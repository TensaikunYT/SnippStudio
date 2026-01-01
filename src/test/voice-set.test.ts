// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
import assert from 'node:assert/strict'
import test from 'node:test'
import { safeFileName } from '../renderer/src/export/formats'
import { captionsToSrt } from '../renderer/src/subtitles/srt'
import { voiceSet } from '../renderer/src/subtitles/voice-set'
import type { Caption } from '../renderer/src/types'

const cap = (over: Partial<Caption> & { id: string }): Caption =>
  ({ start: 0, end: 1, text: 'hello', ...over }) as Caption

test('the voice set holds the single SRT export\'s own two files, under its names', () => {
  const captions = [
    cap({ id: 'b', start: 2, end: 3, text: 'second line' }),
    cap({
      id: 'a',
      start: 0,
      end: 1.5,
      text: 'first line',
      words: [
        { text: 'first', start: 0, end: 0.6 },
        { text: 'line', start: 0.7, end: 1.5 }
      ]
    } as Partial<Caption> & { id: string }),
    // A title card and a shape are not subtitles.
    cap({ id: 'c', start: 4, end: 5, text: 'overlay', layer: 1 }),
    cap({ id: 'd', start: 6, end: 7, text: '', shape: {} } as Partial<Caption> & { id: string })
  ]
  const set = voiceSet('My film: part 1?', captions)!
  // Byte for byte what "Subtitles (.srt)…" writes, sentences and words.
  assert.equal(set.sentences, captionsToSrt(captions, { perWord: false }))
  assert.equal(set.words, captionsToSrt(captions, { perWord: true }))
  const base = safeFileName('My film: part 1?', 'subtitles')
  assert.deepEqual(set.names, { sentences: `${base}.srt`, words: `${base}-words.srt`, sound: `${base}.mp3` })
  assert.deepEqual(set.cues, { sentences: 2, words: 3 })
  // "second line" has no word timings: the word SRT holds it whole, and that is said.
  assert.equal(set.wordTimed, false)
  assert.equal(voiceSet('x', captions.filter((c) => c.id !== 'b'))!.wordTimed, true)
  assert.ok(!set.sentences.includes('overlay'))
})

test('the voice set: no subtitles is nothing to write; no word timings is said', () => {
  assert.equal(voiceSet('x', []), null)
  assert.equal(voiceSet('x', [cap({ id: 'a', text: 'title', layer: 1 })]), null)
  assert.equal(voiceSet('x', [cap({ id: 'a', text: '   ' })]), null)
  const typed = voiceSet('', [cap({ id: 'a', start: 1, end: 2, text: 'typed by hand' })])!
  assert.equal(typed.wordTimed, false)
  // The word SRT falls back to the sentence cue, as the single export's does.
  assert.equal(typed.words, typed.sentences)
  assert.equal(typed.names.sentences, 'subtitles.srt')
})
