// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// Phase 5e (FAZ5-PLAN.md "5e", tarifler\FAZ5.md 5e "Bitti ölçüsü"):
//   A. the checker: F1–F4 "ok"; F1 drawn by its own renderOut with unseeded
//      chance (the fast path: the app's clock is not on it) "unstable"; the
//      code_clip tool's empty page "blank"; a page with a syntax error
//      "error"; the audit's e1-throws (an error in every frame after 2 s,
//      5c + 5d audit S-6) "error", its page's errors after ready seen too;
//   B. a scripted agent over real HTTP: help (no base), code_clip create
//      refused while the project is not saved, three creates on three ranges,
//      the pages written, check each, changes and the clip's note carry the
//      error line, the draft accepted, ONE Ctrl+Z takes all of it back, the
//      folders stay on disk; frames context:true;
//   C. versions: 11 saved changes of a folder leave 10 versions on disk; the
//      inspector's "back to the previous version" puts the one before back.
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { TESTDATA } from '../media.mjs'
import { connectAgent, versionOf } from '../agent-client.mjs'

export const name = 'code-clip-checker-agent'
export const timeoutMs = 900_000
export const freshWindow = true

const EMPTY = '<!doctype html>\n<html>\n<head>\n<meta charset="utf-8">\n</head>\n<body>\n</body>\n</html>\n'

const PAGES = {
  // F1 drawn by its own renderOut: chance unseeded on every draw.
  'F1-unseeded': `<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;background:#000}</style></head><body><canvas id="c" width="640" height="360"></canvas><script>
var g=document.getElementById('c').getContext('2d');
window.__config={width:640,height:360,fps:30,duration:6};
window.renderOut=function(t){ g.fillStyle='#000'; g.fillRect(0,0,640,360); for(var i=0;i<40;i++){ g.fillStyle='hsl('+Math.floor(Math.random()*360)+',80%,60%)'; g.fillRect(Math.random()*600,Math.random()*320,40,40) } };
window.READY=true;
</script></body></html>`,
  blank: EMPTY,
  // A script that does not parse beside one that draws.
  'syntax-error': `<!doctype html><html><head><meta charset="utf-8"></head><body style="margin:0"><canvas id="c" width="640" height="360"></canvas><script>
var g=document.getElementById('c').getContext('2d');
function frame(t){ g.fillStyle='#204'; g.fillRect(0,0,640,360); g.fillStyle='#fc0'; g.fillRect(20+t*0.05,100,80,80); requestAnimationFrame(frame) }
requestAnimationFrame(frame);
</script><script>let broken = ;</script></body></html>`
}

/** A canvas page that draws a moving box (what the scripted agent writes). */
const AGENT_PAGE = (hue, extra = '') => `<!doctype html><html><head><meta charset="utf-8"></head><body style="margin:0"><canvas id="c" width="960" height="540"></canvas><script>
var g=document.getElementById('c').getContext('2d');
function frame(t){ g.clearRect(0,0,960,540); g.fillStyle='hsl(${hue},80%,55%)'; g.fillRect(40+t*0.08,200,160,120); ${extra} requestAnimationFrame(frame) }
requestAnimationFrame(frame);
</script></body></html>`

export async function run({ c, app, media, lib, work }) {
  const { assert } = lib
  await c.waitFor('the agent host', () => c.ev('!!window.__agent'))

  // ---- A. the checker on pages ------------------------------------------------
  const dirs = {}
  for (const n of ['F1-tuval', 'F2-html', 'F3-three', 'F4-gsap', 'E1-throws']) {
    dirs[n] = join(work, 'checker', n)
    cpSync(join(TESTDATA, 'kod-klibi-serbest', n), dirs[n], { recursive: true })
  }
  for (const [n, html] of Object.entries(PAGES)) {
    dirs[n] = join(work, 'checker', n)
    mkdirSync(dirs[n], { recursive: true })
    writeFileSync(join(dirs[n], 'index.html'), html)
  }
  const want = { 'F1-tuval': 'ok', 'F2-html': 'ok', 'F3-three': 'ok', 'F4-gsap': 'ok', 'F1-unseeded': 'unstable', blank: 'blank', 'syntax-error': 'error', 'E1-throws': 'error' }
  const found = {}
  for (const n of Object.keys(want)) {
    const r = await c.run(async (folder) => {
      const sleep = (ms) => new Promise((res) => setTimeout(res, ms))
      const S = window.__store
      const [films, imp] = await window.__codeFilm()
      const info = await window.api.codeFilm.register(folder)
      const a0 = (await imp.codeFilmImport(info)).assets.find((a) => a.kind === 'code')
      const [a] = S.getState().addAssets([a0])
      const id = (a ?? a0).id
      const asset = () => S.getState().project.assets.find((x) => x.id === id)
      films.codeFilms.ensure(asset())
      const t0 = performance.now()
      while (performance.now() - t0 < 60000) {
        const st = films.codeFilms.status(id)
        if (st?.state === 'ready' || st?.state === 'error') break
        films.codeFilms.ensure(asset())
        await sleep(50)
      }
      const st0 = { ...films.codeFilms.status(id) }
      const r = await films.codeFilms.check(asset())
      await sleep(2500)
      const st = films.codeFilms.status(id)
      return { id, state: st0.state, mode: st0.mode, verdict: r.verdict, lines: r.lines, ms: Math.round(r.ms), length: r.length, now: films.codeFilms.verdict(id), runErrors: st?.runErrors ?? 0, runError: st?.runError ?? null }
    }, dirs[n])
    found[n] = r
    console.log(`     ${n}: ${r.verdict} (${r.mode ?? r.state}, ${r.ms} ms)${r.lines.length ? ' — ' + r.lines[0].slice(0, 90) : ''}`)
  }
  for (const [n, v] of Object.entries(want)) assert.equal(found[n].verdict, v, `${n}: ${JSON.stringify(found[n])}`)
  assert.match(found['syntax-error'].lines.join('\n'), /SyntaxError|Unexpected/)
  assert.match(found['E1-throws'].lines.join('\n'), /film bug at/)
  // S-6: errors after ready reach the film's status and its verdict.
  assert.ok(found['E1-throws'].runErrors > 0, 'errors after ready counted')
  assert.match(found['E1-throws'].runError ?? '', /film bug at/)
  assert.equal(found['E1-throws'].now.verdict, 'error')
  // One badge: the checker's "ok" rules over the early sign.
  for (const n of ['F1-tuval', 'F2-html', 'F3-three', 'F4-gsap']) assert.equal(found[n].now.verdict, 'ok', n)
  // The project of part A goes (a new one for the agent).
  await c.run(() => window.__store.getState().newProject?.())
  // (Its film pages let go before the next import.)
  await c.sleep(3000)

  // ---- B. the scripted agent ----------------------------------------------------
  console.log('     part B')
  const [talk] = await lib.seedAssets(app, c, [media.talk])
  console.log('     talk imported')
  await lib.seedTimeline(c, [talk.id])
  await c.run(() => window.__agent.setMode('draft'))
  const ag = await connectAgent({ c, app, assert, client: 'code-clip-script' })
  console.log(`     definitions: ${ag.defsChars} chars`)
  assert.ok(ag.defsChars <= 12000, `definitions ${ag.defsChars}`)
  assert.ok(ag.tools.some((t) => t.name === 'code_clip'))
  // help: no base, no draft.
  const help = await ag.call('edit', { ops: [{ op: 'help', names: ['clip.slip', 'motion.gentlePan'] }] })
  assert.match(help.text, /^clip\.slip\{clipId:s,delta:n\(s\)/m)
  assert.equal(await c.run(() => window.__agent.draft()), null, 'help makes no draft')
  // Not saved yet: refused, and the user is told.
  const refused = await ag.call('code_clip', { create: { name: 'intro', start: 1, end: 3 } }, { allowError: true })
  assert.equal(refused.isError, true)
  assert.match(refused.text, /save the project first/)
  // Saved.
  const projDir = join(work, 'agent-project')
  mkdirSync(projDir, { recursive: true })
  const file = join(projDir, 'code clips.snipp')
  lib.answer(app, { kind: 'save', path: file })
  await c.click('timeline.scroll', { fx: 0.95, fy: 0.97 })
  await c.key('s', ['ctrl'])
  await c.waitFor('saved', async () => existsSync(file), 10000)
  await c.waitFor('not dirty', async () => !(await c.st((s) => s.dirty)), 10000)
  const depth0 = await lib.undoDepth(c)
  const clips0 = await c.st((s) => Object.keys(s.project.clips).length)
  // Three ranges.
  const ranges = { intro: [1, 3], bar: [4, 6.5], outro: [7, 9] }
  const made = {}
  for (const [n, [a, b]] of Object.entries(ranges)) {
    const r = await ag.call('code_clip', { create: { name: n, start: a, end: b } })
    const folder = /^Folder: (.+?) \(/.exec(r.text)?.[1]
    const clip = /clip=([A-Za-z0-9_-]+)/.exec(r.text)?.[1]
    assert.ok(folder && clip, r.text)
    assert.equal(folder, join(projDir, 'anim', n))
    assert.equal(readFileSync(join(folder, 'index.html'), 'utf8'), EMPTY)
    made[n] = { folder, clip }
  }
  const d1 = await c.run(() => window.__agent.draft())
  assert.ok(d1, 'the clips wait in a draft')
  const dp = await c.run(() => window.__agent.draft().project)
  for (const [n, [a, b]] of Object.entries(ranges)) {
    const cl = dp.clips[made[n].clip]
    assert.ok(cl, `${n} in the draft`)
    assert.ok(Math.abs(cl.start - a) < 1e-6 && Math.abs(cl.duration - (b - a)) < 1e-3, `${n}: ${cl.start} + ${cl.duration}`)
    const picture = dp.tracks.findIndex((t) => t.clipIds.some((id) => dp.clips[id]?.assetId === talk.id))
    assert.ok(picture >= 0 && dp.tracks.findIndex((t) => t.id === cl.trackId) < picture, `${n} over the picture`)
  }
  // A second create with the same name uses the folder as it is.
  writeFileSync(join(made.bar.folder, 'index.html'), AGENT_PAGE(200))
  const again = await ag.call('code_clip', { create: { name: 'bar', start: 4, end: 6.5 } }, { allowError: true })
  assert.match(again.text, /it was there: its files are kept/)
  assert.equal(readFileSync(join(made.bar.folder, 'index.html'), 'utf8'), AGENT_PAGE(200))
  // The draft (with that fourth clip) rejected: the folders stay; made again.
  await c.run(() => window.__agent.reject())
  for (const n of Object.keys(ranges)) assert.ok(existsSync(join(made[n].folder, 'index.html')), `${n}'s folder stays after a rejected draft`)
  for (const [n, [a, b]] of Object.entries(ranges)) {
    const r = await ag.call('code_clip', { create: { name: n, start: a, end: b } })
    made[n].clip = /clip=([A-Za-z0-9_-]+)/.exec(r.text)?.[1]
  }
  // The pages written (the third one throws after 0.5 s in every frame).
  writeFileSync(join(made.intro.folder, 'index.html'), AGENT_PAGE(30))
  writeFileSync(join(made.bar.folder, 'index.html'), AGENT_PAGE(120))
  writeFileSync(join(made.outro.folder, 'index.html'), AGENT_PAGE(280, "if (t > 500) throw new Error('outro broke at ' + Math.round(t));"))
  const vRead = versionOf((await ag.call('project')).text)
  await c.sleep(3000)
  const checks = {}
  for (const n of Object.keys(ranges)) {
    checks[n] = await ag.call('code_clip', { check: made[n].clip })
    console.log(`     check ${n}: ${checks[n].text.split('\n')[0]}`)
  }
  assert.match(checks.intro.text, new RegExp(`^${made.intro.clip}: ok\\. Length 2 s`))
  assert.match(checks.bar.text, new RegExp(`^${made.bar.clip}: ok\\. Length 2\\.5 s`))
  assert.match(checks.outro.text, new RegExp(`^${made.outro.clip}: error\\.`))
  assert.match(checks.outro.text, /outro broke at/)
  // changes: one line for the erring clip.
  const ch = await ag.call('changes', { since: vRead })
  assert.match(ch.text, new RegExp(`^Code clip ${made.outro.clip} \\(outro\\): error: .*outro broke at`, 'm'))
  assert.ok(!new RegExp(`Code clip ${made.intro.clip}`).test(ch.text))
  // frames context:true.
  const fr = await ag.call('frames', { times: [1.5, 2.5], context: true, width: 320 })
  // (Audit A5: over the intro's code clip, its own film seconds.)
  assert.match(fr.text, new RegExp(`\\nContext 1\\.50–2\\.50 s\\. Said \\(s of code clip ${made.intro.clip}'s film\\):`))
  assert.match(fr.text, /\nSafe area \(90 %\): x \d+–\d+, y \d+–\d+\. Output \d+x\d+, \d+ fps\.$/)
  // Accepted: one step; the note on the erring clip carries its line.
  const acc = await c.run(async () => {
    const o = await window.__agent.accept()
    return { applied: o?.applied?.length ?? 0, dropped: (o?.dropped ?? []).map((x) => x.reason) }
  })
  console.log(`     accepted: ${acc.applied} ops applied, ${acc.dropped.length} dropped`)
  assert.deepEqual(acc.dropped, [], 'the clips land although their films learnt their own size meanwhile')
  await c.waitFor('accepted', async () => (await c.run(() => window.__agent.draft())) === null, 10000)
  const live = await c.st((s) => s.project)
  for (const n of Object.keys(ranges)) assert.ok(live.clips[made[n].clip], `${n} in the project`)
  await c.waitFor('the error note', async () => (await c.run((id) => (window.__store.getState().project.notes ?? []).some((x) => x.clip?.id === id && /outro broke at/.test(x.text)), made.outro.clip)), 10000)
  const notes = await c.st((s) => (s.project.notes ?? []).map((x) => ({ clip: x.clip?.id, text: x.text })))
  assert.equal(notes.filter((x) => x.clip === made.intro.clip || x.clip === made.bar.clip).length, 0, 'no note on the clips that pass')
  await c.waitFor('the error chip on the timeline', () => c.ev(`!!document.querySelector('[data-testid="codeclip.error"]')`), 10000)
  const depth1 = await lib.undoDepth(c)
  await c.click('timeline.scroll', { fx: 0.95, fy: 0.97 })
  await c.key('z', ['ctrl'])
  await c.waitFor('one undo', async () => (await lib.undoDepth(c)) === depth1 - 1, 5000)
  const after = await c.st((s) => s.project)
  for (const n of Object.keys(ranges)) assert.ok(!after.clips[made[n].clip], `${n} undone`)
  assert.equal(Object.keys(after.clips).length, clips0, 'the project as before the accept')
  assert.ok(depth1 - depth0 >= 1)
  for (const n of Object.keys(ranges)) assert.ok(existsSync(join(made[n].folder, 'index.html')), `${n}'s folder stays`)
  // (Audit A3: their films, used by no clip now, left the project.)
  await c.waitFor('the films left', async () => (await c.st((s, folders) => s.project.assets.filter((a) => a.kind === 'code' && folders.includes(a.path)).length, Object.values(made).map((m) => m.folder))) === 0, 5000)

  // ---- C. versions ----------------------------------------------------------------
  const vf = made.intro.folder
  const vdir = join(vf, '.surumler')
  const before = existsSync(vdir) ? readdirSync(vdir).length : 0
  for (let i = 0; i < 11; i++) {
    writeFileSync(join(vf, 'index.html'), AGENT_PAGE(i * 30, `/* v${i} */`))
    await c.sleep(2600)
  }
  await c.waitFor('10 versions', async () => existsSync(vdir) && readdirSync(vdir).length === 10, 15000)
  const kept = readdirSync(vdir).map(Number).sort((a, b) => a - b)
  console.log(`     versions: ${before} before, ${kept.length} after 11 more saves (${kept[0]}…${kept[kept.length - 1]})`)
  assert.equal(kept.length, 10)
  assert.match(readFileSync(join(vdir, String(kept[kept.length - 1]), 'index.html'), 'utf8'), /\/\* v9 \*\//)
  // Back to the previous version: the inspector's button, on a clip of it.
  // (Audit A3: once the accept was undone no clip used the film and it left
  // the project; its folder stayed. The user brings the folder in again —
  // the work kept by the page and asked after: e2e 66's "Promise was collected".)
  await c.run((folder) => {
    window.__reimport = null
    void (async () => {
      const [, imp] = await window.__codeFilm()
      const info = await window.api.codeFilm.register(folder)
      const a0 = (await imp.codeFilmImport(info)).assets.find((x) => x.kind === 'code')
      window.__store.getState().addAssets([a0])
      window.__reimport = 'done'
    })()
  }, vf)
  await c.waitFor('the folder back in', () => c.ev('window.__reimport === "done"'), 15000)
  await c.run((folder) => {
    const s = window.__store.getState()
    const a = s.project.assets.find((x) => x.kind === 'code' && x.path === folder)
    s.addToTimeline(a.id)
    const clip = Object.values(window.__store.getState().project.clips).find((x) => x.assetId === a.id)
    window.__store.getState().selectClip(clip.id)
  }, vf)
  await c.click('inspector.tab.clip')
  const seen = async () => c.ev(`(() => { const r = document.querySelector('[data-testid="codefilm.versions"]'); const sel = window.__store.getState().selectedClipIds; const tab = document.querySelector('[role="tab"][aria-selected="true"]')?.dataset.testid; const code = [...document.querySelectorAll('.section-title, h3, h4')].map((x) => x.textContent).join('|').slice(0, 300); return JSON.stringify({ count: r?.dataset.count ?? null, sel, tab, code }) })()`)
  try {
    await c.waitFor('the versions row', async () => JSON.parse(await seen()).count === '10', 15000)
  } catch (e) {
    throw new Error(`${e.message}: ${await seen()}`)
  }
  await c.click('codefilm.version-back')
  await c.waitFor('version put back', async () => /\/\* v9 \*\//.test(readFileSync(join(vf, 'index.html'), 'utf8')), 10000)
  assert.match(readFileSync(join(vf, 'index.html'), 'utf8'), /\/\* v9 \*\//)
  assert.equal(readdirSync(vdir).length, 10, 'the files of now became a version, the oldest went')
  await c.sleep(3000)
  assert.equal(readdirSync(vdir).length, 10, 'putting a version back made no new one')
}
