// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// The chess board template's own fields: a little board to play the game on
// (click a piece, click where it goes — only legal moves), the moves as a
// list to step through, a comment for each move, a pasted game (PGN) and a
// start position (FEN).

import { useEffect, useMemo, useRef, useState } from 'react'
import { useStore } from '../state/store'
import { findTemplate } from '../templates/model'
import { chessGame } from '../templates/chess-plan'
import { legalMoves, parseFen, readMoveList, toSan, type Move } from '../templates/chess-rules'
import { drawPiece } from '../templates/chess'
import { uid, type Project, type TemplateBlock } from '../types'
import { Button, IconButton, TextArea, TextField, Tooltip, useT } from '../ui'
import { BareButton } from '../ui/Button'

function edit(fn: (p: Project) => void, mergeKey?: string): void {
  useStore.getState().editTemplates(fn, true, mergeKey)
}

const SIZE = 264
// Notation shown as an example in the empty fields (the same in every language).
const PGN_EXAMPLE = '1. e4 e5 2. Nf3 Nc6 3. Bb5 a6 …'
const FEN_EXAMPLE = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1'

export function ChessFields({ b }: { b: TemplateBlock }): JSX.Element {
  const t = useT()
  const game = chessGame(b)
  const n = b.items.length
  // How many moves are played on the little board (all of them by default).
  const [upto, setUpto] = useState(n)
  const [pick, setPick] = useState<number | null>(null)
  const [pgn, setPgn] = useState('')
  const lastN = useRef(n)
  useEffect(() => {
    // New moves came in (played, pasted or undone): show the latest.
    if (n !== lastN.current) setUpto(n)
    lastN.current = n
  }, [n])
  const at = Math.min(upto, n)
  const pos = at === 0 ? game.start : game.plies[at - 1].after
  const legal = useMemo(() => legalMoves(pos), [pos])
  const targets = pick === null ? [] : legal.filter((m) => m.from === pick)
  const flip = !!b.flip
  const lastMove = at > 0 ? game.plies[at - 1].move : null

  const cv = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const el = cv.current
    if (!el) return
    const dpr = window.devicePixelRatio || 1
    el.width = SIZE * dpr
    el.height = SIZE * dpr
    const g = el.getContext('2d')!
    g.setTransform(dpr, 0, 0, dpr, 0, 0)
    const sq = SIZE / 8
    const xy = (s: number): [number, number] => [((flip ? 7 - (s & 7) : s & 7) + 0.5) * sq, ((flip ? s >> 3 : 7 - (s >> 3)) + 0.5) * sq]
    for (let s = 0; s < 64; s++) {
      const [x, y] = xy(s)
      g.fillStyle = ((s >> 3) + (s & 7)) % 2 === 0 ? '#a69b84' : '#efe6d4'
      g.fillRect(x - sq / 2, y - sq / 2, sq, sq)
      if (lastMove && (s === lastMove.from || s === lastMove.to)) {
        g.fillStyle = 'rgba(242,193,78,0.55)'
        g.fillRect(x - sq / 2, y - sq / 2, sq, sq)
      }
      if (s === pick) {
        g.fillStyle = 'rgba(79,140,255,0.45)'
        g.fillRect(x - sq / 2, y - sq / 2, sq, sq)
      }
    }
    for (let s = 0; s < 64; s++) {
      const [x, y] = xy(s)
      drawPiece(g, pos.board[s], x, y, sq, dpr)
    }
    // Where the picked piece can go: a dot, or a ring round a piece to take.
    for (const m of targets) {
      const [x, y] = xy(m.to)
      g.fillStyle = 'rgba(20,20,20,0.3)'
      g.strokeStyle = 'rgba(20,20,20,0.3)'
      g.lineWidth = 3
      g.beginPath()
      if (pos.board[m.to]) {
        g.arc(x, y, sq * 0.44, 0, Math.PI * 2)
        g.stroke()
      } else {
        g.arc(x, y, sq * 0.15, 0, Math.PI * 2)
        g.fill()
      }
    }
  }, [pos, pick, targets, flip, lastMove])

  const play = (m: Move): void => {
    const san = toSan(pos, m)
    edit((p) => {
      const tp = findTemplate(p, b.id)
      if (!tp) return
      // Played from an earlier move: the game goes on from there.
      tp.items = [...tp.items.slice(0, at), { id: uid(), title: san }]
    })
    setPick(null)
    setUpto(at + 1)
  }
  const onClick = (e: React.MouseEvent<HTMLCanvasElement>): void => {
    const r = e.currentTarget.getBoundingClientRect()
    const f = Math.floor(((e.clientX - r.left) / r.width) * 8)
    const rk = Math.floor(((e.clientY - r.top) / r.height) * 8)
    const s = (flip ? rk : 7 - rk) * 8 + (flip ? 7 - f : f)
    const to = targets.filter((m) => m.to === s)
    if (to.length) {
      // A pawn reaching the end becomes a queen (write e8=N for a knight).
      play(to.find((m) => !m.promo || m.promo.toLowerCase() === 'q') ?? to[0])
      return
    }
    setPick(legal.some((m) => m.from === s) ? s : null)
  }
  const sel = at > 0 ? b.items[at - 1] : undefined
  const fenOk = !b.fen || !!parseFen(b.fen)
  const per = n ? (b.duration - 2.2) / n : 0
  const status = [
    at === 0 ? t('tpl.chess.start') : t('tpl.chess.after', { move: game.plies[at - 1].san }),
    (pos.turn === 'w' ? t('tpl.chess.white') : t('tpl.chess.black')) + (legal.length === 0 ? ` — ${game.plies[at - 1]?.check ? t('tpl.chess.mate') : t('tpl.chess.stalemate')}` : '')
  ].join(' · ')
  return (
    <div className="chess-fields">
      <div className="insp-stack">
        <span className="insp-stack-label">{t('tpl.chess.play')}</span>
        <canvas ref={cv} className="chess-board" style={{ width: SIZE, height: SIZE }} onClick={onClick} />
        <div className="insp-row is-tight">
          <IconButton icon="skip-back" size="sm" label={t('tpl.chess.toStart')} disabled={at === 0} onClick={() => { setUpto(0); setPick(null) }} />
          <IconButton icon="chevron-left" size="sm" label={t('tpl.chess.back')} disabled={at === 0} onClick={() => { setUpto(at - 1); setPick(null) }} />
          <IconButton icon="chevron-right" size="sm" label={t('tpl.chess.on')} disabled={at >= n} onClick={() => { setUpto(at + 1); setPick(null) }} />
          <IconButton icon="skip-forward" size="sm" label={t('tpl.chess.toEnd')} disabled={at >= n} onClick={() => { setUpto(n); setPick(null) }} />
          <IconButton
            icon="undo-2"
            size="sm"
            label={t('tpl.chess.takeBack')}
            disabled={n === 0}
            onClick={() => edit((p) => { const tp = findTemplate(p, b.id); if (tp && tp.items.length > 1) tp.items = tp.items.slice(0, -1) })}
          />
          <IconButton icon="triangles-centerline-dashed-horizontal" size="sm" pressed={flip} label={t('tpl.chess.flip')} onClick={() => edit((p) => { const tp = findTemplate(p, b.id); if (tp) { if (tp.flip) delete tp.flip; else tp.flip = true } })} />
        </div>
        <div className="chess-status">{status}</div>
      </div>
      <div className="chess-moves">
        {game.plies.map((pl, i) => (
          <Tooltip key={b.items[i]?.id ?? i} content={pl.move ? (b.items[i]?.note ?? t('tpl.chess.show')) : t('tpl.chess.illegal', { move: pl.written })}>
            <BareButton
              type="button"
              className={`${i === at - 1 ? 'on' : ''}${pl.move ? '' : ' bad'}`}
              onClick={() => { setUpto(i + 1); setPick(null) }}
            >
              {(i + (game.start.turn === 'b' ? 1 : 0)) % 2 === 0 || i === 0 ? <em>{game.start.full + Math.floor((i + (game.start.turn === 'b' ? 1 : 0)) / 2)}.</em> : null}
              {pl.san}
              {pl.mark ?? ''}
            </BareButton>
          </Tooltip>
        ))}
      </div>
      {sel && (
        <>
          <div className="insp-stack">
            <span className="insp-stack-label">{t('tpl.chess.written', { n: at })}</span>
            <Tooltip content={t('tpl.chess.written.hint')}>
              <TextField
                value={sel.title}
                label={t('tpl.chess.written', { n: at })}
                onChange={(v) => edit((p) => { const it = findTemplate(p, b.id)?.items.find((x) => x.id === sel.id); if (it) it.title = v.slice(0, 20) }, `chess-move:${sel.id}`)}
              />
            </Tooltip>
          </div>
          <div className="insp-stack">
            <span className="insp-stack-label">{t('tpl.chess.comment')}</span>
            <TextField
              value={sel.note ?? ''}
              label={t('tpl.chess.comment')}
              placeholder={t('tpl.chess.comment.placeholder')}
              onChange={(v) => edit((p) => { const it = findTemplate(p, b.id)?.items.find((x) => x.id === sel.id); if (it) { if (v) it.note = v.slice(0, 80); else delete it.note } }, `chess-note:${sel.id}`)}
            />
          </div>
        </>
      )}
      <div className="insp-stack">
        <span className="insp-stack-label">{t('tpl.chess.paste')}</span>
        <TextArea rows={3} value={pgn} label={t('tpl.chess.paste')} placeholder={PGN_EXAMPLE} onChange={setPgn} />
        <Button
          size="sm"
          disabled={!pgn.trim()}
          onClick={() => {
            const moves = readMoveList(pgn).slice(0, 120)
            if (!moves.length) return
            edit((p) => { const tp = findTemplate(p, b.id); if (tp) tp.items = moves.map((m) => ({ id: uid(), title: m })) })
            setPgn('')
          }}
        >
          {t('tpl.chess.useMoves')}
        </Button>
      </div>
      <div className="insp-stack">
        <span className="insp-stack-label">{t('tpl.chess.fen')}</span>
        <TextField
          value={b.fen ?? ''}
          label={t('tpl.chess.fen')}
          invalid={!fenOk}
          mono
          placeholder={FEN_EXAMPLE}
          onChange={(v) => edit((p) => { const tp = findTemplate(p, b.id); if (tp) { if (v.trim()) tp.fen = v.slice(0, 99); else delete tp.fen } }, `chess-fen:${b.id}`)}
        />
        {!fenOk && <div className="hint is-danger">{t('tpl.chess.fen.bad')}</div>}
      </div>
      {game.bad.length > 0 && <div className="hint is-danger">{game.bad.length === 1 ? t('tpl.chess.badOne') : t('tpl.chess.badN', { n: game.bad.length })}</div>}
      {n > 0 && (
        <div className="hint">
          {t('tpl.chess.pace', { s: per.toFixed(1) })}{' '}
          <Button size="sm" variant="ghost" onClick={() => edit((p) => { const tp = findTemplate(p, b.id); if (tp) tp.duration = Math.min(120, Math.max(3, 2.2 + tp.items.length * 1.3)) })}>
            {t('tpl.chess.setPace')}
          </Button>
        </div>
      )}
    </div>
  )
}
