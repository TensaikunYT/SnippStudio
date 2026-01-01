// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// "Fit to voice" (SnippStudio cila O, CILA-O-PLAN.md K3): the pictures picked
// in the Media panel laid on the voice, in one of three ways, as placements
// for `automation.placeImages` on a new AUTO layer (one undo step):
//   numbers  picture n on subtitle line n (the first number in its file name),
//            each held until the next line starts; a number between the
//            first and the last picked that has no picture becomes the
//            timeline's "picture #n missing" slot;
//   even     the pictures, in name order, over the voice in equal parts (the
//            voice: from 0 to the end of the last subtitle line, else the
//            span of the clips on the sound tracks);
//   range    the same equal parts over the selected range.
// Pure: the project and the range in, a plan out. The automation planner it
// builds on is the one the agent's `image_plan` uses (subtitles/automation.ts).
import { projectDuration, type Project } from '../types'
import { markedRange, type ExportMarks } from '../export/marks'
import {
  automationImageAssets,
  automationImageSequenceNumber,
  buildSubtitleImageSpans,
  planNumberedSubtitleImageAutomation,
  type SubtitleImageMissingSlot,
  type SubtitleImagePlacement
} from './automation'

export type FitVoiceMode = 'numbers' | 'even' | 'range'

/** A picture is on screen at least this long, or the plan is refused. */
export const FIT_MIN_SECONDS = 0.1

export type FitVoiceBlock = 'noPictures' | 'noSubtitles' | 'noNumbers' | 'noVoice' | 'noRange' | 'tooShort'

export interface FitVoicePlan {
  placements: SubtitleImagePlacement[]
  /** numbers only: lines between the first and the last number with no picture. */
  missingSlots: SubtitleImageMissingSlot[]
  /** numbers only: pictures left out (no number in the name, a number past the
   *  last line, or a number another picture already took). */
  skipped: number
  /** Where the pictures go, start to end; null when nothing can be placed. */
  span: [number, number] | null
  /** Why nothing can be placed (null: it can). */
  blocked: FitVoiceBlock | null
}

const none = (blocked: FitVoiceBlock, skipped = 0): FitVoicePlan => ({ placements: [], missingSlots: [], skipped, span: null, blocked })

/** The picked assets that are pictures (there, not missing), in name order. */
export function fitPictures(project: Project, ids: readonly string[]): Project['assets'] {
  const picked = new Set(ids)
  return automationImageAssets(project.assets.filter((a) => picked.has(a.id)))
}

/** The voice: 0 to the end of the last subtitle line; without subtitles, the
 *  span of the clips on the sound tracks; null without either. */
export function voiceSpan(project: Project): [number, number] | null {
  const cues = buildSubtitleImageSpans(project.captions, 'cue')
  if (cues.length) return [0, Math.max(...cues.map((c) => c.end))]
  let a = Infinity
  let b = -Infinity
  for (const track of project.tracks) {
    if (track.kind !== 'audio') continue
    for (const id of track.clipIds) {
      const clip = project.clips[id]
      if (!clip || clip.disabled || !(clip.duration > 0)) continue
      a = Math.min(a, clip.start)
      b = Math.max(b, clip.start + clip.duration)
    }
  }
  return b > a ? [a, b] : null
}

/** What the editor has selected as a range, in this order: the in and out
 *  points (I / O), the loop, two cut marks, the span of the selected clips. */
export function selectedSpan(
  project: Project,
  ui: { marks: ExportMarks; loopRange: [number, number] | null; cutMarks: readonly number[]; selectedClipIds: readonly string[] }
): [number, number] | null {
  const marked = markedRange(ui.marks, projectDuration(project))
  if (marked) return marked
  if (ui.loopRange && ui.loopRange[1] > ui.loopRange[0]) return [ui.loopRange[0], ui.loopRange[1]]
  if (ui.cutMarks.length >= 2) {
    const a = Math.min(...ui.cutMarks)
    const b = Math.max(...ui.cutMarks)
    if (b > a) return [a, b]
  }
  const clips = ui.selectedClipIds.map((id) => project.clips[id]).filter((c) => !!c)
  if (clips.length) {
    const a = Math.min(...clips.map((c) => c.start))
    const b = Math.max(...clips.map((c) => c.start + c.duration))
    if (b > a) return [a, b]
  }
  return null
}

/** The pictures over [a, b] in equal parts, in name order. */
function evenly(pictures: Project['assets'], span: [number, number] | null, missing: FitVoiceBlock): FitVoicePlan {
  if (!pictures.length) return none('noPictures')
  if (!span) return none(missing)
  const [a, b] = span
  const step = (b - a) / pictures.length
  if (!(step >= FIT_MIN_SECONDS)) return none('tooShort')
  const placements = pictures.map((asset, i): SubtitleImagePlacement => {
    const start = a + i * step
    const end = i === pictures.length - 1 ? b : a + (i + 1) * step
    return { assetId: asset.id, assetName: asset.name, captionIds: [], text: '', start, end, duration: end - start }
  })
  return { placements, missingSlots: [], skipped: 0, span: [a, b], blocked: null }
}

/** Picture n on subtitle line n (see the head of this file). */
function byNumbers(project: Project, pictures: Project['assets']): FitVoicePlan {
  if (!pictures.length) return none('noPictures')
  const spans = buildSubtitleImageSpans(project.captions, 'cue')
  if (!spans.length) return none('noSubtitles')
  const byNumber = new Map<number, Project['assets'][number]>()
  let skipped = 0
  for (const asset of pictures) {
    const n = automationImageSequenceNumber(asset.name)
    if (n === null || n < 1 || n > spans.length || byNumber.has(n)) skipped++
    else byNumber.set(n, asset)
  }
  if (!byNumber.size) return none('noNumbers', skipped)
  const numbers = [...byNumber.keys()]
  const lo = Math.min(...numbers)
  const hi = Math.max(...numbers)
  const plan = planNumberedSubtitleImageAutomation(
    project.captions,
    spans.slice(0, hi),
    [...byNumber].map(([number, asset]) => ({ number, asset })),
    { timing: 'continuous', continuousStartAtZero: true }
  )
  const missingSlots = plan.missingSlots.filter((slot) => slot.number >= lo)
  const all = [...plan.placements, ...missingSlots]
  if (all.some((x) => !(x.end - x.start >= FIT_MIN_SECONDS))) return none('tooShort', skipped)
  const span: [number, number] = [Math.min(...all.map((x) => x.start)), Math.max(...all.map((x) => x.end))]
  return { placements: plan.placements, missingSlots, skipped, span, blocked: null }
}

/** The plan for one way of fitting the picked pictures. `range` is the
 *  selected range (selectedSpan), read only by the 'range' way. */
export function planFitVoice(project: Project, pictureIds: readonly string[], mode: FitVoiceMode, range: [number, number] | null): FitVoicePlan {
  const pictures = fitPictures(project, pictureIds)
  if (mode === 'numbers') return byNumbers(project, pictures)
  if (mode === 'even') return evenly(pictures, voiceSpan(project), 'noVoice')
  return evenly(pictures, range, 'noRange')
}

/** The way the window opens on: by numbers when there are subtitles and a
 *  picked picture carries a number, else equal parts over the voice. */
export function defaultFitMode(project: Project, pictureIds: readonly string[]): FitVoiceMode {
  const numbered = fitPictures(project, pictureIds).some((a) => automationImageSequenceNumber(a.name) !== null)
  return numbered && buildSubtitleImageSpans(project.captions, 'cue').length > 0 ? 'numbers' : 'even'
}
