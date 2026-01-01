// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// The words of cila K, "code values" (ui/strings-cila-k.ts): every key is written in
// English and Turkish with the same parameters, and each is part of STRINGS.
import assert from 'node:assert/strict'
import test from 'node:test'
import { STRINGS } from '../renderer/src/ui/strings'
import { STRINGS_CILA_K } from '../renderer/src/ui/strings-cila-k'

test('cila K: every key has its Turkish, with the same parameters, and is in STRINGS', () => {
  const params = (s: string): string => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(',')
  const keys = Object.keys(STRINGS_CILA_K)
  assert.ok(keys.length >= 1, `${keys.length} keys`)
  for (const [k, e] of Object.entries(STRINGS_CILA_K)) {
    assert.ok(e.en.trim().length > 0, `${k}: English`)
    assert.ok(e.tr.trim().length > 0, `${k}: Turkish`)
    assert.notEqual(e.en, e.tr, `${k}: the Turkish is not the English again`)
    assert.equal(params(e.tr), params(e.en), `${k}: the same parameters`)
    assert.deepEqual((STRINGS as Record<string, unknown>)[k], e, `${k} is in STRINGS`)
  }
})
