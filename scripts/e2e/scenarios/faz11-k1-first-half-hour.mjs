// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// Phase 11a, K1: a new user's first half hour, in one window, through the
// window's own controls. A fresh profile → the tour start to end → the sample
// project (plays) → File → New → three files through Import → Add all → a
// split (S) → a title (+ Text) → a transition (the cut's +) → subtitles made
// by the real speech model → a 1080p export, checked with ffprobe.
// Counted (kesif.mjs): crashes, error boxes, console errors, unhandled
// rejections, model check problems: all expected 0.
import { existsSync, mkdirSync, rmSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { probeDuration, probeStreams, TESTDATA } from '../media.mjs'
import { installProbe, keepModelCount, record, tally } from '../kesif.mjs'
export const optIn = true
export const name = 'faz11-k1-first-half-hour'
export const timeoutMs = 20 * 60_000

export async function run({ c: c0, app: app0, media, lib, relaunch }) {
  const { assert } = lib
  const steps = []
  const t0 = Date.now()
  const step = (what) => steps.push({ what, s: +((Date.now() - t0) / 1000).toFixed(1) })
  // A fresh profile: a new app, nothing seen, nothing chosen.
  const app = await relaunch()
  const c = app.cdp
  await installProbe(c)
  let out = null
  try {
    // ---- the tour ----------------------------------------------------------
    await c.waitId('tour', 15000)
    for (let i = 0; i < 5; i++) {
      await c.click('tour.next')
      await c.sleep(150)
    }
    await c.waitGone('tour')
    step('tour, five steps')

    // ---- the sample project ---------------------------------------------------
    await c.click('topbar.file')
    await c.click('menu.file.sample')
    await c.waitFor('the sample project open', async () => {
      const p = await c.st((s) => ({ n: s.project.name, clips: Object.values(s.project.clips).length, dirty: s.dirty }))
      return p.clips >= 4 && !p.dirty && /Sample project/.test(p.n) && !(await c.has('ask.confirm'))
    }, 120000, 250)
    await c.key(' ')
    await c.sleep(2000)
    await c.key(' ')
    const played = await c.st((s) => s.currentTime)
    assert.ok(played > 1, `the sample plays (${played})`)
    step('sample project opened and played')

    // ---- a new project, three files in ----------------------------------------
    await c.click('topbar.file')
    await c.click('menu.file.new-16x9')
    await c.sleep(300)
    if (await c.has('ask.confirm')) await c.click('ask.confirm.ok').catch(() => undefined)
    await c.waitFor('an empty project', async () => (await c.st((s) => Object.keys(s.project.clips).length)) === 0, 15000)
    // (The media panel wide enough for its header, as the user would drag it.)
    const bin = await c.box('splitter.bin')
    if (bin && bin.x < 330) await c.dragAt(bin.cx, bin.cy, 340, bin.cy, { steps: 6 })
    const speech = join(TESTDATA, 'ham', 'ham-02dk-en.mp4')
    lib.answer(app, { kind: 'open', paths: [speech, media.other, media.numbered[0]] })
    await lib.dockPage(c, 'media')
    await c.click('media.import')
    await c.waitFor('three assets', async () => (await c.st((s) => s.project.assets.length)) === 3, 30000)
    await c.click('media.add-all')
    const clips = await c.waitFor('three clips', async () => { const l = await lib.clipList(c); return l.length >= 3 ? l : null }, 15000)
    step('three files imported and laid out')

    // ---- a split at 30 s (S on the selected clip) -----------------------------
    const first = clips.find((k) => k.duration > 100)
    await c.run(() => { window.__store.getState().setTime(30); return true })
    await c.click(`timeline.clip.${first.id}`, { fx: 0.05 })
    await c.run(() => { window.__store.getState().setTime(30); return true })
    await c.key('s')
    await c.waitFor('a split', async () => (await lib.clipList(c)).length === clips.length + 1)
    step('split')

    // ---- a title ------------------------------------------------------------
    await c.run(() => { window.__store.getState().setTime(2); return true })
    const titles0 = await c.st((s) => s.project.captions.length)
    await lib.addText(c)
    await c.waitFor('a title', async () => (await c.st((s) => s.project.captions.length)) > titles0)
    step('title')

    // ---- a transition on the first cut ---------------------------------------
    const l2 = (await lib.clipList(c)).filter((k) => k.trackId === first.trackId).sort((a, b) => a.start - b.start)
    await c.click(`timeline.junction.${l2[0].id}.add`, { force: true })
    await c.waitFor('a transition', () => c.st((s, id) => !!s.project.clips[id].transitionOut, l2[0].id))
    step('transition')

    // ---- subtitles by the speech model -----------------------------------------
    await lib.dockPage(c, 'captions')
    await c.waitId('subs.language')
    await c.waitFor('the model checked', async () => !(await c.has('subs.model.missing')) && (await c.run(() => [...document.querySelectorAll('button')].some((b) => b.textContent.includes('Generate subtitles') && !b.disabled))), 20000)
    const sub0 = Date.now()
    await c.run(() => { [...document.querySelectorAll('button')].find((b) => b.textContent.includes('Generate subtitles')).click(); return true })
    // (A question may come first: the title already on the lane is a line too.)
    await c.sleep(500)
    if (await c.has('ask.confirm')) await c.click('ask.confirm.ok').catch(() => undefined)
    const lines = await c.waitFor('subtitles', async () => {
      const n = await c.st((s) => s.project.captions.filter((k) => (k.kind ?? 'subtitle') !== 'text' && k.words?.length).length)
      const busy = await c.st((s) => !!s.transcribeProgress)
      return n > 5 && !busy ? n : null
    }, 600000, 1000)
    const subSeconds = (Date.now() - sub0) / 1000
    step(`subtitles: ${lines} lines in ${subSeconds.toFixed(0)} s`)

    // ---- export 1080p ---------------------------------------------------------
    const outDir = join(TESTDATA, 'cikti')
    mkdirSync(outDir, { recursive: true })
    const mp4 = join(outDir, 'faz11-k1.mp4')
    rmSync(mp4, { force: true })
    const length = await c.st((s) => Math.max(...Object.values(s.project.clips).map((k) => k.start + k.duration)))
    await c.click('topbar.export')
    await c.waitId('dialog.export')
    await c.click('export.preset.yt1080')
    lib.answer(app, { kind: 'save', path: mp4 })
    const e0 = Date.now()
    await c.click('export.start')
    await c.waitGone('dialog.export')
    await c.waitFor('the export done', async () => {
      const st = await c.st((s) => s.exportStatus)
      if (st?.error) throw new Error('export failed: ' + st.error)
      return st?.done && existsSync(mp4) && statSync(mp4).size > 10000
    }, 600000, 500)
    const exportSeconds = (Date.now() - e0) / 1000
    const dur = probeDuration(mp4)
    const streams = probeStreams(mp4)
    const v = streams.find((s) => s.codec_type === 'video'), a = streams.find((s) => s.codec_type === 'audio')
    assert.ok(v && a, 'a video and a sound stream')
    assert.equal(v.codec_name, 'h264')
    assert.deepEqual([v.width, v.height], [1920, 1080])
    assert.ok(Math.abs(dur - length) < 0.2, `as long as the project (${dur} vs ${length})`)
    step(`export 1080p: ${dur.toFixed(2)} s in ${exportSeconds.toFixed(0)} s`)
    out = { length: +length.toFixed(2), file: { seconds: +dur.toFixed(3), bytes: statSync(mp4).size, video: `${v.codec_name} ${v.width}x${v.height}`, audio: a.codec_name }, subSeconds, exportSeconds }
    rmSync(mp4, { force: true })
  } finally {
    await keepModelCount(c).catch(() => undefined)
    const counts = await tally(c).catch((e) => ({ crashes: 1, error: String(e) }))
    record(name, { steps, counts, out })
    console.log(`     ${steps.map((s) => `${s.s}s ${s.what}`).join('\n     ')}\n     counts: ${JSON.stringify({ ...counts, texts: undefined })}`)
  }
  void c0
  void app0
}
