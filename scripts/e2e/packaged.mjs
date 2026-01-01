// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// The e2e run against the PACKAGED program (SnippStudio phase 9a, decision 6):
//   npm run e2e -- --packaged=<folder>       <folder>: an electron-builder output
//                                             folder or its win-unpacked
// A fresh profile per window (as always) and the subset below by default.
// (The check that the embedded terminal's native module loaded from outside
// the archive went with the terminal: TERMINAL-YOK-PLAN.md.)
//
// The package becomes a test copy only for the run: the marker file
// resources/e2e-test-hooks (src/main/e2e-hooks.ts testBuild) is written
// before and removed after, whatever happens. A built package never holds it
// (scripts/package/check.mjs).
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { APP_DIR } from './app.mjs'

/** What the package must do: import, edit, subtitles with the real model,
 *  save-close-open, export, a code clip of each tier (1: its own renderOut,
 *  2: a free canvas page on the app's clock, 3: a whole page), the agent
 *  server with a scripted agent from outside and its draft. */
export const PACKAGED_SUBSET = /^(import-media-to-timeline|edit-split-move-trim-delete-undo|agent-job-transcribe-tr-en|save-close-open|export-mp4|code-clip-live-refresh|code-clip-clock|code-clip-page|agent-server-tools-v2|agent-box-send-draft-accept|security-file-fence|security-trusted-folder)$/i
export const MARKER = 'e2e-test-hooks'

const productName = () => JSON.parse(readFileSync(join(APP_DIR, 'src', 'shared', 'product.json'), 'utf8')).name

/** The program in a package folder (its win-unpacked when given the output folder). */
export function packagedProgram(folder) {
  const exe = process.platform === 'win32' ? `${productName()}.exe` : productName()
  for (const d of [folder, join(folder, 'win-unpacked')]) if (existsSync(join(d, exe)) && existsSync(join(d, 'resources', 'app.asar'))) return { dir: d, exe: join(d, exe) }
  throw new Error(`no packaged ${exe} in ${folder} (nor its win-unpacked)`)
}

/** Points the harness at the package and marks it a test copy until this
 *  process exits. Returns the program's path. */
export function preparePackaged(folder) {
  const { dir, exe } = packagedProgram(resolve(APP_DIR, folder))
  const marker = join(dir, 'resources', MARKER)
  writeFileSync(marker, 'This package is under an e2e run (scripts/e2e/packaged.mjs). Delete this file if the run is gone.\n')
  const clear = () => { try { rmSync(marker, { force: true }) } catch { /* gone */ } }
  process.once('exit', clear)
  for (const sig of ['SIGINT', 'SIGTERM']) process.once(sig, () => { clear(); process.exit(130) })
  process.env.SNIPP_E2E_APP = exe
  console.log(`packaged program: ${exe} (test marker written; removed at exit)`)
  return { dir, exe, marker, clear }
}

// ---- security patch, item 3: debugging switches ------------------------------
// The packaged program started with a debugging switch, and NOT as a test
// copy (no --e2e, although the run's marker file is there), must end at once
// with exit code 64 (src/main/launch-guard.ts) and must not leave a port
// answering. Each launch has a throw-away profile and is off-screen; a
// program still alive after 20 s is ended by its own pid and counted failed.
import { spawn, spawnSync } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { connect as tcpConnect, createServer as tcpServer } from 'node:net'
import { tmpdir } from 'node:os'

const freeTcpPort = () => new Promise((res, rej) => {
  const s = tcpServer()
  s.once('error', rej)
  s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => res(port)) })
})
const answers = (port) => new Promise((res) => {
  const s = tcpConnect(port, '127.0.0.1')
  s.once('connect', () => { s.destroy(); res(true) })
  s.once('error', () => res(false))
  setTimeout(() => { s.destroy(); res(false) }, 200).unref()
})

export async function refusedLaunches(exe) {
  const rows = []
  for (const sw of ['--remote-debugging-port=PORT', '/remote-debugging-port=PORT', '--Remote-Debugging-Port=PORT', '--remote-debugging-pipe', '--inspect=PORT', '--inspect-brk=PORT', '--load-extension=DIR']) {
    const port = await freeTcpPort()
    const profile = mkdtempSync(join(tmpdir(), 'snipp-e2e-refused-'))
    const arg = sw.replace('PORT', String(port)).replace('DIR', profile)
    const t0 = Date.now()
    const proc = spawn(exe, [arg, `--user-data-dir=${profile}`, '--show-inactive=offscreen'], { stdio: 'ignore', windowsHide: true })
    let code = null
    let opened = 0
    let polls = 0
    const exited = new Promise((res) => proc.once('exit', (c) => { code = c; res() }))
    const watch = (async () => {
      while (code === null && Date.now() - t0 < 20_000) {
        polls++
        if (await answers(port)) opened++
        await new Promise((r) => setTimeout(r, 20))
      }
    })()
    await Promise.race([exited, new Promise((r) => setTimeout(r, 20_000))])
    const alive = code === null
    if (alive) {
      if (process.platform === 'win32') spawnSync('taskkill', ['/PID', String(proc.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true })
      else try { process.kill(proc.pid, 'SIGKILL') } catch { /* gone */ }
    }
    await watch
    // (After it is gone nothing may answer on the port either.)
    await new Promise((r) => setTimeout(r, 300))
    const after = await answers(port)
    for (let i = 0; i < 10; i++) { try { rmSync(profile, { recursive: true, force: true }); break } catch { await new Promise((r) => setTimeout(r, 200)) } }
    rows.push({ arg: sw, code, ms: Date.now() - t0, alive, opened, polls, after })
  }
  return rows
}
