// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// Security patch, item 2 (B-G5): the main process never starts a system tool
// by a bare name (Node looks a bare name up in the current folder first on
// Windows). A scan of the main process's source, the helper's own rules, and
// the real thing: a taskkill.exe planted in the current folder does not run.
import assert from 'node:assert/strict'
import test from 'node:test'
import { spawn } from 'node:child_process'
import { copyFileSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { killTree } from '../main/agent-connect'
import { systemDir, systemTool, systemToolCwd, windowsDir } from '../main/system-tool'

const WIN = process.platform === 'win32'
const MAIN = path.join(__dirname, '..', '..', 'src', 'main')

function sources(dir: string): string[] {
  const out: string[] = []
  for (const name of readdirSync(dir)) {
    const p = path.join(dir, name)
    if (statSync(p).isDirectory()) out.push(...sources(p))
    else if (/\.ts$/.test(name)) out.push(p)
  }
  return out
}

/** The code without its comments (a comment may name a tool). */
const code = (text: string): string => text.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, '')).replace(/(^|[^:'"`\\])\/\/[^\n]*/g, '$1')

test('item 2: no start of a program by a bare name anywhere in the main process', () => {
  const files = sources(MAIN)
  assert.ok(files.length > 30, 'the main process\'s sources were found')
  const found: string[] = []
  for (const f of files) {
    const rel = path.relative(MAIN, f).replace(/\\/g, '/')
    const text = code(readFileSync(f, 'utf8'))
    text.split('\n').forEach((line, i) => {
      // A program named by a string in the call itself.
      if (/\b(?:spawn|spawnSync|spawnChild|execFile|execFileSync|exec|execSync|fork)\(\s*['"`]/.test(line)) found.push(`${rel}:${i + 1} starts a program by a literal name`)
      // Windows' tools as words, anywhere but handed to the helper that
      // knows their place (and in that helper itself).
      if (rel !== 'system-tool.ts' && /(?<!systemTool\()['"`](?:taskkill|cmd|powershell|pwsh|where|wmic|reg|tasklist|whoami|schtasks|explorer|rundll32|cscript|wscript|mshta|certutil|bitsadmin|icacls|attrib)(?:\.exe)?['"`]/i.test(line)) found.push(`${rel}:${i + 1} names a Windows tool without its path`)
    })
  }
  assert.deepEqual(found, [])
})

test('item 2: a system tool is its full path under System32 on Windows, its name elsewhere', () => {
  const env = { SystemRoot: 'C:\\Windows' }
  assert.equal(systemTool('taskkill', 'win32', env), 'C:\\Windows\\System32\\taskkill.exe')
  assert.equal(systemTool('cmd', 'win32', env), 'C:\\Windows\\System32\\cmd.exe')
  assert.equal(systemTool('cmd', 'win32', { SystemRoot: 'D:\\WINNT\\' }), 'D:\\WINNT\\System32\\cmd.exe')
  assert.equal(systemTool('cmd', 'win32', { windir: 'E:\\Win' }), 'E:\\Win\\System32\\cmd.exe')
  // An environment that points somewhere odd is not followed.
  for (const bad of ['', '.', 'Windows', '..\\x', '\\\\server\\share\\Windows', '\\\\?\\C:\\Windows', 'C:', 'C:\\a\\..\\..\\x', 'C:\\Win:stream', 'C:\\a\nb']) {
    assert.equal(windowsDir({ SystemRoot: bad }), 'C:\\Windows', JSON.stringify(bad))
  }
  assert.equal(systemDir({}), 'C:\\Windows\\System32')
  assert.equal(systemToolCwd('win32', env), 'C:\\Windows\\System32')
  for (const p of ['linux', 'darwin']) {
    assert.equal(systemTool('cmd', p), 'cmd')
    assert.equal(systemTool('vm_stat', p), 'vm_stat')
    assert.equal(systemToolCwd(p), '/')
  }
  assert.throws(() => systemTool('vm_stat', 'win32', env))
})

const alive = (pid: number): boolean => {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

test('item 2: a taskkill.exe planted in the current folder does not run: the real one ends the process tree', { skip: !WIN }, async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'snipp-g2-'))
  const cwd = process.cwd()
  const keys = Object.keys(process.env).filter((k) => k.toLowerCase() === 'nodefaultcurrentdirectoryinexepath')
  const saved = keys.map((k) => [k, process.env[k]] as const)
  // (A harmless stand-in: Windows' own hostname.exe under taskkill's name.
  // Had it run, the process below would still be alive.)
  copyFileSync(path.join(systemDir(), 'hostname.exe'), path.join(dir, 'taskkill.exe'))
  const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore', windowsHide: true })
  try {
    assert.ok(child.pid && alive(child.pid))
    process.chdir(dir)
    // (An app opened from Explorer has no such variable; this shell sets it.)
    for (const k of keys) delete process.env[k]
    killTree(child.pid)
    const end = Date.now() + 5_000
    while (alive(child.pid) && Date.now() < end) await new Promise((r) => setTimeout(r, 50))
    assert.equal(alive(child.pid), false, 'the real taskkill ended the process')
  } finally {
    process.chdir(cwd)
    for (const [k, v] of saved) if (v !== undefined) process.env[k] = v
    child.kill()
    for (let i = 0; i < 20; i++) {
      try {
        rmSync(dir, { recursive: true, force: true })
        break
      } catch {
        await new Promise((r) => setTimeout(r, 100))
      }
    }
  }
})
