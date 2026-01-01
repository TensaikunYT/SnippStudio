// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// The ideas from VideoHub's review page (ONIZLEME-UYGULA-PLAN.md): the time
// you type (parseTime), the frame step, the play speed, the preview's zoom,
// the new keys (no clash, in any set, on any platform; a Turkish keyboard's
// AltGr and Shift), going from note to note and the merged note marks.
import assert from 'node:assert/strict'
import test from 'node:test'
import { frameOf, parseTime, stepFrame } from '../renderer/src/ui/timecode'
import { PLAY_RATES, cleanRate, stepRate } from '../renderer/src/playback/play-rate'
import { ZOOM_MAX, ZOOM_MIN, clampZoom, oneToOneZoom, zoomAround } from '../renderer/src/components/preview/zoom'
import { ACTIONS, actionsOf, defaultBindings, eventToBinding, type BindingPress } from '../renderer/src/shortcuts'
import { PRESETS, RESERVED_KEYS, bindingClashes, presetBindings } from '../renderer/src/shortcuts-presets'
import { groupNotes, markTarget, neighbourNote, notesInOrder } from '../renderer/src/notes/nav'
import { STRINGS } from '../renderer/src/ui/strings'

const near = (a: number | null, b: number, eps = 1e-9): boolean => a !== null && Math.abs(a - b) <= eps

test('parseTime: minutes and seconds, hours, plain seconds with a point or a comma', () => {
  assert.ok(near(parseTime('1:23.45', 100), 83.45))
  assert.ok(near(parseTime('1:23,45', 100), 83.45))
  assert.ok(near(parseTime('0:05', 30), 5))
  assert.ok(near(parseTime('1:02:03.5', 10), 3723.5))
  assert.ok(near(parseTime('83.4', 10), 83.4))
  assert.ok(near(parseTime('83,4', 10), 83.4))
  assert.ok(near(parseTime(' 12 ', 30), 12))
  assert.ok(near(parseTime('12s', 30), 12))
  assert.ok(near(parseTime('.5', 30), 0.5))
  // Snapped to the start of the frame the time is in.
  assert.ok(near(parseTime('1.01', 30), 1))
  assert.equal(parseTime('1:60', 30), null)
  assert.equal(parseTime('1:61:00', 30), null)
})

test('parseTime: frames, relative seconds and frames, nonsense', () => {
  assert.ok(near(parseTime('k1234', 30), 1234 / 30))
  assert.ok(near(parseTime('K90', 30), 3))
  assert.ok(near(parseTime('f60', 30), 2))
  assert.ok(near(parseTime('#15', 30), 0.5))
  assert.ok(near(parseTime('+2', 30, 10), 12))
  assert.ok(near(parseTime('-0,5', 30, 10), 9.5))
  assert.ok(near(parseTime('+10f', 30, 1), 40 / 30))
  assert.ok(near(parseTime('-3k', 30, 1), 27 / 30))
  assert.equal(parseTime('-20', 30, 5), 0, 'never before the start')
  assert.equal(parseTime('-90f', 30, 1), 0)
  assert.equal(parseTime('+1.5f', 30, 1), null, 'a part of a frame is no frame')
  for (const bad of ['', 'abc', '1:2:3:4', 'k', '++2', '1..2', '12m']) assert.equal(parseTime(bad, 30), null, bad)
  // A missing or bad fps does not make every time NaN.
  assert.ok(near(parseTime('k30', 0), 1))
})

test('stepFrame: on the frame grid, from the frame shown', () => {
  assert.ok(near(stepFrame(1, 30, 1), 31 / 30))
  assert.ok(near(stepFrame(1, 30, -1), 29 / 30))
  assert.ok(near(stepFrame(1.01, 30, 1), 31 / 30), 'a playhead between frames lands on the grid')
  assert.equal(stepFrame(0, 30, -1), 0)
  // Thirty steps of a frame are one second, to the bit.
  let t = 0
  for (let i = 0; i < 30; i++) t = stepFrame(t, 30, 1)
  assert.equal(t, 1)
  assert.equal(frameOf(0.1 * 3, 10), 3)
})

test('play speed: the list, a step each way, kept in the list', () => {
  assert.deepEqual([...PLAY_RATES], [0.25, 0.5, 0.75, 1, 1.5, 2])
  assert.equal(stepRate(1, 1), 1.5)
  assert.equal(stepRate(1, -1), 0.75)
  assert.equal(stepRate(2, 1), 2)
  assert.equal(stepRate(0.25, -1), 0.25)
  assert.equal(stepRate(3, 1), 1.5, 'an unknown rate steps from 1')
  assert.equal(cleanRate('0.5'), 0.5)
  assert.equal(cleanRate(7), 1)
})

test('preview zoom: limits, around a point, one pixel per pixel', () => {
  assert.equal(clampZoom(100), ZOOM_MAX)
  assert.equal(clampZoom(0), ZOOM_MIN)
  assert.equal(clampZoom(Number.NaN), 1)
  // The point under the pointer stays where it is.
  const pv = { zoom: 1, x: 0, y: 0 }
  const z = zoomAround(pv, 2, 300, 100, 800, 450)
  const k0 = Math.min(800 / 1920, 450 / 1080)
  const world = (v: typeof pv, sx: number): number => (sx - 400 - v.x) / (k0 * v.zoom)
  assert.ok(Math.abs(world(pv, 300) - world(z, 300)) < 1e-9)
  // 1920×1080 in 960×540 CSS px: 2 at dpr 1, 1 at dpr 2.
  assert.equal(oneToOneZoom(960, 540, 1920, 1080, 1), 2)
  assert.equal(oneToOneZoom(960, 540, 1920, 1080, 2), 1)
  // 4K in a small preview needs more than the old limit of 6.
  assert.ok(oneToOneZoom(600, 400, 3840, 2160, 1) > 6)
})

const press = (key: string, m: Partial<BindingPress> = {}): BindingPress => ({ key, ctrlKey: false, metaKey: false, shiftKey: false, altKey: false, ...m })

test('a binding from a key press: punctuation is itself whatever it took to type (Turkish Q: AltGr, Shift)', () => {
  assert.equal(eventToBinding(press('?', { shiftKey: true })), '?')
  assert.equal(eventToBinding(press('[', { ctrlKey: true, altKey: true })), '[', 'AltGr+8 on a Turkish keyboard')
  assert.equal(eventToBinding(press(']', { ctrlKey: true, altKey: true, getModifierState: (k) => k === 'AltGraph' })), ']')
  assert.equal(eventToBinding(press(',', { ctrlKey: true })), 'ctrl+,', 'Ctrl+, stays the settings')
  assert.equal(eventToBinding(press(',', { altKey: true })), 'alt+,', 'Alt+, stays the keyframe key')
  assert.equal(eventToBinding(press('C', { shiftKey: true })), 'shift+c', 'a letter keeps its Shift')
  assert.equal(eventToBinding(press('1')), '1')
  assert.equal(eventToBinding(press('ArrowLeft', { shiftKey: true })), 'shift+arrowleft')
  assert.equal(eventToBinding(press(' ', { code: 'Space' })), 'space')
  assert.equal(eventToBinding(press('AltGraph', { ctrlKey: true, altKey: true })), '')
})

test('the new keys: each its own, in every set on every platform; the review keys only in a review', () => {
  const d = defaultBindings()
  assert.deepEqual(
    ['goToTime', 'slower', 'faster', 'previewActual', 'previewFit', 'prevNote', 'nextNote', 'narration', 'shortcutList', 'reviewBefore', 'reviewApprove'].map((id) => d[id as keyof typeof d]),
    ['g', '[', ']', '1', '0', ',', '.', 'shift+c', '?', 'b', 'y']
  )
  for (const p of PRESETS) for (const pl of ['win32', 'darwin', 'linux'] as const) assert.deepEqual(bindingClashes(presetBindings(p.id, pl)), [], `${p.id} on ${pl}`)
  // The review's B and Y are the split and slip tools' keys outside it.
  assert.deepEqual(actionsOf('review').map((a) => a.id), ['reviewBefore', 'reviewApprove'])
  assert.equal(d.splitTool, 'b')
  assert.equal(d.slipTool, 'y')
  // Two review keys on one key, or a global one on the review's, is caught.
  assert.ok(bindingClashes({ ...d, reviewApprove: 'b' }).some((x) => /reviewBefore and reviewApprove/.test(x)))
  assert.ok(bindingClashes({ ...d, goToTime: 's' }).some((x) => /goToTime/.test(x)))
  for (const a of ACTIONS) assert.equal(RESERVED_KEYS.includes(d[a.id]), false, a.id)
  // Every new action is named in both languages.
  for (const a of ACTIONS) if (a.labelKey) assert.ok((STRINGS[a.labelKey] as { tr?: string }).tr, a.id)
})

const note = (id: string, num: number, start: number, end = start, at?: number) => ({ id, num, start, end, ...(at !== undefined ? { at } : {}) })

test('going from note to note: by time, the picked one counts as here', () => {
  const ns = [note('c', 3, 5), note('a', 1, 1), note('b', 2, 3, 4, 3.5), note('d', 4, 5)]
  assert.deepEqual(notesInOrder(ns).map((n) => n.id), ['a', 'b', 'c', 'd'])
  assert.equal(neighbourNote(ns, 0, 1)?.id, 'a')
  assert.equal(neighbourNote(ns, 1, 1)?.id, 'b')
  assert.equal(neighbourNote(ns, 3.2, 1)?.id, 'b', 'its drawing frame (3.5) is where it is looked at')
  assert.equal(neighbourNote(ns, 3.5, -1)?.id, 'a')
  assert.equal(neighbourNote(ns, 5, 1, 'c')?.id, 'd', 'two notes at one moment: the next press goes past the picked one')
  assert.equal(neighbourNote(ns, 5, -1, 'd')?.id, 'c')
  assert.equal(neighbourNote(ns, 9, 1), null)
  assert.equal(neighbourNote([], 0, -1), null)
})

test('note marks: close pins merge, ranges stay their own, a click goes round the mark', () => {
  const ns = [note('a', 1, 1), note('b', 2, 1.05), note('c', 3, 1.1), note('d', 4, 3), note('r', 5, 1.02, 2)]
  // 100 px a second: a, b, c are 5 px apart, r is 98 px wide, d far.
  const marks = groupNotes(ns, 100)
  assert.equal(marks.length, 3)
  const ids = marks.map((m) => m.notes.map((n) => n.id).join(''))
  assert.ok(ids.includes('abc'))
  assert.ok(ids.includes('r'))
  assert.ok(ids.includes('d'))
  // Zoomed in (1000 px a second) they are apart.
  assert.equal(groupNotes(ns, 1000).length, 5)
  const m = marks.find((x) => x.notes.length === 3)!
  assert.equal(markTarget(m, null).id, 'a')
  assert.equal(markTarget(m, 'a').id, 'b')
  assert.equal(markTarget(m, 'c').id, 'a', 'round')
  assert.equal(markTarget(m, 'd').id, 'a', 'a note picked elsewhere: the first')
})
