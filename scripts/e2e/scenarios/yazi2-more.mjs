// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// A title in the preview, the addendum (SnippStudio YAZI2-PLAN.md, "Ek"), with
// real mouse and key events:
//   1 while a title is typed in, the Inspector's field and its clip on the
//     timeline show the same words as the preview; the project gets them
//     once (one undo step for the session);
//   2 an animation card with no text selected adds its title as every card
//     does: in the middle, selected, typed in; one undo step with its move;
//   4 a side pulled: the box's line is at the pointer all the way (the words
//     wrap by whole words inside it); at the release the box sits on the
//     words, the opposite side where it was;
//   5 the guide lines read on a white picture and on a black one (a dark
//     edge and the accent, side by side);
//   6 the quick bar never lies on the title: under it when the title is near
//     the picture's top, inside the picture (at 1366 × 768 too);
//   7 the Inspector's tab says "Text" while a title is the selection, and
//     "Subs" again without one.
// Pictures to tasarim\karsilastirma\yazi2-2 when SNIPP_SCREENS_YAZI2 is set.
import { join } from 'node:path'
import { mkdirSync } from 'node:fs'
import { APP_DIR } from '../app.mjs'
import { PAD, info, slowDrag } from '../text-probe.mjs'

export const name = 'yazi2-more'
export const timeoutMs = 300_000

/** The colours of a short run of the preview canvas's pixels: across (x0…x1 at y) or down. */
const pixels = (c, x0, y0, x1, y1) => c.run((x0, y0, x1, y1) => {
  const cv = document.querySelector('[data-testid="preview.canvas"]')
  const r = cv.getBoundingClientRect()
  const dpr = cv.width / r.width
  const g = cv.getContext('2d')
  const out = []
  const n = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0))
  for (let i = 0; i <= n; i++) {
    const x = x0 + ((x1 - x0) * i) / Math.max(1, n)
    const y = y0 + ((y1 - y0) * i) / Math.max(1, n)
    const d = g.getImageData(Math.round((x - r.left) * dpr), Math.round((y - r.top) * dpr), 1, 1).data
    out.push([d[0], d[1], d[2]])
  }
  return out
}, x0, y0, x1, y1)
// (The outline's gold, also where the 1.5 px line only half covers a pixel.)
const gold = (p) => p[0] > 110 && p[1] > p[0] * 0.75 && p[1] < p[0] && p[2] < p[0] * 0.55
const lime = (p) => p[1] > 200 && p[0] > 140 && p[0] < 215 && p[2] < 150
const dark = (p) => p[0] < 60 && p[1] < 60 && p[2] < 60

export async function run_({ c, lib, out }, size, lang, bad) {
  const tag = `${size[0]}x${size[1]} ${lang}`
  const dir = process.env.SNIPP_SCREENS_YAZI2 ? join(APP_DIR, '..', 'tasarim', 'karsilastirma', 'yazi2-2') : join(out, 'ekranlar-yazi2-2')
  mkdirSync(dir, { recursive: true })
  const shot = (n) => c.shot(join(dir, `ek-${n}-${size[0]}-${lang}.png`))
  const check = async (what, fn) => {
    try {
      const r = await fn()
      if (r) bad.push(`[${tag}] ${what}: ${r}`)
    } catch (e) {
      bad.push(`[${tag}] ${what}: ${String(e.message ?? e).slice(0, 240)}`)
    }
  }
  const near = (a, b, eps) => Math.abs(a - b) <= eps
  await c.send('Emulation.setDeviceMetricsOverride', { width: size[0], height: size[1], deviceScaleFactor: 1, mobile: false })
  // An empty project (a black picture), nothing selected.
  await c.run((l) => { const s = window.__store.getState(); s.setUiLang(l); s.setCaptions([]); s.selectCaptions([]); s.selectClip(null); s.setTime(1); return true }, lang)
  await c.sleep(500)
  const words = lang === 'tr' ? 'Yazarken her yerde aynı söz' : 'The same words everywhere while typing'

  // ---- 7: the tab's name without a title ------------------------------------------------------
  const tabName = () => c.run(() => document.querySelector('[data-testid="inspector.tab.subs"]')?.textContent?.trim() ?? null)
  const subsName = lang === 'tr' ? 'Altyazı' : 'Subs'
  const textName = lang === 'tr' ? 'Yazı' : 'Text'
  await check('7 without a title the tab is the subtitles\'', async () => ((await tabName()) === subsName ? null : `the tab says "${await tabName()}"`))

  // ---- 1: typing shows everywhere -------------------------------------------------------------
  const u0 = (await info(c)).undo
  await lib.addText(c)
  await c.sleep(300)
  let i = await info(c)
  const id = i.caps[i.caps.length - 1].id
  const me = (x) => x.caps.find((k) => k.id === id)
  await c.type(words)
  await c.sleep(250)
  const shown = () => c.run((id) => ({
    field: document.querySelector('.insp-own-text textarea')?.value ?? null,
    clip: document.querySelector(`[data-testid="timeline.caption.${id}"] .chip-text`)?.textContent?.trim() ?? null,
    clipTip: document.querySelector(`[data-testid="timeline.caption.${id}"]`)?.getAttribute('title') ?? '',
    project: window.__store.getState().project.captions.find((k) => k.id === id)?.text,
    undo: window.__store.getState().past.length
  }), id)
  await check('1 the Inspector and the timeline show the words being typed; the project waits', async () => {
    const s = await shown()
    if (s.field !== words) return `the Inspector's field shows "${s.field}"`
    if (s.clip !== words || !s.clipTip.includes(words)) return `the clip shows "${s.clip}"`
    if (s.project === words) return 'the project already has the words'
    return s.undo - u0 === 1 ? null : `${s.undo - u0} undo steps while typing`
  })
  await check('7 with a title picked the tab says Text', async () => ((await tabName()) === textName ? null : `the tab says "${await tabName()}"`))
  await shot('1-yazarken-her-yerde')
  await c.key('Escape')
  await c.sleep(200)
  await check('1 after the typing: the same words in all three, one step', async () => {
    const s = await shown()
    return s.field === words && s.clip === words && s.project === words && s.undo - u0 === 2 ? null : JSON.stringify(s)
  })

  // ---- cila4, 5: a Space on a title just added; a title typed empty ------------------------------
  await check('cila4 5 a Space on a new title plays, its words as they were; a letter still replaces them', async () => {
    await c.st((s) => { s.setPlaying(false); s.setTime(1) })
    const n0 = (await info(c)).caps.length
    await lib.addText(c)
    await c.sleep(300)
    let j = await info(c)
    const fresh = j.caps[j.caps.length - 1]
    if (j.caps.length !== n0 + 1 || !j.typing?.focused) return `not typing in a new title (${j.caps.length - n0} new, typing ${!!j.typing})`
    if (j.typing.b - j.typing.a !== fresh.text.length) return 'the new words are not all selected'
    await c.key(' ')
    await c.sleep(250)
    const playing = await c.st((s) => s.playing)
    await c.st((s) => s.setPlaying(false))
    j = await info(c)
    const still = j.caps.find((k) => k.id === fresh.id)
    if (!still) return 'the title went'
    if (still.text !== fresh.text) return `its words became "${still.text}"`
    if (j.typing) return 'still typing'
    if (!playing) return 'Space did not play'
    // A letter on a new title: in place of its words, as before.
    await c.st((s, t) => s.setTime(t), fresh.start + 0.05)
    await lib.addText(c)
    await c.sleep(300)
    j = await info(c)
    const next = j.caps[j.caps.length - 1]
    await c.key('k')
    await c.sleep(150)
    j = await info(c)
    if (j.typing?.value !== 'k') return `a letter gave "${j.typing?.value}"`
    // Typed empty: the words stay, the title too, silently.
    await c.key('Backspace')
    await c.key('Escape')
    await c.sleep(200)
    j = await info(c)
    const kept = j.caps.find((k) => k.id === next.id)
    if (!kept || kept.text !== next.text) return `typed empty: ${kept ? `"${kept.text}"` : 'gone'}`
    await c.st((s, ids, keep) => { s.deleteCaptions(ids); s.selectCaptions([keep]) }, [fresh.id, next.id], id)
    return null
  })

  // ---- 6: the quick bar's place ---------------------------------------------------------------
  const barCheck = async (what, posY, side) => {
    await c.run((id, y) => { window.__store.getState().setCaptionOwnStyle(id, { posX: 0.5, posY: y }); return true }, id, posY)
    await c.sleep(250)
    const j = await info(c)
    const p = me(j)
    const got = await c.attr('preview.text.bar', 'data-side')
    if (!j.bar) return `${what}: no quick bar`
    if (got !== side) return `${what}: the bar is ${got}`
    const top = p.y - p.h / 2 - PAD
    const bottom = p.y + p.h / 2 + PAD
    if (j.bar.b > top && j.bar.y < bottom) return `${what}: the bar (${j.bar.y.toFixed(0)}–${j.bar.b.toFixed(0)}) lies on the title (${top.toFixed(0)}–${bottom.toFixed(0)})`
    if (j.bar.x < j.frame.x - 0.5 || j.bar.r > j.frame.x + j.frame.w + 0.5 || j.bar.y < j.frame.y - 0.5 || j.bar.b > j.frame.y + j.frame.h + 0.5) return `${what}: the bar ${JSON.stringify(j.bar)} leaves the picture ${JSON.stringify(j.frame)}`
    return null
  }
  await check('6 the bar: over a title in the middle', () => barCheck('middle', 0.55, 'above'))
  await check('6 the bar: under a title near the top', async () => {
    const r = await barCheck('top', 0.1, 'below')
    await shot('6-cubuk-ustteki-yazinin-altinda')
    return r
  })
  await check('6 the bar: over a title near the bottom', () => barCheck('bottom', 0.9, 'above'))
  await c.run((id) => { window.__store.getState().setCaptionOwnStyle(id, { posX: 0.5, posY: 0.5 }); return true }, id)
  await c.sleep(1400)

  // ---- 4: a side pulled ------------------------------------------------------------------------
  i = await info(c)
  let p = me(i)
  const east = [p.x + p.w / 2 + PAD, p.y]
  // A pull to where no word breaks (the line is at the pointer wherever it is).
  const to = [east[0] - p.w * 0.2, east[1] + 1]
  let mid = null
  await slowDrag(c, east[0], east[1], to[0], to[1], {
    steps: 14,
    mid: async () => {
      const j = await info(c)
      const q = me(j)
      // Across the pointer's place, above the side's handle: the box's line.
      const y = q.y - q.h / 2 + 4
      mid = { line: await pixels(c, to[0] - 3, y, to[0] + 3, y), words: q.x + q.w / 2, lines: q.lines.length }
      await shot('4-kenar-fareyi-izliyor')
    }
  })
  i = await info(c)
  await check('4 while pulled the box\'s line is at the pointer; released, the box sits on the words', async () => {
    const q = me(i)
    if (!mid || !mid.line.some(gold)) return `no outline at the pointer (${JSON.stringify(mid?.line)})`
    if (mid.lines <= p.lines.length) return `the words did not wrap (${mid.lines} line(s))`
    if (to[0] - mid.words - PAD < 8) return `the pull ended on a word break: not telling (${(to[0] - mid.words).toFixed(1)})`
    if (!near(q.x - q.w / 2, p.x - p.w / 2, 0.6)) return `the left side went from ${(p.x - p.w / 2).toFixed(1)} to ${(q.x - q.w / 2).toFixed(1)}`
    // Released: the outline's right side is on the words' (their side + the pad), no longer at the pointer.
    const y = q.y - q.h / 2 + 4
    const at = await pixels(c, q.x + q.w / 2 + PAD - 3, y, q.x + q.w / 2 + PAD + 3, y)
    const old = await pixels(c, to[0] - 2, y, to[0] + 2, y)
    if (!at.some(gold)) return 'released: no outline on the words\' side'
    return old.some(gold) ? 'released: the outline is still at the pointer' : null
  })
  await shot('4-birakinca-metne-oturdu')
  await c.key('z', ['ctrl'])
  await c.sleep(200)

  // ---- 5: the guides on a dark and on a light picture ------------------------------------------
  const guides = async (what) => {
    const j = await info(c)
    const q = me(j)
    await c.clickAt(q.x, q.y)
    await slowDrag(c, q.x, q.y, q.x - 0.2 * j.frame.w, q.y + 0.22 * j.frame.h, { steps: 6 })
    const k = await info(c)
    const r = me(k)
    const cx = k.frame.x + k.frame.w / 2
    const cy = k.frame.y + k.frame.h / 2
    let seen = null
    await slowDrag(c, r.x, r.y, cx + 4, cy - 3, {
      mid: async () => {
        // Across each line, away from the title.
        seen = { h: await pixels(c, k.frame.x + 14, cy - 4, k.frame.x + 14, cy + 4), v: await pixels(c, cx - 4, k.frame.y + 12, cx + 4, k.frame.y + 12) }
        await shot(`5-kilavuz-${what}`)
      }
    })
    for (const line of [seen?.h, seen?.v]) {
      if (!line) return `${what}: nothing read`
      if (line.filter(lime).length < 2) return `${what}: no accent line (${JSON.stringify(line)})`
      if (line.filter(dark).length < (what === 'acik' ? 2 : 2)) return `${what}: no dark edge beside it (${JSON.stringify(line)})`
    }
    await c.key('z', ['ctrl']); await c.key('z', ['ctrl'])
    await c.sleep(200)
    return null
  }
  await check('5 the guides on a black picture', () => guides('koyu'))
  // A white picture: a white box over the whole frame, under the title.
  const white = await c.run((id) => {
    const s = window.__store.getState()
    const sid = s.addShapeAtPlayhead('rect')
    const st = window.__store.getState()
    st.setCaptionShape(sid, { w: 1, h: 1 })
    st.setCaptionOwnStyle(sid, { posX: 0.5, posY: 0.5, bgColor: '#ffffff', bgOpacity: 1, bgRadius: 0 })
    st.updateCaption(sid, { layer: 1 })
    st.updateCaption(id, { layer: 2 })
    st.setCaptionOwnStyle(id, { color: '#101014', outlineWidth: 0 })
    st.selectCaptions([id])
    return sid
  }, id)
  await c.sleep(1400)
  await check('5 the guides on a white picture', () => guides('acik'))
  await c.run((sid, id) => { const s = window.__store.getState(); s.deleteCaptions([sid]); window.__store.getState().selectCaptions([id]); return true }, white, id)
  await c.sleep(300)

  // ---- 2: an animation card adds its title as the others do ------------------------------------
  await c.run(() => { const s = window.__store.getState(); s.setCaptions([]); s.selectCaptions([]); s.setTime(3); return true })
  await lib.textPage(c, 'anims')
  await c.sleep(300)
  const u2 = (await info(c)).undo
  await c.click('dock.text.anim.in.slide')
  await c.sleep(350)
  i = await info(c)
  await check('2 an animation card: its title in the middle, typed in, one step', async () => {
    const q = i.caps[0]
    if (i.caps.length !== 1) return `${i.caps.length} titles`
    if (q.posX !== 0.5 || q.posY !== 0.5) return `at ${q.posX}, ${q.posY}`
    if (!near(q.end - q.start, 3, 1e-6) || !near(q.start, 3, 1e-6)) return `at ${q.start}–${q.end}`
    if (!i.typing?.focused || i.typing.a !== 0 || i.typing.b !== i.typing.value.length) return `not typed in (${JSON.stringify(i.typing)})`
    const anim = await c.st((s) => s.project.captions[0].anim)
    if (anim?.in !== 'slide') return `its way in: ${JSON.stringify(anim)}`
    // The playhead rests where the title has arrived: what is typed is seen.
    if (i.time < q.start + (anim.inDur ?? 0.35) - 1e-6) return `the playhead (${i.time}) is inside the way in`
    return i.undo - u2 === 1 ? null : `${i.undo - u2} undo steps`
  })
  await c.type(lang === 'tr' ? 'Kayarak gelen' : 'Sliding in')
  await c.sleep(200)
  await shot('2-animasyon-karti-yazma-kipinde')
  await c.key('Escape')
  await c.sleep(150)
  await check('2 with the title selected the card only changes its move', async () => {
    await c.click('dock.text.anim.in.fade')
    await c.sleep(200)
    const j = await info(c)
    const anim = await c.st((s) => s.project.captions[0].anim)
    return j.caps.length === 1 && anim?.in === 'fade' && !j.typing ? null : `${j.caps.length} titles, ${JSON.stringify(anim)}, typing ${!!j.typing}`
  })
  await check('7 nothing picked: the tab is the subtitles\' again', async () => {
    const j = await info(c)
    await c.clickAt(j.canvas.x + 5, j.canvas.y + 5)
    await c.sleep(200)
    return (await tabName()) === subsName ? null : `the tab says "${await tabName()}"`
  })
}

export async function run(ctx) {
  const { c, lib } = ctx
  const { assert } = lib
  const bad = []
  try {
    await run_(ctx, [1920, 1080], 'en', bad)
    await run_(ctx, [1366, 768], 'tr', bad)
  } finally {
    await c.send('Emulation.setDeviceMetricsOverride', { width: 1920, height: 1080, deviceScaleFactor: 1, mobile: false })
    await c.run(() => { window.__store.getState().setUiLang('en'); return true })
  }
  if (bad.length) console.log('     ' + bad.join('\n     '))
  assert.deepEqual(bad, [], 'a title in the preview, the addendum')
}
