// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// Phase 5e + 5f audit patch (tarifler\FAZ5-YAMA-EF.md) D8a: the checker's
// "error" is an uncaught error, a frame that threw, a page not ready, or a
// file / picture the drawing lacks. What the page logged with console.error,
// addresses refused and a script that could not load are facts: kept as
// lines, never the verdict alone.
import assert from 'node:assert/strict'
import test from 'node:test'
import * as L from '../renderer/src/media/codefilm-limits'

type Split = (r: { errors: string[]; blocked: string[]; failed: string[] } | null) => { errors: string[]; facts: string[] }

test('D8a: a page record split into errors and facts', () => {
  const checkLines = (L as unknown as { checkLines?: Split }).checkLines
  assert.ok(checkLines, 'checkLines')
  const r = checkLines!({
    errors: ['console.error: deprecated option', 'Uncaught ReferenceError: x is not defined'],
    blocked: ['https://cdn.jsdelivr.net/npm/somelib@1.0.0/lib.min.js'],
    failed: ['script https://cdn.jsdelivr.net/npm/somelib@1.0.0/lib.min.js', 'script snippfilm://id/gone.js', 'snippfilm://id/a.png', 'https://cdn.example/pic.png']
  })
  assert.deepEqual(r.errors, ['Uncaught ReferenceError: x is not defined', 'could not load: snippfilm://id/a.png', 'could not load: https://cdn.example/pic.png'])
  assert.deepEqual(r.facts, ['console.error: deprecated option', 'blocked: https://cdn.jsdelivr.net/npm/somelib@1.0.0/lib.min.js', 'could not load: script snippfilm://id/gone.js'])
  // Only facts: the verdict is not "error".
  const only = checkLines!({ errors: ['console.error: once'], blocked: ['https://cdn/x.js'], failed: ['script https://cdn/x.js'] })
  assert.equal(L.verdictOf({ errors: only.errors.length, blank: false, unstable: false }), 'ok')
})
