// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
import { useEffect, useState, type MutableRefObject } from 'react'
import { useStore } from '../state/store'
import { endReview, goToNote, newNote, removeNote, startReview } from '../notes/review'
import { laneNotes, noteSpan, reviewRanges, updateNote } from '../notes/model'
import { groupNotes, markStatus, markTarget } from '../notes/nav'
import { useNoteFilter } from '../notes/filter-pref'
import { kindLabel, statusLabel } from './NotesPanel'
import type { Project, WorkNote } from '../types'
import { TIMELINE_HEADER_W } from '../types'
import { FloatingMenu } from './FloatingMenu'
import { Icon, IconButton, Tooltip, useT } from '../ui'
import { localNum } from '../ui/format'
import { isEmptyLaneTarget, LANE_SLOP_PX, lanePress, markSnapOff } from './note-lane-gesture'
import { gestureMemo, startDrag as timelineDrag, type DragPoint } from './timeline/drag'
import { beginScrub } from './timeline/shared'

const HEADER_W = TIMELINE_HEADER_W
/** A note of one frame is drawn this wide, so it can be seen and grabbed. */
const PIN_W = 12

/** The times a note's edge snaps to: the playhead, the markers, every clip's
 *  edges, the other notes. */
function snapTimes(p: Project, now: number, skip: string | null): number[] {
  const out = [0, now]
  for (const m of p.markers ?? []) out.push(m.time)
  for (const id in p.clips) {
    const c = p.clips[id]
    out.push(c.start, c.start + c.duration)
  }
  for (const n of p.notes ?? []) if (n.id !== skip) out.push(n.start, n.end)
  return out
}

/** `t` moved onto the nearest snap time within `thr` seconds (Shift: as it is). */
function snapped(t: number, times: readonly number[], thr: number, off: boolean): { t: number; guide: number | null } {
  if (off) return { t, guide: null }
  let best = thr
  let at: number | null = null
  for (const c of times) {
    const d = Math.abs(t - c)
    if (d <= best) {
      best = d
      at = c
    }
  }
  return at === null ? { t, guide: null } : { t: at, guide: at }
}

/**
 * The "N" lane, under the ruler: the project's work notes as blocks. A drag
 * on an empty stretch moves the playhead, as on the ruler (phase 3c.Y, K3: a
 * note is never opened by accident); Shift + drag marks a range and writes a
 * note for it, a double click a note at that moment, right click "Note here",
 * the label's "+" and N a note at the playhead. Drag a block to move it, its
 * edges to change its length; click it to pick it and go there. The note
 * being written is the dashed block.
 */
export function NoteLane({
  seek,
  scrubbingRef
}: {
  /** The ruler's own seek (its playhead snapping; `exact`: Shift held). */
  seek?: (t: number, exact: boolean) => void
  /** The timeline's "the playhead is being dragged" flag. */
  scrubbingRef?: MutableRefObject<boolean>
} = {}): JSX.Element {
  const t = useT()
  const notes = useStore((s) => s.project.notes)
  const draft = useStore((s) => s.noteDraft)
  const sel = useStore((s) => s.noteSel)
  const pxPerSec = useStore((s) => s.pxPerSec)
  const reviewing = useStore((s) => (s.noteReview ? s.noteReview.ids[s.noteReview.index] : null))
  // Done notes only while the Notes tab's filter shows them, faded
  // (DENEME-2-PLAN-N.md, K3).
  const filter = useNoteFilter((s) => s.filter)
  const [menu, setMenu] = useState<{ id: string | null; time: number; x: number; y: number } | null>(null)
  // Shift held: the lane's cursor says "a press marks a range".
  const [shiftHeld, setShiftHeld] = useState(false)
  useEffect(() => {
    const on = (e: KeyboardEvent): void => setShiftHeld(e.shiftKey)
    const off = (): void => setShiftHeld(false)
    window.addEventListener('keydown', on)
    window.addEventListener('keyup', on)
    window.addEventListener('blur', off)
    return () => {
      window.removeEventListener('keydown', on)
      window.removeEventListener('keyup', on)
      window.removeEventListener('blur', off)
    }
  }, [])

  useEffect(() => {
    if (!menu) return
    const close = (): void => setMenu(null)
    window.addEventListener('pointerdown', close)
    window.addEventListener('blur', close)
    return () => {
      window.removeEventListener('pointerdown', close)
      window.removeEventListener('blur', close)
    }
  }, [menu])

  const laneTime = (lane: HTMLElement, clientX: number): number => Math.max(0, (clientX - lane.getBoundingClientRect().left - HEADER_W) / useStore.getState().pxPerSec)
  const seekTo = (time: number, exact: boolean): void => {
    if (seek) seek(time, exact)
    else useStore.getState().setTime(time)
  }

  /** A press on the empty lane (K3): a plain drag moves the playhead (a
   *  click puts it there), as on the ruler; Shift + drag marks a range for a
   *  new note (its edges snap; Alt: as it is). */
  const startPress = (e: React.PointerEvent<HTMLDivElement>): void => {
    const what = lanePress(e)
    if (what === 'ignore') return
    // The lane's own gesture: the timeline behind it must not start a
    // marquee (and take the pointer) on the same press.
    e.stopPropagation()
    const lane = e.currentTarget
    lane.setPointerCapture(e.pointerId)
    if (what === 'scrub') {
      if (scrubbingRef) scrubbingRef.current = true
      beginScrub()
      useStore.getState().setPlaying(false)
      seekTo(laneTime(lane, e.clientX), e.shiftKey)
      const onMove = (ev: PointerEvent): void => seekTo(laneTime(lane, ev.clientX), ev.shiftKey)
      const onUp = (): void => {
        lane.removeEventListener('pointermove', onMove)
        lane.removeEventListener('pointerup', onUp)
        lane.removeEventListener('pointercancel', onUp)
        if (scrubbingRef) scrubbingRef.current = false
        useStore.getState().setSnapGuide(null)
      }
      lane.addEventListener('pointermove', onMove)
      lane.addEventListener('pointerup', onUp)
      lane.addEventListener('pointercancel', onUp)
      return
    }
    const t0 = laneTime(lane, e.clientX)
    // The draft as it was: Escape puts it back (phase 3c.4b, timeline/drag.ts).
    const before = useStore.getState().noteDraft
    timelineDrag(e, {
      slop: LANE_SLOP_PX,
      horizontal: true,
      onStart: () => {
        // Marking a range ends a review under way, and stops the film.
        const st = useStore.getState()
        if (st.noteReview) endReview()
        st.setPlaying(false)
      },
      onMove: (ev) => {
        const st = useStore.getState()
        const times = snapTimes(st.project, st.currentTime, null)
        const thr = 8 / st.pxPerSec
        const a = snapped(t0, times, thr, markSnapOff(ev))
        const b = snapped(laneTime(lane, ev.clientX), times, thr, markSnapOff(ev))
        st.startNoteDraft({ start: a.t, end: b.t })
        st.setSnapGuide(b.guide)
      },
      onEnd: (_p, moved) => {
        const st = useStore.getState()
        st.setSnapGuide(null)
        if (!moved) {
          st.setPlaying(false)
          st.setTime(t0)
        }
      },
      onCancel: (moved) => {
        const st = useStore.getState()
        st.setSnapGuide(null)
        if (!moved) return
        if (before) st.patchNoteDraft({ start: before.start, end: before.end })
        else st.cancelNoteDraft()
      }
    })
  }

  /** A double click on the empty lane: a note at that moment (the first
   *  click has already put the playhead there). */
  const onDoubleClick = (e: React.MouseEvent<HTMLDivElement>): void => {
    if (e.button !== 0 || !isEmptyLaneTarget(e.target as HTMLElement)) return
    const time = laneTime(e.currentTarget, e.clientX)
    newNote({ start: time, end: time })
  }

  /** Right click on the empty lane: "Note here". */
  const onContextMenu = (e: React.MouseEvent<HTMLDivElement>): void => {
    if (!isEmptyLaneTarget(e.target as HTMLElement)) return
    e.preventDefault()
    e.stopPropagation()
    setMenu({ id: null, time: laneTime(e.currentTarget, e.clientX), x: e.clientX, y: e.clientY })
  }

  /** Drag a block (a note, or the draft when `n` is null): its body moves
   *  it, an edge changes that end. */
  const startDrag = (e: React.PointerEvent, n: WorkNote | null, mode: 'move' | 'start' | 'end'): void => {
    e.stopPropagation()
    if (e.button !== 0) return
    const base = n ?? useStore.getState().noteDraft
    if (!base) return
    const { start, end } = base
    // timeline/drag.ts (phase 3c.4b): it begins after 4 px, a step per frame,
    // and Escape takes it back with no trace (a note's one undo step, or the
    // draft's range).
    const memo = n ? gestureMemo() : null
    const onMove = (ev: DragPoint): void => {
      const st = useStore.getState()
      const dt = ev.dx / st.pxPerSec
      const times = snapTimes(st.project, st.currentTime, n?.id ?? null)
      const thr = 8 / st.pxPerSec
      let a = start
      let b = end
      let guide: number | null = null
      if (mode === 'move') {
        const len = end - start
        const head = snapped(Math.max(0, start + dt), times, thr, ev.shiftKey)
        const tail = snapped(Math.max(0, start + dt) + len, times, thr, ev.shiftKey)
        // The nearer of its two edges decides.
        const useTail = len > 0 && tail.guide !== null && (head.guide === null || Math.abs(tail.t - (start + dt + len)) < Math.abs(head.t - (start + dt)))
        a = Math.max(0, useTail ? tail.t - len : head.t)
        b = a + len
        guide = useTail ? tail.guide : head.guide
      } else if (mode === 'start') {
        const s1 = snapped(Math.max(0, start + dt), times, thr, ev.shiftKey)
        a = Math.min(s1.t, end)
        guide = s1.guide
      } else {
        const s1 = snapped(Math.max(0, end + dt), times, thr, ev.shiftKey)
        b = Math.max(s1.t, start)
        guide = s1.guide
      }
      if (n) st.editNotes((p) => void updateNote(p, n.id, { start: a, end: b }), false)
      else st.patchNoteDraft({ start: a, end: b })
      st.setSnapGuide(guide)
    }
    timelineDrag(e, {
      horizontal: true,
      onStart: () => {
        if (n) useStore.getState().beginGesture()
      },
      onMove,
      onEnd: (_p, moved) => {
        useStore.getState().setSnapGuide(null)
        if (!moved && n) goToNote(n.id)
      },
      onCancel: (moved) => {
        useStore.getState().setSnapGuide(null)
        if (!moved) return
        if (memo) memo.restore()
        else useStore.getState().patchNoteDraft({ start, end })
      }
    })
  }

  const geometry = (start: number, end: number): { left: number; width: number; pin: boolean } => {
    const w = (end - start) * pxPerSec
    const pin = w < PIN_W
    return { left: HEADER_W + start * pxPerSec - (pin ? PIN_W / 2 : 0), width: pin ? PIN_W : w, pin }
  }
  const menuNote = menu?.id ? notes?.find((n) => n.id === menu.id) : undefined

  return (
    <div className={`tl-note-lane${shiftHeld ? ' is-marking' : ''}`} data-testid="notes.lane" onPointerDown={startPress} onDoubleClick={onDoubleClick} onContextMenu={onContextMenu}>
      <div className="tl-track-label note-label" onPointerDown={(e) => e.stopPropagation()}>
        <Tooltip content={t('notes.lane.hint')}>
          <span className="tname" tabIndex={0} data-testid="notes.lane.label">
            <Icon name="sticky-note" size={14} />
            <em>{t('notes.lane.name')}</em>
          </span>
        </Tooltip>
        <IconButton icon="plus" size="sm" variant="ghost" label={t('notes.lane.add')} shortcut="n" className="note-lane-add" onClick={() => newNote()} testid="notes.lane.add" />
      </div>
      {/* What the agent changed (the notes with an answer): hatched, behind the blocks. */}
      {(notes ?? [])
        .filter((n) => n.status === 'ready')
        .flatMap((n) =>
          reviewRanges(n).map(([a, b], i) => (
            <div
              key={`${n.id}:${i}`}
              className={`tl-note-touched${reviewing === n.id ? ' on' : ''}`}
              data-testid={`notes.lane.touched.${n.id}.${i}`}
              style={{ left: HEADER_W + a * pxPerSec - 3, width: Math.max(6, (b - a) * pxPerSec + 6) }}
              title={t('notes.lane.touched', { n: n.num })}
              onPointerDown={(e) => {
                e.stopPropagation()
                if (e.button === 0) startReview(n.id)
              }}
            />
          ))
        )}
      {groupNotes(laneNotes(notes ?? [], filter, reviewing), pxPerSec, PIN_W, PIN_W + 2).map((mark) => {
        // One-frame notes too close to tell apart at this zoom: one mark with
        // their count; a click goes to the first, the next click to the next
        // (ONIZLEME-UYGULA-PLAN.md, K6). Zoom in to drag one.
        if (mark.notes.length > 1) {
          const g = geometry(mark.at, mark.at)
          const has = mark.notes.some((x) => x.id === sel)
          const status = markStatus(mark.notes)
          return (
            <div
              key={`g:${mark.notes[0].id}`}
              className={`tl-note-block pin group st-${status}${has ? ' selected' : ''}`}
              data-status={status}
              style={{ left: g.left, width: g.width }}
              title={t('notes.lane.group', { n: mark.notes.length, nums: mark.notes.map((x) => `#${x.num}`).join(', ') })}
              data-count={mark.notes.length}
              data-testid={`notes.lane.group.${mark.notes[0].id}`}
              onPointerDown={(e) => {
                e.stopPropagation()
                if (e.button === 0) goToNote(markTarget(mark, useStore.getState().noteSel).id)
              }}
            >
              <span className="num">{mark.notes.length}</span>
            </div>
          )
        }
        const n = mark.notes[0]
        const g = geometry(n.start, n.end)
        return (
          <div
            key={n.id}
            className={`tl-note-block st-${n.status}${g.pin ? ' pin' : ''}${sel === n.id ? ' selected' : ''}${n.shapes?.length ? ' drawn' : ''}`}
            data-status={n.status}
            style={{ left: g.left, width: g.width }}
            title={`#${n.num} · ${localNum(noteSpan(n))} · ${kindLabel(n.kind)} · ${statusLabel(n.status)}${n.text ? `\n${n.text}` : ''}${n.reply ? `\n${t('review.reply', { reply: n.reply })}` : ''}`}
            data-note={n.num}
            data-testid={`notes.lane.note.${n.id}`}
            onPointerDown={(e) => startDrag(e, n, 'move')}
            onContextMenu={(e) => {
              e.preventDefault()
              e.stopPropagation()
              useStore.getState().selectNote(n.id)
              setMenu({ id: n.id, time: n.start, x: e.clientX, y: e.clientY })
            }}
          >
            {!g.pin && <span className="grip l" onPointerDown={(e) => startDrag(e, n, 'start')} />}
            <span className="num">{n.num}</span>
            {g.width > 70 && <span className="lbl">{n.text || kindLabel(n.kind)}</span>}
            {!g.pin && <span className="grip r" onPointerDown={(e) => startDrag(e, n, 'end')} />}
          </div>
        )
      })}
      {draft &&
        (() => {
          const g = geometry(draft.start, draft.end)
          return (
            <div data-testid="notes.lane.draft" className={`tl-note-block draft${g.pin ? ' pin' : ''}`} style={{ left: g.left, width: g.width }} title={t('notes.lane.draft')} onPointerDown={(e) => startDrag(e, null, 'move')}>
              {!g.pin && <span className="grip l" onPointerDown={(e) => startDrag(e, null, 'start')} />}
              <span className="num">+</span>
              {!g.pin && <span className="grip r" onPointerDown={(e) => startDrag(e, null, 'end')} />}
            </div>
          )
        })()}
      {menu && (menuNote || !menu.id) && (
        <FloatingMenu
          x={menu.x}
          y={menu.y}
          onPointerDown={(e) => e.stopPropagation()}
          label={t('notes.lane.menu')}
          testid="notes.lane.menu"
          onClose={() => setMenu(null)}
          items={
            menuNote
              ? [
                  { id: 'show', label: t('notes.lane.show', { n: menuNote.num }), icon: 'pencil', onSelect: () => goToNote(menuNote.id), testid: 'notes.lane.menu.show' },
                  { id: 'delete', label: t('notes.lane.delete'), icon: 'trash', danger: true, onSelect: () => removeNote(menuNote.id), testid: 'notes.lane.menu.delete' }
                ]
              : [{ id: 'here', label: t('notes.lane.here'), icon: 'plus', shortcut: 'n', onSelect: () => newNote({ start: menu.time, end: menu.time }), testid: 'notes.lane.here' }]
          }
        />
      )}
    </div>
  )
}
