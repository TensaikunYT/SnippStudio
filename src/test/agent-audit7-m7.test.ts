// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// SnippStudio phase 7 audit patch (tarifler\FAZ7-YAMA.md), M7: the OpenCode help names its file.
import assert from 'node:assert/strict'
import test from 'node:test'
import { STRINGS } from '../renderer/src/ui/strings'

// ---- M7: the OpenCode help names the file ----------------------------------

test('M7: the OpenCode help names opencode.json / opencode.jsonc and where it goes (both languages)', () => {
  const help = STRINGS['wiz.s2.if1.opencode'] // (the connection wizard's OpenCode step, SIHIRBAZ-PLAN.md)
  for (const text of [help.en, help.tr!]) {
    assert.match(text, /opencode\.json\b/)
    assert.match(text, /opencode\.jsonc/)
    assert.match(text, /~\/\.config\/opencode\//)
  }
})
