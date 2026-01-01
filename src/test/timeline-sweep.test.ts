// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// Round 12a (the general bug sweep): the timeline's working logic. Splits on
// locked rows, in groups and across the A/V link; a split or a nudge that
// changes nothing taking an undo step; a multi-clip nudge; Play at the end;
// and a project's round trip through its file.
import assert from 'node:assert/strict'
import test from 'node:test'
import { defaultProject, type Asset, type Clip, type Project } from '../renderer/src/types'

Object.defineProperty(globalThis, 'document', {
  configurable: true,
  value: { createElement: () => ({ width: 0, height: 0, getContext: () => null }) }
})
Object.defineProperty(globalThis, 'localStorage', {
  configurable: true,
  value: { getItem: () => null, setItem: () => {} }
})

const asset = (id: string, kind: Asset['kind'], duration: number): Asset => ({
  id, kind, name: `${id}.${kind === 'audio' ? 'wav' : kind === 'image' ? 'png' : 'mp4'}`, url: `media://${id}`, path: `C:/media/${id}`, size: 1,
  duration, width: kind === 'audio' ? 0 : 640, height: kind === 'audio' ? 0 : 360, hasAudio: kind !== 'image'
})
const clip = (id: string, assetId: string, trackId: string, start: number, duration: number, extra: Partial<Clip> = {}): Clip => ({
  id, assetId, trackId, start, duration, inPoint: 0, volume: 1, transform: { x: 0, y: 0, scale: 1, rotation: 0 }, ...extra
})

/** V1: a video (0-10) with its sound extracted to A1 (linked); V2: two
 *  pictures (2-6, 6-10) grouped; A2 (locked): music 0-10. */
function cutProject(): Project {
  const p = defaultProject()
  const v1 = p.tracks.find((t) => t.kind === 'video')!
  const a1 = p.tracks.find((t) => t.kind === 'audio')!
  p.tracks.unshift({ id: 'v2', kind: 'video', name: 'V2', clipIds: ['p1', 'p2'] })
  p.tracks.push({ id: 'a2', kind: 'audio', name: 'A2', clipIds: ['music'], locked: true })
  p.assets.push(asset('film', 'video', 20), asset('filmsound', 'audio', 20), asset('pic', 'image', 0), asset('song', 'audio', 60))
  p.clips.video = clip('video', 'film', v1.id, 0, 10, { linkId: 'L', audioExtracted: true })
  p.clips.sound = clip('sound', 'filmsound', a1.id, 0, 10, { linkId: 'L' })
  p.clips.p1 = clip('p1', 'pic', 'v2', 2, 4)
  p.clips.p2 = clip('p2', 'pic', 'v2', 6, 4)
  p.clips.music = clip('music', 'song', 'a2', 0, 10)
  v1.clipIds = ['video']
  a1.clipIds = ['sound']
  p.groups = [{ id: 'G', clipIds: ['p1', 'p2'] }]
  return p
}

async function store(p: Project) {
  const { useStore } = await import('../renderer/src/state/store')
  useStore.getState().loadProject(structuredClone(p))
  useStore.setState({ linkAV: false })
  return useStore
}

const piecesOf = (p: Project, assetId: string): Clip[] =>
  Object.values(p.clips).filter((c) => c.assetId === assetId).sort((a, b) => a.start - b.start)

test('S at the playhead: a locked row is not cut, and an empty cut takes no undo step', async () => {
  const useStore = await store(cutProject())
  useStore.getState().setTime(4)
  useStore.getState().splitAtPlayhead()
  const p = useStore.getState().project
  assert.equal(piecesOf(p, 'song').length, 1, 'the locked music is not cut')
  assert.equal(piecesOf(p, 'film').length, 2)
  assert.equal(piecesOf(p, 'filmsound').length, 2)
  assert.equal(piecesOf(p, 'pic').length, 3)
  assert.equal(useStore.getState().past.length, 1)
  // At the very edge of every clip: nothing to cut, no undo step.
  useStore.getState().setTime(6)
  const past = useStore.getState().past.length
  useStore.getState().selectClip('p2')
  useStore.getState().splitAtPlayhead()
  assert.equal(useStore.getState().past.length, past, 'no empty undo step')
  // Ctrl+B and the split tool on the locked clip: nothing either.
  useStore.getState().selectClip(null)
  useStore.getState().splitClipAt('music', 7)
  useStore.getState().setTime(8)
  useStore.setState({ selectedClipIds: ['music'] })
  useStore.getState().splitTargetAtPlayhead()
  const now = useStore.getState().project
  assert.equal(piecesOf(now, 'song').length, 1)
  // Ctrl+B passed over the locked music to the next clip under the playhead.
  assert.equal(useStore.getState().past.length, past + 1)
})

test('a split grouped clip stays one block with its group; undo puts it back whole', async () => {
  const useStore = await store(cutProject())
  useStore.getState().splitClipAt('p1', 3)
  const p = useStore.getState().project
  const [left, right] = piecesOf(p, 'pic').filter((c) => c.start < 6)
  assert.equal(left.id, 'p1')
  assert.ok(p.groups?.[0].clipIds.includes(right.id), 'the right piece joins the group')
  // Clicking the right piece selects the whole group, as it did before the cut.
  useStore.getState().selectClip(right.id)
  assert.deepEqual(new Set(useStore.getState().selectedClipIds), new Set(['p1', 'p2', right.id]))
  useStore.getState().undo()
  assert.deepEqual(useStore.getState().project.groups, [{ id: 'G', clipIds: ['p1', 'p2'] }])
  assert.equal(useStore.getState().project.clips.p1.duration, 4)
})

test('cutting a linked video and its sound: the halves are linked in pairs, so a half moves with its own half only', async () => {
  const useStore = await store(cutProject())
  useStore.setState({ linkAV: true })
  // The split tool on the video alone cuts its linked sound too while the link is on.
  useStore.getState().splitClipAt('video', 5)
  let p = useStore.getState().project
  const [v0, v1] = piecesOf(p, 'film')
  const [s0, s1] = piecesOf(p, 'filmsound')
  assert.ok(v1 && s1, 'both cut')
  assert.equal(v0.linkId, s0.linkId)
  assert.equal(v1.linkId, s1.linkId)
  assert.notEqual(v0.linkId, v1.linkId)
  // Moving the right video half (link on) takes the right sound half along,
  // and leaves the left halves where they are (before: all four moved).
  useStore.getState().moveClip(v1.id, 12)
  p = useStore.getState().project
  assert.equal(p.clips[v1.id].start, 12)
  assert.equal(p.clips[s1.id].start, 12)
  assert.equal(p.clips[v0.id].start, 0)
  assert.equal(p.clips[s0.id].start, 0)
  useStore.setState({ linkAV: false })
})

test('a linked clip cut alone (link off) keeps its link on both halves', async () => {
  const useStore = await store(cutProject())
  useStore.getState().splitClipAt('video', 5)
  const p = useStore.getState().project
  assert.equal(piecesOf(p, 'filmsound').length, 1)
  assert.deepEqual(piecesOf(p, 'film').map((c) => c.linkId), ['L', 'L'])
})

test('nudging a selection moves it as a drag would: one undo step, touching clips both move', async () => {
  const useStore = await store(cutProject())
  // p1 (2-6) and p2 (6-10) touch: a frame to the right moves both.
  useStore.getState().selectClip('p1')
  assert.deepEqual(new Set(useStore.getState().selectedClipIds), new Set(['p1', 'p2']))
  const frame = 1 / 60
  useStore.getState().nudgeSelection(frame)
  let p = useStore.getState().project
  assert.ok(Math.abs(p.clips.p1.start - (2 + frame)) < 1e-9, `p1 at ${p.clips.p1.start}`)
  assert.ok(Math.abs(p.clips.p2.start - (6 + frame)) < 1e-9, `p2 at ${p.clips.p2.start}`)
  assert.equal(useStore.getState().past.length, 1, 'one undo step for the whole nudge')
  useStore.getState().undo()
  p = useStore.getState().project
  assert.equal(p.clips.p1.start, 2)
  assert.equal(p.clips.p2.start, 6)
  assert.equal(useStore.getState().past.length, 0)
  // Left at 0: nothing moves, nothing to undo.
  useStore.getState().selectClip('video')
  useStore.getState().nudgeSelection(-frame)
  assert.equal(useStore.getState().past.length, 0)
  assert.equal(useStore.getState().project.clips.video.start, 0)
  // A locked clip in the selection stays where it is.
  useStore.setState({ selectedClipIds: ['music', 'sound'] })
  useStore.getState().nudgeSelection(1)
  p = useStore.getState().project
  assert.equal(p.clips.music.start, 0)
  assert.equal(p.clips.sound.start, 1)
})

test('Play with the playhead at the end starts from the top; elsewhere it plays on from there', async () => {
  const useStore = await store(cutProject())
  useStore.getState().setTime(10)
  useStore.getState().setPlaying(true)
  assert.equal(useStore.getState().playing, true)
  assert.equal(useStore.getState().currentTime, 0)
  useStore.getState().setPlaying(false)
  useStore.getState().setTime(4)
  useStore.getState().setPlaying(true)
  assert.equal(useStore.getState().currentTime, 4)
  useStore.getState().setPlaying(false)
})

test('undo and redo through a moved group, a trim, a split and a delete come back exactly', async () => {
  const { planTimelinePlacement } = await import('../renderer/src/timeline/placement')
  const useStore = await store(cutProject())
  const snap = () => JSON.stringify(useStore.getState().project)
  const states = [snap()]
  // A drag of the group (the way the timeline commits one).
  useStore.getState().armGesture()
  useStore.getState().applyTimelinePlacement(planTimelinePlacement(useStore.getState().project, 'p1', ['p1', 'p2'], 5, null, null, false)!)
  useStore.getState().endGesture()
  states.push(snap())
  useStore.getState().armGesture()
  useStore.getState().trimClipEnd('video', -2)
  useStore.getState().endGesture()
  states.push(snap())
  useStore.getState().splitClipAt('sound', 3)
  states.push(snap())
  useStore.getState().deleteClips(['p2'], false)
  states.push(snap())
  assert.equal(useStore.getState().past.length, 4)
  for (let i = states.length - 2; i >= 0; i--) {
    useStore.getState().undo()
    assert.equal(snap(), states[i], `undo back to step ${i}`)
  }
  for (let i = 1; i < states.length; i++) {
    useStore.getState().redo()
    assert.equal(snap(), states[i], `redo to step ${i}`)
  }
})

test('a project comes back from its file as it was: clips, captions, groups, markers, Shorts segments', async () => {
  const { serializeProject, parseProjectFile } = await import('../renderer/src/media/projectio')
  const useStore = await store(cutProject())
  const s = useStore.getState()
  s.addMarkerAtPlayhead()
  useStore.setState((st) => ({
    project: {
      ...st.project,
      name: 'Round trip',
      captions: [{ id: 'c1', start: 0.2, end: 0.9, text: 'Time bends', words: [{ text: 'Time', start: 0.2, end: 0.5 }, { text: 'bends', start: 0.5, end: 0.9 }] }],
      shortSegments: [{ id: 's1', name: 'Short 1', start: 1, end: 9 }]
    } as Project
  }))
  // Runtime-only things a file never carries.
  useStore.getState().setAssetDerived('pic', { thumbnail: 'data:image/jpeg;base64,AAAA', filmstrip: 'data:x', filmstripCols: 4 })
  const before = useStore.getState().project
  const file = serializeProject(before)
  const back = parseProjectFile(file)
  const expected = structuredClone(before) as Project
  for (const a of expected.assets) {
    delete a.thumbnail
    delete a.waveform
    delete a.missing
    delete a.filmstrip
    delete a.filmstripCols
    a.url = ''
  }
  // (Compared as JSON: a key holding undefined is no key in a file.)
  assert.deepEqual(back, JSON.parse(JSON.stringify(expected)))
  // Opened: a fresh history and nothing unsaved, the same project.
  useStore.getState().loadProject(back)
  assert.equal(useStore.getState().past.length, 0)
  assert.equal(useStore.getState().dirty, false)
  useStore.getState().undo()
  assert.deepEqual(useStore.getState().project, back)
  // A file that is not a project is refused, not half-opened.
  assert.throws(() => parseProjectFile('{"version":2}'))
  assert.throws(() => parseProjectFile('null'))
})

test('a Ctrl/Shift press on a selected clip keeps it for a drag or a trim, and lets go of it on a click', async () => {
  const { clipPressSelection } = await import('../renderer/src/timeline/snapping')
  // Shift-trim (no snapping) of a selected clip: it stays selected.
  assert.deepEqual(clipPressSelection({ selected: true, additive: true, copying: false, kind: 'trim-r' }), { now: 'keep', onClick: 'none' })
  // Shift on a selected clip's body: kept for the drag, let go on a click.
  assert.deepEqual(clipPressSelection({ selected: true, additive: true, copying: false, kind: 'move' }), { now: 'keep', onClick: 'toggle-off' })
  // Shift on an unselected clip adds it; a plain press selects it alone.
  assert.deepEqual(clipPressSelection({ selected: false, additive: true, copying: false, kind: 'move' }), { now: 'add', onClick: 'none' })
  assert.deepEqual(clipPressSelection({ selected: true, additive: false, copying: false, kind: 'trim-l' }), { now: 'select', onClick: 'none' })
  // Alt-drag copies: that path picks its own selection.
  assert.deepEqual(clipPressSelection({ selected: false, additive: true, copying: true, kind: 'move' }), { now: 'keep', onClick: 'none' })
})

test('opening or starting a project lets go of the last one\'s cut row, ghost and snap line', async () => {
  const useStore = await store(cutProject())
  useStore.setState({ cutTrackId: 'v2', snapGuide: 3, rangePreview: { start: 1, end: 2 } })
  useStore.getState().loadProject(cutProject())
  let st = useStore.getState()
  assert.equal(st.cutTrackId, null)
  assert.equal(st.snapGuide, null)
  assert.equal(st.rangePreview, null)
  useStore.setState({ cutTrackId: 'v3' })
  useStore.getState().newProject()
  st = useStore.getState()
  assert.equal(st.cutTrackId, null)
})

test('a clip grabbed just right of the header and dragged right does not scroll the view left', async () => {
  const { edgeScrollStep } = await import('../renderer/src/timeline/snapping')
  // The rows from x 0 to 1484; the header column is 110 px, its margin to 170.
  assert.equal(edgeScrollStep(0, 1484, 150, 10), 0, 'heading right inside the left margin: no scroll')
  assert.ok(edgeScrollStep(0, 1484, 130, -10) < 0, 'heading left into it: scrolls left')
  assert.ok(edgeScrollStep(0, 1484, 1470, 30) > 0, 'heading right into the right margin: scrolls right')
  assert.equal(edgeScrollStep(0, 1484, 1470, -5), 0, 'heading left inside the right margin: no scroll')
  assert.equal(edgeScrollStep(0, 1484, 700, 300), 0, 'mid-view: no scroll')
  // Deeper in, faster; never more than a step.
  assert.ok(edgeScrollStep(0, 1484, 1480, 30) > edgeScrollStep(0, 1484, 1440, 30))
  assert.ok(Math.abs(edgeScrollStep(0, 1484, 0, -500)) <= 28)
})

test('Delete leaves a locked track\'s clips (a marquee could select them); only locked: no undo step', async () => {
  const useStore = await store(cutProject())
  useStore.getState().deleteClips(['music', 'p1'], false)
  let p = useStore.getState().project
  assert.ok(p.clips.music, 'the locked music stays')
  assert.equal(p.clips.p1, undefined)
  assert.equal(useStore.getState().past.length, 1)
  useStore.getState().deleteClips(['music'], true)
  p = useStore.getState().project
  assert.ok(p.clips.music)
  assert.equal(useStore.getState().past.length, 1, 'no empty undo step')
})
