// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// Core polish, part B (CILA-B-PLAN.md): speed 0.1x – 100x through the store —
// the followers (subtitles with word times, work notes) land on the same
// moment of the media, "Keep pitch" is one undo step and travels with the
// clip, and "skip ahead" at speed stays inside the file.
import './dom-stub'
import assert from 'node:assert/strict'
import test from 'node:test'
import { useStore } from '../renderer/src/state/store'
import { checkProject, describeProblems } from '../renderer/src/model/check'
import { addNote, noteByNum } from '../renderer/src/notes/model'
import { keepsPitch } from '../renderer/src/timeline/speed'
import { serializeProject } from '../renderer/src/media/projectio'
import { repairProject } from '../renderer/src/model/repair'
import { defaultProject, type Caption, type Clip, type Project } from '../renderer/src/types'

const S = useStore.getState
const near = (a: number | undefined, b: number, what: string, eps = 1e-6): void => assert.ok(a !== undefined && Math.abs(a - b) <= eps, `${what}: ${a} is not ${b}`)
const sound = (): void => assert.equal(checkProject(S().project).length, 0, describeProblems(checkProject(S().project)))
const T = { x: 0, y: 0, scale: 1, rotation: 0 }

/** A voice recording on A1 (media 0–12 s at timeline 2 s) with two subtitle
 *  lines that carry word times. */
function voiceProject(extra: Partial<Clip> = {}): Project {
  const p = defaultProject()
  p.settings.fps = 30
  const a1 = p.tracks.find((t) => t.kind === 'audio')!
  p.assets.push({ id: 'voice', kind: 'audio', name: 'voice.wav', url: '', size: 1, duration: 30, width: 0, height: 0, hasAudio: true })
  p.clips.vc = { id: 'vc', assetId: 'voice', trackId: a1.id, start: 2, inPoint: 0, duration: 12, volume: 1, transform: T, ...extra }
  a1.clipIds.push('vc')
  const cue = (id: string, words: [string, number, number][]): Caption => ({ id, start: words[0][1], end: words[words.length - 1][2], text: words.map((w) => w[0]).join(' '), words: words.map(([text, start, end]) => ({ text, start, end })) })
  // (Times on the timeline: the recording's second + 2.)
  p.captions.push(cue('c1', [['one', 3, 3.5], ['two', 3.5, 4]]), cue('c2', [['three', 10, 10.6], ['four', 10.6, 11]]))
  return p
}
const cap = (id: string): Caption => S().project.captions.find((c) => c.id === id)!

test('subtitles follow a clip to 0.1x and to 100x: every word stays on its moment of the recording', () => {
  for (const speed of [0.1, 100]) {
    S().loadProject(voiceProject())
    S().setClipSpeed('vc', speed)
    sound()
    const c = S().project.clips.vc
    near(c.duration, 12 / speed, `x${speed}: length`)
    // Recording second m is now at start + m / speed.
    const at = (m: number): number => 2 + m / speed
    near(cap('c1').start, at(1), `x${speed}: line 1 starts`)
    near(cap('c1').words![1].start, at(1.5), 'its second word')
    near(cap('c2').start, at(8), `x${speed}: line 2 starts`)
    // (A line is never left shorter than 0.05 s: subtitles/follow.ts.)
    near(cap('c2').end, Math.max(at(8) + 0.05, at(9)), 'line 2 ends')
    near(cap('c2').words![1].end, at(9), 'its last word ends')
    // One undo step back to where they were.
    S().undo()
    near(cap('c2').start, 10, 'undo')
    near(S().project.clips.vc.duration, 12, 'undo: length')
  }
})

test('a work note follows a clip to 0.1x and to 100x', () => {
  for (const speed of [0.1, 100]) {
    const p = voiceProject()
    addNote(p, { start: 8, end: 11, kind: 'fix', text: 'here' })
    S().loadProject(p)
    S().setClipSpeed('vc', speed)
    sound()
    const n = noteByNum(S().project, 1)!
    // Recording seconds 6–9.
    near(n.start, 2 + 6 / speed, `x${speed}: note start`)
    near(n.end, 2 + 9 / speed, `x${speed}: note end`)
  }
})

test('"Keep pitch": on by default, off is stored, one undo step each way, and a cut keeps it', () => {
  S().loadProject(voiceProject())
  assert.equal(keepsPitch(S().project.clips.vc), true)
  assert.equal('keepPitch' in S().project.clips.vc, false, 'nothing stored while it is on')
  const depth = S().past.length
  S().setClipKeepPitch('vc', false)
  assert.equal(S().project.clips.vc.keepPitch, false)
  assert.equal(S().past.length, depth + 1, 'one undo step')
  // A split: both pieces follow the speed with their pitch.
  S().splitClipAt('vc', 6)
  const pieces = Object.values(S().project.clips).filter((c) => c.assetId === 'voice')
  assert.equal(pieces.length, 2)
  for (const c of pieces) assert.equal(c.keepPitch, false, `piece ${c.id}`)
  S().undo()
  S().setClipKeepPitch('vc', true)
  assert.equal('keepPitch' in S().project.clips.vc, false, 'on again: the field is gone')
  S().undo()
  assert.equal(S().project.clips.vc.keepPitch, false)
  S().undo()
  assert.equal(keepsPitch(S().project.clips.vc), true)
  sound()
})

test('skip ahead in a fast clip never runs past the end of its file', () => {
  // 100x: the clip shows the recording's seconds 0–30 in 0.3 s.
  S().loadProject(voiceProject({ duration: 0.3, speed: 100 }))
  S().skipAhead('vc', 2.1, 0.25)
  sound()
  for (const c of Object.values(S().project.clips)) assert.ok(c.inPoint + c.duration * (c.speed ?? 1) <= 30 + 1e-6, `${c.id} plays to ${c.inPoint + c.duration * (c.speed ?? 1)}`)
})

test('the project file: "Keep pitch" off and a speed of 100x or 0.1x are written and read back as they are', () => {
  const p = voiceProject({ duration: 0.12, speed: 100, keepPitch: false })
  p.clips.slow = { ...p.clips.vc, id: 'slow', start: 5, inPoint: 0, duration: 20, speed: 0.1 }
  delete (p.clips.slow as { keepPitch?: false }).keepPitch
  p.tracks.find((t) => t.kind === 'audio')!.clipIds.push('slow')
  const text = serializeProject(p)
  const read = JSON.parse(text) as Project
  // Opening mends what is damaged: nothing here is.
  const notes = repairProject(read)
  assert.deepEqual(notes, [], JSON.stringify(notes))
  assert.equal(read.clips.vc.speed, 100)
  assert.equal(read.clips.vc.keepPitch, false)
  assert.equal(read.clips.vc.duration, 0.12)
  assert.equal(read.clips.slow.speed, 0.1)
  assert.equal('keepPitch' in read.clips.slow, false, 'on: nothing written')
  // A project written before this part has no such field: its clips keep their pitch.
  assert.equal(keepsPitch(read.clips.slow), true)
})
