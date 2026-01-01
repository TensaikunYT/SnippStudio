// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// The sounds the product makes stay the same, sample for sample, when the
// synthesizer's dead recipes (left from the parts removed in phase 1b:
// nothing in the product asks for them) are taken out (SnippStudio phase 2B). fixtures/sfx-hashes.json holds
// every kind's samples' hash as it was before (two seeds, with and without a
// length); a kind still known must give the same, and the dead ones must be
// gone. UPDATE_SFX_HASHES=1 rewrites the file.
import assert from 'node:assert/strict'
import test from 'node:test'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { LEVEL, synthSfx, type SfxEvent } from '../renderer/src/audio/sfx-synth'

const FILE = join(__dirname, '..', '..', 'src', 'test', 'fixtures', 'sfx-hashes.json')

/** Recipes left from the removed parts that nothing in the product names (scripts/split/sfx-kinds.mjs). */
export const DEAD = [
  'tap', 'coin', 'page', 'touch', 'scribble', 'key', 'rumble', 'charge', 'blast', 'boom', 'suck', 'clap', 'rub', 'stamp', 'bell',
  'swell', 'rush', 'slowin', 'slowhum', 'slowout', 'papslide', 'pageturn', 'foldover', 'crumple', 'land',
  'hopoff', 'hopland', 'wash', 'snort', 'rustle', 'creak', 'skid', 'warp', 'boing', 'whistle', 'alarm', 'shutter', 'poptok',
  'wtick', 'hum', 'crush', 'scatter', 'wfold', 'shot', 'hiss', 'thud', 'sting', 'drip', 'zip',
  'rain', 'downpour', 'snowfall', 'wind', 'fogair', 'dayswell', 'birds', 'crickets', 'crackle', 'smolder', 'blast3', 'wake',
  'woodtok', 'felttok', 'softknock', 'blocktok', 'drumtap', 'marimba', 'kalimba', 'pluck', 'cardslide', 'cardflip', 'paperflick',
  'crinkle', 'paperpat', 'glasstink', 'clink', 'marble', 'chime', 'cloth', 'flap', 'pat', 'latch', 'ratchet', 'windup', 'lever',
  'gears', 'drawer', 'twinkle', 'poof', 'beam', 'scan', 'whirr', 'blink', 'plonk', 'boop', 'squeak', 'wobble', 'gulp', 'tada',
  'sheetlift', 'sheetlay', 'scalerise', 'scalefall', 'scalestep',
  'pencil', 'sparks', 'dust', 'debris', 'rollback', 'hoof', 'bedslide', 'haul', 'chain', 'trace',
  'pass', 'cover', 'peel', 'tear', 'splash', 'zap', 'fizz', 'clock', 'blip', 'unfold', 'fold', 'stretch', 'chirp', 'plates', 'lift',
  'pinland', 'flyover', 'pen', 'rise', 'grab', 'pop', 'snap', 'click', 'button', 'shimmer', 'glow'
]

function hashOf(kind: string): string {
  const h = createHash('sha256')
  for (const [seed, dur] of [[1, 0], [7, 1.3]] as const) {
    const x = synthSfx(kind as SfxEvent['kind'], 48000, seed, dur)
    h.update(Buffer.from(x.buffer, x.byteOffset, x.byteLength))
  }
  return h.digest('hex')
}

test('every sound kind still made gives the same samples as before the dead recipes went', () => {
  const kinds = Object.keys(LEVEL).sort()
  const now = Object.fromEntries(kinds.map((k) => [k, hashOf(k)]))
  if (process.env.UPDATE_SFX_HASHES === '1' || !existsSync(FILE)) {
    writeFileSync(FILE, JSON.stringify(now, null, 1) + '\n')
    return
  }
  const before = JSON.parse(readFileSync(FILE, 'utf8')) as Record<string, string>
  for (const k of kinds) assert.equal(now[k], before[k], `the sound "${k}" changed`)
  // What is gone is exactly the dead list.
  const gone = Object.keys(before).filter((k) => !(k in now)).sort()
  assert.deepEqual(gone, [...DEAD].sort().filter((k) => k in before))
  for (const k of DEAD) assert.ok(!(k in now), `the dead recipe "${k}" is still there`)
})
