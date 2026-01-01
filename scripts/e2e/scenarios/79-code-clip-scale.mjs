// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// Phase 5d.2, decision 6 (Ç3's report R4; FAZ5-PLAN.md "5d.2"): an export
// draws each code film at k = output height / film height (1 … 2):
//  - the portrait film of the test material (its own renderOut, 1080 × 1920, sized by
//    devicePixelRatio) in a 4K portrait export (2160 × 3840): its page is
//    loaded again with devicePixelRatio 2; the width of its strong edges in
//    the exported frame is ≤ 1.1× that of its own 4K draw (the page asked at
//    scale 2 directly); the old way (its 1080 × 1920 frame enlarged) is
//    measured beside it;
//  - F2 (a whole page, tier 3) in a 4K export: its drawing window is made
//    at scale 2, the exported text is as sharp as its own 4K draw;
//  - after each export the page draws at 1 again.
import { join } from 'node:path'
import { FILM, TESTDATA } from '../media.mjs'

export const name = 'code-clip-scale'
export const timeoutMs = 600_000

const PORTRAIT = FILM.portrait
const F2 = join(TESTDATA, 'kod-klibi-serbest', 'F2-html')

async function load(c, folder, duration) {
  return c.run(async (folder, duration) => {
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
      await new Promise((r) => setTimeout(r, 50))
    }
    const st = films.codeFilms.status(id)
    return { id, ms: Math.round(performance.now() - t0), status: st ? { ...st } : null, asset: { width: asset().width, height: asset().height, duration: asset().duration, mode: asset().code?.mode } }
  }, folder, duration)
}

/** Exports `moments` of the film at `outW` × `outH` (a project of the film's
 *  size, resolutionScale 2), and measures the width of the strong edges in
 *  the exported frame, the page's own draw at that scale, and its 1× frame
 *  enlarged. */
async function measure(c, id, moments) {
  return c.run(async (id, moments) => {
    const S = window.__store
    const ex = await window.__exporter()
    const [films] = await window.__codeFilm()
    const asset = () => S.getState().project.assets.find((x) => x.id === id)
    const A = asset()
    const W = A.width
    const H = A.height
    const OW = W * 2
    const OH = H * 2
    const p = structuredClone(S.getState().project)
    p.settings = { ...p.settings, width: W, height: H, fps: 30 }
    p.mode = 'frame'
    p.tracks = [{ id: 'V1', kind: 'video', name: 'V1', clipIds: ['k'] }, { id: 'A1', kind: 'audio', name: 'A1', clipIds: [] }]
    p.clips = { k: { id: 'k', assetId: id, trackId: 'V1', start: 0, inPoint: 0, duration: Math.min(A.duration, 20), transform: { x: W / 2, y: H / 2, scale: 1, rotation: 0 }, volume: 1 } }
    p.captions = []
    p.templates = []
    S.getState().loadProject(p)
    S.setState({ selectedClipIds: [], playing: false })
    const pixels = (src, w, h, smooth) => {
      const o = new OffscreenCanvas(w, h)
      const g = o.getContext('2d')
      g.fillStyle = '#000'
      g.fillRect(0, 0, w, h)
      if (smooth) {
        g.imageSmoothingEnabled = true
        g.imageSmoothingQuality = 'high'
      }
      g.drawImage(src, 0, 0, w, h)
      return g.getImageData(0, 0, w, h).data
    }
    // The width of a strong edge: along each row, a run of pixels whose
    // brightness goes one way and changes by ≥ 100 / 255 in all; its width is
    // 1 + the pixels strictly between 10 % and 90 % of the change (a crisp
    // edge 1, one enlarged 2× about 2). The mean over every such edge.
    const edges = (d, w, h) => {
      const L = new Float32Array(w)
      let sum = 0
      let n = 0
      for (let y = 0; y < h; y += 2) {
        const row = y * w * 4
        for (let x = 0; x < w; x++) L[x] = 0.299 * d[row + x * 4] + 0.587 * d[row + x * 4 + 1] + 0.114 * d[row + x * 4 + 2]
        let x = 0
        while (x < w - 1) {
          const dir = Math.sign(L[x + 1] - L[x])
          if (!dir) {
            x++
            continue
          }
          let b = x + 1
          while (b < w - 1 && Math.sign(L[b + 1] - L[b]) === dir) b++
          const la = L[x]
          const lb = L[b]
          if (Math.abs(lb - la) >= 100 && b - x <= 16) {
            let mid = 0
            for (let i = x; i <= b; i++) {
              const f = (L[i] - la) / (lb - la)
              if (f > 0.1 && f < 0.9) mid++
            }
            sum += 1 + mid
            n++
          }
          x = b
        }
      }
      return { mean: n ? Math.round((sum / n) * 1000) / 1000 : null, n }
    }
    const out = { W, H, OW, OH, moments: [] }
    for (const t of moments) {
      // 1. The export (its own drawer, the frame before the encoder).
      let png = null
      let during = null
      await ex.exportProjectMp4(S.getState().project, {
        settings: { container: 'mp4', resolutionScale: 2, fps: 30, bitrateFactor: 0.12, range: [t, t + 0.1], probe: [0], probePng: true },
        onProgress(frac) {
          // (While its frames are drawn.)
          if (frac > 0) during = films.codeFilms.scaleOf(id)
        },
        onProbe: (_i, h) => {
          png = h.slice(h.indexOf(':') + 1)
          during = films.codeFilms.scaleOf(id)
        }
      })
      const after = films.codeFilms.scaleOf(id)
      const bin = atob(png)
      const u8 = new Uint8Array(bin.length)
      for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i)
      const shot = await createImageBitmap(new Blob([u8]))
      const exported = pixels(shot, OW, OH)
      const size = [shot.width, shot.height]
      shot.close()
      // 2. The page's own draw at scale 2 (asked straight, as the export asks it).
      films.codeFilms.lockForExport(true)
      films.codeFilms.exportHeight(OH)
      let native
      let nativeSize
      try {
        const b = await films.codeFilms.exactFrame(asset(), t)
        nativeSize = [b.width, b.height]
        native = pixels(b, OW, OH)
        b.close()
      } finally {
        films.codeFilms.lockForExport(false)
      }
      // 3. The old way: its 1× frame, enlarged.
      const b1 = await films.codeFilms.exactFrame(asset(), t)
      const oneSize = [b1.width, b1.height]
      const old = pixels(b1, OW, OH, true)
      b1.close()
      // How far the exported frame is from its own 4K draw, and from the old way.
      const far = (a, b) => {
        let bad = 0
        for (let i = 0; i < a.length; i += 4) if (Math.abs(a[i] - b[i]) > 28 || Math.abs(a[i + 1] - b[i + 1]) > 28 || Math.abs(a[i + 2] - b[i + 2]) > 28) bad++
        return Math.round((bad / (a.length / 4)) * 10000) / 100
      }
      const vsNative = far(exported, native)
      const vsOld = far(exported, old)
      const e = edges(exported, OW, OH)
      const nv = edges(native, OW, OH)
      const o = edges(old, OW, OH)
      out.moments.push({ t, vsNative, vsOld, size, nativeSize, oneSize, during, after, exported: e, native: nv, old: o, ratio: e.mean && nv.mean ? Math.round((e.mean / nv.mean) * 1000) / 1000 : null, oldRatio: o.mean && nv.mean ? Math.round((o.mean / nv.mean) * 1000) / 1000 : null })
    }
    out.scaleAfter = films.codeFilms.scaleOf(id)
    return out
  }, id, moments)
}

export async function run({ c, lib, work }) {
  const { assert } = lib
  await c.run(() => window.api.testFilmProbe({ kind: 'mute', on: true }))
  const fail = []
  const check = (ok, msg) => {
    if (!ok) fail.push(msg)
  }

  // ---- the portrait film: the fast path (its own renderOut), 4K portrait ----
  const portrait = await load(c, PORTRAIT)
  console.log('     portrait load:', JSON.stringify(portrait))
  assert.equal(portrait.status?.state, 'ready', `the portrait film did not start: ${portrait.status?.error}`)
  assert.equal(portrait.status.mode, 'fast')
  assert.deepEqual([portrait.asset.width, portrait.asset.height], [1080, 1920])
  const k = await measure(c, portrait.id, [4, 9.5, 15])
  for (const m of k.moments) console.log(`     portrait ${m.t} s: exported ${m.size} (scale during the export ${m.during}, after ${m.after}); edge width exported ${m.exported.mean} (${m.exported.n}), own 4K draw ${m.native.mean} (${m.native.n}) ${m.nativeSize}, 1× enlarged ${m.old.mean} (${m.old.n}); ratio ${m.ratio}, old ${m.oldRatio}; pixels beyond 28 vs its own 4K draw ${m.vsNative} %, vs the old way ${m.vsOld} %`)
  for (const m of k.moments) {
    check(m.size[0] === 2160 && m.size[1] === 3840, `portrait ${m.t} s: exported ${m.size}`)
    check(m.nativeSize[0] === 2160 && m.nativeSize[1] === 3840, `portrait ${m.t} s: its own draw at 2 is ${m.nativeSize}`)
    check(m.during === 2, `portrait ${m.t} s: the export drew it at ${m.during}`)
    check(m.after === 1, `portrait ${m.t} s: after the export it draws at ${m.after}`)
    check(m.exported.n > 200 && m.ratio !== null && m.ratio <= 1.1, `portrait ${m.t} s: edge width ${m.ratio}× its own 4K draw (> 1.1)`)
    check(m.vsNative <= 0.5, `portrait ${m.t} s: the exported frame is not its own 4K draw (${m.vsNative} % of the pixels beyond 28)`)
  }

  // ---- F2: a whole page (tier 3), 4K -----------------------------------------
  const f2 = await load(c, F2, 6)
  assert.equal(f2.status?.state, 'ready', `F2 did not start: ${f2.status?.error}`)
  assert.equal(f2.status.mode, 'page')
  const f = await measure(c, f2.id, [2.75])
  for (const m of f.moments) console.log(`     F2 ${m.t} s: exported ${m.size} (scale during ${m.during}, after ${m.after}); edge width exported ${m.exported.mean} (${m.exported.n}), own 4K draw ${m.native.mean} (${m.native.n}) ${m.nativeSize}, 1× enlarged ${m.old.mean}; ratio ${m.ratio}, old ${m.oldRatio}; vs its own 4K draw ${m.vsNative} %, vs the old way ${m.vsOld} %`)
  for (const m of f.moments) {
    check(m.size[0] === f.OW && m.size[1] === f.OH && f.OW === f.W * 2, `F2: exported ${m.size}`)
    check(m.during === 2 && m.after === 1, `F2: scale during ${m.during}, after ${m.after}`)
    check(m.ratio !== null && m.ratio <= 1.1, `F2: edge width ${m.ratio}× its own 4K draw (> 1.1)`)
  }
  // ---- (5c + 5d audit patch, K1) a fast-path page that makes its scene with
  // Math.random while it loads: loaded again for the export, it would draw
  // other stars. The exported frame is the preview's own moment (enlarged),
  // and the preview after the export is byte for byte the one before.
  const rnd = await chancePart(c, work)
  console.log('     K1 chance page:', JSON.stringify(rnd))
  check(rnd.mode === 'fast', `K1: the chance page runs ${rnd.mode}`)
  check(rnd.exportSize[0] === 2560 && rnd.exportSize[1] === 1440, `K1: exported ${rnd.exportSize}`)
  check(rnd.exportVsPreview.badPct <= 0.5, `K1: the exported frame is not the preview's moment (${rnd.exportVsPreview.badPct} % of the pixels beyond 28)`)
  check(rnd.previewBeforeVsAfter.max === 0, `K1: the preview changed with the export (${JSON.stringify(rnd.previewBeforeVsAfter)})`)
  check(rnd.during === 1, `K1: a page with chance at load was loaded again for the export (scale ${rnd.during})`)
  // The portrait film's export at 2 is also its preview's moment (enlarged): 1× frame vs export.
  for (const m of k.moments) check(m.vsOld <= 0.5, `portrait ${m.t} s: the exported frame is not its 1× frame enlarged (${m.vsOld} %)`)

  // ---- (audit patch, K2) a whole page that says no size, added to a 1280 ×
  // 720 project, then the project is made 1080p (the clip scaled 1.5 to fill
  // it): the 1080p export opens its page again at k = 1.5. It must open at
  // the asset's known size, not at the project's new one.
  const ns = await noSizePart(c, work)
  console.log('     K2 no-size page:', JSON.stringify(ns))
  check(ns.firstSize[0] === 1280 && ns.firstSize[1] === 720, `K2: first size ${ns.firstSize}`)
  check(ns.sizeAfterExport[0] === 1280 && ns.sizeAfterExport[1] === 720, `K2: the asset's size changed with the export: ${ns.sizeAfterExport}`)
  check(ns.previewVsExport.badPct <= 0.5, `K2: preview ≠ export (${ns.previewVsExport.badPct} % beyond 28)`)
  check(ns.previewBeforeVsAfter.badPct <= 0.5, `K2: the preview changed with the export (${ns.previewBeforeVsAfter.badPct} %)`)
  check(ns.boxAfter[0] === 255 && ns.boxAfter[1] === 136 && ns.boxAfter[2] === 0, `K2: the page's bottom-right box left the frame: ${ns.boxAfter}`)

  if (fail.length) throw new Error(fail.join('\n'))
}

const CHANCE_PAGE = `<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;background:#000;overflow:hidden}</style></head><body>
<canvas id="c"></canvas><script>
window.__config = { width: 1280, height: 720, fps: 30, duration: 6 }
const dpr = window.devicePixelRatio || 1
const cv = document.getElementById('c'); cv.width = 1280 * dpr; cv.height = 720 * dpr; cv.style.width = '1280px'; cv.style.height = '720px'
const g = cv.getContext('2d'); g.scale(dpr, dpr)
const stars = []
for (let i = 0; i < 200; i++) stars.push({ x: Math.random() * 1270, y: Math.random() * 710, s: 4 + Math.random() * 10 })
window.renderOut = (t) => {
  g.fillStyle = '#000'; g.fillRect(0, 0, 1280, 720)
  g.fillStyle = '#fff'
  for (const s of stars) g.fillRect(s.x, s.y, s.s, s.s)
  g.fillStyle = '#f40'; g.fillRect((t * 200) % 1280, 360, 40, 40)
}
window.READY = true
</script></body></html>`

const NO_SIZE_PAGE = `<!doctype html><html><head><meta charset="utf-8"><style>
html,body{margin:0;overflow:hidden;background:#123}
#t{position:absolute;left:5vw;top:10vh;font:700 8vw Arial,sans-serif;color:#fff}
#b{position:absolute;right:0;bottom:0;width:300px;height:200px;background:#f80}
</style></head><body><div id="t">Size</div><div id="b"></div></body></html>`

/** In the page: the project of `pw` × `ph` with the film as one clip (scale
 *  `sc`), helpers to read the paused preview and an exported frame. */
const IN_PAGE_HELPERS = () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
  const cmp = (a, b) => {
    if (!a || !b || a.length !== b.length) return { bad: -1, badPct: 100, max: -1 }
    let bad = 0
    let max = 0
    for (let i = 0; i < a.length; i += 4) {
      let m = 0
      for (let k = 0; k < 4; k++) m = Math.max(m, Math.abs(a[i + k] - b[i + k]))
      if (m > max) max = m
      if (m > 28) bad++
    }
    return { bad, badPct: Math.round((bad / (a.length / 4)) * 10000) / 100, max }
  }
  const load = async (folder, duration) => {
    const S = window.__store
    const [films, imp] = await window.__codeFilm()
    const info = await window.api.codeFilm.register(folder)
    const a0 = (await imp.codeFilmImport(info)).assets.find((a) => a.kind === 'code')
    if (duration) a0.duration = duration
    const [a] = S.getState().addAssets([a0])
    const id = (a ?? a0).id
    const asset = () => S.getState().project.assets.find((x) => x.id === id)
    const t0 = performance.now()
    while (performance.now() - t0 < 150000) {
      films.codeFilms.ensure(asset())
      const st = films.codeFilms.status(id)
      if (st?.state === 'ready' || st?.state === 'error') break
      await sleep(50)
    }
    // (The bin's strip asks its frames first.)
    while (!asset().filmstrip && performance.now() - t0 < 200000 && films.codeFilms.status(id)?.state === 'ready') await sleep(100)
    return id
  }
  const project = (pw, ph, id, sc) => {
    const S = window.__store
    const p = structuredClone(S.getState().project)
    p.settings = { ...p.settings, width: pw, height: ph, fps: 30 }
    p.mode = 'frame'
    p.tracks = [{ id: 'V1', kind: 'video', name: 'V1', clipIds: id ? ['k'] : [] }, { id: 'A1', kind: 'audio', name: 'A1', clipIds: [] }]
    p.clips = id ? { k: { id: 'k', assetId: id, trackId: 'V1', start: 0, inPoint: 0, duration: 6, transform: { x: pw / 2, y: ph / 2, scale: sc, rotation: 0 }, volume: 1 } } : {}
    p.captions = []
    p.templates = []
    S.getState().loadProject(p)
    S.setState({ selectedClipIds: [], playing: false })
  }
  const shown = async (id, t) => {
    const S = window.__store
    const [films] = await window.__codeFilm()
    const R = await window.__render()
    const P = S.getState().project
    S.getState().setTime(t)
    for (let i = 0; i < 300; i++) {
      await sleep(100)
      if (films.codeFilms.status(id)?.state === 'ready' && films.codeFilms.heldTimes(id, 'k').some((x) => Math.abs(x - t) < 1e-6)) {
        await sleep(200)
        const o = new OffscreenCanvas(P.settings.width, P.settings.height)
        R.renderFrame(o.getContext('2d'), S.getState().project, S.getState().currentTime, window.__engine.resolve, { scale: 1, quality: 'refine' })
        return o.getContext('2d').getImageData(0, 0, P.settings.width, P.settings.height).data
      }
    }
    return null
  }
  const exported = async (id, t, resolutionScale, w, h) => {
    const S = window.__store
    const ex = await window.__exporter()
    const [films] = await window.__codeFilm()
    let png = null
    let during = null
    await ex.exportProjectMp4(S.getState().project, {
      settings: { container: 'mp4', resolutionScale, fps: 30, bitrateFactor: 0.12, range: [t, t + 0.05], probe: [0], probePng: true },
      onProgress() {},
      onProbe: (_i, hx) => {
        png = hx.slice(hx.indexOf(':') + 1)
        during = films.codeFilms.scaleOf(id)
      }
    })
    const bin = atob(png)
    const u8 = new Uint8Array(bin.length)
    for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i)
    const s = await createImageBitmap(new Blob([u8]))
    const size = [s.width, s.height]
    const o = new OffscreenCanvas(w, h)
    const g = o.getContext('2d')
    g.imageSmoothingEnabled = true
    g.imageSmoothingQuality = 'high'
    g.drawImage(s, 0, 0, w, h)
    s.close()
    return { px: g.getImageData(0, 0, w, h).data, size, during }
  }
  window.__k12 = { sleep, cmp, load, project, shown, exported }
}

async function chancePart(c, work) {
  const { mkdirSync, writeFileSync } = await import('node:fs')
  const dir = join(work, 'k1-chance')
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'index.html'), CHANCE_PAGE)
  await c.run(IN_PAGE_HELPERS)
  return c.run(async (dir) => {
    const { cmp, load, project, shown, exported } = window.__k12
    const [films] = await window.__codeFilm()
    project(1280, 720, null, 1)
    const id = await load(dir, 6)
    project(1280, 720, id, 1)
    const T = 2.5
    const before = await shown(id, T)
    // A 1440p export (k = 2), its frame brought back to 1280 × 720.
    const e = await exported(id, T, 2, 1280, 720)
    window.__store.getState().setTime(0)
    const after = await shown(id, T)
    return { mode: films.codeFilms.status(id)?.mode, exportSize: e.size, during: e.during, exportVsPreview: cmp(before, e.px), previewBeforeVsAfter: cmp(before, after) }
  }, dir)
}

async function noSizePart(c, work) {
  const { mkdirSync, writeFileSync } = await import('node:fs')
  const dir = join(work, 'k2-nosize')
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'index.html'), NO_SIZE_PAGE)
  await c.run(IN_PAGE_HELPERS)
  return c.run(async (dir) => {
    const { cmp, load, project, shown, exported } = window.__k12
    const S = window.__store
    const asset = (id) => S.getState().project.assets.find((x) => x.id === id)
    project(1280, 720, null, 1)
    const id = await load(dir, 6)
    const firstSize = [asset(id).width, asset(id).height]
    // The project becomes 1080p; the clip fills it.
    project(1920, 1080, id, 1080 / asset(id).height)
    const before = await shown(id, 2)
    const e = await exported(id, 2, 1, 1920, 1080)
    const sizeAfterExport = [asset(id).width, asset(id).height]
    S.getState().setTime(0)
    const after = await shown(id, 2)
    const at = (d, x, y) => (d ? [...d.subarray((y * 1920 + x) * 4, (y * 1920 + x) * 4 + 4)] : null)
    return { firstSize, sizeAfterExport, exportSize: e.size, previewVsExport: cmp(before, e.px), previewBeforeVsAfter: cmp(before, after), boxAfter: at(after, 1900, 1060) }
  }, dir)
}
