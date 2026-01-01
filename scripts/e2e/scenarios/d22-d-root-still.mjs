// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// 22 November, L1 (the user: "aniden menü aşağı kaydı"): nothing scrolls the
// window itself. At the window's own size (no emulation: the audit found the
// shift there) and at 1366 x 768, each path that opens a part of the
// Inspector (Canvas → Background, a clip's Animate in / out / idle, File →
// Archive, every section's focus), every tab of the Inspector with all its
// cards open and forty Tab keys, every page of the left panel, Settings: the
// page stays at 0, 0 and is exactly as tall and wide as the window, and the
// top bar stays where it was.
import { scene, windowSize, runnerSize } from '../d22-d-scene.mjs'
export const name = 'd22-d-root-still'
export const timeoutMs = 300_000

export async function run(ctx) {
  const { c, lib } = ctx
  const { assert } = lib
  await scene(ctx)
  const still = async (what) => {
    await c.sleep(450)
    const s = await c.run(() => {
      const de = document.documentElement
      return { top: de.scrollTop, left: de.scrollLeft, sh: de.scrollHeight, ch: de.clientHeight, sw: de.scrollWidth, cw: de.clientWidth, body: document.body.scrollTop, root: document.getElementById('root').scrollTop, bar: Math.round(document.querySelector('[data-testid="topbar.file"]').getBoundingClientRect().top) }
    })
    assert.deepEqual([s.top, s.left, s.body, s.root], [0, 0, 0, 0], `${what}: the window scrolled (${JSON.stringify(s)})`)
    assert.equal(s.sh, s.ch, `${what}: the page is taller than the window (${JSON.stringify(s)})`)
    assert.equal(s.sw, s.cw, `${what}: the page is wider than the window (${JSON.stringify(s)})`)
    return s
  }
  const openCards = () => c.run(() => { for (const h of document.querySelectorAll('.inspector [aria-expanded="false"]')) h.click(); return true })
  const tabKeys = async (n) => {
    for (let i = 0; i < n; i++) {
      await c.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 })
      await c.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 })
    }
  }
  const clipMenuRow = async (id) => {
    await c.click('timeline.clip.v2', { fx: 0.5, fy: 0.7 })
    const b = await c.box('timeline.clip.v2')
    await c.clickAt(b.x + b.w * 0.5, b.y + b.h * 0.6, { button: 'right' })
    await c.click(`timeline.clip.v2.menu.${id}`)
  }
  try {
    for (const size of ['real', [1366, 768]]) {
      const tag = size === 'real' ? 'the window as it opens' : '1366 x 768'
      await windowSize(c, size)
      await c.run(() => { window.__store.setState({ selectedClipIds: [] }); return true })
      const bar = (await still(`${tag}, at rest`)).bar
      const check = async (what) => assert.equal((await still(`${tag}, ${what}`)).bar, bar, `${tag}, ${what}: the top bar moved`)
      await c.click('timeline.clip.v2', { fx: 0.5, fy: 0.7 })
      await check('a clip selected')
      // The audit's path: 136 px up, and it stayed.
      await c.click('topbar.canvas')
      await c.click('topbar.canvas.backdrop')
      await check('Canvas → Background')
      // …and the part asked for is in view, in its own panel.
      const seen = await c.run(() => {
        const b = document.querySelector('.inspector .body').getBoundingClientRect()
        const s = document.querySelector('.inspector [data-section="background"]')?.getBoundingClientRect()
        // (Its title too: not behind the Project tab's row of parts, which stays at the top.)
        const parts = document.querySelector('.inspector .body > .insp-parts')?.getBoundingClientRect()
        return s ? { top: Math.round(s.top - b.top), view: Math.round(b.height), under: parts ? Math.round(s.top - parts.bottom) : 0 } : null
      })
      assert.ok(seen && seen.top >= -1 && seen.top < seen.view - 24 && seen.under >= 0, `${tag}: the Background section in view, its title too (${JSON.stringify(seen)})`)
      for (const row of ['anim-in', 'anim-out', 'idle']) {
        await clipMenuRow(row)
        await check(`the clip's menu → ${row}`)
      }
      await c.click('topbar.file')
      await c.click('menu.file.archive')
      await check('File → Archive')
      // Every tab, its cards open, scrolled to its end, forty Tab keys.
      await c.click('timeline.clip.v2', { fx: 0.5, fy: 0.7 })
      for (const tab of ['clip', 'fx', 'subs', 'notes', 'agent', 'project']) {
        await c.click(`inspector.tab.${tab}`)
        await openCards()
        await check(`the ${tab} tab, every card open`)
        await c.run(() => { const b = document.querySelector('.inspector .body'); b.scrollTop = b.scrollHeight; return true })
        await check(`the ${tab} tab at its end`)
        await tabKeys(40)
        await check(`the ${tab} tab after forty Tab keys`)
        await c.run(() => { document.activeElement?.blur?.(); return true })
      }
      // Every section a shortcut can ask for.
      await c.click('timeline.clip.v2', { fx: 0.5, fy: 0.7 })
      await c.click('inspector.tab.clip')
      await openCards()
      const sections = await c.run(() => [...document.querySelectorAll('.inspector [data-section]')].map((e) => e.dataset.section))
      assert.ok(sections.includes('motion'), `the Clip tab's sections: ${sections}`)
      for (const s of [...sections, 'background', 'archive', 'transition-sound', 'subs']) {
        await c.run((s) => { window.__store.getState().focusInspector(s); return true }, s)
        await check(`the focus on "${s}"`)
      }
      // Every page of the left panel.
      for (const page of ['captions', 'code', 'effects', 'filters', 'sounds', 'templates', 'transitions', 'voiceover', 'media']) {
        await lib.dockPage(c, page)
        await check(`the left panel's ${page} page`)
      }
      await lib.textPage(c)
      await check('the Text page')
      await lib.dockPage(c, 'media')
      await c.click('topbar.settings')
      await c.waitId('settings.nav')
      await check('Settings open')
      await tabKeys(30)
      await check('Settings after thirty Tab keys')
      await c.key('Escape')
      await c.waitGone('settings.nav')
    }
  } finally {
    await runnerSize(c)
  }
}
