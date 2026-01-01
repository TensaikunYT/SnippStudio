// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// What is drawn over the timeline's lanes (phase 3c.T: out of Timeline.tsx,
// each with its own subscriptions): the export's in and out points, the cut
// marks, the loop band, the Shorts bands, where a drop will land, a pending
// range, the snap line. The markup is as it was; a drag's step, a trim or a
// zoom now draws only the part it changes.
import { memo, useSyncExternalStore } from 'react'
import { exportMarks, subscribeExportMarks } from '../../export/marks'
import { useStore } from '../../state/store'
import { Icon, useT } from '../../ui'
import { fmtNum } from '../../ui/format'
import { snapTargetName } from '../../timeline/snap-name'
import type { DragSnapTarget } from '../../timeline/snapping'
import { projectDuration } from '../../types'
import { HEADER_W, fmt, playheadAt, useScrubbing, useSlideX } from './shared'
import { gestureMemo, startDrag } from './drag'
import { useTimelineView } from './view-state'

/** The export's in and out points (I / O; phase Ç3b, decision 9). */
export const ExportMarks = memo(function ExportMarks(): JSX.Element {
  const t = useT()
  const pxPerSec = useStore((s) => s.pxPerSec)
  const xMarks = useSyncExternalStore(subscribeExportMarks, exportMarks, exportMarks)
  const filmEnd = useStore((s) => (xMarks.in !== null && xMarks.out === null ? projectDuration(s.project) : 0))
  return (
    <>
      {xMarks.in !== null && <div className="tl-exportmark" data-testid="timeline.export-in" style={{ left: HEADER_W + xMarks.in * pxPerSec }} title={t('export.mark.in', { time: xMarks.in.toFixed(2) })} />}
      {xMarks.out !== null && <div className="tl-exportmark" data-testid="timeline.export-out" style={{ left: HEADER_W + xMarks.out * pxPerSec }} title={t('export.mark.out', { time: xMarks.out.toFixed(2) })} />}
      {(xMarks.in !== null || xMarks.out !== null) && (
        <div
          className="tl-exportrange"
          data-testid="timeline.export-range"
          style={{ left: HEADER_W + (xMarks.in ?? 0) * pxPerSec, width: Math.max(0, ((xMarks.out ?? filmEnd) - (xMarks.in ?? 0)) * pxPerSec) }}
        />
      )}
    </>
  )
})

/** The cutter's marks and the stretch between them. */
export const CutMarks = memo(function CutMarks(): JSX.Element {
  const t = useT()
  const pxPerSec = useStore((s) => s.pxPerSec)
  const cutMarks = useStore((s) => s.cutMarks)
  const deleteBetweenCuts = useStore((s) => s.deleteBetweenCuts)
  return (
    <>
      {cutMarks.map((m, i) => (
        <div key={i} className="tl-cutmark" data-testid={`timeline.cutmark.${i}`} style={{ left: HEADER_W + m * pxPerSec }} title={t('timeline.cutmark.hint', { time: m.toFixed(2) })} />
      ))}
      {cutMarks.length >= 2 && (
        <div
          className="tl-cutrange"
          data-testid="timeline.cutrange"
          title={t('timeline.cutrange.hint')}
          style={{
            left: HEADER_W + Math.min(...cutMarks) * pxPerSec,
            width: (Math.max(...cutMarks) - Math.min(...cutMarks)) * pxPerSec
          }}
          onPointerDown={(e) => e.stopPropagation()}
          onPointerUp={(e) => {
            if (e.button !== 0) return
            e.stopPropagation()
            deleteBetweenCuts(e.altKey)
          }}
          onContextMenu={(e) => {
            e.preventDefault()
            e.stopPropagation()
            const s = useStore.getState()
            const a = Math.min(...s.cutMarks)
            const b = Math.max(...s.cutMarks)
            // The clip to keep-trim: the selected one, else the clip on the
            // marked lane overlapping the range.
            const overlap = (c: (typeof s.project.clips)[string]) => c.start < b && c.start + c.duration > a
            let target = s.selectedClipIds.map((id) => s.project.clips[id]).find((c) => c && overlap(c))
            if (!target) {
              for (const track of s.project.tracks) {
                if (s.cutTrackId && track.id !== s.cutTrackId) continue
                target = track.clipIds.map((id) => s.project.clips[id]).find((c) => c && overlap(c))
                if (target) break
              }
            }
            if (target) s.keepOnlyRange(target.id, a, b)
          }}
        />
      )}
    </>
  )
})

export const LoopBand = memo(function LoopBand(): JSX.Element | null {
  const t = useT()
  const pxPerSec = useStore((s) => s.pxPerSec)
  const loopRange = useStore((s) => s.loopRange)
  return (
    <>
      {loopRange && (
        <div
          className="tl-loop-band"
          style={{
            left: HEADER_W + loopRange[0] * pxPerSec,
            width: Math.max(4, (loopRange[1] - loopRange[0]) * pxPerSec)
          }}
          title={t('timeline.loop.hint', { start: loopRange[0].toFixed(1), end: loopRange[1].toFixed(1) })}
        />
      )}
    </>
  )
})

// Drag a short-segment band (via its label bar): edges resize, bar moves,
// plain click selects. Edges snap to clip edges and the playhead.
const startSegmentDrag = (
  e: React.PointerEvent,
  seg: { id: string; start: number; end: number; locked?: boolean },
  part: 'start' | 'end' | 'move'
) => {
  e.stopPropagation()
  if (e.button !== 0) return
  const s0 = useStore.getState()
  s0.setActiveShortSegment(seg.id)
  if (seg.locked) return // still selectable, never movable
  const orig = { start: seg.start, end: seg.end }
  const memo = gestureMemo()
  const snap = (t: number, st: ReturnType<typeof useStore.getState>, shift: boolean): number => {
    if (shift) return t
    const thr = 8 / st.pxPerSec
    const cands = [0, st.currentTime]
    for (const track of st.project.tracks) {
      for (const id of track.clipIds) {
        const c = st.project.clips[id]
        if (c) cands.push(c.start, c.start + c.duration)
      }
    }
    for (const cand of cands) if (Math.abs(t - cand) <= thr) return cand
    return t
  }
  startDrag(e, {
    horizontal: true,
    // See startCanvasSegDrag: one snapshot per gesture, not one per mouse move.
    onStart: () => useStore.getState().beginGesture(),
    onMove: (p) => {
      const st = useStore.getState()
      const d = p.dx / st.pxPerSec
      if (part === 'start')
        st.updateShortSegment(seg.id, { start: snap(orig.start + d, st, p.shiftKey) }, false)
      else if (part === 'end')
        st.updateShortSegment(seg.id, { end: snap(orig.end + d, st, p.shiftKey) }, false)
      else {
        let dd = Math.max(d, -orig.start)
        // Snap whichever edge lands closer to a snap target.
        const s1 = snap(orig.start + dd, st, p.shiftKey)
        const s2 = snap(orig.end + dd, st, p.shiftKey)
        if (s1 !== orig.start + dd) dd = s1 - orig.start
        else if (s2 !== orig.end + dd) dd = s2 - orig.end
        st.updateShortSegment(seg.id, { start: orig.start + dd, end: orig.end + dd }, false)
      }
    },
    onEnd: (_p, moved) => {
      // Plain click: jump the playhead to the segment start.
      if (!moved && part === 'move') useStore.getState().setTime(orig.start)
    },
    onCancel: (moved) => {
      if (moved) memo.restore()
    }
  })
}

/** The Shorts bands (Shorts mode only). */
export const ShortSegments = memo(function ShortSegments(): JSX.Element | null {
  const t = useT()
  const pxPerSec = useStore((s) => s.pxPerSec)
  const shorts = useStore((s) => s.project.mode === 'shorts')
  const segments = useStore((s) => s.project.shortSegments)
  const activeShortSegmentId = useStore((s) => s.activeShortSegmentId)
  if (!shorts) return null
  return (
    <>
      {        (segments ?? []).map((seg) => (
          <div
            key={seg.id}
            className={`tl-short-seg${activeShortSegmentId === seg.id ? ' active' : ''}${seg.locked ? ' locked' : ''}`}
            style={{
              left: HEADER_W + seg.start * pxPerSec,
              width: Math.max(8, (seg.end - seg.start) * pxPerSec),
              ...(seg.color
                ? { background: `${seg.color}1f`, borderLeftColor: seg.color, borderRightColor: seg.color }
                : {})
            }}
          >
            <div
              className="seg-bar"
              title={t('timeline.seg.hint', { name: seg.name, s: (seg.end - seg.start).toFixed(1) })}
              onPointerDown={(e) => startSegmentDrag(e, seg, 'move')}
            >
              {/* A grip you can actually see and aim at. The whole bar still
                  moves the segment, but nothing said so — the band read as
                  decoration painted over the clips. */}
              {!seg.locked && <span className="seg-move" title={t('timeline.seg.move.hint')}><Icon name="grip-vertical" size={12} /></span>}
              <span className="seg-label" style={seg.color ? { color: seg.color } : undefined}>
                <Icon name={seg.locked ? 'lock' : 'smartphone'} size={12} /> {seg.name} · {t('trans.seconds', { s: (seg.end - seg.start).toFixed(1) })}
                {seg.fixedDur ? <Icon name="ruler" size={12} /> : null}
              </span>
            </div>
            {/* Pan keyframes, so a segment shows WHERE its crop was told
                to be — otherwise they only exist in the panel's list. */}
            {(seg.keyframes ?? []).map((kf) => (
              <span
                key={kf.id}
                className="seg-kf"
                style={{ left: (kf.time - seg.start) * pxPerSec }}
                title={t('timeline.seg.key.hint', { time: kf.time.toFixed(2) })}
              />
            ))}
            {!seg.locked && (
              <>
                {/* A second move handle at the band's right end: a segment
                    wider than the window always has one grip on screen. */}
                <span
                  className="seg-move-r"
                  title={t('timeline.seg.move.hint')}
                  onPointerDown={(e) => startSegmentDrag(e, seg, 'move')}
                >
                  <Icon name="grip-vertical" size={12} /> {t('timeline.seg.move')}
                </span>
                <div
                  className="seg-handle l"
                  title={t('timeline.seg.start.hint')}
                  onPointerDown={(e) => startSegmentDrag(e, seg, 'start')}
                >
                  <span className="seg-grip" />
                </div>
                <div
                  className="seg-handle r"
                  title={t('timeline.seg.end.hint')}
                  onPointerDown={(e) => startSegmentDrag(e, seg, 'end')}
                >
                  <span className="seg-grip" />
                </div>
              </>
            )}
          </div>
        ))}
    </>
  )
})

/** Where a drop will land: a clip's move (the drag preview) or media dragged
 *  in from the bin (`binDrop`, kept by the timeline). */
export const DropIndicator = memo(function DropIndicator({ binDrop }: { binDrop: { sec: number; label: string; top: number } | null }): JSX.Element {
  const t = useT()
  const pxPerSec = useStore((s) => s.pxPerSec)
  const dropSec = useStore((s) => s.dragPreview?.dropSec ?? null)
  const dragInvalidReason = useStore((s) => s.dragPreview?.invalidReason ?? null)
  const dropLabelTop = useStore((s) => s.dragPreview?.dropLabelTop ?? 48)
  const dropTrackName = useStore((s) => (s.dragPreview ? (s.project.tracks.find((track) => track.id === s.dragPreview?.dropTrackId)?.name ?? null) : null))
  return (
    <>
      {dropSec === null && binDrop && (
        <div className="tl-drop-indicator" style={playheadAt(HEADER_W + binDrop.sec * pxPerSec)}>
          <span className="tl-drop-cap" />
          <span className="tl-drop-label" style={{ top: binDrop.top + 4 }}>
            {binDrop.label}
          </span>
        </div>
      )}
      {dropSec !== null && (
        <div className={`tl-drop-indicator${dragInvalidReason ? ' invalid-drop' : ''}`} style={playheadAt(HEADER_W + dropSec * pxPerSec)}>
          <span className="tl-drop-cap" />
          <span className="tl-drop-label" style={{ top: dropLabelTop + 4 }}>
            {dragInvalidReason ?? t('timeline.drop.on', { track: dropTrackName ?? t('timeline.drop.new'), time: fmt(dropSec) })}
          </span>
        </div>
      )}
    </>
  )
})

/** What another panel is about to cut (the transcript's selection). */
export const RangePreview = memo(function RangePreview(): JSX.Element {
  const t = useT()
  const pxPerSec = useStore((s) => s.pxPerSec)
  const rangePreview = useStore((s) => s.rangePreview)
  return (
    <>
      {rangePreview && rangePreview.end > rangePreview.start && (
        <div
          className="tl-rangepreview"
          style={{
            left: HEADER_W + rangePreview.start * pxPerSec,
            width: Math.max(2, (rangePreview.end - rangePreview.start) * pxPerSec)
          }}
          title={rangePreview.label ?? t('timeline.pending')}
        >
          {rangePreview.label && (rangePreview.end - rangePreview.start) * pxPerSec > 60 && (
            <span>{rangePreview.label}</span>
          )}
        </div>
      )}
    </>
  )
})

/** A trim's label, beside the edge being dragged. */
export const TrimTip = memo(function TrimTip(): JSX.Element | null {
  const pxPerSec = useStore((s) => s.pxPerSec)
  const tip = useTimelineView((v) => v.trimTip)
  if (!tip) return null
  return (
    <span className={`tl-trim-tip ${tip.side}`} role="status" data-testid="timeline.trim-tip" style={{ left: 0, top: tip.top + 6, transform: `translateX(${HEADER_W + tip.time * pxPerSec}px) ${tip.side === 'l' ? 'translateX(10px)' : 'translateX(calc(-100% - 10px))'}` }}>
      {tip.text}
    </span>
  )
})

/** The line a drag or a trim has snapped to, and what it snapped to. */
/** The snap line's box: from the left edge (useSlideX moves it). */
const SNAP_BOX = { left: 0 } as const

export const SnapGuide = memo(function SnapGuide(): JSX.Element | null {
  const pxPerSec = useStore((s) => s.pxPerSec)
  const snapGuide = useStore((s) => s.snapGuide)
  const activeSnapTarget = useStore((s) => s.dragPreview?.snapTarget ?? null)
  const snapLabelTop = useStore((s) => s.dragPreview?.snapLabelTop ?? 4)
  // During a scrub the line stays in the page, slid out of sight when there
  // is no snap (is-off): its coming and going on every snap of a scrub made
  // the browser sort every layer out again (useSlideX). Otherwise only while
  // there is a snap, as before.
  const scrubbing = useScrubbing()
  return snapGuide === null && !scrubbing ? null : <SnapLine at={snapGuide} pxPerSec={pxPerSec} activeSnapTarget={activeSnapTarget} snapLabelTop={snapLabelTop} />
})

function SnapLine({ at: snapGuide, pxPerSec, activeSnapTarget, snapLabelTop }: { at: number | null; pxPerSec: number; activeSnapTarget: DragSnapTarget | null; snapLabelTop: number }): JSX.Element {
  const t = useT()
  const ref = useSlideX<HTMLDivElement>(snapGuide === null ? null : HEADER_W + snapGuide * pxPerSec)
  return (
    <div
      ref={ref}
      className={`tl-snapguide${snapGuide === null ? ' is-off' : ''}${snapGuide !== null && activeSnapTarget ? ` ${activeSnapTarget.kind}` : ''}`}
      style={SNAP_BOX}
      aria-hidden={snapGuide === null ? true : undefined}
      title={snapGuide === null ? undefined : activeSnapTarget ? t('timeline.snap.with', { what: snapTargetName(activeSnapTarget), time: fmtNum(snapGuide, 2, true) }) : t('timeline.snap.at', { time: fmtNum(snapGuide, 2, true) })}
    >
      {snapGuide !== null && activeSnapTarget && <span className="tl-snap-label" style={{ top: snapLabelTop + 4 }}><Icon name="arrow-left-right" size={12} /> {snapTargetName(activeSnapTarget)}</span>}
    </div>
  )
}
