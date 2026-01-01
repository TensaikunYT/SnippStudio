// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// Cila O and E (Fit to voice, the encoder choice): every key is written in
// English and Turkish, with the same parameters, and is part of STRINGS (the
// same check as strings-3c.test.ts, for the file of cila O).
import assert from 'node:assert/strict'
import test from 'node:test'
import { STRINGS } from '../renderer/src/ui/strings'
import { STRINGS_3C } from '../renderer/src/ui/strings-3c'
import { STRINGS_3C3 } from '../renderer/src/ui/strings-3c3'
import { STRINGS_3C4 } from '../renderer/src/ui/strings-3c4'
import { STRINGS_CILA_O } from '../renderer/src/ui/strings-cila-o'

test('cila O: every key has its Turkish, with the same parameters, and is in STRINGS', () => {
  const params = (s: string): string => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(',')
  const keys = Object.keys(STRINGS_CILA_O)
  assert.ok(keys.length > 20, `${keys.length} keys`)
  for (const [k, e] of Object.entries(STRINGS_CILA_O)) {
    assert.ok(e.en.trim().length > 0, `${k}: English`)
    assert.ok(e.tr.trim().length > 0, `${k}: Turkish`)
    assert.equal(params(e.tr), params(e.en), `${k}: the same parameters`)
    assert.deepEqual((STRINGS as Record<string, unknown>)[k], e, `${k} is in STRINGS`)
  }
})

test('cila O: no key repeats one of another strings file', () => {
  const other = new Set([...Object.keys(STRINGS_3C), ...Object.keys(STRINGS_3C3), ...Object.keys(STRINGS_3C4)])
  assert.deepEqual(Object.keys(STRINGS_CILA_O).filter((k) => other.has(k)), [])
})
