// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// Chess as rules: a position, the legal moves in it, and moves read and
// written in the usual notation — "Nf3", "exd5", "O-O", "e8=Q+", also
// "e2e4" and the Turkish letters (Ş V K F A). No DOM here, so all of it is
// unit-tested directly.

export type Side = 'w' | 'b'

export interface Position {
  /** a1 = 0, b1 = 1 … h8 = 63: '' empty, 'PNBRQK' white, 'pnbrqk' black. */
  board: string[]
  turn: Side
  /** Castling still allowed: some of 'KQkq'. */
  castle: string
  /** The square a pawn could take en passant, or -1. */
  ep: number
  half: number
  full: number
}

export interface Move {
  from: number
  to: number
  /** The piece as it stands on the board. */
  piece: string
  captured?: string
  /** Where the captured piece stood (not `to` when en passant). */
  capturedAt?: number
  /** What a pawn becomes, in the mover's case. */
  promo?: string
  castle?: 'K' | 'Q'
  rookFrom?: number
  rookTo?: number
}

export const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1'

export const fileOf = (s: number): number => s & 7
export const rankOf = (s: number): number => s >> 3
export const sqName = (s: number): string => 'abcdefgh'[fileOf(s)] + (rankOf(s) + 1)
export function sqOf(name: string): number {
  const f = name.charCodeAt(0) - 97
  const r = name.charCodeAt(1) - 49
  return name.length === 2 && f >= 0 && f < 8 && r >= 0 && r < 8 ? r * 8 + f : -1
}
export const sideOf = (p: string): Side | null => (p ? (p === p.toUpperCase() ? 'w' : 'b') : null)
const at = (f: number, r: number): number => (f >= 0 && f < 8 && r >= 0 && r < 8 ? r * 8 + f : -1)

export function parseFen(fen: string): Position | null {
  const parts = fen.trim().split(/\s+/)
  const rows = parts[0]?.split('/')
  if (!rows || rows.length !== 8) return null
  const board: string[] = Array(64).fill('')
  for (let r = 0; r < 8; r++) {
    let f = 0
    for (const ch of rows[r]) {
      if (/[1-8]/.test(ch)) f += Number(ch)
      else if (/[pnbrqkPNBRQK]/.test(ch)) {
        if (f > 7) return null
        board[(7 - r) * 8 + f] = ch
        f++
      } else return null
    }
    if (f !== 8) return null
  }
  if (board.filter((p) => p === 'K').length !== 1 || board.filter((p) => p === 'k').length !== 1) return null
  const ep = parts[3] && parts[3] !== '-' ? sqOf(parts[3]) : -1
  return {
    board,
    turn: parts[1] === 'b' ? 'b' : 'w',
    castle: (parts[2] ?? '-').replace(/[^KQkq]/g, ''),
    ep,
    half: Number(parts[4]) || 0,
    full: Math.max(1, Number(parts[5]) || 1)
  }
}

export function toFen(p: Position): string {
  const rows: string[] = []
  for (let r = 7; r >= 0; r--) {
    let row = ''
    let gap = 0
    for (let f = 0; f < 8; f++) {
      const pc = p.board[r * 8 + f]
      if (!pc) gap++
      else {
        if (gap) row += gap
        gap = 0
        row += pc
      }
    }
    rows.push(row + (gap ? gap : ''))
  }
  return `${rows.join('/')} ${p.turn} ${p.castle || '-'} ${p.ep >= 0 ? sqName(p.ep) : '-'} ${p.half} ${p.full}`
}

const KNIGHT = [[1, 2], [2, 1], [2, -1], [1, -2], [-1, -2], [-2, -1], [-2, 1], [-1, 2]]
const KING = [[1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1]]
const DIAG = [[1, 1], [1, -1], [-1, 1], [-1, -1]]
const ORTH = [[1, 0], [-1, 0], [0, 1], [0, -1]]

/** Is square `sq` attacked by a piece of side `by`? */
export function attacked(board: string[], sq: number, by: Side): boolean {
  const f = fileOf(sq)
  const r = rankOf(sq)
  const is = (s: number, t: string): boolean => s >= 0 && board[s] !== '' && sideOf(board[s]) === by && board[s].toLowerCase() === t
  // A white pawn attacks from one rank below, a black one from above.
  const pr = by === 'w' ? r - 1 : r + 1
  if (is(at(f - 1, pr), 'p') || is(at(f + 1, pr), 'p')) return true
  for (const [df, dr] of KNIGHT) if (is(at(f + df, r + dr), 'n')) return true
  for (const [df, dr] of KING) if (is(at(f + df, r + dr), 'k')) return true
  for (const [dirs, kinds] of [[DIAG, 'bq'], [ORTH, 'rq']] as const) {
    for (const [df, dr] of dirs) {
      let ff = f + df
      let rr = r + dr
      while (ff >= 0 && ff < 8 && rr >= 0 && rr < 8) {
        const pc = board[rr * 8 + ff]
        if (pc) {
          if (sideOf(pc) === by && kinds.includes(pc.toLowerCase())) return true
          break
        }
        ff += df
        rr += dr
      }
    }
  }
  return false
}

export function inCheck(p: Position, side: Side = p.turn): boolean {
  const k = p.board.indexOf(side === 'w' ? 'K' : 'k')
  return k >= 0 && attacked(p.board, k, side === 'w' ? 'b' : 'w')
}

function pseudoMoves(p: Position): Move[] {
  const out: Move[] = []
  const me = p.turn
  const them: Side = me === 'w' ? 'b' : 'w'
  for (let s = 0; s < 64; s++) {
    const pc = p.board[s]
    if (!pc || sideOf(pc) !== me) continue
    const t = pc.toLowerCase()
    const f = fileOf(s)
    const r = rankOf(s)
    const add = (to: number, extra: Partial<Move> = {}): void => {
      const cap = p.board[to]
      out.push({ from: s, to, piece: pc, ...(cap ? { captured: cap, capturedAt: to } : {}), ...extra })
    }
    if (t === 'p') {
      const dir = me === 'w' ? 1 : -1
      const last = me === 'w' ? 7 : 0
      const step = (to: number): void => {
        if (rankOf(to) === last) for (const q of 'qrbn') add(to, { promo: me === 'w' ? q.toUpperCase() : q })
        else add(to)
      }
      const one = at(f, r + dir)
      if (one >= 0 && !p.board[one]) {
        step(one)
        const two = at(f, r + 2 * dir)
        if (r === (me === 'w' ? 1 : 6) && two >= 0 && !p.board[two]) add(two)
      }
      for (const df of [-1, 1]) {
        const to = at(f + df, r + dir)
        if (to < 0) continue
        if (p.board[to] && sideOf(p.board[to]) === them) step(to)
        else if (to === p.ep && !p.board[to]) {
          const capAt = at(f + df, r)
          if (capAt >= 0 && p.board[capAt]) out.push({ from: s, to, piece: pc, captured: p.board[capAt], capturedAt: capAt })
        }
      }
    } else if (t === 'n' || t === 'k') {
      for (const [df, dr] of t === 'n' ? KNIGHT : KING) {
        const to = at(f + df, r + dr)
        if (to >= 0 && sideOf(p.board[to]) !== me) add(to)
      }
      if (t === 'k') {
        const home = me === 'w' ? 4 : 60
        const rook = me === 'w' ? 'R' : 'r'
        if (s === home && !attacked(p.board, home, them)) {
          const k = me === 'w' ? 'K' : 'k'
          const q = me === 'w' ? 'Q' : 'q'
          if (p.castle.includes(k) && p.board[home + 3] === rook && !p.board[home + 1] && !p.board[home + 2] && !attacked(p.board, home + 1, them) && !attacked(p.board, home + 2, them)) {
            out.push({ from: s, to: home + 2, piece: pc, castle: 'K', rookFrom: home + 3, rookTo: home + 1 })
          }
          if (p.castle.includes(q) && p.board[home - 4] === rook && !p.board[home - 1] && !p.board[home - 2] && !p.board[home - 3] && !attacked(p.board, home - 1, them) && !attacked(p.board, home - 2, them)) {
            out.push({ from: s, to: home - 2, piece: pc, castle: 'Q', rookFrom: home - 4, rookTo: home - 1 })
          }
        }
      }
    } else {
      const dirs = t === 'b' ? DIAG : t === 'r' ? ORTH : [...DIAG, ...ORTH]
      for (const [df, dr] of dirs) {
        let ff = f + df
        let rr = r + dr
        while (ff >= 0 && ff < 8 && rr >= 0 && rr < 8) {
          const to = rr * 8 + ff
          const q = p.board[to]
          if (q) {
            if (sideOf(q) === them) add(to)
            break
          }
          add(to)
          ff += df
          rr += dr
        }
      }
    }
  }
  return out
}

/** The position after a move (the move is taken as legal). */
export function play(p: Position, m: Move): Position {
  const board = p.board.slice()
  board[m.from] = ''
  if (m.capturedAt !== undefined && m.capturedAt !== m.to) board[m.capturedAt] = ''
  board[m.to] = m.promo ?? m.piece
  if (m.rookFrom !== undefined && m.rookTo !== undefined) {
    board[m.rookTo] = board[m.rookFrom]
    board[m.rookFrom] = ''
  }
  let castle = p.castle
  const drop = (chars: string): void => {
    for (const ch of chars) castle = castle.replace(ch, '')
  }
  if (m.piece === 'K') drop('KQ')
  if (m.piece === 'k') drop('kq')
  for (const s of [m.from, m.to]) {
    if (s === 0) drop('Q')
    if (s === 7) drop('K')
    if (s === 56) drop('q')
    if (s === 63) drop('k')
  }
  const pawn = m.piece.toLowerCase() === 'p'
  return {
    board,
    turn: p.turn === 'w' ? 'b' : 'w',
    castle,
    ep: pawn && Math.abs(m.to - m.from) === 16 ? (m.from + m.to) / 2 : -1,
    half: pawn || m.captured ? 0 : p.half + 1,
    full: p.turn === 'b' ? p.full + 1 : p.full
  }
}

export function legalMoves(p: Position): Move[] {
  return pseudoMoves(p).filter((m) => !inCheck(play(p, m), p.turn))
}

/** A move written the usual way: "Nbd2", "exd5", "O-O", "e8=Q+", "Qxf7#". */
export function toSan(p: Position, m: Move): string {
  let s: string
  if (m.castle) s = m.castle === 'K' ? 'O-O' : 'O-O-O'
  else {
    const t = m.piece.toUpperCase()
    if (t === 'P') {
      s = (m.captured ? 'abcdefgh'[fileOf(m.from)] + 'x' : '') + sqName(m.to) + (m.promo ? '=' + m.promo.toUpperCase() : '')
    } else {
      const twins = legalMoves(p).filter((o) => o.piece === m.piece && o.to === m.to && o.from !== m.from)
      let dis = ''
      if (twins.length) {
        if (!twins.some((o) => fileOf(o.from) === fileOf(m.from))) dis = 'abcdefgh'[fileOf(m.from)]
        else if (!twins.some((o) => rankOf(o.from) === rankOf(m.from))) dis = String(rankOf(m.from) + 1)
        else dis = sqName(m.from)
      }
      s = t + dis + (m.captured ? 'x' : '') + sqName(m.to)
    }
  }
  const after = play(p, m)
  if (inCheck(after)) s += legalMoves(after).length === 0 ? '#' : '+'
  return s
}

/** Turkish piece letters to English: Şah, Vezir, Kale, Fil, At. */
const TR: Record<string, string> = { Ş: 'K', V: 'Q', K: 'R', F: 'B', A: 'N' }

/** The legal move a written one means, or null. Takes SAN (with or without
 *  check marks and !? notes), "e2e4" / "e7e8q", "0-0", and Turkish letters. */
export function readMove(p: Position, written: string): Move | null {
  const clean = written
    .trim()
    .replace(/[!?+#]+$/g, '')
    .replace(/[+#]/g, '')
    .replace(/\s*e\.p\.?$/i, '')
    .replace(/[–—]/g, '-')
  if (!clean) return null
  const legal = legalMoves(p)
  if (/^[0O]-[0O](-[0O])?$/i.test(clean)) {
    const side = clean.length > 3 ? 'Q' : 'K'
    return legal.find((m) => m.castle === side) ?? null
  }
  const uci = /^([a-h][1-8])-?([a-h][1-8])=?([qrbnQRBN])?$/.exec(clean)
  if (uci) {
    const from = sqOf(uci[1])
    const to = sqOf(uci[2])
    const hits = legal.filter((m) => m.from === from && m.to === to)
    if (hits.length) return hits.find((m) => !m.promo || m.promo.toLowerCase() === (uci[3] ?? 'q').toLowerCase()) ?? hits[0]
  }
  const tryAs = (text: string): Move | null => {
    const san = /^([KQRBN])?([a-h])?([1-8])?[x:]?([a-h][1-8])(?:=?([QRBN]))?$/.exec(text)
    if (!san) return null
    const type = san[1] ?? 'P'
    const to = sqOf(san[4])
    const hits = legal.filter(
      (m) =>
        m.piece.toUpperCase() === type &&
        m.to === to &&
        !m.castle &&
        (!san[2] || fileOf(m.from) === san[2].charCodeAt(0) - 97) &&
        (!san[3] || rankOf(m.from) === Number(san[3]) - 1)
    )
    if (!hits.length) return null
    const promo = (san[5] ?? 'Q').toLowerCase()
    const pick = hits.filter((m) => !m.promo || m.promo.toLowerCase() === promo)
    // Two different pieces fit: the notation is ambiguous.
    const froms = new Set(pick.map((m) => m.from))
    return froms.size === 1 ? pick[0] : null
  }
  const first = clean[0]
  const english = tryAs(clean)
  if (english) return english
  if (TR[first]) return tryAs(TR[first] + clean.slice(1))
  return null
}

/** The moves in a pasted game: move numbers, {comments}, (side lines), $n
 *  marks and the result are dropped; each move keeps its !? note. */
export function readMoveList(text: string): string[] {
  let s = text.replace(/\{[^}]*\}/g, ' ').replace(/;[^\n]*/g, ' ').replace(/\[[^\]]*\]/g, ' ')
  // Side lines, innermost first.
  for (let k = 0; k < 20 && /\([^()]*\)/.test(s); k++) s = s.replace(/\([^()]*\)/g, ' ')
  return s
    .replace(/\$\d+/g, ' ')
    .replace(/\d+\s*\.(\.\.)?/g, ' ')
    .replace(/…/g, ' ')
    .split(/[\s,]+/)
    .map((w) => w.trim())
    .filter((w) => w && !/^(1-0|0-1|1\/2-1\/2|½-½|\*)$/.test(w))
}

/** The !? note written after a move ("Nf6??" → "??"), if any. */
export function moveMark(written: string): '!!' | '!' | '?' | '??' | '!?' | '?!' | null {
  const m = /([!?]{1,2})\s*$/.exec(written.replace(/[+#]/g, ''))
  if (!m) return null
  const v = m[1]
  return v === '!!' || v === '!' || v === '?' || v === '??' || v === '!?' || v === '?!' ? v : null
}

/** One move of a game, worked out. */
export interface Ply {
  /** The move as written by the user. */
  written: string
  move: Move | null
  san: string
  before: Position
  after: Position
  check: boolean
  mate: boolean
  mark: ReturnType<typeof moveMark>
}

/** A whole game from a start position: each written move read against the
 *  position it is played in. A move that isn't legal there is kept (so the
 *  list stays as written) but plays nothing. */
export function playGame(fen: string | undefined, written: string[]): { start: Position; plies: Ply[]; bad: number[] } {
  const start = (fen && parseFen(fen)) || parseFen(START_FEN)!
  let pos = start
  const plies: Ply[] = []
  const bad: number[] = []
  written.forEach((w, i) => {
    const m = readMove(pos, w)
    if (!m) {
      bad.push(i)
      plies.push({ written: w, move: null, san: w.trim(), before: pos, after: pos, check: false, mate: false, mark: moveMark(w) })
      return
    }
    const san = toSan(pos, m)
    const after = play(pos, m)
    plies.push({ written: w, move: m, san, before: pos, after, check: san.endsWith('+') || san.endsWith('#'), mate: san.endsWith('#'), mark: moveMark(w) })
    pos = after
  })
  return { start, plies, bad }
}
