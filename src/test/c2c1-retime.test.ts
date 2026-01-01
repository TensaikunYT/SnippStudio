// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// Phase Ç2c.1, decision 4 (report K6, D1): a speed change scales the keys by
// the speed ratio (old / new), not by the length ratio, so a key stays on
// its frame of the media when the next clip holds the length; a slip carries
// the keys with the picture (Premiere's way).
import './dom-stub'
import assert from 'node:assert/strict'
import test from 'node:test'
import { commandByName, runCommand } from '../renderer/src/commands'
import { clipTransformAt } from '../renderer/src/playback/pose'
import { mediaAtLocal } from '../renderer/src/timeline/media-time'
import { defaultProject, type Clip, type Project } from '../renderer/src/types'

function project(extra: Partial<Clip>, next = true): Project {
  const p = defaultProject()
  p.tracks = [{ id: 'V1', kind: 'video', name: 'V1', clipIds: next ? ['a', 'b'] : ['a'] }]
  p.assets = [{ id: 'vid', kind: 'video', name: 'vid.mp4', url: 'media://vid', size: 1, duration: 100, width: 1920, height: 1080, hasAudio: false } as never]
  const base = { assetId: 'vid', trackId: 'V1', transform: { x: 960, y: 540, scale: 1, rotation: 0 }, volume: 1 }
  p.clips.a = {
    ...base,
    id: 'a',
    start: 0,
    inPoint: 20,
    duration: 10,
    channels: { x: [{ id: 'k1', time: 1, value: 0 }, { id: 'k5', time: 5, value: 500 }, { id: 'k9', time: 9, value: 100, easing: 'linear' }] },
    volumeKeyframes: [{ id: 'v1', time: 5, value: 0.5 }],
    mask: { enabled: true, shape: 'ellipse', feather: 0, cx: 0, cy: 0, w: 10, h: 10, keyframes: [{ id: 'm1', time: 5, cx: 1, cy: 2, w: 3, h: 4 }] },
    ...extra
  } as Clip
  // Not joined: the speed change runs into it and the length is held.
  if (next) p.clips.b = { ...base, id: 'b', start: 12, inPoint: 0, duration: 5 } as Clip
  p.captions = []
  return p
}
const cmd = (p: Project, name: string, params: unknown): Project => runCommand(p, commandByName(name), params).project

/** The media second each x key of clip `a` is on. */
const keyFrames = (c: Clip): number[] => c.channels!.x!.map((k) => mediaAtLocal(c, k.time))

test('K6: a speed change keeps every key on its media frame when the next clip holds the length', () => {
  for (const [what, extra] of [['forwards', {}], ['backwards', { reversed: true }], ['at twice the speed', { speed: 2 }]] as [string, Partial<Clip>][]) {
    const p = project(extra)
    const before = keyFrames(p.clips.a)
    for (const speed of [0.5, 0.8, 1.6]) {
      const after = cmd(p, 'clip.setSpeed', { clipId: 'a', speed })
      const c = after.clips.a
      const now = keyFrames(c)
      for (let i = 0; i < before.length; i++) assert.ok(Math.abs(now[i] - before[i]) < 1e-9, `${what} ×${speed}: key ${i} on ${now[i]}, was ${before[i]} (length ${c.duration})`)
      // The volume and the mask keys go with them.
      assert.ok(Math.abs(mediaAtLocal(c, c.volumeKeyframes![0].time) - mediaAtLocal(p.clips.a, 5)) < 1e-9, `${what} ×${speed}: volume key`)
      assert.ok(Math.abs(mediaAtLocal(c, c.mask!.keyframes![0].time) - mediaAtLocal(p.clips.a, 5)) < 1e-9, `${what} ×${speed}: mask key`)
    }
  }
})

test('K6: the slider\'s many small changes do not walk a key off its frame', () => {
  let p = project({})
  const before = keyFrames(p.clips.a)
  for (let i = 1; i <= 20; i++) p = cmd(p, 'clip.setSpeed', { clipId: 'a', speed: 1 - i * 0.025 })
  const now = keyFrames(p.clips.a)
  for (let i = 0; i < before.length; i++) assert.ok(Math.abs(now[i] - before[i]) < 1e-9, `key ${i}: ${now[i]} vs ${before[i]}`)
})

test('decision 4: a slip carries the keys with the picture (and its linked partner\'s)', () => {
  for (const [what, extra] of [['forwards', {}], ['backwards', { reversed: true }], ['at twice the speed', { speed: 2 }]] as [string, Partial<Clip>][]) {
    const p = project(extra, false)
    p.tracks.push({ id: 'A1', kind: 'audio', name: 'A1', clipIds: ['s'] })
    p.assets.push({ id: 'snd', kind: 'audio', name: 's.wav', url: 'media://s', size: 1, duration: 100 } as never)
    p.clips.a.linkId = 'L'
    p.clips.s = { id: 's', assetId: 'snd', trackId: 'A1', start: 0, inPoint: 20, duration: 10, transform: { x: 0, y: 0, scale: 1, rotation: 0 }, volume: 1, linkId: 'L', volumeKeyframes: [{ id: 'sv', time: 4, value: 0.2 }], ...extra } as Clip
    const was = keyFrames(p.clips.a)
    const sound = mediaAtLocal(p.clips.s, 4)
    const after = cmd(p, 'clip.slip', { clipId: 'a', delta: 1.5, linkAV: true })
    assert.notEqual(after.clips.a.inPoint, p.clips.a.inPoint, `${what}: it slipped`)
    const now = keyFrames(after.clips.a)
    for (let i = 0; i < was.length; i++) assert.ok(Math.abs(now[i] - was[i]) < 1e-9, `${what}: key ${i} on ${now[i]}, was ${was[i]}`)
    assert.ok(Math.abs(mediaAtLocal(after.clips.s, after.clips.s.volumeKeyframes![0].time) - sound) < 1e-9, `${what}: the partner's key`)
    // The picture's pose at a frame of the footage is the pose it had there.
    const at = (c: Clip, m: number): number => {
      const sp = c.speed ?? 1
      const u = c.reversed ? c.duration - (m - c.inPoint) / sp : (m - c.inPoint) / sp
      return clipTransformAt(c, u).x
    }
    for (const m of [24, 25.5, 26.7]) assert.ok(Math.abs(at(after.clips.a, m) - at(p.clips.a, m)) < 1e-9, `${what}: pose at media ${m}`)
  }
})
