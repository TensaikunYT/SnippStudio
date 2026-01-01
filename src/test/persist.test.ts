// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// Phase Ç2a.2: the user's project file on disk. Decision 4 (backups before
// the first autosave), with the main process stood in by api-stub.ts and the
// real copy code (main/backups.ts) writing into a test profile.
import { stubApi } from './api-stub'
import './dom-stub'
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { backupProjectFile, listBackups, readBackup, BACKUP_DIR, BACKUP_KEEP } from '../main/backups'
import { openProjectByPath, saveProject, setLastProjectPath } from '../renderer/src/media/projectio'

const T = { x: 320, y: 180, scale: 1, rotation: 0 }
/** A project file: `damaged` puts two clips on top of each other (opened
 *  repaired), otherwise it is sound. */
function projectText(uid: string, damaged: boolean, name = 'Kept'): string {
  return JSON.stringify({
    version: 1,
    formatVersion: 2,
    uid,
    name,
    settings: { width: 640, height: 360, fps: 30 },
    mode: 'frame',
    tracks: [
      { id: 'v1', kind: 'video', name: 'V1', clipIds: ['a', 'b'] },
      { id: 'a1', kind: 'audio', name: 'A1', clipIds: [] }
    ],
    clips: {
      a: { id: 'a', assetId: 'talk', trackId: 'v1', start: 0, inPoint: 0, duration: 4, transform: T, volume: 1 },
      b: { id: 'b', assetId: 'talk', trackId: 'v1', start: damaged ? 3 : 4, inPoint: 4, duration: 4, transform: T, volume: 1 }
    },
    assets: [{ id: 'talk', kind: 'video', name: 'talk.mp4', path: 'C:\\nowhere\\talk.mp4', url: '', size: 1, duration: 12, width: 640, height: 360, hasAudio: true }],
    captions: [],
    captionStyle: {},
    snap: { enabled: true, distance: 12, snapEdges: true, snapCenters: true }
  }, null, 2)
}

/** A test profile and a main process that writes and copies files the way
 *  the real one does (index.ts project:save-direct). `hold`: a save of that
 *  file waits until the test calls `release` (an IPC still in flight). */
function world(hold?: { file: string; release?: () => void }): { profile: string; dir: string; saves: { file?: string; backup?: string }[] } {
  const root = mkdtempSync(path.join(tmpdir(), 'snipp-persist-'))
  const profile = path.join(root, 'profile')
  const dir = path.join(root, 'work')
  mkdirSync(profile)
  mkdirSync(dir)
  const saves: { file?: string; backup?: string }[] = []
  stubApi({
    setCurrentProjectPath: () => {},
    openProjectPath: (p: string) => ({ json: readFileSync(p, 'utf8'), path: p, resolved: {} }),
    saveProjectDirect: async (p: string, json: string, _force?: boolean, opts?: { backup?: string }) => {
      saves.push({ ...(hold ? { file: p } : {}), ...(opts?.backup ? { backup: opts.backup } : {}) })
      if (hold && p === hold.file) await new Promise<void>((r) => (hold.release = r))
      if (opts?.backup) {
        const b = await backupProjectFile(profile, p, opts.backup)
        if (!b.ok) return { saved: false, error: 'backup-failed' }
      }
      writeFileSync(p, json)
      return { saved: true, path: p }
    }
  })
  return { profile, dir, saves }
}

const copiesOf = (profile: string, uid: string): string[] => {
  const d = path.join(profile, BACKUP_DIR, uid)
  return existsSync(d) ? readdirSync(d).filter((n) => n.endsWith('.snipp')).sort() : []
}

test('a damaged file opened repaired and then auto-saved: the file as it was is copied into the profile first', async () => {
  const { profile, dir } = world()
  const file = path.join(dir, 'damaged.snipp')
  const original = projectText('u-damaged', true)
  writeFileSync(file, original)
  const opened = await openProjectByPath(file)
  assert.ok(opened && opened.repaired.length > 0, 'opened repaired')
  assert.equal(await saveProject(opened.project, { quick: true, auto: true }), true)
  assert.notEqual(readFileSync(file, 'utf8'), original, 'the autosave wrote the repaired project')
  const copies = copiesOf(profile, 'u-damaged')
  assert.equal(copies.length, 1, 'one copy, in <profile>\\yedekler\\<Project.uid>')
  assert.equal(readFileSync(path.join(profile, BACKUP_DIR, 'u-damaged', copies[0]), 'utf8'), original, 'the copy is the file as it was')
  setLastProjectPath(null)
})

test('a copy only before the FIRST autosave after an open or an explicit save, at most five kept', async () => {
  const { profile, dir, saves } = world()
  const file = path.join(dir, 'sound.snipp')
  writeFileSync(file, projectText('u-sound', false))
  const opened = await openProjectByPath(file)
  assert.ok(opened && opened.repaired.length === 0, 'a sound file: nothing repaired')
  const p = opened.project
  const texts: string[] = []
  // Open → autosave (copy) → autosave (none) → explicit save (none) →
  // autosave (copy) → … seven rounds.
  for (let round = 0; round < 7; round++) {
    texts.push(readFileSync(file, 'utf8'))
    await saveProject({ ...p, name: `auto ${round}a` }, { quick: true, auto: true })
    await saveProject({ ...p, name: `auto ${round}b` }, { quick: true, auto: true })
    await saveProject({ ...p, name: `saved ${round}` }, { quick: true })
  }
  assert.deepEqual(saves.map((s) => !!s.backup), Array.from({ length: 7 }, () => [true, false, false]).flat(), 'asked for a copy before the first autosave of each round only')
  const copies = copiesOf(profile, 'u-sound')
  assert.equal(copies.length, BACKUP_KEEP, 'at most five')
  const kept = copies.map((n) => readFileSync(path.join(profile, BACKUP_DIR, 'u-sound', n), 'utf8'))
  assert.deepEqual(kept, texts.slice(-BACKUP_KEEP), 'the newest five, each the file before that round\'s first autosave')
  setLastProjectPath(null)
})

test('a file opened repaired is copied before ANY first save, an explicit one too', async () => {
  const { profile, dir, saves } = world()
  const file = path.join(dir, 'damaged2.snipp')
  const original = projectText('u-damaged2', true)
  writeFileSync(file, original)
  const opened = await openProjectByPath(file)
  assert.ok(opened)
  await saveProject(opened.project, { quick: true })
  assert.equal(saves[0].backup, 'u-damaged2')
  assert.equal(readFileSync(path.join(profile, BACKUP_DIR, 'u-damaged2', copiesOf(profile, 'u-damaged2')[0]), 'utf8'), original)
  setLastProjectPath(null)
})

test('a copy that cannot be written: nothing is written over the file', async () => {
  const { profile, dir } = world()
  const file = path.join(dir, 'blocked.snipp')
  const original = projectText('u-blocked', false)
  writeFileSync(file, original)
  // The copies' folder cannot be made: a file stands where it would be.
  mkdirSync(path.join(profile, BACKUP_DIR))
  writeFileSync(path.join(profile, BACKUP_DIR, 'u-blocked'), 'not a folder')
  const opened = await openProjectByPath(file)
  assert.ok(opened)
  await assert.rejects(saveProject({ ...opened.project, name: 'changed' }, { quick: true, auto: true }))
  assert.equal(readFileSync(file, 'utf8'), original, 'the file is as it was')
  setLastProjectPath(null)
})

test('backups: names and identities from outside are refused; only its own names are pruned', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'snipp-backups-'))
  const file = path.join(root, 'p.snipp')
  writeFileSync(file, 'one')
  assert.deepEqual(await backupProjectFile(root, file, '../escape'), { ok: false, name: null })
  assert.deepEqual(await backupProjectFile(root, path.join(root, 'none.snipp'), 'u1'), { ok: true, name: null }, 'no file: nothing to copy')
  const b = await backupProjectFile(root, file, 'u1', 1_700_000_000_000)
  assert.ok(b.ok && b.name)
  writeFileSync(path.join(root, BACKUP_DIR, 'u1', 'mine.txt'), 'the user put this here')
  for (let i = 1; i <= 6; i++) await backupProjectFile(root, file, 'u1', 1_700_000_000_000 + i)
  const list = await listBackups(root, 'u1')
  assert.equal(list.length, BACKUP_KEEP)
  assert.equal(list[0].at, 1_700_000_000_006, 'newest first')
  assert.ok(existsSync(path.join(root, BACKUP_DIR, 'u1', 'mine.txt')), 'a file it did not make is never removed')
  assert.equal(await readBackup(root, 'u1', list[0].name), 'one')
  assert.equal(await readBackup(root, 'u1', '..\\..\\p.snipp'), null)
  assert.equal(await readBackup(root, '..', list[0].name), null)
  assert.deepEqual(await listBackups(root, 'C:\\'), [])
})

// == Ç2a patch, item 3 (auditor probe RACE): the due copy belongs to a file. ==
test('Ç2a patch 3: an autosave of project A that finishes after project B (opened repaired) is open does not clear B\'s due copy', async () => {
  const hold: { file: string; release?: () => void } = { file: '' }
  const { profile, dir, saves } = world(hold)
  const fileA = path.join(dir, 'a.snipp')
  hold.file = fileA
  writeFileSync(fileA, projectText('u-race-a', false))
  const fileB = path.join(dir, 'b-damaged.snipp')
  const originalB = projectText('u-race-b', true)
  writeFileSync(fileB, originalB)
  const a = await openProjectByPath(fileA)
  assert.ok(a)
  const inFlight = saveProject(a.project, { quick: true, auto: true }) // A's autosave, the IPC pending
  await new Promise((r) => setTimeout(r, 10))
  const b = await openProjectByPath(fileB) // the user opens B meanwhile
  assert.ok(b && b.repaired.length > 0)
  hold.release!()
  await inFlight
  await saveProject(b.project, { quick: true, auto: true }) // B's first autosave
  setLastProjectPath(null)
  const bSaves = saves.filter((x) => x.file === fileB)
  assert.equal(bSaves[0]?.backup, 'u-race-b', 'B\'s first save asked for a copy')
  const copies = copiesOf(profile, 'u-race-b')
  assert.equal(copies.length, 1)
  assert.equal(readFileSync(path.join(profile, BACKUP_DIR, 'u-race-b', copies[0]), 'utf8'), originalB, 'the copy is B as it was on disk')
})

// == Ç2a patch, item 4 (auditor probe UID): an identity the copies' folder
// cannot be named after is replaced on open. ==
test('Ç2a patch 4: a file whose project id is not a folder name ("film.v2") gets a new one on open, told as a repair: copied before its first save, then autosaved', async () => {
  const { profile, dir, saves } = world()
  const file = path.join(dir, 'dotted.snipp')
  const original = projectText('film.v2', false)
  writeFileSync(file, original)
  const o = await openProjectByPath(file)
  assert.ok(o)
  const uid = o.project.uid!
  assert.notEqual(uid, 'film.v2')
  assert.match(uid, /^[A-Za-z0-9_-]{1,80}$/, 'a valid identity')
  assert.deepEqual(o.repaired, [{ code: 'uid', count: 1 }], 'told as a repair')
  await saveProject(o.project, { quick: true, auto: true }) // the first autosave works
  await saveProject(o.project, { quick: true, auto: true })
  setLastProjectPath(null)
  assert.deepEqual(saves.map((x) => x.backup ?? null), [uid, null], 'a copy before the first save only')
  const copies = copiesOf(profile, uid)
  assert.equal(copies.length, 1)
  assert.equal(readFileSync(path.join(profile, BACKUP_DIR, uid, copies[0]), 'utf8'), original, 'the file as it was')
  assert.equal(JSON.parse(readFileSync(file, 'utf8')).uid, uid, 'the new identity is saved')
  // A sound identity is kept as it is, with nothing told.
  const file2 = path.join(dir, 'kept.snipp')
  writeFileSync(file2, projectText('u_kept-1', false))
  const k = await openProjectByPath(file2)
  setLastProjectPath(null)
  assert.equal(k?.project.uid, 'u_kept-1')
  assert.deepEqual(k?.repaired, [])
})

// == Ç2a patch, item 5 (auditor probe CLOCK): pruning never removes the copy
// just written. ==
test('Ç2a patch 5: a copy taken while the clock is behind the newest five is kept (the oldest other goes), five in all', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'snipp-clock-'))
  const file = path.join(root, 'p.snipp')
  writeFileSync(file, 'old')
  for (let i = 0; i < 5; i++) await backupProjectFile(root, file, 'u1', 1_900_000_000_000 + i)
  writeFileSync(file, 'the deliberate version')
  const b = await backupProjectFile(root, file, 'u1', 1_800_000_000_000)
  assert.ok(b.ok && b.name)
  assert.ok(existsSync(path.join(root, BACKUP_DIR, 'u1', b.name)), 'the copy just reported ok still exists')
  assert.equal(await readBackup(root, 'u1', b.name), 'the deliberate version')
  const list = await listBackups(root, 'u1')
  assert.equal(list.length, BACKUP_KEEP)
  assert.deepEqual(list.map((x) => x.at), [1_900_000_000_004, 1_900_000_000_003, 1_900_000_000_002, 1_900_000_000_001, 1_800_000_000_000], 'the oldest of the others went')
})
