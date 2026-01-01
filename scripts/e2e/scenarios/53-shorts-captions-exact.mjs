// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// Phase Ç3a, decision 5 (report R8, inherited K12): a Short's subtitles in
// the export where the preview shows them: the Shorts caption style's own
// horizontal place, a keyed motion and a tracker. The preview canvas's 9:16
// window and the exported Short (its probed frame) are compared on an 18 × 32 signature at three times. Before
// Ç3a the export drew the captions in output pixels with no window and no
// trackers: the title stood elsewhere and moved 0.56× as far.
export const name = 'shorts-captions-preview-export'

const shownSig = async (c) =>
  c.run(() => {
    const cv = document.querySelector('[data-testid="preview.canvas"]')
    const s = window.__store.getState()
    const { width, height } = s.project.settings
    const pv = s.previewView
    const cw = cv.clientWidth, ch = cv.clientHeight
    const dpr = cv.width / cw
    const fit = Math.min(cw / width, ch / height) * (pv.zoom || 1)
    const dx = (cw - width * fit) / 2 + (pv.x || 0)
    const dy = (ch - height * fit) / 2 + (pv.y || 0)
    return window.__render().then((R) => {
      const win = R.shortsWindowAt(s.project, s.currentTime)
      const o = new OffscreenCanvas(18, 32)
      const g = o.getContext('2d')
      g.drawImage(cv, (dx + (win.cx - win.w / 2) * fit) * dpr, dy * dpr, win.w * fit * dpr, height * fit * dpr, 0, 0, 18, 32)
      return [...g.getImageData(0, 0, 18, 32).data]
    })
  })
// The exported Short's frame at t (its probe PNG: the export's own drawing,
// before the encoder).
const writtenSig = (c, t) =>
  c.run(async (t) => {
    const ex = await window.__exporter()
    const p = window.__store.getState().project
    let png = null
    await ex.exportProjectMp4(p, { settings: { container: 'mp4', resolutionScale: 1, fps: 30, bitrateFactor: 0.12, target: 'shorts', range: [t, t + 0.1], probe: [0], probePng: true }, onProgress() {}, onProbe: (_i, h) => (png = h.slice(h.indexOf(':') + 1)) })
    const bin = atob(png)
    const u8 = new Uint8Array(bin.length)
    for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i)
    const bmp = await createImageBitmap(new Blob([u8]))
    const o = new OffscreenCanvas(18, 32)
    const g = o.getContext('2d')
    g.drawImage(bmp, 0, 0, 18, 32)
    return { sig: [...g.getImageData(0, 0, 18, 32).data], w: bmp.width, h: bmp.height }
  }, t)
const diff = (a, b) => a.reduce((n, v, i) => n + (i % 4 === 3 ? 0 : Math.abs(v - b[i])), 0) / (a.length * 0.75)

export async function run({ c, app, media, lib }) {
  const { assert } = lib
  const [pic] = await lib.seedAssets(app, c, [media.numbered[0]])
  await c.run((id) => {
    const S = window.__store
    const p = structuredClone(S.getState().project)
    const a = p.assets.find((x) => x.id === id)
    p.settings = { ...p.settings, width: 1920, height: 1080, fps: 30 }
    p.mode = 'shorts'
    p.tracks = [{ id: 'V1', kind: 'video', name: 'V1', clipIds: ['bg'] }, { id: 'A1', kind: 'audio', name: 'A1', clipIds: [] }]
    p.clips = { bg: { id: 'bg', assetId: a.id, trackId: 'V1', start: 0, inPoint: 0, duration: 6, transform: { x: 960, y: 540, scale: Math.max(1920 / a.width, 1080 / a.height), rotation: 0 }, volume: 1 } }
    p.shorts = { baseX: 960, keyframes: [{ id: 'p0', time: 0, x: 760 }, { id: 'p1', time: 6, x: 1160 }] }
    p.trackers = [{ id: 'tk', name: 'tk', keyframes: [{ id: 'k0', time: 0, x: 900, y: 500 }, { id: 'k1', time: 6, x: 1000, y: 620 }] }]
    p.captionStyleShorts = { ...p.captionStyle, posX: 0.3, fontSize: 90, color: '#ffffff', bgColor: '#000000', bgOpacity: 1 }
    p.captions = [{ id: 'c1', start: 0, end: 6, text: 'TITLE MOVES', manual: true, trackerId: 'tk', kfs: [{ id: 'm0', time: 0, x: -120, y: -300, scale: 1, rot: 0, opacity: 1 }, { id: 'm1', time: 6, x: 160, y: 200, scale: 1, rot: 0, opacity: 1 }] }]
    p.templates = []
    S.getState().loadProject(p)
    S.setState({ selectedClipIds: [], playing: false })
    return true
  }, pic.id)
  const out = []
  for (const t of [0.5, 3, 5.5]) {
    await c.st((s, t) => s.setTime(t), t)
    await c.sleep(700)
    const shown = await shownSig(c)
    const written = await writtenSig(c, t)
    assert.deepEqual([written.w, written.h], [1080, 1920])
    const d = diff(shown, written.sig)
    out.push(`${t}: ${d.toFixed(2)}`)
    assert.ok(d <= 8, `at ${t} s the Short's preview differs from its export by ${d.toFixed(2)} / 255 on average`)
  }
  console.log('     preview vs export (18×32, /255): ' + out.join('; '))
}
