// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// Core polish, part B (CILA-B-PLAN.md): the right frame at every speed. A
// film whose frame number can be read off its pixels (a white box that steps
// 4 px a frame, 70 to a row) at 50x, at 0.1x and backwards at 50x:
//   - the export's own frame drawer, frame after frame as an export runs,
//     shows exactly the source frame each output frame stands for;
//   - the preview at 50x (faster than a media element plays) keeps rolling
//     on the clock with its element parked and silent, shows frames that
//     move on, and stopped it shows the exact frame under the playhead.
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { E2E_MEDIA, ffmpegBin } from '../media.mjs'
export const name = 'speed-frames'

const FPS = 30
/** A 40 s film, 30 fps: frame n has a white 8 × 6 box at x = 8 + 4 (n mod 70), y = 4 + 9 ⌊n / 70⌋. */
function countFilm() {
  const f = join(E2E_MEDIA, 'count-40s.mp4')
  if (existsSync(f)) return f
  const r = spawnSync(ffmpegBin('ffmpeg'), ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=black:s=320x180:r=30:d=40', '-f', 'lavfi', '-i', 'color=c=white:s=8x6:r=30:d=40', '-filter_complex', "[0][1]overlay=x='8+4*mod(n,70)':y='4+9*floor(n/70)'", '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '14', '-g', '30', '-pix_fmt', 'yuv420p', f], { encoding: 'utf8', windowsHide: true })
  if (r.status !== 0) throw new Error('ffmpeg: ' + r.stderr)
  return f
}

/** In the page (window.__readCount): the frame number on a canvas (the box's centre), or -1. */
const READ = `window.__readCount = (canvas) => {
  const w = canvas.width, h = canvas.height
  const g = (canvas.getContext('2d', { willReadFrequently: true }) ?? null)
  let data
  if (g) data = g.getImageData(0, 0, w, h).data
  else { const k = new OffscreenCanvas(w, h); const kg = k.getContext('2d'); kg.drawImage(canvas, 0, 0); data = kg.getImageData(0, 0, w, h).data }
  let sx = 0, sy = 0, n = 0
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (data[(y * w + x) * 4] > 128) { sx += x; sy += y; n++ }
  if (n < 8) return -1
  // (A canvas of another size than the film's 320 × 180: scaled back.)
  const cx = (sx / n + 0.5) * 320 / w, cy = (sy / n + 0.5) * 180 / h
  return Math.round((cx - 12) / 4) + 70 * Math.round((cy - 7) / 9)
}; true`

export async function run({ c, app, lib }) {
  const { assert } = lib
  const [film] = await lib.seedAssets(app, c, [countFilm()])
  assert.ok(lib.near(film.duration, 40, 0.1), `the film is 40 s (${film.duration})`)
  await c.ev(READ)

  // ---- the export's frames ---------------------------------------------------------
  // a: 50x from media 2 s (frames 60, 110, 160 …); b: 0.1x from 1 s (each
  // frame ten times); r: 50x backwards over media 2–32 s (960, 910 …).
  const frames = await c.run(async (id, FPS) => {
    const read = window.__readCount
    const S = window.__store
    const p = structuredClone(S.getState().project)
    const T = { x: 160, y: 90, scale: 1, rotation: 0 }
    p.settings = { ...p.settings, width: 320, height: 180, fps: FPS }
    p.tracks = [{ id: 'V1', kind: 'video', name: 'V1', clipIds: ['a', 'b', 'r'] }, { id: 'A1', kind: 'audio', name: 'A1', clipIds: [] }]
    p.clips = {
      a: { id: 'a', assetId: id, trackId: 'V1', start: 0, inPoint: 2, duration: 0.6, speed: 50, transform: T, volume: 1 },
      b: { id: 'b', assetId: id, trackId: 'V1', start: 0.6, inPoint: 1, duration: 2, speed: 0.1, transform: T, volume: 1 },
      r: { id: 'r', assetId: id, trackId: 'V1', start: 2.6, inPoint: 2, duration: 0.6, speed: 50, reversed: true, transform: T, volume: 1 }
    }
    p.captions = []
    S.getState().loadProject(p)
    await new Promise((r) => setTimeout(r, 300))
    const ex = await window.__exporter()
    const d = ex.frameDrawer(S.getState().project, { w: 320, h: 180, shorts: false, captions: false })
    const out = []
    const t0 = performance.now()
    try {
      for (let i = 0; i < Math.round(3.2 * FPS); i++) {
        await d.draw(i / FPS)
        out.push(read(d.canvas))
      }
    } finally { d.close() }
    return { out, ms: performance.now() - t0 }
  }, film.id, FPS)
  const shown = frames.out
  // (The film's frame 0 is read as some n0: the count is taken from there.)
  const zero = await c.run(async () => {
    const read = window.__readCount
    const S = window.__store
    const p = structuredClone(S.getState().project)
    p.clips = { a: { ...p.clips.a, start: 0, inPoint: 0, duration: 1, speed: 1 } }
    p.tracks[0].clipIds = ['a']
    const ex = await window.__exporter()
    const d = ex.frameDrawer(p, { w: 320, h: 180, shorts: false, captions: false })
    try { await d.draw(0); const a = read(d.canvas); await d.draw(10 / 30); return [a, read(d.canvas)] } finally { d.close() }
  })
  assert.equal(zero[1] - zero[0], 10, `the film counts its frames (${zero})`)
  const n0 = zero[0]
  for (let i = 0; i < 18; i++) assert.equal(shown[i] - n0, 60 + 50 * i, `50x: output frame ${i} is source frame ${60 + 50 * i} (read ${shown[i] - n0})`)
  for (let j = 0; j < 60; j++) assert.equal(shown[18 + j] - n0, 30 + Math.floor(j / 10 + 1e-6), `0.1x: output frame ${j} is source frame ${30 + Math.floor(j / 10 + 1e-6)} (read ${shown[18 + j] - n0})`)
  for (let i = 0; i < 18; i++) assert.equal(shown[78 + i] - n0, 960 - 50 * i, `50x backwards: output frame ${i} is source frame ${960 - 50 * i} (read ${shown[78 + i] - n0})`)
  console.log(`    export drawer: 96 frames (50x, 0.1x, 50x backwards) in ${Math.round(frames.ms)} ms`)

  // ---- the preview at 50x -------------------------------------------------------------
  // One clip, the whole film at 50x from media 2 s: 0.76 s long.
  const live = await c.run(async () => {
    const read = window.__readCount
    const S = window.__store
    const p = structuredClone(S.getState().project)
    p.clips = { a: { ...p.clips.a, start: 0, inPoint: 2, duration: 0.76, speed: 50 } }
    p.tracks[0].clipIds = ['a']
    S.getState().loadProject(p)
    S.getState().setTime(0)
    const eng = window.__engine
    const wait = (ms) => new Promise((r) => setTimeout(r, ms))
    const frameNow = () => { const f = eng.pausedFrames.get('a'); return f ? read(f) : -1 }
    // Still, at the head: the exact frame.
    let still = -1
    for (let i = 0; i < 60 && still < 0; i++) { await wait(50); still = frameNow() }
    S.getState().setPlaying(true)
    const seen = []
    let rolled = 0
    const t0 = performance.now()
    let first = null
    while (performance.now() - t0 < 4000 && S.getState().playing) {
      await wait(16)
      const t = S.getState().currentTime
      if (first === null && t > 0.02) first = { wall: performance.now(), t }
      if (first !== null) rolled = (t - first.t) / Math.max(1e-3, (performance.now() - first.wall) / 1000)
      const el = eng.videos.get('a')
      seen.push({ t: +t.toFixed(3), n: frameNow(), paused: el ? el.paused : null, muted: el ? el.muted : null, rate: el ? el.playbackRate : null })
    }
    // It ran to the end and stopped there; hold a moment, then read the frame.
    const end = S.getState().currentTime
    S.getState().setPlaying(false)
    S.getState().setTime(0.4)
    let at04 = -1
    for (let i = 0; i < 80; i++) { await wait(50); at04 = frameNow(); if (at04 >= 0 && i > 6) break }
    return { still, seen, rolled, end, at04 }
  })
  assert.equal(live.still - n0, 60, `stopped at the head: source frame 60 (read ${live.still - n0})`)
  const rolling = live.seen.filter((s) => s.t > 0.02)
  assert.ok(rolling.length > 5, `it rolled (${rolling.length} looks)`)
  assert.ok(rolling.every((s) => s.paused === true && s.muted === true), 'the element stays parked and silent at 50x')
  assert.ok(lib.near(live.end, 0.76, 0.05), `it played to the end of the film (${live.end})`)
  assert.ok(live.rolled > 0.8 && live.rolled < 1.2, `the clock kept time while stepping (${live.rolled.toFixed(2)} s per second)`)
  const got = rolling.map((s) => s.n).filter((n) => n >= 0)
  const distinct = [...new Set(got)]
  assert.ok(distinct.length >= 3, `the picture moved on while it played (${distinct.length} different frames)`)
  for (let i = 1; i < got.length; i++) assert.ok(got[i] >= got[i - 1], `never backwards (${got[i - 1]} then ${got[i]})`)
  // Each frame shown is one the film had at or before that moment (it skips, it does not invent).
  for (const s of rolling) if (s.n >= 0) assert.ok(s.n - n0 <= 60 + Math.floor(s.t * 50 * FPS + 1e-6) + 2, `at ${s.t} s it showed frame ${s.n - n0}`)
  assert.equal(live.at04 - n0, 60 + 0.4 * 50 * FPS, `stopped at 0.4 s: source frame ${60 + 0.4 * 50 * FPS} exactly (read ${live.at04 - n0})`)
  console.log(`    preview at 50x: ${distinct.length} different frames in ${rolling.length} looks, clock ${live.rolled.toFixed(2)} s/s`)
}
