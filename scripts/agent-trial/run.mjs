// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// Real-agent trials (SnippStudio phase 4B.6; ANA-PLAN.md §2 "Ölçüm"): Claude
// Code headless (`claude -p --output-format json`) on the user's own
// subscription — measurement only, never part of the product. Each run has
// its own MCP config (--strict-mcp-config: the user's own servers and global
// settings are not used and never written), a turn and a budget limit, no
// saved session, and its usage written to testdata\ajan-defteri.jsonl.
//
//   node scripts/agent-trial/run.mjs baseline   the job without the app: the
//        10-minute talk, its word-timed transcript and ffmpeg in an empty folder
//   node scripts/agent-trial/run.mjs app        the same job through the app's
//        tools (the app off-screen with its own profile); the draft accepted
//        by this script
// Both judged against the talk's truth (words wrongly cut, retakes missed).
// Options: --model=<alias> (default sonnet), --max-turns=<n> (default 40),
// --budget=<usd> (default 3), --label=<text>.
import { spawn } from 'node:child_process'
import { appendFileSync, copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { launchApp } from '../e2e/app.mjs'
import { TESTDATA } from '../e2e/media.mjs'
import * as lib from '../e2e/lib.mjs'
import { captionsFor, judgeRoughCut, keptSource, loadTalk, truthOf, HAM } from '../e2e/talk.mjs'

const args = Object.fromEntries(process.argv.slice(3).map((a) => { const [k, v] = a.replace(/^--/, '').split('='); return [k, v ?? true] }))
const MODE = process.argv[2]
if (MODE !== 'baseline' && MODE !== 'app') {
  console.error('usage: node scripts/agent-trial/run.mjs baseline|app [--model=sonnet] [--max-turns=40] [--budget=3]')
  process.exit(2)
}
const MODEL = args.model ?? 'sonnet'
const TURNS = Number(args['max-turns'] ?? 40)
const BUDGET = Number(args.budget ?? 3)
const TALK = 'ham-10dk-tr'
const LEDGER = join(TESTDATA, 'ajan-defteri.jsonl')
const WORK = join(process.env.SNIPP_TRIAL_DIR ?? join(TESTDATA, '..', 'arsiv', 'ajan-denemeleri'), `${new Date().toISOString().replace(/[:.]/g, '-')}-${MODE}`)
mkdirSync(WORK, { recursive: true })
process.env.PATH = `C:\\ffmpeg\\bin;${process.env.PATH}`

// The same request both times: only where the material is differs.
const JOB = 'Remove the silences, the retakes (where a sentence is said again, the earlier take goes) and the filler words. Then propose 3–5 chapter titles, each with its start in seconds, in your answer.'
const PROMPT = {
  baseline: `This folder holds talk.mp4 (a 10-minute talk in Turkish) and transcript.json (its word-timed transcript: lines, each with its words as [word, start, end] in seconds). ffmpeg is installed. ${JOB} Write the ranges to KEEP to cuts.json as {"keep": [[start, end], ...]} in seconds of talk.mp4.`,
  app: `The video project open in the Snipp editor holds a 10-minute talk in Turkish with word-timed subtitles. Use the snipp tools. ${JOB} Leave the edit as a draft for the user.`
}

function claude(cwd, prompt, mcpFile, allowed) {
  const argv = ['-p', prompt, '--output-format', 'json', '--model', MODEL, '--max-turns', String(TURNS), '--max-budget-usd', String(BUDGET), '--mcp-config', mcpFile, '--strict-mcp-config', '--setting-sources', 'project', '--no-session-persistence', '--disable-slash-commands', '--allowedTools', ...allowed]
  return new Promise((resolve) => {
    const t0 = Date.now()
    const p = spawn(CLAUDE, argv, { cwd, windowsHide: true, env: process.env, stdio: ['ignore', 'pipe', 'pipe'] })
    let out = ''
    let err = ''
    p.stdout.on('data', (d) => (out += d))
    p.stderr.on('data', (d) => (err += d))
    const timer = setTimeout(() => p.kill(), 30 * 60_000)
    p.on('exit', (code) => {
      clearTimeout(timer)
      resolve({ code, out, err, ms: Date.now() - t0 })
    })
  })
}
// The program behind npm's claude.cmd, started without a shell (no quoting).
const NPM_EXE = join(process.env.APPDATA ?? '', 'npm', 'node_modules', '@anthropic-ai', 'claude-code', 'bin', 'claude.exe')
const CLAUDE = existsSync(NPM_EXE) ? NPM_EXE : 'claude'
const q = (s) => s

function record(entry) {
  appendFileSync(LEDGER, JSON.stringify(entry) + '\n')
  writeFileSync(join(WORK, 'sonuc.json'), JSON.stringify(entry, null, 1))
  console.log(JSON.stringify(entry, null, 1))
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
    json: j,
    turns: j?.num_turns ?? null,
    tokens: { input: u.input_tokens ?? null, cacheWrite: u.cache_creation_input_tokens ?? null, cacheRead: u.cache_read_input_tokens ?? null, output: u.output_tokens ?? null },
    cost: j?.total_cost_usd ?? null,
    modelUsage: j?.modelUsage ?? null,
    answer: typeof j?.result === 'string' ? j.result.slice(0, 4000) : null,
    subtype: j?.subtype ?? null,
    isError: j?.is_error ?? null
  }
}

const truth = truthOf(TALK)
const base = { tarih: new Date().toISOString(), faz: '4B.6', model: MODEL, maxTurns: TURNS, budgetUsd: BUDGET, label: args.label ?? null }

if (MODE === 'baseline') {
  // The material: the video and the transcript the app also has (the .srt's
  // lines, the truth's word times), nothing else.
  copyFileSync(join(HAM, `${TALK}.mp4`), join(WORK, 'talk.mp4'))
  const lines = captionsFor(TALK).map((l) => ({ start: l.start, end: l.end, text: l.text, words: l.words.map((w) => [w.text, w.start, w.end]) }))
  writeFileSync(join(WORK, 'transcript.json'), JSON.stringify({ lines }))
  const mcp = join(WORK, '..', `${MODE}-mcp.json`)
  writeFileSync(mcp, JSON.stringify({ mcpServers: {} }))
  const allowed = ['Read', 'Write', 'Edit', 'Glob', 'Grep', 'Bash(ffmpeg:*)', 'Bash(ffprobe:*)', 'Bash(node:*)', 'Bash(python:*)', 'Bash(python3:*)', 'Bash(ls:*)', 'Bash(dir:*)']
  const r = await claude(WORK, q(PROMPT.baseline), q(mcp), allowed.map(q))
  writeFileSync(join(WORK, 'claude-out.json'), r.out)
  if (r.err) writeFileSync(join(WORK, 'claude-err.txt'), r.err)
  const u = usageOf(r)
  let judged = null
  try {
    const keep = JSON.parse(readFileSync(join(WORK, 'cuts.json'), 'utf8')).keep
    judged = judgeRoughCut(truth, keep)
  } catch (e) {
    judged = { error: `no usable cuts.json: ${e.message}` }
  }
  rmSync(join(WORK, 'talk.mp4'), { force: true })
  record({ ...base, is: 'kıyas (uygulamasız): 10 dk kaba kurgu + bölüm başlıkları', exit: r.code, seconds: Math.round(r.ms / 1000), turns: u.turns, tokens: u.tokens, costUsd: u.cost, subtype: u.subtype, isError: u.isError, result: judged, answer: u.answer, folder: WORK })
} else {
  const app = await launchApp()
  try {
    await lib.ready(app.cdp)
    const c = app.cdp
    await lib.reset(c)
    await c.waitFor('the agent host', () => c.ev('!!window.__agent'))
    await loadTalk({ c, app, lib, name: TALK })
    await c.run(() => window.__agent.setMode('draft'))
    const { token } = JSON.parse(readFileSync(join(app.profile, 'agent.json'), 'utf8'))
    const mcp = join(WORK, '..', `${MODE}-mcp.json`)
    writeFileSync(mcp, JSON.stringify({ mcpServers: { snipp: { type: 'http', url: `http://127.0.0.1:${app.agentPort}/mcp`, headers: { Authorization: `Bearer ${token}` } } } }))
    const r = await claude(WORK, q(PROMPT.app), q(mcp), [q('mcp__snipp')])
    writeFileSync(join(WORK, 'claude-out.json'), r.out)
    if (r.err) writeFileSync(join(WORK, 'claude-err.txt'), r.err)
    const u = usageOf(r)
    // What the app counted: its tool calls and their estimated tokens.
    const events = await c.run(() => window.__agent.store.getState().events.map((e) => ({ tool: e.tool, kind: e.kind, chars: e.chars, tokens: Math.round(e.tokens ?? 0), error: e.error ? e.error.slice(0, 120) : undefined })))
    const defs = await c.run(() => Object.values(window.__agent.store.getState().sessions).map((s) => s.defsTokens))
    // The script accepts the draft (as the user would), then judges what is left.
    const draft = await c.run(() => !!window.__agent.draft())
    let judged = null
    if (draft) {
      await c.run(() => window.__agent.accept())
      judged = judgeRoughCut(truth, keptSource(await c.st((s) => s.project)))
    } else judged = { error: 'no draft' }
    record({ ...base, is: 'uygulamayla: 10 dk kaba kurgu + bölüm başlıkları (MCP araçları, taslağı betik kabul etti)', exit: r.code, seconds: Math.round(r.ms / 1000), turns: u.turns, tokens: u.tokens, costUsd: u.cost, subtype: u.subtype, isError: u.isError, result: judged, appCalls: events, appDefsTokens: defs, answer: u.answer, folder: WORK })
  } finally {
    await app.close()
  }
}
void fileURLToPath
