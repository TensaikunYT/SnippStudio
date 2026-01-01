// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
import assert from 'node:assert/strict'
import test from 'node:test'
import { beatsFromOnsets, cutOnBeats, transitionsOnBeats } from '../renderer/src/audio/beats'
import { defaultProject } from '../renderer/src/types'

test('beats: a pulse every half second is 120 BPM, on its own phase', () => {
  const hop = 0.01
  const n = 3000
  const env = new Float32Array(n)
  let seed = 7
  const rnd = (): number => ((seed = (seed * 16807) % 2147483647) / 2147483647)
  for (let i = 0; i < n; i++) env[i] = rnd() * 0.15
  for (let t = 0.23; t < 30; t += 0.5) env[Math.round(t / hop)] += 1 + rnd() * 0.3
  const { bpm, beats } = beatsFromOnsets(env, hop)
  assert.ok(Math.abs(bpm - 120) < 3, `bpm ${bpm}`)
  assert.ok(beats.length > 50)
  for (const b of beats.slice(2, 20)) {
    const off = ((b - 0.23) / 0.5) % 1
    assert.ok(Math.min(off, 1 - off) < 0.06, `beat ${b}`)
  }
})

test('beats: pictures cut every two beats, transitions rolled onto the beat', () => {
  const p = defaultProject()
  const track = p.tracks.find((t) => t.kind === 'video')!
  p.assets.push({ id: 'img', kind: 'image', name: 'a.png', url: '', path: '', size: 1, duration: 0, width: 100, height: 100, hasAudio: false })
  for (let i = 0; i < 4; i++) {
    const id = `c${i}`
    p.clips[id] = { id, assetId: 'img', trackId: track.id, start: i * 1.3, inPoint: 0, duration: 1.3, transform: { x: 0, y: 0, scale: 1, rotation: 0 }, volume: 1 }
    track.clipIds.push(id)
  }
  const beats = Array.from({ length: 40 }, (_, k) => 0.1 + k * 0.5)
  assert.equal(cutOnBeats(p, track.id, beats, 2), 4)
  const cs = track.clipIds.map((id) => p.clips[id])
  cs.forEach((c, i) => {
    assert.ok(Math.abs(c.start - (0.1 + i)) < 1e-9)
    assert.ok(Math.abs(c.duration - 1) < 1e-9)
  })
  // Knock one cut off the beat and put a transition on it: it rolls back.
  cs[0].duration = 1.15
  cs[1].start = 1.25
  cs[1].duration = 0.85
  cs[0].transitionOut = { type: 'mix', duration: 0.4 }
  assert.equal(transitionsOnBeats(p, beats), 1)
  assert.ok(Math.abs(cs[0].start + cs[0].duration - 1.1) < 1e-9 && Math.abs(cs[1].start - 1.1) < 1e-9)
})
