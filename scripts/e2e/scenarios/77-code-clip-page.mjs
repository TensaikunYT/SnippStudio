// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// Phase 5d.1, done measure (FAZ5-PLAN.md, "5d.1"): a page that shows more
// than canvases (HTML text, CSS boxes, an SVG) and knows nothing of the app
// plays as a code clip: a hidden window of the main process draws it whole
// (main/film-window.ts) and each picture comes to the editor as a shared
// texture, matched to the frame asked for by the marker row.
//   - 600 frames of a DOM counter, one after another: each picture shows the
//     frame that was asked (the number is read back from the picture);
//   - the time from asking a 1920 × 1080 frame to having its picture;
//   - going back (the page is loaded again and stepped forward), a smaller
//     picture (the preview's size while playing);
//   - the frame is see-through where the page is: over a talk video, the
//     exported frame is the video there, and the paused preview equals it;
//   - the fences: the page reads neither the user's media nor another film,
//     opens no window and no box, cannot take its window elsewhere;
//   - decision 3: a page in a loop that never ends is stopped and its clip
//     failed while the editor goes on answering; a page whose process holds
//     more memory than the limit is let go (the limit lowered for the test);
//   - no drawing window is left when its film goes, or the editor page does.
// The window is muted for the whole scenario.
import { cpSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

export const name = 'code-clip-page'
export const timeoutMs = 420_000

// Nothing of the app in it: a counter in the DOM driven by
// requestAnimationFrame and performance.now, its number also as twelve
// black / white boxes (read back from the picture), a half see-through box,
// an SVG circle. No size, no length, no background.
const COUNTER = `<!doctype html>
<html><head><meta charset="utf-8"><style>
html, body { margin: 0; overflow: hidden }
#n { position: absolute; left: 60px; top: 40px; font: 700 120px Arial, sans-serif; color: #fff }
#bits { position: absolute; left: 60px; top: 400px; display: flex }
#bits i { display: block; width: 60px; height: 60px; background: #000 }
#bits i.on { background: #fff }
#half { position: absolute; left: 60px; top: 600px; width: 400px; height: 200px; background: rgba(255, 0, 0, 0.5) }
svg { position: absolute; left: 600px; top: 600px }
</style></head><body>
<div id="n">0</div><div id="bits"></div><div id="half"></div>
<svg width="200" height="200"><circle cx="100" cy="100" r="80" fill="#0080ff"/></svg>
<script>
const bits = document.getElementById('bits')
for (let i = 0; i < 12; i++) bits.appendChild(document.createElement('i'))
const t0 = performance.now()
function frame(now) {
  const f = Math.round(((now - t0) * 60) / 1000)
  document.getElementById('n').textContent = String(f)
  for (let i = 0; i < 12; i++) bits.children[i].className = (f >> i) & 1 ? 'on' : ''
  requestAnimationFrame(frame)
}
requestAnimationFrame(frame)
</script></body></html>`

// The hostile page, as a whole page: what it could read or open.
const HOSTILE = `<!doctype html>
<html><head><meta charset="utf-8"></head><body style="margin:0">
<h1 style="color:#fff">fence</h1>
<script>
const say = (k, v) => console.error('Z ' + k + ': ' + (typeof v === 'string' ? v : JSON.stringify(v)))
;(async () => {
  const T = await (await fetch('targets.json')).json()
  const R = {}
  const tryIt = async (k, f) => { try { R[k] = await f() } catch (e) { R[k] = 'refused' } }
  await tryIt('mediaCors', async () => { const r = await fetch(T.media); return r.ok ? 'READ ' + (await r.arrayBuffer()).byteLength : 'refused ' + r.status })
  await tryIt('mediaNoCors', async () => { const r = await fetch(T.media, { mode: 'no-cors' }); return r.type === 'opaque' ? 'opaque' : 'READ' })
  await tryIt('filmCors', async () => { const r = await fetch(T.otherFilm + 'index.html'); return r.ok ? 'READ ' + (await r.text()).length : 'refused ' + r.status })
  await tryIt('import', async () => 'READ ' + (await import(T.otherFilm + 'm.js')).secret)
  await tryIt('net', async () => { const r = await fetch('https://example.com/'); return 'READ ' + r.status })
  R.img = await new Promise((res) => { const i = new Image(); i.onload = () => res('loaded ' + i.naturalWidth); i.onerror = () => res('refused'); i.src = T.image; setTimeout(() => res('refused (timeout)'), 4000) })
  let opened = 'threw'
  try { opened = window.open('about:blank') === null ? 'null' : 'OPENED' } catch (e) {}
  R.open = opened
  const a = performance.now()
  try { alert('a box'); R.alert = 'returned in ' + Math.round(performance.now() - a) + ' ms' } catch (e) { R.alert = 'threw' }
  try { top.location.href = T.otherFilm + 'index.html'; R.top = 'asked' } catch (e) { R.top = 'threw' }
  say('page', R)
  say('done', 'yes')
})()
</script></body></html>`

// A loop that never ends, entered in the first frame after half a second.
const LOOP = `<!doctype html><html><body style="margin:0"><h1 style="color:#fff">loop</h1><script>
requestAnimationFrame(function f(t) { if (t > 500) for (;;) {} requestAnimationFrame(f) })
</script></body></html>`

// Memory: 64 MB more on every frame after the first, up to 1.3 GB.
const HUNGRY = `<!doctype html><html><body style="margin:0"><h1 style="color:#fff">memory</h1><script>
window.keep = []
requestAnimationFrame(function f(t) { if (t > 10 && keep.length < 20) { const a = new Uint8Array(64 * 1024 * 1024); a.fill(1); keep.push(a) } requestAnimationFrame(f) })
</script></body></html>`

const probe = (c, q) => c.run((q) => window.api.testFilmProbe(q), q)

/** Registers the page at `folder` and starts it; answers when it runs or failed. */
async function load(c, folder) {
  return c.run(async (folder) => {
    const S = window.__store
    const [films, imp] = await window.__codeFilm()
    const info = await window.api.codeFilm.register(folder)
    const a0 = (await imp.codeFilmImport(info)).assets.find((a) => a.kind === 'code')
    const [a] = S.getState().addAssets([a0])
    const id = (a ?? a0).id
    const asset = () => S.getState().project.assets.find((x) => x.id === id)
    const t0 = performance.now()
    films.codeFilms.ensure(asset())
    while (performance.now() - t0 < 60000) {
      const st = films.codeFilms.status(id)
      if (st?.state === 'ready' || st?.state === 'error') break
      films.codeFilms.ensure(asset())
      await new Promise((r) => setTimeout(r, 50))
    }
    const st = films.codeFilms.status(id)
    return { id, url: asset().url, ms: Math.round(performance.now() - t0), status: st ? { ...st } : null, steps: (await films.codeFilms.bootTrace(id))?.steps ?? [], asset: { width: asset().width, height: asset().height, duration: asset().duration, mode: asset().code?.mode } }
  }, folder)
}

export async function run({ c, app, media, lib, work, relaunch }) {
  const { assert } = lib
  await probe(c, { kind: 'mute', on: true })
  try {
    const [talk1080] = await lib.seedAssets(app, c, [media.talk1080])

    // ---- the counter page: starts in a drawing window ----------------------
    const dir = join(work, 'counter')
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'index.html'), COUNTER)
    const film = await load(c, dir)
    console.log('     counter page:', JSON.stringify({ ms: film.ms, status: film.status, asset: film.asset, steps: film.steps }))
    assert.equal(film.status?.state, 'ready', JSON.stringify(film))
    assert.equal(film.status.mode, 'page')
    assert.equal(film.asset.mode, 'page')
    assert.deepEqual([film.asset.width, film.asset.height], [1920, 1080], 'a page that says no size is the project\'s size')
    const wins = await probe(c, { kind: 'windows' })
    assert.equal(wins.length, 1, JSON.stringify(wins))
    assert.match(wins[0].url, /^snippfilm:\/\/[a-f0-9]{16}\/__snipp\/host\.html\?win=1/)
    const frames = await probe(c, { kind: 'frames' })
    assert.ok(wins[0].pid > 0 && wins[0].pid !== frames.editorPid && wins[0].pid !== frames.browserPid, 'the drawing window is a process of its own')
    assert.ok(!frames.frames.some((f) => f.url.includes(film.url.slice(12, 28))), 'no frame of the film is left in the editor')

    // ---- 600 frames, each the one asked for; step -> frame time -----------
    const run600 = await c.run(async (id) => {
      const S = window.__store
      const [films] = await window.__codeFilm()
      const asset = () => S.getState().project.assets.find((x) => x.id === id)
      // (The bin's strip asks its frames first.)
      const t0 = performance.now()
      while (!asset().filmstrip && performance.now() - t0 < 60000) await new Promise((r) => setTimeout(r, 100))
      const o = new OffscreenCanvas(12, 1)
      const g = o.getContext('2d', { willReadFrequently: true })
      const read = (bmp, k = 1) => {
        g.clearRect(0, 0, 12, 1)
        for (let i = 0; i < 12; i++) g.drawImage(bmp, (90 + 60 * i) * k, 430 * k, 1, 1, i, 0, 1, 1)
        const d = g.getImageData(0, 0, 12, 1).data
        let n = 0
        for (let i = 0; i < 12; i++) {
          const v = d[i * 4]
          if (d[i * 4 + 3] !== 255 || (v > 8 && v < 247)) return -1
          if (v >= 247) n |= 1 << i
        }
        return n
      }
      const ms = []
      const wrong = []
      let size = null
      for (let k = 1; k <= 600; k++) {
        const a = performance.now()
        const bmp = await films.codeFilms.exactFrame(asset(), k / 60)
        ms.push(performance.now() - a)
        size = [bmp.width, bmp.height]
        const n = read(bmp)
        if (n !== k) wrong.push([k, n])
        bmp.close()
      }
      const sorted = [...ms].sort((x, y) => x - y)
      const out = { right: 600 - wrong.length, wrong: wrong.slice(0, 10), size, median: sorted[300], p95: sorted[570], worst: sorted[599], total: ms.reduce((x, y) => x + y, 0), pageMs: films.codeFilms.status(id)?.drawMs ?? null }
      // Back: the page is loaded again and stepped forward to frame 100.
      const b0 = performance.now()
      const back = await films.codeFilms.exactFrame(asset(), 100 / 60)
      out.back = { ms: performance.now() - b0, read: read(back) }
      back.close()
      // The same frame again, and a smaller picture (the size asked while playing).
      const again = await films.codeFilms.exactFrame(asset(), 100 / 60)
      out.again = read(again)
      again.close()
      const small = await films.codeFilms.exactFrame(asset(), 101 / 60, undefined, 960)
      out.small = { size: [small.width, small.height], read: read(small, 0.5) }
      small.close()
      // Its own pixels: clear where the page is, the half see-through box, the circle.
      const own = await films.codeFilms.exactFrame(asset(), 2)
      const og = new OffscreenCanvas(own.width, own.height).getContext('2d')
      og.drawImage(own, 0, 0)
      const d = og.getImageData(0, 0, own.width, own.height).data
      own.close()
      let clear = 0
      for (let i = 3; i < d.length; i += 4) if (d[i] === 0) clear++
      const px = (x, y) => [...d.subarray((y * 1920 + x) * 4, (y * 1920 + x) * 4 + 4)]
      out.own = { clearPct: Math.round((clear / (d.length / 4)) * 1000) / 10, corner: px(1800, 100), half: px(260, 700), circle: px(700, 700) }
      out.hasAlpha = asset().code?.hasAlpha
      return out
    }, film.id)
    console.log('     600 frames:', JSON.stringify({ ...run600, median: +run600.median.toFixed(2), p95: +run600.p95.toFixed(2), worst: +run600.worst.toFixed(1), total: Math.round(run600.total) }))
    assert.equal(run600.right, 600, `wrong frames: ${JSON.stringify(run600.wrong)}`)
    assert.deepEqual(run600.size, [1920, 1080])
    assert.equal(run600.back.read, 100, 'going back gives the frame asked for')
    assert.equal(run600.again, 100)
    assert.deepEqual(run600.small.size, [960, 540])
    assert.equal(run600.small.read, 101)
    assert.ok(run600.own.clearPct > 80, `the page's frame is not see-through: ${JSON.stringify(run600.own)}`)
    assert.deepEqual(run600.own.corner, [0, 0, 0, 0])
    assert.ok(Math.abs(run600.own.half[3] - 128) <= 1 && run600.own.half[0] >= 253 && run600.own.half[1] <= 2 && run600.own.half[2] <= 2, `the half see-through box: ${JSON.stringify(run600.own.half)}`)
    assert.deepEqual(run600.own.circle, [0, 128, 255, 255])
    assert.equal(run600.hasAlpha, true)

    // ---- over a talk video: see-through for real; preview = export ---------
    const over = await c.run(async (talkId, filmId, moments) => {
      const S = window.__store
      const ex = await window.__exporter()
      const R = await window.__render()
      const [films] = await window.__codeFilm()
      const asset = () => S.getState().project.assets.find((a) => a.id === filmId)
      const p = structuredClone(S.getState().project)
      const W = p.settings.width
      const H = p.settings.height
      const tv = p.assets.find((a) => a.id === talkId)
      p.tracks = [{ id: 'V2', kind: 'video', name: 'V2', clipIds: ['k'] }, { id: 'V1', kind: 'video', name: 'V1', clipIds: ['v'] }, { id: 'A1', kind: 'audio', name: 'A1', clipIds: [] }]
      p.clips = {
        v: { id: 'v', assetId: talkId, trackId: 'V1', start: 0, inPoint: 0, duration: 10, transform: { x: W / 2, y: H / 2, scale: Math.min(W / tv.width, H / tv.height), rotation: 0 }, volume: 1 },
        k: { id: 'k', assetId: filmId, trackId: 'V2', start: 0, inPoint: 0, duration: 10, transform: { x: W / 2, y: H / 2, scale: W / asset().width, rotation: 0 }, volume: 1 }
      }
      p.captions = []
      S.getState().loadProject(p)
      S.setState({ selectedClipIds: [], playing: false })
      const rgba = (src) => { const o = new OffscreenCanvas(W, H); const g = o.getContext('2d'); g.drawImage(src, 0, 0, W, H); return g.getImageData(0, 0, W, H).data }
      const png = async (proj, t) => rgba(await createImageBitmap(new Blob([await ex.exportFramePng(proj, t, false, 'final')], { type: 'image/png' })))
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
        for (let i = 0; i < 60; i++) {
          await new Promise((res) => setTimeout(res, 200))
          const now = draw(proj)
          alike = last && same(last, now) && films.codeFilms.frameFor(proj.clips.k, asset(), t) ? alike + 1 : 0
          last = now
          if (alike >= 2) { shown = now; break }
        }
        if (!shown) return { error: `the preview did not settle at ${t} s` }
        const written = await png(proj, t)
        const writtenAlone = await png(alone, t)
        const ownBmp = await films.codeFilms.exactFrame(asset(), t)
        const own = rgba(ownBmp)
        ownBmp.close()
        const m = { t, max: 0, over2: 0, clearPx: 0, clearDiff: 0, coveredDiff: 0 }
        for (let i = 0; i < shown.length; i += 4) {
          const a = own[i + 3]
          if (a === 0) m.clearPx++
          for (let k = 0; k < 3; k++) {
            if (a === 0 && Math.abs(written[i + k] - writtenAlone[i + k]) > 2) m.clearDiff++
            if (a === 255 && Math.abs(written[i + k] - own[i + k]) > 2) m.coveredDiff++
          }
        }
        // Preview against export. Three alike draws are not "settled": under
        // load the decoder's still of the talk (playback/scrub.ts) and the
        // page's exact frame (media/codefilm.ts) may take longer than that,
        // and meanwhile the preview holds the frame of the moment before, on
        // purpose (no black flash). So: where it differed when it first stood
        // still (in the see-through part: the video; in the page's own
        // part: the film), and the preview must come to the export within
        // 30 s (DENEME-1-PLAN-C.md, item 5). A preview that stays wrong fails.
        const compare = (pic) => {
          const r = { max: 0, over2: 0, inClear: 0, inPage: 0 }
          for (let i = 0; i < pic.length; i += 4) {
            const a = own[i + 3]
            for (let k = 0; k < 3; k++) {
              const d = Math.abs(pic[i + k] - written[i + k])
              if (d > r.max) r.max = d
              if (d > 2) {
                r.over2++
                if (a === 0) r.inClear++
                else r.inPage++
              }
            }
          }
          return r
        }
        const first = compare(shown)
        m.atStill = first
        let now = first
        const since = performance.now()
        for (let i = 0; i < 150 && now.over2 > 0; i++) {
          await new Promise((res) => setTimeout(res, 200))
          now = compare(draw(proj))
        }
        m.max = now.max
        m.over2 = now.over2
        m.cameRightMs = first.over2 > 0 ? Math.round(performance.now() - since) : 0
        out.push(m)
      }
      return { w: W, h: H, moments: out }
    }, talk1080.id, film.id, [0.5, 3.2, 7.75])
    if (over.error) throw new Error(over.error)
    console.log('     over the talk video:', JSON.stringify(over.moments))
    for (const m of over.moments) {
      assert.ok(m.clearPx > 0.8 * over.w * over.h, `at ${m.t} s the page's frame is not see-through`)
      assert.equal(m.clearDiff, 0, `at ${m.t} s the exported frame is not the video where the page is see-through`)
      assert.equal(m.coveredDiff, 0, `at ${m.t} s the exported frame is not the page where the page is opaque`)
      assert.equal(m.over2, 0, `at ${m.t} s the paused preview differs from the export (max ${m.max}, ${m.over2} channels)`)
    }

    // ---- the fences hold in a drawing window -------------------------------
    const other = join(work, 'other')
    cpSync(media.film, other, { recursive: true })
    writeFileSync(join(other, 'm.js'), "export const secret = 'OTHER FILM'\n")
    const reg = await c.run(async (talk, img, other) => ({ media: (await window.api.testRegisterMedia(talk)).url, image: (await window.api.testRegisterMedia(img)).url, other: (await window.api.codeFilm.register(other)).url }), media.talk, media.broll[0], other)
    const otherId = /^snippfilm:\/\/([a-f0-9]{16})\//.exec(reg.other)[1]
    // Twice: with the page's policy, then without it (a test-only switch),
    // where the window's own session must refuse everything itself.
    for (const policy of [true, false]) {
      assert.equal((await probe(c, { kind: 'film-policy', on: policy })).policy, policy)
      const hdir = join(work, policy ? 'hostile' : 'hostile-nopolicy')
      mkdirSync(hdir, { recursive: true })
      writeFileSync(join(hdir, 'index.html'), HOSTILE)
      writeFileSync(join(hdir, 'targets.json'), JSON.stringify({ media: reg.media, image: reg.image, otherFilm: reg.other }))
      const since = Date.now()
      const hostile = await load(c, hdir)
      assert.equal(hostile.status?.state, 'ready', JSON.stringify(hostile))
      assert.equal(hostile.status.mode, 'page')
      const rec = await c.waitFor('the hostile page done', async () => {
        const r = await c.run(async (id) => { const [films] = await window.__codeFilm(); // (Audit D8a: the page's own console.error lines come marked as facts; these pages report by them.)
    const r = await films.codeFilms.diag(id); return r && { ...r, errors: r.errors.map((e) => e.replace(/^console\.error: /, '')) } }, hostile.id)
        return r && r.errors.includes('Z done: yes') ? r : null
      }, 30000, 250)
      const z = JSON.parse(rec.errors.find((e) => e.startsWith('Z page: ')).slice(8))
      console.log(`     fences in the window (policy ${policy ? 'on' : 'off'}):`, JSON.stringify(z), 'blocked', rec.blocked.length)
      for (const k of ['mediaCors', 'filmCors', 'import', 'net', 'img']) assert.match(z[k], /^refused/, `${k}: ${z[k]}`)
      assert.match(z.mediaNoCors, /^(refused|opaque)/)
      assert.equal(z.open, 'null')
      assert.match(z.alert, /^returned in \d+ ms$/)
      assert.ok(parseInt(z.alert.slice(12), 10) < 500, `the box returned at once: ${z.alert}`)
      const seen = await probe(c, { kind: 'requests', since })
      assert.deepEqual(seen.filter((r) => r.scheme === 'media' && r.admitted).map((r) => r.url), [], 'no media:// request of the page was served')
      assert.deepEqual(seen.filter((r) => r.url.includes(otherId) && r.admitted).map((r) => r.url), [], 'no request for the other film was served')
      // (With the policy, the page's own record names the scheme it was
      // refused; without it, the window's session refused each address itself.)
      assert.ok(rec.blocked.some((b) => b.startsWith(policy ? 'media' : 'media:')), `the film's blocked list names the media address: ${JSON.stringify(rec.blocked)}`)
      if (!policy) {
        assert.ok(rec.blocked.some((b) => b.includes(otherId)), `the film's blocked list names the other film: ${JSON.stringify(rec.blocked)}`)
        assert.ok(rec.blocked.some((b) => b.startsWith('https://example.com')), `the film's blocked list names the network address: ${JSON.stringify(rec.blocked)}`)
      }
      const hwin = (await probe(c, { kind: 'windows' })).find((w) => hostile.url.includes(w.id))
      assert.match(hwin.url, /\/__snipp\/host\.html\?win=1/, 'the window stayed on its own page')
    }
    await probe(c, { kind: 'film-policy', on: true })

    // ---- decision 3: a loop that never ends --------------------------------
    const ldir = join(work, 'loop')
    mkdirSync(ldir, { recursive: true })
    writeFileSync(join(ldir, 'index.html'), LOOP)
    const loop = await load(c, ldir)
    assert.equal(loop.status?.state, 'ready', JSON.stringify(loop))
    const loopPid = (await probe(c, { kind: 'windows' })).find((w) => loop.url.includes(w.id)).pid
    await c.run(async (id) => {
      const [films] = await window.__codeFilm()
      const a = window.__store.getState().project.assets.find((x) => x.id === id)
      window.__loopAsk = films.codeFilms.exactFrame(a, 1).then((b) => { b.close(); return 'drew' }, (e) => 'failed: ' + e.message)
      return true
    }, loop.id)
    const t0 = Date.now()
    let worst = 0
    let failedAfter = null
    while (Date.now() - t0 < 20000) {
      const a = Date.now()
      const st = await c.run(async (id) => { const [films] = await window.__codeFilm(); return films.codeFilms.status(id) }, loop.id)
      worst = Math.max(worst, Date.now() - a)
      if (st?.state === 'error') { failedAfter = Date.now() - t0; break }
      await new Promise((r) => setTimeout(r, 200))
    }
    const loopSt = await c.run(async (id) => { const [films] = await window.__codeFilm(); return { st: films.codeFilms.status(id), ask: await window.__loopAsk } }, loop.id)
    const after = await probe(c, { kind: 'windows' })
    const pids = await c.run(() => window.api.testFilmProbe({ kind: 'frames' }))
    console.log(`     loop: editor worst ${worst} ms, clip failed after ${failedAfter} ms, ask ${loopSt.ask}`)
    assert.ok(failedAfter !== null && failedAfter <= 15000, `the clip was not marked failed in 15 s (${failedAfter})`)
    assert.ok(worst < 2000, `the editor stopped answering (${worst} ms)`)
    assert.equal(loopSt.st.unresponsive, true)
    assert.match(loopSt.ask, /^failed: /)
    assert.ok(!after.some((w) => loop.url.includes(w.id)), 'the looping page\'s window is gone')
    assert.ok(pids.editorPid !== loopPid)
    const alive = await c.run((pid) => window.api.testFilmProbe({ kind: 'pid-alive', pid }), loopPid)
    assert.equal(alive?.alive, false, 'the looping page\'s process was ended')

    // ---- decision 3: memory ------------------------------------------------
    assert.deepEqual(await probe(c, { kind: 'film-memory', mb: 600 }), { limitKb: 600 * 1024 })
    const mdir = join(work, 'hungry')
    mkdirSync(mdir, { recursive: true })
    writeFileSync(join(mdir, 'index.html'), HUNGRY)
    const hungry = await load(c, mdir)
    assert.equal(hungry.status?.state, 'ready', JSON.stringify(hungry))
    const mem = await c.run(async (id) => {
      const [films] = await window.__codeFilm()
      const asset = () => window.__store.getState().project.assets.find((x) => x.id === id)
      const t0 = performance.now()
      let k = 1
      while (performance.now() - t0 < 30000) {
        const st = films.codeFilms.status(id)
        if (st?.state === 'error') return { ms: Math.round(performance.now() - t0), error: st.error, frames: k }
        await films.codeFilms.exactFrame(asset(), k++ / 60).then((b) => b.close(), () => undefined)
        await new Promise((r) => setTimeout(r, 100))
      }
      return { ms: Math.round(performance.now() - t0), error: null, frames: k }
    }, hungry.id)
    console.log('     memory:', JSON.stringify(mem))
    assert.match(String(mem.error), /used too much memory \(\d+ MB\)/)
    assert.ok(!(await probe(c, { kind: 'windows' })).some((w) => hungry.url.includes(w.id)), 'the hungry page\'s window is gone')
    await probe(c, { kind: 'film-memory', mb: 0 })

    // ---- nothing left behind ------------------------------------------------
    // (The films leave the project: the engine lets go of their pages.)
    const left = await c.run(async () => {
      const S = window.__store
      const [films] = await window.__codeFilm()
      const p = structuredClone(S.getState().project)
      p.assets = p.assets.filter((a) => a.kind !== 'code')
      p.clips = {}
      p.tracks = p.tracks.map((t) => ({ ...t, clipIds: [] }))
      S.getState().loadProject(p)
      films.codeFilms.release(new Set(p.assets.map((a) => a.id)))
      await new Promise((r) => setTimeout(r, 500))
      return { windows: await window.api.testFilmProbe({ kind: 'windows' }), live: films.codeFilms.livePages() }
    })
    assert.deepEqual(left, { windows: [], live: [] }, 'a drawing window outlived its film')
    // (And when the editor page itself goes: a film started, the page loaded again.)
    const again = await load(c, dir)
    assert.equal(again.status?.state, 'ready')
    assert.equal((await probe(c, { kind: 'windows' })).length, 1)
    await lib.reset(c)
    await c.waitFor('the drawing windows closed with the page', async () => ((await probe(c, { kind: 'windows' })).length === 0 ? true : null), 5000, 100)
    // (And when the editor window closes with a drawing window open: the app
    // quits; a hidden window of a film does not keep it running.)
    const last = await load(c, dir)
    assert.equal(last.status?.state, 'ready')
    assert.equal((await probe(c, { kind: 'windows' })).length, 1)
    await probe(c, { kind: 'mute', on: false })
    const t1 = Date.now()
    c.run(() => { window.api.confirmQuit(); return true }).catch(() => undefined)
    // The app's own decision is what is checked: its last window gone, it
    // quits ("will-quit", e2e-hooks.ts). A drawing window that kept it open
    // would hold that back for good. The process's own end is OS teardown:
    // unloaded about 0.3 s, on a loaded machine 9–28 s (it tripped the old
    // 10 s wait on the process: DENEME-1-PLAN-C.md, item 5); it must come,
    // within 90 s.
    const quitAt = await c.waitFor('the app deciding to quit', async () => app.events().find((e) => e.type === 'will-quit' && e.at >= t1) ?? null, 10000, 50).catch(() => null)
    const code = await Promise.race([app.exited, new Promise((r) => setTimeout(() => r('still running'), 90000))])
    console.log(`     the app quit ${quitAt ? quitAt.at - t1 : '?'} ms after its editor window closed (drawing windows left then: ${quitAt?.filmWindows}); the process ended after ${Date.now() - t1} ms (exit ${code})`)
    assert.ok(quitAt, 'the app did not quit: a drawing window kept it open')
    assert.equal(quitAt.filmWindows, 0, 'a drawing window was still open when the app quit')
    assert.notEqual(code, 'still running', 'the process did not end within 90 s of quitting')
    c = (await relaunch()).cdp
    console.log(`     page clip: 600 / 600 right, ask -> picture median ${run600.median.toFixed(1)} ms (95 %: ${run600.p95.toFixed(1)}, worst ${run600.worst.toFixed(0)}), back to frame 100 in ${Math.round(run600.back.ms)} ms`)
  } finally {
    await probe(c, { kind: 'film-memory', mb: 0 }).catch(() => undefined)
    await probe(c, { kind: 'film-policy', on: true }).catch(() => undefined)
    await probe(c, { kind: 'mute', on: false }).catch(() => undefined)
  }
}
