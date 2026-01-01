// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// Phase 5e + 5f audit patch (tarifler\FAZ5-YAMA-EF.md), what only the app
// shows. Parts (SNIPP_EF=D1,D5 runs only some):
//   D1. the checker's verdict belongs to the code it checked: a page whose
//       code breaks while a check of the code before runs ends "error" (the
//       auditor's p2), and a check asked right after a save answers of the
//       code of now;
//   D5. ten saves of a heavy film (the heavy film, ≈ 13 s to be ready) 2 s and
//       200 ms apart leave no "not ready in 20 s" (the auditor's p3): the
//       verdict is the one of the quiet film;
//   D3. versions only for the open project's own anim\<name>: a folder of the
//       user's elsewhere whose parent is named anim gets no .surumler.
import { appendFileSync, cpSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { FILM, TESTDATA } from '../media.mjs'

export const name = 'code-clip-audit-ef'
export const timeoutMs = 1_200_000
export const freshWindow = true

const PARTS = (process.env.SNIPP_EF ?? '').split(',').map((x) => x.trim()).filter(Boolean)
const part = (p) => !PARTS.length || PARTS.includes(p)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/** Work run in the page, its promise kept by the page and asked after with
 *  short reads (one long awaited ask is now and then answered "Promise was
 *  collected" by CDP: e2e 66). */
let taskSeq = 0
async function task(c, fn, ...args) {
  const key = `__ef${++taskSeq}`
  await c.ev(`window.${key} = { done: false }; (async () => (${fn.toString()})(...${JSON.stringify(args)}))().then((v) => { window.${key} = { done: true, v } }, (e) => { window.${key} = { done: true, e: String(e && e.stack || e) } }); 0`)
  for (;;) {
    const r = await c.ev(`window.${key}`)
    if (r?.done) {
      await c.ev(`delete window.${key}; 0`)
      if (r.e) throw new Error(r.e)
      return r.v
    }
    await sleep(100)
  }
}

function writePage(dir, html) {
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'index.html'), html)
  return dir
}

/** A folder as a code film of the project (as e2e 81 does): its asset id. */
const importFilm = (c, folder, onTimeline = false) =>
  task(
    c,
    async ([folder, onTimeline]) => {
      const S = window.__store
      const [films, imp] = await window.__codeFilm()
      const info = await window.api.codeFilm.register(folder)
      const a0 = (await imp.codeFilmImport(info)).assets.find((a) => a.kind === 'code')
      const [a] = S.getState().addAssets([a0])
      const id = (a ?? a0).id
      if (onTimeline) S.getState().addToTimeline(id)
      films.codeFilms.ensure(S.getState().project.assets.find((x) => x.id === id))
      return id
    },
    [folder, onTimeline]
  )

const waitState = (c, id, ms = 60000) =>
  task(
    c,
    async ([id, ms]) => {
      const sleep = (t) => new Promise((r) => setTimeout(r, t))
      const [films] = await window.__codeFilm()
      const S = window.__store
      const t0 = performance.now()
      while (performance.now() - t0 < ms) {
        const st = films.codeFilms.status(id)
        if (st?.state === 'ready' || st?.state === 'error') return { state: st.state, mode: st.mode, ms: Math.round(performance.now() - t0) }
        const a = S.getState().project.assets.find((x) => x.id === id)
        if (a) films.codeFilms.ensure(a)
        await sleep(50)
      }
      return { state: films.codeFilms.status(id)?.state ?? null, ms }
    },
    [id, ms]
  )

const check = (c, id) =>
  task(c, async (id) => {
    const [films] = await window.__codeFilm()
    const a = window.__store.getState().project.assets.find((x) => x.id === id)
    try {
      const r = await films.codeFilms.check(a)
      return { verdict: r.verdict, lines: r.lines, ms: Math.round(r.ms) }
    } catch (e) {
      return { verdict: 'THROW', lines: [String(e?.message ?? e)] }
    }
  }, id)

const verdictNow = (c, id) =>
  task(c, async (id) => {
    const [films] = await window.__codeFilm()
    return { now: films.codeFilms.verdict(id), act: films.codeFilms.activity(id) }
  }, id)

const fixNotes = (c) => c.st((s) => (s.project.notes ?? []).filter((n) => n.kind === 'fix' && n.status !== 'ready').map((n) => n.text.slice(0, 160)))

/** Waits until no check has run for `quiet` ms (at most `ms`). */
async function untilQuiet(c, id, quiet = 6000, ms = 180000) {
  const t0 = Date.now()
  let since = Date.now()
  while (Date.now() - t0 < ms) {
    const v = await verdictNow(c, id)
    if (v.act.checking) since = Date.now()
    if (Date.now() - since > quiet) return Date.now() - t0
    await sleep(400)
  }
  return -1
}

const GOOD = (tag) => `<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;background:transparent}</style></head><body><canvas id="c" width="1280" height="720"></canvas><script>
var g=document.getElementById('c').getContext('2d');
window.__config={width:1280,height:720,fps:30,duration:10};
window.renderOut=function(t){ g.clearRect(0,0,1280,720); g.fillStyle='#e33'; g.fillRect(100+t*80,300,200,120) };
setTimeout(function(){ window.READY=true }, 6000); /* ${tag} */
</script></body></html>`
/** A small canvas page (
: its colour). */
const SMALL = (n) => `<!doctype html><html><head><meta charset="utf-8"></head><body><canvas id="c" width="320" height="180"></canvas><script>
var g=document.getElementById('c').getContext('2d'); window.__config={width:320,height:180,fps:30,duration:4};
window.renderOut=function(t){ g.clearRect(0,0,320,180); g.fillStyle='hsl(${n * 30},80%,50%)'; g.fillRect(10+t*20,60,60,40) }; window.READY=true; /* v${n} */
</script></body></html>`
const BROKEN = `<!doctype html><html><head><meta charset="utf-8"></head><body><canvas id="c" width="1280" height="720"></canvas><script>
window.__config={width:1280,height:720,fps:30,duration:10};
window.renderOut=function(t){ throw new Error('v2 is broken at ' + t) };
window.READY=true;
</script></body></html>`

export async function run({ c, app, lib, work, relaunch }) {
  const { assert } = lib
  const R = {}
  await c.waitFor('the agent host', () => c.ev('!!window.__agent'))

  if (part('D1')) {
    // (a) the auditor's p2: the code breaks while the check of the code before runs.
    const dir = writePage(join(work, 'd1', 'race'), GOOD('v1'))
    const id = await importFilm(c, dir, true)
    await waitState(c, id, 30000)
    const c0 = await check(c, id)
    writeFileSync(join(dir, 'index.html'), GOOD('v1b'))
    await sleep(8500)
    writeFileSync(join(dir, 'index.html'), BROKEN)
    await sleep(30000)
    await untilQuiet(c, id)
    const end = await verdictNow(c, id)
    const notes = await fixNotes(c)
    const truth = await check(c, id)
    R.D1a = { first: c0.verdict, end: end.now, notes, truth: truth.verdict }
    console.log(`     D1 (a): first ${c0.verdict}; after the break: ${end.now?.verdict} (${end.now?.lines?.[0] ?? ''}); notes ${notes.length}; a check now: ${truth.verdict}`)
    assert.equal(c0.verdict, 'ok')
    assert.equal(truth.verdict, 'error')
    assert.equal(end.now?.verdict, 'error', 'the verdict of the code before stuck to the broken code')
    assert.ok(notes.some((t) => /v2 is broken/.test(t)), `the broken code's note: ${JSON.stringify(notes)}`)
  }

  if (part('D1b')) {
    // (Each part on a project of its own: its film under the playhead, the only one.)
    await lib.reset(c)
    // (b) a check asked right after a save, while the check of the code before runs.
    const dir2 = writePage(join(work, 'd1', 'asked'), GOOD('w1'))
    const id2 = await importFilm(c, dir2, true)
    await waitState(c, id2, 30000)
    await check(c, id2)
    writeFileSync(join(dir2, 'index.html'), GOOD('w1b'))
    await c.waitFor('the check of w1b runs', async () => (await verdictNow(c, id2)).act.checking, 20000)
    await sleep(1500)
    writeFileSync(join(dir2, 'index.html'), BROKEN)
    await sleep(600)
    const asked = await check(c, id2)
    R.D1b = asked
    console.log(`     D1 (b): a check asked 0.6 s after the save, while the one before ran: ${asked.verdict} (${asked.lines[0] ?? ''})`)
    assert.equal(asked.verdict, 'error', `the answer was of the code before: ${JSON.stringify(asked)}`)
    await untilQuiet(c, id2)
  }

  if (part('D5')) {
    await lib.reset(c)
    const dir = join(work, 'd5', 'heavy')
    cpSync(FILM.heavy, dir, { recursive: true })
    const page = join(dir, 'index.html')
    const orig = readFileSync(page, 'utf8')
    const id = await importFilm(c, dir, true)
    const ws = await waitState(c, id, 60000)
    assert.equal(ws.state, 'ready', JSON.stringify(ws))
    const quiet = await check(c, id)
    console.log(`     D5: the quiet film: ${quiet.verdict} (${quiet.lines[0] ?? ''}) in ${quiet.ms} ms`)
    R.D5 = { quiet }
    for (const [label, gap] of [['2 s', 2000], ['200 ms', 200]]) {
      await c.ev(`void (async () => { const [films] = await window.__codeFilm(); window.__d5log = []; const t0 = performance.now(); let last = ''; clearInterval(window.__d5t); window.__d5t = setInterval(() => { const st = films.codeFilms.status(${JSON.stringify(id)}); const act = films.codeFilms.activity(${JSON.stringify(id)}); const v = films.codeFilms.verdict(${JSON.stringify(id)}); const k = (st && st.state) + '|' + act.checking + '|' + (v && v.verdict) + '|' + (v && v.lines && v.lines[0]); if (k !== last) { last = k; window.__d5log.push(Math.round(performance.now() - t0) + ' ' + k) } }, 50) })(); 0`)
      for (let i = 0; i < 10; i++) {
        appendFileSync(page, `<!--ef ${label} ${i}-->\n`)
        await sleep(gap)
      }
      const took = await untilQuiet(c, id)
      const v = await verdictNow(c, id)
      const notes = await fixNotes(c)
      R.D5[label] = { took, verdict: v.now, notes }
      console.log('     D5 log: ' + JSON.stringify(await c.ev('window.__d5log')))
      console.log(`     D5: 10 saves ${label} apart: ${v.now?.verdict} (${v.now?.lines?.[0] ?? ''}); settled in ${took} ms; open fix notes ${notes.length}`)
      assert.ok(took >= 0, 'the checks never settled')
      assert.ok(!(v.now?.lines ?? []).some((l) => /not ready in/.test(l)), `a heavy film's quick saves made "${v.now?.lines?.[0]}"`)
      assert.equal(v.now?.verdict, quiet.verdict, 'the verdict after the saves is the quiet film\'s')
      assert.ok(!notes.some((t) => /not ready in/.test(t)), 'no "not ready" note')
    }
    writeFileSync(page, orig)
  }

  if (part('D3')) {
    // A saved project; a film folder of the user's elsewhere whose parent is
    // named anim gets no versions; the project's own anim\<name> does.
    await lib.reset(c)
    const projDir = join(work, 'd3', 'proj')
    mkdirSync(projDir, { recursive: true })
    const file = join(projDir, 'd3.snipp')
    lib.answer(app, { kind: 'save', path: file })
    await c.click('timeline.scroll', { fx: 0.95, fy: 0.97 })
    await c.key('s', ['ctrl'])
    await c.waitFor('saved', async () => existsSync(file), 10000)
    const vers = (d) => (existsSync(join(d, '.surumler')) ? readdirSync(join(d, '.surumler')).length : 0)
    const user = writePage(join(work, 'd3', 'userfilms', 'anim', 'myfilm'), SMALL(0))
    const own = (await task(c, (p) => window.api.codeFilm.makeAnim(p, 'intro'), file)).folder
    writeFileSync(join(own, 'index.html'), SMALL(0))
    for (const d of [user, own]) await waitState(c, await importFilm(c, d, true), 30000)
    for (let i = 1; i <= 2; i++) {
      writeFileSync(join(user, 'index.html'), SMALL(i))
      writeFileSync(join(own, 'index.html'), SMALL(i))
      await sleep(2800)
    }
    await sleep(1500)
    R.D3 = { user: { folder: user, surumler: existsSync(join(user, '.surumler')) }, own: vers(own) }
    console.log(`     D3: the user's …\\anim\\myfilm outside the project: .surumler ${R.D3.user.surumler ? 'written' : 'none'}; the project's own anim\\intro: ${R.D3.own} versions`)
    assert.equal(R.D3.user.surumler, false, 'nothing is written into a folder of the user\'s')
    assert.ok(R.D3.own >= 1, 'the project\'s own folder keeps versions')
  }

  if (part('O1')) {
    // The template auditor's 1a pages: their own renderOut, no canvas, nothing
    // shown at the middle moment the fast path's probe looked at.
    await lib.reset(c)
    const head = '<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;background:transparent;overflow:hidden}</style></head><body>'
    const O1 = {
      'd-midgone': head + `<div id="t" style="position:absolute;left:40px;top:260px;color:#fff;font:bold 60px sans-serif;background:#0060c0;padding:6px;opacity:0">Lower third</div><script>
window.__config={"width":640,"height":360,"duration":6};
window.renderOut=t=>{const k=t<0.3?t/0.3:t<1.5?1:t<1.8?(1.8-t)/0.3:0;document.getElementById('t').style.opacity=k};
window.READY=true;</script></body></html>`,
      'd-noconfig-late': head + `<div id="t" style="position:absolute;left:40px;top:40px;color:#fff;font:bold 60px sans-serif;opacity:0">Appears at 2 s</div><script>
window.renderOut=t=>{document.getElementById('t').style.opacity=t>=2?1:0};
window.READY=true;</script></body></html>`
    }
    R.O1 = {}
    for (const [k, html] of Object.entries(O1)) {
      const id = await importFilm(c, writePage(join(work, 'o1', k), html), true)
      const st = await waitState(c, id, 60000)
      const v = await check(c, id)
      R.O1[k] = { mode: st.mode, verdict: v.verdict, line: v.lines[0] ?? '' }
      console.log(`     O1 ${k}: mode ${st.mode}, verdict ${v.verdict} ${v.lines[0] ?? ''}`)
      assert.equal(st.mode, 'page', `${k}: drawn whole`)
      assert.equal(v.verdict, 'ok', `${k}: ${JSON.stringify(v)}`)
    }
  }

  if (part('D8a')) {
    // The checker auditor's p1 pages that draw right: a CDN address (refused,
    // the network is closed) with a local copy, and one console.error at
    // load. Their lines stay as facts; the verdict is "ok". A page that
    // throws in every frame stays "error".
    await lib.reset(c)
    const fast = (body, head = '') => `<!doctype html><html><head><meta charset="utf-8">${head}<style>html,body{margin:0;background:transparent}</style></head><body><canvas id="c" width="1280" height="720"></canvas><script>
var g=document.getElementById('c').getContext('2d');
window.__config={width:1280,height:720,fps:30,duration:10};
${body}
window.READY=true;
</script></body></html>`
    const BOX = `function box(t){ g.clearRect(0,0,1280,720); g.fillStyle='#e33'; g.fillRect(100+t*80,300,200,120) }`
    const pages = {
      'console-error': [fast(`${BOX}; console.error('deprecated option, ignored'); window.renderOut=function(t){ box(t) }`), 'ok', /console\.error: deprecated option/],
      'cdn-fallback': [fast(`${BOX}; window.renderOut=function(t){ if(!window.LIB) throw new Error('no lib'); box(t) }`, `<script src="https://cdn.jsdelivr.net/npm/somelib@1.0.0/lib.min.js"></script><script>window.LIB||document.write('<script src="lib.js"><\\/script>')</script>`), 'ok', /blocked: https:\/\/cdn\.jsdelivr\.net/, { 'lib.js': 'window.LIB=1' }],
      'throws': [fast(`${BOX}; window.renderOut=function(t){ throw new Error('broke at ' + t) }`), 'error', /broke at/]
    }
    R.D8a = {}
    for (const [k, [html, want, line, extra]] of Object.entries(pages)) {
      const dir = writePage(join(work, 'd8a', k), html)
      for (const [f, s] of Object.entries(extra ?? {})) writeFileSync(join(dir, f), s)
      const id = await importFilm(c, dir, true)
      await waitState(c, id, 30000)
      const v = await check(c, id)
      R.D8a[k] = v
      console.log(`     D8a ${k}: ${v.verdict} — ${v.lines.join(' | ').slice(0, 200)}`)
      assert.equal(v.verdict, want, `${k}: ${JSON.stringify(v)}`)
      assert.ok(v.lines.some((l) => line.test(l)), `${k}: the line is kept as a fact: ${JSON.stringify(v.lines)}`)
    }
  }

  if (part('D6a')) {
    // The test material's two films (copies): why the checker says what it says.
    // portrait: the same page drawing the same moment again differs (its own
    // unseeded grain) → "unstable" stays. heavy: forward it draws without
    // an error; back from 90 % to 30 % its own code throws → "error" stays.
    R.D6a = {}
    for (const n of ['portrait', 'heavy']) {
      await lib.reset(c)
      const dir = join(work, 'd6a', n)
      cpSync(FILM[n], dir, { recursive: true })
      const id = await importFilm(c, dir, true)
      await waitState(c, id, 90000)
      // Forward, then back, on the live page as it loaded (before the check
      // draws anything); the page's errors counted.
      const walk = await task(
        c,
        async (id) => {
          const [films] = await window.__codeFilm()
          const a = window.__store.getState().project.assets.find((x) => x.id === id)
          const d = a.duration || 10
          const out = []
          for (const f of [0.1, 0.5, 0.9, 0.3]) {
            let err = null
            try {
              const b = await films.codeFilms.exactFrame(a, d * f, undefined, 160)
              b?.close?.()
            } catch (e) {
              err = String(e?.message ?? e).slice(0, 120)
            }
            const st = films.codeFilms.status(id)
            out.push({ at: Math.round(d * f * 100) / 100, errors: st?.runErrors ?? 0, err })
          }
          return out
        },
        id
      )
      const v = await check(c, id)
      R.D6a[n] = { verdict: v.verdict, lines: v.lines, walk }
      console.log(`     D6a ${n}: ${v.verdict} — ${v.lines[0] ?? ''}; forward then back: ${walk.map((w) => `${w.at} s errors ${w.errors}${w.err ? ' (' + w.err + ')' : ''}`).join(', ')}`)
    }
    assert.equal(R.D6a.portrait.verdict, 'unstable')
    assert.ok(R.D6a.portrait.lines.some((l) => /drawn again differs/.test(l)), 'portrait: the same page draws the same moment otherwise')
    assert.equal(R.D6a.heavy.verdict, 'error')
    assert.match(R.D6a.heavy.lines[0], /position/)
  }

  // (Last: it starts the app again.)
  if (part('D4')) {
    // A saved project with a code clip's folder; the app started again on
    // the same profile and the project opened: an agent's saves of that
    // folder are kept as versions before the Inspector shows the clip.
    await lib.reset(c)
    const projDir = join(work, 'd4', 'proj')
    mkdirSync(projDir, { recursive: true })
    const file = join(projDir, 'd4.snipp')
    lib.answer(app, { kind: 'save', path: file })
    await c.click('timeline.scroll', { fx: 0.95, fy: 0.97 })
    await c.key('s', ['ctrl'])
    await c.waitFor('saved', async () => existsSync(file), 10000)
    const vers = (d) => (existsSync(join(d, '.surumler')) ? readdirSync(join(d, '.surumler')).length : 0)
    const folder = (await task(c, (p) => window.api.codeFilm.makeAnim(p, 'intro'), file)).folder
    writeFileSync(join(folder, 'index.html'), SMALL(0))
    await waitState(c, await importFilm(c, folder, true), 30000)
    await c.key('s', ['ctrl'])
    await c.waitFor('saved with its film', async () => !(await c.st((s) => s.dirty)), 10000)
    writeFileSync(join(folder, 'index.html'), SMALL(1))
    await sleep(3000)
    const before = vers(folder)
    const app2 = await relaunch({ profile: app.profile })
    const c2 = app2.cdp
    app2.answers.set([{ kind: 'open', paths: [file] }])
    await c2.click('topbar.file')
    await c2.click('menu.file.open')
    await c2.waitFor('the project opened', async () => (await c2.st((s) => s.project.assets.some((a) => a.kind === 'code'))), 20000)
    for (let i = 2; i <= 4; i++) {
      writeFileSync(join(folder, 'index.html'), SMALL(i))
      await sleep(2800)
    }
    await sleep(1000)
    const after = vers(folder)
    R.D4 = { before, after }
    console.log(`     D4: versions ${before} before the new start, ${after} after 3 saves (the Inspector not shown)`)
    assert.ok(before >= 1)
    assert.ok(after >= before + 3, `saves after the new start kept: ${before} → ${after}`)
  }

  writeFileSync(join(work, 'audit-ef.json'), JSON.stringify(R, null, 1))
}
