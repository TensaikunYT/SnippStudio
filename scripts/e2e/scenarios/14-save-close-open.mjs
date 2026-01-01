// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// Save → close → open: Ctrl+S on a new project asks where (the save dialog
// answered), the file is written; the window is closed (the app quits), the
// app starts again on the same profile, File → Open (the open dialog
// answered) brings back the same project.
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
export const name = 'save-close-open'

/** The parts of a project that must come back the same after a round trip. */
export const essence = (p) => JSON.stringify({
  name: p.name, settings: p.settings, mode: p.mode,
  tracks: p.tracks.map((t) => ({ id: t.id, kind: t.kind, clipIds: t.clipIds })),
  clips: Object.values(p.clips).map((k) => ({ id: k.id, assetId: k.assetId, trackId: k.trackId, start: k.start, inPoint: k.inPoint, duration: k.duration, transitionOut: k.transitionOut ?? null })).sort((a, b) => a.id.localeCompare(b.id)),
  assets: p.assets.map((a) => ({ id: a.id, kind: a.kind, name: a.name, path: a.path })),
  captions: p.captions.map((x) => ({ id: x.id, start: x.start, end: x.end, text: x.text })),
  markers: (p.markers ?? []).map((m) => ({ id: m.id, time: m.time })),
  notes: (p.notes ?? []).map((n) => ({ id: n.id, start: n.start, end: n.end, text: n.text }))
})

export async function run({ c, app, media, lib, work, relaunch }) {
  const { assert } = lib
  const [talk, other] = await lib.seedAssets(app, c, [media.talk, media.other])
  await lib.seedTimeline(c, [talk.id, other.id])
  await c.run(() => {
    const s = window.__store.getState()
    s.setTime(3)
    s.addMarkerAtPlayhead()
    s.addCaptionAtPlayhead('Saved and opened again')
    const first = Object.values(s.project.clips).sort((a, b) => a.start - b.start)[0]
    s.setTransitionOut(first.id, { type: 'mix', duration: 0.5 })
  })
  assert.equal(await c.st((s) => s.dirty), true)
  const want = await c.st((s) => s.project)

  const file = join(work, 'saved project.snipp')
  lib.answer(app, { kind: 'save', path: file })
  await c.click('timeline.scroll', { fx: 0.95, fy: 0.97 })
  await c.key('s', ['ctrl'])
  await c.waitFor('saved', async () => existsSync(file) && !(await c.st((s) => s.dirty)), 10000)
  const saved = JSON.parse(readFileSync(file, 'utf8'))
  assert.equal(essence(saved), essence(want), 'the file holds the project')
  const asked = lib.dialogsAsked(app).filter((e) => e.kind === 'save')
  assert.equal(asked.length, 1, 'the save dialog asked once')

  // Close the window: nothing unsaved, so the app just quits.
  await c.ev('setTimeout(() => window.close(), 50), true')
  const code = await Promise.race([app.exited, new Promise((r) => setTimeout(() => r('timeout'), 15000))])
  assert.notEqual(code, 'timeout', 'the app quit when its window closed')

  // The next start, on the same profile: File → Open.
  const app2 = await relaunch({ profile: app.profile })
  const c2 = app2.cdp
  app2.answers.set([{ kind: 'open', paths: [file] }])
  await c2.click('topbar.file')
  await c2.click('menu.file.open')
  await c2.waitFor('the project opened', async () => (await c2.st((s) => s.project.name)) === saved.name && (await c2.st((s) => Object.keys(s.project.clips).length)) === Object.keys(want.clips).length, 15000)
  const got = await c2.st((s) => s.project)
  assert.equal(essence(got), essence(want), 'the same project')
  assert.equal(await c2.st((s) => s.dirty), false, 'opened, nothing unsaved')
  // Saved again with Ctrl+S: no dialog this time (the file is known).
  await c2.run(() => window.__store.getState().addMarkerAtPlayhead())
  const n = lib.dialogsAsked(app2).length
  await c2.click('timeline.scroll', { fx: 0.95, fy: 0.97 })
  await c2.key('s', ['ctrl'])
  await c2.waitFor('saved again', async () => !(await c2.st((s) => s.dirty)), 10000)
  assert.equal(lib.dialogsAsked(app2).length, n, 'the quick save asked nothing')
  assert.equal((JSON.parse(readFileSync(file, 'utf8')).markers ?? []).length, 2)
}
