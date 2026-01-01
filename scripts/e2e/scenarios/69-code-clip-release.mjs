// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// 5a/5b patch, item 6 (audit C-7, haritalar\_faz5-denetim-citler.md): the
// engine's pruning (`codeFilms.release`, every 120 ticks) closed a film's page
// even while an export held it, so the export's ask failed with "The code
// film was closed." Now it respects the export lock like the other release;
// and asks cancelled by a release outside an export are caught where they
// were asked (no unhandled rejection in the page). The page draws slowly
// (300 ms) so an ask is in flight when the release comes.
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
export const name = 'code-clip-release'
export const timeoutMs = 90_000

const PAGE = `<!doctype html><html><head><meta charset="utf-8"></head><body style="margin:0;background:#000">
<canvas id="c" width="320" height="180"></canvas><script>
const g = document.getElementById('c').getContext('2d')
window.__config = { width: 320, height: 180, fps: 30, duration: 10 }
window.renderOut = (t) => { const e = performance.now() + 300; while (performance.now() < e) {} g.fillStyle = '#246'; g.fillRect(0, 0, 320, 180) }
window.READY = true
</script></body></html>`

export async function run({ c, lib, work }) {
  const { assert } = lib
  const dir = join(work, 'slow')
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'index.html'), PAGE)
  const r = await c.run(async (folder) => {
    const [films, imp] = await window.__codeFilm()
    const info = await window.api.codeFilm.register(folder)
    const a = (await imp.codeFilmImport(info)).assets.find((x) => x.kind === 'code')
    a.duration = 10
    a.width = 320
    a.height = 180
    let unhandled = 0
    const onUnhandled = () => { unhandled++ }
    window.addEventListener('unhandledrejection', onUnhandled)
    const settle = (p) => p.then((b) => { b.close(); return 'frame' }, (e) => 'error: ' + e.message)
    const out = {}
    try {
      films.codeFilms.ensure(a)
      // 1. An export holds the page: the pruning lets it be.
      films.codeFilms.lockForExport(true)
      try {
        const ask = settle(films.codeFilms.exactFrame(a, 1))
        await new Promise((res) => setTimeout(res, 100))
        films.codeFilms.release(new Set())
        out.duringExport = await ask
        out.liveAfterExportRelease = films.codeFilms.livePages().includes(a.id)
      } finally {
        films.codeFilms.lockForExport(false)
      }
      // 2. No export: the page goes, and what was asked of it fails where it was asked.
      const clip = { id: 'kx', assetId: a.id, trackId: 'V1', start: 0, inPoint: 0, duration: 10, transform: { x: 0, y: 0, scale: 1, rotation: 0 }, volume: 1 }
      films.codeFilms.frameFor(clip, a, 2)
      const ask2 = settle(films.codeFilms.exactFrame(a, 3))
      await new Promise((res) => setTimeout(res, 100))
      films.codeFilms.release(new Set())
      out.noExport = await ask2
      await new Promise((res) => setTimeout(res, 800))
      out.unhandled = unhandled
    } finally {
      window.removeEventListener('unhandledrejection', onUnhandled)
      films.codeFilms.release(new Set())
    }
    return out
  }, dir)
  console.log('     release:', JSON.stringify(r))
  assert.equal(r.duringExport, 'frame', 'the export got its frame though the pruning ran')
  assert.equal(r.liveAfterExportRelease, true)
  assert.match(r.noExport, /^error: The code film/, r.noExport)
  assert.equal(r.unhandled, 0, 'no unhandled rejection')
}
