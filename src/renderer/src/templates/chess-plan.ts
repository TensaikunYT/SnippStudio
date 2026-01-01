// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// The chess board template's plan: where the board and its panel sit, when
// each move is played. No DOM here.

import type { TemplateBlock } from '../types'
import { fileOf, playGame, rankOf, type Ply, type Position } from './chess-rules'

type Rect = { x: number; y: number; w: number; h: number }

export interface ChessLayout {
  /** The squares' top-left corner and one square's side. */
  x: number
  y: number
  sq: number
  /** The frame round the squares (the coordinates are printed on it). */
  frame: Rect
  pad: number
  /** The move list beside the board, or the line under it on a Short. */
  panel: Rect
  portrait: boolean
}

export function chessLayout(left: number, W: number, H: number): ChessLayout {
  const portrait = W / H < 1
  if (portrait) {
    const inner = W * 0.84
    const sq = inner / 8
    const pad = sq * 0.34
    const side = inner + pad * 2
    const frame = { x: left + (W - side) / 2, y: H * 0.19, w: side, h: side }
    const top = frame.y + side + H * 0.03
    return { x: frame.x + pad, y: frame.y + pad, sq, frame, pad, panel: { x: frame.x, y: top, w: side, h: Math.min(H * 0.2, H * 0.94 - top) }, portrait }
  }
  const inner = H * 0.72
  const sq = inner / 8
  const pad = sq * 0.34
  const side = inner + pad * 2
  const gap = W * 0.035
  const panelW = Math.min(W * 0.3, W * 0.92 - side - gap)
  const x0 = left + (W - (side + gap + panelW)) / 2
  const frame = { x: x0, y: (H - side) / 2 + H * 0.01, w: side, h: side }
  return { x: frame.x + pad, y: frame.y + pad, sq, frame, pad, panel: { x: x0 + side + gap, y: frame.y, w: panelW, h: side }, portrait }
}

/** A square's middle on screen (the board seen from Black when `flip`). */
export function squareAt(L: ChessLayout, s: number, flip = false): [number, number] {
  const f = flip ? 7 - fileOf(s) : fileOf(s)
  const r = flip ? rankOf(s) : 7 - rankOf(s)
  return [L.x + (f + 0.5) * L.sq, L.y + (r + 0.5) * L.sq]
}

/** Where a moving piece is held: round its head, a little above the middle. */
export const GRIP = 0.12

export interface PlyTime {
  t0: number
  t1: number
  /** Castling: the rook's own move — after the king's when there is time,
   *  else sliding across with the king. */
  rook?: [number, number]
}

/** When each move is played (block time). The moves share the block, so a
 *  longer block is a slower game. */
export function chessTimes(b: Pick<TemplateBlock, 'duration'>, plies: Ply[]): PlyTime[] {
  const lead = 1.1
  const tail = 1.1
  const n = Math.max(1, plies.length)
  const len = Math.max(0.45, (b.duration - lead - tail) / n)
  const travel = Math.max(0.3, Math.min(0.75, len * 0.5))
  return plies.map((p, i) => {
    const t0 = lead + i * len
    const t1 = t0 + travel
    if (!p.move?.castle) return { t0, t1 }
    if (len - travel > 1.05) return { t0, t1, rook: [t1 + 0.42, t1 + 0.42 + 0.32] }
    return { t0, t1, rook: [t0 + travel * 0.35, t1] }
  })
}

const games = new Map<string, { key: string; game: ReturnType<typeof playGame> }>()

/** The block's game, worked out (kept while its moves and start are the same). */
export function chessGame(b: Pick<TemplateBlock, 'id' | 'items' | 'fen'>): { start: Position; plies: Ply[]; bad: number[] } {
  const key = `${b.fen ?? ''}|${b.items.map((it) => it.title).join(' ')}`
  const hit = games.get(b.id)
  if (hit && hit.key === key) return hit.game
  const game = playGame(b.fen, b.items.map((it) => it.title))
  games.set(b.id, { key, game })
  if (games.size > 64) games.delete(games.keys().next().value as string)
  return game
}

