// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
import assert from 'node:assert/strict'
import test from 'node:test'
import { defaultProject, type Caption, type Clip, type Project } from '../renderer/src/types'
import { followClipEdits } from '../renderer/src/subtitles/follow'

Object.defineProperty(globalThis, 'document', {
  configurable: true,
  value: { createElement: () => ({ width: 0, height: 0, getContext: () => null }) }
})
Object.defineProperty(globalThis, 'localStorage', {
  configurable: true,
  value: { getItem: () => null, setItem: () => {} }
})

const near = (a: number | undefined, b: number, msg?: string): void => assert.ok(a !== undefined && Math.abs(a - b) < 1e-6, `${msg ?? ''} ${a} ≠ ${b}`)

/** A project with a voice recording on A1 (12 s of it from 0 s) and three
 *  subtitles with word times, as a transcription leaves them. */
function voiceProject(): Project {
  const p = defaultProject()
  const a1 = p.tracks.find((t) => t.kind === 'audio')!
  p.assets.push({ id: 'voice', kind: 'audio', name: 'voice.wav', url: '', size: 1, duration: 30, width: 0, height: 0, hasAudio: true })
  const clip: Clip = { id: 'vc', assetId: 'voice', trackId: a1.id, start: 0, inPoint: 0, duration: 12, volume: 1, transform: { x: 0, y: 0, scale: 1, rotation: 0 } }
  p.clips[clip.id] = clip
  a1.clipIds.push(clip.id)
  const cue = (id: string, words: [string, number, number][]): Caption => ({
    id,
    start: words[0][1],
    end: words[words.length - 1][2],
    text: words.map((w) => w[0]).join(' '),
    words: words.map(([text, start, end]) => ({ text, start, end }))
  })
  p.captions.push(
    cue('c1', [['Dedenle', 0.5, 1.1], ['nenenin', 1.1, 1.6], ['bir', 1.6, 1.9]]),
    cue('c2', [['araya', 4.0, 4.5], ['gelmesini', 4.5, 5.2]]),
    cue('c3', [['engellemek', 8.0, 8.8], ['için', 8.8, 9.2]])
  )
  // A text layer (a title) is a graphic: it never follows the sound.
  p.captions.push({ id: 'title', start: 4, end: 6, text: 'Title', manual: true, layer: 1 })
  return p
}

async function store() {
  const { useStore } = await import('../renderer/src/state/store')
  return useStore
}

const cap = (p: Project, id: string): Caption => p.captions.find((c) => c.id === id)!

test('captions follow a moved voice clip, and undo puts them back', async () => {
  const S = await store()
  S.getState().loadProject(voiceProject())
  S.getState().moveClip('vc', 3)
  const p = S.getState().project
  near(cap(p, 'c1').start, 3.5)
  near(cap(p, 'c1').words![1].start, 4.1)
  near(cap(p, 'c3').end, 12.2)
  assert.equal(cap(p, 'c1').soundClip, 'vc')
  // The title stays where it was put.
  near(cap(p, 'title').start, 4)
  S.getState().undo()
  const back = S.getState().project
  near(cap(back, 'c1').start, 0.5)
  near(cap(back, 'c3').words![0].start, 8)
  S.getState().redo()
  near(cap(S.getState().project, 'c2').start, 7)
})

test('trimming the head of the voice drops the words cut away and keeps the rest in place', async () => {
  const S = await store()
  S.getState().loadProject(voiceProject())
  // Head trimmed to 1.3 s (not ripple: the clip's start moves with its edge).
  S.getState().setClipHead('vc', 1.3, { start: 0, duration: 12, inPoint: 0 })
  const p = S.getState().project
  near(p.clips.vc.start, 1.3)
  const c1 = cap(p, 'c1')
  assert.deepEqual(c1.words!.map((w) => w.text), ['nenenin', 'bir'])
  assert.equal(c1.text, 'nenenin bir')
  near(c1.words![0].start, 1.1)
  near(cap(p, 'c2').start, 4)
  // Trimming the tail drops the last line's words past the new end.
  S.getState().trimClipEnd('vc', -2.2) // ends at 9.8 → 'için' (8.8–9.2) stays
  S.getState().trimClipEnd('vc', -1.0) // ends at 8.8 → 'için' is gone
  const q = S.getState().project
  near(q.clips.vc.start + q.clips.vc.duration, 8.8)
  assert.deepEqual(cap(q, 'c3').words!.map((w) => w.text), ['engellemek'])
})

test('a split keeps both halves in place; moving the right half takes its words', async () => {
  const S = await store()
  S.getState().loadProject(voiceProject())
  S.getState().splitClipAt('vc', 6)
  const p = S.getState().project
  const right = Object.values(p.clips).find((c) => c.id !== 'vc' && c.assetId === 'voice')!
  near(cap(p, 'c3').start, 8)
  near(cap(p, 'c2').start, 4)
  S.getState().moveClip(right.id, 10)
  const q = S.getState().project
  near(cap(q, 'c3').start, 12)
  near(cap(q, 'c3').words![1].end, 13.2)
  assert.equal(cap(q, 'c3').soundClip, right.id)
  near(cap(q, 'c2').start, 4) // the left half did not move
})

test('a split through a line keeps it whole; moving one half sends the halves apart as two subtitles', async () => {
  const S = await store()
  S.getState().loadProject(voiceProject())
  // Split between 'nenenin' and 'bir': the line stays one subtitle.
  S.getState().splitClipAt('vc', 1.6)
  assert.equal(S.getState().project.captions.filter((c) => !c.manual).length, 3)
  assert.equal(cap(S.getState().project, 'c1').text, 'Dedenle nenenin bir')
  // Then the right part on by 5 s.
  const right = Object.values(S.getState().project.clips).find((c) => c.id !== 'vc' && c.assetId === 'voice')!
  S.getState().moveClip(right.id, 6.6)
  const subs = S.getState().project.captions.filter((c) => !c.manual)
  const left = cap(S.getState().project, 'c1')
  assert.deepEqual(left.words!.map((w) => w.text), ['Dedenle', 'nenenin'])
  const moved = subs.find((c) => c.words?.[0].text === 'bir')!
  assert.ok(moved && moved.id !== 'c1')
  near(moved.start, 6.6)
  assert.equal(moved.text, 'bir')
})

test('ripple-deleting a voice clip takes its subtitles and pulls the next clip’s back with it', async () => {
  const S = await store()
  const project = voiceProject()
  // A second recording right after the first, with its own line.
  const a1 = project.tracks.find((t) => t.kind === 'audio')!
  project.assets.push({ id: 'voice2', kind: 'audio', name: 'voice2.wav', url: '', size: 1, duration: 10, width: 0, height: 0, hasAudio: true })
  project.clips.vc2 = { id: 'vc2', assetId: 'voice2', trackId: a1.id, start: 12, inPoint: 0, duration: 6, volume: 1, transform: { x: 0, y: 0, scale: 1, rotation: 0 } }
  a1.clipIds.push('vc2')
  project.captions.push({ id: 'c4', start: 13, end: 14, text: 'sonra', words: [{ text: 'sonra', start: 13, end: 14 }] })
  // (No title over it: a title wholly inside the deleted span is material
  // of its own, and the ripple delete would leave the gap: Ç2b patch, item 3.)
  project.captions = project.captions.filter((c) => c.id !== 'title')
  S.getState().loadProject(project)
  S.getState().deleteClips(['vc'], true)
  const p = S.getState().project
  assert.equal(p.clips.vc2.start, 0)
  assert.deepEqual(p.captions.filter((c) => !c.manual).map((c) => c.id), ['c4'])
  near(cap(p, 'c4').start, 1)
  near(cap(p, 'c4').words![0].end, 2)
  S.getState().undo()
  assert.equal(S.getState().project.captions.filter((c) => !c.manual).length, 4)
})

test('a sped-up voice clip squeezes its word times with it', async () => {
  const S = await store()
  const project = voiceProject()
  project.clips.vc.start = 2
  for (const c of project.captions) {
    if (c.manual) continue
    c.start += 2
    c.end += 2
    for (const w of c.words ?? []) {
      w.start += 2
      w.end += 2
    }
  }
  S.getState().loadProject(project)
  S.getState().setClipSpeed('vc', 2)
  const p = S.getState().project
  near(p.clips.vc.duration, 6)
  // 8.0 s into the recording → 4.0 s after the clip's start at double speed.
  near(cap(p, 'c3').start, 6)
  near(cap(p, 'c3').words![1].start, 6.4)
  near(cap(p, 'c1').start, 2.25)
})

test('a music bed under the words does not take them along', async () => {
  const S = await store()
  const project = voiceProject()
  const a2 = { id: 'a2', kind: 'audio' as const, name: 'A2', clipIds: ['bed'] }
  project.tracks.push(a2)
  project.assets.push({ id: 'music', kind: 'audio', name: 'bed.mp3', url: '', size: 1, duration: 60, width: 0, height: 0, hasAudio: true })
  project.clips.bed = { id: 'bed', assetId: 'music', trackId: 'a2', start: 0, inPoint: 0, duration: 20, volume: 0.3, transform: { x: 0, y: 0, scale: 1, rotation: 0 } }
  S.getState().loadProject(project)
  S.getState().moveClip('bed', 4)
  near(cap(S.getState().project, 'c1').start, 0.5)
  S.getState().moveClip('vc', 1)
  near(cap(S.getState().project, 'c1').start, 1.5)
})

test('a whole-timeline ripple cut moves the subtitles once, not twice', async () => {
  const S = await store()
  S.getState().loadProject(voiceProject())
  S.getState().rippleDelete(2, 3)
  const p = S.getState().project
  near(cap(p, 'c2').start, 3)
  near(cap(p, 'c3').words![1].end, 8.2)
})

test('followClipEdits leaves a project alone when no clip moved', () => {
  const before = voiceProject()
  const after = structuredClone(before)
  after.captions[0].text = 'changed'
  followClipEdits(before, after)
  assert.equal(after.captions[0].text, 'changed')
  near(after.captions[1].start, 4)
})
