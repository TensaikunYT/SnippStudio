// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
import assert from 'node:assert/strict'
import test from 'node:test'
import { appendAwakeSwitches, AwakeHolds, withFeatures } from '../main/awake'

test('a feature list keeps what was there and adds each feature once', () => {
  assert.equal(withFeatures('', ['SharedArrayBuffer']), 'SharedArrayBuffer')
  assert.equal(withFeatures('CalculateNativeWinOcclusion', ['CalculateNativeWinOcclusion']), 'CalculateNativeWinOcclusion')
  assert.equal(withFeatures('A, B,,', ['B', 'C']), 'A,B,C')
})

test('every awake switch is appended, one value per feature switch', () => {
  // A script may start the dev app with its own --disable-features.
  const switches = new Map<string, string>([['disable-features', 'Foo']])
  appendAwakeSwitches({
    appendSwitch: (name, value) => void switches.set(name, value ?? ''),
    getSwitchValue: (name) => switches.get(name) ?? ''
  })
  assert.equal(switches.get('disable-features'), 'Foo,CalculateNativeWinOcclusion')
  assert.equal(switches.get('enable-features'), 'SharedArrayBuffer')
  for (const s of ['disable-renderer-backgrounding', 'disable-background-timer-throttling', 'disable-backgrounding-occluded-windows']) assert.ok(switches.has(s), s)
})

test('one system blocker while anyone holds the PC awake', () => {
  const log: string[] = []
  let next = 7
  const holds = new AwakeHolds(
    () => (log.push('start'), next++),
    (id) => void log.push(`stop ${id}`)
  )
  holds.set(1, false, 'export') // a release with nothing held
  assert.equal(holds.awake, false)
  holds.set(1, true, 'export')
  holds.set(1, true, 'transcription')
  holds.set(2, true, 'export')
  assert.deepEqual(log, ['start'])
  holds.set(1, false, 'export')
  holds.set(2, false, 'export')
  assert.equal(holds.awake, true)
  holds.set(1, false, 'transcription')
  assert.equal(holds.awake, false)
  assert.deepEqual(log, ['start', 'stop 7'])
  // Two exports in one window: both must end before it may sleep again.
  holds.set(1, true, 'export')
  holds.set(1, true, 'export')
  holds.set(1, false, 'export')
  assert.equal(holds.awake, true)
  holds.set(1, false, 'export')
  assert.deepEqual(log, ['start', 'stop 7', 'start', 'stop 8'])
})

test('a page that goes away lets go of all its holds', () => {
  const holds = new AwakeHolds(() => 1, () => {})
  holds.set(3, true, 'export')
  holds.set(3, true, 'transcription')
  holds.set(4, true, 'export')
  holds.release(3)
  assert.equal(holds.awake, true)
  holds.release(4)
  assert.equal(holds.awake, false)
  holds.release(4)
  assert.equal(holds.awake, false)
})
