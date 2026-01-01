// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
import assert from 'node:assert/strict'
import test from 'node:test'
import { heavyRanges } from '../renderer/src/playback/heavy'
import { createTemplate } from '../renderer/src/templates/model'
import { defaultProject, type Clip } from '../renderer/src/types'

test('the heavy parts: scene templates and big transitions — merged', () => {
  const p = defaultProject()
  const v = p.tracks.find((t) => t.kind === 'video')!
  const add = (id: string, start: number, type?: string): void => {
    p.clips[id] = { id, assetId: 'a', trackId: v.id, start, duration: 4, inPoint: 0, transform: { x: 0, y: 0, scale: 1, rotation: 0 }, volume: 1, ...(type ? { transitionOut: { type, duration: 1, align: 'auto' } } : {}) } as unknown as Clip
    v.clipIds.push(id)
  }
  add('c0', 0, 'mix')
  add('c1', 4, 'film-burn')
  add('c2', 8, 'light-leak')
  add('c3', 12)
  createTemplate(p, 'home', 20)
  createTemplate(p, 'stat', 30)
  // The burn (7–9) and the leak (11–13); the home screen (a scene of its
  // own). The mix and the big number are light.
  assert.deepEqual(heavyRanges(p), [
    [7, 9],
    [11, 13],
    [20, 23.6]
  ])
})
