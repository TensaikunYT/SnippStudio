// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
import assert from 'node:assert/strict'
import test from 'node:test'
import { legalMoves, parseFen, play, playGame, readMove, readMoveList, START_FEN, toFen, toSan, type Position } from '../renderer/src/templates/chess-rules'

function perft(p: Position, depth: number): number {
  if (depth === 0) return 1
  let n = 0
  for (const m of legalMoves(p)) n += perft(play(p, m), depth - 1)
  return n
}

test('chess: move counts match the known perft numbers', () => {
  const start = parseFen(START_FEN)!
  assert.equal(perft(start, 1), 20)
  assert.equal(perft(start, 2), 400)
  assert.equal(perft(start, 3), 8902)
  // "Kiwipete": castling, en passant, promotions and pins all at once.
  const kiwi = parseFen('r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1')!
  assert.equal(perft(kiwi, 1), 48)
  assert.equal(perft(kiwi, 2), 2039)
  // Position 3: en passant into a discovered check along the rank.
  const p3 = parseFen('8/2p5/3p4/KP5r/1R3p1k/8/4P1P1/8 w - - 0 1')!
  assert.equal(perft(p3, 3), 2812)
})

test('chess: FEN round-trips', () => {
  assert.equal(toFen(parseFen(START_FEN)!), START_FEN)
  assert.equal(parseFen('not a fen'), null)
})

test("chess: Scholar's mate reads, plays and is written back with its marks", () => {
  const g = playGame(undefined, ['e4', 'e5', 'Bc4', 'Nc6', 'Qh5', 'Nf6??', 'Qxf7#'])
  assert.deepEqual(g.bad, [])
  assert.deepEqual(g.plies.map((p) => p.san), ['e4', 'e5', 'Bc4', 'Nc6', 'Qh5', 'Nf6', 'Qxf7#'])
  assert.equal(g.plies[5].mark, '??')
  assert.equal(g.plies[6].mate, true)
  assert.equal(g.plies[6].move?.captured, 'p')
})

test('chess: castling, en passant, promotion, disambiguation, Turkish letters and UCI', () => {
  const g = playGame(undefined, ['e2e4', 'd5', 'e5', 'f5', 'exf6', 'Af6', 'Af3', 'e6', 'Fe2', 'Fc5', 'O-O', 'Ae4'])
  assert.deepEqual(g.bad, [])
  assert.equal(g.plies[4].san, 'exf6')
  assert.equal(g.plies[4].move?.capturedAt, 37) // the pawn on f5, not f6
  assert.equal(g.plies[10].san, 'O-O')
  assert.equal(g.plies[10].move?.rookFrom, 7)
  assert.equal(g.plies[10].move?.rookTo, 5)
  const promo = parseFen('8/P6k/8/8/8/8/8/K7 w - - 0 1')!
  const m = readMove(promo, 'a8=Q+')!
  assert.equal(m.promo, 'Q')
  assert.equal(toSan(promo, m), 'a8=Q')
  // Two knights can reach d2: the file tells them apart.
  const two = parseFen('4k3/8/8/8/8/8/8/1N2KN2 w - - 0 1')!
  assert.equal(readMove(two, 'Nd2'), null)
  assert.equal(toSan(two, readMove(two, 'Nbd2')!), 'Nbd2')
  // An illegal move is kept but plays nothing.
  const bad = playGame(undefined, ['e4', 'e4'])
  assert.deepEqual(bad.bad, [1])
})

test('chess: a pasted game keeps only its moves', () => {
  assert.deepEqual(readMoveList('1. e4 e5 {open} 2. Nf3 (2. f4 exf4) Nc6 3... Bb5 $1 a6!? 1-0'), ['e4', 'e5', 'Nf3', 'Nc6', 'Bb5', 'a6!?'])
})
