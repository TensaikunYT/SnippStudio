// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// Phase 3c.3, decision 5 of tarifler\FAZ3C.md: one drag of an Inspector slider
// is ONE undo step, and undoing it gives the old value back. The new sliders
// open and close the store's gesture window exactly as the old ones did
// (components/undo-gesture.ts: armGesture on the first change, endGesture on
// the release); this runs that sequence against the real store for every
// family of slider the Inspector has: the store action each one calls, with
// the values a drag sends. (The same in a real window, with a real pointer:
// scripts/e2e/scenarios/95-inspector-sliders.mjs.)
import { fixture, hash, resetWorld } from './undo-fixture'
import assert from 'node:assert/strict'
import test from 'node:test'
import { useStore, type EditorState } from '../renderer/src/state/store'
import { NO_LOOK } from '../renderer/src/effects/look'
import { PICTURE_PHYSICS, newPictureMove } from '../renderer/src/motion/picture-moves'
import { defaultCaptionStyle } from '../renderer/src/types'

type S = EditorState
interface Family {
  name: string
  /** What must be there before the drag (its own undo steps are not counted). */
  setup?: (s: S) => void
  /** One change of the drag: `k` runs 1…5, `v(k)` is a value between lo and hi. */
  drag: (s: S, k: number) => void
}

const between = (lo: number, hi: number, k: number): number => lo + ((hi - lo) * k) / 5
const withCaption = (s: S): void =>
  s.setCaptions([{ id: 'cap1', start: 1, end: 3, text: 'A text of one’s own', manual: true, style: defaultCaptionStyle() }])

const FAMILIES: Family[] = [
  { name: 'Clip: scale / position / rotation / opacity (setPropValue)', drag: (s, k) => s.setPropValue('ov', 'scale', between(0.4, 1.6, k)) },
  { name: 'Clip: position X (setPropValue x)', drag: (s, k) => s.setPropValue('ov', 'x', between(400, 1500, k)) },
  { name: 'Clip: opacity (setPropValue opacity)', drag: (s, k) => s.setPropValue('ov', 'opacity', between(1, 0.2, k)) },
  { name: 'Clip: speed (setClipSpeed)', drag: (s, k) => s.setClipSpeed('cb', between(1, 2, k)) },
  { name: 'Clip: transition duration (setTransitionOut)', drag: (s, k) => s.setTransitionOut('ca', { ...s.project.clips.ca.transitionOut!, duration: between(0.5, 1.5, k) }) },
  { name: 'Clip: cinematic motion (setMotionFx)', setup: (s) => s.undoable(() => s.setMotionFx('cc', { enabled: true })), drag: (s, k) => s.setMotionFx('cc', { zoomTo: between(1, 1.3, k) }) },
  { name: 'Motion: entrance duration (setClipAnim)', setup: (s) => s.setClipAnim('cc', { in: 'fade' }), drag: (s, k) => s.setClipAnim('cc', { inDur: between(0.5, 2, k) }) },
  { name: 'Motion: idle amount (setClipIdle)', setup: (s) => s.setClipIdle('cc', { style: 'float' }), drag: (s, k) => s.setClipIdle('cc', { amount: between(0.2, 1.8, k) }) },
  { name: 'Moves: physics (editClipMoves, not committing)', setup: (s) => s.editClipMoves('cc', (m) => void m.actions.push(newPictureMove('hop', 0.5, 'mv1'))), drag: (s, k) => s.editClipMoves('cc', (m) => { m.physics = { ...(m.physics ?? PICTURE_PHYSICS), weight: between(0, 1, k) } }, false) },
  { name: 'Colour: grade (setClipGrade)', drag: (s, k) => s.setClipGrade('ca', { brightness: between(1, 1.4, k) }) },
  { name: 'Colour: blur (setClipBlur)', drag: (s, k) => s.setClipBlur('ca', between(0, 30, k)) },
  { name: 'Crop (setClipCrop)', drag: (s, k) => s.setClipCrop('ca', { l: between(0, 0.3, k) }) },
  { name: 'Effects: sharpen, vignette, grain… (setClipEffect)', drag: (s, k) => s.setClipEffect('ca', { sharpen: between(0, 0.8, k) }) },
  { name: 'Chroma key (setClipChroma)', setup: (s) => s.undoable(() => s.setClipChroma('ca', { enabled: true })), drag: (s, k) => s.setClipChroma('ca', { similarity: between(0.1, 0.6, k) }) },
  { name: 'Mask: feather (setClipMask)', setup: (s) => s.undoable(() => s.setClipMask('ca', { enabled: true })), drag: (s, k) => s.setClipMask('ca', { feather: between(0, 60, k) }) },
  { name: 'Mask: rotation (editMaskGeom)', setup: (s) => s.undoable(() => s.setClipMask('ca', { enabled: true })), drag: (s, k) => s.editMaskGeom('ca', { rot: between(0, 1, k) }) },
  { name: 'Audio: volume (setClipVolume)', drag: (s, k) => s.setClipVolume('m1', between(0.5, 1.5, k)) },
  { name: 'Audio: fades (setClipFades)', drag: (s, k) => s.setClipFades('m1', { fadeIn: between(0, 2, k) }) },
  { name: 'Audio effects: EQ, compressor, gate (setClipAudioFx)', drag: (s, k) => s.setClipAudioFx('m1', { eqLow: between(0, 9, k) }) },
  { name: 'Camera look on clips (setClipLook)', drag: (s, k) => s.setClipLook(['ca'], { ...NO_LOOK, grain: between(0, 0.8, k) }) },
  { name: 'Subtitles: style (setCaptionStyle)', drag: (s, k) => s.setCaptionStyle({ fontSize: between(60, 120, k) }) },
  { name: 'Text: its own style (setCaptionOwnStyle)', setup: withCaption, drag: (s, k) => s.setCaptionOwnStyle('cap1', { fontSize: between(60, 200, k) }) },
  { name: 'Text: motion offsets (setCaptionMotion)', setup: withCaption, drag: (s, k) => s.setCaptionMotion('cap1', { x: between(0, 300, k) }) },
  { name: 'Text: animation lengths (updateCaption)', setup: withCaption, drag: (s, k) => s.updateCaption('cap1', { anim: { in: 'fade', inDur: between(0.2, 1.5, k) } }) }
]

for (const f of FAMILIES) {
  test(`one drag is one undo step, and undo gives the old value back: ${f.name}`, () => {
    const s = useStore.getState
    resetWorld()
    s().loadProject(fixture())
    useStore.setState({ dirty: false, currentTime: 2.5, selectedClipIds: [], selectedCaptionIds: [] })
    f.setup?.(s())
    const before = hash(s().project)
    const past0 = s().past.length

    // The gesture: the first change opens the window, the release closes it.
    s().armGesture()
    for (let k = 1; k <= 5; k++) f.drag(s(), k)
    s().endGesture()

    assert.notEqual(hash(s().project), before, 'the drag changed the project')
    assert.equal(s().past.length, past0 + 1, 'one undo step for the whole drag')
    const after = hash(s().project)
    s().undo()
    assert.equal(hash(s().project), before, 'undo: the old value')
    assert.equal(s().past.length, past0)
    s().redo()
    assert.equal(hash(s().project), after, 'redo: the dragged value')

    // A second drag is a second step (the window closed with the release).
    s().armGesture()
    for (let k = 1; k <= 3; k++) f.drag(s(), k)
    s().endGesture()
    assert.equal(s().past.length, past0 + 2, 'the next drag is its own step')
  })
}
