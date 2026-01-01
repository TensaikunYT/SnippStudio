// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// Each kind of selection opens its main card (son, item A): a clip its
// Transform, a code clip its code film (the values live there), an audio
// clip its sound level, a text its text, Style and Motion, a caption line
// its text; nothing else starts open.
import assert from 'node:assert/strict'
import test from 'node:test'
import { clipScopeKind, SCOPE_OPEN, scopeOf } from '../renderer/src/components/inspector/scopes'

test('a selected clip is scoped by its file kind', () => {
  assert.equal(clipScopeKind('code'), 'code')
  assert.equal(clipScopeKind('audio'), 'audio')
  assert.equal(clipScopeKind('video'), 'clip')
  assert.equal(clipScopeKind('image'), 'clip')
  assert.equal(clipScopeKind(undefined), 'clip')
})

test('each kind opens its main card', () => {
  assert.ok(SCOPE_OPEN.clip.includes('Clip'))
  assert.ok(!SCOPE_OPEN.clip.includes('Audio') && !SCOPE_OPEN.clip.includes('Speed'))
  assert.ok(SCOPE_OPEN.code.includes('Code film') && SCOPE_OPEN.code.includes('Clip'))
  assert.ok(SCOPE_OPEN.audio.includes('Audio'))
  for (const id of ['Selected text (manual)', 'Style', 'Motion']) assert.ok(SCOPE_OPEN.text.includes(id), id)
  assert.ok(SCOPE_OPEN.line.includes('This line'))
  for (const k of Object.keys(SCOPE_OPEN) as (keyof typeof SCOPE_OPEN)[]) {
    assert.ok(!SCOPE_OPEN[k].includes('Keyframes'), `${k}: Keyframes folded`)
    assert.ok(!SCOPE_OPEN[k].includes('Effects'), `${k}: Effects folded`)
  }
})

test('each kind remembers its own cards', () => {
  assert.equal(scopeOf('code').name, 'insp.code')
  assert.equal(scopeOf('audio').name, 'insp.audio')
  assert.notEqual(scopeOf('code').name, scopeOf('clip').name)
})
