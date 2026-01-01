// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// Phase Ç2a.2, decision 6 (report P14): main ties the window to a project
// file only once the page has read and accepted it. With A open, opening a
// file the page refuses (made by a much newer Snipp; not a project at all)
// leaves the window tied to A — before, main already believed it held the
// refused file (another window was then told "already open" for it, and A
// could be opened twice).
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

// The page names the product from src/shared/product.json (phase 9a, decision 1).
const PRODUCT = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'src', 'shared', 'product.json'), 'utf8')).name
export const name = 'open-refused-keeps-the-file'

export async function run({ c, app, lib, work }) {
  const { assert } = lib
  const current = () => c.ev('window.api.testCurrentProject()')
  const a = join(work, 'a.snipp')
  writeFileSync(a, JSON.stringify({ version: 1, formatVersion: 2, uid: 'e2e-p14-a', name: 'A', settings: { width: 640, height: 360, fps: 30 }, mode: 'frame', tracks: [{ id: 'v1', kind: 'video', name: 'V1', clipIds: [] }, { id: 'a1', kind: 'audio', name: 'A1', clipIds: [] }], clips: {}, assets: [], captions: [], captionStyle: {}, snap: { enabled: true, distance: 12, snapEdges: true, snapCenters: true } }))
  lib.answer(app, { kind: 'open', paths: [a] })
  await c.click('topbar.file')
  await c.click('menu.file.open')
  await c.waitFor('A open', async () => (await c.st((s) => s.project.name)) === 'A', 10000)
  await c.waitFor('main ties the window to A', async () => (await current())?.toLowerCase() === a.toLowerCase(), 5000)

  for (const [file, text, says] of [
    [join(work, 'newer.snipp'), JSON.stringify({ version: 7, name: 'From far ahead' }), /much newer/i],
    [join(work, 'not-a-project.snipp'), JSON.stringify({ hello: 'world' }), new RegExp(`not a ${PRODUCT} project`, 'i')]
  ]) {
    writeFileSync(file, text)
    lib.answer(app, { kind: 'open', paths: [file] })
    await c.click('topbar.file')
    await c.click('menu.file.open')
    await c.waitFor('the refusal', () => c.run((src) => new RegExp(src, 'i').test(document.body.textContent ?? ''), says.source), 8000)
    assert.equal(await c.st((s) => s.project.name), 'A', 'A stays open')
    assert.equal((await current())?.toLowerCase(), a.toLowerCase(), `the window is still A's (not ${file})`)
  }
}
