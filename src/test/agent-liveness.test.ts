// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// SnippStudio phase 4A.10 (FAZ4A-DUZELTME-2.md C): the main use — the agent
// lays things on the timeline while the user keeps editing — as scripted
// sessions with their targets as assertions. The sessions are the review's
// (haritalar/_faz4a9-dogrulama.md, "Canlılık"): (a) a rough assembly of 25
// ops from the media pool; (b) a 10-minute talk: two cut results, six
// pictures on words, a style, five markers on words.
import './dom-stub'
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import test from 'node:test'
import { closeEditWindows, useStore } from '../renderer/src/state/store'
import { defaultProject, projectDuration, type Asset, type Caption, type Clip, type Project } from '../renderer/src/types'
import { runEdit, type EditContext } from '../renderer/src/agent/edit'
import { acceptDraft, currentDraft, rejectDraft, takeNews, view, watchLive } from '../renderer/src/agent/drafts'
import { useAgentStore } from '../renderer/src/agent/store'
import { setSeams } from '../renderer/src/agent/seams'
import { projectText } from '../renderer/src/agent/format'
import { parseSrt } from '../renderer/src/subtitles/srt'
import type { AnalysisResult, Item } from '../renderer/src/agent/answers'

const S = useStore.getState
type Op = Record<string, unknown>

/** A scripted agent: the calls host.ts makes (view, runEdit, takeNews), counted. */
class Agent {
  calls = 0
  reads = 0
  results = new Map<string, AnalysisResult>()
  constructor(readonly name: string) {}
  private ctx(): EditContext {
    return { session: this.name, client: this.name, results: this.results, beforeFirstEdit: async () => undefined, told: () => undefined }
  }
  read(): { token: string; project: Project; text: string } {
    const v = view(undefined, this.name)
    const news = takeNews(this.name)
    this.reads++
    return { token: v.token, project: v.project, text: [projectText(v.project, { version: v.token, state: v.kind }), ...news].join('\n') }
  }
  analysis(at: { token: string; project: Project }, ranges: [number, number][]): string {
    const id = `r${this.results.size + 1}`
    const items: Item[] = ranges.map((r) => ({ line: `${r[0]}-${r[1]}`, range: r, cut: r }))
    this.results.set(id, { id, kind: 'silences', token: at.token, project: at.project, live: S().projectVersion, head: '', items, apply: (chosen) => (chosen.length ? [{ name: 'timeline.cutRanges', params: { ranges: chosen.map((i) => i.cut!) } }] : []) })
    return id
  }
  async edit(ops: Op[], base: string): Promise<{ applied: boolean[]; text: string }> {
    this.calls++
    const r = await runEdit({ ops, base }, this.ctx())
    const applied = ops.map((_, i) => r.outcomes.some((o) => (o.sent ?? o.index) === i && o.applied))
    return { applied, text: r.text }
  }
}

let sessions = 0
/** A fresh session on `p`: seeded ids, the delayed replay run by hand. */
function start(p: Project, mode: 'draft' | 'direct'): { agent: Agent; flush: () => void; done: () => void } {
  let n = 0
  const seed = ++sessions
  const queue: (() => void)[] = []
  const restore = setSeams({
    newId: () => `v${seed.toString(36)}${(n++).toString(36).padStart(6, '0')}`.slice(0, 13).padEnd(13, '0'),
    entrySeed: (seq) => (seed * 31 + seq * 7919) | 0,
    schedule: (fn) => {
      queue.push(fn)
      return () => void queue.splice(queue.indexOf(fn), 1)
    },
    now: () => 1_700_000_000_000 + n
  })
  const unwatch = watchLive()
  rejectDraft()
  S().loadProject(structuredClone(p))
  useAgentStore.getState().setMode(mode)
  return {
    agent: new Agent(`live-${seed}`),
    flush: () => {
      while (queue.length) queue.shift()!()
    },
    done: () => {
      rejectDraft()
      unwatch()
      restore()
    }
  }
}

function user(calls: { name: string; params: unknown }[]): void {
  closeEditWindows()
  S().runBatch(calls as never)
  closeEditWindows()
}

const video = (id: string, duration: number): Asset => ({ id, kind: 'video', name: `${id}.mp4`, url: `media://${id}`, size: 1, duration, width: 1920, height: 1080, hasAudio: true }) as Asset
const image = (id: string): Asset => ({ id, kind: 'image', name: `${id}.jpg`, url: `media://${id}`, size: 1, duration: 5, width: 1600, height: 900 }) as Asset

const SHOTS = Array.from({ length: 12 }, (_, i) => `shot${String(i + 1).padStart(2, '0')}`)
const BROLL = Array.from({ length: 5 }, (_, i) => `brol${String(i + 1).padStart(2, '0')}`)

/** (a): an empty timeline; 12 shots and 5 pictures in the pool. */
function pool(stills = false): Project {
  const p = defaultProject()
  p.name = 'Pool'
  p.assets = [...SHOTS.map((id, i) => (stills ? image(id) : video(id, 6 + (i % 4)))), ...BROLL.map(image)]
  return p
}

/** The 25 ops of the rough assembly, as ONE call: 12 appends, a track, 5
 *  pictures on it, 4 transitions, 3 titles. What an op makes is named
 *  (`id`) and used by the ops after it. */
function assembly(p: Project): Op[] {
  const v1 = p.tracks.find((t) => t.kind === 'video')!.id
  return [
    ...SHOTS.map((a, i) => ({ op: 'clip.append', assetId: a, trackId: v1, id: `cl${i}` })),
    { op: 'track.add', kind: 'video', id: 'brolltrack' },
    ...BROLL.map((a, i) => ({ op: 'clip.add', assetId: a, trackId: 'brolltrack', start: 5 + i * 15 })),
    ...[0, 1, 2, 3].map((i) => ({ op: 'clip.setTransition', clipId: `cl${i}`, transition: { type: 'mix', duration: 0.5 } })),
    ...[1, 30, 60].map((t, i) => ({ op: 'text.add', time: t, text: `Title ${i + 1}` }))
  ]
}

/** The assembly as it must be in `p`: the shots in order on one track, the
 *  pictures on the track above at their seconds, the transitions, the titles. */
function assembled(p: Project): void {
  const row = (t: { clipIds: string[] }): Clip[] => t.clipIds.map((id) => p.clips[id]).sort((a, b) => a.start - b.start)
  const shots = p.tracks.map(row).find((list) => list.some((c) => c.assetId === 'shot01'))!
  assert.deepEqual(shots.map((c) => c.assetId), SHOTS, 'the twelve shots, in order, on one track')
  shots.forEach((c, i) => i > 0 && assert.ok(Math.abs(c.start - (shots[i - 1].start + shots[i - 1].duration)) < 1e-6, 'back to back'))
  const pics = p.tracks.map(row).find((list) => list.some((c) => c.assetId === 'brol01'))!
  assert.deepEqual(pics.map((c) => [c.assetId, c.start]), BROLL.map((a, i) => [a, 5 + i * 15]), 'the five pictures at their seconds, on one track')
  assert.notEqual(pics[0].trackId, shots[0].trackId)
  assert.deepEqual(shots.slice(0, 4).map((c) => c.transitionOut?.type), ['mix', 'mix', 'mix', 'mix'])
  assert.equal(shots[4].transitionOut, undefined)
  assert.deepEqual(p.captions.filter((c) => /^Title \d$/.test(c.text)).map((c) => [c.text, c.start]).sort(), [['Title 1', 1], ['Title 2', 30], ['Title 3', 60]])
}

test('liveness (a): a rough assembly of 25 ops goes in with ONE call and no extra read', async () => {
  const s = start(pool(), 'direct')
  try {
    const first = s.agent.read()
    const r = await s.agent.edit(assembly(first.project), first.token)
    assert.equal(r.applied.filter(Boolean).length, 25, r.text)
    assert.ok(s.agent.calls <= 2, `${s.agent.calls} calls`)
    assert.equal(s.agent.reads, 1, 'no read besides the first')
    assembled(S().project)
    // (What the ops made is named in the answer: the name given = the id made.)
    assert.match(r.text, /New: cl0=[^,]+, cl1=/)
  } finally {
    s.done()
  }
})

// (Phase 11b, KF4: the same with the twelve shots as PICTURES, as 11a's
// window run had them: a transition on a still was "measured from the clip's
// edges", a structural op, and any edit of the user's dropped it: 21 of 25.)
for (const [what, edit, stills] of [
  ['a marker', { name: 'marker.add', params: { time: 2 } }, false],
  ['a title', { name: 'text.add', params: { time: 50, text: 'User title' } }, false],
  ['a marker', { name: 'marker.add', params: { time: 2 } }, true],
  ['a title', { name: 'text.add', params: { time: 50, text: 'User title' } }, true]
] as const) {
  test(`liveness (a): the assembly${stills ? ' of pictures' : ''} waits as a draft, the user adds ${what}, accepts: 25 of 25 are adopted`, async () => {
    const s = start(pool(stills), 'draft')
    try {
      const first = s.agent.read()
      const r = await s.agent.edit(assembly(first.project), first.token)
      assert.equal(r.applied.filter(Boolean).length, 25, r.text)
      user([edit])
      s.flush()
      const d = currentDraft()!
      assert.equal(d.outcomes.filter((o) => o.applied).length, 25, JSON.stringify(d.outcomes.filter((o) => !o.applied).map((o) => [o.name, o.reason])))
      const out = acceptDraft(undefined, 'now')
      assert.equal(out.applied.length, 25)
      assert.deepEqual(out.dropped, [])
      assembled(S().project)
      // (And the user's own addition is there.)
      assert.ok(what === 'a marker' ? S().project.markers?.some((m) => m.time === 2) : S().project.captions.some((c) => c.text === 'User title'))
      assert.equal(s.agent.calls, 1)
      assert.equal(s.agent.reads, 1)
    } finally {
      s.done()
    }
  })
}

// (Phase 11b, KF4: what keeps a transition on a still a record safe. The
// user shortens the still, moves it, or deletes the clip after it: the
// transition is not made, and the card says why. Without a user edit it
// lands: the 25 of 25 above.)
for (const [what, change] of [
  ['shortens the picture', (ids: string[]) => ({ name: 'clip.trimEnd', params: { clipId: ids[0], delta: -1 } })],
  ['moves the picture away', (ids: string[]) => ({ name: 'clip.move', params: { clipId: ids[0], start: 40 } })],
  ['deletes the clip after it', (ids: string[]) => ({ name: 'clip.delete', params: { ids: [ids[1]] } })]
] as const) {
  test(`liveness (11b, KF4): a transition on a picture waits as a draft; the user ${what}: it drops with its reason`, async () => {
    const s = start(pool(true), 'draft')
    try {
      // Two pictures of the user's on the timeline; the agent reads and sends.
      const v1 = S().project.tracks.find((t) => t.kind === 'video')!.id
      user([{ name: 'clip.append', params: { assetId: 'shot01', trackId: v1 } }, { name: 'clip.append', params: { assetId: 'shot02', trackId: v1 } }])
      const ids = S().project.tracks.find((t) => t.id === v1)!.clipIds.slice()
      const again = s.agent.read()
      const r2 = await s.agent.edit([{ op: 'clip.setTransition', clipId: ids[0], transition: { type: 'mix', duration: 0.5 } }], again.token)
      assert.equal(r2.applied.filter(Boolean).length, 1, r2.text)
      user([change(ids)])
      s.flush()
      const d = currentDraft()!
      const set = d.outcomes.find((o) => o.name === 'clip.setTransition')!
      assert.equal(set.applied, false, `${what}: not made`)
      assert.ok(set.reason && set.reason.length > 10, `${what}: said why (${set.reason})`)
      acceptDraft(undefined, 'now')
      assert.ok(Object.values(S().project.clips).every((c) => c.transitionOut === undefined), `${what}: no transition anywhere`)
    } finally {
      s.done()
    }
  })
}

// (Phase 11b, B17: the agent trims a clip's head in a draft; meanwhile the
// user brings back 0.02 s at that head. The trim would take it too: it was
// within the old 0.02 s tolerance and went silently. Now the op drops, said.)
test('liveness (11b, B17): a head trim waits as a draft, the user reveals 0.02 s at the head: the trim drops, the 0.02 s stays', async () => {
  const p = pool()
  const v1 = p.tracks.find((t) => t.kind === 'video')!
  p.clips = { c1: { id: 'c1', assetId: 'shot01', trackId: v1.id, start: 5, inPoint: 1, duration: 4, transform: { x: 960, y: 540, scale: 1, rotation: 0 }, volume: 1 } as Clip }
  v1.clipIds = ['c1']
  const s = start(p, 'draft')
  try {
    const first = s.agent.read()
    const r = await s.agent.edit([{ op: 'clip.trimHead', clipId: 'c1', edge: 6 }], first.token)
    assert.equal(r.applied.filter(Boolean).length, 1, r.text)
    user([{ name: 'clip.trimHead', params: { clipId: 'c1', edge: 4.98 } }])
    assert.ok(Math.abs(S().project.clips.c1.inPoint - 0.98) < 1e-9, 'the user revealed 0.02 s')
    s.flush()
    const o = currentDraft()!.outcomes[0]
    assert.equal(o.applied, false, 'not made')
    assert.match(o.reason ?? '', /longer now than when you read it/)
  } finally {
    s.done()
  }
})

// (Phase 11b, C22: the card's "added clips" counts new footage, not the
// pieces a cut makes of a clip that was there.)
test('liveness (11b, C22): a cut in a draft adds no clip; an append adds one', async () => {
  const p = pool()
  const v1 = p.tracks.find((t) => t.kind === 'video')!
  p.clips = { c1: { id: 'c1', assetId: 'shot01', trackId: v1.id, start: 0, inPoint: 0, duration: 6, transform: { x: 960, y: 540, scale: 1, rotation: 0 }, volume: 1 } as Clip }
  v1.clipIds = ['c1']
  const s = start(p, 'draft')
  try {
    const first = s.agent.read()
    const r = await s.agent.edit([{ op: 'timeline.cutRanges', ranges: [[2, 3]] }, { op: 'clip.append', assetId: 'shot02', trackId: v1.id }], first.token)
    assert.equal(r.applied.filter(Boolean).length, 2, r.text)
    s.flush()
    assert.equal(useAgentStore.getState().draft?.summary.addedClips, 1, 'the appended shot alone')
  } finally {
    s.done()
  }
})

test('liveness (K4, phase 4A.11): the user adds a marker after the read and before the call; [3 appends, a track, a clip on that track by its name] lands 5 of 5', async () => {
  const s = start(pool(), 'direct')
  try {
    const first = s.agent.read()
    const v1 = first.project.tracks.find((t) => t.kind === 'video')!.id
    user([{ name: 'marker.add', params: { time: 1 } }])
    const r = await s.agent.edit(
      [
        { op: 'clip.append', assetId: 'shot01', trackId: v1 },
        { op: 'clip.append', assetId: 'shot02', trackId: v1 },
        { op: 'clip.append', assetId: 'shot03', trackId: v1 },
        { op: 'track.add', kind: 'video', id: 'T' },
        { op: 'clip.add', assetId: 'brol01', trackId: 'T', start: 2 }
      ],
      first.token
    )
    assert.equal(r.applied.filter(Boolean).length, 5, r.text)
    const p = S().project
    const row = p.tracks.find((t) => t.id === v1)!.clipIds.map((id) => p.clips[id]).sort((a, b) => a.start - b.start)
    assert.deepEqual(row.map((c) => [c.assetId, c.start]), [['shot01', 0], ['shot02', 6], ['shot03', 13]])
    const pic = Object.values(p.clips).find((c) => c.assetId === 'brol01')!
    assert.equal(pic.start, 2)
    assert.notEqual(pic.trackId, v1)
    assert.ok(p.markers?.some((m) => m.time === 1), "the user's marker is there")
  } finally {
    s.done()
  }
})

// ---- (b): the 10-minute talk -----------------------------------------------------

const HAM = join(__dirname, '..', '..', '..', 'testdata', 'ham')
const NAME = 'ham-10dk-tr'
const haveTalk = existsSync(join(HAM, `${NAME}.truth.json`)) && existsSync(join(HAM, `${NAME}.srt`))
const IMGS = Array.from({ length: 6 }, (_, i) => `img${i + 1}`)

function talk10(): { project: Project; cuts: [number, number][] } {
  const truth = JSON.parse(readFileSync(join(HAM, `${NAME}.truth.json`), 'utf8')) as { sure: number; words: { text: string; start: number; end: number }[]; cuts: [number, number][] }
  const p = defaultProject()
  p.name = NAME
  const a: Asset = { id: 'talkvideo', kind: 'video', name: `${NAME}.mp4`, url: 'media://x', size: 1, duration: truth.sure, width: 640, height: 360, hasAudio: true } as Asset
  p.assets = [a, ...IMGS.map(image)]
  const [v1, a1] = p.tracks
  const clip = (id: string, trackId: string, extra: Partial<Clip>): Clip => ({ id, assetId: a.id, trackId, start: 0, inPoint: 0, duration: truth.sure, transform: { x: 320, y: 180, scale: 1, rotation: 0 }, volume: 1, linkId: 'link1', ...extra }) as Clip
  p.clips = { vclip: clip('vclip', v1.id, { audioExtracted: true }), aclip: clip('aclip', a1.id, {}) }
  v1.clipIds = ['vclip']
  a1.clipIds = ['aclip']
  let k = 0
  p.captions = parseSrt(readFileSync(join(HAM, `${NAME}.srt`))).map((l, i): Caption => {
    const words: Caption['words'] = []
    while (k < truth.words.length && truth.words[k].start < l.end - 1e-3) {
      const w = truth.words[k++]
      words.push({ text: w.text, start: w.start, end: w.end })
    }
    return { ...l, id: `line${String(i).padStart(4, '0')}`, words }
  })
  return { project: p, cuts: truth.cuts }
}

/** Lines no cut touches, spread over the talk: where the pictures and the markers go. */
function linesFor(p: Project, cuts: [number, number][], at: number[]): string[] {
  const free = p.captions.filter((c) => (c.words?.length ?? 0) >= 3 && !c.manual && !cuts.some(([a, b]) => a < c.end + 0.5 && b > c.start - 0.5))
  return at.map((x) => free[Math.min(free.length - 1, Math.floor((x * free.length) / 7))].id)
}

/** The nine ops of (b), as ONE call. */
function roughCut(p: Project, cuts: [number, number][]): { ops: Op[]; lines: string[]; marks: string[] } {
  const lines = linesFor(p, cuts, [1, 2, 3, 4, 5, 6])
  const marks = linesFor(p, cuts, [0.5, 1.5, 2.5, 3.5, 4.5])
  return {
    lines,
    marks,
    ops: [
      { op: 'apply', result: 'r1' },
      { op: 'apply', result: 'r2' },
      { op: 'broll.place', look: 'card', placements: lines.map((l, i) => ({ assetId: IMGS[i], start: `${l}#0`, end: `${l}#1>` })) },
      { op: 'caption.setStyle', patch: { fontSize: 72 } },
      ...marks.map((l, i) => ({ op: 'marker.add', time: `${l}#0`, note: `m${i}` }))
    ]
  }
}

/** The pictures lie on the words they were placed by, the markers too (in
 *  `p`, whatever was cut): the largest distance, in seconds. */
function offWords(p: Project, lines: string[], marks: string[]): { pictures: number; worst: number } {
  const word = (id: string, i: number): { start: number; end: number } => p.captions.find((c) => c.id === id)!.words![i]
  let worst = 0
  const pics = IMGS.map((a) => Object.values(p.clips).find((c) => c.assetId === a)).filter((c): c is Clip => !!c)
  for (const c of pics) {
    const l = lines[IMGS.indexOf(c.assetId)]
    worst = Math.max(worst, Math.abs(c.start - word(l, 0).start), Math.abs(c.start + c.duration - word(l, 1).end))
  }
  marks.forEach((l, i) => {
    const m = p.markers?.find((x) => x.note === `m${i}`)
    assert.ok(m, `marker m${i}`)
    worst = Math.max(worst, Math.abs(m.time - word(l, 0).start))
  })
  return { pictures: pics.length, worst }
}

const UNRELATED: { name: string; params: unknown }[][] = [
  [{ name: 'marker.add', params: { time: 2 } }],
  [{ name: 'clip.setVolume', params: { clipId: 'aclip', volume: 0.8 } }],
  [{ name: 'text.add', params: { time: 3, text: 'Note to self' } }],
  [{ name: 'caption.setStyle', params: { patch: { outlineWidth: 6 } } }]
]

test('liveness (b): cuts, six pictures on words, a style and five markers in ONE call; an unrelated edit of the user\'s before the accept leaves all six pictures', { skip: !haveTalk }, async () => {
  const { project, cuts } = talk10()
  for (const edit of UNRELATED) {
    const s = start(project, 'draft')
    try {
      const first = s.agent.read()
      s.agent.analysis(first, cuts.slice(0, 30))
      s.agent.analysis(first, cuts.slice(30))
      const plan = roughCut(first.project, cuts)
      const r = await s.agent.edit(plan.ops, first.token)
      assert.equal(r.applied.filter(Boolean).length, plan.ops.length, r.text)
      assert.equal(s.agent.reads, 1)
      // The user edits something that has nothing to do with it, AFTER the
      // agent's last call; then accepts.
      user(edit)
      s.flush()
      const d = currentDraft()!
      // (Phase 4A.11, K1b: the volume of the talk's own clip, which the cuts
      // only shorten, is lost by none of them: nothing falls out.)
      const fell = d.outcomes.filter((o) => !o.applied || o.left?.length).map((o) => [o.name, o.reason ?? o.notes?.[0]])
      assert.deepEqual(fell, [], 'nothing falls out of the draft')
      const out = acceptDraft(undefined, 'now')
      assert.deepEqual(out.dropped, [])
      const live = S().project
      const at = offWords(live, plan.lines, plan.marks)
      assert.equal(at.pictures, 6, 'six of six pictures')
      assert.ok(at.worst < 1e-6, `pictures and markers on their words (${at.worst})`)
      const gone = cuts.reduce((n, [a, b]) => n + b - a, 0)
      assert.ok(Math.abs(projectDuration(live) - (projectDuration(project) - gone)) < 0.5, 'the cuts are made')
    } finally {
      s.done()
    }
  }
})

test('liveness: straight onto the timeline, the user edits something unrelated while the agent thinks: the pictures land (at least 18 of 20)', { skip: !haveTalk }, async () => {
  const { project, cuts } = talk10()
  let landed = 0
  for (let i = 0; i < 20; i++) {
    const s = start(project, 'direct')
    try {
      const first = s.agent.read()
      const lines = linesFor(first.project, cuts, [1, 2, 3, 4, 5, 6])
      // (Between the read and the call: a marker somewhere, a volume, a
      // title, a style — each time another.)
      const edit = i % 4 === 0 ? [{ name: 'marker.add', params: { time: 1 + i * 7 } }] : UNRELATED[i % 4]
      user(edit)
      const r = await s.agent.edit([{ op: 'broll.place', look: 'card', placements: lines.map((l, k) => ({ assetId: IMGS[k], start: `${l}#0`, end: `${l}#1>` })) }], first.token)
      if (r.applied[0]) {
        const at = offWords(S().project, lines, [])
        assert.equal(at.pictures, 6)
        assert.ok(at.worst < 1e-6, 'on their words')
        landed++
      }
    } finally {
      s.done()
    }
  }
  assert.ok(landed >= 18, `${landed} of 20 landed`)
})

test('liveness (T1, phase 4A.11): five pictures put on words with broll.place in a draft; the user changes an unrelated setting; accepted: 5 of 5', { skip: !haveTalk }, async () => {
  const { project, cuts } = talk10()
  for (const edit of [UNRELATED[1], [{ name: 'clip.setOpacity', params: { clipId: 'vclip', opacity: 0.9 } }]]) {
    const s = start(project, 'draft')
    try {
      const first = s.agent.read()
      const lines = linesFor(first.project, cuts, [1, 2, 3, 4, 5])
      const r = await s.agent.edit([{ op: 'broll.place', look: 'full', placements: lines.map((l, k) => ({ assetId: IMGS[k], start: `${l}#0`, end: `${l}#1>` })) }], first.token)
      assert.equal(r.applied[0], true, r.text)
      user(edit)
      s.flush()
      const out = acceptDraft(undefined, 'now')
      assert.deepEqual(out.dropped, [])
      const at = offWords(S().project, lines, [])
      assert.equal(at.pictures, 5, 'five of five pictures')
      assert.ok(at.worst < 1e-6, 'on their words')
    } finally {
      s.done()
    }
  }
})
