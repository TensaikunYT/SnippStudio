// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// 5a/5b patch, item 9 (audit S-3, haritalar\_faz5-denetim-saydamlik.md): a
// project saved before 5b holds an alpha WebM whose asset says nothing of its
// alpha. Opened, the flag is read a moment later, but the paused preview's
// decoder had been made without alpha and was kept for the session: the
// transparent rows showed opaque black (255 apart from the video under them)
// while the export was right. Now a changed alpha flag remakes the decoders and
// the frames: at 4 paused moments the transparent rows equal the video alone,
// as in the export. Then the same for a relinked file: the clip's frames made
// from an opaque file first, the asset then pointed at the alpha WebM.
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
export const name = 'alpha-old-project'
export const timeoutMs = 180_000

export async function run({ c, app, media, lib, work }) {
  const { assert } = lib
  const file = join(work, 'pre5b.snipp')
  const W = 1920
  const H = 1080
  const k = W / 320
  const project = {
    version: 1, name: 'pre5b', settings: { width: W, height: H, fps: 30 }, mode: 'frame',
    tracks: [{ id: 'V2', kind: 'video', name: 'V2', clipIds: ['w'] }, { id: 'V1', kind: 'video', name: 'V1', clipIds: ['v'] }, { id: 'A1', kind: 'audio', name: 'A1', clipIds: [] }],
    clips: {
      v: { id: 'v', assetId: 'a1', trackId: 'V1', start: 0, inPoint: 0, duration: 12, transform: { x: W / 2, y: H / 2, scale: 1, rotation: 0 }, volume: 1 },
      w: { id: 'w', assetId: 'a2', trackId: 'V2', start: 0, inPoint: 0, duration: 4, transform: { x: W / 2, y: H / 2, scale: k, rotation: 0 }, volume: 1 }
    },
    assets: [
      { id: 'a1', kind: 'video', name: 'talk1080.mp4', path: media.talk1080, duration: 12, width: 1920, height: 1080, hasAudio: true },
      { id: 'a2', kind: 'video', name: 'alpha.webm', path: media.alphaWebm, duration: 4, width: 320, height: 180, hasAudio: false }
    ],
    captions: []
  }
  writeFileSync(file, JSON.stringify(project, null, 1))
  lib.answer(app, { kind: 'open', paths: [file] })
  await c.click('topbar.file')
  await c.click('menu.file.open')
  await c.waitFor('opened', async () => (await c.st((s) => Object.keys(s.project.clips).length)) === 2, 15000)
  const measure = (relink) => c.run(async (relink) => {
    const S = window.__store
    const E = window.__engine
    const R = await window.__render()
    const ex = await window.__exporter()
    const W = 1920
    const H = 1080
    const k = 6
    const t0 = performance.now()
    while (performance.now() - t0 < 8000 && !S.getState().project.assets.find((a) => a.id === 'a2').alpha) await new Promise((res) => setTimeout(res, 20))
    const draw = (pr) => { const o = new OffscreenCanvas(W, H); R.renderFrame(o.getContext('2d'), pr, S.getState().currentTime, E.resolve, { scale: 1, quality: 'refine' }); return o.getContext('2d').getImageData(0, 0, W, H).data }
    // The rows above the square (0–34 of 180) are clear in every frame.
    const top = (x, y) => { let m = 0; for (let yy = 0; yy < Math.floor(35 * k); yy += 3) for (let xx = 0; xx < W; xx += 3) { const i = (yy * W + xx) * 4; for (let ch = 0; ch < 3; ch++) m = Math.max(m, Math.abs(x[i + ch] - y[i + ch])) } return m }
    const same = (a, b) => { for (let i = 0; i < a.length; i += 97) if (a[i] !== b[i]) return false; return true }
    const rgba = (src) => { const o = new OffscreenCanvas(W, H); const g = o.getContext('2d'); g.drawImage(src, 0, 0, W, H); return g.getImageData(0, 0, W, H).data }
    const png = async (pr, t) => rgba(await createImageBitmap(new Blob([await ex.exportFramePng(pr, t, false, 'final')], { type: 'image/png' })))
    const out = []
    for (const t of [0.2, 1.0, 2.0, 3.0]) {
      S.getState().setTime(t + 0.001)
      let last = null
      let shown = null
      let alike = 0
      for (let i = 0; i < 60; i++) {
        await new Promise((res) => setTimeout(res, 200))
        const now = draw(S.getState().project)
        alike = last && same(last, now) ? alike + 1 : 0
        last = now
        if (alike >= 2) { shown = now; break }
      }
      const proj = S.getState().project
      const alone = { ...proj, tracks: proj.tracks.filter((x) => x.id === 'V1'), clips: { v: proj.clips.v } }
      out.push({ t, settled: !!shown, preview: shown ? top(shown, draw(alone)) : -1, export: top(await png(proj, t + 0.001), await png(alone, t + 0.001)) })
    }
    void relink
    return { alpha: S.getState().project.assets.find((a) => a.id === 'a2').alpha === true, out }
  }, relink)
  const r = await measure(false)
  console.log('     opened before 5b:', JSON.stringify(r))
  assert.equal(r.alpha, true)
  for (const m of r.out) {
    assert.ok(m.settled, `t=${m.t}: the paused preview settled`)
    assert.ok(m.preview <= 2, `t=${m.t}: the paused preview shows the video through the transparent rows (max ${m.preview})`)
    assert.ok(m.export <= 2, `t=${m.t}: the export too (max ${m.export})`)
  }
  // A relinked file: frames first from an opaque file (alpha false), then the
  // asset is pointed at the alpha WebM with its flag, as a relink does.
  const urls = await c.run(async (opaque, alphaFile) => ({ opaque: (await window.api.testRegisterMedia(opaque)).url, alpha: (await window.api.testRegisterMedia(alphaFile)).url }), media.other, media.alphaWebm)
  await c.run(async (u) => {
    const S = window.__store
    S.getState().setAssetDerived('a2', { url: u, alpha: false })
    S.getState().setTime(1.5)
    await new Promise((res) => setTimeout(res, 1500))
    return true
  }, urls.opaque)
  await c.run(async (u) => {
    const S = window.__store
    // (dropCachedFrames is what a relink calls for a new file; the alpha flag comes after it.)
    S.getState().setAssetDerived('a2', { url: u })
    await new Promise((res) => setTimeout(res, 300))
    S.getState().setAssetDerived('a2', { alpha: true })
    return true
  }, urls.alpha)
  const r2 = await measure(true)
  console.log('     relinked to an alpha file:', JSON.stringify(r2))
  for (const m of r2.out) {
    assert.ok(m.preview <= 2, `relinked, t=${m.t}: the paused preview shows the video through (max ${m.preview})`)
    assert.ok(m.export <= 2, `relinked, t=${m.t}: the export too (max ${m.export})`)
  }
}
