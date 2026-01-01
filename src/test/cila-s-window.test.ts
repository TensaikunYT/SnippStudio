// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// Çekirdek cila S, "Remove silence": the decision table (CILA.md "S", 1–6).
// One test per row: what is picked → what is listened to → what is cut →
// what moves and what stays. The loudness is made up (a voice that is loud
// while its words are said and quiet between them, a steady music bed).
import { hash, resetWorld } from './undo-fixture'
import assert from 'node:assert/strict'
import test from 'node:test'
import { defaultProject, type Clip, type Project } from '../renderer/src/types'
import { useStore } from '../renderer/src/state/store'
import { versions } from '../renderer/src/state/shared'
import { planSilenceCut, silenceLimit } from '../renderer/src/audio/silence'
import { scanSilence, silenceScope, type SilenceSettings } from '../renderer/src/audio/silence-scope'
import { analyze, type ReadLoudness } from '../renderer/src/agent/analyze'

const T0 = { x: 960, y: 540, scale: 1, rotation: 0 }
const S = useStore.getState
const WIN = 0.04
/** When the voice talks (timeline seconds). The quiet: before the first
 *  word (0–0.5), the pauses 4–6, 10–12, 19–21 (over the join of its two
 *  clips) and 28–31, and after the last word (39–40). */
const TALK: [number, number][] = [[0.5, 4], [6, 10], [12, 19], [21, 28], [31, 39]]
const PAUSES: [number, number][] = [[0, 0.5], [4, 6], [10, 12], [19, 21], [28, 31], [39, 40]]
const SET: SilenceSettings = { sensitivity: 'balanced', minDuration: 0.25, pad: 0.11, pace: 'natural' }

/** V2 a guest's video with its own sound (optional), V1 the talk's picture
 *  (its sound extracted, linked), A1 the voice, A2 "Music". Subtitles with
 *  word times over the talk. */
function film(o: { guest?: boolean; wordInPause?: boolean; noMusic?: boolean } = {}): Project {
  const p = defaultProject()
  p.tracks = [
    { id: 'V2', kind: 'video', name: 'V2', clipIds: [] },
    { id: 'V1', kind: 'video', name: 'V1', clipIds: [] },
    { id: 'A1', kind: 'audio', name: 'A1', clipIds: [] },
    { id: 'A2', kind: 'audio', name: 'Music', clipIds: [] }
  ]
  const a = (id: string, kind: 'video' | 'audio', duration: number) => ({ id, kind, name: id, url: `media://${id}`, size: 1, duration, width: 1920, height: 1080, hasAudio: true }) as never
  p.assets = [a('talk', 'video', 300), a('voice', 'audio', 300), a('music', 'audio', 300), a('guest', 'video', 60)]
  const put = (id: string, assetId: string, trackId: string, start: number, duration: number, extra: Partial<Clip> = {}) => {
    p.clips[id] = { id, assetId, trackId, start, inPoint: start, duration, transform: { ...T0 }, volume: 1, ...extra }
    p.tracks.find((t) => t.id === trackId)!.clipIds.push(id)
  }
  put('t1', 'talk', 'V1', 0, 20, { audioExtracted: true, linkId: 'L1' })
  put('t2', 'talk', 'V1', 20, 20, { audioExtracted: true, linkId: 'L2' })
  put('v1', 'voice', 'A1', 0, 20, { linkId: 'L1' })
  put('v2', 'voice', 'A1', 20, 20, { linkId: 'L2' })
  if (!o.noMusic) put('m1', 'music', 'A2', 0, 40)
  if (o.guest) put('o1', 'guest', 'V2', 5, 10)
  let n = 0
  p.captions = TALK.map(([from, to], i) => {
    const words = []
    for (let t = from; t + 0.4 <= to + 1e-9; t += 0.5) words.push({ text: `w${n++}`, start: t, end: t + 0.4 })
    return { id: `c${i}`, start: from, end: to, text: words.map((w) => w.text).join(' '), words, soundClip: from < 20 ? 'v1' : 'v2' }
  })
  if (o.wordInPause) p.captions.push({ id: 'cx', start: 10.5, end: 11.5, text: 'hmm', words: [{ text: 'hmm', start: 10.5, end: 11.5 }], soundClip: 'v1' })
  return p
}

/** The voice: −20 dB in TALK, −70 between; everything else a steady −18. */
const loudness: ReadLoudness = async (p, clip) => {
  const asset = p.assets.find((x) => x.id === clip.assetId)!
  const n = Math.ceil(clip.duration / WIN)
  if (asset.id !== 'voice') return new Array<number>(n).fill(-18)
  return Array.from({ length: n }, (_, i) => {
    const t = clip.inPoint + (i + 0.5) * WIN
    return TALK.some(([a, b]) => t >= a && t < b) ? -20 : -70
  })
}

const inside = (r: readonly [number, number], [a, b]: [number, number]): boolean => r[0] >= a - 1e-6 && r[1] <= b + 1e-6
/** Each range lies in one of the pauses, in order; which pauses they are. */
const pausesOf = (ranges: readonly (readonly [number, number])[]): number[] => ranges.map((r) => PAUSES.findIndex((q) => inside(r, q)))

async function scanned(p: Project, sel: string[], o: { limit?: [number, number] | null; keepMusic?: boolean } = {}) {
  const scope = await silenceScope(p, sel, loudness)
  assert.ok(scope, 'something to listen to')
  const found = await scanSilence(p, scope, SET, { limit: o.limit ?? null, keepMusic: o.keepMusic ?? true }, loudness)
  return { scope, found, ids: scope.sources.map((c) => c.id) }
}

test('row 1, nothing picked: the speech is listened to (the agent\'s choice); the talk, its picture and the layers are cut, the music stays', async () => {
  const p = film()
  const { scope, found, ids } = await scanned(p, [])
  assert.equal(scope.from, 'speech')
  assert.deepEqual(ids, ['v1', 'v2'])
  assert.deepEqual(pausesOf(found.sure), [0, 1, 2, 3, 4, 5], JSON.stringify(found.sure))
  assert.equal(found.unsure.length, 0)
  assert.deepEqual(found.keepTracks, ['A2'])
  const plan = planSilenceCut(p, ids, found.sure, { keepMusic: true })
  assert.deepEqual(plan.keepTracks, ['A2'])
  assert.deepEqual(plan.cutTracks, ['V1', 'A1'])
  assert.deepEqual([...new Set(plan.marks.map((m) => m.clipId))].sort(), ['t1', 't2', 'v1', 'v2'], 'red on every clip that will be cut, none on the music')
  // Each pause keeps a breath: more than a second goes from each, never all of it.
  for (const i of [1, 2, 3, 4]) assert.ok(plan.ranges[i][1] - plan.ranges[i][0] > 1 && plan.ranges[i][1] - plan.ranges[i][0] < PAUSES[i][1] - PAUSES[i][0], `pause ${i}: ${plan.ranges[i][1] - plan.ranges[i][0]}`)
})

test('row 2, an audio clip picked: that clip alone is listened to', async () => {
  const p = film()
  const { scope, found, ids } = await scanned(p, ['v1'])
  assert.equal(scope.from, 'selection')
  assert.deepEqual(ids, ['v1'])
  // Its own quiet: the lead-in, 4–6, 10–12 and its end (19–20); nothing of v2's.
  assert.deepEqual(pausesOf(found.sure), [0, 1, 2, 3])
  assert.ok(found.sure[3][1] <= 20 + 1e-6)
  assert.deepEqual(planSilenceCut(p, ids, found.sure, { keepMusic: true }).keepTracks, ['A2'])
})

test('row 3, a video clip picked: its own sound, or the linked sound taken out of it', async () => {
  const p = film({ guest: true })
  // The talk's picture has no sound of its own: the linked voice under it.
  const linked = await scanned(p, ['t2'])
  assert.deepEqual(linked.ids, ['v2'])
  assert.deepEqual(linked.scope.pictures, ['t2'])
  // (A guest at speech level lies under nothing after 15 s: v2's pauses are sure.)
  assert.deepEqual(pausesOf(linked.found.sure), [3, 4, 5])
  assert.ok(linked.found.sure[0][0] >= 20 - 1e-6)
  // A video with its own sound: itself (steady sound: no pause in it).
  const own = await scanned(p, ['o1'])
  assert.deepEqual(own.ids, ['o1'])
  assert.deepEqual(own.found.sure, [])
  // A pick with nothing that sounds (the music on a muted track): nothing to listen to.
  p.tracks.find((t) => t.id === 'A2')!.muted = true
  assert.equal(await silenceScope(p, ['m1'], loudness), null)
})

test('row 4, several clips picked: every one is listened to, and a pause is cut only where all of them are quiet', async () => {
  const p = film({ guest: true })
  const { found, ids } = await scanned(p, ['v1', 'o1'])
  assert.deepEqual(ids.sort(), ['o1', 'v1'])
  // The guest talks 5–15: of v1's quiet only the lead-in, the part of 4–6 before 5 and the end (19–20) go.
  assert.equal(found.sure.length + found.unsure.length, 3)
  const all = [...found.sure, ...found.unsure.map((u) => u.r)].sort((a, b) => a[0] - b[0])
  assert.ok(all[0][1] <= 0.5, JSON.stringify(all))
  assert.ok(all[1][0] > 4 && all[1][1] <= 5 + 1e-6, JSON.stringify(all))
  assert.ok(all[2][0] > 19 && all[2][1] <= 20 + 1e-6)
})

test('row 5, a time range (two cut marks, else the loop range): the scan is kept to it', async () => {
  assert.deepEqual(silenceLimit({ cutMarks: [30, 9], loopRange: [1, 2] }), [9, 30])
  assert.deepEqual(silenceLimit({ cutMarks: [9], loopRange: [1, 2] }), [1, 2])
  assert.equal(silenceLimit({ cutMarks: [], loopRange: null }), null)
  assert.equal(silenceLimit({ cutMarks: [5, 5.01], loopRange: null }), null)
  const p = film()
  const { found } = await scanned(p, [], { limit: [9, 30] })
  assert.deepEqual(pausesOf(found.sure), [2, 3, 4])
  assert.ok(found.sure.every(([a, b]) => a >= 9 && b <= 30))
  assert.ok(Math.abs(found.sure[2][1] - 30) < 1e-9, 'the last pause is cut off at the mark')
})

test('row 6, "music is not cut" switched off: every unlocked track is cut, as before; a pause under a loud bed is then not a sure one', async () => {
  const p = film()
  const { found, ids } = await scanned(p, [], { keepMusic: false })
  assert.deepEqual(found.keepTracks, [])
  assert.equal(found.sure.length, 0)
  assert.equal(found.unsure.length, 6)
  assert.ok(found.unsure.every((u) => /m1 at speech level/.test(u.why)))
  const plan = planSilenceCut(p, ids, found.unsure.map((u) => u.r), { keepMusic: false })
  assert.deepEqual(plan.cutTracks, ['V1', 'A1', 'A2'])
  assert.ok(plan.marks.some((m) => m.clipId === 'm1'), 'the music shows red: it will be cut')
})

test('decision 5: the agent\'s "not sure" pauses are counted apart (a word inside the pause, another voice under it) and are not in the cut unless included', async () => {
  const word = await scanned(film({ wordInPause: true }), [])
  assert.deepEqual(pausesOf(word.found.sure), [0, 1, 3, 4, 5])
  assert.deepEqual(word.found.unsure.map((u) => u.why), ['enters a word'])
  const guest = await scanned(film({ guest: true }), [])
  assert.deepEqual(pausesOf(guest.found.sure), [0, 3, 4, 5])
  assert.deepEqual(guest.found.unsure.map((u) => u.why), ['o1 at speech level', 'o1 at speech level'])
  // The same finder as the agent's: the same pauses, the same doubt.
  const p = film({ guest: true, noMusic: true })
  const mine = await scanned(p, [], { keepMusic: false })
  const r = await analyze(p, { kind: 'silences' }, 'r1', 'v-1', undefined, { loudness })
  assert.deepEqual(r.items.filter((i) => !i.uncertain).map((i) => i.cut), mine.found.sure)
  assert.deepEqual(r.items.filter((i) => i.uncertain).map((i) => i.cut), mine.found.unsure.map((u) => u.r))
  assert.equal(mine.found.unsure.length, 2)
})

test('decision 4: the total the window shows is what the cut takes out; one undo step; the music is one piece, the subtitles are on their words', async () => {
  resetWorld()
  const p = film()
  S().loadProject(p)
  const { found, ids } = await scanned(S().project, [])
  const plan = planSilenceCut(S().project, ids, found.sure, { keepMusic: true })
  const before = hash(S().project)
  const depth = S().past.length
  const v0 = S().projectVersion
  const len = (q: Project, t: string): number => q.tracks.find((x) => x.id === t)!.clipIds.reduce((n, id) => n + q.clips[id].duration, 0)
  S().applySilenceCuts(plan.regions, { picked: plan.picked, keepTracks: plan.keepTracks, endBeds: true })
  const out = S().project
  assert.equal(S().past.length - depth, 1)
  assert.deepEqual(versions.entriesAfter(v0)![0].cuts, [plan.ranges], 'the ranges cut are the ranges shown')
  assert.ok(Math.abs(40 - len(out, 'A1') - plan.total) < 1e-6, `${40 - len(out, 'A1')} cut, ${plan.total} shown`)
  assert.ok(Math.abs(len(out, 'V1') - len(out, 'A1')) < 1e-9)
  // The music: one clip, where it was, ending with the film.
  assert.deepEqual(out.tracks.find((t) => t.id === 'A2')!.clipIds, ['m1'])
  assert.equal(out.clips.m1.start, 0)
  assert.ok(Math.abs(out.clips.m1.duration - (40 - plan.total)) < 1e-6)
  // Every subtitle word still lies on the voice it was said in.
  for (const cap of out.captions) {
    for (const w of cap.words!) {
      const under = Object.values(out.clips).find((c) => c.trackId === 'A1' && w.start >= c.start - 1e-6 && w.end <= c.start + c.duration + 1e-6)
      assert.ok(under, `${w.text} at ${w.start}`)
      const media = under.inPoint + (w.start - under.start)
      assert.ok(TALK.some(([a, b]) => media >= a - 1e-6 && media < b), `${w.text} is on talk (${media})`)
    }
  }
  S().undo()
  assert.equal(hash(S().project), before)
})
