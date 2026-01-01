// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// A title of paper cutouts: every word cut from a different paper in a
// different type — the ransom-note look, kept tidy — each one brought in
// quickly from the edge of the frame and laid into its
// place with a small settle, a strip of tape on some. All drawn as vector
// paths, so any word can be made bigger or smaller later.

import { cutoutLayout, cutoutTimes, glide } from './model'
import { clamp01, fontOf, type Ctx } from './draw'

const hash = (a: number, b: number): number => {
  const n = Math.sin(a * 12.9898 + b * 78.233) * 43758.5453
  return n - Math.floor(n)
}

/** A piece of paper cut round a word: four corners a little off square and
 *  a nick along each long edge, the way scissors go. */
function paperPath(g: Ctx['g'], w: number, h: number, seed: number): void {
  const j = (i: number, k: number): number => (hash(seed, i) - 0.5) * k
  const pts: [number, number][] = [
    [-w / 2 + j(1, h * 0.12), -h / 2 + j(2, h * 0.1)],
    [j(3, w * 0.1), -h / 2 + j(4, h * 0.08)],
    [w / 2 + j(5, h * 0.12), -h / 2 + j(6, h * 0.1)],
    [w / 2 + j(7, h * 0.1), h / 2 + j(8, h * 0.1)],
    [j(9, w * 0.1), h / 2 + j(10, h * 0.08)],
    [-w / 2 + j(11, h * 0.1), h / 2 + j(12, h * 0.1)]
  ]
  g.beginPath()
  pts.forEach(([x, y], i) => (i === 0 ? g.moveTo(x, y) : g.lineTo(x, y)))
  g.closePath()
}

export function drawCutout(c: Ctx): void {
  const g = c.g
  const b = c.b
  const st = b.style
  const u = c.u
  const L = cutoutLayout(b, c.x0, c.W, c.H)
  const T = cutoutTimes(b, c.x0, c.W, c.H)
  L.forEach((p, i) => {
    const tm = T[i]
    if (c.t < tm.t0) return
    // Carried in on its own glide, turning into
    // its place; then a small settle as it is pressed down.
    const e = glide((c.t - tm.t0) / (tm.t1 - tm.t0))
    const x = tm.from[0] + (p.cx - tm.from[0]) * e
    const y = tm.from[1] + (p.cy - tm.from[1]) * e
    const rot = tm.rot0 + (p.rot - tm.rot0) * e
    const since = c.t - tm.t1
    const settle = since > 0 ? 1 + 0.05 * Math.exp(-since / 0.07) * Math.cos(since * 30) * clamp01(since / 0.02) : 1.04
    const lifted = 1 - clamp01(since / 0.12)
    g.save()
    g.translate(x, y)
    g.rotate(rot)
    g.scale(settle, settle)
    // Shadow: further while carried, tight once down.
    g.save()
    g.fillStyle = `rgba(0,0,0,${(0.42 - 0.1 * lifted).toFixed(3)})`
    g.translate((6 + 10 * lifted) * u, (9 + 14 * lifted) * u)
    paperPath(g, p.w, p.h, p.seed)
    g.fill()
    g.restore()
    paperPath(g, p.w, p.h, p.seed)
    g.fillStyle = p.paper
    g.fill()
    // Paper: a faint grain across it, and the cut edge's thin light line.
    g.save()
    g.clip()
    g.strokeStyle = 'rgba(0,0,0,0.05)'
    g.lineWidth = 1
    for (let k = -p.h; k < p.h; k += 5 * u) {
      g.beginPath()
      g.moveTo(-p.w / 2, k)
      g.lineTo(p.w / 2, k + p.h * 0.2)
      g.stroke()
    }
    g.restore()
    g.strokeStyle = 'rgba(255,255,255,0.35)'
    g.lineWidth = 1.5 * u
    paperPath(g, p.w, p.h, p.seed)
    g.stroke()
    // The word.
    g.fillStyle = p.ink
    g.font = fontOf(p.size, p.font, p.weight)
    g.textAlign = 'center'
    g.textBaseline = 'middle'
    g.fillText(p.text, 0, p.size * p.dy)
    // A strip of tape on some of them.
    if (st.hand && p.tape) {
      g.save()
      g.rotate(p.tapeRot)
      g.fillStyle = 'rgba(255,250,225,0.55)'
      g.fillRect(-p.h * 0.45, -p.h / 2 - p.h * 0.18, p.h * 0.9, p.h * 0.32)
      g.restore()
    }
    g.restore()
  })
}
