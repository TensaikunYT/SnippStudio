// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// Audit patch (yama-c), O1: taking a compound apart multiplies a child's
// speed by the compound's (a 20x child in a 10x compound plays at 200x: core
// polish B, K3, a legitimate speed), but the repair of every project read
// (open, the recovery snapshot, the agent's restore points) held clip speeds
// to 100x: the clip kept its length and showed half its media, and the next
// save made that for good. The repair's range is now 0.01x – 10 000x (the
// most two commands of 0.1x – 100x can make); the commands still offer 0.1x – 100x.
import './dom-stub'
import assert from 'node:assert/strict'
import test from 'node:test'
import { useStore } from '../renderer/src/state/store'
import { PROJECT_LIMITS } from '../renderer/src/model/repair'
import { readProjectFile, readProjectToOpen, serializeProject } from '../renderer/src/media/projectio'
import { mediaAtLocal } from '../renderer/src/timeline/media-time'
import { SPEED_MAX, SPEED_MIN } from '../renderer/src/timeline/speed'
import { defaultProject, type Clip, type Project } from '../renderer/src/types'

const S = useStore.getState
const T = { x: 960, y: 540, scale: 1, rotation: 0 }

function uncompounded(): { project: Project; clip: Clip } {
  const p = defaultProject()
  p.settings.fps = 30
  p.tracks = [{ id: 'V2', kind: 'video', name: 'V2', clipIds: ['z'] }, { id: 'V1', kind: 'video', name: 'V1', clipIds: ['a'] }, { id: 'A1', kind: 'audio', name: 'A1', clipIds: [] }]
  p.assets = [{ id: 'vid', kind: 'video', name: 'vid.mp4', url: 'media://vid', path: 'C:/m/vid.mp4', size: 1, duration: 600, width: 1920, height: 1080, hasAudio: true } as never]
  p.clips = {
    a: { id: 'a', assetId: 'vid', trackId: 'V1', start: 0, inPoint: 0, duration: 50, transform: T, volume: 1 } as Clip,
    z: { id: 'z', assetId: 'vid', trackId: 'V2', start: 0, inPoint: 300, duration: 2.5, transform: T, volume: 1 } as Clip
  }
  S().loadProject(p)
  S().setClipSpeed('a', 20)
  useStore.setState({ selectedClipIds: ['a', 'z'] })
  S().compoundSelection()
  const comp = Object.values(S().project.clips).find((c) => c.nested)!
  S().setClipSpeed(comp.id, 10)
  S().uncompoundClip(comp.id)
  const clip = Object.values(S().project.clips).find((x) => x.inPoint < 200)!
  return { project: S().project, clip }
}

test('O1: the repair holds speeds to 0.01x – 10 000x; the commands still to 0.1x – 100x', () => {
  assert.equal(PROJECT_LIMITS.minSpeed, 0.01)
  assert.equal(PROJECT_LIMITS.maxSpeed, 10_000)
  assert.equal(SPEED_MIN, 0.1)
  assert.equal(SPEED_MAX, 100)
  assert.ok(PROJECT_LIMITS.maxSpeed >= SPEED_MAX * SPEED_MAX && PROJECT_LIMITS.minSpeed <= SPEED_MIN * SPEED_MIN)
})

test('O1: a 200x clip from a compound taken apart keeps its speed and media through save → open, the recovery reader and a restore point', () => {
  const { project, clip } = uncompounded()
  assert.ok(Math.abs((clip.speed ?? 1) - 200) < 1e-9, `uncompounded at ${clip.speed}x`)
  const json = serializeProject(project)
  for (const [name, read] of [['open / recovery', readProjectToOpen], ['restore point', readProjectFile]] as const) {
    const back = read(json)
    assert.deepEqual(back.repaired, [], name)
    const d = back.project.clips[clip.id]
    assert.equal(d.speed, clip.speed, name)
    assert.equal(d.duration, clip.duration, name)
    assert.equal(mediaAtLocal(d, 0.2), mediaAtLocal(clip, 0.2), name)
  }
})

test('O1: a speed past the repair\'s range is still brought back to it and told', () => {
  const { project, clip } = uncompounded()
  const raw = JSON.parse(serializeProject(project))
  raw.clips[clip.id].speed = 1e9
  const back = readProjectToOpen(JSON.stringify(raw))
  assert.equal(back.project.clips[clip.id].speed, 10_000)
  assert.ok(back.repaired.some((r) => r.code === 'limits'))
})
