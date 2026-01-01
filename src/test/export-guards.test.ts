// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
import assert from 'node:assert/strict'
import test from 'node:test'
import { integratedLufsMulti } from '../renderer/src/audio/loudness'
import { beginExportJob, endExportJob, exportJobNotes, noteExportJob } from '../renderer/src/export/job'
import { NORMALIZE_CEILING_DB, normalizeChannels, normalizeGain, normalizeNote, samplePeak } from '../renderer/src/export/normalize'
import { FIRST_BEAT_MS, STALL_MS, stallOf, StopCounts } from '../main/render-watchdog'

const db = (v: number): number => 20 * Math.log10(v)
const lin = (d: number): number => Math.pow(10, d / 20)
const CEILING = lin(NORMALIZE_CEILING_DB)

/** Two identical channels: a 1 kHz tone of `amp`, with a short burst of
 *  `peak` every second (a narration's plosives). */
function speech(amp: number, peak: number | null, seconds = 6, sr = 48000): Float32Array[] {
  const x = new Float32Array(seconds * sr)
  for (let i = 0; i < x.length; i++) {
    x[i] = amp * Math.sin((2 * Math.PI * 1000 * i) / sr)
    if (peak !== null && i % sr < 48) x[i] = i % 2 ? peak : -peak
  }
  return [x, x.slice()]
}

test('normalize: the gain to −14 LUFS stops where the peaks would pass −1 dBFS, and says so', () => {
  // The auditor's case: −20 LUFS speech with peaks at −3 dBFS. It was raised
  // +6 dB and clipped 3 dB over full scale; now +2 dB and the peaks at −1.
  const held = normalizeGain(-20, lin(-3))!
  assert.ok(Math.abs(held.gainDb - 2) < 1e-9)
  assert.equal(held.heldByPeaks, true)
  assert.ok(Math.abs(held.reached - -18) < 1e-9)
  assert.ok(Math.abs(held.short - 4) < 1e-9)
  assert.match(normalizeNote(held)!, /−18\.0 LUFS, not −14.*−1\.0 dBFS/)
  // Room enough: the target is reached.
  const free = normalizeGain(-20, lin(-10))!
  assert.ok(Math.abs(free.gainDb - 6) < 1e-9)
  assert.equal(free.heldByPeaks, false)
  assert.equal(free.short, 0)
  // (Phase Ç3 patch, S-4: reached, it is said with its gain; it said nothing.)
  assert.match(normalizeNote(free)!, /−14 LUFS: \+6\.0 dB/)
  // Too loud: turned down as before (peaks only go down).
  assert.ok(Math.abs(normalizeGain(-10, 0.99)!.gainDb - -4) < 1e-9)
  // Already over the ceiling and too quiet: left as it is, not turned down.
  const over = normalizeGain(-20, 1)!
  assert.equal(over.gainDb, 0)
  assert.equal(over.heldByPeaks, true)
  // Far too quiet: +12 dB at most, said too.
  const quiet = normalizeGain(-30, lin(-40))!
  assert.ok(Math.abs(quiet.gainDb - 12) < 1e-9)
  assert.equal(quiet.heldByPeaks, false)
  assert.match(normalizeNote(quiet)!, /12 dB at most/)
  // Silence: nothing to do.
  assert.equal(normalizeGain(-Infinity, 0), null)
  assert.equal(normalizeNote(null), null)
})

test('normalize: real samples come out with no sample past −1 dBFS (nothing clipped flat)', () => {
  const ch = speech(0.05, 0.7)
  const before = integratedLufsMulti(ch, 48000)
  assert.ok(before < -20, `quiet speech (${before.toFixed(1)} LUFS)`)
  const g = normalizeChannels(ch, 48000)!
  assert.equal(g.heldByPeaks, true)
  assert.ok(g.gainDb > 2 && g.gainDb < 2.2, `+${g.gainDb.toFixed(2)} dB (−1 − (−3.1))`)
  const peak = samplePeak(ch)
  assert.ok(peak <= CEILING + 1e-6, `peak ${db(peak).toFixed(2)} dBFS`)
  for (const d of ch) for (let i = 0; i < d.length; i++) assert.ok(Math.abs(d[i]) < 1, 'no sample at full scale')
  const after = integratedLufsMulti(ch, 48000)
  assert.ok(Math.abs(after - g.reached) < 0.05, `${after.toFixed(2)} as said (${g.reached.toFixed(2)})`)
})

test('normalize: a mix with room reaches −14 LUFS', () => {
  const ch = speech(0.1, null)
  const g = normalizeChannels(ch, 48000)!
  assert.equal(g.heldByPeaks, false)
  assert.ok(Math.abs(integratedLufsMulti(ch, 48000) - -14) < 0.1)
  assert.ok(samplePeak(ch) <= CEILING)
  // A change under 0.1 dB is left alone (and said as such).
  const near = normalizeChannels(ch, 48000)!
  assert.equal(near.gainDb, 0)
})

test('export job: notes are kept for the running job only, each once, and go with it', () => {
  noteExportJob('before any job')
  const s = beginExportJob()
  assert.deepEqual(exportJobNotes(), [])
  noteExportJob('a')
  noteExportJob('a')
  noteExportJob('b')
  assert.deepEqual(exportJobNotes(), ['a', 'b'])
  for (let i = 0; i < 20; i++) noteExportJob(`n${i}`)
  assert.ok(exportJobNotes().length <= 6, 'a few at most')
  endExportJob(s)
  assert.deepEqual(exportJobNotes(), [])
  noteExportJob('after')
  assert.deepEqual(exportJobNotes(), [])
  // A new job starts with none.
  const s2 = beginExportJob()
  assert.deepEqual(exportJobNotes(), [])
  endExportJob(s2)
})

test('render watchdog: a process that drew and then went quiet for minutes is stuck; one getting ready has longer', () => {
  const t0 = 1_000_000
  assert.equal(stallOf(t0 + 60_000, t0, 3), null)
  assert.equal(stallOf(t0 + STALL_MS, t0, 3), null, 'exactly the limit: not yet')
  assert.match(stallOf(t0 + STALL_MS + 1, t0, 3)!, /stopped drawing/)
  // Before its first frames (the film getting ready there): far longer.
  assert.equal(stallOf(t0 + STALL_MS * 2, t0, 0), null)
  assert.match(stallOf(t0 + FIRST_BEAT_MS + 1, t0, 0)!, /did not start drawing/)
  assert.ok(FIRST_BEAT_MS > STALL_MS && STALL_MS >= 60_000)
})

test('render processes: a stop or a finish while they were starting is seen', () => {
  const s = new StopCounts()
  const m = s.mark(7)
  assert.equal(s.since(7, m), 'none')
  s.stopped(8)
  assert.equal(s.since(7, m), 'none', 'another editor')
  s.stopped(7)
  assert.equal(s.since(7, m), 'stopped')
  s.finished(7)
  assert.equal(s.since(7, m), 'finished')
  // A mark taken after: nothing since.
  assert.equal(s.since(7, s.mark(7)), 'none')
})
