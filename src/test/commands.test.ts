// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// The command layer (SnippStudio phase 2A.1): every command is there, checks
// its parameters, edits only through its draft, and gives what the store's
// buttons give (the store's actions are now wrappers around the commands).
import { fixture, hash, resetWorld } from './undo-fixture'
import assert from 'node:assert/strict'
import test from 'node:test'
import { useStore } from '../renderer/src/state/store'
import { COMMANDS, CommandError, applyBatch, commandByName, runCommand, seededRandom, type CommandEnv } from '../renderer/src/commands'
import { placeSuggestions, type TemplateSuggestion } from '../renderer/src/subtitles/template-suggest'
import type { Project } from '../renderer/src/types'

const env = (): CommandEnv => ({ random: Math.random, now: () => new Date() })
// COMMANDS, not commandByName: the internal ones (clip.place) are tried too.
const run = (p: Project, name: string, params: unknown) => runCommand(p, COMMANDS[name] ?? commandByName(name), params, env())

/** The list the phase brief asks for (the agent tools' needs). */
const REQUIRED = [
  'timeline.cutRanges', 'clip.delete', 'clip.move', 'clip.trimHead', 'clip.trimEnd', 'clip.split', 'clip.add', 'clip.addMedia',
  'clip.set', 'clip.setTransform', 'clip.setOpacity', 'clip.setVolume', 'clip.setMuted', 'clip.setSpeed', 'clip.setFades', 'clip.setTransition',
  'text.add', 'shape.add', 'caption.update', 'caption.delete', 'caption.setStyle', 'caption.editLine',
  'transitions.preset', 'transitions.mix', 'marker.add', 'marker.update', 'marker.delete',
  'track.add', 'track.delete', 'track.move', 'template.place', 'silence.apply', 'automation.placeImages', 'broll.place',
  'note.add', 'note.update', 'note.setStatus', 'note.delete'
]

test('every command the agent tools need is there, named once, with a summary and an object schema', () => {
  for (const name of REQUIRED) assert.ok(COMMANDS[name], `missing ${name}`)
  for (const [name, cmd] of Object.entries(COMMANDS)) {
    assert.equal(cmd.name, name)
    assert.ok(cmd.summary.length > 15 && cmd.summary.length < 260, `${name}: summary`)
    assert.equal(cmd.params.json.type, 'object', `${name}: params is an object`)
    assert.equal(cmd.params.json.additionalProperties, false, `${name}: unknown fields are refused`)
    // The schema is plain JSON (the agent tool is generated from it).
    assert.deepEqual(JSON.parse(JSON.stringify(cmd.params.json)), cmd.params.json)
  }
})

/** One valid call of every command on the fixture, and what it must do. */
const SAMPLES: Record<string, { params: unknown; check: (before: Project, after: Project, result: unknown) => void; setup?: (p: Project) => void }> = {
  'timeline.cutRanges': { params: { ranges: [[1, 2], [5, 6]] }, check: (_b, a, r) => { assert.equal((r as { total: number }).total, 2); const a2 = a.tracks.find((t) => t.id === 'a2')!.clipIds.map((id) => a.clips[id]); assert.equal(a2.length, 3); assert.ok(Math.abs(Math.max(...a2.map((c) => c.start + c.duration)) - 22) < 1e-9) } },
  'timeline.cutRangeOnTrack': { params: { trackId: 'a2', range: [1, 2] }, check: (b, a) => { assert.equal(a.tracks.find((t) => t.id === 'a2')!.clipIds.length, 2); assert.equal(a.clips.m1.duration, 1); assert.deepEqual(a.clips.ca, b.clips.ca) } },
  'clip.rippleTrim': { params: { clipId: 'cb', time: 14, side: 'tail' }, check: (b, a, r) => { assert.deepEqual(r, { closed: true, movedWith: [] }); assert.equal(a.clips.cb.duration, 4); assert.equal(a.clips.cc.start, 14); assert.deepEqual(a.clips.sa, b.clips.sa) } },
  'track.setMagnet': { setup: (p) => { p.clips.cc.start = 26 }, params: { trackId: 'v1', on: true }, check: (b, a) => { assert.equal(a.tracks.find((t) => t.id === 'v1')!.autoPack, true); assert.equal(a.clips.cc.start, 20, 'gathered'); assert.equal(b.clips.cc.start, 26) } },
  'captions.cutRange': { params: { range: [0, 3.1] }, check: (b, a) => { assert.ok(!a.captions.some((c) => c.id === 'c1')); assert.deepEqual(a.clips, b.clips) } },
  'silence.apply': { params: { regions: [{ clipId: 'm1', start: 2, end: 3 }] }, check: (_b, a) => assert.equal(a.tracks.find((t) => t.id === 'a2')!.clipIds.length, 2) },
  'clip.delete': { params: { ids: ['cc'] }, check: (_b, a, r) => { assert.deepEqual(r, ['cc']); assert.ok(!a.clips.cc && a.clips.cl) } },
  'clip.move': { params: { clipId: 'ov', start: 12 }, check: (_b, a) => assert.equal(a.clips.ov.start, 12) },
  'clip.moveToTrack': { params: { clipId: 'ov', trackId: 'v1' }, check: (_b, a) => assert.equal(a.clips.ov.trackId, 'v1') },
  'clip.place': { params: { plan: { changed: true, positions: { ov: { start: 30, trackId: 'v2' } }, trackClipIds: { v2: ['ov'] } } }, check: (_b, a) => assert.equal(a.clips.ov.start, 30) },
  'clip.trimHead': { params: { clipId: 'cb', edge: 12 }, check: (_b, a) => { assert.equal(a.clips.cb.start, 12); assert.equal(a.clips.cb.inPoint, 4) } },
  'clip.trimEnd': { params: { clipId: 'cb', delta: -2 }, check: (_b, a) => assert.equal(a.clips.cb.duration, 8) },
  'clip.slip': { params: { clipId: 'cb', delta: 1 }, check: (_b, a) => assert.equal(a.clips.cb.inPoint, 3) },
  'track.rename': { params: { trackId: 'a2', name: '  Music  ' }, check: (_b, a) => assert.equal(a.tracks.find((t) => t.id === 'a2')!.name, 'Music') },
  'clip.unlink': { params: { ids: ['ca'] }, check: (_b, a) => { assert.equal(a.clips.ca.linkId, undefined); assert.equal(a.clips.sa.linkId, undefined) } },
  'clip.setAgentLock': { params: { ids: ['ca', 'cb'], locked: true }, check: (_b, a) => { assert.equal(a.clips.ca.agentLock, true); assert.equal(a.clips.cb.agentLock, true) } },
  'clip.setLabel': { params: { ids: ['ca', 'cb'], label: 'green' }, check: (_b, a) => { assert.equal(a.clips.ca.label, 'green'); assert.equal(a.clips.cb.label, 'green') } },
  'clip.keepRange': { params: { clipId: 'cb', range: [12, 16] }, check: (_b, a) => { assert.equal(a.clips.cb.start, 12); assert.equal(a.clips.cb.duration, 4) } },
  'clip.split': { params: { clipIds: ['cb'], time: 15 }, check: (_b, a, r) => { assert.equal((r as string[]).length, 1); assert.equal(a.clips.cb.duration, 5) } },
  'clip.add': { params: { assetId: 'img3', trackId: 'v2', start: 10 }, check: (_b, a, r) => assert.equal(a.clips[(r as string[])[0]].start, 10) },
  'clip.addMedia': { params: { assetIds: ['img2'], trackId: 'v2', start: 8 }, check: (_b, a, r) => assert.equal(a.clips[(r as { clipIds: string[] }).clipIds[0]].assetId, 'img2') },
  'clip.append': { params: { assetId: 'img3', trackId: 'v1' }, check: (_b, a) => assert.equal(a.tracks.find((t) => t.id === 'v1')!.clipIds.length, 4) },
  'clip.duplicate': { params: { clipId: 'ov' }, check: (_b, a) => assert.equal(a.tracks.find((t) => t.id === 'v2')!.clipIds.length, 2) },
  'clip.set': { params: { clipId: 'ov', opacity: 0.5, volume: 0.2, transform: { x: 10 }, fadeIn: 1 }, check: (_b, a) => { assert.equal(a.clips.ov.opacity, 0.5); assert.equal(a.clips.ov.volume, 0.2); assert.equal(a.clips.ov.transform.x, 10); assert.equal(a.clips.ov.fadeIn, 1) } },
  'clip.setTransform': { params: { clipId: 'ov', transform: { scale: 0.8 } }, check: (_b, a) => assert.equal(a.clips.ov.transform.scale, 0.8) },
  'clip.setOpacity': { params: { clipId: 'ov', opacity: 0.25 }, check: (_b, a) => assert.equal(a.clips.ov.opacity, 0.25) },
  'clip.setVolume': { params: { clipId: 'm1', volume: 0.1 }, check: (_b, a) => assert.equal(a.clips.m1.volume, 0.1) },
  'clip.setMuted': { params: { clipId: 'm1', muted: true }, check: (_b, a) => assert.equal(a.clips.m1.muted, true) },
  'clip.setSpeed': { params: { clipId: 'cb', speed: 2 }, check: (_b, a) => assert.equal(a.clips.cb.duration, 5) },
  'clip.setSpeedCurve': { params: { clipId: 'cb', curve: { points: [{ u: 0, v: 2 }, { u: 1, v: 2 }] } }, check: (_b, a) => assert.ok(Math.abs(a.clips.cb.duration - 5) < 1e-9 && !!a.clips.cb.speedCurve) },
  'clip.setFades': { params: { clipId: 'm1', fadeOut: 2 }, check: (_b, a) => assert.equal(a.clips.m1.fadeOut, 2) },
  'clip.setTransition': { params: { clipId: 'ca', transition: null }, check: (_b, a) => assert.equal(a.clips.ca.transitionOut, undefined) },
  'transitions.mix': { params: { duration: 0.4 }, check: (_b, a) => assert.equal(a.clips.cb.transitionOut?.type, 'mix') },
  'transitions.preset': { params: { type: 'wipe', duration: 1 }, check: (_b, a) => assert.equal(a.clips.ca.transitionOut?.type, 'wipe') },
  'transitions.clear': { params: {}, check: (_b, a) => assert.equal(a.clips.ca.transitionOut, undefined) },
  'motion.cinematize': { params: { intensity: 0.5, trackId: 'v1' }, check: (_b, a) => assert.ok(a.clips.cb.motionFx) },
  'motion.gentlePan': { params: { direction: 'left-to-right', amount: 6, trackId: 'v2' }, check: (_b, a) => assert.ok(a.clips.ov.motionFx) },
  'fx.stillImage': { params: { style: 'haze', amount: 0.4 }, check: (_b, a) => assert.equal(a.clips.cc.stillImageFx?.style, 'haze') },
  'audio.transitionSfx': { params: { level: 0.2 }, check: (_b, a) => assert.equal(a.transitionSfx, 0.2) },
  'audio.risers': { params: { level: 0.7 }, check: (_b, a) => assert.equal(a.risers, 0.7) },
  'text.add': { params: { time: 1, text: 'Hello' }, check: (_b, a, r) => { const c = a.captions.find((x) => x.id === r)!; assert.equal(c.text, 'Hello'); assert.equal(c.layer, 1) } },
  'shape.add': { params: { time: 1, kind: 'arrow' }, check: (_b, a, r) => assert.equal(a.captions.find((x) => x.id === r)!.shape?.kind, 'arrow') },
  'caption.update': { params: { id: 't1', patch: { text: 'Other' } }, check: (_b, a) => assert.equal(a.captions.find((x) => x.id === 't1')!.text, 'Other') },
  'caption.editLine': { params: { id: 'c2', text: 'this was a test' }, check: (_b, a) => { const c = a.captions.find((x) => x.id === 'c2')!; assert.equal(c.text, 'this was a test'); assert.equal(c.words!.length, 4) } },
  'caption.delete': { params: { ids: ['c3'] }, check: (_b, a) => assert.ok(!a.captions.some((c) => c.id === 'c3')) },
  'caption.setStyle': { params: { patch: { fontSize: 72 } }, check: (_b, a) => assert.equal(a.captionStyle.fontSize, 72) },
  'caption.setOwnStyle': { params: { id: 't1', patch: { color: '#ff0000' } }, check: (_b, a) => assert.equal(a.captions.find((x) => x.id === 't1')!.style!.color, '#ff0000') },
  'caption.setShape': { params: { id: 's1', patch: { w: 0.5 } }, check: (_b, a) => assert.equal(a.captions.find((x) => x.id === 's1')!.shape!.w, 0.5) },
  'marker.add': { params: { time: 7, note: 'here' }, check: (_b, a, r) => assert.equal(a.markers!.find((m) => m.id === r)!.note, 'here') },
  'marker.update': { params: { id: 'mk1', patch: { time: 20 } }, check: (_b, a) => assert.deepEqual(a.markers!.map((m) => m.id), ['mk2', 'mk1']) },
  'marker.delete': { params: { id: 'mk1' }, check: (_b, a) => assert.deepEqual(a.markers!.map((m) => m.id), ['mk2']) },
  'track.add': { params: { kind: 'audio' }, check: (_b, a, r) => assert.equal(a.tracks.at(-1)!.id, r) },
  'track.delete': { params: { trackId: 'v2' }, check: (_b, a, r) => { assert.deepEqual(r, ['ov']); assert.ok(!a.clips.ov) } },
  'track.move': { params: { trackId: 'v2', dir: 1 }, check: (_b, a) => assert.deepEqual(a.tracks.map((t) => t.id).slice(0, 3), ['v3', 'v1', 'v2']) },
  'template.place': { params: { kind: 'stat', time: 3 }, check: (_b, a, r) => assert.equal(a.templates!.find((t) => t.id === r)!.start, 3) },
  'automation.placeImages': {
    params: { placements: [{ captionIds: ['c1'], text: 'hello there world', start: 0.5, end: 3, assetId: 'img1', assetName: 'img1.png', duration: 2.5 }], target: 'new', finish: { transition: 'mix' } },
    check: (_b, a, r) => assert.equal(a.tracks[0].id, (r as { trackId: string }).trackId)
  },
  'broll.place': { params: { placements: [{ assetId: 'img1', start: 1, end: 3 }], look: 'full' }, check: (_b, a) => assert.equal(a.tracks[0].name, 'B-ROLL') },
  'note.add': { params: { start: 11, end: 12, kind: 'cut', text: 'shorter' }, check: (_b, a) => assert.equal(a.notes!.length, 2) },
  'note.update': { params: { id: '__note__', patch: { text: 'again' } }, check: (_b, a) => assert.equal(a.notes![0].text, 'again') },
  'note.setStatus': { params: { id: '__note__', status: 'ready', reply: 'done', touched: [[2, 3]] }, check: (_b, a) => assert.equal(a.notes![0].status, 'ready') },
  'note.delete': { params: { id: '__note__' }, check: (_b, a) => assert.equal(a.notes, undefined) },
  // Phase 5f (internal: the Inspector's). The fixture gets a code film first.
  'code.setParams': {
    setup: (p) => void p.assets.push({ id: 'film', kind: 'code', name: 'film', path: 'C:/p/anim/film', url: 'snippfilm://0123456789abcdef/', size: 0, duration: 4, width: 1920, height: 1080, hasAudio: false, code: { fps: 60 } }),
    params: { assetId: 'film', values: { title: 'Hi', size: 3 } },
    check: (_b, a) => assert.deepEqual(a.assets.find((x) => x.id === 'film')!.code!.params, { title: 'Hi', size: 3 })
  },
  // Cila K (internal: the code values panel's).
  'code.setEdits': {
    setup: (p) => void p.assets.push({ id: 'film', kind: 'code', name: 'film', path: 'C:/p/anim/film', url: 'snippfilm://0123456789abcdef/', size: 0, duration: 4, width: 1920, height: 1080, hasAudio: false, code: { fps: 60 } }),
    params: { assetId: 'film', put: [{ kind: 'color', orig: '#ffffff', value: '#112233' }], drop: [] },
    check: (_b, a) => assert.deepEqual(a.assets.find((x) => x.id === 'film')!.code!.edits, [{ kind: 'color', orig: '#ffffff', value: '#112233' }])
  },
  'project.setLook': { params: { look: { accent: '#112233', font: 'Inter' } }, check: (_b, a) => assert.deepEqual(a.look, { accent: '#112233', font: 'Inter' }) }
}

test('every command does its edit through a draft: the project it was given is left as it was', () => {
  for (const name of Object.keys(COMMANDS)) assert.ok(SAMPLES[name], `no sample call for ${name}`)
  for (const [name, sample] of Object.entries(SAMPLES)) {
    resetWorld()
    const before = fixture()
    sample.setup?.(before)
    const frozen = hash(before)
    const params = JSON.parse(JSON.stringify(sample.params).replace(/__note__/g, before.notes![0].id))
    const { project, result } = run(before, name, params)
    assert.notEqual(project, before, `${name}: a new project`)
    assert.equal(hash(before), frozen, `${name}: the input is untouched`)
    sample.check(before, project, result)
  }
})

test('bad parameters give a readable error and no change', () => {
  const p = fixture()
  const bad: [string, unknown, RegExp][] = [
    ['timeline.cutRanges', { ranges: [[5, 2]] }, /ranges\[0\]: end \(2\) must be after start \(5\)/],
    ['timeline.cutRanges', { ranges: [] }, /needs at least 1 item/],
    ['clip.move', { clipId: 'ov' }, /give one of start \(the new time\) or by/],
    ['clip.move', { clipId: 'ov', start: 'soon' }, /start: expected a number, got "soon"/],
    ['clip.setOpacity', { clipId: 'ov', opacity: 2 }, /opacity: must be at most 1/],
    ['clip.split', { clipIds: ['cb'], time: 15, speed: 2 }, /speed: not a known field/],
    ['track.add', { kind: 'midi' }, /kind: must be one of "video", "audio"/],
    ['caption.editLine', { id: 'c1', start: 4, end: 3 }, /end \(3\) must be after start \(4\)/],
    ['caption.editLine', { id: 'zz', text: 'x' }, /there is no subtitle, title or shape "zz"/],
    ['template.place', { kind: 'spaceship', time: 1 }, /there is no G lane item kind "spaceship"/],
    ['automation.placeImages', { placements: [{ captionIds: [], text: '', start: 1, end: 2, assetId: 'vid1', assetName: 'v', duration: 1 }], target: 'new' }, /cannot be placed/],
    ['note.delete', { id: 'nope' }, /there is no note nope/]
  ]
  for (const [name, params, message] of bad) {
    const before = hash(p)
    assert.throws(() => run(p, name, params), (e: unknown) => e instanceof CommandError && message.test(e.message), name)
    assert.equal(hash(p), before)
  }
  assert.throws(() => commandByName('clip.explode'), /there is no such command/)
})

/** The store action and the command, from the same world, give the same project. */
function same(label: string, viaStore: () => void, viaCommand: (p: Project) => Project, setup: () => void = () => undefined): void {
  resetWorld()
  useStore.getState().loadProject(fixture())
  setup()
  viaStore()
  const a = hash(useStore.getState().project)
  resetWorld()
  useStore.getState().loadProject(fixture())
  setup()
  const b = hash(viaCommand(useStore.getState().project))
  assert.equal(a, b, label)
}

test('the buttons and the commands give the same project', () => {
  const S = useStore.getState
  same('cut ranges', () => S().rippleDeleteMany([[1, 2], [5, 6]]), (p) => run(p, 'timeline.cutRanges', { ranges: [[1, 2], [5, 6]] }).project)
  same('split', () => S().splitClipAt('cb', 15), (p) => run(p, 'clip.split', { clipIds: ['cb'], time: 15 }).project)
  same('split at the playhead, linked', () => (S().setLinkAV(true), S().selectClips(['ca']), S().setTime(4), S().splitAtPlayhead(), S().setLinkAV(false)), (p) => run(p, 'clip.split', { clipIds: ['ca'], time: 4, linkAV: true }).project)
  same('delete with ripple', () => S().deleteClips(['cb'], true), (p) => run(p, 'clip.delete', { ids: ['cb'], ripple: true }).project)
  same('a title at the playhead', () => (S().setTime(5), S().addCaptionAtPlayhead('Hi')), (p) => run(p, 'text.add', { time: 5, text: 'Hi' }).project)
  same('a marker band behind a title', () => (S().setTime(5), S().addShapeAtPlayhead('marker', 't1')), (p) => run(p, 'shape.add', { time: 5, kind: 'marker', highlightCaptionId: 't1' }).project)
  same('a marker', () => (S().setTime(7), S().addMarkerAtPlayhead()), (p) => run(p, 'marker.add', { time: 7 }).project)
  same('a track', () => S().addAudioTrack(), (p) => run(p, 'track.add', { kind: 'audio' }).project)
  same('silence', () => S().applySilenceCuts([{ clipId: 'm1', start: 2, end: 3 }], { crossfade: true }), (p) => run(p, 'silence.apply', { regions: [{ clipId: 'm1', start: 2, end: 3 }], crossfade: true }).project)
  same('a template at the playhead', () => (S().setTime(3), S().insertTemplate('stat')), (p) => run(p, 'template.place', { kind: 'stat', time: 3 }).project)
  same('a home screen over the nearest cut', () => (S().setTime(9), S().insertTemplate('home')), (p) => run(p, 'template.place', { kind: 'home', time: 9 }).project)
  same('speed, linked', () => (S().setLinkAV(true), S().setClipSpeed('ca', 0.5), S().setLinkAV(false)), (p) => run(p, 'clip.setSpeed', { clipId: 'ca', speed: 0.5, linkAV: true }).project)
})

test('the Automation dialog\'s apply step is one command: the same project and one undo step, as the dialog\'s own steps gave', () => {
  const S = useStore.getState
  const placements = [
    { captionIds: ['c1'], text: 'hello there world', start: 0.5, end: 3, assetId: 'img1', assetName: 'img1.png', duration: 2.5 },
    { captionIds: ['c2'], text: 'this is a test', start: 3.2, end: 6, assetId: 'img2', assetName: 'img2.png', duration: 2.8 }
  ]
  const kept: TemplateSuggestion[] = [{ key: 'k', kind: 'stat', start: 1, duration: 2, from: 0, to: 0, title: '42', items: [], word: 'forty' } as unknown as TemplateSuggestion]
  for (const finish of [
    { motion: 'cinematic', transition: 'mix', glow: true, sound: true },
    { motion: 'pan', transition: 'none', glow: false, sound: false }
  ] as const) {
    // As the dialog did it before: the placement, then each finishing touch,
    // inside one undoable.
    resetWorld()
    S().loadProject({ ...fixture(), transitionSfx: 0.2 })
    S().undoable(() => {
      const result = S().placeAutomationImages(placements, 'new', {})!
      if (finish.motion === 'cinematic') S().cinematizeAll(0.5, result.trackId)
      else S().applyGentlePan('left-to-right', 6, result.trackId)
      if (finish.transition === 'mix') S().applyMixTransitions(0.45, result.trackId)
      if (finish.glow) S().applyStillImageFx('light-glow', 0.35, result.trackId)
      if (finish.sound) {
        if ((S().project.transitionSfx ?? 0.5) < 0.5) S().setTransitionSfx(0.5)
        if (!S().project.risers) S().setRisers(0.6)
      }
      S().editTemplates((p) => {
        p.templates = (p.templates ?? []).filter((t) => !kept.some((k) => k.kind === t.kind && Math.abs(k.start - t.start) < 0.3))
        placeSuggestions(p, kept)
      })
    })
    const oldHash = hash(S().project)
    const oldSteps = S().past.length
    const oldSel = S().selectedClipIds
    // Now: one call.
    resetWorld()
    S().loadProject({ ...fixture(), transitionSfx: 0.2 })
    S().placeAutomationImages(placements, 'new', { finish: { ...finish, suggestions: kept } })
    assert.equal(hash(S().project), oldHash, finish.motion)
    assert.equal(S().past.length, oldSteps)
    assert.equal(S().past.length, 1)
    assert.deepEqual(S().selectedClipIds, oldSel)
  }
})

test('a subtitle line keeps its id through a cut; a line the cut runs through keeps its id and loses those words', () => {
  const p = fixture()
  const { project } = run(p, 'timeline.cutRanges', { ranges: [[1.4, 2.2], [7, 9]] })
  const ids = (q: Project) => q.captions.map((c) => c.id).sort()
  assert.deepEqual(ids(project), ids(p))
  const c1 = project.captions.find((c) => c.id === 'c1')!
  assert.equal(c1.text, 'hello world')
  assert.equal(c1.words!.length, 2)
  const c3 = project.captions.find((c) => c.id === 'c3')!
  assert.ok(Math.abs(c3.start - (10.5 - 2.8)) < 1e-9)
})

test('a batch is one edit: every call checked first, all or nothing, results in order', () => {
  const p = fixture()
  const { project, results } = applyBatch(p, [
    { name: 'track.add', params: { kind: 'video' } },
    { name: 'text.add', params: { time: 2, text: 'A' } },
    { name: 'timeline.cutRanges', params: { ranges: [[0, 1]] } }
  ], env())
  assert.equal(results.length, 3)
  assert.equal(project.tracks.length, p.tracks.length + 1)
  assert.equal(project.captions.find((c) => c.id === results[1])!.start, 1)
  // A bad call anywhere: nothing runs, and every problem is listed.
  const before = hash(p)
  assert.throws(() => applyBatch(p, [{ name: 'track.add', params: { kind: 'video' } }, { name: 'clip.move', params: { clipId: 7 } }, { name: 'nope' }]), (e: unknown) =>
    e instanceof CommandError && /#2 clip.move: bad parameters/.test(e.message) && /#3 nope: there is no such command/.test(e.message))
  // A call that fails while running: nothing of the batch is applied.
  assert.throws(() => applyBatch(p, [{ name: 'track.add', params: { kind: 'video' } }, { name: 'caption.editLine', params: { id: 'zz', text: 'x' } }]), /#2 caption.editLine failed/)
  assert.equal(hash(p), before)
  // A seed makes the random choices repeatable.
  const a = applyBatch(p, [{ name: 'motion.cinematize', params: { intensity: 0.5 } }], { random: seededRandom(7), now: () => new Date(0) })
  const b = applyBatch(p, [{ name: 'motion.cinematize', params: { intensity: 0.5 } }], { random: seededRandom(7), now: () => new Date(0) })
  assert.equal(hash(a.project), hash(b.project))
})
