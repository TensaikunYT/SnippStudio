// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// Phase 5b, done measure (FAZ5-PLAN.md, "5b"): a canvas page with a
// transparent body, laid as a code clip over a talk video, shows the video
// where it is transparent, and at six fixed moments the preview's own frame
// at full quality (the engine's sources, paused, drawn by renderFrame at
// scale 1) equals the exported frame (exportFramePng), within 2 / 255 per
// channel. Also: the asset knows it has alpha (its strip's samples).
//
// Two videos under it:
//  - talk1080.mp4, the project's own size: the whole frame is compared;
//  - talk.mp4 (640×360): the paused preview decodes it at 1920 wide and the
//    export draws the file's own 640 scaled up, so the video alone already
//    differs between the two (that path is not 5b's). There the clip's part
//    is checked: where it is opaque, ≤ 2; elsewhere the difference is no more
//    than the video's own difference let through by (1 − alpha), plus 2.
import { join } from 'node:path'
import { TESTDATA } from '../media.mjs'

export const name = 'code-clip-alpha'
export const timeoutMs = 300_000

export const MOMENTS = [0.4, 1.0, 2.5, 4.2, 6.6, 9.3]

export async function run({ c, app, media, lib }) {
  const { assert } = lib
  const [talk1080, talk] = await lib.seedAssets(app, c, [media.talk1080, media.talk])
  for (const [under, strict] of [[talk1080, true], [talk, false]]) {
    const r = await c.run(async (talkId, page, moments) => {
      const S = window.__store
      const ex = await window.__exporter()
      const R = await window.__render()
      const [films, imp] = await window.__codeFilm()
      let film = S.getState().project.assets.find((a) => a.kind === 'code')
      if (!film) {
        const info = await window.api.codeFilm.register(page)
        const film0 = (await imp.codeFilmImport(info)).assets.find((a) => a.kind === 'code')
        const [added] = S.getState().addAssets([film0])
        film = added ?? film0
      }
      const filmId = film.id
      const asset = () => S.getState().project.assets.find((a) => a.id === filmId)
      const t0 = performance.now()
      while (films.codeFilms.status(filmId)?.state !== 'ready' && performance.now() - t0 < 30000) { films.codeFilms.ensure(asset()); await new Promise((res) => setTimeout(res, 50)) }
      if (films.codeFilms.status(filmId)?.state !== 'ready') return { error: 'the page did not start: ' + films.codeFilms.status(filmId)?.error }
      while (!asset().filmstrip && performance.now() - t0 < 60000) await new Promise((res) => setTimeout(res, 100))
      const p = structuredClone(S.getState().project)
      const W = p.settings.width
      const H = p.settings.height
      const tv = p.assets.find((a) => a.id === talkId)
      p.tracks = [{ id: 'V2', kind: 'video', name: 'V2', clipIds: ['k'] }, { id: 'V1', kind: 'video', name: 'V1', clipIds: ['v'] }, { id: 'A1', kind: 'audio', name: 'A1', clipIds: [] }]
      p.clips = {
        v: { id: 'v', assetId: talkId, trackId: 'V1', start: 0, inPoint: 0, duration: 12, transform: { x: W / 2, y: H / 2, scale: Math.min(W / tv.width, H / tv.height), rotation: 0 }, volume: 1 },
        k: { id: 'k', assetId: filmId, trackId: 'V2', start: 0, inPoint: 0, duration: 10, transform: { x: W / 2, y: H / 2, scale: W / asset().width, rotation: 0 }, volume: 1 }
      }
      p.captions = []
      S.getState().loadProject(p)
      S.setState({ selectedClipIds: [], playing: false })
      const rgba = (src) => { const o = new OffscreenCanvas(W, H); const g = o.getContext('2d'); g.drawImage(src, 0, 0, W, H); return g.getImageData(0, 0, W, H).data }
      const png = async (proj, t) => rgba(await createImageBitmap(new Blob([await ex.exportFramePng(proj, t, false, 'final')], { type: 'image/png' })))
      const draw = (proj) => {
        const o = new OffscreenCanvas(W, H)
        R.renderFrame(o.getContext('2d'), proj, S.getState().currentTime, window.__engine.resolve, { scale: 1, quality: 'refine' })
        return o.getContext('2d').getImageData(0, 0, W, H).data
      }
      const same = (a, b) => { for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false; return true }
      const out = { hasAlpha: asset().code?.hasAlpha, w: W, h: H, moments: [] }
      for (const t of moments) {
        S.getState().setTime(t)
        const proj = S.getState().project
        const alone = { ...proj, tracks: [proj.tracks[1]], clips: { v: proj.clips.v } }
        // Settled: the engine has its paused frames (the film's exact frame,
        // the video's decoder frame) and two draws in a row are the same.
        // (Three draws in a row, 0.2 s apart: the decoder's sharp frame comes
        // 160 ms after the playhead stops.)
        let last = null
        let shown = null
        let alike = 0
        for (let i = 0; i < 60; i++) {
          await new Promise((res) => setTimeout(res, 200))
          const now = draw(proj)
          alike = last && same(last, now) && films.codeFilms.frameFor(proj.clips.k, asset(), t) ? alike + 1 : 0
          last = now
          if (alike >= 2) { shown = now; break }
        }
        if (!shown) return { error: `the preview did not settle at ${t} s` }
        const shownAlone = draw(alone)
        const written = await png(proj, t)
        const writtenAlone = await png(alone, t)
        // The film's own frame, drawn as the export draws it (its alpha).
        const ownBmp = await films.codeFilms.exactFrame(asset(), t)
        const own = rgba(ownBmp)
        ownBmp.close()
        const m = { t, max: 0, over2: 0, opaqueOver2: 0, beyondVideo: 0, videoMax: 0, clearPx: 0, partialPx: 0, clearDiff: 0 }
        for (let i = 0; i < shown.length; i += 4) {
          const a = own[i + 3]
          if (a === 0) m.clearPx++
          else if (a < 255) m.partialPx++
          for (let k = 0; k < 3; k++) {
            const d = Math.abs(shown[i + k] - written[i + k])
            const dv = Math.abs(shownAlone[i + k] - writtenAlone[i + k])
            if (d > m.max) m.max = d
            if (dv > m.videoMax) m.videoMax = dv
            if (d > 2) m.over2++
            if (a === 255 && d > 2) m.opaqueOver2++
            if (d > Math.ceil((1 - a / 255) * dv) + 2) m.beyondVideo++
            if (a === 0 && Math.abs(written[i + k] - writtenAlone[i + k]) > 2) m.clearDiff++
          }
        }
        out.moments.push(m)
      }
      return out
    }, under.id, join(TESTDATA, 'kod-klibi-saydam'), MOMENTS)
    if (r.error) throw new Error(r.error)
    console.log(`    ${under.name}: ` + r.moments.map((m) => `t=${m.t} max ${m.max} (video alone ${m.videoMax}) >2:${m.over2} beyond:${m.beyondVideo}`).join('; '))
    assert.equal(r.hasAlpha, true, 'the asset does not know it has alpha')
    for (const m of r.moments) {
      assert.ok(m.clearPx > 0.5 * r.w * r.h, `at ${m.t} s the page's frame is not transparent (${m.clearPx} clear pixels)`)
      assert.equal(m.clearDiff, 0, `at ${m.t} s the exported frame differs from the video alone where the page is transparent`)
      if (strict) assert.equal(m.over2, 0, `${under.name}, ${m.t} s: the preview differs from the export by more than 2 / 255 (max ${m.max}, ${m.over2} channels)`)
      else {
        assert.equal(m.opaqueOver2, 0, `${under.name}, ${m.t} s: where the clip is opaque the preview differs from the export by more than 2 / 255`)
        assert.equal(m.beyondVideo, 0, `${under.name}, ${m.t} s: the preview differs from the export by more than the video under it does (${m.beyondVideo} channels)`)
      }
    }
  }
}
