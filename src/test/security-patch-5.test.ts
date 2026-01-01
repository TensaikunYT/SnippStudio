// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// Security patch, item 5 (K-G3): a link (junction, symbolic link) planted as
// `anim\<name>` or as `anim` itself in a project folder must not take the
// code_clip tool's new folder, the code templates or the version keeper
// outside the project folder. On the real disk, in throw-away folders.
import assert from 'node:assert/strict'
import test from 'node:test'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { keepVersions, makeAnimFolder, stopVersionKeepers, VERSION_DIR, VersionKeeper } from '../main/codefilm-versions'
import { addCodeTemplate } from '../main/code-templates'

interface World {
  root: string
  proj: string
  file: string
  outside: string
}

function world(): World {
  const root = mkdtempSync(path.join(tmpdir(), 'snipp-g5-'))
  const proj = path.join(root, 'kotu proje')
  const outside = path.join(root, 'outside')
  mkdirSync(proj)
  mkdirSync(outside)
  const file = path.join(proj, 'p.snipp')
  writeFileSync(file, '{}')
  return { root, proj, file, outside }
}

/** A directory link that needs no special right on Windows (a junction). */
const link = (target: string, at: string): void => symlinkSync(target, at, 'junction')

test('item 5: code_clip create writes nothing through a linked anim\\<name>', async () => {
  const w = world()
  try {
    mkdirSync(path.join(w.proj, 'anim'))
    link(w.outside, path.join(w.proj, 'anim', 'evil'))
    await assert.rejects(makeAnimFolder(w.file, 'evil'), /outside the project folder/)
    assert.deepEqual(readdirSync(w.outside), [], 'nothing was written outside')
    // (A plain folder beside it still works.)
    const ok = await makeAnimFolder(w.file, 'intro')
    assert.equal(ok.existed, false)
    assert.ok(existsSync(path.join(w.proj, 'anim', 'intro', 'index.html')))
  } finally {
    rmSync(w.root, { recursive: true, force: true })
  }
})

test('item 5: code_clip create and a code template write nothing through a linked anim', async () => {
  const w = world()
  try {
    link(w.outside, path.join(w.proj, 'anim'))
    await assert.rejects(makeAnimFolder(w.file, 'x'), /outside the project folder/)
    assert.deepEqual(readdirSync(w.outside), [], 'no folder was made outside')
    // The template copy goes the same way.
    const templates = path.join(w.root, 'templates')
    mkdirSync(path.join(templates, 'blank'), { recursive: true })
    writeFileSync(path.join(templates, 'blank', 'index.html'), '<!doctype html>')
    await assert.rejects(addCodeTemplate(templates, w.file, 'blank'), /outside the project folder/)
    assert.deepEqual(readdirSync(w.outside), [])
  } finally {
    rmSync(w.root, { recursive: true, force: true })
  }
})

test('item 5: a link that stays inside the project folder is still the project\'s own', async () => {
  const w = world()
  try {
    const real = path.join(w.proj, 'pages', 'a')
    mkdirSync(real, { recursive: true })
    mkdirSync(path.join(w.proj, 'anim'))
    link(real, path.join(w.proj, 'anim', 'a'))
    const r = await makeAnimFolder(w.file, 'a')
    assert.equal(r.existed, false)
    assert.ok(existsSync(path.join(real, 'index.html')))
  } finally {
    rmSync(w.root, { recursive: true, force: true })
  }
})

test('item 5: no versions are kept for a linked anim\\<name> that leads outside', async () => {
  const w = world()
  try {
    mkdirSync(path.join(w.proj, 'anim'))
    writeFileSync(path.join(w.outside, 'index.html'), '<!doctype html><p>theirs</p>')
    writeFileSync(path.join(w.outside, 'notes.txt'), 'a private note')
    link(w.outside, path.join(w.proj, 'anim', 'evil'))
    assert.equal(keepVersions(path.join(w.proj, 'anim', 'evil'), w.file), null)
    // The project's own folder still gets its keeper, and a missing one none.
    mkdirSync(path.join(w.proj, 'anim', 'own'))
    assert.ok(keepVersions(path.join(w.proj, 'anim', 'own'), w.file))
    assert.equal(keepVersions(path.join(w.proj, 'anim', 'none'), w.file), null)
    await new Promise((r) => setTimeout(r, 50))
    assert.equal(existsSync(path.join(w.outside, VERSION_DIR)), false)
  } finally {
    stopVersionKeepers()
    rmSync(w.root, { recursive: true, force: true })
  }
})

test('item 5: a linked .surumler inside a code clip gets no copy and nothing is pruned through it', async () => {
  const w = world()
  try {
    const clip = path.join(w.proj, 'anim', 'own')
    mkdirSync(clip, { recursive: true })
    writeFileSync(path.join(clip, 'index.html'), '<!doctype html><p>one</p>')
    // Twelve numbered folders outside: a keeper that followed the link would
    // take them for old versions and remove the oldest.
    for (let n = 1; n <= 12; n++) mkdirSync(path.join(w.outside, String(n)))
    link(w.outside, path.join(clip, VERSION_DIR))
    const keeper = new VersionKeeper(clip, 20)
    try {
      // (The keeper has read the folder as it is: twelve "versions", it thinks.)
      assert.equal((await keeper.info()).count, 12)
      writeFileSync(path.join(clip, 'index.html'), '<!doctype html><p>two</p>')
      await assert.rejects(keeper.settle(), /outside the project folder/)
      await assert.rejects(keeper.back(), /outside the project folder/)
      assert.deepEqual(readdirSync(w.outside).sort((a, b) => +a - +b), Array.from({ length: 12 }, (_, i) => String(i + 1)), 'the folders outside are as they were')
    } finally {
      keeper.stop()
    }
  } finally {
    rmSync(w.root, { recursive: true, force: true })
  }
})
