// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// SnippStudio phase 4A.11 (tarifler/FAZ4A-YAMA.md, Bölüm A): the round-2
// reviewers' probes P1–P18 (core) as tests with their new behaviour. Each
// test fails when its rule is taken back (scripts/mutate.mjs, Q-mutations).
import './dom-stub'
import assert from 'node:assert/strict'
import test from 'node:test'
import { useStore } from '../renderer/src/state/store'
import { defaultProject, type Asset, type Project } from '../renderer/src/types'
import { acceptDraft, acceptPreview, contextFor, currentDraft, rejectDraft, takeNews, watchLive } from '../renderer/src/agent/drafts'
import { agentTools } from '../renderer/src/agent/tools'
import { analyze } from '../renderer/src/agent/analyze'
import { resultText } from '../renderer/src/agent/answers'
import { editTool } from '../renderer/src/agent/edit'
import { anchorTrack } from '../renderer/src/agent/content'
import { lostChange } from '../renderer/src/agent/replay'
import { clipOf, ctxOf, directCalls, kept, open, read, talk, videoAsset } from './agent-kit'

const S = useStore.getState
const unwatch = watchLive()
test.after(() => {
  rejectDraft()
  unwatch()
})
const user = (name: string, params: unknown): void => void S().runBatch([{ name, params }] as never)
const edit = (ops: Record<string, unknown>[], base: string, extra: Parameters<typeof ctxOf>[0] = {}): Promise<string> => editTool({ ops, base }, ctxOf(extra))
const outcomes = (): { name: string; applied: boolean; reason: string; notes: string[] }[] => currentDraft()!.outcomes.map((o) => ({ name: o.name, applied: o.applied, reason: o.reason ?? '', notes: o.notes ?? [] }))
const K1 = 'something you did not make was changed there after you read it'

/** A talk with subtitles, a B-roll b1 (8–14 s) on V2 and a music bed m1. */
function withBroll(): Project {
  const p = talk(30, true)
  const a1 = p.tracks.find((t) => t.kind === 'audio')!
  p.assets.push({ ...videoAsset('b', 30), hasAudio: false } as Asset, { ...videoAsset('m', 90), kind: 'audio' } as Asset, videoAsset('spare', 20))
  p.tracks.unshift({ id: 'V2', kind: 'video', name: 'V2', clipIds: ['b1'] })
  p.clips.b1 = clipOf('b1', 'b', 'V2', 8, 0, 6)
  p.clips.m1 = clipOf('m1', 'm', a1.id, 0, 0, 30, { volume: 0.3 })
  a1.clipIds = ['m1']
  return p
}
const bPieces = (p: Project): { id: string; start: number; dur: number; grade?: unknown; opacity?: number }[] =>
  Object.values(p.clips)
    .filter((c) => c.assetId === 'b')
    .sort((a, b) => a.start - b.start)
    .map((c) => ({ id: c.id, start: c.start, dur: c.duration, ...(c.grade ? { grade: c.grade } : {}), ...(c.opacity !== undefined ? { opacity: c.opacity } : {}) }))

test('P1 (K1): a trim does not delete a piece the user split off and then graded, blended, masked or keyframed — any field, no list', async () => {
  const restyles: [string, (id: string) => void][] = [
    ['grade', (id) => S().setClipGrade(id, { brightness: 0, contrast: 0, saturation: -1, warmth: 0 })],
    ['blendMode', (id) => S().setClipBlendMode(id, 'screen')],
    ['mask', (id) => S().setClipMask(id, { enabled: true, shape: 'ellipse', feather: 4 })],
    ['opacity', (id) => user('clip.setOpacity', { clipId: id, opacity: 0.5 })],
    ['keyframes', (id) => {
      S().setTime(12.2)
      S().addPropKeyframe(id, 'scale')
    }]
  ]
  for (const [name, restyle] of restyles) {
    open(withBroll())
    await edit([{ op: 'clip.trimEnd', clipId: 'b1', delta: -3 }], read())
    user('clip.split', { clipIds: ['b1'], time: 12 })
    const right = Object.values(S().project.clips).find((c) => c.assetId === 'b' && c.id !== 'b1')!.id
    restyle(right)
    const o = outcomes()[0]
    assert.equal(o.applied, false, `${name}: the trim is dropped`)
    assert.ok(currentDraft()!.project.clips[right], `${name}: the user's piece stays in the draft`)
    rejectDraft()
  }
  // Split alone (no setting): the trim still takes the right piece with it.
  open(withBroll())
  await edit([{ op: 'clip.trimEnd', clipId: 'b1', delta: -3 }], read())
  user('clip.split', { clipIds: ['b1'], time: 12 })
  assert.equal(outcomes()[0].applied, true)
  assert.deepEqual(bPieces(currentDraft()!.project).map((x) => x.dur), [3])
  rejectDraft()
})

test('P2 (K1 + the record rule): clip.delete / a setting does not reach a piece the user split off, moved and restyled — in a draft and straight', async () => {
  open(withBroll())
  await edit([{ op: 'clip.delete', ids: ['b1'] }], read())
  user('clip.split', { clipIds: ['b1'], time: 11 })
  const right = Object.values(S().project.clips).find((c) => c.assetId === 'b' && c.id !== 'b1')!.id
  user('clip.move', { clipId: right, start: 25 })
  user('clip.setOpacity', { clipId: right, opacity: 0.5 })
  assert.equal(outcomes()[0].applied, false)
  assert.equal(bPieces(currentDraft()!.project).length, 2, 'both pieces stay')
  rejectDraft()
  // Moved only (not restyled): not joined to the piece named any more — not the clip named.
  open(withBroll())
  await edit([{ op: 'clip.delete', ids: ['b1'] }], read())
  user('clip.split', { clipIds: ['b1'], time: 11 })
  const r2 = Object.values(S().project.clips).find((c) => c.assetId === 'b' && c.id !== 'b1')!.id
  user('clip.move', { clipId: r2, start: 25 })
  assert.equal(outcomes()[0].applied, false)
  assert.match(outcomes()[0].reason, /was moved or changed since you read it/)
  rejectDraft()
  // Straight onto the timeline, with an old base.
  open(withBroll(), 'direct')
  const v = read()
  user('clip.split', { clipIds: ['b1'], time: 11 })
  const r3 = Object.values(S().project.clips).find((c) => c.assetId === 'b' && c.id !== 'b1')!.id
  user('clip.move', { clipId: r3, start: 25 })
  user('clip.setOpacity', { clipId: r3, opacity: 0.5 })
  const ans = await edit([{ op: 'clip.setMuted', clipId: 'b1', muted: true }, { op: 'clip.delete', ids: ['b1'] }], v)
  assert.match(ans, /Nothing applied/)
  assert.equal(bPieces(S().project).length, 2)
  assert.equal(S().project.clips[r3].opacity, 0.5)
})

test("P3 (K3): a second window of the same program takes over the gone session's draft only — what that one landed stays someone else's", async () => {
  open(talk(20, true))
  const b = read('test')
  await edit([{ op: 'marker.add', time: 11, note: 'by s1, accepted' }], read('test'), { session: 's1' })
  acceptDraft(undefined, 'now')
  await edit([{ op: 'text.add', time: 2, text: 'S1 title' }], read('test'), { session: 's1' })
  await edit([{ op: 'timeline.cutRanges', ranges: [[10, 13]] }], b, { session: 's2', alive: (s) => s !== 's1' })
  const d = currentDraft()!
  assert.equal(d.session, 's2', 'the draft was taken over')
  assert.equal(d.project.markers?.length, 1, "s1's accepted marker stays: the stale cut does not take it")
  const cut = outcomes().find((o) => o.name === 'timeline.cutRanges')
  assert.ok(!cut || !cut.applied || cut.notes.length > 0)
  rejectDraft()
  // An op that depends on how everything lies, sent by s2 on its old read:
  // s1's accepted marker is a change s2 did not make — not made.
  open(talk(20, true))
  const b2 = read('test')
  await edit([{ op: 'marker.add', time: 11, note: 'by s1, accepted' }], read('test'), { session: 's1' })
  acceptDraft(undefined, 'now')
  await edit([{ op: 'text.add', time: 2, text: 'S1 title' }], read('test'), { session: 's1' })
  const ans = await edit([{ op: 'clip.move', clipId: 'c1', start: 1 }], b2, { session: 's2', alive: (s) => s !== 's1' })
  assert.match(ans, /Nothing applied/)
  assert.match(ans, /clip\.move: the project was changed since you read it \(not by you\)/)
  rejectDraft()
})

test('P4 (K4): an assembly — appends, a new track, a clip on that track by its name — lives when the user added a marker between the read and the call', async () => {
  const p = talk(0)
  p.clips = {}
  p.tracks.forEach((t) => (t.clipIds = []))
  p.assets = ['s1', 's2', 's3'].map((id) => videoAsset(id, 6)).concat([{ ...videoAsset('pic', 0), kind: 'image', hasAudio: false } as Asset])
  open(p, 'direct')
  const v = read()
  const v1 = S().project.tracks.find((t) => t.kind === 'video')!.id
  user('marker.add', { time: 1 })
  const ans = await edit(
    [
      { op: 'clip.append', assetId: 's1', trackId: v1 },
      { op: 'clip.append', assetId: 's2', trackId: v1 },
      { op: 'clip.append', assetId: 's3', trackId: v1 },
      { op: 'track.add', kind: 'video', id: 'T' },
      { op: 'clip.add', assetId: 'pic', trackId: 'T', start: 2 }
    ],
    v
  )
  assert.doesNotMatch(ans, /dropped|not applied/i, ans)
  const clips = Object.values(S().project.clips)
  assert.equal(clips.length, 4)
  assert.deepEqual(clips.filter((c) => c.trackId === v1).map((c) => c.start).sort((a, b) => a - b), [0, 6, 12])
  assert.equal(clips.find((c) => c.assetId === 'pic')!.start, 2)
})

test('P5 (K2): footage that comes to play in a second place after a cut was made is not cut there (the range is left and said); at the first run both places are cut, as before', async () => {
  open(talk(20))
  await edit([{ op: 'timeline.cutRanges', ranges: [[6, 7]] }], read())
  user('clip.split', { clipIds: ['c1'], time: 10 })
  const right = Object.values(S().project.clips).find((c) => c.id !== 'c1')!.id
  user('clip.slip', { clipId: right, delta: -5 })
  const o = currentDraft()!.outcomes[0]
  assert.equal(o.applied, false, 'the range is left')
  assert.match(o.reason ?? '', /plays in more than one place now/)
  // The live project's both places stay as the user left them.
  const total = Object.values(currentDraft()!.project.clips).reduce((n, c) => n + c.duration, 0)
  assert.equal(total, 20)
  rejectDraft()
  // Straight, with the base before the slip: found in two places at the first run, both cut and said.
  open(talk(20), 'direct')
  const v = read()
  user('clip.split', { clipIds: ['c1'], time: 10 })
  const r2 = Object.values(S().project.clips).find((c) => c.id !== 'c1')!.id
  user('clip.slip', { clipId: r2, delta: -5 })
  const ans = await edit([{ op: 'timeline.cutRanges', ranges: [[6, 7]] }], v)
  assert.match(ans, /cut 2 ranges/)
})

test('K1b / Q24: a range in two places, one of which the user keyed after the read, is left in both places; the other range is cut', async () => {
  open(talk(20), 'direct')
  const v = read()
  user('clip.split', { clipIds: ['c1'], time: 10 })
  const right = Object.values(S().project.clips).find((c) => c.id !== 'c1')!.id
  user('clip.slip', { clipId: right, delta: -5 })
  // (Source 6.5 s: inside range 1 where it plays a second time, 11–12.)
  S().setVolumeKeyframes(right, [{ time: 1.5, value: 0.2 }])
  const ans = await edit([{ op: 'timeline.cutRanges', ranges: [[6, 7], [2, 3]] }], v)
  assert.match(ans, /range 1: something you did not make was changed there after you read it/)
  const total = Object.values(S().project.clips).reduce((n, c) => n + c.duration, 0)
  assert.ok(Math.abs(total - 19) < 1e-3, `only range 2 is cut, range 1 in neither place (${total}): ${ans}`)
})

test('K1b: a piece a cut makes of one place, inside the window of a second place the user regraded, is the first place\'s: the cut applies', async () => {
  open(talk(20), 'direct')
  const v = read()
  user('clip.split', { clipIds: ['c1'], time: 10 })
  const right = Object.values(S().project.clips).find((c) => c.id !== 'c1')!.id
  user('clip.slip', { clipId: right, delta: -5 })
  S().setClipGrade(right, { brightness: 0, contrast: 0, saturation: -1, warmth: 0 })
  // (Source 4–5 plays only in the first place; what is left of it after,
  // 5–10, lies inside the second place's window, 5–15.)
  const ans = await edit([{ op: 'timeline.cutRanges', ranges: [[4, 5]] }], v)
  assert.match(ans, /^Applied/, ans)
  assert.ok(S().project.clips[right].grade, 'the regraded place keeps its grade')
})

test('P6 (K1, K1b): a waiting cut does not take a title the user retyped inside it; a B-roll the user restyled that the cut only shortens is cut, its look kept', async () => {
  const p = withBroll()
  p.captions.push({ id: 'T1', start: 10.5, end: 12, text: 'Chapter', manual: true } as never)
  open(p)
  await edit([{ op: 'timeline.cutRanges', ranges: [[9, 15]] }], read())
  user('caption.update', { id: 'T1', patch: { text: 'Chapter two: the long version I just typed' } })
  let d = currentDraft()!
  assert.equal(d.outcomes[0].applied, false)
  assert.match(d.outcomes[0].reason ?? '', new RegExp(K1))
  assert.equal(d.project.captions.find((c) => c.id === 'T1')?.text, 'Chapter two: the long version I just typed')
  // Taken back: the cut comes back.
  S().undo()
  assert.equal(currentDraft()!.outcomes[0].applied, true)
  // (K1b) The B-roll restyled: the cut only shortens it — nothing of the
  // user's is lost; what is left keeps the look.
  user('clip.setOpacity', { clipId: 'b1', opacity: 0.4 })
  d = currentDraft()!
  assert.equal(d.outcomes[0].applied, true, d.outcomes[0].reason ?? '')
  assert.deepEqual(bPieces(d.project).map((x) => [x.dur, x.opacity]), [[1, 0.4]])
  rejectDraft()
})

test('K1b: the user regrades a B-roll that a waiting cut only shortens: the cut applies, the grade stays on what remains', async () => {
  open(withBroll())
  await edit([{ op: 'timeline.cutRanges', ranges: [[10, 12]] }], read())
  const g = { brightness: 0.1, contrast: 0, saturation: -1, warmth: 0 }
  S().setClipGrade('b1', g)
  const d = currentDraft()!
  assert.equal(d.outcomes[0].applied, true, d.outcomes[0].reason ?? '')
  const pieces = Object.values(d.project.clips).filter((c) => c.assetId === 'b')
  assert.equal(pieces.reduce((n, c) => n + c.duration, 0), 4)
  assert.ok(pieces.every((c) => JSON.stringify(c.grade) === JSON.stringify(g)), 'the grade is on every piece left')
  rejectDraft()
})

test('K1b: the user changes the talk clip\'s volume: every waiting cut still applies', async () => {
  open(withBroll())
  await edit([{ op: 'timeline.cutRanges', ranges: [[2, 3], [16, 17]] }], read())
  user('clip.setVolume', { clipId: 'c1', volume: 0.6 })
  const o = currentDraft()!.outcomes[0]
  assert.equal(o.applied, true, o.reason ?? '')
  assert.equal(o.left, undefined)
  assert.ok(Object.values(currentDraft()!.project.clips).filter((c) => c.assetId === 'a1').every((c) => c.volume === 0.6))
  rejectDraft()
})

test('K1b: the user puts a volume key inside one range of a waiting cut: that range drops, the others apply', async () => {
  open(withBroll())
  await edit([{ op: 'timeline.cutRanges', ranges: [[2, 3], [16, 17]] }], read())
  S().setVolumeKeyframes('m1', [{ time: 16.5, value: 0.1 }])
  const o = currentDraft()!.outcomes[0]
  assert.equal(o.applied, true)
  assert.deepEqual(o.left, [1])
  assert.match(o.notes![0], /range 2: something you did not make was changed there after you read it \(the volumeKeyframes of clip m1\)/)
  rejectDraft()
})

test('K1b: the user splits the linked talk (the pieces linked anew, nothing else changed): a waiting cut that takes a piece whole still applies', async () => {
  const p = talk(30, true)
  const a1 = p.tracks.find((t) => t.kind === 'audio')!
  p.clips.c1.linkId = 'k'
  p.clips.ca = clipOf('ca', 'a1', a1.id, 0, 0, 30, { linkId: 'k' })
  a1.clipIds = ['ca']
  open(p)
  await edit([{ op: 'timeline.cutRanges', ranges: [[11, 15]] }], read())
  user('clip.split', { clipIds: ['c1'], time: 12, linkAV: true })
  const right = Object.values(S().project.clips).find((c) => c.trackId !== a1.id && c.start > 11)!.id
  user('clip.split', { clipIds: [right], time: 14, linkAV: true })
  const o = currentDraft()!.outcomes[0]
  assert.equal(o.applied, true, o.reason ?? '')
  assert.equal(o.left, undefined, String(o.notes))
  const v = Object.values(currentDraft()!.project.clips).filter((c) => c.trackId !== a1.id)
  assert.ok(Math.abs(v.reduce((n, c) => n + c.duration, 0) - 26) < 1e-3, 'the four seconds are gone')
  assert.equal(v.length, 2, 'the middle piece went whole')
  assert.ok(v.every((c) => !!c.linkId), 'every piece is still linked')
  rejectDraft()
})

// ---- K1b, branch by branch (lostChange on its own) ----------------------------

test('K1b branches: gone whole, the very field written, keys or an edge in what goes, words that go; shortened alone loses nothing', () => {
  const ctx = { own: new Map<string, unknown>(), userChangedSince: () => true }
  const base = withBroll()
  base.captions = base.captions.filter((c) => c.id === 'L2')
  base.markers = [{ id: 'mk', time: 5, color: '#fff', note: 'n' }]
  const seen = structuredClone(base)
  const set = (p: Project, f: (q: Project) => void): Project => {
    const q = structuredClone(p)
    f(q)
    return q
  }
  const user = set(base, (q) => {
    q.clips.b1.opacity = 0.5
    q.clips.b1.fadeIn = 0.5
    q.clips.b1.volumeKeyframes = [{ id: 'v', time: 4.5, value: 0.2 }]
    q.markers![0].note = 'mine'
    const l = q.captions[0]
    l.words = l.words!.map((w, i) => (i === 0 ? { ...w, text: 'WE' } : w))
    l.text = l.words.map((w) => w.text).join(' ')
    l.marks = [2]
  })
  const lost = (after: (q: Project) => void): string | null => lostChange(user, set(user, after), seen, ctx as never)
  // (a) gone whole
  assert.match(lost((q) => { delete q.clips.b1; q.tracks[0].clipIds = [] }) ?? '', /of clip b1/)
  assert.match(lost((q) => { q.markers = [] }) ?? '', /of marker mk/)
  assert.match(lost((q) => { q.captions = [] }) ?? '', /of line L2/)
  // (b) the very field written over
  assert.match(lost((q) => { q.clips.b1.opacity = 1 }) ?? '', /the opacity of clip b1/)
  assert.match(lost((q) => { q.markers![0].note = 'other' }) ?? '', /the note of marker mk/)
  // shortened at the tail, keys and head kept: nothing lost
  assert.equal(lost((q) => { q.clips.b1.duration = 5.5 }), null)
  // (c) the key in what goes (source 4.5 of the B-roll)
  assert.match(lost((q) => { q.clips.b1.duration = 4 }) ?? '', /the volumeKeyframes of clip b1/)
  // (c) the head goes: its fade with it
  assert.match(lost((q) => { const c = q.clips.b1; c.start += 0.5; c.inPoint += 0.5; c.duration -= 0.5; c.volumeKeyframes = [{ id: 'v', time: 4, value: 0.2 }] }) ?? '', /the fadeIn of clip b1/)
  // (c) a line: the retyped word goes / another word goes / a marked word goes
  const words = (keep: number[]) => (q: Project): void => {
    const l = q.captions[0]
    l.words = l.words!.filter((_, i) => keep.includes(i))
    l.text = l.words.map((w) => w.text).join(' ')
    l.marks = l.marks?.map((i) => keep.indexOf(i)).filter((i) => i >= 0)
  }
  const n = user.captions[0].words!.length
  assert.match(lost(words([...Array(n).keys()].filter((i) => i !== 0))) ?? '', /of line L2/)
  assert.equal(lost(words([...Array(n).keys()].filter((i) => i !== 1))), null)
  assert.match(lost(words([...Array(n).keys()].filter((i) => i !== 2))) ?? '', /the marks of line L2/)
  // (b) a line: the very field written over (its place), no word gone
  const placed = set(user, (q) => {
    q.captions[0].place = 'left'
  })
  assert.match(lostChange(placed, set(placed, (q) => { q.captions[0].place = 'right' }), seen, ctx as never) ?? '', /the place of line L2/)
  // (b) a line that lost a word, its marks written over: the marked word
  // stays, its mark gone (marks follow their words through the cut)
  assert.match(lost((q) => { words([...Array(n).keys()].filter((i) => i !== 1))(q); q.captions[0].marks = [] }) ?? '', /the marks of line L2/)
  // (c) a text of its own (not its words joined) is rebuilt by the cut
  const typed = set(base, (q) => {
    q.captions[0].text = q.captions[0].text + ' (sic)'
  })
  assert.match(lostChange(typed, set(typed, words([...Array(n).keys()].filter((i) => i !== 1))), seen, ctx as never) ?? '', /the text of line L2/)
  // (a) a still: the piece of that id deleted, another piece of it left
  const still = set(base, (q) => {
    q.assets.push({ ...videoAsset('pic', 0), kind: 'image', hasAudio: false } as Asset)
    q.clips.s1 = clipOf('s1', 'pic', 'V2', 20, 0, 3)
    q.clips.s2 = { ...clipOf('s2', 'pic', 'V2', 23, 3, 3), instance: 's1' } as never
    q.tracks[0].clipIds.push('s1', 's2')
  })
  const seenS = structuredClone(still)
  const graded = set(still, (q) => {
    q.clips.s1.grade = { brightness: 0, contrast: 0, saturation: -1, warmth: 0 }
  })
  assert.match(lostChange(graded, set(graded, (q) => { delete q.clips.s1 }), seenS, ctx as never) ?? '', /the grade of clip s1/)
})

test('P7 (K7): "at the film start" is dropped when the user takes the start away — after the first run too', async () => {
  open(talk(20, true))
  await edit([{ op: 'text.add', time: 1, text: 'Over hello' }, { op: 'text.add', time: 0, text: 'Opening' }], read())
  assert.equal(outcomes()[1].applied, true)
  S().rippleDeleteMany([[0, 3]])
  const o = outcomes()
  assert.equal(o[1].applied, false)
  assert.match(o[1].reason, /start of the footage was changed after you read it \(not by you\)/)
  assert.ok(!currentDraft()!.project.captions.some((c) => c.text === 'Opening'))
  rejectDraft()
  // The session's own cut of the start does not take the place away.
  open(talk(20, true))
  await edit([{ op: 'timeline.cutRanges', ranges: [[0, 3]] }, { op: 'text.add', time: 0, text: 'Opening' }], read())
  assert.equal(outcomes()[1].applied, true)
  rejectDraft()
})

test('P8 (K5): a voice-over on an audio track under stock videos with silent sound is the anchor', async () => {
  const p = defaultProject()
  const [v1, a1] = p.tracks
  p.assets = [{ ...videoAsset('vo', 30), kind: 'audio' } as Asset, videoAsset('s1', 10), videoAsset('s2', 10), videoAsset('s3', 10)]
  p.clips = { vo: clipOf('vo', 'vo', a1.id, 0, 0, 30), k1: clipOf('k1', 's1', v1.id, 0, 0, 10, { volume: 0 }), k2: clipOf('k2', 's2', v1.id, 10, 0, 10, { muted: true }), k3: clipOf('k3', 's3', v1.id, 20, 0, 10, { volume: 0 }) }
  v1.clipIds = ['k1', 'k2', 'k3']
  a1.clipIds = ['vo']
  open(p)
  assert.equal(anchorTrack(S().project), a1.id)
  await edit([{ op: 'timeline.cutRanges', ranges: [[12, 13]] }, { op: 'text.add', time: 14, text: 'At 14' }], read())
  // The user swaps two stock shots; the voice is untouched. The title over
  // the voice stays (a silent picture is no sound under it); the cut stays
  // out only because another picture lies in its range now (A1).
  user('clip.move', { clipId: 'k2', start: 40 })
  user('clip.move', { clipId: 'k3', start: 10 })
  user('clip.move', { clipId: 'k2', start: 20 })
  const o = outcomes()
  assert.equal(o[1].applied, true, o[1].reason)
  assert.equal(o[0].applied, false)
  assert.match(o[0].reason, /clip k3 lies in it now/)
  assert.doesNotMatch(o[0].reason, /clip vo/)
  rejectDraft()
  // Undone: both back.
  S().undo()
  S().undo()
  S().undo()
  open(S().project)
  await edit([{ op: 'timeline.cutRanges', ranges: [[12, 13]] }, { op: 'text.add', time: 14, text: 'At 14' }], read())
  user('clip.setVolume', { clipId: 'k1', volume: 0.5 })
  assert.deepEqual(outcomes().map((x) => x.applied), [true, true], 'a volume of a picture outside both: nothing falls')
  rejectDraft()
})

test('P12 (K1): deleting an empty placeholder does not delete the picture the user put in it', async () => {
  const p = withBroll()
  p.assets.push({ ...videoAsset('pic', 0), kind: 'image', hasAudio: false } as Asset)
  p.tracks.unshift({ id: 'AUTO', kind: 'video', name: 'AUTO', clipIds: ['ph1'] })
  p.clips.ph1 = { ...clipOf('ph1', '', 'AUTO', 2, 0, 3), volume: 0, automationMissing: { number: 1, text: 'slot', captionIds: [] } } as never
  open(p)
  await edit([{ op: 'clip.delete', ids: ['ph1'] }], read())
  assert.ok(S().fillAutomationMissingImage('ph1', S().project.assets.find((a) => a.id === 'pic')!))
  assert.equal(outcomes()[0].applied, false)
  assert.equal(currentDraft()!.project.clips.ph1?.assetId, 'pic')
  rejectDraft()
})

test('P18 (K6): a move of a clip to a word, after the agent\'s own cut in the same call, is made', async () => {
  open(withBroll())
  await edit([{ op: 'timeline.cutRanges', ranges: [[3, 5]] }, { op: 'clip.move', clipId: 'b1', start: 'L2#0' }], read())
  const o = outcomes()
  assert.deepEqual(o.map((x) => x.applied), [true, true], JSON.stringify(o))
  const d = currentDraft()!.project
  const word = d.captions.find((c) => c.id === 'L2')!.words![0]
  assert.ok(Math.abs(d.clips.b1.start - word.start) < 1e-6)
  rejectDraft()
  // The clip named was cut in pieces by the same call: not made, and said why.
  open(withBroll())
  await edit([{ op: 'timeline.cutRanges', ranges: [[10, 11]] }, { op: 'clip.move', clipId: 'b1', start: 'L2#0' }], read())
  const o2 = outcomes()
  assert.equal(o2[1].applied, false)
  assert.match(o2[1].reason, /only while every clip it names lies whole/)
  rejectDraft()
})

// ---- K1: what the session made, the user changed since; a draft op dropped ----

test('K1: a title the agent made and the user retyped since is not deleted by the agent', async () => {
  open(talk(20, true), 'direct')
  await edit([{ op: 'text.add', time: 2, text: 'Mine' }], read())
  const id = S().project.captions.find((c) => c.text === 'Mine')!.id
  const v = read()
  user('caption.update', { id, patch: { text: 'Mine, retyped by the user' } })
  const ans = await edit([{ op: 'caption.delete', ids: [id] }], v)
  assert.match(ans, new RegExp(K1))
  assert.ok(S().project.captions.some((c) => c.id === id))
})

test('K1: an op written on a draft is not dropped because an op of that draft that set a field was dropped since (the value is the live one again)', async () => {
  const p = defaultProject()
  const [v1, a1] = p.tracks
  p.assets = [{ ...videoAsset('vo', 30), kind: 'audio' } as Asset, { ...videoAsset('pic', 0), kind: 'image', hasAudio: false } as Asset]
  p.clips = { vo: clipOf('vo', 'vo', a1.id, 0, 0, 30), i0: clipOf('i0', 'pic', v1.id, 0, 0, 10) }
  v1.clipIds = ['i0']
  a1.clipIds = ['vo']
  open(p)
  await edit([{ op: 'clip.setMuted', clipId: 'i0', muted: true }], read())
  await edit([{ op: 'timeline.cutRanges', ranges: [[6, 7]] }], read())
  // The user cuts the still in two: the mute (of a still that moved) drops; the cut stays.
  S().rippleDeleteMany([[2, 3]])
  const o = outcomes()
  assert.equal(o[0].applied, false)
  assert.equal(o[1].applied, true, o[1].reason)
  rejectDraft()
})

// ---- T: the tool texts -------------------------------------------------------

test('T1: broll.place is written out in the edit tool with its real fields', () => {
  const ed = agentTools().find((t) => t.name === 'edit')!.description
  assert.match(ed, /broll\.place\{placements:\[\{assetId,start:t,end:t\}\],look:card\|full\}/)
  assert.doesNotMatch(ed, /broll\.place\{…\}/)
})

test('T2 / T8 / T9: "New:" names the op, where each new thing lies, past the end, and a twin', async () => {
  open(withBroll(), 'direct')
  const v = read()
  const a = await edit([{ op: 'clip.add', assetId: 'spare', trackId: 'V2', start: 20 }, { op: 'marker.add', time: 70, note: 'far' }], v)
  assert.match(a, /New: [^\n]*\(#1 V2 20\.00–40\.00\)/)
  assert.match(a, /\(#2 marker 70\.00, past the end, 30\.00\)/)
  const first = S().project.markers!.find((m) => m.note === 'far')!.id
  const b = await edit([{ op: 'marker.add', time: 70, note: 'far' }], v)
  assert.match(b, new RegExp(`same as ${first} your previous call made`))
})

test('T3: a second op that moves what is there, in the same call, is told to come in a call of its own', async () => {
  open(withBroll())
  await edit([{ op: 'clip.move', clipId: 'b1', start: 20 }, { op: 'clip.move', clipId: 'm1', start: 2 }], read())
  const o = outcomes()
  assert.equal(o[0].applied, true)
  assert.equal(o[1].applied, false)
  assert.match(o[1].reason, /#1 clip\.move of this call/)
  assert.match(o[1].reason, /send it in a call of its own/)
  rejectDraft()
  const ed = agentTools().find((t) => t.name === 'edit')!.description
  assert.match(ed, /One op that moves or retimes what is there per call/)
})

test('T4: 700 ranges are refused with "the same base"; followed to the letter, the right footage goes', async () => {
  open(talk(60), 'direct')
  const v = read()
  const ranges = Array.from({ length: 700 }, (_, i): [number, number] => [+(0.1 + i * 0.08).toFixed(3), +(0.13 + i * 0.08).toFixed(3)])
  const no = await edit([{ op: 'timeline.cutRanges', ranges }], v).catch((e: Error) => e.message)
  assert.match(String(no), /send the rest in a next call with the same base/)
  await edit([{ op: 'timeline.cutRanges', ranges: ranges.slice(0, 600) }], v)
  await edit([{ op: 'timeline.cutRanges', ranges: ranges.slice(600) }], v)
  const left = kept(S().project)
  const cut = (m: number): boolean => !left.some(([a, b]) => m > a + 1e-6 && m < b - 1e-6)
  assert.ok(ranges.every(([a, b]) => cut((a + b) / 2)), 'every range meant is gone')
  assert.ok(ranges.slice(0, -1).every(([, b], i) => !cut((b + ranges[i + 1][0]) / 2)), 'nothing between them is')
})

test('T5: the draft news name the call and the op, ids as they are', async () => {
  open(talk(20, true))
  await edit([{ op: 'marker.add', time: 3, note: 'a' }, { op: 'text.add', time: 6.5, text: 'Go' }], read())
  takeNews('s1')
  S().rippleDeleteMany([[6, 7]])
  currentDraft()
  const news = takeNews('s1').join('\n')
  assert.match(news, /dropped call #1 op #2 text\.add: /)
  rejectDraft()
})

test("T6: a marker on a word the agent's own op cut says so: place it on the take that stays", async () => {
  open(talk(20, true))
  await edit([{ op: 'timeline.cutRanges', ranges: [[3, 5]] }, { op: 'marker.add', time: 4, note: 'on a cut word' }], read())
  const o = outcomes()
  assert.equal(o[1].applied, false)
  assert.match(o[1].reason, /cut by your own op #1 \(timeline\.cutRanges\): place it on the take that stays/)
  rejectDraft()
})

test('T7: accepting a call without the call its op was written on says which, and to resend', async () => {
  open(talk(20, true))
  await edit([{ op: 'text.add', time: 2, text: 'One' }], read())
  const id = currentDraft()!.project.captions.find((c) => c.text === 'One')!.id
  await edit([{ op: 'caption.update', id, patch: { text: 'One, better' } }], read())
  const plan = acceptPreview([2])
  const row = plan.drop.find((x) => x.seq === 2 && x.index === 0)
  assert.ok(row, JSON.stringify(plan.drop))
  assert.match(row.reason, /^call #1, which it was written on, was not accepted: resend if still wanted/)
  rejectDraft()
})

test('T10: the preflight answer is a list of facts; nothing in it is framed as a fault found before export', async () => {
  const p = talk(20)
  const r = await analyze(p, { kind: 'preflight' }, 'r1', 'v-1', { cancelled: () => false }, { loudness: async () => null })
  const text = resultText(r, p)
  assert.doesNotMatch(text, /before export|found|problem|issue|wrong/i, text)
})

test('K1: a cut that ends a hair before a clip ends (the command layer K-3) leaves no sliver, and nothing of that content is "made by the session"', async () => {
  const p = talk(20)
  p.clips.c1 = { ...p.clips.c1, duration: 20.000000001 }
  open(p, 'direct')
  const r = directCalls('test', [{ name: 'timeline.cutRanges', params: { ranges: [[15, 20]] } }])
  assert.equal(r.applied, true)
  // (Before phase Ç2b.1 the command left a 1e-9 s piece; the sliver now joins the cut.)
  assert.ok(Object.values(S().project.clips).every((c) => c.duration >= 0.002), 'no sliver is left')
  assert.equal(contextFor('s1', 'test').own.has('k1 made|c1'), false)
  // A piece of 0.01 s is footage (over the 2 ms rule): it stays, and still
  // does not make its whole content the session's.
  const q = talk(20)
  q.clips.c1 = { ...q.clips.c1, duration: 20.01 }
  open(q, 'direct')
  assert.equal(directCalls('test', [{ name: 'timeline.cutRanges', params: { ranges: [[15, 20]] } }]).applied, true)
  assert.ok(Object.values(S().project.clips).some((c) => c.duration < 0.02), 'the command left the 0.01 s piece')
  assert.equal(contextFor('s1', 'test').own.has('k1 made|c1'), false)
  // (No piece that thin is left any more, phase Ç2b.1 K-3: the same rule seen
  // through a clip slipped clear of every second it showed before — nothing
  // of it overlaps the content as it was, and it is still not "made".)
  const s = talk(10)
  open(s, 'direct')
  assert.equal(directCalls('test', [{ name: 'clip.slip', params: { clipId: 'c1', delta: 30 } }]).applied, true)
  assert.equal(S().project.clips.c1.inPoint, 30)
  assert.equal(contextFor('s1', 'test').own.has('k1 made|c1'), false)
})

test("P13 (A1 / drafts#1, N49): a piece the session's own cut split off the user's B-roll, moved by the user into an older cut's range, is not taken by it", async () => {
  open(withBroll(), 'direct')
  const v = read()
  await edit([{ op: 'timeline.cutRanges', ranges: [[9, 10]] }], read())
  const piece = Object.values(S().project.clips).find((c) => c.assetId === 'b' && c.id !== 'b1')!
  user('clip.move', { clipId: piece.id, start: 20 })
  const before = S().project.clips[piece.id].duration
  await edit([{ op: 'timeline.cutRanges', ranges: [[21, 23]] }], v)
  assert.ok(S().project.clips[piece.id], 'the piece is there')
  assert.equal(S().project.clips[piece.id].duration, before, 'and whole')
})

test("A1 / drafts#1 (N49): sound the user laid after the read, that the session's own cut split, is not the session's: a stale title over it is not placed", async () => {
  const p = talk(20, true)
  p.assets.push({ ...videoAsset('mus', 60), kind: 'audio' } as Asset)
  open(p, 'direct')
  const v = read()
  const a1 = S().project.tracks.find((t) => t.kind === 'audio')!.id
  user('clip.add', { assetId: 'mus', trackId: a1, start: 5 })
  await edit([{ op: 'timeline.cutRanges', ranges: [[8, 9]] }], read())
  assert.equal(Object.values(S().project.clips).filter((c) => c.assetId === 'mus').length, 2, "the session's cut split the user's music")
  const ans = await edit([{ op: 'text.add', time: 10, text: 'Stale' }], v)
  assert.match(ans, /Nothing applied/)
  assert.match(ans, /lies under it now and did not \(there\) when you read it/)
})
