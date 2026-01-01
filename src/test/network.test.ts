// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
import assert from 'node:assert/strict'
import test from 'node:test'
import { isAllowedAppRequest } from '../main/network'

test('packaged renderer and Whisper worker cannot request any internet origin', () => {
  assert.equal(isAllowedAppRequest('https://huggingface.co/onnx-community/whisper-medium-ONNX'), false)
  assert.equal(isAllowedAppRequest('https://cdn.jsdelivr.net/npm/onnxruntime-web'), false)
  assert.equal(isAllowedAppRequest('http://127.0.0.1:4173/'), false)
  assert.equal(isAllowedAppRequest('ws://localhost:5173/'), false)
  // (Its own page, when the app's own folder is named: security patch, item 4.)
  assert.equal(isAllowedAppRequest('file:///C:/Snipp/resources/app.asar/out/renderer/index.html', undefined, 'file:///C:/Snipp/resources/app.asar/out/renderer/', 'win32'), true)
  assert.equal(isAllowedAppRequest('file:///C:/Snipp/resources/app.asar/out/renderer/index.html'), false)
  assert.equal(isAllowedAppRequest('file://remote.example/share/model.onnx'), false)
  assert.equal(isAllowedAppRequest('media://local/image.png'), true)
  assert.equal(isAllowedAppRequest('blob:null/abc'), true)
})

test('development allows only the exact loopback origin, not lookalike hosts', () => {
  const dev = 'http://localhost:5173/'
  assert.equal(isAllowedAppRequest('http://localhost:5173/src/main.tsx', dev), true)
  assert.equal(isAllowedAppRequest('ws://localhost:5173/', dev), true)
  assert.equal(isAllowedAppRequest('http://localhost:5174/', dev), false)
  assert.equal(isAllowedAppRequest('http://localhost.evil.example:5173/', dev), false)
  assert.equal(isAllowedAppRequest('https://huggingface.co/', dev), false)
  assert.equal(isAllowedAppRequest('http://localhost:5173/', 'http://remote.example:5173/'), false)
})
