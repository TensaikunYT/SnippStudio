// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// Phase Ç3 patch (haritalar/_fazc3-denetim-goruntu.md G-1, G-5): when the
// graphics card's encoder fails on a configuration, the answer "hardware
// works" kept for the session is dropped for it: the next export of it asks
// the software encoder only. Which errors count as the encoder's.
import assert from 'node:assert/strict'
import test from 'node:test'
import * as enc from '../renderer/src/export/encoder'

const choice: enc.VideoChoice = { codec: 'avc', width: 1920, height: 1080, fps: 30, bitrate: 8_000_000 }

test('G-1/G-5: after the hardware encoder failed on a choice, the session\'s answer for it is the software encoder', async () => {
  const asked: string[] = []
  const g = globalThis as unknown as { VideoEncoder?: unknown }
  const before = g.VideoEncoder
  g.VideoEncoder = { isConfigSupported: async (c: VideoEncoderConfig) => (asked.push(String(c.hardwareAcceleration)), { supported: true }) }
  try {
    enc.forgetEncoderAnswers()
    assert.equal((await enc.probeEncoder(choice)).hw, 'prefer-hardware')
    assert.equal((await enc.probeEncoder(choice)).hw, 'prefer-hardware', 'kept for the session')
    assert.deepEqual(asked, ['prefer-hardware'], 'asked once')
    const mark = (enc as unknown as { markHardwareFailed?: (c: enc.VideoChoice) => void }).markHardwareFailed
    mark?.(choice)
    const after = await enc.probeEncoder(choice)
    assert.equal(after.hw, 'prefer-software', 'the next export runs on the software encoder')
    assert.equal(after.ok, true)
    assert.deepEqual(asked, ['prefer-hardware', 'prefer-software'], 'the hardware encoder is not asked again')
    assert.equal((enc as unknown as { hardwareFailed?: (c: enc.VideoChoice) => boolean }).hardwareFailed?.(choice), true, 'and it says why')
    // Another choice is not touched.
    assert.equal((await enc.probeEncoder({ ...choice, fps: 60 })).hw, 'prefer-hardware')
  } finally {
    enc.forgetEncoderAnswers()
    g.VideoEncoder = before
  }
})

test('G-1: an encoder\'s error counts as the encoder failing; a Cancel or a disk error does not', () => {
  const is = (enc as unknown as { isEncoderFault?: (e: unknown) => boolean }).isEncoderFault
  assert.ok(is, 'isEncoderFault exists')
  assert.equal(is!(new DOMException('Encoding failed.', 'EncodingError')), true)
  assert.equal(is!(new DOMException('Encoder failure', 'OperationError')), true)
  assert.equal(is!(new Error('VideoEncoder error: the codec was reclaimed')), true)
  assert.equal(is!(new DOMException('Export cancelled', 'AbortError')), false)
  assert.equal(is!(new Error("Error invoking remote method 'file:stream-write': Error: ENOSPC: no space left on device, write")), false)
  assert.equal(is!(new Error('The disk is full: the video could not be written.')), false)
})
