// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// The timeline's interaction measures (phase 3c.T): how long a frame takes
// while the timeline is being used, with real input (CDP mouse and wheel
// events on the off-screen window). Part of `npm run perf`; also on its own:
//
//   node scripts/perf/interact.mjs [--only=<regex>] [--projects=ham10,ham30,heavy]
//        [--passes=2] [--out=<file.json>] [--no-build] [--label=<text>]
//
// Six interactions, one input event every 24 ms: tl.pan (120 sideways wheel
// events), tl.zoom (30 Ctrl + wheel steps, the pointer in the middle), tl.scrub
// (the playhead dragged 120 steps; also how long the preview takes to show the new time), tl.dragClip
// (a clip dragged 120 steps, snapping on), tl.trim (an edge, 60 steps), tl.play
// (three seconds of playback, following the playhead). Three projects: the 10-
// and 30-minute talks roughly cut, and the heavy one (scripts/testdata/heavy.mjs).
//
// A frame's time is the main thread's work for it: the input events' tasks
// since the frame before (their handlers and what they made the page draw
// again) and the frame's own animation callbacks, style, layout and paint. That is what must fit in 16.7 ms for 60 pictures a
// second, and it is measurable in a window nobody sees. The window may draw
// faster than that (144 Hz here): the work is summed into 1/60 s slots, so a
// number means the same on any screen. The gaps between the window's own
// frames are written too (`gap…`): there a dropped frame shows as a doubled
// gap, but they also carry the machine's own load.
//
// Per row: med, p95, the frames over 33 ms (50 for the heavy project), frames.
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync, statSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { APP_DIR, launchApp } from '../e2e/app.mjs'
import { TESTDATA, VOICEOVER, probeDuration } from '../e2e/media.mjs'
import { ready, editorAlone } from '../e2e/lib.mjs'
import { heavyProject } from '../testdata/heavy.mjs'

/** The targets (ms): 95 % of frames within `p95`, none over `over`. */
export const TARGETS = { light: { p95: 16.7, over: 33 }, heavy: { p95: 25, over: 50 } }
export const INTERACTIONS = ['pan', 'zoom', 'scrub', 'dragClip', 'trim', 'play']

/** Builds the three projects in the page (window.__perfProjects) and installs
 *  the frame recorder (window.__frames). */
export async function setup(c) {
  const truth = (n) => JSON.parse(readFileSync(join(TESTDATA, 'ham', `${n}.truth.json`), 'utf8'))
  const caps = (t) => t.segments.filter((s) => s.text).map((s, i) => ({ id: `c${i + 1}`, start: s.start, end: s.end, text: s.text, words: t.words.filter((w) => w.start >= s.start - 0.01 && w.end <= s.end + 0.01).map((w) => ({ text: w.text, start: w.start, end: w.end })) }))
  const file = (f) => join(TESTDATA, ...f.split('/'))
  const media = {
    ham10: { file: file('ham/ham-10dk-tr.mp4'), kind: 'video', w: 640, h: 360, audio: true },
    ham30: { file: file('ham/ham-30dk-en.mp4'), kind: 'video', w: 640, h: 360, audio: true },
    voice: { file: join(VOICEOVER, 'vo.wav'), kind: 'audio', w: 0, h: 0, audio: true }
  }
  for (let i = 1; i <= 20; i++) media[`img${i}`] = { file: join(VOICEOVER, `${i}.jpg`), kind: 'image', w: 960, h: 540, audio: false }
  for (const m of Object.values(media)) m.d = m.kind === 'image' ? 0 : probeDuration(m.file)
  const t10 = truth('ham-10dk-tr'), t30 = truth('ham-30dk-en')
  const heavy = heavyProject({ talk: media.ham10.d, voice: media.voice.d })
  await c.run(async (spec) => {
    const S = window.__store
    const A = {}
    for (const [id, m] of Object.entries(spec.media)) {
      const reg = await window.api.testRegisterMedia(m.file)
      if (!reg) throw new Error('cannot register ' + m.file)
      A[id] = { id, kind: m.kind, name: reg.name, path: reg.path, url: reg.url, size: reg.size, duration: m.d, width: m.w, height: m.h, hasAudio: m.audio }
    }
    // A film strip for the videos (an import makes one from the file; here a
    // drawn one of the same shape: 12 cells of 96 x 54), so the clips draw
    // their thumbnails as they do in use.
    const strip = document.createElement('canvas')
    strip.width = 12 * 96
    strip.height = 54
    const g = strip.getContext('2d')
    for (let i = 0; i < 12; i++) {
      g.fillStyle = `hsl(${i * 30} 35% ${30 + (i % 3) * 8}%)`
      g.fillRect(i * 96, 0, 96, 54)
      g.fillStyle = 'rgba(255,255,255,0.5)'
      g.fillRect(i * 96 + 30, 14, 36, 26)
    }
    const stripUrl = strip.toDataURL('image/jpeg', 0.6)
    for (const id of ['ham10', 'ham30']) Object.assign(A[id], { filmstrip: stripUrl, filmstripCols: 12 })
    const capStyle = { fontFamily: 'Arial', fontSize: 64, fontWeight: 800, color: '#ffffff', outlineColor: '#000000', outlineWidth: 6, bgColor: '#000000', bgOpacity: 0, posY: 0.86, maxLineChars: 32, uppercase: false, popup: { enabled: true, duration: 0.2, intensity: 1, style: 'pop' }, wordsPerCue: 0, pauseThreshold: 0 }
    const base = (name) => ({ version: 1, name, settings: { width: 1920, height: 1080, fps: 30 }, mode: 'frame', tracks: [], clips: {}, assets: [], captions: [], captionStyle: capStyle, transcription: { model: 'english', language: 'auto' }, snap: { enabled: true, distance: 12, snapEdges: true, snapCenters: true } })
    const T = (s) => ({ x: 960, y: 540, scale: s, rotation: 0 })
    const talk = async (name, asset, captions, cuts) => {
      const p = base(name)
      p.assets = [A[asset]]
      p.tracks = [{ id: 'V1', kind: 'video', name: 'V1', clipIds: ['v'] }, { id: 'A1', kind: 'audio', name: 'A1', clipIds: [] }]
      p.clips = { v: { id: 'v', assetId: asset, trackId: 'V1', start: 0, inPoint: 0, duration: A[asset].duration, transform: T(3), volume: 1 } }
      p.captions = captions
      S.getState().loadProject(structuredClone(p))
      await new Promise((r) => setTimeout(r, 50))
      S.getState().rippleDeleteMany(cuts)
      return structuredClone(S.getState().project)
    }
    const P = {}
    P.ham10 = await talk('ham-10dk', 'ham10', spec.cap10, spec.cuts10)
    P.ham30 = await talk('ham-30dk', 'ham30', spec.cap30, spec.cuts30)
    const h = base('agir')
    h.tracks = spec.heavy.tracks
    h.clips = Object.fromEntries(Object.entries(spec.heavy.clips).map(([id, k]) => [id, { ...k, assetId: k.assetId === 'talk' ? 'ham10' : k.assetId }]))
    h.captions = spec.heavy.captions
    h.notes = spec.heavy.notes
    h.assets = [A.ham10, A.voice, ...Array.from({ length: 20 }, (_, i) => A[`img${i + 1}`])]
    P.heavy = h
    window.__perfProjects = P

    // The frame recorder. The main thread's busy time is cut into frames:
    // every input event's task (from its first listener until the task after
    // it: the handlers and what they made the page draw again) and every
    // frame's own part (its animation callbacks, style, layout, paint, until
    // the task after it). One queue in order, each stretch counted once
    // (`lastEnd`). A frame's record: [its animation callback's time, the work
    // (ms), finished]. (A record per frame, not one slot written over: on a
    // late frame the next callback comes before the task that closes this one,
    // and the slow frames were the ones lost.)
    const F = { on: false, frames: [], acc: 0, lastEnd: 0, draws: [], seeks: [] }
    const queue = []
    const ch = new MessageChannel()
    ch.port1.onmessage = () => {
      const it = queue.shift()
      const now = performance.now()
      const d = Math.max(0, now - Math.max(it.t, F.lastEnd))
      F.lastEnd = now
      if (it.f) { it.f[1] += d; it.f[2] = 1 } else F.acc += d
    }
    const mark = () => { if (!F.on) return; queue.push({ t: performance.now() }); ch.port2.postMessage(0) }
    // (A scroll's own event comes inside the frame, before its animation
    // callbacks: marked too, or a scroll's work would not be counted.)
    for (const type of ['pointermove', 'wheel', 'scroll', 'pointerdown', 'pointerup', 'keydown']) window.addEventListener(type, mark, { capture: true, passive: true })
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
    F.start = () => { F.frames = []; F.draws = []; F.seeks = []; F.acc = 0; F.on = true }
    F.stop = () => {
      F.on = false
      const fr = F.frames.slice(1).filter((f) => f[2])
      return { frames: fr.map((f) => [+f[0].toFixed(2), +f[1].toFixed(2)]), gap: fr.slice(1).map((f, i) => +(f[0] - fr[i][0]).toFixed(2)), draws: F.draws, seeks: F.seeks }
    }
    window.__frames = F
    return true
  }, { media, cap10: caps(t10), cap30: caps(t30), cuts10: t10.cuts, cuts30: t30.cuts, heavy })
}

/** Loads a project and waits until its timeline is drawn and quiet (the sound
 *  drawings analysed, nothing left loading). */
export async function load(c, name, heightStep) {
  await c.run(async (name, heightStep) => {
    const S = window.__store
    S.getState().setPlaying(false)
    S.getState().loadProject(structuredClone(window.__perfProjects[name]))
    S.getState().setPxPerSec(60)
    S.getState().setTime(20)
    S.getState().setPlayheadSnap(true)
    // The lane height step, where the build has one (phase 3c.T): its control.
    // (The control is in Settings since DENEME-3; the view's own setter, or
    // the old toolbar button in an older build.)
    if (window.__timelineView) window.__timelineView.getState().setTrackScale(heightStep ?? 'medium')
    else document.querySelector(`[data-testid="timeline.trackHeight.${heightStep ?? 'medium'}"]`)?.click()
    S.getState().setDirty(false)
    return true
  }, name, heightStep ?? null)
  await c.waitFor('the timeline of ' + name, () => c.ev(`!!document.querySelector('[data-testid^="timeline.clip."]')`), 20000, 100)
  await c.run(() => { const el = document.querySelector('[data-testid="timeline.scroll"]'); el.scrollLeft = 0; el.scrollTop = 0; return true })
  await c.waitFor('the sound drawings of ' + name, () => c.ev(`!document.querySelector('.wave-loading')`), 180000, 250)
  // And until the page is quiet: a sound drawing shows what has been read so
  // far while the file is still being analysed (a 30-minute talk takes tens of
  // seconds), and that reading ran on under the measures that came after
  // (seen in a CPU profile of the trim: the peak analysis was most of its
  // slow frames). In use it is done once per file and kept on disk. Quiet:
  // under 60 ms of the page's task time in a second (CDP Performance
  // metrics), twice running.
  await c.send('Performance.enable')
  const busy = async () => (await c.send('Performance.getMetrics')).metrics.find((m) => m.name === 'TaskDuration')?.value ?? 0
  let calm = 0
  let quiet = false
  for (let i = 0; i < 180 && !quiet; i++) {
    const t0 = await busy()
    await c.sleep(1000)
    calm = (await busy()) - t0 < 0.06 ? calm + 1 : 0
    quiet = calm >= 2
  }
  if (!quiet) console.log(`(${name}: the page did not become quiet in 3 minutes; measured anyway)`)
  await c.sleep(300)
}

/** The work per frame at 60 pictures a second: the window may draw faster
 *  (144 here), and then most of its frames carry no input at all and the slow
 *  ones are thinned out among them. The recorded frames' work is summed into
 *  1/60 s slots, so the numbers mean the same on any screen. */
export const sixty = (frames) => {
  const slots = new Map()
  for (const [t, w] of frames) {
    const k = Math.floor((t - frames[0][0]) / (1000 / 60))
    slots.set(k, (slots.get(k) ?? 0) + w)
  }
  return [...slots.values()]
}

export const stats = (xs, over) => {
  const s = [...xs].sort((a, b) => a - b)
  const at = (q) => (s.length ? s[Math.min(s.length - 1, Math.floor(q * s.length))] : 0)
  return { med: +at(0.5).toFixed(2), p95: +at(0.95).toFixed(2), max: +(s[s.length - 1] ?? 0).toFixed(2), over: s.filter((x) => x > over).length, n: s.length }
}

/** The scroll area's box and a point in the middle of its lanes. */
const area = (c) => c.run(() => {
  const el = document.querySelector('[data-testid="timeline.scroll"]')
  const r = el.getBoundingClientRect()
  return { x: r.left, y: r.top, w: r.width, h: r.height, scrollLeft: el.scrollLeft }
})

/** A clip in view to work on. To drag: a point of its body with room to
 *  either side of it. To trim: its right edge, away from the view's edges.
 *  The first such clip in the page's order (the same one every run). */
const pickClip = (c, trim) => c.run((trim) => {
  const scroll = document.querySelector('[data-testid="timeline.scroll"]').getBoundingClientRect()
  for (const el of document.querySelectorAll('.tl-clip')) {
    const r = el.getBoundingClientRect()
    if (r.width < 90 || r.top < scroll.top + 24 || r.bottom > scroll.bottom) continue
    const y = r.top + r.height * 0.6
    let x
    if (trim) {
      if (r.right < scroll.left + 420 || r.right > scroll.right - 200) continue
      x = r.right - 4
    } else {
      x = Math.max(r.left + 40, scroll.left + 520)
      if (x > r.right - 30 || x > scroll.right - 520) continue
    }
    const hit = document.elementFromPoint(x, y)
    if (!hit || !el.contains(hit) || hit.closest('.motion-quick') || hit.closest('.fade-handle') || hit.closest('.clip-kf')) continue
    if (trim ? !hit.closest('.handle') : !!hit.closest('.handle')) continue
    return { id: el.dataset.clipId, x, y }
  }
  return null
}, trim)

export async function run(c, what, name) {
  const a = await area(c)
  const mid = { x: a.x + a.w / 2, y: a.y + Math.min(a.h - 30, 150) }
  const F = (js) => c.ev(`window.__frames.${js}`)
  const wheel = (dx, dy, mods = 0) => c.send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: mid.x, y: mid.y, deltaX: dx, deltaY: dy, modifiers: mods, pointerType: 'mouse' })
  // One input event per 24 ms, on a fixed clock: never two in one 1/60 s slot
  // (their work would be summed and the number would depend on how fast this
  // driver happened to run), and no faster when the page is quick.
  let due = performance.now()
  const frame = async (ms = 24) => {
    due += ms
    const wait = due - performance.now()
    if (wait > 0) await c.sleep(wait)
    else due = performance.now()
  }
  const depth = () => c.st((s) => s.past.length)
  const undoTo = async (d) => { for (let i = 0; i < 6 && (await depth()) > d; i++) await c.ev('window.__store.getState().undo()') }
  let out = null
  if (what === 'pan') {
    await c.mouse('mouseMoved', mid.x, mid.y)
    await F('start()')
    // Two seconds: right for one, back for one.
    const left0 = (await area(c)).scrollLeft
    let moved = 0
    for (let i = 0; i < 120; i++) { await wheel(i < 60 ? 60 : -60, 0); await frame(); if (i === 59) moved = (await area(c)).scrollLeft - left0 }
    out = await F('stop()')
    if (moved < 600) throw new Error(`tl.pan: the view scrolled ${moved} px`)
  } else if (what === 'zoom') {
    await c.mouse('mouseMoved', mid.x, mid.y)
    await F('start()')
    let top = 0
    for (let i = 0; i < 30; i++) { await wheel(0, i < 15 ? -100 : 100, 2); await frame(36); if (i === 14) top = await c.st((s) => s.pxPerSec) }
    await c.sleep(120)
    out = await F('stop()')
    if (top < 300) throw new Error(`tl.zoom: the zoom reached ${top} px/s`)
    await c.ev('window.__store.getState().setPxPerSec(60)')
  } else if (what === 'scrub') {
    const ruler = await c.box('timeline.ruler')
    const y = ruler.y + ruler.h / 2
    const x0 = a.x + 300
    // The preview's answer: each new time, and each drawing of the preview.
    await c.run(() => {
      const F = window.__frames, E = window.__engine, S = window.__store
      if (!F.wrapped || E.onDraw !== F.wrapped) {
        const orig = E.onDraw
        F.wrapped = (r) => { orig?.(r); if (F.on) F.draws.push([performance.now(), S.getState().currentTime]) }
        E.onDraw = F.wrapped
      }
      F.unsub?.()
      F.unsub = S.subscribe((s, p) => { if (F.on && s.currentTime !== p.currentTime) F.seeks.push([performance.now(), s.currentTime]) })
      return true
    })
    await c.mouse('mouseMoved', x0, y)
    await c.mouse('mousePressed', x0, y)
    await F('start()')
    for (let i = 1; i <= 120; i++) { await c.mouse('mouseMoved', x0 + (i <= 60 ? i : 120 - i) * 9, y, { down: true }); await frame() }
    await c.sleep(150)
    out = await F('stop()')
    await c.mouse('mouseReleased', x0, y)
    await c.ev('window.__frames.unsub?.()')
  } else if (what === 'dragClip' || what === 'trim') {
    const k = await pickClip(c, what === 'trim')
    if (!k) throw new Error(`no clip to ${what} in ${name}`)
    const d0 = await depth()
    if (what === 'dragClip') {
      await c.mouse('mouseMoved', k.x, k.y)
      await c.mouse('mousePressed', k.x, k.y)
      await F('start()')
      // 120 steps: out to the right, back past the start, and home.
      for (let i = 1; i <= 120; i++) { const t = i / 120; await c.mouse('mouseMoved', k.x + Math.sin(t * Math.PI * 2) * 320, k.y + (i > 50 && i < 70 ? 3 : 0), { down: true }); await frame() }
      out = await F('stop()')
      await c.mouse('mouseReleased', k.x, k.y)
    } else {
      const { x, y } = k
      await c.mouse('mouseMoved', x, y)
      await c.mouse('mousePressed', x, y)
      await F('start()')
      for (let i = 1; i <= 60; i++) { await c.mouse('mouseMoved', x - (i <= 30 ? i : 60 - i) * 2.5, y, { down: true }); await frame() }
      out = await F('stop()')
      await c.mouse('mouseReleased', x, y)
    }
    await c.sleep(150)
    await undoTo(d0)
    await c.ev('window.__store.getState().selectClip(null)')
  } else if (what === 'play') {
    // From just before the right edge of the view, so following has to act.
    await c.run((w) => { const S = window.__store.getState(); const el = document.querySelector('[data-testid="timeline.scroll"]'); S.setTime((el.scrollLeft + w - 110 - 110) / S.pxPerSec); return true }, a.w)
    await c.sleep(200)
    await c.ev('window.__store.getState().setPlaying(true)')
    await c.sleep(600)
    await F('start()')
    await c.sleep(3000)
    out = await F('stop()')
    await c.ev('window.__store.getState().setPlaying(false)')
    await c.run(() => { document.querySelector('[data-testid="timeline.scroll"]').scrollLeft = 0; window.__store.getState().setTime(20); return true })
  }
  await c.sleep(250)
  return out
}

/** Measures; returns { '<tl.what>.<project>': { unit, median (= p95), med, p95, over, gapP95, gapOver, n, target } }. */
export async function measureInteractions(c, { projects = ['ham10', 'ham30', 'heavy'], only = null, passes = 2, heightStep = null, log = () => undefined } = {}) {
  await setup(c)
  const out = {}
  for (const name of projects) {
    await load(c, name, heightStep)
    const target = name === 'heavy' ? TARGETS.heavy : TARGETS.light
    for (const what of INTERACTIONS) {
      const key = `tl.${what}.${name}${heightStep && heightStep !== 'medium' ? '.' + heightStep : ''}`
      if (only && !only.test(key)) continue
      await run(c, what, name) // the warm-up pass
      const work = [], gap = [], lag = []
      for (let p = 0; p < passes; p++) {
        const r = await run(c, what, name)
        work.push(...sixty(r.frames))
        gap.push(...r.gap)
        // Scrub: from a new time to the first drawing of the preview at it.
        if (what === 'scrub') {
          // (The first drawing after the seek: by then the newest time is the
          // one drawn; a seek overtaken before any drawing is not counted.)
          let j = 0
          r.seeks.forEach(([at], i) => {
            while (j < r.draws.length && r.draws[j][0] < at) j++
            const next = r.seeks[i + 1]?.[0] ?? Infinity
            if (j < r.draws.length && r.draws[j][0] <= next) lag.push(r.draws[j][0] - at)
          })
        }
      }
      const w = stats(work, target.over), g = stats(gap, target.over)
      out[key] = { unit: 'ms', median: w.p95, med: w.med, p95: w.p95, max: w.max, over: w.over, n: w.n, gapMed: g.med, gapP95: g.p95, gapOver: g.over, target: w.p95 <= target.p95 && w.over === 0 ? 'ok' : 'missed', floor: 5, limit: 1.5 }
      if (what === 'scrub' && lag.length) { const l = stats(lag, 50); out[`${key}.previewLag`] = { unit: 'ms', median: l.p95, med: l.med, p95: l.p95, max: l.max, n: l.n, floor: 10, limit: 1.5 } }
      log(key, out[key], out[`${key}.previewLag`])
    }
  }
  await c.ev(`(() => { const s = window.__store.getState(); s.newProject('16:9'); s.setDirty(false); return true })()`)
  return out
}

export function printRow(key, v, lag) {
  console.log(`${key.padEnd(26)} med ${String(v.med).padStart(6)}  p95 ${String(v.p95).padStart(6)}  max ${String(v.max).padStart(7)}  over ${String(v.over).padStart(3)} /${String(v.n).padStart(4)}   gap med ${String(v.gapMed).padStart(6)} p95 ${String(v.gapP95).padStart(6)} over ${String(v.gapOver).padStart(3)}   ${v.target}${lag ? `   preview lag med ${lag.med} p95 ${lag.p95}` : ''}`)
}

// ---- on its own ---------------------------------------------------------------
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const arg = (n, d) => { const a = process.argv.find((x) => x.startsWith(`--${n}=`)); return a ? a.slice(n.length + 3) : d }
  const newest = (dir) => { let t = 0; for (const e of readdirSync(dir, { withFileTypes: true })) t = Math.max(t, e.isDirectory() ? newest(join(dir, e.name)) : statSync(join(dir, e.name)).mtimeMs); return t }
  const built = join(APP_DIR, 'out', 'renderer', 'index.html')
  if (!process.argv.includes('--no-build') && (!existsSync(built) || newest(join(APP_DIR, 'src')) > statSync(built).mtimeMs)) {
    const r = spawnSync('cmd', ['/c', 'npm run build'], { cwd: APP_DIR, stdio: 'inherit' })
    if (r.status !== 0) process.exit(1)
  }
  const app = await launchApp({ agent: false })
  let result
  try {
    await ready(app.cdp)
    await editorAlone(app.cdp)
    await app.cdp.sleep(1500)
    result = await measureInteractions(app.cdp, { projects: arg('projects', 'ham10,ham30,heavy').split(','), only: arg('only', null) ? new RegExp(arg('only')) : null, passes: +arg('passes', 2), heightStep: arg('height', null), log: printRow })
  } finally {
    await app.close()
  }
  const commit = spawnSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: APP_DIR, encoding: 'utf8' }).stdout.trim()
  const file = arg('out', null)
  if (file) writeFileSync(file, JSON.stringify({ at: new Date().toISOString(), commit, label: arg('label', ''), metrics: result }, null, 1) + '\n')
  const missed = Object.entries(result).filter(([, v]) => v.target === 'missed').map(([k]) => k)
  console.log(missed.length ? `target missed: ${missed.join(', ')}` : 'every target met')
}
