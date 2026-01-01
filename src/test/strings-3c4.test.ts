// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// Phase 3c.4 (the dialogs and windows): every key added while they moved onto
// the building blocks is written in English and Turkish, with the same
// parameters, is part of STRINGS, and repeats no key of the earlier 3c files.
import assert from 'node:assert/strict'
import test from 'node:test'
import { STRINGS } from '../renderer/src/ui/strings'
import { STRINGS_3C } from '../renderer/src/ui/strings-3c'
import { STRINGS_3C3 } from '../renderer/src/ui/strings-3c3'
import { STRINGS_3C4 } from '../renderer/src/ui/strings-3c4'

test('phase 3c.4: every key has its Turkish, with the same parameters, and is in STRINGS', () => {
  const params = (s: string): string => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(',')
  const keys = Object.keys(STRINGS_3C4)
  assert.ok(keys.length > 40, `${keys.length} keys`)
  for (const [k, e] of Object.entries(STRINGS_3C4)) {
    assert.ok(e.en.trim().length > 0, `${k}: English`)
    assert.ok(e.tr.trim().length > 0, `${k}: Turkish`)
    assert.equal(params(e.tr), params(e.en), `${k}: the same parameters`)
    assert.deepEqual((STRINGS as Record<string, unknown>)[k], e, `${k} is in STRINGS`)
  }
})

test('phase 3c.4: no key of the windows repeats one of phase 3c or 3c.3', () => {
  const other = new Set([...Object.keys(STRINGS_3C), ...Object.keys(STRINGS_3C3)])
  assert.deepEqual(Object.keys(STRINGS_3C4).filter((k) => other.has(k)), [])
})
