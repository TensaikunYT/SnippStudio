// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// 5a/5b patch, item 10 (audit S-4, haritalar\_faz5-denetim-saydamlik.md):
// whether a canvas picture lets the tracks under it through was read back
// (160 px, getImageData) on every frame a compound clip with a look was
// drawn: ~6 ms a frame. Now the answer is kept per picture and asked again
// only when what it shows can change: a compound of plain opaque footage
// that stays where it is is read once, not on each of 60 frames; and the
// export's stills (ImageBitmaps) once each. The frame time is written down.
export const name = 'alpha-read-cost'
export const timeoutMs = 120_000

export async function run({ c, app, media, lib }) {
  const { assert } = lib
  const [talk] = await lib.seedAssets(app, c, [media.talk1080])
  const r = await c.run(async (talkId) => {
    const S = window.__store
    const R = await window.__render()
    const E = window.__engine
    const p = structuredClone(S.getState().project)
    const W = p.settings.width
    const H = p.settings.height
    const look = { grain: 0, weave: 0, halation: 0, fade: 0.6, flicker: 0, dust: 0, mono: 0, vignette: 0.9, vShape: 'round', vMotion: 'still', vSpeed: 1, bars: 0, gate: 0 }
    const kid = { id: 'kc', assetId: talkId, trackId: 'V1', start: 0, inPoint: 0, duration: 10, transform: { x: W / 2, y: H / 2, scale: W / 1920, rotation: 0 }, volume: 1 }
    p.tracks = [{ id: 'V1', kind: 'video', name: 'V1', clipIds: ['n'] }, { id: 'A1', kind: 'audio', name: 'A1', clipIds: [] }]
    p.clips = { n: { id: 'n', assetId: '', nested: { clips: [kid] }, trackId: 'V1', start: 0, inPoint: 0, duration: 10, transform: { x: W / 2, y: H / 2, scale: 0.8, rotation: 0 }, volume: 1, look } }
    S.getState().loadProject(p)
    await new Promise((res) => setTimeout(res, 1500))
    const proj = S.getState().project
    const o = new OffscreenCanvas(W, H)
    const g = o.getContext('2d')
    // Warm up (decoders, scratches).
    for (let i = 0; i < 5; i++) R.renderFrame(g, proj, 1 + i / 30, E.resolve, { scale: 1, quality: 'refine' })
    const r0 = R.seeThroughReads()
    const ms = []
    for (let i = 0; i < 60; i++) {
      const t0 = performance.now()
      R.renderFrame(g, proj, 2 + i / 30, E.resolve, { scale: 1, quality: 'refine' })
      g.getImageData(0, 0, 1, 1)
      ms.push(performance.now() - t0)
    }
    ms.sort((a, b) => a - b)
    return { reads: R.seeThroughReads() - r0, median: +ms[30].toFixed(2), p90: +ms[54].toFixed(2) }
  }, talk.id)
  console.log(`     compound + look, 60 frames: ${r.reads} read-backs, frame median ${r.median} ms, p90 ${r.p90} ms`)
  assert.ok(r.reads <= 2, `a compound of plain footage that stays put is read once, not on each frame (${r.reads} read-backs in 60 frames)`)
}
