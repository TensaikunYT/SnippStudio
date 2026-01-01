// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// Phase 11b: the main process's findings. DG4: `codefilm:make-anim` writes
// beside the window's own saved project, never a path the page names (its
// neighbour `codefilm:add-template` always did).
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import test from 'node:test'

const MAIN = join(__dirname, '..', '..', 'src', 'main')

/** The source of one `ipcMain.handle(name, …)` up to the next handler. */
function handler(file: string, name: string): string {
  const src = readFileSync(join(MAIN, file), 'utf8')
  const at = src.indexOf(`ipcMain.handle('${name}'`)
  assert.ok(at >= 0, name)
  const next = src.indexOf('ipcMain.handle(', at + 10)
  return src.slice(at, next < 0 ? undefined : next)
}

test('DG4: make-anim takes the project path from the window, and refuses one the page names otherwise', () => {
  const h = handler('ipc/media-ipc.ts', 'codefilm:make-anim')
  assert.match(h, /const projectPath = editorState\(event\.sender\)\.currentProjectPath/)
  assert.match(h, /normalize\(pagePath\) !== normalize\(projectPath\)\) return \{ ok: false/)
  assert.match(h, /makeAnimFolder\(normalize\(projectPath\), name\)/)
  // Its neighbour, the model.
  assert.match(handler('ipc/media-ipc.ts', 'codefilm:add-template'), /editorState\(event\.sender\)\.currentProjectPath/)
})

test('A16: every file the export writes is whole or not at all: no plain fs.writeFile left in file-ipc', () => {
  const src = readFileSync(join(MAIN, 'ipc', 'file-ipc.ts'), 'utf8')
  assert.doesNotMatch(src, /fs\.writeFile\(/)
  assert.match(handler('ipc/file-ipc.ts', 'file:write-beside'), /writeFileAtomic\(target, args\.text\)/)
})

test('A17: archive:copy-lut copies only a LUT (a .cube, found as lut:read finds it, with its header) into the chosen folder', () => {
  const h = handler('ipc/project-ipc.ts', 'archive:copy-lut')
  assert.match(h, /if \(!batchExportDir\) return \{ ok: false/)
  assert.match(h, /!isCube\(normalize\(args\.path\)\)\) return \{ ok: false, error: 'not a LUT' \}/)
  assert.match(h, /locateMedia\(.*\{ accept: isCube \}\)/)
  assert.match(h, /LUT_3D_SIZE/)
  assert.match(h, /startsWith\(batchExportDir\)\) return \{ ok: false, error: 'outside folder' \}/)
  assert.match(h, /writeFileAtomic\(target, head\)/)
})
