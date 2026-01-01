// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// node scripts/qa/film-frames.mjs [--out=<dir>] [--compare=<dir>] [--films=a,b] [--gpu2d]
//
// Code films drawn at five moments each, the export's way (codeFilms.exactFrame,
// full size) and the preview's way (codeFilms.frameFor, paused: an exact ask
// on a fresh clip plan), plus the whole export frame (exportFramePng of a
// project the film's size). Phase 5 (FAZ5-PLAN.md): the fast-path films must
// draw the same pixels before and after the app's first script (guard.js), and
// the preview frame must equal the exported one.
//
//   --out=<dir>       writes <film>-<i>.png (the export frame) and frames.json
//   --compare=<dir>   compares every export frame with the one in <dir>
//                     (pixels that differ; 0 = identical)
//   --films=…         a subset of: kod-klibi, heavy, portrait (default all)
//   --gpu2d           the GPU 2D canvas (default: software, as the reference
//                     frames: --disable-accelerated-2d-canvas)
// Off-screen window, own profile (scripts/e2e/app.mjs), closed at the end.
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { launchApp } from '../e2e/app.mjs'
import { FILM, TESTDATA } from '../e2e/media.mjs'
import * as lib from '../e2e/lib.mjs'

const args = Object.fromEntries(process.argv.slice(2).map((a) => { const [k, v] = a.replace(/^--/, '').split('='); return [k, v ?? true] }))
const ALL = {
  'kod-klibi': { path: join(TESTDATA, 'kod-klibi'), times: [0.5, 3.2, 6, 9.7, 11.9] },
  heavy: { path: FILM.heavy, times: [5, 95.5, 200, 333.3, 470] },
  portrait: { path: FILM.portrait, times: [1, 10, 22.5, 35, 48] }
}
const names = args.films ? String(args.films).split(',') : Object.keys(ALL)
const films = names.map((n) => ({ name: n, ...ALL[n] }))
const outDir = args.out ? String(args.out) : null
const cmpDir = args.compare ? String(args.compare) : null
const base = cmpDir && existsSync(join(cmpDir, 'frames.json')) ? JSON.parse(readFileSync(join(cmpDir, 'frames.json'), 'utf8')) : null
const basePng = (name, i) => {
  const p = join(cmpDir, `${name}-${i}.png`)
  return existsSync(p) ? readFileSync(p).toString('base64') : null
}

const app = await launchApp({ agent: false, extraArgs: args.gpu2d ? [] : ['--disable-accelerated-2d-canvas'] })
const results = []
try {
  const c = app.cdp
  await lib.reset(c)
  for (const f of films) {
    const baseline = base ? f.times.map((_, i) => basePng(f.name, i)) : null
    const r = await c.run(async (film, baseline) => {
      const sha = async (buf) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', buf))].map((b) => b.toString(16).padStart(2, '0')).join('')
      const rgba = (img, w, h) => {
        const o = new OffscreenCanvas(w, h)
        const g = o.getContext('2d')
        g.drawImage(img, 0, 0)
        return g.getImageData(0, 0, w, h).data
      }
      const diff = (a, b) => {
        if (a.length !== b.length) return { px: -1, max: -1 }
        let px = 0
        let max = 0
        for (let i = 0; i < a.length; i += 4) {
          const d = Math.max(Math.abs(a[i] - b[i]), Math.abs(a[i + 1] - b[i + 1]), Math.abs(a[i + 2] - b[i + 2]), Math.abs(a[i + 3] - b[i + 3]))
          if (d) px++
          if (d > max) max = d
        }
        return { px, max }
      }
      const b64 = (u8) => {
        let s = ''
        for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode(...u8.subarray(i, i + 0x8000))
        return btoa(s)
      }
      const S = window.__store
      const ex = await window.__exporter()
      const [films, impMod] = await window.__codeFilm()
      const info = await window.api.codeFilm.register(film.path)
      if (!info) return { error: 'not registered' }
      const res = await impMod.codeFilmImport(info)
      const asset0 = res.assets.find((a) => a.kind === 'code')
      const [added] = S.getState().addAssets([asset0])
      const id = (added ?? asset0).id
      const wall0 = performance.now()
      films.codeFilms.ensure(S.getState().project.assets.find((a) => a.id === id))
      let st = null
      for (;;) {
        // (Asked for again and again, as the preview does while its clip is
        // near the playhead: an unused page is let go after 30 s.)
        films.codeFilms.ensure(S.getState().project.assets.find((a) => a.id === id))
        st = films.codeFilms.status(id)
        if (st && st.state !== 'booting') break
        if (performance.now() - wall0 > 180000) break
        await new Promise((r) => setTimeout(r, 50))
      }
      const bootWall = Math.round(performance.now() - wall0)
      if (!st || st.state !== 'ready') return { error: st?.error ?? 'not ready in 180 s', bootWall }
      // The bin's filmstrip asks the page for frames in the background
      // (media/codefilm.ts stripOf): waited for, so every run asks the page
      // the same things in the same order (a film may count its calls: the portrait film's
      // grain does).
      while (!S.getState().project.assets.find((x) => x.id === id)?.filmstrip && performance.now() - wall0 < 900000) await new Promise((r) => setTimeout(r, 100))
      const stripWall = Math.round(performance.now() - wall0)
      const a = S.getState().project.assets.find((x) => x.id === id)
      const W = st.width
      const H = st.height
      const out = { width: W, height: H, fps: st.fps, duration: st.duration, bootMs: st.bootMs, bootWall, stripWall, frames: [] }
      // Five clips of the film on a hidden track of the editor's project: the
      // preview's asks below are of clips the timeline holds (the engine lets
      // go of the frames of clips it does not hold) and the preview itself
      // never draws them (a hidden track), so the page is asked only what this
      // script asks.
      S.setState((s) => {
        const clips = { ...s.project.clips }
        const ids = film.times.map((_, i) => `pv-${film.name}-${i}`)
        ids.forEach((cid, i) => { clips[cid] = { id: cid, assetId: a.id, trackId: 'FFV', start: i * a.duration, inPoint: 0, duration: a.duration, transform: { x: 0, y: 0, scale: 1, rotation: 0 }, volume: 1 } })
        return { project: { ...s.project, clips, tracks: [...s.project.tracks, { id: 'FFV', kind: 'video', name: 'FFV', clipIds: ids, hidden: true }] } }
      })
      const proj = { version: 1, name: 'film-frames', settings: { width: W, height: H, fps: st.fps || 30 }, mode: 'frame', tracks: [{ id: 'V1', kind: 'video', name: 'V1', clipIds: ['f'] }], clips: { f: { id: 'f', assetId: a.id, trackId: 'V1', start: 0, inPoint: 0, duration: a.duration, transform: { x: W / 2, y: H / 2, scale: 1, rotation: 0 }, volume: 1 } }, assets: [a], captions: [], captionStyle: S.getState().project.captionStyle, transcription: { model: 'english', language: 'auto' }, snap: { enabled: true, distance: 12, snapEdges: true, snapCenters: true } }
      const exact = async (t) => {
        const t0 = performance.now()
        const bmp = await films.codeFilms.exactFrame(a, t)
        const ms = Math.round((performance.now() - t0) * 10) / 10
        const px = rgba(bmp, W, H)
        bmp.close()
        return { px, ms, drawMs: films.codeFilms.status(id)?.drawMs }
      }
      for (let i = 0; i < film.times.length; i++) {
        const t = Math.min(film.times[i], a.duration - 0.01)
        // 1. the export's ask
        const e1 = await exact(t)
        // 2. the preview's way: paused, a fresh clip asks for exactly t
        let pv = null
        const clip = S.getState().project.clips[`pv-${film.name}-${i}`]
        const p0 = performance.now()
        while (!pv && performance.now() - p0 < 60000) {
          pv = films.codeFilms.frameFor(clip, a, t)
          if (!pv) await new Promise((r) => setTimeout(r, 30))
        }
        const pvPx = pv ? rgba(pv, W, H) : null
        // 3. the whole export frame of a project the film's size
        const png = await ex.exportFramePng(proj, t, false, 'final')
        const full = await createImageBitmap(new Blob([png], { type: 'image/png' }))
        const fullPx = rgba(full, W, H)
        full.close()
        let fullMean = 0
        for (let k = 0; k < fullPx.length; k += 4 * 97) fullMean += fullPx[k] + fullPx[k + 1] + fullPx[k + 2]
        fullMean = Math.round(fullMean / (fullPx.length / (4 * 97)) / 3)
        // 4. the export's ask again: does the page itself draw t the same twice?
        const e2 = await exact(t)
        const o = new OffscreenCanvas(W, H)
        o.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(e1.px), W, H), 0, 0)
        const own = new Uint8Array(await (await o.convertToBlob({ type: 'image/png' })).arrayBuffer())
        let vsBase = null
        if (baseline && baseline[i]) {
          const bin = Uint8Array.from(atob(baseline[i]), (ch) => ch.charCodeAt(0))
          const bb = await createImageBitmap(new Blob([bin], { type: 'image/png' }))
          vsBase = diff(e1.px, rgba(bb, W, H))
          bb.close()
        }
        out.frames.push({ t, exactMs: e1.ms, drawMs: e1.drawMs, sha: await sha(e1.px.buffer), again: diff(e1.px, e2.px), previewVsExport: pvPx ? diff(pvPx, e2.px) : null, fullVsExport: diff(fullPx, e2.px), fullMean, vsBase, png: b64(own) })
      }
      return out
    }, f, baseline)
    results.push({ film: f.name, ...r })
    const brief = r.frames ? r.frames.map((x) => `t=${x.t} draw=${x.drawMs}ms exact=${x.exactMs}ms again=${JSON.stringify(x.again)} pv=${JSON.stringify(x.previewVsExport)} full=${JSON.stringify(x.fullVsExport)}${x.fullVsExport.px ? ' fullMean=' + x.fullMean : ''}${x.vsBase ? ' base=' + JSON.stringify(x.vsBase) : ''}`).join('\n  ') : r.error
    console.log(`${f.name}: ${r.width ?? ''}x${r.height ?? ''} boot ${r.bootMs ?? '-'} ms (wall ${r.bootWall} ms, strip done ${r.stripWall} ms)\n  ${brief}`)
  }
} finally {
  const log = app.log()
  await app.close()
  const lines = log.split('\n').filter((l) => /snippfilm|Uncaught|error/i.test(l)).slice(-60)
  if (outDir) {
    mkdirSync(outDir, { recursive: true })
    for (const r of results) for (const [i, fr] of (r.frames ?? []).entries()) {
      writeFileSync(join(outDir, `${r.film}-${i}.png`), Buffer.from(fr.png, 'base64'))
      delete fr.png
    }
    writeFileSync(join(outDir, 'frames.json'), JSON.stringify({ at: new Date().toISOString(), gpu2d: !!args.gpu2d, results, log: lines }, null, 1))
  }
  // A difference the page itself makes (the same ask twice differs: `again`)
  // is the film's; preview or export differing from a page that draws t the
  // same twice is the app's.
  const appDiff = (x) => x.again.px === 0 && ((x.previewVsExport && x.previewVsExport.px !== 0) || x.fullVsExport.px !== 0)
  const bad = results.filter((r) => r.error || r.frames?.some((x) => (x.vsBase && x.vsBase.px !== 0) || appDiff(x)))
  if (lines.length) console.log('app log (film lines):\n' + lines.slice(-20).join('\n'))
  console.log(bad.length ? `DIFFERENCES in: ${bad.map((r) => r.film).join(', ')}` : 'all frames equal')
  process.exitCode = bad.length ? 1 : 0
}
