// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// Phase 3c.4b (tarifler\FAZ3C.md, 3c.4 item 4): every control the keyboard
// reaches shows the one focus ring, and Tab walks the editor in its reading
// order: the top bar, the left panel, the preview's toolbar, the Inspector,
// the timeline's toolbar (the page's order: the Inspector sits in the work
// row above the timeline). Shift+Tab walks back. With the system's
// "less motion", no transition or animation runs.
export const name = 'a11y-keyboard-focus-motion'

const REGIONS = [
  ['top bar', '.topbar'],
  ['left panel', '.workspace-dock'],
  ['preview toolbar', '.preview-toolbar'],
  ['inspector', '.inspector'],
  ['timeline toolbar', '.tl-toolbar']
]

export async function run({ c, app, media, lib }) {
  const { assert } = lib
  const [talk] = await lib.seedAssets(app, c, [media.talk])
  await lib.seedTimeline(c, [talk.id])
  await c.click('inspector.tab.clip')
  // Tab without the 80 ms of c.key: a few hundred presses.
  const tab = async (shift = false) => {
    const modifiers = shift ? 8 : 0
    await c.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9, modifiers })
    await c.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9, modifiers })
  }
  /** Where the focus is: its region, its name, and whether a ring is drawn. */
  const here = () =>
    c.run(async (regions) => {
      const el = document.activeElement
      if (!el || el === document.body) return null
      // A control drawn see-through (shown only under the pointer) is a stop
      // the eye cannot find (audit E9): what it and its parents let through,
      // once a fade-in has had its time.
      const seen = () => {
        let o = 1
        for (let e = el; e; e = e.parentElement) o *= parseFloat(getComputedStyle(e).opacity)
        return o
      }
      let opacity = seen()
      if (opacity < 0.99) {
        await new Promise((r) => setTimeout(r, 300))
        opacity = seen()
      }
      const region = regions.find(([, sel]) => el.closest(sel))?.[0] ?? null
      const cs = getComputedStyle(el)
      const accent = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim()
      const hex = (rgb) => '#' + (rgb.match(/\d+/g) ?? []).slice(0, 3).map((n) => Number(n).toString(16).padStart(2, '0')).join('').toUpperCase()
      const ring =
        (cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) > 0) ||
        (cs.boxShadow !== 'none' && cs.boxShadow !== '') ||
        // The splitter shows its focus as the accent itself (shell.css).
        hex(cs.backgroundColor) === accent.toUpperCase() ||
        // A slider wears the ring on its handle (DENEME-4, item 15: round the
        // whole track it ran over the value pill above it; ui/base.css).
        el.matches('input.ui-range:focus-visible')
      const visible = el.getClientRects().length > 0
      const label = el.getAttribute('aria-label') || el.getAttribute('data-testid') || el.textContent?.trim().slice(0, 30) || el.tagName
      return { region, ring: ring && opacity >= 0.5, visible, label, focusVisible: el.matches(':focus-visible'), opacity: Math.round(opacity * 100) / 100 }
    }, REGIONS)

  // ---- Tab forward from the top of the page ----------------------------------
  await c.run(() => { document.activeElement?.blur(); window.scrollTo(0, 0); return true })
  const seen = []
  const noRing = []
  let first = null
  for (let i = 0; i < 600; i++) {
    await tab()
    const h = await here()
    if (!h) continue
    const key = `${h.region}|${h.label}`
    if (first === key) break // round the whole page
    first ??= key
    if (h.region && seen[seen.length - 1] !== h.region) seen.push(h.region)
    if (h.visible && h.focusVisible && !h.ring) noRing.push(`${h.region ?? 'elsewhere'}: ${h.label}${h.opacity < 0.5 ? ` (opacity ${h.opacity})` : ''}`)
  }
  // One whole round of the page, read from the top bar on (Tab starts where
  // the last click left the focus: the round is turned to begin at the top).
  const top = seen.indexOf('top bar')
  const round = [...seen.slice(top), ...seen.slice(0, top)]
  const order = round.filter((r, i) => round.indexOf(r) === i)
  console.log(`     Tab order: ${order.join(' → ')}`)
  assert.deepEqual(order, REGIONS.map(([n]) => n), 'Tab reaches each region, in the reading order')
  assert.deepEqual(noRing, [], 'every control the keyboard reaches shows the focus ring')

  // ---- Shift+Tab: back from the timeline's toolbar to the Inspector ------------
  await c.run(() => { document.querySelector('.tl-toolbar button')?.focus(); return true })
  let backTo = null
  for (let i = 0; i < 200 && !backTo; i++) {
    await tab(true)
    const h = await here()
    if (h?.region && h.region !== 'timeline toolbar') backTo = h.region
  }
  assert.equal(backTo, 'inspector', 'Shift+Tab walks back into the Inspector')

  // ---- less motion: nothing moves -------------------------------------------
  await lib.systemMotion(c, 'reduce')
  try {
    const still = await c.run(() => {
      // A toast (it slides in), a button (it fades its colours), the splitter.
      const probe = document.createElement('div')
      probe.className = 'ui-toast'
      document.body.appendChild(probe)
      const els = [probe, document.querySelector('.ui-btn'), document.querySelector('.splitter'), document.querySelector('.tl-clip')].filter(Boolean)
      const out = els.map((el) => {
        const cs = getComputedStyle(el)
        const times = (v) => v.split(',').map((x) => parseFloat(x) || 0)
        return { cls: el.className.split(' ')[0], transition: Math.max(...times(cs.transitionDuration)), animation: Math.max(...times(cs.animationDuration)), reduce: matchMedia('(prefers-reduced-motion: reduce)').matches }
      })
      probe.remove()
      return out
    })
    assert.ok(still.length >= 3, JSON.stringify(still))
    for (const s of still) {
      assert.equal(s.reduce, true)
      assert.equal(s.transition, 0, `${s.cls}: no transition`)
      assert.equal(s.animation, 0, `${s.cls}: no animation`)
    }
    // And with motion allowed, the same button does fade (the check means something).
    await lib.systemMotion(c, 'no-preference')
    const moving = await c.run(() => parseFloat(getComputedStyle(document.querySelector('.ui-btn')).transitionDuration) || 0)
    assert.ok(moving > 0, 'a button fades its colours when motion is allowed')
  } finally {
    await c.send('Emulation.setEmulatedMedia', { features: [] })
  }
}
