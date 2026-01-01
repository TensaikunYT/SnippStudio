// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// The point before the agent, on disk (SnippStudio phase 4A; phase 4A.8,
// FAZ4A-DUZELTME.md C): the project file's text as it was before an agent's
// change, in the profile's agent-restore folder. Written and read only here,
// by names this file made (no path from the page is trusted); written
// atomically (a temporary file renamed) under a unique name.
//
// Names: <ms>-<kind>-<project key>[.<identity>]-<session>-<unique>.snipp,
// kind "pre" (the point before the agent of a work period) or "pt" (a
// session's point); the key is the file path's, the identity the project's
// own (phase 4A.10, E1). Kept: per project its newest "pre" and its newest
// five "pt". Past 40 files only session points go, the oldest first: a
// project's point before the agent is never deleted to make room (E2,
// safety#5); a write says how far over the folder still is. Only names of
// this pattern (and the older <ms>-<label>.snipp ones) in this folder are
// ever deleted.
import { randomBytes } from 'node:crypto'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { writeFileAtomic } from './safe-write'

export const RESTORE_DIR = 'agent-restore'
/** Session points kept per project (besides its point before the agent). */
export const RESTORE_KEEP = 5
/** Files kept in all. */
export const RESTORE_MAX_FILES = 40
const NAME_RE = /^\d{13}-[A-Za-z0-9_-]{1,80}\.snipp$|^\d{13}-(?:pre|pt)-[a-z0-9]{1,12}\.[a-z0-9]{1,12}-[A-Za-z0-9]{0,12}-[a-z0-9]{6}\.snipp$/
const PARTS_RE = /^(\d{13})-(pre|pt)-([a-z0-9]{1,12})(?:\.([a-z0-9]{1,12}))?-[A-Za-z0-9]{0,12}-[a-z0-9]{6}\.snipp$/

const dirOf = (userData: string): string => path.join(userData, RESTORE_DIR)

interface Parsed {
  name: string
  at: number
  kind: 'pre' | 'pt' | 'old'
  key: string
  /** The project's identity ('' in an older name). */
  id: string
}

function parse(name: string): Parsed | null {
  const m = PARTS_RE.exec(name)
  if (m) return { name, at: Number(m[1]), kind: m[2] as 'pre' | 'pt', key: m[3], id: m[4] ?? '' }
  if (NAME_RE.test(name)) return { name, at: Number(name.slice(0, 13)), kind: 'old', key: `old:${name}`, id: '' }
  return null
}

/** The names to delete so that each project keeps its newest point before
 *  the agent (per path AND identity: a file saved over another path is
 *  another project) and its newest RESTORE_KEEP session points, and then,
 *  past RESTORE_MAX_FILES, the oldest SESSION points (`keepKey`'s last).
 *  A point before the agent is never deleted to make room (phase 4A.10,
 *  E2, safety#5). Pure. */
export function pruneList(names: readonly string[], keepKey?: string, max = RESTORE_MAX_FILES, keep = RESTORE_KEEP): string[] {
  const all = names.map(parse).filter((x): x is Parsed => !!x).sort((a, b) => a.at - b.at || a.name.localeCompare(b.name))
  const gone = new Set<string>()
  const byKey = new Map<string, Parsed[]>()
  for (const p of all) byKey.set(p.key, [...(byKey.get(p.key) ?? []), p])
  for (const list of byKey.values()) {
    const pt = list.filter((p) => p.kind === 'pt')
    for (const p of pt.slice(0, Math.max(0, pt.length - keep))) gone.add(p.name)
    const ids = new Set(list.map((p) => p.id))
    for (const id of ids) {
      const pre = list.filter((p) => p.kind === 'pre' && p.id === id)
      for (const p of pre.slice(0, Math.max(0, pre.length - 1))) gone.add(p.name)
    }
  }
  const left = all.filter((p) => !gone.has(p.name))
  let count = left.length
  if (count > max) {
    const spare = left.filter((p) => p.kind !== 'pre').sort((a, b) => Number(a.key === keepKey) - Number(b.key === keepKey) || a.at - b.at)
    for (const p of spare) {
      if (count <= max) break
      gone.add(p.name)
      count--
    }
  }
  return [...gone]
}

/** How many files the folder holds past RESTORE_MAX_FILES after pruning
 *  (points before the agent that were kept): told to the user. Pure. */
export function overCap(names: readonly string[], max = RESTORE_MAX_FILES): number {
  const gone = new Set(pruneList(names, undefined, max))
  return Math.max(0, names.filter((n) => parse(n) && !gone.has(n)).length - max)
}

export async function writeRestorePoint(userData: string, json: unknown, label: unknown, now = Date.now(), rm?: (file: string) => Promise<void>): Promise<{ name: string; path: string; over?: number } | null> {
  if (typeof json !== 'string' || json.length === 0 || json.length > 512 * 1024 * 1024) return null
  const raw = typeof label === 'string' ? label : 'pt-unknown-agent'
  const m = /^(pre|pt)-([a-z0-9]{1,12})(?:\.([a-z0-9]{1,12}))?-([A-Za-z0-9]{0,12})$/.exec(raw)
  const safe = m ? `${m[1]}-${m[2]}${m[3] ? `.${m[3]}` : ''}-${m[4]}` : `pt-unknown-${raw.replace(/[^A-Za-z0-9]/g, '').slice(0, 12)}`
  const dir = dirOf(userData)
  try {
    await fs.mkdir(dir, { recursive: true })
    const name = `${now}-${safe}-${randomBytes(4).toString('hex').slice(0, 6)}.snipp`
    const file = path.join(dir, name)
    await writeFileAtomic(file, json)
    // The point is written. Clearing old ones is another matter: a file a
    // scanner holds for a moment (EPERM, EBUSY) must not turn a written
    // point into "could not write" (phase 4A.9, V-restore-transcribe-4).
    await pruneRestorePoints(dir, name, m ? m[2] : undefined, rm)
    const over = overCap(await fs.readdir(dir).catch(() => [] as string[]))
    return { name, path: file, ...(over > 0 ? { over } : {}) }
  } catch {
    // The page refuses the edit: no point, no change.
    return null
  }
}

/** Deletes what pruneList names; a file that cannot be deleted now is left
 *  for the next time. Returns how many went. */
export async function pruneRestorePoints(dir: string, keepName: string, keepKey: string | undefined, rm: (file: string) => Promise<void> = (file) => fs.rm(file, { force: true })): Promise<number> {
  let gone = 0
  let names: string[]
  try {
    names = await fs.readdir(dir)
  } catch {
    return 0
  }
  for (const old of pruneList(names, keepKey)) {
    if (old === keepName) continue
    try {
      await rm(path.join(dir, old))
      gone++
    } catch {
      // Held by something else right now: the next write tries again.
    }
  }
  return gone
}

/**
 * The project was saved under another path: its points go with it — MOVED
 * for a rename, COPIED for a Save As (phase 4A.11, P2: the original file
 * keeps its own). Every point of key `from` becomes a point of key `to`
 * (phase 4A.9, V-restore-transcribe-7). Of the points `to` already had (the
 * overwritten file's, phase 4A.10, E1, safety#2), a point before the agent
 * stays one only when it is of the same project and OLDER than the one that
 * comes (phase 4A.11, P1: then the coming one, of a later state, becomes a
 * session point); every other one becomes a session point first, so
 * neither is taken for the other's point before the agent. On no path does
 * a later state take the name "before the agent". The key's last save id
 * (P3) moves with a rename. Returns the new names by the old ones.
 */
export async function rekeyRestorePoints(userData: string, from: unknown, to: unknown, copy: unknown = false): Promise<Record<string, string>> {
  const out: Record<string, string> = {}
  if (typeof from !== 'string' || typeof to !== 'string' || !/^[a-z0-9]{1,12}$/.test(from) || !/^[a-z0-9]{1,12}$/.test(to) || from === to) return out
  const dir = dirOf(userData)
  let names: string[]
  try {
    names = await fs.readdir(dir)
  } catch {
    return out
  }
  const all = names.map(parse).filter((p): p is Parsed => !!p && p.kind !== 'old')
  const coming = all.filter((p) => p.key === from && p.kind === 'pre')
  const there = all.filter((p) => p.key === to && p.kind === 'pre')
  /** Per project identity, the oldest point before the agent of the two
   *  keys is the one that stays it. */
  const oldest = new Map<string, Parsed>()
  for (const p of [...there, ...coming]) {
    const o = oldest.get(p.id)
    if (!o || p.at < o.at) oldest.set(p.id, p)
  }
  const kept = (p: Parsed): boolean => p.id !== '' && oldest.get(p.id) === p && there.some((t) => t.id === p.id) && coming.some((c) => c.id === p.id)
  for (const p of there) {
    if (kept(p)) continue
    const next = p.name.replace(`-pre-${to}`, `-pt-${to}`)
    try {
      await fs.rename(path.join(dir, p.name), path.join(dir, next))
      out[p.name] = next
    } catch {
      // Left as it is: its identity still tells it from the moved project's.
    }
  }
  for (const p of all) {
    if (p.key !== from) continue
    // (An older point before the agent of the same project is there: this
    // one, of a later state, is a session point under the new key.)
    const kind = p.kind === 'pre' && there.some((t) => kept(t) && t.id === p.id) ? 'pt' : p.kind
    const next = p.name.replace(`-${p.kind}-${from}`, `-${kind}-${to}`)
    try {
      if (copy === true) await writeFileAtomic(path.join(dir, next), await fs.readFile(path.join(dir, p.name), 'utf8'))
      else await fs.rename(path.join(dir, p.name), path.join(dir, next))
      out[p.name] = next
    } catch {
      // Left under its old name: still readable by that name.
    }
  }
  if (copy === true) await pruneRestorePoints(dir, '', to)
  else {
    const saves = await readSaves(dir)
    if (saves[from] !== undefined) {
      saves[to] = saves[from]
      delete saves[from]
      await writeSaves(dir, saves)
    }
  }
  return out
}

/** Beside the points: each key's last save id (phase 4A.11, P3), the id the
 *  app wrote into that file when it last saved it (or found in it when it
 *  last opened it). Not a point: never pruned, never listed. */
const SAVES = 'saves.json'
/** Keys remembered at most (the longest unused go). */
const SAVES_MAX = 400
const ID_RE = /^[A-Za-z0-9]{1,40}$/

async function readSaves(dir: string): Promise<Record<string, string>> {
  try {
    const raw = JSON.parse(await fs.readFile(path.join(dir, SAVES), 'utf8')) as unknown
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
    const out: Record<string, string> = {}
    for (const [k, v] of Object.entries(raw)) if (/^[a-z0-9]{1,12}$/.test(k) && typeof v === 'string' && ID_RE.test(v)) out[k] = v
    return out
  } catch {
    return {}
  }
}

async function writeSaves(dir: string, saves: Record<string, string>): Promise<void> {
  const keys = Object.keys(saves)
  for (const k of keys.slice(0, Math.max(0, keys.length - SAVES_MAX))) delete saves[k]
  try {
    await fs.mkdir(dir, { recursive: true })
    await writeFileAtomic(path.join(dir, SAVES), JSON.stringify(saves))
  } catch {
    // Not written: the next open compares with what was there before.
  }
}

/** The app saved the file of key `key` with save id `id` (phase 4A.11, P3). */
export async function noteRestoreSave(userData: string, key: unknown, id: unknown): Promise<boolean> {
  if (typeof key !== 'string' || !/^[a-z0-9]{1,12}$/.test(key) || typeof id !== 'string' || !ID_RE.test(id)) return false
  const dir = dirOf(userData)
  const saves = await readSaves(dir)
  delete saves[key]
  saves[key] = id
  await writeSaves(dir, saves)
  return true
}

/**
 * The file of key `key` was opened and holds save id `id` (phase 4A.11, P3).
 * When the app last knew it with another id, the file was changed outside
 * the app (another episode copied over it, another program wrote it): its
 * points before the agent are of something else now and become session
 * points (not deleted, still listed). Returns the new names by the old ones.
 */
export async function openedRestoreFile(userData: string, key: unknown, id: unknown): Promise<Record<string, string>> {
  const out: Record<string, string> = {}
  if (typeof key !== 'string' || !/^[a-z0-9]{1,12}$/.test(key) || typeof id !== 'string' || !ID_RE.test(id)) return out
  const dir = dirOf(userData)
  const saves = await readSaves(dir)
  const was = saves[key]
  delete saves[key]
  saves[key] = id
  await writeSaves(dir, saves)
  if (was === undefined || was === id) return out
  let names: string[]
  try {
    names = await fs.readdir(dir)
  } catch {
    return out
  }
  for (const name of names) {
    const m = PARTS_RE.exec(name)
    if (!m || m[3] !== key || m[2] !== 'pre') continue
    const next = name.replace(`-pre-${key}`, `-pt-${key}`)
    try {
      await fs.rename(path.join(dir, name), path.join(dir, next))
      out[name] = next
    } catch {
      // Left as it is: a later open tries again (the id differs again).
    }
  }
  return out
}

/**
 * The user went back to a point before the agent: it is the project now, no
 * longer "the state before the agent" of a period still open. On disk it
 * becomes a session point (kind "pt"), so the next period's point before the
 * agent is written anew and this one is not taken for it after a restart.
 * Returns the new name (null when nothing was renamed).
 */
export async function demoteRestorePoint(userData: string, name: unknown): Promise<string | null> {
  if (typeof name !== 'string') return null
  const m = PARTS_RE.exec(name)
  if (!m || m[2] !== 'pre') return null
  const dir = dirOf(userData)
  const next = name.replace(`-pre-${m[3]}`, `-pt-${m[3]}`)
  try {
    await fs.rename(path.join(dir, name), path.join(dir, next))
    return next
  } catch {
    return null
  }
}

export async function readRestorePoint(userData: string, name: unknown): Promise<{ json: string } | null> {
  if (typeof name !== 'string' || !NAME_RE.test(name)) return null
  try {
    return { json: await fs.readFile(path.join(dirOf(userData), name), 'utf8') }
  } catch {
    return null
  }
}

export async function listRestorePoints(userData: string): Promise<{ name: string; size: number }[]> {
  try {
    const dir = dirOf(userData)
    const all = (await fs.readdir(dir)).filter((f) => NAME_RE.test(f)).sort()
    return Promise.all(all.map(async (name) => ({ name, size: (await fs.stat(path.join(dir, name))).size })))
  } catch {
    return []
  }
}
