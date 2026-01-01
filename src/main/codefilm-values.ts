// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// "Code values" in the main process (cila K, SnippStudio CILA-K-PLAN.md):
// the constants of a code clip's page the user changes by hand.
//
//   scan    the film folder's pages, style sheets and scripts are read and
//           the places found (src/shared/codeval): when the panel opens and
//           when a file changes, never otherwise;
//   serve   the user's changes are written into a file's TEXT AS IT IS
//           SERVED (codefilm.ts serveFilm, before the guard is put in); the
//           file on disk is not touched. A film without changes is served
//           exactly as before: nothing here is reached;
//   write   "Write to the files": the changes go into the files themselves,
//           after the version keeper kept the files as they are.
//
// A change is written only where the scanner finds its place in the file as
// it is NOW, in the shape the scanner says (shared/codeval/values.ts emit):
// what a project file claims is never trusted with where or how to write.
// No Electron here: tested in Node.
import { createHash } from 'node:crypto'
import { promises as fs, realpath as realpathCb } from 'node:fs'
import { cleanEdits, FILE_MAX, FOLDER_MAX, isEditsKey, isScanned, patchText, resolveEdits, scanFile, type CodeEdit, type Slot } from '../shared/codeval'
import { filmPathFor, ignoredChange, type ServedValues } from './codefilm'
import { realInside, VERSION_DIR, type VersionKeeper } from './codefilm-versions'
import { foldKey, isInside, pathApi } from './platform-path'

/** How long a page's request waits for the changes its address names. */
export const VALUES_WAIT_MS = 8000
/** The lists of changes kept per film (the pages loading now, the one before). */
const KEYS_KEPT = 6

/** A file's text when it is UTF-8 and nothing else (what the film's server
 *  says every text file is): decoding and encoding it gives the same bytes.
 *  Null for anything else (UTF-16, a byte that is not UTF-8): left alone. */
export function decodeText(buf: Buffer): { text: string; bom: boolean } | null {
  const bom = buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf
  const body = bom ? buf.subarray(3) : buf
  if ((body[0] === 0xff && body[1] === 0xfe) || (body[0] === 0xfe && body[1] === 0xff)) return null
  const text = body.toString('utf8')
  return Buffer.from(text, 'utf8').equals(body) ? { text, bom } : null
}

export function encodeText(text: string, bom: boolean): Buffer {
  const body = Buffer.from(text, 'utf8')
  return bom ? Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), body]) : body
}

export interface ScanSet {
  /** The files scanned: their paths with "/", index.html first, then by name. */
  files: string[]
  /** Pages, style sheets and scripts left out (too long, or past the folder's 2 MB). */
  skipped: number
  bytes: number
}

/** Which files of a film folder are scanned: its pages, style sheets and
 *  scripts (by extension), without the parts that are not the film's code
 *  (node_modules, the versions, the app's side files), each at most
 *  FILE_MAX, FOLDER_MAX in all. Links are not followed. Only names and
 *  sizes are read. */
export async function scanSet(root: string): Promise<ScanSet> {
  const found: { rel: string; size: number }[] = []
  const walk = async (rel: string, depth: number): Promise<void> => {
    if (depth > 8 || found.length > 4000) return
    const entries = await fs.readdir(pathApi().join(root, rel), { withFileTypes: true }).catch(() => [])
    const files: string[] = []
    for (const e of entries) {
      const r = rel ? `${rel}/${e.name}` : e.name
      if (r === VERSION_DIR || ignoredChange(r)) continue
      if (e.isDirectory()) await walk(r, depth + 1)
      else if (e.isFile() && isScanned(e.name)) files.push(r)
    }
    // (A folder's sizes asked together.)
    const sizes = await Promise.all(files.map((r) => fs.stat(pathApi().join(root, r)).then((st) => st.size, () => null)))
    files.forEach((r, i) => {
      if (sizes[i] !== null) found.push({ rel: r, size: sizes[i]! })
    })
  }
  await walk('', 0)
  const first = (r: string): number => (/^index\.html?$/i.test(r) ? 0 : 1)
  found.sort((a, b) => first(a.rel) - first(b.rel) || (a.rel.toLowerCase() < b.rel.toLowerCase() ? -1 : a.rel.toLowerCase() > b.rel.toLowerCase() ? 1 : 0))
  const files: string[] = []
  let bytes = 0
  let skipped = 0
  for (const f of found) {
    if (f.size > FILE_MAX || bytes + f.size > FOLDER_MAX) skipped++
    else {
      bytes += f.size
      files.push(f.rel)
    }
  }
  return { files, skipped, bytes }
}

// ---- scans kept by content ----------------------------------------------------------

const scans = new Map<string, Slot[]>()
const SCANS_KEPT = 300

/** The places of a file's text (kept by what the text is: a file that did
 *  not change is not scanned again). */
export function scanCached(rel: string, buf: Buffer, text: string): Slot[] {
  const key = rel + '|' + createHash('sha1').update(buf).digest('hex')
  let slots = scans.get(key)
  if (slots) {
    scans.delete(key)
    scans.set(key, slots)
    return slots
  }
  slots = scanFile(rel, text)
  scans.set(key, slots)
  while (scans.size > SCANS_KEPT) scans.delete(scans.keys().next().value as string)
  return slots
}

/** Forgets the scans kept (the speed baseline's first scans: e2e only). */
export function forgetScans(): number {
  const n = scans.size
  scans.clear()
  return n
}

export interface FolderScan {
  slots: Slot[]
  files: number
  skipped: number
  bytes: number
  /** How long reading and scanning took (ms). */
  ms: number
}

/** Every place of a film folder (the panel's list). */
export async function scanFolder(root: string): Promise<FolderScan> {
  const t0 = performance.now()
  const set = await scanSet(root)
  // (The folder's real path once; the files read a few at a time: cila K
  // step 6, a 2 MB folder within 150 ms.)
  const realRoot = await realNative(root)
  const bufs: (Buffer | null)[] = new Array(set.files.length).fill(null)
  if (realRoot) {
    let next = 0
    const worker = async (): Promise<void> => {
      while (next < set.files.length) {
        const i = next++
        bufs[i] = await readInside(root, realRoot, set.files[i])
      }
    }
    await Promise.all(Array.from({ length: Math.min(READERS, set.files.length) }, worker))
  }
  const slots: Slot[] = []
  set.files.forEach((rel, i) => {
    const buf = bufs[i]
    const dec = buf ? decodeText(buf) : null
    if (buf && dec) for (const s of scanCached(rel, buf, dec.text)) slots.push(s)
  })
  return { slots, files: set.files.length, skipped: set.skipped, bytes: set.bytes, ms: Math.round((performance.now() - t0) * 10) / 10 }
}

/** Files of a folder read at once while scanning it. */
const READERS = 8

/** A path as the disk resolves it (the system's own call: one per path), or null. */
const realNative = (p: string): Promise<string | null> => new Promise((resolve) => realpathCb.native(p, (e, r) => resolve(e ? null : r)))

/** A file of the folder, read only when it really lies inside it (a link
 *  that leads out is not followed: its real path is inside the folder's
 *  real path `realRoot`), or null. */
async function readInside(root: string, realRoot: string, rel: string): Promise<Buffer | null> {
  const file = filmPathFor(root, '/' + rel.split('/').map(encodeURIComponent).join('/'))
  if (!file) return null
  const real = await realNative(file)
  if (!real || !isInside(realRoot, real)) return null
  return fs.readFile(file).catch(() => null)
}

// ---- the changes of the pages being served -----------------------------------------

interface Plan {
  key: string
  edits: CodeEdit[]
  /** The files that are scanned (folded path → the path as the folder spells it). */
  files: Map<string, string>
  group: boolean
  own: Set<string>
}

/**
 * The changes of the pages being served (serveFilm's `values`).
 * `patch`: the bytes to serve for a text file of film `id` instead of the
 * file's own, or null (serve the file as it is: no changes, or none for it).
 * `page`: the query of an HTML page; the film's own page (`snipp=1…`) says
 * with it which list of changes this load is of. 'missing': the list it
 * names never arrived (the page is not served).
 */
export class FilmValues implements ServedValues {
  private lists = new Map<string, Map<string, CodeEdit[]>>()
  private current = new Map<string, Plan>()
  private waiting = new Map<string, (() => void)[]>()
  constructor(private readonly waitMs = VALUES_WAIT_MS) {}

  /** The editor's list of changes for a film, under its name (editsKey). */
  put(id: string, key: unknown, raw: unknown): boolean {
    if (!isEditsKey(key)) return false
    let l = this.lists.get(id)
    if (!l) this.lists.set(id, (l = new Map()))
    l.delete(key)
    l.set(key, cleanEdits(raw))
    while (l.size > KEYS_KEPT) l.delete(l.keys().next().value as string)
    const w = this.waiting.get(`${id}|${key}`)
    this.waiting.delete(`${id}|${key}`)
    for (const done of w ?? []) done()
    return true
  }

  /** The list a page's address names; waits for it a while (the page's
   *  request and the editor's message race). Null when it never comes. */
  private async listFor(id: string, key: string): Promise<CodeEdit[] | null> {
    const have = (): CodeEdit[] | undefined => this.lists.get(id)?.get(key)
    if (have()) return have()!
    const k = `${id}|${key}`
    await new Promise<void>((resolve) => {
      const l = this.waiting.get(k) ?? []
      this.waiting.set(k, l)
      const timer = setTimeout(done, this.waitMs)
      function done(): void {
        clearTimeout(timer)
        resolve()
      }
      l.push(done)
    })
    return have() ?? null
  }

  async patch(id: string, root: string, rel: string, real: string, page: URLSearchParams | undefined): Promise<Buffer | null | 'missing'> {
    if (page?.has('snipp')) {
      // The film's own page: this load's list of changes (none: served as it is).
      const key = page.get('sne')
      if (!key) this.current.delete(id)
      else {
        if (!isEditsKey(key)) return 'missing'
        const edits = await this.listFor(id, key)
        if (!edits) return 'missing'
        const set = edits.length ? await scanSet(root) : { files: [] }
        this.current.set(id, {
          key,
          edits,
          files: new Map(set.files.map((f) => [foldKey(f), f])),
          group: edits.some((e) => e.file === undefined),
          own: new Set(edits.flatMap((e) => (e.file === undefined ? [] : [foldKey(e.file)])))
        })
      }
    }
    const plan = this.current.get(id)
    if (!plan || !plan.edits.length) return null
    const name = plan.files.get(foldKey(rel))
    if (!name || !(plan.group || plan.own.has(foldKey(rel)))) return null
    const buf = await fs.readFile(real).catch(() => null)
    const dec = buf ? decodeText(buf) : null
    if (!buf || !dec) return null
    const slots = scanCached(name, buf, dec.text)
    if (!slots.length) return null
    const out = patchText(dec.text, slots, resolveEdits(slots, plan.edits).writes)
    return out === dec.text ? null : encodeText(out, dec.bom)
  }

  /** (Tests.) */
  planKey(id: string): string | null {
    return this.current.get(id)?.key ?? null
  }
}

/** The app's own (main/index.ts hands it to serveFilm; the IPC fills it). */
export const filmValues = new FilmValues()

// ---- "Write to the files" ------------------------------------------------------------

export interface WriteResult {
  /** Files rewritten and places changed in them. */
  files: number
  places: number
  /** The version that holds the files as they were. */
  version: number | null
}

/**
 * Writes the changes into the film's own files: each scanned file is read,
 * patched as it would be served, and written when it differs. Before the
 * first byte is written the version keeper keeps the files as they are
 * (`keeper.keepThen`); when it cannot (their text is over a version's limit)
 * nothing is written. A file that changed between the read and the write
 * stops everything.
 */
export async function writeValues(root: string, raw: unknown, keeper: Pick<VersionKeeper, 'keepThen'>): Promise<WriteResult> {
  const edits = cleanEdits(raw)
  if (!edits.length) throw new Error('there is nothing to write')
  const set = await scanSet(root)
  const read: { rel: string; file: string; buf: Buffer; text: string; bom: boolean; slots: Slot[] }[] = []
  for (const rel of set.files) {
    const file = filmPathFor(root, '/' + rel.split('/').map(encodeURIComponent).join('/'))
    if (!file || !(await realInside(root, file))) continue
    const buf = await fs.readFile(file).catch(() => null)
    const dec = buf ? decodeText(buf) : null
    if (buf && dec) read.push({ rel, file, buf, text: dec.text, bom: dec.bom, slots: scanCached(rel, buf, dec.text) })
  }
  const all = read.flatMap((f) => f.slots)
  const { writes } = resolveEdits(all, edits)
  const todo: { file: string; before: Buffer; after: Buffer }[] = []
  let places = 0
  let from = 0
  for (const f of read) {
    const mine = writes.slice(from, from + f.slots.length)
    from += f.slots.length
    const out = patchText(f.text, f.slots, mine)
    if (out === f.text) continue
    places += mine.filter(Boolean).length
    todo.push({ file: f.file, before: f.buf, after: encodeText(out, f.bom) })
  }
  if (!todo.length) throw Object.assign(new Error('none of the changes has a place in the files any more'), { reason: 'gone' })
  const version = await keeper.keepThen(async () => {
    for (const t of todo) {
      const now = await fs.readFile(t.file).catch(() => null)
      if (!now || !now.equals(t.before)) throw Object.assign(new Error('a file changed while its values were being written: nothing more was written'), { reason: 'changed' })
    }
    for (const t of todo) await fs.writeFile(t.file, t.after)
  })
  return { files: todo.length, places, version }
}
