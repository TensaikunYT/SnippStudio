// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
import assert from 'node:assert/strict'
import test from 'node:test'
import { placeSuggestions, type TemplateSuggestion } from '../renderer/src/subtitles/template-suggest'
import { defaultProject } from '../renderer/src/types'

// The suggestions themselves were made by a reader of the narration that went
// with the Automation dialog (phase 3c.4b); placing kept ones stays (the edit
// command placeImages takes them).
test('kept suggestions are placed as templates on the G lane', () => {
  const s: TemplateSuggestion[] = [
    { key: 'count:1', kind: 'count', start: 3, duration: 11.8, from: 1, to: 4, title: 'Bunun üç sebebi var', items: [{ title: 'Zaman çok kısıtlı' }, { title: 'Para yetmiyor' }, { title: 'Kimse yardım etmiyor' }], word: 'üç sebebi' },
    { key: 'versus:5', kind: 'versus', start: 15, duration: 4.5, from: 5, to: 5, title: 'iPhone mi, Android mi?', items: [{ title: 'iPhone' }, { title: 'Android' }], word: 'iPhone mu Android mi' },
    { key: 'stat:7', kind: 'stat', start: 21, duration: 4, from: 7, to: 7, title: '', items: [{ title: 'Bir yıl sonra kişi kullanıyordu', value: 2e6, note: '' }], word: '2 milyon' },
    { key: 'words:9', kind: 'words', start: 27, duration: 2.8, from: 9, to: 9, title: '', items: [], word: 'Ve bu her şeyi değiştirdi', design: 'punch' }
  ]
  const p = defaultProject()
  assert.equal(placeSuggestions(p, s), 4)
  const words = p.templates!.find((t) => t.kind === 'words')!
  assert.equal(words.design, 'punch')
  assert.equal(words.start, 27)
  assert.deepEqual(words.items.map((it) => it.title), ['Ve bu her şeyi değiştirdi'])
  const count = p.templates!.find((t) => t.kind === 'count')!
  assert.deepEqual(count.items.map((it) => it.title), ['Zaman çok kısıtlı', 'Para yetmiyor', 'Kimse yardım etmiyor'])
  assert.equal(count.duration, 11.8)
  assert.equal(p.templates!.find((t) => t.kind === 'stat')!.items[0].value, 2e6)
})
