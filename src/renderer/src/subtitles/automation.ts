// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
import type { Asset, Caption } from '../types'
import { isSubtitle } from '../types'

/** How subtitle cues are turned into units that each receive one image. */
export type SubtitleImageGroupingMode = 'cue' | 'sentence' | 'custom'

/** How the image units occupy time on the timeline. */
export type SubtitleImageTimingMode = 'exact' | 'continuous'

export interface SubtitleImageAutomationOptions {
  /** `cue` pairs every cue; `sentence` joins cues until terminal punctuation. */
  grouping?: SubtitleImageGroupingMode
  /** Explicit cue groups made in the Automation dialog. Required by `custom`. */
  customSpans?: readonly SubtitleImageSpan[]
  /** `exact` keeps subtitle bounds; `continuous` holds an image through a gap. */
  timing?: SubtitleImageTimingMode
  /** In continuous mode, let the first image also cover leading silence. */
  continuousStartAtZero?: boolean
}

/** One subtitle unit before an image has been paired with it. */
export interface SubtitleImageSpan {
  captionIds: string[]
  text: string
  start: number
  end: number
}

/** A store-ready instruction for placing one still image on a video track. */
export interface SubtitleImagePlacement extends SubtitleImageSpan {
  assetId: string
  assetName: string
  duration: number
}

/** A numbered script interval with no chosen still; reserved on the timeline. */
export interface SubtitleImageMissingSlot extends SubtitleImageSpan {
  number: number
  duration: number
}

export interface SubtitleImageCountMismatch {
  /** Number of cue/sentence spans that require an image. */
  spanCount: number
  /** Number of usable image assets found in the project. */
  imageCount: number
}

export interface SubtitleImageAutomationPlan {
  /** Empty when `mismatch` is non-null; automation is deliberately all-or-none. */
  placements: SubtitleImagePlacement[]
  /** Numbered alternatives only; these become clickable, non-rendering slots. */
  missingSlots: SubtitleImageMissingSlot[]
  mismatch: SubtitleImageCountMismatch | null
  /** Valid subtitle cues before optional sentence grouping. */
  cueCount: number
  spanCount: number
  imageCount: number
}

export interface NumberedSubtitleImageSelection {
  /** One-based script/image number. */
  number: number
  asset: Asset
}


const naturalName = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' })

// Terminal punctuation may be followed by one or more closing quotes/brackets:
//   He said "go."   (Really?!)   Finished…"
const SENTENCE_END = /[.!?…](?:["'’”»›)\]}\u3009》」』】〕〗〙〛）]+)?\s*$/u

/** Subtitle cues that are safe to use as timeline intervals, in time order. */
export function validAutomationSubtitleCues(captions: readonly Caption[]): Caption[] {
  return captions
    .map((caption, index) => ({ caption, index }))
    .filter(
      ({ caption }) =>
        isSubtitle(caption) &&
        caption.text.trim().length > 0 &&
        Number.isFinite(caption.start) &&
        Number.isFinite(caption.end) &&
        caption.start >= 0 &&
        caption.end > caption.start
    )
    .sort(
      (a, b) =>
        a.caption.start - b.caption.start ||
        a.caption.end - b.caption.end ||
        a.index - b.index
    )
    .map(({ caption }) => caption)
}

/** Non-missing still assets, naturally ordered (`1`, `2`, `10`, not lexical). */
export function automationImageAssets(assets: readonly Asset[]): Asset[] {
  return assets
    .map((asset, index) => ({ asset, index }))
    .filter(({ asset }) => asset.kind === 'image' && !asset.missing)
    .sort((a, b) => naturalName.compare(a.asset.name, b.asset.name) || a.index - b.index)
    .map(({ asset }) => asset)
}

/** First number in a filename: `17.png`, `image_017.webp` and `17-alt.jpg` share slot 17. */
export function automationImageSequenceNumber(name: string): number | null {
  const stem = name.replace(/\.[^.]+$/, '')
  const match = stem.match(/\d+/)
  if (!match) return null
  const value = Number(match[0])
  return Number.isSafeInteger(value) && value >= 0 ? value : null
}

function cueSpan(caption: Caption): SubtitleImageSpan {
  return {
    captionIds: [caption.id],
    text: caption.text.trim(),
    start: caption.start,
    end: caption.end
  }
}

/** Builds cue-sized or punctuation-delimited sentence-sized subtitle spans. */
export function buildSubtitleImageSpans(
  captions: readonly Caption[],
  grouping: Exclude<SubtitleImageGroupingMode, 'custom'> = 'cue'
): SubtitleImageSpan[] {
  const cues = validAutomationSubtitleCues(captions)
  if (grouping === 'cue') return cues.map(cueSpan)

  const spans: SubtitleImageSpan[] = []
  let open: SubtitleImageSpan | null = null

  const flush = (): void => {
    if (open) spans.push(open)
    open = null
  }

  for (const cue of cues) {
    const text = cue.text.trim()
    if (!open) {
      open = cueSpan(cue)
    } else {
      open.captionIds.push(cue.id)
      open.text = `${open.text} ${text}`
      // Usually this is simply cue.end. Math.max keeps a malformed overlapping
      // SRT from making the combined sentence end before one of its own cues.
      open.end = Math.max(open.end, cue.end)
    }
    if (SENTENCE_END.test(text)) flush()
  }
  // Whisper/SRT text does not always finish with punctuation. It is still a
  // useful final unit and must not disappear from the automation plan.
  flush()
  return spans
}

/**
 * Builds hand-adjustable groups from cue ids that start a new image.
 *
 * The first valid cue always starts a group. `textEdits` are kept local to the
 * dialog until Apply, so changing a pairing boundary or fixing a typo remains
 * part of the same single Undo step as placing the images.
 */
export function buildCustomSubtitleImageSpans(
  captions: readonly Caption[],
  groupStartIds: ReadonlySet<string>,
  textEdits: Readonly<Record<string, string>> = {}
): SubtitleImageSpan[] {
  const cues = validAutomationSubtitleCues(captions)
  const spans: SubtitleImageSpan[] = []
  for (const cue of cues) {
    const text = (textEdits[cue.id] ?? cue.text).trim()
    const startsGroup = spans.length === 0 || groupStartIds.has(cue.id)
    if (startsGroup) {
      spans.push({ captionIds: [cue.id], text, start: cue.start, end: cue.end })
      continue
    }
    const span = spans[spans.length - 1]
    span.captionIds.push(cue.id)
    if (text) span.text = span.text ? `${span.text} ${text}` : text
    span.end = Math.max(span.end, cue.end)
  }
  return spans
}

/**
 * Pairs subtitle spans with naturally sorted images.
 *
 * A count mismatch never returns a partial placement list: applying half a
 * plan would shift every later sentence onto the wrong image while appearing
 * to have succeeded.
 */
export function planSubtitleImageAutomation(
  captions: readonly Caption[],
  assets: readonly Asset[],
  options: SubtitleImageAutomationOptions = {}
): SubtitleImageAutomationPlan {
  const grouping = options.grouping ?? 'cue'
  const timing = options.timing ?? 'exact'
  const cues = validAutomationSubtitleCues(captions)
  const spans =
    grouping === 'custom'
      ? [...(options.customSpans ?? [])].map((span) => ({ ...span, captionIds: [...span.captionIds] }))
      : buildSubtitleImageSpans(cues, grouping)
  const images = automationImageAssets(assets)
  const counts = { cueCount: cues.length, spanCount: spans.length, imageCount: images.length }

  if (spans.length !== images.length) {
    return {
      placements: [],
      missingSlots: [],
      mismatch: { spanCount: spans.length, imageCount: images.length },
      ...counts
    }
  }

  const placements = spans.map((span, index): SubtitleImagePlacement => {
    let start = span.start
    let end = span.end
    if (timing === 'continuous') {
      if (index === 0 && options.continuousStartAtZero) start = 0
      // Fill genuine silence with the preceding image, but never shorten an
      // image when malformed/overlapping subtitle cues cross each other.
      const next = spans[index + 1]
      if (next) end = Math.max(end, next.start)
    }
    const asset = images[index]
    return {
      assetId: asset.id,
      assetName: asset.name,
      captionIds: [...span.captionIds],
      text: span.text,
      start,
      end,
      duration: end - start
    }
  })

  return { placements, missingSlots: [], mismatch: null, ...counts }
}

/**
 * Places an explicitly numbered subset without shifting later images.
 *
 * Unlike filename-order automation, a missing numbered image is unambiguous:
 * image 51 still belongs to subtitle span 51 when image 50 is absent. The
 * missing span is therefore reserved as a non-rendering timeline slot instead
 * of blocking every valid pair.
 */
export function planNumberedSubtitleImageAutomation(
  captions: readonly Caption[],
  spans: readonly SubtitleImageSpan[],
  selections: readonly NumberedSubtitleImageSelection[],
  options: Pick<SubtitleImageAutomationOptions, 'timing' | 'continuousStartAtZero'> = {}
): SubtitleImageAutomationPlan {
  const cues = validAutomationSubtitleCues(captions)
  const timing = options.timing ?? 'exact'
  const byNumber = new Map(
    selections
      .filter(
        ({ number, asset }) =>
          Number.isInteger(number) &&
          number >= 1 &&
          number <= spans.length &&
          automationImageAssets([asset]).length === 1
      )
      .map(({ number, asset }) => [number, asset])
  )

  const timedSlots = spans.map((span, index) => {
    let start = span.start
    let end = span.end
    if (timing === 'continuous') {
      if (index === 0 && options.continuousStartAtZero) start = 0
      // Use the next numbered span, not the next available image. This keeps
      // an absent slot empty and prevents the previous still covering it.
      const next = spans[index + 1]
      if (next) end = Math.max(end, next.start)
    }
    return { ...span, captionIds: [...span.captionIds], number: index + 1, start, end, duration: end - start }
  })
  const placements = timedSlots.flatMap((slot): SubtitleImagePlacement[] => {
    const asset = byNumber.get(slot.number)
    return asset ? [
      {
        assetId: asset.id,
        assetName: asset.name,
        captionIds: slot.captionIds,
        text: slot.text,
        start: slot.start,
        end: slot.end,
        duration: slot.duration
      }
    ] : []
  })
  const missingSlots = timedSlots.filter((slot) => !byNumber.has(slot.number))

  return {
    placements,
    missingSlots,
    mismatch: null,
    cueCount: cues.length,
    spanCount: spans.length,
    imageCount: placements.length
  }
}
