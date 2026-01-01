// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// cogalt, item 7 (23 Nov 2026: "default settings in English; it was writing
// Turkish things"): the program ships in English. A new profile starts in
// English, and no English text the interface shows carries a letter only
// Turkish has (the language's own name, "Türkçe", aside).
import assert from 'node:assert/strict'
import test from 'node:test'
import { STRINGS, langOf, setLang, t, type StringKey } from '../renderer/src/ui/strings'

const TURKISH = /[çğıİöşüÇĞÖŞÜ]/

test('a profile that never chose a language is in English', () => {
  assert.equal(langOf(null), 'en')
  assert.equal(langOf(undefined), 'en')
  assert.equal(langOf('tr-TR'), 'en')
  assert.equal(langOf('tr'), 'tr')
})

test('no English text of the interface has a Turkish-only letter (but the language name)', () => {
  setLang('en')
  const bad: string[] = []
  for (const key of Object.keys(STRINGS) as StringKey[]) {
    const text = t(key).replace(/Türkçe/g, '')
    if (TURKISH.test(text)) bad.push(`${key}: ${text.slice(0, 80)}`)
  }
  assert.deepEqual(bad, [])
})
