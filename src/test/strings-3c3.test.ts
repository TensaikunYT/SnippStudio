// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// Phase 3c.3 (the Inspector): every key added while its panels moved onto the
// building blocks is written in English and Turkish, with the same parameters,
// and is part of STRINGS (the same check as strings-3c.test.ts, for the
// Inspector's own file).
import assert from 'node:assert/strict'
import test from 'node:test'
import { STRINGS } from '../renderer/src/ui/strings'
import { STRINGS_3C } from '../renderer/src/ui/strings-3c'
import { STRINGS_3C3 } from '../renderer/src/ui/strings-3c3'

test('phase 3c.3: every key has its Turkish, with the same parameters, and is in STRINGS', () => {
  const params = (s: string): string => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(',')
  const keys = Object.keys(STRINGS_3C3)
  assert.ok(keys.length > 50, `${keys.length} keys`)
  for (const [k, e] of Object.entries(STRINGS_3C3)) {
    assert.ok(e.en.trim().length > 0, `${k}: English`)
    assert.ok(e.tr.trim().length > 0, `${k}: Turkish`)
    assert.equal(params(e.tr), params(e.en), `${k}: the same parameters`)
    assert.deepEqual((STRINGS as Record<string, unknown>)[k], e, `${k} is in STRINGS`)
  }
})

test('phase 3c.3: no key of the Inspector repeats one of phase 3c', () => {
  const other = new Set(Object.keys(STRINGS_3C))
  assert.deepEqual(Object.keys(STRINGS_3C3).filter((k) => other.has(k)), [])
})
