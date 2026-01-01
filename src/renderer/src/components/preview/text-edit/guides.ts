// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// The lines a dragged thing catches on in the preview (SnippStudio
// YAZI2-PLAN.md, 2.4): the frame's middle and edges, the safe areas, and the
// sides and middles of the other things on screen. One sum for a title, a
// shape and a picture (the clip's and the text's own copies of it were two).
// Pure; tested in src/test/text-edit-guides.test.ts.

export interface Bounds {
  l: number
  t: number
  r: number
  b: number
}

export type GuideKind = 'centre' | 'edge' | 'safe' | 'box'

/** A line to catch on: 'v' stands at x = pos, 'h' lies at y = pos; `from` …
 *  `to` is how far it runs along the other axis (what it belongs to). */
export interface SnapTarget {
  axis: 'v' | 'h'
  pos: number
  kind: GuideKind
  from: number
  to: number
}

/** A line shown while something rests on it. */
export type GuideLine = SnapTarget

/** The frame's own lines: its middle, its edges, and a frame `safe` in (parts of the frame). */
export function frameTargets(width: number, height: number, o: { centres: boolean; edges: boolean; safe?: readonly number[] }): SnapTarget[] {
  const out: SnapTarget[] = []
  const v = (pos: number, kind: GuideKind): void => void out.push({ axis: 'v', pos, kind, from: 0, to: height })
  const h = (pos: number, kind: GuideKind): void => void out.push({ axis: 'h', pos, kind, from: 0, to: width })
  if (o.centres) {
    v(width / 2, 'centre')
    h(height / 2, 'centre')
  }
  if (o.edges) {
    v(0, 'edge')
    v(width, 'edge')
    h(0, 'edge')
    h(height, 'edge')
  }
  for (const s of o.safe ?? []) {
    v(width * s, 'safe')
    v(width * (1 - s), 'safe')
    h(height * s, 'safe')
    h(height * (1 - s), 'safe')
  }
  return out
}

/** Another thing's lines: its sides and its middles. */
export function boxTargets(b: Bounds, o: { centres: boolean; edges: boolean }): SnapTarget[] {
  const out: SnapTarget[] = []
  if (o.edges) {
    out.push({ axis: 'v', pos: b.l, kind: 'box', from: b.t, to: b.b }, { axis: 'v', pos: b.r, kind: 'box', from: b.t, to: b.b })
    out.push({ axis: 'h', pos: b.t, kind: 'box', from: b.l, to: b.r }, { axis: 'h', pos: b.b, kind: 'box', from: b.l, to: b.r })
  }
  if (o.centres) {
    out.push({ axis: 'v', pos: (b.l + b.r) / 2, kind: 'box', from: b.t, to: b.b })
    out.push({ axis: 'h', pos: (b.t + b.b) / 2, kind: 'box', from: b.l, to: b.r })
  }
  return out
}

/** Middle on middle is taken before a side at the same distance. */
const RANK: Record<GuideKind, number> = { centre: 0, box: 1, safe: 2, edge: 3 }

/**
 * A box being moved, caught: how far to shift it so one of its three lines
 * per axis (a side, the middle, the other side) rests on the nearest target
 * within `threshold`, and the lines it then rests on (every one it meets,
 * each run on to reach the box). `lock` leaves one axis alone.
 */
export function snapMove(box: Bounds, targets: readonly SnapTarget[], threshold: number, lock?: 'x' | 'y'): { dx: number; dy: number; guides: GuideLine[] } {
  const mine = { v: [box.l, (box.l + box.r) / 2, box.r], h: [box.t, (box.t + box.b) / 2, box.b] }
  const best = (axis: 'v' | 'h'): number | null => {
    let d: number | null = null
    let rank = 99
    for (const t of targets) {
      if (t.axis !== axis) continue
      mine[axis].forEach((m, i) => {
        const by = t.pos - m
        if (Math.abs(by) > threshold) return
        // A middle on a middle before anything else as near.
        const r = RANK[t.kind] + (i === 1 ? 0 : 0.5)
        if (d === null || Math.abs(by) < Math.abs(d) - 1e-6 || (Math.abs(Math.abs(by) - Math.abs(d)) <= 1e-6 && r < rank)) {
          d = by
          rank = r
        }
      })
    }
    return d
  }
  const sx = lock === 'x' ? null : best('v')
  const sy = lock === 'y' ? null : best('h')
  const dx = sx ?? 0
  const dy = sy ?? 0
  const moved: Bounds = { l: box.l + dx, r: box.r + dx, t: box.t + dy, b: box.b + dy }
  const guides: GuideLine[] = []
  const seen = new Set<string>()
  const meet = (axis: 'v' | 'h', on: boolean): void => {
    if (!on) return
    const lines = axis === 'v' ? [moved.l, (moved.l + moved.r) / 2, moved.r] : [moved.t, (moved.t + moved.b) / 2, moved.b]
    const lo = axis === 'v' ? moved.t : moved.l
    const hi = axis === 'v' ? moved.b : moved.r
    for (const t of targets) {
      if (t.axis !== axis || !lines.some((m) => Math.abs(m - t.pos) < 0.01)) continue
      const key = `${axis}:${t.pos.toFixed(2)}`
      const from = Math.min(t.from, lo)
      const to = Math.max(t.to, hi)
      if (seen.has(key)) {
        // Two things on one line: one guide, run over both.
        const g = guides.find((x) => x.axis === axis && Math.abs(x.pos - t.pos) < 0.01)
        if (g) {
          g.from = Math.min(g.from, from)
          g.to = Math.max(g.to, to)
          if (RANK[t.kind] < RANK[g.kind]) g.kind = t.kind
        }
        continue
      }
      seen.add(key)
      guides.push({ axis, pos: t.pos, kind: t.kind, from, to })
    }
  }
  meet('v', sx !== null)
  meet('h', sy !== null)
  return { dx, dy, guides }
}
