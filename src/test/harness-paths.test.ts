// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// The test harness on three platforms (SnippStudio phase 10a, step 2;
// haritalar\cekirdek-platform.md S1–S6, S10): Electron's program, the search
// path, ffmpeg, the test pictures' font, the test material's folder, ending a
// process tree. scripts/e2e/harness-paths.mjs is an ES module, so it is asked
// through a small child process.
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import test from 'node:test'

const ROOT = join(__dirname, '..', '..')
function ask(expr: string): any {
  const url = 'file:///' + join(ROOT, 'scripts', 'e2e', 'harness-paths.mjs').replace(/\\/g, '/')
  const r = spawnSync(process.execPath, ['--input-type=module', '-e', `const m = await import(${JSON.stringify(url)}); console.log(JSON.stringify(${expr}))`], { encoding: 'utf8' })
  assert.equal(r.status, 0, r.stderr)
  return JSON.parse(r.stdout.trim())
}

test('Electron\'s program: Windows as before, macOS inside its .app, Linux plain; path.txt wins', () => {
  const [w, d, l, t] = ask(`['win32', 'darwin', 'linux'].map((p) => m.electronBinary('/r', p)).concat([m.electronBinary('/r', 'linux', 'electron\\n')])`)
  assert.match(w, /node_modules[\\/]electron[\\/]dist[\\/]electron\.exe$/)
  assert.match(d, /dist[\\/]Electron\.app[\\/]Contents[\\/]MacOS[\\/]Electron$/)
  assert.match(l, /dist[\\/]electron$/)
  assert.equal(t, l)
  // The npm package says the same on this computer (once Electron has fetched
  // its program: a fresh `npm ci` has no path.txt until the first launch).
  const txt = join(ROOT, 'node_modules', 'electron', 'path.txt')
  if (!existsSync(txt)) return
  const pathTxt = readFileSync(txt, 'utf8')
  assert.equal(ask(`m.electronBinary(${JSON.stringify(ROOT)}, process.platform, ${JSON.stringify(pathTxt)})`), ask(`m.electronBinary(${JSON.stringify(ROOT)})`))
})

test('the search path: ffmpeg\'s folder in front on Windows only, with Windows\' separator', () => {
  assert.equal(ask(`m.pathWithFfmpeg('C:\\\\Windows', 'win32')`), 'C:\\ffmpeg\\bin;C:\\Windows')
  assert.equal(ask(`m.pathWithFfmpeg('/opt/homebrew/bin:/usr/bin', 'darwin')`), '/opt/homebrew/bin:/usr/bin')
  assert.equal(ask(`m.pathWithFfmpeg('/usr/bin', 'linux')`), '/usr/bin')
})

test('ffmpeg: C:\\ffmpeg\\bin when there on Windows, else the name; the name elsewhere', () => {
  assert.equal(ask(`m.ffmpegTool('ffprobe', 'win32', () => true)`), 'C:\\ffmpeg\\bin\\ffprobe.exe')
  assert.equal(ask(`m.ffmpegTool('ffprobe', 'win32', () => false)`), 'ffprobe')
  assert.equal(ask(`m.ffmpegTool('ffmpeg', 'linux', () => true)`), 'ffmpeg')
})

test('the test pictures\' font: Arial on Windows (as before), the bundled Inter elsewhere', () => {
  assert.equal(ask(`m.drawtextFont('C:/r', 'win32', () => true)`), 'C\\:/Windows/Fonts/arial.ttf')
  assert.equal(ask(`m.drawtextFont('/r', 'linux', () => false)`), '/r/src/renderer/src/assets/fonts/Inter-Variable.ttf')
  assert.match(ask(`m.drawtextFont('C:/r', 'win32', () => false)`), /^C\\:\/r\/src\/renderer\/src\/assets\/fonts\/Inter-Variable\.ttf$/)
})

test('the test material: SNIPP_TESTDATA when set, else beside the repository', () => {
  assert.match(ask(`m.testdataDir('/r/app', {})`), /[\\/]r[\\/]testdata$/)
  assert.match(ask(`m.testdataDir('/r/app', { SNIPP_TESTDATA: '/tmp/td' })`), /[\\/]tmp[\\/]td$/)
})

test('the test material\'s films by role: roles.json names the folder, else the role is the folder', () => {
  const read = (json: string): string => `() => ${JSON.stringify(json)}`
  assert.match(ask(`m.filmDir('/td', 'heavy', ${read('{ "heavy": "film-b", "portrait": "film-a" }')})`), /[\\/]td[\\/]filmler[\\/]film-b$/)
  assert.match(ask(`m.filmDir('/td', 'portrait', () => { throw new Error('no file') })`), /[\\/]td[\\/]filmler[\\/]portrait$/)
  assert.match(ask(`m.filmDir('/td', 'heavy', ${read('{ "portrait": "film-a" }')})`), /[\\/]td[\\/]filmler[\\/]heavy$/)
})

test('the test material\'s voice-over by role: testdata/roles.json names the folder, else the role is the folder (Faz 9 patch P)', () => {
  const read = (json: string): string => `() => ${JSON.stringify(json)}`
  assert.match(ask(`m.materialDir('/td', 'voiceover', ${read('{ "voiceover": "vo-folder" }')})`), /[\\/]td[\\/]vo-folder$/)
  assert.match(ask(`m.materialDir('/td', 'voiceover', () => { throw new Error('no file') })`), /[\\/]td[\\/]voiceover$/)
})

test('ending a process tree: taskkill on Windows; the process group elsewhere, started detached', () => {
  assert.deepEqual(ask(`m.killPlan(1234, 'win32')`), { command: 'taskkill', args: ['/PID', '1234', '/T', '/F'] })
  assert.deepEqual(ask(`m.killPlan(1234, 'linux')`), { signal: 'SIGKILL', target: -1234 })
  assert.deepEqual(ask(`[m.spawnGroup('win32'), m.spawnGroup('darwin')]`), [{}, { detached: true }])
})

test('line endings are fixed in the repository (.gitattributes)', () => {
  const ga = readFileSync(join(ROOT, '.gitattributes'), 'utf8')
  assert.match(ga, /^\* text=auto eol=lf$/m)
  assert.match(ga, /^\*\.ps1 text eol=crlf$/m)
  for (const ext of ['png', 'ico', 'ttf', 'onnx', 'mp4', 'wav']) assert.match(ga, new RegExp(`^\\*\\.${ext} binary$`, 'm'), ext)
})
