// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// Phase Ç2b.2, decision 1 (report G2, G5): a transition names the clip it goes
// into (`transitionOut.to`; null = a fade-out put there on purpose). When that
// clip is no longer the one after it, the transition is not drawn and is
// dropped at the end of the edit. Behaviour table, one test per row, judged by
// `outgoingTransitionWindow` (the one function the render, the engine, the
// export mix and the sounds read). Old files get `to` from today's adjacency
// (format 4). The timeline's junction shows the window that is rendered.
import './dom-stub'
import assert from 'node:assert/strict'
import test from 'node:test'
import { defaultProject, type Clip, type Project } from '../renderer/src/types'
import { useStore } from '../renderer/src/state/store'
import { outgoingTransitionWindow, NO_TRANSITION } from '../renderer/src/playback/draw/timing'
import { runCommand, commandByName } from '../renderer/src/commands'
import { readProjectFile } from '../renderer/src/media/projectio'
import { CURRENT_FORMAT } from '../renderer/src/model/format'
import { junctionBox } from '../renderer/src/timeline/junction-box'

const S = useStore.getState
const T0 = { x: 960, y: 540, scale: 1, rotation: 0 }

/** V1: A 0–4, B 4–6, C 6–10, each with plenty of media round it; A → B a
 *  1 s dissolve. A1: the voice under all of it. */
function abc(): Project {
  const p = defaultProject()
  p.tracks = [
    { id: 'V1', kind: 'video', name: 'V1', clipIds: [] },
    { id: 'A1', kind: 'audio', name: 'A1', clipIds: [] }
  ]
  p.assets = [
    { id: 'film', kind: 'video', name: 'film.mp4', url: 'media://film', size: 1, duration: 100, width: 1920, height: 1080, hasAudio: false },
    { id: 'voice', kind: 'audio', name: 'voice.wav', url: 'media://voice', size: 1, duration: 100, width: 0, height: 0, hasAudio: true }
  ] as never
  const put = (id: string, trackId: string, assetId: string, start: number, inPoint: number, duration: number, extra: Partial<Clip> = {}) => {
    p.clips[id] = { id, assetId, trackId, start, inPoint, duration, transform: { ...T0 }, volume: 1, ...extra }
    p.tracks.find((t) => t.id === trackId)!.clipIds.push(id)
  }
  put('A', 'V1', 'film', 0, 10, 4, { transitionOut: { type: 'mix', duration: 1, to: 'B' } })
  put('B', 'V1', 'film', 4, 30, 2)
  put('C', 'V1', 'film', 6, 50, 4)
  put('v', 'A1', 'voice', 0, 0, 10)
  return p
}

const win = (p: Project, id: string) => outgoingTransitionWindow(p, p.clips[id])

test('the fixture: A dissolves into B, centred', () => {
  const p = abc()
  assert.deepEqual(win(p, 'A'), { duration: 1, type: 'mix', pre: 0.5, post: 0.5 })
})

test('trim: while A and B still meet, the transition stays; shorter than the window allows, it is clamped', () => {
  S().loadProject(abc())
  // B's tail: the meeting point is untouched.
  S().trimClipEnd('B', -0.5)
  assert.equal(win(S().project, 'A').duration, 1)
  assert.equal(S().project.clips.A.transitionOut?.to, 'B')
  // A's head trimmed to 0.3 s long: the window is clamped to the clip.
  S().setClipHead('A', 3.7, { start: 0, inPoint: 10, duration: 4 })
  const w = win(S().project, 'A')
  assert.ok(w.pre <= 0.3 + 1e-9, `pre ${w.pre}`)
})

test('trim: A\'s tail pulled back so the two no longer meet: the transition goes (no fade-out appears)', () => {
  S().loadProject(abc())
  S().trimClipEnd('A', -1)
  assert.deepEqual(win(S().project, 'A'), NO_TRANSITION)
  assert.equal(S().project.clips.A.transitionOut, undefined)
})

test('move: B moved away, the transition goes; A does not fade out', () => {
  S().loadProject(abc())
  S().moveClip('B', 20)
  assert.deepEqual(win(S().project, 'A'), NO_TRANSITION)
  assert.equal(S().project.clips.A.transitionOut, undefined)
})

test('split: A split, the right piece carries the transition into B; B split, A still goes into B\'s left piece', () => {
  S().loadProject(abc())
  S().splitClipAt('A', 2)
  const right = S().project.tracks[0].clipIds.map((id) => S().project.clips[id]).find((c) => c.start === 2)!
  assert.equal(S().project.clips.A.transitionOut, undefined)
  assert.deepEqual(outgoingTransitionWindow(S().project, right), { duration: 1, type: 'mix', pre: 0.5, post: 0.5 })
  S().loadProject(abc())
  S().splitClipAt('B', 5)
  assert.equal(win(S().project, 'A').duration, 1)
})

test('delete: B deleted, the transition goes', () => {
  S().loadProject(abc())
  S().deleteClips(['B'], false)
  assert.equal(S().project.clips.A.transitionOut, undefined)
})

test('ripple / silence cut: B cut out of the whole timeline, A does not dissolve into C', () => {
  const p = abc()
  const out = runCommand(p, commandByName('timeline.cutRanges'), { ranges: [[4, 6]] }).project
  assert.deepEqual(outgoingTransitionWindow(out, out.clips.A), NO_TRANSITION)
  assert.equal(out.clips.A.transitionOut, undefined)
  const quiet = runCommand(p, commandByName('silence.apply'), { regions: [{ clipId: 'v', start: 4, end: 6 }] }).project
  assert.equal(quiet.clips.A.transitionOut, undefined)
  // A cut inside B (B's left piece keeps its id and still meets A): kept.
  const inside = runCommand(p, commandByName('timeline.cutRanges'), { ranges: [[4.8, 5.2]] }).project
  assert.equal(outgoingTransitionWindow(inside, inside.clips.A).duration, 1)
})

test('paste and duplicate: the copy comes without the transition', () => {
  S().loadProject(abc())
  useStore.setState({ selectedClipIds: ['A'], linkAV: false })
  S().duplicateSelection()
  const copy = Object.values(S().project.clips).find((c) => c.id !== 'A' && c.inPoint === 10)!
  assert.equal(copy.transitionOut, undefined)
  S().loadProject(abc())
  useStore.setState({ selectedClipIds: ['A'], linkAV: false, currentTime: 30 })
  S().copySelection()
  S().pasteAtPlayhead()
  const pasted = Object.values(S().project.clips).find((c) => c.start === 30)!
  assert.equal(pasted.transitionOut, undefined)
  assert.equal(S().project.clips.A.transitionOut?.to, 'B')
})

test('a fade-out put on the last clip on purpose (to: null) stays a fade-out when a clip is put after it', () => {
  S().loadProject(abc())
  S().setTransitionOut('C', { type: 'mix', duration: 1 })
  assert.equal(S().project.clips.C.transitionOut?.to, null)
  assert.deepEqual(win(S().project, 'C'), { duration: 1, type: 'mix', pre: 1, post: 0 })
  S().addClipAt('film', 'V1', 10)
  assert.deepEqual(win(S().project, 'C'), { duration: 1, type: 'mix', pre: 1, post: 0 })
  // Set at a cut, it names the clip after it.
  S().setTransitionOut('B', { type: 'wipe', duration: 0.5 })
  assert.equal(S().project.clips.B.transitionOut?.to, 'C')
})

test('format 4: an old file gets `to` from the adjacency it was drawn with; it looks the same', () => {
  const p = abc()
  // As a format-3 file wrote it: no `to`; C fades out at the end.
  delete p.clips.A.transitionOut!.to
  p.clips.C.transitionOut = { type: 'fade', duration: 0.5 }
  const before = { a: win(p, 'A'), c: win(p, 'C') }
  const r = readProjectFile(JSON.stringify({ ...p, formatVersion: 3 }))
  assert.ok(CURRENT_FORMAT >= 4)
  assert.equal(r.project.clips.A.transitionOut?.to, 'B')
  assert.equal(r.project.clips.C.transitionOut?.to, null)
  assert.deepEqual({ a: win(r.project, 'A'), c: win(r.project, 'C') }, before)
  // Idempotent: read again (the file saved by this build), nothing changes.
  const again = readProjectFile(JSON.stringify({ ...r.project, formatVersion: 4 }))
  assert.deepEqual(again.project.clips, r.project.clips)
})

test('G5: the junction shows the window that is rendered, not the stored length centred', () => {
  const p = abc()
  // B is fresh at the head of its media: auto puts the whole second after the cut.
  p.clips.B.inPoint = 0
  const box = junctionBox(p, p.clips.A, 100)!
  assert.deepEqual(box, { left: (4 - 0) * 100, width: 100, pre: 0, post: 1 })
  // 1.2 s between two 0.5 s clips: the window is what fits.
  const q = abc()
  q.clips.A.duration = 0.5
  q.clips.B.start = 0.5
  q.clips.B.duration = 0.5
  q.clips.C.start = 1
  q.clips.A.transitionOut!.duration = 1.2
  const small = junctionBox(q, q.clips.A, 100)!
  assert.ok(small.width <= 100 + 1e-6, `width ${small.width}`)
  assert.equal(junctionBox(q, q.clips.C, 100), null)
})

test('decision 7: the timeline core reads its tolerances from timeline/eps.ts; the values are as they were', async () => {
  const { readFileSync } = await import('node:fs')
  const { join } = await import('node:path')
  const eps = await import('../renderer/src/timeline/eps')
  assert.deepEqual({ ...eps }, { EPS: 1e-6, KEY_EPS: 1e-4, MS_EPS: 0.001, EDGE_MIN: 0.05, JOIN_EPS: 0.06 })
  const { JOIN_EPS } = await import('../renderer/src/playback/join')
  assert.equal(JOIN_EPS, 0.06)
  const files = ['timeline/placement.ts', 'timeline/slice.ts', 'timeline/snapping.ts', 'timeline/transition-links.ts', 'timeline/junction-box.ts', 'playback/join.ts', 'playback/draw/timing.ts', 'commands/ops/ripple.ts', 'commands/ops/links.ts', 'commands/ops/split.ts', 'commands/clips.ts']
  for (const f of files) {
    const code = readFileSync(join(process.cwd(), 'src', 'renderer', 'src', f), 'utf8')
      .split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).map((l) => l.replace(/\s\/\/ .*$/, '')).join('\n')
    assert.doesNotMatch(code, /\b1e-6\b|\b1e-4\b|(?<![\w.])0\.001\b/, `${f} writes a tolerance out by hand`)
    // (0.06 and 0.05 are also effect sizes there; the join's own value is set once.)
    assert.doesNotMatch(code, /JOIN_EPS\s*=\s*0\.06/, `${f} sets JOIN_EPS itself`)
  }
})
