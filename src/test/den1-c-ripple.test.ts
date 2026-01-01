// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// DENEME-1, item 2 (DENEME-1-PLAN-C.md): Q / W cut the selected clip (else
// the topmost one under the playhead) and its linked sound only; the other
// layers stay where they are. Alt+Q / Alt+W take the time out of every
// unlocked track (the Ç2b.1 behaviour).
import './dom-stub'
import assert from 'node:assert/strict'
import test from 'node:test'
import { defaultProject, type Clip, type Project } from '../renderer/src/types'
import { useStore } from '../renderer/src/state/store'

const T0 = { x: 960, y: 540, scale: 1, rotation: 0 }
const S = useStore.getState

/** V2 a title picture over V1 the talk, A1 the talk's own sound (linked),
 *  A2 music. */
function stack(): Project {
  const p = defaultProject()
  p.tracks = [
    { id: 'V2', kind: 'video', name: 'V2', clipIds: [] },
    { id: 'V1', kind: 'video', name: 'V1', clipIds: [] },
    { id: 'A1', kind: 'audio', name: 'A1', clipIds: [] },
    { id: 'A2', kind: 'audio', name: 'A2', clipIds: [] }
  ]
  const a = (id: string, kind: 'video' | 'audio' | 'image', duration: number) => ({ id, kind, name: id, url: `media://${id}`, size: 1, duration, width: 1920, height: 1080, hasAudio: kind !== 'image' }) as never
  p.assets = [a('talk', 'video', 300), a('music', 'audio', 300), a('pic', 'image', 0)]
  const put = (id: string, assetId: string, trackId: string, start: number, inPoint: number, duration: number, extra: Partial<Clip> = {}) => {
    p.clips[id] = { id, assetId, trackId, start, inPoint, duration, transform: { ...T0 }, volume: 1, ...extra }
    p.tracks.find((t) => t.id === trackId)!.clipIds.push(id)
  }
  put('t1', 'talk', 'V1', 0, 0, 10, { linkId: 'L1' })
  put('t2', 'talk', 'V1', 10, 20, 10, { linkId: 'L2' })
  put('a1', 'talk', 'A1', 0, 0, 10, { linkId: 'L1' })
  put('a2', 'talk', 'A1', 10, 20, 10, { linkId: 'L2' })
  put('p1', 'pic', 'V2', 2, 0, 6)
  put('p2', 'pic', 'V2', 12, 0, 4)
  put('m1', 'music', 'A2', 0, 0, 20)
  return p
}

const load = (time: number, sel: string[], link = true): void => {
  S().loadProject(stack())
  useStore.setState({ currentTime: time, selectedClipIds: sel, linkAV: link })
}

test('W with a clip selected: only that clip and its linked sound lose the part after the playhead', () => {
  load(4, ['t1'])
  S().rippleTrimToPlayhead('right')
  const p = S().project
  assert.equal(p.clips.t1.duration, 4)
  assert.equal(p.clips.a1.duration, 4)
  // Its own tracks close up.
  assert.equal(p.clips.t2.start, 4)
  assert.equal(p.clips.a2.start, 4)
  // The layer above and the music are untouched.
  assert.deepEqual([p.clips.p1.start, p.clips.p1.duration, p.clips.p2.start], [2, 6, 12])
  assert.deepEqual([p.clips.m1.start, p.clips.m1.duration], [0, 20])
})

test('Q with a clip selected: the part before the playhead, the playhead goes to the clip start', () => {
  load(14, ['t2'])
  S().rippleTrimToPlayhead('left')
  const p = S().project
  assert.equal(p.clips.t2.start, 10)
  assert.equal(p.clips.t2.duration, 6)
  assert.equal(p.clips.t2.inPoint, 24)
  assert.equal(p.clips.a2.duration, 6)
  assert.deepEqual([p.clips.p2.start, p.clips.p2.duration], [12, 4])
  assert.equal(p.clips.m1.duration, 20)
  assert.equal(S().currentTime, 10)
})

test('nothing selected: the topmost clip under the playhead, and only its track', () => {
  load(4, [])
  S().rippleTrimToPlayhead('right')
  const p = S().project
  // p1 (V2, 2–8) is the top layer at 4 s: it loses 4–8, p2 moves up 4 s.
  assert.equal(p.clips.p1.duration, 2)
  assert.equal(p.clips.p2.start, 8)
  assert.deepEqual([p.clips.t1.duration, p.clips.a1.duration, p.clips.m1.duration], [10, 10, 20])
})

test('with the link off, the linked sound stays', () => {
  load(4, ['t1'], false)
  S().rippleTrimToPlayhead('right')
  const p = S().project
  assert.equal(p.clips.t1.duration, 4)
  assert.equal(p.clips.a1.duration, 10)
  assert.equal(p.clips.a2.start, 10)
})

test('Alt+W: the time goes out of every unlocked track', () => {
  load(4, ['t1'])
  S().rippleTrimToPlayhead('right', true)
  const p = S().project
  assert.equal(p.clips.t1.duration, 4)
  assert.equal(p.clips.a2.start, 4)
  // The layer above moves with the cut (the music bed follows its own rule:
  // it ends with the film, çekirdek cila S).
  assert.equal(p.clips.p1.duration, 2)
  assert.equal(p.clips.p2.start, 6)
})

test('Q / W are one undo step', () => {
  load(4, ['t1'])
  const before = JSON.stringify(S().project.clips)
  S().rippleTrimToPlayhead('right')
  S().undo()
  assert.equal(JSON.stringify(S().project.clips), before)
})
