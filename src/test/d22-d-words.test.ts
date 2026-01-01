// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// 22 November, L12: words that depend on a count. "3 change(s)" and
// "1 note(s)" were on the draft and in a toast: t() now writes "1 note" and
// "3 notes" (ui/strings.ts plural), and a word that changes with the count
// is written in both forms, `{n|was|were}` (fill).
import assert from 'node:assert/strict'
import test from 'node:test'
import { STRINGS, fill, plural, setLang, t, type StringKey } from '../renderer/src/ui/strings'

test('plural: "(s)" follows the nearest count before it', () => {
  assert.equal(plural('1 note(s)'), '1 note')
  assert.equal(plural('3 note(s)'), '3 notes')
  assert.equal(plural('0 note(s)'), '0 notes')
  assert.equal(plural('1 picture(s) and 2 empty slot(s) for missing numbers'), '1 picture and 2 empty slots for missing numbers')
  assert.equal(plural('1 unreadable work note(s) or drawing stroke(s) removed'), '1 unreadable work note or drawing stroke removed')
  assert.equal(plural('Accepting now: 1 call(s) applied, 0 op(s) or range(s) left out'), 'Accepting now: 1 call applied, 0 ops or ranges left out')
  assert.equal(plural('keyframes put in order (1 list(s))'), 'keyframes put in order (1 list)')
  assert.equal(plural('1.5 thing(s)'), '1.5 things')
  assert.equal(plural('12 clip(s) on V1'), '12 clips on V1')
})

test('plural: no count before it: left as written (seconds, a definition)', () => {
  assert.equal(plural('Start (s)'), 'Start (s)')
  assert.equal(plural('Reply after (s)'), 'Reply after (s)')
  assert.equal(plural('clip.slip{clipId:s,delta:n(s)}'), 'clip.slip{clipId:s,delta:n(s)}')
  assert.equal(plural('Linked partner(s) left in place'), 'Linked partner(s) left in place')
  // (A count in an earlier sentence is not this word's.)
  assert.equal(plural('Version 2. The file(s) stay.'), 'Version 2. The file(s) stay.')
})

test('fill: a word in two forms by its count', () => {
  assert.equal(fill('{n} file(s) {n|was|were} not read', { n: 1 }), '1 file(s) was not read')
  assert.equal(fill('{n} file(s) {n|was|were} not read', { n: 4 }), '4 file(s) were not read')
  assert.equal(fill('{n|it|them}', { n: '1' }), 'it')
  // A parameter that is not given stays as written.
  assert.equal(fill('{m|a|b} {n}', { n: 2 }), '{m|a|b} 2')
  assert.equal(fill('{n|one|}', { n: 2 }), '')
})

test('no English text shows "(s)" after a count, at one or at many', () => {
  setLang('en')
  const params = (text: string, v: number): Record<string, number> => Object.fromEntries([...text.matchAll(/\{(\w+)(?:\|[^{}]*)?\}/g)].map((m) => [m[1], v]))
  const left: string[] = []
  for (const [key, e] of Object.entries(STRINGS) as [StringKey, { en: string }][]) {
    if (!e.en.includes('(s)')) continue
    for (const v of [1, 3]) {
      const shown = t(key, params(e.en, v))
      if (/\d[^.;:!?(]*\(s\)/.test(shown)) left.push(`${key} @${v}: ${shown}`)
    }
  }
  assert.deepEqual(left, [])
  // (The draft bar's own words went with the bar: D22, worker C's review strip says the count.)
  assert.equal(t('d22c.review.notApplied.one', { n: 1 }), '1 operation not applied')
  assert.equal(t('d22c.review.notApplied.other', { n: 3 }), '3 operations not applied')
  assert.equal(t('media.changed', { n: 1 }), '1 media file changed on disk since this project was saved and was read again.')
  assert.equal(t('media.changed', { n: 2 }), '2 media files changed on disk since this project was saved and were read again.')
})

test('Turkish needs no ending after a count and has none', () => {
  setLang('tr')
  try {
    assert.equal(t('d22c.review.notApplied.other', { n: 3 }), '3 işlem uygulanmadı')
    const odd = (Object.entries(STRINGS) as [string, { tr?: string }][]).filter(([, e]) => /\((lar|ler|s)\)/.test(e.tr ?? '')).map(([k]) => k)
    assert.deepEqual(odd, [])
  } finally {
    setLang('en')
  }
})
