// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// Phase Ç3a: the export measurement rig (FAZC3A-PLAN.md, "The rig").
//
// node scripts/export-rig/run.mjs <task>[,<task>…] [--label=<name>] [--keep]
//
//   caps     VideoEncoder.isConfigSupported for every size × rate × codec the
//            capability table names, with prefer-hardware and prefer-software
//            (and what the app itself would ask today)
//   matrix   a 4 s export of a counter source per cell of the capability
//            table: the file read back (size, rate, time base, frame count,
//            constant spacing, level, colour tags), the counter read back
//            (repeats / skips), frames a second
//   edges    the 8K line grid and checker in a 1080p project, exported at
//            1080p, 4K, 1080×1920 and 2160×3840 (Shorts): the edges' 10–90 %
//            width; and the zone plate at 1080p (aliasing)
//   fx       freeze and reversed 4K clips against the same clip played
//            forward (frames a second), and the file's last frame reached
//
// The app is started off-screen with a profile of its own (scripts/e2e),
// driven over CDP, and closed at the end. Results: testdata\cikti\rig-<label>.json
// (the exported files are deleted once read, unless --keep).
import { existsSync, mkdirSync, rmSync, writeFileSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { launchApp } from '../e2e/app.mjs'
import * as lib from '../e2e/lib.mjs'
import { makeSources, KAYNAK, CIKTI, TESTDATA as TESTDATA_DIR, APP_DIR } from './sources.mjs'
import { probeFile, checkFile, readCounter, counterReport, grayFrame, edgeWidth } from './analyze.mjs'
import { C3B } from './tasks-c3b.mjs'

const args = Object.fromEntries(process.argv.slice(3).map((a) => { const [k, v] = a.replace(/^--/, '').split('='); return [k, v ?? true] }))
const tasks = (process.argv[2] ?? 'caps').split(',')
const label = args.label ?? 'son'
const keep = !!args.keep
const only = args.only ? new RegExp(args.only) : null
const SECONDS = Number(args.seconds ?? 4)
makeSources()
mkdirSync(CIKTI, { recursive: true })
const resultsFile = join(CIKTI, `rig-${label}.json`)
const results = existsSync(resultsFile) ? JSON.parse(readFileSync(resultsFile, 'utf8')) : {}
const save = () => writeFileSync(resultsFile, JSON.stringify(results, null, 1))

export const SIZES = [[1920, 1080], [2560, 1440], [3840, 2160], [1080, 1920], [2160, 3840]]
export const RATES = [[24, 1], [25, 1], [30, 1], [50, 1], [60, 1], [24000, 1001], [30000, 1001], [60000, 1001]]

const app = await launchApp({ agent: false })
const c = app.cdp
const say = (...a) => console.log(...a)
try {
  await lib.ready(c)
  // The window's own facts: the GPU, what it draws with.
  results.window = await c.run(() => {
    const g = document.createElement('canvas').getContext('webgl2')
    const dbg = g?.getExtension('WEBGL_debug_renderer_info')
    return { gpu: dbg ? g.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : null, ua: navigator.userAgent }
  })
  say('window:', JSON.stringify(results.window))
  for (const task of tasks) {
    if (task === 'caps') await caps()
    else if (task === 'matrix') await matrix()
    else if (task === 'edges') await edges()
    else if (task === 'fx') await fx()
    else if (task === 'fxpaths') await fxpaths()
    else if (task === 'codefilm') await codefilm()
    else if (task === 'decode') await decode()
    else if (task === 'rates') await rates()
    else if (task === 'exact') await exact()
    else if (task === 'level') await level()
    else if (C3B[task]) await C3B[task]({ c, app, lib, results, save, say, keep, only, args })
    else throw new Error('unknown task ' + task)
    save()
  }
} finally {
  await app.close()
}
say('results:', resultsFile)

// ---------------------------------------------------------------------------

/** mediabunny's own AVC codec string (High, level by macroblocks and bitrate
 *  only: what the export asks today, codec.js buildVideoCodecString). */
async function caps() {
  const sizes = [...SIZES, [960, 540]]
  results.caps = await c.run(async (sizes, rates) => {
    const out = []
    const lvl = [[10, 99, 64e3], [11, 396, 192e3], [12, 396, 384e3], [13, 396, 768e3], [20, 396, 2e6], [21, 792, 4e6], [22, 1620, 4e6], [30, 1620, 10e6], [31, 3600, 14e6], [32, 5120, 20e6], [40, 8192, 20e6], [41, 8192, 50e6], [42, 8704, 50e6], [50, 22080, 135e6], [51, 36864, 240e6], [52, 36864, 240e6], [60, 139264, 240e6], [61, 139264, 480e6], [62, 139264, 800e6]]
    const mbString = (w, h, br) => {
      const mbs = Math.ceil(w / 16) * Math.ceil(h / 16)
      const l = lvl.find(([, m, b]) => mbs <= m && br <= b) ?? lvl[lvl.length - 1]
      return 'avc1.6400' + l[0].toString(16).padStart(2, '0')
    }
    const ex = await window.__exporter()
    void ex
    const bitrateOf = (w, h, fps) => Math.min(60e6, Math.max(4e6, Math.round(w * h * fps * 0.12)))
    for (const [w, h] of sizes) {
      for (const [n, d] of rates) {
        const fps = n / d
        const bitrate = bitrateOf(w, h, fps)
        const row = { w, h, fps: `${n}/${d}`, bitrate }
        for (const codec of ['avc', 'vp9']) {
          const str = codec === 'avc' ? mbString(w, h, bitrate) : 'vp09.00.40.08'
          for (const hw of ['no-preference', 'prefer-hardware', 'prefer-software']) {
            let ok = false, why = ''
            try {
              const r = await VideoEncoder.isConfigSupported({ codec: str, width: w, height: h, bitrate, framerate: fps, hardwareAcceleration: hw })
              ok = !!r.supported
            } catch (e) {
              why = String(e).slice(0, 80)
            }
            row[`${codec}.${hw}`] = ok ? 'yes' : why ? `error ${why}` : 'no'
          }
          row[`${codec}.string`] = str
        }
        out.push(row)
      }
    }
    return out
  }, sizes, RATES)
  for (const r of results.caps) say(`${r.w}×${r.h} ${r.fps.padEnd(10)} avc ${r['avc.string']} hw:${r['avc.prefer-hardware']} sw:${r['avc.prefer-software']} np:${r['avc.no-preference']} | vp9 hw:${r['vp9.prefer-hardware']} sw:${r['vp9.prefer-software']}`)
}

/** Imports files the test way and returns their assets. */
async function seed(files) {
  await lib.reset(c)
  return lib.seedAssets(app, c, files)
}

/** A project of `w`×`h` at `fps` holding `clips` ({ assetId, start, duration,
 *  freeze?, reversed?, inPoint?, speed? }), each fitted (contain) and centred. */
async function setProject({ w, h, fps, mode = 'frame', clips, captions = [] }) {
  return c.run((w, h, fps, mode, clips, captions) => {
    const S = window.__store
    const p = structuredClone(S.getState().project)
    p.settings = { ...p.settings, width: w, height: h, fps }
    p.mode = mode
    p.tracks = [{ id: 'V1', kind: 'video', name: 'V1', clipIds: clips.map((_, i) => `c${i}`) }, { id: 'A1', kind: 'audio', name: 'A1', clipIds: [] }]
    p.clips = {}
    clips.forEach((k, i) => {
      const a = p.assets.find((x) => x.id === k.assetId)
      const fit = Math.min(w / a.width, h / a.height)
      p.clips[`c${i}`] = { id: `c${i}`, assetId: a.id, trackId: 'V1', start: k.start ?? 0, inPoint: k.inPoint ?? 0, duration: k.duration, transform: { x: w / 2, y: h / 2, scale: fit, rotation: 0 }, volume: 1, ...(k.freeze !== undefined ? { freeze: k.freeze } : {}), ...(k.reversed ? { reversed: true } : {}), ...(k.speed ? { speed: k.speed } : {}) }
    })
    p.captions = captions
    p.templates = []
    S.getState().loadProject(p)
    S.setState({ selectedClipIds: [], playing: false })
    const a0 = p.assets.find((x) => x.id === clips[0].assetId)
    const fit = Math.min(w / a0.width, h / a0.height)
    return { rect: { x: (w - a0.width * fit) / 2, y: (h - a0.height * fit) / 2, w: a0.width * fit, h: a0.height * fit } }
  }, w, h, fps, mode, clips, captions)
}

/** Exports the store's project to `file` with `settings`; returns the
 *  seconds the frames took (from the first frame drawn to the end), the
 *  whole time and the frame count, or { error }. */
async function exportTo(file, settings) {
  rmSync(file, { force: true })
  return c.run(async (file, settings) => {
    const ex = await window.__exporter()
    const p = window.__store.getState().project
    await window.api.testChooseSave(file)
    await ex.preloadImagesForExport(p)
    const t0 = performance.now()
    let first = 0, frames = 0, enc = null
    const notes = []
    try {
      await ex.exportProjectMp4(p, {
        settings,
        toPath: file,
        onEncoder: (e) => (enc = e),
        onProgress: (_f, label) => {
          const m = /Drawing frame (\d+) of (\d+)/.exec(label)
          if (m) {
            if (!first) first = performance.now()
            frames = Number(m[2])
          } else if (!/Mixing|Encoding the sound|Writing|Checking|Starting|Loading/.test(label)) notes.push(label)
        }
      })
    } catch (e) {
      return { error: String(e && e.message ? e.message : e).slice(0, 300) }
    }
    const t1 = performance.now()
    return { seconds: (t1 - first) / 1000, total: (t1 - t0) / 1000, frames, fps: frames / ((t1 - first) / 1000), notes, ...(enc ? { hw: enc.hw, codecString: enc.codecString, asked: enc.bitrate } : {}) }
  }, file, settings)
}

async function matrix() {
  const [src1080, src2160] = await seed([join(KAYNAK, 'sayac-1080p60.mp4'), join(KAYNAK, 'sayac-2160p30.mp4')])
  results.matrix = results.matrix ?? {}
  const cells = []
  for (const [w, h] of SIZES) for (const [n, d] of RATES) cells.push({ w, h, n, d, codec: 'avc' })
  cells.push({ w: 1920, h: 1080, n: 30, d: 1, codec: 'vp9' }, { w: 3840, h: 2160, n: 30, d: 1, codec: 'vp9' })
  for (const cell of cells) {
    const key = `${cell.w}x${cell.h}@${cell.n}/${cell.d}.${cell.codec}`
    if (only && !only.test(key)) continue
    const big = Math.max(cell.w, cell.h) >= 2560
    const src = big ? src2160 : src1080
    const srcFps = big ? 30 : 60
    const fps = cell.n / cell.d
    // A project the output's shape: 1920×1080 (or 1080×1920) scaled up.
    const tall = cell.h > cell.w
    const pw = tall ? 1080 : 1920, ph = tall ? 1920 : 1080
    const { rect } = await setProject({ w: pw, h: ph, fps, clips: [{ assetId: src.id, duration: SECONDS + 1 }] })
    const scale = Math.min(cell.w, cell.h) / Math.min(pw, ph)
    const file = join(CIKTI, `rig-${key.replace(/[/@]/g, '_')}.${cell.codec === 'vp9' ? 'webm' : 'mp4'}`)
    say('export', key)
    const run = await exportTo(file, { container: cell.codec === 'vp9' ? 'webm' : 'mp4', resolutionScale: scale, fps, bitrateFactor: 0.12, target: 'landscape', normalize: false, range: [0, SECONDS] })
    const row = { ...run }
    if (!run.error && existsSync(file)) {
      const info = probeFile(file)
      Object.assign(row, checkFile(info, { w: cell.w, h: cell.h, num: cell.n, den: cell.d, seconds: SECONDS }))
      const r = { x: rect.x * scale, y: rect.y * scale, w: rect.w * scale, h: rect.h * scale }
      const seq = readCounter(file, r)
      row.counter = counterReport(seq, srcFps, fps)
      row.bytes = statSync(file).size
      if (!keep) rmSync(file, { force: true })
    }
    results.matrix[key] = row
    save()
    say(' ', JSON.stringify(row))
  }
}

async function edges() {
  const [grid, zone] = await seed([join(KAYNAK, 'izgara-8k.png'), join(KAYNAK, 'zoneplate-4000.png')])
  results.edges = results.edges ?? {}
  const jobs = [
    ['1080p', 'frame', 1, 'landscape', 1920, 1080],
    ['2160p', 'frame', 2, 'landscape', 3840, 2160],
    ['1080x1920 shorts', 'shorts', 1, 'shorts', 1080, 1920],
    ['2160x3840 shorts', 'shorts', 2, 'shorts', 2160, 3840]
  ]
  for (const [name, mode, scale, target, ow, oh] of jobs) {
    if (only && !only.test(name)) continue
    await setProject({ w: 1920, h: 1080, fps: 30, mode, clips: [{ assetId: grid.id, duration: 2 }] })
    const file = join(CIKTI, `rig-edges-${name.replace(/\W+/g, '_')}.mp4`)
    const run = await exportTo(file, { container: 'mp4', resolutionScale: scale, fps: 30, bitrateFactor: 0.2, target, normalize: false, range: [0, 0.5] })
    const row = { ...run }
    if (!run.error) {
      const g = grayFrame(file, 0.1)
      row.size = `${g.w}×${g.h}`
      // The checker (the image's bottom half): rows 60–95 % of the frame.
      row.edge = edgeWidth(g, { x: 0, y: Math.round(oh * 0.6), w: ow, h: Math.round(oh * 0.35) })
      if (!keep) rmSync(file, { force: true })
    }
    results.edges[name] = row
    save()
    say(name, JSON.stringify(row))
  }
  // Aliasing: the zone plate at 1080p, the spread of the pixels where the
  // plate is finer than the output can show (an ideal filter leaves grey).
  if (!only || only.test('zone')) {
    await setProject({ w: 1920, h: 1080, fps: 30, clips: [{ assetId: zone.id, duration: 2 }] })
    const file = join(CIKTI, 'rig-edges-zone.mp4')
    const run = await exportTo(file, { container: 'mp4', resolutionScale: 1, fps: 30, bitrateFactor: 0.2, target: 'landscape', normalize: false, range: [0, 0.5] })
    if (!run.error) {
      const g = grayFrame(file, 0.1)
      const s = 1080 / 4000
      let sum = 0, sq = 0, n = 0
      for (let y = 0; y < g.h; y++) for (let x = 0; x < g.w; x++) {
        const R = Math.hypot(x - 960, y - 540)
        if (R < 700 * s * 1.0 + 0 || R > 1900 * s) continue
        const v = g.px[y * g.w + x]
        sum += v
        sq += v * v
        n++
      }
      const mean = sum / n
      run.aliasStd = +Math.sqrt(sq / n - mean * mean).toFixed(2)
      run.aliasMean = +mean.toFixed(1)
      if (!keep) rmSync(file, { force: true })
    }
    results.edges.zone = run
    save()
    say('zone', JSON.stringify(run))
  }
}

/** A clip's look (R12) and the CPU effect pass (R20) in a 4K export: the
 *  grid's edges with and without them. The CPU pass is forced by a page
 *  whose WebGL2 is switched off before anything asks for it (test only). */
async function fxpaths() {
  results.fxpaths = results.fxpaths ?? {}
  const jobs = [
    ['plain', {}, false],
    ['look', { look: { grain: 0, weave: 0, halation: 0, fade: 0.3, flicker: 0, dust: 0, mono: 0, vignette: 0.2, vShape: 'round', vMotion: 'still', vSpeed: 1, bars: 0, gate: 0 } }, false],
    ['vignette (GPU pass)', { vignette: 0.2 }, false],
    ['vignette (CPU pass)', { vignette: 0.2 }, true]
  ]
  for (const [name, extra, noGl] of jobs) {
    if (only && !only.test(name)) continue
    const [grid] = await seed([join(KAYNAK, 'izgara-8k.png')])
    if (noGl) await c.run(() => {
      const get = HTMLCanvasElement.prototype.getContext
      HTMLCanvasElement.prototype.getContext = function (kind, ...a) {
        return kind === 'webgl2' ? null : get.call(this, kind, ...a)
      }
      return true
    })
    await setProject({ w: 1920, h: 1080, fps: 30, clips: [{ assetId: grid.id, duration: 2 }] })
    await c.run((extra) => {
      const S = window.__store
      const p = structuredClone(S.getState().project)
      Object.assign(p.clips.c0, extra)
      S.getState().loadProject(p)
      return true
    }, extra)
    const file = join(CIKTI, `rig-fxpaths-${name.replace(/\W+/g, '_')}.mp4`)
    const run = await exportTo(file, { container: 'mp4', resolutionScale: 2, fps: 30, bitrateFactor: 0.2, target: 'landscape', normalize: false, range: [0, 0.5] })
    const row = { ...run }
    if (!run.error) {
      const g = grayFrame(file, 0.1)
      // The checker, away from the vignette's dark corners.
      row.edge = edgeWidth(g, { x: Math.round(g.w * 0.25), y: Math.round(g.h * 0.6), w: Math.round(g.w * 0.5), h: Math.round(g.h * 0.25) })
      if (!keep) rmSync(file, { force: true })
    }
    results.fxpaths[name] = row
    save()
    say(name, JSON.stringify(row))
  }
}

/** Decision 10 (R4): a code film of slanted edges declared 1920×1080, in a
 *  1080p project, exported at 1080p and at 4K: how much softer at 4K. */
async function codefilm() {
  results.codefilm = results.codefilm ?? {}
  await lib.reset(c)
  const folder = join(KAYNAK, 'kod-izgara')
  const filmId = await c.run(async (folder) => {
    const info = await window.api.codeFilm.register(folder)
    const [films, imp] = await window.__codeFilm()
    const res = await imp.codeFilmImport(info)
    const S = window.__store
    const added = S.getState().addAssets(res.assets)
    const film = added.find((a) => a.kind === 'code') ?? res.assets.find((a) => a.kind === 'code')
    films.codeFilms.ensure(film)
    return film.id
  }, folder)
  for (const [name, scale] of [['1080p', 1], ['2160p', 2]]) {
    await setProject({ w: 1920, h: 1080, fps: 30, clips: [{ assetId: filmId, duration: 2 }] })
    const file = join(CIKTI, `rig-codefilm-${name}.mp4`)
    const run = await exportTo(file, { container: 'mp4', resolutionScale: scale, fps: 30, bitrateFactor: 0.2, target: 'landscape', normalize: false, range: [0, 0.5] })
    const row = { ...run }
    if (!run.error) {
      const g = grayFrame(file, 0.1)
      row.edge = edgeWidth(g, { x: Math.round(g.w * 0.1), y: Math.round(g.h * 0.1), w: Math.round(g.w * 0.8), h: Math.round(g.h * 0.8) })
      if (!keep) rmSync(file, { force: true })
    }
    results.codefilm[name] = row
    save()
    say('codefilm', name, JSON.stringify(row))
  }
}

/** Decision 6 (R13): files this computer may not decode: the import's badge
 *  and the export's refusal (before the sound is mixed, naming the file). */
async function decode() {
  results.decode = results.decode ?? {}
  for (const name of ['cozulmez-prores.mov', 'hevc10.mp4', 'sayac-25.mp4']) {
    const [a] = await seed([join(KAYNAK, name)])
    const flag = await c.st((s, id) => !!s.project.assets.find((x) => x.id === id)?.undecodable, a.id)
    await setProject({ w: 1920, h: 1080, fps: 30, clips: [{ assetId: a.id, duration: 1 }] })
    const file = join(CIKTI, `rig-decode-${name.replace(/\W+/g, '_')}.mp4`)
    const run = await c.run(async (file) => {
      const ex = await window.__exporter()
      const p = window.__store.getState().project
      await window.api.testChooseSave(file)
      const labels = []
      try {
        await ex.exportProjectMp4(p, { settings: { container: 'mp4', resolutionScale: 1, fps: 30, bitrateFactor: 0.12, target: 'landscape', range: [0, 0.5] }, toPath: file, onProgress: (_f, l) => labels.push(l) })
        return { ok: true, mixed: labels.some((l) => /Mixing/.test(l)) }
      } catch (e) {
        return { error: String(e.message ?? e), mixed: labels.some((l) => /Mixing/.test(l)) }
      }
    }, file)
    run.partLeft = existsSync(file + '.part')
    if (!keep) rmSync(file, { force: true })
    results.decode[name] = { badge: flag, ...run }
    save()
    say('decode', name, JSON.stringify(results.decode[name]))
  }
}

/** Decision 4 (R14): NTSC and PAL counters exported at their own rate and
 *  at the near whole one; the project's rate from the first video. */
async function rates() {
  results.rates = results.rates ?? {}
  const jobs = [
    ['sayac-2997.mp4', 30000 / 1001, [30000, 1001], 30000 / 1001],
    ['sayac-2997.mp4', 30000 / 1001, [30, 1], 30],
    ['sayac-25.mp4', 25, [25, 1], 25],
    ['sayac-25.mp4', 25, [50, 1], 50],
    ['sayac-25.mp4', 25, [24, 1], 24]
  ]
  for (const [src, srcFps, [n, d], outFps] of jobs) {
    const key = `${src}@${n}/${d}`
    if (only && !only.test(key)) continue
    await lib.reset(c)
    const before = await c.st((s) => s.project.settings.fps)
    const [a] = await lib.seedAssets(app, c, [join(KAYNAK, src)])
    const after = await c.st((s) => s.project.settings.fps)
    const { rect } = await setProject({ w: 1920, h: 1080, fps: outFps, clips: [{ assetId: a.id, duration: 9.9 }] })
    const file = join(CIKTI, `rig-rates-${key.replace(/[/@.]/g, '_')}.mp4`)
    const secs = 8
    const run = await exportTo(file, { container: 'mp4', resolutionScale: 1, fps: outFps, bitrateFactor: 0.12, target: 'landscape', normalize: false, range: [0, secs] })
    const row = { projectRate: { before, afterImport: after }, ...run }
    if (!run.error) {
      Object.assign(row, checkFile(probeFile(file), { w: 1920, h: 1080, num: n, den: d, seconds: secs }))
      row.counter = counterReport(readCounter(file, rect), srcFps, outFps)
      if (!keep) rmSync(file, { force: true })
    }
    results.rates[key] = row
    save()
    say('rates', key, JSON.stringify(row))
  }
}

/** Decision 5 (R8, K12): the export's frame (its probe PNG) against
 *  renderFrame drawing the same project at the same time from frames read
 *  one by one (the preview's way: random access, the original pictures),
 *  at 1080p and 4K, landscape and Shorts; 12 times over clip kinds: video
 *  with keyed position and scale, a wipe, a picture with a mask, a mix, a
 *  reversed video, a freeze, a screen-blended picture with keyed opacity, a
 *  code film, an adjustment layer, a template, subtitles (one with keyed
 *  motion on a tracker). PSNR (dB) per time. */

async function exact() {
  const EXACT_TIMES = [0.5, 2.6, 2.95, 3 + 1 / 30, 4.0, 5.6, 6.0, 6.6, 8.0, 9.0, 10.5, 11.9]
  results.exact = results.exact ?? {}
  const E2E = join(TESTDATA_DIR, 'e2e')
  const [talk, other, n1, n2] = await seed([join(E2E, 'talk.mp4'), join(E2E, 'other.mp4'), join(E2E, 'numbered', '1.png'), join(E2E, 'numbered', '2.png')])
  const film = join(APP_DIR, 'scripts', 'qa', 'reference', 'film-demo')
  const block = JSON.parse(readFileSync(join(APP_DIR, 'scripts', 'qa', 'reference', 'tpl-blocks.json'), 'utf8'))[0]
  // (Phase Ç3b: and a compound clip, the picture-in-picture and the code film
  // grouped, at 1080p: its children drawn through the compound's own frame.)
  for (const [name, mode, scale, compound] of [['1920x1080', 'frame', 1, false], ['3840x2160', 'frame', 2, false], ['1080x1920 shorts', 'shorts', 1, false], ['2160x3840 shorts', 'shorts', 2, false], ['1920x1080 compound', 'frame', 1, true]]) {
    if (only && !only.test(name)) continue
    const row = await c.run(async (ids, film, block, mode, scale, times, compound) => {
      const S = window.__store
      const ex = await window.__exporter()
      const R = await window.__render()
      const M = await window.__sources()
      const [films, imp] = await window.__codeFilm()
      // The code film, imported the app's way.
      let code = S.getState().project.assets.find((a) => a.kind === 'code')
      if (!code) {
        const info = await window.api.codeFilm.register(film)
        const res = await imp.codeFilmImport(info)
        code = S.getState().addAssets(res.assets).find((a) => a.kind === 'code') ?? res.assets.find((a) => a.kind === 'code')
        films.codeFilms.ensure(code)
      }
      const p = structuredClone(S.getState().project)
      const A = (id) => p.assets.find((a) => a.id === id)
      const W = 1920, H = 1080
      const fit = (a) => Math.min(W / a.width, H / a.height)
      const T = (a, k = 1, x = W / 2, y = H / 2) => ({ x, y, scale: fit(a) * k, rotation: 0 })
      p.settings = { ...p.settings, width: W, height: H, fps: 30 }
      p.mode = mode
      p.tracks = [
        { id: 'V3', kind: 'video', name: 'V3', clipIds: ['adj'] },
        { id: 'V2', kind: 'video', name: 'V2', clipIds: ['pip', 'film'] },
        { id: 'V1', kind: 'video', name: 'V1', clipIds: ['c1', 'c2', 'c3', 'c4'] },
        { id: 'A1', kind: 'audio', name: 'A1', clipIds: [] }
      ]
      const talk = A(ids[0]), other = A(ids[1]), n1 = A(ids[2]), n2 = A(ids[3])
      p.clips = {
        c1: { id: 'c1', assetId: talk.id, trackId: 'V1', start: 0, inPoint: 0, duration: 3, transform: T(talk), volume: 1, channels: { x: [{ id: 'x0', time: 0, value: 900 }, { id: 'x1', time: 3, value: 1060 }], scale: [{ id: 's0', time: 0, value: fit(talk) }, { id: 's1', time: 3, value: fit(talk) * 1.25 }] }, transitionOut: { type: 'wipe', duration: 0.6, to: 'c2' } },
        c2: { id: 'c2', assetId: n1.id, trackId: 'V1', start: 3, inPoint: 0, duration: 3, transform: T(n1), volume: 1, mask: { enabled: true, shape: 'ellipse', cx: 0, cy: 0, w: 420, h: 260, feather: 18 }, transitionOut: { type: 'mix', duration: 0.6, to: 'c3' } },
        c3: { id: 'c3', assetId: other.id, trackId: 'V1', start: 6, inPoint: 1, duration: 3, transform: T(other), volume: 1, reversed: true },
        c4: { id: 'c4', assetId: talk.id, trackId: 'V1', start: 9, inPoint: 0, duration: 3, transform: T(talk), volume: 1, freeze: 2.0 },
        pip: { id: 'pip', assetId: n2.id, trackId: 'V2', start: 1, inPoint: 0, duration: 4, transform: T(n2, 0.4, 1400, 300), volume: 1, blendMode: 'screen', channels: { opacity: [{ id: 'o0', time: 0, value: 1 }, { id: 'o1', time: 4, value: 0.3 }] } },
        film: { id: 'film', assetId: code.id, trackId: 'V2', start: 6.5, inPoint: 0, duration: 4.5, transform: { x: 560, y: 320, scale: 0.5 * (W / code.width), rotation: 0 }, volume: 1 },
        adj: { id: 'adj', assetId: '', trackId: 'V3', start: 2, inPoint: 0, duration: 5, transform: { x: W / 2, y: H / 2, scale: 1, rotation: 0 }, volume: 1, adjustment: true, grade: { brightness: 1.15, contrast: 1.1, saturation: 0.8, warmth: 0.2 } }
      }
      p.trackers = [{ id: 'tk', name: 'tk', keyframes: [{ id: 'k0', time: 7, x: 900, y: 500 }, { id: 'k1', time: 11.5, x: 1150, y: 640 }] }]
      p.captions = [
        { id: 's1', start: 0.5, end: 4.2, text: 'The cat sat by the window', manual: true },
        { id: 's2', start: 7, end: 11.95, text: 'and came back home', manual: true, trackerId: 'tk', kfs: [{ id: 'm0', time: 0, x: 0, y: 0, scale: 1, rot: 0, opacity: 1 }, { id: 'm1', time: 4, x: 300, y: -60, scale: 1.2, rot: 0, opacity: 1 }] }
      ]
      p.captionStyle = { ...p.captionStyle, posX: 0.5 }
      if (mode === 'shorts') {
        p.captionStyleShorts = { ...p.captionStyle, posX: 0.3 }
        p.shorts = { baseX: 960, keyframes: [{ id: 'p0', time: 0, x: 700 }, { id: 'p1', time: 12, x: 1250 }] }
      }
      p.templates = [{ ...block, id: 'tpl', start: 4, duration: 4 }]
      S.getState().loadProject(p)
      if (compound) {
        S.setState({ selectedClipIds: ['pip', 'film'] })
        S.getState().compoundSelection()
      }
      const proj = S.getState().project
      const TY = await window.__types()
      await ex.preloadImagesForExport(proj)
      const shorts = mode === 'shorts'
      const outW = shorts ? 1080 * scale : W * scale
      const outH = shorts ? 1920 * scale : H * scale
      // The export, its probed frames' PNGs.
      const frames = times.map((t) => Math.round(t * 30))
      const pngs = {}
      await ex.exportProjectMp4(proj, { settings: { container: 'mp4', resolutionScale: scale, fps: 30, bitrateFactor: 0.12, target: shorts ? 'shorts' : 'landscape', normalize: false, range: [0, 12], probe: frames, probePng: true }, onProgress() {}, onProbe: (i, h) => (pngs[i] = h.slice(h.indexOf(':') + 1)) })
      // The reference: renderFrame from frames read one by one.
      const images = new Map()
      const imageOf = async (a) => {
        if (!images.has(a.id)) {
          const im = new Image()
          im.crossOrigin = 'anonymous'
          im.src = a.url
          await im.decode()
          images.set(a.id, im)
        }
        return images.get(a.id)
      }
      const reference = async (t) => {
        const byClip = new Map()
        const bitmaps = []
        for (const clip of TY.flattenClips(R.renderList(proj, t).map((e) => e.clip))) {
          const a = proj.assets.find((x) => x.id === clip.assetId)
          if (!a) continue
          const local = R.clipMediaAt(proj, clip, t).time
          if (a.kind === 'image') byClip.set(clip.id, await imageOf(a))
          else if (a.kind === 'code') {
            const b = await films.codeFilms.exactFrame(a, local)
            bitmaps.push(b)
            byClip.set(clip.id, b)
          } else if (a.kind === 'video') {
            const sink = await M.getVideoSink(a, undefined, { original: true })
            const last = await M.lastVideoFrameTime(a)
            const at = Math.min(Math.max(0, local), last ?? Infinity) + 1e-6
            const w = await sink.getCanvas(at)
            const cv = new OffscreenCanvas(w.canvas.width, w.canvas.height)
            cv.getContext('2d').drawImage(w.canvas, 0, 0)
            byClip.set(clip.id, cv)
          }
        }
        const resolve = (clip, a) => byClip.get(clip.id) ?? (a.kind === 'image' ? images.get(a.id) : null) ?? null
        const out = new OffscreenCanvas(outW, outH)
        const g = out.getContext('2d', { alpha: false })
        if (shorts) {
          const k = outH / H
          const full = new OffscreenCanvas(Math.max(outW, Math.round(W * k)), outH)
          R.renderFrame(full.getContext('2d', { alpha: false }), proj, t, resolve, { scale: k, shortsOverlay: false, quality: 'final' })
          const win = R.shortsWindowAt(proj, t)
          const sx = Math.max(0, Math.min(full.width - outW, Math.round((win.cx - win.w / 2) * k)))
          g.drawImage(full, sx, 0, outW, outH, 0, 0, outW, outH)
        } else R.renderFrame(g, proj, t, resolve, { scale, shortsOverlay: false, quality: 'final' })
        for (const b of bitmaps) b.close()
        return g.getImageData(0, 0, outW, outH).data
      }
      const res = []
      for (let k = 0; k < times.length; k++) {
        const t = frames[k] / 30
        const want = await reference(t)
        const bin = atob(pngs[frames[k]])
        const bytes = new Uint8Array(bin.length)
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
        const bmp = await createImageBitmap(new Blob([bytes], { type: 'image/png' }))
        const cv = new OffscreenCanvas(outW, outH)
        const g = cv.getContext('2d')
        g.drawImage(bmp, 0, 0)
        const got = g.getImageData(0, 0, outW, outH).data
        let se = 0, n = 0, worst = 0
        for (let i = 0; i < got.length; i++) {
          if (i % 4 === 3) continue
          const d = got[i] - want[i]
          se += d * d
          n++
          if (Math.abs(d) > worst) worst = Math.abs(d)
        }
        const mse = se / n
        res.push({ t: +t.toFixed(4), psnr: mse === 0 ? 'inf' : +(10 * Math.log10((255 * 255) / mse)).toFixed(2), worst })
      }
      return { size: `${outW}×${outH}`, frames: res, compound: compound ? Object.values(proj.clips).filter((k) => k.nested).length : 0 }
    }, [talk.id, other.id, n1.id, n2.id], film, block, mode, scale, EXACT_TIMES, compound)
    const ps = row.frames.map((f) => (f.psnr === 'inf' ? Infinity : f.psnr))
    row.minPsnr = Math.min(...ps)
    results.exact[name] = row
    save()
    say('exact', name, `min ${row.minPsnr} dB`, JSON.stringify(row.frames))
  }
}

/** R28: the level each encoder writes into its avcC when asked for 5.2
 *  (2160p60), hardware and software: a few frames straight through
 *  WebCodecs, the level byte of the decoder description read back. */
async function level() {
  results.level = await c.run(async () => {
    const out = {}
    for (const hw of ['prefer-hardware', 'prefer-software']) {
      for (const [w, h, fps, codec] of [[3840, 2160, 60, 'avc1.640034'], [1920, 1080, 60, 'avc1.64002a']]) {
        const key = `${w}x${h}@${fps} ${codec} ${hw}`
        try {
          let desc = null
          const enc = new VideoEncoder({ output: (_c, meta) => { if (meta?.decoderConfig?.description && !desc) desc = new Uint8Array(meta.decoderConfig.description.buffer ?? meta.decoderConfig.description) }, error: (e) => (out[key] = 'error ' + e.message) })
          enc.configure({ codec, width: w, height: h, bitrate: 68e6, framerate: fps, hardwareAcceleration: hw, avc: { format: 'avc' } })
          const cv = new OffscreenCanvas(w, h)
          const g = cv.getContext('2d')
          for (let i = 0; i < 5; i++) {
            g.fillStyle = `rgb(${i * 40},100,200)`
            g.fillRect(0, 0, w, h)
            const f = new VideoFrame(cv, { timestamp: (i * 1e6) / fps })
            enc.encode(f, { keyFrame: i === 0 })
            f.close()
          }
          await enc.flush()
          enc.close()
          out[key] = desc ? `level_idc ${desc[3]}` : out[key] ?? 'no description'
        } catch (e) {
          out[key] = 'error ' + String(e.message ?? e)
        }
      }
    }
    return out
  })
  say('level', JSON.stringify(results.level))
}

async function fx() {
  const [src] = await seed([join(KAYNAK, 'sayac-2160p30.mp4')])
  results.fx = results.fx ?? {}
  const kinds = [
    ['forward', {}],
    ['freeze', { freeze: 5 }],
    ['reversed', { reversed: true }],
    ['freeze-last', { freeze: 9.99 }]
  ]
  for (const [name, extra] of kinds) {
    if (only && !only.test(name)) continue
    const { rect } = await setProject({ w: 1920, h: 1080, fps: 30, clips: [{ assetId: src.id, duration: name === 'freeze-last' ? 1 : 10, ...extra }] })
    const file = join(CIKTI, `rig-fx-${name}.mp4`)
    const dur = name === 'freeze-last' ? 1 : SECONDS
    const run = await exportTo(file, { container: 'mp4', resolutionScale: 2, fps: 30, bitrateFactor: 0.12, target: 'landscape', normalize: false, range: [0, dur] })
    const row = { ...run }
    if (!run.error) {
      const seq = readCounter(file, { x: rect.x * 2, y: rect.y * 2, w: rect.w * 2, h: rect.h * 2 })
      row.counterHead = seq.slice(0, 4)
      row.counterTail = seq.slice(-3)
      if (!keep) rmSync(file, { force: true })
    }
    results.fx[name] = row
    save()
    say(name, JSON.stringify(row))
  }
}
