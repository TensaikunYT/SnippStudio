// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// 5a/5b patch, small item S-9 (haritalar\_faz5-denetim-saydamlik.md no. 9): a
// code film's hasAlpha came only from its filmstrip, and the strip waits while
// an export runs; an export started before the strip was done drew a look on a
// transparent film the old way, and its vignette and fade darkened the video
// under the film's clear parts. Now the export's start (codeFilms.ready) works
// the film's alpha out itself when nothing knows it yet. The transparent 2D
// test page (film-alpha), a look on it, over the 1080 talk video; its alpha
// not known (as right after import); the export's own start, then one frame.
export const name = 'alpha-export-early'
export const timeoutMs = 120_000
import { join } from 'node:path'
import { APP_DIR } from '../app.mjs'

export async function run({ c, app, media, lib }) {
  const { assert } = lib
  const [talk] = await lib.seedAssets(app, c, [media.talk1080])
  const r = await c.run(async (folder, talkId) => {
    const S = window.__store
    const [films, imp] = await window.__codeFilm()
    const ex = await window.__exporter()
    const info = await window.api.codeFilm.register(folder)
    const a = (await imp.codeFilmImport(info)).assets.find((x) => x.kind === 'code')
    a.id = 'fa'
    delete a.code.hasAlpha
    const p = structuredClone(S.getState().project)
    const W = p.settings.width
    const H = p.settings.height
    p.assets.push(a)
    const look = { grain: 0, weave: 0, halation: 0, fade: 0.6, flicker: 0, dust: 0, mono: 0, vignette: 0.9, vShape: 'round', vMotion: 'still', vSpeed: 1, bars: 0, gate: 0 }
    p.tracks = [{ id: 'V2', kind: 'video', name: 'V2', clipIds: ['k'] }, { id: 'V1', kind: 'video', name: 'V1', clipIds: ['v'] }, { id: 'A1', kind: 'audio', name: 'A1', clipIds: [] }]
    p.clips = {
      v: { id: 'v', assetId: talkId, trackId: 'V1', start: 0, inPoint: 0, duration: 10, transform: { x: W / 2, y: H / 2, scale: 1, rotation: 0 }, volume: 1 },
      k: { id: 'k', assetId: 'fa', trackId: 'V2', start: 0, inPoint: 0, duration: 10, transform: { x: W / 2, y: H / 2, scale: W / 1280, rotation: 0 }, volume: 1, look }
    }
    // The export starts at once (before any strip): its lock first, as an export's.
    films.codeFilms.lockForExport(true)
    try {
      S.getState().loadProject(p)
      const proj = S.getState().project
      await ex.mediaReady(proj, [0, 10])
      const rgba = async (pr) => { const b = await createImageBitmap(new Blob([await ex.exportFramePng(pr, 3, false, 'final')], { type: 'image/png' })); const o = new OffscreenCanvas(W, H); const g = o.getContext('2d'); g.drawImage(b, 0, 0, W, H); return g.getImageData(0, 0, W, H).data }
      const withFilm = await rgba(S.getState().project)
      const alone = await rgba({ ...proj, tracks: [proj.tracks[1], proj.tracks[2]], clips: { v: proj.clips.v } })
      // The top-left corner: the film's page is clear there (its drawing is in the middle).
      let mx = 0
      for (let y = 4; y < H * 0.12; y += 3) for (let x = 4; x < W * 0.12; x += 3) { const i = (y * W + x) * 4; for (let ch = 0; ch < 3; ch++) mx = Math.max(mx, Math.abs(withFilm[i + ch] - alone[i + ch])) }
      return { cornerMax: mx, hasAlpha: S.getState().project.assets.find((x) => x.id === 'fa').code?.hasAlpha ?? null }
    } finally {
      films.codeFilms.lockForExport(false)
    }
  }, join(APP_DIR, 'scripts', 'qa', 'reference', 'film-alpha'), talk.id)
  console.log('     export before the strip:', JSON.stringify(r))
  assert.ok(r.cornerMax <= 2, `the look stayed off the video under the film's clear corner (max ${r.cornerMax})`)
  assert.equal(r.hasAlpha, true, 'the film\'s alpha is known after the export\'s start')
}
