// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// Round 12a (the general bug sweep): the user's two drop bugs.
// 1. A drop from the Media panel (or the file manager) onto the timeline
//    landed in the wrong place: a busy spot moved it in time to the nearest
//    gap (an SFX dropped on the narration landed at the narration's end), a
//    drop over a row of the other kind or under the rows went to the first
//    row of its kind at a far time, and nothing snapped or showed where.
// 2. After Ctrl+Z, the same file could not be dropped again ("already in this
//    project"): the import was an undo step of its own, so undo took the clip
//    and left the file, and a second drop of a file the project has placed
//    nothing.
import assert from 'node:assert/strict'
import test from 'node:test'
import { NEW_AUDIO_TRACK, NEW_VIDEO_TRACK, planMediaDrop } from '../renderer/src/timeline/placement'
import { dropTimeAt } from '../renderer/src/timeline/snapping'
import { defaultProject, TIMELINE_HEADER_W, type Asset, type Clip, type Project } from '../renderer/src/types'

Object.defineProperty(globalThis, 'document', {
  configurable: true,
  value: { createElement: () => ({ width: 0, height: 0, getContext: () => null }) }
})
Object.defineProperty(globalThis, 'localStorage', {
  configurable: true,
  value: { getItem: () => null, setItem: () => {} }
})

const asset = (id: string, kind: Asset['kind'], duration: number, path = `C:/media/${id}`): Asset => ({
  id, kind, name: id, url: `media://${id}`, path, size: 1, duration, width: kind === 'audio' ? 0 : 640, height: kind === 'audio' ? 0 : 360, hasAudio: kind !== 'image'
})
const clip = (id: string, assetId: string, trackId: string, start: number, duration: number): Clip => ({
  id, assetId, trackId, start, duration, inPoint: 0, volume: 1, transform: { x: 0, y: 0, scale: 1, rotation: 0 }
})

/** V1 and A1, a 30 s narration on A1 from 0 s and a 4 s picture on V1 at 10 s;
 *  the three test files in the bin. */
function editProject(): Project {
  const p = defaultProject()
  const v1 = p.tracks.find((t) => t.kind === 'video')!
  const a1 = p.tracks.find((t) => t.kind === 'audio')!
  p.assets.push(asset('voice', 'audio', 30), asset('pic', 'image', 0), asset('tone', 'audio', 3), asset('card', 'image', 0), asset('movie', 'video', 4))
  p.clips.narration = clip('narration', 'voice', a1.id, 0, 30)
  p.clips.picture = clip('picture', 'pic', v1.id, 10, 4)
  a1.clipIds = ['narration']
  v1.clipIds = ['picture']
  return p
}

async function storeWith(p: Project) {
  const { useStore } = await import('../renderer/src/state/store')
  useStore.getState().loadProject(structuredClone(p))
  return useStore
}

const newClips = (before: Project, after: Project): Clip[] =>
  Object.values(after.clips).filter((c) => !before.clips[c.id])
const trackName = (p: Project, id: string): string | undefined => p.tracks.find((t) => t.id === id)?.name

test('drop time: pixels to seconds through the scroll and the zoom, the header column off', () => {
  const p = defaultProject()
  // 410 px into the scroll area, not scrolled, 60 px/s: (410 - 110) / 60 = 5 s.
  assert.equal(dropTimeAt(p, 410, 0, 60, null, 99, 3, false).time, 5)
  // Scrolled 300 px at 120 px/s: (710 + 300 - 110) / 120 = 7.5 s.
  assert.equal(dropTimeAt(p, 710, 300, 120, null, 99, 3, false).time, 7.5)
  // Over the header column: the start, never a negative time.
  assert.equal(dropTimeAt(p, 40, 0, 60, null, 99, 3, false).time, 0)
  assert.equal(TIMELINE_HEADER_W, 110)
})

test('drop time snaps like a clip move: an edge or the playhead within 8 px, Shift exact', () => {
  const p = editProject()
  const v1 = p.tracks.find((t) => t.kind === 'video')!.id
  const x = (t: number) => TIMELINE_HEADER_W + t * 60
  // 5 px after the picture's end (14 s): the drop's start goes on it.
  const near = dropTimeAt(p, x(14) + 5, 0, 60, v1, 99, 4, false)
  assert.equal(near.time, 14)
  assert.equal(near.snap?.clipId, 'picture')
  // The clip's END snaps too: a 4 s card whose end is 4 px before 10 s starts at 6 s.
  assert.equal(dropTimeAt(p, x(6) - 4, 0, 60, v1, 99, 4, false).time, 6)
  // The playhead.
  assert.equal(dropTimeAt(p, x(21) + 3, 0, 60, v1, 21, 4, false).time, 21)
  // Shift: exactly where the pointer is.
  assert.equal(dropTimeAt(p, x(14) + 6, 0, 60, v1, 99, 4, true).time, 14.1)
  // Far from anything: unchanged.
  assert.equal(dropTimeAt(p, x(20), 0, 60, v1, 99, 4, false).time, 20)
})

test('bug 1: audio, an image and a video each land at the drop time on the row under the pointer', async () => {
  const p = editProject()
  const v1 = p.tracks.find((t) => t.kind === 'video')!
  const a1 = p.tracks.find((t) => t.kind === 'audio')!
  a1.clipIds = []
  delete p.clips.narration
  const useStore = await storeWith(p)
  for (const [id, track, at] of [['tone', a1.id, 5], ['card', v1.id, 2], ['movie', v1.id, 16]] as const) {
    const before = useStore.getState().project
    const { clipIds } = useStore.getState().addClipsAt([id], track, at)
    const after = useStore.getState().project
    assert.equal(clipIds.length, 1, id)
    const made = after.clips[clipIds[0]]
    assert.equal(made.start, at, `${id} lands at ${at} s`)
    assert.equal(made.trackId, track, `${id} lands on its row`)
    assert.deepEqual(newClips(before, after).map((c) => c.id), clipIds)
  }
})

test('bug 1: a drop on a busy row keeps its time and goes to the nearest free row; nothing moves', async () => {
  const p = editProject()
  const a1 = p.tracks.find((t) => t.kind === 'audio')!
  const v1 = p.tracks.find((t) => t.kind === 'video')!
  const useStore = await storeWith(p)
  // An SFX dropped on the narration at 6.5 s: before, it went to 30 s (the
  // narration's end, the nearest gap). Now 6.5 s, on a new A2.
  const { clipIds: [sfx] } = useStore.getState().addClipsAt(['tone'], a1.id, 6.5)
  let now = useStore.getState().project
  assert.equal(now.clips[sfx].start, 6.5)
  assert.equal(trackName(now, now.clips[sfx].trackId), 'A2')
  assert.equal(now.clips.narration.start, 0)
  // Another at 7 s: A2 is busy there too, so A3; at 20 s A2 is free again.
  const { clipIds: [sfx2] } = useStore.getState().addClipsAt(['tone'], a1.id, 7)
  const { clipIds: [sfx3] } = useStore.getState().addClipsAt(['tone'], a1.id, 20)
  now = useStore.getState().project
  assert.equal(trackName(now, now.clips[sfx2].trackId), 'A3')
  assert.equal(now.clips[sfx2].start, 7)
  assert.equal(trackName(now, now.clips[sfx3].trackId), 'A2')
  assert.equal(now.clips[sfx3].start, 20)
  // An image dropped on the picture at 11 s: on a new V2 over it, at 11 s.
  const { clipIds: [img] } = useStore.getState().addClipsAt(['card'], v1.id, 11)
  now = useStore.getState().project
  assert.equal(now.clips[img].start, 11)
  assert.equal(trackName(now, now.clips[img].trackId), 'V2')
  assert.equal(now.clips.picture.start, 10)
  assert.equal(now.clips.picture.trackId, v1.id)
})

test('bug 1: the row under the pointer of the other kind, or none, still keeps the time', () => {
  const p = editProject()
  const v1 = p.tracks.find((t) => t.kind === 'video')!
  const a1 = p.tracks.find((t) => t.kind === 'audio')!
  a1.clipIds = []
  delete p.clips.narration
  // Audio over the picture row at 7 s: the first audio row, at 7 s (before: A1 at 2 s).
  const audioOverVideo = planMediaDrop(p, [{ assetId: 'tone', kind: 'audio', duration: 3 }], 7, v1.id, null)!
  assert.deepEqual(audioOverVideo.placements, [{ assetId: 'tone', start: 7, trackId: a1.id }])
  // An image over A1: on V1 at that time.
  const imageOverAudio = planMediaDrop(p, [{ assetId: 'card', kind: 'video', duration: 4 }], 2, a1.id, null)!
  assert.deepEqual(imageOverAudio.placements, [{ assetId: 'card', start: 2, trackId: v1.id }])
  // Under the rows (no row): the first row of the kind, the time kept.
  assert.equal(planMediaDrop(p, [{ assetId: 'tone', kind: 'audio', duration: 3 }], 12, null, null)!.anchorStart, 12)
})

test('bug 1: hidden, muted and locked rows are passed over; the row under the pointer may be muted', () => {
  const p = editProject()
  const a1 = p.tracks.find((t) => t.kind === 'audio')!
  p.tracks.push({ id: 'a2', kind: 'audio', name: 'A2', clipIds: [], muted: true })
  p.tracks.push({ id: 'a3', kind: 'audio', name: 'A3', clipIds: [], locked: true })
  p.tracks.push({ id: 'a4', kind: 'audio', name: 'A4', clipIds: [] })
  const item = [{ assetId: 'tone', kind: 'audio' as const, duration: 3 }]
  // Over the busy A1: A2 is muted and A3 locked, so A4.
  assert.equal(planMediaDrop(p, item, 5, a1.id, null)!.anchorTrackId, 'a4')
  // Pointed straight at the muted A2: it goes there (you see it land).
  assert.equal(planMediaDrop(p, item, 5, 'a2', null)!.anchorTrackId, 'a2')
  // Pointed at the locked A3: never on it.
  assert.equal(planMediaDrop(p, item, 5, 'a3', null)!.anchorTrackId, 'a4')
  // Everything busy: a new row.
  p.tracks.find((t) => t.id === 'a4')!.locked = true
  const plan = planMediaDrop(p, item, 5, a1.id, null)!
  assert.equal(plan.anchorTrackId, NEW_AUDIO_TRACK)
  assert.deepEqual(plan.newTracks, ['audio'])
})

test('bug 1: the + strips make a row per kind; several files lie back to back from the drop', async () => {
  const p = editProject()
  const plan = planMediaDrop(p, [
    { assetId: 'card', kind: 'video', duration: 4 },
    { assetId: 'tone', kind: 'audio', duration: 3 },
    { assetId: 'movie', kind: 'video', duration: 4 }
  ], 20, null, 'video')!
  // The pictures on a new V row; the sound keeps its time on an audio row
  // (A1 has the narration there, so a new one too).
  assert.deepEqual(plan.placements.map((x) => [x.trackId, x.start]), [
    [NEW_VIDEO_TRACK, 20],
    [NEW_AUDIO_TRACK, 24],
    [NEW_VIDEO_TRACK, 27]
  ])
  assert.deepEqual(plan.newTracks, ['video', 'audio'])
  const useStore = await storeWith(p)
  const { clipIds } = useStore.getState().addClipsAt(['tone'], null, 3, { newTrack: 'audio' })
  const now = useStore.getState().project
  assert.equal(trackName(now, now.clips[clipIds[0]].trackId), 'A2')
  assert.equal(now.clips[clipIds[0]].start, 3)
})

test('bug 1: on an auto-packed row the indicator shows the packed time and the drop lands on it', async () => {
  const p = editProject()
  const v1 = p.tracks.find((t) => t.kind === 'video')!
  v1.autoPack = true
  p.clips.picture.start = 0
  p.clips.second = clip('second', 'pic', v1.id, 4, 4)
  v1.clipIds = ['picture', 'second']
  // Dropped at 3 s on the packed main row: between the first (0-4) and the
  // second (4-8) by start, so it lands at 4 s and the second packs on to 8 s.
  const plan = planMediaDrop(p, [{ assetId: 'card', kind: 'video', duration: 4 }], 3, v1.id, null)!
  assert.equal(plan.anchorStart, 4)
  const useStore = await storeWith(p)
  const { clipIds } = useStore.getState().addClipsAt(['card'], v1.id, 3)
  const now = useStore.getState().project
  assert.equal(now.clips[clipIds[0]].start, plan.anchorStart)
  assert.equal(now.clips.second.start, 8)
  assert.deepEqual(now.tracks.find((t) => t.id === v1.id)!.clipIds, ['picture', clipIds[0], 'second'])
})

test('bug 2: a dropped file comes in with its clip as one undo step; undo, drop again, redo (audio, image, video)', async () => {
  const useStore = await storeWith(defaultProject())
  for (const [kind, duration] of [['audio', 3], ['image', 0], ['video', 4]] as const) {
    useStore.getState().loadProject(defaultProject())
    const row = useStore.getState().project.tracks.find((t) => t.kind === (kind === 'audio' ? 'audio' : 'video'))!.id
    // What a file dropped from the file manager brings: a probed asset (each
    // probe makes a new id).
    const probe = (n: number) => asset(`${kind}-probe-${n}`, kind, duration, `C:/media/file.${kind}`)
    const first = probe(1)
    const r1 = useStore.getState().addClipsAt([first.id], row, 5, { assets: [first] })
    assert.equal(r1.added.length, 1)
    assert.equal(useStore.getState().past.length, 1, `${kind}: one undo step for the file and its clip`)
    useStore.getState().undo()
    assert.equal(useStore.getState().project.assets.length, 0, `${kind}: undo takes the file out too`)
    assert.equal(Object.keys(useStore.getState().project.clips).length, 0)
    // The same file again: imported and placed (before: refused).
    const second = probe(2)
    const r2 = useStore.getState().addClipsAt([second.id], row, 5, { assets: [second] })
    assert.equal(r2.clipIds.length, 1, `${kind}: placed again after undo`)
    let now = useStore.getState().project
    assert.equal(now.assets.length, 1)
    assert.equal(now.clips[r2.clipIds[0]].assetId, second.id)
    assert.equal(now.clips[r2.clipIds[0]].start, 5)
    // A new edit drops the redo; undo then redo bring it back whole.
    assert.equal(useStore.getState().future.length, 0)
    useStore.getState().undo()
    useStore.getState().redo()
    now = useStore.getState().project
    assert.equal(now.assets.length, 1)
    assert.equal(Object.keys(now.clips).length, 1)
    assert.equal(Object.values(now.clips)[0].assetId, now.assets[0].id)
    // The file once more while the project has it: its asset placed again,
    // no second copy of the file.
    const third = probe(3)
    const r3 = useStore.getState().addClipsAt([third.id], row, 12, { assets: [third] })
    now = useStore.getState().project
    assert.equal(r3.added.length, 0)
    assert.equal(r3.clipIds.length, 1, `${kind}: a file already in the project is placed, not refused`)
    assert.equal(now.assets.length, 1)
    assert.equal(now.clips[r3.clipIds[0]].assetId, second.id)
    assert.equal(now.clips[r3.clipIds[0]].start, 12)
  }
})

test('bug 2: a media-bin item can always be placed again: add, undo, add, undo, redo', async () => {
  const p = editProject()
  const a1 = p.tracks.find((t) => t.kind === 'audio')!
  a1.clipIds = []
  delete p.clips.narration
  const useStore = await storeWith(p)
  for (const id of ['tone', 'card', 'movie']) {
    const count = () => Object.values(useStore.getState().project.clips).filter((c) => c.assetId === id).length
    useStore.getState().addClipsAt([id], null, 40)
    assert.equal(count(), 1)
    useStore.getState().undo()
    assert.equal(count(), 0)
    assert.ok(useStore.getState().project.assets.some((a) => a.id === id), 'the bin keeps the file it had before')
    useStore.getState().addClipsAt([id], null, 40)
    assert.equal(count(), 1)
    useStore.getState().undo()
    useStore.getState().redo()
    assert.equal(count(), 1)
    useStore.getState().undo()
  }
})

test('importing nothing new takes no undo step and keeps the redo history', async () => {
  const p = editProject()
  const useStore = await storeWith(p)
  useStore.getState().addClipsAt(['tone'], null, 40)
  useStore.getState().undo()
  assert.equal(useStore.getState().future.length, 1)
  const past = useStore.getState().past.length
  const added = useStore.getState().addAssets([asset('tone-again', 'audio', 3, 'C:/media/tone')])
  assert.equal(added.length, 0)
  assert.equal(useStore.getState().past.length, past)
  assert.equal(useStore.getState().future.length, 1, 'redo still there')
})
