// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// The range the user gives the agent (KAPSAM-AJAN-PLAN.md §6; the mock-up
// tasarim\maket-ajan, screens 3 and 4): a band in the agent's colour over the
// lanes, its words on the ruler (its length, then how the work stands), the
// rest of the timeline dimmed while the work is limited to it, and the box
// under it: what to do, the ready chips and the user's own, "only here",
// Send. The state is agent/scope-band.ts; what is sent is a work note.
import { memo, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useStore } from '../../state/store'
import { useAgentStore } from '../../agent/store'
import { Button, Checkbox, Chip, IconButton, TextArea, useT } from '../../ui'
import { t as tt } from '../../ui/strings'
import { HEADER_W, snapEdgeTime } from '../timeline/shared'
import { dragBand, type BandGrip } from './scope-drag'
import {
  BAND_CHIPS, CUSTOM_MAX, armBand, bandSpan, bandStatus, closeBand, closeBox, drawBand, dropChip, keepChip, noteOf, pickChip, sendBand, setBandOnly, setBandText, useScopeBand, type ReadyChip
} from '../../agent/scope-band'
import { noteSent } from '../../agent/send-line'
import { CopyText } from './SendLine'
import './scope.css'

/** A ready chip's words in the language of the interface. */
export const chipLabel = (c: ReadyChip): string => tt(`kapsam.chip.${c}`)

function useLen(span: [number, number] | null): string {
  const t = useT()
  const lang = useStore((s) => s.uiLang)
  if (!span) return ''
  const s = (span[1] - span[0]).toFixed(1)
  return t('kapsam.band.len', { s: lang === 'tr' ? s.replace('.', ',') : s })
}

function useBand(): { span: [number, number] | null; status: ReturnType<typeof bandStatus>; only: boolean; open: boolean } {
  const band = useScopeBand((s) => s.band)
  const sent = useScopeBand((s) => s.sent)
  const sawDraft = useScopeBand((s) => s.sawDraft)
  const only = useScopeBand((s) => s.only)
  const open = useScopeBand((s) => s.open)
  const draft = useAgentStore((s) => !!s.draft)
  const note = useStore((s) => (sent ? s.project.notes?.find((n) => n.id === sent) : undefined))
  const project = useStore.getState().project
  // (A draft seen while the work was out: once it is decided, the work is done.)
  useEffect(() => {
    if (sent && draft && !sawDraft) useScopeBand.setState({ sawDraft: true })
  }, [sent, draft, sawDraft])
  void note
  const span = bandSpan(project, { band, sent })
  return { span, status: bandStatus(project, sent, draft, sawDraft), only: only && !!band, open }
}

/** On the ruler: the band's stretch and its words, with a way to remove it. */
export const ScopeRulerMark = memo(function ScopeRulerMark({ pxPerSec }: { pxPerSec: number }): JSX.Element | null {
  const t = useT()
  const { span, status } = useBand()
  const len = useLen(span)
  // A band not sent yet and not made of clips can be changed by hand
  // (cila3, 2b): its edges and its body on the ruler.
  const editable = useScopeBand((s) => !!s.band && !s.sent && !s.band.clips?.length)
  if (!span) return null
  const left = HEADER_W + span[0] * pxPerSec
  const width = Math.max(2, (span[1] - span[0]) * pxPerSec)
  return (
    <div className={`kapsam-ruler is-${status}${editable ? ' is-editable' : ''}`} style={{ left, width }} data-testid="kapsam.band.ruler" onPointerDown={(e) => e.stopPropagation()}>
      {editable && (
        <>
          <span className="kapsam-grip is-move" data-testid="kapsam.band.move" onPointerDown={(e) => beginBandEdit(e, 'move')} />
          <span className="kapsam-grip is-start" data-testid="kapsam.band.start" onPointerDown={(e) => beginBandEdit(e, 'start')} />
          <span className="kapsam-grip is-end" data-testid="kapsam.band.end" onPointerDown={(e) => beginBandEdit(e, 'end')} />
        </>
      )}
      <span className="kapsam-cap" data-testid="kapsam.band.cap" data-status={status}>
        <span className="kapsam-cap-text">{t(`kapsam.band.${status}`, { len })}</span>
        <IconButton icon="x" size="sm" variant="ghost" className="kapsam-cap-x" label={t('kapsam.band.close')} testid="kapsam.band.close" onClick={closeBand} />
      </span>
    </div>
  )
})

/** Over the lanes: the band, and the rest dimmed while the work is limited. */
export const ScopeBand = memo(function ScopeBand({ pxPerSec }: { pxPerSec: number }): JSX.Element | null {
  const { span, status, only, open } = useBand()
  if (!span) return null
  const left = HEADER_W + span[0] * pxPerSec
  const width = Math.max(2, (span[1] - span[0]) * pxPerSec)
  const shade = only && (open || status === 'new' || status === 'working' || status === 'draft')
  return (
    <>
      {shade && <div className="kapsam-shade" style={{ left: HEADER_W, width: Math.max(0, left - HEADER_W) }} />}
      {shade && <div className="kapsam-shade" style={{ left: left + width, right: 0 }} />}
      <div className={`kapsam-band is-${status}`} style={{ left, width }} data-testid="kapsam.band" data-status={status} data-start={span[0].toFixed(3)} data-end={span[1].toFixed(3)} />
    </>
  )
})

/** The ruler's press, with Alt held or "Range" armed: a band is drawn. */
export function beginBandDrag(e: React.PointerEvent, timeOf: (clientX: number) => number): void {
  e.preventDefault()
  e.stopPropagation()
  const el = e.currentTarget as HTMLElement
  el.setPointerCapture(e.pointerId)
  const t0 = timeOf(e.clientX)
  let t1 = t0
  useScopeBand.setState({ band: { start: t0, end: t0 }, open: false, sent: null, sawDraft: false, text: '', chip: null, only: true })
  const move = (ev: PointerEvent): void => {
    t1 = timeOf(ev.clientX)
    useScopeBand.setState({ band: { start: Math.min(t0, t1), end: Math.max(t0, t1) } })
  }
  const up = (): void => {
    el.removeEventListener('pointermove', move)
    el.removeEventListener('pointerup', up)
    el.removeEventListener('pointercancel', up)
    // (A press with no travel is no range.)
    if (Math.abs(t1 - t0) * useStore.getState().pxPerSec < 4) closeBand()
    else drawBand(t0, t1)
  }
  el.addEventListener('pointermove', move)
  el.addEventListener('pointerup', up)
  el.addEventListener('pointercancel', up)
}

/** A press on the band's edge or body on the ruler (cila3, 2b): the edge
 *  follows the pointer, snapping as a clip's edge does (Shift: as it is);
 *  the body moves the whole band. A press on the body that does not travel
 *  is a click on the ruler: the playhead goes there. */
function beginBandEdit(e: React.PointerEvent<HTMLElement>, grip: BandGrip): void {
  if (e.button !== 0) return
  const b = useScopeBand.getState().band
  if (!b) return
  e.preventDefault()
  e.stopPropagation()
  const el = e.currentTarget
  el.setPointerCapture(e.pointerId)
  const x0 = e.clientX
  const pps = useStore.getState().pxPerSec
  const at = b.start + (x0 - (el.parentElement ?? el).getBoundingClientRect().left) / pps
  let travelled = false
  const move = (ev: PointerEvent): void => {
    if (!travelled && Math.abs(ev.clientX - x0) < 3) return
    travelled = true
    const st = useStore.getState()
    const r = dragBand({
      grip,
      start: b.start,
      end: b.end,
      dt: (ev.clientX - x0) / pps,
      min: 4 / pps,
      snap: (t) => (ev.shiftKey ? t : snapEdgeTime(st, t, '', 8 / pps))
    })
    st.setSnapGuide(r.guide)
    useScopeBand.setState({ band: { start: r.start, end: r.end } })
  }
  const up = (): void => {
    el.removeEventListener('pointermove', move)
    el.removeEventListener('pointerup', up)
    el.removeEventListener('pointercancel', up)
    const st = useStore.getState()
    st.setSnapGuide(null)
    if (!travelled && grip === 'move') {
      st.setPlaying(false)
      st.setTime(Math.max(0, at))
    }
  }
  el.addEventListener('pointermove', move)
  el.addEventListener('pointerup', up)
  el.addEventListener('pointercancel', up)
}

/** The toolbar's "Range": what is chosen already (the loop, two cut marks,
 *  the selected clips), else the next drag on the ruler. */
export function pressRange(): void {
  const s = useStore.getState()
  const b = useScopeBand.getState()
  if (b.armed) return armBand(false)
  if (s.loopRange && s.loopRange[1] > s.loopRange[0]) return drawBand(s.loopRange[0], s.loopRange[1])
  if (s.cutMarks.length >= 2) return drawBand(Math.min(...s.cutMarks), Math.max(...s.cutMarks))
  const clips = s.selectedClipIds.map((id) => s.project.clips[id]).filter(Boolean)
  if (clips.length) return drawBand(Math.min(...clips.map((c) => c.start)), Math.max(...clips.map((c) => c.start + c.duration)))
  armBand(true)
}

/** "Sent" said once: taken at once, or waiting for the agent. */
export function toldSent(r: { id: string; taken: boolean; inbox: number } | null): void {
  if (!r) return
  // (GONDER2-PLAN.md: the box closes on a send, so a toast says it, with Copy.)
  noteSent('band', { id: r.inbox, taken: r.taken }, { kind: 'notes', notes: [r.id] }, true)
}

const BOX_W = 320

/** The box under the band (a card over the timeline, kept on screen). */
export function ScopeBox(): JSX.Element | null {
  const t = useT()
  const open = useScopeBand((s) => s.open)
  const band = useScopeBand((s) => s.band)
  const text = useScopeBand((s) => s.text)
  const chip = useScopeBand((s) => s.chip)
  const only = useScopeBand((s) => s.only)
  const custom = useScopeBand((s) => s.custom)
  const ref = useRef<HTMLDivElement>(null)
  const input = useRef<HTMLTextAreaElement>(null)
  const [at, setAt] = useState<{ x: number; y: number } | null>(null)
  useLayoutEffect(() => {
    if (!open) return
    const place = (): void => {
      const mark = document.querySelector('[data-testid="kapsam.band"]')
      const box = ref.current
      if (!mark || !box) return
      const r = mark.getBoundingClientRect()
      const h = box.offsetHeight
      const x = Math.min(Math.max(8, r.left), window.innerWidth - BOX_W - 8)
      const below = r.top + 40
      const y = below + h + 8 <= window.innerHeight ? below : Math.max(8, window.innerHeight - h - 8)
      setAt((cur) => (cur && cur.x === x && cur.y === y ? cur : { x, y }))
    }
    place()
    const scroller = document.querySelector('.tl-scroll')
    scroller?.addEventListener('scroll', place)
    window.addEventListener('resize', place)
    return () => {
      scroller?.removeEventListener('scroll', place)
      window.removeEventListener('resize', place)
    }
  })
  useEffect(() => {
    if (open) input.current?.focus()
  }, [open])
  if (!open || !band) return null
  const clips = !!band.clips?.length
  const ready = noteOf({ text, chip }, chipLabel)
  const send = (): void => {
    if (ready) toldSent(sendBand(chipLabel))
  }
  const isOn = (c: { ready: ReadyChip } | { own: string }): boolean => !!chip && JSON.stringify(chip) === JSON.stringify(c)
  return createPortal(
    <div
      ref={ref}
      className="kapsam-box"
      role="dialog"
      aria-label={t('kapsam.box')}
      data-testid="kapsam.box"
      style={{ left: at?.x ?? -9999, top: at?.y ?? -9999 }}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.stopPropagation()
          closeBox()
        }
      }}
      onPointerDown={(e) => e.stopPropagation()}
    >
      {/* Several lines (cila3, 2a): Enter sends, Shift+Enter is a new line;
          the field grows with its words up to a few lines, then scrolls. */}
      <TextArea
        ref={input}
        rows={1}
        value={text}
        onChange={setBandText}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey && !e.nativeEvent.isComposing) {
            e.preventDefault()
            send()
          }
        }}
        placeholder={t(clips ? 'kapsam.box.askClips' : 'kapsam.box.ask')}
        label={t(clips ? 'kapsam.box.askClips' : 'kapsam.box.ask')}
        testid="kapsam.box.text"
        className="kapsam-box-text"
      />
      <div className="kapsam-chips">
        {BAND_CHIPS.map((c) => (
          <Chip key={c} tone="neutral" pressed={isOn({ ready: c })} onClick={() => pickChip({ ready: c })} testid={`kapsam.box.chip.${c}`}>
            {chipLabel(c)}
          </Chip>
        ))}
        {custom.map((w, i) => (
          <Chip key={w} tone="neutral" pressed={isOn({ own: w })} onClick={() => pickChip({ own: w })} onRemove={() => dropChip(w)} removeLabel={t('kapsam.box.drop', { name: w })} testid={`kapsam.box.own.${i}`}>
            {w}
          </Chip>
        ))}
        {custom.length < CUSTOM_MAX && (
          <IconButton icon="plus" size="sm" variant="ghost" className="kapsam-keep" label={text.trim() ? t('kapsam.box.keep') : t('kapsam.box.keep.empty')} disabled={!text.trim()} testid="kapsam.box.keep" onClick={() => keepChip(text)} />
        )}
        {/* (GONDER2-PLAN.md: the note's words for the agent's chat; not sent. In
            this row: the row below has no room for one more button.) */}
        <CopyText what={() => (ready ? { kind: 'task', text: ready.text } : null)} testid="kapsam.box.copyText" />
      </div>
      <div className="kapsam-row">
        <span className="kapsam-only" title={t('kapsam.box.only.hint')}>
          <Checkbox checked={only} onChange={setBandOnly} label={t(clips ? 'kapsam.box.onlyClips' : 'kapsam.box.only')} testid="kapsam.box.only" />
        </span>
        <Button variant="primary" size="sm" icon="send" disabled={!ready} testid="kapsam.box.send" onClick={send}>
          {t('kapsam.box.send')}
        </Button>
      </div>
    </div>,
    document.body
  )
}
