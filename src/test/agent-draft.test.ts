// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// SnippStudio phase 4A.9: the pure parts of the agent's edits — word
// addresses, content addressing (instances, anchors, locate), the families,
// and replay: one op found again as content, checked against what it did
// where it was read, dropped with a reason when that does not hold.
// (Replaces the tests of the time-carrying engine of phase 4A–4A.8.)
import './dom-stub'
import assert from 'node:assert/strict'
import test from 'node:test'
import { AGENT_COMMANDS, applyBatch, commandByName } from '../renderer/src/commands'
import { hasTimes, idsIn, resolveAddresses } from '../renderer/src/agent/address'
import { anchorTrack, locate, pointAt, spansOf, piecesIn } from '../renderer/src/agent/content'
import { FAMILIES, familyOf } from '../renderer/src/agent/families'
import { captureOp, enter, replay, sameFilm, sameLayout, type Entry, type ReplayContext } from '../renderer/src/agent/replay'
import { instanceOf, type Asset, type Clip, type Project } from '../renderer/src/types'
import { useStore } from '../renderer/src/state/store'
import { clipOf, kept, talk, videoAsset } from './agent-kit'

const schemaOf = (name: string) => commandByName(name).params as never
const ctx = (userChanged = false): ReplayContext => ({ own: new Map(), made: [], userChangedSince: () => userChanged })
const cut = (p: Project, ...ranges: [number, number][]): Project => applyBatch(p, [{ name: 'timeline.cutRanges', params: { ranges } }]).project
/** An edit of `calls` written on `base`, entered on `head`. */
const edit = (base: Project, head: Project, calls: { name: string; params: unknown }[], seq = 1, c = ctx()) =>
  enter(head, { seq, seed: 7 * seq, label: '', at: 0, baseLive: 0 }, calls.map((call) => ({ call, base })), c)

test('word addresses become seconds, by the command\'s own schema', () => {
  const p = talk(20, true)
  const r = resolveAddresses(schemaOf('timeline.cutRanges'), { ranges: ['L1#1-2', 'L2', 'L2#0', ['L1#0', 'L1#0>'], [10, 11]] }, p)
  assert.deepEqual(r, { ranges: [[1.6, 3], [6, 8], [6, 6.4], [1, 1.5], [10, 11]] })
  // An end written as a word is that word's end.
  assert.deepEqual(resolveAddresses(schemaOf('timeline.cutRanges'), { ranges: [['L1#0', 'L1#1']] }, p), { ranges: [[1, 2.2]] })
  assert.deepEqual(resolveAddresses(schemaOf('text.add'), { time: 'L2#1', text: 'Part two' }, p), { time: 6.5, text: 'Part two' })
  assert.deepEqual(resolveAddresses(schemaOf('text.add'), { time: 'L2#1>' }, p), { time: 7 })
  assert.throws(() => resolveAddresses(schemaOf('text.add'), { time: 'L9#0' }, p), /time: there is no subtitle line "L9"/)
  assert.throws(() => resolveAddresses(schemaOf('text.add'), { time: 'L1#7' }, p), /words 0–2, not 7/)
  assert.throws(() => resolveAddresses(schemaOf('timeline.cutRanges'), { ranges: ['soon'] }, p), /is not a range/)
  assert.equal(hasTimes(schemaOf('text.add'), { time: 1 }), true)
  assert.equal(hasTimes(schemaOf('caption.delete'), { ids: ['L1'] }), false)
  assert.deepEqual(idsIn(schemaOf('clip.move'), { clipId: 'c1', start: 3 }), ['c1'])
})

test('every command an agent may send has a family; captions.cutRange is not one of them', () => {
  for (const name of Object.keys(AGENT_COMMANDS)) if (!name.startsWith('note.')) assert.ok(FAMILIES[name], `${name} has no family`)
  for (const name of Object.keys(FAMILIES)) assert.ok(AGENT_COMMANDS[name], `${name} is in the table and is not an agent command`)
  assert.equal(AGENT_COMMANDS['captions.cutRange'], undefined, 'it moves subtitles off their sound by design')
  // A family is a function of the parameters too.
  assert.equal(familyOf('clip.delete', { ids: ['x'] }), 'record')
  assert.equal(familyOf('clip.delete', { ids: ['x'], ripple: true }), 'structural')
  assert.equal(familyOf('clip.set', { clipId: 'x', volume: 1 }), 'record')
  assert.equal(familyOf('clip.set', { clipId: 'x', speed: 2 }), 'structural')
  assert.equal(familyOf('caption.editLine', { id: 'x', text: 'a' }), 'line')
  assert.equal(familyOf('caption.editLine', { id: 'x', start: 1 }), 'structural')
  assert.equal(familyOf('clip.split', { clipIds: ['x'], time: 1, linkAV: true }), 'structural')
  assert.equal(familyOf('clip.trimEnd', { clipId: 'x', delta: 1 }), 'structural')
})

test('instance: a clip cut in pieces keeps one; a copy is its own (S4)', () => {
  const S = useStore.getState
  S().loadProject(talk(20))
  S().runBatch([{ name: 'timeline.cutRanges', params: { ranges: [[3, 4]] } }])
  S().runBatch([{ name: 'clip.split', params: { clipIds: ['c1'], time: 1 } }])
  S().runBatch([{ name: 'silence.apply', params: { regions: [{ clipId: 'c1', start: 0.3, end: 0.6 }] } }])
  let p = S().project
  assert.equal(Object.keys(p.clips).length, 4)
  for (const c of Object.values(p.clips)) assert.equal(instanceOf(c), 'c1', `${c.id} is a piece of c1`)
  // Copies (duplicate, in place, paste) are new content.
  const piece = Object.values(p.clips).find((c) => c.id !== 'c1')!
  // (In place as an Alt-drag makes it: in its window, dropped elsewhere.)
  let copy = ''
  S().undoable(() => {
    copy = S().duplicateClipsInPlace([piece.id])[0]
    S().moveClip(copy, 30)
  })
  p = S().project
  assert.equal(instanceOf(p.clips[copy]), copy)
  assert.notEqual(instanceOf(p.clips[copy]), 'c1')
  // A clip made from media is its own too.
  S().runBatch([{ name: 'clip.add', params: { assetId: 'a1', trackId: null, start: 40 } }])
  const added = Object.values(S().project.clips).find((c) => c.start >= 40)!
  assert.equal(instanceOf(added), added.id)
})

test('locate: a moment of footage is found after cuts, splits and a drag; a copy never stands in for it', () => {
  const p0 = talk(20)
  const v1 = p0.tracks[0].id
  const pt = pointAt(p0, v1, 10)!
  assert.deepEqual(pt, { inst: 'c1', m: 10 })
  const p1 = cut(p0, [3, 5])
  const at1 = locate(p1, pt)
  assert.ok(at1 !== 'gone' && at1 !== 'ambiguous' && Math.abs(at1.time - 8) < 1e-9)
  const piece = (at1 as { clip: Clip }).clip.id
  const p2 = applyBatch(p1, [{ name: 'clip.move', params: { clipId: piece, start: 30 } }]).project
  const at2 = locate(p2, pt)
  assert.ok(at2 !== 'gone' && at2 !== 'ambiguous' && Math.abs(at2.time - 35) < 1e-9, 'it went with its piece')
  assert.equal(locate(cut(p0, [9, 11]), pt), 'gone')
  // The same file again on the track is other content.
  const p3: Project = { ...cut(p0, [9, 11]), clips: { ...cut(p0, [9, 11]).clips } }
  p3.clips.copy = clipOf('copy', 'a1', v1, 40, 0, 20)
  p3.tracks = p3.tracks.map((t) => (t.id === v1 ? { ...t, clipIds: [...t.clipIds, 'copy'] } : t))
  assert.equal(locate(p3, pt), 'gone', 'the copy shows second 10 of the file, but it is not that footage')
  // A boundary second belongs to the piece that starts there (or, as an end, to the one that ends there).
  const p4 = applyBatch(p0, [{ name: 'clip.split', params: { clipIds: ['c1'], time: 10 } }]).project
  const s = locate(p4, pt)
  const e = locate(p4, pt, true)
  assert.ok(s !== 'gone' && s !== 'ambiguous' && e !== 'gone' && e !== 'ambiguous' && s.clip.id !== 'c1' && e.clip.id === 'c1')
  // A reversed clip: its source runs backwards over its time.
  const rev: Project = { ...p0, clips: { c1: { ...p0.clips.c1, reversed: true } } }
  assert.equal(pointAt(rev, v1, 5)!.m, 15)
  const back = locate(rev, { inst: 'c1', m: 15 })
  assert.ok(back !== 'gone' && back !== 'ambiguous' && Math.abs(back.time - 5) < 1e-9)
})

test('anchor (S1, B8): the subtitles\' voice; without subtitles the track with sound, never a longer music bed\'s luck or a row of stills', () => {
  // A talk on V1 and a LONGER music bed on A1, no subtitles: the bed carries
  // more sound, so it is the anchor only because nothing says otherwise…
  const p = talk(20)
  const a1 = p.tracks.find((t) => t.kind === 'audio')!
  p.assets.push({ id: 'mu', kind: 'audio', name: 'm.wav', url: 'media://mu', size: 1, duration: 60, hasAudio: true } as Asset)
  p.clips.mu = clipOf('mu', 'mu', a1.id, 0, 0, 30)
  a1.clipIds = ['mu']
  // …but with subtitles on the talk, the talk's track is.
  const q = talk(20, true)
  const qa = q.tracks.find((t) => t.kind === 'audio')!
  q.assets.push(p.assets[1])
  q.clips.mu = clipOf('mu', 'mu', qa.id, 0, 0, 30)
  qa.clipIds = ['mu']
  assert.equal(anchorTrack(q), q.tracks[0].id, 'the subtitles\' voice')
  // Stills above a voice-over: the voice-over, though the stills are longer.
  const f = talk(20)
  const fv = f.tracks[0]
  const fa = f.tracks.find((t) => t.kind === 'audio')!
  f.assets = [{ id: 'img', kind: 'image', name: 'i.png', url: 'media://i', size: 1, duration: 0, width: 10, height: 10, hasAudio: false } as Asset, { id: 'vo', kind: 'audio', name: 'vo.wav', url: 'media://vo', size: 1, duration: 60, hasAudio: true } as Asset]
  f.clips = { i1: clipOf('i1', 'img', fv.id, 0, 0, 40), vo: clipOf('vo', 'vo', fa.id, 0, 0, 20) }
  fv.clipIds = ['i1']
  fa.clipIds = ['vo']
  assert.equal(anchorTrack(f), fa.id)
  assert.equal(pointAt(f, fv.id, 5), null, 'a still gives no content point')
  // A range is "covered" only when it lies wholly on the anchor's footage.
  assert.equal(piecesIn(f, fa.id, 18, 22).covered, false)
  assert.deepEqual(spansOf(cut(f, [2, 3]), piecesIn(f, fa.id, 5, 7).pieces), [[4, 6]])
})

test('replay: a cut follows its footage across the user\'s cut and its undo; what the user brought back is left alone', () => {
  const whole = talk(20, true)
  const live0 = cut(whole, [3, 8])
  // The agent read live0 and cuts 10–12 there: source 15–17.
  const e = edit(live0, live0, [{ name: 'timeline.cutRanges', params: { ranges: [[10, 12]] } }])
  assert.deepEqual(kept(e.project), [[0, 3], [8, 15], [17, 20]])
  // The user's cut undone: the same entry on the whole talk.
  const r = replay(whole, [e.entry], ctx(true))
  assert.equal(r.outcomes[0].applied, true)
  assert.deepEqual(kept(r.project), [[0, 15], [17, 20]])
  // A range across the user's old cut: the footage that came back is not cut.
  const e2 = edit(live0, live0, [{ name: 'timeline.cutRanges', params: { ranges: [[2, 4]] } }])
  assert.deepEqual(kept(e2.project), [[0, 2], [9, 20]])
  assert.deepEqual(kept(replay(whole, [e2.entry], ctx(true)).project), [[0, 2], [3, 8], [9, 20]])
  assert.deepEqual(replay(whole, [e2.entry], ctx(true)).outcomes[0].cuts, [[2, 3], [8, 9]])
})

test('replay: a cut never takes what the user put there after the agent read (S6); only that range is left out', () => {
  const base = talk(20, true)
  const e = edit(base, base, [{ name: 'timeline.cutRanges', params: { ranges: [[10, 12], [15, 16]] } }])
  const withMarker = applyBatch(base, [{ name: 'marker.add', params: { time: 11, note: 'mine' } }, { name: 'text.add', params: { time: 18, text: 'far' } }]).project
  const r = replay(withMarker, [e.entry], ctx(true))
  assert.equal(r.outcomes[0].applied, true)
  assert.deepEqual(r.outcomes[0].left, [0])
  assert.match(r.outcomes[0].notes![0], /range 1: marker .* lies in it now and did not \(there\) when you read it \(something you did not make\); not cut/)
  assert.deepEqual(kept(r.project), [[0, 15], [16, 20]])
  assert.equal(r.project.markers?.length, 1, 'the user\'s marker is there')
})

test('replay: an op that cannot be made as meant is dropped with its reason, and the rest go on', () => {
  const base = talk(20, true)
  const e = edit(base, base, [
    { name: 'text.add', params: { time: 6.5, text: 'Go', id: 't1' } },
    { name: 'clip.setVolume', params: { clipId: 'c1', volume: 0.5 } },
    { name: 'marker.add', params: { time: 15, note: 'late', id: 'm1' } }
  ])
  assert.deepEqual(e.outcomes.map((o) => o.applied), [true, true, true])
  // The user cut the footage under the title and set the volume themselves.
  const live = applyBatch(cut(base, [6, 7]), [{ name: 'clip.setVolume', params: { clipId: 'c1', volume: 0.8 } }]).project
  const r = replay(live, [e.entry], ctx(true))
  assert.deepEqual(r.outcomes.map((o) => o.applied), [false, false, true])
  assert.match(r.outcomes[0].reason!, /content was removed/)
  assert.match(r.outcomes[1].reason!, /volume of this clip was changed after you read it \(not by you\)/)
  assert.equal(r.project.markers?.[0].time, 14, 'the marker is on source 15')
})

test('replay: a setting of a clip the user split goes to every piece of it; of a piece that is whole again, to nothing (S2, V-accept-ids-4)', () => {
  const base = talk(20)
  const e = edit(base, base, [{ name: 'clip.setVolume', params: { clipId: 'c1', volume: 0 } }])
  const split = applyBatch(base, [{ name: 'clip.split', params: { clipIds: ['c1'], time: 7 } }]).project
  const r = replay(split, [e.entry], ctx(true))
  assert.equal(r.outcomes[0].applied, true)
  assert.deepEqual(Object.values(r.project.clips).map((c) => c.volume), [0, 0], 'both halves')
  // The agent named the piece after its own cut; without that cut the clip is longer than what it named.
  const d1 = edit(base, base, [{ name: 'timeline.cutRanges', params: { ranges: [[10, 11]] } }])
  const d2 = edit(d1.project, d1.project, [{ name: 'clip.setVolume', params: { clipId: 'c1', volume: 0 } }], 2)
  const alone = replay(base, [d2.entry], ctx())
  assert.equal(alone.outcomes[0].applied, false)
  assert.match(alone.outcomes[0].reason!, /part of a longer clip now/)
})

test('replay: a split and a trim are points of the clip\'s own footage; a clip cut up since is trimmed whole pieces and all', () => {
  const base = talk(20)
  const e = edit(base, base, [{ name: 'clip.split', params: { clipIds: ['c1'], time: 12 } }])
  const r = replay(cut(base, [5, 6]), [e.entry], ctx(true))
  assert.equal(r.outcomes[0].applied, true, 'V-rebuild-4: it is not kept as a call that does nothing')
  assert.deepEqual(kept(r.project), [[0, 5], [6, 12], [12, 20]])
  const t = edit(base, base, [{ name: 'clip.trimHead', params: { clipId: 'c1', edge: 10 } }])
  const r2 = replay(cut(base, [5, 6]), [t.entry], ctx(true))
  assert.equal(r2.outcomes[0].applied, true)
  assert.deepEqual(kept(r2.project), [[10, 20]], 'the piece before the user\'s cut went with the trim')
  // Within 0.05 s of an edge a split is dropped, not skipped.
  const r3 = replay(cut(base, [11.98, 13]), [e.entry], ctx(true))
  assert.equal(r3.outcomes[0].applied, false)
})

test('replay: a line is found by its words (the footage they start on), a mark goes where its word is', () => {
  const base = talk(20, true)
  const e = edit(base, base, [{ name: 'caption.update', params: { id: 'L2', patch: { marks: [2] } } }, { name: 'caption.editLine', params: { id: 'L1', text: 'Hello there, friends' } }])
  // The user cuts "we" out of L2: "on" is word 1 now.
  const live = cut(base, [5.95, 6.45])
  const r = replay(live, [e.entry], ctx(true))
  assert.deepEqual(r.outcomes.map((o) => o.applied), [true, true])
  const l2 = r.project.captions.find((c) => c.id === 'L2')!
  assert.equal(l2.words![l2.marks![0]].text, 'on')
  // The marked word itself cut: dropped. A line the user retyped: its new text is not written over.
  const gone = replay(cut(base, [7.05, 8.1]), [e.entry], ctx(true))
  assert.equal(gone.outcomes[0].applied, false)
  const retyped = applyBatch(base, [{ name: 'caption.editLine', params: { id: 'L1', text: 'hello there my friends' } }]).project
  const r2 = replay(retyped, [e.entry], ctx(true))
  assert.equal(r2.outcomes[1].applied, false)
})

test('replay: a structural op runs on the very project it first ran on (its own earlier ops included), and only there (B1)', () => {
  const base = cut(talk(20, true), [9, 10])
  // "Cut and add dissolves" in one edit: the mix meets the project the cut left.
  const e = edit(base, base, [{ name: 'timeline.cutRanges', params: { ranges: [[3, 4]] } }, { name: 'transitions.mix', params: { duration: 0.4 } }])
  assert.deepEqual(e.outcomes.map((o) => o.applied), [true, true])
  assert.equal(e.entry.ops[1].family, 'structural')
  // The same live project again: the same result.
  const again = replay(base, [e.entry], ctx(true))
  assert.deepEqual(again.outcomes.map((o) => o.applied), [true, true])
  assert.ok(sameFilm(again.project, e.project))
  // The user split a clip: the cut still lands; the mix would put a dissolve on their split.
  const live = applyBatch(base, [{ name: 'clip.split', params: { clipIds: ['c1'], time: 6 } }]).project
  const r = replay(live, [e.entry], ctx(true))
  assert.deepEqual(r.outcomes.map((o) => o.applied), [true, false])
  assert.match(r.outcomes[1].reason!, /read again and resend/)
  // A structural op with ids or seconds, written before the agent's own cut: its frame is gone.
  const f = edit(base, e.project, [{ name: 'clip.move', params: { clipId: 'c1', start: 30 } }], 2)
  assert.equal(f.outcomes[0].applied, false)
  assert.match(f.outcomes[0].reason!, /its ids and times are of the version you read/)
  assert.ok(sameLayout(base, applyBatch(base, [{ name: 'clip.setVolume', params: { clipId: 'c1', volume: 0.3 } }]).project), 'a setting is not the layout')
})

test('ids and random choices are an op\'s own: a dropped op shifts nothing, and no id of the project is given out again (S9)', () => {
  const base = talk(20, true)
  const e = edit(base, base, [{ name: 'text.add', params: { time: 2, text: 'Tip' } }, { name: 'text.add', params: { time: 12, text: 'Tip' } }])
  const [t1, t2] = e.outcomes.map((o) => o.result as string)
  const style = edit(e.project, e.project, [{ name: 'caption.update', params: { id: t2, patch: { text: 'Second' } } }], 2)
  // The user cuts the footage under the first title: it is dropped; the second keeps its id.
  const r = replay(cut(base, [1.5, 2.5]), [e.entry, style.entry], ctx(true))
  assert.deepEqual(r.outcomes.map((o) => o.applied), [false, true, true])
  assert.equal(r.project.captions.find((c) => c.id === t2)?.text, 'Second')
  assert.equal(r.project.captions.some((c) => c.id === t1), false)
  // The same seed on a project that already uses those ids: other ids.
  const twice = edit(e.project, e.project, [{ name: 'text.add', params: { time: 5, text: 'Tip' } }, { name: 'text.add', params: { time: 15, text: 'Tip' } }])
  assert.equal(new Set(twice.project.captions.map((c) => c.id)).size, twice.project.captions.length)
  // What the reference run of an op did is not held against a number's noise.
  const op = captureOp(base, base, { name: 'clip.trimEnd', params: { clipId: 'c1', delta: -0.7 } }, 1, 0)
  assert.equal(op.family, 'own')
})

void (null as unknown as Clip | Entry)
void videoAsset
