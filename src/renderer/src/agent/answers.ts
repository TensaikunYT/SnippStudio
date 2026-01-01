// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// How the analyze and edit answers are worded (SnippStudio phase 4A), pure:
// the budget tests (src/test/agent-budget.test.ts) measure exactly these
// lines on the test material.
import type { CommandCall } from '../commands'
import type { Project } from '../types'
import { projectDuration } from '../types'
import type { FlatWord } from '../analysis/words'
import type { RepeatFinding } from '../analysis/repeats'
import { clock, sec } from './format'
import { PRODUCT_NAME } from '../../../shared/product'

/** One finding: the line the agent reads and what applying it means. */
export interface Item {
  line: string
  /** Times of the result's version (the timeline's tracing in 4B). */
  range?: [number, number]
  /** The range applying this item cuts. */
  cut?: [number, number]
  /** A retake: the take this cut is FOR (it is kept). The cut is made only
   *  while that take is still on the timeline. */
  keep?: [number, number]
  data?: unknown
  /** Not sure (a sound no word covers): applied only when named in
   *  `include` (or `only`). */
  uncertain?: boolean
  /** A heading of its own for a run of items (printed before the first). */
  heading?: string
}

export interface AnalysisResult {
  id: string
  kind: string
  /** The version it was measured on (its times are that version's). */
  token: string
  /** That version's project: applying the result reads what its ranges
   *  mean (as content) off it, whenever it is applied. */
  project?: Project
  /** The live version that project stood on ("did anyone change the film
   *  since" is asked from here when the result is applied). */
  live?: number
  head: string
  items: Item[]
  /** The commands for the chosen items; absent when there is nothing to apply. */
  apply?: (items: Item[]) => CommandCall[]
  /** Lines after the list (a summary, a hint). */
  tail?: string[]
}

export const silenceLine = (a: number, b: number): string => `${sec(a)}-${sec(b)}`
/** A filler word: its seconds and its address (a line without word times
 *  has no address: its seconds only, spread over the line). */
export const fillerLine = (w: FlatWord): string => `${sec(w.start)}-${sec(w.end)} "${w.text}"${w.wordIdx >= 0 ? ` ${w.captionId}#${w.wordIdx}${w.estimated ? ' (guessed times)' : ''}` : ' (no word times)'}`
export const islandLine = (a: number, b: number): string => `${sec(a)}-${sec(b)} sound, no word (uncertain)`
/** A retake: "=" only when the two takes are word for word the same;
 *  otherwise how alike they are and the words that differ (phase 4A.10, D2:
 *  "It was the best… / It was the worst…" is not "A = B"). */
export function repeatLine(f: RepeatFinding, words: readonly FlatWord[]): string {
  const said = words.slice(f.firstWords[0], Math.min(f.firstWords[1] + 1, f.firstWords[0] + 3)).map((w) => w.text).join(' ')
  const [a, b] = f.differ ?? [[], []]
  const few = (x: readonly string[]): string => `${x.slice(0, 3).join(' ')}${x.length > 3 ? ' …' : ''}`
  const same = !a.length && !b.length
  // (Why it is not sure, phase 4A.11, N1: "gap 128.6 s", "ends with ?"…)
  const why = (f.why ?? []).filter(Boolean)
  return `${sec(f.first[0])}-${sec(f.first[1])} ${same ? '=' : `~${f.similarity.toFixed(2)}`} ${sec(f.second[0])}… ${f.words}w "${said.slice(0, 14)}"${same ? '' : ` (${few(a)} → ${few(b)})`}${why.length ? ` (${why.join(', ')})` : ''}`
}

/** Speech with no words written: the stretch (the one cut), and the
 *  sentence it comes after. No "=": what is said in it is not known. */
export const unwrittenLine = (start: number, a: number, b: number, said: string): string => `${sec(a)}-${sec(b)} speech, no words (after ${sec(start)}… "${said.slice(0, 14)}")`
export const UNWRITTEN_HEADING = 'Speech with no words written (may be a retake, a filler or missed speech; cut only with "include":[n…]):'

export const keywordLine =(lineId: string, text: string, idx: readonly number[]): string => {
  const words = text.trim().split(/\s+/)
  return `${lineId} ${idx.map((i) => `${i}:${words[i] ?? '?'}`).join(' ')}`
}
export const imageLine = (name: string, a: number, b: number, said: string): string => `${name} ${sec(a)}-${sec(b)} "${said.slice(0, 24)}"`
export const brollLine = (name: string, a: number, b: number, said: string): string => `${name} ${sec(a)}-${sec(b)} "${said.slice(0, 20)}"`
export const preflightLine = (x: { kind: string; at: number; end?: number; clipId?: string; text: string }): string =>
  `${x.kind} ${sec(x.at)}${x.end !== undefined ? `-${sec(x.end)}` : ''}${x.clipId ? ` ${x.clipId}` : ''} ${x.text.slice(0, 40)}`
export const loudnessLine = (clipId: string, a: number, b: number, lufs: number, peak: number): string => `${clipId} ${sec(a)}-${sec(b)} ${lufs.toFixed(1)} LUFS, peak ${peak.toFixed(1)} dB`

/** The answer an agent reads. */
export function resultText(r: AnalysisResult, project: Project): string {
  const lines = [`${r.id} ${r.kind} (v ${r.token}): ${r.head}`]
  r.items.forEach((it, i) => {
    if (it.heading) {
      if (i === 0 || r.items[i - 1].heading !== it.heading) lines.push(it.heading)
    } else if (it.uncertain && (i === 0 || !r.items[i - 1].uncertain || r.items[i - 1].heading)) lines.push('Uncertain (applied only with "include":[n…]):')
    lines.push(`${i + 1} ${it.line}`)
  })
  if (r.tail) lines.push(...r.tail)
  if (r.apply && r.items.some((it) => !it.uncertain)) lines.push(`Apply: edit {"op":"apply","result":"${r.id}"}`)
  else if (r.apply && r.items.length) lines.push(`Apply: edit {"op":"apply","result":"${r.id}","include":[…]}`)
  if (!r.items.length && projectDuration(project) <= 0) lines.push('The timeline is empty.')
  return lines.join('\n')
}

/** What became of one op (replay.ts Outcome, as the answers need it). */
export interface OpOutcome {
  index: number
  sent?: number
  /** The other ops (as sent) made with it as one move. */
  also?: number[]
  command?: string
  name: string
  applied: boolean
  reason?: string
  notes?: string[]
  result?: unknown
  cuts?: [number, number][]
  /** A setting: how much it reached ("1 clip, 0.00–2.76 s"). */
  scope?: string
}

/** A short label for the user and the activity log: what was applied. */
export function labelOf(outcomes: readonly OpOutcome[]): string {
  const counts = new Map<string, number>()
  let cuts = 0
  let seconds = 0
  for (const o of outcomes) {
    if (!o.applied) continue
    const name = o.cuts ? 'timeline.cutRanges' : o.command ?? o.name
    counts.set(name, (counts.get(name) ?? 0) + 1)
    for (const [a, b] of o.cuts ?? []) {
      cuts++
      seconds += b - a
    }
  }
  if (!counts.size) return 'nothing'
  // (A setting says how much it reached: one piece of a talk cut in six is
  // not "the talk".)
  const scope = new Map<string, string>()
  for (const o of outcomes) if (o.applied && o.scope && !o.cuts) scope.set(o.command ?? o.name, scope.has(o.command ?? o.name) ? '' : o.scope)
  return [...counts].map(([name, k]) => (name === 'timeline.cutRanges' ? `cut ${cuts} range${cuts === 1 ? '' : 's'} (${sec(seconds)} s)` : `${name}${k > 1 ? ` ×${k}` : scope.get(name) ? ` (${scope.get(name)})` : ''}`)).join(', ')
}

/** New ids the commands returned (a clip, a title, a track…), for the answer. */
export function madeIds(results: readonly unknown[]): string[] {
  const out: string[] = []
  const take = (v: unknown): void => {
    if (typeof v === 'string' && v.length >= 6 && v.length <= 40) out.push(v)
    else if (Array.isArray(v)) v.forEach(take)
    else if (v && typeof v === 'object') {
      const o = v as Record<string, unknown>
      for (const k of ['id', 'clipId', 'clipIds', 'trackId']) if (k in o) take(o[k])
    }
  }
  results.forEach(take)
  return [...new Set(out)]
}

/** The ranges the ops cut, said as information (each list in the times of
 *  the timeline as it was when that op ran). */
export function cutLines(outcomes: readonly OpOutcome[], moved = false): string[] {
  const lists = outcomes.filter((o) => o.applied && o.cuts?.length).map((o) => o.cuts!)
  if (!lists.length) return []
  if (lists.length > 1) return [`Cut in ${lists.length} lists, ${lists.reduce((n, l) => n + l.length, 0)} ranges (each list in the times the one before left); read again for the new times.`]
  const flat = lists[0]
  const shown = flat.slice(0, 30).map(([a, b]) => `[${sec(a)},${sec(b)}]`).join(' ')
  // (An older base, a draft with earlier cuts: the footage was found where it
  // is now. These are NOT the seconds the agent sent.)
  return [`Cut (${moved ? 'where that footage was found, NOT the seconds you sent' : 'where that footage was'}; everything after a cut moved earlier by it): ${shown}${flat.length > 30 ? ` +${flat.length - 30}` : ''}`]
}

/** The ops that were dropped, grouped by op and reason. */
export function dropLines(outcomes: readonly OpOutcome[]): string[] {
  const groups = new Map<string, number[]>()
  for (const o of outcomes) {
    if (o.applied) continue
    // (A reason that starts with the command's name says it once: phase
    // 4A.10, contract#11, "clip.setVolume: clip.setVolume: …".)
    let why = o.reason ?? 'dropped'
    for (const n of [o.name, o.command]) if (n && why.startsWith(`${n}: `)) why = why.slice(n.length + 2)
    const key = `${o.name}: ${why}`
    groups.set(key, [...new Set([...(groups.get(key) ?? []), (o.sent ?? o.index) + 1, ...(o.also ?? []).map((n) => n + 1)])].sort((a, b) => a - b))
  }
  const lines = [...groups].map(([key, at]) => `${at.slice(0, 12).map((n) => `#${n}`).join(' ')}${at.length > 12 ? ` +${at.length - 12}` : ''} ${key}`)
  for (const o of outcomes) if (o.applied) for (const n of (o.notes ?? []).slice(0, 6)) lines.push(`#${(o.sent ?? o.index) + 1} ${o.name}, ${n}`)
  return lines
}

/**
 * What each applied op made, as the "New:" line says it (phase 4A.11, T2,
 * T8, T9): the name it was given, the id, and — in brackets — the op's
 * number, where it lies (its track and span, a title's or a marker's time),
 * "past the end" when it lies after the footage ends, and "same as <id>"
 * when the very same thing was there already (sent twice).
 */
export function newEntries(outcomes: readonly OpOutcome[], names: readonly (readonly [string, string])[], after: Project, before: Project, read?: Project): string[] {
  const called = new Map(names.map(([name, id]) => [id, name]))
  const footage = Math.max(0, ...Object.values(before.clips).map((c) => c.start + c.duration))
  const out: string[] = []
  const seenIds = new Set<string>()
  const twinOf = <T extends { id: string }>(list: readonly T[] | undefined, x: T, same: (a: T, b: T) => boolean): string | undefined => (list ?? []).find((y) => y.id !== x.id && same(x, y))?.id
  const plain = (o: object, ...skip: string[]): string => JSON.stringify(o, (k, v) => (skip.includes(k) ? undefined : typeof v === 'number' ? Math.round(v * 1e4) / 1e4 : v))
  for (const o of outcomes) {
    if (!o.applied) continue
    for (const id of madeIds([o.result])) {
      if (seenIds.has(id)) continue
      seenIds.add(id)
      const n = (o.sent ?? o.index) + 1
      let where = ''
      let at = -Infinity
      let twin: string | undefined
      const clip = Object.hasOwn(after.clips, id) ? after.clips[id] : undefined
      const line = after.captions.find((c) => c.id === id)
      const mark = after.markers?.find((m) => m.id === id)
      const block = after.templates?.find((t) => t.id === id)
      const track = after.tracks.find((t) => t.id === id)
      if (clip) {
        where = `${after.tracks.find((t) => t.id === clip.trackId)?.name ?? clip.trackId} ${sec(clip.start)}–${sec(clip.start + clip.duration)}`
        at = clip.start
        twin = Object.values(before.clips).find((c) => c.assetId === clip.assetId && c.trackId === clip.trackId && Math.abs(c.start - clip.start) < 1e-3 && Math.abs(c.duration - clip.duration) < 1e-3)?.id
      } else if (line) {
        where = `title ${sec(line.start)}–${sec(line.end)}`
        at = line.start
        twin = twinOf(before.captions, line, (a, b) => plain(a, 'id') === plain(b, 'id'))
      } else if (mark) {
        where = `marker ${sec(mark.time)}`
        at = mark.time
        twin = twinOf(before.markers, mark, (a, b) => plain(a, 'id', 'color') === plain(b, 'id', 'color'))
      } else if (block) {
        where = `G lane ${sec(block.start)}–${sec(block.start + (block.duration ?? 0))}`
        at = block.start
      } else if (track) where = `track ${track.kind}`
      const parts = [`#${n}${where ? ` ${where}` : ''}`]
      if (at > footage + 1e-6 && footage > 0) parts.push(`past the end, ${sec(footage)}`)
      // (Not in the version read: a call of the agent's own since made it.)
      const inRead = (id: string): boolean => !read || read.captions.some((c) => c.id === id) || !!read.markers?.some((m) => m.id === id) || Object.hasOwn(read.clips, id)
      if (twin) parts.push(`same as ${twin} ${inRead(twin) ? 'already there' : 'your previous call made'}`)
      out.push(`${called.has(id) ? `${called.get(id)}=` : ''}${id} (${parts.join(', ')})`)
    }
  }
  return out
}

/** The edit answer. It names no version: the next edit's `base` is the v of
 *  a READ (the seconds of an older read are not this project's). */
/** A change of the film's length this big is said as a warning: the
 *  agent (and the user) see at once when a time was misread (DENEME-2: three
 *  moves "10 s later" made the film 200 s longer). */
export function bigJump(before: number, after: number): boolean {
  const d = Math.abs(after - before)
  return d >= 30 && d >= 0.25 * Math.max(before, 1)
}

/** What one edit call moved, clip by clip (DENEME-2, worker T): where each
 *  clip went, and linked partners left behind. `before` and `after` are the
 *  project before the call and after it (the draft's, or the live one). */
export function moveLines(before: Project, after: Project): string[] {
  const moved: string[] = []
  const stayed: string[] = []
  for (const c of Object.values(after.clips)) {
    const was = before.clips[c.id]
    if (!was || Math.abs(was.start - c.start) < 1e-6) continue
    const d = c.start - was.start
    moved.push(`${c.id} ${sec(was.start)}→${sec(c.start)} (${d > 0 ? '+' : ''}${sec(d)} s)`)
    if (!c.linkId) continue
    for (const o of Object.values(after.clips)) {
      const w = before.clips[o.id]
      if (o.id === c.id || o.linkId !== c.linkId || !w || Math.abs(w.start - o.start) > 1e-6 || Math.abs(w.start - was.start) > 1e-6) continue
      if (!stayed.includes(o.id)) stayed.push(o.id)
    }
  }
  const lines: string[] = []
  if (moved.length) lines.push(`Moved: ${moved.slice(0, 12).join(', ')}${moved.length > 12 ? ` +${moved.length - 12}` : ''}`)
  if (stayed.length) lines.push(`Linked partner(s) left in place, out of step now: ${stayed.slice(0, 12).join(', ')} (linkAV false was sent; without it they move together)`)
  return lines
}

export function editAnswer(o: { draft: boolean; created?: boolean; label: string; pending?: number; length: number; before?: number; outcomes: readonly OpOutcome[]; moved?: boolean; names?: readonly (readonly [string, string])[]; made?: readonly string[]; changes?: readonly string[] }): string {
  const lines: string[] = []
  const dropped = dropLines(o.outcomes)
  // "Read again" is said only where reading again helps (not for an op that
  // had nothing left to do, a name that is no media, a range too short).
  const reread = o.outcomes.some((x) => !x.applied && /read again|reading again|after you read|when you read|no longer on the timeline|is not as you read/.test(x.reason ?? ''))
  if (!o.outcomes.some((x) => x.applied)) return ['Nothing applied: every op was dropped.', ...dropped, ...(reread ? ['Read again (project, transcript) before sending more.'] : [])].join('\n')
  if (o.draft) {
    lines.push(`Draft${o.created ? ' started' : ''}: ${o.label}. ${o.pending} call${o.pending === 1 ? '' : 's'} wait for the user (accept / reject). Length ${sec(o.length)} s (${clock(o.length)}).`)
    lines.push(`This is a draft: nothing changed on the timeline yet; the user accepts it in ${PRODUCT_NAME}.`)
  } else lines.push(`Applied (one undo step): ${o.label}. Length ${sec(o.before ?? o.length)} → ${sec(o.length)} s (${clock(o.length)}).`)
  if (o.before !== undefined && bigJump(o.before, o.length)) lines.push(`Warning: this edit makes the film ${o.length > o.before ? 'longer' : 'shorter'} by ${sec(Math.abs(o.length - o.before))} s (${clock(o.before)} → ${clock(o.length)}): check the times are what you meant (start is a time on the timeline, by a shift).`)
  if (o.changes?.length) lines.push(...o.changes)
  const made = o.made ?? madeIds(o.outcomes.filter((x) => x.applied).map((x) => x.result))
  const called = new Map((o.names ?? []).map(([name, id]) => [id, name]))
  if (made.length) lines.push(`New: ${made.slice(0, 40).map((x) => (o.made ? x : called.has(x) ? `${called.get(x)}=${x}` : x)).join(', ')}${made.length > 40 ? ` +${made.length - 40} (project lists them)` : ''}`)
  lines.push(...cutLines(o.outcomes, o.moved))
  if (dropped.length) lines.push('Dropped (the rest was applied):', ...dropped)
  // (Ops applied AFTER a dropped one: what the dropped ones meant — "the
  // first track of its kind", a time — may be something else now.)
  const firstDrop = Math.min(...o.outcomes.filter((x) => !x.applied && /read again|reading again/.test(x.reason ?? '')).map((x) => x.sent ?? x.index))
  if (o.outcomes.some((x) => x.applied && (x.sent ?? x.index) > firstDrop)) lines.push('Ops after the dropped ones were applied: plan the dropped ones again from a new read (do not resend them as they are).')
  return lines.join('\n')
}
