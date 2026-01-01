// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
import assert from 'node:assert/strict'
import test from 'node:test'
import { riserTimes } from '../renderer/src/audio/risers'
import { createTemplate } from '../renderer/src/templates/model'
import { defaultProject, type Clip, type Project } from '../renderer/src/types'

const withClips = (types: (string | null)[]): Project => {
  const p = defaultProject()
  const v = p.tracks.find((t) => t.kind === 'video')!
  types.forEach((type, i) => {
    const id = `c${i}`
    p.clips[id] = { id, assetId: 'a', trackId: v.id, start: i * 4, duration: 4, inPoint: 0, transform: { x: 960, y: 540, scale: 1, rotation: 0 }, volume: 1, ...(type ? { transitionOut: { type, duration: 1.2, align: 'auto' } } : {}) } as unknown as Clip
    v.clipIds.push(id)
  })
  return p
}

test('build-ups rise into the big moments only', () => {
  const p = withClips(['mix', 'film-burn', 'slide', 'light-leak', null])
  assert.equal(riserTimes(p).length, 0)
  const q = { ...withClips(['mix', 'film-burn', 'slide', 'light-leak', null]), risers: 0.6 }
  createTemplate(q, 'stat', 17)
  const rs = riserTimes(q)
  // The burn (cut at 8), the leak (cut at 16), the number landing (17.15).
  assert.deepEqual(rs.map((e) => +(e.t + e.dur).toFixed(2)), [8, 16, 17.15])
  assert.ok(rs.every((e) => e.dur >= 0.5 && e.dur <= 1.4))
  assert.ok(Math.abs(rs[2].dur - 0.95) < 1e-9, 'squeezed after the one before')
})
