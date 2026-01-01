// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
import assert from 'node:assert/strict'
import test from 'node:test'
import { collectVisualCuts } from '../renderer/src/audio/sfx'
import { defaultProject, type Clip } from '../renderer/src/types'

const imageClip = (id: string, trackId: string, start: number, duration: number): Clip => ({
  id, assetId: `asset-${id}`, trackId, start, duration, inPoint: 0,
  transform: { x: 960, y: 540, scale: 1, rotation: 0 }, volume: 1
})

test('sound cuts include touching visual clips, not gaps or adjustment layers', () => {
  const project = defaultProject()
  const video = project.tracks.find((track) => track.kind === 'video')!
  for (const [id, start, duration] of [['a', 0, 3], ['b', 3, 2], ['c', 5.6, 1], ['d', 6.6, 1]] as const) {
    project.clips[id] = imageClip(id, video.id, start, duration)
    project.assets.push({ id: `asset-${id}`, kind: 'image', name: `${id}.png`, url: `media://${id}`, size: 1, duration: 0, width: 1920, height: 1080, hasAudio: false })
    video.clipIds.push(id)
  }
  assert.deepEqual(collectVisualCuts(project), [3, 6.6])
  project.clips.b.adjustment = true
  assert.deepEqual(collectVisualCuts(project), [6.6])
})

test('dense cuts are deduplicated against the last kept cut', () => {
  const project = defaultProject()
  const video = project.tracks.find((track) => track.kind === 'video')!
  for (let index = 0; index < 4; index++) {
    const id = `short-${index}`
    project.clips[id] = imageClip(id, video.id, index * 0.06, 0.06)
    project.assets.push({ id: `asset-${id}`, kind: 'image', name: `${id}.png`, url: `media://${id}`, size: 1, duration: 0, width: 1920, height: 1080, hasAudio: false })
    video.clipIds.push(id)
  }
  assert.deepEqual(collectVisualCuts(project), [0.06, 0.18])
})

test('batch sound placement keeps visual and dialogue clips put, uses SFX lanes and undoes at once', async () => {
  Object.defineProperty(globalThis, 'document', { configurable: true, value: { createElement: () => ({ width: 0, height: 0, getContext: () => null }) } })
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { getItem: () => null, setItem: () => {} } })
  const { useStore } = await import('../renderer/src/state/store')
  const project = defaultProject()
  const video = project.tracks.find((track) => track.kind === 'video')!
  const audio = project.tracks.find((track) => track.kind === 'audio')!
  project.clips.picture = imageClip('picture', video.id, 0, 7)
  project.clips.voice = { ...imageClip('voice', audio.id, 0, 7), assetId: 'voice-asset' }
  video.clipIds = ['picture']
  audio.clipIds = ['voice']
  project.assets.push(
    { id: 'asset-picture', kind: 'image', name: 'picture.png', url: 'media://picture', size: 1, duration: 0, width: 1920, height: 1080, hasAudio: false },
    { id: 'voice-asset', kind: 'audio', name: 'voice.wav', url: 'media://voice', size: 1, duration: 7, width: 0, height: 0, hasAudio: true },
    { id: 'whoosh', kind: 'audio', name: 'whoosh.wav', url: 'media://whoosh', size: 1, duration: 1, width: 0, height: 0, hasAudio: true }
  )
  useStore.getState().loadProject(project)
  const beforeUndo = useStore.getState().past.length
  assert.equal(useStore.getState().placeSoundEffect('whoosh', [2, 2.4, 5], 0.1, 0.7), 3)
  const result = useStore.getState().project
  assert.equal(result.clips.picture.start, 0)
  assert.equal(result.clips.voice.start, 0)
  assert.equal(audio.clipIds.length, 1)
  assert.equal(result.tracks.filter((track) => track.name.startsWith('SFX')).length, 2)
  assert.deepEqual(Object.values(result.clips).filter((clip) => clip.assetId === 'whoosh').map((clip) => clip.start).sort((a, b) => a - b), [1.9, 2.3, 4.9])
  assert.equal(useStore.getState().placeSoundEffect('whoosh', [2, 2.4, 5], 0.1, 0.7), 0)
  assert.equal(useStore.getState().past.length, beforeUndo + 1)
  useStore.getState().undo()
  assert.equal(Object.values(useStore.getState().project.clips).filter((clip) => clip.assetId === 'whoosh').length, 0)
})
