// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// Phase Ç3 patch (haritalar/_fazc3-denetim-dayaniklilik.md R-5): tests that
// fail when the guard they name is taken out. The bar never goes back, also
// when a costly window of sound raises the mean after many cheap frames.
// (The others: c3p-verify "missing frames", c3p-marks "out at or before the
// in", e2e 61 "encoder-lost-tail" for the packet count.)
import assert from 'node:assert/strict'
import test from 'node:test'
import { WorkBar } from '../renderer/src/export/progress'

test('R-5 (R29): the bar never goes back, though a costly window of sound comes after cheap ones', () => {
  const bar = new WorkBar(1000, 10, 0, 1)
  bar.window(100)
  let last = bar.fraction()
  for (let i = 0; i < 900; i++) {
    bar.frame(5)
    const f = bar.fraction()
    assert.ok(f >= last, `frame ${i}: ${f} after ${last}`)
    last = f
  }
  // One costly window (a long effect chain, a slow decode): the mean of the
  // windows jumps, the share already done must not shrink.
  bar.window(10000)
  const after = bar.fraction()
  assert.ok(after >= last, `after a costly window: ${after.toFixed(4)} (was ${last.toFixed(4)})`)
})
