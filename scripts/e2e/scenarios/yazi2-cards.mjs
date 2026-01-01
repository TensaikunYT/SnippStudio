// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// A title's ways in and its selection (SnippStudio YAZI2-PLAN.md, 2.1, 2.2,
// 2.5, 2.7), with real mouse and key events:
//   1 a style card dragged onto the preview puts its title where it is
//     dropped, typed in at once; a press on the card without a move is still
//     its click (the title in the middle);
//   2 the card dragged onto the timeline shows a ghost clip and adds the
//     title at that time (caught on the clip's end), the playhead there;
//     dropped anywhere else, or with Esc, nothing is added;
//   3 a press on empty picture lets go of the title; a press on the video
//     picks the video and lets go of the title (never both); a press on the
//     title again opens its settings on the right;
//   4 a double-click on empty picture opens nothing; on the title it types
//     in it with all its words selected; a click puts the caret at that
//     letter, a double-click takes the word, a drag selects; Ctrl+A, the
//     arrows with Shift, Home and End work on the lines as drawn;
//   5 a press outside ends the typing with the words kept; a title typed
//     empty keeps its words (cila4, 5: it used to be deleted); unchanged
//     words leave no undo step;
//   6 the timeline's clip, double-clicked, is typed in in the preview;
//   7 a shape has the same outline and handles: a side sizes that side, the
//     opposite one stays;
//   8 the subtitle window (its own tools) still opens for a subtitle line,
//     its words selected.
import { info, slowDrag } from '../text-probe.mjs'

export const name = 'yazi2-cards'
export const timeoutMs = 240_000

export async function run({ c, app, media, lib }) {
  const { assert } = lib
  const bad = []
  const check = async (what, fn) => {
    try {
      const r = await fn()
      if (r) bad.push(`${what}: ${r}`)
    } catch (e) {
      bad.push(`${what}: ${String(e.message ?? e).slice(0, 220)}`)
    }
  }
  const near = (a, b, eps) => Math.abs(a - b) <= eps
  const [talk] = await lib.seedAssets(app, c, [media.talk1080 ?? media.talk])
  await lib.seedTimeline(c, [talk.id])
  await c.run(() => { window.__store.getState().setTime(1); return true })
  await lib.textPage(c, 'styles')
  const u0 = (await info(c)).undo
  const titles = (x) => x.caps.filter((k) => !k.shape)

  // ---- 1: a card onto the preview ---------------------------------------------------------------
  let i = await info(c)
  // (The card brought into the panel's view, as a user scrolls to it.)
  await c.run(() => { document.querySelector('[data-testid="dock.text.style.headline"]').scrollIntoView({ block: 'center' }); return true })
  await c.sleep(200)
  const card = await c.box('dock.text.style.headline')
  const drop = [i.frame.x + 0.3 * i.frame.w, i.frame.y + 0.25 * i.frame.h]
  let ghost = null
  await slowDrag(c, card.cx, card.cy, drop[0], drop[1], { steps: 14, mid: async () => { ghost = await c.attr('text.card.drag', 'data-over') } })
  await c.sleep(250)
  i = await info(c)
  await check('1 a card dropped on the preview: its title there, typed in', async () => {
    if (ghost !== 'preview') return `the dragged card said it was over "${ghost}"`
    if (titles(i).length !== 1) return `${titles(i).length} titles`
    const p = titles(i)[0]
    if (!near(p.posX, 0.3, 0.01) || !near(p.posY, 0.25, 0.012)) return `at ${p.posX.toFixed(3)}, ${p.posY.toFixed(3)}`
    if (p.font !== 'Anton') return `in ${p.font}`
    if (!i.typing?.focused || i.typing.b - i.typing.a !== i.typing.value.length) return 'not typed in with its words selected'
    return i.undo - u0 === 1 ? null : `${i.undo - u0} undo steps`
  })
  await c.type('Dropped')
  await c.key('Escape')
  await c.sleep(150)
  // A press without a move is the card's click: with a title selected it gives it the look.
  await c.click('dock.text.style.neon')
  await c.sleep(200)
  i = await info(c)
  await check('1 a click on a card is still its click', async () => (titles(i).length === 1 && titles(i)[0].font === 'Inter' ? null : `${titles(i).length} titles, the first in ${titles(i)[0]?.font}`))

  // ---- 2: a card onto the timeline ---------------------------------------------------------------
  const u1 = (await info(c)).undo
  const rulerBox = await c.box('timeline.ruler')
  const scroll = await c.box('timeline.scroll')
  const tx = (await lib.timeX(c, 12)) + 5
  let clip = null
  await slowDrag(c, card.cx, card.cy, tx, rulerBox.b ?? rulerBox.y + rulerBox.h + 40, { steps: 16, mid: async () => { clip = { over: await c.attr('text.card.drag', 'data-over'), box: await c.box('text.card.drag.clip') } } })
  await c.sleep(250)
  i = await info(c)
  await check('2 a card dropped on the timeline: a ghost clip, the title at that time', async () => {
    if (clip?.over !== 'timeline' || !clip.box) return `the dragged card said "${clip?.over}", ghost ${JSON.stringify(clip?.box)}`
    const x12 = await lib.timeX(c, 12)
    if (!near(clip.box.x, x12, 1.5)) return `the ghost clip at ${clip.box.x.toFixed(1)}, the video's end at ${x12.toFixed(1)}`
    if (clip.box.y < scroll.y || clip.box.y > scroll.y + scroll.h) return 'the ghost clip is outside the timeline'
    const added = titles(i).find((k) => k.text !== 'Dropped')
    if (!added) return 'no second title'
    if (!near(added.start, 12, 1e-6) || !near(added.end, 15, 1e-6)) return `at ${added.start}–${added.end}`
    if (added.posX !== 0.5 || added.posY !== 0.5) return `placed at ${added.posX}, ${added.posY}`
    if (!near(i.time, 12, 0.02)) return `the playhead at ${i.time}`
    if (!i.typing?.focused) return 'not typed in'
    return i.undo - u1 === 1 ? null : `${i.undo - u1} undo steps`
  })
  await c.key('Escape')
  await c.sleep(150)
  // Dropped on nothing; and taken back with Esc.
  const u2 = (await info(c)).undo
  const count = titles(await info(c)).length
  const insp = await c.box('inspector.tab.project')
  await slowDrag(c, card.cx, card.cy, insp.cx, insp.cy + 200, { steps: 8 })
  await c.mouse('mouseMoved', card.cx, card.cy)
  await c.mouse('mousePressed', card.cx, card.cy)
  for (let n = 1; n <= 8; n++) { await c.mouse('mouseMoved', card.cx + n * 60, card.cy + n * 10, { down: true }); await c.sleep(20) }
  const during = await c.has('text.card.drag')
  await c.key('Escape')
  const afterEsc = await c.has('text.card.drag')
  await c.mouse('mouseReleased', card.cx + 480, card.cy + 80)
  await c.sleep(200)
  i = await info(c)
  await check('2 dropped elsewhere, or Esc: nothing is added', async () => (titles(i).length === count && i.undo === u2 && during && !afterEsc ? null : `${titles(i).length} titles (were ${count}), ${i.undo - u2} steps, ghost ${during} → ${afterEsc}`))

  // ---- 3: the selection -------------------------------------------------------------------------
  await c.run(() => { window.__store.getState().setTime(2); return true })
  await c.sleep(200)
  i = await info(c)
  let p = titles(i).find((k) => k.text === 'Dropped')
  await check('3 one kind of thing is picked at a time', async () => {
    await c.clickAt(p.x, p.y)
    let j = await info(c)
    if (j.sel.join() !== p.id || j.selClips.length) return `a press on the title: ${j.sel.length} title(s), ${j.selClips.length} clip(s)`
    await c.clickAt(i.frame.x + 0.8 * i.frame.w, i.frame.y + 0.8 * i.frame.h)
    j = await info(c)
    if (j.sel.length || j.selClips.length !== 1) return `a press on the video: ${j.sel.length} title(s), ${j.selClips.length} clip(s)`
    await c.clickAt(p.x, p.y)
    j = await info(c)
    if (j.sel.join() !== p.id || j.selClips.length) return `the title again: ${j.sel.length} title(s), ${j.selClips.length} clip(s)`
    if ((await c.attr('inspector.tab.subs', 'aria-selected')) !== 'true') return 'its settings did not open on the right'
    await c.clickAt(i.canvas.x + 5, i.canvas.y + 5)
    j = await info(c)
    return j.sel.length || j.selClips.length ? `a press beside the picture: ${j.sel.length} title(s), ${j.selClips.length} clip(s)` : null
  })

  // ---- 4: typing in place ------------------------------------------------------------------------
  await c.run((id) => { const s = window.__store.getState(); s.updateCaption(id, { text: 'The cat sat by the window and looked out' }); s.setCaptionOwnStyle(id, { posX: 0.5, posY: 0.4, maxLineChars: 22 }); return true }, p.id)
  await c.sleep(1400)
  i = await info(c); p = titles(i).find((k) => k.id === p.id)
  const u3 = i.undo
  await check('4 a double-click on empty picture opens nothing', async () => {
    await c.clickAt(i.frame.x + 0.8 * i.frame.w, i.frame.y + 0.85 * i.frame.h, { double: true })
    await c.sleep(200)
    const j = await info(c)
    return j.typing || (await c.run(() => !!document.querySelector('.caption-editor'))) ? 'something opened' : null
  })
  await check('4 typing where it stands: the caret, a word, a drag, the keys', async () => {
    await c.clickAt(p.x, p.y, { double: true })
    await c.sleep(200)
    let j = await info(c)
    if (!j.typing?.focused || j.typing.a !== 0 || j.typing.b !== p.text.length) return `a double-click: ${JSON.stringify(j.typing)}`
    if (j.cursor !== 'text') { await c.mouse('mouseMoved', p.x + 3, p.y + 3); await c.sleep(100); if ((await info(c)).cursor !== 'text') return `the cursor over its words: ${(await info(c)).cursor}` }
    // The lines as drawn: "The cat sat by the" / "window and looked out". A
    // click a third along the first line.
    if (p.lines.join('|') !== 'The cat sat by the|window and looked out') return `lines ${p.lines.join('|')}`
    const lineY = [p.y - p.h / 4, p.y + p.h / 4]
    await c.clickAt(p.x - p.w / 6, lineY[0])
    j = await info(c)
    if (j.typing.a !== j.typing.b || j.typing.a < 3 || j.typing.a > 9) return `a click: the caret at ${j.typing.a}`
    const caret = j.typing.a
    await c.key('ArrowRight', ['shift']); await c.key('ArrowRight', ['shift'])
    j = await info(c)
    if (j.typing.a !== caret || j.typing.b !== caret + 2) return `Shift+Right twice: ${j.typing.a}–${j.typing.b}`
    await c.key('ArrowDown')
    j = await info(c)
    if (j.typing.a !== j.typing.b || j.typing.a < 19) return `Down: the caret at ${j.typing.a} (the second line starts at 19)`
    await c.key('Home')
    j = await info(c)
    if (j.typing.a !== 19) return `Home: the caret at ${j.typing.a}`
    await c.key('End', ['shift'])
    j = await info(c)
    if (j.typing.a !== 19 || j.typing.b !== p.text.length) return `Shift+End: ${j.typing.a}–${j.typing.b}`
    await c.key('ArrowUp')
    j = await info(c)
    if (j.typing.a > 18) return `Up: the caret at ${j.typing.a}`
    await c.key('a', ['ctrl'])
    j = await info(c)
    if (j.typing.a !== 0 || j.typing.b !== p.text.length) return `Ctrl+A: ${j.typing.a}–${j.typing.b}`
    // A double-click takes the word under it ("window": the second line's first).
    await c.clickAt(p.x - p.w / 2 + p.w * 0.08, lineY[1], { double: true })
    await c.sleep(150)
    j = await info(c)
    const word = j.typing.value.slice(j.typing.a, j.typing.b)
    if (word !== 'window') return `a double-click took "${word}"`
    // A drag selects from where it began to where it is.
    await slowDrag(c, p.x - p.w / 2 + 2, lineY[0], p.x + p.w / 2 - 2, lineY[0], { steps: 6 })
    j = await info(c)
    if (j.typing.a !== 0 || j.typing.b !== 18 || !j.typing.focused) return `a drag along the first line: ${j.typing.a}–${j.typing.b}, focused ${j.typing.focused}`
    await c.type('It')
    j = await info(c)
    if (j.typing.value !== 'It window and looked out') return `typed over the selection: "${j.typing.value}"`
    return j.undo === u3 ? null : 'the project changed while typing'
  })
  // ---- 5: ending it ------------------------------------------------------------------------------
  await check('5 a press outside ends the typing with the words kept, in one step', async () => {
    await c.click('inspector.tab.project')
    await c.sleep(200)
    const j = await info(c)
    const q = titles(j).find((k) => k.id === p.id)
    if (j.typing) return 'still typing'
    if (q.text !== 'It window and looked out') return `the title says "${q.text}"`
    return j.undo - u3 === 1 ? null : `${j.undo - u3} undo steps`
  })
  await check('5 unchanged words leave no step; a title typed empty keeps its words', async () => {
    let j = await info(c)
    p = titles(j).find((k) => k.id === p.id)
    const u = j.undo
    await c.clickAt(p.x, p.y, { double: true })
    await c.sleep(150)
    await c.key('End')
    await c.key('Escape')
    await c.sleep(150)
    j = await info(c)
    if (j.typing || j.undo !== u) return `opened and closed: ${j.undo - u} steps, typing ${!!j.typing}`
    await c.key('Enter')
    await c.sleep(150)
    j = await info(c)
    if (!j.typing?.focused || j.typing.b - j.typing.a !== p.text.length) return 'Enter on the selected title did not start typing'
    await c.key('Backspace')
    await c.key('Enter', ['ctrl'])
    await c.sleep(200)
    j = await info(c)
    if (j.typing) return 'still typing'
    if (!titles(j).some((k) => k.id === p.id && k.text === p.text)) return 'the emptied title lost its words or went'
    return j.undo === u ? null : `${j.undo - u} steps for nothing written`
  })

  // ---- 6: the timeline's clip --------------------------------------------------------------------
  await check('6 the clip on the timeline, double-clicked, is typed in in the preview', async () => {
    await c.run(() => { window.__store.getState().setTime(2.5); return true })
    await c.sleep(150)
    await c.click(`timeline.caption.${p.id}`, { double: true, fx: 0.25, fy: 0.5 })
    await c.sleep(300)
    const j = await info(c)
    if (!j.typing?.focused || j.typing.value !== p.text || j.typing.b - j.typing.a !== p.text.length) return `typing ${JSON.stringify(j.typing)}`
    if (await c.run(() => !!document.querySelector('.caption-editor'))) return 'the old window opened'
    if (j.time < p.start || j.time >= p.end) return `the playhead left the title (${j.time})`
    await c.key('Escape')
    return null
  })

  // ---- 7: a shape --------------------------------------------------------------------------------
  await check('7 a shape: the same handles; a side sizes that side', async () => {
    await c.run(() => { const s = window.__store.getState(); s.setTime(6); s.selectCaptions([]); s.addShapeAtPlayhead('rect'); return true })
    await c.sleep(300)
    let j = await info(c)
    const sh = j.caps.find((k) => k.shape)
    if (j.bar) return 'a shape got the text quick bar'
    await slowDrag(c, sh.x + sh.w / 2, sh.y, sh.x + sh.w / 2 + 60, sh.y)
    j = await info(c)
    let q = j.caps.find((k) => k.shape)
    if (!near(q.w - sh.w, 60, 1.5) || !near(q.x - q.w / 2, sh.x - sh.w / 2, 0.8) || !near(q.h, sh.h, 0.5)) return `the right side: width ${sh.w.toFixed(1)} → ${q.w.toFixed(1)}, left ${(sh.x - sh.w / 2).toFixed(1)} → ${(q.x - q.w / 2).toFixed(1)}`
    await slowDrag(c, q.x - q.w / 2, q.y - q.h / 2, q.x - q.w / 2 - 30, q.y - q.h / 2 - 20)
    j = await info(c)
    const r = j.caps.find((k) => k.shape)
    if (!near(r.w - q.w, 30, 1.5) || !near(r.h - q.h, 20, 1.5) || !near(r.x + r.w / 2, q.x + q.w / 2, 0.8) || !near(r.y + r.h / 2, q.y + q.h / 2, 0.8)) return `the top left corner: ${q.w.toFixed(1)} × ${q.h.toFixed(1)} → ${r.w.toFixed(1)} × ${r.h.toFixed(1)}`
    // A double-click on it opens nothing (it has no words).
    await c.clickAt(r.x, r.y, { double: true })
    await c.sleep(150)
    j = await info(c)
    return j.typing ? 'a shape was typed in' : null
  })

  // ---- 8: a subtitle line keeps its own window ------------------------------------------------------
  await check('8 a subtitle line: its own window, its words selected', async () => {
    await c.run(() => { const s = window.__store.getState(); s.setSubtitles([{ id: 'sub1', start: 8, end: 10, text: 'heard words here' }]); s.selectCaptions([]); s.setTime(9); return true })
    await c.sleep(300)
    const j = await info(c)
    const sub = j.caps.find((k) => k.id === 'sub1')
    await c.clickAt(sub.x, sub.y, { double: true })
    await c.sleep(300)
    const st = await c.run(() => { const ta = document.querySelector('.caption-editor textarea'); return ta ? { v: ta.value, a: ta.selectionStart, b: ta.selectionEnd } : null })
    if (!st) return 'the subtitle window did not open'
    if (st.a !== 0 || st.b !== st.v.length) return `its words are not selected (${st.a}–${st.b})`
    await c.key('Escape')
    return (await info(c)).typing ? 'the title field opened for a subtitle' : null
  })

  if (bad.length) console.log('     ' + bad.join('\n     '))
  assert.deepEqual(bad, [], 'a title\'s ways in and its selection')
}
