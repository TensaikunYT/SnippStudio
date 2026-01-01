// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// Security patch, item 1 (K-G1, K-G2, B-G1): a program planted in the
// project folder (claude.bat, claude.cmd, codex.cmd, node.bat, node.cmd,
// node.exe) must never run in place of the agent or of the `node` its npm
// shim names. Every way an agent program is started is run here for real,
// with stand-in agents and harmless markers, in throw-away folders: the add
// lines the Settings window copies, run in the user's own PowerShell (in the
// project folder itself), the version query and the registration check. (The
// embedded terminal and way D's system terminal went: TERMINAL-YOK-PLAN.md.)
import assert from 'node:assert/strict'
import test from 'node:test'
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { agentEnv, agentQuery, agentVersion, claudeAddLine, codexAddLine, type AgentFound } from '../main/agent-connect'

const WIN = process.platform === 'win32'
const SYS = path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32')
const PS = path.join(SYS, 'WindowsPowerShell', 'v1.0', 'powershell.exe')
const VAR = 'NoDefaultCurrentDirectoryInExePath'
const URL_ = 'http://127.0.0.1:47811/mcp'

/** npm's cmd-shim of a Node CLI (codex, opencode, an older claude): `node`
 *  is named without a path when no node.exe stands beside the shim. */
const npmShim = (js: string): string =>
  ['@ECHO off', 'GOTO start', ':find_dp0', 'SET dp0=%~dp0', 'EXIT /b', ':start', 'SETLOCAL', 'CALL :find_dp0', 'IF EXIST "%dp0%\\node.exe" (', '  SET "_prog=%dp0%\\node.exe"', ') ELSE (', '  SET "_prog=node"', '  SET PATHEXT=%PATHEXT:;.JS;=;%', ')', `endLocal & goto #_undefined_# 2>NUL || title %COMSPEC% & "%_prog%"  "%dp0%\\${js}" %*`, ''].join('\r\n')

interface World {
  root: string
  bin: string
  proj: string
  cfg: string
  settings: string
  claude: AgentFound
  codex: AgentFound
  /** The stand-in agents that really ran (their names). */
  legit: () => string
  /** The planted programs that ran (empty: none). */
  planted: () => string
  reset: () => void
}

/** A throw-away world: the real (stand-in) agents in `bin`, a project folder
 *  holding the planted programs. */
function world(plants: string[]): World {
  const root = mkdtempSync(path.join(tmpdir(), 'snipp-g1-'))
  const bin = path.join(root, 'bin')
  const proj = path.join(root, 'kotu proje')
  const profile = path.join(root, 'profile')
  for (const d of [bin, proj, profile]) mkdirSync(d, { recursive: true })
  for (const name of ['claude', 'codex']) {
    writeFileSync(path.join(bin, `${name}.cmd`), npmShim(`${name}.js`))
    writeFileSync(path.join(bin, `${name}.js`), `require('fs').appendFileSync(require('path').join(__dirname, '..', 'legit.txt'), '${name}\\n'); if (process.argv.includes('--version')) console.log('${name} 9.8.7')\n`)
  }
  for (const p of plants) {
    // (A planted .exe: a copy of Windows' own hostname.exe. It writes no
    // marker; had it run in place of node, the stand-in agent did not.)
    if (p.endsWith('.exe')) copyFileSync(path.join(SYS, 'hostname.exe'), path.join(proj, p))
    else writeFileSync(path.join(proj, p), `@echo ${p}>> "%~dp0KANIT.txt"\r\n`)
  }
  const settings = path.join(profile, 'agent.json')
  writeFileSync(settings, JSON.stringify({ enabled: true, token: 'local-test-token' }))
  const read = (f: string): string => (existsSync(f) ? readFileSync(f, 'utf8').trim().replace(/\s+/g, ' ') : '')
  return {
    root, bin, proj, settings,
    cfg: path.join(profile, 'agent-session', 'mcp.json'),
    claude: { id: 'claude', path: path.join(bin, 'claude.cmd') },
    codex: { id: 'codex', path: path.join(bin, 'codex.cmd') },
    legit: () => read(path.join(root, 'legit.txt')),
    planted: () => read(path.join(proj, 'KANIT.txt')),
    reset: () => {
      rmSync(path.join(root, 'legit.txt'), { force: true })
      rmSync(path.join(proj, 'KANIT.txt'), { force: true })
    }
  }
}

/** The environment of an app the user opened from Explorer: the variable is
 *  not set there (this shell sets it), the stand-in agents and a real node
 *  are on PATH. Restores the process's own afterwards. */
async function asDesktop<T>(w: World, work: () => Promise<T> | T): Promise<T> {
  const keys = Object.keys(process.env).filter((k) => /^(path|NoDefaultCurrentDirectoryInExePath)$/i.test(k))
  const saved = keys.map((k) => [k, process.env[k]] as const)
  for (const k of keys) delete process.env[k]
  process.env.PATH = [w.bin, path.dirname(process.execPath), SYS].join(';')
  try {
    return await work()
  } finally {
    delete process.env.PATH
    for (const [k, v] of saved) if (v !== undefined) process.env[k] = v
  }
}

const SETS: string[][] = [['claude.bat', 'node.bat'], ['claude.cmd', 'codex.cmd', 'node.cmd'], ['node.exe'], ['claude.exe', 'codex.exe']]

test('item 1: every agent start gets NoDefaultCurrentDirectoryInExePath=1 on Windows', () => {
  const env = agentEnv({ PATH: 'p', nodefaultcurrentdirectoryinexepath: '0' }, { X: 'y' }, 'win32')
  assert.equal(env[VAR], '1')
  assert.deepEqual(Object.keys(env).filter((k) => k.toLowerCase() === VAR.toLowerCase()), [VAR], 'one spelling only')
  // (An extra value cannot switch it off.)
  assert.equal(agentEnv({}, { [VAR]: '' }, 'win32')[VAR], '1')
  assert.equal(VAR in agentEnv({ PATH: 'p' }, {}, 'linux'), false)
})

test('item 1: the copied add lines name the agent by its full path', () => {
  const claude: AgentFound = { id: 'claude', path: 'C:\\Users\\u\\AppData\\Roaming\\npm\\claude.cmd' }
  const codex: AgentFound = { id: 'codex', path: "C:\\O'Neil\\bin\\codex.cmd" }
  assert.match(claudeAddLine('C:\\p\\agent.json', URL_, 'snippstudio-dev', 'win32', claude.path), /^\$env:NoDefaultCurrentDirectoryInExePath = '1'; .*& 'C:\\Users\\u\\AppData\\Roaming\\npm\\claude\.cmd' mcp add /)
  assert.match(codexAddLine(URL_, 'snippstudio-dev', 'win32', codex.path), /^\$env:NoDefaultCurrentDirectoryInExePath = '1'; & 'C:\\O''Neil\\bin\\codex\.cmd' mcp remove /)
  assert.equal(codexAddLine(URL_, 'snippstudio', 'linux', '/opt/bin/codex').startsWith("'/opt/bin/codex' mcp remove "), true)
})

for (const plants of SETS) {
  test(`item 1: planted ${plants.join(', ')} in the project folder never runs: the copied add line, the version query, the registration check`, { skip: !WIN }, async () => {
    const w = world(plants)
    try {
      await asDesktop(w, async () => {
        const check = (way: string, name: string, ran = name): void => {
          assert.equal(w.planted(), '', `${way} (${name}): a planted program ran`)
          assert.equal(w.legit(), ran, `${way} (${name}): the real program ran`)
          w.reset()
        }
        for (const agent of [w.claude, w.codex]) {
          const name = agent.id
          // The add line the Settings window copies, in the user's own
          // PowerShell (nothing of the app in its environment), started in
          // the very folder that holds the planted programs: remove, then add.
          const line = name === 'codex' ? codexAddLine(URL_, 'snippstudio-dev', 'win32', agent.path) : claudeAddLine(w.settings, URL_, 'snippstudio-dev', 'win32', agent.path)
          const c = spawnSync(PS, ['-NoProfile', '-NonInteractive', '-Command', line], { cwd: w.proj, env: { ...process.env } as Record<string, string>, windowsHide: true, timeout: 60_000, encoding: 'utf8' })
          assert.equal(c.status, 0, c.stderr)
          check('copied add line', name, `${name} ${name}`)

          // The version query and the registration check (the app asks in the
          // profile; here even in the project folder).
          assert.equal(await agentVersion(agent, w.proj), '9.8.7', `version query (${name})`)
          check('version query', name)
          await agentQuery(agent, ['mcp', 'get', 'snippstudio-dev'], w.proj, null, 30_000)
          check('registration check', name)
        }
      })
    } finally {
      rmSync(w.root, { recursive: true, force: true })
    }
  })
}

test('item 1: PowerShell itself never runs a program from the current folder by its bare name', { skip: !WIN }, async () => {
  const w = world(['claude.bat', 'claude.cmd', 'claude.exe'])
  try {
    await asDesktop(w, () => {
      // (No claude anywhere on PATH: only the planted ones, in the folder.)
      const env = { ...process.env, PATH: [path.dirname(process.execPath), SYS].join(';') } as Record<string, string>
      const r = spawnSync(PS, ['-NoProfile', '-NonInteractive', '-Command', `Set-Location -LiteralPath '${w.proj}'; claude mcp get x`], { cwd: w.root, env, windowsHide: true, timeout: 60_000, encoding: 'utf8' })
      assert.notEqual(r.status, 0)
      assert.match(r.stderr, /claude/)
      assert.equal(w.planted(), '')
      // And the line the app gives when no agent is installed is that one.
      assert.match(claudeAddLine(w.settings, URL_, 'snippstudio-dev', 'win32'), /; claude mcp add --transport http /)
    })
  } finally {
    rmSync(w.root, { recursive: true, force: true })
  }
})
