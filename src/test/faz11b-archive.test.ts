// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// Phase 11b, A17: "Collect files" copies the project's LUT files too (the
// archived project said "(missing)" for each), and the archived project
// names the copies. Through a fake bridge: what archiveProject asks of the
// main process and what it writes.
import './dom-stub'
import assert from 'node:assert/strict'
import test from 'node:test'
import type { Project } from '../renderer/src/types'

test('A17: the archive copies each LUT beside the media and the project file names the copy', async () => {
  const asked: { kind: string; arg: unknown }[] = []
  let written = ''
  const fake = {
    chooseFolder: async () => 'D:\\arch',
    archiveCopy: async (source: string, name: string) => (asked.push({ kind: 'media', arg: { source, name } }), { ok: true, path: `D:\\arch\\media\\${name}`, bytes: 10 }),
    archiveCopyLut: async (lut: { path: string; name: string }) => (asked.push({ kind: 'lut', arg: lut }), { ok: true, path: `D:\\arch\\luts\\${lut.name}`, bytes: 5 }),
    batchWrite: async (_name: string, data: Uint8Array) => ((written = new TextDecoder().decode(data)), { saved: true })
  }
  const g = globalThis as unknown as { window?: unknown }
  g.window = { api: fake, setInterval, clearInterval }
  // Loaded after the fake window: platform.ts reads window.api when it loads.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { archiveProject } = require('../renderer/src/media/projectio') as typeof import('../renderer/src/media/projectio')
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { defaultProject } = require('../renderer/src/types') as typeof import('../renderer/src/types')
  const p: Project = defaultProject()
  p.name = 'Trip'
  p.assets = [{ id: 'abcdef1', kind: 'video', name: 'a.mp4', path: 'C:\\cap\\a.mp4', url: '', size: 10, duration: 5, width: 640, height: 360, hasAudio: true }]
  p.luts = [
    { name: 'Warm', path: 'C:\\looks\\warm.cube', relPath: '..\\looks\\warm.cube', size: 5 },
    { name: 'Teal/Orange', path: 'C:\\looks\\to.cube' }
  ]
  const r = await archiveProject(p)
  assert.equal(r.ok, true)
  assert.deepEqual(r.failed, [])
  assert.equal(r.copied, 3, 'one media file, two LUTs')
  assert.deepEqual(asked.filter((x) => x.kind === 'lut').map((x) => (x.arg as { path: string }).path), ['C:\\looks\\warm.cube', 'C:\\looks\\to.cube'])
  const saved = JSON.parse(written) as Project
  assert.deepEqual(saved.luts?.map((l) => [l.name, l.path]), [['Warm', 'D:\\arch\\luts\\1-Warm.cube'], ['Teal/Orange', 'D:\\arch\\luts\\2-Teal Orange.cube']])
  assert.ok(saved.luts?.every((l) => !l.relPath), 'no relative path of the old place')
  assert.deepEqual(p.luts.map((l) => l.path), ['C:\\looks\\warm.cube', 'C:\\looks\\to.cube'], 'the open project is not changed')
})
