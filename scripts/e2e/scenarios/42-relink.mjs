// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// Phase Ç2a.2, decision 2 (report P7, P15) and decision 1 (P4): a missing
// file relinked from the missing-media dialog is READ — a shorter file gives
// the asset its duration and says how many clips now run past its end; a
// file of another kind (a picture for a video) is refused; an edit, then
// undo, leaves the relinked file where it is. Saved, the file replaced on
// disk by another take: opening the project again reads it again and says so.
import { copyFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
export const name = 'relink-reads-the-file'

const T = { x: 320, y: 180, scale: 1, rotation: 0 }

export async function run({ c, app, media, lib, work }) {
  const { assert } = lib
  const toast = (re) => c.run((src) => [...document.querySelectorAll('[data-testid^="toast."]')].map((e) => e.textContent ?? '').find((x) => new RegExp(src, 'i').test(x)) ?? null, re.source)
  const asset = (id) => c.st((s, id) => s.project.assets.find((a) => a.id === id), id)

  const short = join(work, 'take.mp4')
  copyFileSync(media.other, short) // 6 s
  mkdirSync(join(work, 'gone'), { recursive: true })
  // (In a folder of its own: a file of the same name beside the project
  // would be found there, decision 3.)
  mkdirSync(join(work, 'proj'), { recursive: true })
  const file = join(work, 'proj', 'relink.snipp')
  writeFileSync(file, JSON.stringify({
    version: 1,
    formatVersion: 2,
    uid: 'e2e-relink-0001',
    name: 'Relink',
    settings: { width: 640, height: 360, fps: 30 },
    mode: 'frame',
    tracks: [{ id: 'v1', kind: 'video', name: 'V1', clipIds: ['a', 'b'] }, { id: 'a1', kind: 'audio', name: 'A1', clipIds: [] }],
    clips: {
      a: { id: 'a', assetId: 'talk', trackId: 'v1', start: 0, inPoint: 0, duration: 10, transform: T, volume: 1 },
      b: { id: 'b', assetId: 'cam', trackId: 'v1', start: 10, inPoint: 0, duration: 2, transform: T, volume: 1 }
    },
    assets: [
      { id: 'talk', kind: 'video', name: 'take.mp4', path: join(work, 'gone', 'take.mp4'), url: '', size: 1000, duration: 12, width: 640, height: 360, hasAudio: true },
      { id: 'cam', kind: 'video', name: 'cam.mp4', path: join(work, 'gone', 'cam.mp4'), url: '', size: 1000, duration: 12, width: 640, height: 360, hasAudio: true }
    ],
    captions: [],
    captionStyle: {},
    snap: { enabled: true, distance: 12, snapEdges: true, snapCenters: true }
  }, null, 2))

  lib.answer(app, { kind: 'open', paths: [file] })
  await c.click('topbar.file')
  await c.click('menu.file.open')
  await c.waitId('dialog.missing-media', 15000)

  // 1. A shorter file: read, its duration taken, the clip past its end told.
  lib.answer(app, { kind: 'open', paths: [short] })
  await c.click('missing-media.locate.talk')
  await c.waitFor('the relink', async () => (await asset('talk')).missing === false || (await asset('talk')).missing === undefined, 10000)
  const a = await asset('talk')
  assert.equal(a.path, short)
  assert.ok(Math.abs(a.duration - 6) < 0.2, `the new file's duration (${a.duration})`)
  assert.ok(typeof a.mtime === 'number', 'its fingerprint')
  // (22 November, L12: t() writes English plurals: one clip "runs", two "run".)
  assert.ok(await c.waitFor('the past-the-end notice', () => toast(/1 clip now runs past the end/), 5000))

  // 2. A picture for a video: refused, still missing.
  lib.answer(app, { kind: 'open', paths: [media.numbered[0]] })
  await c.click('missing-media.locate.cam')
  assert.ok(await c.waitFor('the refusal', () => toast(/needs a video/), 8000))
  assert.equal((await asset('cam')).missing, true, 'not relinked')

  // 3. An edit, then undo: the relinked file stays relinked.
  await c.click('missing-media.done')
  await c.st((s) => s.addMarkerAtPlayhead())
  await c.st((s) => s.undo())
  const back = await asset('talk')
  assert.ok(!back.missing, 'still relinked after undo')
  assert.equal(back.path, short)
  assert.ok(Math.abs(back.duration - 6) < 0.2)

  // 4. Saved; the file replaced by another take (12 s); opened again: read again.
  await c.click('timeline.scroll', { fx: 0.95, fy: 0.97 })
  await c.key('s', ['ctrl'])
  await c.waitFor('saved', async () => !(await c.st((s) => s.dirty)), 10000)
  copyFileSync(media.talk, short)
  lib.answer(app, { kind: 'open', paths: [file] })
  await c.click('topbar.file')
  await c.click('menu.file.open')
  await c.waitFor('read again', async () => Math.abs(((await asset('talk'))?.duration ?? 0) - 12) < 0.2, 15000)
  assert.ok(await c.waitFor('the changed-on-disk notice', () => toast(/changed on disk/), 5000))
  assert.equal(await c.run(() => (window.__modelProblems ?? []).length), 0, 'no broken rule')
}
