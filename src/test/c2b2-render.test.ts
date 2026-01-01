// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// Phase Ç2b.2, decisions 3, 4 and 6 (report G3, G4, G6): what a transition
// does to the rest of the clip. An entrance or exit animation under a
// transition is left out whole (the pose is the same on both sides of the
// window's edge, ±1 ms); a linked or extracted sound crosses with its picture
// (the same gain envelope as the picture's own sound); a transition sound
// plays only where something transitions, on a track that is heard.
import './dom-stub'
import assert from 'node:assert/strict'
import test from 'node:test'
import { defaultProject, type Clip, type Project } from '../renderer/src/types'
import { clipVisualPoseAt } from '../renderer/src/playback/draw/motion'
import { outgoingTransitionWindow } from '../renderer/src/playback/draw/timing'

const T0 = { x: 960, y: 540, scale: 1, rotation: 0 }

/** V1: A 0–4, B 4–8 (plenty of media round both), A → B a 0.5 s dissolve,
 *  centred (0.25 s each side). B fades in over 0.5 s, A slides out over 0.5 s. */
function pair(): Project {
  const p = defaultProject()
  p.tracks = [{ id: 'V1', kind: 'video', name: 'V1', clipIds: ['A', 'B'] }, { id: 'A1', kind: 'audio', name: 'A1', clipIds: [] }]
  p.assets = [{ id: 'film', kind: 'video', name: 'film.mp4', url: 'media://film', size: 1, duration: 100, width: 1920, height: 1080, hasAudio: true }] as never
  p.clips.A = { id: 'A', assetId: 'film', trackId: 'V1', start: 0, inPoint: 10, duration: 4, transform: { ...T0 }, volume: 1, anim: { out: 'slide-left', outDur: 0.5 }, transitionOut: { type: 'mix', duration: 0.5, to: 'B' } } as Clip
  p.clips.B = { id: 'B', assetId: 'film', trackId: 'V1', start: 4, inPoint: 30, duration: 4, transform: { ...T0 }, volume: 1, anim: { in: 'fade', inDur: 0.5 } } as Clip
  return p
}

test('G3: the entrance under a transition is left out whole: the pose is the same either side of the window\'s end (±1 ms)', () => {
  const p = pair()
  const w = outgoingTransitionWindow(p, p.clips.A)
  assert.equal(w.post, 0.25)
  const edge = p.clips.B.start + w.post
  const inside = clipVisualPoseAt(p, p.clips.B, edge - 0.001)
  const outside = clipVisualPoseAt(p, p.clips.B, edge + 0.001)
  assert.ok(Math.abs(inside.animation.alpha - outside.animation.alpha) < 1e-3, `alpha ${inside.animation.alpha} → ${outside.animation.alpha}`)
  assert.ok(Math.abs(inside.transform.x - outside.transform.x) < 0.5 && Math.abs(inside.transform.y - outside.transform.y) < 0.5)
})

test('G3: the exit under a transition is left out whole: the pose is the same either side of the window\'s start (±1 ms)', () => {
  const p = pair()
  const w = outgoingTransitionWindow(p, p.clips.A)
  const edge = p.clips.A.start + p.clips.A.duration - w.pre
  const before = clipVisualPoseAt(p, p.clips.A, edge - 0.001)
  const after = clipVisualPoseAt(p, p.clips.A, edge + 0.001)
  assert.ok(Math.abs(before.transform.x - after.transform.x) < 0.5, `x ${before.transform.x} → ${after.transform.x}`)
  assert.ok(Math.abs(before.animation.alpha - after.animation.alpha) < 1e-3)
  // With no transition, the entrance still plays (nothing else changed).
  const q = pair()
  delete q.clips.A.transitionOut
  assert.ok(clipVisualPoseAt(q, q.clips.B, 4.1).animation.alpha < 0.9)
})

/** V1 A 0–4 → B 4–8 (a 1 s dissolve), their sounds extracted onto A1 (a, b),
 *  each pair linked. */
function linkedPair(): Project {
  const p = pair()
  delete p.clips.A.anim
  delete p.clips.B.anim
  p.clips.A.transitionOut = { type: 'mix', duration: 1, to: 'B' }
  Object.assign(p.clips.A, { linkId: 'L1', audioExtracted: true })
  Object.assign(p.clips.B, { linkId: 'L2', audioExtracted: true })
  p.assets.push({ id: 'snd', kind: 'audio', name: 'snd.wav', url: 'media://snd', size: 1, duration: 100, width: 0, height: 0, hasAudio: true } as never)
  p.clips.a = { id: 'a', assetId: 'snd', trackId: 'A1', start: 0, inPoint: 10, duration: 4, transform: { ...T0 }, volume: 1, linkId: 'L1' }
  p.clips.b = { id: 'b', assetId: 'snd', trackId: 'A1', start: 4, inPoint: 30, duration: 4, transform: { ...T0 }, volume: 1, linkId: 'L2' }
  p.tracks[1].clipIds = ['a', 'b']
  return p
}

test('G4: a linked or extracted sound crosses with its picture: the gain envelope on the sound clip is the picture clip\'s', async () => {
  const { soundWindows, incomingTransitionInfo } = await import('../renderer/src/playback/draw/timing')
  const { transitionAudioFade } = await import('../renderer/src/export/audio-window')
  const { transitionGain } = await import('../renderer/src/playback/engine-rules')
  const p = linkedPair()
  const env = (c: Clip, w: { out: ReturnType<typeof outgoingTransitionWindow>; in: ReturnType<typeof outgoingTransitionWindow> }, t: number) => transitionAudioFade(t, c, w.out, w.in, 30)
  const picA = { out: outgoingTransitionWindow(p, p.clips.A), in: incomingTransitionInfo(p, p.clips.A) }
  const picB = { out: outgoingTransitionWindow(p, p.clips.B), in: incomingTransitionInfo(p, p.clips.B) }
  assert.ok(picA.out.post > 0, 'the picture crosses after the cut')
  const sa = soundWindows(p, p.clips.a)
  const sb = soundWindows(p, p.clips.b)
  let crossed = 0
  for (let t = 3; t <= 5.0001; t += 0.05) {
    assert.ok(Math.abs(env(p.clips.a, sa, t) - env(p.clips.A, picA, t)) < 1e-9, `a at ${t.toFixed(2)}: ${env(p.clips.a, sa, t)} vs ${env(p.clips.A, picA, t)}`)
    assert.ok(Math.abs(env(p.clips.b, sb, t) - env(p.clips.B, picB, t)) < 1e-9, `b at ${t.toFixed(2)}`)
    // (The preview's rule gives the same.)
    assert.ok(Math.abs(transitionGain(t, 4, 8, sb.in, sb.out) - transitionGain(t, 4, 8, picB.in, picB.out)) < 1e-9)
    if (env(p.clips.a, sa, t) > 0 && env(p.clips.a, sa, t) < 1) crossed++
  }
  assert.ok(crossed > 5, 'the sound fades over the window, not at a hard cut')
  // A sound next to one that is not the picture's partner does not cross.
  const q = linkedPair()
  q.clips.b.linkId = 'other'
  assert.equal(soundWindows(q, q.clips.a).out.duration, 0)
})

test('G7: a compound clip keeps the transitions between its children: at the old cut both are drawn, as a mix', async () => {
  const { nestedProject } = await import('../renderer/src/playback/draw/clip')
  const { renderList } = await import('../renderer/src/playback/draw/timing')
  const p = pair()
  delete p.clips.A.anim
  delete p.clips.B.anim
  p.clips.A.transitionOut = { type: 'mix', duration: 1, to: 'B' }
  const kids = [p.clips.A, p.clips.B]
  const k: Clip = { id: 'k', assetId: '', nested: { clips: kids }, trackId: 'V1', start: 0, inPoint: 0, duration: 8, transform: { ...T0 }, volume: 1 }
  const q = defaultProject()
  q.assets = p.assets
  q.tracks = [{ id: 'V1', kind: 'video', name: 'V1', clipIds: ['k'] }]
  q.clips = { k }
  const inner = nestedProject(q, k)
  const at = (t: number) => renderList(inner, t).map((e) => `${e.clip.id}${e.mix ? ':' + e.mix : ''}`).join(' ')
  assert.equal(at(4), 'B:in A:out')
  assert.equal(at(3.6), 'B:in A:out')
  assert.equal(at(4.4), 'B:in A:out')
  assert.equal(at(2), 'A')
  assert.equal(at(6), 'B')
})

test('G6: a transition sound plays only where something transitions, and not on a track that is not heard', async () => {
  const { timelineSfxEvents } = await import('../renderer/src/audio/timeline-sfx')
  const base = (): Project => {
    const p = pair()
    delete p.clips.A.anim
    delete p.clips.B.anim
    // (A transition sounds only when given a sound: DENEME-3, V item 2.)
    p.clips.A.transitionOut = { ...p.clips.A.transitionOut!, sfx: 1 }
    p.transitionSfx = 0.7
    return p
  }
  assert.ok(timelineSfxEvents(base()).length > 0, 'a dissolve between two clips breathes')
  // A speed ramp on the last clip goes into nothing: no whoosh.
  const ramp = base()
  delete ramp.clips.A.transitionOut
  ramp.clips.B.transitionOut = { type: 'speed-ramp', duration: 0.6, to: null, sfx: 1 }
  assert.equal(timelineSfxEvents(ramp).length, 0)
  // A muted track, or one left out by a solo, makes no transition sounds.
  const muted = base()
  muted.tracks[0].muted = true
  assert.equal(timelineSfxEvents(muted).length, 0)
  const solo = base()
  solo.tracks[1].solo = true
  assert.equal(timelineSfxEvents(solo).length, 0)
})

test('G8: one TRANSITION_LIMITS (0.05–5 s) for the commands, the presets, the inspector and the junction; clip.setFades says it is sound only', async () => {
  const { readFileSync } = await import('node:fs')
  const { join } = await import('node:path')
  const { TRANSITION_LIMITS } = await import('../renderer/src/timeline/transition-links')
  const { commandByName, runCommand } = await import('../renderer/src/commands')
  assert.deepEqual({ ...TRANSITION_LIMITS }, { min: 0.05, max: 5 })
  const set = commandByName('clip.setTransition').params.json as { properties: { transition: { anyOf?: { properties?: { duration?: { minimum: number; maximum: number } } }[]; properties?: { duration?: { minimum: number; maximum: number } } } } }
  const dur = JSON.stringify(set).match(/"duration":\{[^}]*\}/)![0]
  assert.match(dur, /"minimum":0\.05/)
  assert.match(dur, /"maximum":5/)
  // The presets no longer clamp to 0.2–2 s.
  const p = pair()
  delete p.clips.A.transitionOut
  const out = runCommand(p, commandByName('transitions.preset'), { type: 'wipe', duration: 3 }).project
  assert.equal(out.clips.A.transitionOut?.duration, 3)
  const short = runCommand(p, commandByName('transitions.preset'), { type: 'wipe', duration: 0.1 }).project
  assert.equal(short.clips.A.transitionOut?.duration, 0.1)
  // The inspector's slider and the junction's resize read the same limits.
  const src = (f: string) => readFileSync(join(process.cwd(), 'src', 'renderer', 'src', 'components', f), 'utf8')
  // (Core polish T: the Inspector's transition is components/inspector/transition-section.tsx.)
  assert.match(src('inspector/transition-section.tsx'), /min=\{TRANSITION_LIMITS\.min\}\s*max=\{TRANSITION_LIMITS\.max\}/)
  assert.match(src('timeline/transitions.tsx'), /Math\.max\(TRANSITION_LIMITS\.min, Math\.min\(TRANSITION_LIMITS\.max,/)
  assert.match(commandByName('clip.setFades').summary, /sound only/)
})
