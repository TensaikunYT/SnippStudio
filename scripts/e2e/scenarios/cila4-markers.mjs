// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// The markers, tried end to end with real keys and the mouse (worker cila4,
// item 6; the user: "marker düzgün çalışmıyor", no details):
//   - M puts one at the playhead (one undo step);
//   - a double-click names it (Enter keeps the name), a swatch colours it;
//   - a drag moves it (snapping to the playhead / clip edges), one undo step;
//     a plain click still moves the playhead there;
//   - Shift+M / Ctrl+Shift+M jump between them;
//   - the timeline's search finds it by its name;
//   - a right-click removes it, Ctrl+Z brings it back;
//   - a ripple delete of a clip before it moves it up;
//   - with the agent's range band drawn over it on the ruler it is still
//     the marker a press takes; in the watch mode too;
//   - at 1366 × 768 it is seen and reachable on the ruler.
// The highlighter ("marker") shape behind a title that was moved in the
// preview lies under the title. Pictures with SNIPP_SCREENS_CILA4.
import { join } from 'node:path'
import { mkdirSync } from 'node:fs'
import { accessOn } from '../session.mjs'
import { info } from '../text-probe.mjs'
export const name = 'cila4-markers'
export const timeoutMs = 240_000

export async function run({ c, app, media, lib }) {
  const { assert } = lib
  const dir = process.env.SNIPP_SCREENS_CILA4 || null
  if (dir) mkdirSync(dir, { recursive: true })
  const bad = []
  const check = async (what, fn) => {
    try {
      const r = await fn()
      if (r) bad.push(`${what}: ${r}`)
    } catch (e) {
      bad.push(`${what}: ${String(e.message ?? e).slice(0, 300)}`)
    }
  }
  const [a, b] = await lib.seedAssets(app, c, [media.other, media.talk])
  await lib.seedTimeline(c, [a.id, b.id])
  await c.st((s) => s.setUiLang('en'))
  const markers = () => c.st((s) => (s.project.markers ?? []).map((m) => ({ ...m })))
  const depth = () => lib.undoDepth(c)
  const pin = async (i = 0) => c.run((i) => {
    const el = document.querySelectorAll('.tl-marker')[i]
    if (!el) return null
    const r = el.getBoundingClientRect()
    return { x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width, h: r.height }
  }, i)
  const topAt = (x, y) => c.run((x, y) => document.elementFromPoint(x, y)?.className?.toString() ?? null, x, y)
  // The keys go to the editor, not a field.
  const focusEditor = () => c.run(() => { document.activeElement?.blur?.(); return true })

  // ---- M --------------------------------------------------------------------------------------
  await c.st((s) => s.setTime(2))
  await focusEditor()
  let d0 = await depth()
  await c.key('m')
  await c.sleep(200)
  let ms = await markers()
  await check('M puts a marker at the playhead', async () => (ms.length === 1 && lib.near(ms[0].time, 2, 0.02) ? null : JSON.stringify(ms)))
  await check('M is one undo step', async () => ((await depth()) - d0 === 1 ? null : `${(await depth()) - d0} steps`))
  await c.st((s) => s.setTime(8))
  await focusEditor()
  await c.key('m')
  await c.sleep(200)

  // ---- a name, a colour -----------------------------------------------------------------------
  let p = await pin(0)
  await check('the marker is on the ruler and reachable', async () => {
    if (!p) return 'no .tl-marker'
    const top = await topAt(p.x, p.y)
    return /tl-marker/.test(top ?? '') ? null : `a press there takes "${top}"`
  })
  await c.clickAt(p.x, p.y, { double: true })
  await c.sleep(250)
  await check('a double-click opens its editor', async () => ((await c.run(() => !!document.querySelector('.marker-edit'))) ? null : 'no editor'))
  await c.type('Intro')
  await c.key('Enter')
  await c.sleep(200)
  ms = await markers()
  await check('Enter keeps the name', async () => (ms[0].label === 'Intro' ? null : JSON.stringify(ms[0])))
  p = await pin(0)
  await c.clickAt(p.x, p.y, { double: true })
  await c.sleep(250)
  const before = (await markers())[0].color
  const sw = await c.run(() => {
    const btn = [...document.querySelectorAll('.marker-colors button')].find((x) => getComputedStyle(x).backgroundColor !== 'rgb(255, 216, 61)')
    if (!btn) return null
    const r = btn.getBoundingClientRect()
    return { x: r.left + r.width / 2, y: r.top + r.height / 2, c: getComputedStyle(btn).backgroundColor }
  })
  if (sw) await c.clickAt(sw.x, sw.y)
  await c.sleep(250)
  ms = await markers()
  await check('a swatch colours it', async () => (sw && ms[0].color !== before ? null : `colour ${before} → ${ms[0].color} (swatch ${sw?.c ?? 'none'})`))
  await check('the editor closes after the swatch', async () => ((await c.run(() => !!document.querySelector('.marker-edit'))) ? 'still open' : null))
  if (await c.run(() => !!document.querySelector('.marker-edit'))) await c.key('Escape')
  await check('the name stays after the colour', async () => (ms[0].label === 'Intro' ? null : JSON.stringify(ms[0])))

  // ---- a click, a drag ----------------------------------------------------------------------------
  await c.st((s) => s.setTime(0))
  p = await pin(0)
  await c.clickAt(p.x, p.y)
  await c.sleep(150)
  await check('a click on it moves the playhead there', async () => (lib.near(await c.st((s) => s.currentTime), 2, 0.02) ? null : `playhead ${await c.st((s) => s.currentTime)}`))
  const px = await c.st((s) => s.pxPerSec)
  d0 = await depth()
  await c.dragAt(p.x, p.y, p.x + px * 1.5, p.y, { steps: 12 })
  await c.sleep(200)
  ms = await markers()
  await check('a drag moves it', async () => (lib.near(ms[0].time, 3.5, 0.15) ? null : `it is at ${ms[0].time.toFixed(2)}`))
  await check('a drag is one undo step', async () => ((await depth()) - d0 === 1 ? null : `${(await depth()) - d0} steps`))
  // Snapping: dropped a few pixels from the first clip's end, it lands on it.
  const edge = await c.st((s) => { const k = Object.values(s.project.clips).sort((x, y) => x.start - y.start)[0]; return k.start + k.duration })
  p = await pin(0)
  const near = (await lib.timeX(c, edge)) + 4
  await c.dragAt(p.x, p.y, near, p.y, { steps: 10 })
  await c.sleep(200)
  ms = await markers()
  await check('a drag snaps to a clip edge', async () => (lib.near(ms[0].time, edge, 0.01) ? null : `at ${ms[0].time.toFixed(3)}, the edge ${edge.toFixed(3)}`))
  await c.st((s, id) => s.updateMarker(id, { time: 2 }), ms[0].id)

  // ---- jumps ----------------------------------------------------------------------------------------
  await c.st((s) => s.setTime(0))
  await focusEditor()
  await c.key('m', ['shift'])
  await c.sleep(150)
  const j1 = await c.st((s) => s.currentTime)
  await c.key('m', ['shift'])
  await c.sleep(150)
  const j2 = await c.st((s) => s.currentTime)
  await c.key('m', ['ctrl', 'shift'])
  await c.sleep(150)
  const j3 = await c.st((s) => s.currentTime)
  await check('Shift+M / Ctrl+Shift+M jump', async () => (lib.near(j1, 2, 0.02) && lib.near(j2, 8, 0.02) && lib.near(j3, 2, 0.02) ? null : `${j1} ${j2} ${j3}`))

  // ---- search -------------------------------------------------------------------------------------
  await c.click('timeline.search')
  await c.waitId('timeline.search.input')
  await c.type('Intro')
  await c.sleep(300)
  await check('the search finds it by name', async () => ((await c.ids('timeline.search.hit.marker.')).length === 1 ? null : `${(await c.ids('timeline.search.hit.')).join(', ')}`))
  await c.key('Escape')
  await c.sleep(150)
  if (await c.has('timeline.search.card')) await c.click('timeline.search')

  // ---- right-click, undo ---------------------------------------------------------------------------
  p = await pin(1)
  const n0 = (await markers()).length
  await c.clickAt(p.x, p.y, { button: 'right' })
  await c.sleep(200)
  await check('a right-click removes it', async () => ((await markers()).length === n0 - 1 ? null : `${(await markers()).length} left`))
  await focusEditor()
  await c.key('z', ['ctrl'])
  await c.sleep(200)
  await check('Ctrl+Z brings it back', async () => ((await markers()).length === n0 ? null : `${(await markers()).length}`))

  // ---- a ripple delete before it ------------------------------------------------------------------
  const first = await c.st((s) => { const k = Object.values(s.project.clips).sort((x, y) => x.start - y.start)[0]; return { id: k.id, d: k.duration } })
  const t5 = (await markers()).find((m) => lib.near(m.time, 8, 0.02))
  await c.st((s, id) => s.deleteClips ? s.deleteClips([id], { ripple: true }) : s.rippleDeleteClips([id]), first.id)
  await c.sleep(200)
  await check('a ripple delete before a marker moves it up', async () => {
    const m = (await markers()).find((x) => x.id === t5?.id)
    return m && lib.near(m.time, Math.max(0, 8 - first.d), 0.05) ? null : JSON.stringify(m)
  })
  await c.st((s) => s.undo())

  // ---- the agent's band over it -----------------------------------------------------------------
  await accessOn(c)
  await c.sleep(300)
  p = await pin(0)
  const x0 = await lib.timeX(c, 1)
  const x1 = await lib.timeX(c, 3)
  await c.dragAt(x0, p.y, x1, p.y, { steps: 10, mods: ['alt'] })
  await c.sleep(300)
  // (Its note box takes the keys: left open, Escape would close the band.)
  await check('the range band is drawn on the ruler over the marker', async () => ((await c.has('kapsam.band.ruler')) ? null : 'no band'))
  await focusEditor()
  p = await pin(0)
  await check('with the range band on the ruler, the marker is what a press takes', async () => {
    const top = await topAt(p.x, p.y)
    return /tl-marker/.test(top ?? '') ? null : `a press there takes "${top}"`
  })
  await c.st((s) => s.setTime(0))
  await c.clickAt(p.x, p.y)
  await c.sleep(200)
  await check('with the band, a click on the marker moves the playhead to it', async () => (lib.near(await c.st((s) => s.currentTime), 2, 0.02) ? null : `playhead ${await c.st((s) => s.currentTime)}`))
  await c.clickAt(p.x, p.y, { double: true })
  await c.sleep(250)
  await check('with the band, a double-click on the marker opens its editor', async () => ((await c.run(() => !!document.querySelector('.marker-edit'))) ? null : 'no editor'))
  if (dir) await c.shot(join(dir, '6-isaretci-bant-1920-en.png'))
  if (await c.run(() => !!document.querySelector('.marker-edit'))) await c.key('Escape')

  // ---- 1366 × 768 ----------------------------------------------------------------------------------
  await c.send('Emulation.setDeviceMetricsOverride', { width: 1366, height: 768, deviceScaleFactor: 1, mobile: false })
  await c.sleep(400)
  p = await pin(0)
  await check('1366 × 768: the marker is seen and reachable', async () => {
    if (!p || p.w < 6) return JSON.stringify(p)
    const top = await topAt(p.x, p.y)
    return /tl-marker/.test(top ?? '') ? null : `a press there takes "${top}"`
  })
  if (dir) await c.shot(join(dir, '6-isaretci-1366-en.png'))
  await c.send('Emulation.setDeviceMetricsOverride', { width: 1920, height: 1080, deviceScaleFactor: 1, mobile: false })

  // ---- the watch mode ------------------------------------------------------------------------------
  await c.click('topbar.watch')
  await c.sleep(500)
  p = await pin(0)
  if (dir) await c.shot(join(dir, '6-isaretci-izle-1920-en.png'))
  await check('the watch mode: a marker is reachable where the ruler is shown', async () => {
    if (!p || p.w === 0) return null
    // (The watch mode covers the editor with its own player and strip: a
    // ruler it does not show has no marker to press.)
    const ruler = await c.run(() => { const r = document.querySelector('[data-testid="timeline.ruler"]')?.getBoundingClientRect(); if (!r) return null; const el = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); return !!el?.closest('[data-testid="timeline.ruler"]') })
    if (!ruler) return null
    const top = await topAt(p.x, p.y)
    return /tl-marker/.test(top ?? '') ? null : `a press there takes "${top}"`
  })
  if (await c.has('topbar.watch')) await c.click('topbar.watch')
  await c.sleep(300)

  // ---- the highlighter behind a moved title ------------------------------------------------------
  await c.st((s) => s.setTime(1))
  await lib.addText(c)
  await c.sleep(300)
  await c.type('Marked words')
  await c.key('Escape')
  await c.sleep(200)
  let i = await info(c)
  const title = i.caps[i.caps.length - 1]
  // Moved by a drag in the preview, as a user moves it.
  await c.dragAt(title.x, title.y, title.x + 120, title.y - 80, { steps: 10 })
  await c.sleep(300)
  i = await info(c)
  const moved = i.caps.find((k) => k.id === title.id)
  await c.st((s, id) => s.selectCaptions([id]), title.id)
  await lib.textPage(c, 'shapes')
  await c.click('shapes.add.marker')
  await c.sleep(300)
  i = await info(c)
  const band = await c.st((s, id) => {
    const p = s.project
    const k = p.captions.find((x) => x.shape?.kind === 'marker')
    if (!k) return null
    const st = k.style
    const m = k.motion ?? { x: 0, y: 0 }
    return { x: st.posX * p.settings.width + m.x, y: st.posY * p.settings.height + m.y, w: k.shape.w * p.settings.width, h: k.shape.h * p.settings.height }
  }, title.id)
  await check('the highlighter lies under the moved title', async () => {
    if (!band) return 'no band'
    return Math.abs(band.x - moved.fx) < 30 && Math.abs(band.y - moved.fy) < 40 ? null : `band at ${band.x.toFixed(0)},${band.y.toFixed(0)}, the title at ${moved.fx.toFixed(0)},${moved.fy.toFixed(0)}`
  })
  await check('the highlighter is seen once added (the playhead where it has grown)', async () => {
    const r = await c.st((s) => { const k = s.project.captions.find((x) => x.shape?.kind === 'marker'); return k ? { t: s.currentTime, grown: k.start + (k.anim?.inDur ?? 0) } : null })
    return r && r.t >= r.grown - 1e-6 ? null : JSON.stringify(r)
  })
  if (dir) await c.shot(join(dir, '6-fosforlu-1920-en.png'))
  // The "Marker" look: its font set and loaded.
  await c.st((s, id) => s.selectCaptions([id]), title.id)
  await lib.textPage(c, 'styles')
  await c.click('dock.text.style.marker')
  await c.sleep(500)
  await check('the Marker look gives the title its font, loaded', async () => {
    const f = await c.st((s, id) => s.project.captions.find((x) => x.id === id)?.style?.fontFamily, title.id)
    const loaded = await c.run(() => document.fonts.check('40px "Permanent Marker"'))
    return f === 'Permanent Marker' && loaded ? null : `font ${f}, loaded ${loaded}`
  })
  if (dir) await c.shot(join(dir, '6-marker-bicimi-1920-en.png'))
  await c.st((s) => { s.setCaptions([]); s.selectCaptions([]) })

  if (bad.length) console.log('     ' + bad.join('\n     '))
  assert.deepEqual(bad, [], 'the markers')
}
