// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
import assert from 'node:assert/strict'
import test from 'node:test'
import { captionMarker, keyWordOf, keyWordPlan, toggleKeyWords } from '../renderer/src/subtitles/keywords'
import { defaultCaptionStyle, type Caption } from '../renderer/src/types'

const words = (text: string): string[] => {
  const pick = keyWordOf(text)
  const raw = text.split(/\s+/)
  return pick ? pick.words.map((i) => raw[i]) : []
}

test('key words: a number, a strong word, a name — in Turkish and in English', () => {
  assert.deepEqual(words('Bunun tam 3 sebebi var'), ['3'])
  assert.deepEqual(words('Ülkelerin yüzde 70 kadarı'), ['yüzde', '70'])
  assert.deepEqual(words('Tam üç milyon kişi izledi'), ['üç', 'milyon'])
  assert.deepEqual(words('Bu dünyanın en tehlikeli hayvanı'), ['tehlikeli'])
  assert.deepEqual(words('Bunu asla yapmayın'), ['asla'])
  assert.deepEqual(words('Bu bilgi tamamen efsaneymiş'), ['efsaneymiş'])
  assert.deepEqual(words('Sonra ekip İstanbul’a döndü'), ['İstanbul’a'])
  assert.deepEqual(words('Bunu NASA açıkladı'), ['NASA'])
  assert.deepEqual(words('This is the most dangerous animal'), ['dangerous'])
  assert.deepEqual(words('Bu en güzel yer'), ['güzel'])
  assert.deepEqual(words('You should never do this'), ['never'])
  assert.deepEqual(words('It cost 5 million dollars'), ['5', 'million'])
  // A number beats a strong word; a strong word beats a name.
  assert.deepEqual(words('Ahmet asla 3 kez denemedi'), ['3'])
  assert.deepEqual(words('Ahmet asla pes etmedi'), ['asla'])
  // Nothing to mark: a capital starting a sentence, "bir" (a), "on"/"altı"/"yüz" on their own.
  assert.deepEqual(words('Bugün hava güzeldi'), [])
  assert.deepEqual(words('Bir gün ormana gitti'), [])
  assert.deepEqual(words('Masanın altı tozluydu'), [])
  assert.deepEqual(words('Yüzü kızardı. Sonra gitti'), [])
  // A line written in capitals has no names to find by them.
  assert.deepEqual(words('HERKES ORADAYDI'), [])
  assert.deepEqual(words('Ama altı yüz kişi geldi'), ['altı', 'yüz'])
})

const cap = (id: string, start: number, text: string, extra: Partial<Caption> = {}): Caption => ({ id, start, end: start + 1.5, text, ...extra })

test('key words across a video: spaced out, a name not again and again, yours kept', () => {
  const lines = [
    cap('a', 0, 'Bunu asla unutmayın'),
    cap('b', 1.6, 'Bu çok önemli bir konu'),
    cap('c', 3.2, 'Ahmet bunu biliyordu'),
    cap('d', 5, 'Sonra Ahmet geri döndü'),
    cap('e', 9, 'Sonra Ahmet yine geldi'),
    cap('f', 10.5, 'Tam 3 milyon kişi'),
    cap('g', 12, 'Elle yazılmış bir not', { manual: true }),
    cap('h', 14, 'Ve sonra Mehmet geldi', { marks: [] }),
    cap('i', 16, 'Burada bir şey yok', { marks: [1] })
  ]
  const some = keyWordPlan(lines, 'some')
  assert.deepEqual(some.get('a'), [1])
  // Too soon after the last mark.
  assert.equal(some.get('b'), undefined)
  assert.deepEqual(some.get('d'), [1])
  // The same name, marked a moment ago.
  assert.equal(some.get('e'), undefined)
  // A number may come sooner.
  assert.deepEqual(some.get('f'), [1, 2])
  // Not text you typed yourself; yours stay yours.
  assert.equal(some.get('g'), undefined)
  assert.equal(some.get('h'), undefined)
  // Fewer with "few", more with "more".
  const few = keyWordPlan(lines, 'few')
  const more = keyWordPlan(lines, 'more')
  assert.ok(few.size < some.size, `${few.size} ${some.size}`)
  assert.ok(more.size >= some.size)
  assert.ok([...more.values()].every((w) => w.length <= 2))
  // The same list gives the same plan (and is not worked out twice).
  assert.equal(keyWordPlan(lines, 'some'), some)

  // What a subtitle shows: nothing while off; the found words; yours; its own look's marker.
  const base = defaultCaptionStyle()
  assert.equal(captionMarker(lines[0], lines, base), undefined)
  const on = { ...base, keyMark: { enabled: true, amount: 'some' as const, color: '#ffd23f', duration: 0.5 } }
  assert.deepEqual(captionMarker(lines[0], lines, on), { enabled: true, color: '#ffd23f', duration: 0.5, words: [1] })
  assert.deepEqual(captionMarker(lines[8], lines, on)?.words, [1])
  assert.equal(captionMarker(lines[7], lines, on), undefined)
  const own = cap('z', 20, 'Kendi stili olan', { style: { ...base, marker: { enabled: true, color: '#f00', duration: 0.4, words: [2] } } })
  assert.deepEqual(captionMarker(own, [own], on)?.words, [2])
  // Clicking a word: in, and out again.
  assert.deepEqual(toggleKeyWords([1], [3]), [1, 3])
  assert.deepEqual(toggleKeyWords([1, 3], [3]), [1])
})
