// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
import assert from 'node:assert/strict'
import test from 'node:test'
import { createTemplate, wordsFromSubs, wordsPhrases } from '../renderer/src/templates/model'
import { defaultProject } from '../renderer/src/types'

test('big words: the subtitles under it, word by word on their own timing, upper case the Turkish way', () => {
  const p = defaultProject()
  p.captions = [
    { id: 'a', start: 10, end: 12, text: 'bir günde tam', words: [{ text: 'bir', start: 10, end: 10.5 }, { text: 'günde', start: 10.5, end: 11.2 }, { text: 'tam', start: 11.2, end: 12 }] },
    { id: 'b', start: 12.2, end: 14, text: 'işte hikaye' },
    { id: 'c', start: 30, end: 31, text: 'far away' },
    { id: 'layer', start: 10, end: 14, text: 'a title', layer: 1 }
  ]
  const id = createTemplate(p, 'words', 9.5)
  const b = p.templates!.find((t) => t.id === id)!
  b.duration = 5
  assert.equal(wordsFromSubs(p, b), true)
  const ph = wordsPhrases(p, b)
  assert.equal(ph.length, 2)
  assert.deepEqual(ph[0].map((w) => w.text), ['BİR', 'GÜNDE', 'TAM'])
  assert.ok(Math.abs(ph[0][1].t0 - 1) < 1e-9)
  // A line without word timings is spread over itself by length.
  assert.deepEqual(ph[1].map((w) => w.text), ['İŞTE', 'HİKAYE'])
  assert.ok(ph[1][0].t0 >= 2.7 - 1e-9 && ph[1][1].t0 > ph[1][0].t0)
  // Its own lines instead: spread over the block, the subtitles left alone.
  b.own = true
  assert.equal(wordsFromSubs(p, b), false)
  const own = wordsPhrases(p, b)
  assert.equal(own.length, b.items.length)
  assert.equal(own[0][0].text, 'EVERY')
})

test('video player: its state follows the events', async () => {
  const { playerState } = await import('../renderer/src/templates/player-plan')
  const b = { duration: 9, items: [{ id: 'a', title: 'pause', value: 1.5 }, { id: 'b', title: 'play', value: 3 }, { id: 'c', title: 'quality', value: 6, note: '144p' }, { id: 'd', title: 'cc', value: 7.6 }] }
  assert.equal(playerState(b, 1).paused, false)
  assert.equal(playerState(b, 2).paused, true)
  // The clock stands still while paused.
  assert.equal(playerState(b, 2).pos, playerState(b, 2.9).pos)
  assert.equal(playerState(b, 6.2).quality, '144p')
  assert.equal(playerState(b, 8).cc, true)
})

test('store chart: counts down fifteen to one by default', async () => {
  const { createTemplate, storeTimes } = await import('../renderer/src/templates/model')
  const { defaultProject } = await import('../renderer/src/types')
  const p = defaultProject()
  const id = createTemplate(p, 'store', 2)
  const b = p.templates!.find((t) => t.id === id)!
  assert.equal(b.items.length, 15)
  assert.equal(b.countdown, true)
  const T = storeTimes(b)
  assert.equal(T.at.length, 15)
})

test('big words: its settings are kept safe — words to a line, band, size, other lines, height, blend', async () => {
  const { cleanWordsLook, sanitizeTemplates } = await import('../renderer/src/templates/model')
  assert.deepEqual(cleanWordsLook({ per: 2.6, band: false, size: 9, dim: -1, y: 0.7, blend: 'window' }), { per: 3, band: false, size: 2.5, dim: 0, y: 0.7, blend: 'window' })
  assert.deepEqual(cleanWordsLook({ per: 'x', band: true, blend: 'multiply' }), {})
  const p = defaultProject()
  const id = createTemplate(p, 'words', 1)
  const b = p.templates!.find((t) => t.id === id)!
  b.big = { per: 2, blend: 'overlay' }
  sanitizeTemplates(p)
  assert.deepEqual(p.templates![0].big, { per: 2, blend: 'overlay' })
})

test('big words: a click lands as each line comes up — per piece for Stack, per word for Punch', async () => {
  const { wordsBeats } = await import('../renderer/src/templates/words-plan')
  const p = defaultProject()
  const id = createTemplate(p, 'words', 2)
  const b = p.templates!.find((t) => t.id === id)!
  b.own = true
  b.duration = 6
  b.items = [{ id: 'a', title: 'one two three four five six' }, { id: 'b', title: 'seven eight' }]
  b.design = 'stack'
  b.big = { per: 3 }
  const st = wordsBeats(p, b, false)
  assert.equal(st.length, 3)
  assert.ok(st[0] < st[1] && st[1] < st[2])
  b.design = 'punch'
  assert.equal(wordsBeats(p, b, false).length, 8)
})
