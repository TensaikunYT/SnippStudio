// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// Phase 5e + 5f audit patch (tarifler\FAZ5-YAMA-EF.md) D2 and D3: the
// versions of a code clip's folder. D2: "back" over the 2 MB of a version
// is refused (the files of now could not be kept first), no empty version is
// written, the limit is told; D3: versions only for the open project's own
// `anim\<name>` (a folder named so anywhere else gets nothing).
import assert from 'node:assert/strict'
import test from 'node:test'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { keepVersions, stopVersionKeepers, VERSION_DIR, VersionKeeper, versionNumbers } from '../main/codefilm-versions'

const tmp = (): string => mkdtempSync(path.join(tmpdir(), 'snipp-ef-'))
const BIG = 2 * 1024 * 1024 + 100 * 1024

test('D2: over 2 MB, "back" puts nothing back and says why; the work of now stays', async () => {
  const dir = tmp()
  const root = path.join(dir, 'anim', 'big')
  mkdirSync(root, { recursive: true })
  writeFileSync(path.join(root, 'index.html'), 'v1')
  writeFileSync(path.join(root, 'data.json'), '{}')
  const k = new VersionKeeper(root, 1e9)
  try {
    await k.settle()
    writeFileSync(path.join(root, 'index.html'), 'v2')
    assert.equal(await k.settle(), 1, 'version 1 = v1')
    writeFileSync(path.join(root, 'data.json'), JSON.stringify('x'.repeat(BIG)))
    await k.settle()
    writeFileSync(path.join(root, 'index.html'), 'v3')
    await k.settle()
    writeFileSync(path.join(root, 'index.html'), 'v4')
    await k.settle()
    const info = await k.info()
    assert.equal((info as { over?: boolean }).over, true, `the limit is told: ${JSON.stringify(info)}`)
    await assert.rejects(k.back(), (e: Error & { reason?: string }) => e.reason === 'over-limit', 'refused with its reason')
    assert.equal(readFileSync(path.join(root, 'index.html'), 'utf8'), 'v4', 'the work of now was not written over')
    for (const n of await versionNumbers(root)) assert.ok(readdirSync(path.join(root, VERSION_DIR, String(n))).length > 0, `version ${n} is not empty`)
  } finally {
    k.stop()
    rmSync(dir, { recursive: true, force: true })
  }
})

test('D2: no empty version: a folder with no text file before its first page', async () => {
  const dir = tmp()
  const root = path.join(dir, 'anim', 'pics')
  mkdirSync(root, { recursive: true })
  writeFileSync(path.join(root, 'pic.png'), Buffer.from([1, 2, 3]))
  const k = new VersionKeeper(root, 1e9)
  try {
    await k.settle()
    writeFileSync(path.join(root, 'index.html'), 'first page')
    await k.settle()
    assert.deepEqual(await versionNumbers(root), [], 'nothing to keep: no version written')
  } finally {
    k.stop()
    rmSync(dir, { recursive: true, force: true })
  }
})

test('D3: versions only for the open project\'s own anim\\<name>; another folder named anim gets nothing', async () => {
  const dir = tmp()
  try {
    const proj = path.join(dir, 'proj', 'film.snipp')
    mkdirSync(path.dirname(proj), { recursive: true })
    writeFileSync(proj, '{}')
    const own = path.join(dir, 'proj', 'anim', 'intro')
    const elsewhere = path.join(dir, 'userfilms', 'anim', 'myfilm')
    for (const d of [own, elsewhere]) {
      mkdirSync(d, { recursive: true })
      writeFileSync(path.join(d, 'index.html'), 'a')
    }
    const keep = keepVersions as (root: string, projectPath?: string | null) => VersionKeeper | null
    assert.equal(keep(elsewhere, proj), null, 'outside the project')
    assert.equal(keep(elsewhere), null, 'no project named')
    assert.equal(keep(own, null), null, 'an unsaved project keeps no versions')
    const k = keep(own, proj.toUpperCase())
    assert.ok(k, 'the project\'s own folder (the path compared, not the name)')
    // A folder of the user's that is not the project's: nothing written into it.
    writeFileSync(path.join(elsewhere, 'index.html'), 'b')
    await new Promise((r) => setTimeout(r, 50))
    assert.equal(existsSync(path.join(elsewhere, VERSION_DIR)), false)
  } finally {
    stopVersionKeepers()
    rmSync(dir, { recursive: true, force: true })
  }
})

test('A4: the main process makes no folder for a name Windows keeps', async () => {
  const { makeAnimFolder } = await import('../main/codefilm-versions')
  const dir = tmp()
  try {
    const proj = path.join(dir, 'film.snipp')
    writeFileSync(proj, '{}')
    for (const n of ['CON', 'nul', 'Aux', 'COM1', 'LPT9']) await assert.rejects(makeAnimFolder(proj, n), /Windows/, n)
    assert.equal(existsSync(path.join(dir, 'anim')), false)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
