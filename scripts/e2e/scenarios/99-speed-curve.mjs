// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// Core polish, part C (CILA-C-PLAN.md): a speed curve drawn, played and
// exported.
//   - the Inspector: "Curve" makes a flat curve, a shape, a drag of a point,
//     a click that adds one and a double-click that takes it away — each one
//     undo step, the clip's length following and said in words;
//   - the export's own frame drawer along a three-point curve: each output
//     frame is the source frame of its moment (worked out here on its own),
//     within one frame;
//   - the preview plays it: the element's rate follows the curve, and
//     stopped, the frame under the playhead is the exact one;
//   - the sound: a 330 Hz tone keeps its pitch at the slow and the fast end
//     of a curve in the export (pitch kept), is silent past 8x, and the mix
//     in 2 s windows is the mix in one piece.
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { E2E_MEDIA, ffmpegBin } from '../media.mjs'
export const name = 'speed-curve'

const FPS = 30
/** The film of 97-speed-frames: frame n has a white box at x = 8 + 4 (n mod 70), y = 4 + 9 ⌊n / 70⌋. */
function countFilm() {
  const f = join(E2E_MEDIA, 'count-40s.mp4')
  if (existsSync(f)) return f
  const r = spawnSync(ffmpegBin('ffmpeg'), ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=black:s=320x180:r=30:d=40', '-f', 'lavfi', '-i', 'color=c=white:s=8x6:r=30:d=40', '-filter_complex', "[0][1]overlay=x='8+4*mod(n,70)':y='4+9*floor(n/70)'", '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '14', '-g', '30', '-pix_fmt', 'yuv420p', f], { encoding: 'utf8', windowsHide: true })
  if (r.status !== 0) throw new Error('ffmpeg: ' + r.stderr)
  return f
}

const HELPERS = `window.__readCount = (canvas) => {
  const w = canvas.width, h = canvas.height
  const g = (canvas.getContext('2d', { willReadFrequently: true }) ?? null)
  let data
  if (g) data = g.getImageData(0, 0, w, h).data
  else { const k = new OffscreenCanvas(w, h); const kg = k.getContext('2d'); kg.drawImage(canvas, 0, 0); data = kg.getImageData(0, 0, w, h).data }
  let sx = 0, sy = 0, n = 0
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (data[(y * w + x) * 4] > 128) { sx += x; sy += y; n++ }
  if (n < 8) return -1
  const cx = (sx / n + 0.5) * 320 / w, cy = (sy / n + 0.5) * 180 / h
  return Math.round((cx - 12) / 4) + 70 * Math.round((cy - 7) / 9)
}
window.__pitchOf = (x, rate) => {
  let cross = 0, first = -1, last = -1, sum = 0
  for (let i = 1; i < x.length; i++) { sum += x[i] * x[i]; if (x[i - 1] <= 0 && x[i] > 0) { cross++; if (first < 0) first = i; last = i } }
  return { hz: cross > 1 ? ((cross - 1) * rate) / (last - first) : 0, rms: Math.sqrt(sum / Math.max(1, x.length)) }
}
// The media second a curved clip shows at clip-local second l, worked out on
// its own: the points' eased speed (log speed, smoothstep) summed every 2 ms
// of media (Simpson), inverted by bisection.
window.__expectMedia = (curve, inPoint, mediaLen, duration, l) => {
  const k = curve.keys
  const v = (m) => {
    if (m <= k[0].m) return k[0].v
    if (m >= k[k.length - 1].m) return k[k.length - 1].v
    let i = 0
    while (k[i + 1].m <= m) i++
    const u = (m - k[i].m) / (k[i + 1].m - k[i].m)
    const e = curve.linear ? u : u * u * (3 - 2 * u)
    return Math.exp(Math.log(k[i].v) * (1 - e) + Math.log(k[i + 1].v) * e)
  }
  const cum = [0]
  for (let i = 1; i * 0.002 <= mediaLen + 1e-9; i++) { const a = inPoint + (i - 1) * 0.002; cum.push(cum[i - 1] + (1 / v(a) + 4 / v(a + 0.001) + 1 / v(a + 0.002)) * 0.001 / 3) }
  const T = (m) => { const x = (m - inPoint) / 0.002; const i = Math.min(cum.length - 2, Math.max(0, Math.floor(x))); return cum[i] + (cum[i + 1] - cum[i]) * (x - i) }
  const want = (l / duration) * T(inPoint + mediaLen)
  let lo = inPoint, hi = inPoint + mediaLen
  for (let i = 0; i < 50; i++) { const mid = (lo + hi) / 2; if (T(mid) < want) lo = mid; else hi = mid }
  return (lo + hi) / 2
}; true`

export async function run({ c, app, media, lib }) {
  const { assert } = lib
  await c.ev(HELPERS)
  const [film, tone, talk] = await lib.seedAssets(app, c, [countFilm(), media.other, media.talk])
  assert.ok(lib.near(film.duration, 40, 0.1), `the film is 40 s (${film.duration})`)

  // ---- the Inspector -------------------------------------------------------------------
  await lib.seedTimeline(c, [film.id])
  await c.run(() => {
    const state = JSON.parse(localStorage.getItem('snipp-sections') ?? '{}')
    state.Clip = true
    localStorage.setItem('snipp-sections', JSON.stringify(state))
  })
  await lib.openCards(c, ['Clip', 'Speed'])
  const [clip] = await lib.clipList(c)
  await c.click(`timeline.clip.${clip.id}`, { fx: 0.5 })
  await c.click('inspector.tab.subs')
  await c.click('inspector.tab.clip')
  await c.waitId('inspector.clip.speed.mode')
  const show = (id) => c.run((sel) => document.querySelector(sel)?.scrollIntoView({ block: 'center' }), `[data-testid="${id}"]`)
  const now = () => c.st((s, id) => { const k = s.project.clips[id]; return { duration: k.duration, speed: k.speed ?? 1, keys: k.speedCurve?.keys ?? null, depth: s.past.length } }, clip.id)
  const s0 = await now()
  await show('inspector.clip.speed.mode')
  await c.click('inspector.clip.speed.mode.curve')
  const s1 = await now()
  assert.equal(s1.depth, s0.depth + 1, '"Curve" is one undo step')
  assert.deepEqual(s1.keys.map((k) => k.v), [1, 1], 'a flat curve at the speed it had')
  assert.ok(lib.near(s1.duration, s0.duration, 1e-6), 'the same length')
  await c.waitId('inspector.clip.speed.curve')
  await show('inspector.clip.speed.curve.preset.slow-middle')
  await c.click('inspector.clip.speed.curve.preset.slow-middle')
  const s2 = await now()
  assert.equal(s2.depth, s1.depth + 1, 'a shape is one undo step')
  assert.equal(s2.keys.length, 4)
  assert.ok(s2.duration > s1.duration * 1.2, `the clip got longer (${s1.duration.toFixed(2)} → ${s2.duration.toFixed(2)} s)`)
  const lengthText = async () => (await c.run((sel) => document.querySelector(sel)?.textContent ?? '', '[data-testid="inspector.clip.speed.curve.length"]'))
  const said = await lengthText()
  assert.ok(said.includes(String(Math.round(s2.duration * 100) / 100)), `the length is said: "${said}" (${s2.duration})`)
  // Drag the second point (0.25x) up: one undo step, the clip shorter.
  await show('inspector.clip.speed.curve')
  const g = await c.waitId('inspector.clip.speed.curve')
  const p1 = await c.waitId('inspector.clip.speed.curve.point.1')
  await c.dragAt(p1.cx, p1.cy, p1.cx, g.y + g.h * 0.3, { steps: 12 })
  const s3 = await now()
  assert.equal(s3.depth, s2.depth + 1, 'a drag of a point is one undo step')
  assert.ok(s3.keys[1].v > 1, `the point went up (${s3.keys[1].v}x)`)
  assert.ok(s3.duration < s2.duration, `the clip got shorter (${s2.duration.toFixed(2)} → ${s3.duration.toFixed(2)} s)`)
  // A click on the graph adds a point; a double-click on it takes it away.
  await c.clickAt(g.x + g.w * 0.85, g.y + g.h * 0.6)
  const s4 = await now()
  assert.equal(s4.depth, s3.depth + 1, 'adding a point is one undo step')
  assert.equal(s4.keys.length, 5, 'a point was added')
  const added = await c.waitId('inspector.clip.speed.curve.point.3')
  await c.clickAt(added.cx, added.cy, { double: true })
  const s5 = await now()
  assert.equal(s5.keys.length, 4, 'the double-click took it away')
  assert.equal(s5.depth, s4.depth + 1, 'taking it away is one undo step')
  // Undo walks back one step at a time.
  await c.run(() => window.__store.getState().undo())
  assert.equal((await now()).keys.length, 5, 'undo gives the point back')
  await c.run(() => { window.__store.getState().undo(); window.__store.getState().undo() })
  const back = await now()
  assert.ok(lib.near(back.duration, s2.duration, 1e-6), 'two more: the shape as it was')

  // ---- the export's frames along a three-point curve ---------------------------------
  const frames = await c.run(async (id, FPS) => {
    const read = window.__readCount
    const S = window.__store
    const p = structuredClone(S.getState().project)
    const T = { x: 160, y: 90, scale: 1, rotation: 0 }
    p.settings = { ...p.settings, width: 320, height: 180, fps: FPS }
    p.tracks = [{ id: 'V1', kind: 'video', name: 'V1', clipIds: ['a'] }, { id: 'A1', kind: 'audio', name: 'A1', clipIds: [] }]
    p.clips = { a: { id: 'a', assetId: id, trackId: 'V1', start: 0, inPoint: 2, duration: 30, transform: T, volume: 1 } }
    p.captions = []
    S.getState().loadProject(p)
    S.getState().setClipSpeedCurve('a', { points: [{ u: 0, v: 4 }, { u: 0.4, v: 0.5 }, { u: 1, v: 2 }] })
    await new Promise((r) => setTimeout(r, 300))
    const q = S.getState().project
    const a = q.clips.a
    const ex = await window.__exporter()
    const d = ex.frameDrawer(q, { w: 320, h: 180, shorts: false, captions: false })
    const out = []
    const t0 = performance.now()
    try {
      for (let i = 0; i < Math.floor(a.duration * FPS); i++) {
        await d.draw(i / FPS)
        out.push({ got: read(d.canvas), want: Math.floor(window.__expectMedia(a.speedCurve, 2, 30, a.duration, i / FPS) * FPS + 1e-6) })
      }
    } finally { d.close() }
    return { out, ms: performance.now() - t0, duration: a.duration }
  }, film.id, FPS)
  // (The film's own count may start off by a constant: taken from its first frame.)
  const n0 = frames.out[0].got - frames.out[0].want
  let exact = 0
  for (const [i, f] of frames.out.entries()) {
    const off = Math.abs(f.got - n0 - f.want)
    assert.ok(off <= 1, `output frame ${i}: shows source frame ${f.got - n0}, its moment is ${f.want}`)
    if (off === 0) exact++
  }
  console.log(`    export drawer along the curve: ${frames.out.length} frames, ${exact} exact, the rest ± 1 (${Math.round(frames.ms)} ms)`)
  assert.ok(exact / frames.out.length > 0.98, `nearly every frame exact (${exact} / ${frames.out.length})`)

  // ---- the preview plays it ------------------------------------------------------------
  const live = await c.run(async () => {
    const read = window.__readCount
    const S = window.__store
    const eng = window.__engine
    const wait = (ms) => new Promise((r) => setTimeout(r, ms))
    S.getState().setTime(0)
    await wait(300)
    S.getState().setPlaying(true)
    const rates = []
    const t0 = performance.now()
    while (performance.now() - t0 < 8000) {
      await wait(40)
      const el = eng.videos.get('a')
      if (el) rates.push({ t: S.getState().currentTime, rate: el.playbackRate })
    }
    S.getState().setPlaying(false)
    const at = 7.3
    S.getState().setTime(at)
    let n = -1
    for (let i = 0; i < 80; i++) { await wait(50); const f = eng.pausedFrames.get('a'); n = f ? read(f) : -1; if (n >= 0 && i > 6) break }
    const a = S.getState().project.clips.a
    return { rates, n, want: Math.floor(window.__expectMedia(a.speedCurve, 2, 30, a.duration, at) * 30 + 1e-6) }
  })
  const rs = live.rates.map((r) => r.rate)
  assert.ok(Math.max(...rs) > 1.8 && Math.min(...rs) < 0.9 && Math.max(...rs) / Math.min(...rs) > 2.5,`the element's rate followed the curve (${Math.min(...rs).toFixed(2)} – ${Math.max(...rs).toFixed(2)})`)
  assert.ok(Math.abs(live.n - n0 - live.want) <= 1, `stopped at 7.3 s: source frame ${live.want} (read ${live.n - n0})`)
  console.log(`    preview: element rate ${Math.min(...rs).toFixed(2)} – ${Math.max(...rs).toFixed(2)}, stopped frame ${live.n - n0} (its moment ${live.want})`)

  // ---- the sound along a curve -------------------------------------------------------------
  const sound = await c.run(async (toneId, talkId) => {
    const S = window.__store
    const [, , A] = await window.__subs()
    const base = structuredClone(S.getState().project)
    const a1 = base.tracks.find((t) => t.kind === 'audio')
    for (const id of Object.keys(base.clips)) delete base.clips[id]
    for (const t of base.tracks) t.clipIds = []
    const T = { x: 0, y: 0, scale: 1, rotation: 0 }
    const out = {}
    // 0.5x at the head of a 6 s tone, 2x at its tail; then 2x → 20x (silent past 8x).
    for (const [name, points, keep] of [['slowFast', [{ u: 0, v: 0.5 }, { u: 1, v: 2 }], true], ['tape', [{ u: 0, v: 0.5 }, { u: 1, v: 2 }], false], ['tooFast', [{ u: 0, v: 2 }, { u: 1, v: 20 }], true]]) {
      S.getState().loadProject(structuredClone(base))
      S.getState().addToTimeline(toneId)
      const id = Object.keys(S.getState().project.clips)[0]
      if (!keep) S.getState().setClipKeepPitch(id, false)
      S.getState().setClipSpeedCurve(id, { points })
      const p = S.getState().project
      const c = p.clips[id]
      const buf = await A.mixProjectAudio(p, 48000, 2)
      const x = buf.getChannelData(0)
      const part = (a, b) => window.__pitchOf(x.subarray(Math.round((c.start + c.duration * a) * 48000), Math.round((c.start + c.duration * b) * 48000)), 48000)
      out[name] = { head: part(0.05, 0.2), tail: part(0.85, 0.97), end: part(0.97, 0.995), duration: c.duration }
    }
    // The windows: a voice along a curve, mixed in 2 s windows and in one piece.
    const W = await window.__audioStream()
    const p = structuredClone(base)
    p.clips.t1 = { id: 't1', assetId: talkId, trackId: a1.id, start: 0.3137, inPoint: 0.2, duration: 9, volume: 1, transform: T }
    a1.clipIds = ['t1']
    p.tracks.find((t) => t.id === a1.id).clipIds = ['t1']
    S.getState().loadProject(p)
    S.getState().setClipSpeedCurve('t1', { points: [{ u: 0, v: 0.7 }, { u: 0.5, v: 2.5 }, { u: 1, v: 1.2 }] })
    const q = S.getState().project
    const all = async (windowSec) => {
      const m = new W.ExportMix(q, [0, 12], { windowSec })
      await m.prepare()
      const L = new Float32Array(m.frames)
      let at = 0
      for (let b = await m.next(); b; b = await m.next()) { L.set(b.getChannelData(0).subarray(0, m.frames - at), at); at += b.length }
      return L
    }
    const short = await all(2)
    const whole = await all(1000)
    let worst = 0, sum = 0
    for (let i = 0; i < whole.length; i++) { worst = Math.max(worst, Math.abs(short[i] - whole[i])); sum += whole[i] * whole[i] }
    out.windows = { worst, rms: Math.sqrt(sum / whole.length) }
    return out
  }, tone.id, talk.id)
  for (const end of ['head', 'tail']) {
    const h = sound.slowFast[end]
    assert.ok(Math.abs(h.hz - 330) <= 330 * 0.015, `pitch kept, the ${end}: ${h.hz.toFixed(1)} Hz`)
    assert.ok(h.rms > 0.06, `heard at the ${end} (${h.rms})`)
  }
  assert.ok(sound.tape.head.hz < 250 && sound.tape.tail.hz > 450, `pitch following the curve: ${sound.tape.head.hz.toFixed(0)} Hz → ${sound.tape.tail.hz.toFixed(0)} Hz`)
  assert.ok(sound.tooFast.head.rms > 0.06, `2x → 20x: heard at its head (${sound.tooFast.head.rms})`)
  assert.ok(sound.tooFast.end.rms < 1e-4, `2x → 20x: silent past 8x, its last moments (${sound.tooFast.end.rms})`)
  assert.ok(sound.windows.rms > 0.02, `the curved voice is heard (${sound.windows.rms})`)
  assert.ok(sound.windows.worst < 1e-4, `in 2 s windows the mix is the mix in one piece (largest difference ${sound.windows.worst})`)
  console.log(`    sound: pitch kept ${sound.slowFast.head.hz.toFixed(0)} / ${sound.slowFast.tail.hz.toFixed(0)} Hz, following ${sound.tape.head.hz.toFixed(0)} → ${sound.tape.tail.hz.toFixed(0)} Hz, windows ${sound.windows.worst}`)
}
