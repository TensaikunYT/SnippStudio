// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// A title in the preview (SnippStudio YAZI2-PLAN.md): where its letters are
// (the engine's own wrap, with the caret's places), what a press takes, what a
// pull on a handle makes of its box, the lines a drag catches on, and the
// typing session. The modules of components/preview/text-edit/ that have no
// window in them.
import assert from 'node:assert/strict'
import test from 'node:test'
import { wrapCaption } from '../renderer/src/playback/draw/captions'
import { caretAt, indexAt, layoutText, lineEdge, moveVertical, selectionRects, wordAt, wrapForWidth, wrapLines, wrapWidths, WRAP_MIN, type TextSpec } from '../renderer/src/components/preview/text-edit/layout'
import { boundsOf, boxHandles, boxKnob, handleCursor, middleAfterWidth, sizeByHandle, snapTurn, widthByHandle, type TurnedBox } from '../renderer/src/components/preview/text-edit/handles'
import { boxTargets, frameTargets, snapMove } from '../renderer/src/components/preview/text-edit/guides'
import { hitTest, type ScreenItem } from '../renderer/src/components/preview/text-edit/hit'
import { barPlace } from '../renderer/src/components/preview/text-edit/bar-place'
import { beginTyping, caretTo, caretToEdge, caretVertical, fieldChanged, fieldSelection, selectWord, spaceLeaves, typingResult } from '../renderer/src/components/preview/text-edit/inline'

const DEG = Math.PI / 180
const near = (a: number, b: number, eps = 1e-6): void => assert.ok(Math.abs(a - b) < eps, `${a} ≉ ${b}`)
/** Every letter ten wide at size 10 (a fixed-pitch face). */
const measure = (text: string, size: number): number => text.length * size
const spec = (text: string, over: Partial<TextSpec> = {}): TextSpec => ({ text, uppercase: false, maxLineChars: 12, align: 'center', fontSize: 10, lineHeight: 1.5, fitWidth: 0, minFontSize: 2, ...over })

// ---- layout -------------------------------------------------------------------

test('the lines are the engine\'s own: paragraphs at line breaks, each wrapped by the same rule', () => {
  for (const [text, n] of [['The cat sat by the window', 12], ['  two   blanks\n\nand an empty line ', 9], ['one', 5], ['', 5], ['a\nb', 5], ['straße über alles', 8]] as const) {
    for (const upper of [false, true]) {
      const src = upper ? text.toUpperCase() : text
      const engine = src.split('\n').flatMap((seg) => (seg.trim() ? wrapCaption(seg, n) : ['']))
      assert.deepEqual(wrapLines(text, upper, n), engine, `${JSON.stringify(text)} at ${n}${upper ? ', upper case' : ''}`)
    }
  }
})

test('a block: lines centred on it, or set to its left or right; its size is its lines', () => {
  const c = layoutText(spec('The cat sat by the window'), measure)
  assert.deepEqual(c.lines.map((l) => l.text), ['The cat sat', 'by the', 'window'])
  near(c.width, 110)
  near(c.height, 45)
  assert.deepEqual(c.lines.map((l) => l.left), [-55, -30, -30])
  assert.deepEqual(c.lines.map((l) => l.y), [-15, 0, 15])
  assert.deepEqual(layoutText(spec('The cat sat by the window', { align: 'left' }), measure).lines.map((l) => l.left), [-55, -55, -55])
  assert.deepEqual(layoutText(spec('The cat sat by the window', { align: 'right' }), measure).lines.map((l) => l.left), [-55, -5, -5])
})

test('fit to width shrinks the size until the widest line fits, never under the smallest', () => {
  const fit = layoutText(spec('The cat sat', { fitWidth: 55 }), measure)
  near(fit.fontSize, 5)
  near(fit.width, 55)
  near(fit.lineHeight, 7.5)
  near(layoutText(spec('The cat sat', { fitWidth: 11, minFontSize: 2 }), measure).fontSize, 2)
})

test('the caret: every place of the source has a spot in the drawn block', () => {
  const text = 'The cat sat by the window'
  const l = layoutText(spec(text), measure)
  // Start, inside a word, a word's end, after the blank.
  assert.deepEqual(caretAt(l, 0), { line: 0, x: -55, y: -15 })
  assert.deepEqual(caretAt(l, 2), { line: 0, x: -35, y: -15 })
  assert.deepEqual(caretAt(l, 3), { line: 0, x: -25, y: -15 })
  assert.deepEqual(caretAt(l, 4), { line: 0, x: -15, y: -15 })
  // The end of a wrapped line, and the next place: the next line's start.
  assert.deepEqual(caretAt(l, 11), { line: 0, x: 55, y: -15 })
  assert.deepEqual(caretAt(l, 12), { line: 1, x: -30, y: 0 })
  assert.deepEqual(caretAt(l, text.length), { line: 2, x: 30, y: 15 })
})

test('the caret among blanks: runs of them are one drawn blank; one typed at the end shows as a step', () => {
  const l = layoutText(spec('  ab   cd  ', { maxLineChars: 40 }), measure)
  assert.equal(l.lines[0].text, 'ab cd')
  // Before the first word: the line's start.
  near(caretAt(l, 0).x, -25)
  near(caretAt(l, 2).x, -25)
  near(caretAt(l, 4).x, -5)
  // Anywhere in the run after "ab": after the one drawn blank.
  near(caretAt(l, 5).x, 5)
  near(caretAt(l, 7).x, 5)
  near(caretAt(l, 9).x, 25)
  // After the last word: a blank's width further.
  near(caretAt(l, 10).x, 35)
  // An empty paragraph is a line of its own with the caret in its middle.
  const e = layoutText(spec('ab\n\ncd'), measure)
  assert.equal(e.lines.length, 3)
  assert.deepEqual(caretAt(e, 3), { line: 1, x: 0, y: 0 })
  // Upper case that is longer than its letter: the caret after it is after both.
  const u = layoutText(spec('aßb', { uppercase: true }), measure)
  assert.equal(u.lines[0].text, 'ASSB')
  near(caretAt(u, 2).x - caretAt(u, 1).x, 20)
})

test('a click finds its letter; up and down keep their x; Home and End are the drawn line\'s', () => {
  const text = 'The cat sat by the window'
  const l = layoutText(spec(text), measure)
  assert.equal(indexAt(l, -36, -15), 2)
  assert.equal(indexAt(l, 500, 0), 18)
  assert.equal(indexAt(l, -500, 400), 19)
  assert.equal(indexAt(l, 0, -400), 5)
  // Down from "The c|at": x −5 on the next lines.
  const d1 = moveVertical(l, 5, 1)
  assert.deepEqual(d1, { index: 14, x: -5 })
  assert.equal(moveVertical(l, d1.index, 1, d1.x).index, 21)
  assert.equal(moveVertical(l, 21, 1, -5).index, text.length)
  assert.equal(moveVertical(l, 5, -1).index, 0)
  assert.equal(lineEdge(l, 14, 'start'), 12)
  assert.equal(lineEdge(l, 14, 'end'), 18)
  assert.equal(lineEdge(l, 3, 'end'), 11)
})

test('a selection is a box per line; a word is what a double-click takes', () => {
  const l = layoutText(spec('The cat sat by the window'), measure)
  assert.deepEqual(selectionRects(l, 4, 4), [])
  assert.deepEqual(selectionRects(l, 7, 4), [{ x: -15, y: -22.5, w: 30, h: 15 }])
  const two = selectionRects(l, 8, 14)
  assert.equal(two.length, 2)
  near(two[0].x, 25)
  near(two[0].w, 30)
  near(two[1].x, -30)
  near(two[1].w, 20)
  assert.deepEqual(wordAt('The cat sat', 5), [4, 7])
  assert.deepEqual(wordAt('The cat sat', 7), [4, 7])
  assert.deepEqual(wordAt('The cat sat', 0), [0, 3])
  assert.deepEqual(wordAt('a  b', 2), [2, 2])
})

test('a width picks the widest wrap that fits; narrower than a word, the word alone', () => {
  const s = spec('The cat sat by the window')
  const w = wrapWidths(s, measure)
  assert.equal(w.length, 196)
  near(w[0], 60) // 5: "window" alone is the widest
  near(w[12 - WRAP_MIN], 110)
  near(w[w.length - 1], 250)
  const fits = (target: number): string[] => wrapLines(s.text, false, wrapForWidth(w, target))
  assert.deepEqual(fits(1000), ['The cat sat by the window'])
  assert.deepEqual(fits(250), ['The cat sat by the window'])
  assert.deepEqual(fits(249), ['The cat sat by the', 'window'])
  assert.deepEqual(fits(110), ['The cat sat', 'by the', 'window'])
  assert.deepEqual(fits(75), ['The cat', 'sat by', 'the', 'window'])
  assert.deepEqual(fits(10), ['The', 'cat', 'sat by', 'the', 'window'])
  // Whatever the target, the block is never wider than it (or than its widest word).
  for (let target = 0; target <= 260; target += 7) {
    const n = wrapForWidth(w, target)
    assert.ok(w[n - WRAP_MIN] <= Math.max(target, 60) + 0.5, `at ${target}: ${w[n - WRAP_MIN]}`)
  }
})

// ---- handles ------------------------------------------------------------------

const box = (over: Partial<TurnedBox> = {}): TurnedBox => ({ cx: 200, cy: 100, w: 120, h: 40, rot: 0, ...over })

test('a box has four corner handles always, and a side\'s handle where the side is long enough', () => {
  assert.deepEqual(boxHandles(box()).map((h) => h.id), ['nw', 'ne', 'se', 'sw', 'e', 'w', 'n', 's'])
  assert.deepEqual(boxHandles(box({ h: 20 })).map((h) => h.id), ['nw', 'ne', 'se', 'sw', 'n', 's'])
  assert.deepEqual(boxHandles(box({ w: 30, h: 20 })).map((h) => h.id), ['nw', 'ne', 'se', 'sw'])
  const h = Object.fromEntries(boxHandles(box()).map((x) => [x.id, [x.x, x.y]]))
  assert.deepEqual(h.nw, [140, 80])
  assert.deepEqual(h.e, [260, 100])
  // A quarter turn: the right side's handle is below the middle.
  const q = boxHandles(box({ rot: 90 * DEG })).find((x) => x.id === 'e')!
  near(q.x, 200)
  near(q.y, 160)
})

test('the cursor lies along the pull, on a turned box too; the knob stands above, below at the top', () => {
  assert.equal(handleCursor('e', 0), 'ew-resize')
  assert.equal(handleCursor('se', 0), 'nwse-resize')
  assert.equal(handleCursor('n', 0), 'ns-resize')
  assert.equal(handleCursor('e', 90 * DEG), 'ns-resize')
  assert.equal(handleCursor('ne', 45 * DEG), 'ew-resize')
  assert.deepEqual(boxKnob(box(), 600).knob, [200, 56])
  assert.deepEqual(boxKnob(box({ cy: 30 }), 600).knob, [200, 74])
})

test('a turn catches every 45°, Shift steps by 15°', () => {
  near(snapTurn(43 * DEG, false), 45 * DEG)
  near(snapTurn(-2 * DEG, false), 0)
  near(snapTurn(88 * DEG, false), 90 * DEG)
  near(snapTurn(30 * DEG, false), 30 * DEG)
  near(snapTurn(22 * DEG, true), 15 * DEG)
  near(snapTurn(23 * DEG, true), 30 * DEG)
})

test('a corner sizes the box round the opposite corner; Alt round its middle; the top side round the bottom\'s middle', () => {
  // The bottom right corner pulled out along the diagonal by half its length.
  const r = sizeByHandle(box(), 'se', [260, 120], [320, 140], false, 0.05, 10)
  near(r.ratio, 1.5)
  // The top left corner (140, 80) has not moved: the middle is half the new size from it.
  near(r.cx - (120 * 1.5) / 2, 140)
  near(r.cy - (40 * 1.5) / 2, 80)
  // A pull across the diagonal changes nothing.
  near(sizeByHandle(box(), 'se', [260, 120], [262, 114], false, 0.05, 10).ratio, 1)
  // Alt: the middle stays, the handle goes as far as the pointer.
  const a = sizeByHandle(box(), 'se', [260, 120], [320, 140], true, 0.05, 10)
  near(a.ratio, 2)
  near(a.cx, 200)
  near(a.cy, 100)
  // The top side pulled up by its height: twice the size, the bottom side's middle where it was.
  const t = sizeByHandle(box(), 'n', [200, 80], [200, 40], false, 0.05, 10)
  near(t.ratio, 2)
  near(t.cx, 200)
  near(t.cy + 40, 120)
  // Bounded.
  near(sizeByHandle(box(), 'se', [260, 120], [0, 0], false, 0.25, 10).ratio, 0.25)
  // On a turned box the pull is read in its own frame.
  const q = sizeByHandle(box({ rot: 90 * DEG }), 'e', [200, 160], [200, 190], false, 0.05, 10)
  near(q.ratio, 1.25)
})

test('a side sets the width: the other side stays; on a turned box too; Alt moves both', () => {
  near(widthByHandle(box(), 'e', [260, 100], [230, 130], false), 90)
  near(widthByHandle(box(), 'w', [140, 100], [100, 100], false), 160)
  near(widthByHandle(box(), 'e', [260, 100], [230, 100], true), 60)
  assert.deepEqual(middleAfterWidth(box(), 'e', 90, false), [185, 100])
  assert.deepEqual(middleAfterWidth(box(), 'w', 90, false), [215, 100])
  assert.deepEqual(middleAfterWidth(box(), 'e', 90, true), [200, 100])
  const m = middleAfterWidth(box({ rot: 90 * DEG }), 'e', 90, false)
  near(m[0], 200)
  near(m[1], 85)
  const b = boundsOf(box({ rot: 90 * DEG }))
  near(b.l, 180)
  near(b.t, 40)
})

// ---- guides -------------------------------------------------------------------

test('a dragged box catches on the frame\'s middle, and says which lines it rests on', () => {
  const frame = frameTargets(1920, 1080, { centres: true, edges: true, safe: [0.05, 0.1] })
  const s = snapMove({ l: 850, t: 500, r: 1050, b: 560 }, frame, 12)
  assert.equal(s.dx, 10)
  assert.equal(s.dy, 10)
  assert.deepEqual(s.guides.map((g) => [g.axis, g.pos, g.kind]), [['v', 960, 'centre'], ['h', 540, 'centre']])
  // The frame's lines run the whole frame.
  assert.deepEqual([s.guides[0].from, s.guides[0].to], [0, 1080])
  // Out of reach: nothing.
  const free = snapMove({ l: 700, t: 300, r: 900, b: 360 }, frame, 12)
  assert.deepEqual([free.dx, free.dy, free.guides.length], [0, 0, 0])
  // The safe areas: 5 % and 10 % in.
  const safe = snapMove({ l: 100, t: 300, r: 300, b: 360 }, frame, 12)
  assert.equal(safe.dx, -4)
  assert.equal(safe.guides[0].kind, 'safe')
  assert.equal(snapMove({ l: 190, t: 300, r: 390, b: 360 }, frame, 12).dx, 2)
})

test('the nearest line wins; a locked axis is left alone; another box gives its sides and middles', () => {
  const frame = frameTargets(1920, 1080, { centres: true, edges: false })
  const other = boxTargets({ l: 400, t: 100, r: 600, b: 160 }, { centres: true, edges: true })
  // Its left side 3 from the other's left, its middle 9 from the frame's: the side wins.
  const s = snapMove({ l: 403, t: 300, r: 1499, b: 360 }, [...frame, ...other], 12)
  assert.equal(s.dx, -3)
  assert.deepEqual(s.guides.map((g) => [g.axis, g.pos, g.kind]), [['v', 400, 'box']])
  // The guide reaches from the other box to this one.
  assert.deepEqual([s.guides[0].from, s.guides[0].to], [100, 360])
  // Locked sideways (Shift, a drag up or down): only y is caught.
  const l = snapMove({ l: 403, t: 535, r: 603, b: 555 }, [...frame, ...other], 12, 'x')
  assert.equal(l.dx, 0)
  assert.equal(l.dy, -5)
  assert.deepEqual(l.guides.map((g) => g.axis), ['h'])
  // Middle on middle before a side as near.
  const tie = snapMove({ l: 94, t: 0, r: 114, b: 10 }, [{ axis: 'v', pos: 100, kind: 'edge', from: 0, to: 9 }, { axis: 'v', pos: 108, kind: 'centre', from: 0, to: 9 }], 12)
  assert.equal(tie.dx, 4)
})

// ---- hit ----------------------------------------------------------------------

const item = (id: string, over: Partial<Omit<ScreenItem, 'box'>> & { box?: Partial<TurnedBox> } = {}): ScreenItem => ({ id, selected: false, shape: false, ...over, box: box(over.box) })

test('a press takes the topmost body; only a selected thing has handles and a knob', () => {
  const under = item('under')
  const over = item('over', { box: { cx: 230 } })
  assert.deepEqual(hitTest([under, over], 220, 100, 600), { kind: 'body', id: 'over' })
  assert.deepEqual(hitTest([under, over], 150, 100, 600), { kind: 'body', id: 'under' })
  assert.equal(hitTest([under, over], 500, 300, 600), null)
  // Where an unselected title's corner or knob would be: nothing to take.
  assert.equal(hitTest([under], 200, 50, 600), null)
  // Selected: the outline is 6 px outside the letters; its corner, its side, its knob.
  const sel = item('sel', { selected: true })
  assert.deepEqual(hitTest([sel], 134, 74, 600), { kind: 'handle', id: 'sel', handle: 'nw' })
  assert.deepEqual(hitTest([sel], 266, 100, 600), { kind: 'handle', id: 'sel', handle: 'e' })
  assert.deepEqual(hitTest([sel], 200, 50, 600), { kind: 'knob', id: 'sel' })
  assert.deepEqual(hitTest([sel], 200, 100, 600), { kind: 'body', id: 'sel' })
  // A selected thing's handle before another's body lying over it.
  assert.deepEqual(hitTest([sel, item('top', { box: { cx: 300 } })], 266, 100, 600), { kind: 'handle', id: 'sel', handle: 'e' })
  // While it is typed in, its handles are not drawn: the same press is its body.
  assert.deepEqual(hitTest([sel], 264, 100, 600, false), { kind: 'body', id: 'sel' })
})

test('a turned box is taken where it stands', () => {
  const t = item('t', { box: { rot: 90 * DEG } })
  assert.deepEqual(hitTest([t], 200, 155, 600), { kind: 'body', id: 't' })
  assert.equal(hitTest([t], 255, 100, 600), null)
})

// ---- typing -------------------------------------------------------------------

test('a typing session: all selected at first, the field\'s changes followed, one result at the end', () => {
  let s = beginTyping('c1', 'New text')
  assert.deepEqual(fieldSelection(s), [0, 8, 'forward'])
  s = fieldChanged(s, 'H', 1, 1, false)
  s = fieldChanged(s, 'Hello  world ', 13, 13, false)
  assert.deepEqual(typingResult(s), { kind: 'text', id: 'c1', text: 'Hello  world' })
  assert.deepEqual(typingResult(fieldChanged(s, ' New text\n', 0, 0, false)), { kind: 'none' })
  // Typed away to blanks or to nothing (cila4, 5): kept as it was, never deleted.
  assert.deepEqual(typingResult(fieldChanged(s, ' \n ', 0, 0, false)), { kind: 'none' })
  assert.deepEqual(typingResult(fieldChanged(s, ' ', 1, 1, false)), { kind: 'none' })
  assert.deepEqual(typingResult(fieldChanged(s, '', 0, 0, false)), { kind: 'none' })
  // Unchanged: the same session back (nothing to draw again).
  assert.equal(fieldChanged(s, s.text, s.anchor, s.focus, false), s)
  assert.deepEqual(fieldSelection(beginTyping('c1', 'abc', 'end')), [3, 3, 'forward'])
  assert.deepEqual(fieldSelection(beginTyping('c1', 'abc', 1)), [1, 1, 'forward'])
})

test('a Space on a title nothing was typed in yet, its words all selected, leaves the typing (cila4, 5)', () => {
  const key = (k: string, o: Partial<{ ctrl: boolean; alt: boolean; meta: boolean; shift: boolean }> = {}) => ({ key: k, ctrl: false, alt: false, meta: false, shift: false, ...o })
  const fresh = beginTyping('c1', 'New text')
  assert.equal(spaceLeaves(fresh, key(' ')), true)
  // A letter or a digit takes the words' place as before.
  assert.equal(spaceLeaves(fresh, key('a')), false)
  assert.equal(spaceLeaves(fresh, key('7')), false)
  // With a modifier: not the plain Space.
  assert.equal(spaceLeaves(fresh, key(' ', { shift: true })), false)
  assert.equal(spaceLeaves(fresh, key(' ', { ctrl: true })), false)
  // Something typed, or the caret alone: Space is a blank in the words.
  assert.equal(spaceLeaves(fieldChanged(fresh, 'N', 1, 1, false), key(' ')), false)
  assert.equal(spaceLeaves(beginTyping('c1', 'New text', 'end'), key(' ')), false)
  assert.equal(spaceLeaves(caretTo(fresh, 3, false), key(' ')), false)
  // Selected backwards, all of it: the same.
  assert.equal(spaceLeaves(fieldChanged(fresh, 'New text', 0, 8, true), key(' ')), true)
})

test('the caret by click, by word, by line: Shift runs the selection', () => {
  const text = 'The cat sat by the window'
  const l = layoutText(spec(text), measure)
  let s = beginTyping('c1', text, 5)
  s = caretVertical(s, l, 1, false)
  assert.equal(s.focus, 14)
  s = caretVertical(s, l, 1, true)
  assert.deepEqual(fieldSelection(s), [14, 21, 'forward'])
  // The run keeps its x; a click ends the run.
  assert.equal(s.wantX, -5)
  s = caretTo(s, 2, false)
  assert.equal(s.wantX, null)
  assert.deepEqual(fieldSelection(caretTo(s, 9, true)), [2, 9, 'forward'])
  assert.deepEqual(fieldSelection(caretTo(caretTo(s, 9, false), 2, true)), [2, 9, 'backward'])
  assert.deepEqual(fieldSelection(selectWord(s, 5)), [4, 7, 'forward'])
  assert.deepEqual(fieldSelection(caretToEdge(caretTo(s, 14, false), l, 'end', true)), [14, 18, 'forward'])
  assert.deepEqual(fieldSelection(caretToEdge(caretTo(s, 14, false), l, 'start', false)), [12, 12, 'forward'])
  // The field says its selection runs backward: the caret is at its start.
  assert.equal(fieldChanged(s, text, 2, 6, true).focus, 2)
})

// ---- the quick bar's place ------------------------------------------------------

test('the quick bar: over the title; under it near the top; inside the picture; never on the title when a side has room', () => {
  // A preview 700 × 290 with the picture 500 wide in its middle (1366 × 768).
  const size = { cw: 700, ch: 290 }
  const frame = { l: 100, t: 0, r: 600, b: 290 }
  const bar = { w: 464, h: 36 }
  // A title in the middle: the bar over it and its knob.
  const mid = barPlace({ l: 250, t: 130, r: 450, b: 170 }, 100, bar, frame, size)
  assert.deepEqual([mid.side, mid.top], ['above', 100 - 9 - 10 - 36])
  assert.ok(mid.left >= frame.l && mid.left + bar.w <= frame.r, 'inside the picture')
  // Near the top: under it, clear of its lower side.
  const top = barPlace({ l: 250, t: 20, r: 450, b: 60 }, 84, bar, frame, size)
  assert.equal(top.side, 'below')
  assert.ok(top.top >= 84 + 9 + 10 && top.top + bar.h <= frame.b, `under the title and its knob (${top.top})`)
  // At the picture's left side: kept inside the picture, not centred on the title.
  const left = barPlace({ l: 90, t: 130, r: 190, b: 170 }, 100, bar, frame, size)
  assert.equal(left.left, frame.l + 4)
  // A picture too narrow for the bar (a portrait frame): inside the preview.
  const narrow = barPlace({ l: 300, t: 130, r: 400, b: 170 }, 100, bar, { l: 268, t: 0, r: 432, b: 290 }, size)
  assert.ok(narrow.left >= 4 && narrow.left + bar.w <= size.cw - 4)
  // As tall as the picture: no side has room; inside, against the inner edge
  // it lies less on the title at (cila4, 3).
  // (At the top the bar lies on 10 px of the title, at the bottom on 20.)
  const tall = barPlace({ l: 250, t: 30, r: 450, b: 270 }, 6, bar, frame, size)
  assert.deepEqual([tall.side, tall.top], ['inside', 4])
  const low = barPlace({ l: 250, t: 10, r: 450, b: 240 }, 264, bar, frame, size)
  assert.deepEqual([low.side, low.top], ['inside', 290 - 4 - 36])
})

test('the quick bar on a title that nearly fills the picture (cila4, 3): inside, at the edge it covers least, the top when even', () => {
  const size = { cw: 700, ch: 290 }
  const frame = { l: 100, t: 0, r: 600, b: 290 }
  const bar = { w: 464, h: 36 }
  // The whole picture: even, so the top inner edge.
  const full = barPlace({ l: 110, t: 0, r: 590, b: 290 }, 145, bar, frame, size)
  assert.deepEqual([full.side, full.top], ['inside', 4])
  // Nearly the whole picture, a little lower: still no room either side; the top has less of it.
  const lower = barPlace({ l: 110, t: 20, r: 590, b: 288 }, 154, bar, frame, size)
  assert.deepEqual([lower.side, lower.top], ['inside', 4])
  // A little higher: the bottom inner edge has less of it.
  const higher = barPlace({ l: 110, t: 2, r: 590, b: 268 }, 135, bar, frame, size)
  assert.deepEqual([higher.side, higher.top], ['inside', 290 - 4 - 36])
  // Inside the picture, in both cases.
  for (const at of [full, lower, higher]) assert.ok(at.top >= frame.t && at.top + bar.h <= frame.b && at.left >= frame.l && at.left + bar.w <= frame.r)
  // With room on a side it never goes inside.
  assert.notEqual(barPlace({ l: 250, t: 130, r: 450, b: 170 }, 100, bar, frame, size).side, 'inside')
})
