// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// Phase 5d.2, done measure (FAZ5-PLAN.md "5d.2", tarifler\FAZ5.md 5d.2):
// pages written as one writes for a browser, nothing of the app in them
// (testdata\kod-klibi-serbest\F1–F4), all four laid as clips in ONE project
// (ANA-PLAN's "pages with nothing app-specific" measure), and F2's
// acceptance (HTML text, an SVG icon, CSS keyframes, one CSS transition,
// GSAP tweens that play by themselves, a transparent body; drawn by a window
// of its own, tier 3):
//  - it plays (pictures while the preview plays) and is sought;
//  - the moment T (the transition and a GSAP tween in flight) reached (a) by
//    playing from the start, (b) by scrubbing about, (c) by loading the page
//    again is the same frame (≤ 0.5 % of the pixels beyond 28 / 255);
//  - 6 exported frames = the paused preview's;
//  - over the talk video, transparent: where the page is clear the exported
//    frame is the video;
//  - a page with SVG <animate>, a Web Animation and a playing <video> (tier
//    3): (a) / (b) / (c) the same frame, the video at its moment;
//  - a page whose CSS transition starts from a network answer is "unstable"
//    (its chip in the bin); a page that cannot draw 24 frames a second is
//    "slow" (its chip);
//  - three tier 3 clips playing together: the editor's median frame draw;
//  - frames a second while playing, per page kind (the table in the plan).
import { cpSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { TESTDATA } from '../media.mjs'

export const name = 'code-clip-free-pages'
export const timeoutMs = 600_000

const FREE = join(TESTDATA, 'kod-klibi-serbest')

// SMIL, a Web Animation and a playing video, nothing of the app in it.
const MEDIA_PAGE = `<!doctype html><html><head><meta charset="utf-8"><style>
html,body{margin:0;overflow:hidden;background:transparent}
video{position:absolute;left:40px;top:40px;width:640px;height:360px}
#w{position:absolute;left:760px;top:60px;width:160px;height:160px;background:#ffb347;border-radius:24px}
svg{position:absolute;left:760px;top:300px}
</style></head><body>
<video id="v" src="clip.mp4" muted playsinline></video>
<div id="w"></div>
<svg width="600" height="200"><rect x="0" y="40" width="80" height="80" fill="#3ddc97"><animate attributeName="x" from="0" to="500" dur="4s" repeatCount="indefinite"/></rect>
<circle cx="100" cy="170" r="20" fill="#7aa2ff"><animate attributeName="r" values="10;28;10" dur="1.5s" repeatCount="indefinite"/></circle></svg>
<script>
document.getElementById('w').animate([{ transform: 'translateX(0) rotate(0deg)' }, { transform: 'translateX(700px) rotate(270deg)' }], { duration: 5000, iterations: Infinity, direction: 'alternate', easing: 'ease-in-out' })
setTimeout(function () { document.getElementById('v').play() }, 500)
</script></body></html>`

// A transition that starts when a file has been read (a network answer: the
// app's clock does not drive it). Its birth depends on when it was seen.
const UNSTEADY_PAGE = `<!doctype html><html><head><meta charset="utf-8"><style>
html,body{margin:0;overflow:hidden;background:#101418}
#b{position:absolute;left:100px;top:200px;width:200px;height:200px;background:#ff6b5a;transition:transform 2s linear}
#b.on{transform:translateX(900px)}
h1{color:#fff;font:700 60px Arial,sans-serif;margin:40px}
</style></head><body><h1>unsteady</h1><div id="b"></div><script>
setTimeout(function () { fetch('data.json').then(function (r) { return r.json() }).then(function () { document.getElementById('b').className = 'on' }) }, 1000)
</script></body></html>`

// A canvas page that cannot keep up: heavy sums in each frame (counted
// work, not a clock: the page's clock stands still meanwhile).
const SLOW_PAGE = `<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;background:#000;overflow:hidden}</style></head><body>
<canvas id="c" width="640" height="360"></canvas><script>
const g = document.getElementById('c').getContext('2d')
const s = new Float64Array(1 << 16)
requestAnimationFrame(function f(t) {
  let x = 0
  for (let k = 0; k < 1200; k++) for (let i = 0; i < s.length; i++) x += Math.sqrt(i + k + s[i])
  g.fillStyle = '#123'; g.fillRect(0, 0, 640, 360)
  g.fillStyle = '#ffd166'; g.fillRect((t / 10) % 600, 150, 40, 40 + (x % 1))
  requestAnimationFrame(f)
})
</script></body></html>`

/** In the page: helpers the runs share (installed once). */
async function install(c) {
  await c.run(() => {
    if (window.__c52) return true
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
    const rgba = (src, w, h, ground) => {
      const o = new OffscreenCanvas(w, h)
      const g = o.getContext('2d')
      // (On black, as the preview and the export lay a see-through clip.)
      if (ground) {
        g.fillStyle = ground
        g.fillRect(0, 0, w, h)
      }
      g.drawImage(src, 0, 0, w, h)
      return g.getImageData(0, 0, w, h).data
    }
    const cmp = (a, b) => {
      if (!a || !b || a.length !== b.length) return { same: false, bad: -1, max: -1, exact: false }
      let bad = 0
      let max = 0
      for (let i = 0; i < a.length; i += 4) {
        let m = 0
        for (let k = 0; k < 4; k++) {
          const d = Math.abs(a[i + k] - b[i + k])
          if (d > m) m = d
        }
        if (m > max) max = m
        if (m > 28) bad++
      }
      return { same: bad <= (a.length / 4) * 0.005, bad, badPct: Math.round((bad / (a.length / 4)) * 10000) / 100, max, exact: max === 0 }
    }
    const reload = async (films, id, asset) => {
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
    window.__c52 = { sleep, rgba, cmp, reload }
    return true
  })
}

/** Imports the page at `folder` (duration: the clip's length when it says
 *  none), waits until it runs; answers its asset id. */
async function load(c, folder, duration) {
  return c.run(async (folder, duration) => {
    const { sleep } = window.__c52
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
    while (!asset().filmstrip && performance.now() - t0 < 200000 && films.codeFilms.status(id)?.state === 'ready') await sleep(100)
    const st = films.codeFilms.status(id)
    return { id, ms: Math.round(performance.now() - t0), status: st ? { ...st } : null, asset: { width: asset().width, height: asset().height, duration: asset().duration, mode: asset().code?.mode } }
  }, folder, duration)
}

/** (a) / (b) / (c) at moment T and preview = export at `moments`, in a
 *  project of the film's own size holding only its clip. */
async function measure(c, id, T, moments) {
  return c.run(async (id, T, moments) => {
    const { sleep, rgba, cmp, reload } = window.__c52
    const S = window.__store
    const ex = await window.__exporter()
    const R = await window.__render()
    const [films] = await window.__codeFilm()
    const asset = () => S.getState().project.assets.find((x) => x.id === id)
    const A = asset()
    const W = A.width
    const H = A.height
    const out = { T, W, H }
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
        const ready = films.codeFilms.status(id)?.state === 'ready' && films.codeFilms.heldTimes(id, 'k').some((x) => Math.abs(x - t) < 1e-6)
        alike = ready && last && same(last, now) ? alike + 1 : 0
        last = now
        if (alike >= 3) return now
      }
      return null
    }
    const raw = async (t) => {
      const b = await films.codeFilms.exactFrame(asset(), t)
      const d = rgba(b, W, H)
      b.close()
      return d
    }
    const exact = async (t) => {
      const b = await films.codeFilms.exactFrame(asset(), t)
      const d = rgba(b, W, H, '#000')
      b.close()
      return d
    }
    // (a) playing from the start, then paused at T.
    await reload(films, id, asset)
    S.getState().setTime(0)
    await sleep(300)
    const tp = performance.now()
    S.getState().setPlaying(true)
    while (S.getState().currentTime < T - 1 && performance.now() - tp < 120000) await sleep(20)
    S.getState().setPlaying(false)
    out.playedTo = Math.round(S.getState().currentTime * 1000) / 1000
    out.playFps = films.codeFilms.status(id)?.playFps ?? null
    const a = await settledPreview(T)
    // (b) scrubbing about: ahead, back, off the grid, then T.
    for (const s of [T + 2.3, T - 1.7, T + 0.37, Math.max(0, T - 0.51)]) await exact(s)
    const b = await exact(T)
    // (c) the page loaded again, T asked at once.
    out.reloadMs = await reload(films, id, asset)
    const cc = await exact(T)
    out.ab = cmp(a, b)
    out.ac = cmp(a, cc)
    out.bc = cmp(b, cc)
    out.status = { ...films.codeFilms.status(id) }
    const shown = []
    for (const t of moments) shown.push(await settledPreview(t))
    const written = []
    for (const t of moments) written.push(rgba(await createImageBitmap(new Blob([await ex.exportFramePng(proj(), t, false, 'final')], { type: 'image/png' })), W, H))
    out.moments = moments.map((t, i) => ({ t, ...cmp(shown[i], written[i]) }))
    // Not one colour, and see-through somewhere (its body is).
    const rc = await raw(T)
    let differ = 0
    let clear = 0
    for (let i = 0; i < rc.length; i += 4) {
      if (rc[i] !== rc[0] || rc[i + 1] !== rc[1] || rc[i + 2] !== rc[2] || rc[i + 3] !== rc[3]) differ++
      if (rc[i + 3] === 0) clear++
    }
    out.blank = differ < 100
    out.clearPct = Math.round((clear / (rc.length / 4)) * 1000) / 10
    // The same moment by two different ways also differs from another moment
    // (it moves at all).
    out.moves = !cmp(cc, await exact(T + 0.5)).exact
    return out
  }, id, T, moments)
}

export async function run({ c, app, media, lib, work }) {
  const { assert } = lib
  await c.run(() => window.api.testFilmProbe({ kind: 'mute', on: true }))
  await install(c)
  const fail = []
  const check = (ok, msg) => {
    if (!ok) fail.push(msg)
  }
  const table = {}

  // ---- F2: start, (a) / (b) / (c), preview = export -------------------------
  const f2 = await load(c, join(FREE, 'F2-html'), 8)
  console.log('     F2 load:', JSON.stringify(f2))
  assert.equal(f2.status?.state, 'ready', `F2 did not start: ${f2.status?.error}`)
  assert.equal(f2.status.mode, 'page', 'F2 is a whole page (tier 3)')
  const r2 = await measure(c, f2.id, 2.75, [0.3, 1.0, 2.25, 2.9, 4.4, 5.6])
  console.log(`     F2 T=2.75: played to ${r2.playedTo} (${r2.playFps} pictures/s); a-b ${JSON.stringify(r2.ab)} a-c ${JSON.stringify(r2.ac)} b-c ${JSON.stringify(r2.bc)}; reload ${r2.reloadMs} ms; clear ${r2.clearPct} %; unsteady ${r2.status.unsteady}`)
  console.log('     F2 preview vs export: ' + r2.moments.map((m) => `${m.t}s ${m.badPct}% max ${m.max}`).join('; '))
  check(!r2.blank && r2.moves, 'F2: its frame is one colour or does not move')
  check(r2.clearPct > 30, `F2: its body is not see-through (${r2.clearPct} % clear)`)
  check(r2.ab.same, `F2: (a) played vs (b) scrubbed differ (${r2.ab.badPct} %, max ${r2.ab.max})`)
  check(r2.ac.same, `F2: (a) played vs (c) reloaded differ (${r2.ac.badPct} %, max ${r2.ac.max})`)
  check(r2.bc.same, `F2: (b) scrubbed vs (c) reloaded differ (${r2.bc.badPct} %, max ${r2.bc.max})`)
  for (const m of r2.moments) check(m.same, `F2: preview vs export at ${m.t} s differ (${m.badPct} %, max ${m.max})`)
  check(!r2.status.unsteady, 'F2 (a timer starts its transition) was taken for unstable')
  table.F2 = { mode: 'page', ab: r2.ab, ac: r2.ac, bc: r2.bc, export: r2.moments.every((m) => m.same), exportMax: Math.max(...r2.moments.map((m) => m.max)) }

  // ---- F2 over the talk video: transparent ----------------------------------
  const [talk1080] = await lib.seedAssets(app, c, [media.talk1080])
  const over = await c.run(async (talkId, filmId, moments) => {
    const { sleep, rgba } = window.__c52
    const S = window.__store
    const ex = await window.__exporter()
    const R = await window.__render()
    const [films] = await window.__codeFilm()
    const asset = () => S.getState().project.assets.find((x) => x.id === filmId)
    const W = 1920
    const H = 1080
    const p = structuredClone(S.getState().project)
    p.settings = { ...p.settings, width: W, height: H }
    const tv = p.assets.find((a) => a.id === talkId)
    p.tracks = [{ id: 'V2', kind: 'video', name: 'V2', clipIds: ['k'] }, { id: 'V1', kind: 'video', name: 'V1', clipIds: ['v'] }, { id: 'A1', kind: 'audio', name: 'A1', clipIds: [] }]
    p.clips = {
      v: { id: 'v', assetId: talkId, trackId: 'V1', start: 0, inPoint: 0, duration: 8, transform: { x: W / 2, y: H / 2, scale: Math.min(W / tv.width, H / tv.height), rotation: 0 }, volume: 1 },
      k: { id: 'k', assetId: filmId, trackId: 'V2', start: 0, inPoint: 0, duration: 8, transform: { x: W / 2, y: H / 2, scale: W / asset().width, rotation: 0 }, volume: 1 }
    }
    p.captions = []
    S.getState().loadProject(p)
    S.setState({ selectedClipIds: [], playing: false })
    const png = async (proj, t) => rgba(await createImageBitmap(new Blob([await ex.exportFramePng(proj, t, false, 'final')], { type: 'image/png' })), W, H)
    const draw = (proj) => {
      const o = new OffscreenCanvas(W, H)
      R.renderFrame(o.getContext('2d'), proj, S.getState().currentTime, window.__engine.resolve, { scale: 1, quality: 'refine' })
      return o.getContext('2d').getImageData(0, 0, W, H).data
    }
    const same = (a, b) => { for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false; return true }
    const out = []
    for (const t of moments) {
      S.getState().setTime(t)
      const proj = S.getState().project
      const alone = { ...proj, tracks: [proj.tracks[1]], clips: { v: proj.clips.v } }
      let last = null
      let shown = null
      let alike = 0
      for (let i = 0; i < 80; i++) {
        await sleep(200)
        const now = draw(proj)
        alike = last && same(last, now) && films.codeFilms.heldTimes(filmId, 'k').some((x) => Math.abs(x - t) < 1e-6) ? alike + 1 : 0
        last = now
        if (alike >= 2) { shown = now; break }
      }
      if (!shown) return { error: `the preview did not settle at ${t} s` }
      const written = await png(proj, t)
      const writtenAlone = await png(alone, t)
      const ownBmp = await films.codeFilms.exactFrame(asset(), t)
      const own = rgba(ownBmp, W, H)
      ownBmp.close()
      const m = { t, max: 0, over2: 0, clearPx: 0, clearDiff: 0 }
      for (let i = 0; i < shown.length; i += 4) {
        const a = own[i + 3]
        if (a === 0) m.clearPx++
        for (let k = 0; k < 3; k++) {
          const d = Math.abs(shown[i + k] - written[i + k])
          if (d > m.max) m.max = d
          if (d > 2) m.over2++
          if (a === 0 && Math.abs(written[i + k] - writtenAlone[i + k]) > 2) m.clearDiff++
        }
      }
      out.push(m)
    }
    return { w: W, h: H, moments: out }
  }, talk1080.id, f2.id, [0.5, 2.75, 6.2])
  if (over.error) throw new Error(over.error)
  console.log('     F2 over the talk video:', JSON.stringify(over.moments))
  for (const m of over.moments) {
    check(m.clearPx > 0.3 * over.w * over.h, `F2 at ${m.t} s: not see-through over the video`)
    check(m.clearDiff === 0, `F2 at ${m.t} s: where the page is clear the exported frame is not the video (${m.clearDiff} channels)`)
    check(m.over2 <= over.w * over.h * 3 * 0.005, `F2 at ${m.t} s: the paused preview differs from the export (max ${m.max}, ${m.over2} channels)`)
  }

  // ---- SMIL, a Web Animation and a playing video (tier 3) -------------------
  const mdir = join(work, 'media-page')
  mkdirSync(mdir, { recursive: true })
  writeFileSync(join(mdir, 'index.html'), MEDIA_PAGE)
  cpSync(media.talk, join(mdir, 'clip.mp4'))
  const mp = await load(c, mdir, 8)
  console.log('     media page load:', JSON.stringify(mp))
  assert.equal(mp.status?.state, 'ready', `the media page did not start: ${mp.status?.error}`)
  assert.equal(mp.status.mode, 'page')
  const rm = await measure(c, mp.id, 3.4, [0.6, 2.0, 3.4, 5.1])
  console.log(`     media page T=3.4: a-b ${JSON.stringify(rm.ab)} a-c ${JSON.stringify(rm.ac)} b-c ${JSON.stringify(rm.bc)}; preview vs export ${rm.moments.map((m) => m.badPct + '%/' + m.max).join(' ')}; ${rm.playFps} pictures/s`)
  check(!rm.blank && rm.moves, 'media page: one colour or still')
  check(rm.ab.same && rm.ac.same && rm.bc.same, `media page: (a) / (b) / (c) differ (${rm.ab.badPct} / ${rm.ac.badPct} / ${rm.bc.badPct} %)`)
  for (const m of rm.moments) check(m.same, `media page: preview vs export at ${m.t} s differ (${m.badPct} %, max ${m.max})`)
  // The video's frame is the one of its moment: played from 0.5 s, at 3.4 s
  // it shows 2.9 s of clip.mp4 (compared with that frame of the file).
  const vid = await c.run(async (id, file) => {
    const { rgba, cmp } = window.__c52
    const S = window.__store
    const [films] = await window.__codeFilm()
    const asset = () => S.getState().project.assets.find((x) => x.id === id)
    const b = await films.codeFilms.exactFrame(asset(), 3.4)
    const o = new OffscreenCanvas(640, 360)
    o.getContext('2d').drawImage(b, 40, 40, 640, 360, 0, 0, 640, 360)
    b.close()
    const page = o.getContext('2d').getImageData(0, 0, 640, 360).data
    const reg = await window.api.testRegisterMedia(file)
    const v = document.createElement('video')
    v.muted = true
    v.crossOrigin = 'anonymous'
    v.src = reg.url
    await new Promise((r) => v.addEventListener('loadeddata', r, { once: true }))
    const at = async (s) => {
      v.currentTime = s
      await new Promise((r) => v.addEventListener('seeked', r, { once: true }))
      return rgba(v, 640, 360)
    }
    // Which moment of the file it shows: the closest of 2.0 … 3.8 s (30 fps).
    const diff = (a, b) => {
      let d = 0
      for (let i = 0; i < a.length; i += 16) d += Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2])
      return d / (a.length / 16) / 3
    }
    let best = null
    const near = {}
    for (let k = 60; k <= 114; k++) {
      const s = k / 30
      const d = diff(page, await at(s + 0.001))
      if (Math.abs(s - 2.9) < 0.21) near[s.toFixed(3)] = Math.round(d * 10) / 10
      if (!best || d < best.d) best = { s: Math.round(s * 1000) / 1000, d: Math.round(d * 10) / 10 }
    }
    return { best, near }
  }, mp.id, join(mdir, 'clip.mp4'))
  console.log('     media page video at 3.4 s: closest moment of its file:', JSON.stringify(vid))
  check(Math.abs(vid.best.s - 2.9) <= 0.034, `media page: the video shows ${vid.best.s} s of its file, not 2.9 s (${JSON.stringify(vid)})`)
  table.media = { mode: 'page', ab: rm.ab, ac: rm.ac, bc: rm.bc, export: rm.moments.every((m) => m.same) }

  // ---- F1–F4 as clips of one project ----------------------------------------
  const f1 = await load(c, join(FREE, 'F1-tuval'))
  const f3 = await load(c, join(FREE, 'F3-three'), 10)
  const f4 = await load(c, join(FREE, 'F4-gsap'))
  for (const [nm, f] of [['F1', f1], ['F3', f3], ['F4', f4]]) assert.equal(f.status?.state, 'ready', `${nm} did not start: ${f.status?.error}`)
  const four = await c.run(async (ids) => {
    const { sleep, rgba, cmp } = window.__c52
    const S = window.__store
    const ex = await window.__exporter()
    const R = await window.__render()
    const [films] = await window.__codeFilm()
    const W = 1920
    const H = 1080
    const p = structuredClone(S.getState().project)
    p.settings = { ...p.settings, width: W, height: H }
    // Four quarters: F1 top left, F2 over the whole frame, F3 bottom left, F4 bottom right.
    const place = [[480, 270], [960, 540], [480, 810], [1440, 810]]
    const scaleOf = (a, i) => (i === 1 ? W / a.width : 960 / a.width)
    p.tracks = ids.map((id, i) => ({ id: 'V' + i, kind: 'video', name: 'V' + i, clipIds: ['k' + i] })).reverse()
    p.tracks.push({ id: 'A1', kind: 'audio', name: 'A1', clipIds: [] })
    p.clips = {}
    ids.forEach((id, i) => {
      const a = p.assets.find((x) => x.id === id)
      p.clips['k' + i] = { id: 'k' + i, assetId: id, trackId: 'V' + i, start: 0, inPoint: 0, duration: 8, transform: { x: place[i][0], y: place[i][1], scale: scaleOf(a, i), rotation: 0 }, volume: 1 }
    })
    p.captions = []
    S.getState().loadProject(p)
    S.setState({ selectedClipIds: [], playing: false })
    const proj = () => S.getState().project
    // Plays: 3 s from 1 s.
    S.getState().setTime(1)
    await sleep(500)
    S.getState().setPlaying(true)
    const t0 = performance.now()
    while (S.getState().currentTime < 4 && performance.now() - t0 < 30000) await sleep(50)
    S.getState().setPlaying(false)
    const live = films.codeFilms.livePages()
    const states = ids.map((id) => films.codeFilms.status(id)?.state)
    const out = { live: live.length, states, moments: [] }
    const draw = () => {
      const o = new OffscreenCanvas(W, H)
      R.renderFrame(o.getContext('2d'), proj(), S.getState().currentTime, window.__engine.resolve, { scale: 1, quality: 'refine' })
      return o.getContext('2d').getImageData(0, 0, W, H).data
    }
    const same = (a, b) => { for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false; return true }
    for (const t of [2.25, 5.5]) {
      S.getState().setTime(t)
      let last = null
      let shown = null
      let alike = 0
      for (let i = 0; i < 100; i++) {
        await sleep(200)
        const now = draw()
        const all = ids.every((id, k) => films.codeFilms.heldTimes(id, 'k' + k).some((x) => Math.abs(x - t) < 1e-6))
        alike = all && last && same(last, now) ? alike + 1 : 0
        last = now
        if (alike >= 2) { shown = now; break }
      }
      const written = rgba(await createImageBitmap(new Blob([await ex.exportFramePng(proj(), t, false, 'final')], { type: 'image/png' })), W, H)
      // Each film's quarter shows something (not one colour).
      out.moments.push({ t, settled: !!shown, ...cmp(shown, written) })
    }
    return out
  }, [f1.id, f2.id, f3.id, f4.id])
  console.log('     F1–F4 in one project:', JSON.stringify(four))
  check(four.states.every((s) => s === 'ready'), `F1–F4: not all ready (${four.states})`)
  for (const m of four.moments) check(m.settled && m.same, `F1–F4 at ${m.t} s: preview vs export differ (${m.badPct} %, max ${m.max})`)

  // ---- three tier 3 clips playing together: the editor's frame draw ---------
  // (A project with no clip first: the four pages above are let go as the
  // live-page limit needs.)
  await c.run(async () => {
    const S = window.__store
    const p = structuredClone(S.getState().project)
    p.tracks = [{ id: 'V1', kind: 'video', name: 'V1', clipIds: [] }, { id: 'A1', kind: 'audio', name: 'A1', clipIds: [] }]
    p.clips = {}
    S.getState().loadProject(p)
    await new Promise((r) => setTimeout(r, 1000))
  })
  const copies = []
  for (const k of ['b', 'c']) {
    const d = join(work, 'F2-' + k)
    cpSync(join(FREE, 'F2-html'), d, { recursive: true })
    copies.push(await load(c, d, 8))
  }
  for (const f of copies) assert.equal(f.status?.state, 'ready', `an F2 copy did not start: ${f.status?.error}`)
  const three = await c.run(async (ids) => {
    const { sleep } = window.__c52
    const S = window.__store
    const [films] = await window.__codeFilm()
    const W = 1920
    const H = 1080
    const p = structuredClone(S.getState().project)
    p.settings = { ...p.settings, width: W, height: H, fps: 30 }
    p.tracks = ids.map((id, i) => ({ id: 'V' + i, kind: 'video', name: 'V' + i, clipIds: ['k' + i] }))
    p.tracks.push({ id: 'A1', kind: 'audio', name: 'A1', clipIds: [] })
    p.clips = {}
    ids.forEach((id, i) => {
      p.clips['k' + i] = { id: 'k' + i, assetId: id, trackId: 'V' + i, start: 0, inPoint: 0, duration: 8, transform: { x: W / 2 + (i - 1) * 120, y: H / 2 + (i - 1) * 60, scale: 1, rotation: 0 }, volume: 1 }
    })
    p.captions = []
    S.getState().loadProject(p)
    S.setState({ selectedClipIds: [], playing: false })
    S.getState().setTime(0.5)
    await sleep(1500)
    // Each draw of the preview, timed (the engine's own onDraw).
    const E = window.__engine
    const orig = E.onDraw
    const ms = []
    E.onDraw = function (...a) {
      const t0 = performance.now()
      try {
        return orig.apply(this, a)
      } finally {
        ms.push(performance.now() - t0)
      }
    }
    S.getState().setPlaying(true)
    const t0 = performance.now()
    while (performance.now() - t0 < 6000) await sleep(100)
    S.getState().setPlaying(false)
    E.onDraw = orig
    const sorted = [...ms].sort((a, b) => a - b)
    // And as perf's frame rows measure it (5b's frame.alpha2): one frame of
    // the three clips drawn at 1920 × 1080, read back (the drawing finished).
    const R = await window.__render()
    const t = 3
    const frames = new Map()
    for (let i = 0; i < ids.length; i++) frames.set('k' + i, await films.codeFilms.exactFrame(S.getState().project.assets.find((x) => x.id === ids[i]), t))
    const cv = new OffscreenCanvas(W, H)
    const g = cv.getContext('2d', { alpha: false })
    const proj = S.getState().project
    const runs = []
    for (let r = 0; r <= 12; r++) {
      const a = performance.now()
      for (let k = 0; k < 5; k++) {
        R.renderFrame(g, proj, t, (clip) => frames.get(clip.id) ?? null, { includeCaptions: true, shortsOverlay: false, quality: 'final' })
        g.getImageData(0, 0, 1, 1)
      }
      if (r > 0) runs.push((performance.now() - a) / 5)
    }
    for (const b of frames.values()) b.close()
    runs.sort((a, b) => a - b)
    return {
      frameMs: Math.round(runs[6] * 100) / 100,
      frameMsMax: Math.round(runs[runs.length - 1] * 100) / 100,
      draws: ms.length,
      median: Math.round(sorted[Math.floor(sorted.length / 2)] * 100) / 100,
      p95: Math.round(sorted[Math.floor(sorted.length * 0.95)] * 100) / 100,
      playFps: ids.map((id) => films.codeFilms.status(id)?.playFps ?? null),
      slow: ids.map((id) => !!films.codeFilms.status(id)?.slow),
      windows: (await window.api.testFilmProbe({ kind: 'windows' })).length
    }
  }, [f2.id, ...copies.map((f) => f.id)])
  console.log('     three tier 3 clips playing:', JSON.stringify(three))
  check(three.draws > 60, `three tier 3 clips: only ${three.draws} preview draws in 6 s`)
  check(three.median <= 16 && three.frameMs <= 16, `three tier 3 clips: the editor's median frame draw is ${three.median} ms while playing, ${three.frameMs} ms drawn and read back (> 16)`)

  // ---- frames a second while playing, each kind alone -----------------------
  const fps = await c.run(async (list) => {
    const { sleep } = window.__c52
    const S = window.__store
    const [films] = await window.__codeFilm()
    const out = {}
    for (const [nm, id] of list) {
      const a = S.getState().project.assets.find((x) => x.id === id)
      const W = 1920
      const H = 1080
      const p = structuredClone(S.getState().project)
      p.settings = { ...p.settings, width: W, height: H, fps: 30 }
      p.tracks = [{ id: 'V1', kind: 'video', name: 'V1', clipIds: ['k'] }, { id: 'A1', kind: 'audio', name: 'A1', clipIds: [] }]
      p.clips = { k: { id: 'k', assetId: id, trackId: 'V1', start: 0, inPoint: 0, duration: 8, transform: { x: W / 2, y: H / 2, scale: W / a.width, rotation: 0 }, volume: 1 } }
      p.captions = []
      S.getState().loadProject(p)
      S.setState({ selectedClipIds: [], playing: false })
      S.getState().setTime(0.5)
      await sleep(1500)
      S.getState().setPlaying(true)
      const t0 = performance.now()
      while (performance.now() - t0 < 7000) await sleep(100)
      S.getState().setPlaying(false)
      const st = films.codeFilms.status(id)
      out[nm] = { mode: st?.mode, playFps: st?.playFps ?? null, slow: !!st?.slow }
    }
    return out
  }, [['F1', f1.id], ['F2', f2.id], ['F3', f3.id], ['F4', f4.id], ['media', mp.id]])
  console.log('     pictures a second while playing:', JSON.stringify(fps))
  for (const [nm, r] of Object.entries(fps)) check(r.playFps !== null && r.playFps > 0, `${nm}: no frames a second measured while playing`)

  // ---- "unstable" and "slow", said by their chips ---------------------------
  const udir = join(work, 'unsteady')
  mkdirSync(udir, { recursive: true })
  writeFileSync(join(udir, 'index.html'), UNSTEADY_PAGE)
  writeFileSync(join(udir, 'data.json'), '{"ok":true}')
  const un = await load(c, udir, 6)
  assert.equal(un.status?.state, 'ready', `the unsteady page did not start: ${un.status?.error}`)
  const sdir = join(work, 'slow')
  mkdirSync(sdir, { recursive: true })
  writeFileSync(join(sdir, 'index.html'), SLOW_PAGE)
  const sl = await load(c, sdir, 10)
  assert.equal(sl.status?.state, 'ready', `the slow page did not start: ${sl.status?.error}`)
  const chips = await c.run(async (uid, sid) => {
    const { sleep } = window.__c52
    const S = window.__store
    const [films] = await window.__codeFilm()
    const asset = (id) => S.getState().project.assets.find((x) => x.id === id)
    const W = 1920
    const H = 1080
    const only = (id, scale, dur) => {
      const p = structuredClone(S.getState().project)
      p.settings = { ...p.settings, width: W, height: H, fps: 30 }
      p.tracks = [{ id: 'V1', kind: 'video', name: 'V1', clipIds: ['k'] }, { id: 'A1', kind: 'audio', name: 'A1', clipIds: [] }]
      p.clips = { k: { id: 'k', assetId: id, trackId: 'V1', start: 0, inPoint: 0, duration: dur, transform: { x: W / 2, y: H / 2, scale, rotation: 0 }, volume: 1 } }
      p.captions = []
      S.getState().loadProject(p)
      // (Selected: the inspector shows the clip's code film part.)
      S.setState({ selectedClipIds: ['k'], playing: false })
    }
    const chip = async (id) => {
      for (let i = 0; i < 20; i++) {
        if (document.querySelector(`[data-testid="${id}"]`)) return 1
        await sleep(100)
      }
      return 0
    }
    // The unsteady page asked at 2 s and at 4 s (its fetch has answered by then).
    only(uid, 1, 6)
    await sleep(500)
    ;(await films.codeFilms.exactFrame(asset(uid), 2)).close()
    await sleep(300)
    ;(await films.codeFilms.exactFrame(asset(uid), 4)).close()
    const u = { ...films.codeFilms.status(uid) }
    const chipUnstable = await chip('codefilm.unstable')
    // The slow page played alone for 7 s.
    only(sid, 3, 10)
    S.getState().setTime(0.2)
    await sleep(1000)
    S.getState().setPlaying(true)
    const t0 = performance.now()
    while (performance.now() - t0 < 7000) await sleep(100)
    S.getState().setPlaying(false)
    await sleep(500)
    const s = films.codeFilms.status(sid)
    return { unsteady: !!u?.unsteady, slow: !!s?.slow, slowFps: s?.playFps ?? null, chipUnstable, chipSlow: await chip('codefilm.slow') }
  }, un.id, sl.id)
  console.log('     unstable / slow:', JSON.stringify(chips))
  check(chips.unsteady && chips.chipUnstable > 0, 'a transition started by a network answer is not said to be unstable')
  check(chips.slow && chips.chipSlow > 0, `a page drawing ${chips.slowFps} frames a second is not said to be slow`)

  console.log('     table:', JSON.stringify({ ...table, fps, three: { median: three.median, playFps: three.playFps } }))
  if (fail.length) throw new Error(fail.join('\n'))
}
