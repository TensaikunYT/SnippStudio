// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// Phase Ç2a.1, report P8 / D4 ("Could not decide" 6: a damaged file in the
// app). File → Open with three files: one with no track list, a clip with no
// start and two clips on top of each other opens repaired, says so once, and
// keeps every rule; one cut short gives a plain error and leaves the open
// project alone; one a newer Snipp saved opens, and Ctrl+S asks before
// writing over it (here: cancelled, the file unchanged).
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
export const name = 'damaged-and-newer-files-open'

const T = { x: 320, y: 180, scale: 1, rotation: 0 }
const project = (media, extra = {}) => ({
  version: 1,
  name: 'Damaged',
  settings: { width: 640, height: 360, fps: 30 },
  mode: 'frame',
  clips: {
    a: { id: 'a', assetId: 'talk', trackId: 'v1', start: 0, inPoint: 0, duration: 4, transform: T, volume: 1 },
    b: { id: 'b', assetId: 'talk', trackId: 'v1', start: 3, inPoint: 4, duration: 4, transform: T, volume: 1 },
    c: { id: 'c', assetId: 'talk', trackId: 'v1', start: null, inPoint: 8, duration: 2, transform: T, volume: 1 }
  },
  assets: [{ id: 'talk', kind: 'video', name: 'talk.mp4', path: media.talk, url: '', size: 1, duration: 12, width: 640, height: 360, hasAudio: true }],
  captions: [],
  captionStyle: {},
  snap: { enabled: true, distance: 12, snapEdges: true, snapCenters: true },
  ...extra
})

export async function run({ c, app, media, lib, work }) {
  const { assert } = lib
  const open = async (file) => {
    lib.answer(app, { kind: 'open', paths: [file] })
    await c.click('topbar.file')
    await c.click('menu.file.open')
  }

  // 1. Damaged but readable: opened repaired.
  const damaged = join(work, 'damaged.snipp')
  writeFileSync(damaged, JSON.stringify(project(media)))
  await open(damaged)
  await c.waitFor('the repaired project', async () => (await c.st((s) => s.project.name)) === 'Damaged', 15000)
  const p = await c.st((s) => s.project)
  assert.deepEqual(Object.keys(p.clips).sort(), ['a', 'b'], 'the clip with no start is gone, the others kept')
  assert.ok(p.tracks.some((t) => t.id === 'v1' && t.clipIds.join() === 'a,b'), 'their track made again')
  assert.equal(p.clips.b.start, 4, 'the overlap moved later')
  const text = await c.waitFor('the repair notice', () => c.run(() => [...document.querySelectorAll('[data-testid^="toast."]')].map((e) => e.textContent).find((x) => /repaired/i.test(x ?? '')) ?? null))
  assert.match(text, /repaired/i)
  assert.equal(await c.st((s) => s.dirty), true, 'a repaired project is unsaved work')
  assert.equal(await c.run(() => (window.__modelProblems ?? []).length), 0, 'no broken rule')

  // 2. Cut short: a plain error, the open project untouched.
  const cut = join(work, 'cut-short.snipp')
  writeFileSync(cut, JSON.stringify(project(media)).slice(0, 300))
  await c.st((s) => s.setDirty(false))
  await open(cut)
  await c.waitFor('the error', () => c.run(() => /damaged or cut short/i.test(document.body.textContent ?? '')), 8000)
  assert.equal(await c.st((s) => s.project.name), 'Damaged', 'the open project stays')

  // 3. A newer Snipp's file: opens; Ctrl+S asks first.
  // (Opening another project asks about unsaved work: it is saved as far as
  // this test goes.)
  await c.st((s) => s.setDirty(false))
  const newer = join(work, 'newer.snipp')
  const fresh = project(media, { formatVersion: 99, name: 'From the future', tracks: [{ id: 'v1', kind: 'video', name: 'V1', clipIds: ['a'] }, { id: 'a1', kind: 'audio', name: 'A1', clipIds: [] }] })
  fresh.clips = { a: fresh.clips.a }
  writeFileSync(newer, JSON.stringify(fresh))
  const before = readFileSync(newer, 'utf8')
  await open(newer)
  await c.waitFor('the newer file open', async () => (await c.st((s) => s.project.name)) === 'From the future', 15000)
  await c.st((s) => s.addMarkerAtPlayhead())
  await c.click('timeline.scroll', { fx: 0.95, fy: 0.97 })
  await c.key('s', ['ctrl'])
  await c.waitId('ask.newer-file', 8000)
  await c.click('ask.newer-file.cancel')
  await c.sleep(300)
  assert.equal(readFileSync(newer, 'utf8'), before, 'not written over unasked')
}
