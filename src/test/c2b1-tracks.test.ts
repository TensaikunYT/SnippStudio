// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// Phase Ç2b.1, decision 8 and the rest of L7: a multi-row drag that would
// fall off the top row keeps its rows (L5); keep-range leaves a packed track
// packed (L8); the video track's menu has no "Solo" (L9); a new track is
// named from the highest number, a track can be renamed, the sound effects
// track is found by its role — and an older file's SFX track is given it
// (format 3) (L10); the bulk presets leave a locked track alone (L7).
import './dom-stub'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import test from 'node:test'
import { defaultProject, type Clip, type Project } from '../renderer/src/types'
import { useStore } from '../renderer/src/state/store'
import { commandByName, runCommand } from '../renderer/src/commands'
import { planTimelinePlacement } from '../renderer/src/timeline/placement'
import { CONVERSIONS, CURRENT_FORMAT, convertProject } from '../renderer/src/model/format'

const S = useStore.getState
const T0 = { x: 960, y: 540, scale: 1, rotation: 0 }
const SRC = join(__dirname, '..', '..', 'src', 'renderer', 'src')

function project(): Project {
  const p = defaultProject()
  p.tracks = [
    { id: 'V2', kind: 'video', name: 'V2', clipIds: [] },
    { id: 'V1', kind: 'video', name: 'V1', clipIds: [] },
    { id: 'A1', kind: 'audio', name: 'A1', clipIds: [] }
  ]
  p.assets = [{ id: 'pic', kind: 'image', name: 'pic.png', url: 'media://pic', size: 1, duration: 0, width: 1920, height: 1080, hasAudio: false } as never, { id: 'vid', kind: 'video', name: 'vid.mp4', url: 'media://vid', size: 1, duration: 100, width: 1920, height: 1080, hasAudio: false } as never]
  const put = (id: string, assetId: string, trackId: string, start: number, duration: number, extra: Partial<Clip> = {}) => {
    p.clips[id] = { id, assetId, trackId, start, inPoint: 0, duration, transform: { ...T0 }, volume: 1, ...extra }
    p.tracks.find((t) => t.id === trackId)!.clipIds.push(id)
  }
  put('y', 'pic', 'V2', 10, 5)
  put('x', 'pic', 'V1', 10, 5)
  put('a', 'vid', 'V1', 0, 8)
  p.tracks[1].clipIds = ['a', 'x']
  p.captions = []
  return p
}

test('L5: X and Y selected, X dragged up onto V2 (Y has no row above): neither changes row', () => {
  const p = project()
  const plan = planTimelinePlacement(p, 'x', ['x', 'y'], 0, 'V2', null, false)
  assert.ok(plan)
  assert.equal(plan.positions.x.trackId, 'V1')
  assert.equal(plan.positions.y.trackId, 'V2')
  assert.equal(plan.positions.x.start, 10)
  assert.equal(plan.positions.y.start, 10)
})

test('L8: keep-range on a packed track leaves it packed', () => {
  const p = project()
  p.tracks[1].autoPack = true
  p.clips.x.start = 8
  const out = runCommand(p, commandByName('clip.keepRange'), { clipId: 'a', range: [2, 5] }).project
  assert.equal(out.clips.a.start, 0)
  assert.equal(out.clips.a.duration, 3)
  assert.equal(out.clips.x.start, 3, 'x closes up behind it')
})

test('L9: the video track menu has no Solo (it silenced every other sound and drew the picture as before)', () => {
  const src = readFileSync(join(SRC, 'components', 'timeline', 'track-header.tsx'), 'utf8')
  // (Phase 3c.2: the buttons are building blocks; Solo is the one behind the audio test.)
  assert.ok(!/track\.kind === 'video' && \([^)]*solo/i.test(src))
  assert.equal((src.match(/track-solo/g) ?? []).length, 1, 'one Solo button')
  assert.match(src, /track\.kind === 'audio' && \(\s*<Tooltip[^\n]*solo[\s\S]{0,160}track-solo/)
})

test('L10: a new track takes the next number after the highest; a track is renamed; the SFX track is found by its role', () => {
  let p = project()
  p = runCommand(p, commandByName('track.add'), { kind: 'video' }).project
  assert.deepEqual(p.tracks.filter((t) => t.kind === 'video').map((t) => t.name), ['V3', 'V2', 'V1'])
  p = runCommand(p, commandByName('track.delete'), { trackId: 'V2' }).project
  p = runCommand(p, commandByName('track.add'), { kind: 'video' }).project
  const names = p.tracks.filter((t) => t.kind === 'video').map((t) => t.name)
  assert.equal(new Set(names).size, names.length, `unique: ${names.join(', ')}`)
  assert.deepEqual(names, ['V4', 'V3', 'V1'])
  // Renamed, the sound effects track is still the one effects go on.
  S().loadProject(project())
  const sfx = { id: 'sfx', kind: 'audio', name: 'whoosh', url: 'media://sfx', size: 1, duration: 1, width: 0, height: 0, hasAudio: true } as never
  useStore.setState({ project: { ...S().project, assets: [...S().project.assets, sfx] } })
  assert.equal(S().placeSoundEffect('sfx', [1], 0, 1), 1)
  const track = S().project.tracks.find((t) => t.role === 'sfx')!
  assert.ok(track)
  S().renameTrack(track.id, 'Hits')
  assert.equal(S().project.tracks.find((t) => t.id === track.id)!.name, 'Hits')
  assert.equal(S().placeSoundEffect('sfx', [5], 0, 1), 1)
  assert.equal(S().project.tracks.filter((t) => t.kind === 'audio').length, 2, 'no second SFX track')
  assert.equal(S().project.tracks.find((t) => t.id === track.id)!.clipIds.length, 2)
})

test('format 3: an older file\'s "SFX" tracks are given the role; the conversion can run twice', () => {
  assert.ok(CURRENT_FORMAT >= 3)
  const old = project()
  old.tracks.push({ id: 's', kind: 'audio', name: 'SFX 2', clipIds: [] }, { id: 'm', kind: 'audio', name: 'SFX music', clipIds: [] })
  const conv = CONVERSIONS.find((c) => c.to === 3)!
  const once = structuredClone(old)
  conv.run(once)
  assert.equal(once.tracks.find((t) => t.id === 's')!.role, 'sfx')
  assert.equal(once.tracks.find((t) => t.id === 'm')!.role, undefined)
  const twice = structuredClone(once)
  conv.run(twice)
  assert.deepEqual(twice, once)
  // Read as a format-2 file, it is converted.
  const read = structuredClone(old)
  assert.deepEqual(convertProject(read, 2).length, CURRENT_FORMAT - 2)
  assert.equal(read.tracks.find((t) => t.id === 's')!.role, 'sfx')
})

test('L7: the bulk presets with no track named leave a locked track as it is', () => {
  const p = project()
  p.tracks[0].locked = true
  const out = runCommand(p, commandByName('transitions.mix'), { duration: 0.5 }).project
  assert.equal(out.clips.y.transitionOut, undefined)
  const src = readFileSync(join(SRC, 'components', 'timeline', 'transitions.tsx'), 'utf8')
  assert.match(src, /track\.kind !== 'video' \|\| track\.locked\) return null/)
})
