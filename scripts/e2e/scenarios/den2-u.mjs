// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// The user's second try (tarifler\DENEME-2.md, worker U), each point checked
// in the real window:
//   5 no button carries an edge; controls are 28 (24 small), play 36; a
//     plain button is bare at rest and filled under the pointer;
//   6 every transition kind has its own picture, drawn by the renderer (no
//     two alike, none blank); pointing at one plays it; the Filters page
//     shows its looks on a colour strip with no clip selected;
//   7 the Inspector scrolls without a look tile under the still pointer
//     changing the preview (the frame time while scrolling is written);
//   8 the Transform card's icon row is centred in its card;
//   9 no field, select or the clock's pill stands on a near-black ground;
// and DENEME-3: 10 the Text page's animations as pictures that play;
//   11 no speed preset buttons; 12 the lane height in Settings, not the
//   toolbar; 13 a short, thin zoom slider.
// With SNIPP_DEN2U_SCREENS=<folder> the screens are kept there.
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { TESTDATA, VOICEOVER } from '../media.mjs'
export const name = 'den2-u'
export const timeoutMs = 300_000

export async function run({ c, app, lib }) {
  const { assert } = lib
  const dir = process.env.SNIPP_DEN2U_SCREENS || null
  if (dir) mkdirSync(dir, { recursive: true })
  const bad = []
  const check = async (what, fn) => {
    try {
      const r = await fn()
      if (r) bad.push(`${what}: ${typeof r === 'string' ? r : JSON.stringify(r)}`)
    } catch (e) {
      bad.push(`${what}: ${e.message.split('\n')[0]}`)
    }
  }
  const shot = async (n) => { if (dir) await c.shot(join(dir, `${n}.png`)) }
  const crop = async (n, b, pad = 0) => {
    if (!dir || !b) return
    const r = await c.capture({ format: 'png', clip: { x: Math.max(0, b.x - pad), y: Math.max(0, b.y - pad), width: b.w + pad * 2, height: b.h + pad * 2, scale: 1 } })
    writeFileSync(join(dir, `${n}.png`), Buffer.from(r.data, 'base64'))
  }

  const files = [join(TESTDATA, 'kaynak', 'arkaplan-tr.mp4'), join(VOICEOVER, '4.jpg'), join(VOICEOVER, '9.jpg'), join(TESTDATA, 'ornek', 'tr-kisa.wav')]
  const assets = await lib.seedAssets(app, c, files)
  await lib.seedTimeline(c, assets.map((a) => a.id))
  await c.waitFor('the clips', async () => (await lib.clipList(c)).length === assets.length)
  await c.click('timeline.zoom.fit').catch(() => undefined)
  await lib.seek(c, 4.2)
  await c.sleep(600)
  if (await c.has('tour')) { await c.click('tour.skip'); await c.waitGone('tour') }
  await shot('01-editor')

  // ---- 5: no edge, the sizes -------------------------------------------------
  await check('5 no button has an edge at rest', async () => {
    const edged = await c.run(() => {
      const out = []
      for (const b of document.querySelectorAll('.ui-btn, .ui-tab, .ui-seg-part')) {
        const r = b.getBoundingClientRect()
        if (r.width < 2 || r.bottom < 0 || r.top > innerHeight) continue
        const cs = getComputedStyle(b)
        const visible = (w, col) => parseFloat(w) > 0 && !/rgba\(.*,\s*0\)$|transparent/.test(col)
        if (visible(cs.borderTopWidth, cs.borderTopColor)) out.push(`${b.dataset.testid ?? b.className} ${cs.borderTopColor}`)
      }
      return out.slice(0, 6)
    })
    return edged.length ? edged : null
  })
  await check('5 sizes 28 / 24 / play 36', async () => {
    const r = await c.run(() => {
      const h = (el) => Math.round(el.getBoundingClientRect().height)
      const mds = [...document.querySelectorAll('.ui-btn.ui-size-md')].filter((b) => b.getBoundingClientRect().width > 0 && !b.closest('.transport-bar .tb-center'))
      const sms = [...document.querySelectorAll('.ui-btn.ui-size-sm')].filter((b) => b.getBoundingClientRect().width > 0 && !b.closest('.tl-track-label, .ui-chip'))
      const play = document.querySelector('.transport-play')
      const name = (b) => b.dataset.testid || b.getAttribute('aria-label') || b.textContent.trim().slice(0, 24)
      return { md: [...new Set(mds.map(h))], sm: [...new Set(sms.map(h))], play: play ? h(play) : null, odd: mds.filter((b) => h(b) !== 28).map(name).concat(sms.filter((b) => h(b) !== 24).map(name)).slice(0, 12) }
    })
    if (r.md.some((x) => x !== 28) || r.sm.some((x) => x !== 24) || r.play !== 36) return r
    return null
  })
  // ---- 9: fields and the clock are not on black ----------------------------------
  await check('9 no field on a near-black ground', async () => {
    const dark = await c.run(() => {
      const lum = (rgb) => { const m = rgb.match(/[\d.]+/g)?.map(Number) ?? [0, 0, 0]; return (m[3] ?? 1) === 0 ? null : 0.2126 * m[0] + 0.7152 * m[1] + 0.0722 * m[2] }
      // The colour a pixel of `el` shows: its background over its parents'.
      const shown = (el) => {
        const cv = document.createElement('canvas'); cv.width = cv.height = 1
        const g = cv.getContext('2d')
        const chain = []
        for (let e = el; e; e = e.parentElement) chain.unshift(getComputedStyle(e).backgroundColor)
        for (const col of chain) { g.fillStyle = col; g.fillRect(0, 0, 1, 1) }
        const d = g.getImageData(0, 0, 1, 1).data
        return 0.2126 * d[0] + 0.7152 * d[1] + 0.0722 * d[2]
      }
      const out = []
      for (const el of document.querySelectorAll('.ui-input, .ui-select-el, .timecode')) {
        const r = el.getBoundingClientRect()
        if (r.width < 2 || r.bottom < 0 || r.top > innerHeight) continue
        const own = shown(el)
        const around = shown(el.parentElement)
        if (own < around - 1) out.push(`${el.dataset.testid ?? el.className} ${own.toFixed(0)} < ${around.toFixed(0)}`)
      }
      void lum
      return out.slice(0, 6)
    })
    return dark.length ? dark : null
  })
  await crop('02-saat-hiz', await c.run(() => { const r = document.querySelector('.transport-bar').getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height } }))

  // A clip selected: the Inspector's Clip tab with every card open.
  const film = (await lib.clipList(c)).find((k) => k.assetId === assets[0].id)
  await c.run(() => {
    const st = JSON.parse(localStorage.getItem('snipp-sections') ?? '{}')
    for (const id of ['Transform', 'Speed', 'Opacity', 'Audio', 'Color', 'Effects', 'Green screen (chroma key)', 'Mask', 'Crop', 'Keyframes', 'Animation', 'Camera look', 'Tracker']) st[id] = true
    localStorage.setItem('snipp-sections', JSON.stringify(st))
  })
  await c.click(`timeline.clip.${film.id}`, { fx: 0.6, fy: 0.7 })
  await c.click('inspector.tab.clip').catch(() => undefined)
  await c.waitId('inspector.card.transform')
  await c.sleep(400)
  await shot('03-klip-secili')

  // ---- 8: the Transform card's tools, centred -----------------------------------------
  await check('8 the icon row is centred in its card', async () => {
    const r = await c.run(() => {
      const row = document.querySelector('[data-testid="inspector.card.transform"] .insp-tools') ?? document.querySelector('.insp-tools')
      if (!row) return 'no row'
      const box = row.getBoundingClientRect()
      const kids = [...row.children].filter((e) => e.getBoundingClientRect().width > 0)
      const l = Math.min(...kids.map((e) => e.getBoundingClientRect().left)) - box.left
      const rr = box.right - Math.max(...kids.map((e) => e.getBoundingClientRect().right))
      return Math.abs(l - rr) <= 3 ? null : { left: l, right: rr }
    })
    return r
  })
  await crop('04-donusum', await c.box('inspector.card.transform'), 4)

  // ---- 7: scrolling the Inspector under a still pointer ---------------------------------
  await check('7 scrolling the Inspector leaves the preview alone', async () => {
    const body = await c.run(() => { const b = document.querySelector('.inspector > .body'); const r = b.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2, h: b.scrollHeight - b.clientHeight } })
    if (body.h < 200) return `the Inspector does not scroll far (${body.h} px)`
    // The preview's real drawings while the Inspector scrolls (nothing in
    // the project changes, so there should be none: a look tile passing
    // under the still pointer used to show its look in the preview and take
    // it back, a whole frame drawn twice for each). A drawing of the preview
    // starts with setTransform on its canvas (playback/render.ts renderFrame).
    await c.run(() => {
      window.__pvDraws = 0
      for (const cv of document.querySelectorAll('.preview-canvas-wrap > canvas:not(.note-draw-layer)')) {
        const g = cv.getContext('2d')
        if (!g || g.__counted) continue
        const o = g.setTransform.bind(g)
        g.setTransform = (...x) => { window.__pvDraws++; return o(...x) }
        g.__counted = true
      }
      window.__lutWatch = true
      return true
    })
    await c.mouse('mouseMoved', body.x, body.y)
    await c.sleep(300)
    await c.ev('window.__pvDraws = 0')
    const t0 = Date.now()
    const frames = await c.run(() => { window.__scrollFrames = []; let prev = performance.now(); const f = (now) => { window.__scrollFrames.push(now - prev); prev = now; if (window.__lutWatch) requestAnimationFrame(f) }; requestAnimationFrame(f); return true })
    void frames
    for (let i = 0; i < 60; i++) {
      await c.send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: body.x, y: body.y, deltaX: 0, deltaY: i < 30 ? 80 : -80, pointerType: 'mouse' })
      await c.sleep(24)
    }
    await c.sleep(300)
    const r = await c.run(() => { window.__lutWatch = false; const f = window.__scrollFrames.slice(2).sort((a, b) => a - b); return { seen: window.__pvDraws, p95: f[Math.floor(f.length * 0.95)] ?? 0, n: f.length } })
    console.log(`     Inspector scroll: ${r.n} frames, gap p95 ${r.p95.toFixed(1)} ms, preview drawings ${r.seen} (${Date.now() - t0} ms)`)
    return r.seen > 0 ? `the preview was drawn ${r.seen} times while only the Inspector scrolled` : null
  })

  // ---- 6: the transitions' pictures ---------------------------------------------------
  await lib.dockPage(c, 'transitions')
  await c.waitFor('the pictures', () => c.ev(`document.querySelectorAll('#dock-page-transitions .tp-canvas').length >= 14`), 8000)
  await c.sleep(300)
  await check('6 every transition picture is its own and not blank', async () => {
    const r = await c.run(() => {
      const sig = (cv) => {
        const g = cv.getContext('2d')
        const d = g.getImageData(0, 0, cv.width, cv.height).data
        let s = 0, v = 0, lo = 255, hi = 0
        for (let i = 0; i < d.length; i += 4 * 7) { const y = 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]; s += y * ((i / 4) % 97); v += y; lo = Math.min(lo, y); hi = Math.max(hi, y) }
        return { s: Math.round(s / 1000), spread: Math.round(hi - lo), w: cv.width }
      }
      return [...document.querySelectorAll('#dock-page-transitions .ct-tile')].map((t) => ({ id: t.dataset.testid.split('.').pop(), ...sig(t.querySelector('canvas')) }))
    })
    const flat = r.filter((x) => x.spread < 20 || x.w < 40).map((x) => x.id)
    const sigs = new Map()
    const twins = []
    for (const x of r) { if (sigs.has(x.s)) twins.push(`${sigs.get(x.s)}=${x.id}`); sigs.set(x.s, x.id) }
    return flat.length || twins.length ? { flat, twins } : null
  })
  await shot('05-gecisler')
  const page = await c.run(() => { const r = document.querySelector('#dock-page-transitions').getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: Math.min(r.height, 560) } })
  await crop('06-gecisler-yakin', page)
  // (The page has a search bar above the tiles since REF-AB: bring the tile
  // into view before pointing at it.)
  await c.run(() => document.querySelector('[data-testid="effects.trans.kind.iris"]').scrollIntoView({ block: 'center' }))
  await c.sleep(120)
  await c.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] })
  await check('6 under reduced motion a kind plays too when pointed at (22 November, L2: content, not decoration)', async () => {
    const b = await c.box('effects.trans.kind.iris')
    await c.mouse('mouseMoved', b.cx, b.cy)
    const pics = []
    for (let i = 0; i < 4; i++) { await c.sleep(170); pics.push(await c.run(() => document.querySelector('[data-testid="effects.trans.kind.iris"] canvas').toDataURL().length)) }
    await c.mouse('mouseMoved', b.cx, b.cy + 400)
    await c.sleep(150)
    return new Set(pics).size < 2 ? 'the picture did not move' : null
  })
  await c.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }] })
  await check('6 pointing at a kind plays it', async () => {
    const b = await c.box('effects.trans.kind.iris')
    await c.mouse('mouseMoved', b.cx, b.cy)
    const pics = []
    for (let i = 0; i < 4; i++) {
      await c.sleep(180)
      pics.push(await c.run(() => document.querySelector('[data-testid="effects.trans.kind.iris"] canvas').toDataURL().length))
      if (i === 1) await crop('07-iris-oynuyor', b, 2)
    }
    await c.mouse('mouseMoved', b.cx, b.cy + 400)
    return new Set(pics).size < 2 ? 'the picture did not move' : null
  })
  await c.send('Emulation.setEmulatedMedia', { features: [] })

  // ---- 6: effects and filters -------------------------------------------------------
  await lib.dockPage(c, 'effects')
  await c.sleep(300)
  await shot('08-efektler')
  await c.run(() => { window.__store.getState().selectClip?.(null) ?? window.__store.setState({ selectedClipIds: [] }); return true })
  await lib.dockPage(c, 'filters')
  await c.sleep(500)
  await shot('09-filtreler-secimsiz')
  await check('6 the looks show without a clip', async () => ((await c.count('dock.filters.looks')) || (await c.ev(`document.querySelectorAll('#dock-page-filters canvas').length`)) >= 6 ? null : 'no look pictures'))
  await c.click(`timeline.clip.${film.id}`, { fx: 0.6, fy: 0.7 })
  await c.sleep(500)
  await shot('10-filtreler')

  // ---- DENEME-3: 11, 13 -------------------------------------------------------------
  await check('11 no speed presets', async () => ((await c.ids('inspector.clip.speed.preset')).length ? 'still there' : null))
  await check('12 no lane height in the toolbar', async () => ((await c.has('timeline.trackHeight')) ? 'still in the toolbar' : null))
  await check('13 the zoom slider is short and thin', async () => {
    const r = await c.run(() => { const el = document.querySelector('.tl-zoom input.ui-range'); if (!el) return null; return { w: Math.round(el.getBoundingClientRect().width) } })
    return r && r.w > 96 ? r : null
  })
  await crop('13-zoom', await c.run(() => { const r = document.querySelector('.tl-view').getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height } }), 6)

  // ---- DENEME-3: 10, the text animations ---------------------------------------------
  await lib.textPage(c, 'anims')
  await c.waitId('dock.text.anims')
  await c.sleep(600)
  // (YAZI-PANELI-PLAN.md: in three groups, 10 in, 9 out, 5 while on screen.)
  await check('10 twenty-four animation pictures, none blank', async () => {
    const r = await c.run(() => [...document.querySelectorAll('[data-testid="dock.text.anims"] canvas')].map((cv) => {
      const d = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data
      let lit = 0
      for (let i = 3; i < d.length; i += 4 * 5) if (d[i] > 40) lit++
      return lit
    }))
    return r.length !== 24 || r.some((n) => n < 5) ? r : null
  })
  await c.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }] })
  await check('10 pointing at an animation plays it', async () => {
    await c.run(() => document.querySelector('[data-testid="dock.text.anim.in.slide"]').scrollIntoView({ block: 'center' }))
    const b = await c.box('dock.text.anim.in.slide')
    await c.mouse('mouseMoved', b.cx, b.cy)
    const pics = []
    for (let i = 0; i < 4; i++) { await c.sleep(170); pics.push(await c.run(() => document.querySelector('[data-testid="dock.text.anim.in.slide"] canvas').toDataURL().length)) }
    await c.mouse('mouseMoved', b.cx, b.cy + 500)
    return new Set(pics).size < 2 ? 'the picture did not move' : null
  })
  await c.send('Emulation.setEmulatedMedia', { features: [] })
  await shot('14-yazi-animasyonlari')
  const tp = await c.run(() => { const r = document.querySelector('#dock-page-templates').getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height } })
  await crop('15-yazi-yakin', tp)

  // ---- Settings: buttons filled, values flat; 12, the lane height --------------------
  await c.click('topbar.settings')
  await c.waitId('settings')
  await c.sleep(300)
  await shot('11-ayarlar-genel')
  await check('12 the lane height is in Settings → General', async () => {
    if (!(await c.has('settings.general.lanes'))) return 'not there'
    await c.click('settings.general.lanes.large')
    const on = await c.ev('window.__timelineView.getState().trackScale')
    await c.click('settings.general.lanes.medium')
    return on === 'large' ? null : on
  })
  await c.click('settings.nav.agent')
  await c.sleep(500)
  await shot('12-ayarlar-ajan')
  await c.key('Escape')
  await c.waitGone('settings')
  await lib.dockPage(c, 'media')

  assert.deepEqual(bad, [], 'den2-u')
}
