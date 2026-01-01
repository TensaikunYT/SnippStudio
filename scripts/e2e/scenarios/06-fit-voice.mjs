// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// Fit to voice (cila O, CILA-O-PLAN.md K3; it replaced the Automation window):
// four numbered pictures picked in the Media panel, laid on the voice three
// ways, each on a new AUTO layer in one undo step, each taken back by Ctrl+Z.
//   by subtitle numbers  picture n from line n's start (1 from 0)
//   evenly spaced        equal parts from 0 to the end of the last line
//   into the range       equal parts between the in and out points (I / O)
import { SUBS } from '../media.mjs'
export const name = 'fit-voice-three-ways'

export async function run({ c, app, media, lib }) {
  const { assert } = lib
  const [talk] = await lib.seedAssets(app, c, [media.talk])
  await lib.seedTimeline(c, [talk.id])
  await c.run((subs) => { const s = window.__store.getState(); s.setSubtitles(subs.map((x, i) => ({ id: 's' + i, ...x }))); s.setDirty(false) }, SUBS)
  const pics = await lib.seedAssets(app, c, media.numbered.slice(0, 4))
  const original = await lib.clipList(c)

  // Pick the four pictures: the first, then Shift on the fourth.
  await c.click(`media.item.${pics[0].id}`)
  await c.click(`media.item.${pics[3].id}`, { mods: ['shift'] })
  await c.waitId('media.fit-voice')

  /** Opens the window, takes a way, places; returns the pictures as placed. */
  const place = async (mode) => {
    const depth0 = await lib.undoDepth(c)
    await c.click('media.fit-voice')
    await c.waitId('dialog.fit-voice')
    if (mode) await c.click(`fit-voice.mode.${mode}`)
    await c.waitFor('a plan', async () => (await c.attr('fit-voice.summary', 'data-blocked')) === '')
    await c.click('fit-voice.apply')
    await c.waitGone('dialog.fit-voice')
    const placed = await c.waitFor('pictures on a layer', async () => {
      const p = await c.st((s) => {
        const names = Object.fromEntries(s.project.assets.map((a) => [a.id, a.name]))
        const auto = s.project.tracks.find((t) => t.name === 'AUTO')
        if (!auto || s.project.tracks[0].id !== auto.id) return null
        return auto.clipIds.map((id) => s.project.clips[id]).map((k) => ({ name: names[k.assetId], start: k.start, end: k.start + k.duration })).sort((a, b) => a.start - b.start)
      })
      return p && p.length === 4 ? p : null
    })
    assert.equal((await lib.undoDepth(c)) - depth0, 1, `${mode ?? 'numbers'}: one undo step`)
    await c.waitFor('the toast', async () => c.run(() => !!document.querySelector('[data-testid="toast.stack"] [data-testid^="toast."]')))
    // Ctrl+Z from the timeline takes the whole layer back.
    await c.click('timeline.scroll', { fx: 0.95, fy: 0.97 })
    await c.key('z', ['ctrl'])
    await c.waitFor('undone', async () => JSON.stringify(await lib.clipList(c)) === JSON.stringify(original) && !(await c.st((s) => s.project.tracks.some((t) => t.name === 'AUTO'))))
    return placed
  }
  const near = (a, b) => Math.abs(a - b) < 0.02

  // 1. By subtitle numbers (the window opens on it: subtitles and numbered names).
  const byNumber = await place(null)
  assert.deepEqual(byNumber.map((p) => p.name), ['1.png', '2.png', '3.png', '4.png'])
  const starts = [0, SUBS[1].start, SUBS[2].start, SUBS[3].start]
  byNumber.forEach((p, i) => assert.ok(near(p.start, starts[i]), `picture ${i + 1} from its line (${p.start} / ${starts[i]})`))
  assert.ok(near(byNumber[3].end, SUBS[3].end), 'the last one to the end of its line')

  // 2. Evenly spaced over the voice: 0 to the end of the last line, four equal parts.
  const end = SUBS[SUBS.length - 1].end
  const even = await place('even')
  even.forEach((p, i) => {
    assert.ok(near(p.start, (end / 4) * i) && near(p.end, (end / 4) * (i + 1)), `even part ${i + 1}: ${p.start}–${p.end}`)
  })

  // 3. Into the selected range: the in point at 2 s, the out point at 8 s (I / O).
  await lib.seek(c, 2)
  await c.key('i')
  await lib.seek(c, 8)
  await c.key('o')
  const range = await place('range')
  const a = range[0].start
  const b = range[3].end
  assert.ok(Math.abs(a - 2) < 0.15 && Math.abs(b - 8) < 0.15, `between the in and out points (${a}–${b})`)
  range.forEach((p, i) => assert.ok(near(p.end - p.start, (b - a) / 4), `range part ${i + 1} is a quarter`))
}
