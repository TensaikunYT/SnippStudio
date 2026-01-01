// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
import type { Caption, CaptionWord } from '../types'

export interface CaptionSplitPlan {
  leftText: string
  rightText: string
  leftEnd: number
  rightStart: number
  rightEnd: number
  leftWords?: CaptionWord[]
  rightWords?: CaptionWord[]
}

const MIN_CUE = 0.1

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

/** Finds the closest gap between words. Clicking in the middle of a word is
 * forgiving: the nearest word boundary wins instead of cutting the word. */
function nearestWordGap(text: string, cursor: number): number | null {
  const at = clamp(Math.round(cursor), 0, text.length)
  let best: number | null = null
  let bestDistance = Infinity
  for (let i = 1; i < text.length; i++) {
    if (!/\s/u.test(text[i - 1]) && !/\s/u.test(text[i])) continue
    if (!text.slice(0, i).trim() || !text.slice(i).trim()) continue
    const distance = Math.abs(i - at)
    if (distance < bestDistance) {
      best = i
      bestDistance = distance
    }
  }
  return best
}

function joinsPreviousWord(text: string): boolean {
  return /^[,.;:!?…、。，！？؛؟%‰”’»›)\]}]+$/u.test(text)
}

/** Turns Whisper chunks into the same whitespace-delimited words the editor
 * shows. In particular, Whisper may timestamp a comma as a separate chunk
 * while the editor displays `word,`; treating those as different word counts
 * discarded accurate timings and made a manual split fall back to estimation. */
function editorTimedWords(words: CaptionWord[]): CaptionWord[] {
  const expanded: CaptionWord[] = []
  for (const raw of words) {
    if (!Number.isFinite(raw.start) || !Number.isFinite(raw.end) || raw.end < raw.start) continue
    const parts = raw.text.trim().split(/\s+/u).filter(Boolean)
    if (parts.length === 0) continue
    const duration = Math.max(0, raw.end - raw.start)
    for (let index = 0; index < parts.length; index++) {
      const text = parts[index]
      const start = raw.start + duration * (index / parts.length)
      const end = raw.start + duration * ((index + 1) / parts.length)
      if (joinsPreviousWord(text) && expanded.length > 0) {
        const previous = expanded[expanded.length - 1]
        previous.text += text
        if (Number.isFinite(end)) previous.end = Math.max(previous.end, end)
        if (raw.estimated) previous.estimated = true
      } else {
        expanded.push({ text, start, end, ...(raw.estimated ? { estimated: true } : {}) })
      }
    }
  }
  return expanded
}

function wordKey(text: string): string {
  return text.normalize('NFKC').toLocaleLowerCase().replace(/^[\p{P}\p{S}]+|[\p{P}\p{S}]+$/gu, '')
}

/** Reconcile visible words with Whisper chunks. A visible token may span
 * multiple timed fragments (`1` + `.4`, `enerjinin` + `%20'sini`). Preserve
 * every exact word anchor; estimate only genuinely inserted/replaced text,
 * never redistribute the entire cue because one token was split differently. */
export function alignCaptionWordsToText(
  words: CaptionWord[],
  text: string,
  captionStart: number,
  captionEnd: number
): CaptionWord[] {
  const textWords = text.trim().split(/\s+/u).filter(Boolean)
  if (textWords.length === 0) return []
  const source = editorTimedWords(words)
  const m = source.length
  const n = textWords.length
  type Step = { kind: 'match' | 'replace' | 'delete' | 'insert'; take: number }
  const cost = Array.from({ length: m + 1 }, () => Array<number>(n + 1).fill(Infinity))
  const steps = Array.from({ length: m + 1 }, () => Array<Step | null>(n + 1).fill(null))
  cost[m][n] = 0
  for (let i = m; i >= 0; i--) {
    for (let j = n; j >= 0; j--) {
      if (i === m && j === n) continue
      const offer = (value: number, step: Step): void => {
        if (value < cost[i][j]) {
          cost[i][j] = value
          steps[i][j] = step
        }
      }
      if (i < m && j < n) {
        let joined = ''
        for (let take = 1; take <= Math.min(4, m - i); take++) {
          joined += source[i + take - 1].text
          if (wordKey(joined) === wordKey(textWords[j])) {
            offer((take - 1) * 0.02 + cost[i + take][j + 1], { kind: 'match', take })
          }
        }
        offer(1.5 + cost[i + 1][j + 1], { kind: 'replace', take: 1 })
      }
      if (i < m) offer(1.1 + cost[i + 1][j], { kind: 'delete', take: 1 })
      if (j < n) offer(1.1 + cost[i][j + 1], { kind: 'insert', take: 0 })
    }
  }

  const aligned: Array<CaptionWord | undefined> = new Array(n)
  let i = 0
  let j = 0
  while (i < m || j < n) {
    const step = steps[i][j]
    if (!step) break
    if (step.kind === 'match') {
      const group = source.slice(i, i + step.take)
      aligned[j] = {
        text: textWords[j], start: group[0].start, end: group[group.length - 1].end,
        ...(group.some((word) => word.estimated) ? { estimated: true } : {})
      }
      i += step.take
      j++
    } else if (step.kind === 'replace') {
      aligned[j] = { ...source[i], text: textWords[j], estimated: true }
      i++
      j++
    } else if (step.kind === 'delete') {
      i++
    } else {
      j++
    }
  }

  // Fill only inserted runs between intact neighbouring anchors. A wholly
  // rewritten cue has no anchors and necessarily falls back to its own span.
  for (let from = 0; from < n;) {
    if (aligned[from]) { from++; continue }
    let to = from + 1
    while (to < n && !aligned[to]) to++
    const start = aligned[from - 1]?.end ?? captionStart
    const end = Math.max(start, aligned[to]?.start ?? captionEnd)
    const weights = textWords.slice(from, to).map((word) => Math.max(1, [...word].length))
    const total = weights.reduce((sum, weight) => sum + weight, 0)
    let cursor = start
    for (let k = from; k < to; k++) {
      const next = k === to - 1 ? end : cursor + (end - start) * weights[k - from] / total
      aligned[k] = { text: textWords[k], start: cursor, end: next, estimated: true }
      cursor = next
    }
    from = to
  }
  return aligned as CaptionWord[]
}

/**
 * Plans a two-cue split at the word gap nearest the text cursor.
 *
 * Keep exact Whisper anchors for unchanged words even when the user edits
 * nearby text. Only text without an anchor (such as an SRT cue) uses a
 * proportional estimate within the original cue.
 */
export function planCaptionSplit(caption: Caption, text: string, cursor: number, nextCueStart = Infinity): CaptionSplitPlan | null {
  if (caption.shape || caption.end - caption.start < MIN_CUE * 2) return null
  const gap = nearestWordGap(text, cursor)
  if (gap === null) return null
  const leftText = text.slice(0, gap).trim()
  const rightText = text.slice(gap).trim()
  if (!leftText || !rightText) return null

  const leftCount = leftText.split(/\s+/u).filter(Boolean).length
  let timedWords: CaptionWord[] | undefined
  if (caption.words && caption.words.length > 0) {
    const visibleWords = text.trim().split(/\s+/u).filter(Boolean)
    // A cue whose visible tokens already match its timing row needs no
    // reconciliation. In particular, keep hand-adjusted word ends byte-for-
    // byte: realignment can otherwise turn an edited silence gap into an
    // estimated interval when the subtitle is split later.
    timedWords = caption.words.length === visibleWords.length &&
      caption.words.every((word, index) => wordKey(word.text) === wordKey(visibleWords[index]))
      ? caption.words.map((word) => ({ ...word }))
      : alignCaptionWordsToText(caption.words, text, caption.start, caption.end)
  }

  // A legacy trim or earlier edit may have shortened the cue without moving
  // its word timestamps. Let the surviving words define the real right edge,
  // but never extend into the next subtitle on the same lane.
  const lastWordEnd = timedWords?.at(-1)?.end
  const rightEnd = Math.min(nextCueStart, Math.max(caption.end,
    lastWordEnd !== undefined && Number.isFinite(lastWordEnd) && lastWordEnd - caption.end <= 3 ? lastWordEnd : caption.end))
  if (rightEnd - caption.start < MIN_CUE * 2) return null

  const fallback = clamp(
    caption.start + (rightEnd - caption.start) * (leftText.length / (leftText.length + rightText.length)),
    caption.start + MIN_CUE,
    rightEnd - MIN_CUE
  )
  let leftEnd = fallback
  let rightStart = fallback

  if (timedWords && leftCount > 0 && leftCount < timedWords.length) {
    const before = timedWords[leftCount - 1]
    const after = timedWords[leftCount]
    // Do not clamp a real word onset to the previous (possibly stale) cue
    // end. If the right word cannot fit before the next cue, an estimated
    // character split is safer than claiming its original timing is exact.
    if (Number.isFinite(after.start) && after.start >= caption.start + MIN_CUE && after.start <= rightEnd - MIN_CUE) {
      rightStart = after.start
      leftEnd = Number.isFinite(before.end)
        ? clamp(before.end, caption.start + MIN_CUE, rightStart)
        : fallback
    }
    // The word on the right owns the split boundary. Older code moved both
    // cues to their midpoint when timestamps overlapped, which made the right
    // word appear before its actual Whisper start. Keep that start exact and
    // shorten only the cue on the left.
    if (leftEnd > rightStart) {
      leftEnd = rightStart
    }
  }

  return {
    leftText,
    rightText,
    leftEnd,
    rightStart,
    rightEnd,
    ...(timedWords
      ? { leftWords: timedWords.slice(0, leftCount), rightWords: timedWords.slice(leftCount) }
      : {})
  }
}
