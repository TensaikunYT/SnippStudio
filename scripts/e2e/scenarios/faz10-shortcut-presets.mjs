// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// Phase 10 (FAZ10-PLAN.md "Hazır kısayol takımları"): the Shortcuts window's
// ready sets. Premiere Pro style is chosen with one click: the keys change at
// once, are kept, and work (C is the split tool); one key can still be
// changed by hand (the box says "Your own"); CapCut style and Reset go back
// to the defaults. DaVinci Resolve style is shown, closed (not verified).
// The defaults are put back at the end, whatever happens.
export const name = 'faz10-shortcut-presets'

export async function run({ c, lib }) {
  const { assert } = lib
  const value = () => c.run(() => document.querySelector('[data-testid="shortcuts.preset"]').value)
  const keyText = (a) => c.run((s) => document.querySelector(s)?.textContent?.trim() ?? null, `[data-testid="shortcuts.key.${a}"]`)
  const saved = () => c.ev(`JSON.parse(localStorage.getItem('autocut-shortcuts') ?? '{}')`)
  const open = async () => {
    await c.click('topbar.file')
    await c.click('menu.file.shortcuts')
    await c.waitId('settings.keys')
  }
  try {
    await open()
    assert.equal(await value(), 'snippstudio', 'the defaults are SnippStudio\'s set')
    const davinci = await c.run(() => document.querySelector('[data-testid="shortcuts.preset"] option[value="davinci"]')?.disabled)
    assert.equal(davinci, true, 'DaVinci Resolve style: shown, closed')

    // One click: Premiere Pro style.
    await c.select('shortcuts.preset', 'premiere')
    await c.waitFor('the keys changed', async () => (await keyText('selectTool')) === 'V')
    assert.equal(await keyText('splitTool'), 'C')
    assert.equal(await keyText('cutter'), 'B')
    assert.match(await keyText('splitHere'), /^Ctrl \+ K$/)
    assert.equal(await value(), 'premiere')
    const kept = await saved()
    assert.equal(kept.selectTool, 'v', 'kept in the profile')
    assert.equal(kept.splitHere, 'ctrl+k')
    await c.click('settings.close')
    await c.waitGone('settings')
    // They work: C is now the split tool.
    await c.key('c')
    await c.waitFor('the split tool is on', async () => (await c.st((s) => s.splitToolMode)) === true)
    await c.key('Escape')

    // One key changed by hand: the user's own.
    await open()
    await c.click('shortcuts.key.save')
    await c.key('s', ['ctrl', 'alt'])
    await c.waitFor('the key changed', async () => (await saved()).save === 'ctrl+alt+s')
    assert.equal(await value(), 'custom', 'no set any more')

    // CapCut style: its documented keys are the defaults.
    await c.select('shortcuts.preset', 'capcut')
    await c.waitFor('CapCut chosen', async () => (await value()) === 'capcut')
    assert.equal(await keyText('selectTool'), 'A')
    assert.equal((await saved()).save, 'ctrl+s')

    // Reset to defaults still works, and the box says SnippStudio.
    await c.select('shortcuts.preset', 'premiere')
    await c.waitFor('Premiere again', async () => (await keyText('selectTool')) === 'V')
    await c.click('shortcuts.reset')
    await c.waitFor('the defaults back', async () => (await keyText('selectTool')) === 'A')
    assert.equal(await value(), 'snippstudio')
    await c.click('settings.close')
    await c.waitGone('settings')
    console.log('     Premiere Pro style: V / C / B / Ctrl+K, kept and working; own key → custom; CapCut style and Reset → defaults; DaVinci closed')
  } finally {
    await c.ev(`localStorage.removeItem('autocut-shortcuts'); localStorage.removeItem('snippstudio-shortcut-preset'); true`).catch(() => {})
  }
}
