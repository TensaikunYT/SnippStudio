// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// REF-AB, worker I (REF-AB-PLAN-I.md): a card's reset (one undo step, every
// card back to a new clip's values), a value's ‹ ◇ › (from key to key, the
// diamond adding or taking away), the ready speed curves (written into the
// curve model and read back as themselves), the length that sets the speed,
// and the clip animations' grid (search, kinds, the made-up pictures).
import './dom-stub'
import assert from 'node:assert/strict'
import test from 'node:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { useStore } from '../renderer/src/state/store'
import { pointsOf } from '../renderer/src/timeline/speed-curve'
import { STRINGS } from '../renderer/src/ui/strings'
import { STRINGS_REF_I } from '../renderer/src/ui/strings-ref-i'
import { CLIP_ANIMS, type Clip } from '../renderer/src/types'
import { RESET_PARTS, partIsDefault, runReset, type ResetActions } from '../renderer/src/components/inspector/card-reset'
import { resetCard } from '../renderer/src/components/inspector/card-reset-button'
import { spanKeyTimes, stepValueKey } from '../renderer/src/components/inspector/key-diamond'
import { togglePropKey, toggleVolumeKey } from '../renderer/src/components/inspector/key-toggle'
import { SHAPE_KEY, SHAPE_ORDER, SPEED_SHAPES, isFlat, matchShape, shapePath, shapePoints, shapeSpeedAt } from '../renderer/src/components/inspector/speed-shapes'
import { SpeedShapeTiles } from '../renderer/src/components/inspector/speed-shape-tiles'
import { lengthRange, speedForLength } from '../renderer/src/components/inspector/speed-duration'
import { ANIM_KINDS, KIND_OF, animPreviewProject, animPreviewTime, findAnims } from '../renderer/src/components/inspector/anim-grid'
import { CURVE_PRESETS } from '../renderer/src/timeline/speed-curve'
import { SPEED_MAX, SPEED_MIN } from '../renderer/src/timeline/speed'
import { talk } from './agent-kit'

const S = useStore.getState
const clip = (): Clip => S().project.clips.c1
const fresh = (): void => {
  S().loadProject(talk(10))
  S().setTime(0)
}

// ---- words ------------------------------------------------------------------

test('every key has its Turkish, with the same parameters, is in STRINGS and new', () => {
  const params = (s: string): string => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(',')
  for (const [k, e] of Object.entries(STRINGS_REF_I)) {
    assert.ok(k.startsWith('refi.'), `${k}: the prefix`)
    assert.ok(e.en.trim() && e.tr.trim(), `${k}: both languages`)
    assert.equal(params(e.tr), params(e.en), `${k}: the same parameters`)
    assert.deepEqual((STRINGS as Record<string, unknown>)[k], e, `${k} is in STRINGS`)
  }
  for (const name of SHAPE_ORDER) assert.ok(SHAPE_KEY[name] in STRINGS, `${name} has a name`)
  for (const k of ANIM_KINDS) assert.ok(`refi.anim.kind.${k}` in STRINGS, `${k} has a name`)
})

// ---- item 2: a card's reset ---------------------------------------------------

test('a new clip: every card is as new, nothing to reset', () => {
  fresh()
  for (const part of RESET_PARTS) assert.ok(partIsDefault(S().project, clip(), part), part)
})

test('each card is reset to a new clip\'s values, as one undo step', () => {
  fresh()
  const st = S()
  st.setTime(2)
  st.setPropValue('c1', 'scale', 1.7)
  st.addPropKeyframe('c1', 'x')
  st.setClipFlip('c1', { h: true })
  st.setClipOpacity('c1', 0.4)
  st.setClipBlendMode('c1', 'screen')
  st.setClipGrade('c1', { brightness: 1.2 })
  st.setClipEffect('c1', { sharpen: 0.5, vignette: 0.3 })
  st.setClipFx('c1', { bloom: { amount: 0.6 } })
  st.toggleFxKey('c1', 'bloom')
  st.setClipAnim('c1', { in: 'fade' })
  st.setClipIdle('c1', { style: 'float' })
  st.setClipFades('c1', { fadeIn: 0.5 })
  st.setClipVolume('c1', 0.5)
  st.setClipSpeed('c1', 2)
  st.setClipCrop('c1', { t: 0.1 })
  for (const part of ['transform', 'opacity', 'color', 'effects', 'motion', 'audio', 'speed', 'crop'] as const) {
    assert.equal(partIsDefault(S().project, clip(), part), false, `${part} changed`)
    const before = JSON.stringify(clip())
    resetCard('c1', part)
    assert.ok(partIsDefault(S().project, clip(), part), `${part} reset`)
    S().undo()
    assert.equal(JSON.stringify(clip()), before, `${part}: one undo gives it back`)
    resetCard('c1', part)
  }
  const c = clip()
  assert.equal(c.transform.scale, 1)
  assert.equal(c.channels?.x, undefined, 'the transform\'s keys go with it')
  assert.equal(c.flipH, undefined)
  assert.equal(c.fxKeys, undefined, 'the effects\' keys go with them')
  assert.equal(c.speed ?? 1, 1)
  assert.ok(Math.abs(c.duration - 10) < 1e-6, 'speed 1 again: the clip is its footage\'s length')
})

test('a reset only runs what differs (and nothing on a clean card)', () => {
  fresh()
  const calls: string[] = []
  const spy = new Proxy({}, { get: (_t, name) => () => void calls.push(String(name)) }) as ResetActions
  runReset(S().project, { ...clip(), blur: 4 }, 'color', spy)
  assert.deepEqual(calls, ['setClipBlur'])
  const before = S().past?.length
  resetCard('c1', 'mask')
  assert.equal(S().past?.length, before, 'a clean card makes no undo step')
})

// ---- item 2: ‹ ◇ › --------------------------------------------------------------

test('‹ and › go from key to key of one value; ◇ adds, and on a key takes it away', () => {
  fresh()
  const st = S()
  for (const t of [1, 3, 5]) {
    st.setTime(t)
    togglePropKey('c1', 'scale')
  }
  assert.equal(clip().channels?.scale?.length, 3)
  assert.deepEqual(spanKeyTimes(clip(), clip().channels?.scale).map((x) => Math.round(x * 100) / 100), [1, 3, 5])
  st.setTime(2)
  stepValueKey(clip(), clip().channels?.scale, 1)
  assert.ok(Math.abs(S().currentTime - 3) < 1e-6, '› to the next key')
  stepValueKey(clip(), clip().channels?.scale, -1)
  assert.ok(Math.abs(S().currentTime - 1) < 1e-6, '‹ to the one before')
  stepValueKey(clip(), clip().channels?.scale, -1)
  assert.ok(Math.abs(S().currentTime - 1) < 1e-6, 'none before the first: stays')
  // On a key the diamond takes it away; the last one leaves its value.
  st.setTime(3)
  st.setPropValue('c1', 'scale', 1.5)
  togglePropKey('c1', 'scale')
  assert.equal(clip().channels?.scale?.length, 2)
  st.setTime(1)
  togglePropKey('c1', 'scale')
  st.setTime(5)
  st.setPropValue('c1', 'scale', 2)
  togglePropKey('c1', 'scale')
  assert.equal(clip().channels?.scale, undefined)
  assert.equal(clip().transform.scale, 2, 'the last key\'s value stays as the value')
  // The volume too.
  st.setTime(4)
  toggleVolumeKey('c1')
  assert.equal(clip().volumeKeyframes?.length, 1)
  toggleVolumeKey('c1')
  assert.equal(clip().volumeKeyframes?.length ?? 0, 0)
})

// ---- item 4: the ready speed curves and the length -------------------------------

test('the shapes: in order, held to the range, each read back as itself at any speed', () => {
  assert.deepEqual([...SHAPE_ORDER].sort(), [...Object.keys(SPEED_SHAPES), ...Object.keys(CURVE_PRESETS)].sort())
  for (const name of SHAPE_ORDER) {
    for (const base of [0.5, 1, 2, 3.3]) {
      const pts = shapePoints(name, base)
      assert.equal(pts[0].u, 0)
      assert.equal(pts[pts.length - 1].u, 1)
      for (let i = 1; i < pts.length; i++) assert.ok(pts[i].u > pts[i - 1].u, `${name}: in order`)
      for (const p of pts) assert.ok(p.v >= SPEED_MIN && p.v <= SPEED_MAX, `${name} at ${base}: ${p.v}`)
      assert.equal(matchShape(pts), name, `${name} at ${base}x`)
    }
  }
  assert.equal(matchShape([{ u: 0, v: 2 }, { u: 1, v: 2 }]), 'flat')
  assert.ok(isFlat([{ u: 0, v: 2 }, { u: 1, v: 2 }]))
  assert.equal(matchShape([{ u: 0, v: 2 }, { u: 0.3, v: 0.7 }, { u: 1, v: 5 }]), null, 'one\'s own curve')
  assert.ok(Math.abs(shapeSpeedAt(SPEED_SHAPES.skip, 0.5) - 10) < 1e-9)
  assert.equal(shapePath(SPEED_SHAPES.rhythm, 56, 30).split('L').length, 49)
})

test('a shape written into a clip\'s curve is read back from the model as itself', () => {
  for (const name of SHAPE_ORDER) {
    fresh()
    S().setClipSpeedCurve('c1', { points: shapePoints(name, 1) })
    assert.equal(matchShape(pointsOf(clip())), name, name)
    const html = renderToStaticMarkup(createElement(SpeedShapeTiles, { clip: clip() }))
    assert.equal((html.match(/class="insp-shape(?: is-on)?"/g) ?? []).length, SHAPE_ORDER.length + 2, 'None, Custom and every shape')
    assert.match(html, new RegExp(`data-testid="inspector\\.clip\\.speed\\.curve\\.preset\\.${name}" class="insp-shape is-on"`))
    assert.equal((html.match(/is-on/g) ?? []).length, 1, 'one tile marked')
  }
})

test('the length sets the speed (held to the speeds there are)', () => {
  assert.equal(speedForLength(10, 5), 2)
  assert.equal(speedForLength(10, 20), 0.5)
  assert.equal(speedForLength(10, 1e-6), SPEED_MAX)
  assert.equal(speedForLength(10, 1e6), SPEED_MIN)
  const [lo, hi] = lengthRange(10, 30)
  assert.ok(Math.abs(lo - 10 / SPEED_MAX) < 1e-9 && Math.abs(hi - 10 / SPEED_MIN) < 1e-9)
  fresh()
  S().setClipSpeed('c1', speedForLength(clip().duration * (clip().speed ?? 1), 4))
  assert.ok(Math.abs(clip().duration - 4) < 1e-3, `typed 4 s: ${clip().duration}`)
})

// ---- item 9: the animations' grid -------------------------------------------------

test('search by name or kind, the kinds as filters', () => {
  const name = (a: string): string => a.replace(/-/g, ' ')
  const kindN = (k: string): string => ({ all: 'All', basic: 'Basic', slide: 'Slide', lively: 'Lively', ramp: 'Speed ramp' })[k] ?? k
  assert.deepEqual(findAnims('', 'all', name, kindN), CLIP_ANIMS)
  assert.deepEqual(findAnims('', 'slide', name, kindN), ['slide-up', 'slide-down', 'slide-left', 'slide-right'])
  assert.deepEqual(findAnims('ZOOM', 'all', name, kindN), ['zoom-in', 'zoom-out'])
  assert.deepEqual(findAnims('lively', 'all', name, kindN), ['pop', 'spin', 'whip', 'elastic'], 'by the kind\'s name')
  assert.deepEqual(findAnims('zoom', 'ramp', name, kindN), [])
  // Turkish dots and case do not matter.
  assert.deepEqual(findAnims('YUKARI', 'all', (a) => (a === 'slide-up' ? 'Yukarı kay' : a), kindN), ['slide-up'])
  for (const a of CLIP_ANIMS) if (a !== 'none') assert.ok(KIND_OF[a], `${a} has a kind`)
})

test('a tile\'s picture: the animation done to the frame, its loop inside the clip', () => {
  const pin = animPreviewProject('in', 'spin')
  assert.equal(pin.clips.A.anim?.in, 'spin')
  assert.equal(animPreviewProject('out', 'fade').clips.A.anim?.out, 'fade')
  assert.equal(animPreviewProject('idle', 'sway').clips.A.idle?.style, 'sway')
  assert.equal(animPreviewProject('in', 'none').clips.A.anim, undefined)
  const d = pin.clips.A.duration
  for (const part of ['in', 'out', 'idle'] as const) {
    for (const f of [0, 0.5, 1]) {
      const t = animPreviewTime(part, f)
      assert.ok(t >= 0 && t < d, `${part} ${f}: ${t}`)
    }
  }
  assert.ok(animPreviewTime('out', 1) > d - 0.01, 'the exit plays to the clip\'s end')
})
