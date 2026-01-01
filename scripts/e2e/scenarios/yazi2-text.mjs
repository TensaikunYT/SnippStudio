// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// A title in the preview, as the user works it (SnippStudio YAZI2-PLAN.md;
// YOL-HARITASI.md, part 7): with real mouse and key events, at 1920 × 1080 and
// at 1366 × 768, each in English and in Turkish,
//   1 Add text: the title stands in the middle of the frame for three
//     seconds, selected, typed in at once (its words selected: the first key
//     replaces them); the words appear where the title stands, as they are
//     typed, in its own font; the project gets them once (one undo step);
//   2 a drag: the title follows; near the frame's middle it rests on it
//     exactly and both guide lines are drawn; Alt catches on nothing; Shift
//     keeps to one axis; the quick bar steps aside while dragging;
//   3 the knob turns it: 45° catches, Shift steps by 15°;
//   4 the right side's handle narrows the box: the words wrap, the left side
//     stays where it was;
//   5 a corner sizes it: the opposite corner stays where it was;
//   6 the arrow keys: 1 px, with Shift 10 px, one undo step for the run;
//   7 Ctrl+Z step by step: each of those, in turn, down to no title;
//   8 the exported frame is the preview's picture (the title's place in both);
//   9 the quick bar is inside the preview and sets font, size, colour,
//     alignment, bold, italic and style.
// Pictures to tasarim\karsilastirma\yazi2 when SNIPP_SCREENS_YAZI2 is set.
import { join } from 'node:path'
import { mkdirSync } from 'node:fs'
import { APP_DIR } from '../app.mjs'
import { KNOB, PAD, info, pixel, slowDrag } from '../text-probe.mjs'

export const name = 'yazi2-text'
export const timeoutMs = 480_000

const TEXT = { en: 'The quick brown fox jumps over it', tr: 'Hızlı kahverengi tilki üstünden atlar' }

async function probe({ c, lib, out, bad }, size, lang) {
  const { assert } = lib
  const tag = `${size[0]}x${size[1]} ${lang}`
  const dir = process.env.SNIPP_SCREENS_YAZI2 ? join(APP_DIR, '..', 'tasarim', 'karsilastirma', 'yazi2') : join(out, 'ekranlar-yazi2')
  mkdirSync(dir, { recursive: true })
  const shot = (n) => c.shot(join(dir, `sonra-${n}-${size[0]}-${lang}.png`))
  const check = async (what, fn) => {
    try {
      const r = await fn()
      if (r) bad.push(`[${tag}] ${what}: ${r}`)
    } catch (e) {
      bad.push(`[${tag}] ${what}: ${String(e.message ?? e).slice(0, 220)}`)
    }
  }
  const near = (a, b, eps) => Math.abs(a - b) <= eps

  await c.send('Emulation.setDeviceMetricsOverride', { width: size[0], height: size[1], deviceScaleFactor: 1, mobile: false })
  await c.run((l) => { const s = window.__store.getState(); s.setUiLang(l); s.setTime(1); return true }, lang)
  await c.sleep(500)
  const u0 = (await info(c)).undo

  // ---- 1: add, typed in at once, where it stands ----------------------------------------------
  await lib.addText(c)
  await c.sleep(300)
  let i = await info(c)
  let id = i.caps[i.caps.length - 1]?.id
  const me = (x) => x.caps.find((k) => k.id === id)
  await check('1 added in the middle, three seconds, typed in', async () => {
    const p = me(i)
    if (!p) return 'no title'
    if (p.posX !== 0.5 || p.posY !== 0.5) return `at ${p.posX}, ${p.posY}`
    if (!near(p.end - p.start, 3, 1e-6) || p.layer < 1) return `lasts ${p.end - p.start} on lane ${p.layer}`
    if (!i.typing?.focused) return `not typing (focus: ${i.active})`
    if (i.typing.a !== 0 || i.typing.b !== i.typing.value.length || !i.typing.value) return `selection ${i.typing.a}–${i.typing.b} of "${i.typing.value}"`
    if (i.sel.join() !== id) return `selected ${i.sel.join()}`
    return i.undo - u0 === 1 ? null : `${i.undo - u0} undo steps for the add`
  })
  /** How much of a band across the frame's middle (where the title stands) is white. */
  const ink = () => c.run((x0, y0, x1, y1) => {
    const cv = document.querySelector('[data-testid="preview.canvas"]')
    const r = cv.getBoundingClientRect()
    const dpr = cv.width / r.width
    const w = Math.round((x1 - x0) * dpr)
    const h = Math.round((y1 - y0) * dpr)
    const d = cv.getContext('2d').getImageData(Math.round((x0 - r.left) * dpr), Math.round((y0 - r.top) * dpr), w, h).data
    let n = 0
    for (let k = 0; k < d.length; k += 4) if (d[k] > 245 && d[k + 1] > 245 && d[k + 2] > 245) n++
    return n / (w * h)
  }, i.frame.x + i.frame.w * 0.15, i.frame.y + i.frame.h / 2 - 34 * i.k, i.frame.x + i.frame.w * 0.85, i.frame.y + i.frame.h / 2 + 34 * i.k)
  // (The caret is put at the end first: no selection painted over the placeholder.)
  await c.key('End')
  await c.sleep(120)
  const ink0 = await ink()
  await c.key('a', ['ctrl'])
  await c.type(TEXT[lang])
  await c.sleep(200)
  i = await info(c)
  await check('1 the words are drawn as typed; the project waits', async () => {
    if (i.typing?.value !== TEXT[lang]) return `the field holds "${i.typing?.value}"`
    if (me(i).text === TEXT[lang]) return 'the project already has the words'
    // The letters are on the canvas where the title stands: more white ink
    // there than the placeholder's two words had.
    const b = await ink()
    return b > 0.03 && b > ink0 * 1.5 ? null : `white ink over the middle: ${(ink0 * 100).toFixed(1)} % before, ${(b * 100).toFixed(1)} % after`
  })
  await shot('1-yerinde-yazma')
  // Enter is a new line (drawn at once); Backspace takes it back; Esc is done.
  await c.key('Enter')
  await c.type('x')
  await c.sleep(150)
  i = await info(c)
  await check('1 Enter starts a new line in the title', async () => (i.typing?.value === `${TEXT[lang]}\nx` ? null : `the field holds ${JSON.stringify(i.typing?.value)}`))
  await c.key('Backspace')
  await c.key('Backspace')
  await c.key('Escape')
  await c.sleep(200)
  i = await info(c)
  await check('1 Esc ends the typing: the words in one step, the title still selected', async () => {
    if (i.typing) return 'still typing'
    if (me(i).text !== TEXT[lang]) return `the title says "${me(i).text}"`
    if (i.sel.join() !== id) return `selected ${i.sel.join()}`
    if (i.active !== 'preview.canvas') return `the focus is on ${i.active}`
    return i.undo - u0 === 2 ? null : `${i.undo - u0} undo steps after the typing`
  })
  await check('9 the quick bar is inside the preview, over the title', async () => {
    if (!i.bar) return 'no quick bar'
    if (i.bar.x < i.canvas.x || i.bar.r > i.canvas.r || i.bar.y < i.canvas.y || i.bar.b > i.canvas.b) return `the bar ${JSON.stringify(i.bar)} leaves the preview ${JSON.stringify(i.canvas)}`
    const cut = await c.run(() => [...document.querySelectorAll('[data-testid="preview.text.bar"] *')].filter((e) => e.scrollWidth > e.clientWidth + 1 && e.clientWidth > 0 && e.tagName !== 'SELECT').map((e) => e.className).slice(0, 3))
    if (cut.length) return `cut off in the bar: ${cut.join(', ')}`
    const p = me(i)
    return i.bar.b <= p.y - p.h / 2 - PAD + 1 || i.bar.y >= p.y + p.h / 2 + PAD - 1 ? null : 'the bar lies on the title'
  })
  await shot('2-secili-cubuk')

  // ---- 2: the drag ------------------------------------------------------------------------------
  let p = me(i)
  const cx = i.frame.x + i.frame.w / 2
  const cy = i.frame.y + i.frame.h / 2
  await slowDrag(c, p.x, p.y, p.x - 0.18 * i.frame.w, p.y + 0.2 * i.frame.h, { steps: 8 })
  i = await info(c)
  await check('2 a drag moves it (one step)', async () => {
    const q = me(i)
    if (!near(q.posX, 0.32, 0.01) || !near(q.posY, 0.7, 0.012)) return `at ${q.posX.toFixed(3)}, ${q.posY.toFixed(3)}`
    return i.undo - u0 === 3 ? null : `${i.undo - u0} undo steps`
  })
  p = me(i)
  let guide = null
  let barMid = 'unknown'
  await slowDrag(c, p.x, p.y, cx + 5, cy - 4, {
    mid: async () => {
      // On the frame's middle lines, away from the title: the guides' colour.
      guide = [await pixel(c, i.frame.x + 12, Math.round(cy)), await pixel(c, Math.round(cx), i.frame.y + 10)]
      barMid = (await info(c)).bar
      await shot('3-ortaya-yapisma')
    }
  })
  i = await info(c)
  await check('2 near the middle it rests on it exactly; both guides are drawn; the bar steps aside', async () => {
    const q = me(i)
    if (Math.abs(q.posX - 0.5) > 1e-9 || Math.abs(q.posY - 0.5) > 1e-9) return `at ${q.posX}, ${q.posY}`
    const lime = (px) => px && px[1] > 200 && px[0] > 140 && px[0] < 215 && px[2] < 150
    if (!lime(guide?.[0]) || !lime(guide?.[1])) return `guide pixels ${JSON.stringify(guide)}`
    if (barMid) return 'the quick bar stayed while dragging'
    return i.bar ? null : 'the quick bar did not come back'
  })
  p = me(i)
  await slowDrag(c, p.x, p.y, p.x + 5, p.y + 4, { mods: ['alt'] })
  i = await info(c)
  await check('2 Alt: it catches on nothing', async () => {
    const q = me(i)
    return near(q.fx - 960, 5 / i.k, 1.5) && near(q.fy - 540, 4 / i.k, 1.5) ? null : `moved ${(q.fx - 960).toFixed(1)}, ${(q.fy - 540).toFixed(1)} for 5, 4 px`
  })
  p = me(i)
  await slowDrag(c, p.x, p.y, p.x + 90, p.y + 22, { mods: ['shift'] })
  i = await info(c)
  await check('2 Shift: one axis', async () => {
    const q = me(i)
    return near(q.fy, p.fy, 1e-6) && q.fx - p.fx > 60 / i.k ? null : `moved ${(q.fx - p.fx).toFixed(1)}, ${(q.fy - p.fy).toFixed(1)}`
  })

  // ---- 3: the knob ------------------------------------------------------------------------------
  // (Back in the middle first, so the turned title stays in the picture.)
  await c.run((id) => { window.__store.getState().setCaptionOwnStyle(id, { posX: 0.5, posY: 0.5 }) }, id)
  await c.sleep(1400)
  i = await info(c); p = me(i)
  const uTurn = i.undo
  const knob = [p.x, p.y - p.h / 2 - PAD - KNOB]
  const r0 = p.y - knob[1]
  const at = (deg) => [p.x + r0 * Math.sin((deg * Math.PI) / 180), p.y - r0 * Math.cos((deg * Math.PI) / 180)]
  await c.mouse('mouseMoved', knob[0], knob[1]); await c.sleep(120)
  await check('3 the knob shows the turning cursor', async () => ((await info(c)).cursor.startsWith('url(') ? null : `cursor ${(await info(c)).cursor}`))
  await slowDrag(c, knob[0], knob[1], ...at(43), { mid: () => shot('4-dondurme') })
  i = await info(c)
  await check('3 a turn near 45° is 45°', async () => (near(me(i).rot, 45, 0.01) ? (i.undo - uTurn === 1 ? null : `${i.undo - uTurn} steps`) : `${me(i).rot}°`))
  await slowDrag(c, ...at(45), ...at(71), { mods: ['shift'] })
  i = await info(c)
  await check('3 with Shift it steps by 15°', async () => (near(me(i).rot, 75, 0.01) ? null : `${me(i).rot}°`))
  await slowDrag(c, ...at(75), ...at(2), {})
  i = await info(c)
  await check('3 back near upright it is upright', async () => (near(me(i).rot, 0, 0.01) ? null : `${me(i).rot}°`))
  const uAfterTurn = i.undo

  // ---- 4: the side handle narrows the box --------------------------------------------------------
  p = me(i)
  const east = [p.x + p.w / 2 + PAD, p.y]
  await c.mouse('mouseMoved', east[0], east[1]); await c.sleep(120)
  const eastCursor = (await info(c)).cursor
  await slowDrag(c, east[0], east[1], east[0] - p.w * 0.5, east[1] + 2, { mid: () => shot('5-kutu-daraltma') })
  i = await info(c)
  await check('4 the right side narrows the box: the words wrap, the left side stays', async () => {
    const q = me(i)
    if (eastCursor !== 'ew-resize') return `cursor on the side: ${eastCursor}`
    if (q.lines.length <= p.lines.length) return `still ${q.lines.length} line(s): ${q.lines.join(' / ')}`
    if (!near(q.x - q.w / 2, p.x - p.w / 2, 0.6)) return `the left side went from ${(p.x - p.w / 2).toFixed(1)} to ${(q.x - q.w / 2).toFixed(1)}`
    if (q.text !== p.text) return 'the words changed'
    return i.undo - uAfterTurn === 1 ? null : `${i.undo - uAfterTurn} steps`
  })

  // ---- 5: a corner sizes it ----------------------------------------------------------------------
  p = me(i)
  const corner = [p.x + p.w / 2 + PAD, p.y + p.h / 2 + PAD]
  await c.mouse('mouseMoved', corner[0], corner[1]); await c.sleep(120)
  const cornerCursor = (await info(c)).cursor
  const pull = 0.3
  await slowDrag(c, corner[0], corner[1], corner[0] + p.w * pull, corner[1] + p.h * pull, { mid: () => shot('6-koseden-buyutme') })
  i = await info(c)
  await check('5 a corner sizes it, the opposite corner stays', async () => {
    const q = me(i)
    if (cornerCursor !== 'nwse-resize') return `cursor on the corner: ${cornerCursor}`
    if (!near(q.scale / p.scale, 1 + pull, 0.05)) return `scale ${p.scale} → ${q.scale}`
    if (!near(q.x - q.w / 2, p.x - p.w / 2, 0.8) || !near(q.y - q.h / 2, p.y - p.h / 2, 0.8)) return `the top left corner went from ${(p.x - p.w / 2).toFixed(1)}, ${(p.y - p.h / 2).toFixed(1)} to ${(q.x - q.w / 2).toFixed(1)}, ${(q.y - q.h / 2).toFixed(1)}`
    return i.undo - uAfterTurn === 2 ? null : `${i.undo - uAfterTurn} steps`
  })

  // ---- 6: the arrow keys -------------------------------------------------------------------------
  p = me(i)
  await c.key('ArrowRight'); await c.key('ArrowRight'); await c.key('ArrowUp', ['shift'])
  i = await info(c)
  await check('6 arrows: 1 px, Shift 10 px, one step', async () => {
    const q = me(i)
    if (!near(q.fx - p.fx, 2, 0.01) || !near(q.fy - p.fy, -10, 0.01)) return `moved ${(q.fx - p.fx).toFixed(2)}, ${(q.fy - p.fy).toFixed(2)}`
    return i.undo - uAfterTurn === 3 ? null : `${i.undo - uAfterTurn} steps`
  })

  // ---- 8: the exported frame is the preview's picture --------------------------------------------
  await check('8 the exported frame shows the title where the preview does', async () => {
    // Nothing selected (no outline over the picture), then both pictures of
    // the title's place, the export brought to the preview's size.
    await c.clickAt(i.canvas.x + 6, i.canvas.y + 6)
    await c.sleep(300)
    const q = me(await info(c))
    const j = await info(c)
    if (j.sel.length || j.selClips.length) return `a click beside the picture left ${j.sel.length} title(s), ${j.selClips.length} clip(s) selected`
    const diff = await c.run(async (x0, y0, w, h, fr) => {
      const s = window.__store.getState()
      const ex = await window.__exporter()
      const u8 = await ex.exportFramePng(s.project, s.currentTime, true, 'final')
      const bmp = await createImageBitmap(new Blob([u8]))
      const cv = document.querySelector('[data-testid="preview.canvas"]')
      const r = cv.getBoundingClientRect()
      const dpr = cv.width / r.width
      const mine = cv.getContext('2d').getImageData(Math.round((x0 - r.left) * dpr), Math.round((y0 - r.top) * dpr), Math.round(w * dpr), Math.round(h * dpr))
      const of = new OffscreenCanvas(mine.width, mine.height)
      const g = of.getContext('2d', { willReadFrequently: true })
      const cmp = (shift) => {
        g.clearRect(0, 0, of.width, of.height)
        // The export (the whole frame) drawn where the preview draws the frame.
        g.drawImage(bmp, (fr.x - x0) * dpr + shift, (fr.y - y0) * dpr, fr.w * dpr, fr.h * dpr)
        const d = g.getImageData(0, 0, of.width, of.height).data
        let sum = 0
        for (let k = 0; k < d.length; k += 4) sum += Math.abs(d[k] - mine.data[k]) + Math.abs(d[k + 1] - mine.data[k + 1]) + Math.abs(d[k + 2] - mine.data[k + 2])
        return sum / (d.length / 4) / 3
      }
      return { same: cmp(0), shifted: cmp(10) }
    }, q.x - q.w / 2 - 10, q.y - q.h / 2 - 10, q.w + 20, q.h + 20, j.frame)
    // The same picture (the scaling's own softness aside), and the measure
    // would have seen the title 10 px off.
    // (A smaller preview is softer against the export brought down to it: the
    // letters' edges; a title out of place differs by far more.)
    if (diff.same > 24) return `the two pictures differ by ${diff.same.toFixed(1)} / 255 over the title (${diff.shifted.toFixed(1)} when shifted)`
    return diff.shifted > diff.same * 1.8 ? null : `not telling: ${diff.same.toFixed(1)} against ${diff.shifted.toFixed(1)} when shifted`
  })
  // Selected again for what follows.
  i = await info(c); p = me(i)
  await c.clickAt(p.x, p.y)
  await c.sleep(150)

  // ---- 9: the quick bar's controls ---------------------------------------------------------------
  await check('9 the quick bar sets bold, italic, alignment, size, font, colour, style', async () => {
    const uBar = (await info(c)).undo
    const was = me(await info(c))
    await c.click('preview.text.bar.bold')
    await c.click('preview.text.bar.italic')
    await c.click('preview.text.bar.align.right')
    await c.fill('preview.text.bar.size', '80', { enter: true })
    await c.select('preview.text.bar.font', 'Anton')
    await c.setInput('preview.text.bar.colour', '#ffd23f')
    await c.sleep(300)
    let q = me(await info(c))
    const got = `${q.weight === (was.weight >= 600 ? 400 : 700)} ${q.italic} ${q.align} ${q.size} ${q.font} ${q.color}`
    if (got !== 'true true right 80 Anton #ffd23f') return got
    await shot('7-cubuktan-ayar')
    const steps = (await info(c)).undo - uBar
    if (steps !== 6) return `${steps} undo steps for six settings`
    await c.click('preview.text.bar.style')
    await c.click('preview.text.bar.style.neon')
    await c.sleep(300)
    q = me(await info(c))
    if (q.font !== 'Inter' || q.text !== was.text || !near(q.fx, was.fx, 0.01)) return `the style: ${q.font}, "${q.text}", at ${q.fx}`
    for (let n = 0; n < 7; n++) { await c.key('z', ['ctrl']); await c.sleep(90) }
    q = me(await info(c))
    return q.font === was.font && q.size === was.size && q.italic === was.italic && q.align === was.align ? null : 'seven undos did not take the bar\'s changes back'
  })

  // ---- 7: undo, step by step ---------------------------------------------------------------------
  await check('7 Ctrl+Z takes each back in turn', async () => {
    // (The preview has the keys: a press on the title.)
    let j = await info(c)
    await c.clickAt(me(j).x, me(j).y)
    const seen = []
    const state = (x) => { const q = x.caps.find((k) => k.id === id); return q ? { text: q.text, fx: Math.round(q.fx), fy: Math.round(q.fy), rot: Math.round(q.rot), chars: q.chars, scale: +q.scale.toFixed(2), lines: q.lines.length } : null }
    let before = state(await info(c))
    const want = [
      ['arrows', (a, b) => a.fx !== b.fx && a.fy !== b.fy && a.scale === b.scale],
      ['corner', (a, b) => a.scale !== b.scale && b.scale === 1 && a.chars === b.chars],
      ['width', (a, b) => a.chars !== b.chars && b.lines < a.lines && a.rot === b.rot],
      ['turn to 0', (a, b) => b.rot === 75],
      ['turn to 75', (a, b) => b.rot === 45],
      ['turn to 45', (a, b) => b.rot === 0]
    ]
    for (const [what, ok] of want) {
      await c.key('z', ['ctrl']); await c.sleep(120)
      const after = state(await info(c))
      if (!after || !ok(before, after)) return `undoing "${what}": ${JSON.stringify(before)} → ${JSON.stringify(after)}`
      seen.push(what)
      before = after
    }
    // Down to before the add: the remaining steps, counted.
    let n = 0
    while ((await info(c)).undo > u0 && n < 20) { await c.key('z', ['ctrl']); await c.sleep(90); n++ }
    j = await info(c)
    if (j.caps.some((k) => k.id === id)) return 'the title is still there'
    // (the centring through the store, the three drags, the typing, the add)
    return n === 7 ? null : `${n} more steps down to no title (7 expected)`
  })
}

export async function run(ctx) {
  const { c, app, media, lib } = ctx
  const { assert } = lib
  const [talk] = await lib.seedAssets(app, c, [media.talk1080 ?? media.talk])
  await lib.seedTimeline(c, [talk.id])
  const bad = []
  try {
    for (const size of [[1920, 1080], [1366, 768]]) for (const lang of ['en', 'tr']) await probe({ ...ctx, bad }, size, lang)
  } finally {
    await c.send('Emulation.setDeviceMetricsOverride', { width: 1920, height: 1080, deviceScaleFactor: 1, mobile: false })
    await c.run(() => { window.__store.getState().setUiLang('en'); return true })
  }
  if (bad.length) console.log('     ' + bad.join('\n     '))
  assert.deepEqual(bad, [], 'a title in the preview')
}
