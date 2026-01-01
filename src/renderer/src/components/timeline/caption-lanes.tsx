// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// The subtitle lane and the text lanes (phase 3c.T: out of Timeline.tsx, with
// their own subscriptions, so a clip's drag or trim no longer builds every
// chip again). A chip's drags run through timeline/drag.ts: a step per frame,
// Escape takes the drag back, the view's own scrolling is followed.
import { memo } from 'react'
import { useStore } from '../../state/store'
import { useAfterProject } from '../agent/shown'
import { useViewport } from '../../playback/viewport'
import { Icon, useT, type IconName, type StringKey } from '../../ui'
import { HEADER_W, clampCaptionMove, snapEdgeTime, idIn } from './shared'
import { gestureMemo, startDrag } from './drag'
import { BareButton } from '../../ui/Button'
import { useTyped } from '../preview/text-edit/session'

/** A drawn shape's icon on its chip. */
const SHAPE_ICON: Record<string, IconName> = { marker: 'highlighter', arrow: 'move-up-right', circle: 'circle', line: 'minus', rect: 'square' }

// Drag a caption chip's start/end handle to change its length.
function startCaptionTrim(e: React.PointerEvent, caption: { id: string; start: number; end: number }, edge: 'start' | 'end'): void {
  e.stopPropagation()
  if (e.button !== 0) return
  const s = useStore.getState()
  const memo = gestureMemo()
  // Snapshot on the first real move, and fold the rest in — see
  // startCanvasSegDrag for why per-update snapshots break undo.
  let begun = false
  const orig = edge === 'start' ? caption.start : caption.end
  // Neighbour walls so trimming never overlaps another caption ON THE SAME
  // LANE (text layers are independent of the subtitle lane).
  const lane = (s.project.captions.find((c) => c.id === caption.id)?.layer ?? 0)
  const others = s.project.captions.filter((c) => c.id !== caption.id && (c.layer ?? 0) === lane)
  const leftWall = others.filter((c) => c.end <= caption.start + 1e-4).reduce((m, c) => Math.max(m, c.end), 0)
  const rightWall = others
    .filter((c) => c.start >= caption.end - 1e-4)
    .reduce((m, c) => Math.min(m, c.start), Infinity)
  startDrag(e, {
    horizontal: true,
    onMove: (p) => {
      const st = useStore.getState()
      let t = orig + p.dx / st.pxPerSec
      if (!begun) {
        begun = true
        st.beginGesture()
      }
      // Snap to media clip edges, other captions, markers, segment bands and
      // the playhead — the same targets a clip edge snaps to.
      if (!p.shiftKey) {
        const snapped = snapEdgeTime(st, t, '', 8 / st.pxPerSec)
        st.setSnapGuide(snapped !== t ? snapped : null)
        t = snapped
      } else {
        st.setSnapGuide(null)
      }
      if (edge === 'start') {
        st.updateCaption(caption.id, { start: Math.max(0, leftWall, Math.min(caption.end - 0.1, t)) }, false)
      } else {
        st.updateCaption(caption.id, { end: Math.min(rightWall, Math.max(caption.start + 0.1, t)) }, false)
      }
    },
    onEnd: () => useStore.getState().setSnapGuide(null),
    onCancel: () => {
      useStore.getState().setSnapGuide(null)
      memo.restore()
    }
  })
}

// Drag a caption chip's body to move it (keeping its length). Below the
// move threshold it's a plain click (select + jump).
function startCaptionMove(e: React.PointerEvent, caption: { id: string; start: number; end: number }): void {
  e.stopPropagation()
  if (e.button !== 0) return
  const dur = caption.end - caption.start
  const memo = gestureMemo()
  startDrag(e, {
    horizontal: true,
    onStart: () => useStore.getState().beginGesture(),
    onMove: (p) => {
      const st = useStore.getState()
      let start = Math.max(0, caption.start + p.dx / st.pxPerSec)
      /** Where the snap landed, for the guide line. Moving a title snapped
       *  silently — no line, no feedback — while dragging its ENDS drew one,
       *  so the same gesture told you different things depending on which
       *  three pixels you had grabbed. */
      let guide: number | null = null
      if (!p.shiftKey) {
        const thr = 8 / st.pxPerSec
        const cands = [0, st.currentTime]
        for (const o of st.project.captions) if (o.id !== caption.id) cands.push(o.start, o.end)
        // Clip edges, on every track. Lining a title up with a cut is the
        // reason to drag one along the timeline at all, and it was the one
        // thing this snapped to nothing of.
        for (const tr of st.project.tracks) {
          for (const id of tr.clipIds) {
            const c = st.project.clips[id]
            if (c) cands.push(c.start, c.start + c.duration)
          }
        }
        for (const m of st.project.markers ?? []) cands.push(m.time)
        // Closest wins, once — the old loop let every candidate in range move
        // the caption again, so two nearby edges could drag it past both.
        let best = thr
        for (const c of cands) {
          const dStart = Math.abs(start - c)
          if (dStart <= best) {
            best = dStart
            start = c
            guide = c
          }
        }
        for (const c of cands) {
          const dEnd = Math.abs(start + dur - c)
          if (dEnd <= best) {
            best = dEnd
            start = c - dur
            guide = c
          }
        }
      }
      st.setSnapGuide(guide)
      // Never let the dragged caption overlap another on its own lane —
      // snap into the gap (other lanes are independent).
      const lane = st.project.captions.find((c) => c.id === caption.id)?.layer ?? 0
      start = clampCaptionMove(
        st.project.captions.filter((c) => (c.layer ?? 0) === lane),
        caption.id,
        dur,
        start
      )
      st.updateCaption(caption.id, { start, end: start + dur }, false)
    },
    onEnd: (_p, moved) => {
      const st = useStore.getState()
      st.setSnapGuide(null)
      if (!moved) {
        st.setPlaying(false)
        st.selectCaptions([caption.id])
        st.setTime(caption.start + 0.01)
      }
    },
    onCancel: (moved) => {
      useStore.getState().setSnapGuide(null)
      if (moved) memo.restore()
    }
  })
}

export const CaptionLanes = memo(function CaptionLanes(): JSX.Element {
  const t = useT()
  // (The draft's lines while the timeline shows "After": D22, worker C.)
  const after = useAfterProject()
  const liveCaptions = useStore((s) => s.project.captions)
  const captions = after ? after.captions : liveCaptions
  const pxPerSec = useStore((s) => s.pxPerSec)
  const selectedCaptionIds = useStore((s) => s.selectedCaptionIds)
  // A title being typed in in the preview: its clip shows those words.
  const typed = useTyped()
  const words = (c: { id: string; text: string }): string => (typed?.id === c.id ? typed.text : c.text)
  const snapCaptionId = useStore((s) => s.dragPreview?.snapTarget?.captionId ?? null)
  // The caption chips drawn: those within two screens of the view. Watched in
  // half-screen steps, so scrolling re-renders the lanes only that often
  // (a transcribed hour is thousands of chips, all rebuilt on every render).
  const viewWidth = useViewport((v) => v.width)
  const viewStep = useViewport((v) => Math.floor(v.left / Math.max(200, v.width / 2)))
  const chipLo = (viewStep - 2) * Math.max(200, viewWidth / 2) - HEADER_W
  const chipHi = (viewStep + 5) * Math.max(200, viewWidth / 2)
  // One timeline lane per caption layer (0 = subtitles, 1+ = text layers).
  const captionLayers = [...new Set(captions.map((c) => c.layer ?? 0))].sort((a, b) => a - b)
  return (
    <>
    {captionLayers.map((layer) => (
      <div className="tl-caption-lane" key={layer} data-caption-layer={layer}>
        <div className="tl-track-label">
          <span className="tname" title={layer === 0 ? t('ct.lane.subtitles.hint') : t('timeline.lane.text.hint', { n: layer })}>
            <Icon name={layer === 0 ? 'captions' : 'type'} size={14} />
            <em>{layer === 0 ? t('timeline.lane.subtitles') : t('timeline.lane.text', { n: layer })}</em>
          </span>
        </div>
        {captions.filter((c) => (c.layer ?? 0) === layer && ((HEADER_W + c.end * pxPerSec >= chipLo && HEADER_W + c.start * pxPerSec <= chipHi) || idIn(selectedCaptionIds, c.id))).map((c) => {
          // How wide this chip actually is on screen. A chip zoomed down
          // to a sliver was still carrying two 6 px trim handles and a
          // delete button — together wider than the chip — so clicking a
          // short title to select it hit one of those instead, and the
          // delete fired on the press with nothing to confirm it.
          const chipW = Math.max(14, (c.end - c.start) * pxPerSec - 2)
          const roomForHandles = chipW >= 34
          const roomForDelete = chipW >= 62
          return (
          <div
            key={c.id}
            data-testid={`timeline.caption.${c.id}`}
            className={`tl-caption-chip${idIn(selectedCaptionIds, c.id) ? ' selected' : ''}${
              snapCaptionId === c.id ? ' snap-source' : ''}${c.manual ? ' manual' : ''
            }`}
            style={{ left: HEADER_W + c.start * pxPerSec, width: chipW }}
            title={`${t('timeline.caption.hint', { what: c.shape ? t(`shapes.kind.${c.shape.kind}` as StringKey) : words(c) })}${c.manual ? t('timeline.caption.manual') : ''}`}
            onPointerDown={(e) => startCaptionMove(e, c)}
            onDoubleClick={(e) => {
              e.stopPropagation()
              // Shapes have no text to type into; they are edited in the
              // Effects tab.
              if (!c.shape) useStore.getState().requestCaptionEdit(c.id)
            }}
          >
            {/* Entrance and exit, as wedges on the chip — the same way a
                clip shows its audio fades. Whether a title fades in was
                information that existed only in a panel. */}
            {c.anim?.in && c.anim.in !== 'none' && (
              <span
                className="cap-fade in"
                style={{ width: Math.min(60, (c.anim.inDur ?? 0.35) * pxPerSec) }}
              />
            )}
            {c.anim?.out && c.anim.out !== 'none' && (
              <span
                className="cap-fade out"
                style={{ width: Math.min(60, (c.anim.outDur ?? 0.35) * pxPerSec) }}
              />
            )}
            <span className="chip-text">
              <Icon name={c.shape ? (SHAPE_ICON[c.shape.kind] ?? 'square') : 'type'} size={12} />
              {c.shape ? ` ${t(`shapes.kind.${c.shape.kind}` as StringKey)}` : ` ${words(c)}`}
            </span>
            {/* The start edge AFTER the words (22 Nov, K14). Both are layers of the
                same height; since the words became a pill with a layer of
                its own (DENEME-2 "blocks") the pill, coming later, lay over
                the edge's grab area from 6 px in: the edge could be caught
                on its first 6 px only, not the 8 the pointer is promised
                (e2e timeline-feel). Later in the order, the edge is on top,
                as the end edge always was. Their places are their own
                (absolute): nothing moves. */}
            {roomForHandles && (
              <div
                className="chip-handle l"
                data-testid={`timeline.caption.${c.id}.trim-start`}
                title={t('timeline.caption.trimStart')}
                onPointerDown={(e) => startCaptionTrim(e, c, 'start')}
              />
            )}
            {roomForDelete && (
              <BareButton
                className="chip-del"
                data-testid={`timeline.caption.${c.id}.delete`}
                title={t('timeline.caption.delete')}
                aria-label={t('timeline.caption.delete')}
                // Press only starts the interaction; the delete happens on
                // the click. Deleting on pointerdown meant an aim that was
                // a few pixels off destroyed the caption before the button
                // had even lit up.
                onPointerDown={(e) => e.stopPropagation()}
                onClick={(e) => {
                  e.stopPropagation()
                  useStore.getState().deleteCaption(c.id)
                }}
              >
                <Icon name="x" size={12} />
              </BareButton>
            )}
            {roomForHandles && (
              <div
                className="chip-handle r"
                data-testid={`timeline.caption.${c.id}.trim-end`}
                title={t('timeline.caption.trimEnd')}
                onPointerDown={(e) => startCaptionTrim(e, c, 'end')}
              />
            )}
          </div>
          )
        })}
      </div>
    ))}
    </>
  )
})
