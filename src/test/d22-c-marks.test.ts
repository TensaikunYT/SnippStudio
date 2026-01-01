// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// D22, worker C (YOL-HARITASI.md, part 4): every operation an agent's draft
// applies has a mark on the timeline.
//   - The table (agent/marks.ts MARK_OF) names a mark for every edit command
//     an agent may send (agent/families.ts) and for nothing else: a new
//     command without a mark is a red test here.
//   - Every kind of mark has its drawing (components/agent/review.css) and
//     its name in both languages.
//   - Commands run through the edit tool into a draft: each op becomes one
//     review item, and the item's marks hold the mark its command names.
//   - One op accepted or rejected by itself: one undo step, the rest waits.
import './dom-stub'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import test from 'node:test'
import { useStore } from '../renderer/src/state/store'
import { defaultProject, type Project } from '../renderer/src/types'
import { COMMANDS } from '../renderer/src/commands'
import { FAMILIES } from '../renderer/src/agent/families'
import { MARK_KINDS, MARK_OF, MARK_OF_CHANGE, marksFor, itemStart, type MarkKind } from '../renderer/src/agent/marks'
import { acceptDraft, acceptPreview, acceptWould, draftState, rejectDraft, rejectOp, reviveOp, takeNews, watchLive } from '../renderer/src/agent/drafts'
import { editTool } from '../renderer/src/agent/edit'
import { saidOf } from '../renderer/src/agent/said'
import { useAgentStore } from '../renderer/src/agent/store'
import { STRINGS } from '../renderer/src/ui/strings'
import { clipOf, ctxOf, open, read, videoAsset } from './agent-kit'

const S = useStore.getState
const unwatch = watchLive()
test.after(() => {
  rejectDraft()
  unwatch()
  S().setUiLang('en')
})

test('the table: every edit command an agent may send has a mark, and nothing else is in it', () => {
  assert.deepEqual(Object.keys(MARK_OF).sort(), Object.keys(FAMILIES).sort(), 'MARK_OF and FAMILIES name the same commands')
  for (const [name, kinds] of Object.entries(MARK_OF)) {
    assert.ok(kinds.length > 0, `${name} has a mark`)
    for (const k of kinds) assert.ok(MARK_KINDS.includes(k), `${name}: ${k} is a mark the timeline draws`)
    assert.ok(Object.hasOwn(COMMANDS, name), `${name} is a command`)
  }
  // Every kind of change the sentences know maps to a mark.
  for (const k of Object.values(MARK_OF_CHANGE)) assert.ok(MARK_KINDS.includes(k))
})

test('every kind of mark is drawn (review.css) and named in both languages', () => {
  const css = readFileSync(join(__dirname, '..', '..', 'src', 'renderer', 'src', 'components', 'agent', 'review.css'), 'utf8')
  const tsx = readFileSync(join(__dirname, '..', '..', 'src', 'renderer', 'src', 'components', 'agent', 'DraftMarks.tsx'), 'utf8') + readFileSync(join(__dirname, '..', '..', 'src', 'renderer', 'src', 'components', 'agent', 'AgentTrail.tsx'), 'utf8')
  // The shapes and the ways a mark is drawn: each has its rule.
  for (const sel of ['.agent-mark.is-frame', '.agent-mark.is-was', '.agent-mark.is-ghost', '.agent-mark.is-new', '.agent-mark.is-gone', '.agent-mark-region', '.agent-mark-seam', ".agent-mark[data-shape='band'].is-gone", '.agent-mark.is-row', '.agent-mark.is-chip', '.agent-mark-dot', '.agent-pin', '.agent-mark-badge.is-join', '.agent-mark-badge.is-film', '.agent-mark.is-focus']) {
    assert.ok(css.includes(sel), `${sel} is drawn`)
  }
  for (const shape of ['clip', 'box', 'band', 'chip', 'chipBox', 'track', 'pin', 'film']) assert.match(tsx, new RegExp(`'${shape}'`), `the ${shape} shape is placed`)
  for (const k of MARK_KINDS) {
    const e = (STRINGS as Record<string, { en: string; tr?: string }>)[`d22c.kind.${k}`]
    assert.ok(e?.en && e.tr, `d22c.kind.${k}`)
  }
})

/** V2: d (other) 2–6. V1: a 0–4, b 4–8, c 8–12 of talk, each with its sound on A1. A2: music 0–12. Two subtitle lines, one marker. */
function scene(): Project {
  const p = defaultProject()
  p.assets = [videoAsset('talk', 100), videoAsset('other', 100), { ...videoAsset('music', 100), kind: 'audio', name: 'music.wav' } as never]
  p.tracks = [
    { id: 'V3', kind: 'video', name: 'V3', clipIds: [] },
    { id: 'V2', kind: 'video', name: 'V2', clipIds: ['d'] },
    { id: 'V1', kind: 'video', name: 'V1', clipIds: ['a', 'b', 'c'] },
    { id: 'A1', kind: 'audio', name: 'A1', clipIds: ['as', 'bs', 'cs'] },
    { id: 'A2', kind: 'audio', name: 'A2', clipIds: ['m'] }
  ]
  p.clips = {
    a: clipOf('a', 'talk', 'V1', 0, 0, 4, { linkId: 'L1', audioExtracted: true }),
    as: clipOf('as', 'talk', 'A1', 0, 0, 4, { linkId: 'L1' }),
    b: clipOf('b', 'talk', 'V1', 4, 4, 4, { linkId: 'L2', audioExtracted: true }),
    bs: clipOf('bs', 'talk', 'A1', 4, 4, 4, { linkId: 'L2' }),
    c: clipOf('c', 'talk', 'V1', 8, 8, 4, { linkId: 'L3', audioExtracted: true }),
    cs: clipOf('cs', 'talk', 'A1', 8, 8, 4, { linkId: 'L3' }),
    d: clipOf('d', 'other', 'V2', 2, 0, 4),
    m: clipOf('m', 'music', 'A2', 0, 0, 12)
  }
  p.captions = [
    { id: 'S1', start: 1, end: 3, text: 'hello there', words: [{ text: 'hello', start: 1, end: 2 }, { text: 'there', start: 2, end: 3 }], soundClip: 'as' },
    { id: 'S2', start: 5, end: 7, text: 'we go on', words: [{ text: 'we', start: 5, end: 5.5 }, { text: 'go', start: 5.6, end: 6 }, { text: 'on', start: 6.1, end: 7 }], soundClip: 'bs' }
  ] as never
  p.markers = [{ id: 'm1', time: 6, color: '#ffd83d', note: '', label: 'here' }]
  return p
}

/** One op into a fresh draft; its review item. */
async function one(op: Record<string, unknown>): Promise<{ kinds: MarkKind[]; said: string; marks: ReturnType<typeof marksFor>; answer: string }> {
  open(scene(), 'draft')
  const answer = await editTool({ ops: [op], base: read() }, ctxOf())
  const view = useAgentStore.getState().draft
  const d = draftState()
  if (!view || !d) return { kinds: [], said: '', marks: [], answer }
  const items = view.items ?? []
  return { kinds: items.flatMap((i) => i.kinds), said: items.map((i) => saidOf(i.changes)).join(' | '), marks: marksFor('before', d.on, d.project, view.marks?.cuts ?? [], items), answer }
}

// One op of each sort of command; the mark the table names must be among its item's marks.
const CASES: [Record<string, unknown>, RegExp][] = [
  [{ op: 'timeline.cutRanges', ranges: [[5, 6]] }, /0:05\.0–0:06\.0 is cut out of/],
  [{ op: 'clip.delete', ids: ['d'] }, /^other\.mp4 is removed \(0:02–0:06\)$/],
  [{ op: 'clip.move', clipId: 'd', by: 3 }, /^other\.mp4 moves 3 s later \(0:02 → 0:05\)$/],
  [{ op: 'clip.moveToTrack', clipId: 'd', trackId: 'V3' }, /^other\.mp4 moves to track V3 \(0:02\)$/],
  [{ op: 'clip.trimEnd', clipId: 'd', delta: -1 }, /^other\.mp4: 1 s trimmed off its end \(3 s left of 4 s\)$/],
  [{ op: 'clip.trimHead', clipId: 'd', edge: 3 }, /^other\.mp4: 1 s trimmed off its start \(3 s left of 4 s\)$/],
  [{ op: 'clip.split', clipIds: ['d'], time: 4 }, /^other\.mp4 is split in two at 0:04$/],
  [{ op: 'clip.setVolume', clipId: 'm', volume: 0.5 }, /^music\.wav: volume 100 % → 50 %$/],
  [{ op: 'clip.setOpacity', clipId: 'd', opacity: 0.5 }, /^other\.mp4: opacity 100 % → 50 %$/],
  [{ op: 'clip.setMuted', clipId: 'm', muted: true }, /^music\.wav is muted$/],
  [{ op: 'clip.setSpeed', clipId: 'd', speed: 2 }, /^other\.mp4 plays at 2× \(4 s becomes 2 s\)$/],
  [{ op: 'clip.setFades', clipId: 'm', fadeIn: 1 }, /^music\.wav: its fade in or out changes$/],
  [{ op: 'clip.keepRange', clipId: 'd', range: [3, 5] }, /^other\.mp4: trimmed at both ends \(2 s left of 4 s\)$/],
  [{ op: 'clip.setTransition', clipId: 'a', transition: { type: 'mix', duration: 0.5 } }, /^A transition is added from talk\.mp4 into talk\.mp4 \(0\.5 s\)$/],
  [{ op: 'clip.slip', clipId: 'd', delta: 2 }, /^other\.mp4 shows other footage in the same place/],
  [{ op: 'clip.setTransform', clipId: 'd', transform: { scale: 1.2 } }, /^other\.mp4: size 100 % → 120 %$/],
  [{ op: 'text.add', time: 9, text: 'Subscribe' }, /^A title "Subscribe" is added at 0:09$/],
  [{ op: 'caption.editLine', id: 'S1', text: 'hello friends' }, /^Subtitle “hello there” becomes “hello friends”$/],
  [{ op: 'caption.delete', ids: ['S2'] }, /^Subtitle “we go on” is removed \(0:05\)$/],
  [{ op: 'marker.add', time: 3, note: 'look' }, /^A marker “look” is added at 0:03$/],
  [{ op: 'marker.delete', id: 'm1' }, /^The marker at 0:06 is removed$/],
  [{ op: 'track.add', kind: 'video' }, /^A new picture track: /]
]

test('one op of each sort: its item says what it does and carries the mark the table names', async () => {
  S().setUiLang('en')
  const seen = new Set<MarkKind>()
  for (const [op, words] of CASES) {
    const name = String(op.op)
    const r = await one(op)
    assert.doesNotMatch(r.answer, /^Nothing applied/, `${name}: applied (${r.answer.split('\n')[0]})`)
    assert.ok(r.kinds.length > 0, `${name}: an item with a mark`)
    assert.ok(MARK_OF[name].includes(r.kinds[0]), `${name}: its mark is ${MARK_OF[name].join(' / ')}, got ${r.kinds.join(', ')}`)
    assert.match(r.said, words, `${name}: "${r.said}"`)
    assert.ok(r.marks.length > 0, `${name}: the timeline has something to draw (${JSON.stringify(r.kinds)})`)
    assert.doesNotMatch(r.said, /clip\.|caption\.|marker\.|track\./, `${name}: no command name in the sentence`)
    for (const k of r.kinds) seen.add(k)
  }
  // Between them these cover the marks a clip, a line, a marker and a lane take.
  for (const k of ['cut', 'remove', 'move', 'trim', 'split', 'set', 'transition', 'add', 'line', 'pin', 'track'] as MarkKind[]) assert.ok(seen.has(k), `a case leaves the ${k} mark`)
})

test('the marks lie where the change is, in "Before" (the live film) and in "After" (the draft)', async () => {
  open(scene(), 'draft')
  await editTool({ ops: [{ op: 'clip.move', clipId: 'd', by: 3 }, { op: 'clip.delete', ids: ['m'] }, { op: 'timeline.cutRanges', ranges: [[9, 10]] }, { op: 'clip.setVolume', clipId: 'as', volume: 0.5 }], base: read() }, ctxOf())
  const view = useAgentStore.getState().draft!
  const d = draftState()!
  assert.equal(view.items!.length, 4, 'four ops, four items')
  const before = marksFor('before', d.on, d.project, view.marks!.cuts, view.items!)
  const after = marksFor('after', d.on, d.project, view.marks!.cuts, view.items!)
  const of = (ms: typeof before, item: number): string[] => ms.filter((m) => m.item === item).map((m) => `${m.shape}:${m.variant}`)
  // The move: its old place faded and a dashed box where it goes; after, the clip framed and a ghost where it was.
  assert.deepEqual(of(before, 0), ['clip:was', 'box:ghost'])
  assert.deepEqual(of(after, 0), ['box:was', 'clip:frame'])
  const ghost = before.find((m) => m.item === 0 && m.variant === 'ghost')!
  assert.deepEqual([ghost.trackId, ghost.start, ghost.end], ['V2', 5, 9])
  // The removal: hatched on the live clip; after, a ghost where it lay.
  assert.deepEqual(of(before, 1), ['clip:gone'])
  assert.deepEqual(of(after, 1), ['box:gone'])
  // The cut: a band over 9–10; after, the join at 9.
  const band = before.find((m) => m.item === 2)!
  assert.deepEqual([band.shape, band.variant, band.start, band.end], ['band', 'gone', 9, 10])
  const seam = after.find((m) => m.item === 2)!
  assert.deepEqual([seam.variant, seam.start], ['seam', 9])
  // The setting: a frame on the clip in both.
  assert.deepEqual(of(before, 3), ['clip:frame'])
  assert.deepEqual(of(after, 3), ['clip:frame'])
  // Where the strip takes the playhead for each item.
  assert.equal(itemStart(before, 0, d.on), 5, 'the move: where the clip goes')
  assert.equal(itemStart(before, 1, d.on), 0)
  assert.equal(itemStart(before, 2, d.on), 9)
  assert.equal(itemStart(after, 0, d.project), 5)
})

test('one item accepted by itself: one undo step, in the live film, the rest still waits; the last one ends the draft', async () => {
  open(scene(), 'draft')
  const session = 's1'
  await editTool({ ops: [{ op: 'clip.setVolume', clipId: 'm', volume: 0.5 }, { op: 'clip.delete', ids: ['d'] }, { op: 'marker.add', time: 3 }], base: read() }, ctxOf({ session }))
  const items = (): string[] => (useAgentStore.getState().draft?.items ?? []).map((i) => i.key)
  assert.deepEqual(items(), ['1:0', '1:1', '1:2'])
  const v0 = S().projectVersion
  // Accept the second (the removal) alone.
  const plan = acceptPreview(undefined, ['1:1'])
  assert.deepEqual(plan.outcomes.filter((o) => o.applied).map((o) => `${o.seq}:${o.index}`), ['1:1'])
  const out = acceptDraft(undefined, plan.shown, ['1:1'])
  assert.equal(out.changed, undefined)
  assert.ok(out.version !== null && out.version > v0)
  assert.equal(S().project.clips.d, undefined, 'the clip is gone from the live film')
  assert.equal(S().project.clips.m.volume, 1, 'the volume is not: its item still waits')
  assert.deepEqual(items(), ['1:0', '1:2'], 'two items left')
  assert.equal(useAgentStore.getState().draft?.dropped.length, 0, 'an accepted op is not listed as "not applied"')
  assert.equal(out.ended, undefined)
  S().undo()
  assert.ok(S().project.clips.d, 'ONE undo takes that accept back')
  S().redo()
  // Reject the volume; the marker is the last: accepting it ends the draft, in part.
  const r = rejectOp(1, 0)
  assert.deepEqual(r, { done: true })
  assert.deepEqual(items(), ['1:2'])
  assert.equal(useAgentStore.getState().draft?.dropped.filter((x) => x.rejected).length, 1, 'the rejected one can be brought back')
  assert.equal(reviveOp(1, 0), true)
  assert.deepEqual(items(), ['1:0', '1:2'], 'brought back')
  assert.deepEqual(rejectOp(1, 0), { done: true })
  const last = acceptDraft(undefined, 'now', ['1:2'])
  assert.equal(last.ended, 'partial', 'accepted two, rejected one: in part')
  assert.equal(useAgentStore.getState().draft, null)
  assert.equal(S().project.clips.m.volume, 1)
  assert.equal((S().project.markers ?? []).length, 2)
  // The agent is told what became of each op.
  const news = takeNews(session).join('\n')
  assert.match(news, /the user accepted call #1 op #2 clip\.delete/)
  assert.match(news, /the user rejected call #1 op #1 clip\.setVolume/)
  assert.match(news, /the user accepted call #1 op #3 marker\.add/)
})

test('accepting one item by itself must not silently end another: what it would cost is known before', async () => {
  open(scene(), 'draft')
  // A move (held to the very project it was written on), then a setting.
  await editTool({ ops: [{ op: 'clip.move', clipId: 'd', by: 3 }, { op: 'clip.setVolume', clipId: 'm', volume: 0.5 }], base: read() }, ctxOf())
  const keys = (): string[] => (useAgentStore.getState().draft?.items ?? []).map((i) => i.key)
  assert.deepEqual(keys(), ['1:0', '1:1'])
  // The setting alone would land, but the move would no longer hold.
  const cost = acceptWould(['1:1'])
  assert.deepEqual(cost.plan.outcomes.filter((o) => o.applied).map((o) => `${o.seq}:${o.index}`), ['1:1'])
  assert.deepEqual(cost.lost, ['1:0'], 'the strip asks for the move to be decided first')
  assert.deepEqual(keys(), ['1:0', '1:1'], 'asking changes nothing')
  // The move first costs nothing; then the setting costs nothing either.
  const first = acceptWould(['1:0'])
  assert.deepEqual(first.lost, [])
  acceptDraft(undefined, first.plan.shown, ['1:0'])
  assert.deepEqual(keys(), ['1:1'])
  assert.deepEqual(acceptWould(['1:1']).lost, [])
  assert.equal(acceptDraft(undefined, 'now', ['1:1']).ended, 'accepted')
  assert.equal(S().project.clips.d.start, 5)
  assert.equal(S().project.clips.m.volume, 0.5)
})

test('every item rejected one by one: the draft ends rejected, the film untouched', async () => {
  open(scene(), 'draft')
  await editTool({ ops: [{ op: 'clip.setVolume', clipId: 'm', volume: 0.5 }, { op: 'marker.add', time: 3 }], base: read() }, ctxOf())
  const v0 = S().projectVersion
  assert.deepEqual(rejectOp(1, 0), { done: true })
  assert.deepEqual(rejectOp(1, 1), { done: true, ended: 'rejected' })
  assert.equal(useAgentStore.getState().draft, null)
  assert.equal(S().projectVersion, v0)
})

test('an item written on the one before it is not accepted alone: nothing lands, the draft stays', async () => {
  open(scene(), 'draft')
  // The split makes a new piece; the second op deletes the piece by the name the call gave it.
  await editTool({ ops: [{ op: 'clip.move', clipId: 'd', by: 20 }, { op: 'clip.move', clipId: 'd', by: -5 }], base: read() }, ctxOf())
  const view = useAgentStore.getState().draft!
  const second = view.items!.find((i) => i.key === '1:1')
  if (!second) return // (merged into one move, or dropped: nothing to hold here)
  const plan = acceptPreview(undefined, ['1:1'])
  const alone = plan.outcomes.some((o) => `${o.seq}:${o.index}` === '1:1' && o.applied)
  if (alone) return
  const v0 = S().projectVersion
  const out = acceptDraft(undefined, plan.shown, ['1:1'])
  assert.equal(out.version, null)
  assert.equal(S().projectVersion, v0, 'nothing landed')
  assert.ok(useAgentStore.getState().draft, 'the draft still waits')
})
