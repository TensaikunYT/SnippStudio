// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// "Cila" part D (tarifler\CILA.md "D"): the pixel pass in the real window.
//   1. The shader and the CPU path draw the same picture for the LUT (three
//      strengths), both keyers, the colour dials, mosaic, colour isolate, glow
//      and halation (the difference is written down; the grain is another
//      generator on the CPU and is left out).
//   2. Preview = export: the frame the preview's renderer draws (refine, at
//      the project's size) is the frame the export's drawer draws, for each
//      of them; and at half size the preview shows what the export does
//      (lengths ride the size: a mosaic cell, a glow's spread).
//   3. The eyedropper reads the clip's own picture: with a black-and-white
//      LUT on the clip (the screen shows grey), a click on the green screen
//      gives green.
import { makeFxMedia } from '../../qa/reference/make-fx-media.mjs'
export const name = 'fx-gpu-cpu-preview-export'
export const timeoutMs = 300_000

const LOOKS = {
  lut100: { lut: 'preset:tealOrange' },
  lut50: { lut: 'preset:tealOrange', lutAmount: 0.5 },
  lut25: { lut: 'preset:tealOrange', lutAmount: 0.25 },
  keyNew: { chroma: { enabled: true, color: '#19c832', similarity: 0.4, smoothness: 0.1, method: 'chroma', spill: 0.8 } },
  keyFirst: { chroma: { enabled: true, color: '#19c832', similarity: 0.35, smoothness: 0.12 } },
  vignette: { vignette: 0.6 },
  tone: { tone: { exposure: 0.7, tint: 0.3, highlights: -0.6, shadows: 0.5 } },
  glow: { bloom: { amount: 0.8, threshold: 0.6, radius: 0.5 } },
  halation: { halation: { amount: 0.8, size: 0.6 } },
  mosaic: { mosaic: 24 },
  isolate: { isolate: { color: '#dc1e1e', range: 0.08, amount: 1 } },
  several: { lut: 'preset:warmFilm', lutAmount: 0.8, tone: { exposure: 0.3, tint: 0, highlights: -0.3, shadows: 0.2 }, bloom: { amount: 0.4, threshold: 0.7, radius: 0.4 }, vignette: 0.3, sharpen: 0.4 },
  // The same pass on an adjustment layer over the picture (it is handed the
  // frame as drawn so far, at the scale it is drawn at: its lengths are the
  // project's pixels).
  adjustment: { adj: true, lut: 'preset:cool', mosaic: 24, bloom: { amount: 0.5, threshold: 0.6, radius: 0.5 }, chromaAb: 6 }
}

export async function run({ c, app, lib, work }) {
  const { assert } = lib
  const file = makeFxMedia(work)
  const rows = await c.run(async (file, LOOKS) => {
    const S = window.__store
    const ex = await window.__exporter()
    const R = await window.__render()
    const E = window.__engine
    const reg = await window.api.testRegisterMedia(file)
    if (!reg) throw new Error('could not register ' + file)
    const asset = { id: 'fx', kind: 'image', name: reg.name, path: reg.path, url: reg.url, size: reg.size, duration: 0, width: 1280, height: 720, hasAudio: false }
    const W = 1280, H = 720
    const T = { x: W / 2, y: H / 2, scale: 1, rotation: 0 }
    const base = ({ adj, ...look }) => ({
      version: 1, name: 'fx', settings: { width: W, height: H, fps: 30 }, mode: 'frame',
      tracks: [...(adj ? [{ id: 'V2', kind: 'video', name: 'V2', clipIds: ['adj'] }] : []), { id: 'V1', kind: 'video', name: 'V1', clipIds: ['x'] }, { id: 'A1', kind: 'audio', name: 'A1', clipIds: [] }],
      clips: {
        x: { id: 'x', assetId: 'fx', trackId: 'V1', start: 0, inPoint: 0, duration: 2, transform: T, volume: 1, ...(adj ? {} : look) },
        ...(adj ? { adj: { id: 'adj', assetId: '', adjustment: true, trackId: 'V2', start: 0, inPoint: 0, duration: 2, transform: T, volume: 1, ...look } } : {})
      },
      assets: [asset], captions: [], captionStyle: S.getState().project.captionStyle, snap: { enabled: true, distance: 12, snapEdges: true, snapCenters: true }
    })
    const diff = (a, b) => {
      let max = 0, sum = 0, over = 0
      for (let i = 0; i < a.length; i++) {
        const d = Math.abs(a[i] - b[i])
        if (d > max) max = d
        if (d > 2) over++
        sum += d
      }
      return { max, mean: +(sum / a.length).toFixed(3), over2: +((over / a.length) * 100).toFixed(4) }
    }
    const exported = async (proj, cpu, name) => {
      R.setPixelFxCpuOnly(cpu)
      const d = ex.frameDrawer(proj, { w: W, h: H, shorts: false, captions: false, quality: 'final' })
      try {
        const drawn = R.pixelFxGpuFrames()
        await d.draw(1)
        // The path asked for is the path that drew (a shader that failed to
        // build would leave both to the CPU, and they would agree for nothing).
        const byGpu = R.pixelFxGpuFrames() - drawn
        if (name !== 'plain' && byGpu !== (cpu ? 0 : 1)) throw new Error(`${name}: ${cpu ? 'the CPU path' : 'the GPU path'} was asked for and the GPU drew ${byGpu} pass(es)`)
        const data = d.canvas.getContext('2d').getImageData(0, 0, W, H).data
        const half = new OffscreenCanvas(W / 2, H / 2)
        const hg = half.getContext('2d')
        hg.imageSmoothingQuality = 'high'
        hg.drawImage(d.canvas, 0, 0, W / 2, H / 2)
        return { data, half: hg.getImageData(0, 0, W / 2, H / 2).data }
      } finally {
        d.close()
        R.setPixelFxCpuOnly(false)
      }
    }
    const preview = (proj, scale) => {
      const o = new OffscreenCanvas(W * scale, H * scale)
      const g = o.getContext('2d', { alpha: false })
      R.renderFrame(g, proj, 1, E.resolve, { scale, quality: 'refine', includeCaptions: false })
      return g.getImageData(0, 0, W * scale, H * scale).data
    }
    const out = []
    let plain = null
    for (const [name, look] of [['plain', {}], ...Object.entries(LOOKS)]) {
      S.getState().loadProject(structuredClone(base(look)))
      await ex.preloadImagesForExport(S.getState().project)
      const proj = S.getState().project
      // The preview's own picture of the still (the engine loads it).
      for (let i = 0; i < 100; i++) {
        const px = preview(proj, 1)
        if (px[(360 * W + 700) * 4] + px[(360 * W + 700) * 4 + 1] > 0) break
        await new Promise((r) => setTimeout(r, 50))
      }
      const gpu = await exported(proj, false, name)
      const cpu = await exported(proj, true, name)
      if (name === 'plain') plain = gpu.data
      out.push({
        name,
        changed: name === 'plain' ? 0 : diff(gpu.data, plain).mean,
        gpuCpu: diff(gpu.data, cpu.data),
        previewExport: diff(preview(proj, 1), gpu.data),
        halfSize: diff(preview(proj, 0.5), gpu.half)
      })
    }
    S.getState().newProject('16:9')
    S.getState().setDirty(false)
    return out
  }, file, LOOKS)

  for (const r of rows) console.log(`     ${r.name.padEnd(10)} changed ${String(r.changed).padStart(6)} | GPU vs CPU max ${String(r.gpuCpu.max).padStart(3)} mean ${String(r.gpuCpu.mean).padStart(6)} >2: ${String(r.gpuCpu.over2).padStart(7)} % | preview vs export max ${String(r.previewExport.max).padStart(3)} | half size mean ${r.halfSize.mean}`)
  const by = Object.fromEntries(rows.map((r) => [r.name, r]))
  assert.equal(by.plain.gpuCpu.max, 0, 'a clip with nothing on is not touched by either path')
  for (const r of rows) {
    if (r.name === 'plain') continue
    assert.ok(r.changed > 0.05, `${r.name} changes the picture (mean ${r.changed})`)
    // Preview = export: the same code at the same size.
    assert.ok(r.previewExport.max <= 2, `${r.name}: the preview's frame is the export's (max ${r.previewExport.max} / 255)`)
    // At half size the preview shows the same picture, to within what
    // drawing at half size costs (edges, a cell's border, the blur's taps).
    assert.ok(r.halfSize.mean <= 4, `${r.name}: at half size the preview is the export made smaller (mean ${r.halfSize.mean} / 255)`)
  }
  // The shader and the CPU path. The LUT: every pixel within 2 / 255.
  for (const n of ['lut100', 'lut50', 'lut25']) assert.ok(by[n].gpuCpu.max <= 2, `${n}: GPU and CPU agree to 2 / 255 (max ${by[n].gpuCpu.max})`)
  for (const n of ['keyNew', 'keyFirst', 'vignette', 'tone', 'mosaic', 'isolate']) assert.ok(by[n].gpuCpu.over2 <= 0.5 && by[n].gpuCpu.mean <= 0.5, `${n}: GPU and CPU agree (max ${by[n].gpuCpu.max}, mean ${by[n].gpuCpu.mean}, ${by[n].gpuCpu.over2} % of values over 2)`)
  for (const n of ['glow', 'halation', 'several', 'adjustment']) assert.ok(by[n].gpuCpu.mean <= 1.5, `${n}: GPU and CPU agree on average (mean ${by[n].gpuCpu.mean})`)

  // ---- 3. the eyedropper ---------------------------------------------------------
  const [pic] = await lib.seedAssets(app, c, [file])
  await lib.seedTimeline(c, [pic.id])
  const [first] = await lib.clipList(c)
  await c.run((id) => {
    const s = window.__store.getState()
    const { width, height } = s.project.settings
    // The picture fills the frame; a black-and-white LUT on it and a wrong key.
    s.setClipTransform(id, { x: width / 2, y: height / 2, scale: width / 1280, rotation: 0 })
    s.setClipLut(id, 'preset:monoContrast')
    s.setClipChroma(id, { enabled: true, color: '#ff00ff' })
    s.setTime(0.5)
    // Its clip selected, as when the Inspector's eyedropper is taken up: a
    // dropper whose clip is not selected is put down at once (22 November, L12).
    s.selectClip(id)
    s.setEyedropper(id)
  }, first.id)
  await c.sleep(400)
  // A point of the green screen (picture x 60, y 300), on the screen.
  const at = await c.run(() => {
    const cv = document.querySelector('[data-testid="preview.canvas"]')
    const s = window.__store.getState()
    const { width, height } = s.project.settings
    const pv = s.previewView
    const r = cv.getBoundingClientRect()
    const fit = Math.min(cv.clientWidth / width, cv.clientHeight / height) * (pv.zoom || 1)
    const k = width / 1280
    return [r.left + (cv.clientWidth - width * fit) / 2 + (pv.x || 0) + 60 * k * fit, r.top + (cv.clientHeight - height * fit) / 2 + (pv.y || 0) + 300 * k * fit]
  })
  const depth = await lib.undoDepth(c)
  await c.clickAt(at[0], at[1])
  const colour = await c.waitFor('the key colour read', async () => { const v = await c.st((s, id) => s.project.clips[id].chroma.color, first.id); return v !== '#ff00ff' ? v : null }, 15000)
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(colour.slice(i, i + 2), 16))
  console.log(`     eyedropper: ${colour} (the screen showed grey: a black-and-white LUT is on the clip)`)
  assert.ok(g > 120 && r < 70 && b < 100 && g > r * 2.5, `the screen's own green, not the grey shown (${colour})`)
  assert.equal(await lib.undoDepth(c), depth + 1, 'one undo step')
  assert.equal(await c.st((s) => s.eyedropperClip), null, 'the eyedropper is put down')
  // A click beside the picture: nothing changes, and it says so.
  await c.run((id) => {
    const s = window.__store.getState()
    s.setClipTransform(id, { x: 200, y: 200, scale: 0.2, rotation: 0 })
    s.selectClip(id)
    s.setEyedropper(id)
  }, first.id)
  await c.sleep(200)
  const far = await c.run(() => {
    const cv = document.querySelector('[data-testid="preview.canvas"]')
    const r = cv.getBoundingClientRect()
    return [r.left + r.width * 0.8, r.top + r.height * 0.8]
  })
  await c.clickAt(far[0], far[1])
  await c.waitFor('the miss is said', () => c.run(() => [...document.querySelectorAll('[data-testid^="toast."]')].some((e) => /outside this clip/i.test(e.textContent ?? '')) || null), 10000)
  assert.equal(await c.st((s, id) => s.project.clips[id].chroma.color, first.id), colour, 'the key colour is as it was')
}
