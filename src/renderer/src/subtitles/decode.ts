// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// How the local Whisper decode runs: how many CPU threads it gets, how many
// tokens a window may decode, and the guard against its greedy decoder
// looping. Pure: the tests drive it.

/**
 * WASM threads for the CPU model. Half the logical cores is about the
 * physical cores on a machine with two threads per core, which is where the
 * matrix maths stops getting faster; the other half stays free for the UI and
 * a render that may be running beside the transcription. At most 8 (ORT's
 * thread pool gains little past that), at least 1. `threadsUsable` is false
 * when the page has no SharedArrayBuffer (an older build): ORT then has to run
 * single-threaded, and asking for more only makes it warn.
 */
export function whisperCpuThreads(logicalCores: number | undefined, threadsUsable: boolean): number {
  if (!threadsUsable) return 1
  return Math.max(1, Math.min(8, Math.floor((logicalCores || 1) / 2)))
}

/**
 * The most tokens Whisper may decode for `seconds` of audio in `language`
 * (max_new_tokens). Left alone it runs to the 448-token end of its window on
 * music, noise or a loop, and with word timing every token keeps the
 * cross-attentions of all 24 layers (about 2.3 MB a token, twice over when
 * they are joined): about 2 GB for one runaway window. Real speech is far
 * under the cap: fast English is about 6 tokens a second, so 9 a second is
 * room enough (25 s: 233); Turkish spends about 3 tokens a word, dense
 * narration about 10 a second, so the other languages get 16 (25 s: 408).
 * Phrase timing (`phrases`) adds two timestamp tokens a phrase. Never past
 * 440: the window holds 448 positions, the prompt takes up to 4.
 */
export function whisperTokenCap(seconds: number, language: string, phrases = false): number {
  const s = Number.isFinite(seconds) && seconds > 0 ? seconds : 0
  const rate = language === 'english' ? 9 : 16
  const extra = 8 + (phrases ? Math.ceil(s) : 0)
  return Math.max(16, Math.min(440, Math.ceil(s * rate) + extra))
}

// Whisper's greedy decoder can fall into a loop on music or noise: the same
// word or phrase over and over until the 448-token cap of its 30 s window.
// Real speech never repeats a short block back to back that many times, so a
// loop is: the last block of at most 12 tokens, repeated at least 4 times in a
// row, the repeats covering at least 24 tokens together.
const MAX_BLOCK_TOKENS = 12
const MIN_REPEATS = 4
const MIN_LOOP_TOKENS = 24

export interface TailLoop {
  /** Index of the loop's first copy. */
  start: number
  /** Items in one copy of the repeated block. */
  period: number
  /** Copies back to back, the first included. */
  repeats: number
}

function sameBlock(keys: ArrayLike<unknown>, a: number, b: number, length: number): boolean {
  for (let i = 0; i < length; i++) if (keys[a + i] !== keys[b + i]) return false
  return true
}

/**
 * The loop `keys[from, end)` ends in, or null. Keys are token ids (each one
 * token) or words, whose `weights` are their token counts. The shortest
 * repeating block wins, so "la la la …" is one "la" repeated, not "la la".
 */
export function findTailLoop(
  keys: ArrayLike<unknown>,
  weights?: ArrayLike<number>,
  end = keys.length,
  from = 0
): TailLoop | null {
  for (let period = 1; period * MIN_REPEATS <= end - from; period++) {
    let tokens = 0
    for (let i = end - period; i < end; i++) tokens += weights ? weights[i] : 1
    // Every item is at least one token, so a longer block is only bigger.
    if (tokens > MAX_BLOCK_TOKENS) break
    let repeats = 1
    while (end - (repeats + 1) * period >= from && sameBlock(keys, end - (repeats + 1) * period, end - period, period)) repeats++
    if (repeats >= MIN_REPEATS && repeats * tokens >= MIN_LOOP_TOKENS) {
      return { start: end - repeats * period, period, repeats }
    }
  }
  return null
}

/**
 * `items` with a runaway loop cut down to its first copy: from the point the
 * decoder counts as looping (findTailLoop), the copies that follow are
 * dropped, and so is a last cut-off copy when the window ends in it (the token
 * cap stops mid-block). Only a loop that runs to the END of the window is cut:
 * that is the decoder that never got out (music, noise, the token cap). A
 * repeat the speech itself leaves again (a chant, a chorus, "evet evet …"
 * followed by more words) is what was said, and stays. Returns `items` itself
 * when nothing is cut, so a normal window is passed on untouched.
 */
export function trimLoops<T>(items: T[], keys: readonly unknown[], weights?: ArrayLike<number>): T[] {
  const dropped: [number, number][] = []
  let from = 0
  for (let end = 1; end <= keys.length; end++) {
    const loop = findTailLoop(keys, weights, end, from)
    if (!loop) continue
    const first = loop.start
    let stop = end
    while (stop + loop.period <= keys.length && sameBlock(keys, stop, first, loop.period)) stop += loop.period
    let partial = 0
    while (stop + partial < keys.length && keys[stop + partial] === keys[first + partial]) partial++
    if (stop + partial === keys.length) stop = keys.length
    // Speech after it: a repeat that was said, not a loop.
    if (stop < keys.length) {
      from = stop
      end = stop
      continue
    }
    dropped.push([first + loop.period, stop])
    from = stop
    end = stop
  }
  if (dropped.length === 0) return items
  return items.filter((_, i) => !dropped.some(([a, b]) => i >= a && i < b))
}
