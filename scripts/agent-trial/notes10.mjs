// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// Real-agent trial of phase 11a (tarifler\FAZ11.md 11a step 4; ANA-PLAN.md §2
// "Ölçüm", the third comparison job: a round of 10 review notes on a code
// film). Claude Code headless on the user's own subscription, measurement only
// (never part of the product). The same model, the same request, the same 10
// notes on the same 20-second film, twice:
//   node scripts/agent-trial/notes10.mjs baseline   without the app: a folder
//        with a copy of the film (film/index.html), notes.md (the 10 notes,
//        each with its time and a frame) and frames/n1.jpg … n10.jpg
//   node scripts/agent-trial/notes10.mjs app        with the app: the film as
//        a code clip in a saved project, the 10 notes as the project's notes,
//        the snipp tools and the file tools
// Each run: its own --mcp-config (--strict-mcp-config), no Bash, --max-turns
// 40, a 3 USD budget, no saved session, one line in testdata\ajan-defteri.jsonl
// (faz "11a"). Afterwards the same checks on both films: one text check per
// note (did the asked change land), and the app's checker on the film.
// --dry: the same harness with a scripted stand-in (no claude, no ledger line).
import { spawn } from 'node:child_process'
import { appendFileSync, cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { launchApp } from '../e2e/app.mjs'
import { TESTDATA } from '../e2e/media.mjs'
import * as lib from '../e2e/lib.mjs'
import { connectAgent } from '../e2e/agent-client.mjs'

const args = Object.fromEntries(process.argv.slice(3).map((a) => { const [k, v] = a.replace(/^--/, '').split('='); return [k, v ?? true] }))
const MODE = process.argv[2]
if (MODE !== 'baseline' && MODE !== 'app') {
  console.error('usage: node scripts/agent-trial/notes10.mjs baseline|app [--dry] [--model=sonnet] [--max-turns=40] [--budget=3] [--label=...]')
  process.exit(2)
}
const DRY = !!args.dry
const MODEL = args.model ?? 'sonnet'
const TURNS = Number(args['max-turns'] ?? 40)
const BUDGET = Number(args.budget ?? 3)
const LEDGER = join(TESTDATA, 'ajan-defteri.jsonl')
const WORK = join(process.env.SNIPP_TRIAL_DIR ?? join(TESTDATA, '..', 'arsiv', 'ajan-denemeleri'), `${new Date().toISOString().replace(/[:.]/g, '-')}-11a-${MODE}${DRY ? '-dry' : ''}`)
mkdirSync(WORK, { recursive: true })

/** The film: 20 s, 1280×720, four scenes, drawn by its own renderOut(t). */
export const FILM = `<!doctype html>
<html><head><meta charset="utf-8"><title>River</title>
<style>html,body{margin:0;background:#000}canvas{display:block}</style></head>
<body><canvas id="c" width="1280" height="720"></canvas>
<script>
var c = document.getElementById('c'), g = c.getContext('2d');
window.__config = { width: 1280, height: 720, fps: 30, duration: 20 };
function ease(x) { return x < 0 ? 0 : x > 1 ? 1 : 1 - Math.pow(1 - x, 3); }
var TITLE = 'How a river is made';
var TITLE_SIZE = 56;
var TITLE_BG = '#0b2a5b';
var BULLETS = ['Rain falls', 'Water gathers', 'It flows downhill'];
var BULLET_GAP = 0.6;
var BARS = [['Spring', 30], ['Summer', 60], ['Autumn', 90]];
var BAR_COLOR = '#3fbf6f';
var OUTRO = 'Thanks for watching';
function title(t) {
  g.fillStyle = TITLE_BG; g.fillRect(0, 0, 1280, 720);
  g.globalAlpha = ease(t / 0.8);
  g.fillStyle = '#ffffff'; g.font = 'bold ' + TITLE_SIZE + 'px sans-serif'; g.textAlign = 'center';
  g.fillText(TITLE, 640, 380);
  g.globalAlpha = 1;
}
function bullets(t) {
  g.fillStyle = '#10151c'; g.fillRect(0, 0, 1280, 720);
  g.font = '44px sans-serif'; g.textAlign = 'left';
  for (var i = 0; i < BULLETS.length; i++) {
    var a = ease((t - 0.3 - i * BULLET_GAP) / 0.5);
    g.globalAlpha = a; g.fillStyle = '#e8eef5';
    g.fillText('• ' + BULLETS[i], 220 + (1 - a) * 40, 260 + i * 100);
  }
  g.globalAlpha = 1;
}
function chart(t) {
  g.fillStyle = '#10151c'; g.fillRect(0, 0, 1280, 720);
  var w = 160, gap = 120, x0 = 640 - (BARS.length * w + (BARS.length - 1) * gap) / 2;
  g.font = '32px sans-serif'; g.textAlign = 'center';
  for (var i = 0; i < BARS.length; i++) {
    var h = BARS[i][1] * 4 * ease((t - i * 0.3) / 1.0);
    var x = x0 + i * (w + gap);
    g.fillStyle = BAR_COLOR; g.fillRect(x, 600 - h, w, h);
    g.fillStyle = '#e8eef5'; g.fillText(BARS[i][0], x + w / 2, 650);
    g.fillText(String(BARS[i][1]), x + w / 2, 590 - h);
  }
}
function outro(t) {
  g.fillStyle = '#000000'; g.fillRect(0, 0, 1280, 720);
  g.globalAlpha = ease(t / 0.8);
  g.fillStyle = '#ffffff'; g.font = 'bold 52px sans-serif'; g.textAlign = 'center';
  g.fillText(OUTRO, 640, 370);
  g.globalAlpha = 1;
}
window.renderOut = function (t) {
  if (t < 4) title(t); else if (t < 10) bullets(t - 4); else if (t < 16) chart(t - 10); else outro(t - 16);
};
window.READY = true;
</script></body></html>
`

/** The 10 notes: [start, end, text, check of the film's code after]. */
export const NOTES = [
  [1, 3, 'Make the title about twice as big.', (s) => { const m = /TITLE_SIZE\s*=\s*(\d+)/.exec(s); return m ? +m[1] >= 90 : /bold (9\d|1\d\d)px/.test(s) }],
  [1, 3, "Typo in the title: it should say 'How a river forms', not 'How a river is made'.", (s) => s.includes('How a river forms') && !s.includes('How a river is made')],
  [0, 4, 'Change the background of the title scene from dark blue to black.', (s) => !s.includes('#0b2a5b')],
  [5, 6, "The first bullet should read 'Rain falls on hills'.", (s) => s.includes('Rain falls on hills')],
  [7, 8, 'The bullets come in too fast: let each one come one second after the one before.', (s) => { const m = /BULLET_GAP\s*=\s*([\d.]+)/.exec(s); return m ? +m[1] >= 0.95 : !/i \* 0\.6/.test(s) }],
  [11, 15, 'The Summer bar should be 45, not 60.', (s) => /\['Summer',\s*45\]|"Summer",\s*45|Summer'?"?\s*[,:]\s*45/.test(s)],
  [11, 15, 'Make the bars orange instead of green.', (s) => !s.includes('#3fbf6f') && /orange|#f[0-9a-f]{2}[0-9a-f]{0,3}|#e[6-9a-f][0-9a-f][0-9a-f]00|rgb\(\s*2[0-5]\d\s*,\s*1[0-9]\d/i.test(s)],
  [12, 13, "Remove the 'Autumn' bar.", (s) => !s.includes('Autumn')],
  [17, 19, "The closing text should say 'See you next time'.", (s) => s.includes('See you next time') && !s.includes('Thanks for watching')],
  [17, 19, "Add a small line under the closing text: 'Made with code'.", (s) => s.includes('Made with code')]
]

const JOB = 'Apply these 10 review notes to the film: change only what each note asks.'
const PROMPT = {
  baseline: `This folder holds film/index.html (a 20-second animated video written as one web page, 1280x720, 30 fps; the page draws second t with window.renderOut(t)), notes.md (10 review notes on it, each with its time range in seconds and a frame, frames/n1.jpg … frames/n10.jpg). ${JOB} Edit film/index.html. Do not render anything.`,
  app: `The video project open in the Snipp editor holds a 20-second code film (one web page); its 10 open notes are review notes on it. Use the snipp tools and edit the film's files. ${JOB} When a note is done, mark it ready with a one-line reply.`
}
const FILE_TOOLS = ['Read', 'Write', 'Edit', 'Glob', 'Grep']
const NPM_EXE = join(process.env.APPDATA ?? '', 'npm', 'node_modules', '@anthropic-ai', 'claude-code', 'bin', 'claude.exe')
const CLAUDE = existsSync(NPM_EXE) ? NPM_EXE : 'claude'

function claude(cwd, prompt, mcpFile, allowed) {
  const argv = ['-p', prompt, '--output-format', 'json', '--model', MODEL, '--max-turns', String(TURNS), '--max-budget-usd', String(BUDGET), '--mcp-config', mcpFile, '--strict-mcp-config', '--setting-sources', 'project', '--no-session-persistence', '--disable-slash-commands', '--allowedTools', ...allowed]
  return new Promise((resolve) => {
    const t0 = Date.now()
    const p = spawn(CLAUDE, argv, { cwd, windowsHide: true, env: process.env, stdio: ['ignore', 'pipe', 'pipe'] })
    let out = '', err = ''
    p.stdout.on('data', (d) => (out += d))
    p.stderr.on('data', (d) => (err += d))
    const timer = setTimeout(() => p.kill(), 30 * 60_000)
    p.on('error', (e) => (err += String(e)))
    p.on('exit', (code) => { clearTimeout(timer); resolve({ code, out, err, ms: Date.now() - t0 }) })
  })
}

function usageOf(r) {
  let j = null
  try { j = JSON.parse(r.out.trim().split('\n').filter(Boolean).pop()) } catch { /* not JSON */ }
  const u = j?.usage ?? {}
  return { turns: j?.num_turns ?? null, tokens: { input: u.input_tokens ?? null, cacheWrite: u.cache_creation_input_tokens ?? null, cacheRead: u.cache_read_input_tokens ?? null, output: u.output_tokens ?? null }, cost: j?.total_cost_usd ?? null, answer: typeof j?.result === 'string' ? j.result.slice(0, 3000) : null, subtype: j?.subtype ?? null, isError: j?.is_error ?? null }
}

function record(entry) {
  if (!DRY) appendFileSync(LEDGER, JSON.stringify(entry) + '\n')
  writeFileSync(join(WORK, 'sonuc.json'), JSON.stringify(entry, null, 1))
  console.log(JSON.stringify({ ...entry, checks: undefined, answer: entry.answer?.slice(0, 300) }, null, 1))
}

/** A code film folder as a clip in the open project; its asset id. */
const importFilm = (c, folder) => c.run(async (folder) => {
  const [, imp] = await window.__codeFilm()
  const info = await window.api.codeFilm.register(folder)
  if (!info) return null
  const a0 = (await imp.codeFilmImport(info)).assets.find((a) => a.kind === 'code')
  const [a] = window.__store.getState().addAssets([a0])
  return (a ?? a0).id
}, folder)

const checkFilm = (c, id) => c.run(async (id) => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
  const [films] = await window.__codeFilm()
  const a = window.__store.getState().project.assets.find((x) => x.id === id)
  films.codeFilms.ensure(a)
  const t0 = performance.now()
  while (performance.now() - t0 < 40000) { const st = films.codeFilms.status(id); if (st?.state === 'ready' || st?.state === 'error') break; films.codeFilms.ensure(a); await sleep(100) }
  try { const r = await films.codeFilms.check(a); return { verdict: r.verdict, lines: r.lines.slice(0, 3).map((x) => x.slice(0, 200)), length: r.length } } catch (e) { return { verdict: 'error', lines: [String(e).slice(0, 200)] } }
}, id)

/** The scripted stand-in of --dry: the 10 changes by text replacement. */
function dryEdit(file) {
  let s = readFileSync(file, 'utf8')
  s = s.replace('TITLE_SIZE = 56', 'TITLE_SIZE = 112').replace('How a river is made', 'How a river forms').replace("'#0b2a5b'", "'#000000'").replace("'Rain falls'", "'Rain falls on hills'").replace('BULLET_GAP = 0.6', 'BULLET_GAP = 1').replace("['Summer', 60]", "['Summer', 45]").replace("'#3fbf6f'", "'#ff8c1a'").replace(", ['Autumn', 90]", '').replace('Thanks for watching', 'See you next time').replace("g.fillText(OUTRO, 640, 370);", "g.fillText(OUTRO, 640, 370); g.font = '28px sans-serif'; g.fillText('Made with code', 640, 430);")
  writeFileSync(file, s)
}

const base = { tarih: new Date().toISOString(), faz: '11a', model: MODEL, maxTurns: TURNS, budgetUsd: BUDGET, label: args.label ?? null }

/** An app window with the film on the timeline of a saved project. */
async function filmProject(folderName) {
  const app = await launchApp()
  await lib.ready(app.cdp)
  const c = app.cdp
  await lib.reset(c)
  await c.waitFor('the agent host', () => c.ev('!!window.__agent'))
  const folder = join(WORK, 'anim', folderName)
  mkdirSync(folder, { recursive: true })
  writeFileSync(join(folder, 'index.html'), FILM)
  const file = join(WORK, 'film.snipp')
  // Saved first: the film folder then lies inside the project's folder.
  lib.answer(app, { kind: 'save', path: file })
  await c.click('timeline.scroll', { fx: 0.95, fy: 0.97 })
  await c.key('s', ['ctrl'])
  await c.waitFor('saved', async () => existsSync(file), 15000)
  const id = await importFilm(c, folder)
  await c.run((id) => { window.__store.getState().addToTimeline(id); return true }, id)
  await c.waitFor('the film on the timeline', async () => (await c.st((s) => Object.keys(s.project.clips).length)) === 1)
  await c.key('s', ['ctrl'])
  await c.waitFor('saved', async () => !(await c.st((s) => s.dirty)), 15000)
  return { app, c, folder, file, id }
}

const checksOf = (src) => NOTES.map(([, , text, ok], i) => ({ n: i + 1, done: !!ok(src), note: text.slice(0, 60) }))

if (MODE === 'baseline') {
  // The frames come from the app (the film in a window of its own).
  const { app, c, folder, id } = await filmProject('film-source')
  const frames = join(WORK, 'frames')
  mkdirSync(frames, { recursive: true })
  try {
    const ag = await connectAgent({ c, app, assert: (await import('node:assert/strict')).default, client: 'frames-for-baseline' })
    for (const [i, [a, b]] of NOTES.entries()) {
      const r = await ag.call('frames', { times: [(a + b) / 2], width: 640 })
      const img = r.result.content.find((x) => x.type === 'image')
      writeFileSync(join(frames, `n${i + 1}.jpg`), Buffer.from(img.data, 'base64'))
    }
    const check0 = await checkFilm(c, id)
    console.log('the film before: ' + check0.verdict)
  } finally {
    await app.close()
  }
  cpSync(folder, join(WORK, 'film'), { recursive: true })
  writeFileSync(join(WORK, 'notes.md'), '# Review notes\n\n' + NOTES.map(([a, b, text], i) => `${i + 1}. ${a}–${b} s (frame: frames/n${i + 1}.jpg): ${text}`).join('\n') + '\n')
  const mcp = join(WORK, 'mcp.json')
  writeFileSync(mcp, JSON.stringify({ mcpServers: {} }))
  let r = { code: 0, out: '', err: '', ms: 0 }
  if (DRY) dryEdit(join(WORK, 'film', 'index.html'))
  else r = await claude(WORK, PROMPT.baseline, mcp, FILE_TOOLS)
  writeFileSync(join(WORK, 'claude-out.json'), r.out)
  if (r.err) writeFileSync(join(WORK, 'claude-err.txt'), r.err)
  const u = usageOf(r)
  const src = readFileSync(join(WORK, 'film', 'index.html'), 'utf8')
  const checks = checksOf(src)
  // The edited film through the app's checker.
  const app2 = await launchApp({ agent: false })
  let verdict = null
  try {
    await lib.ready(app2.cdp)
    await lib.reset(app2.cdp)
    const id2 = await importFilm(app2.cdp, join(WORK, 'film'))
    verdict = id2 ? await checkFilm(app2.cdp, id2) : { verdict: 'error', lines: ['not a film folder'] }
  } finally {
    await app2.close()
  }
  record({ ...base, is: 'kıyas (uygulamasız): 10 notluk düzeltme turu (kod filmi kopyası + notes.md + 10 kare, dosya araçları)', dry: DRY || undefined, exit: r.code, seconds: Math.round(r.ms / 1000), turns: u.turns, tokens: u.tokens, costUsd: u.cost, subtype: u.subtype, isError: u.isError, notesDone: checks.filter((x) => x.done).length, checks, checker: verdict, answer: u.answer, folder: WORK })
} else {
  const { app, c, folder, id } = await filmProject('film')
  try {
    await c.run((notes) => { window.__store.getState().runBatch(notes.map(([start, end, text]) => ({ name: 'note.add', params: { start, end, kind: 'fix', text } }))); return true }, NOTES.map(([a, b, t]) => [a, b, t]))
    await c.key('s', ['ctrl'])
    await c.waitFor('saved', async () => !(await c.st((s) => s.dirty)), 15000)
    await c.run(() => window.__agent.setMode('draft'))
    const { token } = JSON.parse(readFileSync(join(app.profile, 'agent.json'), 'utf8'))
    const mcp = join(WORK, 'mcp.json')
    writeFileSync(mcp, JSON.stringify({ mcpServers: { snipp: { type: 'http', url: `http://127.0.0.1:${app.agentPort}/mcp`, headers: { Authorization: `Bearer ${token}` } } } }))
    let r = { code: 0, out: '', err: '', ms: 0 }
    if (DRY) {
      const ag = await connectAgent({ c, app, assert: (await import('node:assert/strict')).default, client: 'dry-stand-in' })
      await ag.call('notes')
      dryEdit(join(folder, 'index.html'))
      await ag.call('notes', { update: NOTES.map((_, i) => ({ id: i + 1, status: 'ready', reply: 'Done.' })) })
    } else r = await claude(WORK, PROMPT.app, mcp, ['mcp__snipp', ...FILE_TOOLS])
    writeFileSync(mcp, readFileSync(mcp, 'utf8').replace(token, 'REDACTED'))
    writeFileSync(join(WORK, 'claude-out.json'), r.out)
    if (r.err) writeFileSync(join(WORK, 'claude-err.txt'), r.err)
    const u = usageOf(r)
    const events = await c.run(() => window.__agent.store.getState().events.map((e) => ({ tool: e.tool, kind: e.kind, chars: e.chars, tokens: Math.round(e.tokens ?? 0), error: e.error ? e.error.slice(0, 160) : undefined })))
    const draft = await c.run(() => !!window.__agent.draft())
    let accepted = null
    if (draft) accepted = await c.run(async () => { const o = await window.__agent.accept(); return { applied: o?.applied?.length ?? 0, dropped: (o?.dropped ?? []).map((x) => x.reason) } })
    const notes = await c.st((s) => s.project.notes.map((n) => ({ status: n.status, reply: (n.reply ?? '').slice(0, 80) })))
    // The film's code: where the clip's film is now.
    const src = readFileSync(join(folder, 'index.html'), 'utf8')
    const checks = checksOf(src)
    await c.sleep(1500)
    const verdict = await checkFilm(c, id)
    record({ ...base, is: 'uygulamayla: 10 notluk düzeltme turu (kod filmi klibi + 10 proje notu, MCP araçları + dosya araçları)', dry: DRY || undefined, exit: r.code, seconds: Math.round(r.ms / 1000), turns: u.turns, tokens: u.tokens, costUsd: u.cost, subtype: u.subtype, isError: u.isError, notesDone: checks.filter((x) => x.done).length, notesReady: notes.filter((n) => n.status === 'ready').length, checks, checker: verdict, draft, accepted, appCalls: events, answer: u.answer, folder: WORK })
    await c.run(() => window.__store.getState().setDirty(false))
  } finally {
    await app.close()
  }
}
