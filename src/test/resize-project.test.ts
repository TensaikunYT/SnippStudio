// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
import assert from 'node:assert/strict'
import test from 'node:test'
import { resizeProjectCanvas } from '../renderer/src/project/resize'
import type { Caption, Clip } from '../renderer/src/types'
import { defaultCaptionMotion, defaultProject } from '../renderer/src/types'

test('canvas aspect changes in place and remaps every project-space animation', () => {
  const project = defaultProject('16:9')
  const trackId = project.tracks[0].id
  const clip: Clip = {
    id: 'clip', assetId: 'asset', trackId, start: 4, inPoint: 0, duration: 6, volume: 1,
    transform: { x: 960, y: 540, scale: 2, rotation: 0 },
    channels: {
      x: [{ id: 'x', time: 2, value: 480 }],
      y: [{ id: 'y', time: 2, value: 810 }],
      scale: [{ id: 'scale', time: 2, value: 4 }]
    },
    motionFx: {
      enabled: true, zoomFrom: 1, zoomTo: 1, panX: 160, panY: 90,
      shakeAmp: 8, shakeRotAmp: 0, shakeSpeed: 1, seed: 1,
      gentlePanX: 64, gentlePanY: -45
    }
  }
  project.clips[clip.id] = clip
  project.tracks[0].clipIds.push(clip.id)
  project.trackers = [{ id: 'tracker', name: 'Face', keyframes: [{ id: 'tk', time: 0, x: 1200, y: 700 }] }]
  const caption: Caption = {
    id: 'caption', start: 0, end: 2, text: 'Text', manual: true,
    motion: { ...defaultCaptionMotion(), x: 200, y: 100 },
    kfs: [{ id: 'ck', time: 1, ...defaultCaptionMotion(), x: 400, y: 200 }]
  }
  project.captions.push(caption)

  assert.equal(resizeProjectCanvas(project, 1080, 1920), true)
  assert.deepEqual(project.settings, { width: 1080, height: 1920, fps: 60 })
  assert.deepEqual(clip.transform, { x: 540, y: 960, scale: 1.125, rotation: 0 })
  assert.equal(clip.channels!.x![0].value, 270)
  assert.equal(clip.channels!.y![0].value, 1440)
  assert.equal(clip.motionFx!.panX, 90)
  assert.equal(clip.motionFx!.panY, 160)
  assert.equal(clip.motionFx!.gentlePanX, 36)
  assert.equal(clip.motionFx!.gentlePanY, -80)
  assert.equal(caption.motion!.x, 112.5)
  assert.ok(Math.abs(caption.motion!.y - 177.77777777777777) < 1e-9)
  assert.equal(project.trackers[0].keyframes[0].x, 675)
  assert.ok(Math.abs(project.trackers[0].keyframes[0].y - 1244.4444444444443) < 1e-9)
})

test('switching landscape to portrait and back restores geometry', () => {
  const project = defaultProject('16:9')
  const originalStyle = structuredClone(project.captionStyle)
  project.clips.clip = {
    id: 'clip', assetId: 'asset', trackId: project.tracks[0].id, start: 0, inPoint: 0,
    duration: 2, volume: 1, transform: { x: 731, y: 402, scale: 0.73, rotation: 0.2 }
  }
  const originalTransform = structuredClone(project.clips.clip.transform)

  resizeProjectCanvas(project, 1080, 1920)
  resizeProjectCanvas(project, 1920, 1080)

  for (const key of ['x', 'y', 'scale', 'rotation'] as const) {
    assert.ok(Math.abs(project.clips.clip.transform[key] - originalTransform[key]) < 1e-9)
  }
  assert.ok(Math.abs(project.captionStyle.fontSize - originalStyle.fontSize) < 1e-9)
  assert.ok(Math.abs(project.captionStyle.outlineWidth - originalStyle.outlineWidth) < 1e-9)
})

test('invalid or unchanged canvas sizes are ignored', () => {
  const project = defaultProject()
  assert.equal(resizeProjectCanvas(project, 1920, 1080), false)
  assert.equal(resizeProjectCanvas(project, 0, 1080), false)
  assert.deepEqual(project.settings, { width: 1920, height: 1080, fps: 60 })
})
