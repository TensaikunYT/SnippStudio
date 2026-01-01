// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// node scripts/qa/film-speed.mjs <film folder> [--acc=<label>] [--stack=<folder>,<folder>] [--play=10] [--export=10] [--at=<s>]
//
// Phase 5a's speed facts of a code film (FAZ5-PLAN.md U3, U4, U6), in the
// app's normal setup (GPU 2D canvas), off-screen, own profile:
//   boot (the page's own and the wall time), exactFrame at full size and at
//   1280 wide (median of 10, moving on the film's grid), the page's draw ms;
//   the preview playing `play` s (distinct preview pictures per second, the
//   page's frames per second);
//   an export of `export` s at the film's size and 60 fps (frames per second);
//   with --stack: those films on tracks above it, all playing (U6), then each
//   film's state and a fresh frame (not black), and WebGL context losses from
//   the app log.
// Take it only on a quiet machine (no mutation run, no other e2e).
import { resolve } from 'node:path'
import { launchApp } from '../e2e/app.mjs'
import * as lib from '../e2e/lib.mjs'

const args = Object.fromEntries(process.argv.slice(3).map((a) => { const [k, v] = a.replace(/^--/, '').split('='); return [k, v ?? true] }))
const folder = resolve(process.argv[2])
const stack = args.stack ? String(args.stack).split(',').map((p) => resolve(p)) : []
const PLAY = Number(args.play ?? 10)
const EXPORT = Number(args.export ?? 10)
const AT = Number(args.at ?? 20)

const app = await launchApp({ agent: false })
const c = app.cdp
try {
  await lib.reset(c)
  const r = await c.run(async (folders, PLAY, EXPORT, AT) => {
    const S = window.__store
    const [films, imp] = await window.__codeFilm()
    const ex = await window.__exporter()
    const med = (a) => { const s = [...a].sort((x, y) => x - y); return Math.round(s[s.length >> 1] * 10) / 10 }
    const assets = []
    for (const f of folders) {
      const info = await window.api.codeFilm.register(f)
      const a0 = (await imp.codeFilmImport(info)).assets.find((a) => a.kind === 'code')
      const [a] = S.getState().addAssets([a0])
      assets.push(a)
    }
    const out = { films: [] }
    for (const a0 of assets) {
      const t0 = performance.now()
      let st
      for (;;) {
        films.codeFilms.ensure(S.getState().project.assets.find((x) => x.id === a0.id))
        st = films.codeFilms.status(a0.id)
        if (st && st.state !== 'booting') break
        await new Promise((r) => setTimeout(r, 50))
      }
      out.films.push({ name: a0.name, state: st.state, error: st.error, bootMs: st.bootMs, bootWall: Math.round(performance.now() - t0), w: st.width, h: st.height, fps: st.fps })
    }
    if (out.films.some((f) => f.state !== 'ready')) return out
    // The bin's strip of each film first (it asks the pages in the background).
    const t1 = performance.now()
    while (assets.some((a) => !S.getState().project.assets.find((x) => x.id === a.id)?.filmstrip) && performance.now() - t1 < 600000) await new Promise((r) => setTimeout(r, 200))
    const main = S.getState().project.assets.find((x) => x.id === assets[0].id)
    const st = films.codeFilms.status(main.id)
    const fps = st.fps || 60
    // exactFrame at full size and at 1280 wide (U4); the page's draw ms (U3).
    for (const width of [undefined, 1280]) {
      const ms = []
      const draw = []
      for (let i = 0; i < 11; i++) {
        const t = AT + i / fps
        const a = performance.now()
        const b = await films.codeFilms.exactFrame(main, t, undefined, width)
        if (i) ms.push(performance.now() - a)
        if (i) draw.push(films.codeFilms.status(main.id).drawMs)
        b.close()
      }
      out[width ? 'exact1280' : 'exactFull'] = { median: med(ms), max: Math.round(Math.max(...ms)), drawMedian: med(draw) }
    }
    // A project: the films stacked, each a full-frame clip from 0.
    const W = st.width, H = st.height
    const tracks = [], clips = {}
    assets.forEach((a0, i) => {
      const a = S.getState().project.assets.find((x) => x.id === a0.id)
      const id = 'c' + i
      tracks.unshift({ id: 'V' + i, kind: 'video', name: 'V' + i, clipIds: [id] })
      clips[id] = { id, assetId: a.id, trackId: 'V' + i, start: 0, inPoint: 0, duration: Math.min(a.duration, AT + Math.max(PLAY, EXPORT) + 5), transform: { x: W / 2, y: H / 2, scale: 1, rotation: 0 }, volume: 1, ...(i ? { opacity: 0.5 } : {}) }
    })
    const proj = { ...structuredClone(S.getState().project), settings: { ...S.getState().project.settings, width: W, height: H, fps: 60 }, tracks, clips, assets: S.getState().project.assets }
    S.getState().loadProject(proj)
    await new Promise((r) => setTimeout(r, 1000))
    // Playing (U3, U6): distinct preview pictures per second.
    if (PLAY > 0) {
      S.getState().setTime(AT)
      await new Promise((r) => setTimeout(r, 1500))
      const cv = document.querySelector('[data-testid="preview.canvas"]')
      const o = new OffscreenCanvas(32, 18)
      const g = o.getContext('2d', { willReadFrequently: true })
      let last = '', changes = 0, ticks = 0
      const drawBefore = films.codeFilms.status(main.id).drawMs
      S.getState().setPlaying(true)
      const p0 = performance.now()
      while (performance.now() - p0 < PLAY * 1000) {
        await new Promise((r) => requestAnimationFrame(r))
        g.drawImage(cv, 0, 0, 32, 18)
        const sig = String(g.getImageData(0, 0, 32, 18).data)
        ticks++
        if (sig !== last) { changes++; last = sig }
      }
      S.getState().setPlaying(false)
      out.play = { seconds: PLAY, previewPicturesPerSec: Math.round((changes / PLAY) * 10) / 10, rafPerSec: Math.round(ticks / PLAY), drawMs: [drawBefore, films.codeFilms.status(main.id).drawMs] }
      out.afterPlay = []
      for (const a of assets) {
        const s2 = films.codeFilms.status(a.id)
        let mean = null
        let askError
        if (s2?.state === 'ready') {
          const b = await films.codeFilms.exactFrame(S.getState().project.assets.find((x) => x.id === a.id), AT + PLAY / 2, undefined, 320).catch((e) => { askError = String(e?.message ?? e).slice(0, 300); return null })
          if (!b) { out.afterPlay.push({ name: a.name, state: s2?.state, askError }); continue }
          const q = new OffscreenCanvas(b.width, b.height).getContext('2d')
          q.drawImage(b, 0, 0)
          const d = q.getImageData(0, 0, b.width, b.height).data
          let s = 0
          for (let k = 0; k < d.length; k += 4) s += d[k] + d[k + 1] + d[k + 2]
          mean = Math.round(s / (d.length / 4) / 3)
          b.close()
        }
        out.afterPlay.push({ name: a.name, state: s2?.state, error: s2?.error, meanLevel: mean })
      }
    }
    // Export (U3): EXPORT s at the film's size, 60 fps.
    if (EXPORT > 0) {
      const e0 = performance.now()
      try {
        await ex.exportProjectMp4(S.getState().project, { onProgress() {}, settings: { container: 'mp4', resolutionScale: 1, fps: 60, bitrateFactor: 0.12, target: 'landscape', normalize: false, range: [AT, AT + EXPORT] } })
        out.export = { seconds: EXPORT, fps: Math.round(((EXPORT * 60) / ((performance.now() - e0) / 1000)) * 10) / 10 }
      } catch (e) {
        out.export = { seconds: EXPORT, error: String(e?.message ?? e).slice(0, 300) }
      }
    }
    out.live = films.codeFilms.livePages().length
    return out
  }, [folder, ...stack], PLAY, EXPORT, AT)
  const log = app.log()
  r.contextLost = (log.match(/context lost|CONTEXT_LOST|webglcontextlost/gi) ?? []).length
  console.log(JSON.stringify(r, null, 1))
} finally {
  await app.close()
}
