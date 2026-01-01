// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// Retakes: the same (or nearly the same) sentence said twice in a row â€” the
// speaker stumbled, stopped and said it again. Found from the words alone,
// pure (SnippStudio phase 4A). Each finding is two ranges and which one to
// drop (the earlier take, by default: the later one is usually the good one).
//
// How: at every place a new sentence can start (after a sentence-ending mark
// or a pause), the words just before it are compared with the same number of
// words just after it, for every sentence start within reach before it. Two
// stretches whose folded words (case, accents, punctuation folded; Turkish
// and English alike) agree by at least `minSimilarity` (word-sequence LCS
// against the longer one) are two takes. The longest such stretch wins.
import { endsSentence, exactWord, foldWord, guessedTime, type FlatWord } from './words'

/** A word that ends a clause ("render," "then;"). */
const endsClause = (w: string): boolean => /[,;:]["'”’)\]]*$/.test(w.trim())

export interface RepeatFinding {
  /** Word indices (into the flat list) of each take: [first, last]. */
  firstWords: [number, number]
  secondWords: [number, number]
  /** Timeline seconds of each take (first word's start, last word's end). */
  first: [number, number]
  second: [number, number]
  /** Which take to drop: the earlier one by default. */
  drop: 'first' | 'second'
  /** The range that takes the dropped take out (and the pause after it). */
  cut: [number, number]
  /** 0..1, how alike the two takes' words are. */
  similarity: number
  words: number
  /** The words that differ (as written), the first take's and the second's:
   *  empty when the two takes are word for word the same. */
  differ: [string[], string[]]
  /** A word of either take has no measured time (a line without word
   *  times, its words spread evenly, or estimated times: phase 4A.11, N2):
   *  the cut's seconds are a guess. */
  guessed?: boolean
  /** Why it is not sure, said in its line ("gap 128.6 s", "under 5 words",
   *  "ends with ?", "guessed times"…); empty when sure (phase 4A.11, N1). */
  why?: string[]
  /** Not surely a retake: listed, not cut unless asked. SURE is only this
   *  (phase 4A.11, N1; before it 4A.9 and 4A.10, D2 / D3), ALL of: (1) the
   *  words letter for letter the same (Turkish lower case, punctuation off,
   *  accents and ı / i NOT folded: exactWord); (2) both sentences end with
   *  the same mark, and not ? or !; (3) five words or more; (4) every word of
   *  both takes with a measured time; (5) back to back: the second take
   *  starts at most 1.5 s after the first ends, no written word between;
   *  (6) not said a third time. The first take starts a sentence.
   *  Two takes that differ by one word are as often two different sentences
   *  ("It was the best of times. It was the worst of times.", "First, …
   *  Second, …", 100 / 200 lira, yapacağız / yapmayacağız) as a corrected
   *  slip: only the agent, reading the words, can tell. A repetition after a
   *  comma or a line break ("Never give up, never give up."), of one or two
   *  words ("Hayır. Hayır."), or a line said three times (a refrain) is as
   *  often meant as it is a slip. */
  uncertain?: boolean
}

export interface RepeatOptions {
  /** At least this alike (0..1). Default 0.8. */
  minSimilarity?: number
  /** The longest take compared, in words. Default 60. */
  maxWords?: number
  /** A pause this long (seconds) can start a sentence. Default 0.3. */
  pause?: number
  /** A take of one word counts only when it is a whole sentence at least
   *  this many letters long. Default 3. */
  minSingle?: number
}

const ms = (t: number): number => Math.round(t * 1000) / 1000

/** A sure retake has at least this many words (phase 4A.11, N1). */
const SURE_WORDS = 5
/** …and its second take starts at most this long after the first ends. */
const SURE_GAP = 1.5
/** The mark a sentence ends with ('.', '…', '?', '!'; '' for none). */
function endMark(w: string): string {
  const m = /([.!?…]+)["'”’)\]]*$/.exec(w.trim())
  if (!m) return ''
  if (m[1].includes('?')) return '?'
  if (m[1].includes('!')) return '!'
  return m[1] === '.' ? '.' : '…'
}

/** Speech the recogniser wrote no words for, right after a sentence and
 *  about as long as it (phase 4A.8, T6). Whisper often writes a sentence said
 *  twice only once: this MAY be that second take. It may as well be another
 *  sentence it missed, a held sound, a laugh: only the lengths are compared,
 *  not what is said (phase 4A.9, V-analysis-tools-tests-3). So it is listed
 *  under its own heading and is in no default apply. */
export interface UnwrittenRetake {
  /** The sentence that was written (word indices into the flat list). */
  sentenceWords: [number, number]
  sentence: [number, number]
  /** The voiced stretch with no words right after it. */
  gap: [number, number]
  /** What to cut: the stretch (the written take, with its subtitles, stays). */
  cut: [number, number]
}

/**
 * Stretches of speech-level sound with no word, right after a sentence and
 * about as long as it: the sentence said again, unwritten. `dbs` are the
 * voice clip's loudness windows (`win` s, the first at `offset`), `thr` its
 * speech threshold. Pure.
 */
export function unwrittenRetakes(words: readonly FlatWord[], dbs: readonly number[], win: number, offset: number, thr: number, pause = 0.3): UnwrittenRetake[] {
  const out: UnwrittenRetake[] = []
  const voiced = (a: number, b: number): number => {
    let n = 0
    for (let i = Math.max(0, Math.ceil((a - offset) / win)); i < Math.min(dbs.length, Math.floor((b - offset) / win)); i++) if (dbs[i] >= thr) n++
    return n * win
  }
  // The whole sentence: back to a sentence end or a clear pause (a comma or
  // a line break is inside a sentence here).
  const startsAt = (k: number): boolean => k <= 0 || endsSentence(words[k - 1].text) || words[k].start - words[k - 1].end >= Math.max(pause, 0.5) - 1e-9
  for (let g = 0; g + 1 < words.length; g++) {
    const a = words[g].end
    const b = words[g + 1].start
    if (b - a < 0.8 || !endsSentence(words[g].text) && b - a < 1.2) continue
    // Only measured word times can bound a stretch with no words: a line
    // without word times has its words spread evenly, and the line's own
    // speech may run past its last guessed word (V-analysis-tools-tests-4).
    if (guessedTime(words[g]) || guessedTime(words[g + 1])) continue
    // The sentence that ends at word g.
    let i0 = g
    while (i0 > 0 && !startsAt(i0) && g - i0 < 60) i0--
    // Its sound and the gap's, measured alike (voiced windows).
    const dur = voiced(words[i0].start, words[g].end)
    if (dur < 0.5) continue
    const said = voiced(a + 0.05, b - 0.05)
    if (said < 0.5 || Math.abs(said - dur) > 0.35 * dur + 0.3) continue
    out.push({ sentenceWords: [i0, g], sentence: [words[i0].start, words[g].end], gap: [a, b], cut: [ms(a + 0.1), ms(Math.max(a + 0.1, b - 0.1))] })
  }
  return out
}

/** The positions of `a` and of `b` that are NOT in their longest common
 *  subsequence (the words that differ). */
function unmatched(a: readonly string[], b: readonly string[]): [number[], number[]] {
  const m = a.length
  const n = b.length
  const t: number[][] = Array.from({ length: m + 1 }, () => new Array<number>(n + 1).fill(0))
  for (let i = m - 1; i >= 0; i--) for (let j = n - 1; j >= 0; j--) t[i][j] = a[i] === b[j] ? t[i + 1][j + 1] + 1 : Math.max(t[i + 1][j], t[i][j + 1])
  const ua: number[] = []
  const ub: number[] = []
  let i = 0
  let j = 0
  while (i < m && j < n) {
    if (a[i] === b[j]) {
      i++
      j++
    } else if (t[i + 1][j] >= t[i][j + 1]) ua.push(i++)
    else ub.push(j++)
  }
  while (i < m) ua.push(i++)
  while (j < n) ub.push(j++)
  return [ua, ub]
}

/** Longest common subsequence length of two token lists. */
function lcs(a: readonly string[], b: readonly string[]): number {
  const m = a.length
  const n = b.length
  let prev = new Uint16Array(n + 1)
  let cur = new Uint16Array(n + 1)
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) cur[j] = a[i - 1] === b[j - 1] ? prev[j - 1] + 1 : Math.max(prev[j], cur[j - 1])
    ;[prev, cur] = [cur, prev]
    cur.fill(0)
  }
  return prev[n]
}

export function findRepeats(words: readonly FlatWord[], opts: RepeatOptions = {}): RepeatFinding[] {
  const minSim = opts.minSimilarity ?? 0.8
  const maxWords = opts.maxWords ?? 60
  const pause = opts.pause ?? 0.3
  const minSingle = opts.minSingle ?? 3
  // Folded tokens; words that fold to nothing ("â€”") are left out.
  const idx: number[] = []
  const tok: string[] = []
  words.forEach((w, i) => {
    const f = foldWord(w.text)
    if (f) {
      idx.push(i)
      tok.push(f)
    }
  })
  const n = tok.length
  /** May a sentence (or a take) start at token k? After a sentence end, a
   *  pause, and — what a recogniser writes for a restart (phase 4A.8, T6) —
   *  after a comma or semicolon, or where a new subtitle line begins. */
  const starts = (k: number): boolean => {
    if (k <= 0) return true
    const prev = words[idx[k - 1]]
    const here = words[idx[k]]
    return endsSentence(prev.text) || endsClause(prev.text) || here.capIdx !== prev.capIdx || here.start - prev.end >= pause - 1e-9
  }
  const isStart = Array.from({ length: n + 1 }, (_, k) => (k < n ? starts(k) : true))
  /** A place a whole SENTENCE starts (or the text ends): after a sentence
   *  end or a clear pause. A comma or a new subtitle line is not one. */
  const strong = (k: number): boolean => {
    if (k <= 0 || k >= n) return true
    const prev = words[idx[k - 1]]
    return endsSentence(prev.text) || words[idx[k]].start - prev.end >= pause - 1e-9
  }
  /** Is the stretch of `k` tokens at `at` said anywhere else as well (a
   *  third time: a refrain)? */
  const saidAgain = (at: number, k: number, not: number): boolean => {
    for (let p = 0; p + k <= n; p++) {
      if (p === at || p === not || !isStart[p]) continue
      let same = true
      for (let i = 0; i < k && same; i++) same = tok[p + i] === tok[at + i]
      if (same) return true
    }
    return false
  }
  const out: RepeatFinding[] = []
  let next = 1
  for (let j = 1; j < n; j++) {
    if (j < next || !isStart[j]) continue
    let best: { k: number; sim: number } | null = null
    // Every sentence start b before j within reach: the first take is b..j-1.
    for (let b = j - 1; b >= Math.max(0, j - maxWords); b--) {
      // A first take may begin inside a line the recogniser merged with the
      // sentence before it ("…gösteriyor ama hepsi … uğraşıyor. Ama hepsi …"):
      // then only a long, nearly identical take counts (phase 4A.8, T6).
      const merged = !isStart[b]
      if (merged && j - b < 4) continue
      const k = j - b
      if (j + k > n) continue
      const A = tok.slice(b, j)
      const B = tok.slice(j, j + k)
      if (k === 1) {
        // One word said twice where takes can start (both sides of the first,
        // the start of the second), long enough to mean it: listed as
        // uncertain (an emphasis as often as a retake).
        if (!(A[0] === B[0] && A[0].length >= minSingle)) continue
      } else if (endsSentence(words[idx[j - 1]].text) && !isStart[j + k]) {
        // A whole sentence, and B only the start of a longer one: an anaphora
        // ("We shall fight on the beaches. We shall fight on the landing
        // grounds."), not a retake; a retake of a whole sentence ends where
        // a sentence can end (phase 4A.8, T6 negative set).
        continue
      }
      // A cheap first look: the two takes start alike.
      if (A[0] !== B[0] && (k < 3 || A[1] !== B[1])) continue
      const sim = lcs(A, B) / k
      if (merged && (sim < 0.9 || !endsSentence(words[idx[j - 1]].text))) continue
      if (sim >= minSim && (!best || k > best.k)) best = { k, sim }
    }
    if (!best) continue
    const { k, sim } = best
    const f0 = idx[j - k]
    const f1 = idx[j - 1]
    const s0 = idx[j]
    const s1 = idx[j + k - 1]
    const first: [number, number] = [words[f0].start, words[f1].end]
    const second: [number, number] = [words[s0].start, words[s1].end]
    // The words that differ, as WRITTEN (the fold finds the pair; it never
    // makes two words the same for the sure cut: phase 4A.11, N1).
    const exact = (from: number): string[] => Array.from({ length: k }, (_, i) => exactWord(words[idx[from + i]].text))
    const [ua, ub] = unmatched(exact(j - k), exact(j))
    const differ: [string[], string[]] = [ua.map((i) => words[idx[j - k + i]].text), ub.map((i) => words[idx[j + i]].text)]
    // (Seconds spread evenly over a line, or estimated, are a guess: phase
    // 4A.10, D3; 4A.11, N2.)
    const guessed = words.slice(f0, s1 + 1).some(guessedTime)
    const same = ua.length === 0 && ub.length === 0
    const why: string[] = []
    if (k < SURE_WORDS) why.push(`under ${SURE_WORDS} words`)
    const endA = endMark(words[f1].text)
    const endB = endMark(words[s1].text)
    if (endA === '?' || endB === '?') why.push('ends with ?')
    else if (endA === '!' || endB === '!') why.push('ends with !')
    else if (endA !== endB) why.push('ends differ')
    else if (!endA) why.push('no end mark')
    if (!strong(j - k)) why.push('not a whole sentence')
    const gap = second[0] - first[1]
    if (gap > SURE_GAP + 1e-9) why.push(`gap ${gap.toFixed(1)} s`)
    else if (words.slice(f1 + 1, s0).some((w) => exactWord(w.text))) why.push('words between')
    if (guessed) why.push('guessed times')
    if (saidAgain(j, k, j - k)) why.push('said 3 times')
    out.push({
      firstWords: [f0, f1],
      secondWords: [s0, s1],
      first,
      second,
      drop: 'first',
      cut: [ms(Math.max(0, first[0] - 0.03)), ms(Math.max(first[0], second[0] - 0.03))],
      similarity: Math.round(sim * 100) / 100,
      words: k,
      differ,
      ...(guessed ? { guessed: true } : {}),
      ...(same && !why.length ? {} : { uncertain: true, why })
    })
    // The second take is not the first of another pair.
    next = j + k
  }
  return out
}
