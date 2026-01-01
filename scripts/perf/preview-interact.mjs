// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// The preview's interaction measures (cila A): how long a frame takes while a
// picture is dragged, sized, turned or its mask moved in the preview, with
// real input (CDP mouse events on the off-screen window). Part of
// `npm run perf` (the pv.* rows); also on its own:
//
//   node scripts/perf/preview-interact.mjs [--only=<regex>] [--passes=2]
//        [--out=<file.json>] [--no-build] [--label=<text>] [--baseline-add]
//
// The scene: the 10-minute talk roughly cut (44 clips, 118 subtitles: what the
// timeline and the Inspector have to follow), full frame, and over it a
// picture at 60 %. Each row is 120 pointer moves, one every 24 ms (never two
// in one 1/60 s slot: the cost of one move's frame):
//
//   pv.drag     the picture moved round the frame, snapping on
//   pv.scale    its corner handle pulled out and in
//   pv.rotate   its knob taken round
//   pv.mask     its soft-edged ellipse mask moved inside it
//   pv.drag.fx  the same move with a pixel pass and a soft mask on the picture
//
// and the same four with a move every 4 ms, 360 of them (`.fast`: a fast
// mouse; the window hands its moves over at the screen's rate, 144 a second
// here, so a slot holds two or three): whether the work grows with the rate
// the pointer reports at. Last, pv.drag.heavy: the move in a scene whose
// picture alone costs more than a frame (five overlays, each with a soft
// mask, a blur and a pixel pass, at full preview quality): where the draft
// picture matters.
//
// A frame's time is the main thread's work for it, as in the timeline's
// measure (scripts/perf/interact.mjs, phase 3c.T): the input events' tasks
// since the frame before and the frame's own animation callbacks, style,
// layout and paint, summed into 1/60 s slots. Beside it: how many times the
// project was written per slot (`writes`), and how long after a move the
// preview drew it (`lag`, ms: hand to screen).
//
// Per row: med, p95, the frames over 33 ms, frames. The row's number (`median`)
// is the 95th percentile.
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync, statSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { APP_DIR, launchApp } from '../e2e/app.mjs'
import { TESTDATA, VOICEOVER, probeDuration } from '../e2e/media.mjs'
import { ready } from '../e2e/lib.mjs'

/** The targets (ms): 95 % of frames within `p95`, none over `over`. */
export const PV_TARGET = { p95: 16.7, over: 33 }
export const PV_ROWS = ['drag', 'scale', 'rotate', 'mask', 'drag.fx', 'drag.fast', 'scale.fast', 'rotate.fast', 'mask.fast', 'drag.heavy']

/** Builds the scene's projects in the page (window.__pvProjects) and installs
 *  the frame recorder (window.__pvFrames). */
async function setup(c) {
  const truth = JSON.parse(readFileSync(join(TESTDATA, 'ham', 'ham-10dk-tr.truth.json'), 'utf8'))
  const caps = truth.segments.filter((s) => s.text).map((s, i) => ({ id: `c${i + 1}`, start: s.start, end: s.end, text: s.text, words: truth.words.filter((w) => w.start >= s.start - 0.01 && w.end <= s.end + 0.01).map((w) => ({ text: w.text, start: w.start, end: w.end })) }))
  const talk = join(TESTDATA, 'ham', 'ham-10dk-tr.mp4')
  const media = {
    ham10: { file: talk, kind: 'video', w: 640, h: 360, audio: true, d: probeDuration(talk) },
    img1: { file: join(VOICEOVER, '1.jpg'), kind: 'image', w: 960, h: 540, audio: false, d: 0 }
  }
  await c.run(async (spec) => {
    const S = window.__store
    const A = {}
    for (const [id, m] of Object.entries(spec.media)) {
      const reg = await window.api.testRegisterMedia(m.file)
      if (!reg) throw new Error('cannot register ' + m.file)
      A[id] = { id, kind: m.kind, name: reg.name, path: reg.path, url: reg.url, size: reg.size, duration: m.d, width: m.w, height: m.h, hasAudio: m.audio }
    }
    const capStyle = { fontFamily: 'Arial', fontSize: 64, fontWeight: 800, color: '#ffffff', outlineColor: '#000000', outlineWidth: 6, bgColor: '#000000', bgOpacity: 0, posY: 0.86, maxLineChars: 32, uppercase: false, popup: { enabled: true, duration: 0.2, intensity: 1, style: 'pop' }, wordsPerCue: 0, pauseThreshold: 0 }
    const p = { version: 1, name: 'pv', settings: { width: 1920, height: 1080, fps: 30 }, mode: 'frame', tracks: [], clips: {}, assets: [A.ham10, A.img1], captions: spec.caps, captionStyle: capStyle, transcription: { model: 'english', language: 'auto' }, snap: { enabled: true, distance: 12, snapEdges: true, snapCenters: true } }
    p.tracks = [{ id: 'V1', kind: 'video', name: 'V1', clipIds: ['v'] }, { id: 'A1', kind: 'audio', name: 'A1', clipIds: [] }]
    p.clips = { v: { id: 'v', assetId: 'ham10', trackId: 'V1', start: 0, inPoint: 0, duration: A.ham10.duration, transform: { x: 960, y: 540, scale: 3, rotation: 0 }, volume: 1 } }
    S.getState().loadProject(structuredClone(p))
    await new Promise((r) => setTimeout(r, 50))
    S.getState().rippleDeleteMany(spec.cuts)
    const base = structuredClone(S.getState().project)
    // The picture over it (tracks[0] is the top layer).
    const over = (extra) => {
      const q = structuredClone(base)
      q.tracks.unshift({ id: 'V2', kind: 'video', name: 'V2', clipIds: ['ov'] })
      q.clips.ov = { id: 'ov', assetId: 'img1', trackId: 'V2', start: 0, inPoint: 0, duration: 120, transform: { x: 960, y: 540, scale: 0.6, rotation: 0 }, volume: 1, ...extra }
      return q
    }
    const mask = { enabled: true, shape: 'ellipse', cx: 0, cy: 0, w: 420, h: 260, feather: 24 }
    // The heavy scene: four more overlays under the one that is dragged, each
    // with a soft mask, a blur and a pixel pass.
    const heavy = over({ mask: { ...mask, feather: 40 }, vignette: 0.5, grain: 0.3, sharpen: 0.4, blur: 4 })
    for (let i = 0; i < 4; i++) {
      const id = 'h' + i
      heavy.tracks.splice(1, 0, { id: 'VH' + i, kind: 'video', name: 'VH' + i, clipIds: [id] })
      heavy.clips[id] = { id, assetId: 'img1', trackId: 'VH' + i, start: 0, inPoint: 0, duration: 120, transform: { x: 480 + (i % 2) * 960, y: 300 + (i > 1 ? 480 : 0), scale: 0.9, rotation: 0.1 * (i - 1.5) }, volume: 1, mask: { ...mask, w: 800, h: 460, feather: 40 }, vignette: 0.5, grain: 0.3, sharpen: 0.4, blur: 4 }
    }
    window.__pvProjects = {
      plain: over({}),
      mask: over({ mask }),
      fx: over({ mask, vignette: 0.5, grain: 0.3, sharpen: 0.4 }),
      heavy
    }

    // The frame recorder (the timeline measure's, phase 3c.T): the main
    // thread's busy time cut into frames. Every input event's task and every
    // frame's own part, one queue in order, each stretch counted once.
    const F = { on: false, frames: [], acc: 0, lastEnd: 0, draws: [], moves: [], writes: [] }
    const queue = []
    const ch = new MessageChannel()
    ch.port1.onmessage = () => {
      const it = queue.shift()
      const now = performance.now()
      const d = Math.max(0, now - Math.max(it.t, F.lastEnd))
      F.lastEnd = now
      if (it.f) { it.f[1] += d; it.f[2] = 1 } else F.acc += d
    }
    const mark = (e) => {
      if (!F.on) return
      const now = performance.now()
      if (e.type === 'pointermove') F.moves.push(now)
      queue.push({ t: now })
      ch.port2.postMessage(0)
    }
    for (const type of ['pointermove', 'pointerdown', 'pointerup', 'keydown']) window.addEventListener(type, mark, { capture: true, passive: true })
    const loop = () => {
      const now = performance.now()
      const f = [now, F.acc, 0]
      F.acc = 0
      if (F.on) F.frames.push(f)
      queue.push({ t: now, f })
      ch.port2.postMessage(0)
      requestAnimationFrame(loop)
    }
    requestAnimationFrame(loop)
    // The project's writes, and the preview's drawings of a changed project.
    S.subscribe((s, prev) => { if (F.on && s.project !== prev.project) F.writes.push(performance.now()) })
    F.hook = () => {
      const E = window.__engine
      if (F.wrapped && E.onDraw === F.wrapped) return
      const orig = E.onDraw
      let last = null
      F.wrapped = (r) => {
        orig?.(r)
        const p = S.getState().project
        if (F.on && p !== last) F.draws.push(performance.now())
        last = p
      }
      E.onDraw = F.wrapped
    }
    F.start = () => { F.hook(); F.frames = []; F.draws = []; F.moves = []; F.writes = []; F.acc = 0; F.on = true }
    F.stop = () => {
      F.on = false
      const fr = F.frames.slice(1).filter((f) => f[2])
      return { frames: fr.map((f) => [+f[0].toFixed(2), +f[1].toFixed(2)]), gap: fr.slice(1).map((f, i) => +(f[0] - fr[i][0]).toFixed(2)), draws: F.draws, moves: F.moves, writes: F.writes }
    }
    window.__pvFrames = F
    return true
  }, { media, caps, cuts: truth.cuts })
}

/** Loads a scene, the picture selected, the playhead inside it, paused. */
async function load(c, name) {
  await c.run(async (name) => {
    const S = window.__store
    S.getState().setPlaying(false)
    S.getState().loadProject(structuredClone(window.__pvProjects[name]))
    S.getState().setTime(30)
    S.getState().setPreviewView({ zoom: 1, x: 0, y: 0 })
    S.getState().selectClip('ov')
    S.getState().setMaskOverlay(name === 'mask' ? 'on' : 'off')
    // The heavy scene at full preview quality, without the playback's own
    // adaptive scale (what a drag does there is the measure).
    S.getState().setPreviewQuality(1)
    if (S.getState().adaptiveQuality) S.getState().setAdaptiveQuality(false)
    S.getState().setDirty(false)
    return true
  }, name)
  await c.waitFor('the timeline', () => c.ev(`!!document.querySelector('[data-testid^="timeline.clip."]')`), 20000, 100)
  await c.waitFor('the sound drawings', () => c.ev(`!document.querySelector('.wave-loading')`), 180000, 250)
  await c.sleep(700)
}

/** The preview's view: frame px → window px. */
const view = (c) => c.run(() => {
  const el = document.querySelector('[data-testid="preview.canvas"]')
  const r = el.getBoundingClientRect()
  const s = window.__store.getState()
  const { width, height } = s.project.settings
  const k = Math.min(r.width / width, r.height / height) * s.previewView.zoom
  return { left: r.left, top: r.top, w: r.width, h: r.height, k, W: width, H: height }
})

/** The work per frame at 60 pictures a second (the window may draw faster). */
const sixty = (frames, extra = []) => {
  const slots = new Map()
  if (!frames.length) return { work: [], counts: [] }
  const t0 = frames[0][0]
  for (const [t, w] of frames) {
    const k = Math.floor((t - t0) / (1000 / 60))
    slots.set(k, (slots.get(k) ?? 0) + w)
  }
  const counts = new Map()
  for (const t of extra) {
    const k = Math.floor((t - t0) / (1000 / 60))
    counts.set(k, (counts.get(k) ?? 0) + 1)
  }
  return { work: [...slots.values()], counts: [...counts.values()] }
}

const stats = (xs, over) => {
  const s = [...xs].sort((a, b) => a - b)
  const at = (q) => (s.length ? s[Math.min(s.length - 1, Math.floor(q * s.length))] : 0)
  return { med: +at(0.5).toFixed(2), p95: +at(0.95).toFixed(2), max: +(s[s.length - 1] ?? 0).toFixed(2), over: s.filter((x) => x > over).length, n: s.length }
}

async function run(c, what) {
  const v = await view(c)
  const P = (x, y) => [v.left + v.w / 2 + (x - v.W / 2) * v.k, v.top + v.h / 2 + (y - v.H / 2) * v.k]
  const F = (js) => c.ev(`window.__pvFrames.${js}`)
  const fast = what.endsWith('.fast')
  const kind = what.split('.')[0]
  const every = fast ? 4 : 24
  let due = performance.now()
  const frame = async () => {
    due += every
    const wait = due - performance.now()
    if (wait > 0) await c.sleep(wait)
    else due = performance.now()
  }
  const depth = () => c.st((s) => s.past.length)
  const d0 = await depth()
  // The picture: 576 × 324 in the frame's middle.
  const hw = 288, hh = 162
  let start, path
  const n = fast ? 360 : 120
  if (kind === 'scale') {
    start = P(960 + hw, 540 + hh)
    // Out along the diagonal and back in past the start.
    path = (t) => { const d = Math.sin(t * Math.PI * 2) * 160; return [start[0] + d, start[1] + d * (hh / hw)] }
  } else if (kind === 'rotate') {
    // The knob: 26 px above the top edge's middle.
    const [cx, cy] = P(960, 540)
    const r0 = hh * v.k + 26
    start = [cx, cy - r0]
    path = (t) => { const a = -Math.PI / 2 + Math.sin(t * Math.PI * 2) * 2.2; return [cx + Math.cos(a) * r0, cy + Math.sin(a) * r0] }
  } else if (kind === 'mask') {
    start = P(960, 540)
    path = (t) => [start[0] + Math.sin(t * Math.PI * 2) * 60 * v.k, start[1] + Math.sin(t * Math.PI * 4) * 30 * v.k]
  } else {
    // A move: a figure of eight through the frame's middle (the snap lines).
    // (Pressed outside the mask's box: an enabled mask takes a press inside it.)
    start = P(960 + 230, 540 + 120)
    path = (t) => [start[0] + Math.sin(t * Math.PI * 2) * 300 * v.k, start[1] + Math.sin(t * Math.PI * 4) * 150 * v.k]
  }
  await c.mouse('mouseMoved', start[0], start[1])
  await c.mouse('mousePressed', start[0], start[1])
  await F('start()')
  for (let i = 1; i <= n; i++) {
    const [x, y] = path(i / n)
    await c.mouse('mouseMoved', x, y, { down: true })
    await frame()
  }
  await c.sleep(60)
  const out = await F('stop()')
  // The preview's draft step at the drag's end (builds without one say nothing).
  out.draft = await c.ev(`document.querySelector('[data-testid="preview.canvas"]').dataset.draft ?? ''`)
  await c.mouse('mouseReleased', start[0], start[1])
  await c.sleep(150)
  if ((await depth()) - d0 !== 1) throw new Error(`pv.${what}: the drag made ${(await depth()) - d0} undo steps (the gesture did not take)`)
  for (let i = 0; i < 4 && (await depth()) > d0; i++) await c.ev('window.__store.getState().undo()')
  await c.ev(`window.__store.getState().selectClip('ov')`)
  await c.sleep(250)
  return out
}

const sceneOf = (what) => (what.startsWith('mask') ? 'mask' : what === 'drag.fx' ? 'fx' : what === 'drag.heavy' ? 'heavy' : 'plain')

/** Measures; returns { 'pv.<what>': { unit, median (= p95), med, p95, over, … } }. */
export async function measurePreview(c, { only = null, passes = 2, log = () => undefined } = {}) {
  await setup(c)
  const out = {}
  let scene = null
  for (const what of PV_ROWS) {
    const key = `pv.${what}`
    if (only && !only.test(key)) continue
    if (scene !== sceneOf(what)) { scene = sceneOf(what); await load(c, scene) }
    await run(c, what) // the warm-up pass
    const work = [], gap = [], lag = [], writes = []
    let draft = ''
    for (let p = 0; p < passes; p++) {
      const r = await run(c, what)
      draft = r.draft
      const s = sixty(r.frames, r.writes)
      work.push(...s.work)
      writes.push(...s.counts)
      gap.push(...r.gap)
      // Hand to screen: from a move to the first drawing of the project after it.
      let j = 0
      r.moves.forEach((at, i) => {
        while (j < r.draws.length && r.draws[j] < at) j++
        const next = r.moves[i + 1] ?? Infinity
        // (Fast moves: only the last move before a drawing is one the eye gets.)
        if (j < r.draws.length && (r.draws[j] <= next || !what.endsWith('.fast'))) lag.push(r.draws[j] - at)
      })
    }
    const w = stats(work, PV_TARGET.over)
    const g = stats(gap, PV_TARGET.over)
    const l = stats(lag, PV_TARGET.over)
    const wr = stats(writes, 1e9)
    // (limit, floor: a percentile of a few hundred frames is noisier than a
    // median of five; scripts/perf/run.mjs reads them.)
    out[key] = { unit: 'ms', median: w.p95, med: w.med, p95: w.p95, max: w.max, over: w.over, n: w.n, gapP95: g.p95, gapOver: g.over, lagMed: l.med, lagP95: l.p95, writesMed: wr.med, writesMax: wr.max, ...(draft && draft !== '1' ? { draft } : {}), target: PV_TARGET, limit: 1.35, floor: 2 }
    log(key, out[key])
  }
  await c.run(() => { const s = window.__store.getState(); s.setMaskOverlay('auto'); s.newProject('16:9'); s.setDirty(false); return true })
  return out
}

export function printPvRow(key, v) {
  const ok = v.p95 <= v.target.p95 && v.over === 0
  console.log(`${key.padEnd(16)}${v.draft ? ' draft ' + v.draft : ''} med ${String(v.med).padStart(6)}  p95 ${String(v.p95).padStart(6)}  max ${String(v.max).padStart(6)}  >${v.target.over}ms ${String(v.over).padStart(2)}  n ${String(v.n).padStart(3)}  writes/frame ${v.writesMed}–${v.writesMax}  lag ${v.lagMed} / ${v.lagP95}  ${ok ? 'ok' : 'OVER'}`)
}

// ---- on its own ---------------------------------------------------------------
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const argv = process.argv.slice(2)
  const flag = (n) => argv.find((a) => a.startsWith(`--${n}=`))?.split('=').slice(1).join('=')
  const newest = (dir) => {
    let t = 0
    for (const e of readdirSync(dir, { withFileTypes: true })) t = Math.max(t, e.isDirectory() ? newest(join(dir, e.name)) : statSync(join(dir, e.name)).mtimeMs)
    return t
  }
  const built = join(APP_DIR, 'out', 'renderer', 'index.html')
  if (!argv.includes('--no-build') && (!existsSync(built) || newest(join(APP_DIR, 'src')) > statSync(built).mtimeMs)) {
    const r = process.platform === 'win32' ? spawnSync('cmd', ['/c', 'npm run build'], { cwd: APP_DIR, stdio: 'inherit' }) : spawnSync('npm', ['run', 'build'], { cwd: APP_DIR, stdio: 'inherit' })
    if (r.status !== 0) process.exit(1)
  }
  const app = await launchApp({ agent: false })
  let rows
  try {
    await ready(app.cdp)
    await app.cdp.sleep(1500)
    rows = await measurePreview(app.cdp, { only: flag('only') ? new RegExp(flag('only')) : null, passes: Number(flag('passes') ?? 2), log: printPvRow })
  } finally {
    await app.close()
  }
  const commit = spawnSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: APP_DIR, encoding: 'utf8' }).stdout.trim()
  const record = { at: new Date().toISOString(), commit, label: flag('label') ?? '', metrics: rows }
  if (flag('out')) writeFileSync(flag('out'), JSON.stringify(record, null, 1) + '\n')
  if (argv.includes('--baseline-add')) {
    // Only the rows the baseline does not have: its own rows stay as they are.
    const BASE = join(TESTDATA, 'perf-taban.json')
    const old = JSON.parse(readFileSync(BASE, 'utf8'))
    const added = Object.keys(rows).filter((k) => !(k in old.metrics))
    for (const k of added) old.metrics[k] = rows[k]
    old.added = [...(old.added ?? []), { at: record.at, commit, rows: added }]
    writeFileSync(BASE, JSON.stringify(old, null, 1) + '\n')
    console.log(`${added.length} new row(s) added to the baseline: ${added.join(', ') || 'none'}`)
  }
}
