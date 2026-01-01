// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// Phase 5e + 5f audit patch (tarifler\FAZ5-YAMA-EF.md) O2: the values a
// page is opened with never drop silently. The project look always goes; a
// text too long is cut, and values that do not fit together are cut (the
// longest first) — what the Inspector shows is what the page gets.
import './dom-stub'
import assert from 'node:assert/strict'
import test from 'node:test'
import * as P from '../renderer/src/media/codefilm-params'
import { useStore } from '../renderer/src/state/store'
import { defaultProject, type Asset } from '../renderer/src/types'

const { readValuesQuery, valuesQuery } = P
const fitted = (P as unknown as { fittedValues?: (v: Record<string, unknown> | undefined, l: unknown) => { v: Record<string, string | number>; cut: string[] } }).fittedValues
const LOOK = { accent: '#00ff00', font: 'Inter' }

test('O2: nine texts 2000 long each, the look and every value still reach the page (cut to fit, said)', () => {
  const values: Record<string, string | number> = { n: 5 }
  for (let i = 0; i < 9; i++) values[`t${i}`] = String.fromCharCode(97 + i).repeat(2000)
  const q = valuesQuery(values, LOOK)
  assert.notEqual(q, '', 'the query is not dropped whole')
  const back = readValuesQuery('?' + q)!
  assert.deepEqual(back.l, LOOK, 'the look always goes')
  assert.equal(back.v?.n, 5)
  for (let i = 0; i < 9; i++) assert.equal(typeof back.v?.[`t${i}`], 'string', `t${i} is there`)
  assert.ok(q.length < 24_000)
  assert.ok(fitted, 'fittedValues: what the Inspector shows')
  const f = fitted!(values, LOOK)
  assert.deepEqual(back.v, f.v, 'the Inspector shows what the page gets')
  assert.ok(f.cut.length > 0, 'the cut ones are named')
})

test('O2: one text over 2000 characters is cut, not dropped; four texts of 1000 emoji keep the look', () => {
  const back = readValuesQuery('?' + valuesQuery({ title: 'x'.repeat(2500) }, null))!
  assert.equal(back.v?.title, 'x'.repeat(2000))
  const emoji: Record<string, string> = {}
  for (let i = 0; i < 4; i++) emoji[`e${i}`] = '🎬'.repeat(1000)
  const q = valuesQuery(emoji, LOOK)
  assert.notEqual(q, '')
  assert.deepEqual(readValuesQuery('?' + q)!.l, LOOK)
})

test('O2: a value is kept at most 2000 characters (the command cuts it)', () => {
  const p = defaultProject()
  p.assets = [{ id: 'f', kind: 'code', name: 'f', url: 'snippfilm://f/', size: 0, duration: 4, width: 640, height: 360, hasAudio: false, code: { fps: 30 } } as Asset]
  useStore.getState().loadProject(p)
  useStore.getState().setCodeParams('f', { t: 'y'.repeat(5000) })
  assert.equal(String(useStore.getState().project.assets[0].code?.params?.t).length, 2000)
})
