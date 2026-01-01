// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// Phase Ç2a.2, decision 5 (report P3, P17): the crash snapshot's life. A page
// reload stands in for a crash (the snapshot it left is offered).
//   P3a: changes, a snapshot, Ctrl+S, a crash: nothing is offered (the saved
//        file is newer than the snapshot).
//   P3b: changes to one project, a snapshot, another project opened (its
//        changes discarded), a crash: nothing is offered as that project's.
//   P17: a project with no clips (a title only) is protected too, 10 s after
//        the last change; the offer names the file the project was of.
import { existsSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
export const name = 'recovery-snapshot-life'

export async function run({ c, app, lib, work }) {
  const { assert } = lib
  const snapshots = () => readdirSync(app.profile).filter((n) => /^recovery-.*\.autocut$/i.test(n))
  // A snapshot written now, the way an uncaught error writes one (the same
  // writer as the timer's).
  const newest = () => Math.max(0, ...snapshots().map((n) => statSync(join(app.profile, n)).mtimeMs))
  const forceSnapshot = async (what) => {
    const before = newest()
    await c.ev(`window.dispatchEvent(new ErrorEvent('error', { message: 'e2e: snapshot now', error: new Error('e2e: snapshot now') })), true`)
    await c.waitFor(`the snapshot (${what})`, () => newest() > before, 5000)
  }
  const crash = async () => {
    await c.send('Page.reload', { ignoreCache: false })
    await c.sleep(300)
    await lib.ready(c)
  }
  const offered = async (ms = 3000) => {
    const t0 = Date.now()
    while (Date.now() - t0 < ms) {
      if (await c.has('ask.recovery')) return true
      await c.sleep(150)
    }
    return false
  }

  // P3a.
  await c.st((s) => { s.setProjectName('Saved after'); s.setTime(2); s.addMarkerAtPlayhead() })
  await forceSnapshot('P3a')
  const saved = join(work, 'saved.snipp')
  lib.answer(app, { kind: 'save', path: saved })
  await c.click('timeline.scroll', { fx: 0.95, fy: 0.97 })
  await c.key('s', ['ctrl'])
  await c.waitFor('saved', async () => existsSync(saved) && !(await c.st((s) => s.dirty)), 10000)
  await c.sleep(500)
  await crash()
  assert.equal(await offered(), false, 'P3a: nothing offered after a save')

  // P3b.
  const other = join(work, 'other.snipp')
  writeFileSync(other, JSON.stringify({ version: 1, formatVersion: 2, uid: 'e2e-p3b', name: 'The other one', settings: { width: 640, height: 360, fps: 30 }, mode: 'frame', tracks: [{ id: 'v1', kind: 'video', name: 'V1', clipIds: [] }, { id: 'a1', kind: 'audio', name: 'A1', clipIds: [] }], clips: {}, assets: [], captions: [], captionStyle: {}, snap: { enabled: true, distance: 12, snapEdges: true, snapCenters: true } }))
  await c.st((s) => { s.newProject('16:9'); s.setProjectName('Discarded'); s.addMarkerAtPlayhead() })
  await forceSnapshot('P3b')
  lib.answer(app, { kind: 'open', paths: [other] })
  await c.click('topbar.file')
  await c.click('menu.file.open')
  await c.waitFor('the other project', async () => (await c.st((s) => s.project.name)) === 'The other one', 10000)
  await c.sleep(500)
  await crash()
  assert.equal(await offered(), false, 'P3b: the discarded project is not offered')

  // P17: no clips, a title only; the snapshot 10 s after the change, and the
  // offer says the file's name.
  lib.answer(app, { kind: 'open', paths: [other] })
  await c.click('topbar.file')
  await c.click('menu.file.open')
  await c.waitFor('the other project again', async () => (await c.st((s) => s.project.name)) === 'The other one', 10000)
  await c.st((s) => s.addCaptionAtPlayhead('Only a title'))
  assert.equal(await c.st((s) => Object.keys(s.project.clips).length), 0)
  await c.waitFor('the snapshot of a project with no clips', () => snapshots().length > 0, 16000, 250)
  await crash()
  assert.equal(await offered(5000), true, 'P17: offered')
  const text = await c.run(() => document.querySelector('[data-testid="ask.recovery"]')?.textContent ?? '')
  assert.match(text, /other\.snipp/, 'the offer names the file')
  await c.click('ask.recovery.discard')
}
