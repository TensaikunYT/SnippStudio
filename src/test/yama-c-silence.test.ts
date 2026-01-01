// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// Audit patch (yama-c), D4: the silence finder laid a backwards clip's
// loudness out forwards (media → clip time without the mirror), so its
// pauses were found at the mirrored places; and the loudness cache did not
// tell a backwards clip from the same clip played forwards.
import './dom-stub'
import assert from 'node:assert/strict'
import test from 'node:test'
import type { Asset, Clip, Project } from '../renderer/src/types'
import { defaultProject } from '../renderer/src/types'
import { clipLoudnessDb } from '../renderer/src/audio/silence'

// The decoder is replaced by a fake (mediabunny's decoding does not exist in
// node). silence.ts reads the module's export at call time.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const sources = require('../renderer/src/media/sources') as { getAudioSink: (asset: Asset, isolated?: boolean) => Promise<unknown>; audioPresentationOffset: (asset: Asset) => Promise<number> }

const SR = 8000

/** A file whose media 10–15 s is a loud tone and 15–20 s silence. */
function sink(): unknown {
  return {
    async *buffers(from: number, to: number) {
      for (let ts = from; ts < to - 1e-9; ts += 0.5) {
        const n = Math.round(Math.min(0.5, to - ts) * SR)
        const data = new Float32Array(n)
        for (let i = 0; i < n; i++) data[i] = ts + i / SR < 15 ? 0.5 * Math.sin((2 * Math.PI * 1000 * i) / SR) : 0
        yield { timestamp: ts, duration: n / SR, buffer: { numberOfChannels: 1, sampleRate: SR, length: n, getChannelData: () => data } }
      }
    }
  }
}

function project(reversed: boolean): { p: Project; c: Clip } {
  const p = defaultProject()
  p.assets = [{ id: 'v', kind: 'audio', name: 'v.wav', url: 'media://v', size: 1, duration: 60, width: 0, height: 0, hasAudio: true } as Asset]
  const c = { id: 'c', assetId: 'v', trackId: 'A1', start: 0, inPoint: 10, duration: 10, transform: { x: 0, y: 0, scale: 1, rotation: 0 }, volume: 1, ...(reversed ? { reversed: true } : {}) } as Clip
  p.tracks = [{ id: 'A1', kind: 'audio', name: 'A1', clipIds: ['c'] }]
  p.clips = { c }
  return { p, c }
}

test('D4: a backwards clip\'s loudness is laid out backwards (its pause first), not like the forward clip\'s', async () => {
  const saved = { sink: sources.getAudioSink, offset: sources.audioPresentationOffset }
  sources.getAudioSink = async () => sink()
  sources.audioPresentationOffset = async () => 0
  try {
    const fwd = project(false)
    const a = (await clipLoudnessDb(fwd.p, fwd.c, 0.5))!
    const rev = project(true)
    const b = (await clipLoudnessDb(rev.p, rev.c, 0.5))!
    assert.equal(a.length, 20)
    assert.equal(b.length, 20)
    // Forwards: loud, then quiet. Backwards: quiet, then loud.
    assert.ok(a[2] > -20 && a[17] < -60, `forwards ${a[2]} … ${a[17]}`)
    assert.ok(b[2] < -60 && b[17] > -20, `backwards ${b[2]} … ${b[17]}`)
  } finally {
    sources.getAudioSink = saved.sink
    sources.audioPresentationOffset = saved.offset
  }
})
