// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
import assert from 'node:assert/strict'
import test from 'node:test'
import { loudPeaks, preflight } from '../renderer/src/export/preflight'
import { defaultProject, type Clip, type Project } from '../renderer/src/types'

function project(): Project {
  const p = defaultProject()
  p.assets.push(
    { id: 'a', kind: 'image', name: 'one.png', url: '', path: 'one.png', size: 1, duration: 0, width: 10, height: 10, hasAudio: false },
    { id: 'b', kind: 'image', name: 'two.png', url: '', path: 'two.png', size: 1, duration: 0, width: 10, height: 10, hasAudio: false, missing: true }
  )
  const v = p.tracks.find((t) => t.kind === 'video')!
  const add = (id: string, assetId: string, start: number, duration: number, extra: Partial<Clip> = {}): void => {
    p.clips[id] = { id, assetId, trackId: v.id, start, duration, inPoint: 0, transform: { x: 0, y: 0, scale: 1, rotation: 0 }, volume: 1, ...extra } as Clip
    v.clipIds.push(id)
  }
  add('c1', 'a', 0, 3)
  add('c2', 'a', 3, 3)
  add('c3', 'b', 8, 3)
  add('c4', 'a', 11, 12)
  add('c5', 'a', 23, 12, { motionFx: {} as never })
  return p
}

test('before the export: gaps, missing files, still pictures, repeats', () => {
  const issues = preflight(project())
  const by = (k: string) => issues.filter((i) => i.kind === k)
  assert.deepEqual(by('gap').map((g) => [g.at, g.end]), [[6, 8]])
  assert.equal(by('missing').length, 1)
  assert.match(by('missing')[0].text, /two\.png/)
  assert.deepEqual(by('still').map((s) => s.clipId), ['c4'])
  assert.deepEqual(by('repeat').map((s) => s.clipId), ['c2', 'c5'])
  assert.ok(issues.every((x, i) => i === 0 || x.at >= issues[i - 1].at))
})

test('a sudden loud peak: a jump well above what came before, once per burst', () => {
  const dbs = Array.from({ length: 200 }, (_, i) => (i >= 100 && i < 106 ? -4 : i >= 150 && i < 152 ? -30 : -28))
  assert.deepEqual(loudPeaks(dbs, 0.05, 10), [15])
  // Loud all along is not sudden.
  assert.deepEqual(loudPeaks(Array(200).fill(-5), 0.05, 0), [])
})
