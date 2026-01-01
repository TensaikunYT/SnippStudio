// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useShallow } from 'zustand/react/shallow'
import './export/export.css'
import { useStore } from '../state/store'
import { Icon, TextField, useT } from '../ui'
import { useViewport } from '../playback/viewport'
import { NEW_AUDIO_TRACK } from '../timeline/placement'
import { draggedAssets, dropItemsOf, planDropAt, timelineDropAt } from '../timeline/droptarget'
import { laneHeight, timeAtViewX, wheelZoom, zoomScrollLeft } from '../timeline/view-math'
import { FloatingMenu } from './FloatingMenu'
import { EmptyState } from './EmptyState'
import { requestShell } from './app/requests'
import { TemplateLane } from './TemplateLane'
import { NoteLane } from './NoteLane'
import { AgentTimelineLayer } from './agent/AgentLayers'
import { useAgentOn } from './agent/useAgentShown'
import { AgentRow } from './agent/AgentRow'
import { AgentRulerMarks, AgentTrail } from './agent/AgentTrail'
import { useAfterProject } from './agent/shown'
import './agent/review.css'
import './agent/ekip.css'
import type { Clip, Project, Track } from '../types'
import { HEADER_W, fmt, snapEdgeTime, snapToSegments, filmLength, sameIds, nearWindow, VIEW_STEP_PX, PLAYHEAD_GRAB_PX, DRAG_SLOP_PX, beginScrub } from './timeline/shared'
import { TrackClips } from './timeline/clip-block'
import { DropGhosts } from './timeline/drop-ghost'
import { TrackHeader } from './timeline/track-header'
import { TransitionJunctions } from './timeline/transitions'
import { selectTransition } from './timeline/transition-state'
import { RulerTicks, Playhead, PlayheadHead } from './timeline/playhead'
import { TimelineToolbar } from './timeline/toolbar'
import { CaptionLanes } from './timeline/caption-lanes'
import { CutMarks, DropIndicator, ExportMarks, LoopBand, RangePreview, ShortSegments, SnapGuide, TrimTip } from './timeline/overlays'
import { ScopeBand, ScopeBox, ScopeRulerMark, beginBandDrag } from './agent/ScopeBand'
import { useScopeBand } from '../agent/scope-band'
import { setZoom, takeZoomAnchor, useTimelineView } from './timeline/view-state'
import { BareButton } from '../ui/Button'

/** The cutter snaps to an edge or the playhead only this close (kullanım, item 1). */
const CUTTER_SNAP_PX = 6
import { zoomWheelHeld } from '../os-platform'
import { MARKER_DRAG_PX, markerSnap } from './marker-drag'
export { keyframeGroups } from './timeline/shared'
export type { KfGroup } from './timeline/shared'

/** The ruler's marks: the user's markers (and the small editor of one), the
 *  selected tracker's keyframes. Their own subscriptions (phase 3c.T). */
const RulerMarks = memo(function RulerMarks(): JSX.Element {
  const t = useT()
  const pxPerSec = useStore((s) => s.pxPerSec)
  // (The draft's markers while the timeline shows "After": D22, worker C.)
  const after = useAfterProject()
  const liveMarkers = useStore((s) => s.project.markers)
  const markers = after ? after.markers : liveMarkers
  const trk = useStore((s) => (s.selectedTrackerId ? s.project.trackers?.find((x) => x.id === s.selectedTrackerId) : undefined))
  const setTime = useStore((s) => s.setTime)
  const [markerEdit, setMarkerEdit] = useState<{ id: string; x: number; y: number; text: string } | null>(null)
  return (
    <>
      {(markers ?? []).map((m) => (
        <div
          key={m.id}
          className="tl-marker"
          style={{ left: HEADER_W + m.time * pxPerSec, background: m.color }}
          title={t('timeline.marker.hint', { name: m.label || m.note || t('timeline.marker'), time: fmt(m.time) })}
          onPointerDown={(e) => {
            e.stopPropagation()
            if (e.button !== 0) return
            // A press seeks to it; a press moved past a few pixels drags it
            // (cila4, 6), snapping to the playhead, the clips' and titles'
            // edges and the other markers (Shift: free). One undo step.
            const el = e.currentTarget
            const x0 = e.clientX
            const from = m.time
            let moved = false
            el.setPointerCapture(e.pointerId)
            const move = (ev: PointerEvent): void => {
              if (!moved && Math.abs(ev.clientX - x0) < MARKER_DRAG_PX) return
              moved = true
              const st = useStore.getState()
              const pps = st.pxPerSec
              const r = ev.shiftKey ? { time: Math.max(0, from + (ev.clientX - x0) / pps), guide: null } : markerSnap(st.project, from + (ev.clientX - x0) / pps, m.id, st.currentTime, 8 / pps)
              st.setSnapGuide(r.guide)
              if (r.time !== st.project.markers?.find((x) => x.id === m.id)?.time) st.updateMarker(m.id, { time: r.time })
            }
            const up = (): void => {
              el.removeEventListener('pointermove', move)
              el.removeEventListener('pointerup', up)
              el.removeEventListener('pointercancel', up)
              useStore.getState().setSnapGuide(null)
              if (!moved) setTime(m.time)
            }
            el.addEventListener('pointermove', move)
            el.addEventListener('pointerup', up)
            el.addEventListener('pointercancel', up)
          }}
          onDoubleClick={(e) => {
            // window.prompt is a no-op in Electron, so editing used to do
            // nothing at all — this opens a proper inline editor.
            e.stopPropagation()
            setMarkerEdit({ id: m.id, x: e.clientX, y: e.clientY, text: m.label ?? m.note ?? '' })
          }}
          onContextMenu={(e) => {
            e.preventDefault()
            e.stopPropagation()
            useStore.getState().deleteMarker(m.id)
          }}
        />
      ))}
      {markerEdit && (
        <FloatingMenu
          x={markerEdit.x}
          y={markerEdit.y}
          className="ctx-menu marker-edit"
          onPointerDown={(e) => e.stopPropagation()}
        >
          <TextField
            autoFocus
            size="sm"
            label={t('timeline.marker.name')}
            value={markerEdit.text}
            placeholder={t('timeline.marker.placeholder')}
            onChange={(text) => setMarkerEdit({ ...markerEdit, text })}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                useStore.getState().updateMarker(markerEdit.id, { label: markerEdit.text })
                setMarkerEdit(null)
              } else if (e.key === 'Escape') setMarkerEdit(null)
            }}
            onBlur={() => {
              useStore.getState().updateMarker(markerEdit.id, { label: markerEdit.text })
              setMarkerEdit(null)
            }}
          />
          <div className="marker-colors">
            {['#ffd83d', '#4fa8ff', '#ff7ab0', '#7ade7a', '#b98cff', '#ff8a4c'].map((c) => (
              <BareButton
                key={c}
                style={{ background: c }}
                title={t('timeline.marker.colour', { colour: c })}
                aria-label={t('timeline.marker.colour', { colour: c })}
                // (The name field keeps the focus: its blur closed the editor
                // before the click came, so no colour was ever set. cila4, 6.)
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  useStore.getState().updateMarker(markerEdit.id, { label: markerEdit.text, color: c })
                  setMarkerEdit(null)
                }}
              />
            ))}
          </div>
        </FloatingMenu>
      )}
      {/* Selected motion tracker's keyframes on the ruler. */}
      {trk?.keyframes.map((kf) => (
        <div
          key={kf.id}
          className="tl-kf tracker"
          style={{ left: HEADER_W + kf.time * pxPerSec }}
          title={t('timeline.trackerKey.hint', { name: trk.name, time: fmt(kf.time) })}
          onPointerDown={(e) => {
            e.stopPropagation()
            setTime(kf.time)
          }}
        />
      ))}
    </>
  )
})

/** A lane's cuts near the view (phase 3c.T). The transition buttons were made
 *  for every cut of the lane, wherever the view was: a hundred cuts, a hundred
 *  buttons built again on every zoom step and every edit. Only the clips in
 *  the window (and the one before and after it, so its outer cuts are whole)
 *  are handed on; which cuts get a button is TransitionJunctions' own rule. */
const NearJunctions = memo(function NearJunctions({ track, clips }: { track: Track; clips: Clip[] }): JSX.Element {
  const px = useStore((s) => s.pxPerSec)
  const width = useViewport((v) => v.width)
  const { lo, hi } = nearWindow(useViewport((v) => Math.floor(v.left / VIEW_STEP_PX)), width)
  const ordered = [...clips].sort((a, b) => a.start - b.start)
  const first = ordered.findIndex((c) => HEADER_W + (c.start + c.duration) * px >= lo)
  let last = -1
  for (let i = ordered.length - 1; i >= 0; i--) {
    if (HEADER_W + ordered[i].start * px <= hi) {
      last = i
      break
    }
  }
  const near = first < 0 || last < first ? [] : ordered.slice(Math.max(0, first - 1), last + 2)
  return <TransitionJunctions track={track} clips={near} />
})

/** One video or sound lane: its head, its clips, its transitions. It watches
 *  its own clips and its own share of a drag (phase 3c.T): another lane's
 *  trim, a drag's step elsewhere or a subtitle's edit does not draw it. */
const TrackRow = memo(function TrackRow({ track, firstAudio, emptyFirst, after }: { track: Track; firstAudio: boolean; emptyFirst?: boolean; after: Project | null }): JSX.Element {
  const t = useT()
  // The lane's clips, the same array until one of them changes. (While the
  // timeline shows an agent's draft — "After" — the draft's clips of this
  // lane, read-only: D22, worker C.)
  const liveClips = useStore(useShallow((s) => (after ? [] : track.clipIds.map((id) => s.project.clips[id]).filter(Boolean))))
  const afterClips = useMemo(() => (after ? track.clipIds.map((id) => after.clips[id]).filter(Boolean) : null), [after, track])
  const clips = afterClips ?? liveClips
  const dropTarget = useStore((s) => s.dragPreview?.targetTrackId === track.id)
  const invalidDrop = useStore((s) => s.dragPreview?.targetTrackId === track.id && !!s.dragPreview.invalidReason)
  const snapSource = useStore((s) => s.dragPreview?.snapTarget?.trackId === track.id)
  const trackScale = useTimelineView((v) => v.trackScale)
  return (
    <div
      className={`tl-track ${track.kind}${firstAudio ? ' first-audio' : ''}${track.hidden ? ' hidden-track' : ''}${
        dropTarget ? ` drop-target${invalidDrop ? ' invalid-drop' : ''}` : ''
      }${snapSource ? ' snap-source-track' : ''}`}
      data-track-id={track.id}
      data-testid={`timeline.track.${track.id}`}
      style={{ height: laneHeight(track.kind, track.height, trackScale) }}
    >
      <TrackHeader track={track} />
      <TrackClips track={track} clips={clips} />
      {/* Where a dragged clip lands (DENEME-3, V item 4). */}
      <DropGhosts track={track} />
      {/* Arayüz v4: an empty lane says what goes in it; on an empty timeline
          the first picture lane also offers the import (timeline.empty). */}
      {clips.length === 0 &&
        (emptyFirst ? (
          <EmptyState className="tl-lane-hint" text={t('timeline.empty.lane')} action={t('bin.import')} icon="plus" onAction={() => requestShell('import')} testid="timeline.empty" />
        ) : (
          <span className="tl-lane-hint" aria-hidden="true">
            <Icon name={track.kind === 'audio' ? 'audio-lines' : 'image'} size={13} />
            {t(track.kind === 'audio' ? 'timeline.lane.dropAudio' : 'timeline.lane.dropMedia')}
          </span>
        ))}
      {track.kind === 'video' && !track.locked && <NearJunctions track={track} clips={clips} />}
    </div>
  )
})

/** The thin "+ lane" strip above the video lanes and below the sound lanes. */
function AddTrackStrip({ kind, binDropNew, seek }: { kind: 'video' | 'audio'; binDropNew: 'video' | 'audio' | null; seek: Record<string, unknown> }): JSX.Element {
  const t = useT()
  const add = useStore((s) => (kind === 'video' ? s.addVideoTrack : s.addAudioTrack))
  const dropNew = useStore((s) => s.dragPreview?.newTrack === kind) || binDropNew === kind
  return (
    <div className={`tl-addtrack${dropNew ? ' drop-new' : ''}`} data-new-track-kind={kind} {...seek}>
      <span className="addtrack-head" />
      <BareButton data-testid={`timeline.add-${kind}-track`} onClick={add} aria-label={t(kind === 'video' ? 'timeline.tool.addVideo' : 'timeline.tool.addAudio')} title={t(kind === 'video' ? 'timeline.strip.video.hint' : 'timeline.strip.audio.hint')}>
        <Icon name="plus" size={12} />
        {dropNew ? t(kind === 'video' ? 'timeline.strip.video.drop' : 'timeline.strip.audio.drop') : null}
      </BareButton>
    </div>
  )
}

export function Timeline(): JSX.Element {
  const t = useT()
  // What the frame itself watches (phase 3c.T): the zoom, the film's length,
  // the lanes, the tool. The project as a whole is not watched here: each part
  // (toolbar, subtitle lanes, a lane's clips, the marks) watches its own.
  const pxPerSec = useStore((s) => s.pxPerSec)
  // "After": the lanes show the agent's draft (components/agent/shown.ts).
  const after = useAfterProject()
  const liveTracks = useStore((s) => s.project.tracks)
  const tracks = after ? after.tracks : liveTracks
  const fps = useStore((s) => s.project.settings.fps || 30)
  const liveEnd = useStore((s) => filmLength(s.project))
  const filmEnd = after ? Math.max(liveEnd, filmLength(after)) : liveEnd
  const empty = useStore((s) => {
    for (const _ in s.project.clips) return false
    return true
  })
  const cutterMode = useStore((s) => s.cutterMode)
  const splitToolMode = useStore((s) => s.splitToolMode)
  const agentOn = useAgentOn()
  const slipToolMode = useStore((s) => s.slipToolMode)
  const playing = useStore((s) => s.playing)
  // A media-bin drag is an HTML5 drag, so it can't use dragPreview (that lives
  // in the pointer-drag path) — it gets its own hover flag for the same strip.
  const [binDropNew, setBinDropNew] = useState<'video' | 'audio' | null>(null)
  /** Where media dragged in from the bin (or the file manager) would land:
   *  the same indicator as a clip's move, so a drop is never a surprise. */
  const [binDrop, setBinDrop] = useState<{ sec: number; label: string; top: number } | null>(null)
  const clearBinDrop = (): void => {
    window.clearTimeout(binDropQuiet.current)
    setBinDropNew(null)
    setBinDrop(null)
    useStore.getState().setSnapGuide(null)
  }
  // A live drag fires dragover all the time, even standing still. A file
  // dragged in from outside and then taken away (Esc, out of the window) may
  // end with no event here at all: when they stop, the indicator goes.
  const binDropQuiet = useRef(0)
  // A drag that ends anywhere else (dropped on another panel, Esc) takes the
  // indicator with it.
  useEffect(() => {
    const end = (): void => {
      setBinDropNew(null)
      setBinDrop(null)
    }
    window.addEventListener('dragend', end)
    window.addEventListener('drop', end)
    return () => {
      window.removeEventListener('dragend', end)
      window.removeEventListener('drop', end)
    }
  }, [])
  /** Which explicit "+ add track" strip is under the pointer. Keeping the kind
   * matters: treating both strips as the video strip made audio drops silently
   * fall back to A1 instead of creating A2. */
  const newTrackKindAt = (x: number, y: number): 'video' | 'audio' | null => {
    const zone = document
      .elementsFromPoint(x, y)
      .find((node) => node instanceof HTMLElement && node.classList.contains('tl-addtrack')) as HTMLElement | undefined
    return zone?.dataset.newTrackKind === 'audio'
      ? 'audio'
      : zone?.dataset.newTrackKind === 'video'
        ? 'video'
        : null
  }
  /** The cutter's and the split tool's line under the pointer: moved by hand
   *  (its style), not by a render of the timeline per pointer move. */
  const ghostRef = useRef<HTMLDivElement>(null)
  const showGhost = (x: number | null, snapped = false): void => {
    const g = ghostRef.current
    if (!g) return
    g.style.display = x === null ? 'none' : ''
    g.classList.toggle('snapped', snapped)
    if (x !== null) g.style.left = `${x}px`
  }
  /** Where the cutter's click cuts (kullanım, item 1): the frame under the
   *  pointer; an edge or the playhead only when it is within CUTTER_SNAP_PX
   *  (the ghost line says so before the click); Alt: no snapping at all. */
  const cutterTime = (clientX: number, alt: boolean): { t: number; snapped: boolean } => {
    const el = scrollRef.current!
    const st = useStore.getState()
    const rect = el.getBoundingClientRect()
    const raw = Math.max(0, (clientX - rect.left + el.scrollLeft - HEADER_W) / st.pxPerSec)
    const fps = st.project.settings.fps || 30
    const onFrame = Math.round(raw * fps) / fps
    if (alt) return { t: onFrame, snapped: false }
    const near = snapEdgeTime(st, raw, '', CUTTER_SNAP_PX / st.pxPerSec)
    return near !== raw ? { t: near, snapped: true } : { t: onFrame, snapped: false }
  }
  const scrollRef = useRef<HTMLDivElement>(null)
  const scrubbing = useRef(false)
  const [followPlayhead, setFollowPlayhead] = useState(
    () => localStorage.getItem('autocut-follow') !== 'off'
  )
  const sideScrub = useRef<{ raf: number; last: number } | null>(null)
  const [marquee, setMarquee] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null)
  const marqueeRef = useRef<{ x0: number; y0: number } | null>(null)
  /** A press in the tracks area that hasn't decided yet whether it is a click
   *  (seek) or a drag (marquee). Resolved by DRAG_SLOP_PX of travel. */
  const pressRef = useRef<{ x: number; y: number } | null>(null)
  /** Pointer is within grabbing distance of the playhead (drives the cursor). */
  const [overPlayhead, setOverPlayhead] = useState(false)

  /**
   * Selects every clip intersecting the marquee rectangle (inner coords).
   *
   * Row positions are MEASURED, not added up. Recomputing them from the ruler
   * height plus each track's height meant the arithmetic had to know about
   * every row the timeline draws, and it didn't: the 18 px "＋ add video track"
   * strip between the caption lanes and the tracks wasn't in the sum, so every
   * track was tested 18 px above where it actually is and a box drawn over one
   * row could select the one below it. offsetTop is relative to .tl-inner,
   * which is exactly the coordinate space the marquee is drawn in.
   */
  const applyMarquee = (x0: number, y0: number, x1: number, y1: number) => {
    const s = useStore.getState()
    const inner = scrollRef.current?.querySelector('.tl-inner') as HTMLElement | null
    if (!inner) return
    const [left, right] = [Math.min(x0, x1), Math.max(x0, x1)]
    const [top, bottom] = [Math.min(y0, y1), Math.max(y0, y1)]
    const t0 = (left - HEADER_W) / s.pxPerSec
    const t1 = (right - HEADER_W) / s.pxPerSec
    const hitsRow = (el: HTMLElement): boolean =>
      el.offsetTop + el.offsetHeight >= top && el.offsetTop <= bottom
    // Caption lanes (subtitles + text layers) sit above the tracks.
    const capHits: string[] = []
    for (const el of inner.querySelectorAll<HTMLElement>('.tl-caption-lane')) {
      if (!hitsRow(el)) continue
      const layer = Number(el.dataset.captionLayer ?? 0)
      capHits.push(
        ...s.project.captions
          .filter((c) => (c.layer ?? 0) === layer && c.start < t1 && c.end > t0)
          .map((c) => c.id)
      )
    }
    // (Only a changed set: the same clips under a growing box are no news.)
    if (!sameIds(s.selectedCaptionIds, capHits)) s.selectCaptions(capHits)
    const hits: string[] = []
    for (const el of inner.querySelectorAll<HTMLElement>('.tl-track')) {
      if (!hitsRow(el)) continue
      const track = s.project.tracks.find((t) => t.id === el.dataset.trackId)
      // Not a locked track's clips (as Select all): selected, the next Delete
      // or nudge would reach what the lock is there to keep.
      if (track?.locked) continue
      for (const id of track?.clipIds ?? []) {
        const clip = s.project.clips[id]
        if (clip && clip.start < t1 && clip.start + clip.duration > t0) hits.push(id)
      }
    }
    if (!sameIds(s.selectedClipIds, hits)) s.selectClips(hits)
  }

  // The wheel over the lanes. Ctrl: zoom about the time under the pointer
  // (several wheel events in a frame are one step; the time stays where it
  // is). Alt: the lane height step. Shift (and a trackpad's sideways travel)
  // scrolls sideways, plain scrolls the lanes up and down: the browser's own.
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    let travel = 0
    let viewX = 0
    let raf = 0
    let altTravel = 0
    const onWheel = (e: WheelEvent): void => {
      if (e.altKey && !e.ctrlKey) {
        e.preventDefault()
        // One notch (or a firm swipe) is one step: up is taller.
        altTravel += e.deltaY
        if (Math.abs(altTravel) >= 60) {
          useTimelineView.getState().stepTrackScale(altTravel < 0 ? 1 : -1)
          altTravel = 0
        }
        return
      }
      // Ctrl (and a pinch); Cmd too on a Mac (phase 10a.5, K3).
      if (!zoomWheelHeld(e)) return
      e.preventDefault()
      travel += e.deltaY
      viewX = e.clientX - el.getBoundingClientRect().left
      if (raf) return
      raf = requestAnimationFrame(() => {
        raf = 0
        const s = useStore.getState()
        const time = Math.max(0, timeAtViewX(viewX, el.scrollLeft, s.pxPerSec, HEADER_W))
        const next = wheelZoom(s.pxPerSec, travel)
        travel = 0
        setZoom(next, { time, viewX })
      })
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => {
      el.removeEventListener('wheel', onWheel)
      if (raf) cancelAnimationFrame(raf)
    }
  }, [])

  // A new zoom is on the page and not yet on the screen: put the zoom's fixed
  // point (the time under the pointer, the playhead, the middle of the view)
  // back where it was, then tell what follows the view (film strips, sound
  // drawings, subtitle chips) where it is now.
  useLayoutEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const anchor = takeZoomAnchor()
    if (anchor) el.scrollLeft = zoomScrollLeft(anchor.time, anchor.viewX, pxPerSec, HEADER_W)
    useViewport.getState().set(el.scrollLeft, el.clientWidth)
  }, [pxPerSec])

  // Keep the waveform viewport in sync on mount and resize too.
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const sync = (): void => useViewport.getState().set(el.scrollLeft, el.clientWidth)
    const ro = new ResizeObserver(sync)
    ro.observe(el)
    const id = requestAnimationFrame(sync)
    return () => {
      ro.disconnect()
      cancelAnimationFrame(id)
    }
  }, [])

  const duration = Math.max(10, filmEnd + 5)
  // Extra empty space after the content so the playhead can sit past the last
  // clip and there's room to drop clips into a gap at the end.
  const totalWidth = duration * pxPerSec + Math.max(60, 8 * pxPerSec)

  // Clicking the full-width add-track strips (not their ＋ button) also seeks,
  // so the whole top band moves the playhead like the ruler does.
  const addTrackSeek = {
    onPointerDown: (e: React.PointerEvent) => {
      // Left button only — see the ruler handler.
      if (e.button !== 0) return
      if ((e.target as HTMLElement).closest('button')) return
      scrubbing.current = true
      beginScrub()
      useStore.getState().setPlaying(false)
      seekSnapped(timeFromEvent(e), e.shiftKey)
      ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
    },
    onPointerMove: (e: React.PointerEvent) => {
      if (scrubbing.current) seekSnapped(timeFromEvent(e), e.shiftKey)
    },
    onPointerUp: () => {
      scrubbing.current = false
      useStore.getState().setSnapGuide(null)
    }
  }

  const timeFromEvent = (e: React.PointerEvent): number => {
    const el = scrollRef.current
    if (!el) return 0
    const rect = el.getBoundingClientRect()
    return Math.max(0, (e.clientX - rect.left + el.scrollLeft - HEADER_W) / pxPerSec)
  }

  /** Seeks to a time, snapping the playhead to clip/caption/marker edges when
   *  the toggle is on (Shift bypasses). Shows the guide line while snapped. */
  const seekSnapped = (t: number, shift: boolean): void => {
    const st = useStore.getState()
    let target = t
    if (shift) {
      // Shift always means "exactly where I put it".
      st.setSnapGuide(null)
    } else if (st.playheadSnap) {
      // 7 px, not 10: the playhead has to be able to sit BETWEEN two keyframes
      // that are close together, and a wide window turns scrubbing into a
      // series of jumps between magnets.
      const snapped = snapEdgeTime(st, t, '', 7 / st.pxPerSec, undefined, false)
      st.setSnapGuide(snapped !== t ? snapped : null)
      target = snapped
    } else {
      // Snap toggle off: still catch Shorts/camera segment edges, but with a
      // tight 7 px window so ordinary scrubbing stays free.
      const snapped = snapToSegments(st, t, 7 / st.pxPerSec)
      st.setSnapGuide(snapped !== t ? snapped : null)
      target = snapped
    }
    st.setTime(target)
  }

  return (
    <div className="timeline">
      <TimelineToolbar followPlayhead={followPlayhead} setFollowPlayhead={setFollowPlayhead} />
      {/* The agent's one line: the review strip while a draft waits, else
          what the agent does now (D22, worker C). */}
      <AgentRow />
      {agentOn && <ScopeBox />}
      <div
        data-testid="timeline.scroll"
        className={`tl-scroll${cutterMode ? ' cutter' : ''}${splitToolMode ? ' splittool' : ''}${
          slipToolMode ? ' sliptool' : ''
        }${overPlayhead && !cutterMode && !splitToolMode && !slipToolMode ? ' on-playhead' : ''}${after ? ' is-agent-after' : ''}`}
        ref={scrollRef}
        onScroll={(e) => {
          const el = e.currentTarget
          useViewport.getState().set(el.scrollLeft, el.clientWidth)
        }}
        onPointerDownCapture={(e) => {
          // Split tool: clicking a clip splits THAT clip at the clicked
          // point (not at the playhead).
          if (splitToolMode && e.button === 0) {
            const clipEl = (e.target as HTMLElement).closest('.tl-clip') as HTMLElement | null
            const clipId = clipEl?.dataset.clipId
            if (clipId) {
              e.preventDefault()
              e.stopPropagation()
              const el = scrollRef.current!
              const rect = el.getBoundingClientRect()
              const t = Math.max(0, (e.clientX - rect.left + el.scrollLeft - HEADER_W) / pxPerSec)
              useStore.getState().splitClipAt(clipId, t)
            }
            return
          }
          // Cutter tool: clicking a clip marks a cut scoped to THAT clip's
          // lane, so cutting audio never touches video/subtitles and vice
          // versa. Clicking the subtitle lane scopes to captions.
          if (!cutterMode || e.button !== 0) return
          // Let clicks on the highlighted region through so its double-click
          // (delete) works instead of dropping another mark.
          if ((e.target as HTMLElement).classList.contains('tl-cutrange')) return
          if (e.clientX - scrollRef.current!.getBoundingClientRect().left < HEADER_W) return
          e.preventDefault()
          e.stopPropagation()
          const { t } = cutterTime(e.clientX, e.altKey)
          const stack = document.elementsFromPoint(e.clientX, e.clientY)
          const trackEl = stack.find(
            (n) => n instanceof HTMLElement && n.classList.contains('tl-track')
          ) as HTMLElement | undefined
          const inCaptionLane = stack.some(
            (n) => n instanceof HTMLElement && n.classList.contains('tl-caption-lane')
          )
          const laneId = inCaptionLane ? 'captions' : (trackEl?.dataset.trackId ?? null)
          useStore.getState().addCutMark(t, laneId)
        }}
        onPointerLeave={() => {
          showGhost(null)
          setOverPlayhead(false)
        }}
        onPointerDown={(e) => {
          // Mouse side buttons pan the VIEW horizontally while held (button 3 =
          // left, button 4 = right). They deliberately leave the playhead alone:
          // moving it meant every look-around also destroyed your play position.
          if (e.button === 3 || e.button === 4) {
            e.preventDefault()
            const dir = e.button === 3 ? -1 : 1
            const speed = 900 // px of timeline per real second
            if (sideScrub.current) cancelAnimationFrame(sideScrub.current.raf)
            const state = { raf: 0, last: performance.now() }
            const step = (now: number) => {
              const dt = (now - state.last) / 1000
              state.last = now
              const el = scrollRef.current
              if (el) el.scrollLeft = Math.max(0, el.scrollLeft + dir * speed * dt)
              state.raf = requestAnimationFrame(step)
            }
            state.raf = requestAnimationFrame(step)
            sideScrub.current = state
            const stop = () => {
              if (sideScrub.current) cancelAnimationFrame(sideScrub.current.raf)
              sideScrub.current = null
              window.removeEventListener('pointerup', stop)
            }
            window.addEventListener('pointerup', stop)
            return
          }
          if (e.button !== 0) return
          const target = e.target as HTMLElement
          // The sticky track-header column owns its own controls (lock, hide,
          // mute, auto-pack, delete, height grip). Capturing the pointer here
          // would swallow their pointerup, so no click would ever fire.
          if (
            target.closest('.tl-clip') ||
            target.closest('.tl-ruler') ||
            target.closest('.tl-addtrack') ||
            target.closest('.tl-track-label')
          )
            return
          const el = scrollRef.current!
          const rect = el.getBoundingClientRect()
          // Left of the header column's right edge is the panel, not a time —
          // one screen-space test covers every part of it (track headers, the
          // add-track strips, the filler under the last row).
          if (e.clientX - rect.left < HEADER_W) return
          const x = e.clientX - rect.left + el.scrollLeft
          const y = e.clientY - rect.top + el.scrollTop
          const s = useStore.getState()
          // The playhead is also a THING you can grab: land within a few pixels
          // of it (the cursor has already changed to say so) and you drag it,
          // instead of the line being a place the pointer can only teleport to.
          const playheadX = HEADER_W + s.currentTime * s.pxPerSec
          if (Math.abs(x - playheadX) <= PLAYHEAD_GRAB_PX) {
            scrubbing.current = true
            beginScrub()
            s.setPlaying(false)
            ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
            return
          }
          // Anywhere else the press is undecided: a click seeks (unchanged), a
          // press that MOVES draws a selection box. Deciding on travel rather
          // than on the press itself is what makes holding-and-dragging a
          // marquee without the playhead jumping to the start of the drag.
          pressRef.current = { x, y }
          s.selectClip(null)
          s.selectCaptions([])
          selectTransition(null)
          ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
        }}
        onPointerMove={(e) => {
          const el = scrollRef.current!
          const rect = el.getBoundingClientRect()
          const x = e.clientX - rect.left + el.scrollLeft
          if (cutterMode) {
            const { t, snapped } = cutterTime(e.clientX, e.altKey)
            showGhost(e.clientX - rect.left < HEADER_W ? null : HEADER_W + t * useStore.getState().pxPerSec, snapped)
            return
          }
          if (splitToolMode) {
            // Split tool only previews over an actual clip.
            const overClip = !!(e.target as HTMLElement).closest('.tl-clip')
            showGhost(overClip ? x : null)
            return
          }
          if (scrubbing.current) {
            seekSnapped(Math.max(0, (x - HEADER_W) / useStore.getState().pxPerSec), e.shiftKey)
            return
          }
          const y = e.clientY - rect.top + el.scrollTop
          // An undecided press turns into a marquee the moment it travels.
          const press = pressRef.current
          if (press && !marqueeRef.current) {
            if (Math.abs(x - press.x) < DRAG_SLOP_PX && Math.abs(y - press.y) < DRAG_SLOP_PX) return
            marqueeRef.current = { x0: press.x, y0: press.y }
          }
          const start = marqueeRef.current
          if (!start) {
            // Hovering near the playhead: say so with the cursor, so it reads as
            // something you can pick up rather than a line painted on the tracks.
            // Only where the press would actually grab it — over a clip or a
            // header the press does something else, and a cursor promising a
            // drag that won't happen is worse than no cursor at all.
            const st = useStore.getState()
            const t = e.target as HTMLElement
            const grabbable =
              !t.closest('.tl-clip') && !t.closest('.tl-track-label') && !t.closest('.tl-ruler') && !t.closest('.tl-addtrack')
            const near =
              grabbable && Math.abs(x - (HEADER_W + st.currentTime * st.pxPerSec)) <= PLAYHEAD_GRAB_PX
            if (near !== overPlayhead) setOverPlayhead(near)
            return
          }
          setMarquee({ x0: start.x0, y0: start.y0, x1: x, y1: y })
          applyMarquee(start.x0, start.y0, x, y)
        }}
        onPointerUp={(e) => {
          // Released without travelling: that was a click, and a click in the
          // tracks moves the playhead there — the one thing about the old
          // behaviour worth keeping.
          if (pressRef.current && !marqueeRef.current && !scrubbing.current) {
            const t = Math.max(0, (pressRef.current.x - HEADER_W) / useStore.getState().pxPerSec)
            useStore.getState().setPlaying(false)
            seekSnapped(t, e.shiftKey)
          }
          pressRef.current = null
          scrubbing.current = false
          marqueeRef.current = null
          setMarquee(null)
          useStore.getState().setSnapGuide(null)
        }}
        onPointerCancel={() => {
          pressRef.current = null
          scrubbing.current = false
          marqueeRef.current = null
          setMarquee(null)
          useStore.getState().setSnapGuide(null)
        }}
        onDragOver={(e) => {
          // ("After" shows an agent's draft: read-only, nothing is dropped in.)
          if (after) return
          if (
            e.dataTransfer.types.includes('application/x-autocut-asset') ||
            e.dataTransfer.types.includes('application/x-autocut-assets') ||
            e.dataTransfer.types.includes('Files')
          ) {
            e.preventDefault()
            e.dataTransfer.dropEffect = 'copy'
            window.clearTimeout(binDropQuiet.current)
            binDropQuiet.current = window.setTimeout(clearBinDrop, 450)
            const s = useStore.getState()
            // The bin says what it is dragging (the drag's own data can't be
            // read before the drop); a file from the file manager is only a
            // time until it has been read.
            const ids = e.dataTransfer.types.includes('Files') ? null : draggedAssets()
            const first = ids ? dropItemsOf(s.project, ids)[0] : undefined
            const at = timelineDropAt(e.clientX, e.clientY, e.shiftKey, first?.duration ?? 0)
            // Light the "new track" strip up while a media item is over it, so
            // dropping onto a layer that doesn't exist yet is an offer you can
            // see rather than something you have to set up first.
            setBinDropNew(at?.newTrack ?? newTrackKindAt(e.clientX, e.clientY))
            if (!at) {
              setBinDrop(null)
              return
            }
            const plan = ids ? planDropAt(s.project, ids, at) : null
            const sec = plan?.anchorStart ?? at.time
            const trackName = plan
              ? s.project.tracks.find((track) => track.id === plan.anchorTrackId)?.name ??
                (plan.anchorTrackId === NEW_AUDIO_TRACK ? t('timeline.drop.newAudio') : t('timeline.drop.newVideo'))
              : null
            const rowId = plan && s.project.tracks.some((track) => track.id === plan.anchorTrackId) ? plan.anchorTrackId : at.trackId
            const rowEl = [...document.querySelectorAll<HTMLElement>('.tl-track')].find((row) => row.dataset.trackId === rowId)
            const stripEl = at.newTrack
              ? document.querySelector<HTMLElement>(`.tl-addtrack[data-new-track-kind="${at.newTrack}"]`)
              : null
            const top = rowEl?.offsetTop ?? stripEl?.offsetTop ?? 48
            const label = trackName ? t('timeline.drop.on', { track: trackName, time: fmt(sec) }) : t('timeline.drop.at', { time: fmt(sec) })
            // The guide only while the clip really lands on the edge it snapped
            // to (a packed row takes it elsewhere).
            s.setSnapGuide(at.snap && Math.abs(sec - at.time) * s.pxPerSec < 1 ? at.snap.time : null)
            setBinDrop((prev) =>
              prev && prev.sec === sec && prev.label === label && prev.top === top ? prev : { sec, label, top }
            )
          }
        }}
        onDragLeave={(e) => {
          // Moving between rows passes through their edges: only leaving the
          // timeline itself puts the indicator away.
          const into = e.relatedTarget as Node | null
          if (into && e.currentTarget.contains(into)) return
          clearBinDrop()
        }}
        onDrop={(e) => {
          if (after) return
          const multi = e.dataTransfer.getData('application/x-autocut-assets')
          const single = e.dataTransfer.getData('application/x-autocut-asset')
          clearBinDrop()
          if (!multi && !single) return
          e.preventDefault()
          e.stopPropagation()
          const s = useStore.getState()
          const ids: string[] = multi ? JSON.parse(multi) : [single]
          const first = dropItemsOf(s.project, ids)[0]
          // The same reading of the pointer as the indicator: the time under
          // it (snapped like a move, Shift for exact), the row, a "+" strip.
          // Where on that row: planMediaDrop (at that time; a busy row passes
          // the clip to the nearest free one, never moving what is there).
          const at = timelineDropAt(e.clientX, e.clientY, e.shiftKey, first?.duration ?? 0)
          if (!at) return
          s.addClipsAt(ids, at.trackId, at.time, { newTrack: at.newTrack })
        }}
      >
        <div className="tl-inner" style={{ width: totalWidth }}>
          <div
            className="tl-ruler"
            data-testid="timeline.ruler"
            onPointerDown={(e) => {
              // LEFT button only. The side buttons scroll the view, and this
              // handler moving the playhead as well meant every look-around
              // threw away the play position — the scroll code below already
              // takes care not to, but the ruler was grabbing the press first.
              if (e.button !== 0) return
              // The corner is the header column's slice of the ruler, not a
              // time — clicking it would seek to 0.
              if ((e.target as HTMLElement).classList.contains('tl-ruler-corner')) return
              // (Alt + drag, or "Range" pressed: a range for the agent.
              // KAPSAM-AJAN-PLAN.md §1.)
              if (agentOn && (e.altKey || useScopeBand.getState().armed)) {
                const el = scrollRef.current
                beginBandDrag(e, (x) => (el ? Math.max(0, (x - el.getBoundingClientRect().left + el.scrollLeft - HEADER_W) / useStore.getState().pxPerSec) : 0))
                return
              }
              scrubbing.current = true
              beginScrub()
              useStore.getState().setPlaying(false)
              seekSnapped(timeFromEvent(e), e.shiftKey)
              ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
            }}
            onPointerMove={(e) => scrubbing.current && seekSnapped(timeFromEvent(e), e.shiftKey)}
            onPointerUp={() => {
              scrubbing.current = false
              useStore.getState().setSnapGuide(null)
            }}
          >
            <div className="tl-ruler-corner" />
            <PlayheadHead pxPerSec={pxPerSec} />
            <RulerTicks duration={duration} pxPerSec={pxPerSec} fps={fps} />
            <RulerMarks />
            <AgentRulerMarks pxPerSec={pxPerSec} />
            {agentOn && <ScopeRulerMark pxPerSec={pxPerSec} />}
          </div>
          <AgentTrail pxPerSec={pxPerSec} />
          {/* Work notes (SnippStudio phase 1): under the ruler, while agent
              access is on (DENEME-2, the user's decision: notes are for the
              agent; off, the lane is not shown and the notes are kept). */}
          {agentOn && <NoteLane seek={(time, exact) => seekSnapped(time, exact)} scrubbingRef={scrubbing} />}
          <CaptionLanes />
          <TemplateLane />
          <AddTrackStrip kind="video" binDropNew={binDropNew} seek={addTrackSeek} />
          {tracks.map((track, ti) => (
            <TrackRow key={track.id} track={track} after={after} firstAudio={track.kind === 'audio' && tracks[ti - 1]?.kind === 'video'} emptyFirst={empty && track.id === tracks.find((x) => x.kind === 'video')?.id} />
          ))}
          <AddTrackStrip kind="audio" binDropNew={binDropNew} seek={addTrackSeek} />
          {/* Grows into whatever height is left under the last track, carrying
              the header column down with it. Without it the column stopped at
              the bottom row and the playhead reappeared in the empty strip
              below — the panel has to be one solid edge from the ruler to the
              bottom of the timeline, or there is always some zoom level where
              the line shows up beside the track names. */}
          <div className="tl-tailfill">
            <div className="tl-tailhead" />
          </div>
          {/* The marks over the lanes share one layer (timeline.css): they
              are drawn in this order, the loop band and the Shorts bands
              first, the playhead and the marquee last. */}
          <LoopBand />
          {agentOn && <ScopeBand pxPerSec={pxPerSec} />}
          <ShortSegments />
          <ExportMarks />
          <CutMarks />
          {(cutterMode || splitToolMode) && <div ref={ghostRef} className={`tl-cutmark ghost${splitToolMode ? ' split' : ''}`} style={{ display: 'none' }} />}
          <DropIndicator binDrop={binDrop} />
          <RangePreview />
          <SnapGuide />
          <TrimTip />
          {/* The agent's draft and activity (phase 4B.4): its own subscriptions. */}
          <AgentTimelineLayer pxPerSec={pxPerSec} />
          <Playhead
            pxPerSec={pxPerSec}
            playing={playing}
            follow={followPlayhead}
            scrollRef={scrollRef}
            scrubbingRef={scrubbing}
          />
          {marquee && (
            <div
              className="tl-marquee"
              style={{
                left: Math.min(marquee.x0, marquee.x1),
                top: Math.min(marquee.y0, marquee.y1),
                width: Math.abs(marquee.x1 - marquee.x0),
                height: Math.abs(marquee.y1 - marquee.y0)
              }}
            />
          )}
        </div>
      </div>
    </div>
  )
}
