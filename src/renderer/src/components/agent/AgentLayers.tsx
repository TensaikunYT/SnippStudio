// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// The agent on the timeline and the preview (SnippStudio phase 4B.4,
// ANA-PLAN.md §3), at zero tokens: every picture is made from the tool-call
// events the app already records, never by asking the agent.
// - the draft: every change of it marked (components/agent/DraftMarks.tsx;
//   D22, worker C), and the clips the agent's job changed, framed;
// - reading (transcript, analyze): a sweep over the range read, at least 600 ms;
// - looking (frames): an eye at each moment and a badge on the preview, 1.5 s;
// - found (an analysis' result): its ranges appear one after another, 40 ms apart;
// - accepted: the hatched ranges close (240 ms);
// - the user's region on the frame (the accent, not amber).
// All motion is CSS (agent.css); the timers here only add and remove the
// pictures in this component's own state — no store is written per frame.
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useStore } from '../../state/store'
import { projectDuration, TIMELINE_HEADER_W } from '../../types'
import { Icon, useT } from '../../ui'
import { useAgentStore, type DraftMarks, type ToolEvent } from '../../agent/store'
import { useSession } from '../../agent/session'
import { useInbox } from '../../agent/inbox'
import { candidate } from '../../playback/candidate'
import { frameBox } from '../NoteDrawLayer'
import { mmss, span } from '../../agent/draft-words'
import { WORK_GAP_MS } from '../../agent/activity'
import { DraftMarksLayer } from './DraftMarks'

const READ_TOOLS = new Set(['transcript', 'analyze'])
export const READ_MIN_MS = 600
export const LOOK_MS = 1500
export const FOUND_MS = 2500
export const FOUND_STAGGER_MS = 40

const endOf = (e: ToolEvent): number => e.started + (e.ms ?? 0)

/** The activity pictures visible at `now` (pure; the tests use it). */
export function activityAt(events: readonly ToolEvent[], now: number): { reads: ToolEvent[]; looks: ToolEvent[]; found: ToolEvent[]; next: number | null } {
  const reads: ToolEvent[] = []
  const looks: ToolEvent[] = []
  const found: ToolEvent[] = []
  let next: number | null = null
  const until = (t: number): void => void (next = next === null ? t : Math.min(next, t))
  for (const e of events.slice(-60)) {
    if (READ_TOOLS.has(e.tool)) {
      const end = e.done ? e.started + Math.max(e.ms ?? 0, READ_MIN_MS) : Infinity
      if (now < end) {
        reads.push(e)
        if (end !== Infinity) until(end)
      }
    }
    if (e.tool === 'frames' && e.at?.length) {
      const end = e.done ? endOf(e) + LOOK_MS : Infinity
      if (now < end) {
        looks.push(e)
        if (end !== Infinity) until(end)
      }
    }
    if (e.done && e.found?.length) {
      const end = endOf(e) + FOUND_MS + e.found.length * FOUND_STAGGER_MS
      if (now < end) {
        found.push(e)
        until(end)
      }
    }
  }
  return { reads, looks, found, next }
}

/** Re-draws at the moment the next picture should go. */
function useActivity(): ReturnType<typeof activityAt> {
  const events = useAgentStore((s) => s.events)
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => setNow(Date.now()), [events])
  const act = activityAt(events, now)
  useEffect(() => {
    if (act.next === null) return
    const id = window.setTimeout(() => setNow(Date.now()), Math.max(16, act.next - Date.now() + 5))
    return () => window.clearTimeout(id)
  }, [act.next])
  return act
}

/** How long the agent's last direct change stays marked. */
export const FLASH_MS = 3200

export const isJump = (before: number, after: number): boolean => Math.abs(after - before) >= 30 && Math.abs(after - before) >= 0.25 * Math.max(before, 1)

export function AgentTimelineLayer({ pxPerSec }: { pxPerSec: number }): JSX.Element | null {
  const t = useT()
  const marks = useAgentStore((s) => s.draft?.marks)
  const outcome = useAgentStore((s) => s.outcome)
  const flash = useAgentStore((s) => s.flash)
  const barShown = useAgentStore((s) => s.barShown)
  const liveClips = useStore((s) => s.project.clips)
  const act = useActivity()
  const ref = useRef<HTMLDivElement>(null)
  const x = (s: number): number => TIMELINE_HEADER_W + s * pxPerSec
  // Accepted: the hatch the user saw closes.
  const lastMarks = useRef<DraftMarks | undefined>(marks)
  if (marks) lastMarks.current = marks
  const [closing, setClosing] = useState<[number, number][] | null>(null)
  const seenOutcome = useRef(outcome?.at ?? 0)
  useEffect(() => {
    if (!outcome || outcome.at === seenOutcome.current) return
    seenOutcome.current = outcome.at
    if (outcome.kind !== 'accepted' && outcome.kind !== 'partial') return
    setClosing(lastMarks.current?.cuts ?? null)
    const id = window.setTimeout(() => setClosing(null), 320)
    return () => window.clearTimeout(id)
  }, [outcome])
  // The agent's last direct change: its clips' boxes, for a moment.
  const [flashBoxes, setFlashBoxes] = useState<{ key: string; left: number; top: number; width: number; height: number }[]>([])
  const [flashOn, setFlashOn] = useState(false)
  useLayoutEffect(() => {
    const inner = ref.current?.parentElement
    if (!flash || !inner || Date.now() - flash.at > FLASH_MS) {
      setFlashOn(false)
      return
    }
    const box = inner.getBoundingClientRect()
    const boxes = flash.clips.flatMap((id) => {
      const el = inner.querySelector<HTMLElement>(`[data-testid="timeline.clip.${CSS.escape(id)}"]`)
      if (!el) return []
      const r = el.getBoundingClientRect()
      return [{ key: id, left: r.left - box.left, top: r.top - box.top, width: r.width, height: r.height }]
    })
    setFlashBoxes(boxes)
    setFlashOn(true)
    const id = window.setTimeout(() => setFlashOn(false), Math.max(0, FLASH_MS - (Date.now() - flash.at)))
    return () => window.clearTimeout(id)
  }, [flash, pxPerSec, liveClips])
  const whole = (): [number, number] => [0, projectDuration(useStore.getState().project)]
  const jumped = !!flash && isJump(flash.lengths.before, flash.lengths.after)
  const flashStart = flash ? Math.min(...flash.ranges.map((r) => r[0]), ...flashBoxes.map((b) => (b.left - TIMELINE_HEADER_W) / pxPerSec)) : 0
  return (
    <div className="agent-tl" ref={ref} data-testid="agent.timeline">
      {/* Every change of a waiting draft, and the clips the job changed (D22). */}
      <DraftMarksLayer pxPerSec={pxPerSec} />
      {!marks &&
        closing?.map(([a, b], i) => <div key={`k${i}`} className="agent-hatch is-closing" style={{ left: x(a), width: Math.max(2, (b - a) * pxPerSec) }} data-testid="agent.hatch.closing" />)}
      {flashOn && flash && (
        <>
          {flashBoxes.map((b) => (
            <div key={`fl${b.key}`} className="agent-flash" style={{ left: b.left, top: b.top, width: b.width, height: b.height }} data-testid="agent.flash" />
          ))}
          {flash.ranges.map(([a], i) => (
            <div key={`fr${i}`} className="agent-flash-cut" style={{ left: x(a) }} data-testid="agent.flash" />
          ))}
          {/* (Its words are the agent bar's while that is on screen: said once.) */}
          {!barShown && <span className={`agent-flash-label${jumped ? ' is-warn' : ''}`} style={{ left: x(Number.isFinite(flashStart) ? Math.max(0, flashStart) : 0) }} data-testid="agent.flash.label">
            {t('den2t.flash.label', { what: flash.label })}
            {jumped ? ` · ${t('den2t.draft.jump', { d: span(flash.lengths.after - flash.lengths.before), way: t(flash.lengths.after > flash.lengths.before ? 'den2t.draft.jump.longer' : 'den2t.draft.jump.shorter'), from: mmss(flash.lengths.before), to: mmss(flash.lengths.after) })}` : ''}
          </span>}
        </>
      )}
      {act.reads.map((e) => {
        const [a, b] = e.range ?? whole()
        return (
          <div key={`r${e.id}`} className="agent-read" style={{ left: x(a), width: Math.max(4, (b - a) * pxPerSec) }} data-testid="agent.reading">
            <i />
            <b>{t('agent.reading')}</b>
          </div>
        )
      })}
      {act.looks.flatMap((e) =>
        (e.at ?? []).map((s, i) => (
          <div key={`l${e.id}.${i}`} className="agent-eye" style={{ left: x(s) }} data-testid="agent.eye">
            <span>
              <Icon name="eye" size={14} />
            </span>
          </div>
        ))
      )}
      {act.found.flatMap((e) =>
        (e.found ?? []).slice(0, 200).map(([a, b], i) => (
          <div key={`f${e.id}.${i}`} className="agent-found" style={{ left: x(a), width: Math.max(2, (b - a) * pxPerSec), animationDelay: `calc(var(--agent-stagger) * ${i})` }} data-testid="agent.found" />
        ))
      )}
    </div>
  )
}

/** The quiet gap between two calls of one piece of work: the agent thinks
 *  between its calls, the light stays on (DENEME-2, item 8). */
export const GLOW_GAP_MS = WORK_GAP_MS

/** Is the agent at work now (a call in flight, or one ended a moment ago),
 *  and when does that end? Waiting for the user (`wait`) is not work. Pure. */
export function glowState(events: readonly ToolEvent[], waiting: boolean, now: number): { on: boolean; until: number | null } {
  if (waiting) return { on: false, until: null }
  if (events.some((e) => !e.done)) return { on: true, until: null }
  const last = events.reduce((m, e) => Math.max(m, endOf(e)), 0)
  return last && now - last < GLOW_GAP_MS ? { on: true, until: last + GLOW_GAP_MS } : { on: false, until: null }
}

/** A soft amber light round the preview while the agent works (it breathes;
 *  under reduced motion a still edge), and a short "done" when it stops.
 *  CSS only (agent.css); the timers here only switch it on and off. */
export function AgentPreviewGlow(): JSX.Element | null {
  const t = useT()
  const events = useAgentStore((s) => s.events)
  const waiting = useInbox((s) => !!s.waiting)
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => setNow(Date.now()), [events, waiting])
  const g = glowState(events, waiting, now)
  useEffect(() => {
    if (g.until === null) return
    const id = window.setTimeout(() => setNow(Date.now()), Math.max(16, g.until - Date.now() + 5))
    return () => window.clearTimeout(id)
  }, [g.until])
  if (!g.on) return null
  return <div className="agent-pv-glow" role="status" aria-label={t('den2t.top.working')} data-testid="agent.pv.glow" />
}

/** Over the preview: the region the user draws (accent), "the agent looked
 *  at this frame" (1.5 s) and "showing the draft" while After is shown. */
export function AgentPreviewLayer(): JSX.Element {
  const t = useT()
  const drawing = useSession((s) => s.drawingRegion)
  const region = useSession((s) => s.region)
  const W = useStore((s) => s.project.settings.width)
  const H = useStore((s) => s.project.settings.height)
  const pv = useStore((s) => s.previewView)
  const act = useActivity()
  const [after, setAfter] = useState(() => candidate.get().showing === 'candidate' && !!candidate.get().project)
  useEffect(() => candidate.subscribe((s) => setAfter(s.showing === 'candidate' && !!s.project)), [])
  const ref = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState({ cw: 0, ch: 0 })
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const measure = (): void => setSize({ cw: el.clientWidth, ch: el.clientHeight })
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    measure()
    return () => ro.disconnect()
  }, [])
  const [live, setLive] = useState<[number, number, number, number] | null>(null)
  const start = useRef<[number, number] | null>(null)
  const pointAt = (e: React.PointerEvent): [number, number] => {
    const r = e.currentTarget.getBoundingClientRect()
    const box = frameBox(r.width, r.height, W, H, useStore.getState().previewView)
    const c = (v: number): number => Math.min(100, Math.max(0, v))
    return [c(((e.clientX - r.left - box.left) / box.w) * 100), c(((e.clientY - r.top - box.top) / box.h) * 100)]
  }
  const rectOf = (a: [number, number], b: [number, number]): [number, number, number, number] => [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.abs(b[0] - a[0]), Math.abs(b[1] - a[1])]
  const shown = live ?? region
  const box = frameBox(size.cw, size.ch, W, H, pv)
  return (
    <div
      ref={ref}
      className={`agent-pv${drawing ? ' is-drawing' : ''}`}
      data-testid="agent.preview"
      onPointerDown={(e) => {
        if (!drawing || e.button !== 0) return
        e.preventDefault()
        e.stopPropagation()
        e.currentTarget.setPointerCapture(e.pointerId)
        start.current = pointAt(e)
        setLive([start.current[0], start.current[1], 0, 0])
      }}
      onPointerMove={(e) => {
        if (start.current) setLive(rectOf(start.current, pointAt(e)))
      }}
      onPointerUp={(e) => {
        const a = start.current
        start.current = null
        setLive(null)
        if (!a) return
        const r = rectOf(a, pointAt(e))
        if (r[2] >= 1 && r[3] >= 1) useSession.getState().setRegion(r)
        else useSession.getState().setDrawingRegion(false)
      }}
    >
      <AgentPreviewGlow />
      {shown && size.cw > 0 && (
        <div className="agent-region" data-testid="agent.region" style={{ left: box.left + (shown[0] / 100) * box.w, top: box.top + (shown[1] / 100) * box.h, width: (shown[2] / 100) * box.w, height: (shown[3] / 100) * box.h }} />
      )}
      {act.looks.length > 0 ? (
        <span className="agent-pv-badge is-look" data-testid="agent.looked" key={act.looks[act.looks.length - 1].id}>
          <Icon name="eye" size={14} />
          {t('agent.looked')}
        </span>
      ) : (
        after && (
          <span className="agent-pv-badge" data-testid="agent.after">
            {t('agent.showingAfter')}
          </span>
        )
      )}
    </div>
  )
}
