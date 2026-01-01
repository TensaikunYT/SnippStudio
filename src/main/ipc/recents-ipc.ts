// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// IPC for the recent projects: the index, finding projects on disk, opening
// by path, the recycle bin, revealing and opening outputs, renaming. Moved out
// of registerIpc (src/main/index.ts) in SnippStudio phase 2B; registerIpc calls
// it where these stood.
import { app, dialog, shell } from 'electron'
import { mt } from '../strings-main'
import type { WebContents } from 'electron'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { isLocalFilePath } from '../security'
import { cleanRecent, mergeRecents, readRecentsFile, recentForFile, removeRecentPath, renameRecentPath, takeInbox, updateRecents, type RecentRecord } from '../recents-store'
import { scanForProjects, type ScanProgress } from '../project-scan'
import { changedOnDisk, onePerPath, readDiskStamp, renameWithRetry, stampKey, writeFileAtomic } from '../safe-write'
import { ipcMain, knownProjectPaths, rememberDiskStamp, editorState, ownerWindow, windowUsingProject, normalize, stripBom, parseJsonFile, MEDIA_EXTENSIONS, focusEditorWindow } from '../state'
import { resolveProjectMedia } from '../media'
import { recentsPath, inboxDir, withPresence, rememberRecentPaths, isUserProjectPath, projectMediaPaths, forgetAnalysis } from '../project-files'
import { PRODUCT_NAME } from '../../shared/product'
import { foldKey } from '../platform-path'

export function registerRecentsIpc(): void {
  // The list, newest first, each entry marked when its file is not there now
  // (moved, deleted, a drive not connected): it stays listed until the user
  // removes it. Projects other programs saved (the inbox) come in first.
  ipcMain.handle('recents:read', async () => {
    const file = recentsPath()
    const inbox = inboxDir()
    if (inbox) await takeInbox(inbox, file, path.join(app.getPath('userData'), 'inbox-seen.json')).catch(() => 0)
    const { list } = await readRecentsFile(file)
    rememberRecentPaths(list)
    return withPresence(list)
  })

  // Every change is a merge in here, into the list as it is on disk now (see
  // recents-store.ts): the renderer never sends a whole list any more, so two
  // windows (or the app and another program) cannot write over each other's entries.
  ipcMain.handle('recents:upsert', async (_e, raw: unknown) => {
    const entry = cleanRecent({ ...(raw && typeof raw === 'object' ? raw : {}), lastOpened: Date.now() })
    if (!entry || !isUserProjectPath(entry.path)) return false
    const written = await updateRecents(recentsPath(), (list) => mergeRecents(list, [entry], 'touch'))
    if (written) rememberRecentPaths(written)
    return !!written
  })

  ipcMain.handle('recents:remove', async (_e, raw: unknown) => {
    if (!isLocalFilePath(raw)) return false
    return !!(await updateRecents(recentsPath(), (list) => removeRecentPath(list, raw)))
  })

  // "Find projects": the user picks folders, they are searched for project
  // files, and what is found joins the list (a listed file stays as it is).
  // Progress goes to the window as recents:find-progress; recents:find-cancel
  // stops it. Picking the folder is the consent, as in the open dialog.
  const findJobs = new Map<number, { aborted: boolean }>()
  ipcMain.handle('recents:find', async (event) => {
    const win = ownerWindow(event.sender)
    if (!win || findJobs.has(event.sender.id)) return null
    const result = await dialog.showOpenDialog(win, {
      title: mt('project.findFolders'),
      properties: ['openDirectory', 'multiSelections']
    })
    if (result.canceled || result.filePaths.length === 0) return null
    const roots = result.filePaths.filter((p) => isLocalFilePath(p)).map((p) => path.normalize(p))
    if (roots.length === 0) return { found: 0, added: 0, dirs: 0, truncated: false, cancelled: false, roots: [] }
    const job = { aborted: false }
    const sender = event.sender
    findJobs.set(sender.id, job)
    const send = (p: ScanProgress & { phase: 'search' | 'read' }): void => {
      if (!sender.isDestroyed()) sender.send('recents:find-progress', p)
    }
    try {
      const scan = await scanForProjects(roots, { signal: job, onProgress: (p) => send({ ...p, phase: 'search' }) })
      const entries: RecentRecord[] = []
      let last = 0
      for (const f of scan.found) {
        if (job.aborted) break
        const e = await recentForFile(f)
        if (e) entries.push(e)
        if (Date.now() - last > 120) {
          last = Date.now()
          send({ phase: 'read', dirs: scan.dirs, found: entries.length, current: f })
        }
      }
      let added = 0
      if (entries.length) {
        const written = await updateRecents(recentsPath(), (list) => {
          const before = new Set(list.map((e) => foldKey(e.path)))
          const next = mergeRecents(list, entries, 'fill')
          added = next.filter((e) => !before.has(foldKey(e.path))).length
          return next
        })
        if (written) rememberRecentPaths(written)
        else added = 0
      }
      return { found: entries.length, added, dirs: scan.dirs, truncated: scan.truncated, cancelled: scan.cancelled || job.aborted, roots }
    } finally {
      findJobs.delete(sender.id)
    }
  })

  ipcMain.handle('recents:find-cancel', (event) => {
    const job = findJobs.get(event.sender.id)
    if (job) job.aborted = true
    return !!job
  })

  // A project file dragged onto the window from Explorer (the user's list,
  // KLISTE-PLAN.md item 2): dropping it is the same consent as choosing it in
  // the open dialog, so it joins the files project:open-path may read. Only
  // .snipp / .autocut (not any .json), a real file. The path is the one the
  // preload took from the dropped File (preload droppedPath, 22 Nov K4): the
  // page cannot name one.
  ipcMain.handle('project:register-dropped', async (_e, raw: unknown) => {
    if (!isLocalFilePath(raw)) return null
    const p = normalize(raw)
    if (!/\.(snipp|autocut)$/i.test(p)) return null
    const stat = await fs.stat(p).catch(() => null)
    if (!stat?.isFile()) return null
    knownProjectPaths.add(p)
    return p
  })

  // Open a project by an explicit path (a recents entry). Mirrors the open
  // dialog's vetting: it must be a real .autocut/.json file; media is resolved
  // here so the renderer never allowlists arbitrary paths.
  ipcMain.handle('project:open-path', async (event, raw: string) => {
    if (typeof raw !== 'string') return { error: 'bad path' }
    const p = normalize(raw)
    if (!/\.(snipp|autocut|json)$/i.test(p)) return { error: 'not a project file' }
    // Only files the USER has already chosen (a dialog this session, or an
    // entry in their own recents index) — never an arbitrary path the renderer
    // made up. Keeps this as narrow as the dialog-based handlers.
    if (!isUserProjectPath(p)) return { error: 'not a known project' }
    const alreadyOpen = windowUsingProject(p, event.sender.id)
    if (alreadyOpen) {
      focusEditorWindow(alreadyOpen)
      return { error: `This project is already open in another ${PRODUCT_NAME} window.` }
    }
    // (Stamped from this stat, taken BEFORE the read: see dialog:open-project.)
    const stat = await fs.stat(p).catch(() => null)
    if (!stat?.isFile()) return { error: 'missing' }
    knownProjectPaths.add(p)
    let json: string
    try {
      json = stripBom(await fs.readFile(p, 'utf-8'))
    } catch {
      return { error: 'Could not read project file.' }
    }
    let parsed: unknown
    try {
      parsed = parseJsonFile(json)
    } catch {
      return { error: 'Project file is not valid JSON.' }
    }
    const state = editorState(event.sender)
    // (Tied to the window once the page accepts it: project:set-current,
    // phase Ç2a.2, P14.)
    state.diskStamps.set(stampKey(p), { mtimeMs: stat.mtimeMs, size: stat.size })
    return { json, path: p, resolved: await resolveProjectMedia(parsed, p, event.sender) }
  })

  // Move a project file to the OS trash (recoverable). Constrained to real
  // .autocut/.json files (the paths come from our own recents index); goes to
  // the Recycle Bin so it's undoable.
  ipcMain.handle('project:trash', async (event, raw: string) => {
    const p = normalize(String(raw))
    if (!/\.(snipp|autocut|json)$/i.test(p)) return { ok: false, error: 'not a project file' }
    if (!isUserProjectPath(p)) return { ok: false, error: 'not a known project' }
    const alreadyOpen = windowUsingProject(p, event.sender.id)
    if (alreadyOpen) {
      focusEditorWindow(alreadyOpen)
      return { ok: false, error: `Project is open in another ${PRODUCT_NAME} window.` }
    }
    if (!(await fs.stat(p).catch(() => null))?.isFile()) return { ok: false, error: 'missing' }
    try {
      // Read the media list BEFORE binning the file, so the derived analysis it
      // pulled in can go with it instead of sitting in userData for ever.
      const media = await projectMediaPaths(p)
      await shell.trashItem(p)
      knownProjectPaths.delete(p)
      void forgetAnalysis(media)
      return { ok: true }
    } catch (err) {
      return { ok: false, error: String(err) }
    }
  })

  /**
   * Reveal or play something this app just wrote. The allowlist is what the
   * user themselves chose in a native dialog during this session (a save path
   * or the batch folder) — the renderer can't name an arbitrary path and have
   * the shell open it.
   */
  const isOwnOutput = (contents: WebContents, p: string): boolean => {
    const state = editorState(contents)
    const batchExportDir = state.batchExportDir
    return state.chosenSavePaths.has(p) || (!!batchExportDir && p.startsWith(batchExportDir + path.sep)) || p === batchExportDir
  }

  ipcMain.handle('output:reveal', async (event, raw: string) => {
    const p = normalize(String(raw))
    if (!isOwnOutput(event.sender, p)) return false
    if (!(await fs.stat(p).catch(() => null))) return false
    shell.showItemInFolder(p)
    return true
  })

  ipcMain.handle('output:open', async (event, raw: string) => {
    const p = normalize(String(raw))
    if (!MEDIA_EXTENSIONS.has(path.extname(p).toLowerCase())) return false
    if (!isOwnOutput(event.sender, p)) return false
    if (!(await fs.stat(p).catch(() => null))) return false
    const err = await shell.openPath(p)
    return err === ''
  })

  ipcMain.handle('path:reveal', async (_e, raw: string) => {
    const p = normalize(String(raw))
    if (!/\.(snipp|autocut|json)$/i.test(p)) return false
    if (!isUserProjectPath(p)) return false
    if (!(await fs.stat(p).catch(() => null))?.isFile()) return false
    shell.showItemInFolder(p)
    return true
  })

  // Rename a project: rewrites the `name` field inside the file AND renames the
  // file on disk to "<name>.<ext>" in the same folder. Returns the new path.
  ipcMain.handle('project:rename', async (event, args: { path: string; name: string }) => {
    const p = normalize(String(args?.path))
    const name = String(args?.name ?? '').trim().slice(0, 200)
    if (!/\.(snipp|autocut|json)$/i.test(p) || !name) return { ok: false }
    if (!isUserProjectPath(p)) return { ok: false, error: 'not a known project' }
    const alreadyOpen = windowUsingProject(p, event.sender.id)
    if (alreadyOpen) {
      focusEditorWindow(alreadyOpen)
      return { ok: false, error: `Project is open in another ${PRODUCT_NAME} window.` }
    }
    if (!(await fs.stat(p).catch(() => null))?.isFile()) return { ok: false, error: 'missing' }
    // Sanitize the display name into a safe file basename.
    const base = name.replace(/[\\/:*?"<>|]/g, '_').replace(/[. ]+$/, '').trim() || 'project'
    const target = normalize(path.join(path.dirname(p), base + path.extname(p)))
    // Refuse to clobber a different existing file.
    if (foldKey(target) !== foldKey(p) && (await fs.stat(target).catch(() => null))) {
      return { ok: false, error: 'exists' }
    }
    const state = editorState(event.sender)
    try {
      const renamed = await onePerPath(p, async () => {
        // This window's stamp of the file follows it. A file another program
        // had written over since keeps reading as changed: renaming it is not
        // the user saying "overwrite it".
        const stamp = state.diskStamps.get(stampKey(p))
        const before = await readDiskStamp(p)
        const parsed = parseJsonFile(await fs.readFile(p, 'utf-8'))
        if (!parsed || typeof parsed !== 'object') return false
        ;(parsed as { name?: string }).name = name
        // Whole or not at all (safe-write.ts), then moved to its new name.
        await writeFileAtomic(p, JSON.stringify(parsed, null, 2))
        if (target !== p) {
          await renameWithRetry(p, target)
          knownProjectPaths.delete(p)
          knownProjectPaths.add(target)
        }
        if (stamp) {
          state.diskStamps.delete(stampKey(p))
          if (changedOnDisk(stamp, before)) state.diskStamps.set(stampKey(target), stamp)
          else await rememberDiskStamp(state, target)
        }
        return true
      })
      if (!renamed) return { ok: false }
      // Its list entry follows it (a merge into the list on disk).
      const written = await updateRecents(recentsPath(), (list) => renameRecentPath(list, p, target, name))
      if (written) rememberRecentPaths(written)
      if (foldKey(state.currentProjectPath) === foldKey(p)) state.currentProjectPath = target
      return { ok: true, path: target }
    } catch (err) {
      return { ok: false, error: String(err) }
    }
  })
}
