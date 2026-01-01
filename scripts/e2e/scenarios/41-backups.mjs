// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// Phase Ç2a.2, decision 4 (report D8; the Ç2a.1 report's "repair on open,
// then autosave"): a damaged file opened repaired is copied into
// <profile>\yedekler\<Project.uid>\ before the autosave writes the repaired
// project over it, once (the next autosave makes no copy); File → Earlier
// versions… lists the copy and opens it as a copy, the project file left as
// the autosave wrote it.
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
export const name = 'backup-before-autosave'

const UID = 'e2e-backup-0001'
const T = { x: 320, y: 180, scale: 1, rotation: 0 }
const project = (media) => ({
  version: 1,
  formatVersion: 2,
  uid: UID,
  name: 'Backed up',
  settings: { width: 640, height: 360, fps: 30 },
  mode: 'frame',
  tracks: [{ id: 'v1', kind: 'video', name: 'V1', clipIds: ['a', 'b'] }, { id: 'a1', kind: 'audio', name: 'A1', clipIds: [] }],
  clips: {
    a: { id: 'a', assetId: 'talk', trackId: 'v1', start: 0, inPoint: 0, duration: 4, transform: T, volume: 1 },
    // On top of a: opened repaired (moved to 4 s).
    b: { id: 'b', assetId: 'talk', trackId: 'v1', start: 3, inPoint: 4, duration: 4, transform: T, volume: 1 }
  },
  assets: [{ id: 'talk', kind: 'video', name: 'talk.mp4', path: media.talk, url: '', size: 1, duration: 12, width: 640, height: 360, hasAudio: true }],
  captions: [],
  captionStyle: {},
  snap: { enabled: true, distance: 12, snapEdges: true, snapCenters: true }
})

export async function run({ c, app, media, lib, work }) {
  const { assert } = lib
  const file = join(work, 'backed up.snipp')
  const original = JSON.stringify(project(media), null, 2)
  writeFileSync(file, original)
  const copies = () => {
    const dir = join(app.profile, 'yedekler', UID)
    return existsSync(dir) ? readdirSync(dir).filter((n) => n.endsWith('.snipp')).map((n) => readFileSync(join(dir, n), 'utf8')) : []
  }

  lib.answer(app, { kind: 'open', paths: [file] })
  await c.click('topbar.file')
  await c.click('menu.file.open')
  await c.waitFor('the repaired project', async () => (await c.st((s) => s.project.name)) === 'Backed up', 15000)
  assert.equal(await c.st((s) => s.project.clips.b.start), 4, 'opened repaired')
  assert.equal(await c.st((s) => s.dirty), true)
  assert.equal(copies().length, 0, 'no copy before an autosave')

  // The autosave, as its timer runs it.
  await c.ev('window.__autosaveNow()')
  await c.waitFor('the autosave', async () => !(await c.st((s) => s.dirty)), 8000)
  assert.notEqual(readFileSync(file, 'utf8'), original, 'the file holds the repaired project now')
  assert.deepEqual(copies(), [original], 'one copy, the file as it was')

  // A second autosave: no copy (only the first after an open or a save).
  await c.st((s) => s.addMarkerAtPlayhead())
  await c.ev('window.__autosaveNow()')
  await c.waitFor('the second autosave', async () => !(await c.st((s) => s.dirty)), 8000)
  assert.equal(copies().length, 1, 'still one copy')
  const written = readFileSync(file, 'utf8')

  // File → Earlier versions…: the copy, opened as a copy.
  await c.click('topbar.file')
  await c.click('menu.file.backups')
  await c.waitId('dialog.backups', 5000)
  await c.waitId('backups.row.0', 5000)
  assert.equal(await c.count('backups.row.1'), 0, 'one version listed')
  await c.click('backups.open.0')
  await c.waitFor('the version open', async () => (await c.st((s) => s.dirty)) === true && !(await c.has('dialog.backups')), 8000)
  assert.equal(await c.st((s) => s.project.uid), UID)
  assert.equal(await c.st((s) => (s.project.markers ?? []).length), 0, 'the version before the marker')
  // A copy: the quick save asks where (cancelled here), the file untouched.
  lib.answer(app, { kind: 'cancel' })
  await c.click('timeline.scroll', { fx: 0.95, fy: 0.97 })
  await c.key('s', ['ctrl'])
  await c.sleep(600)
  assert.equal(lib.dialogsAsked(app).filter((e) => e.kind === 'save').length, 1, 'Save asked for a name')
  assert.equal(readFileSync(file, 'utf8'), written, 'the project file is as the autosave left it')
  assert.equal(await c.run(() => (window.__modelProblems ?? []).length), 0, 'no broken rule')
}
