// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// Phase 10b.1 (FAZ10-PLAN.md; report M1-M2): the codec an export and a
// preview proxy use, from what this computer's encoders can do. With both
// encoders (Windows before and after phase 10, a Mac) every container is
// the one asked for.
import assert from 'node:assert/strict'
import test from 'node:test'
import { pickAudioCodec, pickExportFormat, pickProxyCodecs, pickVideoCodec } from '../renderer/src/export/codec-pick'
import { EXPORT_FORMATS, type ExportContainer } from '../renderer/src/export/formats'

const BOTH = { canAac: true, canAvc: true }

test('pickAudioCodec: the table', () => {
  const rows: [ExportContainer, boolean, string][] = [
    ['mp4', true, 'mp4 aac'],
    ['mp4', false, 'webm opus noAac'],
    ['m4a', true, 'm4a aac'],
    ['m4a', false, 'mp3 mp3 noAac'],
    ['webm', true, 'webm opus'],
    ['webm', false, 'webm opus'],
    ['mp3', false, 'mp3 mp3'],
    ['wav', false, 'wav pcm']
  ]
  for (const [container, canAac, want] of rows) {
    const p = pickAudioCodec({ canAac, container })
    assert.equal([p.container, p.audio, p.reason].filter(Boolean).join(' '), want, `${container} canAac=${canAac}`)
  }
})

test('pickVideoCodec: the table', () => {
  assert.deepEqual(pickVideoCodec({ canAvc: true, container: 'mp4' }), { container: 'mp4', video: 'avc' })
  assert.deepEqual(pickVideoCodec({ canAvc: false, container: 'mp4' }), { container: 'webm', video: 'vp9', reason: 'noAvc' })
  assert.deepEqual(pickVideoCodec({ canAvc: true, container: 'webm' }), { container: 'webm', video: 'vp9' })
  assert.deepEqual(pickVideoCodec({ canAvc: false, container: 'webm' }), { container: 'webm', video: 'vp9' })
})

test('pickExportFormat: with both encoders every format is the one asked for (Windows unchanged)', () => {
  for (const f of EXPORT_FORMATS) assert.deepEqual(pickExportFormat(f.id, BOTH), { container: f.id, reasons: [] }, f.id)
})

test('pickExportFormat: without AAC or H.264 an MP4 is a WebM, an M4A an MP3, with the reasons', () => {
  assert.deepEqual(pickExportFormat('mp4', { canAac: false, canAvc: true }), { container: 'webm', reasons: ['noAac'] })
  assert.deepEqual(pickExportFormat('mp4', { canAac: true, canAvc: false }), { container: 'webm', reasons: ['noAvc'] })
  assert.deepEqual(pickExportFormat('mp4', { canAac: false, canAvc: false }), { container: 'webm', reasons: ['noAvc'] }, 'the WebM needs no AAC: one reason')
  assert.deepEqual(pickExportFormat('m4a', { canAac: false, canAvc: false }), { container: 'mp3', reasons: ['noAac'] })
  assert.deepEqual(pickExportFormat('wav', { canAac: false, canAvc: false }), { container: 'wav', reasons: [] })
  assert.deepEqual(pickExportFormat('webm', { canAac: false, canAvc: false }), { container: 'webm', reasons: [] })
  // Applied twice it stays (the window applies it on every change).
  for (const f of EXPORT_FORMATS)
    for (const caps of [BOTH, { canAac: false, canAvc: true }, { canAac: true, canAvc: false }, { canAac: false, canAvc: false }]) {
      const once = pickExportFormat(f.id, caps)
      assert.deepEqual(pickExportFormat(once.container, caps), { container: once.container, reasons: [] })
    }
})

test('pickProxyCodecs: H.264 + AAC in MP4 as before, else VP9 + Opus in WebM', () => {
  assert.deepEqual(pickProxyCodecs(BOTH), { container: 'mp4', video: 'avc', audio: 'aac' })
  assert.deepEqual(pickProxyCodecs({ canAac: false, canAvc: true }), { container: 'webm', video: 'vp9', audio: 'opus' })
  assert.deepEqual(pickProxyCodecs({ canAac: true, canAvc: false }), { container: 'webm', video: 'vp9', audio: 'opus' })
})
