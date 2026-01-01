// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// Phase Ç3a, decisions 1, 2 and 8: what the encoder is asked (and so what it
// encodes with), the bitrates' floors, the surfaces' sizes in final quality.
import assert from 'node:assert/strict'
import test from 'node:test'
import { avcLevel, encoderConfig, probeEncoder, videoCodecString, vp9Level, type VideoChoice } from '../renderer/src/export/encoder'
import { bitrateFloor, videoBitrateOf, QUALITY_HIGH_FACTOR, QUALITY_STANDARD, QUALITY_MAXIMUM } from '../renderer/src/export/quality'
import { drawQuality, lookCap, surfaceWidth, withDrawQuality } from '../renderer/src/playback/draw/quality'

test('the H.264 level counts the frame rate (report R28: 1080p60 is 4.2, 2160p60 5.2)', () => {
  assert.equal(avcLevel(1920, 1080, 30, 8e6), 40)
  assert.equal(avcLevel(1920, 1080, 60, 12e6), 42)
  assert.equal(avcLevel(1920, 1080, 50, 12e6), 42)
  assert.equal(avcLevel(2560, 1440, 30, 16e6), 50)
  assert.equal(avcLevel(2560, 1440, 60, 24e6), 51)
  assert.equal(avcLevel(3840, 2160, 30, 45e6), 51)
  assert.equal(avcLevel(3840, 2160, 60, 68e6), 52)
  assert.equal(avcLevel(3840, 2160, 50, 68e6), 52)
  assert.equal(avcLevel(2160, 3840, 60, 68e6), 52)
  assert.equal(avcLevel(1080, 1920, 60, 12e6), 42)
  assert.equal(avcLevel(960, 540, 60, 4e6), 32)
  // NTSC rates: 59.94 needs what 60 needs.
  assert.equal(avcLevel(1920, 1080, 60000 / 1001, 12e6), 42)
  // A bitrate over the level's (High: 1.25 × MaxBR) climbs a level.
  assert.equal(avcLevel(1920, 1080, 30, 30e6), 41)
  // mediabunny's choice for 1080p60 was 4.0 (avc1.640028).
  assert.equal(videoCodecString({ codec: 'avc', width: 1920, height: 1080, fps: 60, bitrate: 12e6 }), 'avc1.64002a')
  assert.equal(videoCodecString({ codec: 'avc', width: 3840, height: 2160, fps: 60, bitrate: 68e6 }), 'avc1.640034')
})

test('VP9 levels by picture size and sample rate', () => {
  assert.equal(vp9Level(1920, 1080, 30, 8e6), 40)
  assert.equal(vp9Level(1920, 1080, 60, 12e6), 41)
  assert.equal(vp9Level(3840, 2160, 30, 45e6), 50)
  assert.equal(vp9Level(3840, 2160, 60, 68e6), 51)
  assert.equal(videoCodecString({ codec: 'vp9', width: 3840, height: 2160, fps: 30, bitrate: 45e6 }), 'vp09.00.50.08')
})

test('the configuration asked is the one encoded with (the codec string, the encoder, the rate)', () => {
  const c: VideoChoice = { codec: 'avc', width: 3840, height: 2160, fps: 30, bitrate: 45e6 }
  const hw = encoderConfig(c, 'prefer-hardware')
  assert.deepEqual(hw, { codec: 'avc1.640033', width: 3840, height: 2160, bitrate: 45e6, framerate: 30, hardwareAcceleration: 'prefer-hardware', alpha: 'discard', avc: { format: 'avc' } })
  assert.equal(encoderConfig(c, 'prefer-software').hardwareAcceleration, 'prefer-software')
  assert.equal('avc' in encoderConfig({ ...c, codec: 'vp9' }, 'prefer-software'), false)
})

test('the encoder is asked twice: hardware, then software (said), else refused with the reason', async () => {
  const c: VideoChoice = { codec: 'vp9', width: 3840, height: 2160, fps: 30, bitrate: 45e6 }
  const asked: string[] = []
  const swOnly = await probeEncoder(c, async (cfg) => {
    asked.push(cfg.hardwareAcceleration!)
    return { supported: cfg.hardwareAcceleration === 'prefer-software' }
  })
  assert.deepEqual(asked, ['prefer-hardware', 'prefer-software'])
  assert.deepEqual(swOnly, { ok: true, hw: 'prefer-software' })
  const hwYes = await probeEncoder(c, async () => ({ supported: true }))
  assert.deepEqual(hwYes, { ok: true, hw: 'prefer-hardware' })
  const none = await probeEncoder({ ...c, codec: 'avc' }, async () => ({ supported: false }))
  assert.equal(none.ok, false)
  assert.equal(none.hw, null)
  assert.match(none.why!, /H\.264 at 3840 × 2160, 30 fps, 45\.0 Mbps/)
  // An encoder that throws counts as a no.
  const thrown = await probeEncoder(c, async (cfg) => {
    if (cfg.hardwareAcceleration === 'prefer-hardware') throw new Error('bad')
    return { supported: true }
  })
  assert.deepEqual(thrown, { ok: true, hw: 'prefer-software' })
})

test("High and Maximum never under YouTube's rates (decision 8); Standard as before", () => {
  assert.equal(bitrateFloor(1920, 1080, 30), 8e6)
  assert.equal(bitrateFloor(1920, 1080, 60), 12e6)
  assert.equal(bitrateFloor(3840, 2160, 30), 45e6)
  assert.equal(bitrateFloor(3840, 2160, 60), 68e6)
  assert.equal(bitrateFloor(1080, 1920, 30), 8e6)
  assert.equal(bitrateFloor(2160, 3840, 60), 68e6)
  assert.equal(bitrateFloor(1920, 1080, 25), 8e6)
  assert.equal(bitrateFloor(1920, 1080, 50), 12e6)
  assert.equal(bitrateFloor(1920, 1080, 30000 / 1001), 8e6)
  assert.equal(videoBitrateOf(1920, 1080, 30, QUALITY_HIGH_FACTOR), 8e6)
  assert.equal(videoBitrateOf(3840, 2160, 30, QUALITY_HIGH_FACTOR), 45e6)
  // 60 Mbps was the editor's cap: the floor lifts it.
  assert.equal(videoBitrateOf(3840, 2160, 60, QUALITY_HIGH_FACTOR), 68e6)
  assert.equal(videoBitrateOf(3840, 2160, 60, QUALITY_MAXIMUM), 68e6)
  // Standard keeps its formula (0.08 bits a pixel a frame).
  assert.equal(videoBitrateOf(1920, 1080, 30, QUALITY_STANDARD), Math.round(1920 * 1080 * 30 * 0.08))
  // Above the floor, the factor rules (Maximum at 1080p60 is 24.9 Mb/s).
  assert.equal(videoBitrateOf(1920, 1080, 60, QUALITY_MAXIMUM), Math.round(1920 * 1080 * 60 * 0.2))
})

test('final quality: surfaces by device pixels, never wider than the output; the preview as before', () => {
  // The preview (draft): the asset's pixels at the render scale, as always.
  assert.equal(drawQuality.final, false)
  assert.equal(surfaceWidth(3840, 0.5, 0.25), 1920)
  assert.equal(lookCap(), 2560)
  withDrawQuality(true, 3840, () => {
    // A 4K clip, fitted (0.5) in a 1080p project exported at 4K (q = 2):
    // drawn 3840 wide, so its surfaces are 3840, not 7680 (R21).
    assert.equal(surfaceWidth(3840, 2, 1), 3840)
    // Never more than before (w × q) nor than it is drawn (w × devPerUnit).
    assert.equal(surfaceWidth(1920, 2, 0.6), 1152)
    // A clip zoomed past the frame: the output's width at most.
    assert.equal(surfaceWidth(1920, 2, 6), 3840)
    // Looks work at the output's width (R12: it was 2560).
    assert.equal(lookCap(), 3840)
  })
  withDrawQuality(true, 1920, () => assert.equal(lookCap(), 2560))
  assert.equal(drawQuality.final, false, 'put back after the frame')
})

test('decision 10: a code film an export would enlarge is named (its declared size, the output)', async () => {
  const { codeFilmsEnlarged } = await import('../renderer/src/export/preflight')
  const film = { id: 'f', kind: 'code', name: 'film', url: '', size: 0, duration: 10, width: 1920, height: 1080, hasAudio: false }
  const clip = (scale: number, extra = {}) => ({ id: 'c', assetId: 'f', trackId: 'V1', start: 0, inPoint: 0, duration: 5, transform: { x: 960, y: 540, scale, rotation: 0 }, volume: 1, ...extra })
  const project = (c: object, hidden = false) => ({ settings: { width: 1920, height: 1080, fps: 30 }, tracks: [{ id: 'V1', kind: 'video', name: 'V1', clipIds: ['c'], hidden }], clips: { c }, assets: [film] }) as never
  assert.deepEqual(codeFilmsEnlarged(project(clip(1)), 1080), [], 'at its own size: nothing to say')
  assert.deepEqual(codeFilmsEnlarged(project(clip(1)), 2160), [{ name: 'film', w: 1920, h: 1080 }], '4K: enlarged 2×')
  assert.deepEqual(codeFilmsEnlarged(project(clip(0.4)), 2160), [], 'shown small: 0.4 × 2 < 1')
  assert.deepEqual(codeFilmsEnlarged(project(clip(0.4, { channels: { scale: [{ id: 'a', time: 0, value: 0.4 }, { id: 'b', time: 2, value: 1 }] } })), 2160).length, 1, 'a key that zooms it in counts')
  assert.deepEqual(codeFilmsEnlarged(project(clip(1), true), 2160), [], 'a hidden track is not drawn')
  // A Short of a 1080p project at 1080 × 1920 draws the frame at 1920 / 1080.
  assert.equal(codeFilmsEnlarged(project(clip(1)), 1920).length, 1)
})
