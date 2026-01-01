// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// Phase 5b, decision 4 and 5 (FAZ5-PLAN.md, "5b"): a VP9 WebM with an alpha
// channel over the talk video keeps its transparency paused, playing and in
// the export (it was drawn on black paused and in the export), its frames are
// the right ones; a ProRes 4444 file is refused at import with its message.
//
// alpha.webm (e2e/media.mjs): 320×180, transparent, a blue square whose left
// edge is at 22 + 2n in frame n (rows 40–119), a white band at 50 % alpha
// (rows 140–169). Laid at 6× over talk1080.mp4.
export const name = 'alpha-webm'
export const timeoutMs = 180_000

export async function run({ c, app, media, lib }) {
  const { assert } = lib
  // The import: the WebM comes in knowing its alpha, the ProRes 4444 does not
  // come in and says why.
  app.answers.set([{ kind: 'open', paths: [media.alphaWebm, media.prores] }])
  const imp = await c.run(async () => {
    const [mi] = await window.__media()
    const r = await mi.importMediaFiles()
    const added = window.__store.getState().addAssets(r.assets)
    return { errors: r.errors, assets: added.map((a) => ({ id: a.id, name: a.name, alpha: a.alpha })) }
  })
  assert.equal(imp.assets.length, 1, 'only the WebM comes in')
  assert.equal(imp.assets[0].alpha, true, 'the WebM does not know it has alpha')
  assert.equal(imp.errors.length, 1)
  assert.match(imp.errors[0], /^prores4444\.mov: ProRes 4444 is not supported/)
  const [talk] = await lib.seedAssets(app, c, [media.talk1080])
  const r = await c.run(async (webmId, talkId) => {
    const S = window.__store
    const ex = await window.__exporter()
    const R = await window.__render()
    const p = structuredClone(S.getState().project)
    const W = p.settings.width
    const H = p.settings.height
    const k = W / 320
    p.tracks = [{ id: 'V2', kind: 'video', name: 'V2', clipIds: ['w'] }, { id: 'V1', kind: 'video', name: 'V1', clipIds: ['v'] }, { id: 'A1', kind: 'audio', name: 'A1', clipIds: [] }]
    p.clips = {
      v: { id: 'v', assetId: talkId, trackId: 'V1', start: 0, inPoint: 0, duration: 12, transform: { x: W / 2, y: H / 2, scale: 1, rotation: 0 }, volume: 1 },
      w: { id: 'w', assetId: webmId, trackId: 'V2', start: 0, inPoint: 0, duration: 4, transform: { x: W / 2, y: H / 2, scale: k, rotation: 0 }, volume: 1 }
    }
    p.captions = []
    S.getState().loadProject(p)
    S.setState({ selectedClipIds: [], playing: false })
    const proj = S.getState().project
    const alone = { ...proj, tracks: [proj.tracks[1]], clips: { v: proj.clips.v } }
    const rgba = (src) => { const o = new OffscreenCanvas(W, H); const g = o.getContext('2d'); g.drawImage(src, 0, 0, W, H); return g.getImageData(0, 0, W, H).data }
    const png = async (pr, t) => rgba(await createImageBitmap(new Blob([await ex.exportFramePng(pr, t, false, 'final')], { type: 'image/png' })))
    const draw = (pr) => { const o = new OffscreenCanvas(W, H); R.renderFrame(o.getContext('2d'), pr, S.getState().currentTime, window.__engine.resolve, { scale: 1, quality: 'refine' }); return o.getContext('2d').getImageData(0, 0, W, H).data }
    const same = (a, b) => { for (let i = 0; i < a.length; i += 97) if (a[i] !== b[i]) return false; return true }
    // What a frame of the composite shows: the empty rows (webm rows 0–35)
    // against the video alone; the band (rows 145–165) against video and
    // white half and half; the square's left edge on its row 80.
    const judge = (shown, under, n) => {
      let clearMax = 0, bandMax = 0
      for (let y = 0; y < Math.floor(35 * k); y += 3) for (let x = 0; x < W; x += 3) { const i = (y * W + x) * 4; for (let c = 0; c < 3; c++) clearMax = Math.max(clearMax, Math.abs(shown[i + c] - under[i + c])) }
      for (let y = Math.ceil(145 * k); y < Math.floor(165 * k); y += 3) for (let x = 0; x < W; x += 3) { const i = (y * W + x) * 4; for (let c = 0; c < 3; c++) bandMax = Math.max(bandMax, Math.abs(shown[i + c] - (under[i + c] * 128 + 255 * 127) / 255)) }
      // The square: blue (0x2f6fdf) where it should be, its left edge.
      const row = Math.round(80 * k)
      let edge = -1
      for (let x = 0; x < W; x++) { const i = (row * W + x) * 4; if (Math.abs(shown[i] - 0x2f) < 24 && Math.abs(shown[i + 1] - 0x6f) < 24 && Math.abs(shown[i + 2] - 0xdf) < 24) { edge = x; break } }
      return { clearMax, bandMax, edge: edge < 0 ? -1 : Math.round(edge / k), want: 22 + 2 * n }
    }
    const out = { paused: [], exported: [], playing: null }
    for (const n of [15, 45, 90]) {
      const t = n / 30 + 0.001
      S.getState().setTime(t)
      let last = null, shown = null, alike = 0
      for (let i = 0; i < 60; i++) {
        await new Promise((res) => setTimeout(res, 200))
        const now = draw(proj)
        alike = last && same(last, now) ? alike + 1 : 0
        last = now
        if (alike >= 2) { shown = now; break }
      }
      if (!shown) return { error: `the preview did not settle at frame ${n}` }
      out.paused.push({ n, ...judge(shown, draw(alone), n) })
      out.exported.push({ n, ...judge(await png(proj, t), await png(alone, t), n) })
    }
    // Playing: the <video> element is drawn. ONE read of the WebM's track
    // alone on a transparent canvas, judged within itself: its clear rows
    // keep alpha 0, its band about half, the square is there. (5a/5b patch,
    // audit S-7: comparing two draws of one task was a false alarm, a
    // playing <video> can change between them.)
    S.getState().setTime(0.5)
    await new Promise((res) => setTimeout(res, 500))
    S.getState().setPlaying(true)
    await new Promise((res) => setTimeout(res, 1200))
    // (The source the engine hands the preview for the clip now, drawn once
    // at the video's own size.)
    const src = window.__engine.resolve(proj.clips.w, proj.assets.find((a) => a.id === webmId), S.getState().currentTime)
    const kind = src ? src.constructor.name : 'none'
    const o1 = new OffscreenCanvas(320, 180)
    const g1 = o1.getContext('2d')
    if (src) g1.drawImage(src, 0, 0, 320, 180)
    const one = g1.getImageData(0, 0, 320, 180).data
    S.getState().setPlaying(false)
    let clearA = 0
    for (let y = 0; y < 35; y++) for (let x = 0; x < 320; x++) clearA = Math.max(clearA, one[(y * 320 + x) * 4 + 3])
    const bandA = one[(155 * 320 + 160) * 4 + 3]
    let squareSeen = false
    for (let x = 0; x < 320 && !squareSeen; x++) { const i = (80 * 320 + x) * 4; squareSeen = Math.abs(one[i] - 0x2f) < 24 && Math.abs(one[i + 1] - 0x6f) < 24 && Math.abs(one[i + 2] - 0xdf) < 24 && one[i + 3] > 240 }
    out.playing = { source: kind, clearMax: clearA, bandAlpha: bandA, squareSeen }
    return out
  }, imp.assets[0].id, talk.id)
  if (r.error) throw new Error(r.error)
  console.log(`    paused ${JSON.stringify(r.paused)}\n    exported ${JSON.stringify(r.exported)}\n    playing ${JSON.stringify(r.playing)}`)
  for (const [way, list] of [['paused', r.paused], ['exported', r.exported]]) {
    for (const f of list) {
      assert.ok(f.clearMax <= 3, `${way}, frame ${f.n}: the transparent part does not show the video (max ${f.clearMax})`)
      assert.ok(f.bandMax <= 12, `${way}, frame ${f.n}: the half-transparent band is not half and half (max ${f.bandMax})`)
      assert.ok(Math.abs(f.edge - f.want) <= 1, `${way}, frame ${f.n}: the square is at ${f.edge}, not ${f.want} (a wrong frame)`)
    }
  }
  assert.equal(r.playing.source, 'HTMLVideoElement', 'playing: the preview draws the <video> element')
  assert.ok(r.playing.clearMax <= 3, `playing: the transparent part is not transparent (alpha up to ${r.playing.clearMax})`)
  assert.ok(Math.abs(r.playing.bandAlpha - 128) <= 12, `playing: the band's alpha is ${r.playing.bandAlpha}, not about half`)
  assert.ok(r.playing.squareSeen, 'playing: the square is not there')
}
