// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// Core polish C: every key added for the speed curve is written in English
// and Turkish, with the same parameters, is part of STRINGS, and repeats no
// key of the earlier files.
import assert from 'node:assert/strict'
import test from 'node:test'
import { STRINGS } from '../renderer/src/ui/strings'
import { STRINGS_3C } from '../renderer/src/ui/strings-3c'
import { STRINGS_3C3 } from '../renderer/src/ui/strings-3c3'
import { STRINGS_CILA_B } from '../renderer/src/ui/strings-cila-b'
import { STRINGS_CILA_C } from '../renderer/src/ui/strings-cila-c'

test('cila C: every key has its Turkish, with the same parameters, and is in STRINGS', () => {
  const params = (s: string): string => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(',')
  for (const [k, e] of Object.entries(STRINGS_CILA_C)) {
    assert.ok(k.startsWith('insp.curve.'), `${k}: the prefix`)
    assert.ok(e.en.trim().length > 0, `${k}: English`)
    assert.ok(e.tr.trim().length > 0, `${k}: Turkish`)
    assert.equal(params(e.tr), params(e.en), `${k}: the same parameters`)
    assert.deepEqual((STRINGS as Record<string, unknown>)[k], e, `${k} is in STRINGS`)
  }
  // The silent and stepped hints name the numbers the rules use.
  assert.match(STRINGS_CILA_C['insp.curve.silent'].en, /0\.25×.*8×/)
  assert.match(STRINGS_CILA_C['insp.curve.silent'].tr, /0,25×.*8×/)
  assert.match(STRINGS_CILA_C['insp.curve.stepped'].en, /16×/)
})

test('cila C: no key repeats one of phase 3c, 3c.3 or part B', () => {
  const other = new Set([...Object.keys(STRINGS_3C), ...Object.keys(STRINGS_3C3), ...Object.keys(STRINGS_CILA_B)])
  assert.deepEqual(Object.keys(STRINGS_CILA_C).filter((k) => other.has(k)), [])
})
