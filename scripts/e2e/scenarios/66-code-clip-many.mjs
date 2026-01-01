// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// 5a/5b patch, item 2 (audit C-3, haritalar\_faz5-denetim-citler.md): more code
// films needed at once than the live-page limit. Before: five films near the
// playhead opened and closed pages in an endless loop (2 738 pages in 7.5 s),
// none became ready and the editor stopped answering. Now a page needed now is
// never let go for another needed now: the films over the limit wait with a
// plain "too many code films at once" state and the others play. Three cases:
// 5 films stacked, 8 stacked (paused), 5 short films in a row (played
// through). Throughout: the editor answers every call within 100 ms, and the
// number of pages started stays bounded.
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
export const name = 'code-clip-many'
export const timeoutMs = 150_000

const PAGE = (color) => `<!doctype html><html><head><meta charset="utf-8"></head><body style="margin:0;background:#000">
<canvas id="c" width="320" height="180"></canvas><script>
const g = document.getElementById('c').getContext('2d')
window.__config = { width: 320, height: 180, fps: 30, duration: 10 }
window.renderOut = (t) => { g.fillStyle = '${color}'; g.fillRect(0, 0, 320, 180) }
window.renderOut(0); window.READY = true
</script></body></html>`

const LIMIT = 4

async function load(c, dirs, layout) {
  // The work runs in the page, its promise kept by the page (window.__manyLoad),
  // and is asked after with short calls: one long awaited ask was now and then
  // answered "Promise was collected" by CDP after the hostile scenario.
  await c.run((dirs, layout) => { window.__manyLoad = { done: false, error: null }; window.__manyLoad.p = (async () => {
    const S = window.__store
    // (Each wait bounded and named: an answer that never comes is said, not collected.)
    const within = (p, what) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error('no answer in 10 s: ' + what)), 10000))])
    const [films, imp] = await within(window.__codeFilm(), '__codeFilm')
    const assets = []
    for (const [i, d] of dirs.entries()) {
      const info = await within(window.api.codeFilm.register(d), 'register ' + i)
      const a = (await within(imp.codeFilmImport(info), 'import ' + i)).assets.find((x) => x.kind === 'code')
      a.id = 'f' + i
      a.width = 320
      a.height = 180
      a.duration = 10
      assets.push(a)
    }
    const capStyle = { fontFamily: 'Arial', fontSize: 64, fontWeight: 800, color: '#ffffff', outlineColor: '#000000', outlineWidth: 6, bgColor: '#000000', bgOpacity: 0, posY: 0.86, maxLineChars: 32, uppercase: false, popup: { enabled: true, duration: 0.2, intensity: 1, style: 'pop' }, wordsPerCue: 0, pauseThreshold: 0 }
    const p = { version: 1, name: 'many', settings: { width: 1920, height: 1080, fps: 30 }, mode: 'frame', tracks: [], clips: {}, assets, captions: [], captionStyle: capStyle, transcription: { model: 'english', language: 'auto' }, snap: { enabled: true, distance: 12, snapEdges: true, snapCenters: true } }
    for (let i = 0; i < dirs.length; i++) {
      // stacked: every film 0–10 s on its own track; row: 2 s each, one after another, one track.
      const row = layout === 'row'
      const k = { id: 'k' + i, assetId: 'f' + i, trackId: row ? 'V0' : 'V' + i, start: row ? i * 2 : 0, inPoint: 0, duration: row ? 2 : 10, transform: { x: 200 + (i % 6) * 300, y: 540, scale: 1, rotation: 0 }, volume: 1 }
      if (!row || i === 0) p.tracks.push({ id: k.trackId, kind: 'video', name: k.trackId, clipIds: [] })
      p.tracks.find((t) => t.id === k.trackId).clipIds.push(k.id)
      p.clips[k.id] = k
    }
    const A = (window.__many = { made: 0 })
    if (window.__manyObs) window.__manyObs.disconnect()
    window.__manyObs = new MutationObserver((l) => { for (const m of l) for (const n of m.addedNodes) if (n.tagName === 'IFRAME' && String(n.src).includes('__snipp/host.html')) A.made++ })
    window.__manyObs.observe(document.body, { childList: true })
    S.getState().loadProject(p)
    S.getState().setTime(layout === 'row' ? 0 : 2)
    if (layout === 'row') S.getState().setPlaying(true)
    void films
    return true
  })().then(() => { window.__manyLoad.done = true }, (e) => { window.__manyLoad.error = String(e && e.message || e) }); return true }, dirs, layout)
  await c.waitFor('the films loaded', async () => { const s = await c.ev('window.__manyLoad && JSON.stringify({ done: window.__manyLoad.done, error: window.__manyLoad.error })'); const o = JSON.parse(s); if (o.error) throw new Error(o.error); return o.done }, 30000, 100)
}

/** The editor's answer times (ms) over `ms`, one call every 200 ms; a call
 *  not answered in 2 s counts as 2000. */
async function lagOver(c, ms) {
  const lag = []
  const t0 = Date.now()
  while (Date.now() - t0 < ms) {
    const a = Date.now()
    const r = await Promise.race([c.ev('1').then(() => 'ok'), new Promise((res) => setTimeout(() => res('late'), 2000))])
    lag.push(r === 'ok' ? Date.now() - a : 2000)
    await c.sleep(200)
  }
  return lag
}

const state = (c, n) => c.run((n) => window.__codeFilm().then(([films]) => ({ made: window.__many.made, live: films.codeFilms.livePages().length, states: Array.from({ length: n }, (_, j) => films.codeFilms.status('f' + j)?.state ?? '-') })), n)

export async function run({ c, lib, work }) {
  const { assert } = lib
  const colors = ['#246', '#462', '#624', '#266', '#626', '#662', '#444', '#888']
  const dirs = colors.map((col, i) => {
    const d = join(work, 'many' + i)
    mkdirSync(d, { recursive: true })
    writeFileSync(join(d, 'index.html'), PAGE(col))
    return d
  })
  const report = []
  for (const [label, n, layout, ms] of [['5 stacked', 5, 'stacked', 8000], ['8 stacked', 8, 'stacked', 8000], ['5 in a row, playing', 5, 'row', 11000]]) {
    const step = async (s, f) => { try { return await f() } catch (e) { throw new Error(label + ' / ' + s + ': ' + e.message) } }
    await step('load', () => load(c, dirs.slice(0, n), layout))
    const lag = await step('lag', () => lagOver(c, ms))
    const st = await step('state', () => state(c, n))
    await c.run(() => { window.__store.getState().setPlaying(false); return true })
    const max = Math.max(...lag)
    report.push(`${label}: ${st.made} pages started, live ${st.live}, states ${st.states.join('')}, editor worst ${max} ms`)
    console.log(`     ${report.at(-1)}`)
    assert.ok(max < 100, `${label}: the editor answered every call within 100 ms (worst ${max} ms: ${lag.join(',')})`)
    if (layout === 'stacked') {
      // The films within the limit play; the others wait, said plainly; no page goes and comes back.
      assert.equal(st.states.filter((s) => s === 'ready').length, LIMIT, `${label}: ${st.states.join('')}`)
      assert.equal(st.states.filter((s) => s === 'limited').length, n - LIMIT, `${label}: ${st.states.join('')}`)
      assert.ok(st.made <= LIMIT, `${label}: ${st.made} pages started (at most ${LIMIT})`)
      const msg = await c.run(() => window.__codeFilm().then(([films]) => films.codeFilms.status('f4')?.error ?? ''))
      assert.match(msg, /4/, msg)
    } else {
      // Each film starts at most twice while the playhead passes them all once.
      assert.ok(st.made <= 2 * n, `${label}: ${st.made} pages started (at most ${2 * n})`)
    }
    // Back to an empty project: the pages go.
    await c.run(() => { const S = window.__store; S.getState().loadProject({ ...S.getState().project, assets: [], clips: {}, tracks: [] }); return true })
    await c.run(() => window.__codeFilm().then(([films]) => { films.codeFilms.release(new Set()); return true }))
  }
  console.log('     many: ' + report.join(' | '))
}
