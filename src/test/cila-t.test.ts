// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// Core polish T (CILA-T-PLAN.md): the transitions in one table, the cut's
// one-click default, Ctrl+T's cut, one undo step per change, and the two
// surfaces (the timeline's menu, the Inspector) reading the same table.
import './dom-stub'
import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { useStore } from '../renderer/src/state/store'
import { TRANSITION_TYPES } from '../renderer/src/commands/clips'
import { STRINGS } from '../renderer/src/ui/strings'
import {
  DEFAULT_DURATION,
  FIRST_DEFAULT,
  TABLE_TYPES,
  TRANSITION_KINDS,
  cutsOf,
  kindOf,
  nearestCut,
  rampDirOf,
  typeOf,
  withType
} from '../renderer/src/timeline/transition-types'
import { addDefaultAt, addDefaultNearPlayhead, makeDefault, putTransition, selectTransition, selectedTransition, setTransitionType, useTransitionUi } from '../renderer/src/components/timeline/transition-state'
import { TRANSITION_LIMITS } from '../renderer/src/timeline/transition-links'
import { defaultProject, type Project } from '../renderer/src/types'
import { curveBadge, curveLinePath } from '../renderer/src/timeline/curve-line'

const S = useStore.getState
const T = { x: 0, y: 0, scale: 1, rotation: 0 }
const SRC = join(__dirname, '..', '..', 'src', 'renderer', 'src')
const code = (f: string): string => readFileSync(join(SRC, f), 'utf8')

/** Three clips meeting on V1 (cuts at 4 and 8), a gap, then one more at 14;
 *  `locked` locks V1. */
function film(opts: { locked?: boolean; second?: boolean } = {}): Project {
  const p = defaultProject()
  const v1 = p.tracks.find((t) => t.kind === 'video')!
  v1.locked = !!opts.locked
  p.assets.push({ id: 'a', kind: 'video', name: 'a.mp4', url: '', size: 1, duration: 60, width: 1920, height: 1080, hasAudio: false })
  const add = (id: string, start: number, duration: number, trackId = v1.id): void => {
    p.clips[id] = { id, assetId: 'a', trackId, start, inPoint: start, duration, volume: 1, transform: T }
    p.tracks.find((t) => t.id === trackId)!.clipIds.push(id)
  }
  add('c1', 0, 4)
  add('c2', 4, 4)
  add('c3', 8, 4)
  add('c4', 14, 4)
  if (opts.second) {
    p.tracks.unshift({ id: 'v2', kind: 'video', name: 'V2', clipIds: [] } as never)
    add('d1', 0, 20, 'v2')
    add('d2', 20, 5, 'v2')
  }
  return p
}
const fresh = (p: Project = film()): void => {
  S().loadProject(p)
  selectTransition(null)
  useTransitionUi.setState({ def: { ...FIRST_DEFAULT } })
}
const steps = (): number => S().past.length

test('one table: the 17 types of the command schema, each once, in 14 kinds', () => {
  assert.equal(TRANSITION_KINDS.length, 14)
  assert.deepEqual([...TABLE_TYPES].sort(), [...TRANSITION_TYPES].sort())
  assert.equal(new Set(TABLE_TYPES).size, 17)
  for (const type of TRANSITION_TYPES) {
    const k = kindOf(type)
    assert.equal(typeOf(k.id, rampDirOf(type)), type, `${type} goes round the table`)
    assert.equal(!!k.directional, type.startsWith('ramp-'), `${type}: a ramp is the one directional kind`)
  }
})

test('one table: every kind and group has its name in English and Turkish', () => {
  const S2 = STRINGS as Record<string, { en: string; tr?: string }>
  for (const k of TRANSITION_KINDS) {
    assert.ok(S2[k.name]?.en && S2[k.name]?.tr, `${k.id}: ${k.name}`)
  }
  for (const g of ['basic', 'motion', 'ramp', 'light']) assert.ok(S2[`trans.group.${g}`]?.tr, g)
  for (const d of ['Right', 'Left', 'Down', 'Up']) assert.ok(S2[`trans.opt.ramp${d}`]?.tr, d)
  // The second set of names (the Inspector's own) is gone: one name per type.
  assert.deepEqual(Object.keys(STRINGS).filter((k) => k.startsWith('insp.trans.type')), [])
})

test('one default: 0.5 s, a dissolve, the same everywhere a new transition is made', () => {
  assert.equal(DEFAULT_DURATION, 0.5)
  assert.deepEqual(FIRST_DEFAULT, { type: 'mix', duration: 0.5 })
  assert.deepEqual(withType(null, 'wipe'), { type: 'wipe', duration: 0.5 })
  // What a transition had stays when its type changes …
  assert.deepEqual(withType({ type: 'mix', duration: 0.8, align: 'start', sfx: 0 }, 'slide'), { type: 'slide', duration: 0.8, align: 'start', sfx: 0 })
  // … a film burn gets its time …
  assert.equal(withType({ type: 'mix', duration: 0.5 }, 'film-burn').duration, 1.2)
  assert.equal(withType({ type: 'mix', duration: 2 }, 'film-burn').duration, 2)
  // … and the one rule holds.
  assert.equal(withType(null, 'mix', 99).duration, TRANSITION_LIMITS.max)
  assert.equal(withType(null, 'mix', 0).duration, TRANSITION_LIMITS.min)
})

test('two surfaces, one table: the timeline menu, the Inspector and Library list no kinds of their own', () => {
  for (const f of ['components/timeline/transitions.tsx', 'components/inspector/transition-section.tsx', 'components/inspector/clip-tab.tsx']) {
    const src = code(f)
    for (const lit of ["'film-burn'", "'light-leak'", "'ramp-right'", "'ramp-up'", "'iris'"]) assert.equal(src.includes(lit), false, `${f} names ${lit} itself`)
    assert.ok(src.includes("timeline/transition-types'") || src.includes('./transition-section'), `${f} reads the table`)
  }
  // Library → Effects offers the same grid (its 'ramp-*' are the clip animations' own list).
  assert.ok(code('components/inspector/fx-tab.tsx').includes('<TransitionGrid'))
  assert.equal(code('components/inspector/fx-tab.tsx').includes('MODERN_CUTS'), false)
  // The timeline's old pop-up (its own list, its own default) is gone.
  assert.equal(code('components/timeline/transitions.tsx').includes('tl-trans-menu'), false)
  assert.equal(code('components/timeline/transitions.tsx').includes('onDoubleClick'), false, 'no hidden double-click delete')
})

test('the cuts that take a transition: meeting clips, not across a gap, not on a locked track', () => {
  assert.deepEqual(cutsOf(film()).map((c) => [c.clipId, c.time]), [['c1', 4], ['c2', 8]])
  assert.deepEqual(cutsOf(film({ locked: true })), [])
  const p = film()
  p.clips.c2.adjustment = true
  assert.deepEqual(cutsOf(p).map((c) => c.clipId), [])
})

test('Ctrl+T\'s cut: the nearest on the selected clip\'s track, else on the first video track with a cut', () => {
  const p = film({ second: true })
  assert.equal(nearestCut(p, 7, null)?.clipId, 'd1', 'V2 (first in the list) has a cut')
  assert.equal(nearestCut(p, 7, p.tracks.find((t) => t.name === 'V1')!.id)?.clipId, 'c2')
  assert.equal(nearestCut(p, 5.9, p.tracks.find((t) => t.name === 'V1')!.id)?.clipId, 'c1')
  assert.equal(nearestCut(defaultProject(), 3, null), null)
})

test('a click on a cut: the remembered default, one undo step, selected; undo takes it away', () => {
  fresh()
  const n = steps()
  addDefaultAt('c1')
  assert.deepEqual(S().project.clips.c1.transitionOut && { type: S().project.clips.c1.transitionOut!.type, duration: S().project.clips.c1.transitionOut!.duration }, { type: 'mix', duration: 0.5 })
  assert.equal(steps(), n + 1)
  assert.equal(selectedTransition()?.clipId, 'c1')
  assert.deepEqual(S().selectedClipIds, [])
  S().undo()
  assert.equal(S().project.clips.c1.transitionOut, undefined)
  assert.equal(selectedTransition(), null, 'the selection goes with it')
})

test('choosing a type: one step, remembered; the next click adds it', () => {
  fresh()
  addDefaultAt('c1')
  const n = steps()
  setTransitionType('c1', 'film-burn')
  assert.equal(steps(), n + 1)
  assert.equal(S().project.clips.c1.transitionOut!.type, 'film-burn')
  assert.equal(S().project.clips.c1.transitionOut!.duration, 1.2)
  assert.equal(useTransitionUi.getState().def.type, 'film-burn')
  addDefaultAt('c2')
  assert.equal(S().project.clips.c2.transitionOut!.type, 'film-burn')
  assert.equal(S().project.clips.c2.transitionOut!.duration, 1.2, 'its shortest, over the remembered 0.5')
  // Make default: this one's type and length.
  putTransition('c1', { ...S().project.clips.c1.transitionOut!, type: 'wipe', duration: 0.8 })
  makeDefault('c1')
  assert.deepEqual(useTransitionUi.getState().def, { type: 'wipe', duration: 0.8 })
})

test('Ctrl+T: on the selected transition, else at the cut nearest the playhead; nothing without a cut', () => {
  fresh()
  S().setTime(7.5)
  const n = steps()
  assert.equal(addDefaultNearPlayhead(), true)
  assert.equal(S().project.clips.c2.transitionOut?.type, 'mix')
  assert.equal(steps(), n + 1)
  useTransitionUi.setState({ def: { type: 'zoom', duration: 1 } })
  selectTransition('c2')
  S().setTime(1)
  addDefaultNearPlayhead()
  assert.equal(S().project.clips.c2.transitionOut?.type, 'zoom', 'the selected one, not the one nearest the playhead')
  assert.equal(S().project.clips.c1.transitionOut, undefined)
  fresh(defaultProject())
  assert.equal(addDefaultNearPlayhead(), false)
})

test('one thing is selected: picking a clip lets the transition go, and selecting one lets the clips go', () => {
  fresh()
  addDefaultAt('c1')
  assert.equal(selectedTransition()?.clipId, 'c1')
  S().selectClip('c3')
  assert.equal(useTransitionUi.getState().sel, null)
  selectTransition('c1')
  assert.deepEqual(S().selectedClipIds, [])
  // Delete (App.tsx) is the store's own edit: one step.
  const n = steps()
  putTransition('c1', null)
  assert.equal(steps(), n + 1)
  assert.equal(S().project.clips.c1.transitionOut, undefined)
})

test('an end dragged: one undo step however many steps it took', () => {
  fresh()
  addDefaultAt('c1')
  const n = steps()
  S().beginGesture()
  for (let i = 1; i <= 12; i++) S().setTransitionOut('c1', { ...S().project.clips.c1.transitionOut!, duration: 0.5 + i * 0.05 })
  S().endGesture()
  assert.equal(steps(), n + 1)
  S().undo()
  assert.equal(S().project.clips.c1.transitionOut!.duration, 0.5)
})

test('a speed curve on the timeline: a line from slow (low) to fast (high), its range on the badge; none without a curve', () => {
  const clip = { inPoint: 0, duration: 5, speed: 2, speedCurve: { keys: [{ m: 0, v: 0.5 }, { m: 10, v: 4 }], linear: true as const } }
  const d = curveLinePath(clip, 200, 10)!
  const ys = [...d.matchAll(/[ML][\d.]+ ([\d.]+)/g)].map((m) => Number(m[1]))
  assert.equal(ys.length, 51, 'a sample every 4 px')
  assert.ok(ys[0] > 5 && ys[ys.length - 1] < 5, `slower than 1x below the middle, faster above (${ys[0]}, ${ys[ys.length - 1]})`)
  for (let i = 1; i < ys.length; i++) assert.ok(ys[i] <= ys[i - 1] + 1e-9, 'it only speeds up')
  const b = curveBadge(clip)!
  assert.ok(Number(b.min) < 1 && Number(b.max) > 1, `${b.min}–${b.max}`)
  assert.equal(curveLinePath({ inPoint: 0, duration: 5, speed: 2 }, 200, 10), null)
  assert.equal(curveBadge({ inPoint: 0, duration: 5, speed: 2 }), null)
  assert.equal(curveLinePath({ ...clip, freeze: 1 }, 200, 10), null, 'a freeze frame never plays along a curve')
})
