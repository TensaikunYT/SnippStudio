// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// Real-agent trial of phase 5f (tarifler\FAZ5.md 5f, decisions 5–6;
// ANA-PLAN.md §2 "Ölçüm": "5 bindirme animasyonu"): Claude Code headless on
// the user's own subscription, measurement only (never part of the product).
// The same model, the same request sentence, the same 5 ranges of the
// 10-minute talk, twice:
//   node scripts/agent-trial/anim.mjs baseline   without the app: an empty
//        folder with the talk's word-timed transcript, the 5 ranges and one
//        frame of each; the pages it writes are afterwards run through the
//        app's checker (no agent then)
//   node scripts/agent-trial/anim.mjs app        with the app: the talk in a
//        saved project, the 5 ranges as its 5 notes, the snipp tools; the
//        draft accepted by this script, then every code clip checked
// Each run: its own --mcp-config (--strict-mcp-config), no Bash (file tools
// only: nothing outside its folder is run), --max-turns 40, a 3 USD budget,
// no saved session, one line in testdata\ajan-defteri.jsonl (faz "5f").
// --dry: the same harness with no claude at all (a scripted stand-in writes
// the pages), for checking the harness; written to the run's folder only.
import { spawn, spawnSync } from 'node:child_process'
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { launchApp } from '../e2e/app.mjs'
import { TESTDATA } from '../e2e/media.mjs'
import * as lib from '../e2e/lib.mjs'
import { captionsFor, HAM, loadTalk } from '../e2e/talk.mjs'
import { connectAgent } from '../e2e/agent-client.mjs'

const args = Object.fromEntries(process.argv.slice(3).map((a) => { const [k, v] = a.replace(/^--/, '').split('='); return [k, v ?? true] }))
const MODE = process.argv[2]
if (MODE !== 'baseline' && MODE !== 'app') {
  console.error('usage: node scripts/agent-trial/anim.mjs baseline|app [--dry] [--model=sonnet] [--max-turns=40] [--budget=3] [--label=...]')
  process.exit(2)
}
const DRY = !!args.dry
const MODEL = args.model ?? 'sonnet'
const TURNS = Number(args['max-turns'] ?? 40)
const BUDGET = Number(args.budget ?? 3)
const TALK = 'ham-10dk-tr'
const LEDGER = join(TESTDATA, 'ajan-defteri.jsonl')
const WORK = join(process.env.SNIPP_TRIAL_DIR ?? join(TESTDATA, '..', 'arsiv', 'ajan-denemeleri'), `${new Date().toISOString().replace(/[:.]/g, '-')}-5f-${MODE}${DRY ? '-dry' : ''}`)
mkdirSync(WORK, { recursive: true })
process.env.PATH = `C:\\ffmpeg\\bin;${process.env.PATH}`

/** The 5 ranges (s of the talk): a date, a count, a short time, a number of people, a distance. */
const RANGES = [[0, 5.8], [43.1, 46.7], [167.9, 173.1], [332.6, 336.7], [536.5, 541.0]]
/** The talk's own size and rate (what the app's project also has). */
const OUT = { width: 1920, height: 1080, fps: 24 }

// The same request both times: only where the material is differs.
const JOB = 'For each of these 5 ranges, write one HTML animation with a transparent background to go over the talk. Do not render anything.'
const PROMPT = {
  baseline: `This folder holds transcript.json (a 10-minute talk in Turkish, word-timed: lines, each with its words as [word, start, end] in seconds), ranges.json (5 ranges of the talk, [start, end] in seconds) and frames/r1.png … frames/r5.png (one frame of the talk's video in each range). The video is ${OUT.width}x${OUT.height}, ${OUT.fps} fps. ${JOB} Write them as anims/r1/index.html … anims/r5/index.html.`,
  app: `The video project open in the Snipp editor holds a 10-minute talk in Turkish with word-timed subtitles; the 5 ranges are its 5 notes. Use the snipp tools. ${JOB} Leave the edit as a draft for the user.`
}
const FILE_TOOLS = ['Read', 'Write', 'Edit', 'Glob', 'Grep']

const NPM_EXE = join(process.env.APPDATA ?? '', 'npm', 'node_modules', '@anthropic-ai', 'claude-code', 'bin', 'claude.exe')
const CLAUDE = existsSync(NPM_EXE) ? NPM_EXE : 'claude'

function claude(cwd, prompt, mcpFile, allowed) {
  const argv = ['-p', prompt, '--output-format', 'json', '--model', MODEL, '--max-turns', String(TURNS), '--max-budget-usd', String(BUDGET), '--mcp-config', mcpFile, '--strict-mcp-config', '--setting-sources', 'project', '--no-session-persistence', '--disable-slash-commands', '--allowedTools', ...allowed]
  return new Promise((resolve) => {
    const t0 = Date.now()
    const p = spawn(CLAUDE, argv, { cwd, windowsHide: true, env: process.env, stdio: ['ignore', 'pipe', 'pipe'] })
    let out = ''
    let err = ''
    p.stdout.on('data', (d) => (out += d))
    p.stderr.on('data', (d) => (err += d))
    const timer = setTimeout(() => p.kill(), 40 * 60_000)
    p.on('error', (e) => (err += String(e)))
    p.on('exit', (code) => {
      clearTimeout(timer)
      resolve({ code, out, err, ms: Date.now() - t0 })
    })
  })
}

function usageOf(r) {
  let j = null
  try {
    j = JSON.parse(r.out.trim().split('\n').filter(Boolean).pop())
  } catch {
    /* not JSON */
  }
  const u = j?.usage ?? {}
  return {
    turns: j?.num_turns ?? null,
    tokens: { input: u.input_tokens ?? null, cacheWrite: u.cache_creation_input_tokens ?? null, cacheRead: u.cache_read_input_tokens ?? null, output: u.output_tokens ?? null },
    cost: j?.total_cost_usd ?? null,
    answer: typeof j?.result === 'string' ? j.result.slice(0, 4000) : null,
    subtype: j?.subtype ?? null,
    isError: j?.is_error ?? null
  }
}

function record(entry) {
  if (!DRY) appendFileSync(LEDGER, JSON.stringify(entry) + '\n')
  writeFileSync(join(WORK, 'sonuc.json'), JSON.stringify(entry, null, 1))
  console.log(JSON.stringify(entry, null, 1))
}

/** The checker on a code film (whole film, or the span a clip shows). */
const checkIn = (c, assetId, span) =>
  c.run(async (id, span) => {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
    const [films] = await window.__codeFilm()
    const a = window.__store.getState().project.assets.find((x) => x.id === id)
    films.codeFilms.ensure(a)
    const t0 = performance.now()
    while (performance.now() - t0 < 40000) {
      const st = films.codeFilms.status(id)
      if (st?.state === 'ready' || st?.state === 'error') break
      films.codeFilms.ensure(a)
      await sleep(100)
    }
    try {
      const r = await films.codeFilms.check(a, span ?? undefined)
      const st = films.codeFilms.status(id)
      return { verdict: r.verdict, lines: r.lines.slice(0, 3).map((x) => x.slice(0, 200)), length: r.length, width: r.width, height: r.height, mode: st?.mode ?? null }
    } catch (e) {
      return { verdict: 'error', lines: [String(e).slice(0, 200)], mode: null }
    }
  }, assetId, span)

/** A simple page, for the dry run's stand-in. */
const DRY_PAGE = (n) => `<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;background:transparent}</style></head><body><canvas id="c" width="1920" height="1080"></canvas><script>
var g=document.getElementById('c').getContext('2d');function f(t){g.clearRect(0,0,1920,1080);g.fillStyle='#ffcc00';g.fillRect(100+t*0.1,800,300,120);g.fillStyle='#fff';g.font='80px sans-serif';g.fillText('range ${n}',140,880);requestAnimationFrame(f)}requestAnimationFrame(f);
</script></body></html>`

const base = { tarih: new Date().toISOString(), faz: '5f', model: MODEL, maxTurns: TURNS, budgetUsd: BUDGET, label: args.label ?? null, ranges: RANGES }

if (MODE === 'baseline') {
  const lines = captionsFor(TALK).map((l) => ({ start: l.start, end: l.end, text: l.text, words: l.words.map((w) => [w.text, w.start, w.end]) }))
  writeFileSync(join(WORK, 'transcript.json'), JSON.stringify({ lines }))
  writeFileSync(join(WORK, 'ranges.json'), JSON.stringify({ ranges: RANGES }))
  mkdirSync(join(WORK, 'frames'), { recursive: true })
  RANGES.forEach(([a, b], i) => {
    const r = spawnSync('ffmpeg', ['-v', 'error', '-y', '-ss', String((a + b) / 2), '-i', join(HAM, `${TALK}.mp4`), '-frames:v', '1', '-vf', 'scale=640:-2', join(WORK, 'frames', `r${i + 1}.png`)])
    if (r.status !== 0) throw new Error(`ffmpeg: ${r.stderr}`)
  })
  const mcp = join(WORK, 'mcp.json')
  writeFileSync(mcp, JSON.stringify({ mcpServers: {} }))
  let r = { code: 0, out: '', err: '', ms: 0 }
  if (DRY) RANGES.forEach((_, i) => { mkdirSync(join(WORK, 'anims', `r${i + 1}`), { recursive: true }); writeFileSync(join(WORK, 'anims', `r${i + 1}`, 'index.html'), DRY_PAGE(i + 1)) })
  else r = await claude(WORK, PROMPT.baseline, mcp, FILE_TOOLS)
  writeFileSync(join(WORK, 'claude-out.json'), r.out)
  if (r.err) writeFileSync(join(WORK, 'claude-err.txt'), r.err)
  const u = usageOf(r)
  // Its pages through the app's checker (no agent: a window of its own).
  const checks = {}
  const dirs = existsSync(join(WORK, 'anims')) ? readdirSync(join(WORK, 'anims')).filter((d) => existsSync(join(WORK, 'anims', d, 'index.html'))) : []
  if (dirs.length) {
    const app = await launchApp({ agent: false })
    try {
      await lib.ready(app.cdp)
      await lib.reset(app.cdp)
      for (const d of dirs) {
        const id = await app.cdp.run(async (folder) => {
          const [, imp] = await window.__codeFilm()
          const info = await window.api.codeFilm.register(folder)
          if (!info) return null
          const a0 = (await imp.codeFilmImport(info)).assets.find((a) => a.kind === 'code')
          const [a] = window.__store.getState().addAssets([a0])
          return (a ?? a0).id
        }, join(WORK, 'anims', d))
        checks[d] = id ? await checkIn(app.cdp, id, null) : { verdict: 'error', lines: ['not a code film folder'] }
        console.log(`  ${d}: ${checks[d].verdict} ${checks[d].lines[0] ?? ''}`)
      }
    } finally {
      await app.close()
    }
  }
  const ok = Object.values(checks).filter((x) => x.verdict === 'ok').length
  record({ ...base, is: 'kıyas (uygulamasız): 5 aralığa saydam HTML animasyonu (konuşma metni + 5 kare, dosya araçları)', dry: DRY || undefined, exit: r.code, seconds: Math.round(r.ms / 1000), turns: u.turns, tokens: u.tokens, costUsd: u.cost, subtype: u.subtype, isError: u.isError, pages: dirs.length, checkerOk: ok, checks, answer: u.answer, folder: WORK })
} else {
  const app = await launchApp()
  try {
    await lib.ready(app.cdp)
    const c = app.cdp
    await lib.reset(c)
    await c.waitFor('the agent host', () => c.ev('!!window.__agent'))
    await loadTalk({ c, app, lib, name: TALK })
    // The 5 ranges as the project's notes (kind "animate", no words of ours).
    await c.run((ranges) => window.__store.getState().runBatch(ranges.map(([start, end]) => ({ name: 'note.add', params: { start, end, kind: 'animate', text: '' } }))), RANGES)
    const settings = await c.st((s) => s.project.settings)
    // Saved (code clips go beside the project file): the app's own Ctrl+S.
    const file = join(WORK, 'talk.snipp')
    lib.answer(app, { kind: 'save', path: file })
    await c.click('timeline.scroll', { fx: 0.95, fy: 0.97 })
    await c.key('s', ['ctrl'])
    await c.waitFor('saved', async () => existsSync(file), 15000)
    await c.run(() => window.__agent.setMode('draft'))
    const { token } = JSON.parse(readFileSync(join(app.profile, 'agent.json'), 'utf8'))
    const mcp = join(WORK, 'mcp.json')
    writeFileSync(mcp, JSON.stringify({ mcpServers: { snipp: { type: 'http', url: `http://127.0.0.1:${app.agentPort}/mcp`, headers: { Authorization: `Bearer ${token}` } } } }))
    let r = { code: 0, out: '', err: '', ms: 0 }
    if (DRY) {
      const ag = await connectAgent({ c, app, assert: (await import('node:assert/strict')).default, client: 'dry-stand-in' })
      for (const [i, [a, b]] of RANGES.entries()) {
        const made = await ag.call('code_clip', { create: { name: `r${i + 1}`, start: a, end: b } })
        const folder = /^Folder: (.+?) \(/.exec(made.text)?.[1]
        writeFileSync(join(folder, 'index.html'), DRY_PAGE(i + 1))
      }
    } else r = await claude(WORK, PROMPT.app, mcp, ['mcp__snipp', ...FILE_TOOLS])
    // (The test profile's token is not kept in the run's folder.)
    writeFileSync(mcp, readFileSync(mcp, 'utf8').replace(token, 'REDACTED'))
    writeFileSync(join(WORK, 'claude-out.json'), r.out)
    if (r.err) writeFileSync(join(WORK, 'claude-err.txt'), r.err)
    const u = usageOf(r)
    const events = await c.run(() => window.__agent.store.getState().events.map((e) => ({ tool: e.tool, kind: e.kind, chars: e.chars, tokens: Math.round(e.tokens ?? 0), error: e.error ? e.error.slice(0, 160) : undefined })))
    const defs = await c.run(() => Object.values(window.__agent.store.getState().sessions).map((s) => s.defsTokens))
    // The script accepts the draft (as the user would).
    const draft = await c.run(() => !!window.__agent.draft())
    let accepted = null
    if (draft) accepted = await c.run(async () => { const o = await window.__agent.accept(); return { applied: o?.applied?.length ?? 0, dropped: (o?.dropped ?? []).map((x) => x.reason) } })
    await c.sleep(1500)
    // Every code clip on the timeline, through the checker (the span it shows).
    const clips = await c.st((s) => Object.values(s.project.clips).filter((k) => s.project.assets.find((a) => a.id === k.assetId)?.kind === 'code').map((k) => ({ id: k.id, assetId: k.assetId, start: k.start, duration: k.duration, inPoint: k.inPoint ?? 0, speed: k.speed ?? 1, path: s.project.assets.find((a) => a.id === k.assetId).path })))
    const checks = {}
    for (const k of clips) {
      checks[k.id] = { ...(await checkIn(c, k.assetId, [k.inPoint, k.inPoint + k.duration * k.speed])), start: +k.start.toFixed(2), end: +(k.start + k.duration).toFixed(2), folder: k.path }
      console.log(`  ${k.id} ${k.path}: ${checks[k.id].verdict} ${checks[k.id].lines[0] ?? ''}`)
    }
    const ok = Object.values(checks).filter((x) => x.verdict === 'ok').length
    // Which range each clip covers (its middle inside the range).
    const covered = RANGES.map(([a, b]) => clips.some((k) => k.start + k.duration / 2 >= a - 0.5 && k.start + k.duration / 2 <= b + 0.5))
    record({ ...base, is: 'uygulamayla: 5 aralığa (5 not) saydam HTML animasyonu (MCP araçları + dosya araçları, taslağı betik kabul etti)', dry: DRY || undefined, settings, exit: r.code, seconds: Math.round(r.ms / 1000), turns: u.turns, tokens: u.tokens, costUsd: u.cost, subtype: u.subtype, isError: u.isError, draft, accepted, codeClips: clips.length, rangesCovered: covered.filter(Boolean).length, checkerOk: ok, checks, appCalls: events, appDefsTokens: defs, answer: u.answer, folder: WORK })
    await c.run(() => window.__store.getState().setDirty(false))
  } finally {
    await app.close()
  }
}
