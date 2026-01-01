// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// A title dragged in the preview keeps up with the hand (SnippStudio
// YAZI2-PLAN.md; YOL-HARITASI.md, part 7: 95 % of the frames within 12 ms):
// over a 1080p video with two more titles on screen (their sides and middles
// are lines to catch on), the title is taken round the frame with real mouse
// moves, one every 24 ms and then one every 4 ms, and its side is pulled in
// and out (the words wrap again at every step). Measured as the timeline's
// and the preview's own speed measures are (scripts/perf/interact.mjs): the
// main thread's work per frame, the pointer events' tasks counted in, summed
// into 1/60 s slots. The best of three runs counts (the machine is shared
// with other measures), and the numbers are printed.
import { PAD, info, installRecorder, sixty, stats } from '../text-probe.mjs'

export const name = 'yazi2-drag-speed'
export const timeoutMs = 180_000

/** The target: 95 % of frames within this (ms). */
const P95 = 12

export async function run({ c, app, media, lib }) {
  const { assert } = lib
  const [talk] = await lib.seedAssets(app, c, [media.talk1080 ?? media.talk])
  await lib.seedTimeline(c, [talk.id])
  await c.run(() => {
    const s = window.__store.getState()
    s.setTime(1)
    for (const [text, x, y] of [['Upper left corner', 0.22, 0.18], ['A lower third line', 0.7, 0.86], ['The title that is dragged round', 0.5, 0.5]]) {
      const id = s.addCaptionAtPlayhead(text)
      s.setCaptionOwnStyle(id, { posX: x, posY: y, maxLineChars: 32 })
    }
    return true
  })
  await c.sleep(400)
  await installRecorder(c)
  const measure = async (what, every, moves) => {
    const i = await info(c)
    const p = i.caps[i.caps.length - 1]
    await c.clickAt(p.x, p.y)
    const from = what === 'width' ? [p.x + p.w / 2 + PAD, p.y] : [p.x, p.y]
    await c.mouse('mouseMoved', from[0], from[1])
    await c.mouse('mousePressed', from[0], from[1])
    await c.mouse('mouseMoved', from[0] + 6, from[1], { down: true })
    await c.sleep(60)
    await c.ev('window.__yzFrames.start(), true')
    for (let n = 1; n <= moves; n++) {
      const t = n / moves
      const at = what === 'width' ? [from[0] - Math.abs(Math.sin(t * Math.PI * 2)) * p.w * 0.7, from[1]] : [from[0] + Math.sin(t * Math.PI * 2) * 0.3 * i.frame.w, from[1] - Math.sin(t * Math.PI) * 0.3 * i.frame.h]
      await c.mouse('mouseMoved', at[0], at[1], { down: true })
      await c.sleep(every)
    }
    const r = await c.ev('window.__yzFrames.stop()')
    await c.mouse('mouseReleased', from[0], from[1])
    await c.sleep(120)
    await c.key('z', ['ctrl'])
    await c.sleep(120)
    return { work: stats(sixty(r.frames)), gap: stats(r.gap) }
  }
  const rows = [['move', 24, 120], ['move.fast', 4, 360], ['width', 24, 120]]
  const best = {}
  for (let pass = 0; pass < 3; pass++) {
    for (const [what, every, moves] of rows) {
      const m = await measure(what.startsWith('move') ? 'move' : 'width', every, moves)
      if (!best[what] || m.work.p95 < best[what].work.p95) best[what] = m
    }
    if (rows.every(([what]) => best[what].work.p95 < P95)) break
  }
  for (const [what] of rows) console.log(`     ${what.padEnd(10)} work per frame: med ${best[what].work.med} ms, p95 ${best[what].work.p95} ms, max ${best[what].work.max} ms (${best[what].work.n} frames); frame interval p95 ${best[what].gap.p95} ms`)
  for (const [what] of rows) assert.ok(best[what].work.p95 < P95, `${what}: 95 % of the frames within ${P95} ms (${best[what].work.p95})`)
}
