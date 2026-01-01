// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
import assert from 'node:assert/strict'
import test from 'node:test'
import { filterRecentEntries, isLocalFilePath, isModelStoreFile, isSafeOutput } from '../main/security'
import { developmentOrigin, isAllowedAppRequest, isTrustedDocument } from '../main/network'

test('offline paths reject SMB, device files, alternate streams and relative paths', () => {
  for (const p of ['\\\\server\\share\\sound.wav', '//server/share/file.png', '\\\\?\\UNC\\server\\share\\a.wav', '\\\\.\\C:', 'C:\\file.wav:secret', 'C:relative.wav', 'relative.wav', 'C:\\NUL.wav', 'C:\\a\u0000.wav']) {
    assert.equal(isLocalFilePath(p), false, p)
  }
  assert.equal(isLocalFilePath('C:\\Users\\u\\Video\\ses.wav'), true)
  assert.equal(isLocalFilePath('D:/Türkçe ses/1.wav'), true)
})

test('batch export cannot create an executable or shell-launchable script', () => {
  for (const ext of ['exe', 'dll', 'bat', 'cmd', 'ps1', 'lnk', 'url', 'hta', 'js', 'vbs', 'scr']) {
    assert.equal(isSafeOutput(`C:\\Export\\file.${ext}`), false, ext)
  }
  for (const ext of ['mp4', 'wav', 'snipp', 'srt', 'png']) assert.equal(isSafeOutput(`C:\\Export\\file.${ext}`), true)
})

test('renderer cannot grant itself file permissions by writing recent projects', () => {
  const entries = [{ path: 'C:\\allowed.snipp' }, { path: 'C:\\private.json' }, { path: '\\\\server\\share\\x.snipp' }]
  assert.deepEqual(filterRecentEntries(entries, p => p === 'C:\\allowed.snipp'), [entries[0]])
  assert.equal(filterRecentEntries({}, () => true), null)
})

test('model store accepts only supported Whisper files', () => {
  assert.equal(isModelStoreFile('huggingface.co_onnx-community_whisper-medium.en_timestamped_resolve_main_onnx_encoder_model.onnx'), true)
  for (const name of ['payload.exe', '..\\secret.json', 'config.json', 'huggingface.co_unknown_model_resolve_main_config.json']) assert.equal(isModelStoreFile(name), false)
})

test('release ignores dev environment and trusts only its exact UI document', () => {
  assert.equal(developmentOrigin(true, 'http://localhost:5173'), undefined)
  assert.equal(developmentOrigin(false, 'https://evil.example'), undefined)
  const entry = 'file:///C:/Snipp/resources/app.asar/out/renderer/index.html'
  assert.equal(isTrustedDocument(entry + '#editor', entry), true)
  assert.equal(isTrustedDocument('file:///C:/Users/Public/evil.html', entry), false)
  assert.equal(isTrustedDocument('http://localhost:5173.evil.example', entry, 'http://localhost:5173'), false)
  assert.equal(isAllowedAppRequest('file:////server/share/file.png'), false)
  assert.equal(isAllowedAppRequest('file://server/share/file.png'), false)
  assert.equal(isAllowedAppRequest('media://remote.example/a.png'), false)
})
