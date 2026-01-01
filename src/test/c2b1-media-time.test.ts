// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// Phase Ç2b.1, decision 4 (report L3 = 4A's K-2): every edit that keeps part
// of a clip keeps each kept frame where it was — for a clip played forwards,
// backwards and at twice the speed. Seven edits × three kinds of clip: split,
// head trim, tail trim, a whole-timeline cut, keep-range, the silence cut and
// freeze frame. For each kept timeline second t, the media shown at t before
// is the media shown at t's new place after.
import './dom-stub'
import assert from 'node:assert/strict'
import test from 'node:test'
import { defaultProject, type Clip, type Project } from '../renderer/src/types'
import { runCommand, commandByName } from '../renderer/src/commands'
import { useStore } from '../renderer/src/state/store'
import { inPointFor, mediaAtLocal } from '../renderer/src/timeline/media-time'

const KINDS: [string, Partial<Clip>][] = [
  ['forwards', {}],
  ['backwards', { reversed: true }],
  ['twice the speed', { speed: 2 }]
]

function project(extra: Partial<Clip>): Project {
  const p = defaultProject()
  p.tracks = [{ id: 'V1', kind: 'video', name: 'V1', clipIds: ['x'] }, { id: 'A1', kind: 'audio', name: 'A1', clipIds: [] }]
  p.assets = [{ id: 'vid', kind: 'video', name: 'vid.mp4', url: 'media://vid', size: 1, duration: 100, width: 1920, height: 1080, hasAudio: false } as never]
  p.clips.x = { id: 'x', assetId: 'vid', trackId: 'V1', start: 2, inPoint: 20, duration: 10, transform: { x: 960, y: 540, scale: 1, rotation: 0 }, volume: 1, ...extra }
  p.captions = []
  return p
}

/** The media on V1 at timeline second t (null: nothing there). */
function shown(p: Project, t: number): number | null {
  const c = Object.values(p.clips).find((x) => x.trackId === 'V1' && t > x.start + 1e-6 && t < x.start + x.duration - 1e-6)
  return c ? mediaAtLocal(c, t - c.start) : null
}

type Edit = { name: string; run: (p: Project) => Project; kept: [number, number][]; moved: (t: number) => number }

const cmd = (name: string, params: unknown) => (p: Project): Project => runCommand(p, commandByName(name), params).project

const EDITS: Edit[] = [
  { name: 'split', run: cmd('clip.split', { clipIds: ['x'], time: 5 }), kept: [[2, 12]], moved: (t) => t },
  { name: 'head trim', run: cmd('clip.trimHead', { clipId: 'x', edge: 4 }), kept: [[4, 12]], moved: (t) => t },
  { name: 'head trim that reveals', run: cmd('clip.trimHead', { clipId: 'x', edge: 1 }), kept: [[2, 12]], moved: (t) => t },
  { name: 'tail trim', run: cmd('clip.trimEnd', { clipId: 'x', delta: -3 }), kept: [[2, 9]], moved: (t) => t },
  { name: 'tail trim that reveals', run: cmd('clip.trimEnd', { clipId: 'x', delta: 2 }), kept: [[2, 12]], moved: (t) => t },
  { name: 'whole-timeline cut', run: cmd('timeline.cutRanges', { ranges: [[5, 7]] }), kept: [[2, 5], [7, 12]], moved: (t) => (t >= 7 ? t - 2 : t) },
  { name: 'keep-range', run: cmd('clip.keepRange', { clipId: 'x', range: [4, 9] }), kept: [[4, 9]], moved: (t) => t },
  { name: 'silence cut', run: cmd('silence.apply', { regions: [{ clipId: 'x', start: 5, end: 7 }] }), kept: [[2, 5], [7, 12]], moved: (t) => (t >= 7 ? t - 2 : t) },
  {
    name: 'freeze frame',
    run: (p) => {
      useStore.getState().loadProject(p)
      useStore.setState({ currentTime: 6, selectedClipIds: ['x'] })
      useStore.getState().insertFreezeFrame(2)
      return useStore.getState().project
    },
    kept: [[2, 12]],
    moved: (t) => (t > 6 ? t + 2 : t)
  }
]

for (const [kind, extra] of KINDS) {
  for (const e of EDITS) {
    test(`a kept frame stays where it was: ${e.name}, a clip played ${kind}`, () => {
      const before = project(extra)
      const after = e.run(before)
      let n = 0
      for (const [a, b] of e.kept) {
        for (let t = a + 0.013; t < b - 0.01; t += 0.237) {
          const was = shown(before, t)
          const now = shown(after, e.moved(t))
          assert.ok(was !== null && now !== null, `${t}: something shows`)
          assert.ok(Math.abs(was - now) < 1e-6, `${e.name} (${kind}) at ${t.toFixed(3)}: media ${was.toFixed(3)} before, ${now.toFixed(3)} after`)
          n++
        }
      }
      assert.ok(n > 10)
    })
  }
}

test('the freeze frame holds the frame shown at the playhead (a clip played backwards)', () => {
  const p = project({ reversed: true })
  useStore.getState().loadProject(p)
  useStore.setState({ currentTime: 6, selectedClipIds: ['x'] })
  useStore.getState().insertFreezeFrame(2)
  const hold = Object.values(useStore.getState().project.clips).find((c) => c.freeze !== undefined)!
  assert.equal(hold.freeze, mediaAtLocal(p.clips.x, 4))
})

test('inPointFor: forwards from the kept head, backwards from the kept tail, a held frame never moves', () => {
  const c = { inPoint: 10, duration: 8, speed: 2 }
  assert.equal(inPointFor(c, 3, 8), 16)
  assert.equal(inPointFor({ ...c, reversed: true }, 0, 5), 16)
  assert.equal(inPointFor({ ...c, reversed: true }, 3, 8), 10)
  assert.equal(inPointFor({ ...c, freeze: 12 }, 3, 8), 10)
})
