// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// 5a/5b patch, item 4 (audit S-1, haritalar\_faz5-denetim-saydamlik.md): a
// clip's look or ambient light on a transparent picture multiplied its alpha
// twice: the 50 % white band of alpha.webm (127 over black) came out at 95
// with a mono look and at 63 with a barely visible ambient light, in the
// preview and the export alike. Now the band keeps its alpha: 127 ± 2 with no
// effect, a mono look, a breathing shadow and an edge glow (amount 0.05), and
// the paused preview equals the export there.
export const name = 'alpha-band'
export const timeoutMs = 120_000

export async function run({ c, app, media, lib }) {
  const { assert } = lib
  app.answers.set([{ kind: 'open', paths: [media.alphaWebm] }])
  const [webm] = await c.run(async () => {
    const [mi] = await window.__media()
    const r = await mi.importMediaFiles()
    return window.__store.getState().addAssets(r.assets).map((a) => ({ id: a.id, alpha: a.alpha }))
  })
  assert.equal(webm.alpha, true)
  const r = await c.run(async (webmId) => {
    const S = window.__store
    const E = window.__engine
    const R = await window.__render()
    const ex = await window.__exporter()
    const base = structuredClone(S.getState().project)
    const W = base.settings.width
    const H = base.settings.height
    const k = W / 320
    const rgba = (src) => { const o = new OffscreenCanvas(W, H); const g = o.getContext('2d'); g.drawImage(src, 0, 0, W, H); return g.getImageData(0, 0, W, H).data }
    const png = async (pr, t) => rgba(await createImageBitmap(new Blob([await ex.exportFramePng(pr, t, false, 'final')], { type: 'image/png' })))
    const draw = (pr) => { const o = new OffscreenCanvas(W, H); o.getContext('2d').fillStyle = '#000'; o.getContext('2d').fillRect(0, 0, W, H); R.renderFrame(o.getContext('2d'), pr, S.getState().currentTime, E.resolve, { scale: 1, quality: 'refine' }); return o.getContext('2d').getImageData(0, 0, W, H).data }
    // The band: rows 145–165 of the 320 × 180 video are white at alpha 127.
    const band = (d) => { const y = Math.round(155 * k); const x = Math.round(160 * k); const i = (y * W + x) * 4; return Math.max(d[i], d[i + 1], d[i + 2]) }
    const lookMono = { grain: 0, weave: 0, halation: 0, fade: 0, flicker: 0, dust: 0, mono: 1, vignette: 0, vShape: 'round', vMotion: 'still', vSpeed: 1, bars: 0, gate: 0 }
    const variants = {
      plain: {},
      lookMono: { look: lookMono },
      shadowBreathe: { ambientFx: { style: 'shadow-breathe', amount: 0.05, seed: 1 } },
      edgeGlow: { ambientFx: { style: 'edge-glow', amount: 0.05, seed: 1 } }
    }
    const out = {}
    for (const [nm, extra] of Object.entries(variants)) {
      const p = { ...base, captions: [], tracks: [{ id: 'V2', kind: 'video', name: 'V2', clipIds: ['w'] }, { id: 'A1', kind: 'audio', name: 'A1', clipIds: [] }], clips: { w: { id: 'w', assetId: webmId, trackId: 'V2', start: 0, inPoint: 0, duration: 4, transform: { x: W / 2, y: H / 2, scale: k, rotation: 0 }, volume: 1, ...extra } } }
      const exp = band(await png(p, 1.001))
      S.getState().loadProject(p)
      S.setState({ selectedClipIds: [], playing: false })
      S.getState().setTime(1.001)
      let prev = -1
      let shown = -1
      for (let i = 0; i < 40; i++) {
        await new Promise((res) => setTimeout(res, 150))
        const v = band(draw(S.getState().project))
        if (v === prev && v > 0) { shown = v; break }
        prev = v
      }
      out[nm] = { export: exp, preview: shown }
    }
    return out
  }, webm.id)
  console.log('     band (over black, 127 = alpha 0.5):', JSON.stringify(r))
  for (const [nm, v] of Object.entries(r)) {
    assert.ok(Math.abs(v.export - 127) <= 2, `${nm}: the exported band is ${v.export}, not 127 ± 2`)
    assert.ok(Math.abs(v.preview - v.export) <= 2, `${nm}: preview ${v.preview} vs export ${v.export}`)
  }
}
