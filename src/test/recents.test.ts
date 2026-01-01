// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// Round 8 (One Snipp): the Projects list (recents.json) as a safe merge,
// "Find projects", and registering projects other programs saved.
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import {
  cleanRecent,
  mergeRecents,
  readRecentsFile,
  recentKey,
  registerProjects,
  removeRecentPath,
  renameRecentPath,
  summarizeProject,
  takeInbox,
  THUMBS_MAX,
  updateRecents,
  writeInbox,
  type RecentRecord
} from '../main/recents-store'
import { scanForProjects, skipDir } from '../main/project-scan'

const tmp = (): string => mkdtempSync(path.join(tmpdir(), 'snipp-recents-test-'))

const rec = (p: string, lastOpened: number, extra: Partial<RecentRecord> = {}): RecentRecord => ({
  path: p,
  name: path.win32.basename(p).replace(/\.\w+$/, ''),
  durationSec: 10,
  width: 1920,
  height: 1080,
  lastOpened,
  sizeBytes: 0,
  ...extra
})

const project = (name: string, extra: Record<string, unknown> = {}): string =>
  JSON.stringify({
    version: 1,
    name,
    settings: { width: 1080, height: 1920 },
    assets: [{ id: 'a', size: 1000 }, { id: 'b', size: 500 }],
    tracks: [],
    clips: { c1: { start: 2, duration: 30 } },
    captions: [{ start: 0, end: 40 }],
    ...extra
  })

test('one entry per file: case and slashes do not make a second one', () => {
  assert.equal(recentKey('C:/Users/A/Film.snipp'), recentKey('c:\\users\\a\\FILM.snipp'))
  const list = mergeRecents([rec('C:\\A\\film.snipp', 1, { thumbnail: 'data:image/jpeg;base64,AA' })], [rec('c:/a/FILM.snipp', 5)])
  assert.equal(list.length, 1)
  assert.equal(list[0].lastOpened, 5)
  // A save without a fresh picture keeps the old one.
  assert.equal(list[0].thumbnail, 'data:image/jpeg;base64,AA')
})

test('touch moves to the top; fill adds only what is not listed', () => {
  const base = [rec('C:\\a.snipp', 30), rec('C:\\b.snipp', 20)]
  const touched = mergeRecents(base, [rec('C:\\b.snipp', 40)], 'touch')
  assert.deepEqual(touched.map((e) => e.path), ['C:\\b.snipp', 'C:\\a.snipp'])
  const filled = mergeRecents(base, [rec('C:\\b.snipp', 99, { name: 'other' }), rec('C:\\c.snipp', 10)], 'fill')
  assert.deepEqual(filled.map((e) => [e.path, e.lastOpened]), [['C:\\a.snipp', 30], ['C:\\b.snipp', 20], ['C:\\c.snipp', 10]])
  assert.equal(filled[1].name, 'b')
  assert.deepEqual(removeRecentPath(filled, 'c:/B.SNIPP').map((e) => e.path), ['C:\\a.snipp', 'C:\\c.snipp'])
  const renamed = renameRecentPath(filled, 'C:\\a.snipp', 'C:\\new name.snipp', 'new name')
  assert.equal(renamed[0].path, 'C:\\new name.snipp')
  assert.equal(renamed[0].name, 'new name')
})

test('pictures are kept for the newest entries only, entries are not dropped', () => {
  const many = Array.from({ length: THUMBS_MAX + 15 }, (_, i) => rec(`C:\\p\\${i}.snipp`, 1000 - i, { thumbnail: 'data:image/jpeg;base64,AA' }))
  const list = mergeRecents([], many)
  assert.equal(list.length, many.length)
  assert.equal(list.filter((e) => e.thumbnail).length, THUMBS_MAX)
  assert.ok(list[0].thumbnail && !list[list.length - 1].thumbnail)
})

test('an entry must be a local project path; anything else is not taken', () => {
  for (const p of ['\\\\server\\share\\x.snipp', 'relative.snipp', 'C:\\x.exe', 'C:\\x.snipp:stream', 42]) assert.equal(cleanRecent({ path: p }), null, String(p))
  const e = cleanRecent({ path: 'C:/Users/T/Film.snipp', name: '', width: 'x', thumbnail: 'javascript:alert(1)', extra: 1 })
  assert.ok(e)
  assert.equal(e.path, 'C:\\Users\\T\\Film.snipp')
  assert.equal(e.name, 'Film')
  assert.equal(e.width, 1920)
  assert.equal(e.thumbnail, undefined)
  assert.equal((e as unknown as Record<string, unknown>).extra, undefined)
})

test('changes from many writers at once all land (no write over another)', async () => {
  const dir = tmp()
  try {
    const file = path.join(dir, 'recents.json')
    writeFileSync(file, JSON.stringify([rec('C:\\kept\\old.snipp', 1)]))
    await Promise.all(
      Array.from({ length: 25 }, (_, i) => updateRecents(file, (list) => mergeRecents(list, [rec(`C:\\films\\${i}.snipp`, 100 + i)])))
    )
    const { list, state } = await readRecentsFile(file)
    assert.equal(state, 'ok')
    assert.equal(list.length, 26)
    assert.ok(list.some((e) => e.path === 'C:\\kept\\old.snipp'))
    assert.equal(list[0].path, 'C:\\films\\24.snipp')
    // No temp files left behind.
    assert.deepEqual(readdirSync(dir), ['recents.json'])
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('a list that cannot be read is not written over; a broken one is kept aside', async () => {
  const dir = tmp()
  try {
    // Unreadable (a folder where the file should be): nothing is written.
    const blocked = path.join(dir, 'blocked.json')
    mkdirSync(blocked)
    assert.equal((await readRecentsFile(blocked)).state, 'unreadable')
    assert.equal(await updateRecents(blocked, (l) => mergeRecents(l, [rec('C:\\x.snipp', 1)])), null)

    // A byte-order mark is not a broken file.
    const bom = path.join(dir, 'bom.json')
    writeFileSync(bom, '\ufeff' + JSON.stringify([rec('C:\\x.snipp', 1)]))
    assert.equal((await readRecentsFile(bom)).list.length, 1)

    // Broken JSON: copied aside, then a fresh list.
    const file = path.join(dir, 'recents.json')
    writeFileSync(file, '[{"path": "C:\\\\half')
    assert.equal((await readRecentsFile(file)).state, 'corrupt')
    const written = await updateRecents(file, (l) => mergeRecents(l, [rec('C:\\new.snipp', 2)]))
    assert.equal(written?.length, 1)
    const aside = readdirSync(dir).filter((n) => n.startsWith('recents.corrupt-'))
    assert.equal(aside.length, 1)
    assert.equal(readFileSync(path.join(dir, aside[0]), 'utf8'), '[{"path": "C:\\\\half')

    // A missing list is an empty one.
    assert.deepEqual(await readRecentsFile(path.join(dir, 'none.json')), { list: [], state: 'missing' })
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('entries whose file is gone stay listed (a drive may just be disconnected)', async () => {
  const dir = tmp()
  try {
    const file = path.join(dir, 'recents.json')
    writeFileSync(file, JSON.stringify([rec('Z:\\not connected\\film.snipp', 5), rec('C:\\moved away\\gone.snipp', 4)]))
    await updateRecents(file, (l) => mergeRecents(l, [rec('C:\\here.snipp', 9)]))
    assert.deepEqual((await readRecentsFile(file)).list.map((e) => e.path), ['C:\\here.snipp', 'Z:\\not connected\\film.snipp', 'C:\\moved away\\gone.snipp'])
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('a project file read for its entry: its name, frame, length and media size', () => {
  const e = summarizeProject(project('Moon', { stage: { enabled: true, events: [{ at: 50, dur: 2 }] } }), 'C:\\Films\\moon.snipp', 123)
  assert.ok(e)
  assert.equal(e.name, 'Moon')
  assert.equal(e.width, 1080)
  assert.equal(e.height, 1920)
  // Its length: the clips and the captions (a stage in an old file, which
  // the product leaves out when it opens it, does not count).
  assert.equal(e.durationSec, 40)
  assert.equal(e.sizeBytes, 1500)
  assert.equal(e.lastOpened, 123)
  // "Untitled" says nothing in a list of found files: the file's name does.
  assert.equal(summarizeProject(project('Untitled'), 'C:\\Films\\moon-same-face-v2.snipp', 1)?.name, 'moon-same-face-v2')
  assert.equal(summarizeProject('{"hello": 1}', 'C:\\x.snipp', 1), null)
  assert.equal(summarizeProject('not json', 'C:\\x.snipp', 1), null)
})

test('Find projects: the picked folders, without node_modules, release, .git, hidden or system folders, links or recovery files', async () => {
  const dir = tmp()
  try {
    const put = (rel: string, text = project('x')): void => {
      const f = path.join(dir, rel)
      mkdirSync(path.dirname(f), { recursive: true })
      writeFileSync(f, text)
    }
    put('a.snipp')
    put('films/2026/b.SNIPP')
    put('old/c.autocut')
    put('films/notes.txt', 'x')
    put('node_modules/pkg/d.snipp')
    put('release/win-unpacked/e.snipp')
    put('.git/f.snipp')
    put('.hidden/g.snipp')
    put('$RECYCLE.BIN/h.snipp')
    put('AppData/Roaming/snipp/recovery-1-2.autocut')
    put('films/recovery-12-1.autocut')
    put('deep/1/2/3/4/i.snipp')
    // A junction back up the tree: not followed (no loop, no second walk).
    let linked = false
    try {
      symlinkSync(dir, path.join(dir, 'films', 'loop'), 'junction')
      linked = true
    } catch {
      /* no links here: the rest still holds */
    }
    const ticks: number[] = []
    const r = await scanForProjects([dir, path.join(dir, 'films')], { onProgress: (p) => ticks.push(p.dirs), progressMs: 0 })
    const rel = r.found.map((f) => path.relative(dir, f).replace(/\\/g, '/')).sort()
    assert.deepEqual(rel, ['a.snipp', 'deep/1/2/3/4/i.snipp', 'films/2026/b.SNIPP', 'old/c.autocut'])
    assert.equal(r.truncated, false)
    assert.equal(r.cancelled, false)
    assert.ok(ticks.length >= 2)
    if (linked) assert.ok(!r.found.some((f) => f.includes('loop')))

    // Limits: a depth, a number of finds; both say so.
    const shallow = await scanForProjects([dir], { maxDepth: 2 })
    assert.ok(!shallow.found.some((f) => f.endsWith('i.snipp')))
    assert.equal(shallow.truncated, true)
    const few = await scanForProjects([dir], { maxFound: 2 })
    assert.equal(few.found.length, 2)
    assert.equal(few.truncated, true)

    // Stop.
    const signal = { aborted: false }
    const stopped = await scanForProjects([dir], { signal, onProgress: () => (signal.aborted = true), progressMs: 0 })
    assert.equal(stopped.cancelled, true)
    assert.ok(skipDir('System Volume Information') && skipDir('Program Files') && !skipDir('videolar'))
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('the inbox: taken in once, and a project the user removed does not come back', async () => {
  const dir = tmp()
  try {
    const inbox = path.join(dir, 'inbox')
    const file = path.join(dir, 'recents.json')
    const seen = path.join(dir, 'inbox-seen.json')
    writeFileSync(file, JSON.stringify([rec('C:\\mine.snipp', 50)]))
    await writeInbox(inbox, [rec('C:\\films\\moon.snipp', 10), rec('C:\\mine.snipp', 99, { name: 'changed' })])
    assert.equal(await takeInbox(inbox, file, seen), 1)
    let list = (await readRecentsFile(file)).list
    assert.deepEqual(list.map((e) => [e.path, e.name]), [['C:\\mine.snipp', 'mine'], ['C:\\films\\moon.snipp', 'moon']])
    // Read again: nothing new.
    assert.equal(await takeInbox(inbox, file, seen), 0)
    // The user removes the film; the next read does not bring it back.
    await updateRecents(file, (l) => removeRecentPath(l, 'C:\\films\\moon.snipp'))
    assert.equal(await takeInbox(inbox, file, seen), 0)
    list = (await readRecentsFile(file)).list
    assert.deepEqual(list.map((e) => e.path), ['C:\\mine.snipp'])
    // Another profile's list (its own seen record) still takes it.
    const other = path.join(dir, 'other.json')
    assert.equal(await takeInbox(inbox, other, path.join(dir, 'other-seen.json')), 2)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('registering saved films: a safe merge into the list and one inbox file', async () => {
  const dir = tmp()
  try {
    const films = path.join(dir, 'films')
    mkdirSync(films)
    const a = path.join(films, 'moon-same-face-v2.snipp')
    writeFileSync(a, project('Untitled'))
    writeFileSync(path.join(films, 'notes.snipp'), 'not a project')
    const file = path.join(dir, 'recents.json')
    writeFileSync(file, JSON.stringify([rec('C:\\Users\\T\\Desktop\\other.snipp', 5, { thumbnail: 'data:image/jpeg;base64,AA' })]))
    const r = await registerProjects([a, path.join(films, 'notes.snipp'), path.join(films, 'missing.snipp')], {
      recentsFile: file,
      inboxDir: path.join(dir, 'inbox')
    })
    assert.equal(r.entries.length, 2) // notes.snipp is listed by its name (it is a .snipp file there)
    assert.deepEqual(r.skipped, [path.join(films, 'missing.snipp')])
    assert.equal(r.listWritten, true)
    const list = (await readRecentsFile(file)).list
    assert.equal(list.length, 3)
    assert.ok(list.some((e) => e.path === 'C:\\Users\\T\\Desktop\\other.snipp' && e.thumbnail))
    assert.equal(list.find((e) => e.path === a)?.name, 'moon-same-face-v2')
    assert.ok(r.inboxFile && existsSync(r.inboxFile))
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
