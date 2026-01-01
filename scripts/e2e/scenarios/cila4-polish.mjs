// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// Last polish, worker cila4 (SnippStudio haritalar/_cila4-rapor.md):
//   2 the small pictures a still did not tell apart (GORUNUS R5): the five
//     text moves while on screen differ at rest, "Grow" and "Shrink" differ
//     and the shrink is not a speck; the clip's four motions all through
//     differ at rest; the Effects page's speed ramp is no dark blur. Pointed
//     at, a card still plays.
//   3 the quick bar on a title that nearly fills the picture: inside the
//     picture, at its top inner edge, see-through; gone while the title is
//     dragged.
//   4 a title selected: its style (type, colour…) above its motion in the
//     Inspector; the Text page's styles above the ready-made texts.
// In two sizes and two languages. With SNIPP_SCREENS_CILA4=<folder> it
// photographs each (SNIPP_CILA4_BEFORE=1: the photographs only, for the
// tree before the change).
import { join } from 'node:path'
import { mkdirSync } from 'node:fs'
import { info, slowDrag } from '../text-probe.mjs'
export const name = 'cila4-polish'
export const timeoutMs = 300_000

const BEFORE = !!process.env.SNIPP_CILA4_BEFORE

/** Scrolls the panel holding `tid` so it stands near the top (no scrollIntoView). */
const reveal = (c, tid, at = 0.15) => c.run((s, at) => {
  const el = document.querySelector(s)
  if (!el) return false
  let p = el.parentElement
  while (p && !(p.scrollHeight > p.clientHeight + 2 && /(auto|scroll)/.test(getComputedStyle(p).overflowY))) p = p.parentElement
  if (!p) return true
  const r = el.getBoundingClientRect()
  const pr = p.getBoundingClientRect()
  p.scrollTop += r.top - pr.top - pr.height * at
  return true
}, `[data-testid="${tid}"]`, at)

/** Each canvas under `sel`: a hash of its pixels, its mean light, and the
 *  box of what is drawn on it (alpha > 40) as a share of the canvas. */
const pics = (c, sel) => c.run((sel) => [...document.querySelectorAll(sel)].map((cv) => {
  const d = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data
  let h = 0
  let light = 0
  let n = 0
  let x0 = cv.width, x1 = -1, y0 = cv.height, y1 = -1
  for (let i = 0; i < d.length; i += 4) {
    const px = (i / 4) % cv.width
    const py = Math.floor(i / 4 / cv.width)
    if (i % 28 === 0) h = (h * 31 + d[i] + d[i + 1] * 3 + d[i + 2] * 7 + d[i + 3] * 11) % 1000000007
    light += (d[i] * 0.3 + d[i + 1] * 0.59 + d[i + 2] * 0.11) * (d[i + 3] / 255)
    n++
    if (d[i + 3] > 40) {
      if (px < x0) x0 = px
      if (px > x1) x1 = px
      if (py < y0) y0 = py
      if (py > y1) y1 = py
    }
  }
  return { id: cv.closest('[data-testid]')?.dataset.testid, h, light: light / n, w: x1 < 0 ? 0 : (x1 - x0 + 1) / cv.width, hh: y1 < 0 ? 0 : (y1 - y0 + 1) / cv.height }
}), sel)

export async function run_({ c, app, lib }, size, lang, bad, dir) {
  const tag = `${size[0]}x${size[1]} ${lang}`
  const shot = async (n) => {
    // (The pointer away: no tooltip over what is photographed.)
    await c.mouse('mouseMoved', size[0] / 2, size[1] - 4)
    await c.sleep(150)
    if (dir) await c.shot(join(dir, `${n}-${BEFORE ? 'once' : 'sonra'}-${size[0]}-${lang}.png`))
  }
  const check = async (what, fn) => {
    if (BEFORE) return
    try {
      const r = await fn()
      if (r) bad.push(`[${tag}] ${what}: ${r}`)
    } catch (e) {
      bad.push(`[${tag}] ${what}: ${String(e.message ?? e).slice(0, 240)}`)
    }
  }
  await c.send('Emulation.setDeviceMetricsOverride', { width: size[0], height: size[1], deviceScaleFactor: 1, mobile: false })
  await c.run((l) => { const s = window.__store.getState(); s.setUiLang(l); s.setCaptions([]); s.selectCaptions([]); s.setTime(1); return true }, lang)
  await c.sleep(400)

  // ---- 2: the text page's moves --------------------------------------------------------------
  await lib.textPage(c, 'anims')
  await c.waitId('dock.text.anims')
  await reveal(c, 'dock.text.anim.out.grow', 0.05)
  await c.sleep(700)
  await shot('2a-yazi-animasyonlari')
  await check('2 the five moves while on screen differ at rest', async () => {
    const p = await pics(c, '[data-testid="dock.text.anims.idle"] canvas')
    if (p.length !== 5) return `${p.length} cards`
    return new Set(p.map((x) => x.h)).size === 5 ? null : JSON.stringify(p.map((x) => [x.id, x.h]))
  })
  await check('2 Grow and Shrink differ at rest; Shrink is no speck', async () => {
    const [g, s] = await Promise.all([pics(c, '[data-testid="dock.text.anim.in.grow"] canvas'), pics(c, '[data-testid="dock.text.anim.out.grow"] canvas')])
    const [fade] = await pics(c, '[data-testid="dock.text.anim.out.fade"] canvas')
    if (g[0].h === s[0].h) return 'the same picture'
    return s[0].w >= fade.w * 0.8 ? null : `the shrink's drawing is ${(s[0].w * 100).toFixed(0)} % wide, a fade's ${(fade.w * 100).toFixed(0)} %`
  })
  await check('2 pointed at, a move while on screen plays', async () => {
    const b = await c.box('dock.text.anim.idle.drift')
    await c.mouse('mouseMoved', b.cx, b.cy)
    const seen = []
    for (let i = 0; i < 4; i++) { await c.sleep(220); seen.push((await pics(c, '[data-testid="dock.text.anim.idle.drift"] canvas'))[0].h) }
    await c.mouse('mouseMoved', b.cx, b.cy + 600)
    return new Set(seen).size < 2 ? 'the picture did not move' : null
  })

  // ---- 2: the Effects page's ramp -------------------------------------------------------------
  await lib.dockPage(c, 'effects')
  await c.waitId('effects.demo.ramp')
  await c.sleep(500)
  await shot('2b-efektler')
  await check('2 the speed ramp card is no dark blur; the three differ', async () => {
    const p = await pics(c, '[data-testid^="effects.demo."] canvas')
    const by = Object.fromEntries(p.map((x) => [x.id, x]))
    const ramp = by['effects.demo.ramp']
    const cine = by['effects.demo.cinematize']
    if (!ramp || !cine) return JSON.stringify(p.map((x) => x.id))
    if (new Set(p.map((x) => x.h)).size !== p.length) return 'two cards alike'
    return ramp.light >= cine.light * 0.75 ? null : `the ramp card's light ${ramp.light.toFixed(1)} against ${cine.light.toFixed(1)}`
  })

  // ---- 2: the clip's motions all through ------------------------------------------------------
  const [clip] = await lib.clipList(c)
  await c.run(() => {
    const state = JSON.parse(localStorage.getItem('snipp-sections') ?? '{}')
    state.Motion = true
    localStorage.setItem('snipp-sections', JSON.stringify(state))
    return true
  })
  await c.st((s, id) => s.selectClip(id), clip.id)
  await c.click('inspector.tab.subs')
  await c.click('inspector.tab.clip')
  await c.waitId('inspector.card.motion')
  if (!(await c.has('inspector.clip.motion.grid'))) await c.click('inspector.card.motion.head')
  await c.waitId('inspector.clip.motion.part.idle')
  await c.click('inspector.clip.motion.part.idle')
  await c.waitFor('the motions all through', async () => (await c.ids('inspector.clip.motion.tile.')).length === 5)
  await reveal(c, 'inspector.clip.motion.grid', 0.1)
  await c.sleep(500)
  await shot('2c-klip-surekli')
  await check('2 the four motions all through differ at rest', async () => {
    const all = await pics(c, '[data-testid="inspector.clip.motion.grid"] canvas')
    const none = all.find((x) => x.id.endsWith('.none'))
    const p = all.filter((x) => !x.id.endsWith('.none'))
    if (p.length !== 4 || new Set(p.map((x) => x.h)).size !== 4) return JSON.stringify(p.map((x) => [x.id, x.h]))
    // (As light as the still frame: no moment past the clip's end, black.)
    const dark = p.filter((x) => x.light < none.light * 0.8)
    return dark.length ? `dark: ${dark.map((x) => `${x.id} ${x.light.toFixed(0)} / ${none.light.toFixed(0)}`).join(', ')}` : null
  })
  await check('2 pointed at, a motion all through plays', async () => {
    const tid = 'inspector.clip.motion.tile.float'
    const b = await c.box(tid)
    await c.mouse('mouseMoved', b.cx, b.cy)
    const seen = []
    for (let i = 0; i < 4; i++) { await c.sleep(250); seen.push((await pics(c, `[data-testid="${tid}"] canvas`))[0].h) }
    await c.mouse('mouseMoved', b.cx, b.cy + 600)
    return new Set(seen).size < 2 ? 'the picture did not move' : null
  })
  await c.click('inspector.clip.motion.part.in')

  // ---- 3: the quick bar on a title that nearly fills the picture --------------------------------
  await c.st((s) => s.selectClip(null))
  await lib.addText(c)
  await c.sleep(300)
  await c.type(lang === 'tr' ? 'Büyük' : 'Big')
  await c.key('Escape')
  await c.sleep(200)
  let i = await info(c)
  const id = i.caps[i.caps.length - 1].id
  await c.run((id, t) => {
    const s = window.__store.getState()
    s.updateCaption(id, { text: t })
    s.setCaptionOwnStyle(id, { posX: 0.5, posY: 0.5, fontSize: 420, maxLineChars: 12 })
    s.selectCaptions([id])
    return true
  }, id, lang === 'tr' ? 'BÜYÜK\nYAZI' : 'BIG\nTEXT')
  await c.sleep(500)
  await shot('3-buyuk-yazi')
  await check('3 the bar: inside the picture, at its top inner edge, see-through', async () => {
    const j = await info(c)
    const me = j.caps.find((k) => k.id === id)
    if (!j.bar) return 'no quick bar'
    const side = await c.attr('preview.text.bar', 'data-side')
    if (side !== 'inside') return `the bar is ${side} (the title ${me.h.toFixed(0)} of ${j.frame.h.toFixed(0)} px)`
    if (j.bar.x < j.frame.x - 0.5 || j.bar.r > j.frame.x + j.frame.w + 0.5 || j.bar.y < j.frame.y - 0.5 || j.bar.b > j.frame.y + j.frame.h + 0.5) return `the bar ${JSON.stringify(j.bar)} leaves the picture ${JSON.stringify(j.frame)}`
    if (Math.abs(j.bar.y - (Math.max(j.canvas.y, j.frame.y) + 4)) > 1.5) return `not at the top inner edge (${j.bar.y.toFixed(1)} against ${j.frame.y.toFixed(1)})`
    const op = Number(await c.run(() => getComputedStyle(document.querySelector('[data-testid="preview.text.bar"]')).opacity))
    return op < 0.95 && op > 0.5 ? null : `opacity ${op}`
  })
  await check('3 the bar is gone while the title is dragged, back after', async () => {
    const j = await info(c)
    const me = j.caps.find((k) => k.id === id)
    let during = null
    // (From the title's lower part: the bar lies over its top.)
    const y = me.y + me.h * 0.25
    await slowDrag(c, me.x, y, me.x + 40, y + 10, { steps: 8, mid: async () => { during = await c.has('preview.text.bar') } })
    await c.sleep(300)
    const after = await c.has('preview.text.bar')
    return during === false && after ? null : `during ${during}, after ${after}`
  })
  // ---- 4: a title selected: its style first, on the right and on the left ----------------------
  await c.st((s, id) => { s.updateCaption(id, { text: 'Stil' }); s.setCaptionOwnStyle(id, { fontSize: 96 }); s.selectCaptions([id]) }, id)
  await c.click('inspector.tab.subs')
  if (BEFORE) await c.sleep(400)
  else await c.waitId('inspector.text.sec.type')
  await lib.textPage(c)
  await c.waitId('dock.text.sec.styles')
  await c.run(() => { for (const el of document.querySelectorAll('.dock-scroll, .insp-scroll, [data-testid="inspector"] *')) if (el.scrollTop) el.scrollTop = 0; return true })
  await c.sleep(300)
  await shot('4-stil-ustte')
  await check('4 the Inspector: the style before the motion, under the words', async () => {
    const y = await c.run(() => ['inspector.text.sec.type', 'inspector.text.sec.motion'].map((t) => document.querySelector(`[data-testid="${t}"]`)?.getBoundingClientRect().top ?? null))
    return y[0] !== null && y[1] !== null && y[0] < y[1] ? null : `type at ${y[0]}, motion at ${y[1]}`
  })
  // (okunur, 23 November: the ready-made texts moved to Templates; the text
  // sub-page opens on its styles with or without a selected title.)
  await check('4 the Text page: the styles first, the ready-made texts not on it', async () => {
    const look = () => c.run(() => ({ styles: document.querySelector('#dock-text-text [data-testid="dock.text.sec.styles"]')?.getBoundingClientRect().top ?? null, ready: !!document.querySelector('#dock-text-text [data-testid="dock.text.sec.ready"]') }))
    const sel = await look()
    await c.st((s) => s.selectCaptions([]))
    await c.sleep(200)
    const none = await look()
    return sel.styles !== null && none.styles !== null && !sel.ready && !none.ready ? null : `selected ${JSON.stringify(sel)}, none ${JSON.stringify(none)}`
  })
  await c.st((s) => { s.setCaptions([]); s.selectCaptions([]) })
  await lib.dockPage(c, 'media')
}

export async function run(ctx) {
  const { c, app, media, lib } = ctx
  const { assert } = lib
  const [pic] = await lib.seedAssets(app, c, [media.other])
  await lib.seedTimeline(c, [pic.id])
  const dir = process.env.SNIPP_SCREENS_CILA4 || null
  if (dir) mkdirSync(dir, { recursive: true })
  const bad = []
  try {
    for (const size of [[1920, 1080], [1366, 768]]) for (const lang of ['tr', 'en']) await run_(ctx, size, lang, bad, dir)
  } finally {
    await c.send('Emulation.setDeviceMetricsOverride', { width: 1920, height: 1080, deviceScaleFactor: 1, mobile: false })
    await c.run(() => { window.__store.getState().setUiLang('en'); return true })
  }
  if (bad.length) console.log('     ' + bad.join('\n     '))
  assert.deepEqual(bad, [], 'cila4: the still pictures and the quick bar')
}
