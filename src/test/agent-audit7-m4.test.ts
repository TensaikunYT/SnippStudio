// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// SnippStudio phase 7 audit patch (tarifler\FAZ7-YAMA.md), M4: the subscription note tells the tools apart.
import assert from 'node:assert/strict'
import test from 'node:test'
import { STRINGS } from '../renderer/src/ui/strings'

// ---- M4: the subscription note tells the tools apart ------------------------

test('M4: the plan note says sign-in options differ by tool (both languages), no quota or plan names', () => {
  const plan = STRINGS['agent.picker.plan']
  assert.match(plan.en, /Sign-in options differ by tool; not every subscription works in every tool\./)
  assert.match(plan.tr!, /Giriş seçenekleri araca göre değişir; her abonelik her araçta geçmez\./)
  for (const text of [plan.en, plan.tr!]) assert.doesNotMatch(text, /quota|kota|supported|destekleniyor|Pro\b|Max\b|Plus\b|Team\b/i)
})
