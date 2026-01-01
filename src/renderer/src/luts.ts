// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// .cube LUTs: where their tables come from ("cila" part D).
//
// A LUT a clip uses is one of three things (playback/draw/lut-table.ts holds
// the tables themselves):
//   - a built-in look, made by code;
//   - one of the PROJECT's LUT files (`Project.luts`): a .cube named by its
//     path as a media file is, read here when the project is opened or the
//     file is imported, missing when the file is not there (the Inspector
//     and the export's check say so, the clip is drawn without it);
//   - a .cube imported before part D: its text kept in this computer's
//     IndexedDB, by name. A project that names one goes on working where it
//     is found (read below); nothing new is put there while the app can
//     read files.
import { api } from './platform'
import { useStore } from './state/store'
import type { ProjectLut } from './types'
import { bumpFramesVersion } from './playback/scrub'
import { hasProjectLut, parseCube, setDeclaredLuts, setLocalLut, setLutLoading, setProjectLut } from './playback/draw/lut-table'
import type { LutTable } from './playback/draw/fx-math'

export { parseCube } from './playback/draw/lut-table'

const DB = 'autocut-luts'
const STORE = 'luts'

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1)
    req.onupgradeneeded = () => req.result.createObjectStore(STORE)
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

/** What a read of each project LUT was made of (its file as the project
 *  stores it): the same again is not read again. */
const readAs = new Map<string, string>()
const stamp = (l: ProjectLut): string => `${l.path}|${l.relPath ?? ''}|${l.size ?? ''}|${l.mtime ?? ''}`
/** Tables parsed at import, waiting for the project to declare them. */
const imported = new Map<string, { stamp: string; table: LutTable }>()

/** A name no other LUT file of the project has (the same file keeps its name). */
function freeName(base: string, path: string, luts: readonly ProjectLut[]): string {
  const same = luts.find((l) => l.path.toLowerCase() === path.toLowerCase())
  if (same) return same.name
  // A LUT of this name whose file is missing: this file is it, found again
  // (every clip that names it has it back).
  if (luts.some((l) => l.name === base && !hasProjectLut(l.name))) return base
  let name = base
  for (let i = 2; luts.some((l) => l.name === name); i++) name = `${base} ${i}`
  return name
}

/**
 * Imports a .cube file: one of the project's LUTs from now on (its path is
 * kept, the file is not copied), and `clipId`'s LUT, in one undo step.
 * Returns the name clips use for it. Throws when the file is no 3D .cube.
 */
export async function addLut(file: File, clipId?: string): Promise<string> {
  const base = file.name.replace(/\.cube$/i, '').trim() || 'LUT'
  const text = await file.text()
  const table = parseCube(text) // throws if invalid
  const path = api?.getPathForFile ? api.getPathForFile(file) : ''
  const s = useStore.getState()
  if (!path) {
    // No file path (a plain browser): kept on this computer, as before.
    setLocalLut(base, table)
    const db = await openDb()
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite').objectStore(STORE).put(text, base)
      tx.onsuccess = () => resolve()
      tx.onerror = () => reject(tx.error)
    })
    if (clipId) s.setClipLut(clipId, base)
    return base
  }
  const name = freeName(base, path, s.project.luts ?? [])
  const lut: ProjectLut = { name, path, size: file.size, mtime: Math.round(file.lastModified) }
  imported.set(name, { stamp: stamp(lut), table })
  s.addProjectLut(lut, clipId)
  syncProjectLuts()
  return name
}

/** Reads one project LUT's file (again). */
async function readLut(lut: ProjectLut): Promise<void> {
  const mine = stamp(lut)
  readAs.set(lut.name, mine)
  const ready = imported.get(lut.name)
  if (ready && ready.stamp === mine) {
    imported.delete(lut.name)
    setProjectLut(lut.name, ready.table)
    bumpFramesVersion()
    return
  }
  setLutLoading(lut.name, true)
  let table: LutTable | null = null
  let found: { path: string; size: number; mtime: number } | null = null
  try {
    const got = api?.lutRead ? await api.lutRead({ path: lut.path, relPath: lut.relPath, size: lut.size }) : null
    if (got) {
      table = parseCube(got.text)
      found = got
    }
  } catch {
    table = null
  }
  // Another read of this name started meanwhile (the project changed): its
  // answer is the one that counts.
  if (readAs.get(lut.name) !== mine) return
  setProjectLut(lut.name, table)
  bumpFramesVersion()
  // Found beside a moved project: that is where it lives now, so the next
  // save writes the right relative path (as a media file's: linkMedia).
  if (found && found.path !== lut.path) {
    const now = { ...lut, path: found.path, size: found.size, mtime: found.mtime }
    readAs.set(lut.name, stamp(now))
    // (Told to the project without making it unsaved: a media file found
    // beside a moved project is not an edit either; the next save writes it.)
    const unsaved = useStore.getState().dirty
    useStore.getState().updateProjectLut(lut.name, { path: found.path, size: found.size, mtime: found.mtime })
    if (!unsaved) useStore.getState().setDirty(false)
  }
}

let lastList: readonly ProjectLut[] | undefined
/** Brings the tables in line with the LUT files the open project declares. */
export function syncProjectLuts(): void {
  const luts = useStore.getState().project.luts
  if (luts === lastList) return
  lastList = luts
  const list = luts ?? []
  setDeclaredLuts(list.map((l) => l.name))
  for (const k of [...readAs.keys()]) if (!list.some((l) => l.name === k)) readAs.delete(k)
  for (const lut of list) {
    if (readAs.get(lut.name) === stamp(lut) && (hasProjectLut(lut.name) || !imported.has(lut.name))) continue
    void readLut(lut)
  }
  bumpFramesVersion()
}

/** Reads every project LUT's file again and waits for them: the export does,
 *  so its first frame already has them (and a file that came back is found). */
export async function ensureProjectLuts(project?: { luts?: ProjectLut[] }): Promise<void> {
  syncProjectLuts()
  const open = useStore.getState().project.luts ?? []
  // (Only the open project's: the tables are kept for it.)
  if (project && project.luts !== undefined && project.luts !== open) return
  await Promise.all(open.filter((l) => !hasProjectLut(l.name)).map((l) => readLut(l)))
}

let watching = false
/** Loads the LUTs kept on this computer and follows the open project's own
 *  (call at startup). */
export async function loadLuts(): Promise<void> {
  if (!watching) {
    watching = true
    useStore.subscribe(() => syncProjectLuts())
    syncProjectLuts()
  }
  try {
    const db = await openDb()
    // Wait on the TRANSACTION. The same shape as the font loader had, and the
    // same fault: getAllKeys() is issued first, so it finishes before
    // v.onsuccess ever gets round to assigning k.onsuccess, and the promise
    // never settles. Nothing awaited this either — it simply meant an imported
    // .cube was gone from the list after a restart, with nothing to explain it.
    const [keys, vals] = await new Promise<[IDBValidKey[], string[]]>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readonly')
      const store = tx.objectStore(STORE)
      const k = store.getAllKeys()
      const v = store.getAll()
      tx.oncomplete = () => resolve([k.result, v.result as string[]])
      tx.onerror = () => reject(tx.error)
      tx.onabort = () => reject(tx.error)
    })
    for (let i = 0; i < keys.length; i++) {
      try {
        setLocalLut(String(keys[i]), parseCube(vals[i]))
      } catch {
        /* skip broken */
      }
    }
    bumpFramesVersion()
  } catch {
    /* none */
  }
}
