// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// DENEME-4, worker W (DENEME-4-PLAN-W.md):
//  - the top bar's controls are the small size (28 px), Export one small pill;
//  - the export window: Video, Sound only and This frame ticked together are
//    three files from one run (one save dialog), same folder, same name;
//  - its check is one line that opens a list grouped by kind;
//  - making the subtitles is on the left (the Captions page), their style on
//    the right; a selected shape opens its settings in the Clip tab.
import { existsSync, mkdirSync, rmSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { probeDuration, probeStreams, TESTDATA } from '../media.mjs'
export const name = 'den4-w-export'

export async function run({ c, app, media, lib }) {
  const { assert } = lib
  const out = join(TESTDATA, 'cikti', 'e2e-den4-w')
  mkdirSync(out, { recursive: true })
  const [other] = await lib.seedAssets(app, c, [media.other])
  await lib.seedTimeline(c, [other.id])
  // A black second and a half before the clip: the check has a finding.
  await c.run(() => {
    const s = window.__store.getState()
    const p = structuredClone(s.project)
    for (const k of Object.values(p.clips)) k.start += 1.5
    p.name = 'den4w'
    s.loadProject(p)
    window.__store.getState().setDirty(false)
    return true
  })

  // ---- the top bar: one size -------------------------------------------------------
  const bar = await c.run(() => {
    const h = (id) => document.querySelector(`[data-testid="${id}"]`)?.getBoundingClientRect().height ?? null
    const fs = (id) => { const el = document.querySelector(`[data-testid="${id}"]`); return el ? parseFloat(getComputedStyle(el).fontSize) : null }
    return { exp: h('topbar.export'), more: h('topbar.export-more'), file: h('topbar.file'), canvas: h('topbar.canvas'), settings: h('topbar.settings'), renders: h('topbar.renders'), expFont: fs('topbar.export') }
  })
  for (const [k, v] of Object.entries(bar)) if (v !== null && k !== 'expFont') assert.ok(v <= 28.5, `top bar ${k}: ${v} px`)
  assert.ok(bar.expFont <= 13, `Export's words ${bar.expFont} px`)
  assert.ok(Math.abs(bar.exp - bar.more) < 0.5, 'the arrow is in the same pill')

  // ---- the subtitles are made on the left, their style is on the right ---------------
  await lib.dockPage(c, 'captions')
  await c.waitId('subs.language')
  assert.ok(await c.has('subs.import-srt'), '.srt in on the left')
  assert.ok(await c.has('dock.captions.run'), 'generate on the left')
  await c.click('inspector.tab.subs')
  assert.equal(await c.has('subs.make-left'), true, 'the Subtitles tab says where they are made')
  assert.equal(await c.run(() => document.querySelectorAll('[data-testid="subs.language"]').length), 1, 'the language once')

  // ---- a shape: added on the left, set on the right -----------------------------------
  await lib.textPage(c, 'shapes')
  await c.click('shapes.add.rect')
  await c.waitId('inspector.shape')
  assert.equal(await c.attr('inspector.tab.clip', 'aria-selected'), 'true', 'the Clip tab')
  assert.equal(await c.run(() => !!document.querySelector('.dock-body [data-testid="shapes.delete"]')), false, 'no shape settings on the left')
  await c.click('shapes.delete')
  await c.waitFor('the shape gone', async () => !(await c.st((s) => s.project.captions.some((x) => x.shape))))

  // ---- in at 1 s, out at 3 s ---------------------------------------------------------
  await c.st((s) => s.setTime(1))
  await c.key('i')
  await c.st((s) => s.setTime(3))
  await c.key('o')
  await c.st((s) => s.setTime(2))

  // ---- the window: the check's line and its list ----------------------------------------
  await c.click('topbar.export')
  await c.waitId('dialog.export')
  const fit = await c.run(() => { const r = document.querySelector('[data-testid="dialog.export"]').getBoundingClientRect(); return { w: r.width, h: r.height } })
  // (960 wide since 22 Nov, L9: the choices show their whole text. Measured at
  // 1366 × 768 itself, in both languages, by d22-b-export-layout.)
  assert.ok(fit.w <= 1366 - 32 && fit.h <= 740, `the window fits 1366 × 768 (${fit.w} × ${fit.h})`)
  await c.waitFor('the check said', async () => /\d/.test(await c.run(() => document.querySelector('[data-testid="export.pre.summary"]')?.textContent ?? '')), 15000)
  const line = await c.run(() => document.querySelector('[data-testid="export.pre.summary"]').textContent)
  assert.match(line, /warning|uyarı/, `one line: ${line}`)
  assert.equal(await c.has('export.pre.list'), false, 'closed at first')
  await c.click('export.pre.summary')
  await c.waitId('export.pre.list')
  assert.ok(await c.has('export.pre.group.gap'), 'grouped: nothing to see')
  await c.click('export.pre.summary')
  await c.waitGone('export.pre.list')

  // ---- three outputs, one run -------------------------------------------------------
  await c.click('export.out.sound')
  await c.select('export.sound-format', 'wav')
  await c.click('export.out.frame')
  if ((await c.run(() => document.querySelector('[data-testid="export.youtube"]')?.checked)) === true) await c.click('export.youtube')
  for (const k of ['video', 'sound', 'frame']) assert.ok(await c.has(`export.file.${k}`), `the summary names the ${k} file`)
  const label = await c.run(() => document.querySelector('[data-testid="export.start"]').textContent)
  assert.match(label, /3/, `the button says three: ${label}`)
  const mp4 = join(out, 'den4w.mp4')
  const files = { mp4, wav: join(out, 'den4w.wav'), png: join(out, 'den4w.png') }
  for (const f of Object.values(files)) rmSync(f, { force: true })
  lib.answer(app, { kind: 'save', path: mp4 })
  await c.click('export.start')
  await c.waitGone('dialog.export')
  await c.waitFor('three files', async () => {
    const st = await c.st((s) => s.exportStatus)
    if (st?.error) throw new Error('export failed: ' + st.error)
    return st?.done && st.kind === 'frame' && Object.values(files).every((f) => existsSync(f) && statSync(f).size > 1000)
  }, 180000, 250)
  const v = probeStreams(files.mp4)
  assert.ok(v.some((s) => s.codec_type === 'video') && v.some((s) => s.codec_type === 'audio'), 'the video with its sound')
  assert.ok(lib.near(probeDuration(files.mp4), 2, 0.08), 'in to out')
  const a = probeStreams(files.wav)
  assert.deepEqual(a.map((s) => s.codec_type), ['audio'], 'the sound alone')
  assert.ok(lib.near(probeDuration(files.wav), 2, 0.05), 'the sound of in to out')
  const p = probeStreams(files.png)
  assert.equal(p[0]?.codec_name, 'png')
  assert.deepEqual([p[0].width, p[0].height], [1920, 1080], 'the frame at the project size')
  for (const f of Object.values(files)) rmSync(f, { force: true })
  console.log(`     bar ${bar.exp} px; "${line}"; three files from one save dialog`)
}
