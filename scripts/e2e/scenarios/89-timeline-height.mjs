// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// Phase 3c.Y, K1 (tarifler\FAZ3C-YERLESIM.md): the timeline is 42 % of the
// window (1920 × 1080 → 454 px), kept as a share; an old saved 300 px is the
// new default, an old dragged value its share; a drag survives the page
// opening again; at 1280 × 720 the limits hold (preview ≥ 220 px, timeline
// ≤ 65 %); a double click on the splitter puts the default back; the
// splitter moves 16 px per arrow key.
export const name = 'layout-timeline-height'

const KEY = 'autocut-panel-layout'

export async function run({ c, lib }) {
  const { assert } = lib
  const size = (width, height) => c.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false })
  const height = () => lib.timelineHeight(c)
  const near = async (want, what) => {
    await c.waitFor(`${what}: ${want} px`, async () => Math.abs((await height()) - want) <= 2, 4000)
  }
  /** The page opened again with this saved layout (null: none, a fresh profile). */
  const openWith = async (saved) => {
    await c.run((k, v) => { if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v); return true }, KEY, saved === null ? null : JSON.stringify(saved))
    await c.send('Page.reload', { ignoreCache: false })
    await c.sleep(300)
    await lib.ready(c)
    for (let i = 0; i < 10; i++) {
      if (await c.has('ask.recovery')) { await c.click('ask.recovery.discard'); break }
      await c.sleep(100)
    }
  }
  const saved = () => c.run((k) => JSON.parse(localStorage.getItem(k) ?? 'null'), KEY)

  try {
    // A fresh profile: 42 % of 1080.
    await openWith(null)
    await near(454, 'fresh profile')
    const fresh = await height()
    // An old profile with the old untouched default: the new default.
    await openWith({ bin: 340, inspector: 292, timeline: 300 })
    await near(454, 'old default 300')
    // An old profile the user had dragged: its share of this window.
    await openWith({ bin: 340, inspector: 292, timeline: 432 })
    await near(432, 'old dragged 432')
    await openWith({ bin: 340, inspector: 292, timeline: 300 })

    // Dragged up 100 px: kept as a share, there again after the page opens again.
    let s = await c.box('splitter.timeline')
    await c.dragAt(s.cx, s.cy, s.cx, s.cy - 100, { steps: 10 })
    await near(554, 'dragged')
    const kept = await saved()
    assert.ok(Math.abs(kept.timelineRatio - 554 / 1080) < 0.003, `saved as a share (${kept.timelineRatio})`)
    assert.equal(kept.timeline, undefined, 'no pixel value saved')
    await openWith(kept)
    await near(554, 'after opening again')

    // A smaller window: the same share, then the limits.
    await size(1280, 720)
    await near(Math.round((554 / 1080) * 720), 'the same share at 720')
    s = await c.box('splitter.timeline')
    await c.dragAt(s.cx, s.cy, s.cx, 30, { steps: 12 })
    // At most 65 % (468) and the preview keeps 220 (720 − 48 − 6 − 6 − 220 = 440;
    // v3: 6 px of ground under the timeline's card).
    await near(440, 'dragged to the top at 720')
    const top = await height()
    assert.ok(720 - 48 - 6 - top >= 220, `the preview keeps 220 px (${720 - 54 - top})`)
    s = await c.box('splitter.timeline')
    await c.dragAt(s.cx, s.cy, s.cx, 715, { steps: 12 })
    await near(240, 'dragged to the bottom: at least 240')

    // Double click: the default (42 % of 720 = 302).
    s = await c.box('splitter.timeline')
    await c.clickAt(s.cx, s.cy, { double: true })
    await near(302, 'double click at 720')

    // The keyboard: focused, Up grows it 16 px, Down shrinks it.
    await c.click('splitter.timeline')
    assert.equal(await lib.focused(c), 'splitter.timeline')
    assert.equal(await c.attr('splitter.timeline', 'role'), 'separator')
    await c.key('ArrowUp')
    await near(318, 'Up')
    await c.key('ArrowDown')
    await c.key('ArrowDown')
    await near(286, 'Down twice')

    // Back to the default and the run's window size.
    s = await c.box('splitter.timeline')
    await c.clickAt(s.cx, s.cy, { double: true })
    await size(1920, 1080)
    await near(454, 'the default at 1080')
    console.log(`     timeline: fresh ${fresh} px at 1080; 440 max / 240 min at 720; double click 302; arrows ±16`)
  } finally {
    await size(1920, 1080)
  }
}
