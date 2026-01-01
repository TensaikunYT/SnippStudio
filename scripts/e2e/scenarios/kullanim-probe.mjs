// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// The user's eight notes (kullanım, 23 Nov): a measuring run, not a check.
// The cutter's click with a real hand's jitter, the Inspector's selection
// switch, the preview's middle-button pan (light and heavy), and the screens
// the notes are about. Numbers go to the console and, with
// SNIPP_KULLANIM=<before|after>, the pictures to
// tasarim\karsilastirma\kullanim\<label>-*. Opt in: --only=kullanim-probe.
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { APP_DIR } from '../app.mjs'
export const name = 'kullanim-probe'
export const optIn = true
export const timeoutMs = 300_000

export async function run({ c, app, media, lib, out }) {
  const label = process.env.SNIPP_KULLANIM ?? 'probe'
  const dir = process.env.SNIPP_KULLANIM ? join(APP_DIR, '..', 'tasarim', 'karsilastirma', 'kullanim') : join(out, 'kullanim')
  mkdirSync(dir, { recursive: true })
  const size = (width, height) => c.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false })
  const lang = (l) => c.run((l) => window.__store.getState().setUiLang(l), l)
  const result = {}
  const [talk, other, big] = await lib.seedAssets(app, c, [media.talk, media.other, media.talk1080])
  await lib.seedTimeline(c, [talk.id, other.id])
  await c.st((s) => s.setPxPerSec(60))
  await c.sleep(300)
  const clips = await lib.clipList(c)
  const [a, b] = clips.filter((k) => k.trackId === clips[0].trackId)

  // ---- 1. the cutter, a click with 5 px of travel on the second clip's body
  await c.run((id) => { window.__store.getState().moveClip(id, 14); return true }, b.id)
  b.start = 14
  const depth0 = await lib.undoDepth(c)
  await c.st((s) => s.setCutterMode(true))
  await c.sleep(150)
  const kb = await c.box(`timeline.clip.${b.id}`)
  const x = kb.x + 40.5, y = kb.y + kb.h * 0.6
  const scroll = await c.box('timeline.scroll')
  const tClick = await c.run((x) => { const el = document.querySelector('[data-testid="timeline.scroll"]'); const r = el.getBoundingClientRect(); return (x - r.left + el.scrollLeft - 176) }, x)
  await c.mouse('mouseMoved', x, y)
  await c.mouse('mousePressed', x, y)
  await c.mouse('mouseMoved', x + 3, y, { down: true })
  await c.mouse('mouseMoved', x + 6, y, { down: true })
  await c.mouse('mouseMoved', x + 7, y, { down: true })
  await c.mouse('mouseReleased', x + 7, y)
  await c.sleep(250)
  const after1 = await lib.clipList(c)
  result.cutter = {
    clickX: x, scrollX: scroll.x, tClickPx: tClick,
    bStartBefore: b.start, bStartAfter: after1.find((k) => k.id === b.id)?.start,
    marks: await c.st((s) => s.cutMarks), undoSteps: (await lib.undoDepth(c)) - depth0, time: await c.st((s) => s.currentTime), pxPerSec: 60
  }
  await c.st((s) => { s.clearCutMarks(); s.setCutterMode(false) })
  
  // ---- 5. the Inspector: switching the selection, open cards vs folded
  const switchMs = () => c.run(async (ids) => {
    const S = window.__store
    const times = []
    for (let i = 0; i < 12; i++) {
      const t0 = performance.now()
      S.getState().selectClip(ids[i % 2])
      await new Promise((r) => setTimeout(r, 0))
      document.querySelector('.inspector')?.getBoundingClientRect()
      void document.body.offsetHeight
      times.push(performance.now() - t0)
    }
    times.sort((p, q) => p - q)
    return { median: +times[6].toFixed(1), max: +times[11].toFixed(1) }
  }, [a.id, b.id])
  await c.click('inspector.tab.clip')
  result.switch = await switchMs()
  result.cards = await c.run(() => [...document.querySelectorAll('.inspector .ui-section.has-icon')].map((s) => `${s.querySelector('.ui-section-name')?.textContent}:${s.classList.contains('is-open') ? 'open' : 'closed'}`))

  // ---- 8. the preview's middle-button pan, 1x and zoomed, light and heavy
  const pan = async (what) => {
    const pv = await c.box('preview.canvas').catch(() => null) ?? await c.run(() => { const r = document.querySelector('.preview canvas').getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height } })
    const cx = pv.x + pv.w / 2, cy = pv.y + pv.h / 2
    await c.run(() => {
      window.__panFrames = []
      let last = performance.now()
      const tick = (now) => { window.__panFrames.push(now - last); last = now; if (window.__panOn) requestAnimationFrame(tick) }
      window.__panOn = true
      requestAnimationFrame(tick)
    })
    await c.mouse('mouseMoved', cx, cy)
    await c.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: cx, y: cy, button: 'middle', buttons: 4, clickCount: 1, pointerType: 'mouse' })
    for (let i = 0; i < 90; i++) {
      const dx = Math.sin(i / 10) * 120
      await c.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: cx + dx, y: cy + dx / 4, button: 'middle', buttons: 4, pointerType: 'mouse' })
      await c.sleep(8)
    }
    await c.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: cx, y: cy, button: 'middle', buttons: 0, clickCount: 1, pointerType: 'mouse' })
    const f = await c.run(() => { window.__panOn = false; return window.__panFrames.slice(2) })
    f.sort((p, q) => p - q)
    result[`pan.${what}`] = { n: f.length, p50: +f[Math.floor(f.length * 0.5)].toFixed(1), p95: +f[Math.floor(f.length * 0.95)].toFixed(1), max: +f[f.length - 1].toFixed(1) }
  }
  await c.st((s) => { s.selectClip(null); s.setTime(2); s.setPreviewView({ zoom: 1, x: 0, y: 0 }) })
  await c.sleep(300)
  await pan('light.1x')
  await c.st((s) => s.setPreviewView({ zoom: 2, x: 0, y: 0 }))
  await c.sleep(300)
  await pan('light.2x')
  // heavy: the 1080p talk on a second layer over both, and a title.
  await c.run((id) => { const s = window.__store.getState(); s.addToTimeline(id); return true }, big.id)
  await c.run((id) => { const s = window.__store.getState(); s.addToTimeline(id); s.setTime(1); return true }, big.id)
  await c.st((s) => s.setPreviewView({ zoom: 1, x: 0, y: 0 }))
  await c.sleep(600)
  await pan('heavy.1x')
  await c.st((s) => s.setPreviewView({ zoom: 2, x: 0, y: 0 }))
  await c.sleep(300)
  await pan('heavy.2x')
  await c.st((s) => s.setPreviewView({ zoom: 1, x: 0, y: 0 }))

  // ---- the pictures: timeline toolbar, Inspector, left rail tooltip, watch
  const shot = async (n) => { await c.sleep(500); await c.shot(join(dir, `${label}-${n}.png`)) }
  for (const [w, h] of [[1920, 1080], [1366, 768]]) {
    for (const l of ['tr', 'en']) {
      await size(w, h)
      await lang(l)
      await c.st((s) => s.selectClip(Object.keys(s.project.clips)[0]))
      await c.click('inspector.tab.clip')
      await c.mouse('mouseMoved', 2, 300)
      await shot(`editor-${w}-${l}`)
    }
  }
  await size(1366, 768)
  await lang('tr')
  const cat = await c.box('dock.page.templates')
  await c.mouse('mouseMoved', cat.x + cat.w / 2, cat.y + cat.h / 2)
  await c.sleep(900)
  await shot('dock-tip-1366-tr')
  for (const l of ['tr', 'en']) {
    await lang(l)
    await c.click('topbar.watch')
    await c.waitId('watch')
    await c.mouse('mouseMoved', 2, 300)
    await shot('watch-1366-' + l)
    await c.key('Escape')
    await c.waitGone('watch')
  }
  // the text's cards
  await lang('tr')
  await lib.addText(c)
  await c.mouse('mouseMoved', 2, 300)
  await shot('text-1366-tr')
  await size(1920, 1080)
  await lang('en')
  await shot('text-1920-en')
  await c.send('Emulation.clearDeviceMetricsOverride')
  writeFileSync(join(dir, `${label}-numbers.json`), JSON.stringify(result, null, 2))
  console.log('     kullanim-probe ' + JSON.stringify(result))
}
