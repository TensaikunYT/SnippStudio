// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// The agent's inbox (GONDER-PLAN.md): what the user sends to the agent from
// the app — notes ("Send to agent"), a task typed in the command box, their
// answer on the draft card — handed to the agent's `wait` call, each item
// once. VideoHub's channel.js (inbox, push, deliver, wake), for one window.
//
// Kept in memory, per window and per open project (GONDER-PLAN.md, 1): not in
// the project file (no unsaved change, no undo step, nothing carried to
// another computer), not on disk (the user's words stay off it); the notes
// themselves stay in the project with their status.
//
// Only the interface writes here (sendToInbox, called by the components on
// the user's press). No agent tool can: the wait tool only takes.
//
// Who gets an item (D22, the audit's A2 / K2: it used to be whichever agent
// waited first, so a task meant for the agent working on the project went to
// one that had been refused, and "the user REJECTED your draft" to an agent
// that had no draft). An item with `to` (the answer on a draft: the draft's
// owner) is that agent program's only. Any other item (a task, notes) goes
// to the agent working on the project when it is handed over — the one that
// holds it, else the one the user picked (agent/holder.ts workingAgent) —
// and only when there is none to the first agent that waits, as before.
// Decided at the handing over, not at the send: what is in line when the
// user hands the project on goes to the new agent.
import { create } from 'zustand'
import { useHolder, workingAgent } from './holder'
import { projectSession, useStore } from '../state/store'
import { noteLines } from '../notes/agent'
import type { Project } from '../types'
import { PRODUCT_NAME } from '../../../shared/product'

export type DraftAnswer = 'accepted' | 'partial' | 'rejected'

export type InboxEntry = (
  | { kind: 'notes'; notes: string[] }
  | { kind: 'task'; text: string; selection?: string }
  | { kind: 'draft'; outcome: DraftAnswer; text?: string }
  /** The user handed the project to this agent (D22, the audit's A11). */
  | { kind: 'handover' }
) & {
  /** The agent program (its MCP client name) this is for, and no other: the
   *  owner of the draft an answer is about. Unset: the agent working on the
   *  project when it is handed over. */
  to?: string
}

export type InboxItem = InboxEntry & {
  id: number
  at: number
  /** Given back after a delivery that was lost on the way. */
  again?: boolean
}

export type Delivered = InboxItem & { deliveredAt: number; to: string }

export interface Inbox {
  /** The last number given. */
  seq: number
  /** The cursor: every item up to this number was handed over. */
  delivered: number
  /** Not handed over yet (numbers above the cursor). */
  items: InboxItem[]
  /** The last ones handed over, newest first ("sent recently"). */
  recent: Delivered[]
}

/** How many delivered items the Agent tab keeps showing. */
export const RECENT_MAX = 12
/** A task's words at most (a request, not a document). */
export const TASK_MAX = 4000

// ---- the rules (pure) -------------------------------------------------------

export const emptyInbox = (): Inbox => ({ seq: 0, delivered: 0, items: [], recent: [] })

/** One more item, numbered. */
export function pushItem(box: Inbox, entry: InboxEntry, now: number): InboxItem {
  const item = { ...entry, id: box.seq + 1, at: now } as InboxItem
  box.seq = item.id
  box.items.push(item)
  return item
}

/** Is this item for that agent program? `working`: the agent working on the
 *  project now (null: nobody, so whoever waits). */
export const isFor = (item: { to?: string }, client: string, working: string | null): boolean => (item.to ?? working ?? client) === client

/** The items not handed over yet, in order, and out of the line: none is
 *  handed over twice. With `client`: only those that are for that agent
 *  program (isFor); the others stay in line for theirs. The cursor is the
 *  highest number handed over. */
export function takeItems(box: Inbox, client?: string, working: string | null = null): InboxItem[] {
  const out = client === undefined ? box.items : box.items.filter((i) => isFor(i, client, working))
  if (!out.length) return []
  box.items = client === undefined ? [] : box.items.filter((i) => !out.includes(i))
  box.delivered = Math.max(box.delivered, ...out.map((i) => i.id))
  return out
}

/** What was handed over and read, for the "sent recently" list. */
export function remember(box: Inbox, items: readonly InboxItem[], to: string, now: number): void {
  box.recent = [...items.map((i) => ({ ...i, deliveredAt: now, to })).reverse(), ...box.recent].slice(0, RECENT_MAX)
}

/** A delivery that never reached the agent: its items go back in line
 *  (new numbers, after whatever came meanwhile) and leave the recent list. */
export function giveBack(box: Inbox, items: readonly InboxItem[], now: number): InboxItem[] {
  const ids = new Set(items.map((i) => i.id))
  box.recent = box.recent.filter((r) => !ids.has(r.id))
  return items.map((i) => {
    const { id: _id, at: _at, again: _again, ...entry } = i
    const back = pushItem(box, entry as InboxEntry, now)
    back.again = true
    return back
  })
}

/** The notes waiting in line (not handed over yet). */
export const queuedNotes = (box: Inbox): Set<string> => new Set(box.items.flatMap((i) => (i.kind === 'notes' ? i.notes : [])))

const clean = (s: string): string => s.replace(/\s+/g, ' ').trim()

/** What a wait answers: short, English. `seen`: the project as the agent
 *  reads it (its draft while one waits: `inDraft`), the notes' times in it. */
export function inboxText(items: readonly InboxItem[], seen: Project, inDraft = false): string {
  const lines = [`From the user in ${PRODUCT_NAME} ("${seen.name || 'Untitled'}"):`]
  const notes = new Map((seen.notes ?? []).map((n) => [n.id, n]))
  for (const it of items) {
    if (it.kind === 'notes') {
      const ns = it.notes.map((id) => notes.get(id)).filter((n): n is NonNullable<typeof n> => !!n).sort((a, b) => a.start - b.start || a.num - b.num)
      if (!ns.length) continue
      lines.push(`${ns.length} note${ns.length === 1 ? '' : 's'} sent, now "with agent" (answer with notes update). Times are timeline seconds${inDraft ? ' of your draft' : ''}.`)
      for (const n of ns) lines.push(...noteLines(seen, n))
    } else if (it.kind === 'task') {
      lines.push(`Task: "${clean(it.text)}"`)
      if (it.selection) lines.push(`   selected then: ${it.selection}`)
    } else if (it.kind === 'handover') {
      lines.push('The user handed this project to you: you may change it now. Another agent worked on it before: read it again first.')
    } else {
      const what = it.outcome === 'rejected' ? 'REJECTED your draft' : it.outcome === 'partial' ? 'accepted part of your draft (read changes for what was applied)' : 'accepted your draft'
      lines.push(`The user ${what}.${it.text ? ` In their words: "${clean(it.text)}"` : ''}`)
    }
  }
  lines.push('When done, call wait again.')
  return lines.join('\n')
}

// ---- the window's inbox ---------------------------------------------------------

/** What the interface shows of it. */
export interface InboxView {
  /** The wait of the agent a send would go to is open now (or ended under
   *  GRACE_MS ago: a wait is called again at once, the line does not blink
   *  between two). An agent that waits while the project is another's is
   *  not "waiting for you": what you send would not reach it. */
  waiting: { client: string; since: number } | null
  /** Items in line, and their numbers. */
  queued: number
  queuedIds: number[]
  /** Notes in line (their button does not count them again). */
  queuedNotes: string[]
  recent: Delivered[]
}

export const useInbox = create<InboxView>(() => ({ waiting: null, queued: 0, queuedIds: [], queuedNotes: [], recent: [] }))

const GRACE_MS = 2500

interface Waiter {
  call: string
  client: string
  session?: string
  since: number
  /** Takes what is in line for it, if anything is. */
  wake: () => void
}

let box = emptyInbox()
let boxProject = projectSession()
const waiters: Waiter[] = []
let lastEnd: { at: number; client: string; since: number } | null = null
let graceTimer: ReturnType<typeof setTimeout> | null = null

/** Another project opened: its inbox is a new one (what was in line for the
 *  one before does not go to this one's agent). */
function current(): Inbox {
  if (boxProject !== projectSession()) {
    boxProject = projectSession()
    box = emptyInbox()
  }
  return box
}

/** The waits a send (a task, notes) would reach now: the working agent's,
 *  the session that holds the project first; with no working agent, all. */
function takers(to?: string): Waiter[] {
  const working = workingAgent()
  const holds = useHolder.getState().holder?.session
  const first = (w: Waiter): number => Number(w.session !== undefined && w.session === holds)
  return waiters.filter((w) => isFor({ to }, w.client, working)).sort((a, b) => first(b) - first(a))
}

function publish(): void {
  const b = current()
  const mine = takers()
  const open = mine[0]
  const ended = lastEnd && Date.now() - lastEnd.at < GRACE_MS && isFor({}, lastEnd.client, workingAgent()) ? lastEnd : null
  const waiting = open ? { client: open.client, since: Math.min(...mine.map((w) => w.since)) } : ended ? { client: ended.client, since: ended.since } : null
  // "In line for the agent" is what the working agent will get: the answer
  // on the draft of an agent that is not it is not in the user's line.
  const working = workingAgent()
  const line = b.items.filter((i) => i.to === undefined || working === null || i.to === working)
  useInbox.setState({ waiting, queued: line.length, queuedIds: line.map((i) => i.id), queuedNotes: [...queuedNotes(b)], recent: b.recent })
}

/** The project changed: the view follows (the inbox itself on next use).
 *  The agent working on the project changed (the user handed it on, picked
 *  one, its session ended): what is in line may be for a wait that is open. */
export function watchInboxProject(): () => void {
  const a = useStore.subscribe((s, prev) => {
    if (s.project !== prev.project && boxProject !== projectSession()) publish()
  })
  const b = useHolder.subscribe((s, prev) => {
    if (s.holder === prev.holder && s.chosen === prev.chosen) return
    // The project was taken from an agent: every call of its session is
    // answered "handed to another agent" from now, so the answer on its
    // draft that is in line for it would never be taken.
    if (s.handedOff !== prev.handedOff && prev.holder && prev.holder.client !== s.holder?.client) dropItemsTo(prev.holder.client)
    publish()
    for (const w of [...waiters]) w.wake()
  })
  return () => {
    a()
    b()
  }
}

/**
 * The user sent something (a component, on their press). A waiting agent
 * takes it at once. Returns whether one did.
 */
export function sendToInbox(entry: InboxEntry, now = Date.now()): { taken: boolean; id: number } {
  const e: InboxEntry = entry.kind === 'task' ? { ...entry, text: entry.text.trim().slice(0, TASK_MAX) } : entry
  const item = pushItem(current(), e, now)
  const first = takers(item.to)[0]
  publish()
  if (first) first.wake()
  return { taken: !!first, id: item.id }
}

/** The user copied an item to paste it into the agent's chat themself
 *  (GONDER2-PLAN.md): it leaves the line, so the agent does not get it twice.
 *  False when it is not in line any more (taken meanwhile). */
export function withdrawItem(id: number): boolean {
  const b = current()
  const before = b.items.length
  b.items = b.items.filter((i) => i.id !== id)
  if (b.items.length === before) return false
  publish()
  return true
}

/** Is the wait of the agent a send would go to open now (it goes at once)? */
export const agentWaiting = (): boolean => takers().length > 0

/** What is in line for an agent program by name (the answer on its draft)
 *  goes when that program has no session left: nobody will ever take it. */
export function dropItemsTo(client: string): void {
  const b = current()
  if (!b.items.some((i) => i.to === client)) return
  b.items = b.items.filter((i) => i.to !== client)
  publish()
}

export interface WaitOptions {
  call: string
  client: string
  /** The agent session that waits (the one that holds the project is first). */
  session?: string
  /** Until when (Date.now()) to wait; [] after it. */
  until: number
  /** Stop now (cancelled, another project, access off): null. */
  stop: () => boolean
}

/** One wait: what is in line at once, or the next send, or [] at `until`,
 *  or null when stopped. Items handed over are no longer in line. */
export function waitForItems(o: WaitOptions): Promise<InboxItem[] | null> {
  const take = (): InboxItem[] => takeItems(current(), o.client, workingAgent())
  const ready = take()
  if (ready.length) {
    publish()
    return Promise.resolve(ready)
  }
  return new Promise((resolve) => {
    let done = false
    const w: Waiter = {
      call: o.call,
      client: o.client,
      ...(o.session !== undefined ? { session: o.session } : {}),
      since: Date.now(),
      wake: () => {
        const items = take()
        if (items.length) finish(items)
      }
    }
    const finish = (items: InboxItem[] | null): void => {
      if (done) return
      done = true
      clearInterval(tick)
      const i = waiters.indexOf(w)
      if (i >= 0) waiters.splice(i, 1)
      if (!waiters.length) {
        lastEnd = { at: Date.now(), client: w.client, since: w.since }
        if (graceTimer) clearTimeout(graceTimer)
        graceTimer = setTimeout(publish, GRACE_MS + 50)
      }
      publish()
      resolve(items)
    }
    const tick = setInterval(() => {
      if (o.stop()) finish(null)
      else if (Date.now() >= o.until) finish([])
    }, 200)
    waiters.push(w)
    lastEnd = null
    publish()
  })
}

/** Items handed to `to` and read: the recent list. */
export function rememberSent(items: readonly InboxItem[], to: string): void {
  remember(current(), items, to, Date.now())
  publish()
}

/** A delivery lost on the way: its items go back in line. */
export function giveBackItems(items: readonly InboxItem[], project: number): void {
  if (project !== projectSession()) return
  giveBack(current(), items, Date.now())
  publish()
  for (const w of [...waiters]) w.wake()
}

/** For the tests: a fresh inbox. */
export function resetInbox(): void {
  box = emptyInbox()
  boxProject = projectSession()
  waiters.length = 0
  lastEnd = null
  publish()
}
