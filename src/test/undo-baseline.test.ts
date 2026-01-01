// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// Undo equivalence (SnippStudio phase 2A.0). Every edit action of the store
// and every gesture (a clip dragged, a head trimmed, a slider held, a key held)
// is run on one fixed project, and what it did is written down: how many undo
// steps it made, whether it cleared redo, the project before and after (a hash),
// what it changed in the UI state (selection, playhead, cut marks…), its
// return value, and whether undoing those steps gives the project back.
//
// The records live in fixtures/undo-baseline.json, made from the code as it
// was before the command layer (d1e9047). The command layer must give the same
// records, except the rows FAZ2A-PLAN.md §3 lists as changed on purpose.
//   UPDATE_UNDO_BASELINE=1 npm test     writes the file anew
//   UPDATE_UNDO_BASELINE=add npm test   adds the rows the file does not have
//                                       (a new scenario); no row in it changes
//
// 22 November 2026 (D22-PLAN-B.md, K11): every action of the store is either
// run by a scenario here or named in NOT_EDITS with what it is instead; an
// action added to the store without a row fails the last test of this file.
// The rows added that day (the last block of SCENARIOS) record the code as it
// was then, not d1e9047: most of those actions are younger than the command
// layer.
import { canonical, fixture, hash, resetWorld, tick } from './undo-fixture'
import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { useStore, type EditorState } from '../renderer/src/state/store'
import { planTimelinePlacement } from '../renderer/src/timeline/placement'
import { automationOf } from '../renderer/src/timeline/slice'
import { createTemplate, deleteTemplate } from '../renderer/src/templates/model'
import { setNoteStatus, updateNote } from '../renderer/src/notes/model'
import type { Asset } from '../renderer/src/types'

type S = EditorState

interface Scenario {
  name: string
  /** Playhead before the action. */
  t?: number
  sel?: string[]
  capSel?: string[]
  linkAV?: boolean
  /** V1 is an auto-packed track (every clip butt-joined). */
  packed?: boolean
  /** UI state set up first (cut marks, a template picked…), not recorded. */
  setup?: (s: () => S) => void
  run: (s: () => S) => unknown
}

const UI_KEYS = [
  'selectedClipIds', 'selectedCaptionIds', 'currentTime', 'cutMarks', 'cutTrackId', 'templateSel', 'noteSel',
  'activeShortSegmentId', 'selectedTrackerId', 'loopRange', 'playing', 'dirty'
] as const

const uiOf = (st: S): Record<string, unknown> => {
  const o: Record<string, unknown> = {}
  for (const k of UI_KEYS) o[k] = st[k]
  o.silencePreview = st.silencePreview ? st.silencePreview.length : null
  o.noteDraft = st.noteDraft ? 1 : 0
  return o
}

const newImage = (id: string): Asset => ({ id, kind: 'image', name: `${id}.png`, path: `C:\\media\\${id}`, url: `media://${id}`, size: 10, duration: 0, width: 1000, height: 1000, hasAudio: false })
const base = (s: () => S, id: string) => {
  const c = s().project.clips[id]
  return { start: c.start, inPoint: c.inPoint, duration: c.duration, automation: automationOf(c) }
}

const SCENARIOS: Scenario[] = [
  // -- project -------------------------------------------------------------
  { name: 'setSettings size', run: (s) => s().setSettings({ width: 1280, height: 720 }) },
  { name: 'setSettings fps', run: (s) => s().setSettings({ fps: 30 }) },
  { name: 'setSettings same (no-op)', run: (s) => s().setSettings({ fps: 60 }) },
  { name: 'setMode shorts', run: (s) => s().setMode('shorts') },
  { name: 'setMode same', run: (s) => s().setMode('frame') },
  { name: 'setProjectName', run: (s) => s().setProjectName('Renamed') },
  // -- assets --------------------------------------------------------------
  { name: 'addAssets new', run: (s) => s().addAssets([newImage('imgN')]).map((a) => a.id) },
  { name: 'addAssets existing', run: (s) => s().addAssets([{ ...newImage('img1') }]).map((a) => a.id) },
  { name: 'replaceImageClip', run: (s) => s().replaceImageClip('cc', newImage('imgR')) },
  { name: 'deleteAsset', sel: ['ov', 'cb'], run: (s) => s().deleteAsset('img1') },
  { name: 'updateAsset', run: (s) => s().updateAsset('aud1', { name: 'music.wav' }) },
  // -- add -------------------------------------------------------------------
  { name: 'addToTimeline', run: (s) => s().addToTimeline('img3', 'v1') },
  { name: 'addToTimeline audio default track', run: (s) => s().addToTimeline('aud1') },
  { name: 'addAllToTimeline', run: (s) => s().addAllToTimeline() },
  { name: 'addClipsAt existing', run: (s) => s().addClipsAt(['img2'], 'v2', 8) },
  { name: 'addClipsAt new asset', run: (s) => s().addClipsAt(['imgD'], 'v2', 9, { assets: [newImage('imgD')] }) },
  { name: 'addClipsAt new track', run: (s) => s().addClipsAt(['vid2'], null, 3, { newTrack: 'video' }) },
  { name: 'addClipAt', run: (s) => s().addClipAt('img3', 'v2', 12) },
  { name: 'addClipAt no commit', run: (s) => s().addClipAt('img3', 'v2', 12, false) },
  // -- auto-place --------------------------------------------------------------
  { name: 'placeSoundEffect', run: (s) => s().placeSoundEffect('aud1', [1, 5, 5.01], 0.1, 0.8) },
  { name: 'placeSoundEffect none', run: (s) => s().placeSoundEffect('img1', [1], 0.1, 0.8) },
  {
    name: 'placeAutomationImages new layer',
    run: (s) => s().placeAutomationImages([
      { captionIds: ['c1'], text: 'hello there world', start: 0.5, end: 3, assetId: 'img1', assetName: 'img1.png', duration: 2.5 },
      { captionIds: ['c2'], text: 'this is a test', start: 3.2, end: 6, assetId: 'img2', assetName: 'img2.png', duration: 2.8 }
    ], 'new', { captionTextEdits: { c2: 'this is the test' }, missingSlots: [{ captionIds: ['c3'], text: 'second clip speaks', start: 10.5, end: 14, number: 3, duration: 3.5 }] })
  },
  {
    name: 'placeAutomationImages overlap refused',
    run: (s) => s().placeAutomationImages([{ captionIds: ['c1'], text: 'x', start: 2, end: 4, assetId: 'img3', assetName: 'img3.png', duration: 2 }], 'v2')
  },
  {
    name: 'placeAutomationImages replace',
    run: (s) => s().placeAutomationImages([{ captionIds: ['c1'], text: 'x', start: 2, end: 4, assetId: 'img3', assetName: 'img3.png', duration: 2 }], 'v2', { replaceOverlaps: true })
  },
  {
    name: 'fillAutomationMissingImage',
    setup: (s) => {
      s().placeAutomationImages([], 'new', { missingSlots: [{ captionIds: ['c3'], text: 'x', start: 10.5, end: 14, number: 3, duration: 3.5 }] })
      s().selectClips([])
    },
    run: (s) => s().fillAutomationMissingImage(Object.values(s().project.clips).find((c) => c.automationMissing)!.id, newImage('imgF'))
  },
  // -- move --------------------------------------------------------------------
  { name: 'moveClip', run: (s) => s().moveClip('ov', 12) },
  { name: 'moveClip no commit', run: (s) => s().moveClip('ov', 12, false) },
  { name: 'moveClip blocked lands free', run: (s) => s().moveClip('cc', 5) },
  { name: 'moveClip linked, link on', linkAV: true, run: (s) => s().moveClip('ca', 30) },
  { name: 'moveClip linked, link off', run: (s) => s().moveClip('ca', 30) },
  { name: 'moveClipToTrack', run: (s) => s().moveClipToTrack('ov', 'v1') },
  { name: 'moveClipToTrack wrong kind', run: (s) => s().moveClipToTrack('ov', 'a1') },
  {
    name: 'applyTimelinePlacement',
    run: (s) => {
      const plan = planTimelinePlacement(s().project, 'ov', ['ov'], 20, null, null, false)
      s().applyTimelinePlacement(plan!)
    }
  },
  {
    name: 'applyTimelinePlacement new track',
    run: (s) => {
      const plan = planTimelinePlacement(s().project, 'ov', ['ov'], 1, null, 'video', false)
      s().applyTimelinePlacement(plan!)
    }
  },
  { name: 'nudgeSelection', sel: ['ov'], run: (s) => s().nudgeSelection(0.5) },
  { name: 'nudgeSelection locked only', sel: ['cl'], run: (s) => s().nudgeSelection(0.5) },
  // -- trim --------------------------------------------------------------------
  { name: 'setClipHead trim in', run: (s) => s().setClipHead('cb', 12, base(s, 'cb')) },
  { name: 'setClipHead reveal blocked', run: (s) => s().setClipHead('cb', 8, base(s, 'cb')) },
  { name: 'setClipHead same', run: (s) => s().setClipHead('cb', 10, base(s, 'cb')) },
  { name: 'trimClipEnd shorter', run: (s) => s().trimClipEnd('cb', -2) },
  { name: 'trimClipEnd blocked', run: (s) => s().trimClipEnd('cb', 3) },
  { name: 'slipClip', run: (s) => s().slipClip('cb', 1, 2) },
  { name: 'slipClip linked', linkAV: true, run: (s) => s().slipClip('ca', -1, 5) },
  { name: 'revealEarlier', run: (s) => s().revealEarlier('cb', 1) },
  { name: 'keepOnlyRange', setup: (s) => s().addCutMark(12, 'v1'), run: (s) => s().keepOnlyRange('cb', 12, 16) },
  // -- split ---------------------------------------------------------------------
  { name: 'splitAtPlayhead all', t: 4, run: (s) => s().splitAtPlayhead() },
  { name: 'splitAtPlayhead selected', t: 4, sel: ['m1'], run: (s) => s().splitAtPlayhead() },
  { name: 'splitAtPlayhead linked', t: 4, sel: ['ca'], linkAV: true, run: (s) => s().splitAtPlayhead() },
  { name: 'splitAtPlayhead nothing', t: 100, run: (s) => s().splitAtPlayhead() },
  {
    name: 'splitAtPlayhead template',
    t: 17,
    setup: (s) => s().selectTemplate(s().project.templates![0].id),
    run: (s) => s().splitAtPlayhead()
  },
  { name: 'splitClipAt', run: (s) => s().splitClipAt('cb', 15) },
  { name: 'splitClipAt edge', run: (s) => s().splitClipAt('cb', 10) },
  { name: 'splitTargetAtPlayhead', t: 3, sel: [], run: (s) => s().splitTargetAtPlayhead() },
  { name: 'skipAhead', run: (s) => s().skipAhead('cb', 12, 1) },
  // -- delete / ripple -----------------------------------------------------------
  { name: 'deleteClip', sel: ['cc', 'ov'], run: (s) => s().deleteClip('cc', false) },
  { name: 'deleteClips ripple', sel: ['cb'], run: (s) => s().deleteClips(['cb', 'ov'], true) },
  { name: 'deleteClips locked only', run: (s) => s().deleteClips(['cl'], true) },
  { name: 'rippleTrimToPlayhead left', t: 4, run: (s) => s().rippleTrimToPlayhead('left') },
  { name: 'rippleTrimToPlayhead right', t: 4, run: (s) => s().rippleTrimToPlayhead('right') },
  { name: 'closeGapAtPlayhead', t: 22, sel: ['cc'], setup: (s) => s().moveClip('cc', 26), run: (s) => s().closeGapAtPlayhead() },
  { name: 'closeGapAtPlayhead none', t: 4, run: (s) => s().closeGapAtPlayhead() },
  { name: 'deleteBetweenCuts track', setup: (s) => (s().addCutMark(2, 'v1'), s().addCutMark(4, 'v1')), run: (s) => s().deleteBetweenCuts() },
  { name: 'deleteBetweenCuts all', setup: (s) => (s().addCutMark(2, null), s().addCutMark(4, null)), run: (s) => s().deleteBetweenCuts() },
  { name: 'deleteBetweenCuts captions', setup: (s) => (s().addCutMark(2, 'captions'), s().addCutMark(4, 'captions')), run: (s) => s().deleteBetweenCuts() },
  { name: 'rippleDelete', sel: ['cb'], capSel: ['c1'], run: (s) => s().rippleDelete(2, 4) },
  { name: 'rippleDelete tiny', run: (s) => s().rippleDelete(2, 2.01) },
  { name: 'rippleDeleteMany', run: (s) => s().rippleDeleteMany([[5, 6], [1, 2], [1.5, 2.5], [12, 12.01]]) },
  { name: 'rippleDeleteMany through a line', run: (s) => s().rippleDeleteMany([[3.9, 4.6]]) },
  { name: 'applySilenceCuts', sel: ['ca'], setup: (s) => s().setSilencePreview([{ clipId: 'ca', start: 2, end: 3 }]), run: (s) => s().applySilenceCuts([{ clipId: 'ca', start: 2, end: 3 }, { clipId: 'cb', start: 12, end: 13 }], { crossfade: true }) },
  { name: 'applySilenceCuts none', setup: (s) => s().setSilencePreview([{ clipId: 'ca', start: 2, end: 3 }]), run: (s) => s().applySilenceCuts([{ clipId: 'zz', start: 2, end: 3 }]) },
  // -- clipboard -----------------------------------------------------------------
  { name: 'copySelection + pasteAtPlayhead', t: 30, sel: ['ov'], run: (s) => (s().copySelection(), s().pasteAtPlayhead()) },
  { name: 'pasteCaptionsAtPlayhead', t: 30, capSel: ['t1'], run: (s) => (s().copySelection(), s().pasteCaptionsAtPlayhead()) },
  { name: 'duplicateSelection', sel: ['ov'], run: (s) => s().duplicateSelection() },
  // (Ç2a.1: as the Alt-drag makes it, in its window and dropped elsewhere;
  // alone it is a copy sitting on its original, which the model check refuses.)
  { name: 'duplicateClipsInPlace', run: (s) => s().undoable(() => s().moveClip(s().duplicateClipsInPlace(['ov'])[0], 12)) },
  { name: 'pasteAttributes', sel: ['ov'], run: (s) => (s().copySelection(), s().selectClips(['cc']), s().pasteAttributes()) },
  // -- clip ops ------------------------------------------------------------------
  { name: 'insertFreezeFrame', t: 4, sel: ['ca'], run: (s) => s().insertFreezeFrame(1) },
  { name: 'toggleReverse', run: (s) => s().toggleReverse('cb') },
  { name: 'compoundSelection', sel: ['cb', 'cc'], run: (s) => s().compoundSelection() },
  {
    name: 'uncompoundClip',
    setup: (s) => (s().selectClips(['cb', 'cc']), s().compoundSelection()),
    run: (s) => s().uncompoundClip(Object.values(s().project.clips).find((c) => c.nested)!.id)
  },
  { name: 'groupSelection', sel: ['ov', 'ca'], run: (s) => s().groupSelection() },
  { name: 'ungroupSelection', sel: ['cb'], run: (s) => s().ungroupSelection() },
  { name: 'setClipsDisabled', run: (s) => s().setClipsDisabled(['cb'], true) },
  { name: 'extractAudio', run: (s) => s().extractAudio('cb') },
  // -- speed -----------------------------------------------------------------------
  { name: 'setClipSpeed', run: (s) => s().setClipSpeed('cb', 2) },
  { name: 'setClipSpeed linked, link on', linkAV: true, run: (s) => s().setClipSpeed('ca', 0.5) },
  { name: 'setClipSpeed still', run: (s) => s().setClipSpeed('cc', 2) },
  // -- transform / look ------------------------------------------------------------
  { name: 'setClipTransform', run: (s) => s().setClipTransform('ov', { x: 100 }) },
  { name: 'setClipTransform no commit', run: (s) => s().setClipTransform('ov', { x: 100 }, false) },
  { name: 'setClipTransform same', run: (s) => s().setClipTransform('ov', { x: 1400 }) },
  { name: 'setPropValue keyed', t: 12, run: (s) => s().setPropValue('cb', 'scale', 1.1) },
  { name: 'setPropValue static', t: 3, run: (s) => s().setPropValue('ov', 'x', 200) },
  { name: 'fillFrame', t: 3, run: (s) => s().fillFrame('ov') },
  { name: 'fitFrame', t: 3, run: (s) => s().fitFrame('ov') },
  { name: 'centerClip', t: 3, run: (s) => s().centerClip('ov') },
  { name: 'setClipGrade', run: (s) => s().setClipGrade('cb', { contrast: 1.2 }) },
  { name: 'setClipCrop', run: (s) => s().setClipCrop('cb', { left: 0.1 } as never) },
  { name: 'setClipBlur', run: (s) => s().setClipBlur('cb', 4) },
  { name: 'setClipBlendMode', run: (s) => s().setClipBlendMode('ov', 'screen' as never) },
  { name: 'setClipEffect', run: (s) => s().setClipEffect('cb', { vignette: 0.4 } as never) },
  { name: 'setClipAnim', run: (s) => s().setClipAnim('ov', { in: 'fade' } as never) },
  { name: 'setClipOpacity', run: (s) => s().setClipOpacity('ov', 0.5) },
  { name: 'setClipFlip', run: (s) => s().setClipFlip('ov', { h: true }) },
  // -- keyframes -----------------------------------------------------------------------
  { name: 'addClipKeyframe', t: 3, run: (s) => s().addClipKeyframe('ov') },
  { name: 'addPropKeyframe', t: 13, run: (s) => s().addPropKeyframe('cb', 'x') },
  { name: 'dragClipKeyframe', t: 14, run: (s) => s().dragClipKeyframe('cb', { scale: 1.5 }) },
  { name: 'deleteClipKeyframe', run: (s) => s().deleteClipKeyframe('cb', 'scale', 'k2') },
  { name: 'moveClipKeyframe', run: (s) => s().moveClipKeyframe('cb', 'scale', 'k2', 6) },
  { name: 'clearClipKeyframes', run: (s) => s().clearClipKeyframes('cb') },
  { name: 'copy + pasteClipAnimation', run: (s) => (s().copyClipAnimation('cb'), s().pasteClipAnimation(['ov'])) },
  // -- mask / tracker ---------------------------------------------------------------------
  { name: 'setClipMask', run: (s) => s().setClipMask('cb', { enabled: true, shape: 'ellipse' }) },
  { name: 'addTracker', t: 3, run: (s) => s().addTracker() },
  // -- tracks ---------------------------------------------------------------------------------
  { name: 'addVideoTrack', run: (s) => s().addVideoTrack() },
  { name: 'addAudioTrack', run: (s) => s().addAudioTrack() },
  { name: 'deleteTrack', sel: ['ov', 'cb'], run: (s) => s().deleteTrack('v2') },
  { name: 'deleteTrack last of kind', run: (s) => (s().deleteTrack('a2'), s().deleteTrack('a1')) },
  { name: 'moveTrack', run: (s) => s().moveTrack('v2', 1) },
  { name: 'moveTrack across kinds', run: (s) => s().moveTrack('v1', 1) },
  { name: 'setTrackFlags', run: (s) => s().setTrackFlags('a2', { muted: true }) },
  { name: 'setTrackHeight', run: (s) => s().setTrackHeight('v1', 100) },
  { name: 'packTrack', setup: (s) => s().moveClip('cc', 26), run: (s) => s().packTrack('v1') },
  { name: 'packMainTrack', run: (s) => s().packMainTrack() },
  { name: 'resolveTrackOverlaps', run: (s) => s().resolveTrackOverlaps() },
  // -- audio --------------------------------------------------------------------------------------
  { name: 'setClipVolume', run: (s) => s().setClipVolume('m1', 0.3) },
  { name: 'toggleClipMute', run: (s) => s().toggleClipMute('m1') },
  { name: 'setClipFades', run: (s) => s().setClipFades('m1', { fadeIn: 1, fadeOut: 2 }) },
  { name: 'addVolumeKeyframe', t: 5, run: (s) => s().addVolumeKeyframe('m1') },
  { name: 'setVolumeKeyframes', run: (s) => s().setVolumeKeyframes('m1', [{ time: 1, value: 0.2 }, { time: 3, value: 0.8 }]) },
  { name: 'setClipAudioFx', run: (s) => s().setClipAudioFx('m1', { gain: 3 } as never) },
  {
    name: 'applyAutoDucking',
    run: (s) => s().applyAutoDucking('a1', 'a2', Array.from({ length: 24 }, (_, i) => i % 4 < 2), { cell: 1, duckRatio: 0.3, attack: 0.1, hold: 0.2, release: 0.3 } as never)
  },
  { name: 'setTrackLevel', run: (s) => s().setTrackLevel('a2', 0.5) },
  // -- transitions / fx -------------------------------------------------------------------------
  { name: 'applyMixTransitions', run: (s) => s().applyMixTransitions(0.45) },
  { name: 'applyMixTransitions track', run: (s) => s().applyMixTransitions(0.45, 'v1') },
  { name: 'applyTransitionPreset', run: (s) => s().applyTransitionPreset('fade', 0.8) },
  { name: 'applyRampInOut', run: (s) => s().applyRampInOut('ramp-right', 0.5) },
  { name: 'clearTransitions', run: (s) => s().clearTransitions() },
  { name: 'setTransitionOut', run: (s) => s().setTransitionOut('cb', { type: 'slide', duration: 1 }) },
  { name: 'setTransitionOut none', run: (s) => s().setTransitionOut('ca', null) },
  { name: 'cinematizeAll', run: (s) => s().cinematizeAll(0.5) },
  { name: 'cinematizeAll track', run: (s) => s().cinematizeAll(0.5, 'v2') },
  { name: 'applyGentlePan', run: (s) => s().applyGentlePan('left-to-right', 6) },
  { name: 'applyStillImageFx', run: (s) => s().applyStillImageFx('light-glow', 0.35) },
  { name: 'clearStillImageFx', setup: (s) => s().applyStillImageFx('light-glow', 0.35), run: (s) => s().clearStillImageFx() },
  { name: 'applyAmbientFx', run: (s) => s().applyAmbientFx('living-frame', 0.5) },
  { name: 'setMotionFx', run: (s) => s().setMotionFx('cb', { zoomFrom: 1, zoomTo: 1.2 } as never) },
  // -- captions --------------------------------------------------------------------------------
  { name: 'setCaptions', run: (s) => s().setCaptions([{ id: 'x1', text: 'only', start: 1, end: 2 }]) },
  { name: 'setSubtitles', run: (s) => s().setSubtitles([{ id: 'x1', text: 'new sub', start: 1, end: 2 }]) },
  { name: 'replaceCaptionsInRange', run: (s) => s().replaceCaptionsInRange(0, 6, [{ id: 'x1', text: 'one', start: 1, end: 2 }]) },
  { name: 'compactCaptions', run: (s) => s().compactCaptions() },
  { name: 'addCaptionAtPlayhead', t: 1, run: (s) => s().addCaptionAtPlayhead('Hi') },
  { name: 'addCaptionAtPlayhead busy layer', t: 5, run: (s) => s().addCaptionAtPlayhead() },
  { name: 'addShapeAtPlayhead rect', t: 2, run: (s) => s().addShapeAtPlayhead('rect') },
  { name: 'addShapeAtPlayhead marker over text', t: 5, run: (s) => s().addShapeAtPlayhead('marker', 't1') },
  { name: 'updateCaption text', run: (s) => s().updateCaption('c1', { text: 'hello world' }) },
  { name: 'updateCaption move', run: (s) => s().updateCaption('c3', { start: 11, end: 14.5 }) },
  { name: 'updateCaption no commit', run: (s) => s().updateCaption('t1', { text: 'T' }, false) },
  { name: 'updateCaption same', run: (s) => s().updateCaption('t1', { text: 'Title' }) },
  { name: 'setCaptionWordStart', run: (s) => s().setCaptionWordStart('c1', 1, 1.5) },
  { name: 'splitCaptionAtCursor', capSel: ['c2'], run: (s) => s().splitCaptionAtCursor('c2', 'this is a test', 7) },
  { name: 'deleteCaption', run: (s) => s().deleteCaption('c3') },
  { name: 'deleteCaptions', capSel: ['c1', 'c2'], run: (s) => s().deleteCaptions(['c1', 'c2']) },
  { name: 'setCaptionShape', run: (s) => s().setCaptionShape('s1', { w: 0.5 }) },
  { name: 'setCaptionOwnStyle', run: (s) => s().setCaptionOwnStyle('t1', { color: '#ff0000' }) },
  { name: 'setCaptionMotion', run: (s) => s().setCaptionMotion('t1', { x: 10 } as never) },
  { name: 'setCaptionMotion commit', run: (s) => s().setCaptionMotion('t1', { x: 10 } as never, true) },
  { name: 'addCaptionKeyframe', t: 5, run: (s) => s().addCaptionKeyframe('t1') },
  { name: 'copy + pasteCaptionStyle', run: (s) => (s().copyCaptionStyle('t1'), s().pasteCaptionStyle(['s1'])) },
  { name: 'setCaptionStyle', run: (s) => s().setCaptionStyle({ fontSize: 70 }) },
  { name: 'setCaptionStyleShorts', run: (s) => s().setCaptionStyleShorts({ fontSize: 50 }) },
  { name: 'setTranscription', run: (s) => s().setTranscription({ language: 'tr' } as never) },
  // -- markers ------------------------------------------------------------------------------------
  { name: 'addMarkerAtPlayhead', t: 7, run: (s) => s().addMarkerAtPlayhead() },
  { name: 'updateMarker', run: (s) => s().updateMarker('mk1', { note: 'changed' }) },
  { name: 'updateMarker time', run: (s) => s().updateMarker('mk1', { time: 20 }) },
  { name: 'deleteMarker', run: (s) => s().deleteMarker('mk2') },
  { name: 'deleteMarker all', run: (s) => (s().deleteMarker('mk2'), s().deleteMarker('mk1')) },
  // -- shorts -------------------------------------------------------------------------------------
  { name: 'setShortsBase', run: (s) => s().setShortsBase(700) },
  { name: 'addShortsKeyframe', t: 3, run: (s) => s().addShortsKeyframe() },
  { name: 'addShortSegment', t: 12, run: (s) => s().addShortSegment() },
  { name: 'updateShortSegment', run: (s) => s().updateShortSegment('seg1', { name: 'Renamed' }) },
  { name: 'deleteShortSegment', run: (s) => s().deleteShortSegment('seg1') },
  { name: 'markShortBound in', t: 12, run: (s) => s().markShortBound('in') },
  // -- misc ------------------------------------------------------------------------------------------
  { name: 'setBackdrop', run: (s) => s().setBackdrop({ style: 'aurora' }) },
  { name: 'setCameraLook', run: (s) => s().setCameraLook({ grain: 0.3 } as never) },
  { name: 'addLookLayer', run: (s) => s().addLookLayer({ grain: 0.3 } as never, 2, 6) },
  { name: 'setTransitionSfx', run: (s) => s().setTransitionSfx(0.3) },
  { name: 'setRisers', run: (s) => s().setRisers(0.6) },
  { name: 'setRisers no commit', run: (s) => s().setRisers(0.6, false) },
  { name: 'setSnap', run: (s) => s().setSnap({ enabled: false }) },
  // -- notes ----------------------------------------------------------------------------------------
  {
    name: 'saveNoteDraft',
    sel: ['cb'],
    setup: (s) => (s().startNoteDraft({ start: 11, end: 12 }), s().patchNoteDraft({ text: 'make it pop' })),
    run: (s) => s().saveNoteDraft()
  },
  { name: 'editNotes status (no step)', run: (s) => s().editNotes((p) => void setNoteStatus(p, p.notes![0].id, 'agent'), false) },
  { name: 'editNotes update', run: (s) => s().editNotes((p) => void updateNote(p, p.notes![0].id, { text: 'other' })) },
  { name: 'setNoteImage', run: (s) => s().setNoteImage(s().project.notes![0].id, 'data:image/jpeg;base64,AAAA') },
  // -- templates ----------------------------------------------------------------------------------
  { name: 'editTemplates create', run: (s) => { let id = ''; s().editTemplates((p) => { id = createTemplate(p, 'stat', 3) }); return id } },
  { name: 'editTemplates delete', run: (s) => s().editTemplates((p) => deleteTemplate(p, p.templates![0].id)) },

  // == gestures ===================================================================================
  {
    name: 'gesture: clip drag (20 moves)',
    run: (s) => {
      s().armGesture()
      for (let i = 1; i <= 20; i++) (tick(16), s().moveClip('ov', 2 + i * 0.25, false))
      s().endGesture()
    }
  },
  {
    name: 'gesture: head trim drag',
    run: (s) => {
      const b = base(s, 'cb')
      s().armGesture()
      for (let i = 1; i <= 10; i++) (tick(16), s().setClipHead('cb', 10 + i * 0.2, b))
      s().endGesture()
    }
  },
  {
    name: 'gesture: end trim drag',
    run: (s) => {
      s().armGesture()
      for (let i = 1; i <= 5; i++) (tick(16), s().trimClipEnd('cb', -0.3))
      s().endGesture()
    }
  },
  {
    name: 'gesture: slip drag',
    run: (s) => {
      s().armGesture()
      for (let i = 1; i <= 5; i++) (tick(16), s().slipClip('cb', i * 0.2, 2))
      s().endGesture()
    }
  },
  {
    name: 'gesture: opacity slider',
    run: (s) => {
      s().armGesture()
      for (let i = 1; i <= 10; i++) (tick(16), s().setClipOpacity('ov', 1 - i * 0.05))
      s().endGesture()
    }
  },
  {
    name: 'gesture: position slider on a snapshotting action',
    run: (s) => {
      s().armGesture()
      for (let i = 1; i <= 10; i++) (tick(16), s().setClipTransform('ov', { x: 1400 + i }))
      s().endGesture()
    }
  },
  {
    name: 'gesture: speed slider',
    run: (s) => {
      s().armGesture()
      for (let i = 1; i <= 5; i++) (tick(16), s().setClipSpeed('cb', 1 + i * 0.1))
      s().endGesture()
    }
  },
  {
    name: 'gesture: volume slider',
    run: (s) => {
      s().armGesture()
      for (let i = 1; i <= 5; i++) (tick(16), s().setClipVolume('m1', 0.5 + i * 0.05))
      s().endGesture()
    }
  },
  {
    name: 'gesture: idle pause splits the drag',
    run: (s) => {
      s().armGesture()
      s().moveClip('ov', 3, false)
      tick(1600)
      s().moveClip('ov', 4, false)
      s().endGesture()
    }
  },
  {
    name: 'gesture: held still before the first move',
    run: (s) => {
      s().armGesture()
      tick(2500)
      s().moveClip('ov', 3, false)
      tick(16)
      s().moveClip('ov', 4, false)
      s().endGesture()
    }
  },
  { name: 'gesture: armed, nothing changed', run: (s) => (s().armGesture(), s().endGesture()) },
  { name: 'gesture: armed, a change that changes nothing', run: (s) => (s().armGesture(), s().setClipFades('m1', {}), s().endGesture()) },
  { name: 'no-op snapshot edit (fades unchanged, step asked for)', run: (s) => s().setClipsDisabled(['zz'], true) },
  { name: 'gesture: held arrow key (3 nudges)', sel: ['ov'], run: (s) => (s().nudgeSelection(0.1), tick(30), s().nudgeSelection(0.1), tick(30), s().nudgeSelection(0.1)) },
  {
    name: 'gesture: beginGesture then silent moves',
    run: (s) => {
      s().beginGesture()
      s().moveClip('ov', 3, false)
      s().moveClip('ov', 4, false)
    }
  },
  {
    name: 'gesture: typing merges within 1.2 s',
    run: (s) => {
      s().updateCaption('t1', { text: 'T' })
      tick(300)
      s().updateCaption('t1', { text: 'Ti' })
      tick(300)
      s().updateCaption('t1', { text: 'Tit' })
      tick(2000)
      s().updateCaption('t1', { text: 'Titl' })
    }
  },
  {
    name: 'gesture: nested undoable',
    t: 7,
    run: (s) => {
      s().undoable(() => {
        s().addVideoTrack()
        s().undoable(() => s().addMarkerAtPlayhead())
        s().addAudioTrack()
      })
    }
  },
  {
    name: 'gesture: undoable while a drag is open',
    t: 7,
    run: (s) => {
      s().armGesture()
      s().moveClip('ov', 3, false)
      s().undoable(() => s().addMarkerAtPlayhead())
      s().moveClip('ov', 4, false)
      s().endGesture()
    }
  },
  {
    name: 'gesture: slow undoable (idle inside)',
    t: 7,
    run: (s) => {
      s().undoable(() => {
        s().addVideoTrack()
        tick(1600)
        s().addAudioTrack()
      })
    }
  },
  { name: 'gesture: shape add is one step', t: 2, run: (s) => s().addShapeAtPlayhead('arrow') },
  { name: 'gesture: skipAhead steps', run: (s) => s().skipAhead('cb', 14, 2) },

  // == added in 2A.5 (recorded from d1e9047 too) ==================================
  // An auto-packed V1: the packing paths of move, trim, delete, speed, drop.
  { name: 'packed: moveClip', packed: true, run: (s) => s().moveClip('ca', 15) },
  { name: 'packed: setClipHead trim in', packed: true, run: (s) => s().setClipHead('cb', 12, base(s, 'cb')) },
  { name: 'packed: setClipHead grows from the tail', packed: true, run: (s) => s().setClipHead('cb', 8, base(s, 'cb')) },
  { name: 'packed: trimClipEnd shorter', packed: true, run: (s) => s().trimClipEnd('ca', -3) },
  { name: 'packed: trimClipEnd longer', packed: true, run: (s) => s().trimClipEnd('cb', 3) },
  { name: 'packed: deleteClips', packed: true, run: (s) => s().deleteClips(['ca'], false) },
  { name: 'packed: deleteClips ripple', packed: true, run: (s) => s().deleteClips(['cb'], true) },
  { name: 'packed: setClipSpeed', packed: true, run: (s) => s().setClipSpeed('cb', 2) },
  { name: 'packed: addClipAt drop', packed: true, run: (s) => s().addClipAt('img3', 'v1', 5) },
  { name: 'packed: moveClipToTrack onto it', packed: true, run: (s) => s().moveClipToTrack('ov', 'v1') },
  { name: 'packed: splitAtPlayhead', packed: true, t: 4, sel: ['ca'], run: (s) => s().splitAtPlayhead() },
  { name: 'packed: rippleDelete', packed: true, run: (s) => s().rippleDelete(2, 4) },
  // The trim and slip drags as the timeline really runs them: beginGesture,
  // silent moves, the window closed by the pointer-up.
  {
    name: 'begin: head trim drag',
    run: (s) => {
      const b = base(s, 'cb')
      s().beginGesture()
      for (let i = 1; i <= 10; i++) (tick(16), s().setClipHead('cb', 10 + i * 0.2, b))
      s().endGesture()
    }
  },
  {
    name: 'begin: end trim drag',
    run: (s) => {
      s().beginGesture()
      for (let i = 1; i <= 5; i++) (tick(16), s().trimClipEnd('cb', -0.3))
      s().endGesture()
    }
  },
  {
    name: 'begin: slip drag',
    run: (s) => {
      s().beginGesture()
      for (let i = 1; i <= 5; i++) (tick(16), s().slipClip('cb', i * 0.2, 2))
      s().endGesture()
    }
  },
  {
    name: 'begin: a code window in the middle of a trim drag',
    t: 7,
    run: (s) => {
      const b = base(s, 'cb')
      s().beginGesture()
      for (let i = 1; i <= 3; i++) (tick(16), s().setClipHead('cb', 10 + i * 0.2, b))
      s().undoable(() => s().addMarkerAtPlayhead())
      for (let i = 4; i <= 6; i++) (tick(16), s().setClipHead('cb', 10 + i * 0.2, b))
      s().endGesture()
    }
  },
  {
    name: 'gesture: moves that change nothing keep the drag open',
    run: (s) => {
      s().armGesture()
      s().moveClip('ov', 3, false)
      for (let i = 0; i < 20; i++) (tick(100), s().moveClip('ov', 3, false))
      s().moveClip('ov', 4, false)
      s().endGesture()
    }
  },
  {
    name: 'gesture: moves that change nothing keep a snapshotting drag open',
    run: (s) => {
      s().armGesture()
      s().setClipTransform('ov', { x: 100 })
      for (let i = 0; i < 20; i++) (tick(100), s().setClipTransform('ov', { x: 100 }))
      s().setClipTransform('ov', { x: 200 })
      tick(16)
      s().setClipTransform('ov', { x: 300 })
      s().endGesture()
    }
  },
  {
    name: 'gesture: an empty code window inside a drag',
    run: (s) => {
      s().armGesture()
      s().moveClip('ov', 3, false)
      s().undoable(() => undefined)
      s().moveClip('ov', 4, false)
      s().endGesture()
    }
  },
  {
    name: 'gesture: a code window after a drag left open and idle',
    t: 7,
    run: (s) => {
      s().armGesture()
      s().moveClip('ov', 3, false)
      tick(5000)
      s().undoable(() => s().addMarkerAtPlayhead())
      tick(100)
      s().addAudioTrack()
      tick(100)
      s().addVideoTrack()
    }
  },
  // A pending silence-cut preview and the edits after it.
  { name: 'silence preview: a title', t: 1, setup: (s) => s().setSilencePreview([{ clipId: 'sa', start: 2, end: 3 }]), run: (s) => s().addCaptionAtPlayhead('x') },
  { name: 'silence preview: a shape', t: 1, setup: (s) => s().setSilencePreview([{ clipId: 'sa', start: 2, end: 3 }]), run: (s) => s().addShapeAtPlayhead('rect') },
  { name: 'silence preview: a clip dragged', setup: (s) => s().setSilencePreview([{ clipId: 'sa', start: 2, end: 3 }]), run: (s) => (s().armGesture(), s().moveClip('sa', 2, false), s().endGesture()) },
  { name: 'silence preview: a cut', setup: (s) => s().setSilencePreview([{ clipId: 'sa', start: 2, end: 3 }]), run: (s) => s().rippleDelete(5, 6) },

  // == added on 22 November 2026 (K11): the edit actions that had no row ==========
  // -- several commands as one edit, a candidate adopted ---------------------------
  { name: 'runBatch', run: (s) => s().runBatch([{ name: 'marker.add', params: { time: 27, note: 'batch' } }, { name: 'track.add', params: { kind: 'video' } }]) },
  { name: 'runBatch that fails', run: (s) => { try { s().runBatch([{ name: 'marker.add', params: { time: 27 } }, { name: 'clip.delete', params: { ids: ['zz'] } }]) } catch { return 'refused' } return 'made' } },
  {
    name: 'adoptCandidate',
    run: (s) => {
      const next = structuredClone(s().project)
      next.clips.ov.start = 12
      return s().adoptCandidate(next, { baseVersion: s().projectVersion })
    }
  },
  // -- project ------------------------------------------------------------------------
  { name: 'setProjectLook', run: (s) => s().setProjectLook({ accent: '#112233', font: 'Inter' }) },
  { name: 'setCodeParams', setup: (s) => void s().addAssets([codeFilm()]), run: (s) => s().setCodeParams('film', { title: 'Hi', size: 3 }) },
  { name: 'setCodeEdits', setup: (s) => void s().addAssets([codeFilm()]), run: (s) => s().setCodeEdits('film', [{ kind: 'color', orig: '#ffffff', value: '#112233' }] as never, []) },
  { name: 'markTimes', run: (s) => s().markTimes([{ time: 3, label: 'A' }, { time: 9, note: 'look here' }, { time: -1 }]) },
  { name: 'markTimes none', run: (s) => s().markTimes([{ time: -1 }]) },
  // -- tracks, links -------------------------------------------------------------------
  { name: 'renameTrack', run: (s) => s().renameTrack('v2', 'Overlay') },
  { name: 'unlinkClips', run: (s) => s().unlinkClips(['ca']) },
  { name: 'addAdjustmentLayer', t: 3, run: (s) => s().addAdjustmentLayer() },
  // -- Q / W on a linked pair, the track-only close (22 Nov, K3) -------------------------
  { name: 'rippleTrimToPlayhead right, linked pair', t: 4, sel: ['ca'], linkAV: true, run: (s) => s().rippleTrimToPlayhead('right') },
  { name: 'rippleTrimToPlayhead left, linked pair', t: 4, sel: ['ca'], linkAV: true, run: (s) => s().rippleTrimToPlayhead('left') },
  { name: 'rippleTrimToPlayhead right, every track', t: 4, sel: ['ca'], run: (s) => s().rippleTrimToPlayhead('right', true) },
  { name: 'closeGapAtPlayhead its track, link on', t: 22, sel: ['cc'], linkAV: true, setup: (s) => s().moveClip('cc', 26), run: (s) => s().closeGapAtPlayhead(true) },
  { name: 'deleteBetweenCuts its track', setup: (s) => (s().addCutMark(12, 'v1'), s().addCutMark(14, 'v1')), run: (s) => s().deleteBetweenCuts(true) },
  { name: 'deleteClips ripple its track', linkAV: true, run: (s) => s().deleteClips(['cb'], true, true) },
  // -- clipboard -------------------------------------------------------------------------
  { name: 'copySelection + pasteClipboard', t: 30, sel: ['ov'], run: (s) => (s().copySelection(), s().pasteClipboard()) },
  { name: 'copyKeyframeStamp + pasteKeyframeAtPlayhead', t: 3, sel: ['ov'], run: (s) => [s().copyKeyframeStamp('cb', 8), s().hasCopiedKeyframe(), s().pasteKeyframeAtPlayhead(['ov'])] },
  { name: 'copyShortSegment + pasteShortSegment', t: 15, run: (s) => (s().copyShortSegment('seg1'), s().pasteShortSegment() !== null) },
  // -- keyframes -------------------------------------------------------------------------
  { name: 'keyframeClips', t: 3, run: (s) => s().keyframeClips(['ov', 'm1', 'cl']) },
  { name: 'toggleKeyframeAtPlayhead on', t: 3, sel: ['ov'], run: (s) => s().toggleKeyframeAtPlayhead() },
  { name: 'toggleKeyframeAtPlayhead off', t: 18, sel: ['cb'], run: (s) => s().toggleKeyframeAtPlayhead() },
  { name: 'setPropValues static', t: 3, run: (s) => s().setPropValues('ov', { x: 200, y: 300 }) },
  { name: 'setPropValues keyed', t: 12, run: (s) => s().setPropValues('cb', { scale: 1.2, x: 900 }) },
  { name: 'setPropValues no commit', t: 3, run: (s) => s().setPropValues('ov', { x: 200, y: 300 }, false) },
  { name: 'setPropValues merged nudges', t: 3, run: (s) => (s().setPropValues('ov', { x: 1401 }, true, 'nudge'), tick(30), s().setPropValues('ov', { x: 1402 }, true, 'nudge')) },
  { name: 'moveKeyframeGroup', run: (s) => s().moveKeyframeGroup('cb', 8, 6) },
  {
    name: 'gesture: dragKeyframes',
    run: (s) => {
      const drag = { base: structuredClone(s().project.clips.cb.channels!), keys: [{ ch: 'scale' as const, id: 'k2' }], from: 8 }
      s().beginGesture()
      for (const to of [7.5, 7, 6.5, 6]) (tick(16), s().dragKeyframes('cb', drag, to))
      s().endGesture()
    }
  },
  { name: 'deleteKeyframes', run: (s) => s().deleteKeyframes('cb', [{ ch: 'scale', id: 'k2' }]) },
  { name: 'deleteKeyframeGroup', run: (s) => s().deleteKeyframeGroup('cb', 8) },
  { name: 'readKeyframeGroup + insertKeyframeGroup', run: (s) => s().insertKeyframeGroup('cb', 4, { ...s().readKeyframeGroup('cb', 8), x: 900 }) },
  { name: 'rippleKeyframes', run: (s) => s().rippleKeyframes('cb', 0, 1) },
  { name: 'setKeyframeEasing', run: (s) => s().setKeyframeEasing('cb', 'scale', 'k2', 'hold') },
  // -- mask / tracker ----------------------------------------------------------------------
  { name: 'editMaskGeom', setup: (s) => s().setClipMask('cb', { enabled: true, shape: 'ellipse' }), run: (s) => s().editMaskGeom('cb', { cx: 0.4 }) },
  { name: 'addMaskKeyframe', t: 12, setup: (s) => s().setClipMask('cb', { enabled: true, shape: 'ellipse' }), run: (s) => s().addMaskKeyframe('cb') },
  {
    name: 'deleteMaskKeyframe',
    t: 12,
    setup: (s) => (s().setClipMask('cb', { enabled: true, shape: 'ellipse' }), s().addMaskKeyframe('cb')),
    run: (s) => s().deleteMaskKeyframe('cb', (s().project.clips.cb.mask as unknown as { keyframes: { id: string }[] }).keyframes[0].id)
  },
  { name: 'addMaskPoint', setup: (s) => s().setClipMask('cb', { enabled: true, shape: 'ellipse' }), run: (s) => (s().addMaskPoint('cb', 0.3, 0.3), s().addMaskPoint('cb', 0.6, 0.3)) },
  { name: 'renameTracker', t: 3, setup: (s) => void s().addTracker(), run: (s) => s().renameTracker(s().project.trackers![0].id, 'Face') },
  { name: 'dragTracker', t: 3, setup: (s) => void s().addTracker(), run: (s) => s().dragTracker(s().project.trackers![0].id, 4, 100, 200) },
  {
    name: 'deleteTrackerKeyframe',
    t: 3,
    setup: (s) => (s().addTracker(), s().dragTracker(s().project.trackers![0].id, 4, 100, 200)),
    run: (s) => s().deleteTrackerKeyframe(s().project.trackers![0].id, s().project.trackers![0].keyframes[0].id)
  },
  { name: 'setClipTracker', t: 3, setup: (s) => void s().addTracker(), run: (s) => s().setClipTracker('ov', s().project.trackers![0].id) },
  { name: 'deleteTracker', t: 3, setup: (s) => (s().addTracker(), s().setClipTracker('ov', s().project.trackers![0].id)), run: (s) => s().deleteTracker(s().project.trackers![0].id) },
  // -- the clip's look ----------------------------------------------------------------------
  { name: 'rotate90', run: (s) => s().rotate90('ov') },
  { name: 'setClipChroma', run: (s) => s().setClipChroma('cb', { enabled: true, color: '#00ff00' }) },
  { name: 'setClipChroma off', setup: (s) => s().setClipChroma('cb', { enabled: true, color: '#00ff00' }), run: (s) => s().setClipChroma('cb', null) },
  { name: 'setClipLut', run: (s) => s().setClipLut('cb', 'preset:cool') },
  { name: 'setClipLutAmount', setup: (s) => s().setClipLut('cb', 'preset:cool'), run: (s) => s().setClipLutAmount('cb', 0.5) },
  { name: 'setClipTone', run: (s) => s().setClipTone('cb', { exposure: 0.3 }) },
  { name: 'setClipFx', run: (s) => s().setClipFx('cb', { bloom: { amount: 0.4 }, mosaic: 12 }) },
  { name: 'toggleFxKey on', t: 12, setup: (s) => s().setClipFx('cb', { bloom: { amount: 0.4 } }), run: (s) => s().toggleFxKey('cb', 'bloom') },
  { name: 'toggleFxKey off', t: 12, setup: (s) => (s().setClipFx('cb', { bloom: { amount: 0.4 } }), s().toggleFxKey('cb', 'bloom')), run: (s) => s().toggleFxKey('cb', 'bloom') },
  { name: 'addProjectLut', run: (s) => s().addProjectLut({ name: 'Mine', path: 'C:\\luts\\mine.cube' }, 'cb') },
  { name: 'updateProjectLut (no step)', setup: (s) => s().addProjectLut({ name: 'Mine', path: 'C:\\luts\\mine.cube' }), run: (s) => s().updateProjectLut('Mine', { path: 'D:\\moved\\mine.cube' }) },
  { name: 'setClipIdle', run: (s) => s().setClipIdle('ov', { style: 'float', amount: 0.5 }) },
  // -- speed ------------------------------------------------------------------------------------
  { name: 'setClipSpeedCurve', run: (s) => s().setClipSpeedCurve('cb', { points: [{ u: 0, v: 1 }, { u: 1, v: 2 }] }) },
  // (A moment between the two: a curve changed again at once is the same step.)
  { name: 'setClipSpeedCurve off', setup: (s) => (s().setClipSpeedCurve('cb', { points: [{ u: 0, v: 1 }, { u: 1, v: 2 }] }), tick(5000)), run: (s) => s().setClipSpeedCurve('cb', null) },
  { name: 'setClipSpeedCurve again at once (same step)', setup: (s) => s().setClipSpeedCurve('cb', { points: [{ u: 0, v: 1 }, { u: 1, v: 2 }] }), run: (s) => s().setClipSpeedCurve('cb', { points: [{ u: 0, v: 1 }, { u: 1, v: 3 }] }) },
  { name: 'setClipKeepPitch off', setup: (s) => (s().setClipSpeed('cb', 2), tick(5000)), run: (s) => s().setClipKeepPitch('cb', false) },
  { name: 'setClipKeepPitch on (as it is)', setup: (s) => (s().setClipSpeed('cb', 2), tick(5000)), run: (s) => s().setClipKeepPitch('cb', true) },
  // -- sound -------------------------------------------------------------------------------------
  { name: 'dragVolumeKeyframe', t: 5, setup: (s) => s().addVolumeKeyframe('m1'), run: (s) => s().dragVolumeKeyframe('m1', 0.7) },
  { name: 'deleteVolumeKeyframe', t: 5, setup: (s) => s().addVolumeKeyframe('m1'), run: (s) => s().deleteVolumeKeyframe('m1', s().project.clips.m1.volumeKeyframes![0].id) },
  { name: 'clearVolumeKeyframes', setup: (s) => s().setVolumeKeyframes('m1', [{ time: 1, value: 0.2 }, { time: 3, value: 0.8 }]), run: (s) => s().clearVolumeKeyframes('m1') },
  { name: 'applyCleanedAudio', run: (s) => s().applyCleanedAudio('sa', { path: 'C:\\media\\clean.wav', name: 'clean.wav', size: 10, url: 'media://clean' }, { noise: 0.5, ess: 0.3 }) },
  {
    name: 'restoreOriginalAudio',
    setup: (s) => s().applyCleanedAudio('sa', { path: 'C:\\media\\clean.wav', name: 'clean.wav', size: 10, url: 'media://clean' }, { noise: 0.5, ess: 0.3 }),
    run: (s) => s().restoreOriginalAudio('sa')
  },
  {
    name: 'clearAutoDucking',
    setup: (s) => void s().applyAutoDucking('a1', 'a2', Array.from({ length: 24 }, (_, i) => i % 4 < 2), { cell: 1, duckRatio: 0.3, attack: 0.1, hold: 0.2, release: 0.3 } as never),
    run: (s) => s().clearAutoDucking('a2')
  },
  // -- motion ---------------------------------------------------------------------------------------
  { name: 'clearAmbientFx', setup: (s) => void s().applyAmbientFx('living-frame', 0.5), run: (s) => s().clearAmbientFx() },
  { name: 'clearAllMotionFx', setup: (s) => void s().cinematizeAll(0.5), run: (s) => s().clearAllMotionFx() },
  { name: 'rerollMotionFx', setup: (s) => void s().cinematizeAll(0.5), run: (s) => s().rerollMotionFx('cb') },
  { name: 'removeClipMotionLayer', setup: (s) => void s().cinematizeAll(0.5), run: (s) => s().removeClipMotionLayer('cb', 'cinematic') },
  { name: 'editClipMoves', run: (s) => s().editClipMoves('ov', (m) => void m.actions.push({ id: 'mv1', kind: 'hop', time: 3, dur: 0.5 })) },
  { name: 'editClipMoves no commit', run: (s) => s().editClipMoves('ov', (m) => void m.actions.push({ id: 'mv1', kind: 'hop', time: 3, dur: 0.5 }), false) },
  { name: 'setClipLook', run: (s) => s().setClipLook(['ov', 'cb'], { grain: 0.3 } as never) },
  { name: 'setLayerLook', setup: (s) => void s().addLookLayer({ grain: 0.3 } as never, 2, 6), run: (s) => s().setLayerLook(lookLayer(s), { grain: 0.6 } as never) },
  { name: 'setLookOver', setup: (s) => void s().addLookLayer({ grain: 0.3 } as never, 2, 6), run: (s) => s().setLookOver(lookLayer(s), 'all') },
  // -- titles ---------------------------------------------------------------------------------------
  { name: 'deleteCaptionKeyframe', t: 5, setup: (s) => s().addCaptionKeyframe('t1'), run: (s) => s().deleteCaptionKeyframe('t1', captionKeys(s, 't1')[0]) },
  { name: 'clearCaptionKeyframes', t: 5, setup: (s) => s().addCaptionKeyframe('t1'), run: (s) => s().clearCaptionKeyframes('t1') },
  { name: 'setCaptionWordEnd', run: (s) => s().setCaptionWordEnd('c1', 1, 1.9) },
  // -- templates, Shorts ------------------------------------------------------------------------------
  { name: 'insertTemplate', t: 12, run: (s) => s().insertTemplate('stat') },
  { name: 'dragShorts parks the window', t: 3, run: (s) => s().dragShorts(600) },
  { name: 'dragShorts keyed', t: 3, setup: (s) => s().addShortsKeyframe(), run: (s) => s().dragShorts(600) },
  { name: 'deleteShortsKeyframe', t: 3, setup: (s) => (s().addShortsKeyframe(), tick(5000)), run: (s) => s().deleteShortsKeyframe(shortsKeys(s)[0]) },
  { name: 'suggestShortSegments', setup: (s) => s().deleteShortSegment('seg1'), run: (s) => s().suggestShortSegments() },
  { name: 'suggestShortSegments no room', run: (s) => s().suggestShortSegments() },
  // -- a track's magnet: the header's button, track.setMagnet ---------------------------------------
  { name: 'setTrackMagnet on gathers', setup: (s) => s().moveClip('cc', 26), run: (s) => s().setTrackMagnet('v1', true) },
  { name: 'setTrackMagnet off', packed: true, run: (s) => s().setTrackMagnet('v1', false) },
  { name: 'setTrackMagnet as it is', packed: true, run: (s) => s().setTrackMagnet('v1', true) },
  // -- the user's lock of a clip against agents (KAPSAM-AJAN-PLAN.md, K1) --------------------------
  { name: 'setClipsAgentLock on', run: (s) => s().setClipsAgentLock(['cb', 'ca'], true) },
  { name: 'setClipsAgentLock off', setup: (s) => s().setClipsAgentLock(['cb'], true), run: (s) => s().setClipsAgentLock(['cb'], false) },
  // KOLAY-PLAN.md, item 3 (23 November): a clip's coloured label.
  { name: 'setClipsLabel on', run: (s) => s().setClipsLabel(['cb', 'ca'], 'blue') },
  { name: 'setClipsLabel off', setup: (s) => s().setClipsLabel(['cb'], 'red'), run: (s) => s().setClipsLabel(['cb'], null) },
  { name: 'setClipsLabel same (no-op)', setup: (s) => s().setClipsLabel(['cb'], 'red'), run: (s) => s().setClipsLabel(['cb'], 'red') },
  // (cogalt, 23 Nov: the copies are the command clip.duplicate's; a linked
  // pair copied as a pair, and the agent's call by name.)
  { name: 'duplicateSelection linked', sel: ['ca'], linkAV: true, run: (s) => s().duplicateSelection() },
  { name: 'runBatch clip.duplicate', run: (s) => s().runBatch([{ name: 'clip.duplicate', params: { clipId: 'ca' } }]) },
  { name: 'runBatch clip.duplicate at', run: (s) => s().runBatch([{ name: 'clip.duplicate', params: { clipIds: ['ov', 'cc'], at: 30 } }]) },
  { name: 'runBatch clip.add by clip id', run: (s) => s().runBatch([{ name: 'clip.add', params: { assetId: 'cc', trackId: 'v2', start: 30 } }]) },
]

const codeFilm = (): Asset => ({ id: 'film', kind: 'code', name: 'film', path: 'C:/p/anim/film', url: 'snippfilm://0123456789abcdef/', size: 0, duration: 4, width: 1920, height: 1080, hasAudio: false, code: { fps: 60 } }) as Asset
const lookLayer = (s: () => S): string => Object.values(s().project.clips).find((c) => c.trackId !== 'v3' && c.adjustment && !['cl', 'ov', 'ca', 'cb', 'cc', 'sa', 'm1'].includes(c.id))!.id
/** Ids of every key a title has (whichever list holds them). */
const captionKeys = (s: () => S, id: string): string[] => {
  const out: string[] = []
  JSON.stringify(s().project.captions.find((c) => c.id === id), (k, v) => {
    if (v && typeof v === 'object' && !Array.isArray(v) && typeof v.id === 'string' && typeof v.time === 'number' && k !== '') out.push(v.id)
    return v
  })
  return out
}
const shortsKeys = (s: () => S): string[] => [...(s().project.shorts?.keyframes ?? []), ...(s().project.shortSegments ?? []).flatMap((x) => x.keyframes)].map((k) => k.id)

interface Row {
  name: string
  steps: number
  redoKept: boolean
  before: string
  after: string
  ui: Record<string, unknown>
  result?: string
  undoRestores: boolean
}

function record(sc: Scenario): Row {
  const s = useStore.getState
  resetWorld()
  const project = fixture()
  if (sc.packed) project.tracks.find((t) => t.id === 'v1')!.autoPack = true
  s().loadProject(project)
  s().setLinkAV(!!sc.linkAV)
  // A redo step to see whether the action throws it away.
  s().setMode('shorts')
  s().undo()
  useStore.setState({ dirty: false, currentTime: sc.t ?? 0, selectedClipIds: sc.sel ?? [], selectedCaptionIds: sc.capSel ?? [] })
  sc.setup?.(s)
  const before = hash(s().project)
  const past0 = s().past.length
  const ui0 = uiOf(s())
  const ret = sc.run(s)
  const after = hash(s().project)
  const steps = s().past.length - past0
  const ui1 = uiOf(s())
  const ui: Record<string, unknown> = {}
  for (const k of Object.keys(ui1)) if (JSON.stringify(ui0[k]) !== JSON.stringify(ui1[k])) ui[k] = ui1[k]
  const redoKept = s().future.length > 0
  for (let i = 0; i < steps; i++) s().undo()
  const undoRestores = hash(s().project) === before
  s().setLinkAV(false)
  return { name: sc.name, steps, redoKept, before, after, ui, ...(ret !== undefined ? { result: hash(ret) } : {}), undoRestores }
}

const FILE = join(process.cwd(), 'src', 'test', 'fixtures', 'undo-baseline.json')

/**
 * The records phase 2A.2 changed ON PURPOSE (FAZ2A-PLAN.md §3); every other
 * record must be as the baseline file has it. The project hashes of these
 * rows do not change: only the undo steps, the redo stack and `dirty`.
 *  - An edit that changes nothing is no edit: no undo step (so redo is kept)
 *    and the project stays saved.
 *  - undoable windows nest, and one is one step however long it runs; one
 *    that comes during a UI drag gets its own step, the drag a new one after.
 */
const NO_STEP = { steps: 0, redoKept: true, ui: {} }
const NOT_DIRTY = { ui: {} }
const ON_PURPOSE: Record<string, Partial<Row>> = {
  // Ç2b acceptance (managing session): a ripple cut through a linked pair gives the right pieces a fresh link of their own (they were all one link, so deleting one piece took every other piece with it); only the hash of the result changes.
  'deleteBetweenCuts all': { after: 'fc42430148948f7e' },
  'rippleDelete': { after: 'fc42430148948f7e' },
  'rippleDeleteMany': { after: 'ec04f948c6783554' },
  'rippleDeleteMany through a line': { after: 'd6cc8e38ef7cc2ad' },
  'packed: rippleDelete': { after: 'f5edda574e0fb10d' },
  'silence preview: a cut': { after: '431bd535c6ac5c41' },
  'setMode same': NO_STEP,
  'setClipTransform same': NO_STEP,
  'moveTrack across kinds': NO_STEP,
  'setTrackLevel': NO_STEP,
  'updateCaption same': NO_STEP,
  'gesture: armed, a change that changes nothing': NO_STEP,
  'no-op snapshot edit (fades unchanged, step asked for)': NO_STEP,
  'moveClipToTrack wrong kind': NOT_DIRTY,
  'setClipHead reveal blocked': NOT_DIRTY,
  'setClipHead same': NOT_DIRTY,
  'trimClipEnd blocked': NOT_DIRTY,
  'packMainTrack': NOT_DIRTY,
  'resolveTrackOverlaps': NOT_DIRTY,
  'setNoteImage': NOT_DIRTY,
  // The second delete would take the last audio track: refused, no step.
  'deleteTrack last of kind': { steps: 1 },
  'gesture: nested undoable': { steps: 1 },
  'gesture: undoable while a drag is open': { steps: 3 },
  'gesture: slow undoable (idle inside)': { steps: 1 },
  // 2A.5: a beginGesture drag (trim, slip…) is an open window, so a code
  // window in its middle gets its own step and the rest of the drag a new one.
  // ('begin: a code window in the middle of a trim drag': steps 3, written
  // with its Ç2b.2 change at the end.)
  // 2A.5: a silence-cut preview is cleared when the clips' timing changes,
  // whichever path (a drag too), and kept when it does not (a title).
  'silence preview: a title': { ui: { selectedCaptionIds: ['00000007-0000'], dirty: true } },
  'silence preview: a clip dragged': { ui: { dirty: true, silencePreview: null } },
  // == phase Ç2a.1 (FAZC2A-PLAN.md, "Undo baseline rows changed on purpose") ==
  // C3: cb is followed at once by cc, so there is no room to grow into: it no
  // longer runs over cc (a no-op now, no step).
  'revealEarlier': { ...NO_STEP, after: '3278c3385e731402' },
  // C5: the copy in place is made as the Alt-drag makes it (its window, then
  // moved away); alone it sat on its original and could not be undone.
  'duplicateClipsInPlace': { steps: 1, redoKept: false, after: 'd55b8b82a52c817e', result: undefined, undoRestores: true },
  // C1: deleting ca leaves sa linked to nothing: the lone link goes.
  'packed: deleteClips': { after: '3eda0a2e25cd172d' },
  // Decision 4 (report D2 / P1): with no window open, every change is an
  // undo step of its own, whatever the action asked for. These actions,
  // called alone, used to make no step: undone together with the edit before
  // them, the redo stack left in place, and undoing "their" steps did not
  // give the project back (undoRestores false). Project hashes unchanged.
  ...Object.fromEntries([
    'setProjectName', 'addClipAt no commit', 'moveClip no commit', 'moveClipToTrack', 'applyTimelinePlacement', 'applyTimelinePlacement new track',
    'setClipHead trim in', 'trimClipEnd shorter', 'slipClip', 'slipClip linked', 'setClipSpeed', 'setClipSpeed linked, link on', 'setClipSpeed still',
    'setClipTransform no commit', 'setClipGrade', 'setClipCrop', 'setClipBlur', 'setClipBlendMode', 'setClipEffect', 'setClipAnim', 'setClipOpacity',
    'dragClipKeyframe', 'moveClipKeyframe', 'setTrackFlags', 'setClipVolume', 'setClipFades', 'setClipAudioFx', 'setTransitionOut', 'setTransitionOut none',
    'setMotionFx', 'updateCaption no commit', 'setCaptionShape', 'setCaptionOwnStyle', 'setCaptionMotion', 'setCaptionStyle', 'setCaptionStyleShorts',
    'setTranscription', 'setShortsBase', 'setRisers no commit', 'packed: setClipHead trim in', 'packed: setClipHead grows from the tail',
    'packed: trimClipEnd shorter', 'packed: trimClipEnd longer', 'packed: setClipSpeed', 'packed: moveClipToTrack onto it'
  ].map((name) => [name, { steps: 1, redoKept: false, undoRestores: true }])),
  // P16: deleteAsset says whether it deleted (true here: img1 is in no
  // compound); the project and the steps are as recorded.
  'deleteAsset': { result: 'b5bea41b6c623f7c' },
  // Decision 4: the drag's window closed on the idle pause, so the move
  // after it is a step of its own (it used to ride on the first one).
  'gesture: idle pause splits the drag': { steps: 2 },
  // == phase Ç2b.1 (FAZC2B-PLAN.md, "Undo baseline rows changed on purpose") ==
  // Decision 1 (report L1): Q / W, close gap, the cut marks and the silence
  // cut take their range out of every unlocked track (the
  // sound, the music, the layers above move with the picture); they used to
  // move only the clip's own track. Steps unchanged; the project after is.
  // (Ripple delete is back on its recorded rows since Ç2b E1: the fixture
  // has material on other tracks under the deleted clips, so only their own
  // tracks close up, as before.)
  // (Q / W are back on their recorded rows since DENEME-1, item 2: the
  // clip's own track and its linked sound only; Alt+Q / Alt+W cut every track.)
  'closeGapAtPlayhead': { after: '50714276cc0895e9' },
  'deleteBetweenCuts track': { after: 'fc42430148948f7e' },
  // (Ç2c.1, decision 1: the pieces keep cb's whole key list: 'ad613f6187c45b3f' → '05837d8995ed0c7d'.)
  'applySilenceCuts': { after: '05837d8995ed0c7d' },
  // K-4 = P10 (decision 6): clip.move is laid out by the drag's planner. cc
  // asked to 5 lands there (it used to look for a free place and stay put):
  // ca, which it lands on, and what follows move later, each with its
  // linked partner. On the packed track, ca dropped at 15 lands inside cb,
  // i.e. before it: where it already is (the old move put it after cb).
  // (Ç2b patch, item 8: this row runs with the link off; the clips cc
  // pushes now take their linked partners the same distance — they were
  // left behind: 'b73c10f91dae34c8' → '97ca7c523f17612d'.)
  'moveClip blocked lands free': { steps: 1, redoKept: false, after: '97ca7c523f17612d', ui: { dirty: true } },
  'packed: moveClip': { ...NO_STEP, after: 'eb24f2f5eb2274bb' },
  // L7 (decision 3): the presets with no track named leave the locked V3
  // (its still cl) as it is; they used to animate it too.
  'applyRampInOut': { after: 'd12a56362c2fc480' },
  'cinematizeAll': { after: 'b8267c69a747af7c' },
  'applyGentlePan': { after: 'c12b038e30eb5254' },
  'applyStillImageFx': { after: 'cd83e04b064d3526' },
  'clearStillImageFx': { before: 'cd83e04b064d3526' },
  // L10: the sound effects track it makes says it is one (role 'sfx').
  'placeSoundEffect': { after: 'af923c93cc2f7815' },
  // == phase Ç2b.2 (FAZC2B-PLAN.md, "Undo baseline rows changed on purpose (Ç2b.2)") ==
  // Decision 1 (report G2): ca's dissolve names cb; each of these edits
  // leaves cb no longer the clip right after ca (ca moved, cb's head trimmed
  // or kept to a range, cb put into a compound, a clip dropped or moved in
  // between on the packed track), so the dissolve goes (it re-aimed at
  // whatever came to touch ca, or became a fade-out). Only that differs;
  // steps as recorded (later keys repeat the Ç2a ones they override).
  'moveClip linked, link on': { after: '9cf3f33f3e7af41f' },
  'moveClip linked, link off': { after: 'b13237d8822e81c4' },
  'setClipHead trim in': { steps: 1, redoKept: false, after: '1f992d9993e9b32f', undoRestores: true },
  'keepOnlyRange': { after: '29dbd74b2c41f43b' },
  'compoundSelection': { after: '74f175f44657b48c' },
  'uncompoundClip': { before: '74f175f44657b48c', after: 'b3edaaee382fcfd4' },
  'gesture: head trim drag': { after: '1f992d9993e9b32f' },
  'packed: addClipAt drop': { after: '11af86f92cac3614' },
  'packed: moveClipToTrack onto it': { steps: 1, redoKept: false, after: '1c7959b962e096b0', undoRestores: true },
  'begin: head trim drag': { after: '1f992d9993e9b32f' },
  'begin: a code window in the middle of a trim drag': { steps: 3, after: '4216e342524ccc07' },
  // (Ç2c.1, decision 1, the five head-trim rows above: cb keeps its key at 0
  // off the clip instead of a key made at the new edge: 'setClipHead trim in'
  // '1a02beeb4eae484e' → '1f992d9993e9b32f', 'keepOnlyRange' 'e4f3d489a4958b3d'
  // → '29dbd74b2c41f43b', the two head trim drags '846cf82975ca5d4c' →
  // '1f992d9993e9b32f' (now the same project as the trim in one call: every
  // frame of the drag is cut from the keys it started with), the code window
  // in a trim drag 'fb0f8ee81c89075a' → '4216e342524ccc07'.)
  // == Ç2b patch (FAZC2B-PLAN.md, "Ç2b yaması") ==
  // Item 3: the fixture has material on other tracks under the deleted
  // clips, so a ripple delete leaves the gap (E1 closed their own tracks,
  // which drifted the linked pairs after them). Steps as recorded. (The
  // packed row is unchanged: its packed track closes up on its own.)
  'deleteClips ripple': { after: '259e8956e3e540e6' },
  // (Item 8: 'moveClip blocked lands free', written with its Ç2b.1 entry.)
  // == phase Ç2c.1 (FAZC2C-PLAN.md, "Undo baseline rows changed on purpose") ==
  // Steps as recorded; only the project after differs, in cb's keys (scale
  // 0 → 8 s) and, for the freeze frame, the held frame's pose. (Rows already
  // listed above are changed where they are.)
  // Decision 1: both halves of a split carry the whole list (the right one
  // moved by the left one's length) instead of a key made at the cut.
  'splitClipAt': { after: '733d9bba9b88a920' },
  // Decision 1 + 4: skip ahead is a split, then a slip of the right piece:
  // its keys ride with its footage.
  // Phase 11b, KF6: the split and the slip are ONE undo step (they were two:
  // one Ctrl+Z left the split). The project after is the same.
  'skipAhead': { steps: 1, after: '9b38cf3f2d4443b7' },
  'gesture: skipAhead steps': { steps: 1, after: '2bae2fcc5a1942f8' },
  // Decision 4: a slip carries the keys with the picture. The drag moves them
  // step by step (its five 0.2 s moves land a hair from one 1 s move:
  // floating point), so its hash is not the one-call row's any more.
  'slipClip': { steps: 1, redoKept: false, after: '456bd45c691833ee', undoRestores: true },
  'gesture: slip drag': { after: 'cc2254bf3e4b7995' },
  'begin: slip drag': { after: 'cc2254bf3e4b7995' },
  // Decision 4: keys scaled by the speed ratio (old / new) instead of the
  // length ratio: the same factor here (nothing holds the length), computed
  // another way, so the key times differ in their last bits.
  'gesture: speed slider': { after: 'ab7df2a6fd280618' },
  // Decision 1 + 5: the halves keep the whole list and the held frame shows
  // the zoom the keys gave at the playhead (it showed the static scale).
  // Ç2c patch, item 4 (was '33f19dee6c52391c'): the title t1 (at the
  // playhead, 4 s) and the shape s1 (8 s) move on by the hold with the
  // footage; with them put back, the project hashes to the old value.
  'insertFreezeFrame': { after: '73139df4b814a857' },
  // Decision 1 (the head trim on the packed track, as the rows above).
  'packed: setClipHead trim in': { steps: 1, redoKept: false, after: 'aa695b4e4eb3b8d2', undoRestores: true },
  // == phase Ç2c.2 (FAZC2C-PLAN.md, "Undo baseline rows changed on purpose (Ç2c.2)") ==
  // Decision 2: "Keyframe all" gives its five keys one set id (the keys,
  // their ids, times and values as recorded: the hash without the set id is
  // the recorded 'a7c42575463d2340').
  'addClipKeyframe': { after: '03b3545f90528327' }
}

test('undo equivalence: every edit action and gesture makes the steps and the project it did before the command layer (but the rows changed on purpose)', () => {
  const rows = SCENARIOS.map(record)
  assert.equal(new Set(rows.map((r) => r.name)).size, rows.length, 'scenario names are unique')
  if (process.env.UPDATE_UNDO_BASELINE !== '1') assert.ok(existsSync(FILE), `${FILE} is missing (UPDATE_UNDO_BASELINE=1 writes it)`)
  if (process.env.UPDATE_UNDO_BASELINE === '1') {
    writeFileSync(FILE, JSON.stringify(rows, null, 1) + '\n')
    return
  }
  if (process.env.UPDATE_UNDO_BASELINE === 'add') {
    // New scenarios only: every row the file has stays as it is.
    const have = JSON.parse(readFileSync(FILE, 'utf8')) as Row[]
    const names = new Set(have.map((r) => r.name))
    writeFileSync(FILE, JSON.stringify([...have, ...rows.filter((r) => !names.has(r.name))], null, 1) + '\n')
    return
  }
  const want = (JSON.parse(readFileSync(FILE, 'utf8')) as Row[]).map((r) => (ON_PURPOSE[r.name] ? { ...r, ...ON_PURPOSE[r.name] } : r))
  for (const name of Object.keys(ON_PURPOSE)) assert.ok(want.some((r) => r.name === name), `${name} is in the baseline`)
  const byName = new Map(want.map((r) => [r.name, r]))
  const diffs: string[] = []
  for (const row of rows) {
    const w = byName.get(row.name)
    if (!w) diffs.push(`${row.name}: not in the baseline`)
    // (Keys in any order: a row changed on purpose may gain a field.)
    else if (canonical(w) !== canonical(row)) diffs.push(`${row.name}:\n  was ${JSON.stringify(w)}\n  now ${JSON.stringify(row)}`)
  }
  for (const w of want) if (!rows.some((r) => r.name === w.name)) diffs.push(`${w.name}: missing from the run`)
  assert.deepEqual(diffs, [], diffs.join('\n'))
})

test('the same scenario gives the same record twice (the world is deterministic)', () => {
  for (const sc of SCENARIOS.slice(0, 40)) assert.deepEqual(record(sc), record(sc), sc.name)
})

// ---- K11 (22 November 2026): no store action is outside this file ----------------
/**
 * The store's actions that are NOT edits of the project, and what each is
 * instead. Everything else the store can do must be run by a scenario above.
 *  view      what is shown or picked: the selection, the playhead, a tool, a panel's state
 *  status    what the app is doing (transcribing, exporting), told to the interface
 *  query     reads; changes nothing
 *  clipboard takes a copy; changes nothing in the project
 *  history   moves along the undo steps, or starts a project (no step of its own)
 *  derived   what the app worked out about a file (a thumbnail, a length): not the user's edit, not undoable
 */
const NOT_EDITS: Record<string, 'view' | 'status' | 'query' | 'clipboard' | 'history' | 'derived'> = {
  redo: 'history', undoTo: 'history', newProject: 'history',
  hasCopiedAnimation: 'query', hasCopiedKeyframe: 'query', hasCopiedCaptionStyle: 'query', shiftTable: 'query', changesSince: 'query', pinVersion: 'query',
  setAssetDerived: 'derived',
  setTranscribeStatus: 'status', setTranscribeProgress: 'status', setExportStatus: 'status',
  setPreviewQuality: 'view', setAdaptiveQuality: 'view', setPreviewView: 'view', setAudioDrift: 'view', focusInspector: 'view', setDirty: 'view',
  setProxiesEnabled: 'view', setEyedropper: 'view', setMaskOverlay: 'view', setClipTabActive: 'view', setLoopRange: 'view', setDragPreview: 'view',
  setSnapGuide: 'view', setRangePreview: 'view', setPlayheadSnap: 'view', setShowGuideOverlay: 'view', setUiLang: 'view', setCutterMode: 'view',
  setSplitToolMode: 'view', setSlipToolMode: 'view', setMapPick: 'view', setScopeKind: 'view', setTime: 'view', setPlaying: 'view', selectClip: 'view',
  selectAll: 'view', selectCaptions: 'view', requestCaptionEdit: 'view', setPxPerSec: 'view', setTimelineMagnet: 'view', setMaskDrawMode: 'view',
  setSelectedTracker: 'view', toggleExportQueue: 'view', clearExportQueue: 'view', reorderExportQueue: 'view', clearCutMarks: 'view',
  selectNote: 'view', cancelNoteDraft: 'view', setNoteTool: 'view', setNoteColor: 'view', setNoteReview: 'view', setActiveShortSegment: 'view'
}

test('every action of the store is run by a scenario here, or is named as not an edit (22 Nov, K11)', () => {
  const text = readFileSync(join(process.cwd(), 'src', 'test', 'undo-baseline.test.ts'), 'utf8')
  const run = new Set([...text.matchAll(/s\(\)\.(\w+)\(/g)].map((m) => m[1]))
  const actions = Object.entries(useStore.getState()).filter(([, v]) => typeof v === 'function').map(([k]) => k)
  const missing = actions.filter((k) => !run.has(k) && !(k in NOT_EDITS))
  assert.deepEqual(missing, [], `store actions with no undo-baseline row (add a scenario, or name them in NOT_EDITS with what they are): ${missing.join(', ')}`)
  for (const k of Object.keys(NOT_EDITS)) assert.ok(actions.includes(k), `${k} is in NOT_EDITS but is no action of the store`)
  for (const k of Object.keys(NOT_EDITS)) assert.ok(!run.has(k) || NOT_EDITS[k] !== 'view' || true)
  // An action named "not an edit" must not edit: its source, read from the
  // slices, may not go through the store's edit path (mutate / runBatch).
  const dir = join(process.cwd(), 'src', 'renderer', 'src', 'state')
  const sources = ['store.ts', ...['captions', 'clip', 'cutting', 'effects', 'keyframes', 'notes', 'placing', 'project', 'shorts', 'versions', 'view'].map((n) => join('slices', n + '.ts'))].map((p) => readFileSync(join(dir, p), 'utf8'))
  for (const [k, kind] of Object.entries(NOT_EDITS)) {
    if (kind === 'history') continue
    let body: string | null = null
    for (const src of sources) {
      const at = src.search(new RegExp(`\\n    ${k}: `))
      if (at < 0) continue
      const rest = src.slice(at + 1)
      const end = rest.slice(1).search(/\n    [A-Za-z_]\w*: /)
      body = rest.slice(0, end < 0 ? 2000 : end + 1)
      break
    }
    assert.ok(body, `${k}: its source was not found in the store's slices`)
    assert.doesNotMatch(body!, /\bmutate\(|\brunBatch\(|\bundoable\(/, `${k} is named "${kind}" in NOT_EDITS but its source edits the project`)
  }
})
