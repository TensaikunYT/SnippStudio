// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
import assert from 'node:assert/strict'
import test from 'node:test'
import { audioChunks, EXPORT_FORMATS, formatOf } from '../renderer/src/export/formats'
import { beginExportJob, cancelExportJob, endExportJob, etaFromSamples, exportJobRunning, fmtLeft, wasCancelled } from '../renderer/src/export/job'

test('export formats: MP3 and M4A are sound-only with their own file types; MP4 stays the default', () => {
  assert.equal(formatOf(undefined).id, 'mp4')
  assert.equal(formatOf('nonsense').id, 'mp4')
  const mp3 = formatOf('mp3')
  assert.deepEqual([mp3.ext, mp3.mime, mp3.audioOnly], ['mp3', 'audio/mpeg', true])
  const m4a = formatOf('m4a')
  assert.deepEqual([m4a.ext, m4a.mime, m4a.audioOnly, m4a.audioCodec], ['m4a', 'audio/mp4', true, 'AAC'])
  assert.equal(formatOf('wav').audioOnly, true)
  assert.equal(formatOf('webm').audioOnly, false)
  // Every format the dialog lists has a distinct extension.
  assert.equal(new Set(EXPORT_FORMATS.map((f) => f.ext)).size, EXPORT_FORMATS.length)
})

test('the sound is fed to the encoder in pieces that cover it exactly once', () => {
  const chunks = audioChunks(48000 * 5 + 7, 48000, 2)
  assert.deepEqual(chunks[0], [0, 96000])
  assert.equal(chunks.length, 3)
  assert.equal(chunks[chunks.length - 1][1], 48000 * 5 + 7)
  for (let i = 1; i < chunks.length; i++) assert.equal(chunks[i][0], chunks[i - 1][1])
  assert.deepEqual(audioChunks(0, 48000), [])
})

test('time left follows how fast the bar moves now, not since the start', () => {
  // A quick first phase (the sound mix: 6 % in 1 s), then the frames at 1 % a second.
  const samples: [number, number][] = [[0, 0], [1, 0.06]]
  for (let t = 2; t <= 20; t++) samples.push([t, 0.06 + (t - 1) * 0.01])
  const eta = etaFromSamples(samples)!
  const left = 1 - samples[samples.length - 1][1]
  assert.ok(Math.abs(eta - left / 0.01) < 1, `about ${left / 0.01}s left, said ${eta}`)
  assert.equal(etaFromSamples([[0, 0]]), null)
  assert.equal(etaFromSamples([[0, 0.5], [0.5, 0.5]]), null)
  assert.equal(etaFromSamples([[0, 0.5], [5, 1]]), 0)
  assert.equal(fmtLeft(65), '1m 05s')
  assert.equal(fmtLeft(0.4), '<1s')
})

test('Cancel aborts the running job only, and a cancel is told apart from a failure', () => {
  const first = beginExportJob()
  assert.equal(exportJobRunning(), true)
  cancelExportJob()
  assert.equal(first.aborted, true)
  assert.equal(wasCancelled(first, new Error('anything')), true)
  endExportJob(first)
  assert.equal(exportJobRunning(), false)
  const second = beginExportJob()
  assert.equal(wasCancelled(second, new Error('disk full')), false)
  assert.equal(wasCancelled(second, new DOMException('Render cancelled', 'AbortError')), true)
  endExportJob(first) // an old job ending does not end the new one
  assert.equal(exportJobRunning(), true)
  endExportJob(second)
})
