// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// Phase 3c.3 (the Inspector on the building blocks; tarifler\FAZ3C.md decision
// 5): in a real window, with a real pointer, one drag of a slider is ONE undo
// step and Ctrl+Z gives the old value back, for a slider of every family the
// Inspector has; a number typed into its field is taken as typed (kept in
// range, not put on the step grid) and is one undo step too.
import { join } from 'node:path'
export const name = 'inspector-sliders-undo'

/** Every section open, whatever the profile remembers (set before the tab mounts). */
const OPEN = ['Clip', 'Audio', 'Effects', 'Color', 'Crop', 'Keyframes', 'Style', 'Preview snapping', 'Project']

export async function run({ c, app, media, lib }) {
  const { assert } = lib
  const [talk, pic] = await lib.seedAssets(app, c, [media.talk, media.numbered[2]])
  await lib.seedTimeline(c, [talk.id, pic.id])
  await c.run((open) => {
    const state = JSON.parse(localStorage.getItem('snipp-sections') ?? '{}')
    for (const id of open) state[id] = true
    localStorage.setItem('snipp-sections', JSON.stringify(state))
  }, OPEN)
  // (Cards fold by default per kind of selection since kullanım, item 5.)
  await lib.openCards(c, [...OPEN, 'Opacity', 'Speed'])
  const [first] = await lib.clipList(c)
  await c.click(`timeline.clip.${first.id}`, { fx: 0.5 })
  // The tab mounts again, reading the open sections.
  await c.click('inspector.tab.subs')
  await c.click('inspector.tab.clip')
  await c.waitId('inspector.clip.x')

  const clip = (pick) => c.st(pick, first.id)
  const state = (pick) => c.st(pick)
  const close = (a, b) => Math.abs(a - b) < 1e-6

  const pickClip = () => c.run((clip) => { const st = window.__store; if (!st.getState().selectedClipIds.includes(clip)) st.setState({ selectedClipIds: [clip] }) }, first.id)

  /** Drags the track of the slider `id` and checks: changed, one step, Ctrl+Z restores. */
  const dragOnce = async (id, read, from = 0.3, to = 0.72, onClip = true) => {
    // (An undo may take the selection with it: the clip is picked again.)
    if (onClip) await pickClip()
    const before = await read()
    const depth = await lib.undoDepth(c)
    await c.waitId(id)
    // Into the middle of its panel first, as a user would scroll to it.
    await c.run((sel) => document.querySelector(sel)?.scrollIntoView({ block: 'center' }), `[data-testid="${id}"]`)
    const b = await c.box(id)
    await c.dragAt(b.x + from * b.w, b.cy, b.x + to * b.w, b.cy, { steps: 8 })
    const after = await c.waitFor(`${id}: a new value`, async () => { const v = await read(); return close(v, before) ? null : [v] })
    assert.equal(await lib.undoDepth(c), depth + 1, `${id}: one drag is one undo step (${before} → ${after[0]})`)
    await c.key('z', ['ctrl'])
    await c.waitFor(`${id}: the old value after Ctrl+Z`, async () => close(await read(), before))
    assert.equal(await lib.undoDepth(c), depth, `${id}: the step is gone`)
  }

  // ---- the Clip tab ------------------------------------------------------------------
  await dragOnce('inspector.clip.scale', () => clip((s, id) => s.project.clips[id].transform.scale))
  // (Arayüz v4: Position X is a field whose name is its drag handle.)
  await dragOnce('inspector.clip.x.scrub', () => clip((s, id) => s.project.clips[id].transform.x))
  await dragOnce('inspector.clip.rotate', () => clip((s, id) => s.project.clips[id].transform.rotation))
  await dragOnce('inspector.clip.opacity', () => clip((s, id) => s.project.clips[id].opacity ?? 1), 0.9, 0.4)
  await dragOnce('inspector.clip.speed', () => clip((s, id) => s.project.clips[id].speed ?? 1))
  await dragOnce('inspector.audio.volume', () => clip((s, id) => s.project.clips[id].volume), 0.5, 0.8)
  // (Arayüz v4: the fades are the Audio card's Fade part.)
  await pickClip()
  await c.click('inspector.audio.part.fade')
  await dragOnce('inspector.audio.fade-in', () => clip((s, id) => s.project.clips[id].fadeIn ?? 0), 0.05, 0.6)
  await dragOnce('inspector.effects.sharpen', () => clip((s, id) => s.project.clips[id].sharpen ?? 0), 0.05, 0.6)
  await dragOnce('inspector.color.brightness', () => clip((s, id) => s.project.clips[id].grade?.brightness ?? 1))
  await dragOnce('inspector.color.blur', () => clip((s, id) => s.project.clips[id].blur ?? 0), 0.05, 0.6)
  await dragOnce('inspector.crop.left', () => clip((s, id) => s.project.clips[id].crop?.l ?? 0), 0.05, 0.6)

  // A typed number: kept as typed (33.3, not the grid's 33), one undo step.
  await pickClip()
  const depth = await lib.undoDepth(c)
  const scale0 = await clip((s, id) => s.project.clips[id].transform.scale)
  await c.click('inspector.clip.scale.value')
  await c.key('a', ['ctrl'])
  await c.type('33.3')
  await c.key('Enter')
  await c.waitFor('scale 33.3 %', async () => close(await clip((s, id) => s.project.clips[id].transform.scale), 0.333))
  assert.equal(await lib.undoDepth(c), depth + 1, 'a typed value is one undo step')
  assert.equal(await c.value('inspector.clip.scale.value'), '33.3 %', 'shown as typed, with its unit')
  // An arrow key adds one step to the value as it is.
  await c.key('ArrowUp')
  await c.waitFor('scale 34.3 %', async () => close(await clip((s, id) => s.project.clips[id].transform.scale), 0.343))
  assert.equal(await lib.undoDepth(c), depth + 2, 'an arrow key is one undo step')
  // Out of range: kept in range.
  await c.key('a', ['ctrl'])
  await c.type('9000')
  await c.key('Enter')
  await c.waitFor('scale at its most', async () => close(await clip((s, id) => s.project.clips[id].transform.scale), 4))
  await c.click('inspector.tab.clip')
  for (let i = 0; i < 3; i++) await c.key('z', ['ctrl'])
  await c.waitFor('the scale it had', async () => close(await clip((s, id) => s.project.clips[id].transform.scale), scale0))
  assert.equal(await lib.undoDepth(c), depth)

  // ---- the Subs tab -------------------------------------------------------------------
  await c.click('inspector.tab.subs')
  await c.waitId('subs.style.size')
  await dragOnce('subs.style.size', () => state((s) => s.project.captionStyle.fontSize))
  await dragOnce('subs.style.position', () => state((s) => s.project.captionStyle.posY))
  await dragOnce('subs.style.line-height', () => state((s) => s.project.captionStyle.lineHeight ?? 1.25))
  await dragOnce('subs.style.bg-radius', () => state((s) => s.project.captionStyle.bgRadius ?? 0), 0.05, 0.6)

  // ---- the Template tab ---------------------------------------------------------------
  await lib.templatesPage(c)
  await c.click('templates.insert.steps')
  const tpl = await c.waitFor('a Steps block', () => c.st((s) => s.project.templates?.find((x) => x.kind === 'steps') ?? null))
  await c.waitId('template.length')
  await dragOnce('template.length', () => c.st((s, id) => s.project.templates.find((x) => x.id === id).duration, tpl.id), 0.3, 0.72, false)
  // (With SNIPP_SCREENS_3C: the Template tab's picture, beside the twelve of 87-screens-3c.)
  if (process.env.SNIPP_SCREENS_3C) {
    await c.sleep(400)
    await c.shot(join(process.env.SNIPP_SCREENS_3C, '06b-inspector-sablon.png'))
  }
}
