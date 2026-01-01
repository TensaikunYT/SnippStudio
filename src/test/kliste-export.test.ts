// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// The user's list, item 5 (KLISTE-PLAN.md): a bitrate typed by hand is kept
// for the next export window (with the Custom preset), inside the field's
// own range, and anything else read back from the profile is no bitrate.
import assert from 'node:assert/strict'
import test from 'node:test'
import { CUSTOM_MBPS_MAX, CUSTOM_MBPS_MIN, customMbpsAtStart } from '../renderer/src/export/quality'

test('the custom bitrate comes back with the Custom preset, in range, a whole number', () => {
  assert.equal(customMbpsAtStart('custom', '6'), 6)
  assert.equal(customMbpsAtStart('custom', '12.4'), 12)
  assert.equal(customMbpsAtStart('custom', '999'), CUSTOM_MBPS_MAX)
  assert.equal(customMbpsAtStart('custom', '0.2'), CUSTOM_MBPS_MIN)
  // Not a custom bitrate: the quality choices as before.
  assert.equal(customMbpsAtStart('custom', '0'), 0)
  assert.equal(customMbpsAtStart('custom', null), 0)
  assert.equal(customMbpsAtStart('custom', 'abc'), 0)
  assert.equal(customMbpsAtStart('custom', '-5'), 0)
  // Another preset sets the quality itself.
  assert.equal(customMbpsAtStart('yt1080', '6'), 0)
  assert.equal(customMbpsAtStart('shorts', '6'), 0)
})
