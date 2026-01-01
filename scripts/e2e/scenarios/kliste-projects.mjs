// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// The user's list, item 2 (SnippStudio KLISTE-PLAN.md): saving, the recent
// projects, opening. What phase 11's K5 (20 save / close / open cycles),
// 14, 40–45 (damaged file, backups, relink, moved folder, recovery, refused
// open) and the recents unit tests (order, one entry per file whatever its
// case or slashes, a missing file kept and marked) did not walk:
//   - Ctrl+S on a new project asks where; Save as writes a second file and
//     the project goes on in it, the first file untouched; the recents list
//     has both, newest first;
//   - unsaved work: File → New asks first (No keeps the work, Yes starts
//     anew); opening another project asks first too;
//   - a project file dragged onto the window from Explorer opens it (after
//     the same question), instead of "unsupported or unreadable file";
//   - a file gone from disk: still on Projects, marked missing; pressing it
//     says so and changes nothing.
import { existsSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
export const name = 'kliste-projects'
export const timeoutMs = 180_000

const markers = (file) => (JSON.parse(readFileSync(file, 'utf8')).markers ?? []).length

export async function run({ c, app, media, lib, work }) {
  const { assert } = lib
  const asked = () => c.run(() => (window.__e2eDialogs ?? []).filter((d) => d.kind === 'confirm').length)
  const answerConfirm = (yes) => c.run((yes) => window.__e2eAnswers.push(yes), yes)
  const [talk] = await lib.seedAssets(app, c, [media.talk])
  await lib.seedTimeline(c, [talk.id])
  await c.run(() => {
    const s = window.__store.getState()
    s.setTime(1)
    s.addMarkerAtPlayhead()
  })
  assert.equal(await c.st((s) => s.dirty), true)

  // ---- Ctrl+S, then Save as -----------------------------------------------------------
  const A = join(work, 'first.snipp')
  const B = join(work, 'second.snipp')
  lib.answer(app, { kind: 'save', path: A })
  await c.click('timeline.scroll', { fx: 0.95, fy: 0.97 })
  await c.key('s', ['ctrl'])
  await c.waitFor('saved as A', async () => existsSync(A) && !(await c.st((s) => s.dirty)), 10000)
  await c.run(() => {
    const s = window.__store.getState()
    s.setTime(2)
    s.addMarkerAtPlayhead()
  })
  lib.answer(app, { kind: 'save', path: B })
  await c.click('topbar.file')
  await c.click('menu.file.save-as')
  await c.waitFor('saved as B', async () => existsSync(B) && !(await c.st((s) => s.dirty)), 10000)
  assert.equal(markers(A), 1, 'the first file is as it was saved')
  assert.equal(markers(B), 2, 'the second file has the new marker')
  // The project goes on in B: a quick save writes B, asks nothing.
  await c.run(() => {
    const s = window.__store.getState()
    s.setTime(3)
    s.addMarkerAtPlayhead()
  })
  const n = lib.dialogsAsked(app).length
  await c.click('timeline.scroll', { fx: 0.95, fy: 0.97 })
  await c.key('s', ['ctrl'])
  await c.waitFor('quick save', async () => !(await c.st((s) => s.dirty)), 10000)
  assert.equal(lib.dialogsAsked(app).length, n, 'no dialog')
  assert.equal(markers(B), 3)
  assert.equal(markers(A), 1)
  const recents = await c.run(async () => (await window.api.recentsRead()).sort((a, b) => b.lastOpened - a.lastOpened).map((e) => e.path))
  const key = (p) => p.toLowerCase()
  assert.deepEqual(recents.slice(0, 2).map(key), [B, A].map(key), `the recents, newest first (${recents.join(', ')})`)

  // ---- unsaved work is asked about ---------------------------------------------------
  await c.run(() => window.__store.getState().addMarkerAtPlayhead())
  let q = await asked()
  await answerConfirm(false)
  await c.click('topbar.file')
  await c.click('menu.file.new-16x9')
  await c.waitFor('asked', async () => (await asked()) === q + 1, 5000)
  assert.equal(await c.st((s) => (s.project.markers ?? []).length), 4, 'No: the work is kept')
  assert.equal(await c.st((s) => s.dirty), true)
  await answerConfirm(true)
  await c.click('topbar.file')
  await c.click('menu.file.new-16x9')
  await c.waitFor('a new project', async () => (await c.st((s) => Object.keys(s.project.clips).length)) === 0, 5000)
  assert.equal(await asked(), q + 2)

  // ---- a project file dropped on the window ---------------------------------------------
  await c.run(() => window.__store.getState().addMarkerAtPlayhead())
  q = await asked()
  await answerConfirm(true)
  const box = await c.box('timeline.scroll')
  const drop = { items: [], files: [A], dragOperationsMask: 1 }
  for (const type of ['dragEnter', 'dragOver', 'drop']) await c.send('Input.dispatchDragEvent', { type, x: box.cx, y: box.cy, data: drop })
  await c.waitFor('the dropped project open', async () => (await c.st((s) => (s.project.markers ?? []).length)) === 1 && Object.keys(await c.st((s) => s.project.clips)).length === 1, 10000)
  assert.equal(await asked(), q + 1, 'the unsaved marker was asked about first')
  assert.equal(await c.st((s) => s.dirty), false, 'opened, nothing unsaved')
  assert.equal(await c.st((s) => s.project.assets.length), 1, 'opened, not imported as media')

  // ---- a file gone from disk -------------------------------------------------------------
  rmSync(B, { force: true })
  await c.click('topbar.file')
  await c.click('menu.file.projects')
  await c.waitFor('the projects page', () => c.has('home.card.open'), 8000)
  const cards = await c.run(() => [...document.querySelectorAll('[data-testid="home.card.open"]')].map((b) => ({ title: b.title, missing: !!b.querySelector('.project-missing') })))
  const gone = cards.find((x) => x.title.toLowerCase().includes('second.snipp'))
  assert.ok(gone?.missing, `the deleted file is still listed, marked missing (${JSON.stringify(cards)})`)
  // (What a press could change: the timeline, the marks, the file it is tied to.)
  const now = () => c.st((s) => JSON.stringify({ clips: s.project.clips, tracks: s.project.tracks, markers: s.project.markers, name: s.project.name, dirty: s.dirty }))
  const before = await now()
  await c.run(() => [...document.querySelectorAll('[data-testid="home.card.open"]')].find((b) => b.title.toLowerCase().includes('second.snipp')).click())
  await c.sleep(600)
  assert.equal(await now(), before, 'nothing changed')
  console.log(`     Ctrl+S, Save as (A kept), quick save into B, recents B then A; New asked (No kept, Yes new); dropped .snipp opened; missing file marked`)
}
