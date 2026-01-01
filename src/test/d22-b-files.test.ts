// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// 22 November, worker B, K1 and K4 (D22-PLAN-B.md): "the user chose this
// file" comes from a system window or from the dropped File itself, never
// from text the page sends. Read from the sources, so it holds for paths no
// unit test can run (the bridge and the main process); the running proof is
// the e2e scenario security-chosen-paths.
import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { EXPORT_EXTENSIONS, exportFileList } from '../shared/export-place'

const SRC = join(process.cwd(), 'src')
const read = (rel: string): string => readFileSync(join(SRC, rel), 'utf8')
const code = (rel: string): string => read(rel).replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')

test('K4: every "this was dropped" call hands the bridge the File; the bridge takes the path itself', () => {
  const preload = code('preload/index.ts')
  const calls = [...preload.matchAll(/ipcRenderer\.invoke\('((?:media|project|codefilm):register-dropped(?:-folder)?)', ([^)]*\)?)\)/g)]
  assert.deepEqual(calls.map((m) => m[1]).sort(), ['codefilm:register-dropped', 'media:register-dropped', 'media:register-dropped-folder', 'project:register-dropped'])
  for (const m of calls) assert.equal(m[2], 'droppedPath(file)', `${m[1]} gets the path the bridge took`)
  for (const name of ['registerDroppedFolder', 'registerDroppedMedia', 'registerDroppedProject']) assert.match(preload, new RegExp(`${name}: \\(file: File\\)`), `${name} takes a File`)
  // droppedPath: an object only, through webUtils; text gives no path.
  const fn = preload.slice(preload.indexOf('function droppedPath'), preload.indexOf('const api = {'))
  assert.match(fn, /if \(!file \|\| typeof file !== 'object'\) return ''/)
  assert.match(fn, /webUtils\.getPathForFile\(file as File\)/)
  // The page's callers pass the File.
  assert.match(code('renderer/src/App.tsx'), /api\.registerDroppedProject\(files\[0\]\)/)
  const imp = code('renderer/src/media/import.ts')
  assert.match(imp, /api\.registerDroppedFolder\(f\)/)
  assert.match(imp, /api\.registerDroppedMedia\(f\)/)
  assert.match(imp, /api\.codeFilm\.registerDropped\(f\)/)
})

test('K4, the code clip folder: a folder the page names is registered only when it may run already, and nothing is trusted for it', () => {
  const main = code('main/ipc/media-ipc.ts')
  const named = main.slice(main.indexOf("ipcMain.handle('codefilm:register',"), main.indexOf("ipcMain.handle('codefilm:register-dropped'"))
  assert.match(named, /if \(!filmMayRun\(folder, project\)\) return null\s+const info = await codeFilmAt\(folder\)/)
  assert.doesNotMatch(named, /trustOwnHand|trustedFolders\.add/, 'the page cannot make a folder trusted by naming it')
  // The dropped one is trusted (the user's own hand), and its path is the bridge's.
  const dropped = main.slice(main.indexOf("ipcMain.handle('codefilm:register-dropped'"), main.indexOf("ipcMain.handle('codefilm:trust-asks'"))
  assert.match(dropped, /trustOwnHand\(/)
  assert.match(code('preload/index.ts'), /registerDropped: \(file: File\)[^\n]*'codefilm:register-dropped', droppedPath\(file\)\)/)
  // The folders the app hands the page are trusted where they are made.
  for (const made of ['codefilm:make-anim', 'codefilm:add-template']) {
    const at = main.indexOf(`ipcMain.handle('${made}'`)
    assert.match(main.slice(at, at + 1400), /trustOwnHand\(r\.folder, normalize\(projectPath\)\)/, made)
  }
})

test('K1: the save window opens one path; an export\'s other files are export file types, asked for', () => {
  const handler = code('main/ipc/file-ipc.ts')
  const choose = handler.slice(handler.indexOf("'dialog:choose-save'"), handler.indexOf("'file:write-chosen'"))
  assert.equal((choose.match(/chosenSavePaths\.add\(/g) ?? []).length, 1)
  assert.doesNotMatch(choose, /siblings/)
  assert.doesNotMatch(code('preload/index.ts'), /siblings/)
  // export:approve: a file already there is named back unless the user agreed.
  const approve = code('main/ipc/export-place-ipc.ts')
  assert.match(approve, /if \(there\.length && args\.replace !== true\) return \{ ok: false, exists: there \}/)
  // Sound, picture and video only: never a project, a text or a data file.
  for (const ext of ['snipp', 'autocut', 'json', 'txt', 'srt', 'exe', 'js', 'html']) {
    assert.ok(!EXPORT_EXTENSIONS.includes(ext), ext)
    assert.equal(exportFileList([`tanitim.${ext}`]), null, ext)
  }
  assert.deepEqual(exportFileList(['tanitim.wav', 'tanitim.png', 'tanitim-kapak.png']), ['tanitim.wav', 'tanitim.png', 'tanitim-kapak.png'])
})
