// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// The heavy timeline project (phase 3c.T): six lanes, 300 clips, 600 subtitles
// and texts, 40 work notes over ten minutes. Made by rule from a seed, so it is
// the same project every time; its media are the test material's own files
// (the 10-minute talk, the faceless channel's voice and its 20 pictures), named
// here by a short key the caller turns into assets.
//
//   heavyProject({ talk, voice })   durations of the two sources, in seconds
//   -> { name, settings, tracks, clips, captions, notes, assetKeys }
//
// node scripts/testdata/make.mjs writes it to testdata\agir\proje.json;
// npm run perf builds it in the page (scripts/perf/interact.mjs).

function rng(seed) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export const HEAVY = { tracks: 6, clips: 300, captions: 600, notes: 40, seconds: 600 }

export function heavyProject({ talk, voice }) {
  const rnd = rng(3020)
  const r3 = (x) => +x.toFixed(3)
  const T = (scale) => ({ x: 960, y: 540, scale, rotation: 0 })
  const tracks = [
    { id: 'V3', kind: 'video', name: 'V3', clipIds: [] },
    { id: 'V2', kind: 'video', name: 'V2', clipIds: [] },
    { id: 'V1', kind: 'video', name: 'V1', clipIds: [] },
    { id: 'A1', kind: 'audio', name: 'A1', clipIds: [] },
    { id: 'A2', kind: 'audio', name: 'A2', clipIds: [] },
    { id: 'A3', kind: 'audio', name: 'A3', clipIds: [] }
  ]
  const clips = {}
  const put = (trackId, clip) => {
    clips[clip.id] = { trackId, transform: T(1), volume: 1, ...clip }
    tracks.find((t) => t.id === trackId).clipIds.push(clip.id)
  }
  /** `n` clips on a lane across the film: each in its own slot, shorter than
   *  the slot by a gap that is sometimes nothing (touching clips). */
  const lane = (trackId, n, make) => {
    const slot = HEAVY.seconds / n
    for (let i = 0; i < n; i++) {
      const gap = rnd() < 0.4 ? 0 : slot * (0.05 + rnd() * 0.3)
      const start = r3(i * slot)
      make(i, start, r3(slot - gap))
    }
  }
  // V1: the talk, cut into 100 pieces in order (its own sound drawn under it).
  lane('V1', 100, (i, start, duration) =>
    put('V1', { id: `v${i + 1}`, assetId: 'talk', start, duration, inPoint: r3(Math.min(talk - duration - 0.1, i * (talk / 100))), transform: T(3), ...(i % 9 === 4 ? { transitionOut: { type: 'mix', duration: 0.4 } } : {}), ...(i % 12 === 7 ? { speed: 1 } : {}) }))
  // V2, V3: pictures over it; some with a slow push, some keyed.
  lane('V2', 60, (i, start, duration) =>
    put('V2', { id: `p${i + 1}`, assetId: `img${(i % 20) + 1}`, start, duration, inPoint: 0, transform: T(0.6), ...(i % 5 === 0 ? { motionFx: { enabled: true, zoomFrom: 1, zoomTo: 1.1, panX: 0.02, panY: 0, shakeAmp: 0, shakeRotAmp: 0, shakeSpeed: 1, seed: i + 1 } } : {}), ...(i % 7 === 3 ? { anim: { in: 'fade', inDur: 0.4, out: 'fade', outDur: 0.4 } } : {}) }))
  lane('V3', 40, (i, start, duration) =>
    put('V3', { id: `q${i + 1}`, assetId: `img${((i * 3) % 20) + 1}`, start, duration, inPoint: 0, transform: T(0.4) }))
  // A1..A3: the voice in pieces; some with fades.
  const sound = (trackId, n, prefix) =>
    lane(trackId, n, (i, start, duration) =>
      put(trackId, { id: `${prefix}${i + 1}`, assetId: 'voice', start, duration, inPoint: r3(Math.min(Math.max(0, voice - duration - 0.1), rnd() * Math.max(0, voice - duration - 0.1))), volume: r3(0.6 + rnd() * 0.4), ...(i % 4 === 1 ? { fadeIn: 0.3, fadeOut: 0.5 } : {}) }))
  sound('A1', 50, 'a')
  sound('A2', 30, 'b')
  sound('A3', 20, 'c')

  // 520 subtitles end to end with their words, 80 texts on a lane of their own.
  const WORDS = ['time', 'line', 'clip', 'frame', 'cut', 'sound', 'picture', 'light', 'slow', 'again', 'over', 'under', 'first', 'last', 'more']
  const captions = []
  const step = HEAVY.seconds / 520
  for (let i = 0; i < 520; i++) {
    const start = r3(i * step + 0.02)
    const end = r3((i + 1) * step - 0.04)
    const n = 2 + Math.floor(rnd() * 3)
    const words = Array.from({ length: n }, (_, k) => ({ text: WORDS[Math.floor(rnd() * WORDS.length)], start: r3(start + ((end - start) * k) / n), end: r3(start + ((end - start) * (k + 1)) / n) }))
    captions.push({ id: `s${i + 1}`, start, end, text: words.map((w) => w.text).join(' '), words })
  }
  for (let i = 0; i < 80; i++) {
    const start = r3(i * 7.5 + 1)
    captions.push({ id: `t${i + 1}`, start, end: r3(start + 2 + rnd() * 3), text: `Title ${i + 1}`, manual: true, layer: 1 })
  }

  // 40 work notes: points and stretches, across the film.
  const notes = []
  for (let i = 0; i < 40; i++) {
    const start = r3(5 + i * 14.5)
    notes.push({ id: `n${i + 1}`, num: i + 1, start, end: i % 3 === 0 ? start : r3(start + 2 + rnd() * 4), kind: 'fix', text: `Note ${i + 1}`, status: 'open', created: '2026-11-20T00:00:00.000Z' })
  }

  return {
    name: 'agir',
    settings: { width: 1920, height: 1080, fps: 30 },
    tracks,
    clips,
    captions,
    notes,
    /** The media it names: key -> what the caller's asset must be. */
    assetKeys: { talk: 'ham/ham-10dk-tr.mp4', voice: 'voiceover/vo.wav', ...Object.fromEntries(Array.from({ length: 20 }, (_, i) => [`img${i + 1}`, `voiceover/${i + 1}.jpg`])) }
  }
}
