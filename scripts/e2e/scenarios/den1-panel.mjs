// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// The user's first try (tarifler\DENEME-1.md, worker P: the panels), each
// fault as he met it, with a real pointer where he used one:
//   1 Text in the left menu opens on text and titles; the templates are a
//     sub-page of it;
//   2 the left panel closes (its category column stays) and is remembered;
//   3 no choice's words run into each other (Camera look's "Lies over");
//   4 an icon button's hover square is centred on its icon;
//   5 pointing at a LUT changes the picture's colour, not where it stands;
//   6 the green screen's eyedropper: a picking cursor, Esc stops it, a click
//     is one undo step;
//   7 a keyed value's diamond is filled and coloured.
// Every check runs and the failures are reported together.
import { join } from 'node:path'
import { makeFxMedia } from '../../qa/reference/make-fx-media.mjs'
import { VOICEOVER } from '../media.mjs'
export const name = 'den1-panel'
export const timeoutMs = 240_000

export async function run({ c, app, lib, work }) {
  const { assert } = lib
  const bad = []
  const check = async (what, fn) => {
    try {
      const r = await fn()
      if (r) bad.push(`${what}: ${typeof r === 'string' ? r : JSON.stringify(r)}`)
    } catch (e) {
      bad.push(`${what}: ${e.message.split('\n')[0]}`)
    }
  }
  const [pic] = await lib.seedAssets(app, c, [makeFxMedia(work)])
  await lib.seedTimeline(c, [pic.id])
  const [first] = await lib.clipList(c)
  await c.run(() => {
    const state = JSON.parse(localStorage.getItem('snipp-sections') ?? '{}')
    for (const id of ['Clip', 'Keyframes', 'Green screen (chroma key)', 'Camera look', 'Color']) state[id] = true
    localStorage.setItem('snipp-sections', JSON.stringify(state))
  })
  const pick = async () => {
    await c.run((id) => { const s = window.__store.getState(); s.setTime(0.5); s.selectClips?.([id]) ?? window.__store.setState({ selectedClipIds: [id] }) }, first.id)
    await c.sleep(150)
  }
  await pick()
  await c.click(`timeline.clip.${first.id}`, { fx: 0.5 })
  await c.click('inspector.tab.clip').catch(() => undefined)
  await c.waitId('inspector.card.transform')

  // ---- 4: the hover square around an icon is centred on it ---------------------------
  await check('4 icon buttons centred', async () => {
    const off = await c.run(() => {
      const out = []
      for (const b of document.querySelectorAll('.ui-btn')) {
        const icon = b.querySelector(':scope > .ui-icon')
        const words = [...b.querySelectorAll('span')].filter((e) => e.textContent.trim() && getComputedStyle(e).display !== 'none' && e.getBoundingClientRect().width > 0)
        if (!icon || words.length) continue
        const r = b.getBoundingClientRect()
        if (r.width < 4 || r.bottom < 0 || r.top > innerHeight) continue
        const i = icon.getBoundingClientRect()
        const dx = i.left + i.width / 2 - (r.left + r.width / 2)
        const dy = i.top + i.height / 2 - (r.top + r.height / 2)
        if (Math.abs(dx) > 0.75 || Math.abs(dy) > 0.75) out.push(`${b.getAttribute('aria-label') ?? b.dataset.testid} dx=${dx.toFixed(1)} dy=${dy.toFixed(1)} (${Math.round(r.width)}×${Math.round(r.height)})`)
      }
      return out
    })
    return off.length ? off.slice(0, 6).join('; ') : null
  })

  // ---- 7: a keyed value's diamond ----------------------------------------------------------
  await check('7 keyed diamond', async () => {
    await c.run((id) => window.__store.getState().addPropKeyframe(id, 'scale'), first.id)
    await c.sleep(200)
    const at = await c.run(() => {
      const row = document.querySelector('[data-testid="inspector.clip.scale"]')?.closest('.insp-prop')
      const key = row?.querySelector('.insp-key')
      const free = document.querySelector('[data-testid="inspector.clip.rotate"]')?.closest('.insp-prop')?.querySelector('.insp-key')
      if (!key || !free) return { missing: true }
      const fill = (b) => getComputedStyle(b.querySelector('path')).fill
      return { keyed: fill(key), keyedColour: getComputedStyle(key).color, free: fill(free), freeColour: getComputedStyle(free).color, rowKeyed: row.classList.contains('is-keyed'), atKey: key.classList.contains('is-at') }
    })
    if (at.missing) return 'no diamond'
    const out = []
    if (at.keyed === 'none') out.push('the keyed diamond is hollow')
    if (at.free !== 'none') out.push('the diamond of a value without keys is filled')
    if (at.keyedColour === at.freeColour) out.push('keyed and free diamonds have one colour')
    if (!at.rowKeyed) out.push('the keyed row is not marked')
    if (!at.atKey) out.push('on the key, the diamond does not say so')
    return out.join('; ') || null
  })

  // ---- 6: the eyedropper ---------------------------------------------------------------------
  await check('6 eyedropper', async () => {
    await c.run((id) => window.__store.getState().undoable(() => window.__store.getState().setClipChroma(id, { enabled: true, color: '#00ff00' })), first.id)
    await pick()
    await c.waitId('inspector.chroma.eyedropper', 4000)
    const out = []
    await c.click('inspector.chroma.eyedropper')
    const cv = await c.box('preview.canvas')
    await c.mouse('mouseMoved', cv.cx, cv.cy)
    await c.sleep(150)
    const cursor = await c.run(() => getComputedStyle(document.querySelector('[data-testid="preview.canvas"]')).cursor)
    if (cursor !== 'crosshair') out.push(`cursor "${cursor}" over the preview`)
    await c.key('Escape')
    await c.sleep(100)
    if (await c.st((s) => s.eyedropperClip)) out.push('Esc does not stop it')
    // A click: the key colour, one undo step.
    await c.click('inspector.chroma.eyedropper')
    const depth = await lib.undoDepth(c)
    await c.mouse('mouseMoved', cv.cx, cv.cy)
    await c.clickAt(cv.cx, cv.cy)
    await c.waitFor('a picked colour', async () => (await c.st((s, id) => s.project.clips[id].chroma.color, first.id)) !== '#00ff00', 6000).catch(() => out.push('no colour picked'))
    const steps = (await lib.undoDepth(c)) - depth
    if (steps !== 1) out.push(`${steps} undo steps`)
    return out.join('; ') || null
  })

  // ---- 3: no choice's words run into each other -------------------------------------------------
  await check('3 Camera look "Lies over"', async () => {
    const layer = await c.run(() => {
      const s = window.__store.getState()
      return s.addLookLayer({ grain: 0.3, weave: 0, halation: 0, fade: 0, flicker: 0, dust: 0, mono: 0, vignette: 0.2, vShape: 'round', vMotion: 'still', vSpeed: 1, bars: 0, gate: 0 }, 0, 2)
    })
    await c.sleep(200)
    if (!layer) return 'no look layer made'
    await c.run((id) => window.__store.setState({ selectedClipIds: [id] }), layer)
    await c.sleep(300)
    return null
  })
  for (const lang of ['tr', 'en']) {
    for (const width of [260, 320]) {
      await check(`3 choices fit (${lang}, Inspector ${width})`, async () => {
        await c.run((l) => window.__store.getState().setUiLang(l), lang)
        const sp = await c.box('splitter.inspector')
        const now = await c.run(() => document.querySelector('.inspector')?.getBoundingClientRect().width ?? 0)
        if (sp) await c.dragAt(sp.cx, sp.cy, sp.cx + (now - width), sp.cy, { steps: 4 })
        await c.sleep(250)
        const r = await c.run(() => {
          const out = []
          for (const part of document.querySelectorAll('.inspector .ui-seg-part')) {
            const pr = part.getBoundingClientRect()
            if (pr.width < 2 || pr.bottom < 0) continue
            const words = part.querySelector('span:last-child') ?? part
            if (words.scrollWidth > words.clientWidth + 1) out.push(`"${part.textContent.trim()}" ${words.scrollWidth}>${words.clientWidth}`)
            const range = document.createRange()
            range.selectNodeContents(words)
            const tr = range.getBoundingClientRect()
            if (tr.left < pr.left - 1 || tr.right > pr.right + 1) out.push(`"${part.textContent.trim()}" runs out of its part`)
          }
          // (The vignette's shape and motion rows must be among them: the
          // longest names of the Inspector's choices.)
          if (![...document.querySelectorAll('.inspector .ui-seg-part')].some((p) => /Breathes|Nefes/.test(p.textContent) && p.getBoundingClientRect().width > 0)) out.push('the vignette motion row was not measured')
          return out
        })
        return r.length ? r.slice(0, 5).join('; ') : null
      })
    }
  }
  await c.run(() => window.__store.getState().setUiLang('en'))

  // ---- 5: a LUT moves nothing -------------------------------------------------------------------
  await check('5 LUT hover keeps the picture in place', async () => {
    // A drawing with fine lines (a still of the user's voice-over films):
    // where point sampling showed as jagged, shifting edges.
    const [still] = await lib.seedAssets(app, c, [join(VOICEOVER, '1.jpg')])
    await c.run((id) => { const s = window.__store.getState(); s.addToTimeline(id); s.setDirty(false) }, still.id)
    await c.sleep(200)
    const sc = await c.st((s, a) => Object.values(s.project.clips).find((k) => k.assetId === a), still.id)
    await c.run((k) => { const s = window.__store.getState(); s.setTime(k.start + 0.5); window.__store.setState({ selectedClipIds: [k.id] }) }, sc)
    await c.click('dock.page.filters')
    await c.waitId('inspector.color.looks', 4000).catch(() => undefined)
    const tile = await c.run(() => {
      const t = document.querySelector('.dock-body [data-testid="inspector.color.look.cool"]')
      if (!t) return null
      t.scrollIntoView({ block: 'center' })
      const r = t.getBoundingClientRect()
      return { cx: r.left + r.width / 2, cy: r.top + r.height / 2 }
    })
    if (!tile) return 'no look tile in Filters'
    // The picture's edges in the preview canvas (gradient of the luminance,
    // each frame normalised: a look changes the colours, not the edges).
    const edges = () => c.run(() => {
      const cv = document.querySelector('[data-testid="preview.canvas"]')
      const o = new OffscreenCanvas(cv.width, cv.height)
      const g = o.getContext('2d')
      g.drawImage(cv, 0, 0)
      const W = cv.width, H = cv.height
      const d = g.getImageData(0, 0, W, H).data
      const L = new Float32Array(W * H)
      for (let i = 0; i < W * H; i++) L[i] = 0.2126 * d[i * 4] + 0.7152 * d[i * 4 + 1] + 0.0722 * d[i * 4 + 2]
      let m = 0, v = 0
      for (const x of L) m += x
      m /= L.length
      for (const x of L) v += (x - m) ** 2
      const sd = Math.sqrt(v / L.length) || 1
      const E = new Float32Array(W * H)
      for (let y = 0; y < H - 1; y++) for (let x = 0; x < W - 1; x++) { const i = y * W + x; E[i] = (Math.abs(L[i + 1] - L[i]) + Math.abs(L[i + W] - L[i])) / sd }
      return Array.from(E)
    })
    const corr = (a, b) => {
      let ma = 0, mb = 0
      for (let i = 0; i < a.length; i++) { ma += a[i]; mb += b[i] }
      ma /= a.length; mb /= b.length
      let n = 0, da = 0, db = 0
      for (let i = 0; i < a.length; i++) { const x = a[i] - ma, y = b[i] - mb; n += x * y; da += x * x; db += y * y }
      return n / Math.sqrt(da * db)
    }
    // At half quality (where it showed): the preview works smaller than the picture.
    await c.run(() => window.__store.getState().setPreviewQuality(0.5))
    const tl = await c.box('timeline.ruler')
    await c.mouse('mouseMoved', tl.cx, tl.cy)
    await c.sleep(700)
    const before = await edges()
    await c.mouse('mouseMoved', tile.cx, tile.cy)
    await c.sleep(900)
    const during = await edges()
    await c.mouse('mouseMoved', tl.cx, tl.cy)
    await c.sleep(500)
    // The look changes colours too, so its number mixes both. The same pass
    // (the preview's GL pixel pass a LUT runs through) with an effect too
    // faint to see — a 2 % vignette — leaves the sampling alone to measure.
    await c.run((id) => window.__store.getState().setClipEffect(id, { vignette: 0.02 }), sc.id)
    await c.sleep(900)
    const faint = await edges()
    await c.run(() => window.__store.getState().undo())
    await c.run(() => window.__store.getState().setPreviewQuality(1))
    await c.sleep(300)
    const r = corr(before, during)
    const r2 = corr(before, faint)
    console.log(`     LUT hover: the edges before and during agree ${r.toFixed(3)}; through the pass alone ${r2.toFixed(3)}`)
    return r2 < 0.97 ? `the preview's pixel pass moves the picture's edges (${r2.toFixed(3)} < 0.97; with the look ${r.toFixed(3)})` : null
  })

  // ---- 1: Text opens on text, templates are a sub-page ----------------------------------------
  await check('1 Text page', async () => {
    await c.click('dock.page.templates')
    await c.sleep(200)
    const out = []
    if (!(await c.has('dock.text.add'))) out.push('no "Add text" first')
    if (await c.has('templates.insert.steps')) out.push('the templates show at once')
    if (await c.has('dock.text.tab.templates')) {
      await c.click('dock.text.tab.templates')
      await c.sleep(200)
      if (!(await c.has('templates.insert.steps'))) out.push('the templates sub-page shows no template')
      await c.click('dock.text.tab.text')
    } else out.push('no templates sub-page')
    // A title from the page: one undo step, selected.
    if (await c.has('dock.text.add')) {
      const depth = await lib.undoDepth(c)
      await c.click('dock.text.add')
      await c.sleep(150)
      const n = await c.st((s) => s.project.captions.filter((k) => k.manual).length)
      if (n !== 1) out.push(`${n} titles after Add text`)
      if ((await lib.undoDepth(c)) - depth !== 1) out.push('Add text is not one undo step')
    }
    return out.join('; ') || null
  })

  // ---- 2: the left panel closes ------------------------------------------------------------------
  await check('2 left panel closes', async () => {
    const out = []
    const col = () => c.run(() => parseFloat(getComputedStyle(document.querySelector('.main')).gridTemplateColumns.split(' ')[0]))
    const previewW = () => c.run(() => document.querySelector('.main > .preview').getBoundingClientRect().width)
    const w0 = await previewW()
    await c.click('dock.page.templates') // the open page's icon: closes
    await c.sleep(250)
    const shut = await c.run(() => { const b = document.querySelector('.dock-body'); return !b || b.getBoundingClientRect().width < 2 })
    if (!shut) out.push('a click on the open category does not close the panel')
    if ((await col()) > 80) out.push(`the column stays ${await col()} px`)
    if ((await previewW()) <= w0) out.push('the preview does not grow')
    if (!(await c.has('dock.page.media'))) out.push('the category column went too')
    // Remembered.
    await c.send('Page.reload', { ignoreCache: false })
    await c.sleep(300)
    await lib.ready(c)
    for (let i = 0; i < 10; i++) { if (await c.has('ask.recovery')) { await c.click('ask.recovery.discard'); break } await c.sleep(100) }
    const still = await c.run(() => { const b = document.querySelector('.dock-body'); return !b || b.getBoundingClientRect().width < 2 })
    if (!still) out.push('not remembered after a reload')
    // A category's icon opens it on that page.
    await c.click('dock.page.media')
    await c.sleep(250)
    if (!(await c.has('dock.close'))) out.push('no close button on the open panel')
    else {
      await c.click('dock.close')
      await c.sleep(200)
      const gone = await c.run(() => { const b = document.querySelector('.dock-body'); return !b || b.getBoundingClientRect().width < 2 })
      if (!gone) out.push('the close button does not close')
      await c.click('dock.page.media')
    }
    return out.join('; ') || null
  })

  for (const b of bad) console.log(`     FAULT ${b}`)
  assert.equal(bad.length, 0, `the panel faults of the first try: ${bad.length}`)
}
