// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// The Inspector scrolled (DENEME-2, worker U, item 7; the user: "sağdaki
// panelde hafif clunky oldu kaydırırken"): the main thread's work per frame
// while the Clip tab of a picture clip, every card open, is scrolled with the
// wheel under a still pointer, down and back up. Part of `npm run perf` (the
// insp.scroll row); also on its own:
//
//   node scripts/perf/inspector-scroll.mjs [--passes=3] [--no-build] [--out=<file.json>]
//
// A frame's time is measured as the timeline's (scripts/perf/interact.mjs:
// the input events' tasks and the frame's own work, summed into 1/60 s
// slots); the row's number is the 95th percentile. Beside it: how many times
// the preview drew while only the Inspector moved (`pvDraws`; it should be 0:
// a look tile sliding under the pointer drew the preview twice, its look and
// back, before item 7's repair).
import { spawnSync } from 'node:child_process'
import { existsSync, statSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { APP_DIR, launchApp } from '../e2e/app.mjs'
import { VOICEOVER } from '../e2e/media.mjs'
import { ready } from '../e2e/lib.mjs'
import { sixty, stats } from './interact.mjs'

const CARDS = ['Transform', 'Speed', 'Opacity', 'Audio', 'Color', 'Effects', 'Green screen (chroma key)', 'Mask', 'Crop', 'Keyframes', 'Animation', 'Camera look', 'Tracker']

/** The frame recorder (the same as interact.mjs's setup; installed once). */
async function recorder(c) {
  await c.run(() => {
    if (window.__frames) return true
    const F = { on: false, frames: [], acc: 0, lastEnd: 0 }
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
    F.start = () => { F.frames = []; F.acc = 0; F.on = true }
    F.stop = () => {
      F.on = false
      const fr = F.frames.slice(1).filter((f) => f[2])
      return { frames: fr.map((f) => [+f[0].toFixed(2), +f[1].toFixed(2)]), gap: fr.slice(1).map((f, i) => +(f[0] - fr[i][0]).toFixed(2)) }
    }
    window.__frames = F
    return true
  })
}

/** Measures; returns { 'insp.scroll': { unit, median (= p95), med, p95, max, over, n, pvDraws } }. */
export async function measureInspectorScroll(c, { passes = 3, log = () => undefined } = {}) {
  await recorder(c)
  // A picture clip (its Color card holds the look tiles), every card open.
  const img = join(VOICEOVER, '4.jpg')
  await c.run(async (file, cards) => {
    const S = window.__store
    S.getState().newProject('16:9')
    const reg = await window.api.testRegisterMedia(file)
    const [a] = S.getState().addAssets([{ id: 'insp-img', kind: 'image', name: reg.name, path: reg.path, url: reg.url, size: reg.size, duration: 0, width: 960, height: 540, hasAudio: false }])
    S.getState().addToTimeline(a.id)
    const st = JSON.parse(localStorage.getItem('snipp-sections') ?? '{}')
    for (const id of cards) st[id] = true
    localStorage.setItem('snipp-sections', JSON.stringify(st))
    const id = Object.keys(S.getState().project.clips)[0]
    S.setState({ selectedClipIds: [id] })
    S.getState().setDirty(false)
    return true
  }, img, CARDS)
  await c.ev(`document.querySelector('[data-testid="inspector.tab.clip"]')?.click(), true`)
  await c.waitFor('the Clip tab', () => c.ev(`!!document.querySelector('[data-testid="inspector.card.transform"]')`), 8000)
  await c.sleep(800)
  const body = await c.run(() => {
    const b = document.querySelector('.inspector > .body')
    b.scrollTop = 0
    const r = b.getBoundingClientRect()
    // The preview's drawings (each starts with setTransform on its canvas).
    window.__pvDraws = 0
    for (const cv of document.querySelectorAll('.preview-canvas-wrap > canvas:not(.note-draw-layer)')) {
      const g = cv.getContext('2d')
      if (!g || g.__counted) continue
      const o = g.setTransform.bind(g)
      g.setTransform = (...x) => { window.__pvDraws++; return o(...x) }
      g.__counted = true
    }
    return { x: r.left + r.width / 2, y: r.top + r.height / 2, room: b.scrollHeight - b.clientHeight }
  })
  if (body.room < 300) throw new Error(`insp.scroll: the Inspector scrolls only ${body.room} px`)
  await c.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: body.x, y: body.y, button: 'none', pointerType: 'mouse' })
  const pass = async () => {
    let due = performance.now()
    await c.ev('window.__pvDraws = 0, window.__frames.start(), true')
    // 120 wheel steps: 60 down, 60 back up, one every 24 ms.
    for (let i = 0; i < 120; i++) {
      await c.send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: body.x, y: body.y, deltaX: 0, deltaY: i < 60 ? 60 : -60, pointerType: 'mouse' })
      due += 24
      const wait = due - performance.now()
      if (wait > 0) await c.sleep(wait)
      else due = performance.now()
    }
    await c.sleep(150)
    const r = await c.ev('window.__frames.stop()')
    return { ...r, pvDraws: await c.ev('window.__pvDraws') }
  }
  await pass() // the warm-up
  const work = []
  let pvDraws = 0
  for (let i = 0; i < passes; i++) {
    const r = await pass()
    work.push(...sixty(r.frames))
    pvDraws += r.pvDraws
  }
  const w = stats(work, 33)
  const out = { 'insp.scroll': { unit: 'ms', median: w.p95, med: w.med, p95: w.p95, max: w.max, over: w.over, n: w.n, pvDraws, floor: 5, limit: 1.5 } }
  log('insp.scroll', out['insp.scroll'])
  await c.ev(`(() => { const s = window.__store.getState(); s.newProject('16:9'); s.setDirty(false); return true })()`)
  return out
}

export function printInspRow(key, v) {
  console.log(`${key.padEnd(26)} med ${String(v.med).padStart(6)}  p95 ${String(v.p95).padStart(6)}  max ${String(v.max).padStart(7)}  over ${String(v.over).padStart(3)} /${String(v.n).padStart(4)}   preview drawings ${v.pvDraws}`)
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
    await app.cdp.sleep(1500)
    result = await measureInspectorScroll(app.cdp, { passes: +arg('passes', 3), log: printInspRow })
  } finally {
    await app.close()
  }
  const file = arg('out', null)
  if (file) writeFileSync(file, JSON.stringify({ at: new Date().toISOString(), metrics: result }, null, 1) + '\n')
}
