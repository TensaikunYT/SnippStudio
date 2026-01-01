// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// The speed curve editor of the Clip tab (core polish, part C): a small
// graph — across, the clip's footage from its first frame on screen to its
// last; up, the speed on a log scale (0.1x – 100x) — with its points to add
// (click), move (drag) and remove (double-click, or Delete), the ready-made
// shapes, straight or eased between points, and what the curve does to the
// clip said in words (its length, its range, where it is silent).
//
// Across is the footage, not the clip's length on the timeline: dragging a
// point up or down changes how long the clip lasts, and on a time axis every
// point after it would slide sideways under the pointer (CILA-C-PLAN.md C11).
// One drag is one undo step; the clip's new length shows on the timeline as
// it is dragged.
import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react'
import { useStore } from '../../state/store'
import { AUDIBLE_MAX, AUDIBLE_MIN, PLAYABLE_MAX, SPEED_MAX, SPEED_MIN } from '../../timeline/speed'
import { CURVE_MAX_KEYS, CURVE_PRESETS, clampCurveSpeed, curveRange, curveScale, curveSpeed, hasCurve, pointsOf, type CurvePoint, type CurvePreset } from '../../timeline/speed-curve'
import type { Clip } from '../../types'
import { Button, Tooltip, useT } from '../../ui'
import { formatFree } from '../../ui/logic'
import { Switch } from './parts'

/** The graph's height (interface audit G11: at 112 it was ≈ 100 px of curve,
 *  its labels on the line). */
const H = 168
const PAD = 8
const LO = Math.log10(SPEED_MIN)
const HI = Math.log10(SPEED_MAX)
/** The speeds with a line across the graph. */
const GRID = [0.1, 0.25, 1, 4, 16, 100] as const
const shown = (v: number): string => formatFree(v, 2)

/** The order the presets are offered in. */
export const CURVE_PRESET_ORDER: readonly CurvePreset[] = ['ease-in', 'ease-out', 'slow-middle', 'fast-middle', 'pulse']

/** A preset's points around a speed (each held to the range). */
export function presetPoints(name: CurvePreset, base: number): CurvePoint[] {
  return CURVE_PRESETS[name].map((p) => ({ u: p.u, v: clampCurveSpeed(Math.round(p.v * base * 100) / 100) }))
}

/** The speed at `u` (0..1 along the clip as it plays) of a curved clip. */
export function speedAtU(clip: Clip, u: number): number {
  if (!hasCurve(clip)) return clip.speed ?? 1
  const len = clip.duration * (clip.speed ?? 1)
  const m = clip.inPoint + (clip.reversed ? 1 - u : u) * len
  return curveSpeed(clip.speedCurve, m) * (curveScale(clip) ?? 1)
}

/** Where ← / → put point `i` (moved by `d` along the clip), or null when it
 *  does not move: an end point, or one already against its neighbour. */
export function nudgeU(points: readonly CurvePoint[], i: number, d: number): number | null {
  const p = points[i]
  if (!p || p.u <= 1e-6 || p.u >= 1 - 1e-6) return null
  const lo = points[i - 1].u + 0.01
  const hi = points[i + 1].u - 0.01
  const u = Math.round(Math.min(hi, Math.max(lo, p.u + d)) * 1000) / 1000
  return Math.abs(u - p.u) < 1e-9 ? null : u
}

/** One change of the curve as one undo step. */
function commit(clipId: string, points: CurvePoint[] | null, linear?: boolean): void {
  const st = useStore.getState()
  st.armGesture()
  st.setClipSpeedCurve(clipId, points ? { points, ...(linear ? { linear: true } : {}) } : null)
  st.endGesture()
}

export function SpeedCurveEditor({ clip }: { clip: Clip }): JSX.Element {
  const t = useT()
  const box = useRef<HTMLDivElement>(null)
  const [w, setW] = useState(240)
  const [active, setActive] = useState<number | null>(null)
  const drag = useRef<{ i: number; edge: boolean } | null>(null)
  useEffect(() => {
    const el = box.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(() => setW(Math.max(120, Math.round(el.clientWidth))))
    ro.observe(el)
    setW(Math.max(120, Math.round(el.clientWidth)))
    return () => ro.disconnect()
  }, [])
  const linear = !!clip.speedCurve?.linear
  const points = pointsOf(clip)
  const x = (u: number): number => PAD + u * (w - 2 * PAD)
  const y = (v: number): number => PAD + (1 - (Math.log10(Math.min(SPEED_MAX, Math.max(SPEED_MIN, v))) - LO) / (HI - LO)) * (H - 2 * PAD)
  const at = (e: PointerEvent<SVGElement>): CurvePoint => {
    const r = (e.currentTarget.ownerSVGElement ?? (e.currentTarget as SVGSVGElement)).getBoundingClientRect()
    const u = Math.min(1, Math.max(0, (e.clientX - r.left - PAD) / Math.max(1, r.width - 2 * PAD)))
    const f = 1 - (e.clientY - r.top - PAD) / Math.max(1, r.height - 2 * PAD)
    return { u, v: clampCurveSpeed(Math.round(10 ** (LO + Math.min(1, Math.max(0, f)) * (HI - LO)) * 100) / 100) }
  }
  const set = (next: CurvePoint[]): void => useStore.getState().setClipSpeedCurve(clip.id, { points: next, ...(linear ? { linear: true } : {}) })
  const isEdge = (p: CurvePoint): boolean => p.u <= 1e-6 || p.u >= 1 - 1e-6
  const remove = (i: number): void => {
    if (points.length <= 2 || isEdge(points[i])) return
    commit(clip.id, points.filter((_, k) => k !== i), linear)
    setActive(null)
  }
  // The curve itself, sampled across the graph.
  const steps = 96
  const path = Array.from({ length: steps + 1 }, (_, k) => `${k ? 'L' : 'M'}${x(k / steps).toFixed(1)},${y(speedAtU(clip, k / steps)).toFixed(1)}`).join(' ')
  return (
    <div className="insp-curve" ref={box}>
      <svg
        className="insp-curve-graph"
        width={w}
        height={H}
        role="group"
        aria-label={t('insp.curve.editor')}
        data-testid="inspector.clip.speed.curve"
        onPointerDown={(e) => {
          // A click on the graph (not on a point) adds a point there.
          if (e.button !== 0 || points.length >= CURVE_MAX_KEYS) return
          const p = at(e)
          commit(clip.id, [...points, p].sort((a, b) => a.u - b.u), linear)
        }}
      >
        <rect className="insp-curve-silent" x={PAD} y={PAD} width={w - 2 * PAD} height={Math.max(0, y(AUDIBLE_MAX) - PAD)} />
        <rect className="insp-curve-silent" x={PAD} y={y(AUDIBLE_MIN)} width={w - 2 * PAD} height={Math.max(0, H - PAD - y(AUDIBLE_MIN))} />
        {GRID.map((v) => (
          <g key={v}>
            <line className={v === 1 ? 'insp-curve-one' : 'insp-curve-grid'} x1={PAD} x2={w - PAD} y1={y(v)} y2={y(v)} />
            <text className="insp-curve-label" x={PAD + 2} y={y(v) - 2}>{t('insp.speed.times', { v: shown(v) })}</text>
          </g>
        ))}
        <path className="insp-curve-line" d={path} />
        {points.map((p, i) => (
          <circle
            key={i}
            className={`insp-curve-point${active === i ? ' is-on' : ''}`}
            cx={x(p.u)}
            cy={y(p.v)}
            r={6}
            tabIndex={0}
            role="slider"
            aria-label={t('insp.curve.point', { n: String(i + 1), v: shown(p.v) })}
            aria-valuemin={SPEED_MIN}
            aria-valuemax={SPEED_MAX}
            aria-valuenow={p.v}
            data-testid={`inspector.clip.speed.curve.point.${i}`}
            onFocus={() => setActive(i)}
            onPointerDown={(e) => {
              e.stopPropagation()
              if (e.button !== 0) return
              ;(e.currentTarget as Element).setPointerCapture?.(e.pointerId)
              drag.current = { i, edge: isEdge(p) }
              setActive(i)
              useStore.getState().armGesture()
            }}
            onPointerMove={(e) => {
              const d = drag.current
              if (!d) return
              const q = at(e)
              const lo = d.i > 0 ? points[d.i - 1].u + 0.01 : 0
              const hi = d.i < points.length - 1 ? points[d.i + 1].u - 0.01 : 1
              const u = d.edge ? points[d.i].u : Math.min(hi, Math.max(lo, q.u))
              set(points.map((o, k) => (k === d.i ? { u, v: q.v } : o)))
            }}
            onPointerUp={() => {
              if (!drag.current) return
              drag.current = null
              useStore.getState().endGesture()
            }}
            onDoubleClick={(e) => {
              e.stopPropagation()
              remove(i)
            }}
            onKeyDown={(e: KeyboardEvent<SVGCircleElement>) => {
              if (e.key === 'Delete' || e.key === 'Backspace') {
                e.preventDefault()
                remove(i)
              } else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
                e.preventDefault()
                const f = e.key === 'ArrowUp' ? 1.1 : 1 / 1.1
                commit(clip.id, points.map((o, k) => (k === i ? { u: o.u, v: clampCurveSpeed(Math.round(o.v * f * 100) / 100) } : o)), linear)
              } else if ((e.key === 'ArrowLeft' || e.key === 'ArrowRight') && !e.altKey && !e.ctrlKey && !e.metaKey) {
                // ← / → move the point along the clip (audit item 14; they
                // stepped the playhead): a hundredth at a time, a tenth with
                // Shift, never past its neighbours; the end points stay.
                e.preventDefault()
                const u = nudgeU(points, i, (e.key === 'ArrowRight' ? 1 : -1) * (e.shiftKey ? 0.1 : 0.01))
                if (u !== null) commit(clip.id, points.map((o, k) => (k === i ? { u, v: o.v } : o)), linear)
              }
            }}
          />
        ))}
      </svg>
      <div className="hint compact-hint">{t('insp.curve.howto')}</div>
    </div>
  )
}

/** The rest of the curve's row: shapes, straight or eased, flat, and what it does. */
export function SpeedCurveTools({ clip, hasSound, isVideo }: { clip: Clip; hasSound: boolean; isVideo: boolean }): JSX.Element {
  const t = useT()
  const ramp = useStore((s) => {
    if (clip.transitionOut?.type === 'speed-ramp') return true
    const track = s.project.tracks.find((tr) => tr.id === clip.trackId)
    return !!track?.clipIds.some((id) => {
      const o = s.project.clips[id]
      return !!o && o.id !== clip.id && o.transitionOut?.type === 'speed-ramp' && Math.abs(o.start + o.duration - clip.start) < 0.06
    })
  })
  const speed = clip.speed ?? 1
  const linear = !!clip.speedCurve?.linear
  const range = curveRange(clip) ?? [speed, speed]
  const media = clip.duration * speed
  return (
    <>
      {/* The ready shapes are tiles above the graph (speed-shape-tiles.tsx,
          REF-AB item 4); a flat curve at the clip's speed stays a button. */}
      <div className="insp-row">
        <Tooltip content={t('insp.curve.reset.hint')}>
          <Button size="sm" testid="inspector.clip.speed.curve.flat" onClick={() => commit(clip.id, [{ u: 0, v: clampCurveSpeed(speed) }, { u: 1, v: clampCurveSpeed(speed) }], linear)}>
            {t('insp.curve.reset')}
          </Button>
        </Tooltip>
      </div>
      <Switch label={t('insp.curve.linear')} hint={t('insp.curve.linear.hint')} checked={linear} onChange={(on) => commit(clip.id, pointsOf(clip), on)} testid="inspector.clip.speed.curve.linear" />
      <div className="hint is-state" data-testid="inspector.clip.speed.curve.length">{t('insp.curve.length', { now: shown(clip.duration), media: shown(media), avg: shown(speed) })}</div>
      <div className="hint is-state" data-testid="inspector.clip.speed.curve.range">{t('insp.curve.range', { lo: shown(range[0]), hi: shown(range[1]) })}</div>
      {hasSound && (range[0] < AUDIBLE_MIN - 1e-9 || range[1] > AUDIBLE_MAX + 1e-9) && <div className="hint is-state" data-testid="inspector.clip.speed.curve.silent">{t('insp.curve.silent')}</div>}
      {isVideo && range[1] > PLAYABLE_MAX && <div className="hint is-state" data-testid="inspector.clip.speed.curve.stepped">{t('insp.curve.stepped')}</div>}
      {ramp && <div className="hint is-state" data-testid="inspector.clip.speed.curve.ramp">{t('insp.curve.ramp')}</div>}
    </>
  )
}
