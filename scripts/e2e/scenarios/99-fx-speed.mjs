// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// "Cila" part D, "it must not slow the program down": what one effect of the
// pixel pass costs on a full-HD clip, written down on every run. A frame
// drawn in final quality with its picture already decoded (as npm run perf
// times frame.*), a dragged dial (the store changed and a frame drawn, 120
// times), and the speed of a 5 s export without and with the effect.
//
// The budget itself (a frame at most 8 ms, a dragged frame's 95th percentile
// at most 16.7 ms, the export at most 15 % slower) is npm run perf's to hold:
// that run has the machine to itself. This one shares it with another heavy
// run, so it only fails where something is plainly wrong (a frame over
// 16.7 ms, an export under two thirds of the plain clip's speed).
export const name = 'fx-speed'
export const timeoutMs = 300_000

const LOOKS = {
  none: {},
  lut: { lut: 'preset:tealOrange' },
  key: { chroma: { enabled: true, color: '#19c832', similarity: 0.4, smoothness: 0.1, method: 'chroma', spill: 0.5 } },
  tone: { tone: { exposure: 0.5, tint: 0.2, highlights: -0.4, shadows: 0.4 } },
  glow: { bloom: { amount: 0.6, threshold: 0.6, radius: 0.5 } },
  halation: { halation: { amount: 0.6, size: 0.5 } },
  mosaic: { mosaic: 24 },
  isolate: { isolate: { color: '#dc1e1e', range: 0.08, amount: 1 } },
  all: { lut: 'preset:tealOrange', tone: { exposure: 0.5, tint: 0.2, highlights: -0.4, shadows: 0.4 }, bloom: { amount: 0.6, threshold: 0.6, radius: 0.5 }, halation: { amount: 0.6, size: 0.5 }, isolate: { color: '#dc1e1e', range: 0.2, amount: 0.5 }, vignette: 0.3, sharpen: 0.3 }
}

export async function run({ c, app, media, lib }) {
  const { assert } = lib
  const [talk] = await lib.seedAssets(app, c, [media.talk1080])
  const rows = await c.run(async (talkId, LOOKS) => {
    const S = window.__store
    const ex = await window.__exporter()
    const R = await window.__render()
    const SRC = await window.__sources()
    const asset = S.getState().project.assets.find((a) => a.id === talkId)
    const W = 1920, H = 1080
    const project = (look) => ({
      version: 1, name: 'fx-speed', settings: { width: W, height: H, fps: 30 }, mode: 'frame',
      tracks: [{ id: 'V1', kind: 'video', name: 'V1', clipIds: ['x'] }, { id: 'A1', kind: 'audio', name: 'A1', clipIds: [] }],
      clips: { x: { id: 'x', assetId: talkId, trackId: 'V1', start: 0, inPoint: 0, duration: 10, transform: { x: W / 2, y: H / 2, scale: 1, rotation: 0 }, volume: 1, ...look } },
      assets: [asset], captions: [], captionStyle: S.getState().project.captionStyle, snap: { enabled: true, distance: 12, snapEdges: true, snapCenters: true }
    })
    const median = (a) => { const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)] }
    const canvas = new OffscreenCanvas(W, H)
    const ctx = canvas.getContext('2d', { alpha: false })
    const sink = await SRC.getVideoSink(asset, undefined, { original: true })
    const frame = (await sink.getCanvas(3)).canvas
    const resolve = () => frame
    const draw = (p) => {
      R.renderFrame(ctx, p, 3, resolve, { includeCaptions: true, shortsOverlay: false, quality: 'final' })
      ctx.getImageData(0, 0, 1, 1)
    }
    const out = []
    for (const [name, look] of Object.entries(LOOKS)) {
      S.getState().loadProject(structuredClone(project(look)))
      await new Promise((r) => setTimeout(r, 50))
      const p = S.getState().project
      for (let i = 0; i < 5; i++) draw(p)
      const runs = []
      for (let i = 0; i < 5; i++) {
        const t0 = performance.now()
        for (let r = 0; r < 10; r++) draw(p)
        runs.push((performance.now() - t0) / 10)
      }
      const row = { name, frame: +median(runs).toFixed(2) }
      if (name === 'glow') {
        // The dial dragged: 120 values, the store changed and a frame drawn for each.
        const ms = []
        S.getState().armGesture()
        for (let k = 0; k < 120; k++) {
          const t0 = performance.now()
          S.getState().setClipFx('x', { bloom: { amount: 0.1 + (0.8 * k) / 119 } })
          draw(S.getState().project)
          ms.push(performance.now() - t0)
        }
        S.getState().endGesture()
        ms.sort((a, b) => a - b)
        row.drag95 = +ms[Math.floor(ms.length * 0.95)].toFixed(2)
        row.dragMax = +ms[ms.length - 1].toFixed(2)
        S.getState().loadProject(structuredClone(project(look)))
        await new Promise((r) => setTimeout(r, 50))
      }
      // 5 s of it exported (150 frames), twice: the better run.
      const fps = []
      for (let i = 0; i < 2; i++) {
        const t0 = performance.now()
        await ex.exportProjectMp4(S.getState().project, { onProgress() {}, settings: { container: 'mp4', resolutionScale: 1, fps: 30, bitrateFactor: 0.12, target: 'landscape', normalize: false, range: [0, 5] } })
        fps.push(150 / ((performance.now() - t0) / 1000))
      }
      row.fps = +Math.max(...fps).toFixed(1)
      out.push(row)
    }
    S.getState().newProject('16:9')
    S.getState().setDirty(false)
    return out
  }, talk.id, LOOKS)
  const plain = rows.find((r) => r.name === 'none')
  for (const r of rows) {
    console.log(`     ${r.name.padEnd(9)} frame ${String(r.frame).padStart(6)} ms (+${(r.frame - plain.frame).toFixed(2)}) | export ${String(r.fps).padStart(6)} fps (${((r.fps / plain.fps - 1) * 100).toFixed(0)} %)${r.drag95 !== undefined ? ` | dragged dial: 95th percentile ${r.drag95} ms, slowest ${r.dragMax} ms` : ''}`)
  }
  for (const r of rows) {
    assert.ok(r.frame <= 16.7, `${r.name}: a full-HD frame in ${r.frame} ms (at most a frame at 60 fps)`)
    assert.ok(r.fps >= plain.fps * 0.66, `${r.name}: the export at ${r.fps} fps against the plain clip's ${plain.fps}`)
    if (r.drag95 !== undefined) assert.ok(r.drag95 <= 16.7, `the dragged dial's frames: 95th percentile ${r.drag95} ms`)
  }
}
