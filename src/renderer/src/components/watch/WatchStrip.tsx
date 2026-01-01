// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// The thin film strip of the watch mode (IZLE-PLAN.md; the mock-up's 7th
// screen): the whole film in one bar, a pin for each note (its colour its
// status), the agent's trail under it, the playhead. A click goes there, a
// drag is a range note, a pin is that note.
import { useEffect, useRef, useState } from 'react'
import { useStore } from '../../state/store'
import { projectDuration, type WorkNote } from '../../types'
import { BareButton, Tooltip, useT } from '../../ui'
import { goToNote } from '../../notes/review'
import { trailOf } from '../../agent/activity'
import { useAgentJob } from '../agent/useJob'
import { startWatchNote } from './watch-state'
import { stripTime, stripX, watchSpan } from './watch-math'

const PAD = 10
const DRAG_PX = 4

function useWidth(ref: React.RefObject<HTMLElement>): number {
  const [w, setW] = useState(0)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const ro = new ResizeObserver(() => setW(el.clientWidth))
    ro.observe(el)
    setW(el.clientWidth)
    return () => ro.disconnect()
  }, [ref])
  return w
}

export function WatchStrip(): JSX.Element {
  const t = useT()
  const ref = useRef<HTMLDivElement>(null)
  const w = useWidth(ref)
  const length = useStore((s) => Math.max(projectDuration(s.project), 0.001))
  const now = useStore((s) => s.currentTime)
  const notes = useStore((s) => s.project.notes) ?? []
  const sel = useStore((s) => s.noteSel)
  const draft = useStore((s) => s.noteDraft)
  const job = useAgentJob()
  const trail = job.job ? trailOf(job.job, length) : []
  const [drag, setDrag] = useState<[number, number] | null>(null)
  const x = (sec: number): number => stripX(sec, length, w, PAD)

  const down = (e: React.PointerEvent<HTMLDivElement>): void => {
    if (e.button !== 0) return
    e.preventDefault()
    const el = e.currentTarget
    el.setPointerCapture(e.pointerId)
    const r = el.getBoundingClientRect()
    const x0 = e.clientX
    const at = (cx: number): number => stripTime(cx - r.left, length, r.width, PAD)
    const t0 = at(x0)
    let dragging = false
    const move = (ev: PointerEvent): void => {
      if (!dragging && Math.abs(ev.clientX - x0) < DRAG_PX) return
      dragging = true
      setDrag([t0, at(ev.clientX)])
    }
    const up = (ev: PointerEvent): void => {
      el.removeEventListener('pointermove', move)
      el.removeEventListener('pointerup', up)
      el.removeEventListener('pointercancel', up)
      setDrag(null)
      const t1 = at(ev.clientX)
      if (dragging && Math.abs(t1 - t0) >= 0.1) {
        startWatchNote({ start: Math.min(t0, t1), end: Math.max(t0, t1) })
        return
      }
      const s = useStore.getState()
      s.setTime(t1)
    }
    el.addEventListener('pointermove', move)
    el.addEventListener('pointerup', up)
    el.addEventListener('pointercancel', up)
  }

  const band = (a: number, b: number, cls: string, key: string, test?: string): JSX.Element => (
    <span key={key} className={cls} data-testid={test} style={{ left: x(Math.min(a, b)), width: Math.max(2, x(Math.max(a, b)) - x(Math.min(a, b))) }} />
  )
  const ranged = (n: Pick<WorkNote, 'start' | 'end'>): boolean => n.end - n.start >= 0.1

  return (
    <div ref={ref} className="watch-strip" data-testid="watch.strip" role="group" aria-label={t('izle.strip')} onPointerDown={down}>
      <div className="watch-strip-film" />
      {notes.filter(ranged).map((n) => band(n.start, n.end, `watch-strip-range is-${n.status}`, `r${n.id}`))}
      {draft && ranged(draft) && band(draft.start, draft.end, 'watch-strip-range is-draft', 'draft', 'watch.strip.draft')}
      {drag && band(drag[0], drag[1], 'watch-strip-range is-draft', 'drag', 'watch.strip.drag')}
      {trail.map((p, i) => band(p.from, p.to, `watch-strip-trail${p.wrote ? ' is-wrote' : ''}`, `t${i}`, 'watch.strip.trail'))}
      {w > 0 &&
        notes.map((n) => (
          <Tooltip key={n.id} content={n.text ? `${t('izle.pin', { num: n.num, time: watchSpan(n) })} · ${n.text}` : t('izle.pin', { num: n.num, time: watchSpan(n) })}>
            <BareButton
              className={`watch-pin is-${n.status}${n.id === sel ? ' is-on' : ''}`}
              style={{ left: x(n.start) }}
              testid={`watch.pin.${n.num}`}
              data-status={n.status}
              aria-label={t('izle.pin', { num: n.num, time: watchSpan(n) })}
              onPointerDown={(e) => e.stopPropagation()}
              onClick={() => goToNote(n.id)}
            />
          </Tooltip>
        ))}
      {w > 0 && <span className="watch-strip-head" data-testid="watch.strip.head" style={{ left: x(now) }} aria-hidden="true" />}
    </div>
  )
}
