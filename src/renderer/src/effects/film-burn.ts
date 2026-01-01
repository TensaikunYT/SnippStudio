// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// Film burning: the frame catching in the gate. As a transition the old shot
// burns away — ragged holes open from its edges, charred brown at the rim and
// glowing orange-white, the new shot showing through them, the whole frame
// over-exposing warm at the height of it. As an effect on a clip it flares
// now and then: a hot bloom from an edge with a scorched rim, gone again.
// Drawn in code, pure functions of time, so preview and export agree.

type Ctx2D = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D

const hash = (a: number, b = 0): number => {
  const n = Math.sin(a * 12.9898 + b * 78.233) * 43758.5453
  return n - Math.floor(n)
}

export function seedOf(id: string): number {
  let h = 2166136261
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 16777619)
  return (h >>> 0) % 100000
}

const smooth = (u: number): number => {
  const x = u < 0 ? 0 : u > 1 ? 1 : u
  return x * x * (3 - 2 * x)
}

interface Blob {
  x: number
  y: number
  /** Its ragged edge, as a closed polygon. */
  pts: [number, number][]
  r: number
}

/** The burns at progress f (0 → 1) over a w × h frame starting at (x0, y0). */
function burns(seed: number, f: number, x0: number, y0: number, w: number, h: number, count = 3, reach = 1.25, lag = 0.14): Blob[] {
  const out: Blob[] = []
  const diag = Math.hypot(w, h)
  for (let i = 0; i < count; i++) {
    // Each starts near an edge, a little after the one before.
    const side = Math.floor(hash(seed, i * 3 + 1) * 4)
    const along = 0.15 + 0.7 * hash(seed, i * 3 + 2)
    const cx = side === 0 ? 0.04 : side === 1 ? 0.96 : along
    const cy = side === 2 ? 0.05 : side === 3 ? 0.95 : along
    const u = smooth((f - i * lag) / (1 - (count - 1) * lag * 0.6))
    if (u <= 0) continue
    // Slow to catch, then racing (the way a frame burns).
    const r = diag * reach * (u * u * 0.85 + u * 0.15)
    const pts: [number, number][] = []
    const N = 56
    for (let k = 0; k < N; k++) {
      const a = (k / N) * Math.PI * 2
      // A ragged rim that keeps changing as it eats in.
      const j =
        0.16 * Math.sin(a * 3 + seed + i + f * 4) +
        0.09 * Math.sin(a * 7 + seed * 1.7 - f * 9) +
        0.05 * Math.sin(a * 13 + i * 2.3 + f * 17) +
        0.05 * (hash(seed + i, k + Math.floor(f * 24)) - 0.5)
      const rr = r * (1 + j)
      pts.push([x0 + cx * w + Math.cos(a) * rr, y0 + cy * h + Math.sin(a) * rr])
    }
    out.push({ x: x0 + cx * w, y: y0 + cy * h, pts, r })
  }
  return out
}

function trace(g: Ctx2D, pts: [number, number][], k = 1, cx = 0, cy = 0): void {
  g.beginPath()
  pts.forEach(([x, y], i) => {
    const px = cx + (x - cx) * k
    const py = cy + (y - cy) * k
    if (i === 0) g.moveTo(px, py)
    else g.lineTo(px, py)
  })
  g.closePath()
}

/**
 * The old shot, burning (on its own surface, in frame units): scorched brown
 * round each burn, and the holes eaten out of it, soft at the edge.
 */
export function burnHoles(g: Ctx2D, seed: number, f: number, w: number, h: number, px: number): void {
  const bl = burns(seed, f, 0, 0, w, h)
  if (!bl.length) return
  g.save()
  // Scorch: a dark brown band just outside each hole, only on the picture.
  g.globalCompositeOperation = 'source-atop'
  g.filter = `blur(${Math.max(1, 0.012 * h * px).toFixed(1)}px)`
  for (const b of bl) {
    trace(g, b.pts, 1.12, b.x, b.y)
    g.fillStyle = 'rgba(58,26,8,0.78)'
    g.fill()
  }
  // The holes.
  g.globalCompositeOperation = 'destination-out'
  g.filter = `blur(${Math.max(1, 0.006 * h * px).toFixed(1)}px)`
  for (const b of bl) {
    trace(g, b.pts, 1, b.x, b.y)
    g.fillStyle = '#000'
    g.fill()
  }
  g.restore()
}

/** The light of it, over everything (frame units): the frame heating up and
 *  flaring warm, each hole white-hot round its edge — cooling inwards to the
 *  new shot — with an orange glow spilling out over the old one. */
export function burnGlow(g: Ctx2D, seed: number, f: number, w: number, h: number, px: number): void {
  const heat = Math.sin(Math.PI * Math.min(1, Math.max(0, f)))
  if (heat <= 0.003) return
  const flick = 0.82 + 0.18 * hash(seed, Math.floor(f * 40))
  const life = Math.pow(Math.max(0, 1 - f), 0.6)
  const diag = Math.hypot(w, h)
  g.save()
  // The frame heating: warm, flickering, a white flare at the height of it.
  g.globalCompositeOperation = 'screen'
  const flare = Math.exp(-(((f - 0.42) / 0.14) ** 2))
  const gl = g.createRadialGradient(w * 0.5, h * 0.55, 0, w * 0.5, h * 0.55, diag * 0.7)
  gl.addColorStop(0, `rgba(255,226,170,${((0.22 * heat + 0.45 * flare) * flick).toFixed(3)})`)
  gl.addColorStop(0.55, `rgba(255,128,44,${((0.26 * heat + 0.2 * flare) * flick).toFixed(3)})`)
  gl.addColorStop(1, `rgba(170,40,12,${(0.3 * heat).toFixed(3)})`)
  g.fillStyle = gl
  g.fillRect(0, 0, w, h)
  for (const b of burns(seed, f, 0, 0, w, h)) {
    // Out of the frame by now: its light is gone with it.
    const near = 1 - smooth((b.r - diag * 0.75) / (diag * 0.5))
    const k = life * near * flick
    if (k <= 0.01) continue
    // Inside the hole: white-hot at the edge, cooling to nothing inwards.
    g.save()
    trace(g, b.pts, 1, b.x, b.y)
    g.clip()
    const band = Math.max(0.06 * h, b.r * 0.35)
    const hot = g.createRadialGradient(b.x, b.y, Math.max(0, b.r - band * 1.6), b.x, b.y, b.r * 1.3)
    hot.addColorStop(0, 'rgba(255,150,50,0)')
    hot.addColorStop(0.45, `rgba(255,170,70,${(0.55 * k).toFixed(3)})`)
    hot.addColorStop(0.75, `rgba(255,236,200,${(0.95 * k).toFixed(3)})`)
    hot.addColorStop(1, `rgba(255,250,235,${(0.95 * k).toFixed(3)})`)
    g.fillStyle = hot
    g.fillRect(b.x - b.r * 1.4, b.y - b.r * 1.4, b.r * 2.8, b.r * 2.8)
    g.restore()
    // Its glow spilling out over the old shot.
    g.globalCompositeOperation = 'lighter'
    g.filter = `blur(${Math.max(1, 0.035 * h * px).toFixed(1)}px)`
    g.lineWidth = 0.07 * h
    g.strokeStyle = `rgba(255,104,30,${(0.5 * k).toFixed(3)})`
    trace(g, b.pts, 1.02, b.x, b.y)
    g.stroke()
    g.filter = 'none'
    g.globalCompositeOperation = 'screen'
  }
  g.restore()
}

/**
 * Film burn on a clip (centred units: the picture is −w/2…w/2): a flare
 * every few seconds — a hot bloom from an edge with a scorched, glowing rim
 * that never eats through — and a warm flicker under it all.
 */
export function burnFlare(g: Ctx2D, seed: number, t: number, w: number, h: number, amount: number, px: number): void {
  const a = Math.max(0, Math.min(1, amount))
  if (a <= 0) return
  // Flares 4–7 s apart, each about 1.4 s.
  let k = 0
  let at = 1.2 + 2 * hash(seed, 99)
  while (at + 1.6 < t && k < 2000) {
    at += 4 + 3 * hash(seed, k + 7)
    k++
  }
  const u = (t - at) / 1.4
  g.save()
  // The warm flicker of a projector lamp.
  g.globalCompositeOperation = 'screen'
  g.fillStyle = `rgba(255,140,60,${(0.035 * a * (0.6 + 0.4 * hash(seed, Math.floor(t * 18)))).toFixed(3)})`
  g.fillRect(-w / 2, -h / 2, w, h)
  if (u > 0 && u < 1) {
    // Grows to a third of the frame and cools away, never a hole: a soft
    // white-hot bloom with an orange edge, and the frame flaring warm round it.
    const f = 0.42 * Math.sin((Math.PI * u) / 1.15)
    const heat = Math.sin(Math.PI * u) * a
    const bl = burns(seed + k * 31, f, -w / 2, -h / 2, w, h, 1, 0.9)
    for (const b of bl) {
      g.globalCompositeOperation = 'screen'
      const wide = g.createRadialGradient(b.x, b.y, 0, b.x, b.y, Math.max(w, h) * 0.9)
      wide.addColorStop(0, `rgba(255,170,80,${(0.45 * heat).toFixed(3)})`)
      wide.addColorStop(0.5, `rgba(255,110,40,${(0.18 * heat).toFixed(3)})`)
      wide.addColorStop(1, 'rgba(160,40,10,0)')
      g.fillStyle = wide
      g.fillRect(-w / 2, -h / 2, w, h)
      g.filter = `blur(${Math.max(1, 0.03 * h * px).toFixed(1)}px)`
      const core = g.createRadialGradient(b.x, b.y, 0, b.x, b.y, Math.max(1, b.r * 1.15))
      core.addColorStop(0, `rgba(255,250,236,${(0.98 * heat).toFixed(3)})`)
      core.addColorStop(0.6, `rgba(255,214,150,${(0.9 * heat).toFixed(3)})`)
      core.addColorStop(1, `rgba(255,120,40,${(0.6 * heat).toFixed(3)})`)
      g.fillStyle = core
      trace(g, b.pts, 1, b.x, b.y)
      g.fill()
      g.globalCompositeOperation = 'lighter'
      g.lineWidth = 0.05 * h
      g.strokeStyle = `rgba(255,100,28,${(0.45 * heat).toFixed(3)})`
      trace(g, b.pts, 1.04, b.x, b.y)
      g.stroke()
      g.filter = 'none'
    }
  }
  g.restore()
}
