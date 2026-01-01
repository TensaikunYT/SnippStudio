// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// A draft in the user's words (DENEME-2-PLAN-T.md, "Ek 2"): the sentences of
// agent/draft-words.ts said with t(), the headline and the length warning;
// and what the review strip does with a draft (D22, worker C): accept all of
// it, reject it, accept or reject one of its items, show it in the preview.
// Every accept writes the point before the agent first (restore.ts
// acceptSaved: never drafts.ts acceptDraft from here), and the agent that
// made the draft is told how it went.
import { useEffect, useState } from 'react'
import { t, notify } from '../../ui'
import { mmss, span } from '../../agent/draft-words'
import type { DraftView } from '../../agent/store'
import { form } from '../../agent/count'
import { bigJump } from '../../agent/answers'
import { acceptPreview, acceptWould, freshDraft, rejectDraft, rejectOp, rejectOps, type AcceptPlan } from '../../agent/drafts'
import { acceptSaved } from '../../agent/restore'
import { sendToInbox, type DraftAnswer } from '../../agent/inbox'
import { LOCAL_CLIENT } from '../../agent/ready'
import { candidate, compareMode, type CompareMode, type Showing } from '../../playback/candidate'
import { itemEnd, itemStart, marksFor } from '../../agent/marks'
import { useStore } from '../../state/store'

// One change's sentence: agent/said.ts (D22: the toast, the timeline's mark
// and the Steps list of a direct edit say it too).
export { changeText } from '../../agent/said'

/** "5 changes · the film gets 3:20 shorter". */
export function headline(d: DraftView): string {
  const n = d.items?.length ?? d.calls.length
  const l = d.lengths
  const diff = l ? l.draft - l.live : 0
  const length = !l || Math.abs(diff) < 0.05 ? t('den2t.draft.len.same', { len: mmss(l?.live ?? 0) }) : diff < 0 ? t('den2t.draft.len.shorter', { d: span(diff) }) : t('den2t.draft.len.longer', { d: span(diff) })
  return t(`d22c.draft.headline.${form(n)}`, { n, length })
}

/** The warning when the draft changes the film's length a lot, or null. */
export function jumpText(d: DraftView): string | null {
  const l = d.lengths
  if (!l || !bigJump(l.live, l.draft)) return null
  return t('den2t.draft.jump', { d: span(l.draft - l.live), way: t(l.draft > l.live ? 'den2t.draft.jump.longer' : 'den2t.draft.jump.shorter'), from: mmss(l.live), to: mmss(l.draft) })
}

/** The warning in a few words, for the strip: "film 3:14 longer". */
export function jumpShort(d: DraftView): string | null {
  const l = d.lengths
  if (!l || !bigJump(l.live, l.draft)) return null
  return t(l.draft > l.live ? 'd22c.draft.jump.longer' : 'd22c.draft.jump.shorter', { d: span(l.draft - l.live) })
}

/** The user's answer goes to that agent (a ready job's draft has nobody to answer). */
export function answerAgent(outcome: DraftAnswer, client: string | undefined, said = ''): void {
  if (!client || client === LOCAL_CLIENT) return
  const text = said.trim().slice(0, 1000)
  // (To the draft's owner, and no other agent: D22, the audit's A2.)
  sendToInbox({ kind: 'draft', outcome, to: client, ...(text ? { text } : {}) })
}

/** Accept the whole draft as it is shown now: replayed first, the point
 *  before the agent written, then accepted (ONE undo step). */
export async function acceptWholeDraft(d: DraftView, said = ''): Promise<boolean> {
  freshDraft()
  let shown
  try {
    shown = acceptPreview().shown
  } catch (e) {
    notify({ text: t('agent.draft.failed', { error: e instanceof Error ? e.message : String(e) }), kind: 'error' })
    return false
  }
  try {
    const out = await acceptSaved(undefined, shown)
    if (out.changed) {
      notify({ text: t('agent.draft.changed'), kind: 'error' })
      return false
    }
    if (out.version === null) {
      notify({ text: t('agent.draft.nothing') })
      return false
    }
    const lost = out.dropped.filter((x) => x.reason !== 'not selected').length
    notify({ text: lost ? t('agent.draft.partial', { dropped: lost }) : t('agent.draft.accepted') })
    // (Some of it was rejected one by one before: the agent hears "in part".)
    answerAgent(lost || d.decided?.rejected ? 'partial' : 'accepted', d.client, said)
    return true
  } catch (e) {
    notify({ text: t('agent.draft.failed', { error: e instanceof Error ? e.message : String(e) }), kind: 'error' })
    return false
  }
}

/** Reject the draft (what of it still waits), the agent told. */
export function rejectWholeDraft(d: DraftView, said = ''): void {
  rejectDraft()
  notify({ text: t('agent.draft.rejected') })
  // (Some of it was accepted one by one before: "in part".)
  answerAgent(d.decided?.accepted ? 'partial' : 'rejected', d.client, said)
}

export interface AlonePlan {
  /** The item would be applied by itself, on the project as it is. */
  ok: boolean
  /** Items of the draft that are applied now and would not be any more if
   *  this one landed by itself (an item that moves things holds only on the
   *  very project it was written on): they are decided first. */
  lost: string[]
  shown: AcceptPlan['shown']
}

/** Would this one item be applied by itself now, and at what cost to the
 *  rest? (An op written on the ones before it — a move after a cut, say — is
 *  not applied alone: it is accepted with them.) */
export function planAlone(key: string): AlonePlan | null {
  try {
    const { plan, lost } = acceptWould([key])
    return { ok: plan.outcomes.some((o) => `${o.seq}:${o.index}` === key && o.applied), lost, shown: plan.shown }
  } catch {
    return null
  }
}

/** Accept ONE item of the draft (the point before the agent first; one undo
 *  step). The agent is answered when nothing of the draft waits any more. */
export async function acceptItem(d: DraftView, key: string, plan: AlonePlan): Promise<boolean> {
  try {
    const out = await acceptSaved(undefined, plan.shown, [key])
    if (out.changed) {
      notify({ text: t('agent.draft.changed'), kind: 'error' })
      return false
    }
    if (out.version === null) {
      notify({ text: t('d22c.review.notAlone') })
      return false
    }
    notify({ text: t('d22c.review.accepted') })
    if (out.ended) answerAgent(out.ended, d.client)
    return true
  } catch (e) {
    notify({ text: t('agent.draft.failed', { error: e instanceof Error ? e.message : String(e) }), kind: 'error' })
    return false
  }
}

/** Would a worker's group (EKIP-PLAN.md) be applied by itself now, and at
 *  what cost to the other groups? `ok`: every item of it lands; `lost`:
 *  items of other workers that are applied now and would not be any more. */
export function planGroup(keys: readonly string[]): AlonePlan | null {
  if (!keys.length) return null
  try {
    const { plan, lost } = acceptWould(keys)
    const landed = new Set(plan.outcomes.filter((o) => o.applied).map((o) => `${o.seq}:${o.index}`))
    return { ok: keys.every((k) => landed.has(k)), lost, shown: plan.shown }
  } catch {
    return null
  }
}

/** Accept a worker's group: the point before the agent first, then its
 *  items as ONE undo step (acceptSaved with those ops). */
export async function acceptGroup(d: DraftView, keys: readonly string[], plan: AlonePlan, name: string): Promise<boolean> {
  try {
    const out = await acceptSaved(undefined, plan.shown, keys)
    if (out.changed) {
      notify({ text: t('agent.draft.changed'), kind: 'error' })
      return false
    }
    if (out.version === null) {
      notify({ text: t('d22c.review.notAlone') })
      return false
    }
    notify({ text: t('ekip.group.accepted', { name }) })
    if (out.ended) answerAgent(out.ended, d.client)
    return true
  } catch (e) {
    notify({ text: t('agent.draft.failed', { error: e instanceof Error ? e.message : String(e) }), kind: 'error' })
    return false
  }
}

/** Reject a worker's group (one replay; the agent is answered once, when
 *  nothing of the draft waits any more). */
export function rejectGroup(d: DraftView, keys: readonly string[], name: string): void {
  const out = rejectOps(keys.map((k) => {
    const [seq, index] = k.split(':').map(Number)
    return { seq, index }
  }))
  if (!out.done) return
  notify({ text: t('ekip.group.rejected', { name }) })
  if (out.ended) answerAgent(out.ended, d.client)
}

/** Reject ONE item of the draft; the rest stays. */
export function rejectItem(d: DraftView, seq: number, index: number): void {
  const out = rejectOp(seq, index)
  if (!out.done) return
  notify({ text: t(out.ended ? 'd22c.review.rejectedLast' : 'd22c.review.rejected') })
  if (out.ended) answerAgent(out.ended, d.client)
}

/** What the preview shows of a draft: one of the two, or both compared
 *  (ONIZLEME-UYGULA-PLAN.md, K8). */
export type PreviewWhich = Showing | Exclude<CompareMode, 'off'>

/** Shows `which` in the preview (and "After" on the timeline), the draft
 *  replayed first (drafts#12). */
export function showInPreview(which: PreviewWhich): void {
  if (which !== 'live') freshDraft()
  if (which === 'live' || which === 'candidate') candidate.show(which)
  else candidate.compare(which)
}

const viewNow = (): PreviewWhich => {
  const c = compareMode()
  return c !== 'off' ? c : candidate.get().showing
}

export function useShowing(): PreviewWhich {
  const [showing, setShowing] = useState<PreviewWhich>(viewNow)
  useEffect(() => candidate.subscribe(() => setShowing(viewNow())), [])
  return showing
}

/** Seconds played before a change and after it ("play this change"). */
export const PLAY_AROUND_S = 2

/**
 * Plays ONE change of the draft as the film would be with it ("After"): from
 * a little before where it happens to a little after, then stops and shows
 * again what was shown before. A pause of the user's ends it where it is
 * (the draft stays shown: they stopped to look). Answers the stop; `done` is
 * called when it has ended, either way.
 */
export function playItem(d: DraftView, key: string, done: () => void): () => void {
  const items = d.items ?? []
  const i = items.findIndex((x) => x.key === key)
  const was = viewNow()
  showInPreview('candidate')
  const next = d.project
  const marks = d.on && next ? marksFor('after', d.on, next, d.marks?.cuts ?? [], items) : []
  const at = (next ? itemStart(marks, i, next) : null) ?? 0
  const end = (next ? itemEnd(marks, i, next) : null) ?? at
  const from = Math.max(0, at - PLAY_AROUND_S)
  const to = Math.max(at, end) + PLAY_AROUND_S
  const s = useStore.getState()
  s.setPlaying(false)
  s.setTime(from)
  s.setPlaying(true)
  let over = false
  const finish = (back: boolean): void => {
    if (over) return
    over = true
    unsub()
    const st = useStore.getState()
    if (st.playing) st.setPlaying(false)
    if (back && was === 'live') showInPreview('live')
    done()
  }
  const unsub = useStore.subscribe((st) => {
    if (over) return
    // (It reached the end, or the film ended under it.)
    if (st.currentTime >= to) finish(true)
    // (Paused by the user: it stays where they stopped it.)
    else if (!st.playing) finish(false)
  })
  return () => finish(true)
}

/** Which draft the strip shows (more calls added to it keep it; a new draft
 *  after a reject or an accept is another, its calls numbered from 1 again). */
export const draftIdOf = (draft: DraftView | null | undefined): string | null => (draft ? `${draft.session}|${draft.id ?? ''}` : null)
