// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// Where the test harness finds things, per platform (SnippStudio phase 10a,
// step 2; haritalar\cekirdek-platform.md S1–S6). Pure: every function takes
// the platform and the facts it looks at, so src/test/harness-paths.test.ts
// runs the macOS and Linux branches on Windows. The Windows answers are the
// ones the harness used before (decision 1).
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'

/** Electron's program inside its npm package (`node_modules/electron/path.txt`
 *  names it: electron.exe, Electron.app/Contents/MacOS/Electron, electron). */
export function electronBinary(appDir, platform = process.platform, pathTxt = null) {
  const dist = path.join(appDir, 'node_modules', 'electron', 'dist')
  if (pathTxt) return path.join(dist, pathTxt.trim())
  if (platform === 'win32') return path.join(dist, 'electron.exe')
  if (platform === 'darwin') return path.join(dist, 'Electron.app', 'Contents', 'MacOS', 'Electron')
  return path.join(dist, 'electron')
}

/** The search path with Windows' usual ffmpeg folder in front (Windows only,
 *  with Windows' separator); other systems keep theirs as it is. */
export function pathWithFfmpeg(current, platform = process.platform) {
  if (platform !== 'win32') return current ?? ''
  return `C:\\ffmpeg\\bin;${current ?? ''}`
}

/** An ffmpeg tool: Windows' C:\ffmpeg\bin copy when it is there, else the
 *  name (the search path finds it). */
export function ffmpegTool(name, platform = process.platform, exists = existsSync) {
  if (platform === 'win32') {
    const p = path.win32.join('C:\\ffmpeg\\bin', name + '.exe')
    return exists(p) ? p : name
  }
  return name
}

/** The font for the test pictures' numbers: Windows' Arial (as before), else
 *  the app's own Inter (in the repository), written the way ffmpeg's
 *  drawtext filter wants a path. */
export function drawtextFont(appDir, platform = process.platform, exists = existsSync) {
  if (platform === 'win32' && exists('C:\\Windows\\Fonts\\arial.ttf')) return 'C\\:/Windows/Fonts/arial.ttf'
  const inter = path.join(appDir, 'src', 'renderer', 'src', 'assets', 'fonts', 'Inter-Variable.ttf').replace(/\\/g, '/')
  return inter.replace(/^([A-Za-z]):/, '$1\\:')
}

/** The test material's folder: SNIPP_TESTDATA when set, else <repo>/../testdata. */
export function testdataDir(appDir, env = process.env) {
  return env.SNIPP_TESTDATA ? path.resolve(env.SNIPP_TESTDATA) : path.join(appDir, '..', 'testdata')
}

/** The test material's two big code films, by role: `portrait` (1080 × 1920,
 *  its own renderOut, unseeded grain) and `heavy` (a long landscape film whose
 *  start builds every scene at once). Which folders of <testdata>/filmler they
 *  are is written in <testdata>/filmler/roles.json ({ "portrait": "<folder>",
 *  "heavy": "<folder>" }), which stays with the material, out of the
 *  repository; without it the folder is named after the role. */
export function filmDir(testdata, role, read = readFileSync) {
  let roles = {}
  try { roles = JSON.parse(read(path.join(testdata, 'filmler', 'roles.json'), 'utf8')) } catch { /* no map: the role is the folder */ }
  return path.join(testdata, 'filmler', typeof roles[role] === 'string' && roles[role] ? roles[role] : role)
}

/** A folder of the test material by role, the same way (Faz 9 audit patch P,
 *  P11: the material's own folder names stay out of the repository). Roles:
 *  `voiceover` (a voice-over vo.wav, its subtitles vo.srt, 20 numbered
 *  pictures 1.jpg … 20.jpg and proje.snipp). The map is <testdata>/roles.json
 *  ({ "voiceover": "<folder>" }); without it the folder is named after the role. */
export function materialDir(testdata, role, read = readFileSync) {
  let roles = {}
  try { roles = JSON.parse(read(path.join(testdata, 'roles.json'), 'utf8')) } catch { /* no map: the role is the folder */ }
  return path.join(testdata, typeof roles[role] === 'string' && roles[role] ? roles[role] : role)
}

/** How to end a process and everything it started: Windows' taskkill tree;
 *  on macOS / Linux the process group (the app is started detached, so its
 *  pid is its group's). */
export function killPlan(pid, platform = process.platform) {
  if (platform === 'win32') return { command: 'taskkill', args: ['/PID', String(pid), '/T', '/F'] }
  return { signal: 'SIGKILL', target: -pid }
}

/** Spawn options so the tree can be ended that way. */
export const spawnGroup = (platform = process.platform) => (platform === 'win32' ? {} : { detached: true })

/** A search path with no agent program on it: the system's own folders only
 *  (Windows: System32 and the Windows folder; elsewhere /usr/bin and /bin). */
export function systemOnlyPath(platform = process.platform, env = process.env) {
  if (platform === 'win32') return [path.win32.join(env.SystemRoot ?? 'C:\Windows', 'System32'), env.SystemRoot ?? 'C:\Windows'].join(';')
  return '/usr/bin:/bin'
}

/** The user's own shell running one copied line, as a program and its
 *  arguments: PowerShell on Windows (the chooser's lines are PowerShell's
 *  there), sh elsewhere. */
export function userShell(line, platform = process.platform) {
  return platform === 'win32' ? { file: 'powershell.exe', args: ['-NoProfile', '-NonInteractive', '-Command', line] } : { file: 'sh', args: ['-c', line] }
}
