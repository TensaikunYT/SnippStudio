// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// Key words: which word in a subtitle deserves the highlighter — a number, a
// name, a strong word ("asla", "en büyük", "never") — at most one in a line,
// and not in every line: the marked lines are spaced out, a name is not
// marked again and again. Turkish and English. Worked out from the text, so a
// subtitle that is edited, split or regrouped is simply looked at again; the
// words you change yourself are kept on the subtitle (`marks`).

import type { Caption, CaptionStyle } from '../types'
import { isSubtitle } from '../types'

export type KeyAmount = 'few' | 'some' | 'more'
type Marker = NonNullable<CaptionStyle['marker']>

/** The look of the key words, and how many: the subtitles' own setting. */
export type KeyMarkLook = NonNullable<CaptionStyle['keyMark']>
export const KEY_MARK_DEFAULT: KeyMarkLook = { enabled: true, amount: 'some', color: '#f1ef00', duration: 0.48 }

/** Lower case (the Turkish way), the suffix after an apostrophe dropped,
 *  only letters, digits and % kept. */
export function bareWord(w: string): string {
  return w
    .toLocaleLowerCase('tr')
    .replace(/[’'`´].*$/u, '')
    .replace(/[^\p{L}\p{N}%]/gu, '')
}

const set = (s: string): Set<string> => new Set(s.split(/\s+/).filter(Boolean))

// Numbers said as words. "bir" (also "a"), and "on", "altı", "yüz" (also
// "on top", "under", "face") only count next to another number.
const NUM_SURE = set(`iki üç dört beş yedi sekiz dokuz yirmi otuz kırk elli altmış yetmiş seksen doksan bin milyon milyar trilyon
  two three four five six seven eight nine ten eleven twelve twenty thirty forty fifty sixty seventy eighty ninety hundred thousand million billion trillion`)
const NUM_MAYBE = set('on altı yüz bir one')
const MAGNITUDE = set('yüz bin milyon milyar trilyon hundred thousand million billion trillion percent % yüzde')

// Strong words, said whole…
const STRONG = set(`asla hiçbir hiçbiri kesinlikle dev sır sırrı şok tek ilk yalan dikkat yasak bedava
  never always best worst biggest largest smallest secret free huge massive insane incredible impossible dangerous deadly
  banned illegal record important critical crucial truth lie myth perfect shocking mistake warning`)
// …or as a stem with its endings ("tehlikeli", "felaketi", "imkansızdı").
const STRONG_STEMS = [
  'imkansız', 'imkânsız', 'inanılmaz', 'tehlike', 'felaket', 'efsane', 'rekor', 'mükemmel', 'kusursuz', 'kritik', 'önemli', 'hayati',
  'gizli', 'yasakl', 'korkunç', 'ölümcül', 'muazzam', 'devasa', 'kocaman', 'ücretsiz', 'zehir', 'yasadışı', 'şok'
]
// Words that make the next one strong: "en büyük", "the most dangerous".
const SUPERLATIVE = set('en most')
// Never a key word on their own, however they are written.
const PLAIN = set(`ben sen o biz siz onlar bu şu ve ile ama fakat çünkü için gibi da de ki mi mı mu mü
  i you he she it we they the a an and or but so of to in on at is are was were`)

const isDigitWord = (b: string): boolean => /\p{N}/u.test(b)
const isNumberWord = (b: string): boolean => isDigitWord(b) || NUM_SURE.has(b)
const strongWord = (b: string): boolean => STRONG.has(b) || STRONG_STEMS.some((s) => b.startsWith(s))
const endsSentence = (w: string): boolean => /[.!?…:]["”’)]*$/u.test(w)

/** One choice: the word(s) to mark and how much they deserve it. */
interface Pick {
  words: number[]
  score: number
  /** What it is, folded — so the same name is not marked over and over. */
  key: string
}

/**
 * The key word of one subtitle line, if it has one: a number (with the word
 * that makes it one — "yüzde 70", "3 milyon"), then a strong word (after
 * "en", the word it makes strong), then a name (a capital in the middle of
 * a sentence, or letters in capitals like "NASA").
 */
export function keyWordOf(text: string): Pick | null {
  const raw = [...text.matchAll(/\S+/gu)].map((m) => m[0])
  const bare = raw.map(bareWord)
  let best = null as Pick | null
  // A line typed all in capitals has no names to find by their capitals.
  const shouting = text === text.toLocaleUpperCase('tr')
  const offer = (p: Pick): void => {
    // A higher score wins; between equals, the longer word (it says more).
    const len = (q: Pick): number => q.words.reduce((n, i) => n + bare[i].length, 0)
    if (!best || p.score > best.score || (p.score === best.score && len(p) > len(best))) best = p
  }
  for (let i = 0; i < raw.length; i++) {
    const b = bare[i]
    if (!b) continue
    const next = bare[i + 1] ?? ''
    const prev = bare[i - 1] ?? ''
    // Numbers.
    if (isNumberWord(b) || (NUM_MAYBE.has(b) && (isNumberWord(next) || MAGNITUDE.has(next) || prev === 'yüzde'))) {
      // Skip a number that the word before already claimed ("üç yüz", "yüzde 70").
      if (i > 0 && (isNumberWord(prev) || NUM_MAYBE.has(prev) || prev === 'yüzde') && best?.words.includes(i - 1)) continue
      const words = [i]
      if (next && (MAGNITUDE.has(next) || isNumberWord(next))) words.push(i + 1)
      if (prev === 'yüzde') words.unshift(i - 1)
      // A year or a plain "1" says less than "3 milyon" or "%70".
      const score = b.includes('%') || words.length > 1 || (isDigitWord(b) && b.length >= 2 && b.length !== 4) ? 3.2 : 3
      offer({ words, score: b === 'bir' || b === 'one' ? 0 : score, key: words.map((k) => bare[k]).join(' ') })
      continue
    }
    if (PLAIN.has(b)) continue
    // Strong words; "en X" marks both.
    // "en büyük": the word it makes strong (marking "en" too would split
    // over two lines when the line breaks between them).
    if (SUPERLATIVE.has(b) && next && !PLAIN.has(next) && !isNumberWord(next)) {
      offer({ words: [i + 1], score: 2.8, key: next })
      continue
    }
    if (strongWord(b) && !SUPERLATIVE.has(prev)) {
      offer({ words: [i], score: 2.5, key: b })
      continue
    }
    // Names: letters in capitals, or a capital that does not start a sentence.
    const letters = raw[i].replace(/[^\p{L}]/gu, '')
    if (shouting) continue
    if (letters.length >= 2 && letters === letters.toLocaleUpperCase('tr') && letters !== letters.toLocaleLowerCase('tr')) {
      offer({ words: [i], score: 2.2, key: b })
      continue
    }
    if (i > 0 && /^\p{Lu}/u.test(letters) && !endsSentence(raw[i - 1]) && b.length >= 2) {
      offer({ words: [i], score: 2, key: b })
    }
  }
  return best && best.score > 0 ? best : null
}

/** How choosy each amount is: the least a word must deserve, and the seconds
 *  kept between two marked lines (a number may come at half of that). */
const AMOUNT: Record<KeyAmount, { min: number; gap: number }> = {
  few: { min: 2.5, gap: 7 },
  some: { min: 2, gap: 3.2 },
  more: { min: 2, gap: 1.2 }
}

const plans = new WeakMap<Caption[], Map<KeyAmount, Map<string, number[]>>>()

/** For every subtitle, the words to mark (empty: none), cached per list. */
export function keyWordPlan(captions: Caption[], amount: KeyAmount = 'some'): Map<string, number[]> {
  let byAmount = plans.get(captions)
  if (!byAmount) plans.set(captions, (byAmount = new Map()))
  const cached = byAmount.get(amount)
  if (cached) return cached
  const rule = AMOUNT[amount] ?? AMOUNT.some
  const out = new Map<string, number[]>()
  const subs = captions.filter(isSubtitle).sort((a, b) => a.start - b.start)
  let lastAt = -Infinity
  const lastKey = new Map<string, number>()
  for (const c of subs) {
    // Yours count for the spacing too.
    if (c.marks) {
      if (c.marks.length) lastAt = c.start
      continue
    }
    const pick = keyWordOf(c.text)
    if (!pick || pick.score < rule.min) continue
    const gap = pick.score >= 3 ? rule.gap / 2 : rule.gap
    if (c.start - lastAt < gap) continue
    // The same name or word again soon after: let it be.
    const seen = lastKey.get(pick.key)
    if (seen !== undefined && c.start - seen < 25) continue
    out.set(c.id, pick.words)
    lastAt = c.start
    lastKey.set(pick.key, c.start)
  }
  byAmount.set(amount, out)
  return out
}

/**
 * The marker a caption shows: its own (a text with its own look), else — for
 * a subtitle, while key words are on — the words chosen for it, or the ones
 * you chose yourself; else the subtitles' own look's marker, as before.
 */
export function captionMarker(caption: Caption, captions: Caption[], base: CaptionStyle): Marker | undefined {
  if (caption.style) return caption.style.marker
  const look = base.keyMark
  if (!look?.enabled || !isSubtitle(caption)) return base.marker
  const words = caption.marks ?? keyWordPlan(captions, look.amount).get(caption.id) ?? []
  if (!words.length) return undefined
  return { enabled: true, color: look.color, duration: look.duration, words }
}

/** The words marked in a subtitle with a word added or taken away (clicked). */
export function toggleKeyWords(now: number[], clicked: number[]): number[] {
  const remove = clicked.every((i) => now.includes(i))
  return remove ? now.filter((i) => !clicked.includes(i)) : [...new Set([...now, ...clicked])].sort((a, b) => a - b)
}
