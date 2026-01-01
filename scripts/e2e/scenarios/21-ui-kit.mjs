// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// The building blocks in a real window (SnippStudio phase 3a.2): the type
// faces come from the package (no request leaves the app), and the keyboard,
// the focus and the timing of each block do what the unit tests say their
// decisions are — on the #ui-kit page, elements found by test name and role.
export const name = 'ui-kit-keyboard-focus'

export async function run({ c, lib }) {
  const { assert } = lib
  const val = (id) => c.value(id)
  const attr = (id, a) => c.attr(id, a)
  const focusOn = (id) => c.run((s) => { document.querySelector(s).focus(); return true }, `[data-testid="${id}"]`)
  const errorsBefore = c.consoleErrors.length
  await lib.openKit(c)
  try {
    // ---- the faces: Inter UI and JetBrains Mono, loaded from the app itself ----
    const fonts = await c.run(async () => {
      await document.fonts.load('13px "Inter UI"')
      await document.fonts.load('12px "JetBrains Mono"')
      await document.fonts.ready
      const urls = performance.getEntriesByType('resource').map((e) => e.name)
      // Where each face's file is: the @font-face rules' sources, resolved.
      const faces = []
      for (const sheet of document.styleSheets) {
        let rules = []
        try { rules = [...sheet.cssRules] } catch { /* not readable */ }
        for (const r of rules) {
          if (!(r instanceof CSSFontFaceRule)) continue
          const family = r.style.getPropertyValue('font-family').replace(/["']/g, '').trim()
          if (family !== 'Inter UI' && family !== 'JetBrains Mono') continue
          for (const m of r.style.getPropertyValue('src').matchAll(/url\(["']?([^"')]+)["']?\)/g)) faces.push({ family, url: new URL(m[1], sheet.href ?? location.href).href })
        }
      }
      return {
        loaded: [...document.fonts].filter((f) => f.status === 'loaded').map((f) => f.family.replace(/"/g, '')),
        body: getComputedStyle(document.body).fontFamily,
        mono: getComputedStyle(document.querySelector('[data-testid="kit.slider.scale.value"]')).fontFamily,
        faces,
        remote: urls.filter((u) => /^(https?|wss?):/i.test(u) && !/^(https?|wss?):\/\/(localhost|127\.0\.0\.1)(:|\/)/i.test(u)),
        origin: location.protocol
      }
    })
    assert.ok(fonts.loaded.includes('Inter UI'), `Inter UI loaded (${fonts.loaded})`)
    assert.ok(fonts.loaded.includes('JetBrains Mono'), `JetBrains Mono loaded (${fonts.loaded})`)
    assert.match(fonts.body, /^"?Inter UI"?/)
    assert.match(fonts.mono, /^"?JetBrains Mono"?/)
    assert.equal(fonts.faces.filter((f) => f.family === 'Inter UI').length, 1)
    assert.equal(fonts.faces.filter((f) => f.family === 'JetBrains Mono').length, 2)
    for (const f of fonts.faces) assert.ok(f.url.startsWith(fonts.origin) && /\/assets\//.test(f.url), `${f.family}: ${f.url} is the app's own file`)
    assert.deepEqual(fonts.remote, [], 'no request to the internet')

    // ---- buttons: a click counts, a disabled one does not, Tab moves on, one focus ring ----
    await c.click('kit.button.primary')
    assert.equal(await c.ev(`document.querySelector('[data-testid="kit.clicks"]').textContent`), '1')
    await c.click('kit.button.disabled', { force: true })
    assert.equal(await c.ev(`document.querySelector('[data-testid="kit.clicks"]').textContent`), '1', 'a disabled button does nothing')
    await focusOn('kit.button.primary')
    await c.key('Tab')
    assert.equal(await lib.focused(c), 'kit.button.secondary')
    const ring = await c.ev(`(() => { const s = getComputedStyle(document.activeElement); return { w: s.outlineWidth, c: s.outlineColor, style: s.outlineStyle, shadow: s.boxShadow } })()`)
    assert.equal(ring.w, '1px')
    assert.equal(ring.c, 'rgb(182, 240, 103)')
    assert.match(ring.shadow, /rgba\(182, 240, 103, 0\.28\) 0px 0px 0px 3px/)
    await c.key(' ')
    assert.equal(await c.ev(`document.querySelector('[data-testid="kit.clicks"]').textContent`), '2', 'Space presses a button')

    // ---- the number field: typed, stepped, given back ----
    await c.fill('kit.slider.scale.value', '150', { enter: true })
    assert.equal(await val('kit.slider.scale.value'), '150 %')
    assert.equal(await val('kit.slider.scale.range'), '150')
    await c.key('ArrowUp')
    assert.equal(await val('kit.slider.scale.value'), '151 %')
    await c.key('ArrowUp', ['shift'])
    assert.equal(await val('kit.slider.scale.value'), '161 %')
    await c.key('End')
    assert.equal(await val('kit.slider.scale.value'), '200 %', 'End: the top of the range')
    await c.fill('kit.slider.scale.value', 'abc')
    await c.key('Escape')
    assert.equal(await val('kit.slider.scale.value'), '200 %', 'Escape gives the old value back')
    await c.fill('kit.slider.scale.value', '999', { enter: true })
    assert.equal(await val('kit.slider.scale.value'), '200 %', 'kept in range')
    await c.fill('kit.slider.volume.value', '−6,7 dB', { enter: true })
    assert.equal(await val('kit.slider.volume.value'), '-6.5 dB', 'comma, minus sign and unit read; snapped to the step')
    await c.fill('kit.field.duration', '12', { enter: true })
    assert.equal(await val('kit.field.duration'), '12.0 s')
    // The track with the keyboard.
    await focusOn('kit.slider.opacity.range')
    await c.key('ArrowRight')
    assert.equal(await val('kit.slider.opacity.value'), '86 %')
    // Arayüz v4: Shift + arrow ten steps, Alt + arrow a tenth of one; a
    // drag with Alt held goes a tenth of the pointer's way.
    await focusOn('kit.slider.grain.range')
    await c.key('ArrowRight')
    assert.equal(await val('kit.slider.grain.value'), '51 %', 'a 0–1 slider steps by 1 %')
    await c.key('ArrowRight', ['shift'])
    assert.equal(await val('kit.slider.grain.value'), '61 %', 'Shift: ten steps')
    await c.key('ArrowLeft', ['alt'])
    assert.equal(await attr('kit.slider.grain.value', 'aria-valuenow'), '60.9', 'Alt: a tenth of a step')
    const g = await c.box('kit.slider.grain.range')
    await c.dragAt(g.x + g.w * 0.2, g.cy, g.x + g.w * 0.7, g.cy, { steps: 6 })
    const plain = Number(await attr('kit.slider.grain.value', 'aria-valuenow'))
    assert.ok(plain > 60 && plain < 75, `a plain drag follows the pointer (${plain})`)
    await c.dragAt(g.x + g.w * 0.7, g.cy, g.x + g.w * 0.2, g.cy, { steps: 6, mods: ['alt'] })
    const fine = Number(await attr('kit.slider.grain.value', 'aria-valuenow'))
    assert.ok(Math.abs(plain - fine - 5) < 1.5, `Alt: half the track is a twentieth of the range (${plain} → ${fine})`)
    // The name of a number is its handle.
    const x = await c.box('kit.scrub.x.scrub')
    await c.dragAt(x.cx, x.cy, x.cx + 20, x.cy, { steps: 5 })
    assert.equal(await val('kit.scrub.x'), '20')
    // The card folds, its small tabs choose.
    await c.click('kit.card.part.b')
    assert.equal(await attr('kit.card.part.b', 'aria-selected'), 'true')

    // ---- switch, checkbox ----
    await c.click('kit.toggle.snap')
    assert.equal(await attr('kit.toggle.snap', 'aria-checked'), 'true')
    await c.key(' ')
    assert.equal(await attr('kit.toggle.snap', 'aria-checked'), 'false', 'Space turns it')
    await c.click('kit.check.all')
    assert.equal(await c.ev(`document.querySelector('[data-testid="kit.check.all"]').checked`), true)
    await c.key(' ')
    assert.equal(await c.ev(`document.querySelector('[data-testid="kit.check.all"]').checked`), false)

    // ---- segmented and tabs: arrows choose, Home/End, wrap ----
    // (After a click the arrows are the app's, not a new choice: interface
    // audit E3. Reached by the keyboard, they choose.)
    const keyboardOn = async (id) => {
      await c.run(() => { document.activeElement?.blur(); return true })
      await focusOn(id)
    }
    await c.click('kit.seg.fit')
    await c.key('ArrowRight')
    assert.equal(await attr('kit.seg.fit', 'aria-checked'), 'true', "a click's focus: the arrow does not choose")
    await keyboardOn('kit.seg.fit')
    await c.key('ArrowRight')
    assert.equal(await attr('kit.seg.fill', 'aria-checked'), 'true')
    assert.equal(await lib.focused(c), 'kit.seg.fill')
    await c.key('End')
    assert.equal(await attr('kit.seg.stretch', 'aria-checked'), 'true')
    await c.key('ArrowRight')
    assert.equal(await attr('kit.seg.fit', 'aria-checked'), 'true', 'wraps')
    await c.click('kit.tabs.clip')
    await c.key('ArrowRight')
    assert.equal(await attr('kit.tabs.clip', 'aria-selected'), 'true', "a click's focus: the arrow does not choose")
    await keyboardOn('kit.tabs.clip')
    await c.key('ArrowRight')
    assert.equal(await attr('kit.tabs.look', 'aria-selected'), 'true')
    await c.key('End')
    assert.equal(await attr('kit.tabs.agent', 'aria-selected'), 'true')
    assert.equal(await lib.focused(c), 'kit.tabs.agent')
    await c.key('Home')
    assert.equal(await attr('kit.tabs.clip', 'aria-selected'), 'true')

    // ---- the menu: opens on its first item, skips the disabled one, type-ahead, Escape back to its button ----
    await c.click('kit.menu')
    await c.waitId('kit.menu.menu')
    assert.equal(await attr('kit.menu', 'aria-expanded'), 'true')
    assert.equal(await lib.focused(c), 'kit.menu.item.split')
    await c.key('ArrowDown')
    assert.equal(await lib.focused(c), 'kit.menu.item.duplicate')
    await c.key('ArrowDown')
    assert.equal(await lib.focused(c), 'kit.menu.item.link', 'the disabled item is skipped')
    await c.key('d')
    assert.equal(await lib.focused(c), 'kit.menu.item.delete', 'a letter jumps')
    await c.key('ArrowDown')
    assert.equal(await lib.focused(c), 'kit.menu.item.split', 'wraps')
    await c.key('Escape')
    await c.waitGone('kit.menu.menu')
    assert.equal(await lib.focused(c), 'kit.menu', 'the focus goes back to the button')
    await c.key('ArrowUp')
    await c.waitId('kit.menu.menu')
    assert.equal(await lib.focused(c), 'kit.menu.item.delete', 'ArrowUp opens on the last item')
    await c.key('Home')
    await c.key('ArrowDown')
    await c.key('Enter')
    await c.waitGone('kit.menu.menu')
    assert.match(await c.ev(`document.querySelector('[data-testid="kit.menu.result"]').textContent`), /Duplicate/)
    assert.equal(await lib.focused(c), 'kit.menu')
    // A press outside closes it.
    await c.click('kit.menu')
    await c.waitId('kit.menu.menu')
    await c.click('kit.title')
    await c.waitGone('kit.menu.menu')

    // ---- the dialog: focus in, Tab stays in, Escape out, focus back ----
    await c.click('kit.dialog.open')
    await c.waitId('kit.dialog')
    assert.equal(await lib.focused(c), 'kit.dialog.name', 'the first field has the focus')
    const inside = () => c.ev(`!!document.activeElement?.closest('[data-testid="kit.dialog"]')`)
    for (let i = 0; i < 6; i++) {
      await c.key('Tab', i % 2 ? ['shift'] : [])
      assert.equal(await inside(), true, `Tab ${i + 1} stays inside`)
    }
    for (let i = 0; i < 4; i++) await c.key('Tab')
    assert.equal(await inside(), true)
    await c.key('Escape')
    await c.waitGone('kit.dialog')
    assert.equal(await lib.focused(c), 'kit.dialog.open', 'the focus goes back to the button that opened it')
    // The close button closes it too.
    await c.click('kit.dialog.open')
    await c.click('kit.dialog.close')
    await c.waitGone('kit.dialog')

    // ---- the tooltip: not before 400 ms, then there, gone when the pointer leaves ----
    const tips = () => c.ev(`document.querySelectorAll('.ui-tooltip-layer [role="tooltip"]').length`)
    const host = await c.box('kit.tooltip.host')
    await c.mouse('mouseMoved', host.cx, host.cy)
    await c.sleep(200)
    assert.equal(await tips(), 0, 'not yet at 200 ms')
    await c.waitFor('the tooltip', async () => (await tips()) === 1, 2000, 40)
    assert.match(await c.ev(`document.querySelector('.ui-tooltip-layer [role="tooltip"]').textContent`), /Split the clip.*S/)
    await c.mouse('mouseMoved', 5, 5)
    await c.waitFor('the tooltip gone', async () => (await tips()) === 0, 2000, 40)

    // ---- toasts: one with an action; the action runs and closes it; the close button ----
    const toastIds = async () => (await c.ids('toast.')).filter((x) => /^toast\.\d+$/.test(x))
    await c.click('kit.toast.show')
    const [first] = await c.waitFor('a toast', async () => { const l = await toastIds(); return l.length === 1 ? l : null })
    await c.click(`${first}.action`)
    const [second] = await c.waitFor('the action\'s own toast', async () => { const l = await toastIds(); return l.length === 1 && l[0] !== first ? l : null })
    await c.click(`${second}.dismiss`)
    await c.waitFor('no toast', async () => (await toastIds()).length === 0)
    await c.click('kit.toast.show')
    await c.click('kit.toast.show')
    assert.equal((await toastIds()).length, 2, 'stacked')

    // ---- less motion: when the system asks, the durations and the pulse stop ----
    const motion = () => c.ev(`(() => { const r = getComputedStyle(document.documentElement); const pulse = document.querySelector('.ui-chip-pulse'); return { fast: r.getPropertyValue('--dur-fast').trim(), pulse: r.getPropertyValue('--agent-pulse').trim(), anim: getComputedStyle(pulse).animationName } })()`)
    // (Both ways explicitly: this machine's own setting may already ask for less.)
    try {
      await lib.systemMotion(c, 'no-preference')
      assert.deepEqual(await motion(), { fast: '120ms', pulse: '1.4s', anim: 'ui-pulse' })
      await lib.systemMotion(c, 'reduce')
      assert.deepEqual(await motion(), { fast: '0ms', pulse: '0s', anim: 'none' })
    } finally {
      await c.send('Emulation.setEmulatedMedia', { features: [] })
    }

    // ---- a chip removed; the language switched (t() redraws) and back ----
    await c.click('kit.chip.removable.remove')
    await c.waitGone('kit.chip.removable')
    await c.click('kit.lang.tr')
    await c.waitFor('Turkish words', async () => (await c.ev(`document.querySelector('[data-testid="kit.title"]').textContent`)) === 'Yapı taşları')
    assert.equal(await c.st((s) => s.uiLang), 'tr')
    assert.equal(await c.ev(`localStorage.getItem('snipp-ui-lang')`), 'tr')
    await c.click('kit.lang.en')
    await c.waitFor('English words', async () => (await c.ev(`document.querySelector('[data-testid="kit.title"]').textContent`)) === 'Building blocks')
    assert.deepEqual(c.consoleErrors.slice(errorsBefore), [], 'no page error')
  } finally {
    await lib.closeKit(c)
  }
}
