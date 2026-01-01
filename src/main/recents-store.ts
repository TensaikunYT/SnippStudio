// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
/**
 * The recent-projects index (recents.json in userData): every change is a
 * merge into what is on disk now, never a whole list sent from somewhere else.
 *
 * Why (round 8 of the fix run): the renderer used to read the list, change it
 * and send the whole list back. Two windows interleaving those steps lost one
 * of the changes; a list that could not be read for a moment (a half-written
 * or locked file) came back as "no projects", and the next save wrote a list
 * holding that one project over everything. Here each change re-reads the
 * file, merges, de-duplicates by the normalised path and writes atomically
 * (temp file + rename), one change at a time per file. A file that cannot be
 * read is left alone (the change waits for the next save) and a file that is
 * not JSON any more is kept aside before a fresh list replaces it. Entries are
 * never dropped because their file is missing (a disconnected drive): only the
 * user removes them.
 *
 * No Electron and no relative imports: another program can load this file
 * directly (Node strips the types) to register the projects it saves, and
 * the tests run it.
 */
import { promises as fs } from 'node:fs'
import path from 'node:path'

export interface RecentRecord {
  path: string
  name: string
  /** A small JPEG data URL of the playhead frame (the newest entries only). */
  thumbnail?: string
  durationSec: number
  width: number
  height: number
  /** ms since the epoch: the last open or save (a found file: its mtime). */
  lastOpened: number
  sizeBytes: number
}

/** More than anyone opens; the oldest go past this. */
export const RECENTS_MAX = 1000
/** Thumbnails are kept for the newest entries only, so the file stays small. */
export const THUMBS_MAX = 60
const THUMB_MAX_CHARS = 200_000
const PROJECT_EXT = /\.(snipp|autocut|json)$/i

// ---- the platform's path rules (phase 10a, step 1) ----------------------------
// The same rules as platform-path.ts, written here because this file imports
// nothing relative; src/test/platform-path.test.ts checks that the two agree.
// Windows' branch is the code as it was.
let rulesPlatform: NodeJS.Platform | null = null
const plat = (): NodeJS.Platform => rulesPlatform ?? process.platform
/** Tests only: this file's path rules as another platform's (null: this computer's). */
export function setRecentsPlatformForTests(p: NodeJS.Platform | null): void {
  rulesPlatform = p
}
const papi = (platform: NodeJS.Platform = plat()): typeof path.win32 => (platform === 'win32' ? path.win32 : path.posix)
const fold = (p: string, platform: NodeJS.Platform = plat()): string => (platform === 'win32' ? p.toLowerCase() : platform === 'darwin' ? p.normalize('NFC') : p)

/** Reject UNC/SMB, device namespaces, alternate streams and relative paths
 * before a filesystem call can initiate an OS-level network connection.
 * (macOS / Linux: an absolute path, not //…, not under /dev, /proc, /sys.) */
export function isLocalFilePath(value: unknown, platform: NodeJS.Platform = plat()): value is string {
  if (typeof value !== 'string' || !value || value.length > 4096 || /[\x00-\x1f]/.test(value)) return false
  if (platform !== 'win32') {
    if (!value.startsWith('/') || value.startsWith('//')) return false
    return !/^\/(dev|proc|sys)(\/|$)/.test(path.posix.normalize(value))
  }
  const p = value.replace(/\\/g, '/')
  if (!/^[a-z]:\//i.test(p) || p.slice(2).includes(':')) return false
  // (The device names as platform-path.ts WINDOWS_DEVICE_NAME: security patch, item 10.)
  return !p.slice(3).split('/').some((part) => /^(?:con|prn|aux|nul|com[0-9¹²³]|lpt[0-9¹²³]|conin\$|conout\$|clock\$) *(?:\.|$)/i.test(part))
}

/** One key per file: Windows paths are case-insensitive and take either
 *  slash; macOS keys are NFC; Linux keys keep case (platform-path.ts pathKey). */
export function recentKey(p: string, platform: NodeJS.Platform = plat()): string {
  return fold(papi(platform).normalize(p), platform)
}

const num = (v: unknown, fallback = 0): number => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : fallback)

/** A well-formed entry, or null. Unknown fields are dropped. */
export function cleanRecent(raw: unknown): RecentRecord | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  if (!isLocalFilePath(r.path) || !PROJECT_EXT.test(r.path)) return null
  const p = papi().normalize(r.path)
  const name = typeof r.name === 'string' && r.name.trim() ? r.name.slice(0, 260) : papi().basename(p).replace(PROJECT_EXT, '')
  const entry: RecentRecord = {
    path: p,
    name,
    durationSec: num(r.durationSec),
    width: Math.round(num(r.width, 1920)),
    height: Math.round(num(r.height, 1080)),
    lastOpened: num(r.lastOpened),
    sizeBytes: num(r.sizeBytes)
  }
  if (typeof r.thumbnail === 'string' && r.thumbnail.startsWith('data:image/') && r.thumbnail.length <= THUMB_MAX_CHARS) entry.thumbnail = r.thumbnail
  return entry
}

/** Newest first, one entry per file, capped; thumbnails on the newest only. */
export function tidyRecents(list: RecentRecord[]): RecentRecord[] {
  const byKey = new Map<string, RecentRecord>()
  for (const e of list) {
    const k = recentKey(e.path)
    const prev = byKey.get(k)
    if (!prev) byKey.set(k, e)
    else {
      const [newer, older] = e.lastOpened > prev.lastOpened ? [e, prev] : [prev, e]
      byKey.set(k, { ...newer, thumbnail: newer.thumbnail ?? older.thumbnail })
    }
  }
  const out = [...byKey.values()].sort((a, b) => b.lastOpened - a.lastOpened).slice(0, RECENTS_MAX)
  return out.map((e, i) => {
    if (i < THUMBS_MAX || e.thumbnail === undefined) return e
    const bare: RecentRecord = { ...e }
    delete bare.thumbnail
    return bare
  })
}

/**
 * How a change lands:
 * - `touch` (an open or a save): the new entry replaces the old one and
 *   moves to the top; an old thumbnail stays when the new one has none.
 * - `fill` (found by a scan, registered from outside): added only when the
 *   file is not listed yet; a listed one is left exactly as it is.
 */
export function mergeRecents(list: RecentRecord[], add: RecentRecord[], mode: 'touch' | 'fill' = 'touch'): RecentRecord[] {
  const keys = new Map(list.map((e) => [recentKey(e.path), e]))
  const next = list.slice()
  for (const e of add) {
    const k = recentKey(e.path)
    const prev = keys.get(k)
    if (prev && mode === 'fill') continue
    const merged = prev ? { ...e, thumbnail: e.thumbnail ?? prev.thumbnail } : e
    const i = next.findIndex((x) => recentKey(x.path) === k)
    if (i >= 0) next.splice(i, 1)
    next.push(merged)
    keys.set(k, merged)
  }
  return tidyRecents(next)
}

export function removeRecentPath(list: RecentRecord[], p: string): RecentRecord[] {
  const k = recentKey(p)
  return list.filter((e) => recentKey(e.path) !== k)
}

/** A file renamed on disk: its entry follows it (and keeps its place). */
export function renameRecentPath(list: RecentRecord[], from: string, to: string, name: string): RecentRecord[] {
  const k = recentKey(from)
  return tidyRecents(list.map((e) => (recentKey(e.path) === k ? { ...e, path: papi().normalize(to), name } : e)))
}

export type ReadState = 'ok' | 'missing' | 'unreadable' | 'corrupt'

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))
const BUSY = new Set(['EBUSY', 'EPERM', 'EACCES', 'EAGAIN', 'EMFILE', 'ENFILE'])

/** The list on disk. A locked file is tried again a few times: a sharing
 *  violation while another writer renames its file over this one, or a scan,
 *  must not read as "no projects". */
export async function readRecentsFile(file: string): Promise<{ list: RecentRecord[]; state: ReadState }> {
  let text: string | null = null
  for (let attempt = 0; ; attempt++) {
    try {
      text = await fs.readFile(file, 'utf-8')
      break
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code ?? ''
      if (code === 'ENOENT') return { list: [], state: 'missing' }
      if (!BUSY.has(code) || attempt >= 5) return { list: [], state: 'unreadable' }
      await sleep(40 * (attempt + 1))
    }
  }
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1)
  if (!text.trim()) return { list: [], state: 'corrupt' }
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return { list: [], state: 'corrupt' }
  }
  if (!Array.isArray(parsed)) return { list: [], state: 'corrupt' }
  const list: RecentRecord[] = []
  for (const raw of parsed.slice(0, RECENTS_MAX * 2)) {
    const e = cleanRecent(raw)
    if (e) list.push(e)
  }
  return { list: tidyRecents(list), state: 'ok' }
}

let tmpSeq = 0
/** Temp file beside it, then a rename over it: a reader sees the old list or
 *  the new one, never half of one. A rename refused for a moment (the file
 *  held open by a reader or a scanner) is tried again. */
export async function writeRecentsFile(file: string, list: RecentRecord[]): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true })
  const tmp = `${file}.${process.pid}.${Date.now()}.${++tmpSeq}.tmp`
  await fs.writeFile(tmp, JSON.stringify(list), 'utf-8')
  for (let attempt = 0; ; attempt++) {
    try {
      await fs.rename(tmp, file)
      return
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code ?? ''
      if (!BUSY.has(code) || attempt >= 6) {
        await fs.rm(tmp, { force: true }).catch(() => {})
        throw err
      }
      await sleep(50 * (attempt + 1))
    }
  }
}

const queues = new Map<string, Promise<unknown>>()

/**
 * Re-read, change, write: one change at a time per file. Returns the list as
 * written, or null when nothing was written (the file could not be read, or
 * the write failed). A file that is no JSON list any more is copied aside
 * (recents.corrupt-<time>.json) before a fresh list takes its place, so a
 * broken index cannot block the list for ever and nothing is lost unseen.
 */
export function updateRecents(file: string, change: (list: RecentRecord[]) => RecentRecord[]): Promise<RecentRecord[] | null> {
  const key = recentKey(file)
  const run = async (): Promise<RecentRecord[] | null> => {
    const { list, state } = await readRecentsFile(file)
    if (state === 'unreadable') return null
    if (state === 'corrupt') {
      const aside = path.join(path.dirname(file), `recents.corrupt-${Date.now()}.json`)
      try {
        await fs.copyFile(file, aside)
      } catch {
        return null
      }
    }
    const next = tidyRecents(change(list))
    try {
      await writeRecentsFile(file, next)
    } catch {
      return null
    }
    return next
  }
  const prev = queues.get(key) ?? Promise.resolve()
  const job = prev.then(run, run)
  const tail = job.catch(() => null)
  queues.set(key, tail)
  void tail.then(() => {
    if (queues.get(key) === tail) queues.delete(key)
  })
  return job
}

/** A project file's own name, its frame size, its length and the media it
 *  uses, for a list entry (found by a scan, or saved by another program). Null when
 *  the text is not a Snipp project. */
export function summarizeProject(text: string, filePath: string, mtimeMs: number): RecentRecord | null {
  let p: Record<string, any>
  try {
    p = JSON.parse(text.charCodeAt(0) === 0xfeff ? text.slice(1) : text)
  } catch {
    return null
  }
  if (!p || typeof p !== 'object' || Array.isArray(p)) return null
  if (p.version !== 1 && !Array.isArray(p.tracks) && !(p.clips && typeof p.clips === 'object')) return null
  let end = 0
  const clips = p.clips && typeof p.clips === 'object' ? (Object.values(p.clips) as Record<string, unknown>[]) : []
  for (const c of clips) end = Math.max(end, num(c?.start) + num(c?.duration))
  for (const c of Array.isArray(p.captions) ? p.captions : []) end = Math.max(end, num(c?.end))
  const assets = Array.isArray(p.assets) ? p.assets : []
  const sizeBytes = assets.reduce((s: number, a: Record<string, unknown>) => s + num(a?.size), 0)
  const fileName = papi().basename(papi().normalize(filePath)).replace(PROJECT_EXT, '')
  const own = typeof p.name === 'string' ? p.name.trim() : ''
  return cleanRecent({
    path: filePath,
    // "Untitled" says nothing in a list of found files: the file's name does.
    name: own && own.toLowerCase() !== 'untitled' ? own : fileName,
    durationSec: end,
    width: num(p.settings?.width, 1920),
    height: num(p.settings?.height, 1080),
    lastOpened: mtimeMs,
    sizeBytes
  })
}

/** Reads a project file for its entry. Files over the cap are listed by name. */
export async function recentForFile(filePath: string, maxBytes = 64 * 1024 * 1024): Promise<RecentRecord | null> {
  const stat = await fs.stat(filePath).catch(() => null)
  if (!stat?.isFile()) return null
  const fallback = cleanRecent({ path: filePath, lastOpened: stat.mtimeMs })
  if (stat.size > maxBytes) return fallback
  const text = await fs.readFile(filePath, 'utf-8').catch(() => null)
  return (text !== null ? summarizeProject(text, filePath, stat.mtimeMs) : null) ?? fallback
}

// ---- The inbox ---------------------------------------------------------------
// Projects saved by another program (the films Claude makes) are
// dropped as small files into ~/.snipp/inbox, and the packaged app merges them
// into its list the next time it reads it. The list itself lives under
// AppData, and a program run inside a sandbox that keeps its own copy of
// AppData (the Claude desktop app does) would write that copy, never the one
// the user's Snipp reads; the home folder is the same for both.

export const INBOX_EXT = '.json'

/** Writes one inbox file (temp name, then renamed into place). */
export async function writeInbox(dir: string, entries: RecentRecord[]): Promise<string> {
  await fs.mkdir(dir, { recursive: true })
  const base = `${Date.now()}-${process.pid}-${++tmpSeq}`
  const tmp = path.join(dir, `${base}.tmp`)
  const file = path.join(dir, `${base}${INBOX_EXT}`)
  await fs.writeFile(tmp, JSON.stringify(entries), 'utf-8')
  await fs.rename(tmp, file)
  return file
}

/** The inbox's files, oldest first, each with its entries. A file that cannot
 *  be read now is left out (it is read the next time). */
export async function readInbox(dir: string): Promise<{ name: string; entries: RecentRecord[] }[]> {
  const names = await fs.readdir(dir).catch(() => [] as string[])
  const out: { name: string; entries: RecentRecord[] }[] = []
  for (const name of names.filter((n) => n.toLowerCase().endsWith(INBOX_EXT)).sort().slice(-1000)) {
    const { list, state } = await readRecentsFile(path.join(dir, name))
    if (state === 'unreadable' || state === 'missing') continue
    out.push({ name, entries: list })
  }
  return out
}

/**
 * Merges the inbox files this list has not taken in yet. The files stay (an
 * app in another profile, or in a sandbox, may read them too); which ones this
 * list took is kept in `seenFile` beside it, so a project the user removed
 * from the list does not come back. Returns how many entries were new.
 */
export async function takeInbox(dir: string, recentsFile: string, seenFile: string): Promise<number> {
  const files = await readInbox(dir)
  if (files.length === 0) return 0
  const seenNow = await readSeen(seenFile)
  const fresh = files.filter((f) => !seenNow.has(f.name.toLowerCase()))
  if (fresh.length === 0) return 0
  let added = 0
  const written = await updateRecents(recentsFile, (list) => {
    const before = new Set(list.map((e) => recentKey(e.path)))
    const next = mergeRecents(list, fresh.flatMap((f) => f.entries), 'fill')
    added = next.filter((e) => !before.has(recentKey(e.path))).length
    return next
  })
  if (!written) return 0
  // Only names still in the inbox are kept, so the record cannot grow for ever.
  const present = new Set(files.map((f) => f.name.toLowerCase()))
  const keep = [...seenNow, ...fresh.map((f) => f.name.toLowerCase())].filter((n) => present.has(n))
  await writeSeen(seenFile, keep).catch(() => {})
  return added
}

async function readSeen(file: string): Promise<Set<string>> {
  try {
    const parsed = JSON.parse(await fs.readFile(file, 'utf-8'))
    return new Set(Array.isArray(parsed) ? parsed.filter((n): n is string => typeof n === 'string').map((n) => n.toLowerCase()) : [])
  } catch {
    return new Set()
  }
}

async function writeSeen(file: string, names: string[]): Promise<void> {
  const tmp = `${file}.${process.pid}.${++tmpSeq}.tmp`
  await fs.writeFile(tmp, JSON.stringify([...new Set(names)]), 'utf-8')
  await fs.rename(tmp, file)
}

/** Inbox files older than this are removed by the next writer. */
export const INBOX_KEEP_MS = 120 * 24 * 3600 * 1000

/** Registers project files: a safe merge into the list itself (`touch`: a
 *  save is the newest thing done with the file) and, when given, one inbox
 *  file for a Snipp that reads another copy of the list. What another program calls. */
export async function registerProjects(
  files: string[],
  opts: { recentsFile?: string; inboxDir?: string; now?: number } = {}
): Promise<{ entries: RecentRecord[]; skipped: string[]; listWritten: boolean; inboxFile: string | null }> {
  const now = opts.now ?? Date.now()
  const entries: RecentRecord[] = []
  const skipped: string[] = []
  for (const f of files) {
    const abs = path.resolve(f)
    const e = isLocalFilePath(abs) && PROJECT_EXT.test(abs) ? await recentForFile(abs) : null
    if (e) entries.push({ ...e, lastOpened: now })
    else skipped.push(f)
  }
  let listWritten = false
  if (opts.recentsFile && entries.length) listWritten = !!(await updateRecents(opts.recentsFile, (list) => mergeRecents(list, entries, 'touch')))
  let inboxFile: string | null = null
  if (opts.inboxDir && entries.length) {
    inboxFile = await writeInbox(opts.inboxDir, entries)
    const names = await fs.readdir(opts.inboxDir).catch(() => [] as string[])
    for (const n of names) {
      const m = /^(\d{12,})-/.exec(n)
      if (m && now - Number(m[1]) > INBOX_KEEP_MS && n.toLowerCase().endsWith(INBOX_EXT)) await fs.rm(path.join(opts.inboxDir, n), { force: true }).catch(() => {})
    }
  }
  return { entries, skipped, listWritten, inboxFile }
}

// ---- Is the file there? ------------------------------------------------------
// The Projects list marks entries whose file is gone. A stat on a sleeping
// external disk or an unreachable mapped drive holds one of the main process's
// few file threads for seconds, and a stat per entry, all at once, could take
// every one of them: media playback and saves then waited behind it. So each
// drive is asked once (and while that question is still out, a second look
// at the list waits for the same one), and the files on the drives that
// answer are looked at a couple at a time.

/** The drive an entry lives on ("c:\"; "/" on macOS and Linux). */
export function pathRoot(p: string, platform: NodeJS.Platform = plat()): string {
  return fold(papi(platform).parse(papi(platform).normalize(p)).root, platform)
}

export interface PresenceOptions {
  stat: (p: string) => Promise<{ isFile(): boolean }>
  /** How long the whole look may take; what is not known by then stays unmarked. */
  timeoutMs?: number
  /** Files looked at together (default 2). */
  concurrency?: number
  /** The drive questions still out, shared between looks (main keeps one). */
  probes?: Map<string, Promise<boolean>>
}

/** Marks entries whose file is not there now. A drive that does not answer in
 *  time is left unmarked (it may be slow, not gone); a drive that is not there
 *  at all marks its entries at once. */
export async function markPresence<T extends { path: string }>(list: T[], opts: PresenceOptions): Promise<(T & { missing?: boolean })[]> {
  const probes = opts.probes ?? new Map<string, Promise<boolean>>()
  let timer: ReturnType<typeof setTimeout> | undefined
  const late = new Promise<'late'>((r) => {
    timer = setTimeout(() => r('late'), opts.timeoutMs ?? 1500)
  })
  let over = false
  void late.then(() => {
    over = true
  })
  try {
    const roots = new Map<string, boolean | 'late'>()
    await Promise.all(
      [...new Set(list.map((e) => pathRoot(e.path)))].map(async (root) => {
        let probe = probes.get(root)
        if (!probe) {
          const asked: Promise<boolean> = opts.stat(root).then(
            () => true,
            () => false
          )
          probe = asked
          probes.set(root, asked)
          void asked.then(() => {
            if (probes.get(root) === asked) probes.delete(root)
          })
        }
        roots.set(root, await Promise.race([probe, late]))
      })
    )
    const missing = new Map<number, boolean>()
    const todo: number[] = []
    list.forEach((e, i) => {
      const up = roots.get(pathRoot(e.path))
      if (up === false) missing.set(i, true)
      else if (up === true) todo.push(i)
    })
    const worker = async (): Promise<void> => {
      for (let i = todo.shift(); i !== undefined && !over; i = todo.shift()) {
        const r = await Promise.race([
          opts.stat(list[i].path).then(
            (s) => s.isFile(),
            () => false
          ),
          late
        ])
        if (r !== 'late') missing.set(i, !r)
      }
    }
    await Promise.all(Array.from({ length: Math.max(1, opts.concurrency ?? 2) }, worker))
    return list.map((e, i) => (missing.get(i) ? { ...e, missing: true } : e))
  } finally {
    clearTimeout(timer)
  }
}
