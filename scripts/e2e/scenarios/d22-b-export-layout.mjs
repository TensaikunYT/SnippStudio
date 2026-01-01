// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// 22 November, L9 (D22-PLAN-B.md): the export window's small flaws, measured
// in English and Turkish at 1366 × 768 and 1920 × 1080, with every output
// ticked and the in-to-out range open (the fullest the window gets).
//  - An in / out time and its "at the playhead" button do not touch
//    ("5.00 sAt the playhead"; in Turkish the button lay over the number).
//  - A choice shows its whole text ("1920 × 1080 (proj", "High (recommenc").
//    So does a time ("12,00 sn" lost its last letter in Turkish).
//  - The ticks are square: several outputs may be ticked, and a round tick
//    reads as "one of these".
//  - The window stays inside the screen; the page itself never scrolls.
// SNIPP_SCREENS=<folder>: the four pictures are written there.
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
export const name = 'd22-b-export-layout'

const SIZES = [[1366, 768], [1920, 1080]]

export async function run({ c, app, media, lib }) {
  const { assert } = lib
  const shots = process.env.SNIPP_SCREENS
  if (shots) mkdirSync(shots, { recursive: true })
  const [talk] = await lib.seedAssets(app, c, [media.talk])
  await lib.seedTimeline(c, [talk.id])
  try {
    for (const lang of ['en', 'tr']) {
      for (const [w, h] of SIZES) {
        await c.send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: false })
        await c.run((lang) => window.__store.getState().setUiLang(lang), lang)
        await c.click('topbar.export')
        await c.waitId('dialog.export')
        for (const k of ['video', 'sound', 'frame']) {
          const on = await c.run((id) => document.querySelector(`[data-testid="export.out.${id}"]`)?.checked ?? null, k)
          if (on === false) await c.click(`export.out.${k}`)
        }
        await c.click('export.range.inout')
        await c.waitId('export.range.in-playhead')
        const m = await c.run(() => {
          const q = (id) => document.querySelector(`[data-testid="${id}"]`)
          const r = (el) => { const b = el.getBoundingClientRect(); return { x: b.left, y: b.top, r: b.right, b: b.bottom, w: b.width, h: b.height } }
          const out = { range: [], selects: [], ticks: [] }
          for (const side of ['in', 'out']) out.range.push({ side, field: r(q(`export.range.${side}`)), button: r(q(`export.range.${side}-playhead`)) })
          const ctx = document.createElement('canvas').getContext('2d')
          for (const sel of document.querySelectorAll('[data-testid="dialog.export"] select')) {
            const cs = getComputedStyle(sel)
            ctx.font = `${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`
            const text = sel.selectedOptions[0]?.textContent ?? ''
            out.selects.push({ id: sel.getAttribute('data-testid'), text, need: Math.ceil(ctx.measureText(text).width), room: Math.floor(sel.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight)) })
          }
          for (const box of document.querySelectorAll('[data-testid="dialog.export"] input[type="checkbox"]')) {
            const b = box.getBoundingClientRect()
            out.ticks.push({ id: box.getAttribute('data-testid'), w: b.width, h: b.height, corner: parseFloat(getComputedStyle(box).borderTopLeftRadius) })
          }
          out.numbers = [...document.querySelectorAll('[data-testid="dialog.export"] input.ui-number')].map((n) => ({ id: n.getAttribute('data-testid'), text: n.value, need: n.scrollWidth, room: n.clientWidth }))
          out.dialog = r(q('dialog.export'))
          out.page = { scrollTop: document.documentElement.scrollTop, scrollHeight: document.documentElement.scrollHeight, clientHeight: document.documentElement.clientHeight, w: innerWidth, h: innerHeight }
          return out
        })
        const at = `${lang} ${w}×${h}`
        for (const { side, field, button } of m.range) {
          assert.ok(button.x - field.r >= 8, `${at}: the ${side} time and its button are ${Math.round(button.x - field.r)} px apart`)
          assert.ok(Math.abs((field.y + field.b) / 2 - (button.y + button.b) / 2) <= 2, `${at}: the ${side} time and its button are on one line`)
          assert.ok(button.r <= m.dialog.r, `${at}: the ${side} button is inside the window`)
        }
        assert.ok(m.selects.length >= 6, `${at}: the choices were found (${m.selects.length})`)
        for (const s of m.selects) assert.ok(s.need <= s.room, `${at}: "${s.text}" (${s.id}) needs ${s.need} px and has ${s.room}`)
        for (const n of m.numbers) assert.ok(n.need <= n.room, `${at}: "${n.text}" (${n.id}) needs ${n.need} px and has ${n.room}`)
        assert.ok(m.ticks.length >= 5, `${at}: the ticks were found (${m.ticks.length})`)
        for (const t of m.ticks) {
          assert.equal(t.w, t.h, `${at}: ${t.id} is as wide as it is high`)
          assert.ok(t.corner <= t.w / 4, `${at}: ${t.id} is a square tick (corner ${t.corner} px of ${t.w})`)
        }
        assert.ok(m.dialog.x >= 0 && m.dialog.r <= m.page.w && m.dialog.y >= 0 && m.dialog.b <= m.page.h, `${at}: the window is inside the screen (${JSON.stringify(m.dialog)})`)
        assert.equal(m.page.scrollTop, 0, `${at}: the page did not scroll`)
        assert.equal(m.page.scrollHeight, m.page.clientHeight, `${at}: the page has nothing to scroll`)
        if (shots) await c.shot(join(shots, `d22-b-export-${w}-${lang}.png`))
        await c.click('export.cancel')
        await c.waitGone('dialog.export')
      }
    }
    console.log('     en + tr at 1366 × 768 and 1920 × 1080: times and buttons apart, choices whole, square ticks, the window inside the screen')
  } finally {
    await c.send('Emulation.setDeviceMetricsOverride', { width: 1920, height: 1080, deviceScaleFactor: 1, mobile: false })
    await c.run(() => window.__store.getState().setUiLang('en'))
  }
}
