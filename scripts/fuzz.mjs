// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// The full oracle run (SnippStudio phase 4A.9, A8): 3 000 random sequences of
// agent and user steps (and 1 000 each of the agent alone, of the command
// layer alone, and of several agents), in shards, each its own process.
// `npm run fuzz` (-- --n=3000 --shards=8 --only=full|agent|pure|two|keep|wild). Results:
// ..\testdata\fuzz-sonuc\last.json. Exit code 1 when any sequence has a
// violation, a must-stay-alive op was dropped, or the agent alone lost an op.
import { spawn, spawnSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { cpus } from 'node:os'
import { join } from 'node:path'

const arg = (name, fallback) => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`))
  return hit ? hit.slice(name.length + 3) : fallback
}
const N = Number(arg('n', 3000))
const SHARDS = Number(arg('shards', Math.max(2, Math.min(8, cpus().length - 1))))
const only = arg('only', '')
const from = Number(arg('from', 1))

const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx'
const tsc = spawnSync(npx, ['tsc', '-p', 'tsconfig.test.json'], { stdio: 'inherit', shell: process.platform === 'win32' })
if (tsc.status !== 0) process.exit(tsc.status ?? 1)
writeFileSync(join('out-test', 'package.json'), JSON.stringify({ type: 'commonjs' }) + '\n')

const ALWAYS_ALIVE = ['none', 'cut', 'undo', 'redo', 'split', 'move', 'trim', 'delete', 'add', 'mark', 'note', 'prop', 'capText']

function shard(kind, start, count) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [join('out-test', 'test', 'oracle', 'shard.js'), String(start), String(count), kind], { stdio: ['ignore', 'pipe', 'inherit'] })
    let out = ''
    child.stdout.on('data', (d) => (out += d))
    child.on('close', (code) => {
      try {
        resolve(JSON.parse(out.trim().split('\n').pop()))
      } catch {
        reject(new Error(`shard ${kind} ${start} failed (exit ${code}): ${out.slice(-400)}`))
      }
    })
  })
}

async function run(kind, total) {
  const per = Math.ceil(total / SHARDS)
  const t0 = Date.now()
  const parts = await Promise.all(Array.from({ length: SHARDS }, (_, i) => shard(kind, from + i * per, Math.min(per, total - i * per))).filter(Boolean))
  const sum = { kind, sequences: 0, steps: 0, failing: 0, byKind: {}, liveness: {}, agentDrops: {}, structural: { ops: 0, dropped: 0 }, exempt: {}, judged: { content: 0, literal: 0 }, framed: 0, firstFailures: [], cases: [], wallMs: Date.now() - t0 }
  for (const p of parts) {
    const t = p.tally
    sum.sequences += t.sequences
    sum.steps += t.steps
    sum.failing += t.failing
    for (const [k, v] of Object.entries(t.byKind)) sum.byKind[k] = (sum.byKind[k] ?? 0) + v
    for (const [k, v] of Object.entries(t.agentDrops)) sum.agentDrops[k] = (sum.agentDrops[k] ?? 0) + v
    for (const [k, v] of Object.entries(t.exempt ?? {})) sum.exempt[k] = (sum.exempt[k] ?? 0) + v
    sum.judged.content += t.judged?.content ?? 0
    sum.judged.literal += t.judged?.literal ?? 0
    sum.framed += t.framed ?? 0
    if (t.mix) {
      sum.mix ??= { high: 0, curve: 0, keptCut: 0, all: 0 }
      for (const k of Object.keys(sum.mix)) sum.mix[k] += t.mix[k] ?? 0
    }
    for (const [k, v] of Object.entries(t.liveness)) {
      const row = (sum.liveness[k] ??= { ops: 0, dropped: 0 })
      row.ops += v.ops
      row.dropped += v.dropped
    }
    sum.structural.ops += t.structural.ops
    sum.structural.dropped += t.structural.dropped
    sum.firstFailures.push(...t.firstFailures)
    sum.liveDrops = [...(sum.liveDrops ?? []), ...(t.liveDrops ?? [])]
    sum.cases.push(...p.cases)
  }
  // Per kind of user change: the classes alone, and every mix under "mixed".
  const alone = {}
  const mixed = { ops: 0, dropped: 0 }
  for (const [k, v] of Object.entries(sum.liveness)) {
    if (k.includes('+')) {
      mixed.ops += v.ops
      mixed.dropped += v.dropped
    } else alone[k] = v
  }
  sum.livenessAlone = alone
  sum.livenessMixed = mixed
  sum.livenessBreaks = Object.entries(sum.liveness)
    .filter(([k, v]) => v.dropped > 0 && k.split('+').every((c) => ALWAYS_ALIVE.includes(c)))
    .map(([classes, v]) => ({ classes, ...v }))
  return sum
}

// (two: several agents — two sessions of one program and another program —
// with the user switching between draft and direct: phase 4A.10, F8.)
const plan = [
  ['pure', Math.ceil(N / 3)],
  ['agent', Math.ceil(N / 3)],
  ['full', N],
  ['two', Math.max(Math.ceil(N / 3), Number(arg('two', 0)))],
  // (keep: the full run with the user's cuts leaving the music bed alone:
  // çekirdek cila S, the ripple's keepTracks.)
  ['keep', Math.ceil(N / 3)],
  // (wild: keep, with the user's voice clips through a high speed (22x –
  // 100x), a curve and kept-bed transcript / silence cuts in one sequence:
  // audit patch yama-c, D5. The subtitle lines are checked in every kind.)
  ['wild', Math.ceil(N / 3)]
].filter(([k]) => !only || k === only)

const results = []
for (const [kind, total] of plan) {
  const r = await run(kind, total)
  results.push(r)
  const drops = Object.values(r.agentDrops).reduce((a, b) => a + b, 0)
  console.log(`${kind}: ${r.sequences} sequences, ${r.steps} steps, ${(r.wallMs / 1000).toFixed(1)} s; failing ${r.failing}; kinds ${JSON.stringify(r.byKind)}`)
  console.log(`  dropped with no user step since the read: ${drops} ${JSON.stringify(r.agentDrops)}; structural ${r.structural.dropped}/${r.structural.ops} dropped`)
  const all = r.judged.content + r.judged.literal
  console.log(`  applied ops judged in full ${r.judged.content}, for their context only (literal) ${r.judged.literal} (${all ? ((100 * r.judged.literal) / all).toFixed(1) : 0} %), not judged 0; drops that are no loss by the oracle's own reckoning ${JSON.stringify(r.exempt)}`)
  if (r.mix) console.log(`  user's high speed (>= 22x) ${r.mix.high}, curve ${r.mix.curve}, kept-bed cut ${r.mix.keptCut}, all three in one sequence ${r.mix.all} (of ${r.sequences})`)
  if (kind === 'full' || kind === 'two' || kind === 'keep' || kind === 'wild') {
    console.log('  liveness (cut and placement ops whose content is still there; dropped / ops):')
    for (const [k, v] of Object.entries(r.livenessAlone).sort()) console.log(`    ${k}: ${v.dropped} / ${v.ops}`)
    console.log(`    (mixes): ${r.livenessMixed.dropped} / ${r.livenessMixed.ops}`)
    console.log(`  must-stay-alive breaks: ${JSON.stringify(r.livenessBreaks)}`)
    for (const b of r.livenessBreaks) for (const d of (r.liveDrops ?? []).filter((x) => x.classes === b.classes)) console.log(`    break: ${JSON.stringify(d)}`)
  }
  for (const c of r.cases.slice(0, 3)) console.log(`  case: ${JSON.stringify(c)}`)
}

const dir = join('..', 'testdata', 'fuzz-sonuc')
mkdirSync(dir, { recursive: true })
writeFileSync(join(dir, 'last.json'), JSON.stringify({ at: new Date().toISOString(), n: N, shards: SHARDS, results }, null, 1))
const bad = results.some((r) => r.failing > 0 || (r.livenessBreaks?.length ?? 0) > 0 || ((r.kind === 'pure' || r.kind === 'agent') && Object.keys(r.agentDrops).length > 0))
process.exit(bad && !process.argv.includes('--report') ? 1 : 0)
