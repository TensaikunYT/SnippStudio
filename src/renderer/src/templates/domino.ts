// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// Domino: one thing leads to another. Tiles stand in a row on a shelf; the
// first one tips over, and each falls — faster as it goes, as
// a thing falling does — onto the next and leans there, the last one lying
// flat. As each tile goes, its word comes up under it on a small sticker:
// the chain reads left to right. No bounce: a tile comes to rest.

import { dominoLayout, dominoTimes } from './model'
import { clamp01, fontOf, headline, outCubic, prog, roundRect, text, type Ctx } from './draw'

/** Where the pips of a die face go (in a unit square, −0.5..0.5). */
const PIPS: Record<number, [number, number][]> = {
  1: [[0, 0]],
  2: [[-0.25, -0.25], [0.25, 0.25]],
  3: [[-0.25, -0.25], [0, 0], [0.25, 0.25]],
  4: [[-0.25, -0.25], [0.25, -0.25], [-0.25, 0.25], [0.25, 0.25]],
  5: [[-0.25, -0.25], [0.25, -0.25], [0, 0], [-0.25, 0.25], [0.25, 0.25]],
  6: [[-0.25, -0.28], [0.25, -0.28], [-0.25, 0], [0.25, 0], [-0.25, 0.28], [0.25, 0.28]]
}

const pick = (seed: number, i: number, k: number): number => {
  const x = Math.sin((seed + 1) * 12.9898 + i * 78.233 + k * 37.719) * 43758.5453
  return 1 + Math.floor((x - Math.floor(x)) * 6)
}

export function drawDomino(c: Ctx): void {
  const { g, b, u } = c
  const st = b.style
  const L = dominoLayout(b, c.x0, c.W, c.H)
  const T = dominoTimes(b, L)
  const n = L.tiles.length
  const appear = outCubic(prog(c.t, 0, 0.5))
  headline(c)
  // The shelf they stand on.
  g.save()
  g.globalAlpha *= appear
  g.shadowColor = 'rgba(0,0,0,0.45)'
  g.shadowBlur = 14 * u
  g.shadowOffsetY = 8 * u
  g.fillStyle = st.ink
  roundRect(g, L.shelf.x - 4 * u, L.shelf.y - 4 * u, L.shelf.w + 8 * u, L.shelf.h + 8 * u, 10 * u)
  g.fill()
  g.shadowColor = 'transparent'
  g.fillStyle = st.card
  roundRect(g, L.shelf.x, L.shelf.y, L.shelf.w, L.shelf.h, 7 * u)
  g.fill()
  g.restore()
  // The tiles, last first, so each leans over the one after it.
  for (let i = n - 1; i >= 0; i--) {
    const tile = L.tiles[i]
    const k = outCubic(prog(c.t, 0.1 + 0.07 * i, 0.45))
    if (k <= 0) continue
    const th = T.angle(i, c.t)
    g.save()
    g.globalAlpha *= k
    // Turned about its bottom corner on the falling side.
    g.translate(tile.x + L.tw / 2, L.floor)
    g.rotate(th)
    g.translate(-L.tw / 2, (1 - k) * 30 * u)
    const w = L.tw
    const h = L.th
    const r = w * 0.16
    const ol = 5.5 * u
    g.save()
    g.shadowColor = 'rgba(0,0,0,0.5)'
    g.shadowBlur = 14 * u
    g.shadowOffsetX = 5 * u
    g.shadowOffsetY = 7 * u
    g.fillStyle = st.ink
    roundRect(g, -w / 2 - ol, -h - ol, w + ol * 2, h + ol * 2, r + ol)
    g.fill()
    g.restore()
    g.fillStyle = st.card
    roundRect(g, -w / 2, -h, w, h, r)
    g.fill()
    // A soft light down its face.
    const sheen = g.createLinearGradient(-w / 2, 0, w / 2, 0)
    sheen.addColorStop(0, 'rgba(255,255,255,0.0)')
    sheen.addColorStop(0.3, 'rgba(255,255,255,0.18)')
    sheen.addColorStop(1, 'rgba(0,0,0,0.06)')
    g.fillStyle = sheen
    roundRect(g, -w / 2, -h, w, h, r)
    g.fill()
    // The line across its middle, and the pips on each half.
    g.fillStyle = st.ink
    g.fillRect(-w * 0.36, -h / 2 - 2.5 * u, w * 0.72, 5 * u)
    for (const [half, cy] of [[0, -h * 0.75], [1, -h * 0.25]] as const) {
      const face = PIPS[pick(b.seed, i, half)]
      for (const [px, py] of face) {
        g.beginPath()
        g.arc(px * w * 0.95, cy + py * w * 0.95, w * 0.075, 0, Math.PI * 2)
        g.fill()
      }
    }
    // Once it has gone over, a touch of the accent along its edge.
    const lit = clamp01((c.t - T.fall[i]) / 0.35)
    if (lit > 0) {
      g.strokeStyle = st.accent
      g.globalAlpha *= lit
      g.lineWidth = 6 * u
      roundRect(g, -w / 2 + 6 * u, -h + 6 * u, w - 12 * u, h - 12 * u, r * 0.7)
      g.stroke()
    }
    g.restore()
  }
  // The words: each comes up under its tile as it falls.
  b.items.forEach((it, i) => {
    const tile = L.tiles[i]
    const k = outCubic(prog(c.t, T.fall[i] + 0.08, 0.4))
    if (k <= 0 || !it.title) return
    const size = L.label
    g.font = fontOf(size, st.font, 800)
    const tw = Math.min(L.step * 0.94, g.measureText(it.title).width + size * 0.9)
    const x = tile.x - tw / 2
    const y = L.shelf.y + L.shelf.h + 18 * u + (1 - k) * 14 * u
    const h = size * 1.6
    g.save()
    g.globalAlpha *= k
    g.fillStyle = st.ink
    roundRect(g, x - 4 * u, y - 4 * u, tw + 8 * u, h + 8 * u, 12 * u)
    g.fill()
    g.fillStyle = st.card
    roundRect(g, x, y, tw, h, 9 * u)
    g.fill()
    g.fillStyle = st.accent
    g.fillRect(x + tw * 0.2, y + h - 7 * u, tw * 0.6 * k, 4 * u)
    text(c, it.title, x + tw / 2, y + h * 0.66, { size, family: st.font, weight: 800, color: st.ink, align: 'center', maxW: tw - size * 0.6 })
    g.restore()
  })
}
