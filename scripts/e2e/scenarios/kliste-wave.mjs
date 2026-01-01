// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// The user's list, item 4 (SnippStudio KLISTE-PLAN.md): the clip's waveform
// on the timeline follows what is heard. A steady tone (its bars all the
// same height) on A1, the bars read from the timeline's own canvas: the
// volume at 50 % halves them, a fade-in starts them at nothing and grows
// them, volume points draw their line, mute flattens them, back to 100 %
// brings them back. (Above 100 % a full-scale bar cannot grow: it stays at
// the top.)
import { spawnSync } from 'node:child_process'
import { join } from 'node:path'
import { ffmpegBin } from '../media.mjs'
export const name = 'kliste-wave'

/** In the page: the bars' heights (px) at fractions of the clip's width. */
const BARS = `window.__bars = (clipId, at) => {
  const cv = document.querySelector('[data-testid="timeline.clip.' + clipId + '"] canvas.wave')
  if (!cv) return null
  const g = cv.getContext('2d')
  const d = g.getImageData(0, 0, cv.width, cv.height).data
  const box = cv.getBoundingClientRect()
  const clip = document.querySelector('[data-testid="timeline.clip.' + clipId + '"]').getBoundingClientRect()
  return at.map((f) => {
    const x = Math.round(((clip.left + f * clip.width - box.left) / box.width) * cv.width)
    if (x < 0 || x >= cv.width) return null
    let n = 0
    // (okunur, 23 November: the baseline row is left out. Through silence the
    // waveform now draws a clear 1 px flat line on purpose, so "flat" is that
    // line and no bar above it; before, the line was too faint to count.)
    const base = Math.max(1, Math.round(window.devicePixelRatio || 1))
    for (let y = 0; y < cv.height - base; y++) {
      const i = (y * cv.width + x) * 4
      if (d[i + 3] > 150 && d[i + 2] > 150) n++
    }
    return Math.round((n / cv.height) * 1000) / 1000
  })
}; true`

export async function run({ c, app, lib, work }) {
  const { assert } = lib
  const tone = join(work, 'tone.wav')
  const r = spawnSync(ffmpegBin('ffmpeg'), ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'sine=frequency=220:sample_rate=48000:duration=8', '-af', 'volume=0.5', '-c:a', 'pcm_s16le', tone], { encoding: 'utf8', windowsHide: true })
  if (r.status !== 0) throw new Error('ffmpeg: ' + r.stderr)
  const [a] = await lib.seedAssets(app, c, [tone])
  await lib.seedTimeline(c, [a.id])
  await c.ev(BARS)
  const [clip] = await lib.clipList(c)
  // The whole clip on screen.
  await c.run(() => window.__store.getState().setPxPerSec?.(100))
  const at = [0.1, 0.25, 0.5, 0.75, 0.9]
  const bars = async (what) => {
    let got = null
    await c.waitFor(`the waveform (${what})`, async () => {
      got = await c.run((id, at) => window.__bars(id, at), clip.id, at)
      return Array.isArray(got) && got.every((v) => v !== null)
    }, 8000, 150)
    await c.sleep(250)
    got = await c.run((id, at) => window.__bars(id, at), clip.id, at)
    return got
  }
  const edit = (fn, ...args) => c.run(fn, clip.id, ...args)
  const full = await bars('100 %')
  const top = Math.max(...full)
  assert.ok(top > 0.5 && full.every((v) => Math.abs(v - top) < 0.03), `a steady tone: the bars the same height (${full})`)

  await edit((id) => window.__store.getState().setClipVolume(id, 0.5))
  const half = await bars('50 %')
  for (const [i, v] of half.entries()) assert.ok(Math.abs(v - full[i] / 2) < 0.04, `50 %: bar ${i} ${v}, half of ${full[i]}`)

  await edit((id) => window.__store.getState().setClipVolume(id, 1))
  await edit((id) => window.__store.getState().setClipFades(id, { fadeIn: 4 }))
  const fade = await bars('fade-in 4 s')
  // 8 s clip: 0.1 → 0.8 s of a 4 s fade (20 %), 0.25 → 50 %, 0.5 → 100 %.
  for (const [i, want] of [[0, 0.2], [1, 0.5], [2, 1], [3, 1]]) assert.ok(Math.abs(fade[i] - full[i] * want) < 0.05, `fade-in: bar ${i} ${fade[i]}, expected ${(full[i] * want).toFixed(3)}`)

  await edit((id) => window.__store.getState().setClipFades(id, { fadeIn: 0 }))
  await edit((id) => {
    const S = window.__store
    const p = structuredClone(S.getState().project)
    p.clips[id].volumeKeyframes = [{ id: 'k0', time: 0, value: 0 }, { id: 'k1', time: 8, value: 1 }]
    S.getState().loadProject(p)
  })
  const ramp = await bars('volume points 0 → 1')
  for (const [i, f] of at.entries()) assert.ok(Math.abs(ramp[i] - full[i] * f) < 0.05, `volume points: bar ${i} ${ramp[i]}, expected ${(full[i] * f).toFixed(3)}`)

  await edit((id) => window.__store.getState().toggleClipMute(id))
  const muted = await bars('muted')
  assert.ok(muted.every((v) => v <= 0.02), `muted: flat (${muted})`)
  console.log(`     bars at ${at.join(', ')} of the clip: 100 % ${full}; 50 % ${half}; fade-in ${fade}; points ${ramp}; muted ${muted}`)
}
