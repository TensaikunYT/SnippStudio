// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// SnippStudio phase 4A.9 (FAZ4A-YENIDEN.md A4–A5): accepting a draft is the
// same replay on the live project — all of it, some of it, or all but one
// range of a cut — as ONE undo step. What the user did while it waited stays
// (notes, locks, the name: they are the live project's); what is not
// accepted stays as the draft; the user accepts what they were shown. And
// (4A.8 F, unchanged) "şey" is a word, not a filler.
import './dom-stub'
import assert from 'node:assert/strict'
import test from 'node:test'
import { useStore } from '../renderer/src/state/store'
import type { Asset, Clip, Project } from '../renderer/src/types'
import { acceptDraft, acceptPreview, currentDraft, draftState, rejectDraft, removeRange, reviveOp, takeNews, watchLive } from '../renderer/src/agent/drafts'
import { editTool } from '../renderer/src/agent/edit'
import { useAgentStore } from '../renderer/src/agent/store'
import { addNote, setNoteStatus } from '../renderer/src/notes/model'
import { FILLER_DEFAULT, FILLER_DEFAULT_EN, fillerHits, fillerLanguage, fillerSet, isFillerSound } from '../renderer/src/analysis/fillers'
import { flattenWords } from '../renderer/src/analysis/words'
import { speechContrast, speechTrack } from '../renderer/src/analysis/voice'
import { analyze, chosenItems } from '../renderer/src/agent/analyze'
import { fillerLine, resultText } from '../renderer/src/agent/answers'
import { voiceClipIds } from '../renderer/src/subtitles/follow'
import { clipOf, ctxOf, draftCalls, kept, open, read, talk } from './agent-kit'
import { carryRange } from '../renderer/src/agent/content'

const S = useStore.getState
const unwatch = watchLive()
test.after(() => unwatch())

const long = (): Project => talk(30)
const fresh = (p: Project): void => open(p)
const cutOp = (...ranges: [number, number][]) => ({ name: 'timeline.cutRanges', params: { ranges } })

// ---- V-accept-ids-6, D1: a note's touched ranges, named in the draft's seconds ----

test('V-accept-ids-6: touched ranges named while the draft waits are the draft\'s seconds: carried to the live timeline, moved by the accept once', () => {
  const p = long()
  addNote(p, { start: 20, end: 21, kind: 'free', text: 'fix this' }, new Date())
  fresh(p)
  const id = S().project.notes![0].id
  draftCalls('s1', 'test', [cutOp([2, 4])])
  const draft = currentDraft()!.project
  // The agent reads its draft: the material of the note is at 18-19 there.
  assert.ok(Math.abs(draft.notes![0].start - 18) < 1e-6)
  const carried = carryRange(draft, S().project, [18, 19])
  assert.ok(carried && Math.abs(carried[0] - 20) < 1e-6 && Math.abs(carried[1] - 21) < 1e-6, `on the live timeline that is 20-21 (${String(carried)})`)
  S().editNotes((d) => void setNoteStatus(d, id, 'ready', { reply: 'done', touched: [carried!] }), false)
  acceptDraft(undefined, 'now')
  const note = S().project.notes!.find((n) => n.id === id)!
  assert.ok(Math.abs(note.start - 18) < 1e-6)
  assert.deepEqual(note.touched!.map(([a, b]) => [Math.round(a * 100) / 100, Math.round(b * 100) / 100]), [[18, 19]], 'with the note, not 2 s before it')
  // A range on what the draft cut away of its own, or past the footage: not placed.
  fresh(long())
  draftCalls('s1', 'test', [cutOp([2, 4])])
  assert.equal(carryRange(currentDraft()!.project, S().project, [40, 41]), null)
  // A range across the draft's cut: the live range that holds both ends.
  const across = carryRange(currentDraft()!.project, S().project, [1, 3])
  assert.ok(across && Math.abs(across[0] - 1) < 1e-6 && Math.abs(across[1] - 5) < 1e-6)
  rejectDraft()
})

// ---- V-accept-ids-1, -2, -5: what an entry makes is found again ---------------------

test('V-accept-ids-1 / -2: b-roll placed and then set, a cut before a note: plain Accept all applies everything, and the note follows the cut', () => {
  const p = long()
  p.assets.push({ id: 'i1', kind: 'image', name: 'one.png', url: 'media://i1', size: 1, duration: 0, width: 800, height: 600, hasAudio: false } as Asset, { id: 'i2', kind: 'image', name: 'two.png', url: 'media://i2', size: 1, duration: 0, width: 800, height: 600, hasAudio: false } as Asset)
  addNote(p, { start: 20, end: 21, kind: 'free', text: 'a note' }, new Date())
  fresh(p)
  draftCalls('s1', 'test', [cutOp([2, 4])])
  const placed = draftCalls('s1', 'test', [{ name: 'broll.place', params: { placements: [{ assetId: 'i1', start: 5, end: 7 }, { assetId: 'i2', start: 9, end: 11 }], look: 'card' } }])
  const made = (placed.outcomes[0].result as { clipIds: string[] }).clipIds
  assert.equal(made.length, 2)
  // A later call on one of the clips it made (read from the draft).
  draftCalls('s1', 'test', [{ name: 'clip.setOpacity', params: { clipId: made[0], opacity: 0.5 } }])
  // The user adds a marker far from all of it: the draft is replayed on the
  // live project at the accept (phase 4A.10, table#7: with no user change
  // nothing was replayed, and ids made again per replay went unseen).
  const was = currentDraft()!.project
  S().runBatch([{ name: 'marker.add', params: { time: 27, note: 'user' } }])
  const plan = acceptPreview()
  assert.notEqual(plan.project, was, 'the draft was replayed on the live project with the marker')
  assert.ok(plan.project.markers?.some((m) => m.note === 'user'))
  assert.deepEqual(plan.drop, [], 'nothing dropped: the user only added a marker far away')
  assert.equal(plan.all, true)
  const out = acceptDraft(undefined, 'now')
  assert.deepEqual(out.dropped, [])
  const live = S().project
  assert.equal(live.clips[made[0]]?.opacity, 0.5, 'the b-roll clip has the id the agent was given, and its setting')
  assert.ok(live.clips[made[1]])
  assert.ok(Math.abs(live.notes![0].start - 18) < 1e-6, `the note followed the 2 s cut before it (${live.notes![0].start})`)
  assert.equal(draftState(), null, 'accepted whole')
})

test('V-accept-ids-5: a track the agent adds and uses stays its own when the user adds a track meanwhile; so does its title when the user adds one near it', () => {
  const p = long()
  p.assets.push({ id: 'i1', kind: 'image', name: 'one.png', url: 'media://i1', size: 1, duration: 0, width: 800, height: 600, hasAudio: false } as Asset)
  fresh(p)
  const added = draftCalls('s1', 'test', [{ name: 'track.add', params: { kind: 'video' } }])
  const track = (added.outcomes[0].result as { id?: string; trackId?: string })
  const trackId = track.id ?? track.trackId ?? currentDraft()!.project.tracks.find((t) => !S().project.tracks.some((x) => x.id === t.id))!.id
  draftCalls('s1', 'test', [{ name: 'clip.add', params: { assetId: 'i1', trackId, start: 12 } }])
  draftCalls('s1', 'test', [{ name: 'text.add', params: { time: 10, text: 'Agent', id: 'agenttitle01' } }])
  draftCalls('s1', 'test', [{ name: 'caption.update', params: { id: 'agenttitle01', patch: { text: 'Agent!' } } }])
  // The user adds a video track and a title of their own near the agent's.
  S().runBatch([{ name: 'track.add', params: { kind: 'video' } }])
  S().runBatch([{ name: 'text.add', params: { time: 9.5, text: 'Mine' } }])
  const plan = acceptPreview()
  const structural = plan.drop.filter((x) => !/depends on how everything lies/.test(x.reason ?? ''))
  assert.deepEqual(structural, [], `no drop with a false reason: ${JSON.stringify(plan.drop)}`)
  const d = currentDraft()!.project
  assert.equal(d.captions.find((c) => c.id === 'agenttitle01')?.text, 'Agent!', 'the agent\'s title kept its id; its later change is on it')
  assert.ok(d.captions.some((c) => c.text === 'Mine'))
  assert.ok(d.tracks.some((t) => t.id === trackId), 'the agent\'s track is there under its id')
  rejectDraft()
})

// ---- D1: what the user did while it waited --------------------------------------

test('D1: accept keeps the notes, note answers, track locks and name the user and the agent wrote while the draft waited; notes follow the cut', () => {
  const p = long()
  addNote(p, { start: 20, end: 21, kind: 'free', text: 'old note' }, new Date())
  fresh(p)
  const oldNote = S().project.notes![0].id
  draftCalls('s1', 'test', [cutOp([2, 4])])
  S().editNotes((d) => void setNoteStatus(d, oldNote, 'ready', { reply: 'done it' }), false)
  S().editNotes((d) => void addNote(d, { start: 25, end: 26, kind: 'free', text: 'new note' }, new Date()))
  const audio = S().project.tracks.find((t) => t.kind === 'audio')!.id
  S().setTrackFlags(audio, { locked: true })
  S().setProjectName('Renamed')
  const seq = S().project.noteSeq
  const past = S().past.length
  acceptDraft(undefined, 'now')
  const live = S().project
  assert.equal(S().past.length, past + 1, 'one undo step')
  assert.equal(live.name, 'Renamed')
  assert.equal(live.tracks.find((t) => t.id === audio)!.locked, true, 'the lock stays')
  assert.equal(live.notes?.find((n) => n.id === oldNote)?.status, 'ready', 'the agent\'s answer stays')
  assert.equal(live.notes?.find((n) => n.id === oldNote)?.reply, 'done it')
  const added = live.notes?.find((n) => n.text === 'new note')
  assert.ok(added, 'the user\'s new note stays')
  assert.equal(live.noteSeq, seq)
  assert.ok(Math.abs(added!.start - 23) < 0.01, `the cut before it moved the note with the picture (at ${added!.start})`)
  assert.ok(Math.abs(live.notes!.find((n) => n.id === oldNote)!.start - 18) < 0.01)
  assert.equal(Object.values(live.clips).length, 2, 'the cut is there')
  assert.equal(draftState(), null)
})

test('D1/D8: a track locked while the draft waits: the draft is replayed with the lock (its cut leaves that track alone)', () => {
  const p = long()
  const a1 = p.tracks.find((t) => t.kind === 'audio')!
  p.assets.push({ id: 'm1', kind: 'audio', name: 'music.wav', url: 'media://m', size: 1, duration: 60, hasAudio: true } as Asset)
  p.clips.m1 = clipOf('m1', 'm1', a1.id, 10, 0, 20)
  a1.clipIds = ['m1']
  fresh(p)
  draftCalls('s1', 'test', [cutOp([12, 14])])
  assert.equal(Object.values(currentDraft()!.project.clips).filter((c) => c.assetId === 'm1').length, 2, 'the music was cut too')
  S().setTrackFlags(a1.id, { locked: true })
  const d = currentDraft()!
  assert.deepEqual(Object.values(d.project.clips).filter((c) => c.assetId === 'm1').map((c) => [c.start, c.duration]), [[10, 20]], 'the locked music is as it was')
  assert.equal(d.outcomes[0].applied, true)
  acceptDraft(undefined, 'now')
  assert.equal(S().project.clips.m1.duration, 20)
  assert.deepEqual(kept(S().project), [[0, 12], [14, 30]])
})

// ---- D4: an id names content -----------------------------------------------------

test('D4: after the user\'s cut a setting still lands on the piece it was sent for (the same file twice on a track)', async () => {
  const p = long()
  const v1 = p.tracks[0]
  p.clips = { c1: clipOf('c1', 'a1', v1.id, 0, 0, 10), c2: clipOf('c2', 'a1', v1.id, 10, 0, 10) }
  v1.clipIds = ['c1', 'c2']
  fresh(p)
  draftCalls('s1', 'test', [cutOp([3, 4], [13, 14])])
  const piece = Object.values(currentDraft()!.project.clips).find((c) => c.instance === 'c2')!
  await editTool({ ops: [{ op: 'clip.setOpacity', clipId: piece.id, opacity: 0 }], base: read() }, ctxOf())
  // The user cuts the second range's footage away (and more): only c1's cut is left to make.
  S().rippleDeleteMany([[12.5, 14.5]])
  const d = currentDraft()!
  const hidden = Object.values(d.project.clips).filter((c) => c.opacity === 0)
  assert.equal(hidden.length, 1)
  assert.equal(hidden[0].instance, 'c2', 'the piece of the SECOND clip')
  assert.ok(hidden[0].inPoint >= 4.5 - 1e-6, 'what is left of the footage it was sent for')
  assert.ok(Object.values(d.project.clips).filter((c) => (c.instance ?? c.id) === 'c1').every((c) => (c.opacity ?? 1) === 1), 'no piece of the first')
  rejectDraft()
})

// ---- D5: choosing ------------------------------------------------------------------

test('D5: a selection is a set; a partial accept says what it drops, leaves the rest as the draft; nothing left → nothing adopted', async () => {
  fresh(long())
  draftCalls('s1', 'test', [{ name: 'text.add', params: { time: 5, text: 'Title', id: 't1' } }])
  draftCalls('s1', 'test', [{ name: 'caption.update', params: { id: 't1', patch: { text: 'Styled' } } }])
  draftCalls('s1', 'test', [cutOp([20, 21])])
  assert.throws(() => acceptPreview([1, 99]), /The draft has no call #99/)
  // #2 leans on #1's title: alone, it has nothing to write to.
  const plan = acceptPreview([2, 2])
  assert.deepEqual(plan.apply, [])
  assert.match(plan.drop.find((x) => x.seq === 2)!.reason, /there is no t1 any more|no subtitle line or title/)
  assert.equal(plan.drop.filter((x) => x.reason === 'not selected').length, 2)
  const v = S().projectVersion
  const none = acceptDraft([2], 'now')
  assert.equal(none.version, null)
  assert.equal(S().projectVersion, v, 'nothing adopted')
  assert.equal(draftState()!.entries.length, 3, 'the draft still waits')
  assert.equal(useAgentStore.getState().outcome?.kind, 'nothing')
  // #1 and #3: one step; #2 stays as the draft, on the live project as it is now.
  const past = S().past.length
  const some = acceptDraft([3, 1, 1], 'now')
  assert.deepEqual(some.applied, ['1:0', '3:0'])
  assert.equal(S().past.length, past + 1)
  assert.equal(useAgentStore.getState().outcome?.kind, 'partial')
  const d = currentDraft()!
  assert.deepEqual(d.entries.map((e) => e.seq), [2])
  assert.equal(d.outcomes[0].applied, true, 'its title is in the live project now')
  assert.equal(d.project.captions.find((c) => c.id === 't1')?.text, 'Styled')
  assert.match(takeNews('s1').join('\n'), /the user accepted calls #1, #3.*#2 still waits/)
  acceptDraft(undefined, 'now')
  assert.equal(S().project.captions.find((c) => c.id === 't1')?.text, 'Styled')
  assert.equal(draftState(), null)
  assert.equal(useAgentStore.getState().outcome?.kind, 'accepted')
})

test('S12: the user accepts what they saw: when the project or the outcome changed since the card, nothing is adopted', () => {
  fresh(long())
  draftCalls('s1', 'test', [cutOp([10, 12]), { name: 'marker.add', params: { time: 20, note: 'm' } }])
  const card = acceptPreview()
  assert.equal(card.all, true)
  // The user's last drag lands after the card was drawn: the cut's footage is gone.
  S().rippleDeleteMany([[9, 13]])
  const v = S().projectVersion
  const r = acceptDraft(undefined, card.shown)
  assert.equal(r.changed, true)
  assert.equal(r.version, null)
  assert.equal(S().projectVersion, v)
  assert.equal(useAgentStore.getState().outcome?.kind, 'changed')
  // The card again, then what it shows.
  const again = acceptPreview()
  assert.equal(again.drop.length, 1)
  assert.equal(acceptDraft(undefined, again.shown).version, S().projectVersion)
  assert.equal(S().project.markers?.[0].note, 'm')
})

test('A5: one range taken out of a cut: the others stay; what leaned on nothing of it is untouched', () => {
  fresh(long())
  draftCalls('s1', 'test', [cutOp([5, 6], [10, 12], [20, 21]), { name: 'marker.add', params: { time: 15, note: 'm' } }])
  assert.equal(removeRange(1, 1, 0), false, 'a marker has no ranges')
  assert.equal(removeRange(1, 0, 1), true)
  const d = currentDraft()!
  assert.deepEqual(kept(d.project), [[0, 5], [6, 20], [21, 30]])
  assert.ok(Math.abs(d.project.markers![0].time - 14) < 1e-6, 'the marker is on source 15')
  acceptDraft(undefined, 'now')
  assert.deepEqual(kept(S().project), [[0, 5], [6, 20], [21, 30]])
})

test('B11: a drop the agent was told of does not come back by itself once it sent a later edit; the user can bring it back', async () => {
  fresh(talk(20, true))
  const v0 = read()
  await editTool({ ops: [{ op: 'text.add', time: 6.5, text: 'Go', id: 'g1' }, { op: 'marker.add', time: 15, note: 'm' }], base: v0 }, ctxOf())
  S().rippleDeleteMany([[6, 7]])
  assert.equal(currentDraft()!.outcomes[0].applied, false)
  assert.match(takeNews('s1').join('\n'), /dropped call #1 op #\d+ text\.add: content was removed/)
  // Not told again on the next replay.
  S().runBatch([{ name: 'marker.add', params: { time: 1 } }])
  currentDraft()
  assert.equal(takeNews('s1').filter((n) => n.startsWith('dropped')).length, 0)
  // The agent sends the title again elsewhere; then the user takes the cut back.
  await editTool({ ops: [{ op: 'text.add', time: 8.5, text: 'Go', id: 'g2' }], base: read() }, ctxOf())
  S().undo()
  S().undo()
  const d = currentDraft()!
  assert.equal(d.project.captions.filter((c) => c.text === 'Go').length, 1, 'not two titles')
  assert.match(d.outcomes[0].reason!, /dropped before your later edit/)
  assert.equal(reviveOp(1, 0), true)
  assert.equal(currentDraft()!.project.captions.filter((c) => c.text === 'Go').length, 2)
  rejectDraft()
})

// ---- T2 / T13 ------------------------------------------------------------------

test('T2: "şey" in "bir şey", "her şey", "hiçbir şey" is a word, not a filler sound', () => {
  const caps = [
    { id: 'a', start: 0, end: 3, text: 'bir şey var', words: [{ text: 'bir', start: 0, end: 0.4 }, { text: 'şey', start: 0.5, end: 0.9 }, { text: 'var', start: 1, end: 1.5 }] },
    { id: 'b', start: 4, end: 7, text: 'her şey hiçbir şey.', words: [{ text: 'her', start: 4, end: 4.3 }, { text: 'şey', start: 4.4, end: 4.8 }, { text: 'hiçbir', start: 5, end: 5.5 }, { text: 'şey.', start: 5.6, end: 6 }] },
    { id: 'c', start: 8, end: 9, text: 'Şey', words: [{ text: 'Şey', start: 8, end: 8.4 }] }
  ]
  assert.deepEqual(fillerHits(flattenWords(caps), fillerSet(FILLER_DEFAULT)), [])
})

test('T3: a sound with no word is uncertain — listed after the text\'s, applied only when named; only the voice is listened to', () => {
  const r = {
    id: 'r9', kind: 'fillers', token: 'x-1', head: '',
    items: [
      { line: '1.00-1.30 "ee" L#0', cut: [1, 1.3] as [number, number] },
      { line: '5.00-5.40 sound, no word (uncertain)', cut: [5, 5.4] as [number, number], uncertain: true }
    ],
    apply: () => []
  }
  assert.deepEqual(chosenItems(r).map((i) => i.cut), [[1, 1.3]], 'by default: the text\'s only')
  assert.deepEqual(chosenItems(r, undefined, undefined, [2]).map((i) => i.cut), [[1, 1.3], [5, 5.4]], 'include names it')
  assert.match(resultText(r, long()), /^Uncertain \(applied only with "include":\[n…\]\):\n2 5\.00-5\.40/m)
  // The voice under the subtitles, not the music beside it.
  const p = long()
  const a1 = p.tracks.find((t) => t.kind === 'audio')!
  p.assets.push({ id: 'vo', kind: 'audio', name: 'voice.wav', url: 'media://v', size: 1, duration: 60, hasAudio: true } as Asset, { id: 'mu', kind: 'audio', name: 'music.wav', url: 'media://m', size: 1, duration: 60, hasAudio: true } as Asset)
  const a2 = { id: 'a2track00001', kind: 'audio' as const, name: 'A2', clipIds: ['mu1'] }
  p.tracks.push(a2)
  p.clips.vo1 = { id: 'vo1', assetId: 'vo', trackId: a1.id, start: 0, inPoint: 0, duration: 30, transform: { x: 960, y: 540, scale: 1, rotation: 0 }, volume: 1 } as Clip
  p.clips.mu1 = { id: 'mu1', assetId: 'mu', trackId: a2.id, start: 0, inPoint: 0, duration: 30, transform: { x: 960, y: 540, scale: 1, rotation: 0 }, volume: 0.3 } as Clip
  a1.clipIds = ['vo1']
  p.captions = [{ id: 'L', start: 1, end: 3, text: 'ee hello', words: [{ text: 'ee', start: 1, end: 1.3 }, { text: 'hello', start: 1.5, end: 2 }] }]
  assert.deepEqual([...voiceClipIds(p)], ['vo1'])
})

test('T3: the speech is told from the music by its sound, whatever the kind and order of the tracks', async () => {
  const win = 0.04
  const words = [[1, 1.4], [1.5, 2], [2.2, 2.8], [8, 8.5], [8.6, 9.2], [9.3, 9.9]].map(([start, end]) => ({ start, end }))
  const speech = (extra: [number, number][] = []): number[] => {
    const dbs = new Array(Math.round(12 / win)).fill(-60)
    for (const [a, b] of [...words.map((w) => [w.start, w.end]), ...extra]) for (let i = Math.round(a / win); i < Math.round(b / win); i++) dbs[i] = -20
    return dbs
  }
  const bed = (): number[] => new Array(Math.round(12 / win)).fill(-24)
  // Loud while the words are said, quiet between: the speech. A bed is alike in both.
  assert.ok(speechContrast([{ start: 0, dbs: speech() }], win, words)! > 30)
  assert.ok(Math.abs(speechContrast([{ start: 0, dbs: bed() }], win, words)!) < 1)
  // The music on the FIRST audio track, the voice-over under it; a talking
  // video over music on an audio track: the speech's track either way.
  assert.equal(speechTrack([{ track: 'A1', clips: [{ start: 0, dbs: bed() }] }, { track: 'A2', clips: [{ start: 0, dbs: speech() }] }], win, words), 'A2')
  assert.equal(speechTrack([{ track: 'V1', clips: [{ start: 0, dbs: speech() }] }, { track: 'A1', clips: [{ start: 0, dbs: bed() }] }], win, words), 'V1')
  // Nothing stands out (two beds): no claim; the caller keeps the subtitles' choice.
  assert.equal(speechTrack([{ track: 'A1', clips: [{ start: 0, dbs: bed() }] }, { track: 'A2', clips: [{ start: 0, dbs: bed() }] }], win, words), null)

  // The analysis itself: music on A1 (the subtitles' own choice names it:
  // an audio track, the higher one), the voice-over on A2 with an "ee" no
  // word covers at 5.0–5.4 s. The island is found in the VOICE; the bed,
  // loud all along, gives none (and is not what is listened to).
  const p = long()
  const a1 = p.tracks.find((t) => t.kind === 'audio')!
  for (const t of p.tracks) t.clipIds = []
  p.clips = {}
  p.assets.push({ id: 'vo', kind: 'audio', name: 'voice.wav', url: 'media://v', size: 1, duration: 60, hasAudio: true } as Asset, { id: 'mu', kind: 'audio', name: 'music.wav', url: 'media://m', size: 1, duration: 60, hasAudio: true } as Asset)
  const a2 = { id: 'a2track00001', kind: 'audio' as const, name: 'A2', clipIds: ['vo1'] }
  p.tracks.push(a2)
  const at = { transform: { x: 960, y: 540, scale: 1, rotation: 0 }, start: 0, inPoint: 0, duration: 12 }
  p.clips.mu1 = { ...at, id: 'mu1', assetId: 'mu', trackId: a1.id, volume: 0.3 } as Clip
  p.clips.vo1 = { ...at, id: 'vo1', assetId: 'vo', trackId: a2.id, volume: 1 } as Clip
  a1.clipIds = ['mu1']
  p.captions = [
    { id: 'L1', start: 1, end: 2.8, text: 'hello there friends', words: [{ text: 'hello', start: 1, end: 1.4 }, { text: 'there', start: 1.5, end: 2 }, { text: 'friends', start: 2.2, end: 2.8 }] },
    { id: 'L2', start: 8, end: 9.9, text: 'we go on', words: [{ text: 'we', start: 8, end: 8.5 }, { text: 'go', start: 8.6, end: 9.2 }, { text: 'on', start: 9.3, end: 9.9 }] }
  ]
  assert.deepEqual([...voiceClipIds(p)], ['mu1'], 'by track kind and order the subtitles name the music (the finding)')
  const read: string[] = []
  const loudness = async (_p: Project, clip: Clip): Promise<number[] | null> => {
    read.push(clip.id)
    return clip.id === 'vo1' ? speech([[5, 5.4]]) : bed()
  }
  const r = await analyze(p, { kind: 'fillers' } as never, 'r1', 'v-1', { cancelled: () => false }, { loudness })
  const islands = r.items.filter((it) => (it.data as { source?: string })?.source === 'audio')
  assert.deepEqual(islands.map((it) => it.cut), [[5, 5.4]], 'the "ee" in the voice, nothing from the bed')
  assert.ok(islands.every((it) => it.uncertain))
  // With the voice alone on the timeline nothing needs telling apart.
  delete p.clips.mu1
  a1.clipIds = []
  const one = await analyze(p, { kind: 'fillers' } as never, 'r2', 'v-1', { cancelled: () => false }, { loudness })
  assert.deepEqual(one.items.filter((it) => (it.data as { source?: string })?.source === 'audio').map((it) => it.cut), [[5, 5.4]])
})

test('T13: a filler in a line without word times is given by its seconds, not a broken address', () => {
  const words = flattenWords([{ id: 'n', start: 0, end: 2, text: 'eee okay' }])
  assert.equal(fillerLine(words[0]), '0.00-1.00 "eee" (no word times)')
  const timed = flattenWords([{ id: 't', start: 0, end: 2, text: 'eee okay', words: [{ text: 'eee', start: 0, end: 0.5 }, { text: 'okay', start: 0.6, end: 1 }] }])
  assert.equal(fillerLine(timed[0]), '0.00-0.50 "eee" t#0')
})

test('T13: filler sounds by their shape, whatever their length and case; words that look alike are not', () => {
  const say = (list: string[]) => [{ id: 'x', start: 0, end: list.length, text: list.join(' '), words: list.map((text, i) => ({ text, start: i, end: i + 0.5 })) }]
  const yes = ['Eee,', 'ee', 'eeeee...', 'Iıı', 'ıııı', 'Aa', 'mmmm', 'Hımm', 'hmm', 'Um', 'Uh...', 'uhm', 'Ehm', '(ııı)']
  for (const lang of ['tr', 'en'] as const) assert.equal(fillerHits(flattenWords(say(yes)), new Set(), lang).length, yes.length, `every sound (${lang})`)
  const no = ['him', 'em', 'e', 'a', 'o', 'Ah', 'eh', 'şey', 'yani', 'işte', 'like', 'here', 'mom', 'umbrella', 'aaron']
  for (const lang of ['tr', 'en'] as const) assert.deepEqual(fillerHits(flattenWords(say(no)), new Set(), lang), [], `no word (${lang})`)
})

test('V-analysis-tools-tests-2: a filler shape never takes a real word: numerals, units, abbreviations; "er" by language', () => {
  const say = (list: string[]) => flattenWords([{ id: 'x', start: 0, end: list.length, text: list.join(' '), words: list.map((text, i) => ({ text, start: i, end: i + 0.5 })) }])
  // A Roman numeral ("II. Dünya Savaşı", "World War II"), a unit with its
  // number or alone, an abbreviation, a word all in capitals, a word with a
  // full stop inside: none is a sound, in either language.
  const real = ['II.', 'II', 'III', '35mm', 'mm', 'MM', 'ER', 'AAA', 'AA', 'UH', 'UM', 'a.m', 'e.g', '3e', 'aa2']
  for (const w of real) for (const lang of ['tr', 'en'] as const) assert.equal(isFillerSound(w, lang), false, `${w} (${lang})`)
  for (const lang of ['tr', 'en'] as const) assert.deepEqual(fillerHits(say(real), new Set(), lang), [], lang)
  // Turkish: "er" is a word ("er ya da geç", "Er Ryan"); English: a sound.
  for (const w of ['er', 'Er', 'er,', 'erm']) {
    assert.equal(isFillerSound(w, 'tr'), false, `${w} in Turkish`)
    assert.equal(isFillerSound(w, 'en'), true, `${w} in English`)
  }
  assert.equal(isFillerSound('er'), false, 'with no language given: the safe one')
  assert.doesNotMatch(`,${FILLER_DEFAULT},`, /,er,|,erm,/, 'the panel\'s default list cuts no Turkish "er"')
  assert.match(`,${FILLER_DEFAULT_EN},`, /,er,/)
  // The language: the one the subtitles were made in; unknown: by the letters.
  assert.equal(fillerLanguage('tr', 'hello'), 'tr')
  assert.equal(fillerLanguage('en', 'çok güzel'), 'en')
  assert.equal(fillerLanguage('auto', 'bugün çok güzel'), 'tr')
  assert.equal(fillerLanguage(undefined, 'It was a good day'), 'en')
  assert.equal(fillerLanguage('auto', 'I think It Is fine'), 'en', 'a capital I is no Turkish letter')
})

test('T13 / V-analysis-tools-tests-2: analyze fillers — "Er" stays in a Turkish talk; a hit in a line without word times is uncertain (not in a plain apply)', async () => {
  const p = talk(20)
  // (No clips: the sound path, which reads the voice's loudness, has nothing to read here.)
  for (const t of p.tracks) t.clipIds = []
  p.clips = {}
  p.transcription = { model: 'multilingual' as never, language: 'tr' as never }
  p.captions = [
    // (A pause after "eee": it stands apart, phase 4A.11, N4.)
    { id: 'a', start: 0, end: 3, text: 'Er ya da geç II. bölüm eee başlar', words: ['Er', 'ya', 'da', 'geç', 'II.', 'bölüm', 'eee', 'başlar'].map((text, i) => ({ text, start: i * 0.35 + (i === 7 ? 0.2 : 0), end: i * 0.35 + 0.3 + (i === 7 ? 0.2 : 0) })) },
    // An imported line: no word times. Its "Eee" is at a guessed second.
    { id: 'b', start: 5, end: 8, text: 'Eee bugün çok güzel bir gün' }
  ]
  const r = await analyze(p, { kind: 'fillers', from: 0, to: 9 } as never, 'r1', 'v-1', { cancelled: () => false })
  const text = r.items.filter((it) => (it.data as { source?: string })?.source === 'text')
  assert.deepEqual(text.map((it) => [it.line, !!it.uncertain]), [['2.10-2.40 "eee" a#6', false], ['5.00-5.50 "Eee" (no word times)', true]])
  // A plain apply cuts the measured one only.
  const calls = r.apply!(chosenItems(r))
  assert.deepEqual(calls.map((c) => (c.params as { ranges: number[][] }).ranges.length), [1])
  assert.match(resultText(r, p), /with no measured word times \(their seconds are a guess: uncertain\)/)
})
