// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// The undo rule in one place (phase Ç2a.1, decision 4; report D2 / P1): with
// no window open, every change is an undo step of its own and clears the
// redo stack; only the view (a row's height, the snapping) stays out of the
// history and is kept by undo and redo. For every track flag and every field
// of the subtitle style: change → Ctrl+Z → only that came back → Ctrl+Y →
// applied again.
import { fixture, hash, resetWorld, tick } from './undo-fixture'
import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { useStore } from '../renderer/src/state/store'
import type { CaptionStyle, Project } from '../renderer/src/types'

const S = useStore.getState
const fresh = (): void => {
  resetWorld()
  S().loadProject(fixture())
}

/** One edit first (a split), then the change: undo takes back the change
 *  alone, redo puts it back, and each is one step. */
function oneStep(what: string, change: () => void): void {
  fresh()
  S().splitClipAt('cb', 15)
  tick(5000)
  const afterSplit = hash(S().project)
  const steps = S().past.length
  change()
  const changed = hash(S().project)
  assert.notEqual(changed, afterSplit, `${what}: it changed something`)
  assert.equal(S().past.length, steps + 1, `${what}: one step of its own`)
  assert.equal(S().future.length, 0)
  S().undo()
  assert.equal(hash(S().project), afterSplit, `${what}: Ctrl+Z took back that change alone (the split stays)`)
  S().redo()
  assert.equal(hash(S().project), changed, `${what}: Ctrl+Y applied it again`)
  // And a recorded change clears the redo stack.
  S().undo()
  tick(5000)
  change()
  assert.equal(S().future.length, 0, `${what}: the change cleared the redo stack`)
}

test('track flags: hide, mute, solo and lock are each an undo step of their own', () => {
  for (const flag of ['hidden', 'muted', 'solo', 'locked'] as const) {
    for (const trackId of ['v2', 'a2']) oneStep(`${trackId} ${flag}`, () => S().setTrackFlags(trackId, { [flag]: !S().project.tracks.find((t) => t.id === trackId)![flag] }))
  }
})

/** A value of every field of CaptionStyle, unlike the default. */
const STYLE: Required<CaptionStyle> = {
  fontFamily: 'Georgia', fontSize: 72, fontWeight: 400, italic: true, color: '#ffcc00', outlineColor: '#ff0000', outlineWidth: 3,
  bgColor: '#112233', bgOpacity: 0.5, posY: 0.5, posX: 0.3, maxLineChars: 40, uppercase: true,
  boil: { enabled: true, amount: 1, fps: 10 },
  popup: { enabled: true, duration: 0.2, intensity: 1, style: 'fade' },
  wordsPerCue: 3, pauseThreshold: 0.4,
  shadow: { enabled: true, color: '#000000', blur: 6, dx: 2, dy: 2 },
  lineHeight: 1.5, letterSpacing: 2, align: 'left', rotate: 0.1, bgRadius: 8, bgPadX: 0.5, bgPadY: 0.3,
  bgBorder: { color: '#ffffff', width: 2 },
  marker: { enabled: true, color: '#ffff00', duration: 0.3 },
  keyMark: { enabled: true, amount: 'some', color: '#ff00ff', duration: 0.3 },
  fitWidth: 0.8,
  gradient: { enabled: true, from: '#ff0000', to: '#0000ff', angle: 45 },
  blend: 'screen',
  highlight: { enabled: true, color: '#00ff00', scale: 1.2 },
  emoji: { enabled: true, rules: 'money=$' }
}

test('the list of style fields here is every field of CaptionStyle (read from types.ts)', () => {
  const src = readFileSync(join(process.cwd(), 'src', 'renderer', 'src', 'types.ts'), 'utf8')
  const body = /export interface CaptionStyle \{([\s\S]*?)\n\}/.exec(src)![1]
  // Top-level fields only: two spaces in, a name, an optional mark, a colon.
  const fields = [...body.matchAll(/^ {2}(\w+)\??:/gm)].map((m) => m[1]).sort()
  assert.deepEqual(Object.keys(STYLE).sort(), fields)
})

test('every subtitle style field (main and Shorts) is an undo step of its own', () => {
  for (const [k, v] of Object.entries(STYLE)) {
    oneStep(`style ${k}`, () => S().setCaptionStyle({ [k]: v } as Partial<CaptionStyle>))
    oneStep(`Shorts style ${k}`, () => S().setCaptionStyleShorts({ [k]: v } as Partial<CaptionStyle>))
  }
})

test('a run of one continuous change (a colour being picked, a size typed) is one step; two clicks of a switch are two', () => {
  fresh()
  const steps = S().past.length
  for (const c of ['#111111', '#222222', '#333333']) (S().setCaptionStyle({ color: c }), tick(100))
  assert.equal(S().past.length, steps + 1, 'the colour picker: one step')
  tick(5000)
  S().setCaptionStyle({ uppercase: true })
  tick(100)
  S().setCaptionStyle({ uppercase: false })
  assert.equal(S().past.length, steps + 3, 'a switch clicked twice: two steps')
  // A pause breaks the run.
  tick(5000)
  S().setClipVolume('m1', 0.4)
  tick(2000)
  S().setClipVolume('m1', 0.3)
  assert.equal(S().past.length, steps + 5)
})

test('the view is not in the history: a row height and the snapping make no step, keep the redo stack and stay as they are through undo and redo', () => {
  fresh()
  S().splitClipAt('cb', 15)
  S().undo()
  const redo = S().future.length
  const steps = S().past.length
  S().setTrackHeight('v1', 120)
  S().setSnap({ enabled: false })
  assert.equal(S().past.length, steps, 'no step')
  assert.equal(S().future.length, redo, 'the redo stack kept')
  S().redo()
  const p: Project = S().project
  assert.ok(Object.values(p.clips).length > 7, 'the split came back')
  assert.equal(p.tracks.find((t) => t.id === 'v1')!.height, 120, 'the height stays through redo')
  assert.equal(p.snap.enabled, false, 'the snapping stays through redo')
  S().undo()
  assert.equal(S().project.tracks.find((t) => t.id === 'v1')!.height, 120, 'and through undo')
  assert.equal(S().project.snap.enabled, false)
})

test('P1 as the report wrote it: split, mute, Ctrl+Z keeps the split; edit, undo, mute, Ctrl+Y does nothing (the mute cleared the redo stack)', () => {
  fresh()
  S().splitClipAt('cb', 15)
  const split = hash(S().project)
  S().setTrackFlags('a1', { muted: true })
  S().undo()
  assert.equal(hash(S().project), split)
  fresh()
  S().splitClipAt('cb', 15)
  S().undo()
  S().setTrackFlags('a1', { muted: true })
  const muted = hash(S().project)
  S().redo()
  assert.equal(hash(S().project), muted, 'redo does not drop the mute')
})

// == Ç2a patch, item 6 (auditor probe A3): a colour picked on one text, and
// the transition sound sliders, are one undo step per drag (each input event
// used to be a step: 80 of them filled the 61-step history). ==
/** `drag` fires 80 input events 16 ms apart: one step, undone in one go. */
function oneDrag(what: string, drag: (i: number) => void): void {
  fresh()
  S().splitClipAt('cb', 15)
  tick(5000)
  const before = hash(S().project)
  const steps = S().past.length
  for (let i = 0; i < 80; i++) {
    tick(16)
    drag(i)
  }
  assert.notEqual(hash(S().project), before, `${what}: it changed something`)
  assert.equal(S().past.length - steps, 1, `${what}: one step for the whole drag`)
  S().undo()
  assert.equal(hash(S().project), before, `${what}: one Ctrl+Z takes the whole drag back (the split stays)`)
}

test('Ç2a patch 6: a colour dragged on one text (setCaptionOwnStyle) is one undo step', () => {
  oneDrag('own style colour', (i) => S().setCaptionOwnStyle('t1', { color: `#${(i * 3 + 1).toString(16).padStart(6, '0')}` }))
  // A switch of its own is still a step of its own; another field after a
  // pause too.
  fresh()
  const steps = S().past.length
  S().setCaptionOwnStyle('t1', { uppercase: true })
  tick(100)
  S().setCaptionOwnStyle('t1', { uppercase: false })
  tick(5000)
  S().setCaptionOwnStyle('t1', { color: '#123456' })
  assert.equal(S().past.length, steps + 3)
})

test('Ç2a patch 6: the transition sound sliders ("this one", every one, build-ups) are one undo step per drag', () => {
  // TransitionSound's "this one" slider: setTransitionOut with the new sfx,
  // no window open (components/timeline/transitions.tsx setOwn(v, false)).
  oneDrag('this transition\'s sound', (i) => {
    const tr = S().project.clips.ca.transitionOut!
    S().setTransitionOut('ca', { ...tr, sfx: 0.05 + (i % 20) * 0.05 })
  })
  oneDrag('every transition\'s sound', (i) => S().setTransitionSfx(0.05 + (i % 19) * 0.05))
  oneDrag('build-ups', (i) => S().setRisers(0.05 + (i % 19) * 0.05))
  // Two different changes of a transition are still two steps.
  fresh()
  const steps = S().past.length
  S().setTransitionOut('ca', { type: 'slide', duration: 0.5 })
  tick(5000)
  S().setTransitionOut('ca', { type: 'slide', duration: 1 })
  assert.equal(S().past.length, steps + 2)
})
