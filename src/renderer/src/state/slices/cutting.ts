// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// The store's cutting actions: slip, trim, delete, split, ripple, cut marks,
// silence cuts, paste and duplicate, freeze frame, compound clips, the
// adjustment layer. Moved out of state/store.ts in SnippStudio phase 2B
// (no change).
import { automationOf, freshCopy, freshNestedIds, holdFxKeys, remapClipAutomation, slipAutomation } from '../../timeline/slice'
import type { Asset, Clip, Project, Track } from '../../types'
import { clipsOfTrack, instanceOf, neutralGrade, uid } from '../../types'
import { setTemplateCut } from '../../templates/model'
import { applyAutoPack, clone, dropLoneLinks, findTrack, forgetClips, freeTrackAt, settleClipOnTrack, sortTrack } from '../../commands/ops/base'
import { divideAutomation, divideClipExtras, targetClipAt } from '../../commands/ops/split'
import { insertTimeElsewhere, lockedBehind, ripplePlan } from '../../commands/ops/ripple'
import { notify } from '../../ui/toast-core'
import { transitionsOfCopy } from '../../timeline/transition-links'
import { t } from '../../ui/strings'
import { localAtMedia, mediaAtLocal, partOf, takePart } from '../../timeline/media-time'
import { shiftCurve } from '../../timeline/speed-curve'
import { minClipLength } from '../../timeline/speed'
import { clipOpacityAt, clipTransformAt, maskGeomAt } from '../../playback/pose'
import { automationGainAt } from '../../audio/envelope'
import { applySilence, cutCaptionRange, cutRangeOnTrack, cutRanges, mergeCutRanges, rippleTrim, rippleTrimPlan, silenceByClip, silenceRanges, trackCutPlan } from '../../commands/timeline'
import { addMarker, updateMarker } from '../../commands/markers'
import { deletableClipIds, deleteClips, duplicateInto, keepRange, ownTrackClosePlan, rippleLeavesGap, slipClip, splitClips, splitsAnything, trimEnd, trimHead, unlinkClips } from '../../commands/clips'
import { freePairs, lockedPartner, relink, withPartners } from '../../commands/ops/links'
import { env } from '../shared'
import type { CutScope, EditorState } from '../editor-state'
import type { GetState, Mutate, SetState } from './types'

export type CuttingActions = Pick<EditorState, 
  | 'slipClip'
  | 'unlinkClips'
  | 'setClipHead'
  | 'trimClipEnd'
  | 'deleteClip'
  | 'deleteClips'
  | 'splitAtPlayhead'
  | 'splitClipAt'
  | 'skipAhead'
  | 'splitTargetAtPlayhead'
  | 'rippleTrimToPlayhead'
  | 'closeGapAtPlayhead'
  | 'applySilenceCuts'
  | 'markTimes'
  | 'addCutMark'
  | 'clearCutMarks'
  | 'deleteBetweenCuts'
  | 'rippleDelete'
  | 'rippleDeleteMany'
  | 'keepOnlyRange'
  | 'pasteAtPlayhead'
  | 'duplicateSelection'
  | 'duplicateClipsInPlace'
  | 'insertFreezeFrame'
  | 'compoundSelection'
  | 'uncompoundClip'
  | 'addAdjustmentLayer'
>

export function cuttingActions(set: SetState, get: GetState, mutate: Mutate): CuttingActions {
  /** An edit of `ids` a locked partner holds: told, not made. */
  const refusedByLock = (ids: readonly string[], link: boolean): boolean => tellLockedPartner(get().project, ids, link)
  /** One range out of every unlocked track (`trackId` null) or one track:
   *  the one ripple (phase Ç2b.1, decision 1). */
  const cutRange = (range: [number, number], trackId: string | null, scope?: CutScope): void => {
    if (trackId) {
      // One track only: the linked partners of what moves up follow, or the
      // gap stays and the user is told (22 Nov, K3; the link switch off: as
      // it was, that track alone).
      const linkAV = get().linkAV
      tellGapLeft(get().project, trackCutPlan(get().project, { trackId, range, linkAV }).blockedBy)
      mutate((p) => void cutRangeOnTrack.apply(p, { trackId, range, linkAV }, env()))
      return
    }
    cutMany([range], scope)
  }
  /** Ranges out of every unlocked track but the ones `scope` keeps (a music
   *  bed: çekirdek cila S, decision 2; no scope: every one, as before). */
  const cutMany = (ranges: readonly [number, number][], scope?: CutScope): boolean => {
    // Merged first (commands/timeline.ts): nothing left is no edit at all.
    const merged = mergeCutRanges(ranges)
    if (merged.length === 0) return false
    tellLockedBehind(get().project, merged[0][0])
    // The ranges really taken out (widened over slivers, K-3) are the
    // version log's: older times move by exactly them.
    const cuts = ripplePlan(merged)
    const keep = keptOf(get().project, scope)
    mutate((p) => void cutRanges.apply(p, { ranges: merged, ...keep.params }, env()), true, undefined, { cuts: [cuts], ...keep.meta })
    return true
  }
  return {
    /**
     * Head trim, driven by the ABSOLUTE position the handle is dragged to plus
     * the clip's shape when the drag began. Working from a baseline instead of
     * accumulating deltas makes the drag exactly reversible — dragging back over
     * the same ground restores the same shape — and leaves no room for rounding
     * to let the clip creep.
     *
     * Dragging right trims the head normally: the edge moves, a gap opens behind
     * it, nothing else on the track is touched. Dragging left reveals earlier
     * media and the edge moves left, until the previous clip is in the way. THAT
     * is the case worth improving: rather than simply refusing, the edge stops
     * at the neighbour and the remaining material is added by growing to the
     * right, pushing what follows. So "I need a bit more of the earlier scene"
     * stays one drag even when the clip is boxed in.
     */
    unlinkClips: (clipIds) => mutate((p) => unlinkClips.apply(p, { ids: clipIds }, env())),

    slipClip: (clipId, deltaSec, baseInPoint) => {
      if (refusedByLock([clipId], get().linkAV)) return
      mutate((p) => slipClip.apply(p, { clipId, delta: deltaSec, baseInPoint, linkAV: get().linkAV }, env()), false)
    },

    // With the link on (and no Alt: `alone`), the partner gets the same edge
    // change (phase Ç2b.1, decision 2).
    setClipHead: (clipId, edgeSec, base, alone) => {
      const linkAV = get().linkAV && !alone
      if (refusedByLock([clipId], linkAV)) return
      mutate((p) => trimHead.apply(p, { clipId, edge: edgeSec, base, linkAV }, env()), false)
    },

    trimClipEnd: (clipId, deltaSec, alone) => {
      const linkAV = get().linkAV && !alone
      if (refusedByLock([clipId], linkAV)) return
      mutate((p) => trimEnd.apply(p, { clipId, delta: deltaSec, linkAV }, env()), false)
    },

    deleteClip: (clipId, ripple) => get().deleteClips([clipId], ripple),

    deleteClips: (requested, ripple, onlyItsTrack) => {
      const linkAV = get().linkAV
      // A locked track keeps its clips (and a pair one of them is locked
      // in): nothing to delete is no edit at all.
      tellLockedPartner(get().project, requested, linkAV)
      const clipIds = deletableClipIds(get().project, requested, linkAV)
      if (clipIds.length === 0) return
      // Material on another track in the time they took: deleted without
      // ripple, the gap stays, and the user is told once (Ç2b patch, item 3;
      // Alt closes their own tracks).
      if (ripple && !onlyItsTrack && rippleLeavesGap(get().project, clipIds)) notify({ text: t('timeline.rippleGapLeft'), kind: 'info' })
      else if (ripple && !onlyItsTrack) tellLockedBehind(get().project, Math.min(...clipIds.map((id) => get().project.clips[id].start)))
      // Alt, their own tracks only: a linked pair after them that could not
      // stay in step keeps every gap open, and that is said (22 Nov, K3).
      else if (ripple && onlyItsTrack) tellDeleteGapLeft(get().project, ownTrackClosePlan(get().project, clipIds, linkAV).blockedBy)
      mutate((p) => void deleteClips.apply(p, { ids: clipIds, ripple, onlyItsTrack, linkAV }, env()))
      set({ selectedClipIds: get().selectedClipIds.filter((id) => !clipIds.includes(id)) })
    },

    splitAtPlayhead: () => {
      const { currentTime, selectedClipIds, templateSel } = get()
      // A template on its own is cut short there.
      const tb = templateSel && selectedClipIds.length === 0 ? get().project.templates?.find((t) => t.id === templateSel) : undefined
      if (tb) {
        if (currentTime > tb.start && currentTime < tb.start + tb.duration) get().editTemplates((p) => setTemplateCut(p, tb.id, currentTime - tb.start))
        return
      }
      const ids = selectedClipIds.length > 0 ? selectedClipIds : Object.keys(get().project.clips)
      // Nothing under the playhead to cut (or only locked clips): no edit, and
      // no empty undo step that Ctrl+Z would spend doing nothing.
      // (A selected pair a lock holds is not cut, and the user is told.)
      if (selectedClipIds.length > 0) tellLockedPartner(get().project, ids, get().linkAV)
      if (!splitsAnything(get().project, ids, currentTime, get().linkAV)) return
      mutate((p) => void splitClips.apply(p, { clipIds: ids, time: currentTime, linkAV: get().linkAV }, env()))
    },

    splitClipAt: (clipId, time) => {
      // A locked clip, or a cut at its very edge: nothing, and no undo step.
      if (refusedByLock([clipId], get().linkAV)) return
      if (!splitsAnything(get().project, [clipId], time, false)) return
      mutate((p) => void splitClips.apply(p, { clipIds: [clipId], time, linkAV: get().linkAV }, env()))
    },

    skipAhead: (clipId, time, seconds) => {
      // (As splitClipAt: a locked clip, or a cut at its very edge, is no edit.)
      if (refusedByLock([clipId], get().linkAV)) return
      if (!splitsAnything(get().project, [clipId], time, false)) return
      // The split and the slip of the right piece are ONE edit, one undo step
      // (phase 11b, KF6: they were two, and one Ctrl+Z left the split).
      mutate((p) => {
        const before = new Set(Object.keys(p.clips))
        splitClips.apply(p, { clipIds: [clipId], time, linkAV: get().linkAV }, env())
        const right = Object.values(p.clips).find((c) => !before.has(c.id) && Math.abs(c.start - time) < 1e-6)
        const r = right && p.clips[right.id]
        const asset = r && p.assets.find((a) => a.id === r.assetId)
        if (!r) return
        const speed = r.speed ?? 1
        const shift = seconds * speed
        // Backwards (phase 11b, B2): the piece plays its media from the end
        // down, so skipping ahead takes the media window DOWN by the shift;
        // with less than that left before the file's start it plays shorter.
        // (It slid up before: the piece jumped back, to footage already seen.)
        if (r.reversed && !r.speedCurve && r.freeze === undefined) {
          const down = Math.min(shift, r.inPoint)
          slipAutomation(r, r.inPoint, r.inPoint - down)
          r.inPoint -= down
          if (down < shift) r.duration = Math.max(minClipLength(p.settings.fps), r.duration - (shift - down) / speed)
          return
        }
        const room = asset?.duration ? asset.duration - (r.inPoint + r.duration * speed) : shift
        r.inPoint += shift
        // Along a speed curve the curve stays where it was on the timeline
        // (a slip: core polish C).
        if (r.speedCurve) r.speedCurve = shiftCurve(r.speedCurve, shift)
        // A slip of the piece: its keys ride with the footage (phase Ç2c.1,
        // decision 4).
        slipAutomation(r, r.inPoint - shift, r.inPoint)
        // Past the end of the media the part plays shorter.
        // (Never shorter than one frame, and never past the file's end: the
        // old 0.1 s floor at speed x was 0.1 × x seconds of media, core
        // polish B.)
        if (room < shift && r.speedCurve && asset?.duration) {
          // Along a curve: it ends where the file does, at the curve's speeds.
          const nd = Math.max(minClipLength(p.settings.fps), Math.min(r.duration, localAtMedia(r, asset.duration)))
          takePart(r, r, 0, nd)
          r.duration = nd
          if (r.inPoint + r.duration * (r.speed ?? 1) > asset.duration) {
            const inPoint = Math.max(0, asset.duration - r.duration * (r.speed ?? 1))
            slipAutomation(r, r.inPoint, inPoint)
            r.speedCurve = shiftCurve(r.speedCurve, inPoint - r.inPoint)
            r.inPoint = inPoint
          }
        } else if (room < shift) {
          r.duration = Math.max(minClipLength(p.settings.fps), r.duration - (shift - Math.max(0, room)) / speed)
          if (asset?.duration && r.inPoint + r.duration * speed > asset.duration) {
            const inPoint = Math.max(0, asset.duration - r.duration * speed)
            slipAutomation(r, r.inPoint, inPoint)
            r.inPoint = inPoint
          }
        }
      })
    },

    splitTargetAtPlayhead: () => {
      const { currentTime, selectedClipIds, project } = get()
      const target = targetClipAt(project, selectedClipIds, currentTime)
      if (target) get().splitClipAt(target.id, currentTime)
    },

    rippleTrimToPlayhead: (side, everyTrack) => {
      const { currentTime, selectedClipIds, project, linkAV } = get()
      const target = targetClipAt(project, selectedClipIds, currentTime)
      if (!target) return
      const cs = target.start
      let closed = true
      if (everyTrack) {
        // Alt: every unlocked track loses that time (phase Ç2b.1, decision 1).
        cutRange(side === 'left' ? [cs, currentTime] : [currentTime, cs + target.duration], null)
      } else {
        // The selected clip, else the topmost one under the playhead, and its
        // linked partner (with the link on): only their tracks close up; the
        // layers above and below stay (DENEME-1-PLAN-C.md, item 2). One pure
        // command (22 Nov, K3): the linked pairs after the cut stay in step
        // (a partner on another track moves up with its clip), and a pair
        // gets one change; where that cannot be done the gap stays, said.
        if (refusedByLock([target.id], linkAV)) return
        const params = { clipId: target.id, time: currentTime, side: side === 'left' ? ('head' as const) : ('tail' as const), linkAV }
        const blockedBy = rippleTrimPlan(project, params)?.plan.blockedBy
        closed = blockedBy === undefined
        tellGapLeft(project, blockedBy)
        mutate((p) => void rippleTrim.apply(p, params, env()))
      }
      // Left: the remaining part slid back to the clip's original start, so
      // put the playhead there (not when the gap stayed: the clip now begins
      // at the playhead). Right: it stays at the cut (the new clip end).
      if (side === 'left' && closed) set({ currentTime: cs })
    },

    closeGapAtPlayhead: (onlyItsTrack) => {
      const { currentTime, selectedClipIds, project } = get()
      // Work on the track of the selected clip, else the top video track.
      const sel = selectedClipIds[0] ? project.clips[selectedClipIds[0]] : undefined
      const track =
        (sel && findTrack(project, sel.trackId)) || project.tracks.find((t) => t.kind === 'video')
      if (!track) return
      const clips = clipsOfTrack(project, track).sort((a, b) => a.start - b.start)
      // The gap the playhead sits in: previous clip's end → next clip's start.
      let gapStart = 0
      let gapEnd = Infinity
      for (const c of clips) {
        if (c.start + c.duration <= currentTime + 1e-6) gapStart = Math.max(gapStart, c.start + c.duration)
        if (c.start >= currentTime - 1e-6) {
          gapEnd = Math.min(gapEnd, c.start)
          break
        }
        // Playhead inside a clip → not a gap.
        if (c.start < currentTime && c.start + c.duration > currentTime) return
      }
      if (gapEnd === Infinity || gapEnd - gapStart < 0.02) return
      cutRange([gapStart, gapEnd], onlyItsTrack ? track.id : null)
      set({ currentTime: gapStart })
    },

    /**
     * Removes the silent stretches from the clips you picked — and only those.
     *
     * The detector labels every gap with the clip that owns it. This matters
     * when Ctrl+A selects several voice clips: each gets its OWN silent gaps,
     * while unrelated selected music and still images are untouched.
     */
    applySilenceCuts: (regions, opts) => {
      // Nothing to cut on clips the project has: no edit, the preview goes.
      if (silenceByClip(get().project, regions).size === 0) {
        set({ silencePreview: null })
        return
      }
      // The silence out of the whole timeline (phase Ç2b.1, decision 1): a
      // cut like any other, so older times move by exactly its ranges.
      // A picked voice with no pause found is loud all through (Ç2b patch).
      const picked = opts?.picked
      const ranges = silenceRanges(get().project, regions, picked)
      if (ranges.length === 0) {
        set({ silencePreview: null })
        return
      }
      tellLockedBehind(get().project, ranges[0][0])
      const cuts = ripplePlan(ranges)
      const keep = keptOf(get().project, opts)
      mutate((p) => void applySilence.apply(p, { regions, picked, crossfade: opts?.crossfade, ...keep.params }, env()), true, undefined, { cuts: [cuts], ...keep.meta })
      set({ silencePreview: null, selectedClipIds: [] })
    },

    markTimes: (marks) => {
      const list = marks.filter((m) => Number.isFinite(m.time) && m.time >= 0)
      if (list.length === 0) return
      mutate((p) => {
        for (const m of list) {
          const id = addMarker.apply(p, { time: m.time, ...(m.note ? { note: m.note } : {}) }, env())
          if (m.label) updateMarker.apply(p, { id, patch: { label: m.label } }, env())
        }
      })
    },
    addCutMark: (time, trackId) =>
      set((s) => {
        // Marking a different lane starts a fresh pair scoped to that lane.
        if (s.cutTrackId !== trackId) return { cutMarks: [time], cutTrackId: trackId }
        if (s.cutMarks.some((m) => Math.abs(m - time) < 0.02)) return s
        // A third mark starts a fresh pair.
        if (s.cutMarks.length >= 2) return { cutMarks: [time] }
        return { cutMarks: [...s.cutMarks, time].sort((a, b) => a - b) }
      }),
    clearCutMarks: () => set({ cutMarks: [], cutTrackId: null }),

    deleteBetweenCuts: (onlyItsTrack) => {
      const { cutMarks: marks, cutTrackId } = get()
      if (marks.length < 2) return
      const a = Math.min(...marks)
      const b = Math.max(...marks)
      if (b - a < 0.02) return
      // Subtitle lane: only remove/shift captions in the range.
      if (cutTrackId === 'captions') {
        mutate((p) => cutCaptionRange.apply(p, { range: [a, b] }, env()))
        set({ cutMarks: [], cutTrackId: null })
        return
      }
      // The marked range out of every unlocked track (phase Ç2b.1, decision
      // 1); with Alt, out of the marked lane only.
      cutRange([a, b], onlyItsTrack && cutTrackId ? cutTrackId : null)
      set({ cutMarks: [], cutTrackId: null, selectedClipIds: [] })
    },

    rippleDelete: (a, b, scope) => {
      if (b - a < 0.02) return
      cutRange([a, b], null, scope)
      set({ selectedClipIds: [], selectedCaptionIds: [] })
    },

    rippleDeleteMany: (ranges, scope) => {
      if (!cutMany(ranges, scope)) return
      set({ selectedClipIds: [], selectedCaptionIds: [] })
    },

    keepOnlyRange: (clipId, a, b) => {
      mutate((p) => keepRange.apply(p, { clipId, range: [a, b] }, env()))
      set({ cutMarks: [], cutTrackId: null })
    },

    /**
     * Pastes at the playhead, onto a track with ROOM for it.
     *
     * It used to paste onto the clip's own track and then cascade — which
     * shoves everything after the paste to the right. Ctrl+V in the middle of
     * a finished edit therefore moved every later cut, and the one thing a
     * paste must never do is rearrange work you weren't looking at. So it
     * looks upward for a free lane and makes one if there isn't any: the copy
     * lands exactly where the playhead is, over the top, and nothing else on
     * the timeline moves at all.
     */
    pasteAtPlayhead: () => {
      const s = get()
      const clips = s.clipboard
      if (!clips || clips.length === 0) return
      const t0 = Math.min(...clips.map((c) => c.start))
      const newIds: string[] = []
      mutate((p) => {
        // The media the copied clips show come with them (phase Ç2a.1, report
        // P5): pasted into another project, a clip of media it does not have
        // was an invisible clip that took up time and was saved.
        const assetIds = pasteAssets(p, s.clipboardAssets)
        // Copied pairs (a picture and its sound) are pasted as pairs: the
        // copies get a link of their own (phase Ç2b.1, decision 2).
        const links = new Map<string, string>()
        const linkOf = (link: string | undefined): string | undefined => {
          if (!link || clips.filter((c) => c.linkId === link).length < 2) return undefined
          if (!links.has(link)) links.set(link, uid())
          return links.get(link)
        }
        for (const src0 of clips) {
          const src = withAssets(src0, assetIds)
          const asset = p.assets.find((a) => a.id === src.assetId)
          const kind: Track['kind'] = asset?.kind === 'audio' ? 'audio' : 'video'
          const start = s.currentTime + (src.start - t0)
          const end = start + src.duration
          const home = findTrack(p, src.trackId)
          const track = freeTrackAt(p, kind, home && home.kind === kind ? home : null, start, end)
          const c: Clip = { ...clone(src), id: uid(), trackId: track.id, start }
          delete c.linkId
          const link = linkOf(src.linkId)
          if (link) c.linkId = link
          // A pasted clip is new content, not a piece of the one copied.
          delete c.instance
          freshCopy(c)
          // (A copy comes without its transition: phase Ç2b.2, decision 1.)
          transitionsOfCopy(c)
          p.clips[c.id] = c
          track.clipIds.push(c.id)
          sortTrack(p, track)
          newIds.push(c.id)
        }
        applyAutoPack(p)
      })
      set({ selectedClipIds: newIds })
    },

    duplicateSelection: () => {
      const s = get()
      // A locked track gets no copy (phase Ç2b.1, decision 3: Ctrl+D on a
      // clip selected before its track was locked added one); a linked
      // partner is copied with its clip, the copies linked to each other.
      const ids = freePairs(s.project, s.selectedClipIds, s.linkAV)
      tellLockedPartner(s.project, s.selectedClipIds, s.linkAV)
      if (ids.length === 0) return
      let newIds: string[] = []
      // (The copies are made by the command an agent sends too: clip.duplicate.)
      mutate((p) => {
        newIds = duplicateInto(p, ids, undefined, false)
      })
      set({ selectedClipIds: newIds })
    },

    duplicateClipsInPlace: (ids) => {
      const newIds: string[] = []
      // With the link on, the partners are copied too (after the asked ones,
      // whose copies come back in order), the copies linked to each other:
      // the drag then moves each copy with its partner (phase Ç2b.1).
      const all = withPartners(get().project, ids, get().linkAV)
      mutate((p) => {
        const links = new Map<string, string>()
        for (const id of all) {
          const src = p.clips[id]
          const track = src ? findTrack(p, src.trackId) : undefined
          if (!src || !track) {
            newIds.push('')
            continue
          }
          // Same start/track — the copy overlaps the original until the drag
          // moves it. Overlap resolution runs on drop, not here.
          const c: Clip = { ...clone(src), id: uid() }
          relink(c, links, all, p)
          delete c.instance
          freshCopy(c)
          // (A copy comes without its transition: phase Ç2b.2, decision 1.)
          transitionsOfCopy(c)
          p.clips[c.id] = c
          track.clipIds.push(c.id)
          newIds.push(c.id)
        }
      }, false)
      return newIds.slice(0, ids.length)
    },

    insertFreezeFrame: (holdSec = 2) => {
      const s = get()
      const t = s.currentTime
      const clipId =
        s.selectedClipIds[0] ??
        Object.values(s.project.clips).find((c) => {
          const asset = s.project.assets.find((a) => a.id === c.assetId)
          return asset?.kind === 'video' && t > c.start && t < c.start + c.duration
        })?.id
      if (!clipId) return
      if (refusedByLock([clipId], s.linkAV)) return
      mutate((p) => {
        const clip = p.clips[clipId]
        if (!clip) return
        const track = findTrack(p, clip.trackId)
        if (!track || track.locked) return
        if (t <= clip.start + 0.05 || t >= clip.start + clip.duration - 0.05) return
        const cutAt = t - clip.start
        // The frame on screen at the playhead (a backwards clip shows its
        // media from the end: timeline/media-time.ts).
        const mediaT = mediaAtLocal(clip, cutAt)
        const source = automationOf(clip)
        // What its keys show at the playhead: the held frame keeps it (phase
        // Ç2c.1, decision 5; report K5: it showed the clip's static pose, so
        // the picture jumped into and out of the hold).
        const held = {
          transform: clipTransformAt(clip, cutAt),
          opacity: clipOpacityAt(clip, cutAt),
          mask: clip.mask ? maskGeomAt(clip.mask, cutAt) : null,
          volume: automationGainAt(clip, cutAt)
        }
        // Split: left keeps the original id; right resumes after the hold.
        const right: Clip = { ...clone(clip), id: uid(), instance: instanceOf(clip) }
        // (A compound's children: ids of their own in each copy; phase 11b.)
        freshNestedIds(right)
        takePart(right, clip, cutAt, clip.duration)
        right.duration = clip.start + clip.duration - t
        right.start = t + holdSec
        takePart(clip, clip, 0, cutAt)
        clip.duration = cutAt
        // The same division a normal split does (phase Ç2c.1, decision 1).
        divideAutomation(clip, right, cutAt, source)
        // The hold itself.
        const hold: Clip = { ...clone(clip), id: uid() }
        freshNestedIds(hold)
        // The held frame is its own thing, not a piece of the footage.
        delete hold.instance
        hold.start = t
        hold.duration = holdSec
        hold.freeze = mediaT
        delete hold.speedCurve
        delete hold.transitionOut
        // A held frame animates nothing. The legacy array was cleared and the
        // per-channel one — the one clips actually use now — was not, so the
        // hold played the whole move over a frozen picture.
        delete hold.channels
        holdFxKeys(hold, cutAt)
        delete hold.volumeKeyframes
        delete hold.autoDucking
        if (hold.mask) delete hold.mask.keyframes
        hold.transform = { ...held.transform }
        hold.opacity = held.opacity
        hold.volume = held.volume
        if (hold.mask && held.mask) {
          const { points, rot, ...geom } = held.mask
          Object.assign(hold.mask, geom)
          if (rot !== undefined) hold.mask.rot = rot
          if (points) hold.mask.points = points.map((q) => ({ ...q }))
        }
        p.clips[right.id] = right
        p.clips[hold.id] = hold
        track.clipIds.push(right.id, hold.id)
        divideClipExtras(p, clip, right, cutAt + right.duration, cutAt, cutAt)
        // The hold is a still: no way in or out of its own.
        delete hold.anim
        delete hold.fadeIn
        delete hold.fadeOut
        delete hold.motionFx
        // Everything after the split point shifts right by the hold.
        for (const id of track.clipIds) {
          const other = p.clips[id]
          if (other && other.id !== clip.id && other.id !== hold.id && other.id !== right.id && other.start >= t) {
            other.start += holdSec
          }
        }
        sortTrack(p, track)
        // And the rest of the timeline with it: the other tracks (the linked
        // voice above all), markers, Shorts bands and the
        // templates. Only this track moved before, so lip-sync was off by
        // the hold from there on.
        insertTimeElsewhere(p, t, holdSec, track.id, get().linkAV ? clip.linkId : undefined)
      })
    },

    compoundSelection: () => {
      // (One child per clip, whatever the selection holds twice: phase 11b, KF7.)
      const ids = [...new Set(get().selectedClipIds)]
      if (ids.length < 2) return
      const id = uid()
      mutate((p) => {
        const picked = ids.map((i) => p.clips[i]).filter(Boolean)
        if (picked.length < 2) return
        // Only visual clips can be flattened into one image.
        if (picked.some((c) => c.adjustment)) return
        const start = Math.min(...picked.map((c) => c.start))
        const end = Math.max(...picked.map((c) => c.start + c.duration))
        // Keep the on-screen stacking: lowest video track draws first, and
        // tracks[0] is the TOP layer in the UI.
        const order = new Map(p.tracks.map((t, i) => [t.id, i]))
        const children = [...picked]
          .sort((a, b) => (order.get(b.trackId) ?? 0) - (order.get(a.trackId) ?? 0))
          .map((c) => ({ ...clone(c), start: c.start - start }))
        // A link to a clip left outside breaks here, on both sides (phase
        // Ç2a.1: the outside one lets go below, in forgetClips).
        const pickedIds = new Set(picked.map((c) => c.id))
        for (const ch of children) {
          if (ch.linkId && Object.values(p.clips).some((o) => o.linkId === ch.linkId && !pickedIds.has(o.id))) delete ch.linkId
        }
        // Host the compound on the topmost track any member occupied.
        const hostTrackId = picked.reduce((best, c) =>
          (order.get(c.trackId) ?? 0) < (order.get(best.trackId) ?? 0) ? c : best
        ).trackId
        const host = findTrack(p, hostTrackId)
        if (!host) return
        const { width, height } = p.settings
        const compound: Clip = {
          id,
          assetId: '',
          nested: { clips: children },
          trackId: host.id,
          start,
          inPoint: 0,
          duration: Math.max(0.1, end - start),
          transform: { x: width / 2, y: height / 2, scale: 1, rotation: 0 },
          volume: 1
        }
        // Remove the originals from their tracks, then drop the compound in.
        for (const c of picked) {
          const tr = findTrack(p, c.trackId)
          if (tr) tr.clipIds = tr.clipIds.filter((x) => x !== c.id)
          delete p.clips[c.id]
        }
        // The originals now live inside the compound, so any group they were in
        // must let go of them — the group can't reach inside a compound.
        forgetClips(p, picked.map((c) => c.id))
        // On the host track if it is free over the compound's span now, else
        // on a free one near it (cascading the host pushed unrelated clips).
        const target = freeTrackAt(p, 'video', host, start, start + compound.duration)
        compound.trackId = target.id
        p.clips[id] = compound
        target.clipIds.push(id)
        sortTrack(p, target)
      })
      set({ selectedClipIds: [id] })
    },

    uncompoundClip: (clipId) => {
      const ids: string[] = []
      // The compound's own animation does not go onto its children: said
      // (phase Ç2c.2, report K21).
      const own = get().project.clips[clipId]
      const animated = !!own?.nested && (!!own.channels && Object.keys(own.channels).length > 0 || !!own.mask || !!own.motionFx || !!own.anim || !!own.idle || (own.opacity ?? 1) < 1)
      mutate((p) => {
        const compound = p.clips[clipId]
        if (!compound?.nested) return
        const track = findTrack(p, compound.trackId)
        if (!track) return
        // The compound off its track first, so its own span counts as free.
        track.clipIds = track.clipIds.filter((x) => x !== clipId)
        delete p.clips[clipId]
        forgetClips(p, [clipId])
        // Children come back at their absolute times, on the compound's clock
        // (its in point and speed: a trimmed or split compound), cut to what
        // the compound showed, each on the layer it came from when that is
        // free there, else on a free one near it — never piled onto the host
        // track one after another, never pushing other clips.
        const cSpeed = Math.max(0.01, compound.speed ?? 1)
        const cIn = compound.inPoint || 0
        const cEnd = compound.start + compound.duration
        for (const child of compound.nested.clips) {
          const cs = compound.start + (child.start - cIn) / cSpeed
          const ce = cs + child.duration / cSpeed
          if (ce <= compound.start + 1e-6 || cs >= cEnd - 1e-6) continue
          const headCut = Math.max(0, compound.start - cs)
          const tailCut = Math.max(0, ce - cEnd)
          const start = cs + headCut
          const duration = ce - cs - headCut - tailCut
          // (Along a child's speed curve the part kept has its own average:
          // core polish C.)
          const part = child.speedCurve ? partOf(child, headCut * cSpeed, (headCut + duration) * cSpeed) : null
          const speed = (part?.speed ?? child.speed ?? 1) * cSpeed
          const own = findTrack(p, child.trackId)
          const kind = own?.kind ?? track.kind
          const home = own && own.kind === kind ? own : track
          const dest = freeTrackAt(p, kind, home, start, start + duration)
          const restored: Clip = {
            ...clone(child),
            id: uid(),
            trackId: dest.id,
            start,
            duration,
            inPoint: part ? part.inPoint : child.inPoint + headCut * speed,
            ...(child.speed !== undefined || cSpeed !== 1 || part ? { speed } : {})
          }
          // Its keys were on the compound's clock (its own seconds at the
          // compound's speed): on the timeline they run `cSpeed` times as fast,
          // from what the compound's window cut off its head (phase Ç2c.2,
          // report K21: they played cSpeed times too slow).
          if (headCut > 0 || cSpeed !== 1) remapClipAutomation(restored, (t) => (t - headCut * cSpeed) / cSpeed, automationOf(child))
          p.clips[restored.id] = restored
          dest.clipIds.push(restored.id)
          sortTrack(p, dest)
          ids.push(restored.id)
        }
        // A child cut off by the compound's window does not come back: its
        // link partner lets go of it (phase Ç2a.1).
        dropLoneLinks(p)
      })
      set({ selectedClipIds: ids })
      if (animated && ids.length > 0) notify({ text: t('compound.ownAnimationGone'), kind: 'info' })
    },

    addAdjustmentLayer: () => {
      const id = uid()
      const { currentTime } = get()
      mutate((p) => {
        // Topmost video track, so it sits above the footage it grades.
        const track = p.tracks.find((t) => t.kind === 'video')
        if (!track) return
        const { width, height } = p.settings
        const clip: Clip = {
          id,
          assetId: '',
          adjustment: true,
          trackId: track.id,
          start: Math.max(0, currentTime),
          inPoint: 0,
          duration: 5,
          transform: { x: width / 2, y: height / 2, scale: 1, rotation: 0 },
          volume: 0,
          grade: neutralGrade()
        }
        p.clips[id] = clip
        track.clipIds.push(id)
        settleClipOnTrack(p, track, clip)
      })
      set({ selectedClipIds: [id] })
    }
  }
}

/** The copied media into `p` (phase Ç2a.1, P5): one it has (same id, or the
 *  same file under another id) is used, one it lacks is added. Returns the
 *  copied asset id → the id in `p`. */
function pasteAssets(p: Project, assets: readonly Asset[]): Map<string, string> {
  const ids = new Map<string, string>()
  for (const a of assets) {
    const same = p.assets.find((x) => x.id === a.id) ?? (a.path ? p.assets.find((x) => x.path === a.path && x.kind === a.kind) : undefined)
    if (same) ids.set(a.id, same.id)
    else {
      p.assets.push(clone(a))
      ids.set(a.id, a.id)
    }
  }
  return ids
}

/** A copied clip with its media ids (at every depth) as they are in the
 *  project it is pasted into. */
function withAssets(c: Clip, ids: ReadonlyMap<string, string>): Clip {
  const map = (x: Clip): Clip => ({
    ...x,
    assetId: ids.get(x.assetId) ?? x.assetId,
    ...(x.cleaned ? { cleaned: { ...x.cleaned, from: ids.get(x.cleaned.from) ?? x.cleaned.from } } : {}),
    ...(x.nested ? { nested: { clips: x.nested.clips.map(map) } } : {})
  })
  return ids.size ? map(c) : c
}

/** The tracks of `scope` the project has and that are not locked (a locked
 *  one stays anyway): what the command gets, and what the version log is
 *  told stood still. None: nothing is passed, the cut is the old one. */
function keptOf(p: Project, scope: CutScope | undefined): { params: { keepTracks?: string[]; endBeds?: boolean }; meta: { fixed?: string[] } } {
  const tracks = (scope?.keepTracks ?? []).filter((id) => p.tracks.some((t) => t.id === id && !t.locked))
  if (tracks.length === 0) return { params: {}, meta: {} }
  return { params: { keepTracks: tracks, ...(scope?.endBeds ? { endBeds: true } : {}) }, meta: { fixed: tracks } }
}

/** A whole-timeline cut from `from` on leaves the locked tracks with a clip
 *  after it where they were: the user is told they are out of step now
 *  (phase Ç2b.1, decision 1). */
function tellLockedBehind(p: Project, from: number): void {
  // (body below)
  tellBehind(p, from)
}

/** A track-only close that left its gap (ops/ripple.ts closePlan: a linked
 *  pair could not stay in step): said once, with the track in the way. */
function tellGapLeft(p: Project, blockedBy: string | undefined): void {
  if (blockedBy === undefined) return
  notify({ text: t('d22b.close.gapLeft', { track: p.tracks.find((x) => x.id === blockedBy)?.name ?? blockedBy }), kind: 'info' })
}

/** The same for Alt + ripple delete: the clips are gone, their gaps stayed. */
function tellDeleteGapLeft(p: Project, blockedBy: string | undefined): void {
  if (blockedBy === undefined) return
  notify({ text: t('d22b.delete.gapLeft', { track: p.tracks.find((x) => x.id === blockedBy)?.name ?? blockedBy }), kind: 'info' })
}

/** A clip of `ids` linked to a clip on a locked track: the edit is not made
 *  for it, and the user is told (phase Ç2b.1, decision 3). Returns whether
 *  one was found. */
export function tellLockedPartner(p: Project, ids: readonly string[], link: boolean): boolean {
  const held = lockedPartner(p, ids, link)
  if (held) notify({ text: t('link.lockedPartner', { name: p.assets.find((a) => a.id === held.clip.assetId)?.name ?? held.clip.id, track: held.track }), kind: 'info' })
  return !!held
}

function tellBehind(p: Project, from: number): void {
  const behind = lockedBehind(p, from)
  if (behind.length) notify({ text: t('timeline.lockedBehind', { names: behind.map((x) => x.name).join(', '), time: from.toFixed(2) }), kind: 'info' })
}
