// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// SnippStudio phase 7 audit patch (tarifler\FAZ7-YAMA.md), S3: the user's own agent settings are not written, on the real disk.
import assert from 'node:assert/strict'
import test from 'node:test'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { agentEnv, antigravityPrintLine, claudeAddLine, codexAddLine, codexEnvLine, openCodeConfig, tokenSetupLine } from '../main/agent-connect'

// ---- S3: the user's own agent settings are not written (the real disk) -----

/** Every file under a folder: path → size and modification time. */
function treeOf(root: string): Map<string, string> {
  const out = new Map<string, string>()
  const walk = (dir: string): void => {
    for (const name of readdirSync(dir)) {
      const p = path.join(dir, name)
      const st = statSync(p)
      if (st.isDirectory()) walk(p)
      else out.set(path.relative(root, p), `${st.size}:${st.mtimeMs}:${readFileSync(p, 'utf8')}`)
    }
  }
  walk(root)
  return out
}

test('S3: the copied parts of every agent write nothing in the user\'s home: .codex, .claude, .config/opencode, opencode.json*', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'snipp-s3-'))
  const home = path.join(root, 'home')
  const roaming = path.join(home, 'AppData', 'Roaming')
  const local = path.join(home, 'AppData', 'Local')
  const project = path.join(root, 'project')
  const profile = path.join(root, 'profile')
  const keys = ['USERPROFILE', 'HOME', 'APPDATA', 'LOCALAPPDATA', 'XDG_CONFIG_HOME', 'CODEX_HOME'] as const
  const saved = Object.fromEntries(keys.map((k) => [k, process.env[k]]))
  const cwdBefore = process.cwd()
  try {
    // The user's own settings, as they are before.
    for (const [file, text] of [
      [path.join(home, '.codex', 'config.toml'), 'model = "mine"\n'],
      [path.join(home, '.claude', 'settings.json'), '{"mine":true}\n'],
      [path.join(home, '.config', 'opencode', 'opencode.json'), '{"mine":true}\n'],
      [path.join(roaming, 'npm', 'keep.txt'), 'x'],
      [path.join(local, 'keep.txt'), 'x']
    ]) {
      mkdirSync(path.dirname(file), { recursive: true })
      writeFileSync(file, text)
    }
    mkdirSync(project, { recursive: true })
    Object.assign(process.env, { USERPROFILE: home, HOME: home, APPDATA: roaming, LOCALAPPDATA: local, XDG_CONFIG_HOME: path.join(home, '.config') })
    delete process.env.CODEX_HOME
    process.chdir(project)
    const before = treeOf(home)
    const url = 'http://127.0.0.1:47811/mcp'
    const settings = path.join(profile, 'agent.json')

    // Every part the Settings window copies, for every agent (since
    // TERMINAL-YOK-PLAN.md the app starts no agent: the parts are all).
    agentEnv(process.env, {})
    claudeAddLine(settings, url, 'snippstudio-dev', 'win32')
    codexAddLine(url, 'snippstudio-dev', 'win32')
    codexEnvLine(settings, 'snippstudio-dev', 'win32')
    openCodeConfig(url)
    tokenSetupLine(settings)
    antigravityPrintLine(settings, url, 'win32')

    // Nothing under the home was created or changed.
    assert.deepEqual([...treeOf(home)].sort(), [...before].sort())
    for (const dir of ['.codex', '.claude', path.join('.config', 'opencode')]) {
      assert.deepEqual(readdirSync(path.join(home, dir)).sort(), dir === '.codex' ? ['config.toml'] : dir === '.claude' ? ['settings.json'] : ['opencode.json'])
    }
    // Nor anything in the project or the working folder, nor in the profile.
    assert.deepEqual(readdirSync(project), [])
    assert.ok(!existsSync(path.join(project, 'opencode.jsonc')))
    assert.ok(!existsSync(profile), 'nothing written in the profile either')
  } finally {
    process.chdir(cwdBefore)
    for (const k of keys) {
      if (saved[k] === undefined) delete process.env[k]
      else process.env[k] = saved[k]
    }
    rmSync(root, { recursive: true, force: true })
  }
})
