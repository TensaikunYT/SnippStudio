// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// Starts the built app for a test: off-screen, never focused, its own
// throw-away profile, the OS dialogs answered by the test (src/main/e2e-hooks.ts),
// the agent server on a port of its own. One window. Whatever happens to this
// Node process — an error, Ctrl+C, being killed — the app goes with it: a
// small detached watchdog kills the app's process tree when this process is gone.
import { spawn, spawnSync } from 'node:child_process'
import { createServer } from 'node:net'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync, readFileSync, appendFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { connect } from './cdp.mjs'
import { electronBinary, killPlan, spawnGroup } from './harness-paths.mjs'

export const APP_DIR = fileURLToPath(new URL('../..', import.meta.url)).replace(/[\\/]$/, '')
// Electron's program as its npm package names it (path.txt; phase 10a, S1).
// Electron 43's package has no install script: it fetches its program on first
// use (from its own cache when the zip is there). A fresh clone (npm ci) has
// none yet, so the harness asks for it once, as `npx install-electron` would.
function electronPath() {
  const pathTxt = () => { try { return readFileSync(join(APP_DIR, 'node_modules', 'electron', 'path.txt'), 'utf8') } catch { return null } }
  let bin = electronBinary(APP_DIR, process.platform, pathTxt())
  if (!existsSync(bin)) {
    spawnSync(process.execPath, [join(APP_DIR, 'node_modules', 'electron', 'install.js')], { cwd: APP_DIR, stdio: 'inherit' })
    bin = electronBinary(APP_DIR, process.platform, pathTxt())
  }
  return bin
}
let electronExe = null

/** The packaged program under test, or null for the source build (phase 9a,
 *  decision 6: run.mjs --packaged=<folder> sets SNIPP_E2E_APP). */
export const packagedApp = () => process.env.SNIPP_E2E_APP || null

export function freePort() {
  return new Promise((res, rej) => {
    const s = createServer()
    s.once('error', rej)
    s.listen(0, '127.0.0.1', () => {
      const { port } = s.address()
      s.close(() => res(port))
    })
  })
}

export function killTree(pid) {
  if (!pid) return
  // Windows: taskkill's tree; macOS / Linux: the process group (the app is
  // started detached, so its pid is its group's; phase 10a, S2).
  const plan = killPlan(pid)
  if (plan.command) spawnSync(plan.command, plan.args, { stdio: 'ignore', windowsHide: true })
  else try { process.kill(plan.target, plan.signal) } catch { /* gone */ }
}

/** Launches the app. `profile` defaults to a new folder under the OS temp dir. */
export async function launchApp({ profile, extraArgs = [], agent = true, own, agentSearchPath } = {}) {
  const packed = packagedApp()
  if (!packed && !existsSync(join(APP_DIR, 'out', 'main', 'index.js'))) throw new Error('No build: run npm run build first')
  if (packed && !existsSync(packed)) throw new Error(`No packaged program at ${packed}`)
  // A profile made here (or handed over with own: true) is deleted on close.
  let ownProfile = own ?? !profile
  profile ??= mkdtempSync(join(tmpdir(), 'snipp-e2e-'))
  mkdirSync(profile, { recursive: true })
  const port = await freePort()
  const agentPort = await freePort()
  const args = [
    // (A packaged program is the app itself; the source build is Electron + this folder.)
    ...(packed ? [] : ['.']),
    `--remote-debugging-port=${port}`,
    '--show-inactive=offscreen',
    `--user-data-dir=${profile}`,
    '--e2e',
    `--e2e-agent-port=${agentPort}`,
    ...(agent ? ['--agent'] : []),
    ...extraArgs
  ]
  const env = { ...process.env, ELECTRON_ENABLE_LOGGING: '1' }
  if (agentSearchPath !== undefined) {
    for (const key of Object.keys(env)) if (key.toLowerCase() === 'path') delete env[key]
    env.PATH = agentSearchPath
  }
  const proc = spawn(packed ?? (electronExe ??= electronPath()), args, { cwd: packed ? dirname(packed) : APP_DIR, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true, env, ...spawnGroup() })
  const logFile = join(profile, 'e2e-app.log')
  const keep = (b) => { try { appendFileSync(logFile, b) } catch { /* profile gone */ } }
  proc.stdout.on('data', keep)
  proc.stderr.on('data', keep)
  // The watchdog: outlives this process only to kill the app after it.
  const dog = spawn(process.execPath, [fileURLToPath(new URL('./watchdog.mjs', import.meta.url)), String(process.pid), String(proc.pid)], { detached: true, stdio: 'ignore', windowsHide: true })
  dog.unref()
  let closed = false
  /** Closes the app (its whole process tree). keepProfile: the profile stays
   *  (to start the app again on it). */
  const close = async ({ keepProfile = false } = {}) => {
    if (closed) return
    closed = true
    if (keepProfile) ownProfile = false
    try { cdp?.close() } catch { /* already */ }
    killTree(proc.pid)
    killTree(dog.pid)
    if (ownProfile) for (let i = 0; i < 10; i++) {
      try { rmSync(profile, { recursive: true, force: true }); break } catch { await new Promise((r) => setTimeout(r, 300)) }
    }
  }
  const onExit = () => { if (!closed) { killTree(proc.pid); killTree(dog.pid) } }
  process.once('exit', onExit)
  let cdp = null
  try {
    cdp = await connect(port)
  } catch (err) {
    await close()
    throw err
  }
  const exited = new Promise((res) => proc.once('exit', (code) => res(code)))
  return { proc, port, agentPort, profile, cdp, close, exited, answers: answersFor(profile), events: () => eventsOf(profile), log: () => (existsSync(logFile) ? readFileSync(logFile, 'utf8') : '') }
}

/** The answers the app's stand-in dialogs give, in order (e2e-hooks.ts). */
export function answersFor(profile) {
  const file = join(profile, 'e2e', 'answers.json')
  return {
    set(list) {
      mkdirSync(join(profile, 'e2e'), { recursive: true })
      writeFileSync(file, JSON.stringify(list))
    },
    pending() {
      try { return JSON.parse(readFileSync(file, 'utf8')) } catch { return [] }
    }
  }
}

export function eventsOf(profile) {
  const file = join(profile, 'e2e', 'events.jsonl')
  if (!existsSync(file)) return []
  return readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l))
}
