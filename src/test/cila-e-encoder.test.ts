// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// Cila E (CILA-O-PLAN.md K7): the export window's "Encoder: Automatic /
// Software". With Software the graphics card's encoder is never asked; its
// answer is kept apart from Automatic's; Automatic is as before.
import assert from 'node:assert/strict'
import test from 'node:test'
import * as enc from '../renderer/src/export/encoder'

const askLog = (supported: (hw: string) => boolean): { asked: string[]; restore: () => void } => {
  const asked: string[] = []
  const g = globalThis as unknown as { VideoEncoder?: unknown }
  const before = g.VideoEncoder
  g.VideoEncoder = { isConfigSupported: async (c: VideoEncoderConfig) => (asked.push(String(c.hardwareAcceleration)), { supported: supported(String(c.hardwareAcceleration)) }) }
  return { asked, restore: () => (g.VideoEncoder = before) }
}

test('Software: the hardware encoder is never asked, and the export runs on the software one', async () => {
  const log = askLog(() => true)
  try {
    enc.forgetEncoderAnswers()
    const soft = enc.videoChoice('avc', 1920, 1080, 30, 8_000_000, 'software')
    assert.equal(soft.software, true)
    const v = await enc.probeEncoder(soft)
    assert.deepEqual(v, { ok: true, hw: 'prefer-software' })
    assert.deepEqual(log.asked, ['prefer-software'], 'only the software encoder was asked')
    // The same size under Automatic is asked on its own (not the software answer kept).
    const auto = await enc.probeEncoder(enc.videoChoice('avc', 1920, 1080, 30, 8_000_000, 'auto'))
    assert.equal(auto.hw, 'prefer-hardware')
    assert.deepEqual(log.asked, ['prefer-software', 'prefer-hardware'])
    // And Software asked again is the kept answer: still no hardware question.
    await enc.probeEncoder(soft)
    assert.deepEqual(log.asked, ['prefer-software', 'prefer-hardware'])
  } finally {
    enc.forgetEncoderAnswers()
    log.restore()
  }
})

test('Software that the software encoder refuses is refused, without a word to the graphics card', async () => {
  const log = askLog((hw) => hw === 'prefer-hardware')
  try {
    enc.forgetEncoderAnswers()
    const v = await enc.probeEncoder(enc.videoChoice('vp9', 3840, 2160, 60, 60_000_000, 'software'))
    assert.equal(v.ok, false)
    assert.deepEqual(log.asked, ['prefer-software'])
  } finally {
    enc.forgetEncoderAnswers()
    log.restore()
  }
})

test('Automatic is the default and adds nothing to the choice (the encoder config is the same as before)', () => {
  const plain = enc.videoChoice('avc', 1280, 720, 30, 5_000_000)
  assert.deepEqual(plain, { codec: 'avc', width: 1280, height: 720, fps: 30, bitrate: 5_000_000 })
  assert.deepEqual(enc.encoderConfig(enc.videoChoice('avc', 1280, 720, 30, 5_000_000, 'software'), 'prefer-software'), enc.encoderConfig(plain, 'prefer-software'))
})
