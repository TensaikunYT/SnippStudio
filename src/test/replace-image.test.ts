// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
import assert from 'node:assert/strict'
import test from 'node:test'
import { replaceTimelineImage } from '../renderer/src/media/replace'
import type { Asset, Clip } from '../renderer/src/types'
import { defaultProject } from '../renderer/src/types'

const image = (id: string, path: string): Asset => ({
  id,
  kind: 'image',
  name: `${id}.png`,
  path,
  url: `media://${id}`,
  size: 10,
  duration: 0,
  width: 1920,
  height: 1080,
  hasAudio: false
})

test('replacing a timeline image changes only assetId and preserves neighbours', () => {
  const project = defaultProject()
  const old = image('old', 'C:\\images\\old.png')
  const next = image('next', 'C:\\images\\next.png')
  project.assets.push(old)
  const clip: Clip = {
    id: 'clip',
    assetId: old.id,
    trackId: project.tracks[0].id,
    start: 12,
    duration: 4.5,
    inPoint: 0,
    transform: { x: 888, y: 444, scale: 1.18, rotation: 0.2 },
    volume: 0.7,
    motionFx: {
      enabled: true,
      zoomFrom: 1.04,
      zoomTo: 1.04,
      panX: -64,
      panY: 0,
      shakeAmp: 0,
      shakeRotAmp: 0,
      shakeSpeed: 0.3,
      seed: 42,
      ease: 'smooth'
    },
    anim: { in: 'fade', out: 'slide-left', inDur: 0.4, outDur: 0.5 },
    transitionOut: { type: 'mix', duration: 0.7 }
  }
  const before = structuredClone(clip)
  project.clips[clip.id] = clip
  project.tracks[0].clipIds.push(clip.id)
  const tracksBefore = structuredClone(project.tracks)

  const result = replaceTimelineImage(project, clip.id, next)

  assert.deepEqual(result, { assetId: 'next', addedAsset: true, changed: true })
  assert.deepEqual(project.clips[clip.id], { ...before, assetId: 'next' })
  assert.deepEqual(project.tracks, tracksBefore)
  assert.equal(project.assets.includes(old), true)
  assert.equal(project.assets.includes(next), true)
})

test('replacement reuses an already imported image and rejects non-images', () => {
  const project = defaultProject()
  const old = image('old', 'C:\\images\\old.png')
  const existing = image('existing', 'C:\\images\\NEW.png')
  project.assets.push(old, existing)
  project.clips.clip = {
    id: 'clip', assetId: old.id, trackId: project.tracks[0].id, start: 0, duration: 3,
    inPoint: 0, transform: { x: 960, y: 540, scale: 1, rotation: 0 }, volume: 1
  }
  project.tracks[0].clipIds.push('clip')
  const duplicate = image('duplicate', 'c:\\images\\new.png')

  assert.deepEqual(replaceTimelineImage(project, 'clip', duplicate), {
    assetId: 'existing', addedAsset: false, changed: true
  })
  assert.equal(project.assets.some((asset) => asset.id === 'duplicate'), false)
  assert.equal(
    replaceTimelineImage(project, 'clip', { ...duplicate, id: 'video', kind: 'video' }),
    null
  )
})
