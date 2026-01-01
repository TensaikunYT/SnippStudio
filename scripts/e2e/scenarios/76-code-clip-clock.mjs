// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// Phase 5c, done measure (FAZ5-PLAN.md "5c", tarifler\FAZ5.md 5c): pages
// written as one writes for a browser, with nothing for the app in them
// (testdata\kod-klibi-serbest\F1, F3, F4), play on the app's clock:
//  - F1 (canvas, requestAnimationFrame + performance.now + Math.random +
//    setTimeout): two fresh loads give the same frame at 3 moments;
//  - F1, F3 (three.js setAnimationLoop + Clock + AnimationMixer, a cube
//    turned on every frame), F4 (a paused GSAP timeline in __timelines):
//    a moment reached (a) by playing from the start in the preview, (b) by
//    scrubbing about, (c) by loading the page again is the same frame
//    (≤ 0.5 % of the pixels differ by more than 28 / 255);
//  - at 6 moments the exported frame (exportFramePng, a second pass) is the
//    paused preview's frame (renderFrame at scale 1), within the same margin;
//  - F3's copy that loads three.js from a CDN address plays (no network);
//  - going back to 30 s in F3 is timed;
//  - a page that shows HTML text is refused by name (tier 3 is phase 5d's).
import { join } from 'node:path'
import { mkdirSync, writeFileSync } from 'node:fs'
import { TESTDATA } from '../media.mjs'

export const name = 'code-clip-clock'
export const timeoutMs = 600_000

const FREE = join(TESTDATA, 'kod-klibi-serbest')

/** In the page: helpers the per-page runs share (installed once). */
async function install(c) {
  await c.run(() => {
    if (window.__c5) return true
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
    const rgba = (src, w, h) => {
      const o = new OffscreenCanvas(w, h)
      const g = o.getContext('2d')
      g.drawImage(src, 0, 0, w, h)
      return g.getImageData(0, 0, w, h).data
    }
    // (≤ 0.5 % of the pixels differ by > 28 / 255 in a channel.)
    const cmp = (a, b) => {
      if (!a || !b || a.length !== b.length) return { same: false, bad: -1, max: -1, exact: false }
      let bad = 0
      let max = 0
      let exact = true
      for (let i = 0; i < a.length; i += 4) {
        let m = 0
        for (let k = 0; k < 4; k++) {
          const d = Math.abs(a[i + k] - b[i + k])
          if (d > m) m = d
        }
        if (m) exact = false
        if (m > max) max = m
        if (m > 28) bad++
      }
      return { same: bad <= (a.length / 4) * 0.005, bad, badPct: Math.round((bad / (a.length / 4)) * 10000) / 100, max, exact }
    }
    const digest = (d) => {
      let h = 2166136261
      for (let i = 0; i < d.length; i += 7) h = Math.imul(h ^ d[i], 16777619) >>> 0
      return h.toString(16)
    }
    window.__c5 = { sleep, rgba, cmp, digest }
    return true
  })
}

/** Imports the page at `folder`, waits until it runs; answers its asset id. */
async function load(c, folder, duration) {
  return c.run(async (folder, duration) => {
    const { sleep } = window.__c5
    const S = window.__store
    const [films, imp] = await window.__codeFilm()
    const info = await window.api.codeFilm.register(folder)
    const a0 = (await imp.codeFilmImport(info)).assets.find((a) => a.kind === 'code')
    if (duration) a0.duration = duration
    const [a] = S.getState().addAssets([a0])
    const id = (a ?? a0).id
    const asset = () => S.getState().project.assets.find((x) => x.id === id)
    const t0 = performance.now()
    films.codeFilms.ensure(asset())
    while (performance.now() - t0 < 150000) {
      const st = films.codeFilms.status(id)
      if (st?.state === 'ready' || st?.state === 'error') break
      films.codeFilms.ensure(asset())
      await sleep(50)
    }
    // (The bin's strip asks its frames first; let it finish.)
    while (!asset().filmstrip && performance.now() - t0 < 200000 && films.codeFilms.status(id)?.state === 'ready') await sleep(100)
    const st = films.codeFilms.status(id)
    return { id, ms: Math.round(performance.now() - t0), status: st ? { ...st } : null, asset: { width: asset().width, height: asset().height, duration: asset().duration, mode: asset().code?.mode } }
  }, folder, duration)
}

/** Restarts a film's page (as when it is reloaded) and waits until it runs. */
const RELOAD = async (films, id, asset, sleep) => {
  films.codeFilms.reload(id)
  const t0 = performance.now()
  while (performance.now() - t0 < 150000) {
    films.codeFilms.ensure(asset())
    const st = films.codeFilms.status(id)
    if (st?.state === 'ready' || st?.state === 'error') break
    await sleep(50)
  }
  return Math.round(performance.now() - t0)
}

/** (a) / (b) / (c) at moment T, and the six preview / export moments. */
async function measure(c, id, T, moments) {
  return c.run(async (id, T, moments, reloadSrc) => {
    const { sleep, rgba, cmp } = window.__c5
    const reload = eval('(' + reloadSrc + ')')
    const S = window.__store
    const ex = await window.__exporter()
    const R = await window.__render()
    const [films] = await window.__codeFilm()
    const asset = () => S.getState().project.assets.find((x) => x.id === id)
    const A = asset()
    const W = A.width
    const H = A.height
    const out = { T, W, H }
    // A project of the film's own size with only the clip, at scale 1.
    const p = structuredClone(S.getState().project)
    p.settings = { ...p.settings, width: W, height: H }
    p.tracks = [{ id: 'V1', kind: 'video', name: 'V1', clipIds: ['k'] }, { id: 'A1', kind: 'audio', name: 'A1', clipIds: [] }]
    p.clips = { k: { id: 'k', assetId: id, trackId: 'V1', start: 0, inPoint: 0, duration: A.duration, transform: { x: W / 2, y: H / 2, scale: 1, rotation: 0 }, volume: 1 } }
    p.captions = []
    S.getState().loadProject(p)
    S.setState({ selectedClipIds: [], playing: false })
    const proj = () => S.getState().project
    const settledPreview = async (t) => {
      S.getState().setTime(t)
      const same = (a, b) => { for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false; return true }
      let last = null
      let alike = 0
      for (let i = 0; i < 300; i++) {
        await sleep(100)
        const o = new OffscreenCanvas(W, H)
        R.renderFrame(o.getContext('2d'), proj(), S.getState().currentTime, window.__engine.resolve, { scale: 1, quality: 'refine' })
        const now = o.getContext('2d').getImageData(0, 0, W, H).data
        // (Its frame of exactly t has come: the preview shows the nearest one meanwhile.)
        const ready = films.codeFilms.status(id)?.state === 'ready' && films.codeFilms.heldTimes(id, 'k').some((x) => Math.abs(x - t) < 1e-6)
        alike = ready && last && same(last, now) ? alike + 1 : 0
        last = now
        if (alike >= 3) return now
      }
      return null
    }
    const exact = async (t) => {
      const b = await films.codeFilms.exactFrame(asset(), t)
      const d = rgba(b, W, H)
      b.close()
      return d
    }
    // (a) playing from the start in the preview, then paused at T (stopped
    // a second before it: the frames asked ahead stay before T).
    await reload(films, id, asset, sleep)
    S.getState().setTime(0)
    await sleep(300)
    const tp = performance.now()
    S.getState().setPlaying(true)
    while (S.getState().currentTime < T - 1 && performance.now() - tp < 120000) await sleep(20)
    S.getState().setPlaying(false)
    out.playedTo = Math.round(S.getState().currentTime * 1000) / 1000
    const a = await settledPreview(T)
    // (b) scrubbing about: ahead, back, off the frame grid, then T.
    for (const s of [T + 2.3, T - 1.7, T + 0.37, Math.max(0, T - 0.51)]) await exact(s)
    const b = await exact(T)
    // (c) the page loaded again, T asked at once.
    out.reloadMs = await reload(films, id, asset, sleep)
    const cc = await exact(T)
    out.ab = cmp(a, b)
    out.ac = cmp(a, cc)
    out.bc = cmp(b, cc)
    out.status = { ...films.codeFilms.status(id) }
    // Six moments: the paused preview's frame, then (a second pass, as an
    // export runs from its start) the exported frame.
    const shown = []
    for (const t of moments) shown.push(await settledPreview(t))
    const written = []
    for (const t of moments) written.push(rgba(await createImageBitmap(new Blob([await ex.exportFramePng(proj(), t, false, 'final')], { type: 'image/png' })), W, H))
    // (Which side is off, when they differ: the film's own frame of t.)
    const own = []
    for (const t of moments) own.push(await exact(t))
    out.moments = moments.map((t, i) => ({ t, ...cmp(shown[i], written[i]), vsOwn: [cmp(shown[i], own[i]).badPct, cmp(written[i], own[i]).badPct] }))
    out.blank = (() => {
      // The page drew something (not one colour) at T.
      const d = cc
      let differ = 0
      for (let i = 4; i < d.length; i += 4) if (d[i] !== d[0] || d[i + 1] !== d[1] || d[i + 2] !== d[2]) differ++
      return differ < 100
    })()
    return out
  }, id, T, moments, RELOAD.toString())
}

export async function run({ c, lib, work }) {
  const { assert } = lib
  await install(c)
  const fail = []
  const check = (ok, msg) => {
    if (!ok) fail.push(msg)
  }

  // ---- F1: the app's clock, two fresh loads ------------------------------
  const f1 = await load(c, join(FREE, 'F1-tuval'))
  console.log('     F1 load:', JSON.stringify(f1))
  assert.equal(f1.status?.state, 'ready', `F1 did not start: ${f1.status?.error}`)
  assert.equal(f1.status.mode, 'canvas')
  assert.equal(f1.asset.mode, 'canvas', 'the way it plays is kept in the asset')
  assert.equal(f1.asset.width, 960, 'size from its biggest canvas')
  assert.equal(f1.asset.height, 540)
  assert.equal(f1.asset.duration, 10, 'a page that says no length: the clip length (a dropped folder: 10 s)')
  const twice = await c.run(async (id, reloadSrc) => {
    const { sleep, rgba, digest } = window.__c5
    const reload = eval('(' + reloadSrc + ')')
    const S = window.__store
    const [films] = await window.__codeFilm()
    const asset = () => S.getState().project.assets.find((x) => x.id === id)
    const run = async () => {
      await reload(films, id, asset, sleep)
      const out = []
      for (const t of [1.5, 4, 7.25]) {
        const b = await films.codeFilms.exactFrame(asset(), t)
        out.push(digest(rgba(b, b.width, b.height)))
        b.close()
      }
      return out
    }
    return { one: await run(), two: await run(), pure: films.codeFilms.status(id)?.pure }
  }, f1.id, RELOAD.toString())
  console.log('     F1 two loads:', JSON.stringify(twice))
  assert.deepEqual(twice.one, twice.two, 'F1: two fresh loads draw the same frames')
  assert.equal(new Set(twice.one).size, 3, 'F1: three different moments')
  assert.equal(twice.pure, false, 'F1 keeps state from frame to frame (not pure in time)')

  // ---- F1, F3, F4: (a) / (b) / (c) and preview = export -------------------
  const f3 = await load(c, join(FREE, 'F3-three'), 40)
  console.log('     F3 load:', JSON.stringify(f3))
  assert.equal(f3.status?.state, 'ready', `F3 did not start: ${f3.status?.error}`)
  const f4 = await load(c, join(FREE, 'F4-gsap'))
  console.log('     F4 load:', JSON.stringify(f4))
  assert.equal(f4.status?.state, 'ready', `F4 did not start: ${f4.status?.error}`)
  assert.equal(f4.asset.duration, 8, 'F4: its GSAP timeline gives its length')
  // (5c + 5d audit patch, S-1: a page with GSAP is never taken for pure in
  // time: GSAP's own ticker may run tweens of its own. F4 is stepped.)
  assert.equal(f4.status.pure, false, 'F4 (a page with GSAP) is not taken for pure in time')
  const rows = []
  for (const [nm, f, T, moments] of [
    ['F1', f1, 3, [0.5, 1.25, 2.0, 3.5, 5.75, 8.0]],
    ['F3', f3, 5, [0.5, 1.25, 2.0, 3.5, 5.75, 8.0]],
    ['F4', f4, 4, [0.4, 1.0, 2.5, 4.2, 6.6, 7.9]]
  ]) {
    const r = await measure(c, f.id, T, moments)
    rows.push([nm, r])
    console.log(`     ${nm} T=${T}: played to ${r.playedTo}; a-b ${JSON.stringify(r.ab)} a-c ${JSON.stringify(r.ac)} b-c ${JSON.stringify(r.bc)}; reload ${r.reloadMs} ms; pure ${r.status.pure}`)
    console.log(`     ${nm} preview vs export: ` + r.moments.map((m) => `${m.t}s ${m.badPct}% max ${m.max}${m.exact ? ' exact' : ''} (own ${m.vsOwn.join('/')})`).join('; '))
    check(!r.blank, `${nm}: the frame at ${T} s is one colour`)
    check(r.ab.same, `${nm}: (a) played vs (b) scrubbed differ (${r.ab.badPct} %, max ${r.ab.max})`)
    check(r.ac.same, `${nm}: (a) played vs (c) reloaded differ (${r.ac.badPct} %, max ${r.ac.max})`)
    check(r.bc.same, `${nm}: (b) scrubbed vs (c) reloaded differ (${r.bc.badPct} %, max ${r.bc.max})`)
    for (const m of r.moments) check(m.same, `${nm}: preview vs export at ${m.t} s differ (${m.badPct} %, max ${m.max})`)
  }

  // ---- F3: back to 30 s; its CDN copy -----------------------------------
  const back = await c.run(async (id) => {
    const S = window.__store
    const [films] = await window.__codeFilm()
    const asset = () => S.getState().project.assets.find((x) => x.id === id)
    ;(await films.codeFilms.exactFrame(asset(), 35)).close()
    const t0 = performance.now()
    ;(await films.codeFilms.exactFrame(asset(), 30)).close()
    const backMs = Math.round(performance.now() - t0)
    const t1 = performance.now()
    ;(await films.codeFilms.exactFrame(asset(), 30 + 1 / 60)).close()
    return { backMs, nextMs: Math.round(performance.now() - t1), pure: films.codeFilms.status(id)?.pure }
  }, f3.id)
  console.log('     F3 back to 30 s:', JSON.stringify(back))
  const cdn = await load(c, join(FREE, 'F3-three-cdn'), 40)
  console.log('     F3 from a CDN address:', JSON.stringify(cdn))
  assert.equal(cdn.status?.state, 'ready', `F3's CDN copy did not start: ${cdn.status?.error}`)
  const cdnR = await c.run(async (idL, idC) => {
    const { rgba, cmp } = window.__c5
    const S = window.__store
    const [films] = await window.__codeFilm()
    const a = (id) => S.getState().project.assets.find((x) => x.id === id)
    const fr = async (id) => { const b = await films.codeFilms.exactFrame(a(id), 2); const d = rgba(b, b.width, b.height); b.close(); return d }
    const local = await fr(idL)
    const remote = await fr(idC)
    const diag = await films.codeFilms.diag(idC)
    return { cmp: cmp(local, remote), blocked: diag?.blocked ?? null, failed: diag?.failed ?? null, errors: diag?.errors ?? null }
  }, f3.id, cdn.id)
  console.log('     F3 CDN vs local at 2 s:', JSON.stringify(cdnR))
  check(cdnR.cmp.same, `F3's CDN copy draws differently from the local one at 2 s (${cdnR.cmp.badPct} %)`)
  check(cdnR.blocked && cdnR.blocked.length === 0, `F3's CDN copy had addresses blocked: ${JSON.stringify(cdnR.blocked)}`)

  // ---- a page that shows HTML: drawn whole by a window of its own (5d.1) ---
  const dir = join(work, 'html-page')
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'index.html'), '<!doctype html><html><body style="margin:0;background:#000"><h1 style="color:#fff">Hello</h1><canvas width="320" height="180"></canvas><script>requestAnimationFrame(function f(){requestAnimationFrame(f)})</script></body></html>')
  const html = await load(c, dir)
  console.log('     HTML page:', JSON.stringify(html))
  assert.equal(html.status?.state, 'ready', JSON.stringify(html.status))
  assert.equal(html.status?.mode, 'page')
  assert.equal(html.asset.mode, 'page')

  // ---- another three.js version from a CDN: blocked, and named -------------
  const dir2 = join(work, 'three-160')
  mkdirSync(dir2, { recursive: true })
  writeFileSync(join(dir2, 'index.html'), '<!doctype html><html><head><script type="importmap">{"imports":{"three":"https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js"}}</script></head><body style="margin:0;background:#000"><script type="module">import * as THREE from "three"; const r = new THREE.WebGLRenderer(); r.setSize(320, 180); document.body.appendChild(r.domElement); r.setAnimationLoop(() => r.render(new THREE.Scene(), new THREE.PerspectiveCamera()))</script></body></html>')
  const old = await load(c, dir2)
  console.log('     three 0.160 from a CDN:', JSON.stringify(old))
  assert.equal(old.status?.state, 'error')
  assert.match(String(old.status?.error), /no canvas.*blocked: https:\/\/cdn\.jsdelivr\.net\/npm\/three@0\.160\.0/)

  if (fail.length) throw new Error(fail.join('\n'))
}
