// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// Phase 9a, decision 3: the first start of a new profile folder copies the
// older app's projects list, shortcuts and interface settings, once; the older
// folder is never written; the agent's token and the restore points stay.
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { inheritProfile, INHERITED_ITEMS, MARKER, pickSource, profileIsNew } from '../main/profile-inherit'
import { INHERIT_FROM } from '../shared/product'

/** Every file under a folder with its bytes and time (to see nothing changed). */
function snapshot(dir: string): Record<string, string> {
  const out: Record<string, string> = {}
  const walk = (d: string): void => {
    for (const e of readdirSync(d)) {
      const p = path.join(d, e)
      const s = statSync(p)
      if (s.isDirectory()) walk(p)
      else out[path.relative(dir, p)] = `${s.size}:${s.mtimeMs}:${readFileSync(p).toString('base64')}`
    }
  }
  walk(dir)
  return out
}

/** An older profile with the user's setup and the things never copied. */
function oldProfile(appData: string, name: string, recents = '[{"path":"C:\\\\v\\\\a.snipp"}]'): string {
  const dir = path.join(appData, name)
  mkdirSync(path.join(dir, 'Local Storage', 'leveldb'), { recursive: true })
  writeFileSync(path.join(dir, 'recents.json'), recents)
  writeFileSync(path.join(dir, 'Local Storage', 'leveldb', '000003.log'), 'autocut-shortcuts=...')
  writeFileSync(path.join(dir, 'Local Storage', 'leveldb', 'LOCK'), '')
  writeFileSync(path.join(dir, 'agent.json'), '{"token":"secret"}')
  mkdirSync(path.join(dir, 'agent-restore'), { recursive: true })
  writeFileSync(path.join(dir, 'agent-restore', 'p1.json'), '{}')
  mkdirSync(path.join(dir, 'whisper-models'), { recursive: true })
  return dir
}

test('the older folders are "Snipp Dev" and "Snipp", and the copy is only the user\'s setup', () => {
  assert.deepEqual([...INHERIT_FROM], ['Snipp Dev', 'Snipp'])
  assert.deepEqual([...INHERITED_ITEMS], ['recents.json', 'Local Storage'])
})

test('a new profile gets the setup of the older app; the older folder is not written', () => {
  const appData = mkdtempSync(path.join(tmpdir(), 'inherit-'))
  try {
    const old = oldProfile(appData, 'Snipp Dev')
    const before = snapshot(old)
    const target = path.join(appData, 'SnippStudio Dev')
    assert.equal(profileIsNew(target), true)
    const r = inheritProfile(target, appData, INHERIT_FROM)
    assert.deepEqual(r, { from: 'Snipp Dev', copied: ['recents.json', 'Local Storage'] })
    assert.equal(readFileSync(path.join(target, 'recents.json'), 'utf8'), readFileSync(path.join(old, 'recents.json'), 'utf8'))
    assert.ok(existsSync(path.join(target, 'Local Storage', 'leveldb', '000003.log')))
    // Never: the token, the restore points, models, Chromium's lock.
    assert.equal(existsSync(path.join(target, 'agent.json')), false)
    assert.equal(existsSync(path.join(target, 'agent-restore')), false)
    assert.equal(existsSync(path.join(target, 'whisper-models')), false)
    assert.equal(existsSync(path.join(target, 'Local Storage', 'leveldb', 'LOCK')), false)
    // The older folder: byte for byte, time for time, as it was.
    assert.deepEqual(snapshot(old), before)
    // Once: the marker says it was done, a second start copies nothing.
    assert.ok(existsSync(path.join(target, MARKER)))
    writeFileSync(path.join(old, 'recents.json'), '[]')
    assert.equal(inheritProfile(target, appData, INHERIT_FROM), null)
    assert.notEqual(readFileSync(path.join(target, 'recents.json'), 'utf8'), '[]')
  } finally {
    rmSync(appData, { recursive: true, force: true })
  }
})

test('a profile in use is never written over, and with no older folder nothing happens', () => {
  const appData = mkdtempSync(path.join(tmpdir(), 'inherit-'))
  try {
    oldProfile(appData, 'Snipp')
    // In use: it has its own recents (no marker: made before this phase).
    const used = path.join(appData, 'SnippStudio')
    mkdirSync(used, { recursive: true })
    writeFileSync(path.join(used, 'recents.json'), '[]')
    assert.equal(profileIsNew(used), false)
    assert.equal(inheritProfile(used, appData, INHERIT_FROM), null)
    assert.equal(readFileSync(path.join(used, 'recents.json'), 'utf8'), '[]')
    // Nothing older beside it: no copy, but the marker (it is not asked again).
    const lone = mkdtempSync(path.join(tmpdir(), 'inherit-lone-'))
    try {
      const target = path.join(lone, 'SnippStudio')
      assert.equal(inheritProfile(target, lone, INHERIT_FROM), null)
      assert.ok(existsSync(path.join(target, MARKER)))
      assert.equal(profileIsNew(target), false)
    } finally {
      rmSync(lone, { recursive: true, force: true })
    }
  } finally {
    rmSync(appData, { recursive: true, force: true })
  }
})

test('of two older folders, the one used last; never the new folder itself', () => {
  const appData = mkdtempSync(path.join(tmpdir(), 'inherit-'))
  try {
    const dev = oldProfile(appData, 'Snipp Dev', '["dev"]')
    const rel = oldProfile(appData, 'Snipp', '["release"]')
    const old = new Date('2026-01-01T00:00:00Z')
    const recent = new Date('2026-11-01T00:00:00Z')
    for (const i of INHERITED_ITEMS) {
      utimesSync(path.join(dev, i), old, old)
      utimesSync(path.join(rel, i), recent, recent)
    }
    assert.equal(pickSource(appData, INHERIT_FROM, path.join(appData, 'SnippStudio')), 'Snipp')
    for (const i of INHERITED_ITEMS) utimesSync(path.join(dev, i), recent, recent)
    // A tie: the first named ("Snipp Dev", the daily copy of the last weeks).
    assert.equal(pickSource(appData, INHERIT_FROM, path.join(appData, 'SnippStudio')), 'Snipp Dev')
    assert.equal(pickSource(appData, ['Snipp Dev'], dev), null)
    const r = inheritProfile(path.join(appData, 'SnippStudio'), appData, INHERIT_FROM)
    assert.equal(r?.from, 'Snipp Dev')
    assert.equal(readFileSync(path.join(appData, 'SnippStudio', 'recents.json'), 'utf8'), '["dev"]')
  } finally {
    rmSync(appData, { recursive: true, force: true })
  }
})
