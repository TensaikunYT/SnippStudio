// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
import assert from 'node:assert/strict'
import test from 'node:test'
import { automationGainAt } from '../renderer/src/audio/envelope'
import { autoThresholdDb, keptPause, resolveSilenceSelection, silenceRangesFromDb } from '../renderer/src/audio/silence'
import { defaultProject, type Asset, type Clip } from '../renderer/src/types'

const asset = (id: string, kind: Asset['kind'], hasAudio: boolean): Asset => ({
  id, kind, hasAudio, name: id, url: `test://${id}`, size: 1, duration: 12, width: 0, height: 0
})
const clip = (id: string, trackId: string, assetId: string, linkId?: string): Clip => ({
  id, trackId, assetId, linkId, start: 0, duration: 10, inPoint: 0, volume: 1,
  transform: { x: 0, y: 0, scale: 1, rotation: 0 }
})

test('Ctrl+A analyses each audio clip, not the first audio or selected stills', () => {
  const project = defaultProject()
  const [video, audio] = project.tracks
  project.assets = [asset('voice1', 'audio', true), asset('voice2', 'audio', true), asset('still', 'image', false)]
  project.clips.a = clip('a', audio.id, 'voice1')
  project.clips.b = clip('b', audio.id, 'voice2')
  project.clips.image = clip('image', video.id, 'still')
  audio.clipIds = ['a', 'b']
  video.clipIds = ['image']

  const selection = resolveSilenceSelection(project, ['image', 'a', 'b'])!
  assert.deepEqual(selection.sources.map((source) => source.id), ['a', 'b'])
  assert.deepEqual(selection.targetsBySource, { a: ['a'], b: ['b'] })
})

test('an extracted-audio picture follows only its linked sound', () => {
  const project = defaultProject()
  const [video, audio] = project.tracks
  project.assets = [asset('movie', 'video', true), asset('sound', 'audio', true)]
  project.clips.picture = { ...clip('picture', video.id, 'movie', 'pair'), audioExtracted: true }
  project.clips.voice = clip('voice', audio.id, 'sound', 'pair')
  video.clipIds = ['picture']
  audio.clipIds = ['voice']

  for (const ids of [['picture'], ['picture', 'voice']]) {
    const selection = resolveSilenceSelection(project, ids)!
    assert.deepEqual(selection.sources.map((source) => source.id), ['voice'])
    assert.deepEqual(selection.targetsBySource.voice, ['voice', 'picture'])
  }
})

test('a previously cut linked picture finds its matching audio fragment', () => {
  const project = defaultProject()
  const [video, audio] = project.tracks
  project.assets = [asset('movie', 'video', true), asset('sound', 'audio', true)]
  project.clips.picture1 = { ...clip('picture1', video.id, 'movie', 'pair'), duration: 1, audioExtracted: true }
  project.clips.picture2 = { ...clip('picture2', video.id, 'movie', 'pair'), start: 2, duration: 1, audioExtracted: true }
  project.clips.voice1 = { ...clip('voice1', audio.id, 'sound', 'pair'), duration: 1 }
  project.clips.voice2 = { ...clip('voice2', audio.id, 'sound', 'pair'), start: 2, duration: 1 }
  video.clipIds = ['picture1', 'picture2']
  audio.clipIds = ['voice1', 'voice2']

  const selection = resolveSilenceSelection(project, ['picture2'])!
  assert.deepEqual(selection.sources.map((source) => source.id), ['voice2'])
  assert.deepEqual(selection.targetsBySource.voice2, ['voice2', 'picture2'])
})

test('muted and locked tracks cannot be selected as silence sources', () => {
  const project = defaultProject()
  const audio = project.tracks[1]
  project.assets = [asset('a', 'audio', true)]
  project.clips.a = clip('a', audio.id, 'a')
  audio.clipIds = ['a']
  audio.muted = true
  assert.equal(resolveSilenceSelection(project, ['a']), null)
  audio.muted = false
  audio.locked = true
  assert.equal(resolveSilenceSelection(project, ['a']), null)
})

test('balanced threshold detects a sustained room-tone gap only 8 dB below speech', () => {
  const dbs = [...Array(50).fill(-28), ...Array(10).fill(-36), ...Array(50).fill(-28)]
  assert.ok(autoThresholdDb(dbs, 'balanced') > -36)
  assert.ok(autoThresholdDb(dbs, 'less') < -36)
})

test('a short quiet noise blip does not split a long silent passage', () => {
  const dbs = [...Array(10).fill(-20), ...Array(8).fill(-40), -31,
    ...Array(8).fill(-40), ...Array(10).fill(-20)]
  const ranges = silenceRangesFromDb(dbs, -35, { minDuration: 0.5, pad: 0.08 })
  assert.equal(ranges.length, 1)
  assert.ok(ranges[0].start > 0.4 && ranges[0].end < 1.1)
  const voiced = [...Array(10).fill(-20), ...Array(8).fill(-40), -15,
    ...Array(8).fill(-40), ...Array(10).fill(-20)]
  assert.deepEqual(silenceRangesFromDb(voiced, -35, { minDuration: 0.5, pad: 0.08 }), [])
})

test('a pause between words keeps a natural length, a long one shrinks to a breath', () => {
  const W = 0.04
  const gapOf = (n: number): number[] => [...Array(10).fill(-20), ...Array(n).fill(-50), ...Array(10).fill(-20)]
  const left = (n: number, pace?: 'tight' | 'natural' | 'relaxed'): number => {
    const r = silenceRangesFromDb(gapOf(n), -35, { minDuration: 0.25, pad: 0.11, pace })
    return n * W - r.reduce((s, x) => s + x.end - x.start, 0)
  }
  // 0.4 s between words: most of it stays.
  assert.ok(left(10) > 0.24 && left(10) < 0.4)
  // A 2 s hesitation becomes a breath, not a butt-join.
  assert.ok(left(50) > 0.38 && left(50) < 0.5, String(left(50)))
  assert.ok(left(50, 'tight') < left(50) && left(50) < left(50, 'relaxed'))
  // Kept pause grows with the gap and never below both pads.
  assert.ok(keptPause(0.3, 0.11) <= keptPause(1, 0.11) && keptPause(1, 0.11) <= keptPause(3, 0.11))
  assert.ok(keptPause(3, 0.11) >= 0.22)
  // More of the pause is kept after the last word than before the next.
  const [r] = silenceRangesFromDb(gapOf(50), -35, { minDuration: 0.25, pad: 0.11 })
  assert.ok(r.start - 0.4 > 2.4 - r.end)
})

test('a noisy room still counts as quiet between words', () => {
  // Floor −60, room/breath −42, speech −18: a fixed margin over the floor
  // (−52) called the room "sound"; the share of the range doesn't.
  const dbs = [...Array(40).fill(-18), ...Array(6).fill(-60), ...Array(20).fill(-42), ...Array(40).fill(-18)]
  assert.ok(autoThresholdDb(dbs, 'balanced') > -42)
})

test('leading and trailing quiet goes down to a pad', () => {
  const dbs = [...Array(25).fill(-60), ...Array(10).fill(-20), ...Array(25).fill(-60)]
  const r = silenceRangesFromDb(dbs, -35, { minDuration: 0.25, pad: 0.1 })
  assert.equal(r.length, 2)
  assert.equal(r[0].start, 0)
  assert.ok(Math.abs(r[0].end - 0.9) < 1e-9)
  assert.ok(Math.abs(r[1].end - 2.4) < 1e-9)
})

test('a fully silent recording can be removed', () => {
  const dbs = Array(30).fill(-90)
  const threshold = autoThresholdDb(dbs, 'balanced')
  assert.ok(threshold > -90)
  assert.equal(silenceRangesFromDb(dbs, threshold, { minDuration: 0.25, pad: 0.08 }).length, 1)
})

test('applying multi-clip cuts: out of the whole timeline, only where every picked clip is quiet (phase Ç2b.1)', async () => {
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
  const audio1 = project.tracks[1]
  const audio2 = { id: 'a2', kind: 'audio' as const, name: 'A2', clipIds: ['b'] }
  project.tracks.push(audio2)
  project.assets = [asset('voice1', 'audio', true), asset('voice2', 'audio', true), asset('still', 'image', false)]
  project.clips.a = {
    ...clip('a', audio1.id, 'voice1'), duration: 5,
    volumeKeyframes: [{ id: 'k0', time: 0, value: 0 }, { id: 'k5', time: 5, value: 1 }]
  }
  project.clips.b = { ...clip('b', audio2.id, 'voice2'), duration: 5 }
  project.clips.image = { ...clip('image', project.tracks[0].id, 'still'), start: 5, duration: 2 }
  audio1.clipIds = ['a']
  project.tracks[0].clipIds = ['image']
  useStore.getState().loadProject(project)

  // a is quiet over 1–2.5, b over 2–4: both only over 2–2.5. Before, each
  // track lost its own gaps and the image after them stayed put: the two
  // voices and the picture fell out of step.
  useStore.getState().applySilenceCuts([
    { clipId: 'a', start: 1, end: 2.5 },
    { clipId: 'b', start: 2, end: 4 }
  ])
  const result = useStore.getState().project
  const pieces = (trackId: string): Clip[] => result.tracks
    .find((track) => track.id === trackId)!.clipIds.map((id) => result.clips[id])
  assert.deepEqual(pieces(audio1.id).map((piece) => piece.duration), [2, 2.5])
  assert.deepEqual(pieces(audio2.id).map((piece) => piece.duration), [2, 2.5])
  // The volume keys go on through the pieces (0 → 1 over a's 5 s).
  assert.ok(Math.abs(automationGainAt(pieces(audio1.id)[1], 0) - 0.5) < 1e-6)
  assert.ok(Math.abs(automationGainAt(pieces(audio1.id)[1], 2.5) - 1) < 1e-6)
  assert.equal(result.clips.image.start, 4.5)
})
