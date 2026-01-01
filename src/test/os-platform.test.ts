// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// Phase 10a, steps 5 and 6 (FAZ10-PLAN.md): the key names, the mouse
// modifiers and the fonts of each platform, run here on Windows with the
// platform passed in (or faked with setUiPlatformForTests). Every Windows
// answer is the one the code gave before phase 10.
import assert from 'node:assert/strict'
import test from 'node:test'
import {
  addModHeld,
  ariaModName,
  captionFontDefault,
  defaultCaptionFont,
  fontChoices,
  fontInstalledBy,
  keysInText,
  modKeyName,
  overlayFontStack,
  platformFromNavigator,
  setUiPlatformForTests,
  terminalMonoStack,
  uiPlatform,
  zoomWheelHeld,
  type UiPlatform
} from '../renderer/src/os-platform'
import { ariaShortcut, shortcutLabel } from '../renderer/src/ui/logic'
import { STRINGS, setLang, t, type Entry, type StringKey } from '../renderer/src/ui/strings'
import { bindingLabel } from '../renderer/src/shortcuts'
import { defaultProject } from '../renderer/src/types'
import { fontsUsed, preflight } from '../renderer/src/export/preflight'

const ALL: UiPlatform[] = ['win32', 'darwin', 'linux']
const CMD = '⌘'
const OPT = '⌥'

test('platformFromNavigator: Windows, Mac, the rest is Linux; nothing known is Windows', () => {
  assert.equal(platformFromNavigator('Win32'), 'win32')
  assert.equal(platformFromNavigator('MacIntel'), 'darwin')
  assert.equal(platformFromNavigator('Linux x86_64'), 'linux')
  assert.equal(platformFromNavigator('Linux aarch64'), 'linux')
  assert.equal(platformFromNavigator(''), 'win32')
  assert.equal(platformFromNavigator(undefined), 'win32')
  // This test runs on Windows: the real platform is Windows.
  setUiPlatformForTests(null)
  assert.equal(uiPlatform(), process.platform === 'darwin' ? 'darwin' : process.platform === 'win32' ? 'win32' : 'linux')
})

test('shortcutLabel: Ctrl S on Windows and Linux, ⌘ S on a Mac; meta is Win / Super / ⌘', () => {
  assert.equal(shortcutLabel('ctrl+s', 'win32'), 'Ctrl S')
  assert.equal(shortcutLabel('ctrl+s', 'linux'), 'Ctrl S')
  assert.equal(shortcutLabel('ctrl+s', 'darwin'), `${CMD} S`)
  assert.equal(shortcutLabel('ctrl+shift+z', 'darwin'), `${CMD} ⇧ Z`)
  assert.equal(shortcutLabel('alt+enter', 'darwin'), `${OPT} Enter`)
  assert.equal(shortcutLabel('meta+e', 'win32'), 'Win E')
  assert.equal(shortcutLabel('meta+e', 'linux'), 'Super E')
  assert.equal(shortcutLabel('meta+e', 'darwin'), `${CMD} E`)
  // Windows: exactly the old table.
  assert.equal(shortcutLabel('ctrl+shift+alt+del', 'win32'), 'Ctrl Shift Alt Del')
  assert.equal(shortcutLabel('esc', 'darwin'), 'Esc')
  for (const p of ALL) assert.equal(modKeyName('shift', p) === 'Shift', p !== 'darwin')
})

test('ariaShortcut: Control on Windows and Linux, Meta on a Mac', () => {
  assert.equal(ariaShortcut('ctrl+d', 'win32'), 'Control+D')
  assert.equal(ariaShortcut('ctrl+d', 'linux'), 'Control+D')
  assert.equal(ariaShortcut('ctrl+d', 'darwin'), 'Meta+D')
  assert.equal(ariaModName('alt', 'darwin'), 'Alt')
})

test('keysInText: Windows and Linux keep the text; a Mac reads Cmd and Option', () => {
  const s = 'Ctrl+Z undoes it · Ctrl/Shift for several · Alt+drag to duplicate · Ctrl+Shift+Z'
  assert.equal(keysInText(s, 'win32'), s)
  assert.equal(keysInText(s, 'linux'), s)
  assert.equal(keysInText(s, 'darwin'), `${CMD}+Z undoes it · ${CMD}/Shift for several · ${OPT}+drag to duplicate · ${CMD}+Shift+Z`)
  // The Control key itself where the code reads ctrlKey (the subtitle split).
  assert.equal(keysInText('Ctrl+Space or Alt+Enter', 'darwin'), `⌃+Space or ${OPT}+Enter`)
  // Only key names: words that merely start the same stay.
  assert.equal(keysInText('Alternate takes, Control room', 'darwin'), 'Alternate takes, Control room')
})

test('every text of the interface: unchanged on Windows and Linux, no "Ctrl+" left on a Mac', () => {
  for (const [k, e] of Object.entries(STRINGS) as [string, Entry][]) {
    for (const s of [e.en, e.tr].filter((x): x is string => !!x)) {
      assert.equal(keysInText(s, 'win32'), s, k)
      assert.equal(keysInText(s, 'linux'), s, k)
      assert.equal(/\bCtrl\+/.test(keysInText(s, 'darwin')), false, `${k}: ${keysInText(s, 'darwin')}`)
    }
  }
})

test('t() writes the platform\'s keys; bindingLabel too', () => {
  const k = 'agent.edited' as StringKey
  try {
    setLang('en')
    setUiPlatformForTests('win32')
    assert.equal(t(k, { what: 'cut' }), 'Agent: cut. Ctrl+Z undoes it.')
    assert.equal(bindingLabel('ctrl+shift+z'), 'Ctrl + Shift + Z')
    setUiPlatformForTests('linux')
    assert.equal(t(k, { what: 'cut' }), 'Agent: cut. Ctrl+Z undoes it.')
    setUiPlatformForTests('darwin')
    assert.equal(t(k, { what: 'cut' }), `Agent: cut. ${CMD}+Z undoes it.`)
    assert.equal(bindingLabel('ctrl+shift+z'), `${CMD} + Shift + Z`)
    assert.equal(bindingLabel('alt+,'), `${OPT} + ,`)
    setLang('tr')
    assert.equal(t(k, { what: 'kesim' }), `Ajan: kesim. ${CMD}+Z geri alır.`)
  } finally {
    setLang('en')
    setUiPlatformForTests(null)
  }
})

test('the mouse: add to the selection and zoom by wheel', () => {
  const ev = (ctrlKey: boolean, metaKey: boolean) => ({ ctrlKey, metaKey })
  for (const p of ['win32', 'linux'] as const) {
    // As before phase 10: Ctrl only.
    assert.equal(addModHeld(ev(true, false), p), true)
    assert.equal(addModHeld(ev(false, true), p), false)
    assert.equal(zoomWheelHeld(ev(true, false), p), true)
    assert.equal(zoomWheelHeld(ev(false, true), p), false)
    assert.equal(zoomWheelHeld(ev(false, false), p), false)
  }
  assert.equal(addModHeld(ev(false, true), 'darwin'), true, 'Cmd+click adds')
  assert.equal(addModHeld(ev(true, false), 'darwin'), true)
  assert.equal(zoomWheelHeld(ev(true, false), 'darwin'), true, 'a pinch arrives as ctrl+wheel')
  assert.equal(zoomWheelHeld(ev(false, true), 'darwin'), true, 'Cmd+wheel')
  assert.equal(zoomWheelHeld(ev(false, false), 'darwin'), false)
})

// A measurer that knows a few faces: a missing face measures like its generic.
const fakeMeasure = (have: string[]) => (font: string): number => {
  const m = /"([^"]+)", (\S+)$/.exec(font)
  const generic = m ? m[2] : font.split(' ').slice(1).join(' ')
  const base = { monospace: 600, serif: 500, 'sans-serif': 520 }[generic] ?? 0
  return m && have.includes(m[1]) ? 555 + m[1].length : base
}

test('fontInstalledBy: a face is there when it measures unlike the generic fallbacks', () => {
  const m = fakeMeasure(['Arial', 'Helvetica'])
  assert.equal(fontInstalledBy(m, 'Arial'), true)
  assert.equal(fontInstalledBy(m, 'Segoe UI Black'), false)
  assert.equal(fontInstalledBy(m, '"Helvetica"'), true, 'quotes in the name are ignored')
})

test('defaultCaptionFont: Arial on Windows always; elsewhere Arial if there, else the bundled Inter', () => {
  assert.equal(defaultCaptionFont('win32', () => false), 'Arial')
  assert.equal(defaultCaptionFont('win32', null), 'Arial')
  assert.equal(defaultCaptionFont('darwin', (f) => f === 'Arial'), 'Arial')
  assert.equal(defaultCaptionFont('linux', () => false), 'Inter')
  assert.equal(defaultCaptionFont('linux', null), 'Arial', 'nothing to measure with (Node): as before')
  // In Node (no canvas) a new project's font is Arial on every platform, so a
  // project made by a test is the same everywhere (the store applies it).
  try {
    for (const p of ALL) {
      setUiPlatformForTests(p)
      assert.equal(captionFontDefault(), 'Arial', p)
    }
  } finally {
    setUiPlatformForTests(null)
  }
})

test('fontChoices: Windows lists everything; elsewhere the missing system faces go, a chosen one stays marked', () => {
  const list = ['Inter', 'Segoe UI Black', 'Arial', 'Impact']
  const always = new Set(['Inter'])
  const has = (f: string): boolean => ['Arial'].includes(f)
  const win = fontChoices(list, always, 'win32', has, 'Segoe UI Black')
  assert.deepEqual(win.map((c) => c.family), list)
  assert.equal(win.some((c) => c.missing), false)
  assert.deepEqual(fontChoices(list, always, 'linux', has), [
    { family: 'Inter', missing: false },
    { family: 'Arial', missing: false }
  ])
  assert.deepEqual(fontChoices(list, always, 'darwin', has, 'Impact').map((c) => `${c.family}${c.missing ? '?' : ''}`), ['Inter', 'Arial', 'Impact?'])
  // A face named by a project from another computer and not in the list.
  assert.deepEqual(fontChoices(list, always, 'linux', has, 'Helvetica Neue').map((c) => `${c.family}${c.missing ? '?' : ''}`), ['Inter', 'Arial', 'Helvetica Neue?'])
  // Nothing to measure with: as on Windows.
  assert.equal(fontChoices(list, always, 'linux', null).length, list.length)
})

test('font stacks: Windows exactly as before, the bundled face first elsewhere', () => {
  assert.equal(terminalMonoStack('win32'), '"Cascadia Mono", Consolas, "DejaVu Sans Mono", monospace')
  for (const p of ['darwin', 'linux'] as const) assert.match(terminalMonoStack(p), /^"JetBrains Mono", /)
  assert.equal(overlayFontStack('win32'), '"Segoe UI", sans-serif')
  assert.match(overlayFontStack('linux'), /^"Inter UI", /)
})

test('preflight: a font the computer lacks is said once, where it is first seen; nothing without the window\'s answer', () => {
  const p = defaultProject()
  p.captionStyle.fontFamily = 'Segoe UI Black'
  p.captions = [
    { id: 'c1', start: 4, end: 6, text: 'a' } as never,
    { id: 'c2', start: 2, end: 3, text: 'b', font: 'Helvetica Neue' } as never,
    { id: 'c3', start: 8, end: 9, text: 'c', style: { ...p.captionStyle, fontFamily: 'Segoe UI Black' } } as never
  ]
  assert.deepEqual(fontsUsed(p), [
    { family: 'Helvetica Neue', at: 2 },
    { family: 'Segoe UI Black', at: 2 }
  ])
  const none = preflight(p)
  assert.equal(none.some((x) => x.say?.key === 'pre.faz10.font'), false, 'Windows / tests / the agent: no font finding')
  const found = preflight(p, { fontMissing: (f) => f !== 'Helvetica Neue' }).filter((x) => x.say?.key === 'pre.faz10.font')
  assert.equal(found.length, 1)
  assert.equal(found[0].kind, 'missing')
  assert.equal(found[0].at, 2)
  assert.equal(found[0].say?.name, 'Segoe UI Black')
  // Its English is the key's English word for word.
  setLang('en')
  assert.equal(t('pre.faz10.font', { name: 'Segoe UI Black' }), found[0].text)
})
