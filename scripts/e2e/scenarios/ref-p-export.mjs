// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// REF-AB, worker P2, item 11 (REF-AB-PLAN-P.md): the export window's name,
// place and cover.
//  - the name typed in the window; the place chosen with the folder button
//    (the system's folder window, the only one asked); a bad name stops it;
//  - the cover: its small picture, written beside the video as a PNG;
//  - the place remembered: the next export asks no window; a file already
//    there is asked about (the app's own question) before it is replaced.
import { existsSync, mkdirSync, rmSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { probeStreams, TESTDATA } from '../media.mjs'
export const name = 'ref-p-export'

export async function run({ c, app, media, lib }) {
  const { assert } = lib
  const out = join(TESTDATA, 'cikti', 'e2e-ref-p')
  mkdirSync(out, { recursive: true })
  const [other] = await lib.seedAssets(app, c, [media.other])
  await lib.seedTimeline(c, [other.id])
  await c.run(() => {
    const s = window.__store.getState()
    const p = structuredClone(s.project)
    p.name = 'refp'
    s.loadProject(p)
    window.__store.getState().setDirty(false)
    window.__store.getState().setTime(1)
    return true
  })
  const mp4 = join(out, 'refp film.mp4')
  const cover = join(out, 'refp film-cover.png')
  for (const f of [mp4, cover]) rmSync(f, { force: true })

  // ---- the window: its name, no place yet, the cover ---------------------------------
  await c.click('topbar.export')
  await c.waitId('dialog.export')
  assert.equal(await c.value('export.name'), 'refp', 'the name: the project’s')
  assert.equal(await c.value('export.place'), '', 'no place yet')
  if ((await c.run(() => document.querySelector('[data-testid="export.youtube"]')?.checked)) === true) await c.click('export.youtube')
  await c.click('export.cover.on')
  await c.waitId('export.cover.img', 20000)
  await c.waitId('export.file.cover')
  // A bad name stops the export, said why.
  await c.fill('export.name', 'a:b')
  await c.waitId('export.blocked.name')
  assert.equal(await c.run(() => document.querySelector('[data-testid="export.start"]').disabled), true, 'Export is off')
  await c.fill('export.name', 'refp film')
  await c.waitGone('export.blocked.name')
  // The place: the folder window.
  const since = Date.now()
  lib.answer(app, { kind: 'open', paths: [out] })
  await c.click('export.place.choose')
  await c.waitFor('the place shown', async () => (await c.value('export.place')).toLowerCase() === out.toLowerCase(), 8000)
  // The cover at another moment.
  await c.click('export.cover.change')
  await c.click('export.cover.playhead')
  await c.click('export.start')
  await c.waitGone('dialog.export')
  await c.waitFor('the video and its cover', async () => {
    const st = await c.st((s) => s.exportStatus)
    if (st?.error) throw new Error('export failed: ' + st.error)
    return st?.done && st.kind === 'frame' && [mp4, cover].every((f) => existsSync(f) && statSync(f).size > 1000)
  }, 180000, 250)
  const v = probeStreams(mp4)
  assert.ok(v.some((s) => s.codec_type === 'video'), 'the video')
  const p = probeStreams(cover)
  assert.equal(p[0]?.codec_name, 'png', 'the cover is a PNG beside it')
  assert.deepEqual([p[0].width, p[0].height], [1920, 1080], 'at the project size')
  const asked = lib.dialogsAsked(app, since).map((d) => d.kind)
  assert.deepEqual(asked, ['open'], `only the folder window was asked: ${asked.join(', ')}`)

  // ---- again: the place remembered, the files there asked about ------------------------
  const sizeBefore = statSync(mp4).mtimeMs
  const since2 = Date.now()
  const confirmsBefore = await c.run(() => (window.__e2eDialogs ?? []).filter((d) => d.kind === 'confirm').length)
  await c.click('topbar.export')
  await c.waitId('dialog.export')
  await c.waitFor('the place remembered', async () => (await c.value('export.place')).toLowerCase() === out.toLowerCase(), 8000)
  assert.equal(await c.attr('export.cover.on', 'aria-checked') ?? String(await c.run(() => document.querySelector('[data-testid="export.cover.on"]')?.checked)), 'true', 'the cover choice remembered')
  await c.fill('export.name', 'refp film')
  if ((await c.run(() => document.querySelector('[data-testid="export.youtube"]')?.checked)) === true) await c.click('export.youtube')
  await c.click('export.start')
  await c.waitGone('dialog.export', 10000)
  await c.waitFor('replaced', async () => {
    const st = await c.st((s) => s.exportStatus)
    if (st?.error) throw new Error('export failed: ' + st.error)
    return st?.done && st.kind === 'frame' && existsSync(mp4) && statSync(mp4).mtimeMs > sizeBefore
  }, 180000, 250)
  const confirms = await c.run(() => (window.__e2eDialogs ?? []).filter((d) => d.kind === 'confirm').length)
  assert.equal(confirms - confirmsBefore, 1, 'asked once before replacing')
  assert.deepEqual(lib.dialogsAsked(app, since2).map((d) => d.kind), [], 'no system window the second time')
  for (const f of [mp4, cover]) rmSync(f, { force: true })
  console.log('     name, place (one folder window), cover beside the video; remembered, asked before replacing')
}
