// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// Audit patch (yama-c), D2: the agent's project line of a clip said neither
// that it plays backwards nor that its sound is not heard at its speed (the
// preview and the export leave out the sound of a backwards clip and of one
// under 0.25x or over 8x, and of a curve's stretches outside that).
import './dom-stub'
import assert from 'node:assert/strict'
import test from 'node:test'
import { projectText } from '../renderer/src/agent/format'
import { COMMANDS, runCommand } from '../renderer/src/commands'
import { defaultProject, type Clip, type Project } from '../renderer/src/types'

const T = { x: 960, y: 540, scale: 1, rotation: 0 }

test('D2: the project line tells a backwards clip and a clip whose sound is not heard at its speed', () => {
  let p: Project = defaultProject()
  p.tracks = [{ id: 'V1', kind: 'video', name: 'V1', clipIds: ['a', 'b', 'c', 'd', 'e', 'f'] }]
  p.assets = [
    { id: 'vid', kind: 'video', name: 'vid.mp4', url: 'media://vid', size: 1, duration: 600, width: 1920, height: 1080, hasAudio: true } as never,
    { id: 'mute', kind: 'video', name: 'mute.mp4', url: 'media://mute', size: 1, duration: 600, width: 1920, height: 1080, hasAudio: false } as never
  ]
  const clip = (id: string, start: number, extra: Partial<Clip>, assetId = 'vid'): Clip => ({ id, assetId, trackId: 'V1', start, inPoint: start * 10, duration: 1, transform: T, volume: 1, ...extra }) as Clip
  p.clips = {
    a: clip('a', 0, {}),
    b: clip('b', 1, { reversed: true }),
    c: clip('c', 2, { speed: 10 }),
    d: clip('d', 3, { speed: 0.2 }),
    e: clip('e', 4, { speed: 10 }, 'mute'),
    f: clip('f', 5, {})
  }
  p = runCommand(p, COMMANDS['clip.setSpeedCurve'], { clipId: 'f', curve: { points: [{ u: 0, v: 1 }, { u: 1, v: 20 }] } }).project
  const text = projectText(p, { version: 1, state: 'live' } as never, 'V1')
  const line = (id: string): string => text.split('\n').find((l) => l.trim().startsWith(`${id} `)) ?? ''
  assert.doesNotMatch(line('a'), /reversed|no sound/)
  assert.match(line('b'), /reversed \(no sound\)/)
  assert.match(line('c'), /speed 10x no sound \(heard only at 0\.25–8x\)/)
  assert.match(line('d'), /no sound \(heard only at 0\.25–8x\)/)
  // (A clip with no sound of its own: nothing to say about its sound.)
  assert.doesNotMatch(line('e'), /no sound/)
  assert.match(line('f'), /speed curve .* no sound where its speed is outside 0\.25–8x/)
})
