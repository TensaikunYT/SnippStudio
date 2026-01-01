// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// Cila O, K3: "Fit to voice" plans the picked pictures three ways (by
// subtitle numbers, evenly over the voice, evenly over the selected range)
// and lays them on a new layer in one undo step.
import './dom-stub'
import assert from 'node:assert/strict'
import test from 'node:test'
import { defaultFitMode, FIT_MIN_SECONDS, planFitVoice, selectedSpan, voiceSpan } from '../renderer/src/subtitles/fit-voice'
import { defaultProject, type Asset, type Caption, type Project } from '../renderer/src/types'

const caption = (id: string, start: number, end: number, text: string): Caption => ({ id, start, end, text })
const picture = (id: string, name: string, patch: Partial<Asset> = {}): Asset => ({
  id, name, kind: 'image', url: `media://${id}`, size: 1, duration: 0, width: 1920, height: 1080, hasAudio: false, ...patch
})
const noMarks = { in: null, out: null }

/** Four subtitle lines (0.5–2, 2.5–4, 5–6, 6.5–9) and pictures 1, 2, 4, "cover", 9. */
function project(): Project {
  const p = defaultProject()
  p.assets = [
    picture('p4', '4.png'),
    picture('p1', '01.jpg'),
    picture('p2', 'image_2.png'),
    picture('cover', 'cover.png'),
    picture('p9', '9.png'),
    picture('gone', '3.png', { missing: true }),
    { ...picture('talk', 'talk.mp4'), kind: 'video', duration: 12 }
  ]
  p.captions = [caption('a', 0.5, 2, 'One.'), caption('b', 2.5, 4, 'Two.'), caption('c', 5, 6, 'Three.'), caption('d', 6.5, 9, 'Four.')]
  return p
}
const round = (x: number): number => Math.round(x * 1000) / 1000

test('by numbers: picture n on line n, held until the next line, a gap is an empty slot, the rest is left out and counted', () => {
  const p = project()
  const plan = planFitVoice(p, ['p4', 'p1', 'cover', 'p9', 'talk', 'gone'], 'numbers', null)
  assert.equal(plan.blocked, null)
  // 1 → line 1 from 0 (the leading silence too) to line 2; 4 → line 4 to its end.
  assert.deepEqual(plan.placements.map((x) => [x.assetId, x.start, x.end, x.captionIds.join()]), [
    ['p1', 0, 2.5, 'a'],
    ['p4', 6.5, 9, 'd']
  ])
  // Lines 2 and 3 have no picked picture: the timeline's "picture #n missing" slots.
  assert.deepEqual(plan.missingSlots.map((x) => [x.number, x.start, x.end]), [[2, 2.5, 5], [3, 5, 6.5]])
  // "cover" has no number, 9 is past the last line (the video and the missing file are not pictures here).
  assert.equal(plan.skipped, 2)
  assert.deepEqual(plan.span, [0, 9])
})

test('by numbers: a number two pictures share goes to the first in name order; no gap before the first number picked', () => {
  const p = project()
  p.assets.push(picture('p2b', '2-alt.png'))
  const plan = planFitVoice(p, ['p2', 'p2b'], 'numbers', null)
  assert.deepEqual(plan.placements.map((x) => [x.assetId, x.start, x.end]), [['p2b', 2.5, 4]])
  assert.equal(plan.missingSlots.length, 0, 'line 1 is not an empty slot: it is before the first number picked')
  assert.equal(plan.skipped, 1)
})

test('by numbers: closed without subtitles, or without a number that fits a line', () => {
  const p = project()
  assert.equal(planFitVoice(p, ['cover', 'p9'], 'numbers', null).blocked, 'noNumbers')
  p.captions = []
  assert.equal(planFitVoice(p, ['p1'], 'numbers', null).blocked, 'noSubtitles')
  assert.equal(planFitVoice(p, [], 'numbers', null).blocked, 'noPictures')
})

test('evenly: the pictures in name order, in equal parts from 0 to the end of the last line, end to end', () => {
  const p = project()
  assert.deepEqual(voiceSpan(p), [0, 9])
  const plan = planFitVoice(p, ['p4', 'cover', 'p1'], 'even', null)
  assert.equal(plan.blocked, null)
  assert.deepEqual(plan.placements.map((x) => x.assetId), ['p1', 'p4', 'cover'], 'natural name order: 01, 4, cover')
  assert.deepEqual(plan.placements.map((x) => [round(x.start), round(x.end)]), [[0, 3], [3, 6], [6, 9]])
  for (let i = 1; i < plan.placements.length; i++) assert.equal(plan.placements[i].start, plan.placements[i - 1].end, 'no gap, no overlap')
  assert.equal(plan.placements[2].end, 9)
})

test('evenly: without subtitles, the voice is the span of the sound tracks’ clips; without either, closed', () => {
  const p = project()
  p.captions = []
  assert.equal(planFitVoice(p, ['p1'], 'even', null).blocked, 'noVoice')
  const track = { id: 'a1', kind: 'audio' as const, name: 'A1', clipIds: ['v1', 'v2', 'off'] }
  p.tracks.push(track)
  const clip = (id: string, start: number, duration: number, disabled?: boolean) => ({ id, assetId: 'talk', trackId: 'a1', start, inPoint: 0, duration, transform: { x: 0, y: 0, scale: 1, rotation: 0 }, volume: 1, ...(disabled ? { disabled } : {}) })
  p.clips.v1 = clip('v1', 2, 3)
  p.clips.v2 = clip('v2', 6, 4)
  p.clips.off = clip('off', 20, 5, true)
  assert.deepEqual(voiceSpan(p), [2, 10], 'a switched-off clip is not heard')
  const plan = planFitVoice(p, ['p1', 'p2'], 'even', null)
  assert.deepEqual(plan.placements.map((x) => [x.start, x.end]), [[2, 6], [6, 10]])
})

test('into the range: in and out points first, then the loop, two cut marks, the selected clips', () => {
  const p = project()
  p.tracks[0].clipIds.push('k')
  p.clips.k = { id: 'k', assetId: 'talk', trackId: p.tracks[0].id, start: 1, inPoint: 0, duration: 7, transform: { x: 0, y: 0, scale: 1, rotation: 0 }, volume: 1 }
  const ui = { marks: noMarks, loopRange: null as [number, number] | null, cutMarks: [] as number[], selectedClipIds: [] as string[] }
  assert.equal(selectedSpan(p, ui), null)
  assert.equal(planFitVoice(p, ['p1'], 'range', selectedSpan(p, ui)).blocked, 'noRange')
  assert.deepEqual(selectedSpan(p, { ...ui, selectedClipIds: ['k'] }), [1, 8])
  assert.deepEqual(selectedSpan(p, { ...ui, selectedClipIds: ['k'], cutMarks: [5, 3, 4] }), [3, 5])
  assert.deepEqual(selectedSpan(p, { ...ui, selectedClipIds: ['k'], cutMarks: [5, 3], loopRange: [2, 6] }), [2, 6])
  assert.deepEqual(selectedSpan(p, { ...ui, selectedClipIds: ['k'], cutMarks: [5, 3], loopRange: [2, 6], marks: { in: 4, out: 7 } }), [4, 7])
  const plan = planFitVoice(p, ['p2', 'p1'], 'range', [4, 7])
  assert.deepEqual(plan.placements.map((x) => [x.assetId, x.start, x.end]), [['p1', 4, 5.5], ['p2', 5.5, 7]])
})

test('a picture shorter than a tenth of a second is refused, not placed', () => {
  const p = project()
  const many = Array.from({ length: 12 }, (_, i) => picture(`m${i}`, `m${i}.png`))
  p.assets.push(...many)
  const plan = planFitVoice(p, many.map((a) => a.id), 'range', [0, 1])
  assert.ok(1 / 12 < FIT_MIN_SECONDS)
  assert.equal(plan.blocked, 'tooShort')
  assert.equal(plan.placements.length, 0)
})

test('the window opens on numbers when there are subtitles and a numbered picture, else evenly', () => {
  const p = project()
  assert.equal(defaultFitMode(p, ['cover', 'p4']), 'numbers')
  assert.equal(defaultFitMode(p, ['cover']), 'even')
  p.captions = []
  assert.equal(defaultFitMode(p, ['p4']), 'even')
})

test('each way lands on a new AUTO layer in one undo step, and Undo gives the project back', async () => {
  const { useStore } = await import('../renderer/src/state/store')
  for (const mode of ['numbers', 'even', 'range'] as const) {
    const p = project()
    useStore.getState().loadProject(p)
    const before = JSON.stringify(useStore.getState().project)
    const depth = useStore.getState().past.length
    const plan = planFitVoice(useStore.getState().project, ['p1', 'p2', 'p4'], mode, [1, 7])
    assert.equal(plan.blocked, null, mode)
    const placed = useStore.getState().placeAutomationImages(plan.placements, 'new', { missingSlots: plan.missingSlots })
    assert.ok(placed, mode)
    const s = useStore.getState()
    assert.equal(s.past.length - depth, 1, `${mode}: one undo step`)
    const track = s.project.tracks.find((t) => t.id === placed.trackId)!
    assert.equal(track.name, 'AUTO')
    assert.equal(s.project.tracks[0].id, track.id, 'the new layer is on top')
    assert.equal(track.clipIds.length, plan.placements.length + plan.missingSlots.length, mode)
    // Nothing else moved: the other tracks are as they were.
    assert.equal(s.project.tracks.length, p.tracks.length + 1)
    s.undo()
    assert.equal(JSON.stringify(useStore.getState().project), before, `${mode}: undone`)
  }
})
