// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// Phase Ç2b.2, done measure: the preview shows what the export writes at a
// transition's first and last frame, for four kinds (a dissolve, a wipe, a
// slide, a zoom). Two numbered cards butt on V1; the playhead is put on the
// window's first frame and on its last (and its middle); the preview canvas (paused, settled)
// and exportFramePng at the same time are compared on a 32×18 signature.
export const name = 'preview-export-transitions'

// (The frame inside the preview canvas: fitted and centred as
// PreviewCanvas.tsx draws it, its 1 px outline left out.)
const sig = async (c) =>
  c.run(() => {
    const cv = document.querySelector('[data-testid="preview.canvas"]')
    const s = window.__store.getState()
    const { width, height } = s.project.settings
    const pv = s.previewView
    const cw = cv.clientWidth
    const ch = cv.clientHeight
    const dpr = cv.width / cw
    const fit = Math.min(cw / width, ch / height) * (pv.zoom || 1)
    const dw = width * fit
    const dh = height * fit
    const dx = (cw - dw) / 2 + (pv.x || 0)
    const dy = (ch - dh) / 2 + (pv.y || 0)
    const o = new OffscreenCanvas(32, 18)
    const g = o.getContext('2d')
    g.drawImage(cv, (dx + 2) * dpr, (dy + 2) * dpr, (dw - 4) * dpr, (dh - 4) * dpr, 0, 0, 32, 18)
    return [...g.getImageData(0, 0, 32, 18).data]
  })
const exportSig = (c, t) =>
  c.run(async (t) => {
    const ex = await window.__exporter()
    const p = window.__store.getState().project
    await ex.preloadImagesForExport(p)
    const u8 = await ex.exportFramePng(p, t, true, 'final')
    const bmp = await createImageBitmap(new Blob([u8]))
    const o = new OffscreenCanvas(32, 18)
    const g = o.getContext('2d')
    g.drawImage(bmp, 0, 0, 32, 18)
    return [...g.getImageData(0, 0, 32, 18).data]
  }, t)
const diff = (a, b) => a.reduce((n, v, i) => n + (i % 4 === 3 ? 0 : Math.abs(v - b[i])), 0) / (a.length * 0.75)

export async function run({ c, app, media, lib }) {
  const { assert } = lib
  const [a, b] = await lib.seedAssets(app, c, [media.numbered[0], media.numbered[1]])
  const out = []
  for (const type of ['mix', 'wipe', 'slide', 'zoom']) {
    const w = await c.run((ids, type) => {
      const S = window.__store
      const p = structuredClone(S.getState().project)
      const T = { x: p.settings.width / 2, y: p.settings.height / 2, scale: 1, rotation: 0 }
      const fit = (asset) => Math.min(p.settings.width / asset.width, p.settings.height / asset.height)
      const A = p.assets.find((x) => x.id === ids[0])
      const B = p.assets.find((x) => x.id === ids[1])
      p.tracks = [{ id: 'V1', kind: 'video', name: 'V1', clipIds: ['ta', 'tb'] }, { id: 'A1', kind: 'audio', name: 'A1', clipIds: [] }]
      p.clips = {
        ta: { id: 'ta', assetId: ids[0], trackId: 'V1', start: 0, inPoint: 0, duration: 3, transform: { ...T, scale: fit(A) }, volume: 1, transitionOut: { type, duration: 1, to: 'tb' } },
        tb: { id: 'tb', assetId: ids[1], trackId: 'V1', start: 3, inPoint: 0, duration: 3, transform: { ...T, scale: fit(B) }, volume: 1 }
      }
      p.captions = []
      S.getState().loadProject(p)
      S.setState({ selectedClipIds: [], playing: false })
      return { fps: p.settings.fps }
    }, [a.id, b.id], type)
    // A still on both sides: centred, 2.5–3.5 s. Its first frame, and its last.
    const first = 2.5
    const last = 3.5 - 1 / w.fps
    // (And its middle: the mix, the wipe's edge, the slide half-way.)
    for (const [k, t] of [['first', first], ['middle', 3], ['last', last]]) {
      await c.st((s, t) => s.setTime(t), t)
      await c.sleep(700)
      const shown = await sig(c)
      const written = await exportSig(c, t)
      const d = diff(shown, written)
      out.push(`${type} ${k} ${d.toFixed(2)}`)
      // (First and last: within 3 / 255. In the middle a moving edge lands on
      // the preview's own, smaller buffer: within 6.)
      assert.ok(d <= (k === 'middle' ? 6 : 3), `${type}, the ${k} frame (${t.toFixed(3)} s): the preview differs from the export by ${d.toFixed(2)} / 255 on average`)
    }
  }
  console.log('    ' + out.join('; '))
}
