// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// Phase Ç3 patch (haritalar/_fazc3-denetim-dayaniklilik.md R-6,
// _fazc3-denetim-ses.md S-4): the export window's preset in a project whose
// size is not in the menu, and the loudness normalizing's default and what
// the result says about it.
import './dom-stub'
import assert from 'node:assert/strict'
import test from 'node:test'
import * as Q from '../renderer/src/export/quality'
import { normalizeGain, normalizeNote } from '../renderer/src/export/normalize'

type Start = (kept: string | null, p: { forSegments: boolean; shortsMode: boolean; vertical: boolean; width: number; height: number }) => string
const lands = { forSegments: false, shortsMode: false, vertical: false }

test('R-6: a YouTube preset that does not give 1920 × 1080 / 3840 × 2160 in this project is Custom', () => {
  const holds = (Q as unknown as { youtubePresetHolds?: (l: number, w: number, h: number) => boolean }).youtubePresetHolds
  const start = (Q as unknown as { startPresetOf?: Start }).startPresetOf
  assert.ok(holds && start, 'the preset rule exists')
  // The auditor's two projects (outside the menu): the output stayed the project's size.
  assert.equal(holds!(1080, 1280, 720), false)
  assert.equal(holds!(1080, 2560, 1440), false)
  assert.equal(start!('yt1080', { ...lands, width: 1280, height: 720 }), 'custom')
  assert.equal(start!(null, { ...lands, width: 2560, height: 1440 }), 'custom')
  assert.equal(start!('yt4k', { ...lands, width: 1280, height: 720 }), 'yt4k', '4K of 720p is 3840 × 2160')
  // The menu's sizes: as before.
  assert.equal(start!('yt1080', { ...lands, width: 1920, height: 1080 }), 'yt1080')
  assert.equal(start!('yt1080', { ...lands, width: 3840, height: 2160 }), 'yt1080')
  assert.equal(start!(null, { ...lands, width: 1920, height: 1080 }), 'yt1080')
  assert.equal(start!(null, { ...lands, vertical: true, width: 1080, height: 1920 }), 'shorts')
})

test('S-4: −14 LUFS is on by default only for a video with a YouTube preset; the result says the gain', () => {
  const byDefault = (Q as unknown as { normalizeByDefault?: (k: string, p: string) => boolean }).normalizeByDefault
  assert.ok(byDefault, 'the default rule exists')
  assert.equal(byDefault!('video', 'yt1080'), true)
  assert.equal(byDefault!('video', 'yt4k'), true)
  assert.equal(byDefault!('video', 'shorts'), false)
  assert.equal(byDefault!('video', 'custom'), false)
  assert.equal(byDefault!('sound', 'yt1080'), false, 'not carried into Sound only')
  // A −9 LUFS master turned down to −14: said, with its gain.
  const down = normalizeGain(-9, 0.9)!
  assert.match(normalizeNote(down) ?? '', /−5\.0 dB/)
  const up = normalizeGain(-20, Math.pow(10, -10 / 20))!
  assert.match(normalizeNote(up) ?? '', /\+6\.0 dB/)
})

test('R-7: the removed still-frame dialog\'s three words are gone', async () => {
  const { STRINGS } = await import('../renderer/src/ui/strings')
  assert.deepEqual(['still.title', 'still.save', 'still.cancel'].filter((k) => k in STRINGS), [])
})