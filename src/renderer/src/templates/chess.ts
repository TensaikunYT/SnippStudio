// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// A chess board that really plays: the moves you write (or play on the
// little board in the inspector) are read as chess — castling, en passant,
// promotion, check and mate — and each piece glides across to its square. Beside the board, the game written down as
// it goes, the move being played lit, its comment under it and the pieces
// taken so far. The sticker look: pieces with a bold ink line and a hard
// shadow, a dark frame with the files and ranks on it.

import { isDarkStyle, glide } from './model'
import { chessGame, chessLayout, chessTimes, squareAt, type ChessLayout } from './chess-plan'
import { sideOf, type Ply, type Position } from './chess-rules'
import { clamp01, fontOf, outCubic, prog, roundRect, text, type Ctx } from './draw'
import { alpha, onAccent, wrap } from './extras'

type G = Ctx['g']

/** Two colours mixed: `k` of the way from a to b. */
function mix(a: string, b: string, k: number): string {
  const p = (h: string): number[] => {
    const m = /^#?([0-9a-f]{6})$/i.exec(h)
    const n = m ? parseInt(m[1], 16) : 0
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
  }
  const A = p(a)
  const B = p(b)
  return '#' + A.map((v, i) => Math.round(v + (B[i] - v) * k).toString(16).padStart(2, '0')).join('')
}

/** The board's colours from the template's palette. */
function boardColors(c: Ctx): { light: string; dark: string; frame: string; coord: string; line: string } {
  const st = c.b.style
  if (isDarkStyle(st)) {
    return {
      light: mix(mix(st.card, st.ink, 0.42), st.accent, 0.06),
      dark: mix(mix(st.card, st.ink, 0.2), st.accent, 0.08),
      frame: mix(st.card, '#000000', 0.35),
      coord: alpha(st.ink, 0.62),
      line: mix(st.card, st.ink, 0.75)
    }
  }
  return {
    light: st.card,
    dark: mix(mix(st.card, st.ink, 0.38), st.accent, 0.12),
    frame: mix(st.ink, st.card, 0.12),
    coord: alpha(st.card, 0.72),
    line: st.ink
  }
}

// -- the pieces ------------------------------------------------------------------

const PIECE_INK = '#0b0b0d'
const WHITE = '#fbf8f1'
const BLACK = '#232429'

function rr(g: G, x: number, y: number, w: number, h: number, r: number): void {
  g.moveTo(x + r, y)
  g.arcTo(x + w, y, x + w, y + h, r)
  g.arcTo(x + w, y + h, x, y + h, r)
  g.arcTo(x, y + h, x, y, r)
  g.arcTo(x, y, x + w, y, r)
  g.closePath()
}
function circle(g: G, x: number, y: number, r: number): void {
  g.moveTo(x + r, y)
  g.arc(x, y, r, 0, Math.PI * 2)
  g.closePath()
}

/** A piece's silhouette in square units (the square is -0.5..0.5, y down),
 *  as separate parts that overlap into one shape. */
function silhouette(g: G, t: string): void {
  // The foot every piece stands on.
  rr(g, -0.3, 0.27, 0.6, 0.11, 0.045)
  rr(g, -0.24, 0.2, 0.48, 0.09, 0.03)
  const body = (top: number, neck: number): void => {
    g.moveTo(-0.17, 0.22)
    g.bezierCurveTo(-0.15, 0.08, -neck - 0.03, top + 0.06, -neck, top)
    g.lineTo(neck, top)
    g.bezierCurveTo(neck + 0.03, top + 0.06, 0.15, 0.08, 0.17, 0.22)
    g.closePath()
  }
  switch (t) {
    case 'p':
      body(-0.01, 0.07)
      rr(g, -0.15, -0.05, 0.3, 0.06, 0.03)
      circle(g, 0, -0.16, 0.12)
      break
    case 'r':
      g.moveTo(-0.17, 0.22)
      g.lineTo(-0.14, -0.08)
      g.lineTo(0.14, -0.08)
      g.lineTo(0.17, 0.22)
      g.closePath()
      rr(g, -0.19, -0.13, 0.38, 0.07, 0.02)
      g.moveTo(-0.21, -0.12)
      for (const [x, y] of [[-0.21, -0.36], [-0.12, -0.36], [-0.12, -0.29], [-0.045, -0.29], [-0.045, -0.36], [0.045, -0.36], [0.045, -0.29], [0.12, -0.29], [0.12, -0.36], [0.21, -0.36], [0.21, -0.12]]) g.lineTo(x, y)
      g.closePath()
      break
    case 'b':
      body(-0.02, 0.06)
      rr(g, -0.14, -0.07, 0.28, 0.06, 0.03)
      g.moveTo(0, -0.37)
      g.bezierCurveTo(0.15, -0.27, 0.16, -0.13, 0.09, -0.06)
      g.lineTo(-0.09, -0.06)
      g.bezierCurveTo(-0.16, -0.13, -0.15, -0.27, 0, -0.37)
      g.closePath()
      circle(g, 0, -0.39, 0.042)
      break
    case 'n':
      g.moveTo(0.19, 0.22)
      g.bezierCurveTo(0.22, 0.02, 0.2, -0.16, 0.1, -0.27)
      g.lineTo(0.09, -0.39)
      g.lineTo(0.02, -0.3)
      g.bezierCurveTo(-0.06, -0.29, -0.15, -0.22, -0.22, -0.11)
      g.bezierCurveTo(-0.265, -0.05, -0.24, 0.005, -0.18, 0.0)
      g.bezierCurveTo(-0.12, -0.005, -0.07, -0.04, -0.03, -0.06)
      g.bezierCurveTo(-0.08, 0.04, -0.17, 0.1, -0.18, 0.22)
      g.closePath()
      break
    case 'q':
    case 'k':
      body(-0.08, 0.07)
      rr(g, -0.15, -0.125, 0.3, 0.06, 0.03)
      if (t === 'q') {
        g.moveTo(-0.13, -0.1)
        for (const [x, y] of [[-0.23, -0.3], [-0.12, -0.2], [-0.1, -0.35], [-0.035, -0.21], [0, -0.38], [0.035, -0.21], [0.1, -0.35], [0.12, -0.2], [0.23, -0.3], [0.13, -0.1]]) g.lineTo(x, y)
        g.closePath()
        for (const [x, y] of [[-0.23, -0.31], [-0.1, -0.36], [0, -0.395], [0.1, -0.36], [0.23, -0.31]]) circle(g, x, y, 0.036)
      } else {
        g.moveTo(-0.14, -0.1)
        g.bezierCurveTo(-0.2, -0.2, -0.12, -0.28, 0, -0.28)
        g.bezierCurveTo(0.12, -0.28, 0.2, -0.2, 0.14, -0.1)
        g.closePath()
        rr(g, -0.029, -0.435, 0.058, 0.17, 0.012)
        rr(g, -0.085, -0.39, 0.17, 0.052, 0.012)
      }
      break
  }
}

/** The fine lines inside a piece: a knight's eye and mane, a bishop's cut. */
function details(g: G, t: string, color: string, lw: number): void {
  g.strokeStyle = color
  g.fillStyle = color
  g.lineWidth = lw
  g.lineCap = 'round'
  if (t === 'n') {
    g.beginPath()
    g.arc(-0.075, -0.19, 0.024, 0, Math.PI * 2)
    g.fill()
    g.beginPath()
    g.arc(-0.2, -0.065, 0.013, 0, Math.PI * 2)
    g.fill()
    g.beginPath()
    g.moveTo(0.1, -0.24)
    g.bezierCurveTo(0.16, -0.12, 0.165, 0.0, 0.15, 0.13)
    g.stroke()
  } else if (t === 'b') {
    g.beginPath()
    g.moveTo(0.015, -0.27)
    g.lineTo(0.085, -0.17)
    g.stroke()
  } else if (t === 'r') {
    g.beginPath()
    g.moveTo(-0.13, 0.05)
    g.lineTo(0.13, 0.05)
    g.stroke()
  }
}

/**
 * A piece at (cx, cy) on a square of side `sq`: its outline and hard shadow,
 * the flat fill, a soft turn of light across it, the fine lines. `lift` (0..1)
 * raises it off the board — bigger, its shadow further and softer.
 */
export function drawPiece(g: G, piece: string, cx: number, cy: number, sq: number, px: number, lift = 0, a = 1): void {
  if (!piece || a <= 0) return
  const t = piece.toLowerCase()
  const white = sideOf(piece) === 'w'
  const k = sq * (1 + 0.1 * lift)
  g.save()
  g.globalAlpha *= a
  g.translate(cx, cy)
  g.scale(k, k)
  g.lineJoin = 'round'
  g.beginPath()
  silhouette(g, t)
  // Canvas shadows are in device pixels, not in the scaled units.
  g.save()
  g.shadowColor = `rgba(0,0,0,${(0.34 - 0.08 * lift).toFixed(3)})`
  g.shadowOffsetX = (0.035 + 0.07 * lift) * k * px
  g.shadowOffsetY = (0.05 + 0.1 * lift) * k * px
  g.shadowBlur = 0.1 * lift * k * px
  g.strokeStyle = PIECE_INK
  g.lineWidth = 0.085
  g.stroke()
  g.restore()
  g.fillStyle = white ? WHITE : BLACK
  g.fill()
  // Light from the top left: a soft turn across the body.
  g.save()
  g.clip()
  const gr = g.createLinearGradient(-0.3, -0.4, 0.3, 0.4)
  if (white) {
    gr.addColorStop(0, 'rgba(255,255,255,0.5)')
    gr.addColorStop(0.5, 'rgba(255,255,255,0)')
    gr.addColorStop(1, 'rgba(70,50,30,0.2)')
  } else {
    gr.addColorStop(0, 'rgba(255,255,255,0.2)')
    gr.addColorStop(0.45, 'rgba(255,255,255,0)')
    gr.addColorStop(1, 'rgba(0,0,0,0.25)')
  }
  g.fillStyle = gr
  g.fillRect(-0.5, -0.5, 1, 1)
  g.restore()
  // A black piece keeps a fine light rim inside its line, so it reads on a
  // dark square.
  if (!white) {
    g.beginPath()
    silhouette(g, t)
    g.strokeStyle = 'rgba(255,255,255,0.22)'
    g.lineWidth = 0.018
    g.stroke()
  }
  details(g, t, white ? PIECE_INK : 'rgba(255,255,255,0.75)', 0.022)
  g.restore()
}

// -- the board -------------------------------------------------------------------

/** What is on the board at local time t: the position the last finished
 *  move left, the move under way (if any) and how far along it is. */
function stateAt(plies: Ply[], T: ReturnType<typeof chessTimes>, start: Position, t: number): { base: Position; moving: number; last: number } {
  let last = -1
  let moving = -1
  for (let i = 0; i < plies.length; i++) {
    if (!plies[i].move) continue
    // A move is over a moment after it lands (a taken piece shrinks away).
    const end = Math.max(T[i].t1 + 0.26, T[i].rook?.[1] ?? 0)
    if (t >= end) last = i
    else if (t >= T[i].t0) {
      moving = i
      break
    } else break
  }
  const base = moving >= 0 ? plies[moving].before : last >= 0 ? plies[last].after : start
  return { base, moving, last }
}

function drawBoard(c: Ctx, L: ChessLayout, flip: boolean): void {
  const g = c.g
  const col = boardColors(c)
  const u = c.u
  const F = L.frame
  // The frame: the sticker line, a hard shadow, the dark wood.
  const r = L.pad * 0.55
  g.save()
  g.shadowColor = 'rgba(0,0,0,0.5)'
  g.shadowOffsetX = 8 * u * c.px
  g.shadowOffsetY = 12 * u * c.px
  g.fillStyle = col.line
  roundRect(g, F.x - 5 * u, F.y - 5 * u, F.w + 10 * u, F.h + 10 * u, r + 5 * u)
  g.fill()
  g.restore()
  g.fillStyle = col.frame
  roundRect(g, F.x, F.y, F.w, F.h, r)
  g.fill()
  // The squares.
  const S = L.sq
  for (let rank = 0; rank < 8; rank++) {
    for (let file = 0; file < 8; file++) {
      g.fillStyle = (rank + file) % 2 === 0 ? col.dark : col.light
      const x = L.x + (flip ? 7 - file : file) * S
      const y = L.y + (flip ? rank : 7 - rank) * S
      g.fillRect(x, y, S + 0.5, S + 0.5)
    }
  }
  // A soft light across the whole board, and its edge set into the frame.
  const gl = g.createLinearGradient(L.x, L.y, L.x + 8 * S, L.y + 8 * S)
  gl.addColorStop(0, 'rgba(255,255,255,0.1)')
  gl.addColorStop(0.55, 'rgba(255,255,255,0)')
  gl.addColorStop(1, 'rgba(0,0,0,0.12)')
  g.fillStyle = gl
  g.fillRect(L.x, L.y, 8 * S, 8 * S)
  g.strokeStyle = 'rgba(0,0,0,0.35)'
  g.lineWidth = 2 * u
  g.strokeRect(L.x, L.y, 8 * S, 8 * S)
  // The files along the bottom, the ranks up the left.
  const fs = L.pad * 0.52
  for (let i = 0; i < 8; i++) {
    const file = 'abcdefgh'[flip ? 7 - i : i]
    const rank = String(flip ? i + 1 : 8 - i)
    text(c, file, L.x + (i + 0.5) * S, L.y + 8 * S + L.pad * 0.7, { size: fs, weight: 700, color: col.coord, align: 'center' })
    text(c, rank, L.x - L.pad * 0.5, L.y + (i + 0.5) * S + fs * 0.36, { size: fs, weight: 700, color: col.coord, align: 'center' })
  }
}

/** A square lit: the last move's from and to. */
function lightSquare(c: Ctx, L: ChessLayout, s: number, flip: boolean, a: number): void {
  if (a <= 0) return
  const [x, y] = squareAt(L, s, flip)
  c.g.fillStyle = alpha(c.b.style.accent, 0.5 * a)
  c.g.fillRect(x - L.sq / 2, y - L.sq / 2, L.sq, L.sq)
}

const MARK_COLOR: Record<string, string> = { '!!': '#1fb9a6', '!': '#5b8def', '!?': '#7f9cc8', '?!': '#e8a33d', '?': '#e8783d', '??': '#d9453b' }

export function drawChess(c: Ctx): void {
  const { g, b, u } = c
  const L = chessLayout(c.x0, c.W, c.H)
  const game = chessGame(b)
  const T = chessTimes(b, game.plies)
  const flip = !!b.flip
  const t = c.t
  // The board settles in.
  const inK = outCubic(prog(t, 0, 0.5))
  g.save()
  g.translate(0, (1 - inK) * 24 * u)
  drawBoard(c, L, flip)
  const { base, moving, last } = stateAt(game.plies, T, game.start, t)
  // The latest move's squares, lit as it lands; the move under way's own
  // square lit from the moment it is picked up.
  const lit = moving >= 0 ? moving : last
  if (lit >= 0) {
    const m = game.plies[lit].move!
    lightSquare(c, L, m.from, flip, moving >= 0 ? clamp01((t - T[lit].t0) / 0.15) : 1)
    if (t >= T[lit].t1) lightSquare(c, L, m.to, flip, clamp01((t - T[lit].t1) / 0.12))
  }
  // Check: a red glow under the king.
  if (last >= 0 && moving < 0 && game.plies[last].check) {
    const pos = game.plies[last].after
    const k = pos.board.indexOf(pos.turn === 'w' ? 'K' : 'k')
    if (k >= 0) {
      const [x, y] = squareAt(L, k, flip)
      const a = clamp01((t - T[last].t1) / 0.25)
      const rg = g.createRadialGradient(x, y, 0, x, y, L.sq * 0.62)
      rg.addColorStop(0, `rgba(235,60,50,${(0.85 * a).toFixed(3)})`)
      rg.addColorStop(1, 'rgba(235,60,50,0)')
      g.fillStyle = rg
      g.fillRect(x - L.sq / 2, y - L.sq / 2, L.sq, L.sq)
    }
  }
  // The pieces at rest (the pieces set out one after another as it opens).
  const mv = moving >= 0 ? game.plies[moving].move! : null
  const mt = moving >= 0 ? T[moving] : null
  const rookGone = (s: number): boolean => !!(mv?.rookFrom === s && mt?.rook && t >= mt.rook[0])
  for (let s = 0; s < 64; s++) {
    const pc = base.board[s]
    if (!pc) continue
    if (mv && s === mv.from) continue
    if (rookGone(s)) continue
    const [x, y] = squareAt(L, s, flip)
    const k = (flip ? 7 - (s & 7) : s & 7) + (flip ? s >> 3 : 7 - (s >> 3)) * 0.6
    const set = outCubic(prog(t, 0.2 + k * 0.025, 0.3))
    // Taken: it stays till the piece lands on it, then shrinks away.
    let a = set
    let scale = 1
    if (mv && s === mv.capturedAt && mt) {
      const q = clamp01((t - mt.t1 + 0.06) / 0.24)
      a *= 1 - q
      scale = 1 - 0.35 * q
    }
    g.save()
    g.translate(x, y)
    g.scale(scale, scale)
    drawPiece(g, pc, 0, (1 - set) * -0.12 * L.sq, L.sq, c.px, 0, a)
    g.restore()
  }
  // The move under way: lifted, gliding across.
  if (mv && mt) {
    const A = squareAt(L, mv.from, flip)
    const B = squareAt(L, mv.to, flip)
    const e = glide((t - mt.t0) / (mt.t1 - mt.t0))
    const up = Math.sin(Math.PI * clamp01((t - mt.t0) / (mt.t1 - mt.t0)))
    if (mv.rookFrom !== undefined && mv.rookTo !== undefined && mt.rook) {
      const RA = squareAt(L, mv.rookFrom, flip)
      const RB = squareAt(L, mv.rookTo, flip)
      if (t >= mt.rook[0]) {
        const er = glide((t - mt.rook[0]) / (mt.rook[1] - mt.rook[0]))
        drawPiece(g, base.board[mv.rookFrom], RA[0] + (RB[0] - RA[0]) * er, RA[1] + (RB[1] - RA[1]) * er, L.sq, c.px, Math.sin(Math.PI * clamp01(er)) * 0.8)
      }
    }
    if (t < mt.t1) {
      drawPiece(g, mv.piece, A[0] + (B[0] - A[0]) * e, A[1] + (B[1] - A[1]) * e, L.sq, c.px, up)
    } else {
      drawPiece(g, mv.promo ?? mv.piece, B[0], B[1], L.sq, c.px, 0)
      // A pawn just promoted: a quick ring of light as it turns.
      if (mv.promo) {
        const q = clamp01((t - mt.t1) / 0.26)
        g.strokeStyle = alpha(c.b.style.accent, 0.8 * (1 - q))
        g.lineWidth = 4 * u
        g.beginPath()
        g.arc(B[0], B[1], L.sq * (0.3 + 0.35 * q), 0, Math.PI * 2)
        g.stroke()
      }
    }
  }
  // The latest move's note: !!, ?, … in a badge on its square.
  if (last >= 0 && moving < 0 && game.plies[last].mark) {
    const mk = game.plies[last].mark!
    const [x, y] = squareAt(L, game.plies[last].move!.to, flip)
    const q = outCubic(clamp01((t - T[last].t1 - 0.05) / 0.25))
    const R = L.sq * 0.2 * (0.7 + 0.3 * q)
    const bx = x + L.sq * 0.36
    const by = y - L.sq * 0.36
    g.save()
    g.globalAlpha *= q
    g.fillStyle = PIECE_INK
    g.beginPath()
    g.arc(bx + 2 * u, by + 3 * u, R + 3 * u, 0, Math.PI * 2)
    g.fill()
    g.fillStyle = MARK_COLOR[mk] ?? c.b.style.accent
    g.beginPath()
    g.arc(bx, by, R, 0, Math.PI * 2)
    g.fill()
    text(c, mk, bx, by + R * 0.36, { size: R * (mk.length > 1 ? 0.95 : 1.15), weight: 800, color: '#ffffff', align: 'center' })
    g.restore()
  }
  g.restore()
  drawPanel(c, L, game.plies, T, moving >= 0 ? moving : last, inK)
}

/** The game written down beside the board (or the move under it on a Short). */
function drawPanel(c: Ctx, L: ChessLayout, plies: Ply[], T: ReturnType<typeof chessTimes>, cur: number, inK: number): void {
  const { g, b, u } = c
  const st = b.style
  const P = L.panel
  if (P.h <= 20 * u) return
  const shown = plies.filter((_, i) => c.t >= T[i].t0).length
  const firstNo = (plies[0]?.before.full ?? 1)
  const blackFirst = plies[0]?.before.turn === 'b'
  const label = (i: number): string => {
    const k = i + (blackFirst ? 1 : 0)
    return `${firstNo + Math.floor(k / 2)}.${k % 2 ? '..' : ''}`
  }
  g.save()
  g.translate((1 - inK) * 30 * u * (L.portrait ? 0 : 1), (1 - inK) * 24 * u)
  // The card.
  const r = 18 * u
  g.save()
  g.shadowColor = 'rgba(0,0,0,0.5)'
  g.shadowOffsetX = 7 * u * c.px
  g.shadowOffsetY = 10 * u * c.px
  g.fillStyle = st.ink
  roundRect(g, P.x - 5 * u, P.y - 5 * u, P.w + 10 * u, P.h + 10 * u, r + 5 * u)
  g.fill()
  g.restore()
  g.fillStyle = st.card
  roundRect(g, P.x, P.y, P.w, P.h, r)
  g.fill()
  const padX = P.w * 0.08
  const x0 = P.x + padX
  const inner = P.w - padX * 2
  const note = cur >= 0 ? (b.items[cur]?.note ?? '').trim() : ''
  const noteA = cur >= 0 ? clamp01((c.t - T[cur].t1) / 0.3) : 0
  if (L.portrait) {
    // A Short: the headline over the board; here the move and its comment.
    if (b.title) text(c, b.title, c.x0 + c.W / 2, L.frame.y - c.H * 0.035, { size: 58 * u, family: st.font, color: c.onBg, align: 'center', maxW: c.W * 0.9 })
    if (cur >= 0) {
      const san = `${label(cur)} ${plies[cur].san}`
      text(c, san, P.x + P.w / 2, P.y + P.h * (note ? 0.38 : 0.6), { size: P.h * 0.26, family: st.font, color: st.ink, align: 'center', maxW: inner })
      if (note) {
        const lines = wrap(g, note, P.h * 0.13, inner, 'Inter', 600, 2)
        lines.forEach((ln, i) => text(c, ln, P.x + P.w / 2, P.y + P.h * (0.66 + i * 0.17), { size: P.h * 0.13, weight: 600, color: alpha(st.ink, 0.75), align: 'center', alpha: noteA }))
      }
    }
    g.restore()
    return
  }
  // The headline, a short accent rule under it.
  let y = P.y + P.h * 0.1
  if (b.title) {
    const size = text(c, b.title, x0, y, { size: P.h * 0.065, family: st.font, color: st.ink, maxW: inner })
    g.fillStyle = st.accent
    roundRect(g, x0, y + size * 0.35, Math.min(inner, 70 * u), 7 * u, 3.5 * u)
    g.fill()
    y += size * 0.35 + P.h * 0.06
  } else y = P.y + P.h * 0.07
  // The taken pieces, small, at the bottom; the comment over them.
  const trayH = P.h * 0.12
  const noteLines = note ? wrap(g, note, P.h * 0.042, inner, 'Inter', 600, 3) : []
  const noteH = noteLines.length ? noteLines.length * P.h * 0.056 + P.h * 0.03 : 0
  const listBottom = P.y + P.h - trayH - noteH - P.h * 0.03
  // The moves, two to a row; the newest row kept in view.
  const rowH = P.h * 0.068
  const rows = Math.ceil((shown + (blackFirst ? 1 : 0)) / 2)
  const fit = Math.max(1, Math.floor((listBottom - y) / rowH))
  const first = Math.max(0, rows - fit)
  const colW = (inner - inner * 0.2) / 2
  const fs = rowH * 0.5
  g.save()
  g.beginPath()
  g.rect(P.x, y - rowH * 0.2, P.w, listBottom - y + rowH * 0.2)
  g.clip()
  for (let i = 0; i < shown; i++) {
    const k = i + (blackFirst ? 1 : 0)
    const row = Math.floor(k / 2)
    if (row < first) continue
    const ry = y + (row - first) * rowH + rowH * 0.62
    const a = clamp01((c.t - T[i].t0) / 0.2)
    if (k % 2 === 0 || i === 0) text(c, `${firstNo + row}.`, x0, ry, { size: fs, weight: 600, color: alpha(st.ink, 0.45), alpha: a })
    const cx = x0 + inner * 0.2 + (k % 2) * colW
    const san = plies[i].san + (plies[i].mark ?? '')
    if (i === cur) {
      g.font = fontOf(fs, 'Inter', 800)
      const w = g.measureText(san).width
      g.fillStyle = st.accent
      roundRect(g, cx - fs * 0.35, ry - fs * 0.95, w + fs * 0.7, fs * 1.35, fs * 0.35)
      g.fill()
      text(c, san, cx, ry, { size: fs, weight: 800, color: onAccent(c) })
    } else text(c, san, cx, ry, { size: fs, weight: 700, color: st.ink, alpha: a * (plies[i].move ? 1 : 0.4) })
  }
  g.restore()
  // The comment on the move being played.
  if (noteLines.length) {
    const ny = listBottom + P.h * 0.05
    noteLines.forEach((ln, i) => text(c, ln, x0, ny + i * P.h * 0.056, { size: P.h * 0.042, weight: 600, color: st.ink, alpha: noteA }))
  }
  // The pieces taken so far: White's catch on top, Black's below.
  const taken: Record<'w' | 'b', string[]> = { w: [], b: [] }
  plies.forEach((p, i) => {
    if (p.move?.captured && c.t >= T[i].t1) taken[p.before.turn].push(p.move.captured)
  })
  const ts = trayH * 0.42
  const order = 'qrbnp'
  ;(['w', 'b'] as const).forEach((side, row) => {
    const list = taken[side].slice().sort((a, b) => order.indexOf(a.toLowerCase()) - order.indexOf(b.toLowerCase()))
    list.forEach((pc, i) => drawPiece(g, pc, x0 + ts * 0.5 + i * ts * 0.62, P.y + P.h - trayH + row * trayH * 0.48 + ts * 0.55, ts, c.px))
  })
  g.restore()
}
