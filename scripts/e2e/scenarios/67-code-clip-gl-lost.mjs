// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// 5a/5b patch, item 3 (audit C-4, haritalar\_faz5-denetim-citler.md): a film
// whose WebGL context is lost. Before: it stayed "ready" and every frame came
// back black (0,0,0,255), and an export wrote them silently. Now the host
// notices (the context's isContextLost() after the draw, and the
// webglcontextlost event), the frame is answered with an error, the clip's
// status says the graphics memory ran out for this film, an export stops with a
// sentence naming the film, and a restored context makes it ready again. The
// page loses its context on purpose (WEBGL_lose_context) when asked for 4 s and gives it
// back 1.5 s later.
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
export const name = 'code-clip-gl-lost'
export const timeoutMs = 120_000

const PAGE = `<!doctype html><html><head><meta charset="utf-8"></head><body style="margin:0;background:#000">
<canvas id="c" width="320" height="180"></canvas><script>
const cv = document.getElementById('c')
let gl = cv.getContext('webgl')
window.__config = { width: 320, height: 180, fps: 30, duration: 10 }
let lostOnce = false
cv.addEventListener('webglcontextlost', (e) => { e.preventDefault(); const ext = window.__ext; setTimeout(() => ext.restoreContext(), 1500) })
cv.addEventListener('webglcontextrestored', () => { gl = cv.getContext('webgl') })
window.renderOut = (t) => {
  // (Only when asked for 4 s exactly: the bin's strip asks other moments.)
  if (Math.abs(t - 4) < 0.05 && !lostOnce) { lostOnce = true; window.__ext = gl.getExtension('WEBGL_lose_context'); window.__ext.loseContext() }
  gl.clearColor(0.2, 0.8, 0.3, 1)
  gl.clear(gl.COLOR_BUFFER_BIT)
}
window.renderOut(0)
window.READY = true
</script></body></html>`

export async function run({ c, lib, work }) {
  const { assert } = lib
  const dir = join(work, 'gl-lost')
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'index.html'), PAGE)
  const r = await c.run(async (folder) => {
    const S = window.__store
    const [films, imp] = await window.__codeFilm()
    const info = await window.api.codeFilm.register(folder)
    const a0 = (await imp.codeFilmImport(info)).assets.find((a) => a.kind === 'code')
    a0.duration = 10
    const [a] = S.getState().addAssets([a0])
    films.codeFilms.ensure(a)
    const sleep = (ms) => new Promise((res) => setTimeout(res, ms))
    const until = async (f, ms) => { const t0 = performance.now(); while (performance.now() - t0 < ms) { const v = f(); if (v) return v; await sleep(50) } return null }
    await until(() => films.codeFilms.status(a.id)?.state === 'ready', 30000)
    const px = async (t) => {
      try {
        const b = await films.codeFilms.exactFrame(a, t)
        const o = new OffscreenCanvas(b.width, b.height).getContext('2d')
        o.drawImage(b, 0, 0)
        const d = o.getImageData(b.width >> 1, b.height >> 1, 1, 1).data
        b.close()
        return [...d].join(',')
      } catch (e) {
        return 'error: ' + e.message
      }
    }
    const out = {}
    out.before = await px(1)
    out.lost = await px(4)
    out.statusLost = { ...films.codeFilms.status(a.id) }
    out.lostAgain = await px(5)
    // (exactFrame is the export's own ask: an export stops with that sentence.)
    out.restoredReady = !!(await until(() => films.codeFilms.status(a.id)?.state === 'ready', 10000))
    out.after = await px(6)
    out.statusAfter = films.codeFilms.status(a.id)?.state
    return out
  }, dir)
  console.log('     gl-lost:', JSON.stringify(r))
  assert.equal(r.before, '51,204,77,255', 'drawn before the loss')
  assert.match(r.lost, /^error: The code film ".*" could not draw 4\.00 s: .*graphics memory/i, `the frame after the loss is an error naming the film: ${r.lost}`)
  assert.equal(r.statusLost.state, 'error')
  assert.match(r.statusLost.error, /graphics memory/i)
  assert.match(r.lostAgain, /^error: /, `still lost: ${r.lostAgain}`)
  assert.equal(r.restoredReady, true, 'ready again once the context is restored')
  assert.equal(r.after, '51,204,77,255', 'drawn again after the restore')
  assert.equal(r.statusAfter, 'ready')
}
