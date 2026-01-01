// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
import assert from 'node:assert/strict'
import test from 'node:test'
import { findDragSnap } from '../renderer/src/timeline/snapping'
import { defaultProject, type Clip } from '../renderer/src/types'

const clip = (id: string, trackId: string, start: number, duration: number): Clip => ({
  id, assetId: id, trackId, start, duration, inPoint: 0, volume: 1,
  transform: { x: 0, y: 0, scale: 1, rotation: 0 }
})

test('image edge on the destination track beats a subtitle edge a few pixels closer', () => {
  const project = defaultProject()
  const track = project.tracks[0]
  project.clips.image = clip('image', track.id, 10, 4)
  track.clipIds = ['image']
  project.assets.push({
    id: 'image', kind: 'image', name: 'image.png', url: 'media://image', size: 1,
    duration: 0, width: 100, height: 100, hasAudio: false
  })
  project.captions.push({ id: 'subtitle', start: 14.04, end: 15, text: 'Next sentence' })
  const result = findDragSnap(project, 14.035, 2, 100, track.id, new Set(), 30)!
  assert.equal(result.target.kind, 'image')
  assert.equal(result.target.clipId, 'image')
  assert.equal(result.target.time, 14)
  assert.equal(result.start, 14)
})

test('subtitle alignment remains available when no image edge is close', () => {
  const project = defaultProject()
  project.captions.push({ id: 'subtitle', start: 5, end: 6, text: 'Line' })
  const result = findDragSnap(project, 4.95, 2, 100, project.tracks[0].id, new Set(), 30)!
  assert.equal(result.target.kind, 'subtitle')
  assert.equal(result.target.captionId, 'subtitle')
  assert.equal(result.start, 5)
})

test('the active image track wins over another video layer and dragged clips are excluded', () => {
  const project = defaultProject()
  const v1 = project.tracks[0]
  const v2 = { id: 'v2', kind: 'video' as const, name: 'V2', clipIds: ['upper'] }
  project.tracks.unshift(v2)
  project.clips.lower = clip('lower', v1.id, 2, 3)
  project.clips.upper = clip('upper', v2.id, 2.02, 3)
  v1.clipIds = ['lower']
  const result = findDragSnap(project, 5.019, 1, 100, v1.id, new Set(['upper']), 30)!
  assert.equal(result.target.clipId, 'lower')
  assert.equal(result.target.trackId, v1.id)
})

test('snap threshold stays eight screen pixels at different zoom levels', () => {
  const project = defaultProject()
  project.captions.push({ id: 'subtitle', start: 5, end: 6, text: 'Line' })
  assert.ok(findDragSnap(project, 4.925, 1, 100, project.tracks[0].id, new Set(), 30))
  assert.equal(findDragSnap(project, 4.925, 1, 200, project.tracks[0].id, new Set(), 30), null)
})
