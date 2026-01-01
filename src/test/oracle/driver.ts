// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// How the random sequences reach the agent's draft core (SnippStudio phase
// 4A.9, plan K25): a thin driver, so the same generator and the same oracle
// measure the core whatever its inside is. This file is the ONLY place of the
// oracle that imports the agent modules.
//
// Phase 4A.10 (F3, F8): several agents (two sessions of one program and a
// second program), and the projects BETWEEN the ops of a materialisation (a
// replay of the first n ops), so every op is judged on the project it met.
import '../dom-stub'
import { useStore } from '../../renderer/src/state/store'
import type { Project } from '../../renderer/src/types'
import { runEdit, type EditContext } from '../../renderer/src/agent/edit'
import { acceptDraft, acceptPreview, contextFor, currentDraft, draftState, rejectDraft, removeRange, reviveOp, takeNews, view, watchLive, type AcceptPlan, type Entry } from '../../renderer/src/agent/drafts'
import { replay, type ReplayContext } from '../../renderer/src/agent/replay'
import { useAgentStore } from '../../renderer/src/agent/store'
import { setSeams } from '../../renderer/src/agent/seams'
import type { AnalysisResult, Item } from '../../renderer/src/agent/answers'
import type { CommandCall } from '../../renderer/src/commands'

export interface Seen {
  project: Project
  token: string
}

export interface EditReport {
  /** The call failed whole: nothing was applied. */
  error?: string
  /** Ops (0-based) the answer says were not applied. */
  refused: Set<number>
  /** The draft entry the call became (draft mode). */
  seq?: number
  answer: string
  /** Why each dropped op was dropped (when the core says). */
  reasons?: Map<number, string>
  /** The ranges of a cut that were left out, said by the core. */
  left?: Map<number, number[]>
  /** The ops in the order the core ran them (a materialisation: Mat). */
  mat?: Mat
}

/** One materialisation: a live project and the ops replayed on it, in
 *  order. `at(n)` is the project the n-th op met (the first n ops replayed);
 *  `at(ops.length)` is what came out. */
export interface Mat {
  L: Project
  ops: { seq: number; index: number }[]
  at: (n: number) => Project
  /** All the ops replayed once more on L (not what was kept of the first
   *  time): the same film, the same ids, or the replay is not one. */
  again: () => Project
}

export interface DraftNow {
  project: Project
  /** The live project it was replayed on. */
  on: Project
  /** Which agent's it is. */
  who: number
  seqs: number[]
  /** Is op `op` (0-based) of entry `seq` applied in the draft as it stands? */
  applied: (seq: number, op: number) => boolean
  reason?: (seq: number, op: number) => string | undefined
  left?: (seq: number, op: number) => number[] | undefined
  /** Ops the core holds as dropped for good (the user may bring them back). */
  retired: { seq: number; index: number }[]
  mat: Mat
}

export interface Accepted {
  adopted: boolean
  /** Nothing was adopted because what would be is not what the card showed. */
  changed?: boolean
  applied: (seq: number, op: number) => boolean
  left?: (seq: number, op: number) => number[] | undefined
  mat?: Mat
}

export interface Driver {
  reset(project: Project, mode: 'draft' | 'direct'): void
  /** The user's setting: agent edits wait as a draft, or land at once. */
  setMode(mode: 'draft' | 'direct'): void
  /** How many agents there are (0 and 1: two sessions of one program; 2:
   *  another program). */
  agents: number
  /** What the agent reads now (its draft when it has one). */
  read(who?: number): Seen
  /** Registers an analysis measured on `seen` whose items cut `ranges`
   *  (`keeps`: for a retake, the take the cut is kept FOR); returns the
   *  result id for {"op":"apply"}. */
  analysis(seen: Seen, ranges: [number, number][], who?: number, keeps?: ([number, number] | null)[]): string
  edit(ops: Record<string, unknown>[], base: string, who?: number): Promise<EditReport>
  /** The draft after the delayed replay ran, or null. */
  draft(): DraftNow | null
  /** What the card would show (to accept with: nothing is adopted when it
   *  no longer holds). */
  preview(seqs?: number[]): { shown: unknown; project: Project } | null
  accept(seqs?: number[], shown?: unknown): Accepted
  /** Takes one range out of a cut list of the draft; false when the core
   *  cannot. */
  removeRange?: (seq: number, op: number, range: number) => boolean
  /** The user brings back an op dropped for good. */
  revive?: (seq: number, op: number) => boolean
  reject(): void
  /** Runs the delayed replay now. */
  flush(): void
  dispose(): void
}

const S = useStore.getState

let drivers = 0

/** The core as it is in this tree. */
export function makeDriver(runSeed: number): Driver {
  let n = 0
  const queue: (() => void)[] = []
  const restore = setSeams({
    newId: () => `d${(runSeed >>> 0).toString(36)}${(n++).toString(36).padStart(5, '0')}`.slice(0, 13).padEnd(13, '0'),
    entrySeed: (seq) => (runSeed * 31 + seq * 7919) | 0,
    schedule: (fn) => {
      queue.push(fn)
      return () => void queue.splice(queue.indexOf(fn), 1)
    },
    now: () => 1_700_000_000_000 + n
  })
  const unwatch = watchLive()
  const tag = `${runSeed}-${++drivers}`
  const AGENTS = [
    { session: 's1', client: `oracle-${tag}` },
    { session: 's2', client: `oracle-${tag}` },
    { session: 's3', client: `other-${tag}` }
  ]
  const results = AGENTS.map(() => new Map<string, AnalysisResult>())
  let resultSeq = 0
  const ctx = (who: number): EditContext => ({ session: AGENTS[who].session, client: AGENTS[who].client, results: results[who], beforeFirstEdit: async () => undefined, told: () => undefined })
  const flush = (): void => {
    while (queue.length) queue.shift()!()
  }
  const key = (seq: number, op: number): string => `${seq}:${op}`
  const whoOf = (session: string): number => Math.max(0, AGENTS.findIndex((a) => a.session === session))
  /** The first n ops of `entries` (in order), as entries. */
  const prefix = (entries: readonly Entry[], count: number): Entry[] => {
    const out: Entry[] = []
    let left = count
    for (const e of entries) {
      if (left <= 0) break
      out.push(left >= e.ops.length ? e : { ...e, ops: e.ops.slice(0, left) })
      left -= e.ops.length
    }
    return out
  }
  /** The session's context as it was before the materialisation (what
   *  landed since must not change what replaying its ops gives). */
  const snap = (who: number): (() => ReplayContext) => {
    const c = contextFor(AGENTS[who].session, AGENTS[who].client)
    return () => ({ ...c, own: new Map(c.own), made: [...(c.made ?? [])], moved: [...(c.moved ?? [])] })
  }
  const matOf = (L: Project, entries: readonly Entry[], who: number, final: Project, ctx0: () => ReplayContext = snap(who)): Mat => {
    const ops = entries.flatMap((e) => e.ops.map((_, index) => ({ seq: e.seq, index })))
    const cache = new Map<number, Project>([[0, L], [ops.length, final]])
    return {
      L,
      ops,
      at: (k) => {
        let p = cache.get(k)
        if (!p) cache.set(k, (p = replay(L, prefix(entries, k), ctx0()).project))
        return p
      },
      again: () => replay(L, entries, ctx0()).project
    }
  }
  return {
    agents: AGENTS.length,
    reset(project, mode) {
      rejectDraft()
      queue.length = 0
      for (const r of results) r.clear()
      S().loadProject(project)
      useAgentStore.getState().setMode(mode)
    },
    setMode(mode) {
      useAgentStore.getState().setMode(mode)
    },
    read(who = 0) {
      flush()
      const v = view(undefined, AGENTS[who].client)
      // (As the project tool does: the read tells the agent its draft's news.)
      takeNews(AGENTS[who].session)
      return { project: v.project, token: v.token }
    },
    analysis(at, ranges, who = 0, keeps) {
      const id = `r${++resultSeq}`
      const items: Item[] = ranges.map((r, i) => ({ line: `${r[0]}-${r[1]}`, range: r, cut: r, ...(keeps?.[i] ? { keep: keeps[i] } : {}) }) as Item)
      // (As the analyze tool does: the live version the measured project stands on.)
      results[who].set(id, { id, kind: 'silences', token: at.token, project: at.project, live: S().projectVersion, head: '', items, apply: (chosen) => (chosen.length ? [{ name: 'timeline.cutRanges', params: { ranges: chosen.map((i) => i.cut!) } } as CommandCall] : []) })
      return id
    },
    async edit(ops, base, who = 0) {
      flush()
      const L = S().project
      const hadDraft = !!currentDraft()
      const ctx0 = snap(who)
      try {
        const r = await runEdit({ ops, base }, ctx(who))
        takeNews(AGENTS[who].session)
        // An "apply" op is one command here, so ops and outcomes line up.
        const refused = new Set(r.outcomes.filter((o) => !o.applied).map((o) => o.index))
        const reasons = new Map(r.outcomes.filter((o) => !o.applied).map((o) => [o.index, o.reason ?? '']))
        const left = new Map(r.outcomes.filter((o) => o.left?.length).map((o) => [o.index, o.left!]))
        // Straight onto the timeline: the entry on the live project as it was.
        const direct = r.seq === undefined && !hadDraft && r.entry
        return { refused, reasons, left, answer: r.text, ...(r.seq !== undefined ? { seq: r.seq } : {}), ...(direct ? { mat: matOf(L, [r.entry!], who, S().project, ctx0) } : {}) }
      } catch (e) {
        return { error: e instanceof Error ? e.message : String(e), refused: new Set(ops.map((_, i) => i)), answer: '' }
      }
    },
    draft() {
      flush()
      const d = currentDraft()
      if (!d) return null
      const on = new Set(d.outcomes.filter((o) => o.applied).map((o) => key(o.seq, o.index)))
      // (For an applied cut that left ranges out: what it said of them.)
      const why = new Map(d.outcomes.filter((o) => !o.applied || o.notes?.length).map((o) => [key(o.seq, o.index), o.applied ? o.notes!.join('; ') : o.reason ?? '']))
      const left = new Map(d.outcomes.filter((o) => o.left?.length).map((o) => [key(o.seq, o.index), o.left!]))
      const who = whoOf(d.session)
      return {
        project: d.project,
        on: d.on,
        who,
        seqs: d.entries.map((e) => e.seq),
        applied: (seq, op) => on.has(key(seq, op)),
        reason: (seq, op) => why.get(key(seq, op)),
        left: (seq, op) => left.get(key(seq, op)),
        retired: d.entries.flatMap((e) => e.ops.map((op, index) => ({ seq: e.seq, index, retired: !!op.retired })).filter((x) => x.retired)),
        mat: matOf(d.on, d.entries, who, d.project)
      }
    },
    preview(seqs) {
      flush()
      if (!currentDraft()) return null
      const p = acceptPreview(seqs)
      return { shown: p.shown, project: p.project }
    },
    accept(seqs, shown) {
      flush()
      const d = draftState()
      const L = S().project
      const entries = d ? d.entries.filter((e) => !seqs || seqs.includes(e.seq)) : []
      const who = d ? whoOf(d.session) : 0
      const ctx0 = snap(who)
      const out = acceptDraft(seqs, (shown as AcceptPlan['shown'] | undefined) ?? 'now')
      const on = new Set(out.applied)
      const left = new Map((out.outcomes ?? []).filter((o) => o.left?.length).map((o) => [key(o.seq, o.index), o.left!]))
      const adopted = out.version !== null
      return { adopted, ...(out.changed ? { changed: true } : {}), applied: (seq, op) => on.has(key(seq, op)), left: (seq, op) => left.get(key(seq, op)), ...(adopted ? { mat: matOf(L, entries, who, S().project, ctx0) } : {}) }
    },
    removeRange(seq, op, range) {
      flush()
      return removeRange(seq, op, range)
    },
    revive(seq, op) {
      flush()
      return reviveOp(seq, op)
    },
    reject() {
      rejectDraft()
    },
    flush,
    dispose() {
      rejectDraft()
      unwatch()
      restore()
    }
  }
}
