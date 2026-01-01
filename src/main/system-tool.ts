// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// The operating system's own tools, by their full path (security patch,
// item 2; B-G5). A program started by its bare name is looked up by Node
// (libuv) in the main process's current folder FIRST on Windows; when a
// project was opened by a double click that folder can be the project's, and
// a taskkill.exe lying there would run in place of Windows' own. So the main
// process never starts a system tool by a bare name: every such start goes
// through systemTool(), and src/test/security-patch-2.test.ts scans for one
// that does not.
//
// No Electron and no relative imports (the tests load it alone).
import path from 'node:path'

/** Windows' tools the main process starts, each with its place under System32. */
const WINDOWS_TOOLS = {
  cmd: ['cmd.exe'],
  taskkill: ['taskkill.exe'],
  powershell: ['WindowsPowerShell', 'v1.0', 'powershell.exe']
} as const

export type SystemToolName = keyof typeof WINDOWS_TOOLS | 'vm_stat'

/** Windows' own folder, from the environment only when it is a plain drive
 *  path (never a relative, UNC or device path), else the usual one. */
export function windowsDir(env: NodeJS.ProcessEnv = process.env): string {
  for (const raw of [env.SystemRoot, env.windir]) {
    if (typeof raw !== 'string') continue
    if (raw.split(/[\\/]/).includes('..')) continue
    const p = path.win32.normalize(raw)
    if (/^[a-z]:\\[^<>:"|?*\x00-\x1f]*$/i.test(p)) return p.replace(/\\+$/, '')
  }
  return 'C:\\Windows'
}

/** Windows' System32: also the folder its tools are started in (never the
 *  project's folder, whatever the app's own current folder is). */
export const systemDir = (env: NodeJS.ProcessEnv = process.env): string => path.win32.join(windowsDir(env), 'System32')

/**
 * The program to start for a system tool: on Windows its full path under
 * System32, elsewhere the name itself (a POSIX PATH holds no current folder
 * unless the user put it there).
 */
export function systemTool(name: SystemToolName, platform: string = process.platform, env: NodeJS.ProcessEnv = process.env): string {
  if (platform !== 'win32') return name
  const parts = (WINDOWS_TOOLS as Record<string, readonly string[] | undefined>)[name]
  if (!parts) throw new Error(`not a Windows system tool: ${name}`)
  return path.win32.join(systemDir(env), ...parts)
}

/** The folder a system tool is started in: Windows' System32, elsewhere the
 *  root (it exists everywhere and is nobody's project). */
export const systemToolCwd = (platform: string = process.platform, env: NodeJS.ProcessEnv = process.env): string => (platform === 'win32' ? systemDir(env) : '/')
