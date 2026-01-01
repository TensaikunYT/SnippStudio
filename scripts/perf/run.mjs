// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// npm run perf [-- --baseline] [--no-build] [--only=fx]: the speed baseline (SnippStudio
// phase 2B.4). Fixed projects made from testdata\ (scripts/testdata/make.mjs),
// fixed moments, every number the median of 5 runs (after one warm-up):
//
//   frame.*      drawing one full-quality frame: renderFrame with its frames
//                already decoded, flushed (a 1-pixel read makes the GPU finish);
//                for the code clip, its exactFrame
//   edit.*       one edit in the 10- and 30-minute projects (mutate + the
//                equality check + the version log), as the store does it
//   changesSince, batch50   after five edits; 50 commands as one step
//   timeline.firstDraw      the 10-minute project loaded until its clips and
//                           subtitles are in the timeline's DOM
//   export.fps   frames per second of a 10 s full-HD MP4 export
//   frame.fx.*, drag.glow.p95, export.fps.fx.*   "cila" part D: a 1080p clip
//                with one effect of the pixel pass on (none, a LUT, the
//                chroma keyer, the colour dials, glow, halation, mosaic,
//                colour isolate): a frame, a dragged dial (the 95th
//                percentile of 120 frames) and the export's speed. Budget
//                (tarifler\CILA.md): a frame at most 8 ms, a dragged frame at
//                most 16.7 ms, the export at most 15 % slower than without.
//   codeval.scan.2mb   (cila K) the "code values" panel's first scan of a
//                      2 MB film folder, asked from the window
//   insp.scroll  the Inspector's Clip tab, every card open, scrolled with the
//                wheel (DENEME-2; scripts/perf/inspector-scroll.mjs): the p95
//                of the main thread's work per frame
//   pv.*         editing in the preview (cila A; scripts/perf/preview-interact.mjs):
//                the main thread's work per frame while a picture is moved,
//                sized, turned and its mask moved with real pointer events.
//                The row's number is the 95th percentile; `--no-pv` leaves
//                them out.
//   tl.*         the timeline in use (phase 3c.T; scripts/perf/interact.mjs):
//                the main thread's work per frame while it is scrolled, zoomed,
//                scrubbed, a clip dragged, an edge trimmed, the film played, in
//                the 10- and 30-minute talks and the heavy project (6 lanes,
//                300 clips, 600 subtitles). The row's number is the 95th
//                percentile; its median, the frames over the limit and the gaps
//                between frames are beside it. `--interact` measures only these;
//                `--baseline-add` writes the rows the baseline does not have yet
//                (and touches no row it has).
//
// Frame rate (rAF) is not measured: in a window nobody sees it is not reliable.
// Written to testdata\perf-son.json; with --baseline to testdata\perf-taban.json.
// Against the baseline, a number more than 20 % worse (and worse by more than
// its noise floor) fails the run.
// --only=fx measures the pixel pass's lines alone (a minute and a half; the
// other lines are left out, and the result goes to perf-son-fx.json so the
// last whole run's file stays).
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync, statSync, readdirSync } from 'node:fs'
import { cpus, totalmem } from 'node:os'
import { dirname, join } from 'node:path'
import { APP_DIR, launchApp } from '../e2e/app.mjs'
import { FILM, TESTDATA, VOICEOVER, makeE2eMedia, probeDuration } from '../e2e/media.mjs'
import { ready, editorAlone } from '../e2e/lib.mjs'
import { measurePreview, printPvRow } from './preview-interact.mjs'
import { measureInteractions, printRow } from './interact.mjs'
import { measureInspectorScroll, printInspRow } from './inspector-scroll.mjs'

const args = new Set(process.argv.slice(2))
const BASE = join(TESTDATA, 'perf-taban.json')
const ONLY_FX = args.has('--only=fx')
// --tl=<regex> (DENEME-3, V): only the timeline rows whose name matches
// (e.g. --interact --tl=dragClip), into perf-son-tl.json.
const TL_ARG = [...args].find((a) => a.startsWith('--tl='))
const TL_ONLY = TL_ARG ? new RegExp(TL_ARG.slice(5)) : null
const LAST = join(TESTDATA, ONLY_FX ? 'perf-son-fx.json' : TL_ONLY ? 'perf-son-tl.json' : 'perf-son.json')
const RUNS = 5
/** The quick ones (a frame, an edit) are repeated this many times per run. */
const REP = 10
const LIMIT = 1.2
/** Below these, a difference is noise (ms; fps). */
const FLOOR = { ms: 0.25, fps: 5 }

function newest(dir) {
  let t = 0
  for (const e of readdirSync(dir, { withFileTypes: true })) t = Math.max(t, e.isDirectory() ? newest(join(dir, e.name)) : statSync(join(dir, e.name)).mtimeMs)
  return t
}
const built = join(APP_DIR, 'out', 'renderer', 'index.html')
if (!args.has('--no-build') && (!existsSync(built) || newest(join(APP_DIR, 'src')) > statSync(built).mtimeMs)) {
  const r = process.platform === 'win32' ? spawnSync('cmd', ['/c', 'npm run build'], { cwd: APP_DIR, stdio: 'inherit' }) : spawnSync('npm', ['run', 'build'], { cwd: APP_DIR, stdio: 'inherit' })
  if (r.status !== 0) process.exit(1)
}
for (const f of [join(TESTDATA, 'ham', 'ham-10dk-tr.mp4'), join(TESTDATA, 'ham', 'ham-30dk-en.mp4'), join(VOICEOVER, 'vo.wav'), join(TESTDATA, 'kod-klibi', 'index.html')]) {
  if (!existsSync(f)) { console.error(`testdata missing ${f}: node scripts/testdata/make.mjs`); process.exit(1) }
}

// ---- the fixed projects (built here, registered and loaded in the page) ----
const truth = (n) => JSON.parse(readFileSync(join(TESTDATA, 'ham', `${n}.truth.json`), 'utf8'))
function captionsFromTruth(t) {
  return t.segments.filter((s) => s.text).map((s, i) => ({ id: `c${i + 1}`, start: s.start, end: s.end, text: s.text, words: t.words.filter((w) => w.start >= s.start - 0.01 && w.end <= s.end + 0.01).map((w) => ({ text: w.text, start: w.start, end: w.end })) }))
}
const media = {
  ham10: { file: join(TESTDATA, 'ham', 'ham-10dk-tr.mp4'), kind: 'video', w: 640, h: 360, d: probeDuration(join(TESTDATA, 'ham', 'ham-10dk-tr.mp4')), audio: true },
  ham30: { file: join(TESTDATA, 'ham', 'ham-30dk-en.mp4'), kind: 'video', w: 640, h: 360, d: probeDuration(join(TESTDATA, 'ham', 'ham-30dk-en.mp4')), audio: true },
  vo: { file: join(VOICEOVER, 'vo.wav'), kind: 'audio', w: 0, h: 0, d: probeDuration(join(VOICEOVER, 'vo.wav')), audio: true }
}
for (let i = 1; i <= 20; i++) media[`img${i}`] = { file: join(VOICEOVER, `${i}.jpg`), kind: 'image', w: 960, h: 540, d: 0, audio: false }
// A 1920 x 1080 clip (the e2e tests' own, made with ffmpeg): the pixel pass at full HD.
const talk1080 = makeE2eMedia().talk1080
media.talk1080 = { file: talk1080, kind: 'video', w: 1920, h: 1080, d: probeDuration(talk1080), audio: true }
/** "Cila" part D: one effect of the pixel pass each. */
const fxLooks = {
  none: {},
  lut: { lut: 'preset:tealOrange' },
  key: { chroma: { enabled: true, color: '#19c832', similarity: 0.4, smoothness: 0.1, method: 'chroma', spill: 0.5 } },
  tone: { tone: { exposure: 0.5, tint: 0.2, highlights: -0.4, shadows: 0.4 } },
  glow: { bloom: { amount: 0.6, threshold: 0.6, radius: 0.5 } },
  halation: { halation: { amount: 0.6, size: 0.5 } },
  mosaic: { mosaic: 24 },
  isolate: { isolate: { color: '#dc1e1e', range: 0.08, amount: 1 } }
}
const FX_FRAME_MAX_MS = 8
const FX_DRAG_MAX_MS = 16.7
const FX_EXPORT_DROP = 0.15
const t10 = truth('ham-10dk-tr'), t30 = truth('ham-30dk-en')
const faceless = readFileSync(join(VOICEOVER, 'vo.srt'), 'utf8').replace(/\r/g, '').split('\n\n').filter(Boolean).map((b, i) => {
  const l = b.split('\n'); const [a, z] = l[1].split(' --> ').map((x) => { const [h, m, s] = x.replace(',', '.').split(':'); return +h * 3600 + +m * 60 + +s })
  return { id: `f${i + 1}`, start: a, end: z, text: l.slice(2).join(' ') }
})
const blocks = JSON.parse(readFileSync(join(APP_DIR, 'scripts', 'qa', 'reference', 'tpl-blocks.json'), 'utf8'))
const steps = { ...blocks.find((b) => b.kind === 'steps'), id: 'tsteps', start: 25 }

const spec = { onlyFx: ONLY_FX, fxLooks, media, cap10: captionsFromTruth(t10), cap30: captionsFromTruth(t30), cuts10: t10.cuts, cuts30: t30.cuts, faceless, steps, film: join(TESTDATA, 'kod-klibi'), alphaFilms: [join(TESTDATA, 'kod-klibi-saydam'), join(TESTDATA, 'kod-klibi-saydam-gl')] }
/** Phase 5b's measure: with two transparent overlays, the median frame draw
 *  is at most this (ms), whatever the baseline says. */
const ALPHA2_MAX_MS = 16

/**
 * Cila K, `codeval.scan.2mb`: opening the "code values" panel reads a film
 * folder's pages, style sheets and scripts (at most 2 MB) and scans them.
 * The folder: the real code of testdata's two big films (portrait, heavy),
 * copied until it is just under 2 MB. The main process keeps scans by file
 * content: before each run they are forgotten (a test-only probe), so each
 * run is a first scan. Timed in the window, as the panel waits for it.
 */
async function codeValuesScan() {
  const SKIP = /(^|[\\/])(\.videohub|\.surumler|\.git|node_modules|work|tools|src_audio|__pycache__|snipp)([\\/]|$)/i
  const code = []
  for (const film of ['portrait', 'heavy']) {
    const dir = FILM[film]
    const walk = (rel) => {
      for (const e of readdirSync(join(dir, rel), { withFileTypes: true })) {
        const r = rel ? join(rel, e.name) : e.name
        if (SKIP.test(r)) continue
        if (e.isDirectory()) walk(r)
        else if (/\.(html?|css|m?js)$/i.test(e.name) && !/\.min\.[a-z]+$/i.test(e.name)) {
          const size = statSync(join(dir, r)).size
          if (size <= 1024 * 1024) code.push({ film, rel: r, text: readFileSync(join(dir, r), 'utf8'), size })
        }
      }
    }
    if (existsSync(dir)) walk('')
  }
  if (!code.length) return { 'codeval.scan.2mb': 'not measured: testdata\\filmler has neither film (roles.json)' }
  const root = join(app.profile, 'perf-codeval')
  rmSync(root, { recursive: true, force: true })
  const target = 2 * 1024 * 1024 - 64 * 1024
  const files = [{ path: join(root, 'index.html'), text: '<!doctype html><html><body></body></html>\n' }]
  let bytes = 0
  for (let k = 0; k < 20 && bytes < target; k++) {
    for (const f of code) {
      if (bytes + f.size > target) { bytes = target; break }
      files.push({ path: join(root, `c${k}`, f.film, f.rel), text: f.text })
      bytes += f.size
    }
  }
  for (const f of files) {
    mkdirSync(dirname(f.path), { recursive: true })
    writeFileSync(f.path, f.text)
  }
  const id = await c.run(async (folder) => /^snippfilm:\/\/([a-f0-9]{16})\//.exec((await window.api.codeFilm.register(folder)).url)[1], root)
  const runs = []
  let last = null
  let firstMs = 0
  // (Run 0, not counted, is also the first read of the files just written:
  // on Windows that read is slowed by the virus scanner, 1–2 s here.)
  for (let i = 0; i <= RUNS; i++) {
    last = await c.run(async (id) => {
      await window.api.testFilmProbe({ kind: 'codeval-forget' })
      const t0 = performance.now()
      const r = await window.api.codeFilm.valuesScan(id)
      return { ms: performance.now() - t0, files: r.files, bytes: r.bytes, skipped: r.skipped, slots: r.slots.length, main: r.ms }
    }, id)
    if (i > 0) runs.push(last.ms)
    else firstMs = last.ms
  }
  rmSync(root, { recursive: true, force: true })
  const median = [...runs].sort((x, y) => x - y)[Math.floor(runs.length / 2)]
  return {
    'codeval.scan.2mb': { unit: 'ms', median: +median.toFixed(3), runs: runs.map((x) => +x.toFixed(3)) },
    'codeval.scan.folder': `${last.files} files, ${Math.round(last.bytes / 1024)} KB, ${last.skipped} left out, ${last.slots} places; ${last.main} ms of it in the main process; the first read of the files just written ${Math.round(firstMs)} ms`
  }
}

const app = await launchApp({ agent: false })
const c = app.cdp
let result
try {
  await ready(c)
  await editorAlone(c)
  await c.sleep(1500)
  result = args.has('--interact') ? {} : await c.run(async (spec, RUNS, REP) => {
    const S = window.__store
    const ex = await window.__exporter()
    const R = await window.__render()
    const SRC = await window.__sources()
    const cmds = await window.__commands()
    const median = (a) => { const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)] }
    const now = () => performance.now()
    const tick = () => new Promise((r) => setTimeout(r, 0))

    // Assets: registered the test way, described from what is known.
    const A = {}
    for (const [id, m] of Object.entries(spec.media)) {
      const reg = await window.api.testRegisterMedia(m.file)
      if (!reg) throw new Error('cannot register ' + m.file)
      A[id] = { id, kind: m.kind, name: reg.name, path: reg.path, url: reg.url, size: reg.size, duration: m.d, width: m.w, height: m.h, hasAudio: m.audio }
    }
    const info = await window.api.codeFilm.register(spec.film)
    const [films, imp] = await window.__codeFilm()
    const film = (await imp.codeFilmImport(info)).assets.find((a) => a.kind === 'code')
    film.id = 'film'
    films.codeFilms.ensure(film)

    const capStyle = { fontFamily: 'Arial', fontSize: 64, fontWeight: 800, color: '#ffffff', outlineColor: '#000000', outlineWidth: 6, bgColor: '#000000', bgOpacity: 0, posY: 0.86, maxLineChars: 32, uppercase: false, popup: { enabled: true, duration: 0.2, intensity: 1, style: 'pop' }, wordsPerCue: 0, pauseThreshold: 0 }
    const base = (name) => ({ version: 1, name, settings: { width: 1920, height: 1080, fps: 30 }, mode: 'frame', tracks: [], clips: {}, assets: [], captions: [], captionStyle: capStyle, transcription: { model: 'english', language: 'auto' }, snap: { enabled: true, distance: 12, snapEdges: true, snapCenters: true } })
    const T = (s) => ({ x: 960, y: 540, scale: s, rotation: 0 })
    const put = (p, track, clips) => { p.tracks.push(track); for (const k of clips) { p.clips[k.id] = k; track.clipIds.push(k.id) } }
    const load = async (p) => { S.getState().loadProject(structuredClone(p)); await new Promise((r) => setTimeout(r, 50)) }

    // The raw-talk projects, roughly cut the way their truth says (one step).
    const talk = async (name, asset, caps, cuts) => {
      const p = base(name)
      p.assets = [A[asset]]
      put(p, { id: 'V1', kind: 'video', name: 'V1', clipIds: [] }, [{ id: 'v', assetId: asset, trackId: 'V1', start: 0, inPoint: 0, duration: A[asset].duration, transform: T(3), volume: 1 }])
      put(p, { id: 'A1', kind: 'audio', name: 'A1', clipIds: [] }, [])
      p.captions = caps
      await load(p)
      S.getState().rippleDeleteMany(cuts)
      return structuredClone(S.getState().project)
    }
    const P10 = await talk('ham-10dk', 'ham10', spec.cap10, spec.cuts10)
    const P30 = await talk('ham-30dk', 'ham30', spec.cap30, spec.cuts30)
    // The faceless project: 20 pictures, a soft mix and a slow push each, the voice, its subtitles.
    const PF = base('voiceover')
    PF.assets = [A.vo, ...Array.from({ length: 20 }, (_, i) => A[`img${i + 1}`])]
    const len = A.vo.duration / 20
    put(PF, { id: 'V1', kind: 'video', name: 'V1', clipIds: [] }, Array.from({ length: 20 }, (_, i) => ({ id: `i${i + 1}`, assetId: `img${i + 1}`, trackId: 'V1', start: +(i * len).toFixed(3), inPoint: 0, duration: +len.toFixed(3), transform: T(2), volume: 1, transitionOut: i < 19 ? { type: 'mix', duration: 0.6 } : undefined, motionFx: { enabled: true, zoomFrom: 1, zoomTo: 1.12, panX: 0.03, panY: 0, shakeAmp: 0, shakeRotAmp: 0, shakeSpeed: 1, seed: i + 1 } })))
    put(PF, { id: 'A1', kind: 'audio', name: 'A1', clipIds: [] }, [{ id: 'vo', assetId: 'vo', trackId: 'A1', start: 0, inPoint: 0, duration: A.vo.duration, transform: T(1), volume: 1 }])
    PF.captions = spec.faceless
    // The code clip, a subtitle over it.
    const PC = base('kod-klibi')
    PC.assets = [film]
    put(PC, { id: 'V1', kind: 'video', name: 'V1', clipIds: [] }, [{ id: 'k', assetId: 'film', trackId: 'V1', start: 0, inPoint: 0, duration: 12, transform: T(1.5), volume: 1 }])
    PC.captions = [{ id: 'kc', start: 0.5, end: 11, text: 'A code clip under a subtitle' }]
    // A template over the 10-minute talk.
    const PT = structuredClone(P10)
    PT.templates = [spec.steps]
    // Phase 5b: two transparent code clips (a 2D canvas page and a WebGL
    // one) over the 10-minute talk.
    const PA = structuredClone(P10)
    {
      const ids = ['alpha2d', 'alphagl']
      for (const [i, path] of spec.alphaFilms.entries()) {
        const inf = await window.api.codeFilm.register(path)
        const a = (await imp.codeFilmImport(inf)).assets.find((x) => x.kind === 'code')
        a.id = ids[i]
        a.code = { ...a.code, hasAlpha: true }
        // (Asked with a project that holds it loaded: the engine's pruning
        // closes the pages of films the loaded project does not hold.)
        await load({ ...base('alpha-' + i), assets: [a] })
        films.codeFilms.ensure(a)
        await films.codeFilms.exactFrame(a, 0).then((b) => b.close())
        const st = films.codeFilms.status(a.id)
        a.width = st.width
        a.height = st.height
        a.duration = st.duration
        PA.assets.push(a)
        // (tracks[0] is the top layer.)
        const k = { id: 'ka' + i, assetId: a.id, trackId: 'VA' + i, start: 0, inPoint: 0, duration: 10, transform: T(1920 / st.width), volume: 1 }
        PA.tracks.unshift({ id: k.trackId, kind: 'video', name: k.trackId, clipIds: [k.id] })
        PA.clips[k.id] = k
      }
    }

    const out = {}
    const add = (name, unit, runs) => { out[name] = { unit, median: +median(runs).toFixed(3), runs: runs.map((x) => +x.toFixed(3)) } }

    // ---- A. one frame ---------------------------------------------------------
    const canvas = new OffscreenCanvas(1920, 1080)
    const ctx = canvas.getContext('2d', { alpha: false })
    const images = new Map()
    const imageOf = async (a) => {
      if (!images.has(a.id)) { const im = new Image(); im.crossOrigin = 'anonymous'; im.src = a.url; await im.decode(); images.set(a.id, im) }
      return images.get(a.id)
    }
    /** The frames of `p` at `t`, decoded: what renderFrame is handed. */
    const framesAt = async (p, t) => {
      const frames = new Map()
      for (const e of R.renderList(p, t)) {
        const a = p.assets.find((x) => x.id === e.clip.assetId)
        if (!a) continue
        if (a.kind === 'image') frames.set(e.clip.id, await imageOf(a))
        if (a.kind === 'code') frames.set(e.clip.id, await films.codeFilms.exactFrame(a, R.clipMediaAt(p, e.clip, t).time))
        if (a.kind === 'video') {
          const sink = await SRC.getVideoSink(a, undefined, { original: true })
          const w = await sink.getCanvas(Math.min(a.duration - 0.05, R.clipMediaAt(p, e.clip, t).time))
          if (w) frames.set(e.clip.id, w.canvas)
        }
      }
      return frames
    }
    const frameTime = async (p, t) => {
      await load(p)
      await ex.preloadImagesForExport(p)
      const frames = await framesAt(p, t)
      const resolve = (clip) => frames.get(clip.id) ?? null
      {
        // A source that would taint the canvas (no read back then) is named.
        const probe = new OffscreenCanvas(8, 8).getContext('2d')
        R.renderFrame(ctx, p, t, resolve, { includeCaptions: true, shortsOverlay: false, quality: 'final' })
        try { ctx.getImageData(0, 0, 1, 1) } catch {
          const bad = []
          for (const [id, f] of frames) { probe.drawImage(f, 0, 0, 8, 8); try { probe.getImageData(0, 0, 1, 1) } catch { bad.push(id + ':' + Object.prototype.toString.call(f)) } }
          throw new Error(`frame ${p.name} @${t}: the canvas is tainted; sources ${JSON.stringify(bad)}; entries ${R.renderList(p, t).map((e) => e.clip.id + '/' + p.assets.find((x) => x.id === e.clip.assetId)?.kind).join(',')}`)
        }
      }
      const runs = []
      // Each run: REP frames (the clock's step is 0.1 ms), the time per frame.
      for (let i = 0; i <= RUNS; i++) {
        const t0 = now()
        for (let r = 0; r < REP; r++) {
          R.renderFrame(ctx, p, t, resolve, { includeCaptions: true, shortsOverlay: false, quality: 'final' })
          ctx.getImageData(0, 0, 1, 1)
        }
        if (i > 0) runs.push((now() - t0) / REP)
      }
      return runs
    }
    const all = !spec.onlyFx
    if (all) {
    for (const t of [30, 200, 400]) add(`frame.ham10.t${t}`, 'ms', await frameTime(P10, t))
    add('frame.template.t30', 'ms', await frameTime(PT, 30))
    for (const t of [10, 70, 130]) add(`frame.faceless.t${t}`, 'ms', await frameTime(PF, t))
    add('frame.codeclip.t6', 'ms', await frameTime(PC, 6))
    for (const t of [3, 6]) add(`frame.alpha2.t${t}`, 'ms', await frameTime(PA, t))
    }
    // The project that holds the film (5a/5b patch, audit C-7: asked while
    // another project was loaded, the engine's pruning closed its page now
    // and then, and the ask failed with "The code film was closed.").
    await load(PC)
    for (const t of all ? [1, 6, 11] : []) {
      const runs = []
      // A different frame each time (a frame already drawn may be kept);
      // each run REP frames, the time per frame; three frames to warm up.
      for (let w = 0; w < 3; w++) (await films.codeFilms.exactFrame(film, Math.max(0, t - 0.5) + w / 30)).close()
      for (let i = 0; i < RUNS; i++) {
        const t0 = now()
        for (let r = 0; r < REP; r++) (await films.codeFilms.exactFrame(film, Math.min(11.9, t + (i * REP + r) / 60))).close()
        runs.push((now() - t0) / REP)
      }
      add(`frame.exactFrame.t${t}`, 'ms', runs)
    }

    // ---- A2. the pixel pass ("cila" part D): a 1080p clip, one effect on -----------
    const fxProject = (look) => {
      const p = base('fx')
      p.assets = [A.talk1080]
      put(p, { id: 'V1', kind: 'video', name: 'V1', clipIds: [] }, [{ id: 'x', assetId: 'talk1080', trackId: 'V1', start: 0, inPoint: 0, duration: 10, transform: T(1), volume: 1, ...look }])
      put(p, { id: 'A1', kind: 'audio', name: 'A1', clipIds: [] }, [])
      return p
    }
    for (const [name, look] of Object.entries(spec.fxLooks)) add(`frame.fx.${name}`, 'ms', await frameTime(fxProject(look), 3))
    {
      // A dragged dial: the glow's amount through 120 values, the store
      // changed and a full-HD frame drawn for each; the 95th percentile.
      const p = fxProject(spec.fxLooks.glow)
      await load(p)
      const frames = await framesAt(p, 3)
      const resolve = (clip) => frames.get(clip.id) ?? null
      const runs = []
      for (let i = 0; i <= RUNS; i++) {
        const ms = []
        S.getState().armGesture()
        for (let k = 0; k < 120; k++) {
          const t0 = now()
          S.getState().setClipFx('x', { bloom: { amount: 0.1 + (0.8 * k) / 119 } })
          R.renderFrame(ctx, S.getState().project, 3, resolve, { includeCaptions: true, shortsOverlay: false, quality: 'final' })
          ctx.getImageData(0, 0, 1, 1)
          ms.push(now() - t0)
        }
        S.getState().endGesture()
        ms.sort((a, b) => a - b)
        if (i > 0) runs.push(ms[Math.floor(ms.length * 0.95)])
      }
      add('drag.glow.p95', 'ms', runs)
    }

    // ---- B. one edit ------------------------------------------------------------
    for (const [name, P] of all ? [['ham10', P10], ['ham30', P30]] : []) {
      await load(P)
      const ids = Object.keys(S.getState().project.clips)
      const capId = S.getState().project.captions[5].id
      const vol = [], cap = []
      for (let i = 0; i <= RUNS; i++) {
        let t0 = now()
        for (let r = 0; r < REP; r++) S.getState().setClipVolume(ids[(i * REP + r) % ids.length], 0.3 + ((i * REP + r) % 7) * 0.1)
        const a = (now() - t0) / REP
        t0 = now()
        for (let r = 0; r < REP; r++) S.getState().updateCaption(capId, { text: 'edited ' + i + '.' + r })
        const b = (now() - t0) / REP
        if (i > 0) { vol.push(a); cap.push(b) }
      }
      add(`edit.${name}.clipVolume`, 'ms', vol)
      add(`edit.${name}.captionText`, 'ms', cap)
      out[`project.${name}`] = { clips: ids.length, captions: S.getState().project.captions.length, words: S.getState().project.captions.reduce((n, x) => n + (x.words?.length ?? 0), 0) }
    }

    // ---- C. changesSince, a 50-command batch -------------------------------------
    if (all) {
      await load(P30)
      const v0 = S.getState().projectVersion
      const st = S.getState()
      const ids = Object.keys(st.project.clips)
      for (let i = 0; i < 5; i++) S.getState().setClipVolume(ids[i], 0.7)
      S.getState().rippleDeleteMany([[100, 101]])
      const runs = []
      for (let i = 0; i <= RUNS; i++) { const t0 = now(); for (let r = 0; r < REP; r++) S.getState().changesSince(v0); if (i > 0) runs.push((now() - t0) / REP) }
      add('changesSince.ham30', 'ms', runs)
    }
    if (all) {
      const runs = []
      for (let i = 0; i <= RUNS; i++) {
        await load(P30)
        const p = S.getState().project
        const clips = Object.values(p.clips).sort((a, b) => a.start - b.start)
        const calls = []
        for (let j = 0; j < 25; j++) calls.push({ name: 'marker.add', params: { time: 10 + j * 30 } })
        for (let j = 0; j < 25; j++) { const k = clips[j * 3]; calls.push({ name: 'clip.split', params: { clipIds: [k.id], time: +(k.start + k.duration / 2).toFixed(3) } }) }
        const t0 = now()
        S.getState().runBatch(calls)
        if (i > 0) runs.push(now() - t0)
      }
      add('batch50.ham30', 'ms', runs)
    }

    // ---- D. the timeline's first drawing -----------------------------------------
    if (all) {
      const runs = []
      const n = Object.keys(P10.clips).length
      for (let i = 0; i <= RUNS; i++) {
        S.getState().newProject('16:9')
        await new Promise((r) => setTimeout(r, 300))
        const t0 = now()
        S.getState().loadProject(structuredClone(P10))
        while (!document.querySelector('[data-testid^="timeline.clip."]') || !document.querySelector('[data-testid^="timeline.caption."]')) await tick()
        if (i > 0) runs.push(now() - t0)
      }
      add('timeline.firstDraw.ham10', 'ms', runs)
      out['timeline.clipsInDom'] = document.querySelectorAll('[data-testid^="timeline.clip."]').length + ' of ' + n
    }

    // ---- E. a short export -----------------------------------------------------
    if (all) {
      const runs = []
      for (let i = 0; i < 3; i++) {
        await load(P10)
        const t0 = now()
        await ex.exportProjectMp4(S.getState().project, { onProgress() {}, settings: { container: 'mp4', resolutionScale: 1, fps: 30, bitrateFactor: 0.12, target: 'landscape', normalize: false, range: [20, 30] } })
        runs.push(300 / ((now() - t0) / 1000))
      }
      add('export.fps.ham10.10s', 'fps', runs)
    }

    // ---- F. speed (core polish B) ----------------------------------------------
    // The 10-minute talk as one clip at a speed (its sound with it: at 4x the
    // pitch-preserving stretch is in the export).
    const atSpeed = (speed) => {
      const p = base('ham-10dk-x' + speed)
      p.assets = [A.ham10]
      put(p, { id: 'V1', kind: 'video', name: 'V1', clipIds: [] }, [{ id: 'v', assetId: 'ham10', trackId: 'V1', start: 0, inPoint: 0, duration: A.ham10.duration / speed, speed, transform: T(3), volume: 1 }])
      put(p, { id: 'A1', kind: 'audio', name: 'A1', clipIds: [] }, [])
      return p
    }
    {
      // 10 s of the film (300 frames) at 4x, and the same stretch at 1x beside it.
      for (const speed of [4, 1]) {
        const runs = []
        for (let i = 0; i < 3; i++) {
          await load(atSpeed(speed))
          const t0 = now()
          await ex.exportProjectMp4(S.getState().project, { onProgress() {}, settings: { container: 'mp4', resolutionScale: 1, fps: 30, bitrateFactor: 0.12, target: 'landscape', normalize: false, range: [20, 30] } })
          runs.push(300 / ((now() - t0) / 1000))
        }
        add(`export.fps.speed${speed}`, 'fps', runs)
      }
    }
    {
      // The preview at 50x (above what a media element plays: the decoder is
      // stepped through): while it plays, how long one new picture takes.
      // Each run: 2 s of playback from another place, the time ÷ the number
      // of different frames the engine was given.
      const eng = window.__engine
      const probe = new OffscreenCanvas(32, 18).getContext('2d', { willReadFrequently: true })
      const print = (src) => { probe.drawImage(src, 0, 0, 32, 18); const d = probe.getImageData(0, 0, 32, 18).data; let h = 0; for (let i = 0; i < d.length; i += 4) h = (h * 31 + d[i] + d[i + 1] * 3 + d[i + 2] * 7) | 0; return h }
      await load(atSpeed(50))
      const runs = []
      for (let i = 0; i <= RUNS; i++) {
        S.getState().setPlaying(false)
        S.getState().setTime(1 + i * 1.5)
        await new Promise((r) => setTimeout(r, 500))
        S.getState().setPlaying(true)
        let t0 = now()
        while (S.getState().currentTime < 1 + i * 1.5 + 0.03 && now() - t0 < 3000) await new Promise((r) => requestAnimationFrame(r))
        t0 = now()
        let last = null
        let frames = 0
        while (now() - t0 < 2000) {
          await new Promise((r) => requestAnimationFrame(r))
          const f = eng.pausedFrames.get('v')
          if (!f) continue
          const h = print(f)
          if (h !== last) { frames++; last = h }
        }
        S.getState().setPlaying(false)
        if (i > 0) runs.push(2000 / Math.max(1, frames))
      }
      add('speed.preview.x50', 'ms', runs)
    }
    // "Cila" part D: the same 10 s of a 1080p clip, without and with each
    // effect, in turns: plain, with the effect, plain, with the effect…
    // Each effect is held against the plain exports made right beside it
    // (`plain`): the speed of an export drifts over a run (the first ones of
    // a window are slower, and so are those made while the editor is still
    // reading the big projects' waveforms), and that drift must not read as
    // an effect's doing. One export first that is not counted.
    {
      const fxExport = async (look, seconds = 10) => {
        await load(fxProject(look))
        const t0 = now()
        await ex.exportProjectMp4(S.getState().project, { onProgress() {}, settings: { container: 'mp4', resolutionScale: 1, fps: 30, bitrateFactor: 0.12, target: 'landscape', normalize: false, range: [0, seconds] } })
        return (seconds * 30) / ((now() - t0) / 1000)
      }
      await fxExport({}, 3)
      const plainAll = []
      for (const [name, look] of Object.entries(spec.fxLooks)) {
        if (name === 'none') continue
        const without = []
        const withIt = []
        for (let i = 0; i < 3; i++) {
          without.push(await fxExport(spec.fxLooks.none))
          withIt.push(await fxExport(look))
        }
        add(`export.fps.fx.${name}`, 'fps', withIt)
        out[`export.fps.fx.${name}`].plain = +median(without).toFixed(3)
        plainAll.push(...without)
      }
      add('export.fps.fx.none', 'fps', plainAll)
    }

    // ---- G. a speed curve (core polish C) ----------------------------------------
    // The 10-minute talk with a three-point curve (4x → 0.5x → 2x): 10 s of
    // the film exported (its sound stretched along the curve), and a drag of
    // the curve's middle point, one step a frame (the 95th percentile of the
    // time from a step to the next frame: what a pointer move costs, the
    // Inspector open on the clip).
    const curved = async () => {
      await load(atSpeed(1))
      S.getState().setClipSpeedCurve('v', { points: [{ u: 0, v: 4 }, { u: 0.4, v: 0.5 }, { u: 1, v: 2 }] })
      await new Promise((r) => setTimeout(r, 200))
    }
    {
      const runs = []
      for (let i = 0; i < 3; i++) {
        await curved()
        const t0 = now()
        await ex.exportProjectMp4(S.getState().project, { onProgress() {}, settings: { container: 'mp4', resolutionScale: 1, fps: 30, bitrateFactor: 0.12, target: 'landscape', normalize: false, range: [20, 30] } })
        runs.push(300 / ((now() - t0) / 1000))
      }
      add('export.fps.curve', 'fps', runs)
    }
    {
      await curved()
      S.setState({ selectedClipIds: ['v'] })
      const runs = []
      for (let i = 0; i <= RUNS; i++) {
        const steps = []
        S.getState().armGesture()
        for (let k = 0; k < 60; k++) {
          const t0 = now()
          S.getState().setClipSpeedCurve('v', { points: [{ u: 0, v: 4 }, { u: 0.4, v: 0.25 * 1.05 ** k }, { u: 1, v: 2 }] })
          await new Promise((r) => requestAnimationFrame(r))
          steps.push(now() - t0)
        }
        S.getState().endGesture()
        steps.sort((a, b) => a - b)
        if (i > 0) runs.push(steps[Math.floor(steps.length * 0.95)])
      }
      add('speed.curve.drag.p95', 'ms', runs)
    }
    S.getState().newProject('16:9')
    S.getState().setDirty(false)
    return out
  }, spec, RUNS, REP)
  if (!args.has('--interact') && !ONLY_FX) {
    Object.assign(result, await codeValuesScan())
    // Editing in the preview (the same window, after the rest).
    if (!args.has('--no-pv')) Object.assign(result, await measurePreview(c, { log: process.env.PERF_SECOND ? () => undefined : printPvRow }))
    // The Inspector scrolled (DENEME-2, item 7; scripts/perf/inspector-scroll.mjs).
    Object.assign(result, await measureInspectorScroll(c, { log: process.env.PERF_SECOND ? () => undefined : printInspRow }))
  }
  // The timeline in use (the same window, after the rest).
  if (!args.has('--no-interact') && !ONLY_FX) Object.assign(result, await measureInteractions(c, { only: TL_ONLY, log: process.env.PERF_SECOND ? () => undefined : printRow }))
} finally {
  await app.close()
}

const commit = spawnSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: APP_DIR, encoding: 'utf8' }).stdout.trim()
const record = { at: new Date().toISOString(), commit, machine: { cpu: cpus()[0]?.model, cores: cpus().length, ramGB: Math.round(totalmem() / 2 ** 30) }, runs: RUNS, metrics: result }
if (args.has('--baseline-add')) {
  // Only the rows the baseline does not have: its own rows stay as they are.
  const old = JSON.parse(readFileSync(BASE, 'utf8'))
  const added = Object.keys(result).filter((k) => !(k in old.metrics))
  for (const k of added) old.metrics[k] = result[k]
  old.added = [...(old.added ?? []), { at: record.at, commit, rows: added }]
  writeFileSync(BASE, JSON.stringify(old, null, 1) + '\n')
  writeFileSync(LAST, JSON.stringify(record, null, 1) + '\n')
  console.log(`${added.length} new row(s) added to the baseline: ${added.join(', ') || 'none'}`)
  process.exit(0)
}
writeFileSync(args.has('--baseline') ? BASE : LAST, JSON.stringify(record, null, 1) + '\n')
const base = !args.has('--baseline') && existsSync(BASE) ? JSON.parse(readFileSync(BASE, 'utf8')) : null
// (A row may bring its own limit and noise floor: the timeline's frame times
// are a percentile of a few hundred frames, noisier than a median of five.)
const isWorse = (k, v) => {
  const b = base?.metrics[k]?.median
  if (b === undefined || v?.median === undefined) return false
  const ratio = v.unit !== 'fps' ? v.median / b : b / v.median
  return ratio > (v.limit ?? LIMIT) && Math.abs(v.median - b) > (v.floor ?? FLOOR[v.unit])
}
// A number that came out worse is measured once more (a whole second run, in
// a new window) and the better of the two counts: a single slow moment of the
// machine (seen: one run's caption edit at 1.1 ms against 0.7) is not a
// regression; a real one is slow both times.
if (base && !process.env.PERF_SECOND && Object.entries(result).some(([k, v]) => isWorse(k, v))) {
  console.log('worse than the baseline: measuring again to confirm')
  spawnSync(process.execPath, [process.argv[1], '--no-build', ...(ONLY_FX ? ['--only=fx'] : []), ...(args.has('--no-pv') ? ['--no-pv'] : []), ...(args.has('--interact') ? ['--interact'] : []), ...(args.has('--no-interact') ? ['--no-interact'] : []), ...(TL_ARG ? [TL_ARG] : [])], { stdio: 'ignore', env: { ...process.env, PERF_SECOND: '1' } })
  const second = JSON.parse(readFileSync(LAST, 'utf8')).metrics
  for (const [k, v] of Object.entries(result)) {
    const w = second[k]
    if (v?.median === undefined || w?.median === undefined) continue
    const better = v.unit === 'fps' ? w.median > v.median : w.median < v.median
    if (better) result[k] = { ...w, firstRun: v.median }
  }
  writeFileSync(LAST, JSON.stringify({ ...record, metrics: result, note: 'better of two runs per number' }, null, 1) + '\n')
}
let worse = 0
console.log(`${'metric'.padEnd(30)} ${'now'.padStart(10)} ${base ? 'baseline'.padStart(10) + '   change' : ''}`)
for (const [k, v] of Object.entries(result)) {
  if (v?.median === undefined) { console.log(`${k.padEnd(30)} ${JSON.stringify(v)}`); continue }
  const b = base?.metrics[k]?.median
  let mark = ''
  if (b !== undefined) {
    const bad = isWorse(k, v)
    if (bad) worse++
    mark = `${(b).toFixed(2).padStart(10)} ${((v.median / b - 1) * 100).toFixed(0).padStart(6)} %${bad ? '  WORSE' : ''}`
  }
  console.log(`${k.padEnd(30)} ${v.median.toFixed(2).padStart(10)} ${v.unit.padEnd(3)} ${mark}`)
}
console.log(args.has('--baseline') ? `baseline written: ${BASE}` : base ? `${worse} worse than the baseline by more than 20 %` : 'no baseline yet (npm run perf -- --baseline)')
// The timeline's targets (phase 3c.T): said, not a reason to fail the run (on
// a busy machine a percentile of frame times moves; the baseline rule above is
// what fails it).
const missed = Object.entries(result).filter(([, v]) => v?.target === 'missed').map(([k, v]) => `${k} (p95 ${v.p95} ms, ${v.over} over)`)
if (Object.values(result).some((v) => v?.target)) console.log(missed.length ? `timeline frame targets missed: ${missed.join('; ')}` : 'timeline frame targets: all met')
// Phase 5b: two transparent overlays, median frame draw ≤ ALPHA2_MAX_MS.
let over = 0
for (const [k, v] of Object.entries(result)) {
  if (!k.startsWith('frame.alpha2.') || v?.median === undefined) continue
  const ok = v.median <= ALPHA2_MAX_MS
  if (!ok) over++
  console.log(`${k}: ${v.median.toFixed(2)} ms ${ok ? '<=' : '>'} ${ALPHA2_MAX_MS} ms ${ok ? 'ok' : 'TOO SLOW'}`)
}
// "Cila" part D: the pixel pass's budget (tarifler\CILA.md, "Hız bütçesi").
const plainFps = result['export.fps.fx.none']?.median
for (const [k, v] of Object.entries(result)) {
  if (v?.median === undefined) continue
  let ok = true, say = ''
  if (k.startsWith('frame.fx.')) { ok = v.median <= FX_FRAME_MAX_MS; say = `${v.median.toFixed(2)} ms ${ok ? '<=' : '>'} ${FX_FRAME_MAX_MS} ms` }
  else if (k === 'drag.glow.p95') { ok = v.median <= FX_DRAG_MAX_MS; say = `${v.median.toFixed(2)} ms ${ok ? '<=' : '>'} ${FX_DRAG_MAX_MS} ms` }
  else if (k.startsWith('export.fps.fx.') && k !== 'export.fps.fx.none' && (v.plain ?? plainFps)) { const plain = v.plain ?? plainFps; const drop = 1 - v.median / plain; ok = drop <= FX_EXPORT_DROP; say = `${v.median.toFixed(1)} fps against the plain clip's ${plain.toFixed(1)} beside it: ${Math.abs(drop * 100).toFixed(0)} % ${drop > 0 ? 'slower' : 'faster'} (at most ${FX_EXPORT_DROP * 100} % slower)` }
  else continue
  if (!ok) over++
  console.log(`${k}: ${say} ${ok ? 'ok' : 'OVER BUDGET'}`)
}
process.exit(worse || over ? 1 : 0)
