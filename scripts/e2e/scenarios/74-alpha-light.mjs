// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// 5a/5b patch, item 11 (audit S-6 + S-5, haritalar\_faz5-denetim-saydamlik.md):
// light on a transparent clip lit the video under it. A transition's light
// (flash, light leak, film burn) between two cuts of a transparent clip lit
// the whole frame (flash: 46.8 % of the clear area, up to 133 / 255), and the
// still-photo effects (window light, dust, light leak) painted the empty
// parts of a transparent PNG (window light: 100 %). Now the light is kept to
// where the clip itself is (weighted by its alpha): under its clear parts the
// export equals the video alone. (Opaque clips: reference project
// ref-oldpath, equal to the build of a43f1f2.)
export const name = 'alpha-light'
export const timeoutMs = 180_000

export async function run({ c, app, media, lib }) {
  const { assert } = lib
  app.answers.set([{ kind: 'open', paths: [media.alphaWebm] }])
  const [webm] = await c.run(async () => {
    const [mi] = await window.__media()
    const r = await mi.importMediaFiles()
    return window.__store.getState().addAssets(r.assets).map((a) => ({ id: a.id, alpha: a.alpha }))
  })
  const [talk1080, still] = await lib.seedAssets(app, c, [media.talk1080, media.alphaPng])
  const r = await c.run(async (webmId, t1080, stillId) => {
    const S = window.__store
    const ex = await window.__exporter()
    const base = structuredClone(S.getState().project)
    const W = base.settings.width
    const H = base.settings.height
    const k = W / 320
    const rgba = (src) => { const o = new OffscreenCanvas(W, H); const g = o.getContext('2d'); g.drawImage(src, 0, 0, W, H); return g.getImageData(0, 0, W, H).data }
    const png = async (pr, t) => rgba(await createImageBitmap(new Blob([await ex.exportFramePng(pr, t, false, 'final')], { type: 'image/png' })))
    const A1 = { id: 'A1', kind: 'audio', name: 'A1', clipIds: [] }
    const under = { v: { id: 'v', assetId: t1080, trackId: 'V1', start: 0, inPoint: 0, duration: 12, transform: { x: W / 2, y: H / 2, scale: 1, rotation: 0 }, volume: 1 } }
    const mk = (clips, ids) => ({ ...base, captions: [], tracks: [{ id: 'V2', kind: 'video', name: 'V2', clipIds: ids }, { id: 'V1', kind: 'video', name: 'V1', clipIds: ['v'] }, A1], clips: { ...under, ...clips } })
    const T = { x: W / 2, y: H / 2, scale: k, rotation: 0 }
    // The clear rows of the picture (0–33 of 180): changed pixels against the video alone.
    const spill = (a, b) => { let n = 0; let cnt = 0; let mx = 0; for (let y = 0; y < 33 * k; y += 3) for (let x = 0; x < W; x += 3) { const i = (y * W + x) * 4; let m = 0; for (let cc = 0; cc < 3; cc++) m = Math.max(m, Math.abs(a[i + cc] - b[i + cc])); n++; if (m > 2) cnt++; mx = Math.max(mx, m) } return { pct: +((100 * cnt) / n).toFixed(1), max: mx } }
    // And the opaque square (rows 45–115, its columns at that frame): lit there.
    const lit = (a, b, x0) => { let mx = 0; for (let y = Math.round(50 * k); y < 110 * k; y += 4) for (let x = Math.round((x0 + 5) * k); x < (x0 + 75) * k; x += 4) { const i = (y * W + x) * 4; for (let cc = 0; cc < 3; cc++) mx = Math.max(mx, Math.abs(a[i + cc] - b[i + cc])) } return mx }
    const out = {}
    const t = 1.001
    const alone = await png(mk({}, []), t)
    const plain = await png(mk({ w: { id: 'w', assetId: stillId, trackId: 'V2', start: 0, inPoint: 0, duration: 4, transform: T, volume: 1 } }, ['w']), t)
    for (const st of ['window-light', 'dust', 'light-leak', 'haze']) {
      const d = await png(mk({ w: { id: 'w', assetId: stillId, trackId: 'V2', start: 0, inPoint: 0, duration: 4, transform: T, volume: 1, stillImageFx: { style: st, amount: 0.8, seed: 2 } } }, ['w']), t)
      out['still.' + st] = { ...spill(d, alone), onPicture: lit(d, plain, 60) }
    }
    for (const ty of ['flash', 'light-leak', 'film-burn']) {
      const p = mk({
        w: { id: 'w', assetId: webmId, trackId: 'V2', start: 0, inPoint: 0, duration: 1.5, transform: T, volume: 1, transitionOut: { type: ty, duration: 0.6, to: 'w2', align: 'center' } },
        w2: { id: 'w2', assetId: webmId, trackId: 'V2', start: 1.5, inPoint: 2, duration: 2, transform: T, volume: 1 }
      }, ['w', 'w2'])
      const at = 1.501
      out['transition.' + ty] = spill(await png(p, at), await png(mk({}, []), at))
    }
    return out
  }, webm.id, talk1080.id, still.id)
  for (const [k2, v] of Object.entries(r)) console.log('    ', k2.padEnd(24), JSON.stringify(v))
  for (const [k2, v] of Object.entries(r)) assert.ok(v.pct === 0, `${k2}: the light reached the video under the clear part (${JSON.stringify(v)})`)
  // The light still lights the picture itself (window light and light leak are bright effects).
  assert.ok(r['still.window-light'].onPicture > 2, JSON.stringify(r['still.window-light']))
}
