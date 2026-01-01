// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// Phase Ç3b: the rig's sound, sync, memory and robustness tasks
// (FAZC3B-PLAN.md). Called from run.mjs with its context.
//
//   clicks    the ham-10dk rough cut and a 440 Hz tone cut at arbitrary
//             phases: steps over 0.1 within ±2 ms of each cut (WAV and MP4)
//   peak      two full-scale tones summed: the true peak (ffmpeg ebur128)
//   sweep     a 44.1 kHz log sweep exported at 48 kHz: the images (dB)
//   sync      the 30-minute flash + click source at 30 and 60 fps: offsets
//   memory    a 30-minute project (voice, a second long sound, a reversed 4K
//             clip): the page's memory and the time to the first frame
//             (--frames=N cancels after N frames; --scale=2 for 4K)
//   progressui frames a second with the export card shown and without it
//   robust    cancel at 1 / 50 / 99 %, a full disk, a busy / read-only target,
//             Turkish and 300-character paths, minimised, edit during export
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync, chmodSync } from 'node:fs'
import { join } from 'node:path'
import { spawn, spawnSync } from 'node:child_process'
import { KAYNAK, CIKTI, TESTDATA, makeFlashClick, makeAudioSources, ff } from './sources.mjs'
import { samples, clicksAt, truePeak, sweepImages, syncReport, watchMemory, appProcesses } from './sound.mjs'
import { probeFile, checkFile } from './analyze.mjs'

/** Builds a project in the page: settings, tracks [{ id, kind, clips: [{ assetId, start, duration, inPoint?, ...extra }] }]. */
export async function buildProject(c, { w = 1920, h = 1080, fps = 30, tracks, captions = [] }) {
  return c.run((w, h, fps, tracks, captions) => {
    const S = window.__store
    const p = structuredClone(S.getState().project)
    p.settings = { ...p.settings, width: w, height: h, fps }
    p.mode = 'frame'
    p.tracks = []
    p.clips = {}
    let n = 0
    for (const tr of tracks) {
      const ids = []
      for (const k of tr.clips) {
        const a = p.assets.find((x) => x.id === k.assetId)
        const id = k.id ?? `k${n++}`
        const fit = a && a.width ? Math.min(w / a.width, h / a.height) : 1
        p.clips[id] = { id, assetId: k.assetId, trackId: tr.id, start: k.start ?? 0, inPoint: k.inPoint ?? 0, duration: k.duration, transform: { x: w / 2, y: h / 2, scale: fit, rotation: 0 }, volume: k.volume ?? 1, ...(k.extra ?? {}) }
        ids.push(id)
      }
      p.tracks.push({ id: tr.id, kind: tr.kind, name: tr.id, clipIds: ids })
    }
    p.captions = captions
    p.templates = []
    S.getState().loadProject(p)
    S.setState({ selectedClipIds: [], playing: false })
    return true
  }, w, h, fps, tracks, captions)
}

/** Exports the store's project: `settings`, to `file` (streamed), with
 *  `cancelAt` (a fraction or a frame count) and `watch` (a callback given
 *  the first-frame time). Returns timings, notes, the error. */
export async function exportFile(c, file, settings, { cancelAfterFrames = 0, cancelAtFraction = 0, toPath = true, keepTarget = false } = {}) {
  if (!keepTarget) rmSync(file, { force: true })
  return c.run(async (file, settings, cancelAfterFrames, cancelAtFraction, toPath) => {
    const ex = await window.__exporter()
    const p = window.__store.getState().project
    if (toPath) await window.api.testChooseSave(file)
    await ex.preloadImagesForExport(p)
    const ac = new AbortController()
    // What the export says beside its result (exportNote also logs it).
    const said = []
    const warn = console.warn
    console.warn = (...a) => {
      if (typeof a[0] === 'string' && a[0].startsWith('[export] ')) said.push(a[0].slice(9))
      return warn.apply(console, a)
    }
    const t0 = performance.now()
    let first = 0, frames = 0, total = 0, enc = null, lastFrac = 0
    const labels = []
    const marks = []
    let data = null
    try {
      data = await ex.exportProjectMp4(p, {
        settings,
        signal: ac.signal,
        ...(toPath ? { toPath: file } : {}),
        onEncoder: (e) => (enc = e),
        onProgress: (f, label) => {
          lastFrac = f
          const m = /Drawing frame (\d+) of (\d+)/.exec(label)
          if (m) {
            if (!first) first = performance.now()
            frames = Number(m[1])
            total = Number(m[2])
            if (cancelAfterFrames && frames >= cancelAfterFrames) ac.abort()
          } else if (labels[labels.length - 1] !== label) labels.push(label)
          if (marks.length === 0 || performance.now() - marks[marks.length - 1][0] > 2000) marks.push([performance.now(), f])
          if (cancelAtFraction && f >= cancelAtFraction) ac.abort()
        }
      })
    } catch (e) {
      console.warn = warn
      const t1 = performance.now()
      return { notes: said, error: String(e && e.message ? e.message : e).slice(0, 400), cancelled: ac.signal.aborted, firstFrameS: first ? (first - t0) / 1000 : null, frames, total, fps: first ? frames / ((t1 - first) / 1000) : null, lastFrac, labels: labels.slice(-12), progress: marks.map(([t, f]) => [+((t - t0) / 1000).toFixed(1), +f.toFixed(4)]) }
    }
    const t1 = performance.now()
    console.warn = warn
    const notes = said
    return { seconds: (t1 - t0) / 1000, firstFrameS: first ? (first - t0) / 1000 : null, frames: total, fps: first ? total / ((t1 - first) / 1000) : null, labels: labels.slice(-12), notes, bytes: data ? data.byteLength : 0, progress: marks.map(([t, f]) => [+((t - t0) / 1000).toFixed(1), +f.toFixed(4)]), ...(enc ? { hw: enc.hw } : {}) }
  }, file, settings, cancelAfterFrames, cancelAtFraction, toPath)
}

/** A sound-only export (WAV), written to `file` the app's way (the path
 *  made chosen by the test hook). */
export async function exportWav(c, file, settings = {}) {
  rmSync(file, { force: true })
  const r = await c.run(async (file, settings) => {
    const ex = await window.__exporter()
    const p = window.__store.getState().project
    await window.api.testChooseSave(file)
    const notes = []
    const data = await ex.exportProjectMp4(p, { settings: { container: 'wav', ...settings }, onProgress() {} })
    const w = await window.api.writeChosenFile(file, data)
    return { saved: w.saved, error: w.error, bytes: data.byteLength, notes }
  }, file, settings)
  if (!r.saved) throw new Error('wav not written: ' + r.error)
  return file
}

/** A CDP session on the browser itself (window states), and the page's id. */
async function browserSession(port) {
  const ver = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json()
  const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()
  const page = list.find((t) => t.type === 'page')
  const ws = new WebSocket(ver.webSocketDebuggerUrl)
  await new Promise((ok, no) => { ws.onopen = ok; ws.onerror = no })
  let id = 0
  const waiting = new Map()
  ws.onmessage = (m) => {
    const msg = JSON.parse(m.data)
    const w = waiting.get(msg.id)
    if (!w) return
    waiting.delete(msg.id)
    if (msg.error) w[1](new Error(msg.error.message))
    else w[0](msg.result)
  }
  return {
    pageId: page?.id,
    send: (method, params = {}) => new Promise((ok, no) => { const k = ++id; waiting.set(k, [ok, no]); ws.send(JSON.stringify({ id: k, method, params })) }),
    close: () => ws.close()
  }
}

export const C3B = {
  async clicks(ctx) {
    const { c, app, lib, results, save, say, keep } = ctx
    makeAudioSources()
    results.clicks = {}
    // (1) The ham-10dk rough cut (its truth's cuts, one step), 640 × 360.
    await lib.reset(c)
    const [talk] = await lib.seedAssets(app, c, [join(TESTDATA, 'ham', 'ham-10dk-tr.mp4')])
    const truth = JSON.parse(readFileSync(join(TESTDATA, 'ham', 'ham-10dk-tr.truth.json'), 'utf8'))
    await buildProject(c, { w: 640, h: 360, fps: 30, tracks: [{ id: 'V1', kind: 'video', clips: [{ id: 'v', assetId: talk.id, duration: talk.duration }] }, { id: 'A1', kind: 'audio', clips: [] }] })
    const cuts = await c.run((cuts) => {
      const S = window.__store
      S.getState().rippleDeleteMany(cuts)
      const p = S.getState().project
      return Object.values(p.clips).filter((k) => k.trackId === 'V1').map((k) => k.start).filter((t) => t > 0.01).sort((a, b) => a - b)
    }, truth.cuts)
    say('ham-10dk rough cut:', cuts.length, 'cuts')
    const wav = join(CIKTI, 'rig-clicks-ham10.wav')
    await exportWav(c, wav)
    results.clicks.ham10Wav = clicksAt(samples(wav), cuts)
    const mp4 = join(CIKTI, 'rig-clicks-ham10.mp4')
    const run = await exportFile(c, mp4, { container: 'mp4', resolutionScale: 1, fps: 30, bitrateFactor: 0.08, normalize: false })
    results.clicks.ham10Mp4 = { ...clicksAt(samples(mp4), cuts), fps: run.fps, error: run.error, notes: run.notes }
    say('ham10', JSON.stringify(results.clicks.ham10Wav), JSON.stringify({ ...results.clicks.ham10Mp4, worstPerCut: undefined }))
    if (!keep) rmSync(mp4, { force: true }), rmSync(wav, { force: true })
    save()
    // (2) A 440 Hz tone at 0.5 cut into 24 pieces of 0.25 s from arbitrary
    // places (the phase jumps at every cut).
    await lib.reset(c)
    const [tone] = await lib.seedAssets(app, c, [join(KAYNAK, 'ton-440.wav')])
    const pieces = Array.from({ length: 24 }, (_, i) => ({ assetId: tone.id, start: i * 0.25, duration: 0.25, inPoint: +(0.0123 + i * 0.6137).toFixed(4) }))
    await buildProject(c, { w: 640, h: 360, fps: 30, tracks: [{ id: 'V1', kind: 'video', clips: [] }, { id: 'A1', kind: 'audio', clips: pieces }] })
    const toneCuts = pieces.slice(1).map((p) => p.start)
    const twav = join(CIKTI, 'rig-clicks-tone.wav')
    await exportWav(c, twav)
    results.clicks.toneWav = clicksAt(samples(twav), toneCuts)
    const tmp4 = join(CIKTI, 'rig-clicks-tone.mp4')
    await exportFile(c, tmp4, { container: 'mp4', resolutionScale: 1, fps: 30, bitrateFactor: 0.08, normalize: false })
    results.clicks.toneMp4 = clicksAt(samples(tmp4), toneCuts)
    say('tone', JSON.stringify(results.clicks.toneWav), JSON.stringify({ ...results.clicks.toneMp4, worstPerCut: undefined }))
    if (!keep) rmSync(tmp4, { force: true }), rmSync(twav, { force: true })
    save()
  },

  async peak(ctx) {
    const { c, app, lib, results, save, say, keep } = ctx
    makeAudioSources()
    await lib.reset(c)
    const [a, b] = await lib.seedAssets(app, c, [join(KAYNAK, 'ton-997.wav'), join(KAYNAK, 'ton-1503.wav')])
    await buildProject(c, { w: 640, h: 360, fps: 30, tracks: [{ id: 'V1', kind: 'video', clips: [] }, { id: 'A1', kind: 'audio', clips: [{ assetId: a.id, duration: 5 }] }, { id: 'A2', kind: 'audio', clips: [{ assetId: b.id, duration: 5 }] }] })
    results.peak = {}
    const mp4 = join(CIKTI, 'rig-peak.mp4')
    const run = await exportFile(c, mp4, { container: 'mp4', resolutionScale: 1, fps: 30, bitrateFactor: 0.08, normalize: false })
    results.peak.mp4 = { ...truePeak(mp4), notes: run.notes, error: run.error }
    const wav = join(CIKTI, 'rig-peak.wav')
    await exportWav(c, wav)
    results.peak.wav = truePeak(wav)
    // Normalize on as well (its −14 LUFS raise, then the limiter).
    const mp4n = join(CIKTI, 'rig-peak-norm.mp4')
    const runN = await exportFile(c, mp4n, { container: 'mp4', resolutionScale: 1, fps: 30, bitrateFactor: 0.08, normalize: true })
    results.peak.mp4Normalized = { ...truePeak(mp4n), notes: runN.notes }
    say('peak', JSON.stringify(results.peak))
    if (!keep) for (const f of [mp4, wav, mp4n]) rmSync(f, { force: true })
    save()
  },

  async sweep(ctx) {
    const { c, app, lib, results, save, say, keep } = ctx
    makeAudioSources()
    await lib.reset(c)
    const [s] = await lib.seedAssets(app, c, [join(KAYNAK, 'supurme-44k.wav')])
    await buildProject(c, { w: 640, h: 360, fps: 30, tracks: [{ id: 'V1', kind: 'video', clips: [] }, { id: 'A1', kind: 'audio', clips: [{ assetId: s.id, duration: 10 }] }] })
    const wav = join(CIKTI, 'rig-sweep.wav')
    await exportWav(c, wav)
    // The source itself through ffmpeg's own resampler (soxr-like swr, the
    // reference of what a good one leaves).
    const ref = sweepImages(samples(join(KAYNAK, 'supurme-44k.wav')))
    results.sweep = { export: sweepImages(samples(wav)), ffmpegResampled: ref }
    say('sweep', JSON.stringify(results.sweep))
    if (!keep) rmSync(wav, { force: true })
    save()
  },

  async sync(ctx) {
    const { c, app, lib, results, save, say, keep, args } = ctx
    const minutes = Number(args.minutes ?? 30)
    results.sync = results.sync ?? {}
    const jobs = [[30, 48000], [60, 44100]]
    if (args.all) jobs.push([60, 48000], [30, 44100])
    for (const [fps, rate] of jobs) {
      const key = `${minutes}min@${fps}fps/${rate}`
      if (ctx.only && !ctx.only.test(key)) continue
      const src = makeFlashClick(minutes, rate)
      await lib.reset(c)
      const [a] = await lib.seedAssets(app, c, [src])
      await buildProject(c, { w: 320, h: 180, fps, tracks: [{ id: 'V1', kind: 'video', clips: [{ assetId: a.id, duration: a.duration }] }, { id: 'A1', kind: 'audio', clips: [] }] })
      const file = join(CIKTI, `rig-sync-${fps}-${rate}.mp4`)
      say('sync', key, 'exporting')
      const run = await exportFile(c, file, { container: 'mp4', resolutionScale: 1, fps, bitrateFactor: 0.08, normalize: false })
      const row = { ...run, progress: undefined }
      if (!run.error) {
        const info = probeFile(file)
        row.audio = info.a ? { start: info.a.start_time, duration: info.a.duration } : null
        row.video = { nb: info.v?.nb_frames, duration: info.v?.duration }
        row.report = syncReport(file, fps)
        if (!keep) rmSync(file, { force: true })
      }
      results.sync[key] = row
      save()
      say('sync', key, JSON.stringify(row.report ?? row.error))
    }
  },

  async memory(ctx) {
    const { c, app, lib, results, save, say, keep, args } = ctx
    const scale = Number(args.scale ?? 1)
    const frames = Number(args.frames ?? 0)
    const label = args.memlabel ?? `x${scale}${frames ? `-first${frames}` : '-full'}${args.noreverse ? '-noreverse' : ''}`
    const flash = makeFlashClick(30, 48000)
    await lib.reset(c)
    const [talk, bed, k4] = await lib.seedAssets(app, c, [join(TESTDATA, 'ham', 'ham-30dk-en.mp4'), flash, join(KAYNAK, 'sayac-2160p30.mp4')])
    const D = Math.min(talk.duration, bed.duration)
    // The voice and its picture for 30 minutes; a second sound under it for
    // the whole length (the flash file's clicks, at a tenth); a reversed 4K
    // clip on top at one minute (decision 7's 1.1 GB of frames).
    await buildProject(c, {
      w: 1920, h: 1080, fps: 30,
      tracks: [
        { id: 'V2', kind: 'video', clips: args.noreverse ? [] : [{ assetId: k4.id, start: 60, duration: 8, extra: { reversed: true } }] },
        { id: 'V1', kind: 'video', clips: [{ assetId: talk.id, duration: D }] },
        { id: 'A1', kind: 'audio', clips: [{ assetId: bed.id, duration: D, volume: 0.1 }] }
      ]
    })
    const procs = appProcesses(app.proc.pid)
    const watch = watchMemory(procs.map((p) => p.pid))
    const file = join(CIKTI, `rig-memory-${label}.mp4`)
    say('memory', label, 'exporting', D.toFixed(0), 's', procs.map((p) => `${p.type}:${p.pid}`).join(' '))
    const t0 = Date.now()
    const run = await exportFile(c, file, { container: 'mp4', resolutionScale: scale, fps: 30, bitrateFactor: 0.12, normalize: false }, { cancelAfterFrames: frames })
    const peak = watch.stop()
    const row = { label, scale, frames, wallS: (Date.now() - t0) / 1000, ...run, procs, peakMB: Object.fromEntries(procs.map((p) => [`${p.type}${p.utility ? ':' + p.utility : ''}:${p.pid}`, peak[p.pid] ?? null])), series: watch.series.filter((_, i) => i % 5 === 0) }
    if (!run.error && existsSync(file)) {
      const info = probeFile(file)
      row.file = { bytes: statSync(file).size, ...checkFile(info, { w: 1920 * scale, h: 1080 * scale, num: 30, den: 1, seconds: D }), audio: info.a ? { duration: info.a.duration, start: info.a.start_time } : null }
      if (!keep) rmSync(file, { force: true })
    }
    rmSync(file + '.part', { force: true })
    results.memory = results.memory ?? {}
    results.memory[label] = row
    save()
    say('memory', label, JSON.stringify({ ...row, series: undefined, progress: undefined, procs: undefined }))
  },

  async robust(ctx) {
    const { c, app, lib, results, save, say, args } = ctx
    results.robust = results.robust ?? {}
    const R = results.robust
    const put = (k, v) => {
      R[k] = v
      save()
      say('robust', k, JSON.stringify(v))
    }
    await lib.reset(c)
    const [src, k4] = await lib.seedAssets(app, c, [join(KAYNAK, 'sayac-1080p60.mp4'), join(KAYNAK, 'sayac-2160p30.mp4')])
    const project20 = () => buildProject(c, { w: 1920, h: 1080, fps: 30, tracks: [{ id: 'V1', kind: 'video', clips: [{ assetId: src.id, duration: 10 }, { assetId: src.id, start: 10, duration: 10 }] }, { id: 'A1', kind: 'audio', clips: [] }] })
    await project20()
    const base = { container: 'mp4', resolutionScale: 1, fps: 30, bitrateFactor: 0.12, normalize: false }
    const want = (k) => !ctx.only || ctx.only.test(k)
    const after = async (file) => {
      await new Promise((r) => setTimeout(r, 1500))
      return { part: existsSync(file + '.part'), file: existsSync(file) }
    }
    // Cancel at 1 / 50 / 99 %, then a second export at once.
    for (const at of [0.01, 0.5, 0.99]) {
      const k = `cancel-${Math.round(at * 100)}`
      if (!want(k)) continue
      const file = join(CIKTI, `rig-robust-${k}.mp4`)
      // (99 %: by the frames drawn, 594 of 600; the bar's last percent is the file's writing.)
      const r = await exportFile(c, file, base, at > 0.9 ? { cancelAfterFrames: 594 } : { cancelAtFraction: at })
      const left = await after(file)
      const again = join(CIKTI, `rig-robust-${k}-again.mp4`)
      const r2 = await exportFile(c, again, { ...base, range: [0, 2] })
      put(k, { cancelled: r.cancelled, error: r.error?.slice(0, 80), lastFrac: r.lastFrac, partLeft: left.part, fileLeft: left.file, secondOk: !r2.error && existsSync(again), secondError: r2.error })
      rmSync(file, { force: true })
      rmSync(again, { force: true })
    }
    // A full disk: 100 MB, then the writes fail (the test hook in main).
    if (want('disk-full')) {
      await buildProject(c, { w: 1920, h: 1080, fps: 30, tracks: [{ id: 'V1', kind: 'video', clips: [{ assetId: k4.id, duration: 10 }, { assetId: k4.id, start: 10, duration: 10 }, { assetId: k4.id, start: 20, duration: 10 }] }, { id: 'A1', kind: 'audio', clips: [] }] })
      const file = join(CIKTI, 'rig-robust-full.mp4')
      await c.run(() => window.api.testDiskFault({ fullAfter: 100 * 2 ** 20 }))
      const r = await exportFile(c, file, { ...base, resolutionScale: 2 })
      await c.run(() => window.api.testDiskFault({}))
      put('disk-full', { error: r.error, frames: r.frames, ...(await after(file)) })
      // The precheck: 50 MB free for a film of about 170 MB.
      await c.run(() => window.api.testDiskFault({ free: 50 * 2 ** 20 }))
      const r2 = await exportFile(c, file, { ...base, resolutionScale: 2 })
      await c.run(() => window.api.testDiskFault({}))
      put('disk-precheck', { error: r2.error, frames: r2.frames, firstFrameS: r2.firstFrameS, ...(await after(file)) })
      rmSync(file, { force: true })
      await project20()
    }
    // A target open in another program (an exclusive handle, as a player
    // that locks its file): refused before anything is drawn.
    if (want('busy')) {
      const file = join(CIKTI, 'rig-robust-busy.mp4')
      writeFileSync(file, 'old')
      const holder = spawn('powershell', ['-NoProfile', '-Command', `$f=[System.IO.File]::Open('${file}','Open','Read','None'); Start-Sleep -Seconds 60; $f.Close()`], { windowsHide: true, stdio: 'ignore' })
      await new Promise((r) => setTimeout(r, 2500))
      const r = await exportFile(c, file, { ...base, range: [0, 2] }, { keepTarget: true })
      spawnSync('taskkill', ['/PID', String(holder.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true })
      await new Promise((r) => setTimeout(r, 500))
      put('busy', { error: r.error, frames: r.frames, ...(await after(file)) })
      rmSync(file, { force: true })
    }
    // A read-only target: replaced.
    if (want('readonly')) {
      const file = join(CIKTI, 'rig-robust-readonly.mp4')
      writeFileSync(file, 'old')
      chmodSync(file, 0o444)
      const r = await exportFile(c, file, { ...base, range: [0, 2] }, { keepTarget: true })
      const size = existsSync(file) ? statSync(file).size : 0
      put('readonly', { error: r.error, replaced: size > 1000, ...(await after(file)) })
      try {
        chmodSync(file, 0o666)
      } catch {
        /* gone */
      }
      rmSync(file, { force: true })
    }
    // Turkish letters, and a path of 300 characters.
    if (want('paths')) {
      const tr = join(CIKTI, 'Kullanıcılar', 'Şule', 'Masaüstü', 'çıktı ğüşiöç.mp4')
      mkdirSync(join(CIKTI, 'Kullanıcılar', 'Şule', 'Masaüstü'), { recursive: true })
      const r = await exportFile(c, tr, { ...base, range: [0, 2] })
      put('path-turkish', { error: r.error, written: existsSync(tr) && statSync(tr).size > 1000, length: tr.length })
      rmSync(join(CIKTI, 'Kullanıcılar'), { recursive: true, force: true })
      let dir = join(CIKTI, 'uzun')
      while (dir.length < 270) dir = join(dir, 'klasor-adi-uzun-' + dir.length)
      const long = join(dir, 'x'.repeat(Math.max(1, 300 - dir.length - 5)) + '.mp4')
      mkdirSync(dir, { recursive: true })
      const r2 = await exportFile(c, long, { ...base, range: [0, 2] })
      put('path-300', { error: r2.error, written: existsSync(long) && statSync(long).size > 1000, length: long.length })
      rmSync(join(CIKTI, 'uzun'), { recursive: true, force: true })
    }
    // The window minimised during an export, against a shown one (fps).
    if (want('minimised')) {
      const file = join(CIKTI, 'rig-robust-min.mp4')
      const shown = await exportFile(c, file, base)
      // Electron's CDP has no window states: the test's own window (off
      // screen, our process) is minimised through Win32 (ShowWindow 6 =
      // SW_MINIMIZE, then 4 = SW_SHOWNOACTIVATE back where it was).
      const show = (cmd) => spawnSync('powershell', ['-NoProfile', '-Command', `Add-Type -Name W -Namespace U -MemberDefinition '[DllImport("user32.dll")] public static extern bool ShowWindow(System.IntPtr h, int c); [DllImport("user32.dll")] public static extern bool IsIconic(System.IntPtr h);'; $h=(Get-Process -Id ${app.proc.pid}).MainWindowHandle; [void][U.W]::ShowWindow($h, ${cmd}); Start-Sleep -Milliseconds 300; [U.W]::IsIconic($h)`], { encoding: 'utf8', windowsHide: true }).stdout.trim()
      const iconic = show(6)
      const minimised = await exportFile(c, file, base)
      const stillIconic = show(-1).split(/\s+/).pop()
      show(4)
      put('minimised', { iconic, stillIconicAfter: stillIconic, shownFps: shown.fps, minimisedFps: minimised.fps, ratio: +(minimised.fps / shown.fps).toFixed(3), how: 'Win32 ShowWindow SW_MINIMIZE on the test window' })
      rmSync(file, { force: true })
    }
    // Editing during an export: the file equals the project as it was when
    // the export began (probe hashes of 12 frames against an undisturbed run).
    if (want('edit')) {
      const frames = [0, 15, 30, 60, 90, 120, 150, 200, 260, 330, 420, 590]
      const hashes = async (edit) => c.run(async (frames, edit) => {
        const ex = await window.__exporter()
        const S = window.__store
        const p = S.getState().project
        const out = {}
        let edited = false
        await ex.exportProjectMp4(p, {
          settings: { container: 'mp4', resolutionScale: 0.5, fps: 30, bitrateFactor: 0.08, normalize: false, probe: frames },
          onProbe: (i, h) => (out[i] = h),
          onProgress: (_f, l) => {
            if (edit && !edited && Number(/Drawing frame (\d+) /.exec(l)?.[1] ?? 0) >= 20) {
              edited = true
              const s = S.getState()
              const [a, b] = Object.keys(s.project.clips)
              s.runBatch([{ name: 'clip.delete', params: { ids: [b] } }, { name: 'clip.move', params: { clipId: a, start: 3 } }])
            }
          }
        })
        return { out, edited, changed: S.getState().project !== p }
      }, frames, edit)
      const plain = await hashes(false)
      await project20()
      const edited = await hashes(true)
      const same = frames.filter((i) => plain.out[i] === edited.out[i]).length
      put('edit-during', { frames: frames.length, same, edited: edited.edited, projectChanged: edited.changed })
      await project20()
    }
  },

  /** Decision 1: the sound mixed in short windows against one window over
   *  the whole stretch (the same code, so any difference is the windows'):
   *  the voice with stateful effects, a 44.1 kHz sweep, cut tones, a
   *  transition's sound. Max difference and steps at the window joins. */
  async windows(ctx) {
    const { c, app, lib, results, save, say } = ctx
    makeAudioSources()
    await lib.reset(c)
    // A FLAC voice (44.1 kHz, lossless: an AAC source's noise bands (PNS)
    // are drawn anew by each decoder start, so two decodes of it never match
    // sample for sample, windows or not), a 44.1 kHz sweep, a tone.
    const [talk, sweep, tone] = await lib.seedAssets(app, c, [join(KAYNAK, ctx.args.aac ? '../ham/ham-02dk-en.mp4' : 'en-fable.flac'), join(KAYNAK, 'supurme-44k.wav'), join(KAYNAK, 'ton-440.wav')])
    const fx = { eqLow: 3, eqMid: 0, eqHigh: -2, highpass: 80, lowpass: 0, comp: { enabled: true, threshold: -20, ratio: 3 }, gate: { enabled: true, threshold: -45, release: 120 } }
    await buildProject(c, {
      w: 640, h: 360, fps: 30,
      tracks: [
        { id: 'V1', kind: 'video', clips: [] },
        { id: 'A2', kind: 'audio', clips: [{ assetId: talk.id, duration: 30, extra: ctx.args.nofx ? {} : { audioFx: fx } }, { assetId: talk.id, start: 30, inPoint: 40, duration: 25 }] },
        { id: 'A1', kind: 'audio', clips: [{ assetId: sweep.id, start: 3, duration: 10, volume: 0.5 }, ...Array.from({ length: 8 }, (_, i) => ({ assetId: tone.id, start: 20 + i * 2.37, duration: 2.37, inPoint: +(0.31 * i).toFixed(3), volume: 0.4 }))] }
      ]
    })
    if (ctx.args.dump) await c.run((p) => { window.__rigDump = p; return true }, join(CIKTI, 'rig-win-'))
    if (ctx.args.ceil) await c.run((v) => { window.__rigCeil = v; return true }, Number(ctx.args.ceil))
    const r = await c.run(async () => {
      const S = window.__store
      const A = await window.__audioStream()
      const p = S.getState().project
      const all = async (windowSec) => {
        const m = new A.ExportMix(p, [0, 55], { windowSec, ceilingDb: window.__rigCeil ?? -1 })
        await m.prepare()
        const L = new Float32Array(m.frames), R = new Float32Array(m.frames)
        let at = 0
        for (let b = await m.next(); b; b = await m.next()) {
          L.set(b.getChannelData(0).subarray(0, m.frames - at), at)
          R.set(b.getChannelData(1).subarray(0, m.frames - at), at)
          at += b.length
        }
        return { L, R, passes: m.passes, lead: A.carriesState(p) }
      }
      const t0 = performance.now()
      const short = await all(7)
      const t1 = performance.now()
      const whole = await all(1000)
      let worst = 0, worstAt = 0
      for (let i = 0; i < whole.L.length; i++) {
        const d = Math.max(Math.abs(short.L[i] - whole.L[i]), Math.abs(short.R[i] - whole.R[i]))
        if (d > worst) { worst = d; worstAt = i / 48000 }
      }
      // Steps at the joins (every 7 s) in the windowed mix, against the whole's there.
      const joins = []
      for (let k = 1; k * 7 < 55; k++) {
        const i = k * 7 * 48000
        joins.push(+Math.max(Math.abs(short.L[i] - short.L[i - 1]) - Math.abs(whole.L[i] - whole.L[i - 1]), 0).toFixed(6))
      }
      // Per window: the largest difference, and the lag (samples) that best
      // lines the two up there.
      const per = []
      for (let k = 0; k * 7 < 55; k++) {
        const a = k * 7 * 48000, b = Math.min(whole.L.length, (k + 1) * 7 * 48000)
        let w = 0
        for (let i = a; i < b; i++) w = Math.max(w, Math.abs(short.L[i] - whole.L[i]))
        let best = 0, bestLag = 0
        for (let lag = -24000; lag <= 24000; lag += 1) {
          let s = 0
          for (let i = a + 25000; i < b - 25000; i += 31) s += short.L[i] * whole.L[i + lag]
          if (s > best) { best = s; bestLag = lag }
        }
        per.push({ k, worst: +w.toFixed(4), lag: bestLag })
      }
      const around = (i) => Array.from({ length: 6 }, (_, j) => [+short.L[i - 2 + j].toFixed(4), +whole.L[i - 2 + j].toFixed(4)])
      const wi = Math.round(worstAt * 48000)
      // Ratio short / whole over the 0.2 s around the worst point (energy).
      let es = 0, ew = 0
      for (let i = wi - 4800; i < wi + 4800; i++) { es += short.L[i] ** 2; ew += whole.L[i] ** 2 }
      if (window.__rigDump) {
        const ex = await window.__exporter()
        for (const [name, m] of [['short', short], ['whole', whole]]) {
          const ab = new AudioBuffer({ length: m.L.length, sampleRate: 48000, numberOfChannels: 2 })
          ab.copyToChannel(m.L, 0)
          ab.copyToChannel(m.R, 1)
          const path = window.__rigDump + name + '.wav'
          await window.api.testChooseSave(path)
          await window.api.writeChosenFile(path, ex.encodeWav(ab))
        }
      }
      const corr = []
      for (let lag = -3; lag <= 3; lag++) {
        let sxy = 0, sxx = 0, syy = 0
        for (let i = wi - 24000; i < wi + 24000; i++) { sxy += short.L[i] * whole.L[i + lag]; sxx += short.L[i] ** 2; syy += whole.L[i + lag] ** 2 }
        corr.push(+(sxy / Math.sqrt(sxx * syy)).toFixed(4))
      }
      let sxr = 0
      for (let i = wi - 24000; i < wi + 24000; i++) sxr += short.L[i] * whole.R[i]
      return { corr, LR: [short.L[wi], short.R[wi], whole.L[wi], whole.R[wi]], around: around(wi), energyRatio: Math.sqrt(es / ew), worstDiff: worst, worstAt, perWindow: per, joinsExtraStep: joins, passes: short.passes, stateLead: short.lead, msShortWindows: t1 - t0 }
    })
    results.windows = r
    save()
    say('windows', JSON.stringify(r))
  },

  /** R16, R17, R19, R22, R24: faults made on purpose. */
  async faults(ctx) {
    const { c, app, lib, results, save, say } = ctx
    results.faults = results.faults ?? {}
    const put = (k, v) => {
      results.faults[k] = v
      save()
      say('faults', k, JSON.stringify(v))
    }
    const want = (k) => !ctx.only || ctx.only.test(k)
    const settle = () => new Promise((r) => setTimeout(r, 1500))
    await lib.reset(c)
    const [src] = await lib.seedAssets(app, c, [join(KAYNAK, 'sayac-1080p60.mp4')])
    const plain = () => buildProject(c, { w: 1920, h: 1080, fps: 30, tracks: [{ id: 'V1', kind: 'video', clips: [{ assetId: src.id, duration: 10 }] }, { id: 'A1', kind: 'audio', clips: [] }] })
    await plain()
    const base = { container: 'mp4', resolutionScale: 1, fps: 30, bitrateFactor: 0.12, normalize: false }
    // R24: a throw right after the file is opened (the fault point).
    if (want('opened')) {
      const file = join(CIKTI, 'rig-fault-opened.mp4')
      rmSync(file, { force: true })
      const r = await c.run(async (file, settings) => {
        const ex = await window.__exporter()
        await window.api.testChooseSave(file)
        try {
          await ex.exportProjectMp4(window.__store.getState().project, { settings, toPath: file, onProgress() {}, fault: (s) => { if (s === 'opened') throw new Error('test fault after the file opened') } })
          return { error: null }
        } catch (e) {
          return { error: String(e.message ?? e) }
        }
      }, file, base)
      await settle()
      put('opened-throw', { ...r, partLeft: existsSync(file + '.part') })
      // A second export to the same name: does it work with the handle still open?
      const r2 = await exportFile(c, file, { ...base, range: [0, 1] })
      put('opened-then-again', { error: r2.error ?? null, written: existsSync(file) })
      rmSync(file, { force: true })
      rmSync(file + '.part', { force: true })
    }
    // R19: the encoder loses the film's tail without a word (every frame
    // after the 100th dropped inside VideoEncoder.encode).
    if (want('lost-tail')) {
      const file = join(CIKTI, 'rig-fault-tail.mp4')
      await c.run(() => {
        const orig = VideoEncoder.prototype.encode
        let n = 0
        window.__rigEncode = orig
        VideoEncoder.prototype.encode = function (f, o) {
          if (++n > 100) return
          return orig.call(this, f, o)
        }
        return true
      })
      const r = await exportFile(c, file, base)
      await c.run(() => {
        VideoEncoder.prototype.encode = window.__rigEncode
        return true
      })
      const info = existsSync(file) ? probeFile(file) : null
      put('lost-tail', { error: r.error ?? null, notes: r.notes, saidDone: !r.error, fileFrames: info?.v?.nb_frames ?? null, asked: 300 })
      rmSync(file, { force: true })
    }
    // R16: 64 KB of noise in the middle of a forward clip's file.
    if (want('corrupt')) {
      const bad = join(CIKTI, 'rig-bozuk.mp4')
      const buf = readFileSync(join(KAYNAK, 'sayac-1080p60.mp4'))
      const at = Math.floor(buf.length / 2)
      for (let i = 0; i < 65536; i++) buf[at + i] = (i * 2654435761) >>> 24
      writeFileSync(bad, buf)
      await lib.reset(c)
      const [b] = await lib.seedAssets(app, c, [bad])
      await buildProject(c, { w: 1920, h: 1080, fps: 30, tracks: [{ id: 'V1', kind: 'video', clips: [{ assetId: b.id, duration: 10 }] }, { id: 'A1', kind: 'audio', clips: [] }] })
      const file = join(CIKTI, 'rig-fault-corrupt.mp4')
      const r = await exportFile(c, file, base)
      const info = existsSync(file) ? probeFile(file) : null
      put('corrupt', { error: r.error ?? null, notes: r.notes, frames: r.frames, fileFrames: info?.v?.nb_frames ?? null })
      rmSync(file, { force: true })
      await lib.reset(c)
      const [s2] = await lib.seedAssets(app, c, [join(KAYNAK, 'sayac-1080p60.mp4')])
      src.id = s2.id
      await plain()
      rmSync(bad, { force: true })
    }
    // R17: the GPU process killed in the middle of a 4K export (Chromium
    // starts a new one; the export's canvases lose their contexts).
    if (want('gpu')) {
      await lib.reset(c)
      const [k4] = await lib.seedAssets(app, c, [join(KAYNAK, 'sayac-2160p30.mp4')])
      await buildProject(c, { w: 1920, h: 1080, fps: 30, tracks: [{ id: 'V1', kind: 'video', clips: [{ assetId: k4.id, duration: 10 }, { assetId: k4.id, start: 10, duration: 10 }] }, { id: 'A1', kind: 'audio', clips: [] }] })
      const file = join(CIKTI, 'rig-fault-gpu.mp4')
      rmSync(file, { force: true })
      await c.run(async (file, settings) => {
        const ex = await window.__exporter()
        await window.api.testChooseSave(file)
        window.__rig = { frames: 0, done: null, lost: 0 }
        window.__rig.job = ex.exportProjectMp4(window.__store.getState().project, { settings, toPath: file, onProgress: (_f, l) => { const m = /Drawing frame (\d+)/.exec(l); if (m) window.__rig.frames = Number(m[1]) } })
          .then(() => (window.__rig.done = { ok: true }), (e) => (window.__rig.done = { error: String(e.message ?? e) }))
        return true
      }, file, { ...base, resolutionScale: 2 })
      for (let i = 0; i < 200 && (await c.run(() => window.__rig.frames)) < 150; i++) await new Promise((r) => setTimeout(r, 100))
      const gpu = appProcesses(app.proc.pid).find((p) => p.type === 'gpu-process')
      if (gpu) spawnSync('taskkill', ['/PID', String(gpu.pid), '/F'], { stdio: 'ignore', windowsHide: true })
      const killedAt = await c.run(() => window.__rig.frames)
      for (let i = 0; i < 600 && !(await c.run(() => window.__rig.done)); i++) await new Promise((r) => setTimeout(r, 200))
      const done = await c.run(() => window.__rig.done)
      let black = null
      if (existsSync(file)) {
        const bd = spawnSync(ff('ffmpeg'), ['-hide_banner', '-nostats', '-i', file, '-vf', 'blackdetect=d=0.03:pix_th=0.05', '-an', '-f', 'null', '-'], { encoding: 'utf8', windowsHide: true })
        black = [...bd.stderr.matchAll(/black_start:([\d.]+) black_end:([\d.]+)/g)].map((m) => [Number(m[1]), Number(m[2])])
      }
      put('gpu-killed', { killedPid: gpu?.pid ?? null, killedAtFrame: killedAt, done, fileWritten: existsSync(file), blackStretches: black, partLeft: existsSync(file + '.part') })
      rmSync(file, { force: true })
    }
    // R22: an HLG and a PQ source (HEVC Main 10, BT.2020): a badge at
    // import, a sentence before the export?
    if (want('hdr')) {
      const out = {}
      for (const [name, trc] of [['hdr-hlg.mp4', 'arib-std-b67'], ['hdr-pq.mp4', 'smpte2084']]) {
        const f = join(KAYNAK, name)
        if (!existsSync(f)) spawnSync(ff('ffmpeg'), ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc2=size=640x360:rate=30:duration=2', '-c:v', 'libx265', '-pix_fmt', 'yuv420p10le', '-tag:v', 'hvc1', '-x265-params', `colorprim=bt2020:transfer=${trc}:colormatrix=bt2020nc`, '-color_primaries', 'bt2020', '-color_trc', trc, '-colorspace', 'bt2020nc', '-movflags', '+write_colr', f], { windowsHide: true })
        // ffmpeg's colr box says "unspecified" for the primaries and the
        // transfer (only the stream's own VUI holds them); a phone's or a
        // camera's HDR file names them in its colr box: written in.
        {
          const b = readFileSync(f)
          const i = b.indexOf('colrnclx')
          if (i >= 0 && b.readUInt16BE(i + 10) === 2) {
            b.writeUInt16BE(9, i + 8)
            b.writeUInt16BE(trc === 'smpte2084' ? 16 : 18, i + 10)
            writeFileSync(f, b)
          }
        }
        await lib.reset(c)
        const [a] = await lib.seedAssets(app, c, [f])
        const asset = await c.st((s, id) => { const x = s.project.assets.find((y) => y.id === id); return { hdr: x.hdr ?? null, undecodable: !!x.undecodable } }, a.id)
        await buildProject(c, { w: 1920, h: 1080, fps: 30, tracks: [{ id: 'V1', kind: 'video', clips: [{ assetId: a.id, duration: 2 }] }, { id: 'A1', kind: 'audio', clips: [] }] })
        const file = join(CIKTI, `rig-fault-${name}`)
        const r = await exportFile(c, file, { ...base, range: [0, 1] })
        out[name] = { asset, error: r.error ?? null, notes: r.notes, badge: await c.has('media.hdr') }
        rmSync(file, { force: true })
      }
      put('hdr', out)
    }
  },

  async progressui(ctx) {
    const { c, app, lib, results, save, say } = ctx
    await lib.reset(c)
    const [src] = await lib.seedAssets(app, c, [join(KAYNAK, 'sayac-1080p60.mp4')])
    await buildProject(c, { w: 1920, h: 1080, fps: 60, tracks: [{ id: 'V1', kind: 'video', clips: [{ assetId: src.id, duration: 10 }] }, { id: 'A1', kind: 'audio', clips: [] }] })
    results.progressui = {}
    for (let rep = 0; rep < 2; rep++) {
      for (const mode of ['card', 'none']) {
        const file = join(CIKTI, `rig-ui-${mode}.mp4`)
        const r = await c.run(async (file, mode) => {
          const ex = await window.__exporter()
          const [job] = await window.__exportJob()
          const p = window.__store.getState().project
          await window.api.testChooseSave(file)
          let first = 0, n = 0, updates = 0
          const settings = { container: 'mp4', resolutionScale: 1, fps: 60, bitrateFactor: 0.12, normalize: false }
          const t0 = performance.now()
          const unsub = window.__store.subscribe((s, prev) => { if (s.exportStatus !== prev.exportStatus) updates++ })
          const go = (progress) => ex.exportProjectMp4(p, { settings, toPath: file, onProgress: (f, l) => { const m = /Drawing frame (\d+) of (\d+)/.exec(l); if (m) { if (!first) first = performance.now(); n = Number(m[2]) } progress(f, l) } })
          if (mode === 'card') await job.runExportJob('video', { detail: 'rig', target: file }, async (signal, progress) => { await go(progress); return {} })
          else await go(() => {})
          unsub()
          const t1 = performance.now()
          return { fps: n / ((t1 - first) / 1000), storeUpdates: updates, seconds: (t1 - t0) / 1000 }
        }, file, mode)
        rmSync(file, { force: true })
        results.progressui[`${mode}${rep}`] = r
        say('progressui', mode, JSON.stringify(r))
      }
    }
    save()
  }
}
