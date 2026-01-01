// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// The user's list, item 3 (KLISTE-PLAN.md): the main track's magnet (a
// track's auto-pack). On the main track clips sit back to back from 0; a
// removal, a move out, a trim or a clip dropped in leaves no gap and no
// overlap; the linked sound rides along; Ctrl+Z gives back each step.
import './dom-stub'
import assert from 'node:assert/strict'
import test from 'node:test'
import { defaultProject, type Clip, type Project } from '../renderer/src/types'
import { useStore } from '../renderer/src/state/store'
import { planTimelinePlacement } from '../renderer/src/timeline/placement'

const S = useStore.getState
const T0 = { x: 960, y: 540, scale: 1, rotation: 0 }

function project(): Project {
  const p = defaultProject()
  p.tracks = [
    { id: 'V2', kind: 'video', name: 'V2', clipIds: [] },
    { id: 'V1', kind: 'video', name: 'V1', clipIds: [] },
    { id: 'A1', kind: 'audio', name: 'A1', clipIds: [] }
  ]
  p.assets = [
    { id: 'vid', kind: 'video', name: 'vid.mp4', url: 'media://vid', size: 1, duration: 100, width: 1920, height: 1080, hasAudio: true } as never,
    { id: 'pic', kind: 'image', name: 'pic.png', url: 'media://pic', size: 1, duration: 0, width: 1920, height: 1080, hasAudio: false } as never
  ]
  const put = (id: string, assetId: string, trackId: string, start: number, duration: number, extra: Partial<Clip> = {}): void => {
    p.clips[id] = { id, assetId, trackId, start, inPoint: 10, duration, transform: { ...T0 }, volume: 1, ...extra }
    p.tracks.find((t) => t.id === trackId)!.clipIds.push(id)
  }
  // Three shots on V1 with gaps, each with its linked sound on A1; a title on V2.
  put('a', 'vid', 'V1', 0, 4, { linkId: 'la' })
  put('b', 'vid', 'V1', 6, 4, { linkId: 'lb' })
  put('c', 'vid', 'V1', 13, 4, { linkId: 'lc' })
  put('as', 'vid', 'A1', 0, 4, { linkId: 'la' })
  put('bs', 'vid', 'A1', 6, 4, { linkId: 'lb' })
  put('cs', 'vid', 'A1', 13, 4, { linkId: 'lc' })
  put('t', 'pic', 'V2', 20, 3)
  p.captions = []
  return p
}

const starts = (ids: string[]): number[] => ids.map((id) => Math.round(S().project.clips[id].start * 1000) / 1000)
/** The main track's clips in time order: no gap, no overlap, from 0. */
function packed(trackId = 'V1'): void {
  const p = S().project
  const clips = p.tracks.find((t) => t.id === trackId)!.clipIds.map((id) => p.clips[id]).sort((x, y) => x.start - y.start)
  let at = 0
  for (const c of clips) {
    assert.ok(Math.abs(c.start - at) < 1e-6, `${c.id} at ${c.start}, expected ${at}`)
    at = c.start + c.duration
  }
}
/** Each linked sound starts with its picture. */
function partnersWith(): void {
  const p = S().project
  for (const c of Object.values(p.clips)) {
    if (!c.linkId || c.trackId !== 'V1') continue
    const partner = Object.values(p.clips).find((o) => o.id !== c.id && o.linkId === c.linkId)
    if (partner) assert.ok(Math.abs(partner.start - c.start) < 1e-6, `${partner.id} at ${partner.start}, its picture ${c.id} at ${c.start}`)
  }
}
/** A trim drag as the clip block makes it (clip-block.tsx): one undo step. */
function drag(fn: () => void): void {
  S().beginGesture()
  fn()
  S().endGesture()
}
/** The magnet switched on as the track header does it (track-header.tsx). */
function magnetOn(): void {
  S().undoable(() => {
    S().setTrackFlags('V1', { autoPack: true })
    S().packTrack('V1')
  })
}

test('magnet on: the main track closes up from 0, the linked sound rides along, Ctrl+Z gives the gaps back', () => {
  S().loadProject(project())
  magnetOn()
  assert.deepEqual(starts(['a', 'b', 'c']), [0, 4, 8])
  partnersWith()
  assert.equal(S().project.clips.t.start, 20, 'a clip on another track that is not linked stays')
  S().undo()
  assert.deepEqual(starts(['a', 'b', 'c', 'as', 'bs', 'cs']), [0, 6, 13, 0, 6, 13])
  assert.equal(S().project.tracks.find((t) => t.id === 'V1')!.autoPack, undefined)
})

test('magnet: removing a middle clip closes the gap; Ctrl+Z puts it back', () => {
  S().loadProject(project())
  magnetOn()
  S().deleteClips(['b'], false)
  packed()
  partnersWith()
  assert.deepEqual(starts(['a', 'c']), [0, 4])
  S().undo()
  packed()
  assert.deepEqual(starts(['a', 'b', 'c']), [0, 4, 8])
  partnersWith()
})

test('magnet: trimming a clip shorter or longer keeps the track packed, never overlapping', () => {
  S().loadProject(project())
  magnetOn()
  // (A trim is a drag: the timeline takes its undo step when it starts.)
  drag(() => S().trimClipEnd('a', -1.5))
  packed()
  partnersWith()
  assert.deepEqual(starts(['a', 'b', 'c']), [0, 2.5, 6.5])
  drag(() => S().trimClipEnd('a', 3))
  packed()
  partnersWith()
  const base = { ...S().project.clips.b }
  drag(() => S().setClipHead('b', S().project.clips.b.start + 1, { start: base.start, inPoint: base.inPoint, duration: base.duration } as never))
  packed()
  partnersWith()
  S().undo()
  S().undo()
  S().undo()
  assert.deepEqual(starts(['a', 'b', 'c']), [0, 4, 8])
})

test('magnet: a clip dragged onto the main track goes in without overlap; dragged off, the gap closes', () => {
  S().loadProject(project())
  magnetOn()
  // The title from V2 dropped in the middle of shot b.
  const into = planTimelinePlacement(S().project, 't', ['t'], 5 - 20, 'V1', null, true)!
  S().applyTimelinePlacement(into)
  assert.equal(S().project.clips.t.trackId, 'V1')
  packed()
  partnersWith()
  // Shot c dragged up onto V2.
  const out = planTimelinePlacement(S().project, 'c', ['c'], 0, 'V2', null, false)!
  S().applyTimelinePlacement(out)
  assert.equal(S().project.clips.c.trackId, 'V2')
  packed()
  partnersWith()
  S().undo()
  S().undo()
  assert.deepEqual(starts(['a', 'b', 'c']), [0, 4, 8])
  assert.equal(S().project.clips.t.trackId, 'V2')
})

test('magnet: a clip moved along the main track keeps it packed', () => {
  S().loadProject(project())
  magnetOn()
  // c dragged to the very start.
  const plan = planTimelinePlacement(S().project, 'c', ['c'], -8, null, null, true)!
  S().applyTimelinePlacement(plan)
  packed()
  partnersWith()
  S().splitClipAt('a', S().project.clips.a.start + 1)
  packed()
  partnersWith()
})

test('magnet off: nothing moves by itself any more', () => {
  S().loadProject(project())
  magnetOn()
  S().setTrackFlags('V1', { autoPack: false })
  S().deleteClips(['b'], false)
  assert.deepEqual(starts(['a', 'c']), [0, 8])
})

test('magnet, the timeline\'s drag (DENEME-3, V item 3): a little over the clip before it, a clip stays after it; past its middle, it goes before', () => {
  S().loadProject(project())
  magnetOn()
  // a 0–4, b 4–8, c 8–12 after packing; c dragged 1 s back onto b's tail.
  const DRAG = { insert: 'middle' } as const
  const little = planTimelinePlacement(S().project, 'c', ['c'], -1, null, null, true, DRAG)!
  assert.equal(little.changed, false, 'it stays after b')
  S().applyTimelinePlacement(little)
  packed()
  assert.deepEqual(starts(['a', 'b', 'c']), [0, 4, 8])
  // Its middle past b's (6): before b, the pair rides along.
  const past = planTimelinePlacement(S().project, 'c', ['c'], -4, null, null, true, DRAG)!
  S().applyTimelinePlacement(past)
  packed()
  partnersWith()
  assert.deepEqual(starts(['a', 'c', 'b']), [0, 4, 8])
  S().undo()
  assert.deepEqual(starts(['a', 'b', 'c']), [0, 4, 8])
})
