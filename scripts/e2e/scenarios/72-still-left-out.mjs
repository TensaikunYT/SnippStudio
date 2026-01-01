// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// 5a/5b patch, item 8 (audit C-6, haritalar\_faz5-denetim-citler.md): a still
// frame (a note's picture, "save frame", the agent's frames tool) draws a code
// clip leniently: a film that cannot draw that moment was left out silently,
// and the picture came without it. Now the result says so in one sentence
// naming the clip: the still's own list (exportFramePng), the agent's frames
// answer. The film's page throws for every moment from 1 s on.
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { connectAgent } from '../agent-client.mjs'
export const name = 'still-left-out'
export const timeoutMs = 120_000

const PAGE = `<!doctype html><html><head><meta charset="utf-8"></head><body style="margin:0;background:#000">
<canvas id="c" width="320" height="180"></canvas><script>
const g = document.getElementById('c').getContext('2d')
window.__config = { width: 320, height: 180, fps: 30, duration: 10 }
window.renderOut = (t) => { if (t >= 1) throw new Error('this film breaks after 1 s'); g.fillStyle = '#246'; g.fillRect(0, 0, 320, 180) }
window.renderOut(0); window.READY = true
</script></body></html>`

export async function run({ c, app, media, lib, work }) {
  const { assert } = lib
  const dir = join(work, 'breaks')
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'index.html'), PAGE)
  const [talk] = await lib.seedAssets(app, c, [media.talk])
  await c.waitFor('the agent host', () => c.ev('!!window.__agent'))
  const r = await c.run(async (folder, talkId) => {
    const S = window.__store
    const [films, imp] = await window.__codeFilm()
    const info = await window.api.codeFilm.register(folder)
    const a = (await imp.codeFilmImport(info)).assets.find((x) => x.kind === 'code')
    a.id = 'brk'
    a.width = 320
    a.height = 180
    a.duration = 10
    const p = structuredClone(S.getState().project)
    p.assets.push(a)
    p.tracks = [{ id: 'V2', kind: 'video', name: 'V2', clipIds: ['k'] }, { id: 'V1', kind: 'video', name: 'V1', clipIds: ['v'] }, { id: 'A1', kind: 'audio', name: 'A1', clipIds: [] }]
    p.clips = {
      v: { id: 'v', assetId: talkId, trackId: 'V1', start: 0, inPoint: 0, duration: 10, transform: { x: p.settings.width / 2, y: p.settings.height / 2, scale: p.settings.width / 640, rotation: 0 }, volume: 1 },
      k: { id: 'k', assetId: 'brk', trackId: 'V2', start: 0, inPoint: 0, duration: 10, transform: { x: p.settings.width / 2, y: p.settings.height / 2, scale: 1, rotation: 0 }, volume: 1 }
    }
    S.getState().loadProject(p)
    S.getState().setDirty(false)
    films.codeFilms.ensure(S.getState().project.assets.find((x) => x.id === 'brk'))
    const t0 = performance.now()
    while (films.codeFilms.status('brk')?.state !== 'ready' && performance.now() - t0 < 20000) await new Promise((res) => setTimeout(res, 50))
    const ex = await window.__exporter()
    const ok = []
    await ex.exportFramePng(S.getState().project, 0.5, false, 'draft', ok)
    const left = []
    const png = await ex.exportFramePng(S.getState().project, 2.5, false, 'draft', left)
    return { ok, left, bytes: png.length }
  }, dir, talk.id)
  console.log('     still:', JSON.stringify(r))
  assert.deepEqual(r.ok, [], 'a moment the film draws: nothing left out')
  assert.ok(r.bytes > 1000, 'the still is still made')
  assert.equal(r.left.length, 1, JSON.stringify(r.left))
  assert.match(r.left[0], /"breaks"/, r.left[0])
  // The agent's frames tool says it too.
  const ag = await connectAgent({ c, app, assert })
  const fr = await ag.call('frames', { times: [2.5] })
  console.log('     frames:', fr.text)
  assert.equal(fr.images.length, 1)
  assert.match(fr.text, /"breaks"/, fr.text)
  const fine = await ag.call('frames', { times: [0.5] })
  assert.doesNotMatch(fine.text, /"breaks"/, fine.text)
}
