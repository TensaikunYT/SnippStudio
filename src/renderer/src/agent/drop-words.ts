// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// Why an operation of a draft is not applied, for the USER (D22, worker C,
// the second pass). The reasons the replay gives (agent/replay.ts) are words
// for the agent: English, exact, with ids and what to send next. The list of
// what is not applied showed those very sentences to the user. This reads a
// reason's sort off its words and names it; the page says the sort's own
// plain sentence in the user's language (ui/strings-d22-c.ts, "d22c.drop.*"),
// with the agent's sentence one press away ("Details"). What goes to the
// agent is not touched. A reason of no known sort is "other": a plain
// general sentence, and the details. Pure (src/test/d22-c-drops.test.ts).

export type DropKind =
  | 'later'
  | 'scope'
  | 'region'
  | 'clipLock'
  | 'dependsOn'
  | 'internal'
  | 'locked'
  | 'magnet'
  | 'lands'
  | 'ownEarlier'
  | 'youChanged'
  | 'filmChanged'
  | 'already'
  | 'gone'
  | 'pieces'
  | 'twice'
  | 'words'
  | 'wouldAlso'
  | 'edge'
  | 'noChoice'
  | 'other'

/** The sorts, each with what gives it away, in the order they are tried (a
 *  reason that says two things is the first of them). */
const SORTS: readonly [DropKind, RegExp][] = [
  // (Kept with the reason it first had: read before that reason.)
  ['later', /dropped before your later edit/i],
  // (The program's own limits: agent/scope.ts. Before "locked", which is a
  // track's.)
  ['scope', /what the user limited this work to/i],
  // (Another worker's region: agent/regions.ts.)
  ['region', /inside the region of worker "/i],
  ['clipLock', /the user locked clip [\w-]+ against agents/i],
  ['dependsOn', /which it was written on, was not accepted|needs what op #\d+ of this call makes/i],
  ['internal', /internal error/i],
  ['locked', /\b(is|was) locked\b|locked or unlocked|locked now|locked track/i],
  ['magnet', /magnet/i],
  ['lands', /would land on|not named|push:true/i],
  ['ownEarlier', /an earlier edit of yours|your own op #/i],
  ['filmChanged', /depends on how everything lies|is not as it was when this was sent|would not do now what it did/i],
  // (Removed by the user: said as "no longer there", not as "you changed it".)
  ['gone', /no longer on the timeline|content was removed/i],
  ['youChanged', /\(not by you\)|something you did not make|after you read it|since you read it/i],
  ['already', /^nothing (left )?to do|already (cut|ends|is)|changes nothing|is as this would make it|a cut at its point already/i],
  ['twice', /more than once|lie over each other|no one meaning|is there twice/i],
  ['words', /\bword\b/i],
  ['gone', /no longer on the timeline|content was removed|is gone|was removed|no such|there is no /i],
  ['pieces', /cut in pieces|cut in two|part of a longer clip|cut or trimmed|is longer now|edges? (is|are) (gone|not)/i],
  ['edge', /within 0\.05 s of a clip edge|never shorter than|cannot trim that far/i],
  ['wouldAlso', /would now also change|to another value than|would leave footage|would lie over|would reach footage|would take it away|into other footage|lies under it now/i],
  ['noChoice', /no item is chosen/i]
]

export const DROP_KINDS: readonly DropKind[] = [...new Set(SORTS.map(([k]) => k)), 'other']

/** The sort of a reason the replay gave. */
export function dropKind(reason: string): DropKind {
  for (const [kind, re] of SORTS) if (re.test(reason)) return kind
  return 'other'
}

/** The key of the sentence the user reads for it. */
export const dropKey = (reason: string): `d22c.drop.${DropKind}` => `d22c.drop.${dropKind(reason)}`

/**
 * The team mode (EKIP-PLAN.md): an op one worker wrote that dropped because
 * ANOTHER worker's call changed the timeline first (the phase 4A.8 rule,
 * untouched: the reason names that call, "your call #N"). Answers that
 * worker ('' for the agent's own unlabelled calls; `workerOf` answers the
 * same, and null for a call the draft no longer holds), or undefined when
 * the reason names no call (or one not known), or the call is the op's own
 * worker's. Only the user's sentence says it; what the agent is told is not
 * changed.
 */
export function collidedWith(reason: string, own: string | undefined, workerOf: (seq: number) => string | null): string | undefined {
  const m = /\byour call #(\d+)\b/.exec(reason)
  if (!m) return undefined
  const other = workerOf(Number(m[1]))
  if (other === null) return undefined
  return other === (own ?? '') ? undefined : other
}

/** A draft's call as the collision reading needs it: its worker ('' for an
 *  unlabelled one) and whether one of its ops may move or cut (not only add
 *  or set a field). */
export interface CallMoves {
  seq: number
  as: string
  moves: boolean
}

/**
 * The same, read off an edit's ANSWER (an op dropped at once, when the call
 * came: "an earlier edit of yours … moved or cut what was there"). The
 * answer names the call ("your call #N") or not ("in an earlier call");
 * then the calls the draft got after the version the op was written on
 * (`held`: the calls that version held; undefined: none) that may move or
 * cut are the candidates, and a worker is named only when they are all one
 * other worker's. Nothing is guessed: two workers, none, or the op's own:
 * undefined.
 */
export function collidedAfter(answer: string, own: string | undefined, calls: readonly CallMoves[], held: readonly number[] | undefined): string | undefined {
  if (!/an earlier edit of yours/.test(answer) || /\bof this call\)/.test(answer)) return undefined
  const named = collidedWith(answer, own, (n) => calls.find((c) => c.seq === n)?.as ?? null)
  if (named !== undefined || /\byour call #\d+\b/.test(answer)) return named
  const after = calls.filter((c) => c.moves && !(held ?? []).includes(c.seq))
  const who = [...new Set(after.map((c) => c.as))]
  return who.length === 1 && who[0] !== (own ?? '') ? who[0] : undefined
}

/** The worker whose region a dropped op would have changed (the reason
 *  names it), or undefined. */
export const regionOwner = (reason: string): string | undefined => /inside the region of worker "([^"]+)"/.exec(reason)?.[1]
