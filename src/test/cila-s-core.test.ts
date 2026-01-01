// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// Çekirdek cila S, the core (CILA.md "S", decisions 2 and 3): the ripple's
// "leave these tracks" set and the music that ends with the film.
//
// First the pin: WITHOUT keepTracks the ripple, timeline.cutRanges and
// silence.apply give byte for byte what they gave at 35899d3 (the hashes
// below were written by that tree, before ops/ripple.ts was touched).
import { hash, resetWorld } from './undo-fixture'
import assert from 'node:assert/strict'
import test from 'node:test'
import { defaultProject, projectDuration, type Clip, type Project } from '../renderer/src/types'
import { runCommand, commandByName } from '../renderer/src/commands'
import { applySilence, bedTracks, cutRanges } from '../renderer/src/commands/timeline'
import { endBeds, rippleRange } from '../renderer/src/commands/ops/ripple'
import { defaultEnv, produceEdit } from '../renderer/src/commands/core'
import { useStore } from '../renderer/src/state/store'
import { versions } from '../renderer/src/state/shared'

const T0 = { x: 960, y: 540, scale: 1, rotation: 0 }
const S = useStore.getState

/** V2 B-roll and stings, V1 the talk (its sound extracted, linked to A1's
 *  voice pieces), A1 the voice, A2 music, A3 sound effects; subtitles, a
 *  marker, a note. */
function film(opts: { lockA2?: boolean; musicTo?: number; fadeOut?: number } = {}): Project {
  const p = defaultProject()
  p.tracks = [
    { id: 'V2', kind: 'video', name: 'V2', clipIds: [] },
    { id: 'V1', kind: 'video', name: 'V1', clipIds: [] },
    { id: 'A1', kind: 'audio', name: 'A1', clipIds: [] },
    { id: 'A2', kind: 'audio', name: 'Music', clipIds: [], ...(opts.lockA2 ? { locked: true } : {}) },
    { id: 'A3', kind: 'audio', name: 'SFX', clipIds: [], role: 'sfx' }
  ]
  const a = (id: string, kind: 'video' | 'audio' | 'image', duration: number) => ({ id, kind, name: id, url: `media://${id}`, size: 1, duration, width: 1920, height: 1080, hasAudio: kind !== 'image' }) as never
  p.assets = [a('talk', 'video', 300), a('voice', 'audio', 300), a('music', 'audio', 300), a('pic', 'image', 0), a('sting', 'video', 30), a('whoosh', 'audio', 5)]
  const put = (id: string, assetId: string, trackId: string, start: number, inPoint: number, duration: number, extra: Partial<Clip> = {}) => {
    p.clips[id] = { id, assetId, trackId, start, inPoint, duration, transform: { ...T0 }, volume: 1, ...extra }
    p.tracks.find((t) => t.id === trackId)!.clipIds.push(id)
  }
  put('t1', 'talk', 'V1', 0, 10, 12, { audioExtracted: true, linkId: 'L1' })
  put('t2', 'talk', 'V1', 12, 40, 14, { audioExtracted: true, linkId: 'L2' })
  put('t3', 'talk', 'V1', 26, 70, 10, { audioExtracted: true, linkId: 'L3' })
  put('v1', 'voice', 'A1', 0, 10, 12, { linkId: 'L1' })
  put('v2', 'voice', 'A1', 12, 40, 14, { linkId: 'L2' })
  put('v3', 'voice', 'A1', 26, 70, 10, { linkId: 'L3' })
  put('b1', 'pic', 'V2', 4, 0, 5)
  put('s1', 'sting', 'V2', 15, 0, 3)
  put('s2', 'sting', 'V2', 30, 2, 4)
  put('m1', 'music', 'A2', 0, 0, opts.musicTo ?? 36, opts.fadeOut ? { fadeOut: opts.fadeOut } : {})
  put('w1', 'whoosh', 'A3', 30, 0, 1)
  p.captions = Array.from({ length: 10 }, (_, i) => ({ id: `c${i}`, start: i * 3.5 + 0.3, end: i * 3.5 + 2.8, text: `line ${i}`, soundClip: i * 3.5 < 12 ? 'v1' : i * 3.5 < 26 ? 'v2' : 'v3' }))
  p.markers = [{ id: 'mk', time: 33, color: '#fff', note: '' }]
  return p
}

const seeded = (): ReturnType<typeof defaultEnv> => {
  let n = 0
  return { ...defaultEnv(), newId: () => `n${(n++).toString().padStart(4, '0')}` }
}

// ---- the pin ---------------------------------------------------------------

const PIN: Record<string, string> = {
  'cutRanges': 'c76cb082ad728dbb',
  'cutRanges locked': '5f96f8bd820a9fe7',
  'silence.apply': 'c75172fbb758234c',
  'silence.apply crossfade picked': '32c19d1ee667d57f',
  'rippleRange one track': 'c3c27996b4539b9b',
  'store rippleDeleteMany': '946001125409df78',
  'store applySilenceCuts': 'f7d67ec503a4de4d'
}

function pinned(): Record<string, string> {
  const out: Record<string, string> = {}
  out['cutRanges'] = hash(runCommand(film(), commandByName('timeline.cutRanges'), { ranges: [[3, 4.5], [16, 18.25], [29.999, 31]] }, seeded()).project)
  out['cutRanges locked'] = hash(runCommand(film({ lockA2: true }), commandByName('timeline.cutRanges'), { ranges: [[3, 4.5], [16, 18.25]] }, seeded()).project)
  out['silence.apply'] = hash(runCommand(film(), commandByName('silence.apply'), { regions: [{ clipId: 'v1', start: 5, end: 6.5 }, { clipId: 'v2', start: 20, end: 22 }] }, seeded()).project)
  out['silence.apply crossfade picked'] = hash(runCommand(film(), commandByName('silence.apply'), { regions: [{ clipId: 'v1', start: 5, end: 6.5 }, { clipId: 'v2', start: 20, end: 22 }], picked: ['v1', 'v2', 'v3', 't1', 't2', 't3'], crossfade: true }, seeded()).project)
  out['rippleRange one track'] = hash(produceEdit(film(), (d) => void rippleRange(d, [[16, 18]], 'V1')))
  resetWorld()
  S().loadProject(film())
  S().rippleDeleteMany([[3, 4.5], [16, 18.25]])
  out['store rippleDeleteMany'] = hash(S().project)
  resetWorld()
  S().loadProject(film())
  S().applySilenceCuts([{ clipId: 'v1', start: 5, end: 6.5 }, { clipId: 'v2', start: 20, end: 22 }], { crossfade: true, picked: ['v1', 'v2'] })
  out['store applySilenceCuts'] = hash(S().project)
  return out
}

test('pin: with no keepTracks the ripple, timeline.cutRanges and silence.apply give what they gave at 35899d3, byte for byte', () => {
  const now = pinned()
  if (process.env.CILA_S_PIN) console.log(JSON.stringify(now, null, 1))
  assert.deepEqual(now, PIN)
})

// ---- decision 2: the tracks a cut leaves alone ------------------------------

const clipsOn = (p: Project, trackId: string): Clip[] => p.tracks.find((t) => t.id === trackId)!.clipIds.map((id) => p.clips[id])
const SIL = [{ clipId: 'v1', start: 5, end: 6.5 }, { clipId: 'v2', start: 20, end: 22 }]

test('decision 2: an empty keepTracks is no keepTracks (the ripple and both commands)', () => {
  resetWorld()
  const a = hash(produceEdit(film(), (d) => void rippleRange(d, [[5, 6.5], [20, 22]], null, { fades: true })))
  resetWorld()
  const b = hash(produceEdit(film(), (d) => void rippleRange(d, [[5, 6.5], [20, 22]], null, { fades: true, keepTracks: [] })))
  assert.equal(b, a)
  const cut = (keepTracks?: string[]): string => (resetWorld(), hash(produceEdit(film(), (d) => void cutRanges.apply(d, { ranges: [[5, 6.5]], ...(keepTracks ? { keepTracks, endBeds: true } : {}) }, seeded()))))
  assert.equal(cut([]), cut())
  // A track the project does not have keeps nothing.
  assert.equal(cut(['nope']), cut())
  const sil = (keepTracks?: string[]): string => (resetWorld(), hash(produceEdit(film(), (d) => void applySilence.apply(d, { regions: SIL, ...(keepTracks ? { keepTracks, endBeds: true } : {}) }, seeded()))))
  assert.equal(sil([]), sil())
})

test('decision 2: keepTracks is the store\'s own: a call by name cannot give it (the agent\'s contract stands)', () => {
  assert.throws(() => runCommand(film(), commandByName('silence.apply'), { regions: SIL, keepTracks: ['A2'] }), /bad parameters/)
  assert.throws(() => runCommand(film(), commandByName('timeline.cutRanges'), { ranges: [[5, 6]], keepTracks: ['A2'] }), /bad parameters/)
  assert.throws(() => runCommand(film(), commandByName('timeline.cutRanges'), { ranges: [[5, 6]], endBeds: true }), /bad parameters/)
})

test('decision 2: a silence cut that keeps the music: the music is one piece where it was; the talk, its picture, the layers, the effects, the subtitles and the marker move up', () => {
  const p = film()
  const out = produceEdit(p, (d) => void applySilence.apply(d, { regions: SIL, picked: ['v1', 'v2', 'v3'], keepTracks: ['A2'] }, seeded()))
  // 1.5 s and 2 s went.
  assert.deepEqual(clipsOn(out, 'A2').map((c) => [c.id, c.start, c.inPoint, c.duration]), [['m1', 0, 0, 36]])
  assert.deepEqual(out.clips.m1, p.clips.m1, 'the music clip is untouched')
  assert.equal(clipsOn(out, 'A1').length, 5, 'the voice in five pieces')
  assert.equal(clipsOn(out, 'V1').length, 5, 'its picture in five pieces')
  const sum = (t: string): number => clipsOn(out, t).reduce((n, c) => n + c.duration, 0)
  assert.ok(Math.abs(sum('A1') - 32.5) < 1e-9 && Math.abs(sum('V1') - 32.5) < 1e-9)
  assert.equal(out.clips.t3.start, 22.5)
  assert.equal(out.clips.v3.start, 22.5)
  assert.equal(out.clips.s1.start, 13.5, 'the layer above moved by the first cut')
  assert.equal(out.clips.s2.start, 26.5)
  assert.equal(out.clips.w1.start, 26.5, 'the sound effect stays on its moment of the picture')
  assert.equal(out.markers![0].time, 29.5)
  // Subtitles: c2 (7.3–9.8) moved by 1.5, c9 (31.8–34.3) by 3.5.
  assert.ok(Math.abs(out.captions.find((c) => c.id === 'c2')!.start - 5.8) < 1e-9)
  assert.ok(Math.abs(out.captions.find((c) => c.id === 'c9')!.start - 28.3) < 1e-9)
  // Each picture piece still lies on its sound piece, linked to it and to nothing else.
  for (const v of clipsOn(out, 'V1')) {
    const partner = clipsOn(out, 'A1').filter((a) => a.linkId === v.linkId)
    assert.equal(partner.length, 1, `${v.id} has one partner`)
    assert.ok(Math.abs(partner[0].start - v.start) < 1e-9 && Math.abs(partner[0].duration - v.duration) < 1e-9)
  }
  // Without endBeds the music runs on to where it ran (3.5 s past the rest).
  assert.equal(projectDuration(out), 36)
})

test('decision 2: with the option off (no keepTracks) the music is cut and moved, as it always was', () => {
  const out = produceEdit(film(), (d) => void applySilence.apply(d, { regions: SIL, picked: ['v1', 'v2', 'v3'] }, seeded()))
  assert.equal(clipsOn(out, 'A2').length, 3)
  assert.ok(Math.abs(clipsOn(out, 'A2').reduce((n, c) => n + c.duration, 0) - 32.5) < 1e-9)
})

test('decision 2: which tracks are the bed (bedTracks)', () => {
  const p = film()
  assert.deepEqual(bedTracks(p, ['v1', 'v2', 'v3']), ['A2'], 'the music; not the voice, not the effects track, never a video track')
  assert.deepEqual(bedTracks(p, ['t1']), ['A2'], 'a picture as the source: its linked sound is cut with it, the music is the bed')
  assert.deepEqual(bedTracks(p, []), [], 'no source: nothing is kept')
  assert.deepEqual(bedTracks(p, ['gone']), [], 'a source the project does not have: nothing is kept')
  assert.deepEqual(bedTracks(film({ lockA2: true }), ['v1']), [], 'a locked track stays anyway: not listed')
  // A second sound linked to a picture is that picture's sound, not a bed.
  const q = film()
  q.clips.m1.linkId = 'LB'
  q.clips.b1.linkId = 'LB'
  assert.deepEqual(bedTracks(q, ['v1']), [])
  // A music clip on the voice's own track: the track holds a source, it is cut.
  const r = film()
  r.tracks.find((t) => t.id === 'A2')!.clipIds = []
  r.clips.m1.trackId = 'A1'
  r.clips.m1.start = 40
  r.tracks.find((t) => t.id === 'A1')!.clipIds.push('m1')
  assert.deepEqual(bedTracks(r, ['v1']), [])
})

// ---- decision 3: the music ends with the film -------------------------------

test('decision 3: the kept music is cut back to the new end and fades out there (its own fade-out kept; 1 s when it had none)', () => {
  const run = (o: Parameters<typeof film>[0], endBedsOn = true): Project => produceEdit(film(o), (d) => void applySilence.apply(d, { regions: SIL, picked: ['v1', 'v2', 'v3'], keepTracks: ['A2'], endBeds: endBedsOn }, seeded()))
  const plain = run({})
  assert.equal(plain.clips.m1.start, 0)
  assert.equal(plain.clips.m1.inPoint, 0)
  assert.ok(Math.abs(plain.clips.m1.duration - 32.5) < 1e-9, `the music ends at 32.5 (${plain.clips.m1.duration})`)
  assert.equal(plain.clips.m1.fadeOut, 1)
  assert.ok(Math.abs(projectDuration(plain) - 32.5) < 1e-9)
  assert.equal(run({ fadeOut: 2.5 }).clips.m1.fadeOut, 2.5, 'its own fade-out stays')
  // Music that ran 4 s past the last picture runs 4 s past it still.
  const tail = run({ musicTo: 40 })
  assert.ok(Math.abs(tail.clips.m1.duration - 36.5) < 1e-9)
  // Music that ended before the new end is not touched.
  assert.deepEqual(run({ musicTo: 20 }).clips.m1, film({ musicTo: 20 }).clips.m1)
  // Off: it runs on.
  assert.equal(run({}, false).clips.m1.duration, 36)
})

test('decision 3: a music clip that would begin after the new end goes; a locked bed is never cut back', () => {
  const p = film({ musicTo: 33 })
  p.assets.push({ id: 'music2', kind: 'audio', name: 'music2', url: 'media://music2', size: 1, duration: 60, width: 0, height: 0, hasAudio: true } as never)
  p.clips.m2 = { id: 'm2', assetId: 'music2', trackId: 'A2', start: 33, inPoint: 0, duration: 3, transform: { ...T0 }, volume: 1 }
  p.tracks.find((t) => t.id === 'A2')!.clipIds.push('m2')
  const out = produceEdit(p, (d) => void applySilence.apply(d, { regions: SIL, picked: ['v1', 'v2', 'v3'], keepTracks: ['A2'], endBeds: true }, seeded()))
  assert.equal(out.clips.m2, undefined)
  assert.ok(Math.abs(out.clips.m1.duration - 32.5) < 1e-9)
  assert.deepEqual(clipsOn(out, 'A2').map((c) => c.id), ['m1'])
  // endBeds on its own, on a locked track: nothing.
  const q = film({ lockA2: true })
  assert.deepEqual(endBeds(q, ['A2'], 40), [])
})

// ---- the store ---------------------------------------------------------------

test('the store: a kept-music silence cut and a kept-music range cut are one undo step each, undo gives the project back, and the version log knows the music stood still', () => {
  resetWorld()
  const p = film()
  S().loadProject(p)
  const before = hash(S().project)
  const depth = S().past.length
  const v0 = S().projectVersion
  S().applySilenceCuts(SIL, { picked: ['v1', 'v2', 'v3'], keepTracks: ['A2'], endBeds: true })
  assert.equal(S().past.length - depth, 1)
  assert.ok(Math.abs(S().project.clips.m1.duration - 32.5) < 1e-9)
  const entry = versions.entriesAfter(v0)!
  assert.equal(entry.length, 1)
  assert.equal(entry[0].kind, 'cut')
  assert.deepEqual(entry[0].fixedTracks, ['A2'])
  assert.deepEqual(entry[0].cuts, [[[5, 6.5], [20, 22]]])
  S().undo()
  assert.equal(hash(S().project), before)

  S().rippleDeleteMany([[5, 6.5], [20, 22]], { keepTracks: ['A2'] })
  assert.equal(S().past.length - depth, 1)
  assert.deepEqual(S().project.clips.m1, p.clips.m1)
  assert.equal(S().project.clips.t3.start, 22.5)
  S().undo()
  S().rippleDelete(5, 6.5, { keepTracks: ['A2', 'zz'], endBeds: true })
  assert.ok(Math.abs(S().project.clips.m1.duration - 34.5) < 1e-9)
  assert.equal(S().past.length - depth, 1)
  S().undo()
  assert.equal(hash(S().project), before)
  // A locked bed is the lock's, not the option's: it stays whole.
  S().loadProject(film({ lockA2: true }))
  const v1 = S().projectVersion
  S().rippleDelete(5, 6.5, { keepTracks: ['A2'], endBeds: true })
  assert.equal(S().project.clips.m1.duration, 36)
  assert.deepEqual(versions.entriesAfter(v1)![0].fixedTracks, ['A2'])
})

test('the store: markTimes leaves its markers in one undo step', () => {
  resetWorld()
  S().loadProject(film())
  const depth = S().past.length
  S().markTimes([{ time: 5, label: 'Pause 1.5 s' }, { time: 20, label: 'Pause 2.0 s', note: 'n' }])
  assert.equal(S().past.length - depth, 1)
  assert.deepEqual(S().project.markers!.map((m) => [m.time, m.label ?? '', m.note]), [[5, 'Pause 1.5 s', ''], [20, 'Pause 2.0 s', 'n'], [33, '', '']])
  assert.equal(S().project.clips.t1.duration, 12, 'nothing is cut')
  S().undo()
  assert.equal(S().project.markers!.length, 1)
  S().markTimes([])
  assert.equal(S().past.length - depth, 0)
})
