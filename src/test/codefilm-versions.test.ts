// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// Phase 5e, decisions 3 and 5 (FAZ5-PLAN.md "5e"): the versions of a code
// clip's folder (text files only, at most 2 MB a version, the last 10; one
// put back with the files of now kept as a version) and the code_clip tool's
// folder (made beside the saved project, never written over).
import assert from 'node:assert/strict'
import test from 'node:test'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { ignoredChange } from '../main/codefilm'
import { EMPTY_PAGE, isVersioned, makeAnimFolder, readTextFiles, VERSION_DIR, VERSION_KEEP, VersionKeeper, versionNumbers } from '../main/codefilm-versions'

const tmp = (): string => mkdtempSync(path.join(tmpdir(), 'snipp-5e-'))

test('versions: each settled change keeps the state before it; 11 changes leave the last 10; the version folder is not watched', async () => {
  const dir = tmp()
  const root = path.join(dir, 'anim', 'intro')
  mkdirSync(path.join(root, 'js'), { recursive: true })
  writeFileSync(path.join(root, 'index.html'), 'v0')
  writeFileSync(path.join(root, 'js', 'a.js'), 'a0')
  writeFileSync(path.join(root, 'pic.png'), Buffer.from([1, 2, 3]))
  assert.equal(isVersioned(root), true)
  assert.equal(isVersioned(dir), false)
  const k = new VersionKeeper(root, 1e9)
  try {
    assert.equal(await k.settle(), null, 'nothing changed')
    for (let i = 1; i <= 11; i++) {
      writeFileSync(path.join(root, 'index.html'), `v${i}`)
      assert.equal(await k.settle(), i)
    }
    const ns = await versionNumbers(root)
    assert.equal(ns.length, VERSION_KEEP)
    assert.deepEqual(ns, [2, 3, 4, 5, 6, 7, 8, 9, 10, 11])
    // Version n holds the state before change n: text files only.
    assert.equal(readFileSync(path.join(root, VERSION_DIR, '11', 'index.html'), 'utf8'), 'v10')
    assert.equal(readFileSync(path.join(root, VERSION_DIR, '11', 'js', 'a.js'), 'utf8'), 'a0')
    assert.equal(existsSync(path.join(root, VERSION_DIR, '11', 'pic.png')), false)
    // The versions are not part of the files a version keeps (no loop).
    assert.deepEqual([...(await readTextFiles(root))!.keys()].sort(), ['index.html', 'js/a.js'])
    assert.equal(ignoredChange(`${VERSION_DIR}/3/index.html`), true)
    assert.equal(await k.settle(), null, 'writing a version is no change')
  } finally {
    k.stop()
    rmSync(dir, { recursive: true, force: true })
  }
})

test('versions: back puts the newest version in place, keeps the files of now as a version, the next back goes further', async () => {
  const dir = tmp()
  const root = path.join(dir, 'anim', 'bar')
  mkdirSync(root, { recursive: true })
  writeFileSync(path.join(root, 'index.html'), 'one')
  const k = new VersionKeeper(root, 1e9)
  try {
    await k.settle()
    writeFileSync(path.join(root, 'index.html'), 'two')
    await k.settle() // version 1 = one
    writeFileSync(path.join(root, 'index.html'), 'three')
    writeFileSync(path.join(root, 'extra.js'), 'x')
    await k.settle() // version 2 = two
    assert.deepEqual(await k.info(), { count: 2, next: 2, over: false })
    const r = await k.back()
    assert.equal(r.n, 2)
    assert.equal(r.saved, 3, 'the files of now are version 3')
    assert.equal(readFileSync(path.join(root, 'index.html'), 'utf8'), 'two')
    assert.equal(existsSync(path.join(root, 'extra.js')), false, 'a text file the version did not have goes (it is in version 3)')
    assert.equal(readFileSync(path.join(root, VERSION_DIR, '3', 'extra.js'), 'utf8'), 'x')
    assert.equal(await k.settle(), null, 'putting a version back is not a new version')
    assert.deepEqual(await k.info(), { count: 3, next: 1, over: false })
    await k.back()
    assert.equal(readFileSync(path.join(root, 'index.html'), 'utf8'), 'one')
    assert.deepEqual(await k.info(), { count: 3, next: null, over: false })
    await assert.rejects(k.back(), /no earlier version/)
    // A change by someone again: back starts from the newest version.
    writeFileSync(path.join(root, 'index.html'), 'four')
    assert.equal(await k.settle(), 4)
    assert.deepEqual(await k.info(), { count: 4, next: 4, over: false })
  } finally {
    k.stop()
    rmSync(dir, { recursive: true, force: true })
  }
})

test('versions: a folder over 2 MB of text keeps no version', async () => {
  const dir = tmp()
  const root = path.join(dir, 'anim', 'big')
  mkdirSync(root, { recursive: true })
  writeFileSync(path.join(root, 'index.html'), 'x'.repeat(2 * 1024 * 1024 + 10))
  const k = new VersionKeeper(root, 1e9)
  try {
    await k.settle()
    writeFileSync(path.join(root, 'index.html'), 'small')
    assert.equal(await k.settle(), null)
    assert.deepEqual(await versionNumbers(root), [])
  } finally {
    k.stop()
    rmSync(dir, { recursive: true, force: true })
  }
})

test('code_clip folder: anim\\<name>\\ beside the saved project, an empty transparent page, never written over', async () => {
  const dir = tmp()
  try {
    const proj = path.join(dir, 'film.snipp')
    await assert.rejects(makeAnimFolder(proj, 'intro'), /save the project first/)
    writeFileSync(proj, '{}')
    await assert.rejects(makeAnimFolder(proj, '../x'), /name/)
    await assert.rejects(makeAnimFolder(proj, ''), /name/)
    const r = await makeAnimFolder(proj, 'intro')
    assert.equal(r.folder, path.join(dir, 'anim', 'intro'))
    assert.equal(r.existed, false)
    assert.equal(readFileSync(path.join(r.folder, 'index.html'), 'utf8'), EMPTY_PAGE)
    assert.doesNotMatch(EMPTY_PAGE, /background/, 'no ground set: transparent by default')
    writeFileSync(path.join(r.folder, 'index.html'), 'the agent wrote this')
    const again = await makeAnimFolder(proj, 'intro')
    assert.equal(again.existed, true)
    assert.equal(readFileSync(path.join(r.folder, 'index.html'), 'utf8'), 'the agent wrote this')
    assert.deepEqual(readdirSync(path.join(dir, 'anim')), ['intro'])
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
