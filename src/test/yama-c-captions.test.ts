// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// Audit patch (yama-c), Y1: a subtitle line whose clip went through a high
// speed (its length / 0.05 s: ≈ 22x for a 1.1 s line) was floored to 0.05 s
// on the timeline; the next speed change turned that floor into media time
// and carried it, so a line slowed back down hung seconds past its last word,
// over the next line, and the next trim / curve / cut left it behind outside
// its clip (and the film ran on to it: projectDuration counts subtitles).
import './dom-stub'
import assert from 'node:assert/strict'
import test from 'node:test'
import { useStore } from '../renderer/src/state/store'
import { defaultProject, type Caption, type Clip, type Project } from '../renderer/src/types'
import { lineProblems } from './oracle/lines'

const S = useStore.getState
const T = { x: 960, y: 540, scale: 1, rotation: 0 }

function base(opts: { words?: boolean; music?: boolean } = {}): Project {
  const p = defaultProject()
  p.settings.fps = 30
  p.tracks = [
    { id: 'V1', kind: 'video', name: 'V1', clipIds: ['a'] },
    { id: 'A1', kind: 'audio', name: 'A1', clipIds: ['s'] },
    { id: 'A2', kind: 'audio', name: 'Music', clipIds: opts.music ? ['m'] : [] }
  ]
  p.assets = [
    { id: 'vid', kind: 'video', name: 'vid.mp4', url: 'media://vid', size: 1, duration: 120, width: 1920, height: 1080, hasAudio: false } as never,
    { id: 'snd', kind: 'audio', name: 'snd.wav', url: 'media://snd', size: 1, duration: 120, width: 0, height: 0, hasAudio: true } as never,
    { id: 'mus', kind: 'audio', name: 'mus.wav', url: 'media://mus', size: 1, duration: 300, width: 0, height: 0, hasAudio: true } as never
  ]
  p.clips.a = { id: 'a', assetId: 'vid', trackId: 'V1', start: 0, inPoint: 20, duration: 40, transform: T, volume: 1, linkId: 'L' } as Clip
  p.clips.s = { id: 's', assetId: 'snd', trackId: 'A1', start: 0, inPoint: 20, duration: 40, transform: T, volume: 1, linkId: 'L' } as Clip
  if (opts.music) p.clips.m = { id: 'm', assetId: 'mus', trackId: 'A2', start: 0, inPoint: 0, duration: 30, transform: T, volume: 1 } as Clip
  const caps: Caption[] = []
  for (let i = 0; i < 18; i++) {
    const st = 1 + i * 2.1
    const w = [{ text: `w${i}a`, start: st, end: st + 0.5 }, { text: `w${i}b`, start: st + 0.6, end: st + 1.1 }]
    caps.push({ id: `c${i}`, start: st, end: st + 1.1, text: `w${i}a w${i}b`, ...(opts.words === false ? {} : { words: w }), soundClip: 's' } as Caption)
  }
  p.captions = caps
  return p
}

/** What must hold after every edit (oracle/lines.ts: the fuzz checks the same). */
const problems = (p: Project): string[] => lineProblems(p, { tail: true }).map((x) => x.detail)

type Step = [string, ...unknown[]]
function run(p: Project, steps: Step[]): string[] {
  S().loadProject(p)
  useStore.setState({ linkAV: true })
  const found: string[] = []
  for (const [fn, ...args] of steps) {
    ;(S() as unknown as Record<string, (...a: unknown[]) => void>)[fn](...args)
    for (const x of problems(S().project)) found.push(`after ${fn} ${JSON.stringify(args)}: ${x}`)
  }
  return found
}

const same = (a: Caption[], b: Caption[]): void => {
  assert.equal(a.length, b.length)
  a.forEach((c, i) => {
    assert.equal(c.id, b[i].id)
    assert.ok(Math.abs(c.start - b[i].start) < 1e-6 && Math.abs(c.end - b[i].end) < 1e-6, `${c.id} ${c.start}–${c.end}, was ${b[i].start}–${b[i].end}`)
    ;(c.words ?? []).forEach((w, j) => assert.ok(Math.abs(w.start - b[i].words![j].start) < 1e-6 && Math.abs(w.end - b[i].words![j].end) < 1e-6))
  })
}

test('Y1: 100x and back to 1x gives every line back where it was (no line grows past its last word)', () => {
  const p = base()
  assert.deepEqual(run(p, [['setClipSpeed', 'a', 100], ['setClipSpeed', 'a', 1]]), [])
  same(S().project.captions, p.captions)
})

test('Y1: the speed slider dragged 1 → 30 → 1 (every step an edit) leaves the lines as they were', () => {
  const p = base()
  const up = [1.5, 2, 3, 5, 8, 10, 15, 20, 25, 30]
  const steps: Step[] = [...up, ...[...up].reverse().slice(1), 1].map((v) => ['setClipSpeed', 'a', v])
  assert.deepEqual(run(p, steps), [])
  same(S().project.captions, p.captions)
  assert.deepEqual(run(base(), [2, 10, 30, 10, 2, 1].map((v) => ['setClipSpeed', 'a', v])), [])
  same(S().project.captions, p.captions)
})

test('Y1: after a high speed, a trim, a curve and a cut keep every line on its clip and the film its length', () => {
  const chains: Step[][] = [
    [['setClipSpeed', 'a', 10], ['rippleDelete', 2.96, 4, { keepTracks: ['A2'], endBeds: true }], ['setClipSpeed', 'a', 100], ['setClipSpeed', 'a', 0.1], ['setClipSpeedCurve', 'a', { points: [{ u: 0, v: 50 }, { u: 0.62, v: 0.5 }, { u: 1, v: 0.1 }] }]],
    [['setClipSpeed', 'a', 50], ['setClipSpeed', 'a', 1], ['trimClipEnd', 'a', -12], ['setClipSpeedCurve', 'a', { points: [{ u: 0, v: 0.5 }, { u: 1, v: 2 }] }]],
    [['setClipSpeed', 'a', 100], ['setClipSpeed', 'a', 0.5], ['rippleDelete', 20, 24, { keepTracks: ['A2'], endBeds: false }], ['trimClipEnd', 'a', -5]],
    [['setClipSpeedCurve', 'a', { points: [{ u: 0, v: 50 }, { u: 1, v: 50 }] }], ['setClipSpeedCurve', 'a', null], ['rippleDelete', 5, 7]],
    [['setClipSpeed', 'a', 30], ['splitClipAt', 'a', 0.5], ['setClipSpeed', 'a', 1], ['rippleDelete', 3, 3.5, { keepTracks: ['A2'], endBeds: true }]]
  ]
  for (const chain of chains) assert.deepEqual(run(base({ music: true }), chain), [], JSON.stringify(chain))
})

test('Y1: a line without word times floored at 100x does not grow over the next one at 1x', () => {
  const p = base({ words: false })
  assert.deepEqual(run(p, [['setClipSpeed', 'a', 100], ['setClipSpeed', 'a', 1]]), [])
  assert.deepEqual(run(base({ words: false, music: true }), [['setClipSpeed', 'a', 40], ['setClipSpeed', 'a', 2], ['trimClipEnd', 'a', -4]]), [])
})
