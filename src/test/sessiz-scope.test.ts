// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// Dalga 2, S (SESSIZ-PLAN.md): "Remove silence" cuts where the user says.
// Each choice: only the expected tracks' clips change (the others are
// compared whole, before and after), one undo step, and undo gives back the
// project. A linked pair is never pulled apart by the choice (decision 1).
import { hash, resetWorld } from './undo-fixture'
import assert from 'node:assert/strict'
import test from 'node:test'
import { defaultProject, type Clip, type Project } from '../renderer/src/types'
import { useStore } from '../renderer/src/state/store'
import { planSilenceCut, silenceCutTracks, sourceTracks } from '../renderer/src/audio/silence'
import { cutPrefs } from '../renderer/src/audio/cut-prefs'

const T0 = { x: 960, y: 540, scale: 1, rotation: 0 }
const S = useStore.getState
/** The pauses the window found in the voice (timeline seconds). */
const PAUSES: [number, number][] = [[4.2, 5.8], [10.2, 11.8], [24.2, 25.8]]

/** V3 an unrelated picture over everything, V2 a guest's video linked to
 *  its sound on A3, V1 the talk's picture linked to the voice on A1, A2
 *  the music. */
function film(): Project {
  const p = defaultProject()
  p.tracks = [
    { id: 'V3', kind: 'video', name: 'V3', clipIds: [] },
    { id: 'V2', kind: 'video', name: 'V2', clipIds: [] },
    { id: 'V1', kind: 'video', name: 'V1', clipIds: [] },
    { id: 'A1', kind: 'audio', name: 'A1', clipIds: [] },
    { id: 'A3', kind: 'audio', name: 'A3', clipIds: [] },
    { id: 'A2', kind: 'audio', name: 'Music', clipIds: [] }
  ]
  const a = (id: string, kind: 'video' | 'audio' | 'image', duration: number) => ({ id, kind, name: id, url: `media://${id}`, size: 1, duration, width: 1920, height: 1080, hasAudio: kind !== 'image' }) as never
  p.assets = [a('talk', 'video', 300), a('voice', 'audio', 300), a('music', 'audio', 300), a('guest', 'video', 60), a('logo', 'image', 0)]
  const put = (id: string, assetId: string, trackId: string, start: number, duration: number, extra: Partial<Clip> = {}) => {
    p.clips[id] = { id, assetId, trackId, start, inPoint: start, duration, transform: { ...T0 }, volume: 1, ...extra }
    p.tracks.find((t) => t.id === trackId)!.clipIds.push(id)
  }
  put('t1', 'talk', 'V1', 0, 40, { audioExtracted: true, linkId: 'L1' })
  put('v1', 'voice', 'A1', 0, 40, { linkId: 'L1' })
  put('g1', 'guest', 'V2', 20, 10, { audioExtracted: true, linkId: 'L2' })
  put('g2', 'guest', 'A3', 20, 10, { linkId: 'L2' })
  put('m1', 'music', 'A2', 0, 40)
  put('i1', 'logo', 'V3', 0, 40)
  return p
}

/** The clips of `track` as they are (ids, times, everything). */
const onTrack = (p: Project, track: string): string => hash(p.tracks.find((t) => t.id === track)!.clipIds.map((id) => p.clips[id]))

/** Loads the film, cuts PAUSES (listening to the voice) with `tracks`
 *  asked (none: every track, the music kept) and checks what changed. */
function cut(o: { tracks?: string[]; lock?: string }) {
  resetWorld()
  const p = film()
  if (o.lock) p.tracks.find((t) => t.id === o.lock)!.locked = true
  S().loadProject(p)
  const plan = planSilenceCut(S().project, ['v1'], PAUSES, o.tracks ? { keepMusic: true, tracks: o.tracks } : { keepMusic: true })
  const before = hash(S().project)
  const was = Object.fromEntries(S().project.tracks.map((t) => [t.id, onTrack(S().project, t.id)]))
  const depth = S().past.length
  S().applySilenceCuts(plan.regions, { picked: plan.picked, keepTracks: plan.keepTracks })
  const out = S().project
  const changed = out.tracks.filter((t) => onTrack(out, t.id) !== was[t.id]).map((t) => t.id)
  const steps = S().past.length - depth
  const result = { plan, changed, steps, out }
  S().undo()
  assert.equal(hash(S().project), before, 'undo gives back the project')
  return result
}

const len = (p: Project, track: string): number => p.tracks.find((t) => t.id === track)!.clipIds.reduce((n, id) => n + p.clips[id].duration, 0)
const total = PAUSES.reduce((n, [a, b]) => n + b - a, 0)

test('picked sound: the voice and its linked picture are cut; the picture above, the guest and the music stay as they were', () => {
  const tracks = sourceTracks(film(), ['v1'])
  assert.deepEqual(tracks, ['A1'])
  const { plan, changed, steps, out } = cut({ tracks })
  assert.deepEqual(plan.cutTracks, ['V1', 'A1'])
  assert.deepEqual(plan.pulled, ['V1'], 'the linked picture comes with its sound')
  assert.deepEqual(plan.keepTracks, ['V3', 'V2', 'A3', 'A2'])
  assert.deepEqual(changed, ['V1', 'A1'])
  assert.equal(steps, 1)
  assert.ok(Math.abs(40 - len(out, 'A1') - total) < 1e-6)
  assert.ok(Math.abs(len(out, 'V1') - len(out, 'A1')) < 1e-9, 'the pair in step')
  assert.equal(out.clips.i1.start, 0)
  assert.equal(out.clips.i1.duration, 40, 'the picture above is not cut')
  assert.ok(plan.behind.includes('V3') && plan.behind.includes('V2'), 'the tracks that may fall out of step are named')
  assert.ok(plan.marks.every((m) => ['t1', 'v1'].includes(m.clipId) || out.clips[m.clipId]?.trackId === 'V1' || out.clips[m.clipId]?.trackId === 'A1'), 'red only on the tracks cut')
})

test('all tracks: every unlocked track is cut but the music (as before)', () => {
  const { plan, changed, steps } = cut({})
  assert.deepEqual(plan.cutTracks, ['V3', 'V2', 'V1', 'A1', 'A3'])
  assert.deepEqual(plan.keepTracks, ['A2'])
  assert.deepEqual(plan.pulled, [])
  assert.deepEqual(plan.behind, [])
  assert.deepEqual(changed, ['V3', 'V2', 'V1', 'A1', 'A3'])
  assert.equal(steps, 1)
})

test('chosen tracks: only the picture above is cut', () => {
  const { plan, changed, steps, out } = cut({ tracks: ['V3'] })
  assert.deepEqual(plan.cutTracks, ['V3'])
  assert.deepEqual(changed, ['V3'])
  assert.equal(steps, 1)
  assert.ok(Math.abs(40 - len(out, 'V3') - total) < 1e-6)
})

test('chosen tracks: a linked partner on a track not ticked is cut with it (the pair stays in step)', () => {
  assert.deepEqual(silenceCutTracks(film(), ['V2']), ['V2', 'A3'])
  const { plan, changed, steps, out } = cut({ tracks: ['V2'] })
  assert.deepEqual(plan.pulled, ['A3'])
  assert.deepEqual(changed, ['V2', 'A3'])
  assert.equal(steps, 1)
  const g = (t: string) => out.tracks.find((x) => x.id === t)!.clipIds.map((id) => [out.clips[id].start, out.clips[id].duration])
  assert.deepEqual(g('V2'), g('A3'), 'the guest picture and its sound cut alike')
})

test('chosen tracks: a linked partner before the first cut does not pull its track in', () => {
  const p = film()
  // The guest now ends before the first pause: nothing of the pair moves.
  p.clips.g1.start = p.clips.g2.start = 0
  p.clips.g1.duration = p.clips.g2.duration = 3
  assert.deepEqual(silenceCutTracks(p, ['V2'], PAUSES[0][0]), ['V2'])
})

test('chosen tracks: a linked partner on a locked track stays where it is (named as locked), the rest is cut', () => {
  const { plan, changed } = cut({ tracks: ['V2'], lock: 'A3' })
  assert.deepEqual(plan.cutTracks, ['V2'])
  assert.deepEqual(plan.pulled, [])
  assert.deepEqual(plan.lockedTracks, ['A3'])
  assert.deepEqual(changed, ['V2'])
})

test('chosen tracks, none ticked: nothing to cut is said; the defaults remembered are picked sound / all tracks', () => {
  const plan = planSilenceCut(film(), ['v1'], PAUSES, { keepMusic: true, tracks: [] })
  assert.deepEqual(plan.cutTracks, [])
  const prefs = cutPrefs()
  assert.deepEqual(prefs.target, { picked: 'picked', none: 'all' })
})
