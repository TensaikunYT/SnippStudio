// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
import assert from 'node:assert/strict'
import test from 'node:test'
import {
  automationImageAssets,
  automationImageSequenceNumber,
  buildCustomSubtitleImageSpans,
  buildSubtitleImageSpans,
  planNumberedSubtitleImageAutomation,
  planSubtitleImageAutomation,
  validAutomationSubtitleCues
} from '../renderer/src/subtitles/automation'
import { defaultProject, type Asset, type Caption } from '../renderer/src/types'

const caption = (id: string, start: number, end: number, text: string, patch: Partial<Caption> = {}): Caption => ({
  id,
  start,
  end,
  text,
  ...patch
})

const asset = (id: string, name: string, patch: Partial<Asset> = {}): Asset => ({
  id,
  name,
  kind: 'image',
  url: `media://${id}`,
  size: 1,
  duration: 0,
  width: 1920,
  height: 1080,
  hasAudio: false,
  ...patch
})

test('valid automation cues keep only non-empty, finite, positive subtitle intervals', () => {
  const cues = validAutomationSubtitleCues([
    caption('late', 3, 4, 'later'),
    caption('manual', 0, 1, 'title', { manual: true }),
    caption('layer', 0, 1, 'overlay', { layer: 1 }),
    caption('shape', 0, 1, '', { shape: { kind: 'rect', w: 0.2, h: 0.2 } }),
    caption('blank', 0, 1, '   '),
    caption('negative', -1, 1, 'bad'),
    caption('backwards', 2, 1, 'bad'),
    caption('nan', Number.NaN, 1, 'bad'),
    caption('first', 1, 2, 'first')
  ])

  assert.deepEqual(cues.map((cue) => cue.id), ['first', 'late'])
})

test('image assets exclude non-images and missing files, then sort names naturally', () => {
  const images = automationImageAssets([
    asset('ten', '10.png'),
    asset('video', '0.mp4', { kind: 'video', duration: 3 }),
    asset('two', '2.png'),
    asset('missing', '1.png', { missing: true }),
    asset('one', '1.jpg')
  ])

  assert.deepEqual(images.map((image) => image.id), ['one', 'two', 'ten'])
})

test('alternative sequence numbers accept padded and prefixed filenames', () => {
  assert.equal(automationImageSequenceNumber('003.png'), 3)
  assert.equal(automationImageSequenceNumber('scene_42_final.webp'), 42)
  assert.equal(automationImageSequenceNumber('cover.png'), null)
})

test('cue grouping returns one span per valid cue in timeline order', () => {
  const spans = buildSubtitleImageSpans(
    [caption('b', 2, 3, 'Second.'), caption('a', 0, 1, 'First.')],
    'cue'
  )

  assert.deepEqual(spans, [
    { captionIds: ['a'], text: 'First.', start: 0, end: 1 },
    { captionIds: ['b'], text: 'Second.', start: 2, end: 3 }
  ])
})

test('sentence grouping joins cues through terminal punctuation and keeps an open tail', () => {
  const spans = buildSubtitleImageSpans(
    [
      caption('a', 0.2, 0.8, 'A sentence split'),
      caption('b', 0.9, 1.4, 'across cues."'),
      caption('c', 1.8, 2.1, 'Really?!]'),
      caption('d', 2.4, 2.8, 'An unfinished'),
      caption('e', 3, 3.5, 'tail')
    ],
    'sentence'
  )

  assert.deepEqual(spans, [
    {
      captionIds: ['a', 'b'],
      text: 'A sentence split across cues."',
      start: 0.2,
      end: 1.4
    },
    { captionIds: ['c'], text: 'Really?!]', start: 1.8, end: 2.1 },
    {
      captionIds: ['d', 'e'],
      text: 'An unfinished tail',
      start: 2.4,
      end: 3.5
    }
  ])
})

test('sentence grouping recognises a unicode ellipsis before a closing quote', () => {
  const spans = buildSubtitleImageSpans(
    [caption('a', 0, 1, 'Wait for it…”'), caption('b', 1.2, 2, 'No punctuation')],
    'sentence'
  )

  assert.deepEqual(spans.map((span) => span.captionIds), [['a'], ['b']])
})

test('custom grouping follows manual boundaries and uses draft subtitle text', () => {
  const captions = [
    caption('a', 0, 1, 'First'),
    caption('b', 1, 2, 'draft'),
    caption('c', 2, 3, 'Second group.')
  ]
  const spans = buildCustomSubtitleImageSpans(captions, new Set(['a', 'c']), { b: 'sentence.' })

  assert.deepEqual(spans, [
    { captionIds: ['a', 'b'], text: 'First sentence.', start: 0, end: 2 },
    { captionIds: ['c'], text: 'Second group.', start: 2, end: 3 }
  ])
})

test('custom plans use explicit groups instead of punctuation detection', () => {
  const captions = [caption('a', 0, 1, 'One.'), caption('b', 1, 2, 'Two.')]
  const customSpans = buildCustomSubtitleImageSpans(captions, new Set(['a']))
  const result = planSubtitleImageAutomation(captions, [asset('image', '1.png')], {
    grouping: 'custom',
    customSpans
  })

  assert.equal(result.mismatch, null)
  assert.equal(result.placements.length, 1)
  assert.deepEqual(result.placements[0].captionIds, ['a', 'b'])
})

test('exact timing pairs naturally sorted images with unchanged subtitle bounds', () => {
  const result = planSubtitleImageAutomation(
    [caption('a', 0.4, 1.2, 'One.'), caption('b', 2, 2.7, 'Two.')],
    [asset('second', '2.png'), asset('first', '1.png')],
    { grouping: 'cue', timing: 'exact', continuousStartAtZero: true }
  )

  assert.equal(result.mismatch, null)
  assert.deepEqual(
    result.placements.map(({ assetId, captionIds, start, end }) => ({ assetId, captionIds, start, end })),
    [
      { assetId: 'first', captionIds: ['a'], start: 0.4, end: 1.2 },
      { assetId: 'second', captionIds: ['b'], start: 2, end: 2.7 }
    ]
  )
  assert.ok(Math.abs(result.placements[0].duration - 0.8) < 1e-12)
  assert.ok(Math.abs(result.placements[1].duration - 0.7) < 1e-12)
})

test('continuous timing can cover leading silence and holds each non-final image to the next start', () => {
  const result = planSubtitleImageAutomation(
    [caption('a', 0.5, 1, 'One.'), caption('b', 2, 2.6, 'Two.'), caption('c', 4, 5, 'Three.')],
    [asset('a1', '1.png'), asset('a2', '2.png'), asset('a3', '3.png')],
    { timing: 'continuous', continuousStartAtZero: true }
  )

  assert.deepEqual(
    result.placements.map(({ start, end, duration }) => ({ start, end, duration })),
    [
      { start: 0, end: 2, duration: 2 },
      { start: 2, end: 4, duration: 2 },
      { start: 4, end: 5, duration: 1 }
    ]
  )
})

test('continuous timing does not move the first image to zero unless requested', () => {
  const result = planSubtitleImageAutomation(
    [caption('a', 0.5, 1, 'One.'), caption('b', 2, 3, 'Two.')],
    [asset('a1', '1.png'), asset('a2', '2.png')],
    { timing: 'continuous' }
  )

  assert.deepEqual(result.placements.map(({ start, end }) => ({ start, end })), [
    { start: 0.5, end: 2 },
    { start: 2, end: 3 }
  ])
})

test('count mismatch is all-or-none and reports grouped span and usable image counts', () => {
  const result = planSubtitleImageAutomation(
    [caption('a', 0, 1, 'First half'), caption('b', 1, 2, 'finishes.'), caption('c', 3, 4, 'Second.')],
    [asset('only', '1.png')],
    { grouping: 'sentence', timing: 'exact' }
  )

  assert.equal(result.cueCount, 3)
  assert.equal(result.spanCount, 2)
  assert.equal(result.imageCount, 1)
  assert.deepEqual(result.mismatch, { spanCount: 2, imageCount: 1 })
  assert.deepEqual(result.placements, [])
})

test('numbered alternative plans reserve missing numbers without shifting later images', () => {
  const captions = [
    caption('a', 0.5, 1, 'One.'),
    caption('b', 2, 2.5, 'Two.'),
    caption('c', 4, 5, 'Three.')
  ]
  const spans = buildSubtitleImageSpans(captions, 'cue')
  const result = planNumberedSubtitleImageAutomation(
    captions,
    spans,
    [
      { number: 1, asset: asset('one', '1.png') },
      { number: 3, asset: asset('three', '3.png') }
    ],
    { timing: 'continuous', continuousStartAtZero: true }
  )

  assert.equal(result.mismatch, null)
  assert.deepEqual(
    result.placements.map(({ assetId, captionIds, start, end }) => ({ assetId, captionIds, start, end })),
    [
      { assetId: 'one', captionIds: ['a'], start: 0, end: 2 },
      { assetId: 'three', captionIds: ['c'], start: 4, end: 5 }
    ]
  )
  assert.deepEqual(
    result.missingSlots.map(({ number, captionIds, start, end, duration }) =>
      ({ number, captionIds, start, end, duration })),
    [{ number: 2, captionIds: ['b'], start: 2, end: 4, duration: 2 }]
  )
})

test('automation creates a persistent missing-image clip that can be filled without shifting its neighbours', async () => {
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: { getItem: () => null, setItem: () => {} }
  })
  Object.defineProperty(globalThis, 'document', {
    configurable: true,
    value: { createElement: () => ({}) }
  })
  const { useStore } = await import('../renderer/src/state/store')
  const project = defaultProject()
  project.assets = [asset('one', '1.png'), asset('three', '3.png')]
  project.captions = [
    caption('a', 0.5, 1, 'One.'),
    caption('b', 2, 2.5, 'Two.'),
    caption('c', 4, 5, 'Three.')
  ]
  useStore.getState().loadProject(project)
  const plan = planNumberedSubtitleImageAutomation(
    project.captions,
    buildSubtitleImageSpans(project.captions, 'cue'),
    [{ number: 1, asset: project.assets[0] }, { number: 3, asset: project.assets[1] }],
    { timing: 'continuous', continuousStartAtZero: true }
  )
  const placed = useStore.getState().placeAutomationImages(plan.placements, 'new', {
    missingSlots: plan.missingSlots
  })
  assert.ok(placed)
  const state = useStore.getState().project
  const track = state.tracks.find((candidate) => candidate.id === placed.trackId)!
  const clips = track.clipIds.map((id) => state.clips[id])
  assert.deepEqual(clips.map(({ start, duration }) => ({ start, duration })), [
    { start: 0, duration: 2 },
    { start: 2, duration: 2 },
    { start: 4, duration: 1 }
  ])
  const missing = clips[1]
  assert.equal(missing.assetId, '')
  assert.equal(missing.automationMissing?.number, 2)
  assert.equal(missing.automationMissing?.text, 'Two.')

  assert.equal(useStore.getState().fillAutomationMissingImage(missing.id, asset('two', '2.png')), true)
  const filled = useStore.getState().project.clips[missing.id]
  assert.equal(filled.assetId, 'two')
  assert.equal(filled.automationMissing, undefined)
  assert.equal(filled.start, 2)
  assert.equal(filled.duration, 2)
  assert.equal(useStore.getState().project.clips[clips[2].id].start, 4)
  useStore.getState().undo()
  assert.equal(useStore.getState().project.clips[missing.id].automationMissing?.number, 2)
})

test('numbered automation can reserve every image slot before any still is imported', async () => {
  const { useStore } = await import('../renderer/src/state/store')
  const project = defaultProject()
  project.captions = [caption('a', 0, 1, 'One.'), caption('b', 1, 2, 'Two.')]
  useStore.getState().loadProject(project)
  const plan = planNumberedSubtitleImageAutomation(
    project.captions,
    buildSubtitleImageSpans(project.captions, 'cue'),
    [],
    { timing: 'exact' }
  )
  const placed = useStore.getState().placeAutomationImages(plan.placements, 'new', {
    missingSlots: plan.missingSlots
  })
  assert.ok(placed)
  assert.equal(placed.clipIds.length, 0)
  const result = useStore.getState().project
  assert.deepEqual(result.tracks[0].clipIds.map((id) => result.clips[id].automationMissing?.number), [1, 2])
})
