// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// The ready shortcut sets (phase 10, FAZ10-PLAN.md "Hazır kısayol takımları"):
// every set, on every platform, gives each action its own key, none the app
// keeps, and every key it sets has the page it was read on.
import assert from 'node:assert/strict'
import test from 'node:test'
import { ACTIONS, defaultBindings, type ActionId } from '../renderer/src/shortcuts'
import { PRESETS, RESERVED_KEYS, bindingClashes, presetBindings, presetOf } from '../renderer/src/shortcuts-presets'
import { STRINGS, setLang, t } from '../renderer/src/ui/strings'
import { shortcutLabel } from '../renderer/src/ui/logic'
import type { UiPlatform } from '../renderer/src/os-platform'

const PLATFORMS: UiPlatform[] = ['win32', 'darwin', 'linux']
const ids = new Set<string>(ACTIONS.map((a) => a.id))

test('four sets, in order, each named through t() in both languages ("… style", no other mark)', () => {
  assert.deepEqual(PRESETS.map((p) => p.id), ['snippstudio', 'premiere', 'davinci', 'capcut'])
  for (const p of PRESETS) {
    const e = STRINGS[p.nameKey] as { en: string; tr?: string }
    assert.ok(e.en && e.tr, p.id)
    if (p.id !== 'snippstudio') {
      assert.match(e.en, / style$/)
      assert.match(e.tr!, / tarzı$/)
    }
  }
})

test('no two actions on one key, and none on a key the app keeps, in every set on every platform', () => {
  assert.deepEqual(bindingClashes(defaultBindings()), [], 'the defaults themselves')
  for (const p of PRESETS)
    for (const pl of PLATFORMS) assert.deepEqual(bindingClashes(presetBindings(p.id, pl)), [], `${p.id} on ${pl}`)
  // The checker catches both.
  assert.ok(bindingClashes({ ...defaultBindings(), selectTool: 's' }).some((x) => /split and selectTool|selectTool/.test(x)))
  assert.ok(bindingClashes({ ...defaultBindings(), selectTool: 'm' }).some((x) => /kept by the app/.test(x)))
})

test('every key a set writes is a real action with its documentation page; the moved ones are actions too', () => {
  for (const p of PRESETS) {
    for (const k of p.keys) {
      assert.ok(ids.has(k.action), `${p.id}: ${k.action}`)
      assert.match(k.source, /^https:\/\/(helpx\.adobe\.com|www\.capcut\.com)\//, `${p.id} ${k.action}: an official page`)
      assert.equal(RESERVED_KEYS.includes(k.key), false)
    }
    for (const a of Object.keys(p.moved)) assert.ok(ids.has(a), `${p.id} moved ${a}`)
    if (!p.verified) assert.deepEqual([p.keys.length, Object.keys(p.moved).length], [0, 0], `${p.id}: nothing written that was not checked`)
  }
})

test('Premiere Pro style: the documented keys, a Mac gets its own column; actions without a counterpart keep their key', () => {
  const win = presetBindings('premiere', 'win32')
  const mac = presetBindings('premiere', 'darwin')
  assert.equal(win.selectTool, 'v')
  assert.equal(win.splitTool, 'c')
  assert.equal(win.splitHere, 'ctrl+k')
  assert.equal(win.toggleDisable, 'shift+e')
  assert.equal(mac.toggleDisable, 'ctrl+shift+e', 'Shift+Cmd+E')
  assert.equal(mac.nudgeLeft, 'ctrl+arrowleft', 'Cmd+Left')
  assert.equal(win.nudgeLeft, 'alt+arrowleft')
  assert.equal(win.cutter, 'b', 'the cutter took the key the split tool left')
  // Untouched actions stay on their defaults.
  const d = defaultBindings()
  const changed = (Object.keys(d) as ActionId[]).filter((a) => d[a] !== win[a]).sort()
  assert.deepEqual(changed, ['cutter', 'selectTool', 'splitHere', 'splitTool', 'toggleDisable'])
  // On a Mac the labels say ⌘ (the helper of step 5).
  assert.equal(shortcutLabel(mac.splitHere, 'darwin'), '⌘ K')
  assert.equal(shortcutLabel(win.splitHere, 'win32'), 'Ctrl K')
})

test('CapCut style: its documented keys are SnippStudio\'s own; DaVinci Resolve style: not checked, closed', () => {
  for (const pl of PLATFORMS) assert.deepEqual(presetBindings('capcut', pl), defaultBindings())
  const davinci = PRESETS.find((p) => p.id === 'davinci')!
  assert.equal(davinci.verified, false)
})

test('presetOf: the set the keys are, or null for the user\'s own', () => {
  for (const pl of PLATFORMS) {
    assert.equal(presetOf(defaultBindings(), pl), 'snippstudio')
    assert.equal(presetOf(presetBindings('premiere', pl), pl), 'premiere')
    assert.equal(presetOf({ ...presetBindings('premiere', pl), save: 'ctrl+alt+s' }, pl), null)
  }
})

test('the window\'s words in both languages', () => {
  try {
    setLang('tr')
    assert.equal(t('keys.preset.label'), 'Hazır takım')
    assert.equal(t('keys.preset.premiere'), 'Premiere Pro tarzı')
    setLang('en')
    assert.equal(t('keys.preset.capcut'), 'CapCut style')
  } finally {
    setLang('en')
  }
})
