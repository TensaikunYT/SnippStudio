// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// The voice-over in the main process (REF-AB, worker S, item 8;
// REF-AB-PLAN-S.md; SECURITY-REVIEW.md "The microphone"):
//  - the session's permission handlers: every permission refused, except the
//    microphone for the editor's own page right after its Record press
//    (voiceover-permission.ts decides);
//  - the take written as a WAV beside the project (its `Voiceover` folder),
//    at a path main makes: the page hands over the bytes, never a path.
import { app, type Session, type WebContents } from 'electron'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { isTrustedDocument } from './network'
import { allowedMediaPaths, devUrl, editorWindows, ipcMain, normalize, pathToMediaUrl, rendererEntry } from './state'
import { foldKey, isInside } from './platform-path'
import { writeFileAtomic } from './safe-write'
import { mt } from './strings-main'
import { fileStamp, isVoiceoverWav, MAX_WAV_BYTES, micCheckAllowed, micRequestAllowed, ARM_MS } from './voiceover-permission'

/** When each editor window's page last armed (by web contents id). */
const armed = new Map<number, number>()
/** Windows given the microphone since they opened. */
const granted = new Set<number>()

const ownPage = (url: string | undefined): boolean => !!url && isTrustedDocument(url, rendererEntry, devUrl)

/** The session's permission handlers (index.ts secureSession). */
export function guardPermissions(ses: Session): void {
  ses.setPermissionRequestHandler((wc: WebContents, permission, callback, details) => {
    const id = wc?.id ?? -1
    const ok = micRequestAllowed({
      permission,
      mediaTypes: (details as { mediaTypes?: string[] }).mediaTypes,
      isMainFrame: !!details?.isMainFrame,
      ownPage: ownPage(details?.requestingUrl) && ownPage(wc?.getURL()),
      editor: editorWindows.has(id),
      armedAt: armed.get(id),
      now: Date.now()
    })
    if (ok) {
      // One press, one microphone.
      armed.delete(id)
      if (!granted.has(id)) wc.once('destroyed', () => granted.delete(id))
      granted.add(id)
    }
    callback(ok)
  })
  ses.setPermissionCheckHandler((wc, permission, _origin, details) => {
    const id = wc?.id ?? -1
    const at = armed.get(id)
    return micCheckAllowed({
      permission,
      mediaType: details?.mediaType,
      isMainFrame: !!details?.isMainFrame,
      ownPage: ownPage(details?.requestingUrl) && ownPage(wc?.getURL()),
      editor: !!wc && editorWindows.has(id),
      granted: granted.has(id),
      armed: at !== undefined && Date.now() - at <= ARM_MS
    })
  })
  ses.setDevicePermissionHandler(() => false)
}

/** Where the window's takes go: the project's `Voiceover` folder, or the
 *  profile's for a project never saved. Made if missing; its real path must
 *  lie inside the project's folder (a planted junction must not lead out:
 *  the security patch's item 5 rule). */
async function takeFolder(projectPath: string | null): Promise<string | null> {
  if (projectPath) {
    const root = path.dirname(projectPath)
    const dir = path.join(root, mt('voiceover.folder'))
    await fs.mkdir(dir, { recursive: true })
    const [real, realRoot] = await Promise.all([fs.realpath(dir), fs.realpath(root)])
    if (!isInside(realRoot, real) || foldKey(real) === foldKey(realRoot)) return null
    return dir
  }
  const root = app.getPath('userData')
  const dir = path.join(root, mt('voiceover.profileFolder'))
  await fs.mkdir(dir, { recursive: true })
  const [real, realRoot] = await Promise.all([fs.realpath(dir), fs.realpath(root)])
  return isInside(realRoot, real) && foldKey(real) !== foldKey(realRoot) ? dir : null
}

export function registerVoiceoverIpc(): void {
  // The page is about to ask for the microphone: its Record press.
  ipcMain.handle('voiceover:arm', (event) => {
    armed.set(event.sender.id, Date.now())
    return true
  })
  ipcMain.handle('voiceover:write', async (event, data: unknown) => {
    if (!(data instanceof Uint8Array) || data.byteLength > MAX_WAV_BYTES || !isVoiceoverWav(data)) return null
    const projectPath = editorWindows.get(event.sender.id)?.currentProjectPath ?? null
    const dir = await takeFolder(projectPath).catch(() => null)
    if (!dir) return null
    const base = mt('voiceover.file', { when: fileStamp(new Date()) })
    let p = ''
    for (let n = 1; n < 1000; n++) {
      const name = n === 1 ? `${base}.wav` : `${base} (${n}).wav`
      const candidate = normalize(path.join(dir, name))
      if (!(await fs.stat(candidate).catch(() => null))) {
        p = candidate
        break
      }
    }
    if (!p) return null
    await writeFileAtomic(p, data)
    allowedMediaPaths.add(foldKey(p))
    const st = await fs.stat(p)
    return { path: p, name: path.basename(p), size: st.size, mtime: Math.round(st.mtimeMs), url: pathToMediaUrl(p), inProject: !!projectPath }
  })
}
