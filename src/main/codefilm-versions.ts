// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// Versions of a code clip's files (phase 5e, decision 3). Each time the files
// of an `anim\<name>\` folder change (the change settled for 2 s), the state
// they had before goes into `anim\<name>\.surumler\<n>\`: only text files,
// at most 2 MB a version, the last 10 versions. "Back to the previous
// version" (the inspector) puts one back in one click; the files as they
// were then become a version too. The app never deletes the agent's files
// otherwise; the versions are the app's own copies.
//
// The watch ignores its own `.surumler` folder (no loop: audit point 4) and
// the film watcher (codefilm.ts ignoredChange) does too.
import { promises as fs, realpathSync, watch, type FSWatcher } from 'node:fs'
import { ignoredChange } from './codefilm'
import { foldKey, isInside, pathApi } from './platform-path'

export const VERSION_DIR = '.surumler'
export const VERSION_KEEP = 10
export const VERSION_MAX_BYTES = 2 * 1024 * 1024
export const VERSION_SETTLE_MS = 2000
/** The files a version keeps: text, by their extension. */
export const TEXT_FILE = /\.(html?|m?js|cjs|jsx|tsx?|css|json|svg|txt|md|glsl|frag|vert|wgsl|csv|xml)$/i

type Files = Map<string, Buffer>

/** A folder whose versions are kept: a code clip's own, `…\anim\<name>`.
 *  With `projectPath` (audit D3): only the anim\<name> beside that saved
 *  project file, the paths compared (a folder named anim elsewhere is the
 *  user's: nothing is written into it). */
export function isVersioned(root: string, projectPath?: string | null): boolean {
  if (foldKey(pathApi().basename(pathApi().dirname(root))) !== 'anim') return false
  if (projectPath === undefined) return true
  if (!projectPath || !pathApi().isAbsolute(projectPath)) return false
  const own = foldKey(pathApi().resolve(pathApi().dirname(projectPath), 'anim'))
  return foldKey(pathApi().resolve(pathApi().dirname(root))) === own
}

// ---- links that lead outside (security patch, item 5; K-G3) -----------------
// A project folder that came from somewhere else can hold `anim\<name>` (or
// `anim`, or a clip's `.surumler`) as a junction or a symbolic link to any
// folder of the user's. The path's text then still says "inside the project";
// the disk says otherwise. So before anything is written, the path as the
// disk resolves it (links followed) must lie inside the folder it claims to
// be in, resolved the same way.

/** What a refused write says (the agent's `code_clip create` reads it). */
export const OUTSIDE_PROJECT = 'the folder is a link that leads outside the project folder: nothing was written'

/** Is `p`, as the disk resolves it, `inside` itself or within it? A path
 *  that does not exist (or a link to nowhere) is not. */
export async function realInside(inside: string, p: string): Promise<boolean> {
  try {
    return isInside(await fs.realpath(inside), await fs.realpath(p))
  } catch {
    return false
  }
}

/** The same, at once (the keeper is asked for while a project opens). */
export function realInsideSync(inside: string, p: string): boolean {
  try {
    return isInside(realpathSync.native(inside), realpathSync.native(p))
  } catch {
    return false
  }
}

/** Throws unless what is at `p` now (a folder, a link, nothing yet) keeps a
 *  write inside `projectDir`: nothing there is fine, a link out is not. */
export async function mustStayInside(projectDir: string, p: string): Promise<void> {
  const there = await fs.lstat(p).catch(() => null)
  if (there && !(await realInside(projectDir, p))) throw new Error(OUTSIDE_PROJECT)
}

/** The text files of a folder (relative paths with /), without the versions;
 *  null when they are over the 2 MB of a version. */
export async function readTextFiles(root: string, max = VERSION_MAX_BYTES): Promise<Files | null> {
  const out: Files = new Map()
  let bytes = 0
  const walk = async (rel: string): Promise<boolean> => {
    const entries = await fs.readdir(pathApi().join(root, rel), { withFileTypes: true }).catch(() => [])
    for (const e of entries) {
      const r = rel ? `${rel}/${e.name}` : e.name
      if (r === VERSION_DIR || ignoredChange(r)) continue
      if (e.isDirectory()) {
        if (!(await walk(r))) return false
        continue
      }
      if (!e.isFile() || !TEXT_FILE.test(e.name)) continue
      const b = await fs.readFile(pathApi().join(root, r)).catch(() => null)
      if (!b) continue
      bytes += b.length
      if (bytes > max) return false
      out.set(r, b)
    }
    return true
  }
  return (await walk('')) ? out : null
}

export function sameFiles(a: Files | null, b: Files | null): boolean {
  if (!a || !b) return a === b
  if (a.size !== b.size) return false
  for (const [k, v] of a) if (!b.get(k)?.equals(v)) return false
  return true
}

/** The versions kept, oldest first. */
export async function versionNumbers(root: string): Promise<number[]> {
  const entries = await fs.readdir(pathApi().join(root, VERSION_DIR), { withFileTypes: true }).catch(() => [])
  return entries
    .filter((e) => e.isDirectory() && /^\d{1,6}$/.test(e.name))
    .map((e) => +e.name)
    .sort((x, y) => x - y)
}

async function writeVersion(root: string, files: Files): Promise<number> {
  // (Never an empty version: audit D2.)
  if (!files.size) throw new Error('nothing to keep')
  // (A `.surumler` that is a link out of the clip's folder gets no copy, and
  // nothing is pruned through it: security patch, item 5.)
  await mustStayInside(root, pathApi().join(root, VERSION_DIR))
  const ns = await versionNumbers(root)
  const n = (ns[ns.length - 1] ?? 0) + 1
  const dir = pathApi().join(root, VERSION_DIR, String(n))
  for (const [rel, b] of files) {
    const to = pathApi().join(dir, ...rel.split('/'))
    await fs.mkdir(pathApi().dirname(to), { recursive: true })
    await fs.writeFile(to, b)
  }
  await fs.mkdir(dir, { recursive: true })
  // The oldest go: the last VERSION_KEEP stay.
  const all = [...ns, n]
  for (const old of all.slice(0, Math.max(0, all.length - VERSION_KEEP))) await fs.rm(pathApi().join(root, VERSION_DIR, String(old)), { recursive: true, force: true })
  return n
}

/** Keeps the versions of one folder while the app runs. */
export class VersionKeeper {
  private snapshot: Files | null = null
  private ready: Promise<void>
  private chain: Promise<unknown> = Promise.resolve()
  private timer: ReturnType<typeof setTimeout> | null = null
  private w: FSWatcher | null = null
  /** After a "back": the next one goes one version further back. */
  private cursor: number | null = null
  /** How many versions were written by changes (for tests and the log). */
  written = 0

  constructor(readonly root: string, private readonly settleMs = VERSION_SETTLE_MS) {
    this.ready = readTextFiles(root).then((f) => void (this.snapshot = f))
    try {
      this.w = watch(root, { recursive: true }, (_e, name) => {
        const rel = typeof name === 'string' ? name.replace(/\\/g, '/') : ''
        if (!rel || rel === VERSION_DIR || rel.startsWith(VERSION_DIR + '/') || ignoredChange(rel)) return
        this.touched()
      })
      this.w.on('error', () => {})
    } catch {
      this.w = null
    }
  }

  /** A file changed: the state before it is kept once the change settles. */
  touched(): void {
    if (this.timer) clearTimeout(this.timer)
    this.timer = setTimeout(() => {
      this.timer = null
      void this.serial(() => this.settle())
    }, this.settleMs)
  }

  private serial<T>(work: () => Promise<T>): Promise<T> {
    const next = this.chain.then(work, work)
    this.chain = next.catch(() => undefined)
    return next
  }

  /** The files now, against the last state seen: different → that state is a version. */
  async settle(): Promise<number | null> {
    await this.ready
    const now = await readTextFiles(this.root)
    if (sameFiles(now, this.snapshot)) return null
    const before = this.snapshot
    this.snapshot = now
    // (Over the 2 MB, or no text file before: nothing to keep — audit D2.)
    if (!before?.size) return null
    this.cursor = null
    this.written++
    return writeVersion(this.root, before)
  }

  /** The versions kept, and the one "back" would put in place now. */
  async info(): Promise<{ count: number; next: number | null; over: boolean }> {
    await this.ready
    const ns = await versionNumbers(this.root)
    const next = this.cursor === null ? (ns[ns.length - 1] ?? null) : ([...ns].reverse().find((n) => n <= this.cursor!) ?? null)
    // (Its text files over the 2 MB of a version: none kept now — told.)
    return { count: ns.length, next, over: this.snapshot === null }
  }

  /** "Back to the previous version": the files as they are now become a
   *  version (when they differ from the newest one), the chosen version's
   *  files are put back, text files it did not have are removed. */
  back(): Promise<{ n: number; saved: number | null }> {
    return this.serial(async () => {
      await this.ready
      if (this.timer) {
        // A change still settling is kept first.
        clearTimeout(this.timer)
        this.timer = null
        await this.settle()
      }
      await mustStayInside(this.root, pathApi().join(this.root, VERSION_DIR))
      const { next } = await this.info()
      if (next === null) throw new Error('there is no earlier version')
      const dir = pathApi().join(this.root, VERSION_DIR, String(next))
      const target = await readTextFiles(dir, Infinity)
      if (!target) throw new Error('the version could not be read')
      // Audit D2: the files of now are kept as a version first; over the 2 MB
      // they cannot be, and nothing is put back (the work of now stays).
      const now = await readTextFiles(this.root)
      if (!now) throw Object.assign(new Error('the files as they are now are over the 2 MB a version keeps: nothing was put back'), { reason: 'over-limit' })
      // (Kept already as one of the versions: not kept twice.)
      let kept = false
      for (const n of await versionNumbers(this.root)) if (!kept) kept = sameFiles(now, await readTextFiles(pathApi().join(this.root, VERSION_DIR, String(n)), Infinity))
      const saved = kept || !now.size ? null : await writeVersion(this.root, now)
      for (const [rel, b] of target) {
        const to = pathApi().join(this.root, ...rel.split('/'))
        await fs.mkdir(pathApi().dirname(to), { recursive: true })
        await fs.writeFile(to, b)
      }
      for (const rel of now.keys()) if (!target.has(rel)) await fs.rm(pathApi().join(this.root, ...rel.split('/')), { force: true })
      this.snapshot = target
      this.cursor = next - 1
      return { n: next, saved }
    })
  }

  /** The files as they are now are kept as a version, THEN `work` changes
   *  them (cila K, "Write to the files": the app writes into a clip's own
   *  code only with the state before it kept). When they cannot be kept
   *  (their text is over a version's limit, or there is none) `work` is not
   *  run. Returns the version made for the state before (null when a kept
   *  version already holds exactly it). What `work` wrote is the state seen
   *  from then on: it makes no second version of itself. */
  keepThen(work: () => Promise<void>): Promise<number | null> {
    return this.serial(async () => {
      await this.ready
      if (this.timer) {
        // A change still settling is kept first.
        clearTimeout(this.timer)
        this.timer = null
        await this.settle()
      }
      await mustStayInside(this.root, pathApi().join(this.root, VERSION_DIR))
      const now = await readTextFiles(this.root)
      if (!now) throw Object.assign(new Error('the files as they are now are over the 2 MB a version keeps: nothing was written'), { reason: 'over-limit' })
      if (!now.size) throw new Error('there is nothing to keep')
      let n: number | null = null
      // (Kept already as one of the versions: not kept twice; "back" goes to that one.)
      let keptAt: number | null = null
      for (const v of await versionNumbers(this.root)) if (sameFiles(now, await readTextFiles(pathApi().join(this.root, VERSION_DIR, String(v)), Infinity))) keptAt = v
      if (keptAt === null) n = await writeVersion(this.root, now)
      try {
        await work()
      } finally {
        // (Whatever was written, even half: it is the state seen from now on.)
        this.snapshot = await readTextFiles(this.root)
        this.cursor = keptAt
        if (this.timer) clearTimeout(this.timer)
        this.timer = null
      }
      return n
    })
  }

  stop(): void {
    if (this.timer) clearTimeout(this.timer)
    this.w?.close()
  }
}

const keepers = new Map<string, VersionKeeper>()

/** The keeper of a code clip's folder (made once; null for other folders):
 *  only the open project's own anim\<name> (audit D3; an unsaved project:
 *  none). */
export function keepVersions(root: string, projectPath?: string | null): VersionKeeper | null {
  if (!isVersioned(root, projectPath ?? null)) return null
  // (The folder as the disk resolves it: a planted link to a folder outside
  // the project gets no keeper, so nothing is read, copied, put back or
  // removed there: security patch, item 5.)
  if (!projectPath || !realInsideSync(pathApi().dirname(projectPath), root)) return null
  const key = foldKey(root)
  let k = keepers.get(key)
  if (!k) {
    k = new VersionKeeper(root)
    keepers.set(key, k)
  }
  return k
}

export function stopVersionKeepers(): void {
  for (const k of keepers.values()) k.stop()
  keepers.clear()
}

// ---- the code_clip tool's folder (phase 5e, decision 5) -----------------------

/** The page a new code clip starts with: empty, its body transparent (a page
 *  sets no ground by default: phase 5b, decision 1). No word of how to
 *  animate (ANA-PLAN principle 6), not even a style attribute. */
export const EMPTY_PAGE = '<!doctype html>\n<html>\n<head>\n<meta charset="utf-8">\n</head>\n<body>\n</body>\n</html>\n'

export const ANIM_NAME = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/

/** `anim\<name>\` beside the project file, with an empty index.html unless
 *  the folder already has one (a second create with the same name uses the
 *  folder as it is: nothing is written over). */
export async function makeAnimFolder(projectPath: string, name: string): Promise<{ folder: string; existed: boolean }> {
  if (!ANIM_NAME.test(name)) throw new Error('name: letters, digits, - and _ (at most 64)')
  // (Audit A4: a name Windows keeps for devices makes no folder.)
  if (/^(con|prn|aux|nul|com[0-9]|lpt[0-9])$/i.test(name)) throw new Error('name: a name Windows keeps for devices')
  if (!pathApi().isAbsolute(projectPath) || !/\.snipp$/i.test(projectPath)) throw new Error('save the project first')
  const st = await fs.stat(projectPath).catch(() => null)
  if (!st?.isFile()) throw new Error('save the project first')
  const projectDir = pathApi().dirname(projectPath)
  const anim = pathApi().join(projectDir, 'anim')
  const folder = pathApi().join(anim, name)
  // What is there already (`anim`, `anim\<name>`) must not be a link out of
  // the project folder: before a folder is made, and again once it is there
  // (security patch, item 5; K-G3).
  await mustStayInside(projectDir, anim)
  await mustStayInside(projectDir, folder)
  await fs.mkdir(folder, { recursive: true })
  if (!(await realInside(projectDir, folder))) throw new Error(OUTSIDE_PROJECT)
  const page = pathApi().join(folder, 'index.html')
  let existed = true
  try {
    await fs.writeFile(page, EMPTY_PAGE, { flag: 'wx' })
    existed = false
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e
  }
  return { folder, existed }
}
