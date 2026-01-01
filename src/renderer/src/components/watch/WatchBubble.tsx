// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// The watch mode's note box (IZLE-PLAN.md, K5): while a note is being
// written, a small box over the film — beside its pin, or on the film's
// lower edge at the playhead for a note with no pin. The words, and the kind
// as chips. Enter saves and the film plays on when the note stopped it;
// Shift+Enter is a new line; Esc lets the note go.
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useStore } from '../../state/store'
import { projectDuration, type NoteKind } from '../../types'
import { Chip, TextArea, notify, t as tt, useT, type StringKey } from '../../ui'
import { frameBox } from '../NoteDrawLayer'
import { usePreviewUi } from '../preview/pv-ui'
import { dropWatchNote, saveWatchNote } from './watch-state'
import { bubblePlace, type Box } from './watch-math'

const BW = 280
/** The chips in the order the brief says them: fix, cut, add animation, question. */
const KINDS: NoteKind[] = ['fix', 'cut', 'animate', 'free']

/** The film's frame inside `screen`, in its own pixels. */
function useFrame(screen: React.RefObject<HTMLElement>, on: boolean): { frame: Box; area: { w: number; h: number } } | null {
  const W = useStore((s) => s.project.settings.width)
  const H = useStore((s) => s.project.settings.height)
  const pv = useStore((s) => s.previewView)
  const [tick, setTick] = useState(0)
  useEffect(() => {
    const el = screen.current
    if (!el || !on) return
    const ro = new ResizeObserver(() => setTick((n) => n + 1))
    ro.observe(el)
    return () => ro.disconnect()
  }, [screen, on])
  void tick
  const el = screen.current
  const wrap = el?.querySelector<HTMLElement>('.preview-canvas-wrap')
  if (!on || !el || !wrap) return null
  const a = el.getBoundingClientRect()
  const r = wrap.getBoundingClientRect()
  const f = frameBox(r.width, r.height, W, H, pv)
  return { frame: { left: r.left - a.left + f.left, top: r.top - a.top + f.top, w: f.w, h: f.h }, area: { w: a.width, h: a.height } }
}

export function WatchBubble({ screen }: { screen: React.RefObject<HTMLElement> }): JSX.Element | null {
  const t = useT()
  const draft = useStore((s) => s.noteDraft)
  const length = useStore((s) => projectDuration(s.project))
  const quick = usePreviewUi((s) => s.quickNote)
  const ref = useRef<HTMLTextAreaElement>(null)
  const boxRef = useRef<HTMLDivElement>(null)
  const [bh, setBh] = useState(96)
  const open = !!draft
  const geo = useFrame(screen, open)
  useEffect(() => {
    if (open) ref.current?.focus()
  }, [open])
  useLayoutEffect(() => {
    if (boxRef.current) setBh(boxRef.current.offsetHeight)
  })
  if (!draft || !geo) return null
  const firstPin = draft.shapes.find((s) => s.type === 'pin')
  const pin: [number, number] | null = quick ? [quick.x, quick.y] : firstPin ? [firstPin.pts[0][0], firstPin.pts[0][1]] : null
  const at = length > 0 ? draft.start / length : 0
  const pos = bubblePlace({ frame: geo.frame, area: geo.area, pin, at, bw: Math.min(BW, geo.area.w - 16), bh })
  const setKind = (kind: NoteKind): void => {
    useStore.getState().patchNoteDraft({ kind })
    ref.current?.focus()
  }
  return (
    <div
      ref={boxRef}
      className="watch-bubble"
      data-testid="watch.bubble"
      role="group"
      aria-label={t('izle.bubble')}
      style={{ left: pos.left, top: pos.top, width: Math.min(BW, geo.area.w - 16) }}
      onPointerDown={(e) => e.stopPropagation()}
    >
      <TextArea
        ref={ref}
        rows={2}
        className="watch-bubble-text"
        testid="watch.bubble.text"
        label={t('izle.bubble')}
        placeholder={t('izle.bubble.placeholder')}
        value={draft.text}
        onChange={(text) => useStore.getState().patchNoteDraft({ text })}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey && !e.ctrlKey && !e.metaKey) {
            e.preventDefault()
            e.stopPropagation()
            const d = useStore.getState().noteDraft
            if (d && !d.text.trim() && d.shapes.length === 0) {
              notify({ text: tt('notes.quick.empty') })
              return
            }
            saveWatchNote()
            return
          }
          if (e.key === 'Escape') {
            e.preventDefault()
            e.stopPropagation()
            dropWatchNote()
          }
        }}
      />
      <div className="watch-chips" role="group" aria-label={t('izle.bubble.kinds')}>
        {KINDS.map((k) => (
          <Chip key={k} tone="agent" pressed={draft.kind === k} testid={`watch.kind.${k}`} onClick={() => setKind(k)}>
            {t(`izle.kind.${k}` as StringKey)}
          </Chip>
        ))}
      </div>
    </div>
  )
}
