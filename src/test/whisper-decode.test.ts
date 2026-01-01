// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
import assert from 'node:assert/strict'
import test from 'node:test'
import { findTailLoop, trimLoops, whisperCpuThreads } from '../renderer/src/subtitles/decode'

const repeat = <T>(block: T[], times: number): T[] => Array.from({ length: times }, () => block).flat()

test('the CPU model gets half the logical cores, 1 to 8, and 1 without shared memory', () => {
  assert.equal(whisperCpuThreads(8, true), 4)
  assert.equal(whisperCpuThreads(12, true), 6)
  assert.equal(whisperCpuThreads(32, true), 8)
  assert.equal(whisperCpuThreads(3, true), 1)
  assert.equal(whisperCpuThreads(1, true), 1)
  assert.equal(whisperCpuThreads(undefined, true), 1)
  assert.equal(whisperCpuThreads(16, false), 1)
})

test('a token loop is a block of up to 12 tokens repeated 4+ times covering 24+ tokens', () => {
  // One token: it takes 24 copies.
  assert.equal(findTailLoop([7, ...repeat([5], 23)]), null)
  assert.deepEqual(findTailLoop([7, ...repeat([5], 24)]), { start: 1, period: 1, repeats: 24 })
  // Three tokens ("Thank you."): 8 copies.
  assert.equal(findTailLoop(repeat([1, 2, 3], 7)), null)
  assert.deepEqual(findTailLoop(repeat([1, 2, 3], 8)), { start: 0, period: 3, repeats: 8 })
  // Twelve tokens: 4 copies are enough, 3 are not.
  const twelve = Array.from({ length: 12 }, (_, i) => i)
  assert.equal(findTailLoop(repeat(twelve, 3)), null)
  assert.deepEqual(findTailLoop(repeat(twelve, 4)), { start: 0, period: 12, repeats: 4 })
  // Thirteen tokens never count, however often they repeat.
  assert.equal(findTailLoop(repeat(Array.from({ length: 13 }, (_, i) => i), 10)), null)
  // Only the end counts: a loop the decoder already left is not a tail loop.
  assert.equal(findTailLoop([...repeat([5], 30), 8, 9]), null)
  // The shortest block wins.
  assert.equal(findTailLoop(repeat([5], 40))?.period, 1)
})

test('speech-like text with ordinary repeats is not a loop', () => {
  const words = 'bu çok çok önemli bir şey ve bu şey bizim için çok çok önemli evet evet evet'.split(' ')
  assert.equal(findTailLoop(words), null)
  assert.equal(trimLoops(words, words), words)
})

test('looped words are cut to their first copy, weighed by their tokens', () => {
  const words = ['Müzik', 'başlıyor', ...repeat(['Thank', 'you.'], 9)]
  // "Thank" is one token and "you." two: 9 copies x 3 tokens = 27.
  const weights = words.map((w) => (w === 'you.' ? 2 : 1))
  assert.deepEqual(trimLoops(words, words, weights), ['Müzik', 'başlıyor', 'Thank', 'you.'])
  // Counted one token per word the same 18 words are not yet a loop.
  assert.equal(trimLoops(words, words), words)
})

test('a cut-off last copy at the end of the window goes too; a repeat the speech leaves again stays', () => {
  const capped = ['a', ...repeat(['la', 'li', 'lo'], 9), 'la', 'li']
  assert.deepEqual(trimLoops(capped, capped), ['a', 'la', 'li', 'lo'])
  // A chant or chorus followed by more speech was said: nothing is cut.
  const resumed = [...repeat(['ve'], 26), 've', 'sonra', 'konuştu']
  assert.equal(trimLoops(resumed, resumed), resumed)
  const chant = [...repeat(['Allah', 'Allah'], 14), 'diye', 'bağırdılar']
  assert.equal(trimLoops(chant, chant), chant)
  // Items are kept by their own identity; the keys only compare them.
  const items = capped.map((text, i) => ({ text, i }))
  assert.deepEqual(trimLoops(items, capped).map((w) => w.i), [0, 1, 2, 3])
})
