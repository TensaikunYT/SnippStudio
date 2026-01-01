// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// 22 November, L7 / L8: on the timeline no mark lies on a clip's name pill.
// The rule, checked by boxes: for every clip, the box of its name pill and
// the box of each of its marks (the chain of a linked clip, the motion star,
// the idle mark, the FX and speed badges) and of every transition block on
// the lane do not intersect (area 0), at the three lane heights (S / M / L),
// at rest and with everything selected, at 1366 x 768 and at 1920 x 1080.
// The chain is inside the pill (it is part of the name, not on it). And a
// sound lane says its name at the small height too.
// SNIPP_D22D_SHOTS=<folder>: the timeline's picture in each state.
import { writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { scene, windowSize, runnerSize } from '../d22-d-scene.mjs'
export const name = 'd22-d-pill-clear'
export const timeoutMs = 180_000

const SHOTS = process.env.SNIPP_D22D_SHOTS || null

/** In the page: every clip's name pill against its marks and the lane's transition blocks. */
const measure = () => {
  const shown = (e) => {
    const cs = getComputedStyle(e)
    const r = e.getBoundingClientRect()
    return cs.display !== 'none' && cs.visibility !== 'hidden' && parseFloat(cs.opacity) > 0.05 && r.width > 0 && r.height > 0
  }
  const cut = (a, b) => ({ left: Math.max(a.left, b.left), top: Math.max(a.top, b.top), right: Math.min(a.right, b.right), bottom: Math.min(a.bottom, b.bottom) })
  const area = (q) => Math.max(0, q.right - q.left) * Math.max(0, q.bottom - q.top)
  const all = [...document.querySelectorAll('[data-testid]')]
  const by = (re) => all.filter((e) => re.test(e.dataset.testid))
  const blocks = by(/^timeline\.junction\.[^.]+\.block$/).filter(shown)
  const hits = []
  const pills = []
  const marks = []
  for (const clip of by(/^timeline\.clip\.[^.]+$/)) {
    const id = clip.dataset.testid.slice('timeline.clip.'.length)
    const pill = all.find((e) => e.dataset.testid === `timeline.clip.${id}.name`)
    if (!pill || !shown(pill)) continue
    // (What the clip's own edge cuts off is not seen.)
    const box = clip.getBoundingClientRect()
    const p = cut(pill.getBoundingClientRect(), box)
    if (area(p) <= 0) continue
    pills.push(id)
    for (const mark of by(new RegExp(`^timeline\\.clip\\.${id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\.(link|motion\\.left|motion\\.right|idle|fx|speed|curve-badge)$`))) {
      if (!shown(mark)) continue
      const what = mark.dataset.testid.slice(`timeline.clip.${id}.`.length)
      marks.push(`${id}.${what}`)
      const inside = pill.contains(mark)
      if (what === 'link') {
        if (!inside) hits.push(`${id}: the chain is outside the name pill`)
        continue
      }
      const a = area(cut(p, cut(mark.getBoundingClientRect(), box)))
      if (inside || a > 0.01) hits.push(`${id}: ${what} lies on the name (${a.toFixed(1)} px²)`)
    }
    for (const b of blocks) {
      const a = area(cut(p, b.getBoundingClientRect()))
      if (a > 0.01) hits.push(`${id}: the transition block ${b.dataset.testid} lies on the name (${a.toFixed(1)} px²)`)
    }
  }
  const lanes = by(/^timeline\.track\.[^.]+\.label$/).map((e) => ({ id: e.dataset.testid.split('.')[2], shown: shown(e), text: e.textContent.trim(), w: Math.round(e.getBoundingClientRect().width), cut: e.scrollWidth > e.clientWidth + 1 }))
  return { hits, pills, marks, blocks: blocks.length, lanes }
}

export async function run(ctx) {
  const { c, lib } = ctx
  const { assert } = lib
  await scene(ctx)
  // An entrance on the linked clip, an idle motion and an exit on the next, a
  // transition between them, a speed on a sound clip.
  await c.run(() => {
    const s = window.__store.getState()
    s.runBatch([
      { name: 'clip.setTransition', params: { clipId: 'v1', transition: { type: 'mix', duration: 1 } } },
      { name: 'clip.setSpeed', params: { clipId: 'snd2', speed: 2 } }
    ])
    s.setClipAnim('v1', { in: 'fade' })
    s.setClipIdle('v2', { style: 'float' })
    s.setClipAnim('v2', { out: 'fade' })
    s.setClipAnim('pic', { out: 'fade' })
    s.setDirty(false)
    return true
  })
  const lanes = async (scale) => {
    await c.click('topbar.settings')
    await c.waitId('settings.general.lanes')
    await c.click(`settings.general.lanes.${scale}`)
    await c.key('Escape')
    await c.waitGone('settings.nav')
    await c.sleep(250)
  }
  const shot = async (file) => {
    if (!SHOTS) return
    mkdirSync(SHOTS, { recursive: true })
    const b = await c.box('timeline.toolbar-settings')
    const w = await c.ev('innerWidth'), h = await c.ev('innerHeight')
    const y = Math.max(0, b.y - 8)
    const r = await c.capture({ format: 'png', clip: { x: 0, y, width: w, height: h - y, scale: 1 } })
    writeFileSync(join(SHOTS, file), Buffer.from(r.data, 'base64'))
  }
  try {
    for (const size of [[1366, 768], [1920, 1080]]) {
      await windowSize(c, size)
      for (const scale of ['small', 'medium', 'large']) {
        await lanes(scale)
        for (const state of ['rest', 'selected']) {
          await c.run((sel) => { const S = window.__store; S.setState({ selectedClipIds: sel ? Object.keys(S.getState().project.clips) : [] }); return true }, state === 'selected')
          // (The pointer away from the lanes: a hover shows marks of its own.)
          await c.mouse('mouseMoved', size[0] / 2, 120)
          await c.sleep(250)
          const tag = `${size.join('x')}, ${scale}, ${state}`
          const m = await c.run(measure)
          console.log(`     ${tag}: ${m.pills.length} names, marks ${m.marks.join(' ')}, ${m.blocks} transition block(s); lanes ${m.lanes.map((l) => l.text + (l.shown ? '' : ' (hidden)')).join(' ')}`)
          assert.ok(m.pills.length >= 6, `${tag}: the clips' names are measured (${m.pills})`)
          assert.equal(m.blocks, 1, `${tag}: the transition's block`)
          // (son, item B) The motion buttons show on the selected (or hovered)
          // clip only; at rest an animated clip keeps its corner wedge alone.
          const motionMarks = ['v1.motion.left', 'v2.motion.left', 'pic.motion.right']
          for (const want of ['v1.link', 'snd.link', 'v2.idle', 'snd2.speed', ...(state === 'selected' ? motionMarks : [])]) assert.ok(m.marks.includes(want), `${tag}: the mark ${want} is there to be measured (${m.marks})`)
          if (state === 'rest') {
            assert.deepEqual(m.marks.filter((k) => /\.motion\./.test(k)), [], `${tag}: no motion button at rest`)
            const wedges = await c.run(() => ['v1', 'pic'].map((id) => !!document.querySelector(`[data-testid="timeline.clip.${id}"] .anim-badge`)))
            assert.deepEqual(wedges, [true, true], `${tag}: the animated clips keep their corner wedge`)
          }
          assert.deepEqual(m.hits, [], `${tag}: a mark on a name`)
          // Every lane says its name, the sound lanes at the small height too.
          assert.deepEqual(m.lanes.filter((l) => !l.shown || !l.text || l.w < 8).map((l) => l.id), [], `${tag}: every lane's name shows (${JSON.stringify(m.lanes)})`)
          assert.deepEqual(m.lanes.filter((l) => l.cut).map((l) => l.id), [], `${tag}: no lane's two-letter name is cut`)
          await shot(`cizelge-${size.join('x')}-${scale}-${state}.png`)
        }
      }
    }
    // Under the pointer the clip's motion buttons show: still not on the name.
    await windowSize(c, [1366, 768])
    await lanes('small')
    await c.run(() => { window.__store.setState({ selectedClipIds: [] }); return true })
    const b = await c.box('timeline.clip.p2')
    await c.mouse('mouseMoved', b.x + b.w * 0.6, b.y + b.h * 0.7)
    await c.sleep(300)
    const hov = await c.run(measure)
    assert.ok(hov.marks.includes('p2.motion.right'), `under the pointer the motion button shows (${hov.marks})`)
    assert.deepEqual(hov.hits, [], 'under the pointer: a mark on a name')
    await shot('cizelge-1366x768-small-hover.png')
    // The motion button still opens its menu, and the menu's "More" opens the Inspector's Motion.
    await c.click('timeline.clip.p2.motion.right')
    await c.waitFor('the motion menu', () => c.ev(`!!document.querySelector('.motion-quick-menu')`))
    await c.key('Escape')
    await c.mouse('mouseMoved', 683, 120)
    await c.mouse('mousePressed', 683, 120)
    await c.mouse('mouseReleased', 683, 120)
  } finally {
    await lanes('medium').catch(() => undefined)
    await runnerSize(c)
  }
}
