// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// A count said right in both languages (D22, worker C; the audit's L12: "3
// change(s)", "1 note(s)"): a text that depends on a number has two keys,
// "<key>.one" and "<key>.other", and the caller writes the key as
// `<key>.${form(n)}`. (Turkish puts no ending after a number: its two texts
// are the same.) Pure: agent/draft-words.ts builds its keys with it.

/** Which of a counted text's two keys `n` takes. */
export const form = (n: number): 'one' | 'other' => (n === 1 ? 'one' : 'other')

/** A number with its Turkish possessive ending, as in "4 nottan 2’si"
 *  (TOKEN-PLAN.md): the ending follows how the number is said (bir → 1’i,
 *  iki → 2’si, üç → 3’ü, altı → 6’sı, on → 10’u, kırk → 40’ı, yüz → 100’ü). */
export function trOf(n: number): string {
  const units = ['ı', 'i', 'si', 'ü', 'ü', 'i', 'sı', 'si', 'i', 'u']
  const tens = ['', 'u', 'si', 'u', 'ı', 'si', 'ı', 'i', 'i', 'ı']
  const k = Math.abs(Math.round(n))
  const end = k === 0 ? 'ı' : k % 10 ? units[k % 10] : k % 100 ? tens[(k % 100) / 10] : k % 1000 ? 'ü' : 'i'
  return `${k}’${end}`
}
