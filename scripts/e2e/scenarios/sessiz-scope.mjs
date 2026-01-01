// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// Dalga 2, S (SESSIZ-PLAN.md): "Remove silence" with the talk picked and an
// unrelated picture on a track above it. The window offers "Picked sound"
// first; Remove cuts the talk only, the picture stays where it was, one undo
// step. "All tracks" names the picture's track among those cut; "Choose…"
// lists the tracks with ticks. Measured in English and Turkish at 1366 × 768
// and 1920 × 1080: the window inside the screen, no text cut short, the
// choices on one line. SNIPP_SCREENS=<folder>: the pictures are written there.
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
export const name = 'sessiz-scope'

const SIZES = [[1920, 1080], [1366, 768]]

const openWindow = async (c) => {
  await c.click('preview.silence')
  await c.waitId('silence')
  await c.waitFor('the scan', async () => (await c.has('silence.scope')) && (await c.attr('silence.status', 'data-busy')) === '0', 30000)
}
const closeWindow = async (c) => {
  await c.click('silence.cancel')
  await c.waitGone('silence')
}

/** Text that does not fit its box, parts that lie over each other, and
 *  where the window is. */
const measure = (c) =>
  c.run(() => {
    const win = document.querySelector('[data-testid="silence"]').closest('.silence-popover') ?? document.querySelector('[data-testid="silence"]')
    const box = (el) => el.getBoundingClientRect()
    const cut = []
    // Every element with text of its own that is clipped (an ellipsis or a
    // hidden overflow) and wider inside than its box.
    for (const el of win.querySelectorAll('*')) {
      const cs = getComputedStyle(el)
      if (cs.overflowX === 'visible' && cs.textOverflow !== 'ellipsis') continue
      if (!(el.textContent ?? '').trim()) continue
      if (el.scrollWidth > el.clientWidth + 1) cut.push(el.textContent)
    }
    for (const btn of win.querySelectorAll('button')) {
      const r = btn.getBoundingClientRect()
      if (r.right > win.getBoundingClientRect().right + 0.5) cut.push(`outside: ${btn.textContent}`)
    }
    const seg = [...win.querySelectorAll('[data-testid^="silence.target."]')].map((b) => ({ id: b.getAttribute("data-testid"), r: { top: box(b).top, left: box(b).left }, fits: b.scrollWidth <= b.clientWidth + 1, text: b.textContent }))
    const w = box(win)
    return { win: { x: w.left, y: w.top, r: w.right, b: w.bottom }, cut, seg, view: { w: innerWidth, h: innerHeight } }
  })

export async function run({ c, app, media, lib }) {
  const { assert } = lib
  const shots = process.env.SNIPP_SCREENS
  if (shots) mkdirSync(shots, { recursive: true })
  const [talk, pic] = await lib.seedAssets(app, c, [media.talk, media.broll[0]])
  await lib.seedTimeline(c, [talk.id])
  // The picture on a track of its own above the talk, all along it.
  await c.run((id) => {
    const s = window.__store.getState()
    s.editTemplates((p) => {
      const T = { x: p.settings.width / 2, y: p.settings.height / 2, scale: 1, rotation: 0 }
      p.tracks.unshift({ id: 'VP', kind: 'video', name: 'V2', clipIds: ['pic1'] })
      p.clips.pic1 = { id: 'pic1', assetId: id, trackId: 'VP', start: 0, inPoint: 0, duration: 12, transform: { ...T }, volume: 1 }
    })
    s.setDirty(false)
  }, pic.id)
  const [clip] = (await lib.clipList(c)).filter((k) => k.trackId !== 'VP')
  const pick = () => c.run((id) => window.__store.setState({ selectedClipIds: [id] }), clip.id)
  const picture = () => c.st((s) => { const k = s.project.clips.pic1; return k && { start: k.start, duration: k.duration, inPoint: k.inPoint, trackId: k.trackId } })
  const pic0 = await picture()

  try {
    // 1. The window in both languages at both sizes, each choice that shows more.
    for (const lang of ['en', 'tr']) {
      for (const [w, h] of SIZES) {
        await c.send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: false })
        await c.run((l) => window.__store.getState().setUiLang(l), lang)
        await pick()
        for (const target of ['picked', 'custom']) {
          await openWindow(c)
          await c.click(`silence.target.${target}`)
          await c.waitFor(target, async () => (await c.attr('silence.scope', 'data-target')) === target && (await c.attr('silence.status', 'data-busy')) === '0')
          await c.sleep(300)
          const m = await measure(c)
          const at = `${lang} ${w}×${h} ${target}`
          if (shots) await c.shot(join(shots, `sessiz-${target}-${w}-${lang}.png`))
          assert.deepEqual(m.cut, [], `${at}: text cut short`)
          assert.ok(m.seg.length === 3 && m.seg.every((s) => s.fits), `${at}: the three choices whole (${JSON.stringify(m.seg.map((s) => s.text))})`)
          assert.ok(m.seg.every((s) => Math.abs(s.r.top - m.seg[0].r.top) < 1), `${at}: the choices on one line (${JSON.stringify(m.seg.map((s) => [s.id, Math.round(s.r.top), Math.round(s.r.left)]))})`)
          assert.ok(m.win.x >= 0 && m.win.y >= 0 && m.win.r <= m.view.w && m.win.b <= m.view.h, `${at}: the window inside the screen (${JSON.stringify(m.win)})`)
          await c.click('silence.target.picked')
          await closeWindow(c)
        }
      }
    }
    // 2. The talk picked: "Picked sound" is chosen, the picture's track is left.
    await pick()
    await openWindow(c)
    assert.equal(await c.attr('silence.scope', 'data-target'), 'picked')
    assert.equal(await c.attr('silence.scope', 'data-cut'), clip.trackId, 'only the talk\'s track is cut')
    assert.ok((await c.attr('silence.scope', 'data-kept')).split(',').includes('VP'), 'the picture\'s track stays')
    const ranges = Number(await c.attr('silence.status', 'data-ranges'))
    assert.ok(ranges >= 1, `pauses found (${ranges})`)
    const marks = await c.st((s) => s.silencePreview)
    assert.ok(marks.every((m) => m.clipId !== 'pic1'), 'no red on the picture')
    const shown = Number(await c.attr('silence.status', 'data-total'))
    const depth0 = await lib.undoDepth(c)
    await c.click('silence.apply')
    await c.waitGone('silence')
    const talkLen = await c.waitFor('the cut', async () => {
      const n = await c.st((s) => Object.values(s.project.clips).filter((k) => k.trackId !== 'VP').reduce((t, k) => t + k.duration, 0))
      return n < 11.99 ? n : null
    })
    assert.ok(lib.near(12 - talkLen, shown, 0.005), `the talk lost what the window showed (${(12 - talkLen).toFixed(3)} / ${shown.toFixed(3)})`)
    assert.deepEqual(await picture(), pic0, 'the picture above is where it was, whole')
    assert.equal((await lib.undoDepth(c)) - depth0, 1, 'one undo step')
    await c.key('z', ['ctrl'])
    await c.waitFor('undo', async () => (await lib.clipList(c)).filter((k) => k.trackId !== 'VP').length === 1)

    // 3. "All tracks": the picture's track is cut too; "Choose…" lists the tracks.
    await pick()
    await openWindow(c)
    await c.click('silence.target.all')
    await c.waitFor('all tracks', async () => (await c.attr('silence.scope', 'data-target')) === 'all' && (await c.attr('silence.status', 'data-busy')) === '0')
    assert.ok((await c.attr('silence.scope', 'data-cut')).split(',').includes('VP'))
    await c.click('silence.target.custom')
    await c.waitId('silence.tracks')
    await c.waitFor('chosen', async () => (await c.attr('silence.scope', 'data-target')) === 'custom' && (await c.attr('silence.status', 'data-busy')) === '0')
    assert.equal(await c.attr('silence.scope', 'data-cut'), clip.trackId, 'it starts from the talk\'s track')
    await c.click('silence.track.VP')
    await c.waitFor('the picture ticked', async () => (await c.attr('silence.scope', 'data-cut')).split(',').includes('VP'))
    await c.click('silence.track.VP')
    await c.waitFor('untick', async () => !(await c.attr('silence.scope', 'data-cut')).split(',').includes('VP'))
    await c.click('silence.target.picked')
    await closeWindow(c)

  } finally {
    await c.send('Emulation.setDeviceMetricsOverride', { width: 1920, height: 1080, deviceScaleFactor: 1, mobile: false })
    await c.run(() => window.__store.getState().setUiLang('en'))
  }
}
