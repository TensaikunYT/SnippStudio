// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// Cila K, "code values" (SnippStudio CILA-K-PLAN.md, tarifler\CILA.md K
// "Bitti"): the constants of a code clip's page changed by hand, in the side
// panel the Inspector's code clip part opens.
//   A. an HTML page that says nothing of parameters: its colour and its text
//      changed in the panel; the film's frame changes, the file does not; one
//      undo step per field; the paused preview = the exported frame;
//      a hostile text (tags, quotes, a script) arrives as text, runs nothing;
//      undone, the frame is the one before;
//   B. a canvas page: a colour inside its JS changes the frame;
//   C. the "agent" rewrites the canvas file: the change kept says "no longer
//      in the page", and is discarded;
//   D. "Write to the files": the value in the file, the same frame, the list
//      empty; "back to the previous version" puts the file and frame back;
//   E. the two big films of testdata (portrait, heavy): what the scan finds, how
//      long it takes, and on the heavy one how long a value change takes to show.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { FILM, TESTDATA } from '../media.mjs'

export const name = 'code-values'
export const timeoutMs = 600_000
export const freshWindow = true

/** The text the user types: tags, quotes, an ampersand, a script. */
const HOSTILE = 'Dünya & "biz" <img src=x onerror="window.HACK=1"></div><script>window.HACK=1</script>'
/** The same, as a JS string of the page (no "<" in the page's own script). */
const HOSTILE_JS = JSON.stringify(HOSTILE).replace(/</g, '\\x3c')

// The page's marker (top right): lime when the title holds the typed text
// exactly and nothing of it ran, red when something ran, none otherwise.
const HTML_PAGE = `<!doctype html><html><head><meta charset="utf-8"><style>
html,body{margin:0;width:640px;height:360px;background:#102030;overflow:hidden;font-family:"Segoe UI",sans-serif}
#t{position:absolute;left:40px;top:110px;font-size:56px;font-weight:800;color:#ffcc00;white-space:nowrap}
#b{position:absolute;left:40px;top:260px;height:40px;width:100px;background:#ff3366}
#m{position:absolute;right:0;top:0;width:60px;height:60px}
</style></head><body><div id="t">Merhaba</div><div id="b"></div><div id="m"></div><script>
var WANT = ${HOSTILE_JS};
window.__config = { width: 640, height: 360, duration: 4 };
window.renderOut = function (t) {
  document.getElementById('b').style.width = Math.round(100 + t * 80) + 'px';
  var ran = window.HACK === 1 || !!document.querySelector('img');
  var same = document.getElementById('t').textContent === WANT;
  document.getElementById('m').style.background = ran ? 'red' : same ? 'lime' : 'transparent';
};
window.READY = true;
</script></body></html>
`

const canvasPage = (dot) => `<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;background:#000}</style></head>
<body><canvas id="c" width="640" height="360"></canvas><script>
const g = document.getElementById('c').getContext('2d');
const BG = '#0b1d2a';
const DOT = '${dot}';
window.__config = { width: 640, height: 360, duration: 4 };
window.renderOut = function (t) {
  g.fillStyle = BG;
  g.fillRect(0, 0, 640, 360);
  g.fillStyle = DOT;
  g.beginPath();
  g.arc(120 + t * 100, 220, 70, 0, 7);
  g.fill();
  g.fillStyle = '#ffffff';
  g.font = '48px Arial';
  g.fillText('Sayaç', 40, 80);
};
window.READY = true;
</script></body></html>
`

/** A film's own frame (its page's draw, 640 wide): a hash and two pixels. */
const frameOf = (c, assetId, t) =>
  c.run(async (id, t) => {
    const [films] = await window.__codeFilm()
    const a = window.__store.getState().project.assets.find((x) => x.id === id)
    const t0 = performance.now()
    let bmp = null
    while (!bmp && performance.now() - t0 < 60000) bmp = await films.codeFilms.exactFrame(a, t, undefined, 640).catch(() => null)
    if (!bmp) throw new Error('no frame of ' + id)
    const cv = new OffscreenCanvas(bmp.width, bmp.height)
    const g = cv.getContext('2d')
    g.drawImage(bmp, 0, 0)
    const px = g.getImageData(0, 0, bmp.width, bmp.height).data
    const at = (x, y) => [...px.subarray((y * bmp.width + x) * 4, (y * bmp.width + x) * 4 + 3)]
    const hex = [...new Uint8Array(await crypto.subtle.digest('SHA-256', px))].map((b) => b.toString(16).padStart(2, '0')).join('')
    return { hash: hex.slice(0, 16), marker: at(bmp.width - 20, 20), bar: at(60, Math.round(bmp.height * 0.78)), w: bmp.width, ms: Math.round(performance.now() - t0) }
  }, assetId, t)

/** The paused preview at `t` (it settles first) against the exported frame. */
const previewVsExport = (c, t) =>
  c.run(async (t) => {
    const S = window.__store
    const ex = await window.__exporter()
    const R = await window.__render()
    const p0 = S.getState().project
    const W = p0.settings.width
    const H = p0.settings.height
    S.getState().setPlaying(false)
    S.getState().setTime(t)
    const rgba = (src) => { const o = new OffscreenCanvas(W, H); const g = o.getContext('2d'); g.drawImage(src, 0, 0, W, H); return g.getImageData(0, 0, W, H).data }
    const draw = () => {
      const o = new OffscreenCanvas(W, H)
      R.renderFrame(o.getContext('2d'), S.getState().project, S.getState().currentTime, window.__engine.resolve, { scale: 1, quality: 'refine' })
      return o.getContext('2d').getImageData(0, 0, W, H).data
    }
    const same = (a, b) => { for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false; return true }
    let last = null
    let shown = null
    let alike = 0
    for (let i = 0; i < 80 && !shown; i++) {
      await new Promise((r) => setTimeout(r, 200))
      const now = draw()
      alike = last && same(last, now) ? alike + 1 : 0
      last = now
      if (alike >= 3) shown = now
    }
    if (!shown) return { error: `the preview did not settle at ${t} s` }
    const written = rgba(await createImageBitmap(new Blob([await ex.exportFramePng(S.getState().project, t, false, 'final')], { type: 'image/png' })))
    let max = 0
    let over2 = 0
    let lit = 0
    for (let i = 0; i < shown.length; i += 4) {
      if (shown[i] + shown[i + 1] + shown[i + 2] > 30) lit++
      for (let k = 0; k < 3; k++) {
        const d = Math.abs(shown[i + k] - written[i + k])
        if (d > max) max = d
        if (d > 2) over2++
      }
    }
    return { t, max, over2, litPct: Math.round((lit / (shown.length / 4)) * 1000) / 10 }
  }, t)

const edits = (c, id) => c.st((s, id) => s.project.assets.find((a) => a.id === id)?.code?.edits ?? [], id)

/** The test name of the panel's row of this kind whose page value is `orig`. */
const rowOf = (c, kind, orig) =>
  c.run(
    (kind, orig) => [...document.querySelectorAll('[data-testid="codeval.panel"] [data-testid^="codeval."][data-kind]')].find((e) => e.dataset.kind === kind && e.dataset.orig === orig)?.dataset.testid ?? null,
    kind,
    orig
  )

const panelReady = (c, assetId) =>
  c.waitFor('the values panel read the page', async () => {
    const st = await c.attr('codeval.panel', 'data-state')
    const of = await c.attr('codeval.panel', 'data-asset')
    return st === 'ready' && of === assetId ? { slots: +(await c.attr('codeval.panel', 'data-slots')), ms: +(await c.attr('codeval.panel', 'data-ms')) } : null
  }, 20000)

export async function run({ c, app, lib, work }) {
  const { assert } = lib
  // ---- a saved project with two pages in its anim folder -----------------------
  const projDir = join(work, 'values-project')
  const htmlDir = join(projDir, 'anim', 'sayfa')
  const canvasDir = join(projDir, 'anim', 'tuval')
  mkdirSync(htmlDir, { recursive: true })
  mkdirSync(canvasDir, { recursive: true })
  writeFileSync(join(htmlDir, 'index.html'), HTML_PAGE)
  writeFileSync(join(canvasDir, 'index.html'), canvasPage('#22aa44'))
  const file = join(projDir, 'values.snipp')
  lib.answer(app, { kind: 'save', path: file })
  await c.click('timeline.scroll', { fx: 0.95, fy: 0.97 })
  await c.key('s', ['ctrl'])
  await c.waitFor('saved', async () => existsSync(file), 10000)

  const addFilm = async (folder) => {
    const id = await c.run(async (folder) => {
      const [, imp] = await window.__codeFilm()
      const info = await window.api.codeFilm.register(folder)
      const a0 = (await imp.codeFilmImport(info)).assets.find((a) => a.kind === 'code')
      const [a] = window.__store.getState().addAssets([a0])
      return (a ?? a0).id
    }, folder)
    const before = await c.st((s) => Object.keys(s.project.clips))
    await c.st((s, id) => s.addToTimeline(id), id)
    const clipId = await c.waitFor('the clip placed', async () => c.st((s, b) => Object.keys(s.project.clips).find((k) => !b.includes(k)) ?? null, before), 5000)
    return { id, clipId }
  }
  const html = await addFilm(htmlDir)
  const canvas = await addFilm(canvasDir)
  const htmlCode = readFileSync(join(htmlDir, 'index.html'), 'utf8')

  // ---- A. the HTML page --------------------------------------------------------
  const f0 = await frameOf(c, html.id, 2)
  assert.deepEqual(f0.marker, [0x10, 0x20, 0x30], 'the marker shows nothing before the text is changed')
  await c.st((s, id) => s.selectClips([id]), html.clipId)
  await c.click('inspector.tab.clip')
  await c.click('codeval.open')
  const scanned = await panelReady(c, html.id)
  console.log(`     HTML page: ${scanned.slots} places found in ${scanned.ms} ms`)
  assert.equal(scanned.slots, 5, 'its three colours, its text, its font')
  const colorRow = await rowOf(c, 'color', '#ff3366')
  const textRow = await rowOf(c, 'text', 'Merhaba')
  assert.ok(colorRow && textRow, `rows: ${colorRow} ${textRow}`)
  assert.ok(await rowOf(c, 'font', 'Segoe UI'), 'the font found')
  assert.ok(await rowOf(c, 'color', '#102030'), 'the ground colour found')
  if (process.env.SNIPP_SHOTS) await c.shot(join(process.env.SNIPP_SHOTS, '92-panel.png'))

  const d0 = await lib.undoDepth(c)
  await c.fill(`${colorRow}.value`, '#00ff00', { enter: true })
  await c.waitFor('the colour kept', async () => (await edits(c, html.id)).length === 1, 5000)
  assert.equal(await lib.undoDepth(c), d0 + 1, 'one undo step for the colour')
  const f1 = await c.waitFor('the frame with the new colour', async () => {
    const f = await frameOf(c, html.id, 2)
    return f.hash !== f0.hash ? f : null
  }, 30000)
  assert.deepEqual(f1.bar, [0, 255, 0], `the bar is green: ${f1.bar}`)
  assert.equal(readFileSync(join(htmlDir, 'index.html'), 'utf8'), htmlCode, 'the file is not touched')

  await c.fill(`${textRow}.value`, HOSTILE)
  await c.waitFor('the text kept (300 ms after the hand stops)', async () => (await edits(c, html.id)).length === 2, 5000)
  assert.equal(await lib.undoDepth(c), d0 + 2, 'one undo step for the text')
  const f2 = await c.waitFor('the frame with the new text', async () => {
    const f = await frameOf(c, html.id, 2)
    return f.hash !== f1.hash ? f : null
  }, 30000)
  assert.deepEqual(f2.marker, [0, 255, 0], `the typed text arrived as text and ran nothing (marker ${f2.marker})`)
  console.log(`     colour #ff3366 → #00ff00, text → hostile: frame ${f0.hash} → ${f1.hash} → ${f2.hash}; marker lime`)

  // The paused preview = the exported frame (at 2 s the HTML clip is the one
  // drawn: the canvas clip follows it on the timeline).
  const pe = await previewVsExport(c, 2)
  if (pe.error) throw new Error(pe.error)
  console.log(`     preview vs export at 2 s: max ${pe.max}, ${pe.over2} channels over 2 / 255, ${pe.litPct} % lit`)
  assert.equal(pe.over2, 0, `the paused preview differs from the export (max ${pe.max})`)
  assert.ok(pe.litPct > 1, 'something was drawn')

  // Undone (twice): the frame before.
  await c.click('timeline.scroll', { fx: 0.95, fy: 0.97 })
  await c.key('z', ['ctrl'])
  await c.key('z', ['ctrl'])
  await c.waitFor('both undone', async () => (await edits(c, html.id)).length === 0, 5000)
  const f3 = await c.waitFor('the frame back', async () => {
    const f = await frameOf(c, html.id, 2)
    return f.hash === f0.hash ? f : null
  }, 30000)
  assert.equal(f3.hash, f0.hash)

  // ---- B. the canvas page: a colour inside its JS ---------------------------------
  const g0 = await frameOf(c, canvas.id, 2)
  await c.st((s, id) => s.selectClips([id]), canvas.clipId)
  await c.click('codeval.open')
  const scannedC = await panelReady(c, canvas.id)
  const dotRow = await rowOf(c, 'color', '#22aa44')
  assert.ok(dotRow, 'the colour of a JS string found')
  assert.equal(await c.attr(dotRow, 'data-places'), '1')
  assert.ok(await rowOf(c, 'text', 'Sayaç'), "fillText's text found")
  assert.ok(await rowOf(c, 'font', 'Arial'), "the canvas font's family found")
  await c.fill(`${dotRow}.value`, '#aa2222', { enter: true })
  await c.waitFor('the canvas colour kept', async () => (await edits(c, canvas.id)).length === 1, 5000)
  const g1 = await c.waitFor('the canvas frame changed', async () => {
    const f = await frameOf(c, canvas.id, 2)
    return f.hash !== g0.hash ? f : null
  }, 30000)
  console.log(`     canvas page: ${scannedC.slots} places in ${scannedC.ms} ms; JS colour #22aa44 → #aa2222: ${g0.hash} → ${g1.hash}`)

  // ---- C. the agent rewrites the page: the change has no place any more ----------
  writeFileSync(join(canvasDir, 'index.html'), canvasPage('#3366ff'))
  await c.waitFor('the change said to be gone', async () => (await c.attr('codeval.gone', 'data-count')) === '1', 20000)
  assert.equal((await edits(c, canvas.id)).length, 1, 'kept until the user lets it go')
  if (process.env.SNIPP_SHOTS) await c.shot(join(process.env.SNIPP_SHOTS, '92-gone.png'))
  await c.click('codeval.gone.0.discard')
  await c.waitFor('discarded', async () => (await edits(c, canvas.id)).length === 0, 5000)
  await c.waitGone('codeval.gone', 5000)

  // ---- D. "Write to the files" and back -------------------------------------------
  await c.st((s, id) => s.selectClips([id]), html.clipId)
  await c.click('codeval.open')
  await panelReady(c, html.id)
  const colorRow2 = await rowOf(c, 'color', '#ff3366')
  await c.fill(`${colorRow2}.value`, '#00ff00', { enter: true })
  await c.waitFor('the colour kept again', async () => (await edits(c, html.id)).length === 1, 5000)
  await c.waitFor('the edited frame', async () => (await frameOf(c, html.id, 2)).hash === f1.hash, 30000)
  await c.click('codeval.write')
  await c.waitFor('written: the list emptied', async () => (await edits(c, html.id)).length === 0, 10000)
  const written = readFileSync(join(htmlDir, 'index.html'), 'utf8')
  assert.equal(written, htmlCode.replace('background:#ff3366', 'background:#00ff00'), 'exactly the one value written into the file')
  const w1 = await c.waitFor('the same frame from the file', async () => {
    const f = await frameOf(c, html.id, 2)
    return f.hash === f1.hash ? f : null
  }, 30000)
  assert.equal(w1.hash, f1.hash)
  await c.waitFor('a version kept', async () => +((await c.attr('codefilm.versions', 'data-count')) ?? 0) >= 1, 15000)
  await c.click('codefilm.version-back')
  await c.waitFor('the file as it was', async () => readFileSync(join(htmlDir, 'index.html'), 'utf8') === htmlCode, 15000)
  await c.waitFor('the frame as it was', async () => (await frameOf(c, html.id, 2)).hash === f0.hash, 30000)
  console.log('     written to the file: one value, the same frame; back to the version: the file and the frame as before')

  // ---- E. the heavy films of testdata -------------------------------------------
  await c.click('codeval.close')
  for (const film of ['portrait', 'heavy']) {
    const dir = FILM[film]
    if (!existsSync(join(dir, 'index.html'))) {
      console.log(`     ${film}: not in testdata, skipped`)
      continue
    }
    const r = await c.run(async (folder) => {
      const info = await window.api.codeFilm.register(folder)
      const id = /^snippfilm:\/\/([a-f0-9]{16})\//.exec(info.url)[1]
      const times = []
      let last = null
      for (let i = 0; i < 3; i++) {
        const t0 = performance.now()
        last = await window.api.codeFilm.valuesScan(id)
        times.push(Math.round(performance.now() - t0))
      }
      const kinds = { color: 0, text: 0, font: 0, time: 0 }
      const rows = { color: new Set(), text: new Set(), font: new Set(), time: new Set() }
      for (const s of last.slots) {
        kinds[s.kind]++
        rows[s.kind].add(s.kind === 'font' ? s.value.toLowerCase() : s.value)
      }
      return { info, times, mainMs: last.ms, files: last.files, skipped: last.skipped, bytes: last.bytes, kinds, rows: Object.fromEntries(Object.entries(rows).map(([k, v]) => [k, v.size])), first: last.slots.find((s) => s.kind === 'color')?.value ?? null }
    }, dir)
    console.log(`     ${film}: ${r.files} files (${Math.round(r.bytes / 1024)} KB, ${r.skipped} left out), places ${JSON.stringify(r.kinds)}, rows ${JSON.stringify(r.rows)}; scan ${r.mainMs} ms in main, ${r.times.join(' / ')} ms asked from the window (first cold)`)
    assert.ok(r.bytes <= 2 * 1024 * 1024, 'at most 2 MB read')
    if (film !== 'heavy' || !r.first) continue
    // A value change on the heavy film: how long until its frame shows it.
    const id = await c.run(async (info) => {
      const [, imp] = await window.__codeFilm()
      const a0 = (await imp.codeFilmImport(info)).assets.find((a) => a.kind === 'code')
      const [a] = window.__store.getState().addAssets([a0])
      return (a ?? a0).id
    }, r.info)
    const p0 = await frameOf(c, id, 3)
    const t0 = Date.now()
    await c.st((s, id, orig) => s.setCodeEdits(id, [{ kind: 'color', orig, value: '#ff00ff' }]), id, r.first)
    const p1 = await frameOf(c, id, 3)
    const reload = Date.now() - t0
    console.log(`     heavy: first frame ${p0.ms} ms; colour ${r.first} → #ff00ff: a frame of the page again after ${reload} ms (${p1.hash === p0.hash ? 'the same picture at 3 s' : 'another picture'})`)
  }
  await c.run(() => window.__store.getState().setDirty(false))
}
