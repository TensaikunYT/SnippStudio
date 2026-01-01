// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
import assert from 'node:assert/strict'
import test from 'node:test'
import { assetKeywords, foldWord, planBroll, saysKeyword } from '../renderer/src/subtitles/broll'
import type { Caption } from '../renderer/src/types'

const cap = (id: string, start: number, end: number, text: string): Caption => ({ id, start, end, text })

test('b-roll: a file name gives its words, without numbers and filler', () => {
  assert.deepEqual(assetKeywords('01 - İstanbul Boğazı (final).jpg'), ['istanbul', 'bogazi'])
  assert.deepEqual(assetKeywords('grand_canyon_4k_1920x1080.png'), ['grand', 'canyon'])
  assert.deepEqual(assetKeywords('IMG_2044.JPG'), [])
  assert.equal(foldWord("Kapadokya'da"), 'kapadokya')
})

test('b-roll: a spoken word finds its keyword, with Turkish endings', () => {
  assert.ok(saysKeyword(foldWord("İstanbul'da"), 'istanbul'))
  assert.ok(saysKeyword(foldWord('istanbuldan'), 'istanbul'))
  assert.ok(saysKeyword(foldWord('boğaz'), 'bogazi'))
  assert.ok(!saysKeyword('can', 'canyon'), 'short words never stretch')
  assert.ok(!saysKeyword(foldWord('kediler'), 'kopek'))
})

test('b-roll: each picture goes where it is said, once, never overlapping', () => {
  const captions = [
    cap('c1', 0, 3, 'Bugün İstanbul’da bir gün geçireceğiz'),
    cap('c2', 3, 6, 'Önce boğazı gezdik, sonra Galata kulesine çıktık'),
    cap('c3', 6.2, 9, 'İstanbul akşamları çok güzel'),
    cap('c4', 12, 15, 'Kapadokya ise bambaşka')
  ]
  const assets = [
    { id: 'a', name: 'istanbul.jpg', kind: 'image' as const, duration: 0 },
    { id: 'b', name: 'galata kulesi.png', kind: 'image' as const, duration: 0 },
    { id: 'c', name: 'kapadokya-balon.mp4', kind: 'video' as const, duration: 2.5 },
    { id: 'd', name: 'IMG_0001.jpg', kind: 'image' as const, duration: 0 }
  ]
  const { placements, unmatched } = planBroll(captions, assets)
  const by = new Map(placements.map((p) => [p.assetId, p]))
  assert.ok(by.get('a')!.start < 1, 'istanbul at its first mention')
  assert.ok(by.get('b')!.start > 3 && by.get('b')!.start < 6, 'galata tower where it is said')
  assert.ok(by.get('c')!.start >= 11.5 && by.get('c')!.end - by.get('c')!.start <= 2.5 + 1e-9, 'a clip no longer than itself')
  assert.ok(unmatched.includes('d'))
  for (let i = 1; i < placements.length; i++) assert.ok(placements[i].start >= placements[i - 1].end, 'no overlap')
})

test('b-roll: your own words for a picture win over its file name', () => {
  const captions = [cap('c1', 0, 4, 'The old lighthouse stood alone')]
  const assets = [{ id: 'x', name: 'DSC_4410.jpg', kind: 'image' as const, duration: 0 }]
  assert.equal(planBroll(captions, assets).placements.length, 0)
  const { placements } = planBroll(captions, assets, { keywords: { x: ['lighthouse'] } })
  assert.equal(placements.length, 1)
  assert.equal(placements[0].said, 'lighthouse')
})
