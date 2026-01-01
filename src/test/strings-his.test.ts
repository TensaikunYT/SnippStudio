// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// Phase 3c.T (the timeline's feel): every key it added is written in English
// and Turkish, with the same parameters, is part of STRINGS, and repeats no
// key of the other phase 3c files (the same check as strings-3c2.test.ts).
import assert from 'node:assert/strict'
import test from 'node:test'
import { STRINGS } from '../renderer/src/ui/strings'
import { STRINGS_3C } from '../renderer/src/ui/strings-3c'
import { STRINGS_3C2 } from '../renderer/src/ui/strings-3c2'
import { STRINGS_3C3 } from '../renderer/src/ui/strings-3c3'
import { STRINGS_3C4 } from '../renderer/src/ui/strings-3c4'
import { STRINGS_HIS } from '../renderer/src/ui/strings-his'

test('phase 3c.T: every key has its Turkish, with the same parameters, and is in STRINGS', () => {
  const params = (s: string): string => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(',')
  const keys = Object.keys(STRINGS_HIS)
  assert.ok(keys.length >= 10, `${keys.length} keys`)
  for (const [k, e] of Object.entries(STRINGS_HIS)) {
    assert.ok(e.en.trim().length > 0, `${k}: English`)
    assert.ok(e.tr.trim().length > 0, `${k}: Turkish`)
    assert.equal(params(e.tr), params(e.en), `${k}: the same parameters`)
    assert.deepEqual((STRINGS as Record<string, unknown>)[k], e, `${k} is in STRINGS`)
  }
})

test('phase 3c.T: no key repeats one of the other phase 3c files', () => {
  const other = new Set([...Object.keys(STRINGS_3C), ...Object.keys(STRINGS_3C2), ...Object.keys(STRINGS_3C3), ...Object.keys(STRINGS_3C4)])
  assert.deepEqual(Object.keys(STRINGS_HIS).filter((k) => other.has(k)), [])
})
