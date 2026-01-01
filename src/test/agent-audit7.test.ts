// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// SnippStudio phase 7 audit patch (tarifler\FAZ7-YAMA.md): S1, S2, each
// test written before its repair (M1, way D's line, went with way D:
// TERMINAL-YOK-PLAN.md). (M3, M4, M7, M8, S3: agent-audit7-*.test.ts.)
import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { cellWidth, gridOf, sheetWidth } from '../renderer/src/agent/frames'
import { agentVersion, stopVersionQueries, versionQueriesRunning } from '../main/agent-connect'

// ---- S1: the frame width setting must not grow a grid ------------------------

test('S1: without a width, the setting is one frame\'s width and a grid shrinks it in proportion', () => {
  // The default setting (512) gives every n the size it had before phase 7.
  const before: Record<number, number> = { 1: 512, 2: 384, 4: 320, 9: 256, 12: 224 }
  for (const n of [1, 2, 4, 9, 12]) {
    assert.equal(sheetWidth(n, undefined, '512'), before[n], `${n} frames at 512`)
    assert.equal(sheetWidth(n, undefined, '384'), Math.round(gridOf(n).cell * 384 / 512), `${n} frames at 384`)
    assert.equal(sheetWidth(n, undefined, '768'), Math.round(gridOf(n).cell * 768 / 512), `${n} frames at 768`)
  }
  assert.equal(sheetWidth(1, undefined, '384'), 384)
  assert.equal(sheetWidth(1, undefined, '768'), 768)
  assert.equal(sheetWidth(12, undefined, '384'), 168)
  // An explicit width in the call always wins.
  for (const n of [1, 2, 12]) for (const s of ['384', '512', '768']) assert.equal(sheetWidth(n, 700, s), 700)
  // A setting that is not one of the three is the default.
  for (const bad of [0, 99999, 'abc', '', null, undefined, '600', 512.5]) {
    for (const n of [1, 4, 12]) assert.equal(sheetWidth(n, undefined, bad), before[n], `${String(bad)} with ${n} frames`)
  }
  // The n = 2 sheet the auditor measured before phase 7: 2 cells of 384.
  assert.equal(2 * cellWidth(2, sheetWidth(2, undefined, '512'), 16 / 9, 1_200_000) + 2, 770)
})

// ---- S2: a version query does not outlive the app ---------------------------

const aliveP = (pid: number): boolean => {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}
const until = async (what: string, ok: () => boolean, ms = 8_000): Promise<void> => {
  const end = Date.now() + ms
  while (!ok()) {
    if (Date.now() > end) throw new Error('timed out: ' + what)
    await new Promise((r) => setTimeout(r, 50))
  }
}

test('S2: a hanging version query is ended with its tree when its window closes or the app quits', { skip: process.platform !== 'win32' }, async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'snipp hang '))
  const before = process.env.SNIPP_TEST_NODE
  process.env.SNIPP_TEST_NODE = process.execPath
  try {
    const shim = path.join(dir, 'claude.cmd')
    writeFileSync(shim, '@echo off\r\n"%SNIPP_TEST_NODE%" "%~dp0hang.cjs" %*\r\n')
    writeFileSync(path.join(dir, 'hang.cjs'), 'require("fs").writeFileSync(require("path").join(__dirname, "pid-" + process.pid), ""); setInterval(() => {}, 1000)')
    const pids = (): number[] => readdirSync(dir).filter((f) => f.startsWith('pid-')).map((f) => Number(f.slice(4)))
    // The owner window closes: only its query ends.
    const a = agentVersion({ id: 'claude', path: shim }, dir, 7)
    await until('the first hanging query started', () => pids().length === 1)
    assert.equal(versionQueriesRunning(), 1)
    assert.equal(stopVersionQueries(8), 0, 'another window\'s close leaves it')
    assert.equal(stopVersionQueries(7), 1)
    assert.equal(await a, null)
    await until('the first query\'s node gone', () => !aliveP(pids()[0]), 3_000)
    // The app quits (will-quit: every query).
    const b = agentVersion({ id: 'claude', path: shim }, dir, 9)
    await until('the second hanging query started', () => pids().length === 2)
    const second = pids().find((p) => aliveP(p))!
    const t0 = Date.now()
    assert.equal(stopVersionQueries(), 1)
    assert.equal(await b, null)
    await until('the second query\'s node gone', () => !aliveP(second), 3_000)
    assert.ok(Date.now() - t0 < 3_000)
    assert.equal(versionQueriesRunning(), 0)
  } finally {
    if (before === undefined) delete process.env.SNIPP_TEST_NODE
    else process.env.SNIPP_TEST_NODE = before
    rmSync(dir, { recursive: true, force: true })
  }
})
