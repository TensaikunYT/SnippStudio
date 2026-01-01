// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// npm run e2e [-- options]: the end-to-end tests (SnippStudio phase 2B).
//
// The built app is started off-screen with a profile of its own (app.mjs),
// driven over CDP (cdp.mjs) and closed at the end, whatever happens. Each
// scenario (scenarios/*.mjs) starts from a reloaded, empty editor.
//
//   --only=<regex>     scenarios whose name matches
//   (scenarios exporting optIn, the long phase 11 exploration runs, only with
//    --only naming them or SNIPP_KESIF=1)
//   --repeat=<n>       the whole run n times (flakiness check); one window per run
//   --frames           also the reference frames (scripts/qa/reference), compared
//                      byte for byte with testdata\referans\baseline
//   --frames-only      only the reference frames
//   --frames-baseline  write the reference frames as the new baseline (no compare)
//   --ring             the fixed ring (npm run e2e:halka): the scenarios named
//                      security-* and agent-*, then the reference frames. Run at
//                      the acceptance of EVERY merge (22 Nov 2026: three things
//                      were red on studio, a stale security scenario, two
//                      reference sounds and a grab area, and all three had
//                      passed sixteen merges' "tsc + unit tests + --only").
//                      Results: testdata\e2e-sonuc\halka.json.
//   --ring=hizli       the ring without its one slow part, the transcription
//                      job (it loads the speech model: about 160 s of the
//                      ring's 5 minutes; what it checks changes only with the
//                      subtitle code). Said in the output each time.
//   --no-build         do not rebuild a stale build first
//   --list             the scenario names
//   --packaged=<dir>   the packaged program in <dir> (packaged.mjs): its subset by default
// Results: testdata\e2e-sonuc\last.json (and a screenshot per failure).
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, statSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL, fileURLToPath } from 'node:url'
import { APP_DIR, launchApp } from './app.mjs'
import { TESTDATA, makeE2eMedia } from './media.mjs'
import * as lib from './lib.mjs'
import { DEFAULT_SCENARIO_MS, REFERENCE_FRAMES_MS, runScenarioList } from './limit.mjs'
import { PACKAGED_SUBSET, preparePackaged, refusedLaunches } from './packaged.mjs'
import { pathWithFfmpeg } from './harness-paths.mjs'

const args = Object.fromEntries(process.argv.slice(2).map((a) => { const i = a.indexOf('='); const k = (i < 0 ? a : a.slice(0, i)).replace(/^--/, ''); return [k, i < 0 ? true : a.slice(i + 1)] }))
// --packaged=<folder> (phase 9a, decision 6): the packaged program in <folder>
// (or its win-unpacked) instead of the source build; by default only the
// subset that shows the package works (PACKAGED_SUBSET).
const PACKED = typeof args.packaged === 'string' ? preparePackaged(args.packaged) : null
const RING = !!args.ring
const RING_QUICK = args.ring === 'hizli'
/** The ring's slow part (--ring=hizli leaves it out, and says so). */
const RING_SLOW = /^agent-job-transcribe/
if (RING && (args.only || args['frames-baseline'] || args['frames-only'] || PACKED)) {
  console.error('--ring runs its own fixed set: not with --only, --frames-only, --frames-baseline or --packaged')
  process.exit(2)
}
/** The ring's scenarios, by name (the reference frames come after them). */
const RING_SCENARIOS = /^(security-|agent-)/
const ONLY = args.only ? new RegExp(args.only, 'i') : RING ? RING_SCENARIOS : PACKED ? PACKAGED_SUBSET : null
const REPEAT = Number(args.repeat ?? 1)
const OUT = join(TESTDATA, 'e2e-sonuc')
mkdirSync(OUT, { recursive: true })
for (const f of readdirSync(OUT)) if (f.startsWith('HATA-')) rmSync(join(OUT, f), { force: true })
// (Windows' ffmpeg folder in front, with Windows' separator; elsewhere the PATH as it is: phase 10a, S4.)
process.env.PATH = pathWithFfmpeg(process.env.PATH)

const HERE = fileURLToPath(new URL('.', import.meta.url))
const files = readdirSync(join(HERE, 'scenarios')).filter((f) => f.endsWith('.mjs')).sort()
const scenarios = []
for (const f of files) {
  const m = await import(pathToFileURL(join(HERE, 'scenarios', f)).href)
  scenarios.push({ file: f, name: m.name ?? f.replace(/\.mjs$/, ''), run: m.run, needsFreshWindow: !!m.freshWindow, timeoutMs: m.timeoutMs, optIn: !!m.optIn })
}
// Long exploration runs (phase 11's K1–K7: up to 30 minutes each) export
// `optIn`: they run when --only names them or SNIPP_KESIF=1, not in the
// everyday full run.
const KESIF = process.env.SNIPP_KESIF === '1'
if (args.list) {
  for (const s of scenarios) console.log(s.name)
  process.exit(0)
}

// ---- a stale build is rebuilt (the tests are about the built app) --------
function newest(dir) {
  let t = 0
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name)
    t = Math.max(t, e.isDirectory() ? newest(p) : statSync(p).mtimeMs)
  }
  return t
}
const built = join(APP_DIR, 'out', 'renderer', 'index.html')
if (!PACKED && !args['no-build'] && (!existsSync(built) || newest(join(APP_DIR, 'src')) > statSync(built).mtimeMs)) {
  console.log('build is older than src: npm run build')
  const r = process.platform === 'win32' ? spawnSync('cmd', ['/c', 'npm run build'], { cwd: APP_DIR, stdio: 'inherit' }) : spawnSync('npm', ['run', 'build'], { cwd: APP_DIR, stdio: 'inherit' })
  if (r.status !== 0) process.exit(r.status ?? 1)
}

const media = makeE2eMedia()
const results = []
const frames = args.frames || args['frames-only'] || args['frames-baseline'] || RING

async function runScenarios(round) {
  const list = args['frames-only'] || args['frames-baseline'] ? [] : scenarios.filter((s) => (ONLY ? ONLY.test(s.name) : !s.optIn || KESIF)).filter((s) => !(RING_QUICK && RING_SLOW.test(s.name)))
  if (RING_QUICK) console.log(`ring (hizli): left out ${scenarios.filter((s) => RING_SCENARIOS.test(s.name) && RING_SLOW.test(s.name)).map((s) => s.name).join(', ')}`)
  if (!list.length) {
    if (frames && round === 1) await referenceFrames()
    return
  }
  let app = await launchApp()
  const relaunch = async () => {
    await app.close()
    app = await launchApp()
  }
  try {
    // Each scenario within its time limit (limit.mjs): past it, it fails with
    // where it stood, its app is closed by its own process tree, and the next
    // one starts with a new app.
    await runScenarioList(list, {
      limitOf: (s) => s.timeoutMs ?? DEFAULT_SCENARIO_MS,
      where: () => app.cdp?.lastStep ?? '',
      run: async (s) => {
        const work = join(app.profile, 'work', s.name.replace(/[^\w.-]+/g, '_'))
        mkdirSync(work, { recursive: true })
        if (s.needsFreshWindow) await relaunch()
        await lib.reset(app.cdp)
        app.answers.set([])
        await s.run({ c: app.cdp, app, media, lib, work, out: OUT, relaunch: async (opts = {}) => {
          // The same profile again (a "next start" of the app), or a new one.
          await app.close({ keepProfile: !!opts.profile })
          app = await launchApp({ own: !!opts.profile, ...opts })
          await lib.ready(app.cdp)
          // (Not the Projects window of a new profile: lib.homeClosedAtLaunch.
          // A scenario about that window asks for it with home: true.)
          if (!opts.home) await lib.homeClosedAtLaunch(app.cdp)
          return app
        } })
        const left = app.answers.pending()
        if (left.length) throw new Error(`dialog answers left unused: ${JSON.stringify(left)}`)
        // The window itself never scrolls (22 November, L1): lib.rootStill.
        await lib.rootStill(app.cdp)
      },
      recover: async (s, err) => {
        // (A scenario past its limit may be stuck in the very capture a
        // screenshot needs: none then.)
        if (!err?.timedOut) {
          try { await app.cdp.shot(join(OUT, `HATA-${s.name.replace(/[^\w.-]+/g, '_')}.png`)) } catch { /* window gone */ }
        }
        // A broken window must not break the next scenario.
        await relaunch()
      },
      report: (r) => {
        results.push({ round, ...r })
        console.log(`${r.ok ? 'ok  ' : 'FAIL'} ${r.name.padEnd(34)} ${String(r.ms).padStart(6)} ms${r.error ? '\n     ' + r.error.replace(/\n/g, '\n     ') : ''}`)
      }
    })
  } finally {
    await app.close()
  }
  if (PACKED && round === 1 && !args.only) await refusedLaunchCheck()
  if (frames && round === 1) await referenceFrames()
}

/// ---- the packaged program refuses debugging switches (security patch, item 3) ----
// Started with --remote-debugging-port and the like, without the test gate's
// --e2e: it ends with exit code 64 and nothing is left answering on the port.
// "opened": how often the port answered while the program was still on its
// way out (said, not failed on: the main script is an ES module, and Chromium
// can start its debugging server a moment before the script gets to refuse).
async function refusedLaunchCheck() {
  const t0 = Date.now()
  let ok = false, error = null
  try {
    const rows = await refusedLaunches(PACKED.exe)
    const bad = rows.filter((r) => r.alive || r.code !== 64 || r.after)
    ok = bad.length === 0
    for (const r of rows) console.log(`     ${r.arg.padEnd(30)} exit ${r.code} after ${r.ms} ms; the port answered ${r.opened} of ${r.polls} tries before the exit, ${r.after ? 'STILL ANSWERS' : 'not'} after it`)
    if (!ok) error = `not refused: ${JSON.stringify(bad)}`
  } catch (e) {
    error = String(e?.message ?? e)
  }
  results.push({ round: 1, name: 'packaged-refuses-debug-switches', ok, ms: Date.now() - t0, error })
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${'packaged-refuses-debug-switches'.padEnd(34)} ${String(Date.now() - t0).padStart(6)} ms${error ? '\n     ' + error : ''}`)
}

// ---- reference frames -------------------------------------------------------
// In a window of their own whose 2D canvases draw in software
// (--disable-accelerated-2d-canvas): the GPU rasterizer's edges depend on what
// it drew before (the five "flaky" frames of phase 1b; FAZ2B-PLAN.md K4), the
// software one's do not. The baseline is made the same way.
async function referenceFrames() {
  const app = await launchApp({ extraArgs: ['--disable-accelerated-2d-canvas'], agent: false })
  try {
    await referenceFramesIn(app)
  } finally {
    await app.close()
  }
}
async function referenceFramesIn(app) {
  const REF = join(TESTDATA, 'referans')
  const mediaDir = join(REF, 'media')
  if (!existsSync(join(mediaDir, 'v1.mp4'))) {
    mkdirSync(mediaDir, { recursive: true })
    spawnSync(process.execPath, [join(APP_DIR, 'scripts', 'qa', 'reference', 'make-media.mjs'), mediaDir], { stdio: 'inherit' })
  }
  await lib.reset(app.cdp)
  const base = args['frames-baseline']
  const name = base ? 'baseline' : 'son'
  const json = join(REF, `${name}.json`), pngs = join(REF, name)
  rmSync(pngs, { recursive: true, force: true })
  const t0 = Date.now()
  const r = spawnSync(process.execPath, [join(APP_DIR, 'scripts', 'qa', 'reference', 'refs.mjs'), json, pngs, mediaDir], { stdio: ['ignore', 'pipe', 'inherit'], env: { ...process.env, SNIPP_CDP_PORT: String(app.port) }, encoding: 'utf8', timeout: REFERENCE_FRAMES_MS, killSignal: 'SIGKILL' })
  if (r.status !== 0) {
    const why = r.error?.code === 'ETIMEDOUT' ? `timed out after ${REFERENCE_FRAMES_MS / 1000} s` : 'refs.mjs failed'
    results.push({ round: 1, name: 'reference-frames', ok: false, ms: Date.now() - t0, error: why })
    console.log(`FAIL reference-frames (${why})`)
    return
  }
  if (base) {
    console.log(`reference frames: new baseline written (${json})`)
    results.push({ round: 1, name: 'reference-frames (baseline)', ok: true, ms: Date.now() - t0 })
    return
  }
  const cmp = spawnSync(process.execPath, [join(APP_DIR, 'scripts', 'qa', 'reference', 'cmp.mjs'), join(REF, 'baseline.json'), json, join(REF, 'baseline'), pngs, '^tpl-(intro|outro|blackhole)$'], { encoding: 'utf8' })
  const last = cmp.stdout.trim().split('\n').pop()
  const ok = cmp.status === 0
  results.push({ round: 1, name: 'reference-frames', ok, ms: Date.now() - t0, error: ok ? null : cmp.stdout.trim().split('\n').slice(-12).join('\n') })
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${'reference-frames'.padEnd(34)} ${String(Date.now() - t0).padStart(6)} ms  ${last}`)
  if (!ok) console.log(cmp.stdout)
}

const t0 = Date.now()
for (let round = 1; round <= REPEAT; round++) {
  if (REPEAT > 1) console.log(`-- round ${round} --`)
  await runScenarios(round)
}
const failed = results.filter((r) => !r.ok)
writeFileSync(join(OUT, RING ? 'halka.json' : 'last.json'), JSON.stringify({ at: new Date().toISOString(), packaged: PACKED?.exe ?? null, seconds: Math.round((Date.now() - t0) / 1000), passed: results.length - failed.length, failed: failed.length, results }, null, 1))
if (RING) {
  // The slowest parts, so a ring that grows past its two minutes says where.
  const slow = [...results].sort((a, b) => b.ms - a.ms).slice(0, 5).map((r) => `${r.name} ${Math.round(r.ms / 1000)} s`).join(', ')
  console.log(`\nring: ${results.length} parts; the slowest: ${slow}`)
}
console.log(`\n${results.length - failed.length} passed, ${failed.length} failed (${Math.round((Date.now() - t0) / 1000)} s)`)
process.exit(failed.length ? 1 : 0)
