// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// Phase 5f (FAZ5-PLAN.md "5f", tarifler\FAZ5.md 5f "Bitti ölçüsü"):
//   A. the six code templates added from the Templates panel to a saved
//      project: each copied into anim\<id>\ (byte for byte the app's), on a
//      new track over the picture at the playhead, played by its own
//      renderOut, its Parameters said, the checker "ok";
//   B. a parameter changed in the Inspector changes the frame and not the
//      code file; undone, the frame is the one before; the value is in the
//      saved project file;
//   C. the project look set in the Inspector reaches a template's frame and
//      the agent's frames context (as one fact line); cleared, it is gone;
//   D. (gone: the command box's "quick" way went with the typed request);
//   E. (found by the real-agent trial) an HTML page with its own renderOut
//      and no canvas is drawn whole, by its renderOut: not blank.
import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { connectAgent } from '../agent-client.mjs'

export const name = 'code-templates'
export const timeoutMs = 600_000
export const freshWindow = true

const IDS = ['blank', 'lower-third', 'bar-chart', 'counter', 'arrow', 'title-card']
const APP_DIR = new URL('../../../', import.meta.url)
const TPL = (id) => join(APP_DIR.pathname.replace(/^\/([A-Za-z]:)/, '$1'), 'resources', 'kod-sablonlari', id, 'index.html')

/** A frame of a film's page (its own draw, at `w` wide), as a hash and its pixels' sum. */
const frameOf = (c, assetId, t, w = 480) =>
  c.run(async (id, t, w) => {
    const [films] = await window.__codeFilm()
    const a = window.__store.getState().project.assets.find((x) => x.id === id)
    const t0 = performance.now()
    let bmp = null
    while (!bmp && performance.now() - t0 < 30000) bmp = await films.codeFilms.exactFrame(a, t, undefined, w).catch(() => null)
    if (!bmp) throw new Error('no frame of ' + id)
    const cv = new OffscreenCanvas(bmp.width, bmp.height)
    const g = cv.getContext('2d')
    g.drawImage(bmp, 0, 0)
    const px = g.getImageData(0, 0, bmp.width, bmp.height).data
    const hex = [...new Uint8Array(await crypto.subtle.digest('SHA-256', px))].map((b) => b.toString(16).padStart(2, '0')).join('')
    let alpha = 0
    for (let i = 3; i < px.length; i += 4) alpha += px[i] > 0 ? 1 : 0
    return { hash: hex.slice(0, 16), seen: alpha / (px.length / 4) }
  }, assetId, t, w)

const waitReady = (c, assetId) =>
  c.waitFor(`film ${assetId} ready`, () =>
    c.run(async (id) => {
      const [films] = await window.__codeFilm()
      const a = window.__store.getState().project.assets.find((x) => x.id === id)
      films.codeFilms.ensure(a)
      const st = films.codeFilms.status(id)
      return st?.state === 'ready' ? { mode: st.mode, params: st.params, readsLook: st.readsLook, query: null } : null
    }, assetId), 60000)

export async function run({ c, app, media, lib, work }) {
  const { assert } = lib
  await c.waitFor('the agent host', () => c.ev('!!window.__agent'))
  const [talk] = await lib.seedAssets(app, c, [media.talk])
  await lib.seedTimeline(c, [talk.id])
  // Not saved: the template is refused, the user told.
  await lib.dockPage(c, 'code')
  await c.click('codetpl.add.counter')
  await c.sleep(800)
  assert.equal(await c.st((s) => s.project.assets.filter((a) => a.kind === 'code').length), 0, 'nothing added to an unsaved project')
  // Saved.
  const projDir = join(work, 'tpl-project')
  mkdirSync(projDir, { recursive: true })
  const file = join(projDir, 'templates.snipp')
  lib.answer(app, { kind: 'save', path: file })
  await c.click('timeline.scroll', { fx: 0.95, fy: 0.97 })
  await c.key('s', ['ctrl'])
  await c.waitFor('saved', async () => existsSync(file), 10000)

  // ---- A. the six, each at its own moment -----------------------------------------
  const made = {}
  for (const [i, id] of IDS.entries()) {
    const at = 1 + i * 7
    await c.st((s, t) => s.setTime(t), at)
    const before = await c.st((s) => Object.keys(s.project.clips))
    const depth = await lib.undoDepth(c)
    await c.click(`codetpl.add.${id}`)
    const clipId = await c.waitFor(`${id} placed`, async () => (await c.st((s, b) => Object.keys(s.project.clips).find((k) => !b.includes(k)) ?? null, before)), 15000)
    const info = await c.st((s, cid) => {
      const cl = s.project.clips[cid]
      const a = s.project.assets.find((x) => x.id === cl.assetId)
      const top = s.project.tracks[0]
      const picture = s.project.tracks.findIndex((t) => t.clipIds.some((k) => s.project.clips[k]?.assetId !== cl.assetId && s.project.assets.find((x) => x.id === s.project.clips[k]?.assetId)?.kind === 'video'))
      return { assetId: a.id, path: a.path, start: cl.start, duration: cl.duration, onTop: top.clipIds.includes(cid), above: s.project.tracks.findIndex((t) => t.id === cl.trackId) < picture }
    }, clipId)
    assert.equal(await lib.undoDepth(c), depth + 1, `${id}: one undo step`)
    assert.equal(info.path, join(projDir, 'anim', id))
    // (Line ends aside: a package built from another checkout may hold CRLF.)
    const lf = (s) => s.replace(/\r\n/g, '\n')
    assert.equal(lf(readFileSync(join(info.path, 'index.html'), 'utf8')), lf(readFileSync(TPL(id), 'utf8')), `${id}: the app's page, copied`)
    assert.ok(info.onTop && info.above, `${id}: on a new track over the picture`)
    assert.ok(Math.abs(info.start - at) < 0.05, `${id} at the playhead: ${info.start}`)
    const st = await waitReady(c, info.assetId)
    assert.equal(st.mode, 'fast', `${id}: its own renderOut`)
    assert.ok(Array.isArray(st.params) && st.params.length >= 4, `${id}: its parameters said`)
    const r = await c.run(async (aid) => {
      const [films] = await window.__codeFilm()
      const a = window.__store.getState().project.assets.find((x) => x.id === aid)
      const r = await films.codeFilms.check(a)
      return { verdict: r.verdict, lines: r.lines, ms: Math.round(r.ms), length: r.length }
    }, info.assetId)
    console.log(`     ${id}: ${r.verdict} in ${r.ms} ms, length ${r.length} s, ${st.params.length} parameters`)
    assert.equal(r.verdict, 'ok', `${id}: ${JSON.stringify(r)}`)
    assert.ok(Math.abs(info.duration - r.length) < 0.05, `${id}: the clip as long as the page says (${info.duration} / ${r.length})`)
    made[id] = { ...info, clipId, check: r }
  }

  if (process.env.SNIPP_SHOTS) await c.shot(join(process.env.SNIPP_SHOTS, '82-panel.png'))
  // ---- B. a parameter: the frame changes, the code file does not ------------------
  const counter = made.counter
  const code0 = readFileSync(join(counter.path, 'index.html'), 'utf8')
  const f0 = await frameOf(c, counter.assetId, 3)
  await c.st((s, id) => s.selectClips([id]), counter.clipId)
  await c.click('inspector.tab.clip')
  await c.click('codefilm.params.toggle')
  await c.fill('codefilm.param.to', '98765', { enter: true })
  if (process.env.SNIPP_SHOTS) await c.shot(join(process.env.SNIPP_SHOTS, '82-params.png'))
  await c.waitFor('the value kept', async () => (await c.st((s, id) => s.project.assets.find((a) => a.id === id).code.params?.to ?? null, counter.assetId)) === 98765, 5000)
  await c.sleep(500)
  const f1 = await c.waitFor('the frame redrawn', async () => {
    const f = await frameOf(c, counter.assetId, 3)
    return f.hash !== f0.hash ? f : null
  }, 20000)
  assert.notEqual(f1.hash, f0.hash, 'the frame changed')
  assert.equal(readFileSync(join(counter.path, 'index.html'), 'utf8'), code0, 'the code file did not')
  // The page got the value (its params said, the user's on top).
  const said = await c.run(async (id) => (await window.__codeFilm())[0].codeFilms.status(id).params.find((p) => p.key === 'to').value, counter.assetId)
  assert.equal(said, 1000, "the Inspector shows the page's own value as its default")
  // Saved: in the project file.
  await c.click('timeline.scroll', { fx: 0.95, fy: 0.97 })
  await c.key('s', ['ctrl'])
  await c.waitFor('saved with the value', async () => /"to":\s*98765/.test(readFileSync(file, 'utf8')), 10000)
  // Undone: the page's own value, the frame as before.
  await c.key('z', ['ctrl'])
  await c.waitFor('undone', async () => (await c.st((s, id) => s.project.assets.find((a) => a.id === id).code.params ?? null, counter.assetId)) === null, 5000)
  const f2 = await c.waitFor('the frame back', async () => {
    const f = await frameOf(c, counter.assetId, 3)
    return f.hash === f0.hash ? f : null
  }, 20000)
  assert.equal(f2.hash, f0.hash)
  console.log(`     counter "to" 1000 → 98765: frame ${f0.hash} → ${f1.hash}, code file the same; undone → ${f2.hash}`)

  // ---- C. the project look ---------------------------------------------------------
  const blank = made.blank
  const b0 = await frameOf(c, blank.assetId, 2)
  const blankSt = await waitReady(c, blank.assetId)
  assert.equal(blankSt.readsLook, true, 'the template read the project look')
  const ag = await connectAgent({ c, app, assert, client: 'tpl-script' })
  const ctx0 = (await ag.call('frames', { times: [1.5, 2.5], context: true, width: 320 })).text
  assert.ok(!/Project look/.test(ctx0), 'no look line while none is set')
  await c.click('inspector.tab.project')
  await c.click('inspector.project.settings')
  await c.fill('project.look.accent', '#00c8ff', { enter: true })
  await c.fill('project.look.font', 'Consolas', { enter: true })
  if (process.env.SNIPP_SHOTS) await c.shot(join(process.env.SNIPP_SHOTS, '82-look.png'))
  await c.waitFor('the look kept', async () => JSON.stringify(await c.st((s) => s.project.look ?? null)) === JSON.stringify({ accent: '#00c8ff', font: 'Consolas' }), 5000)
  const b1 = await c.waitFor('the template redrawn', async () => {
    const f = await frameOf(c, blank.assetId, 2)
    return f.hash !== b0.hash ? f : null
  }, 20000)
  const ctx1 = (await ag.call('frames', { times: [1.5, 2.5], context: true, width: 320 })).text
  assert.match(ctx1, /\nProject look \(set by the user\): accent #00c8ff, font "Consolas"\.$/)
  await c.fill('project.look.accent', '', { enter: true })
  await c.fill('project.look.font', '', { enter: true })
  await c.waitFor('the look cleared', async () => (await c.st((s) => s.project.look ?? null)) === null, 5000)
  const b2 = await c.waitFor('the template as before', async () => {
    const f = await frameOf(c, blank.assetId, 2)
    return f.hash === b0.hash ? f : null
  }, 20000)
  const ctx2 = (await ag.call('frames', { times: [1.5, 2.5], context: true, width: 320 })).text
  assert.ok(!/Project look/.test(ctx2))
  console.log(`     look: blank ${b0.hash} → ${b1.hash} → ${b2.hash}; context line said only while set`)

  // (D, quick / original, went with the typed request: TERMINAL-YOK-PLAN.md.)
  await domPagePart({ c, lib, work })
  await c.run(() => window.__store.getState().setDirty(false))
}

// ---- E (found by the real-agent trial): a page with its own renderOut that
// draws HTML and no canvas is drawn whole (a window of its own), its renderOut
// called at each moment: not blank, frames differ by moment, the checker "ok".
export const DOM_PAGE = `<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;width:1280px;height:720px;background:transparent;overflow:hidden;font-family:"Segoe UI",sans-serif}
#t{position:absolute;left:80px;top:500px;font-size:96px;font-weight:800;color:#fff;opacity:0}#b{position:absolute;left:80px;top:620px;height:12px;width:600px;background:#ffb020;transform-origin:left}</style></head>
<body><div id="t">1986</div><div id="b"></div><script>
window.__config={width:1280,height:720,duration:4};
window.renderOut=function(t){var k=Math.min(1,t/1.5);document.getElementById('t').style.opacity=k;document.getElementById('t').textContent=String(Math.round(1976+10*k));document.getElementById('b').style.transform='scaleX('+k+')'};
window.READY=true;
</script></body></html>`

export async function domPagePart({ c, lib, work }) {
  const { assert } = lib
  const { mkdirSync, writeFileSync } = await import('node:fs')
  const dir = join(work, 'dom-renderout')
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'index.html'), DOM_PAGE)
  const id = await c.run(async (folder) => {
    const [, imp] = await window.__codeFilm()
    const info = await window.api.codeFilm.register(folder)
    const a0 = (await imp.codeFilmImport(info)).assets.find((a) => a.kind === 'code')
    const [a] = window.__store.getState().addAssets([a0])
    return (a ?? a0).id
  }, dir)
  await c.waitFor('the page drawn whole', () =>
    c.run(async (id) => {
      const [films] = await window.__codeFilm()
      films.codeFilms.ensure(window.__store.getState().project.assets.find((x) => x.id === id))
      const st = films.codeFilms.status(id)
      return st?.state === 'ready' && st.mode === 'page'
    }, id), 60000)
  const f0 = await frameOf(c, id, 0.2)
  const f1 = await frameOf(c, id, 2)
  assert.notEqual(f0.hash, f1.hash, 'two moments, two pictures')
  assert.ok(f1.seen > 0.01, `drawn (not clear): ${f1.seen}`)
  const r = await c.run(async (id) => {
    const [films] = await window.__codeFilm()
    const r = await films.codeFilms.check(window.__store.getState().project.assets.find((x) => x.id === id))
    return { verdict: r.verdict, lines: r.lines }
  }, id)
  console.log(`     HTML page with its own renderOut, no canvas: mode page, ${r.verdict}; ${(f1.seen * 100).toFixed(1)} % of the frame drawn at 2 s`)
  assert.equal(r.verdict, 'ok', JSON.stringify(r))
}
