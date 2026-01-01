// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// "Cila" part D in the Inspector, with a real pointer:
//   - pointing at a built-in look shows it in the preview and changes
//     nothing in the project (no undo step, not dirty); the pointer away, the
//     preview is back; a click makes it the clip's LUT, one undo step;
//   - one drag of each new dial (LUT intensity, exposure, glow, halation,
//     mosaic) is ONE undo step and Ctrl+Z gives the old value back;
//   - the keyframe button beside an effect's amount writes a key at the
//     playhead, and the dial then writes onto keys.
import { makeFxMedia } from '../../qa/reference/make-fx-media.mjs'
export const name = 'fx-inspector-looks-dials-keys'
export const timeoutMs = 180_000

const OPEN = ['Clip', 'Effects', 'Color']

/** A small signature of the frame inside the preview canvas (32 × 18). */
const sig = (c) =>
  c.run(() => {
    const cv = document.querySelector('[data-testid="preview.canvas"]')
    const s = window.__store.getState()
    const { width, height } = s.project.settings
    const pv = s.previewView
    const cw = cv.clientWidth
    const ch = cv.clientHeight
    const dpr = cv.width / cw
    const fit = Math.min(cw / width, ch / height) * (pv.zoom || 1)
    const dw = width * fit
    const dh = height * fit
    const dx = (cw - dw) / 2 + (pv.x || 0)
    const dy = (ch - dh) / 2 + (pv.y || 0)
    const o = new OffscreenCanvas(32, 18)
    const g = o.getContext('2d')
    g.drawImage(cv, (dx + 2) * dpr, (dy + 2) * dpr, (dw - 4) * dpr, (dh - 4) * dpr, 0, 0, 32, 18)
    return [...g.getImageData(0, 0, 32, 18).data]
  })
const apart = (a, b) => a.reduce((m, v, i) => m + Math.abs(v - b[i]), 0) / a.length

export async function run({ c, app, lib, work }) {
  const { assert } = lib
  const [pic] = await lib.seedAssets(app, c, [makeFxMedia(work)])
  await lib.seedTimeline(c, [pic.id])
  await c.run((open) => {
    const state = JSON.parse(localStorage.getItem('snipp-sections') ?? '{}')
    for (const id of open) state[id] = true
    localStorage.setItem('snipp-sections', JSON.stringify(state))
  }, OPEN)
  const [first] = await lib.clipList(c)
  await c.run(() => { const s = window.__store.getState(); s.setTime(0.5); s.setDirty(false) })
  await c.click(`timeline.clip.${first.id}`, { fx: 0.5 })
  await c.click('inspector.tab.subs')
  await c.click('inspector.tab.clip')
  // The looks' tiles: the left panel's Filters (DENEME-4, worker W; they
  // were in the Clip tab's Color card too).
  await lib.dockPage(c, 'filters')
  await c.waitId('inspector.color.looks')
  const clip = (pick) => c.st(pick, first.id)
  const pickClip = () => c.run((id) => { const st = window.__store; if (!st.getState().selectedClipIds.includes(id)) st.setState({ selectedClipIds: [id] }) }, first.id)
  const scrollTo = (id) => c.run((sel) => document.querySelector(sel)?.scrollIntoView({ block: 'center' }), `[data-testid="${id}"]`)

  // ---- the looks: pointing shows, a click takes ---------------------------------
  await c.sleep(400)
  const before = await sig(c)
  const depth0 = await lib.undoDepth(c)
  await scrollTo('inspector.color.look.night')
  const tile = await c.box('inspector.color.look.night')
  await c.mouse('mouseMoved', tile.cx, tile.cy)
  const shown = await c.waitFor('the look in the preview', async () => { const s = await sig(c); return apart(s, before) > 8 ? s : null }, 8000)
  assert.equal(await clip((s, id) => s.project.clips[id].lut ?? null), null, 'pointing changes nothing in the project')
  assert.equal(await lib.undoDepth(c), depth0, 'no undo step')
  assert.equal(await c.st((s) => s.dirty), false, 'not dirty')
  // Another look under the pointer: another picture.
  const other = await c.box('inspector.color.look.monoContrast')
  await c.mouse('mouseMoved', other.cx, other.cy)
  await c.waitFor('the other look in the preview', async () => apart(await sig(c), shown) > 4, 8000)
  // The pointer away (onto the timeline): the preview is the project's again.
  const tl = await c.box('timeline.ruler')
  await c.mouse('mouseMoved', tl.cx, tl.cy)
  await c.waitFor('the preview back', async () => apart(await sig(c), before) < 1, 8000)
  // A click takes the look: one undo step.
  await c.click('inspector.color.look.night')
  await c.waitFor('the look on the clip', async () => (await clip((s, id) => s.project.clips[id].lut)) === 'preset:night')
  assert.equal(await lib.undoDepth(c), depth0 + 1, 'taking a look is one undo step')
  assert.equal(await c.attr('inspector.color.look.night', 'aria-pressed'), 'true')
  await c.mouse('mouseMoved', tl.cx, tl.cy)
  await c.waitFor('the look drawn', async () => apart(await sig(c), shown) < 1.5, 8000)

  // ---- one drag, one undo step -------------------------------------------------------
  const close = (a, b) => Math.abs(a - b) < 1e-6
  const dragOnce = async (id, read, from, to) => {
    await pickClip()
    const was = await read()
    const depth = await lib.undoDepth(c)
    await c.waitId(id)
    await scrollTo(id)
    const b = await c.box(id)
    await c.dragAt(b.x + from * b.w, b.cy, b.x + to * b.w, b.cy, { steps: 8 })
    const now = await c.waitFor(`${id}: a new value`, async () => { const v = await read(); return close(v, was) ? null : [v] })
    assert.equal(await lib.undoDepth(c), depth + 1, `${id}: one drag is one undo step (${was} → ${now[0]})`)
    await c.key('z', ['ctrl'])
    await c.waitFor(`${id}: the old value after Ctrl+Z`, async () => close(await read(), was))
    assert.equal(await lib.undoDepth(c), depth, `${id}: the step is gone`)
  }
  await dragOnce('inspector.color.lutAmount', () => clip((s, id) => s.project.clips[id].lutAmount ?? 1), 0.95, 0.4)
  await dragOnce('inspector.color.exposure', () => clip((s, id) => s.project.clips[id].tone?.exposure ?? 0), 0.5, 0.8)
  await dragOnce('inspector.color.shadows', () => clip((s, id) => s.project.clips[id].tone?.shadows ?? 0), 0.5, 0.2)
  await dragOnce('inspector.effects.glow', () => clip((s, id) => s.project.clips[id].bloom?.amount ?? 0), 0.05, 0.6)
  await dragOnce('inspector.effects.halation', () => clip((s, id) => s.project.clips[id].halation?.amount ?? 0), 0.05, 0.6)
  await dragOnce('inspector.effects.mosaic', () => clip((s, id) => s.project.clips[id].mosaic ?? 0), 0.05, 0.4)

  // ---- a key on an effect's amount ----------------------------------------------------
  await pickClip()
  await scrollTo('inspector.effects.glow.key')
  await c.click('inspector.effects.glow.key')
  await c.waitFor('a key at the playhead', async () => ((await clip((s, id) => s.project.clips[id].fxKeys?.bloom?.length)) ?? 0) === 1)
  const key0 = await clip((s, id) => s.project.clips[id].fxKeys.bloom[0])
  assert.ok(Math.abs(key0.time - 0.5) < 0.02, `at the playhead, 0.5 s into the clip (${key0.time})`)
  // Later in the clip the dial writes a second key, not the base.
  await c.run(() => window.__store.getState().setTime(1.5))
  await pickClip()
  const b = await c.box('inspector.effects.glow')
  await c.dragAt(b.x + 0.1 * b.w, b.cy, b.x + 0.7 * b.w, b.cy, { steps: 6 })
  await c.waitFor('a second key', async () => ((await clip((s, id) => s.project.clips[id].fxKeys?.bloom?.length)) ?? 0) === 2)
  const keys = await clip((s, id) => s.project.clips[id].fxKeys.bloom)
  assert.ok(keys[1].time > 1.4 && keys[1].value > keys[0].value, `the dragged value on a key at 1.5 s (${JSON.stringify(keys)})`)
  // On a key, the button takes it away.
  await c.click('inspector.effects.glow.key')
  await c.waitFor('the key gone', async () => ((await clip((s, id) => s.project.clips[id].fxKeys?.bloom?.length)) ?? 0) === 1)
}
