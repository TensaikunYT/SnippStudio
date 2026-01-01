// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// Phase Ç2a.2, decision 1 (report P4, D3 narrow road): where a media file
// lives and what was read from it (url, path, missing, size, the probed
// duration / width / height / sound, a code film's fps) stay in the project,
// but undo and redo do not carry them: after a jump they are the CURRENT
// project's.
import { fixture, resetWorld } from './undo-fixture'
import assert from 'node:assert/strict'
import test from 'node:test'
import { useStore } from '../renderer/src/state/store'
import type { Asset, Project } from '../renderer/src/types'

const S = useStore.getState
const asset = (id: string, p: Project = S().project): Asset => p.assets.find((a) => a.id === id)!

function missingWorld(): void {
  resetWorld()
  const p = fixture()
  const v = p.assets.find((a) => a.id === 'vid2')!
  Object.assign(v, { url: '', missing: true, path: 'C:\\old\\vid2.mp4', size: 100, duration: 30 })
  S().loadProject(p)
}

test('P4: edit, relink, undo — the media stays relinked (missing is not brought back)', () => {
  missingWorld()
  S().setTime(5)
  S().addMarkerAtPlayhead() // an edit while the file is missing
  const relinked = { url: 'media://local/C%3A%5Cnew%5Cvid2.mp4', path: 'C:\\new\\vid2.mp4', size: 200, missing: undefined, duration: 24, width: 3840, height: 2160, hasAudio: false }
  S().updateAsset('vid2', relinked as Partial<Asset>)
  S().undo()
  const a = asset('vid2')
  assert.equal(S().project.markers?.length, 2, 'the edit is undone')
  assert.ok(!a.missing, 'not missing again')
  assert.equal(a.url, relinked.url)
  assert.equal(a.path, relinked.path)
  assert.equal(a.size, 200)
  assert.equal(a.duration, 24, 'the duration read from the new file')
  assert.equal(a.width, 3840)
  assert.equal(a.hasAudio, false)
  S().redo()
  assert.equal(S().project.markers?.length, 3, 'the edit is back')
  assert.ok(!asset('vid2').missing)
  assert.equal(asset('vid2').url, relinked.url)
})

test('P4: a code film\'s corrected duration and fps survive an undo past the correction', () => {
  resetWorld()
  const p = fixture()
  p.assets.push({ id: 'film', kind: 'code', name: 'film', path: 'C:\\films\\a', url: 'snippfilm://x/', size: 0, duration: 60, width: 1920, height: 1080, hasAudio: false, code: { fps: 60 } })
  S().loadProject(p)
  S().setTime(5)
  S().addMarkerAtPlayhead()
  // The film's page said what it really is (media/codefilm.ts).
  S().setAssetDerived('film', { duration: 42.5, width: 1280, height: 720, code: { fps: 30 } })
  S().undo()
  const f = asset('film')
  assert.equal(f.duration, 42.5)
  assert.equal(f.width, 1280)
  assert.equal(f.code?.fps, 30)
})

test('P4: an asset deleted and brought back by undo keeps what the step had; the others follow the current project', () => {
  missingWorld()
  S().updateAsset('vid2', { url: 'media://local/new', path: 'C:\\new\\vid2.mp4', missing: undefined } as Partial<Asset>)
  S().deleteAsset('img1')
  S().undo()
  assert.ok(asset('img1'), 'img1 is back')
  assert.equal(asset('img1').path, fixture().assets.find((a) => a.id === 'img1')!.path)
  assert.equal(asset('vid2').url, 'media://local/new', 'the relink is kept')
  // Nothing else of the step is touched: the clips of img1 are back too.
  assert.ok(Object.values(S().project.clips).some((c) => c.assetId === 'img1'))
})

test('P4 and P13: undo back to the saved project is "saved" only when no media field differs from the file', () => {
  missingWorld()
  S().setTime(5)
  S().addMarkerAtPlayhead()
  S().undo()
  assert.equal(S().dirty, false, 'back to the project as opened')
  S().redo()
  // A relink, then back: the file still has the old path, so it is unsaved.
  S().updateAsset('vid2', { url: 'media://local/new', path: 'C:\\new\\vid2.mp4', missing: undefined } as Partial<Asset>)
  S().undo()
  assert.equal(asset('vid2').path, 'C:\\new\\vid2.mp4')
  assert.equal(S().dirty, true, 'the relink is not in the file yet')
})

test('P4: the Agent tab\'s "back to here" keeps a relink made since', async () => {
  const { recordStep, backTo } = await import('../renderer/src/agent/steps')
  missingWorld()
  recordStep('call-1')
  S().setTime(5)
  S().addMarkerAtPlayhead()
  S().updateAsset('vid2', { url: 'media://local/new', path: 'D:/new/vid2.mp4', missing: undefined, duration: 24 } as Partial<Asset>)
  assert.equal(backTo('call-1'), true)
  assert.equal(S().project.markers?.length, 2, 'back to after the step')
  assert.ok(!asset('vid2').missing)
  assert.equal(asset('vid2').path, 'D:/new/vid2.mp4')
  assert.equal(asset('vid2').duration, 24)
})
