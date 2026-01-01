// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// A clip on the timeline (ClipBlock: its drag, trim, menu, fades, keyframes and
// motion button) and a track's visible clips (TrackClips). Moved out of
// Timeline.tsx in SnippStudio phase 2B (no change; the same subscriptions).
import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { hasLook, LOOK_PRESETS, lookName } from '../../effects/look'
import { lookShown, moveName } from '../../ui/data-names'
import { LiveBadge } from './LiveBadge'
import { useStore } from '../../state/store'
import { engine } from '../../playback/engine'
import { cancelScrub, requestFrame } from '../../playback/scrub'
import { useViewport } from '../../playback/viewport'
import { importReplacementImage } from '../../media/import'
import { planTimelinePlacement } from '../../timeline/placement'
import { automationOf } from '../../timeline/slice'
import { trimBaseOf } from '../../commands/clips'
import { tellLockedPartner } from '../../state/slices/cutting'
import { notify } from '../../ui/toast-core'
import { Button, Icon, Segmented, type MenuItem } from '../../ui'
import { t } from '../../ui/strings'
import { addModHeld } from '../../os-platform'
import { clipPressSelection, findDragSnap, type DragSnapTarget } from '../../timeline/snapping'
import { Filmstrip } from '../Filmstrip'
import { Waveform } from '../Waveform'
import { FloatingMenu } from '../FloatingMenu'
import type { Clip, ClipAnim, IdleStyle, Track } from '../../types'
import { assetById, CLIP_ANIMS, IDLE_STYLES, uid } from '../../types'
import type { KeyDrag } from '../../timeline/key-drag'
import { joinedEdges, quietNames, keyframeGroups, keysOffClip, motionMarks, volumeKeyMarks, HEADER_W, fmt, snapEdgeTime, assetIn, idIn, nearWindow, VIEW_STEP_PX } from './shared'
import { cutReach } from '../../timeline/junction-box'

/** The kind's icon in the clip's name chip (v3). */
const KIND_ICON = { video: 'video', image: 'image', audio: 'audio-waveform', code: 'code' } as const
import { trimDelta } from '../../timeline/view-math'
import { gestureMemo, settle, startDrag, type DragPoint } from './drag'
import { useTimelineView } from './view-state'
import type { TrimDrag } from './shared'
import { CodeClipActivity } from './CodeClipActivity'
import { curveBadge, curveBadgeShown, curveLinePath } from '../../timeline/curve-line'
import { BareButton } from '../../ui/Button'
import { animName, idleName } from '../inspector/motion-names'
import { useAgentOn } from '../agent/useAgentShown'
import { agentMenuItems } from '../agent/clip-agent-menu'
import { labelMenuItems, labelToken } from './clip-label-menu'

/** Between a transition's block and the clip's top row (px). */
const CLIP_TOP_GAP = 4

/** The speed curve's line under a clip: its height (px). */
const CURVE_LINE_H = 10

// Memoized so an unrelated Timeline re-render (selection, a sibling clip
// moving) doesn't reconcile every clip. Immer keeps unchanged clip objects
// referentially stable, so memo skips them.
export const ClipBlock = memo(ClipBlockInner)

/** A clip narrower than this (px) has no room for a name pill: none is drawn (okunur). */
const NAME_MIN_W = 56

const NO_IDS: string[] = []

/**
 * A track's clip blocks, only those in or near the visible part of the
 * timeline (a screen to either side), plus any selected or being dragged
 * (a drag holds its block's pointer). A long silence-cut timeline mounted
 * every one of its clips, each with its own store subscriptions, all run on
 * every frame of playback.
 */
export const TrackClips = memo(function TrackClips({ track, clips }: { track: Track; clips: Clip[] }): JSX.Element {
  // The view in steps of 160 px (phase 3c.T; it was 32): a scroll goes
  // through this list a few times a screen and brings in a few blocks each
  // time. The window is a screen to either side of the view.
  const width = useViewport((v) => v.width)
  const { lo, hi } = nearWindow(useViewport((v) => Math.floor(v.left / VIEW_STEP_PX)), width)
  const px = useStore((st) => st.pxPerSec)
  const selected = useStore((st) => st.selectedClipIds)
  // (The ids' own arrays, the same until the dragged set changes: a drag's
  // step is not a reason to go through the lane's clips again.)
  const dragIds = useStore(useShallow((st) => st.dragPreview?.ids ?? NO_IDS))
  const linkedIds = useStore(useShallow((st) => st.dragPreview?.linked ?? NO_IDS))
  const joins = useMemo(() => joinedEdges(clips), [clips])
  // Which pieces of a cut-up run rest their name (okunur): on the clip list
  // only, never per frame or per scrub step.
  const quiet = useMemo(() => quietNames(clips), [clips])
  // How far a transition's block reaches into each clip of its cut (22
  // November, L8): the clip's top row keeps clear of it. (The project read
  // here is the one `clips` came from: a transition lives on its clip.)
  const reach = useMemo(() => cutReach(useStore.getState().project, clips, px), [clips, px])
  return (
    <>
      {clips
        .filter((c) => {
          const x0 = HEADER_W + c.start * px
          const x1 = HEADER_W + (c.start + c.duration) * px
          return (x1 >= lo && x0 <= hi) || idIn(selected, c.id) || dragIds.includes(c.id) || linkedIds.includes(c.id)
        })
        .map((clip) => (
          <ClipBlock key={clip.id} clip={clip} track={track} joinL={joins.left.has(clip.id)} joinR={joins.right.has(clip.id)} quiet={quiet.has(clip.id)} padL={reach.get(clip.id)?.left ?? 0} padR={reach.get(clip.id)?.right ?? 0} />
        ))}
    </>
  )
})


export function ClipBlockInner({ clip, track, joinL = false, joinR = false, quiet = false, padL = 0, padR = 0 }: { clip: Clip; track: Track; joinL?: boolean; joinR?: boolean; /** A later piece of a run cut from one source: its name pill rests (shown on hover and when selected). */ quiet?: boolean; /** A transition's block over this clip's start / end reaches this far in (px). */ padL?: number; padR?: number }): JSX.Element | null {
  const pxPerSec = useStore((s) => s.pxPerSec)
  const offKeys = keysOffClip(clip)
  const marks = motionMarks(clip)
  const selected = useStore((s) => idIn(s.selectedClipIds, clip.id))
  const linkAV = useStore((s) => s.linkAV)
  const asset = useStore((s) => assetIn(s.project.assets, clip.assetId))
  // Select the stable array reference; filter in render (a filtering selector
  // would return a fresh array every snapshot and trip React's loop guard).
  const silencePreview = useStore((s) => s.silencePreview)
  // Red marks go on every clip that will actually be cut — the selection — and
  // are clipped to each one, so a video and its audio both show what's coming.
  // (Matching on region.clipId alone showed it only on the clip that was
  // listened to; matching on overlap alone marked clips nobody asked to cut.)
  const inSelection = useStore((s) => idIn(s.selectedClipIds, clip.id))
  const silenceRegions =
    inSelection || silencePreview?.some((r) => r.clipId === clip.id)
      ? silencePreview
          ?.filter((r) => r.clipId === clip.id && r.end > clip.start && r.start < clip.start + clip.duration)
          .map((r) => ({
            ...r,
            start: Math.max(r.start, clip.start),
            end: Math.min(r.end, clip.start + clip.duration)
          }))
      : undefined
  const dragRef = useRef<TrimDrag | null>(null)
  // While an edge is dragged, its label (where it is, how long the clip is
  // now) is drawn beside the edge, over the lanes (timeline/overlays.tsx).
  const setTrimTip = (trimTip: { time: number; top: number; side: 'l' | 'r'; text: string } | null): void => useTimelineView.setState({ trimTip })
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null)
  // (Its "For the agent" menu, opened where the first one was: KAPSAM-AJAN-PLAN.md §6.)
  const [agentMenu, setAgentMenu] = useState<{ x: number; y: number; ids: string[] } | null>(null)
  // The labels' second menu (KOLAY-PLAN.md, item 3: clip-label-menu.ts).
  const [labelMenu, setLabelMenu] = useState<{ x: number; y: number; ids: string[] } | null>(null)
  const agentOn = useAgentOn()
  const [kfMenu, setKfMenu] = useState<{ x: number; y: number; time: number } | null>(null)
  // Select only this clip's preview fields. With dozens of stills on a track,
  // subscribing every ClipBlock to the whole drag object made every pointer
  // move redraw every filmstrip and waveform.
  // Where the pointer has it (DENEME-3, V item 4): only the dragged clips and
  // their partners move during a drag (the landing is a ghost,
  // drop-ghost.tsx). Every step moves them, so the offset is written onto the
  // block's `translate` directly, not through a render of this block.
  const rootRef = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    const follow = (s: ReturnType<typeof useStore.getState>): void => {
      const el = rootRef.current
      if (!el) return
      const at = s.dragPreview?.follow?.[clip.id]
      const v = at === undefined || Math.abs(at - clip.start) < 1e-9 ? '' : `${(at - clip.start) * s.pxPerSec}px 0px`
      if (el.style.translate !== v) el.style.translate = v
    }
    follow(useStore.getState())
    return useStore.subscribe(follow)
  }, [clip.id, clip.start])
  const inDrag = useStore((s) => s.dragPreview?.ids.includes(clip.id) ?? false)
  const inLinked = useStore((s) => s.dragPreview?.linked?.includes(clip.id) ?? false)
  const snapSource = useStore((s) => s.dragPreview?.snapTarget?.clipId === clip.id)
  const invalidDrag = useStore((s) => !!s.dragPreview?.invalidReason && (s.dragPreview?.ids.includes(clip.id) ?? false))
  const previewDy = useStore((s) => s.dragPreview?.verticalOffsets[clip.id] ?? 0)

  // Close the keyframe context menu on any outside press.
  useEffect(() => {
    if (!kfMenu) return
    const close = (e: PointerEvent): void => {
      if (!(e.target as HTMLElement).closest('.ui-menu-layer')) setKfMenu(null)
    }
    window.addEventListener('pointerdown', close)
    return () => window.removeEventListener('pointerdown', close)
  }, [kfMenu])

  // Adjustment layers carry no media, but still drag, trim and keyframe like
  // any other clip — so only the media-dependent chrome is skipped below.
  if (!asset && !clip.adjustment && !clip.nested && !clip.automationMissing) return null

  const onPointerDown = (rawKind: TrimDrag['kind']) => (e: React.PointerEvent) => {
    e.stopPropagation()
    if (e.button !== 0 || track.locked) return
    const s = useStore.getState()
    // With the slip tool on, a press on the clip BODY slides the media inside
    // it. The trim handles keep their own job — slipping and trimming are the
    // two halves of fixing a cut and you want both without swapping tools.
    const kind: TrimDrag['kind'] = rawKind === 'move' && s.slipToolMode ? 'slip' : rawKind
    // What Escape puts back (timeline/drag.ts): taken before an Alt + drag's
    // copies are made (they go too), else after the press has selected.
    let memo = gestureMemo()
    // The undo snapshot is taken at the first real CHANGE, not here: a plain
    // click on a clip used to push an entry that undid nothing, so the first
    // Ctrl+Z after selecting something appeared to do nothing at all. Alt+drag
    // is the exception — it duplicates immediately, so it snapshots first.
    let gestureBegun = false
    // Alt+drag on a clip body: duplicate it (and the selection) in place, then
    // drag the copies — the originals stay put.
    let dragClipId = clip.id
    if (kind === 'move' && e.altKey) {
      // Snapshot BEFORE the duplication so a single undo reverts copy + move.
      s.beginGesture()
      gestureBegun = true
      if (!s.selectedClipIds.includes(clip.id)) s.selectClip(clip.id)
      const srcIds = useStore.getState().selectedClipIds
      const copies = s.duplicateClipsInPlace(srcIds)
      const idx = srcIds.indexOf(clip.id)
      dragClipId = copies[idx] || clip.id
      s.selectClips(copies.filter(Boolean))
    }
    // Ctrl/Shift on a selected clip used to let go of it on the press, so a
    // Shift-trim or a Shift-drag (no snapping) deselected the very clip it was
    // working on: now a click lets go of it on release, a drag keeps it.
    const press = clipPressSelection({ selected: s.selectedClipIds.includes(clip.id), additive: addModHeld(e) || e.shiftKey, copying: kind === 'move' && e.altKey, kind })
    if (press.now !== 'keep') s.selectClip(clip.id, press.now === 'add')
    const toggleOnClick = press.onClick === 'toggle-off'
    if (!gestureBegun) memo = gestureMemo()
    // Read fresh state: an Alt+drag just created the copies, so the old `s`
    // snapshot doesn't contain them — building groupStarts off it would leave
    // it empty and no drag ghost would render (only the cursor moved).
    const fresh = useStore.getState()
    const groupStarts = new Map<string, number>()
    for (const id of fresh.selectedClipIds) {
      const c = fresh.project.clips[id]
      if (c) groupStarts.set(id, c.start)
    }
    const dragClip = fresh.project.clips[dragClipId]
    const drag: TrimDrag = {
      kind,
      clipId: dragClipId,
      startX: e.clientX,
      startY: e.clientY,
      origStart: dragClip?.start ?? clip.start,
      origEnd: (dragClip?.start ?? clip.start) + (dragClip?.duration ?? clip.duration),
      base: {
        start: dragClip?.start ?? clip.start,
        inPoint: dragClip?.inPoint ?? clip.inPoint,
        duration: dragClip?.duration ?? clip.duration,
        // Its keys as the drag found them: a head trim cuts them from these.
        ...(kind === 'trim-l' ? { automation: automationOf(dragClip ?? clip) } : {}),
        // …and its slow push or pan (phase Ç2c.2, report K14).
        ...(kind === 'trim-l' && (dragClip ?? clip).motionFx ? { motionFx: structuredClone((dragClip ?? clip).motionFx!) } : {}),
        // Its linked partners as they were: they get the same edge change.
        ...(kind === 'trim-l' ? { partners: trimBaseOf(dragClip ?? clip, fresh.project).partners } : {})
      },
      alone: kind !== 'move' && e.altKey,
      startScroll: 0,
      rowTop: ((e.currentTarget as HTMLElement).closest('.tl-track') as HTMLElement | null)?.offsetTop ?? 0,
      gestureBegun,
      duplicated: kind === 'move' && e.altKey,
      groupStarts,
      // Every drag begins once the pointer has travelled 4 px (timeline/drag.ts):
      // a click on a clip or on its edge changes nothing.
      started: false,
      toggleOnClick,
      // Trimming previews the frame at the dragged edge; the playhead
      // returns here on release so editing stays fast.
      prevTime: kind !== 'move' ? s.currentTime : undefined
    }
    dragRef.current = drag
    startDrag(e, {
      // Dragging to the edge scrolls the timeline instead of stopping dead
      // there. MOVES only: a trim handle lives right next to the track header,
      // so the pointer sits in the left margin for most of the gesture —
      // auto-scrolling there made the whole view (and the frame under the
      // edge) creep sideways on its own. A trim never needs to reach
      // off-screen material anyway.
      edgeScroll: kind === 'move',
      onStart: () => {
        drag.started = true
        if (kind === 'move' && !drag.gestureBegun) {
          drag.gestureBegun = true
          useStore.getState().armGesture()
        }
      },
      onMove: (p) => dragStep(drag, p),
      onEnd: () => dragRelease(drag, memo),
      onCancel: () => dragCancel(drag, memo)
    })
  }

  /** One step of the drag: the newest pointer position, once per frame.
   *  `p.dx` already holds whatever the view scrolled meanwhile (edge
   *  scrolling, the wheel), so the dragged edge stays under the pointer. */
  const dragStep = (drag: TrimDrag, p: DragPoint): void => {
    if (dragRef.current !== drag) return
    const s = useStore.getState()
    const deltaSec = p.dx / s.pxPerSec

    if (drag.kind === 'move') {
      // Ghost drag: nothing in the project mutates until pointer-up — the
      // preview offset lives in cheap UI state, so dragging stays smooth.
      let newStart = Math.max(0, drag.origStart + deltaSec)
      const cur = s.project.clips[drag.clipId]
      if (!cur) return
      // The lanes and the "+" strips where they are now: read once per step,
      // before anything is written (the old code asked the page three times a
      // pointer move, between its writes).
      const rows: { el: HTMLElement; top: number; bottom: number }[] = []
      for (const el of document.querySelectorAll<HTMLElement>('.tl-track, .tl-addtrack')) {
        const b = el.getBoundingClientRect()
        rows.push({ el, top: b.top, bottom: b.bottom })
      }
      const under = (cls: string): HTMLElement | undefined => rows.find((r) => r.el.classList.contains(cls) && p.clientY >= r.top && p.clientY < r.bottom)?.el
      // Cross-track target: highlighted live, applied on drop. Works for
      // multi-selections too — the whole group moves to the hovered track.
      let targetTrackId: string | null = null
      let newTrack: 'video' | 'audio' | null = null
      let invalidReason: string | null = null
      let hoveredTrackId: string | null = null
      {
        // A lifted clip can cover another row while retaining its original
        // DOM parent. Hit-testing the painted stack then reports that parent
        // instead of the row beneath the pointer, making cross-track drops
        // feel as though they missed. Row bounds are the stable drop target.
        const rowEl = under('tl-track')
        const curTrack = s.project.tracks.find((t) => t.id === cur.trackId)
        const target = rowEl?.dataset.trackId
          ? s.project.tracks.find((t) => t.id === rowEl.dataset.trackId)
          : undefined
        hoveredTrackId = target?.id ?? null
        const kindKey = curTrack?.kind === 'audio' ? 'audio' : 'video'
        if (target) {
          if (target.locked) invalidReason = t('clip.drop.locked', { track: target.name })
          else if (target.kind !== curTrack?.kind) invalidReason = t(`clip.drop.kind.${kindKey}`)
          else if (target.id !== curTrack.id) targetTrackId = target.id
        }
        // Only the explicit + strip creates a track. Previously *anywhere*
        // above the first video row, including subtitle chips, counted as a
        // new video layer and a released clip seemed to vanish.
        if (!target && drag.groupStarts.size === 1) {
          const zone = under('tl-addtrack')
          if (curTrack && zone?.dataset.newTrackKind === curTrack.kind) newTrack = curTrack.kind
        }
        if (!target && !newTrack) invalidReason = t(`clip.drop.strip.${kindKey}`)
      }
      // Image cuts are the strongest snap targets while placing an image on a
      // video row. Subtitle cuts still work when no visual edge is nearby.
      const snap = !p.shiftKey && !invalidReason
        ? findDragSnap(s.project, newStart, cur.duration, s.pxPerSec,
            targetTrackId ?? cur.trackId, new Set(drag.groupStarts.keys()), s.currentTime)
        : null
      if (snap) newStart = snap.start
      // The same landing as the last step (the pointer moved inside a snap, or
      // up and down inside a lane): nothing new to plan or to draw.
      const stepKey = `${newStart.toFixed(4)}|${targetTrackId}|${newTrack}|${hoveredTrackId}|${invalidReason}|${snap ? `${snap.target.time}${snap.movingEdge}` : ''}|${newTrack ? Math.round(p.dy) : ''}`
      if (drag.lastStep === stepKey && s.dragPreview) return
      drag.lastStep = stepKey
      // The live ghost and the committed edit share one placement calculation.
      const draggedIds = [...drag.groupStarts.keys()]
      const placement = planTimelinePlacement(
        s.project,
        drag.clipId,
        draggedIds,
        newStart - drag.origStart,
        targetTrackId,
        newTrack,
        s.linkAV,
        // Trades places with a neighbour only past its middle (DENEME-3, V 3).
        { insert: 'middle' }
      )
      if (!placement) {
        s.setSnapGuide(null)
        s.setDragPreview(null)
        return
      }
      const snapSourceClip = snap?.target.clipId ? s.project.clips[snap.target.clipId] : null
      const snapSourcePosition = snapSourceClip ? placement.positions[snapSourceClip.id] : null
      // An insertion may ripple the former snap source. In that case the old
      // edge is no longer a real alignment target, so do not label it as one.
      const sourceStillAtEdge = !snapSourceClip || !snapSourcePosition ||
        Math.abs(snapSourcePosition.start - snapSourceClip.start) * s.pxPerSec < 1
      const snapTarget: DragSnapTarget | null = !invalidReason && snap && sourceStillAtEdge &&
        Math.abs(placement.anchorStart + (snap.movingEdge === 'end' ? cur.duration : 0) - snap.target.time) * s.pxPerSec < 1
        ? snap.target : null
      s.setSnapGuide(snapTarget?.time ?? null)
      const previewPositions = invalidReason
        ? {
            ...placement.positions,
            ...Object.fromEntries(draggedIds.map((id) => {
              const original = s.project.clips[id]
              return [id, {
                start: Math.max(0, original.start + newStart - drag.origStart),
                trackId: hoveredTrackId ?? placement.anchorTrackId
              }]
            }))
          }
        : placement.positions
      const trackRows = rows.filter((r) => r.el.classList.contains('tl-track'))
      const rowTops = new Map(trackRows.map((r) => [r.el.dataset.trackId ?? '', r.top]))
      const dropLabelTop = trackRows.find((r) => r.el.dataset.trackId === (hoveredTrackId ?? placement.anchorTrackId))?.el.offsetTop ?? 48
      const snapCaption = snapTarget?.captionId
        ? s.project.captions.find((caption) => caption.id === snapTarget.captionId)
        : undefined
      const snapLabelTop = snapTarget?.trackId
        ? trackRows.find((r) => r.el.dataset.trackId === snapTarget.trackId)?.el.offsetTop
        : snapCaption
          ? [...document.querySelectorAll<HTMLElement>('.tl-caption-lane')]
              .find((row) => Number(row.dataset.captionLayer) === (snapCaption.layer ?? 0))?.offsetTop
          : undefined
      const verticalOffsets: Record<string, number> = {}
      for (const id of draggedIds) {
        const original = s.project.clips[id]
        const planned = previewPositions[id]
        if (!original || !planned) continue
        const sourceTop = rowTops.get(original.trackId)
        const targetTop = rowTops.get(planned.trackId)
        verticalOffsets[id] = targetTop !== undefined && sourceTop !== undefined
          ? targetTop - sourceTop
          : placement.newTrack && id === drag.clipId
            ? p.dy
            : 0
      }
      // The dragged clips (and the partners they take along) follow the
      // pointer; where they land, and where the clips they push go, is drawn
      // as a ghost (drop-ghost.tsx). DENEME-3, V item 4: they used to jump to
      // the landing, and the clips pushed to theirs, at every step.
      const follow: Record<string, number> = {}
      {
        const ids = new Set(draggedIds)
        if (s.linkAV) for (const id of draggedIds) for (const o of placement.movedIds) if (o !== id && s.project.clips[o]?.linkId && s.project.clips[o].linkId === s.project.clips[id]?.linkId) ids.add(o)
        let delta = newStart - drag.origStart
        for (const id of ids) delta = Math.max(delta, -(s.project.clips[id]?.start ?? 0))
        for (const id of ids) if (s.project.clips[id]) follow[id] = s.project.clips[id].start + delta
      }
      s.setDragPreview({
        ids: draggedIds,
        // (The partners riding along: lifted with the dragged clips.)
        linked: Object.keys(follow).filter((id) => !drag.groupStarts.has(id)),
        follow,
        targetTrackId: hoveredTrackId,
        dropSec: invalidReason ? newStart : placement.anchorStart,
        dropTrackId: newTrack ? null : hoveredTrackId ?? placement.anchorTrackId,
        positions: previewPositions,
        verticalOffsets,
        placement,
        newTrack: placement.newTrack,
        snapTarget,
        invalidReason,
        dropLabelTop,
        snapLabelTop
      })
    } else if (drag.kind === 'slip') {
      // Dragging RIGHT should reveal LATER media, which means the in point goes
      // the other way — the picture slides under the window like film through a
      // gate. One gesture, one undo step.
      // Nothing to slide through in a still, an adjustment layer or a compound
      // clip — and beginning the gesture anyway would leave an undo step that
      // undoes nothing.
      const slipClip = s.project.clips[drag.clipId]
      const slipAsset = slipClip ? assetById(s.project, slipClip.assetId) : undefined
      if (!slipAsset || slipAsset.kind === 'image') return
      if (!drag.gestureBegun) {
        drag.gestureBegun = true
        s.beginGesture()
      }
      s.slipClip(drag.clipId, -deltaSec, drag.base.inPoint)
      // Show the frame that is now at the cut, so you can see what you picked.
      const cur = s.project.clips[drag.clipId]
      if (cur) s.setTime(cur.start + 0.001)
    } else {
      // Trim: work in absolute edge time so the edge can snap to other clips
      // (on any track, audio included), captions, segment bands, the
      // playhead and 0 — the same targets a move snaps to. Shift bypasses.
      const cur = s.project.clips[drag.clipId]
      if (!cur) return
      const left = drag.kind === 'trim-l'
      let desired = Math.max(0, (left ? drag.origStart : drag.origEnd) + deltaSec)
      if (!p.shiftKey) {
        // NOT the live playhead: a trim drags the playhead along with the edge to
        // preview the frame there, so including it made the edge snap to its own
        // previous position — a 12 px dead zone that made trimming feel sticky.
        // The playhead as it was BEFORE the drag is still a target.
        const tol = 12 / s.pxPerSec
        let snapped = snapEdgeTime(s, desired, drag.clipId, tol, undefined, false)
        if (
          drag.prevTime !== undefined &&
          Math.abs(desired - drag.prevTime) <= tol &&
          (snapped === desired || Math.abs(desired - drag.prevTime) < Math.abs(desired - snapped))
        ) {
          snapped = drag.prevTime
        }
        s.setSnapGuide(snapped === desired ? null : snapped)
        desired = snapped
      } else {
        s.setSnapGuide(null)
      }
      // Sub-pixel repeats would just churn the store and the decoder.
      if (drag.lastEdge !== undefined && Math.abs(desired - drag.lastEdge) * s.pxPerSec < 1) return
      drag.lastEdge = desired
      if (!drag.gestureBegun) {
        drag.gestureBegun = true
        s.beginGesture()
      }
      if (left) {
        // Absolute, against the shape the clip had when the drag started: the
        // head edge can stop moving (blocked by the previous clip) while the
        // drag continues, so a running delta would keep re-applying itself.
        s.setClipHead(drag.clipId, desired, drag.base, drag.alone)
      } else {
        s.trimClipEnd(drag.clipId, desired - (cur.start + cur.duration), drag.alone)
      }
      // Preview the frame at the dragged edge.
      const c = useStore.getState().project.clips[drag.clipId]
      if (c) {
        const edge = left ? c.start : c.start + c.duration
        const moved = trimDelta(edge - (left ? drag.origStart : drag.origEnd))
        setTrimTip({ time: edge, top: drag.rowTop ?? 0, side: left ? 'l' : 'r', text: t(left ? 'clip.trim.tip.in' : 'clip.trim.tip.out', { time: fmt(edge), sign: moved.sign, delta: moved.abs, length: c.duration.toFixed(2) }) })
        s.setTime(left ? c.start + 0.001 : Math.max(c.start, c.start + c.duration - 0.04))
        scrubTrimFrame(c, left ? 'l' : 'r')
      }
    }
  }

  /** Pull the exact frame at the trim edge from the decoder (fast + precise). */
  const scrubTrimFrame = (clip: Clip, edge: 'l' | 'r'): void => {
    const asset = assetById(useStore.getState().project, clip.assetId)
    if (!asset || asset.kind !== 'video' || asset.missing) return
    const speed = clip.speed ?? 1
    const local =
      edge === 'l' ? clip.inPoint : clip.inPoint + Math.max(0, clip.duration * speed - 0.04)
    requestFrame(asset, local, (frame) => {
      if (dragRef.current?.clipId === clip.id) engine.setScrubFrame(clip.id, frame)
    })
  }

  /** The pointer was released (the drag's last step has run at that point). */
  const dragRelease = (drag: TrimDrag, memo: { restore: () => void }): void => {
    if (dragRef.current !== drag) return
    dragRef.current = null
    setTrimTip(null)
    const s = useStore.getState()
    s.setSnapGuide(null)
    // Trim finished: drop the decoder scrub overrides and jump the playhead
    // back to where it was.
    if (drag.kind !== 'move') {
      cancelScrub()
      engine.clearScrub()
      if (drag.prevTime !== undefined) s.setTime(drag.prevTime)
    }
    // A Ctrl/Shift click (no drag) on a selected clip lets go of it.
    if (drag.kind === 'move' && !drag.started && drag.toggleOnClick) s.selectClip(drag.clipId, true)
    if (drag.kind === 'move' && drag.started) {
      // Commit exactly the positions shown by the ghost. The old cascade
      // could move the clip far from the pointer when it overlapped a neighbour.
      const preview = s.dragPreview
      s.setDragPreview(null)
      if (preview && !preview.invalidReason) s.applyTimelinePlacement(preview.placement)
      // Alt-drag creates a temporary copy at pointer-down. A rejected drop
      // must also remove that copy instead of leaving it on the source track
      // (taken back while its window is open: phase Ç2a.1, the window's model
      // check never sees the copy on its original).
      if ((!preview || preview.invalidReason) && drag.duplicated) memo.restore()
      else s.endGesture()
      if (preview?.invalidReason) notify({ text: preview.invalidReason, kind: 'error' })
      // No plan at all: a partner a lock holds, or one with no room (phase
      // Ç2b.1, decisions 2 and 3) — said, not silently nothing.
      else if (!preview && !tellLockedPartner(s.project, [drag.clipId], s.linkAV) && s.linkAV && s.project.clips[drag.clipId]?.linkId) notify({ text: t('link.moveRefused'), kind: 'info' })
    } else {
      s.setDragPreview(null)
      // An Alt+press released without a drag made a copy on top of its
      // original, invisible, sounding twice (phase Ç2a.1, report P2): taken back.
      if (drag.kind === 'move' && drag.duplicated) memo.restore()
    }
  }

  /** Escape, a cancelled pointer, the window losing focus: the drag never
   *  happened. The ghost glides home (120 ms), a trim's or a slip's edits
   *  and an Alt + drag's copies are taken back, and no undo step is left. */
  const dragCancel = (drag: TrimDrag, memo: { restore: () => void }): void => {
    if (dragRef.current !== drag) return
    dragRef.current = null
    setTrimTip(null)
    const s = useStore.getState()
    settle()
    s.setDragPreview(null)
    s.setSnapGuide(null)
    if (drag.kind !== 'move') {
      cancelScrub()
      engine.clearScrub()
    }
    memo.restore()
  }

  const inPreview = inDrag || inLinked
  // Only the clip under the pointer lifts vertically; linked partners and
  // displaced neighbours follow their planned timeline positions horizontally.
  // (A drag's ghost is an offset on top of where the clip is: a transform,
  // which is only composited again, not a new `left`, which lays the lane
  // out again on every step. Phase 3c.T.)
  const left = HEADER_W + clip.start * pxPerSec
  const width = Math.max(8, clip.duration * pxPerSec)
  // A speed curve's range and line (core polish T). Read from the clip only:
  // the same object until it changes.
  const curveSpan = curveBadge(clip)
  const curveLine = curveSpan ? curveLinePath(clip, width, CURVE_LINE_H) : null
  // (A flat curve: no range to show; its one speed takes the plain badge.)
  const curved = curveBadgeShown(curveSpan) ? curveSpan : null
  // Drawn exactly where it lies (DENEME-1, item 3): the old 2 px inset left
  // a channel of lane between touching clips that read as a gap of time. Two
  // touching clips now meet with a seam: each one's edge ring, drawn above its
  // thumbnail (timeline.css, .tl-clip::before), and square corners there
  // (join-l / join-r), so a row of jump cuts still reads as separate pieces.
  const drawLeft = left
  const drawWidth = Math.max(5, width)
  // Linked video/audio: marked so a pair is recognisable at a glance instead of
  // being something you find out about by dragging one of them.
  const linked = !!clip.linkId && linkAV
  const cls = `tl-clip ${clip.automationMissing ? 'missing-image' : asset ? asset.kind : clip.nested ? 'compound' : 'adjustment'}${selected ? ' selected' : ''}${inPreview ? ' dragging' : ''}${invalidDrag ? ' invalid-drop' : ''}${snapSource ? ' snap-source' : ''}${clip.disabled ? ' disabled' : ''}${width < 26 ? ' tight' : ''}${width < NAME_MIN_W ? ' narrow' : ''}${quiet ? ' quiet' : ''}${linked ? ' linked' : ''}${joinL ? ' join-l' : ''}${joinR ? ' join-r' : ''}`
  const hasAudio = !!asset && (asset.kind === 'audio' || (asset.hasAudio && !clip.audioExtracted))
  // The motion shortcut: on a clip with a picture, wide enough to aim at.
  const motionButtons = (track.kind === 'video' || !!clip.adjustment || !!clip.nested) && !track.locked && clip.duration * pxPerSec >= 44

  const chooseImage = async (fillMissing: boolean): Promise<void> => {
    setMenu(null)
    const result = await importReplacementImage().catch((error: unknown) => ({
      assets: [],
      errors: [error instanceof Error ? error.message : String(error)]
    }))
    const replacement = result.assets[0]
    // An empty result is the normal Cancel path; do not turn it into an error.
    if (!replacement) {
      if (result.errors.length > 0) notify({ text: t('clip.image.openFailed', { why: result.errors.join(' · ') }), kind: 'error' })
      return
    }
    const saved = fillMissing
      ? useStore.getState().fillAutomationMissingImage(clip.id, replacement)
      : useStore.getState().replaceImageClip(clip.id, replacement)
    if (!saved) {
      notify({ text: t('clip.image.placeFailed'), kind: 'error' })
    }
  }
  const replaceImage = (): Promise<void> => chooseImage(false)
  const fillMissingImage = (): Promise<void> => chooseImage(true)

  /** The rows of the clip's menu (right-click). */
  const clipMenuItems = (): MenuItem[] => {
    const st = useStore.getState()
    const mine = (): string[] => {
      const now = useStore.getState()
      return now.selectedClipIds.includes(clip.id) ? now.selectedClipIds : [clip.id]
    }
    const toMotion = (): void => {
      const now = useStore.getState()
      now.selectClip(clip.id)
      now.focusInspector('motion')
    }
    const items: MenuItem[] = []
    if (clip.automationMissing) items.push({ id: 'fill', label: t('clip.menu.addImage', { n: clip.automationMissing.number }), icon: 'image', onSelect: () => void fillMissingImage() })
    if (asset?.kind === 'image') items.push({ id: 'replace', label: t('clip.menu.replaceImage'), icon: 'image', hint: t('clip.menu.replaceImage.hint'), onSelect: () => void replaceImage() })
    // Jump straight to the Motion controls in the inspector — much faster
    // than hunting for the panel on every clip.
    if (!clip.automationMissing && (track.kind === 'video' || clip.adjustment || clip.nested)) {
      items.push(
        { id: 'anim-in', label: t('clip.menu.animIn'), icon: 'sparkles', separatorBefore: items.length > 0, onSelect: toMotion },
        { id: 'anim-out', label: t('clip.menu.animOut'), icon: 'sparkles', onSelect: toMotion },
        { id: 'idle', label: t('clip.menu.idle'), icon: 'waves-horizontal', onSelect: toMotion },
        { id: 'paste-key', label: t('clip.menu.pasteKey'), icon: 'clipboard-paste', hint: t('clip.menu.pasteKey.hint'), separatorBefore: true, disabled: !st.hasCopiedKeyframe(), onSelect: () => useStore.getState().pasteKeyframeAtPlayhead(mine()) },
        { id: 'copy-keys', label: t('clip.menu.copyKeys'), icon: 'copy', hint: t('clip.menu.copyKeys.hint'), separatorBefore: true, onSelect: () => useStore.getState().copyClipAnimation(clip.id) },
        // Always listed, greyed when there is nothing to paste. Hiding it
        // meant the one place you would look for it was empty.
        { id: 'paste-keys', label: t('clip.menu.pasteKeys'), icon: 'clipboard-paste', hint: t('clip.menu.pasteKeys.hint'), disabled: !st.hasCopiedAnimation(), onSelect: () => useStore.getState().pasteClipAnimation(mine()) }
      )
    }
    items.push({ id: 'disable', label: clip.disabled ? t('clip.menu.enable') : t('clip.menu.disable'), icon: clip.disabled ? 'eye' : 'eye-off', separatorBefore: items.length > 0, onSelect: () => useStore.getState().setClipsDisabled(mine(), !clip.disabled) })
    if (menu) {
      const at = menu
      items.push({ id: 'label', label: t('kolay.label'), icon: 'bookmark', onSelect: () => setLabelMenu({ x: at.x, y: at.y, ids: mine() }) })
    }
    if (clip.linkId) items.push({ id: 'unlink', label: t('clip.unlink'), icon: 'unlink', testid: 'clip.unlink', onSelect: () => useStore.getState().unlinkClips([clip.id]) })
    if (asset?.kind === 'video' && asset.hasAudio) items.push({ id: 'extract', label: t('clip.menu.extractAudio'), icon: 'eighth-notes', separatorBefore: true, onSelect: () => useStore.getState().extractAudio(clip.id) })
    // What works on the selection (core polish T: also in the toolbar's
    // Tools): compound, group, an adjustment layer at the playhead.
    const sel = mine()
    const grouped = (st.project.groups ?? []).some((g) => sel.some((id) => g.clipIds.includes(id)))
    if (clip.nested && sel.length === 1) items.push({ id: 'uncompound', label: t('timeline.tool.uncompound'), icon: 'layers', hint: t('timeline.tool.uncompound.hint'), separatorBefore: true, onSelect: () => useStore.getState().uncompoundClip(clip.id) })
    else items.push({ id: 'compound', label: t('timeline.tool.compound'), icon: 'layers', hint: t('timeline.tool.compound.hint'), separatorBefore: true, disabled: sel.length < 2, onSelect: () => useStore.getState().compoundSelection() })
    if (grouped) items.push({ id: 'ungroup', label: t('timeline.tool.ungroup'), icon: 'unlink', hint: t('timeline.tool.ungroup.hint'), onSelect: () => useStore.getState().ungroupSelection() })
    else items.push({ id: 'group', label: t('timeline.tool.group', { n: sel.length }), icon: 'link', hint: t('timeline.tool.group.hint'), disabled: sel.length < 2, onSelect: () => useStore.getState().groupSelection() })
    items.push({ id: 'adjustment', label: t('timeline.tool.adjustment'), icon: 'contrast', hint: t('timeline.tool.adjustment.hint'), onSelect: () => useStore.getState().addAdjustmentLayer() })
    if (agentOn && menu) {
      const at = menu
      items.push({ id: 'agent', label: t('kapsam.menu.forAgent'), icon: 'bot', separatorBefore: true, onSelect: () => setAgentMenu({ x: at.x, y: at.y, ids: mine() }) })
    }
    // Each row by its name for the end-to-end tests (two keep the names they had).
    return items.map((it) => ({ ...it, testid: it.testid ?? `timeline.clip.${clip.id}.menu.${it.id}` }))
  }
  /** The rows of a keyframe diamond's menu. */
  const keyMenuItems = (time: number): MenuItem[] => {
    const st = useStore.getState()
    return [
      { id: 'jump', label: t('clip.key.jump'), icon: 'diamond', onSelect: () => useStore.getState().setTime(clip.start + time) },
      {
        id: 'delete',
        label: t('clip.key.delete'),
        icon: 'trash',
        onSelect: () => {
          const kg = keyframeGroups(clip).find((x) => Math.abs(x.time - time) < 1e-3)
          if (kg) useStore.getState().deleteKeyframes(clip.id, kg.keys)
        }
      },
      // THIS keyframe, to be dropped wherever the playhead is next — what you
      // reach for when a shot has to come back to a pose it held earlier, on
      // this clip or any other.
      { id: 'copy', label: t('clip.key.copy'), icon: 'copy', hint: t('clip.key.copy.hint'), onSelect: () => useStore.getState().copyKeyframeStamp(clip.id, time) },
      { id: 'paste', label: t('clip.menu.pasteKey'), icon: 'clipboard-paste', hint: t('clip.key.paste.hint'), disabled: !st.hasCopiedKeyframe(), onSelect: () => useStore.getState().pasteKeyframeAtPlayhead([clip.id]) },
      { id: 'copy-all', label: t('clip.menu.copyKeys'), icon: 'copy', hint: t('clip.menu.copyKeys.hint'), separatorBefore: true, onSelect: () => useStore.getState().copyClipAnimation(clip.id) },
      { id: 'paste-all', label: t('clip.menu.pasteKeys'), icon: 'clipboard-paste', hint: t('clip.menu.pasteKeys.hint'), disabled: !st.hasCopiedAnimation(), onSelect: () => useStore.getState().pasteClipAnimation([clip.id]) },
      { id: 'paste-scaled', label: t('keyframe.pasteScaled'), icon: 'clipboard-paste', hint: t('keyframe.pasteScaled.title'), testid: `timeline.clip.${clip.id}.paste-keys-scaled`, disabled: !st.hasCopiedAnimation(), onSelect: () => useStore.getState().pasteClipAnimation([clip.id], { scaled: true }) },
      { id: 'clear', label: t('clip.key.clear'), icon: 'eraser', danger: true, separatorBefore: true, onSelect: () => useStore.getState().clearClipKeyframes(clip.id) }
    ]
  }

  return (
    <div
      ref={rootRef}
      className={cls}
      data-clip-id={clip.id}
      data-testid={`timeline.clip.${clip.id}`}
      style={{
        left: drawLeft,
        width: drawWidth,
        // (Sideways, the drag's offset is on `translate`: rootRef above.)
        transform: previewDy ? `translateY(${previewDy}px)` : undefined
      }}
      onPointerDown={onPointerDown('move')}
      onContextMenu={(e) => {
        // Every clip has a menu. This used to open only on a video clip that
        // had an audio track — which is the one thing the menu is NOT mostly
        // about — so right-clicking an image, a silent clip, a shape or a
        // compound did nothing, and "paste the keyframes here" was unreachable.
        if (track.locked) return
        e.preventDefault()
        e.stopPropagation()
        setMenu({ x: e.clientX, y: e.clientY })
      }}
    >
      {menu && (
        <>
          <div className="ctx-backdrop" onPointerDown={(e) => (e.stopPropagation(), setMenu(null))} />
          <FloatingMenu x={menu.x} y={menu.y} onPointerDown={(e) => e.stopPropagation()} label={t('clip.menu')} testid={`timeline.clip.${clip.id}.menu`} onClose={() => setMenu(null)} items={clipMenuItems()} />
        </>
      )}
      {labelMenu && (
        <>
          <div className="ctx-backdrop" onPointerDown={(e) => (e.stopPropagation(), setLabelMenu(null))} />
          <FloatingMenu x={labelMenu.x} y={labelMenu.y} onPointerDown={(e) => e.stopPropagation()} label={t('kolay.label')} testid={`timeline.clip.${clip.id}.label-menu`} onClose={() => setLabelMenu(null)} items={labelMenuItems(clip.id, labelMenu.ids)} />
        </>
      )}
      {agentMenu && (
        <>
          <div className="ctx-backdrop" onPointerDown={(e) => (e.stopPropagation(), setAgentMenu(null))} />
          <FloatingMenu x={agentMenu.x} y={agentMenu.y} onPointerDown={(e) => e.stopPropagation()} label={t('kapsam.menu.forAgent')} testid={`timeline.clip.${clip.id}.agent-menu`} onClose={() => setAgentMenu(null)} items={agentMenuItems(clip.id, agentMenu.ids)} />
        </>
      )}
      {asset?.filmstrip && track.kind === 'video' ? (
        <Filmstrip clip={clip} asset={asset} />
      ) : asset?.thumbnail && track.kind === 'video' ? (
        <div className="thumb" style={{ backgroundImage: `url(${asset.thumbnail})` }} />
      ) : null}
      {clip.automationMissing && (
        <BareButton
          className="tl-missing-image-fill"
          title={t('clip.missing.hint', { n: clip.automationMissing.number, text: clip.automationMissing.text })}
          disabled={track.locked}
          onPointerDown={(event) => event.stopPropagation()}
          onClick={(event) => {
            event.stopPropagation()
            void fillMissingImage()
          }}
        >
          <span><Icon name="triangle-exclamation-point" size={12} /> {t('clip.missing', { n: clip.automationMissing.number })}</span>
          <small>{t('clip.missing.add')}</small>
        </BareButton>
      )}
      {/* (Linked: the chain is in the name pill, below. A clip that waits for
          its picture has no pill: its chain stays in the corner.) */}
      {linked && width >= 34 && clip.automationMissing && (
        <span
          className="link-badge"
          title={t('clip.linked.hint')}
        >
          <Icon name="link" size={12} />
        </span>
      )}
      {asset && track.kind === 'audio' && <Waveform clip={clip} asset={asset} />}
      {asset && track.kind === 'video' && asset.hasAudio && !clip.audioExtracted && (
        <div className="video-wave">
          <Waveform clip={clip} asset={asset} />
        </div>
      )}

      {/* Keys off the clip (an edit keeps them: phase Ç2c.1): one mark at
          that edge, which takes no pointer (the trim handle is there). */}
      {(['before', 'after'] as const).map((side) =>
        offKeys[side] > 0 ? (
          <div
            key={side}
            className={`clip-kf-off ${side}`}
            data-testid={`timeline.clip.${clip.id}.keys-off-${side}`}
            title={t('keyframe.outside', { n: offKeys[side] })}
            aria-label={t('keyframe.outside', { n: offKeys[side] })}
          />
        ) : null
      )}
      {keyframeGroups(clip).map((g) => (
        <div
          key={g.id}
          data-testid={`timeline.clip.${clip.id}.key.${g.id}`}
          className={`clip-kf${g.channels.length > 1 ? ' multi' : ''}`}
          // Clamped inside the clip: a keyframe at 0 (which is exactly where a
          // split leaves one) sat half outside a box with overflow:hidden, so
          // it looked like it had vanished and there was nothing left to grab.
          style={{ left: Math.min(Math.max(g.time * pxPerSec - 5, 0), Math.max(0, drawWidth - 10)) }}
          title={t('clip.key.hint', { what: g.channels.length > 1 ? t('clip.key.all', { list: g.channels.join(', ') }) : (g.channels[0] ?? ''), time: g.time.toFixed(2) })}
          onPointerDown={(e) => {
            e.stopPropagation()
            if (e.button !== 0 || track.locked) return
            const s = useStore.getState()
            // Snapshot at the first real move: clicking a diamond used to push
            // an undo entry that reverted nothing.
            let begun = false
            const startTime = g.time
            const ripple = e.ctrlKey || e.metaKey
            const memo = gestureMemo()
            // The keys of this diamond, by id, and the clip's keys as the drag
            // begins: every step is worked out from them, so only these keys
            // move, one they pass over is back where it was, and one they are
            // dropped on gives way (phase Ç2c.2, decision 2; report K3). Alt
            // leaves them and moves copies, made inside the drag with their
            // easing (K24: one undo step).
            const base = structuredClone(s.project.clips[clip.id]?.channels ?? {})
            const drag: KeyDrag = {
              base,
              keys: g.keys,
              from: g.time,
              ripple,
              ...(e.altKey ? { copies: { ids: Object.fromEntries(g.keys.map((r) => [r.id, uid()])), group: uid() } } : {})
            }
            // The diamonds as the drag began, to snap to (the dragged one's
            // own time aside).
            const others = keyframeGroups({ ...clip, channels: base }).filter((o) => o.id !== g.id).map((o) => o.time)
            let curTime = g.time
            // (timeline/drag.ts listens on the WINDOW: a re-render can swap the
            // node out mid-drag and the pointer capture would be lost with it.
            // A step per frame; Escape puts the keys back.)
            startDrag(e, {
              horizontal: true,
              onMove: (p) => {
                const st = useStore.getState()
                let t = startTime + p.dx / st.pxPerSec
                if (!p.shiftKey) {
                  const threshold = 8 / st.pxPerSec
                  const cands = [0, clip.duration, st.currentTime - clip.start, ...others]
                  for (const c of cands) if (Math.abs(t - c) <= threshold) t = c
                }
                t = Math.min(clip.duration, Math.max(0, t))
                if (Math.abs(t - curTime) < 1e-4) return
                if (!begun) {
                  begun = true
                  st.beginGesture()
                }
                st.dragKeyframes(clip.id, drag, t)
                curTime = t
              },
              onCancel: () => memo.restore()
            })
          }}
          onDoubleClick={(e) => {
            e.stopPropagation()
            useStore.getState().setTime(clip.start + g.time)
          }}
          onContextMenu={(e) => {
            e.preventDefault()
            e.stopPropagation()
            if (!track.locked) setKfMenu({ x: e.clientX, y: e.clientY, time: g.time })
          }}
        />
      ))}
      {kfMenu && (
        <FloatingMenu x={kfMenu.x} y={kfMenu.y} onPointerDown={(e) => e.stopPropagation()} label={t('clip.key.menu')} testid={`timeline.clip.${clip.id}.key-menu`} onClose={() => setKfMenu(null)} items={keyMenuItems(kfMenu.time)} />
      )}
      {volumeKeyMarks(clip, track, asset).map((k) => (
          <div
            key={k.id}
            data-testid={`timeline.clip.${clip.id}.volume-key.${k.id}`}
            className="vol-kf"
            style={{ left: k.time * pxPerSec - 4, bottom: 2 + k.value * 60 + '%' }}
            title={t('clip.volKey.hint', { pct: (k.value * 100).toFixed(0), time: k.time.toFixed(2) })}
            onPointerDown={(e) => {
              e.stopPropagation()
              useStore.getState().setPlaying(false)
              useStore.getState().setTime(clip.start + k.time)
            }}
          />
        ))}
      {/* The picture's moves (spans along the bottom) and the keys of its
          effect amounts and mask (small marks): DENEME-1, item 4. They take
          no pointer; the Inspector edits them. */}
      {marks.moves.map((m) => (
        <div
          key={m.id}
          data-testid={`timeline.clip.${clip.id}.move.${m.id}`}
          className="move-mark"
          style={{ left: m.from * pxPerSec, width: Math.max(3, (m.to - m.from) * pxPerSec) }}
          title={t('den1c.clip.move', { name: moveName(m.kind), from: m.from.toFixed(2), to: m.to.toFixed(2) })}
        />
      ))}
      {marks.keys.map((k) => (
        <div
          key={`${k.what}${k.time.toFixed(3)}`}
          data-testid={`timeline.clip.${clip.id}.${k.what}-key.${k.time.toFixed(2)}`}
          className={`key-mark ${k.what}`}
          style={{ left: Math.min(Math.max(k.time * pxPerSec - 3, 0), Math.max(0, drawWidth - 7)) }}
          title={t(k.what === 'fx' ? 'den1c.clip.fxKey' : 'den1c.clip.maskKey', { time: k.time.toFixed(2) })}
        />
      ))}
      {silenceRegions?.map((r, i) => (
        <div
          key={i}
          className={r.unsure ? 'silence-region unsure' : 'silence-region'}
          style={{
            left: (r.start - clip.start) * pxPerSec,
            width: Math.max(2, (r.end - r.start) * pxPerSec)
          }}
          title={t('clip.silence.hint', { s: (r.end - r.start).toFixed(2) })}
        />
      ))}
      {asset?.kind === 'code' && <CodeClipActivity assetId={asset.id} />}
      {/* Its coloured label (KOLAY-PLAN.md, item 3): a thin line along the top
          edge, inside the clip, clear of its rounded corners; under the name
          row (which starts below it), the selection's outline and the
          agent's marks (their own layers). */}
      {clip.label && <span className="clip-label-line" data-testid={`timeline.clip.${clip.id}.label`} data-label={clip.label} style={{ background: `var(${labelToken(clip.label)})` }} aria-hidden="true" />}
      {/* The clip's top row (22 November, L7 / L8): the name pill first, the
          start's motion button and the idle mark after it, then, at the right
          end, the end's motion button and the corner badges. ONE row laid out
          by the page: these were separately placed absolutes, and the star
          sat on the name's first letters, the chain and the idle mark on the
          pill at the small lane height. In a row nothing can lie on the
          name; when room runs out the name shortens with an ellipsis. A
          transition's block over a cut pushes the row's end in (padL / padR,
          from TrackClips), so the block is not on a name either. */}
      {!clip.automationMissing && (
        <div className="clip-top" style={padL > 0 || padR > 0 ? { left: padL > 0 ? padL + CLIP_TOP_GAP : undefined, right: padR > 0 ? padR + CLIP_TOP_GAP : undefined } : undefined}>
          <div className="label" data-testid={`timeline.clip.${clip.id}.name`}>
            {asset
              ? <><Icon name={KIND_ICON[asset.kind]} size={12} /><span className="label-name">{asset.name}</span></>
              : clip.nested
                ? <><Icon name="layers" size={12} /> {t('clip.label.compound', { n: clip.nested.clips.length })}</>
                : clip.cameraLook && hasLook(clip.cameraLook)
                  ? <><Icon name="contrast" size={12} /> {t('clip.label.look', { name: lookShown(lookName(clip.cameraLook), LOOK_PRESETS) })}{clip.lookOver === 'all' ? t('clip.label.look.all') : clip.lookOver === 'graphics' ? t('clip.label.look.graphics') : ''}</>
                  : <><Icon name="contrast" size={12} /> {t('clip.label.adjustment')}</>}
            {/* Linked to its sound / picture: the chain, in the pill. */}
            {linked && <span className="label-link" data-testid={`timeline.clip.${clip.id}.link`} title={t('clip.linked.hint')}><Icon name="link" size={12} /></span>}
            {asset?.kind === 'code' && <LiveBadge testid={`timeline.clip.${clip.id}.live`} />}
          </div>
          {/* Motion shortcut: a small button that shows on hover and on the
              selected clip (son, item B: not at rest, where the wedge says it). Wide clips get one after the
              name too, so you don't have to scroll to the far end just to
              add an animation. */}
          {motionButtons && clip.duration * pxPerSec >= 240 && <MotionQuickButton clip={clip} side="left" />}
          {clip.idle?.style && clip.idle.style !== 'none' && width >= 44 && (
            <div className="idle-badge" data-testid={`timeline.clip.${clip.id}.idle`} title={t('clip.idle.hint', { name: clip.idle.style })}>
              <Icon name="waves-horizontal" size={12} />
            </div>
          )}
          <span className="clip-top-gap" />
          {motionButtons && <MotionQuickButton clip={clip} side="right" />}
          {/* Locked against the agent (KAPSAM-AJAN-PLAN.md §6): in the row, so it
              never lies on the name. */}
          {clip.agentLock === true && width >= 36 && (
            <span className="kapsam-lock" data-testid={`timeline.clip.${clip.id}.agent-lock`} title={t('kapsam.lock.hint')}>
              <Icon name="lock" size={10} />
            </span>
          )}
          {/* One strip for the corner badges. They were two independently placed
              absolutes in the same corner, which meant a clip that was both
              retimed and had motion FX wore one on top of the other. */}
          {(((clip.motionFx?.enabled || clip.stillImageFx || clip.ambientFx) && width >= 44) || (((clip.speed ?? 1) !== 1 || curved) && width >= 40)) && (
            <div className="clip-badges">
              {(clip.motionFx?.enabled || clip.stillImageFx || clip.ambientFx) && width >= 44 && <span className="fx-badge" data-testid={`timeline.clip.${clip.id}.fx`}>{t('clip.badge.fx')}</span>}
              {/* A speed curve: the range it passes through (core polish T); the
                  line under the clip shows where. */}
              {curved && width >= 40 && (
                <span className="speed-badge curve" data-testid={`timeline.clip.${clip.id}.curve-badge`} title={t('ct.curve.hint', curved)}>
                  {t('ct.curve.badge', curved)}
                </span>
              )}
              {/* Retimed clips say so. A clip at 4× looks exactly like a clip at 1×
                  on the timeline, and you find out by playing it. */}
              {!curved && (clip.speed ?? 1) !== 1 && width >= 40 && (
                <span className="speed-badge" data-testid={`timeline.clip.${clip.id}.speed`} title={t('clip.badge.speed', { x: (clip.speed ?? 1).toFixed(2) })}>
                  {Number((clip.speed ?? 1).toFixed(2))}×
                </span>
              )}
            </div>
          )}
        </div>
      )}
      {/* A speed curve's line along the bottom of the clip (core polish T). */}
      {curveLine && (
        <svg className="tl-curve-line" data-testid={`timeline.clip.${clip.id}.curve-line`} width={width} height={CURVE_LINE_H} viewBox={`0 0 ${width} ${CURVE_LINE_H}`} aria-hidden="true">
          <path className="tl-curve-one" d={`M0 ${CURVE_LINE_H / 2}H${width}`} />
          <path d={curveLine} />
        </svg>
      )}
      {/* Corner fade handles: drag inwards to set the audio fade, the way every
          NLE does it — previously fades were only reachable from the inspector.
          Hidden on clips too narrow to aim at: two handles plus two trim handles
          on a 20 px clip is four overlapping targets and no clip left. */}
      {hasAudio && !track.locked && width >= 70 && (
        <>
          <FadeHandle clip={clip} edge="in" />
          <FadeHandle clip={clip} edge="out" />
        </>
      )}
      {/* Animate-in / animate-out get their own edge marker, matching the
          purple the transition badge uses, so an animation added from the quick
          menu is as visible on the clip as one added from the panel. */}
      {clip.anim?.in && clip.anim.in !== 'none' && (
        <div
          className="anim-badge in"
          data-testid={`timeline.clip.${clip.id}.anim-in`}
          style={{ width: Math.min(width - 6, (clip.anim.inDur ?? 0.5) * pxPerSec) }}
          title={t('clip.anim.in.hint', { name: clip.anim.in, s: (clip.anim.inDur ?? 0.5).toFixed(2) })}
        />
      )}
      {clip.anim?.out && clip.anim.out !== 'none' && (
        <div
          className="anim-badge out"
          data-testid={`timeline.clip.${clip.id}.anim-out`}
          style={{ width: Math.min(width - 6, (clip.anim.outDur ?? 0.5) * pxPerSec) }}
          title={t('clip.anim.out.hint', { name: clip.anim.out, s: (clip.anim.outDur ?? 0.5).toFixed(2) })}
        />
      )}
      {clip.transitionOut && (
        <div className="trans-badge" style={{ width: Math.min(width - 10, clip.transitionOut.duration * pxPerSec) }} title={t('clip.trans.hint', { s: clip.transitionOut.duration.toFixed(2) })} />
      )}
      <div className="handle l" data-testid={`timeline.clip.${clip.id}.trim-start`} title={t('clip.trim.start')} onPointerDown={onPointerDown('trim-l')} />
      <div className="handle r" data-testid={`timeline.clip.${clip.id}.trim-end`} title={t('clip.trim.end')} onPointerDown={onPointerDown('trim-r')} />
    </div>
  )
}

// Use the canonical lists — hand-written copies drifted from the real enums
// (the idle names were pure invention), so picking one silently wrote a value
// the renderer didn't understand and nothing happened.
export const ANIM_PRESETS = CLIP_ANIMS
export const IDLE_PRESETS = IDLE_STYLES

/**
 * A single ✨ button that fades in when the pointer is over the clip. It opens a
 * compact menu for Animate in / out / Idle motion — applying a preset right
 * there, or jumping to the full Motion panel. Deliberately hover-only and set
 * in from the edges so it never competes with dragging or the trim handles.
 */
/**
 * Draggable fade handle in a clip's BOTTOM corner.
 *
 * The clip edges were getting crowded: transitions, animate-in/out markers,
 * keyframes and the motion button all live along the top. Fades are an audio
 * idea, so they moved down to where the waveform is — different edge, different
 * shape (a ramp wedge, not a full-height gradient) and a different colour, so
 * a fade can no longer be mistaken for a transition.
 */
export function FadeHandle({ clip, edge }: { clip: Clip; edge: 'in' | 'out' }): JSX.Element {
  const pxPerSec = useStore((s) => s.pxPerSec)
  const [dragging, setDragging] = useState(false)
  const dur = (edge === 'in' ? clip.fadeIn : clip.fadeOut) ?? 0
  const px = Math.max(0, dur * pxPerSec)
  return (
    <>
      {dur > 0 && (
        <div
          className={`fade-wedge ${edge}`}
          style={{ width: px }}
          title={edge === 'in' ? t('clip.fade.in', { s: dur.toFixed(2) }) : t('clip.fade.out', { s: dur.toFixed(2) })}
        />
      )}
      {(dragging || dur > 0) && px > 26 && (
        <div className={`fade-label ${edge}`}>{t('trans.seconds', { s: dur.toFixed(2) })}</div>
      )}
      <div
        className={`fade-handle ${edge}${dragging ? ' on' : ''}`}
        // Never sits on the very edge: the trim handle occupies the first 14 px
        // and full height there, and trimming from the corner must keep working.
        style={{ [edge === 'in' ? 'left' : 'right']: Math.max(14, px - 6) }}
        title={edge === 'in' ? t('clip.fade.in.handle') : t('clip.fade.out.handle')}
        onDoubleClick={(e) => {
          e.stopPropagation()
          const st = useStore.getState()
          st.undoable(() => st.setClipFades(clip.id, edge === 'in' ? { fadeIn: 0 } : { fadeOut: 0 }))
        }}
        onPointerDown={(e) => {
          e.stopPropagation()
          if (e.button !== 0) return
          setDragging(true)
          const orig = dur
          const maxFade = Math.max(0.05, clip.duration)
          const memo = gestureMemo()
          startDrag(e, {
            horizontal: true,
            slop: 2,
            onStart: () => useStore.getState().beginGesture(),
            onMove: (p) => {
              const st = useStore.getState()
              const delta = p.dx / st.pxPerSec
              const next = Math.max(0, Math.min(maxFade, orig + (edge === 'in' ? delta : -delta)))
              st.setClipFades(clip.id, edge === 'in' ? { fadeIn: next } : { fadeOut: next })
            },
            onEnd: () => setDragging(false),
            onCancel: (moved) => {
              setDragging(false)
              if (moved) memo.restore()
            }
          })
        }}
      >
        <span className="fade-grip" />
      </div>
    </>
  )
}

export function MotionQuickButton({ clip, side }: { clip: Clip; side: 'left' | 'right' }): JSX.Element {
  // The button at the START of the clip opens on the entrance, the one at the
  // END opens on the exit. Both used to open on 'in', so setting an exit meant
  // reaching for the right-hand button and then correcting the app's guess.
  const [tab, setTab] = useState<'in' | 'out' | 'idle'>(side === 'right' ? 'out' : 'in')
  const [anchor, setAnchor] = useState<{ x: number; y: number } | null>(null)
  const pxPerSec = useStore((s) => s.pxPerSec)

  // The clip block is `overflow: hidden`, so a menu rendered inside it was
  // clipped down to the tab strip — which is exactly why picking In/Out looked
  // like it did nothing. The menu is portalled to <body> instead.
  useEffect(() => {
    if (!anchor) return
    const close = (e: PointerEvent): void => {
      const el = e.target as HTMLElement
      if (!el.closest('.motion-quick') && !el.closest('.motion-quick-menu')) setAnchor(null)
    }
    // Scrolling or zooming the TIMELINE would leave the menu floating over the
    // wrong clip, so that dismisses it — but scrolling INSIDE the menu must not.
    const dismiss = (e: WheelEvent): void => {
      if ((e.target as HTMLElement).closest('.motion-quick-menu')) return
      setAnchor(null)
    }
    window.addEventListener('pointerdown', close)
    window.addEventListener('wheel', dismiss, { passive: true })
    return () => {
      window.removeEventListener('pointerdown', close)
      window.removeEventListener('wheel', dismiss)
    }
  }, [anchor])
  useEffect(() => setAnchor(null), [pxPerSec])

  const animIn = clip.anim?.in ?? 'none'
  const animOut = clip.anim?.out ?? 'none'
  const idle = clip.idle?.style ?? 'none'
  const active = animIn !== 'none' || animOut !== 'none' || idle !== 'none'

  // In / Out / Idle are independent settings: applying one keeps the menu open
  // so the next can be picked straight away.
  const apply = (value: string): void => {
    const s = useStore.getState()
    s.undoable(() => {
      if (tab === 'idle') s.setClipIdle(clip.id, { style: value as never })
      else s.setClipAnim(clip.id, tab === 'in' ? { in: value as never } : { out: value as never })
    })
  }

  const presets = tab === 'idle' ? IDLE_PRESETS : ANIM_PRESETS
  const current = tab === 'idle' ? idle : tab === 'in' ? animIn : animOut
  const valueOf = (t: 'in' | 'out' | 'idle'): string => (t === 'in' ? animIn : t === 'out' ? animOut : idle)

  return (
    <div className={`motion-quick ${side}`} onPointerDown={(e) => e.stopPropagation()}>
      <BareButton
        className={`motion-quick-btn${active ? ' on' : ''}${anchor ? ' open' : ''}`}
        data-testid={`timeline.clip.${clip.id}.motion.${side}`}
        title={t('clip.motion.hint')}
        aria-label={t('clip.motion.hint')}
        onClick={(e) => {
          e.stopPropagation()
          if (anchor) {
            setAnchor(null)
            return
          }
          const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
          setAnchor({ x: r.left, y: r.bottom + 4 })
        }}
      >
        <Icon name="sparkles" size={12} />
      </BareButton>
      {anchor && (
        <FloatingMenu
          x={anchor.x}
          y={anchor.y}
          className="motion-quick-menu"
          onPointerDown={(e) => e.stopPropagation()}
        >
          <Segmented
            label={t('clip.motion.part')}
            value={tab}
            onChange={setTab}
            options={(['in', 'out', 'idle'] as const).map((part) => ({ value: part, label: `${t(`clip.motion.${part}`)}${valueOf(part) !== 'none' ? ' •' : ''}` }))}
          />
          <div className="mq-list">
            {presets.map((p) => (
              <Button key={p} variant="ghost" size="sm" pressed={current === p} onClick={() => apply(p)}>
                {tab === 'idle' ? idleName(p as IdleStyle) : animName(p as ClipAnim)}
              </Button>
            ))}
          </div>
          <div className="ctx-sep" />
          <Button
            variant="ghost"
            size="sm"
            icon="settings"
            onClick={() => {
              const s = useStore.getState()
              s.selectClip(clip.id)
              s.focusInspector('motion')
              setAnchor(null)
            }}
          >
            {t('clip.motion.more')}
          </Button>
        </FloatingMenu>
      )}
    </div>
  )
}
