// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// Phase Ç2b, E2 (the e2e `backup-before-autosave` timed out in 2 of 3 full
// runs of Ç2b.1): an autosave right after an open raced the re-read of the
// media files that changed on disk (phase Ç2a.2, decision 2). The autosave
// wrote the project without the new fingerprints; the re-read landed after
// it and made the project unsaved again ("Auto-saved." and, at once, "1
// media file changed on disk… read again"). Now the autosave waits for that
// re-read: what it writes holds the re-read, and the project stays saved.
import './dom-stub'
import { fixture, resetWorld } from './undo-fixture'
import assert from 'node:assert/strict'
import test from 'node:test'
import { useStore } from '../renderer/src/state/store'
import type { Asset, Project } from '../renderer/src/types'
import { refreshChangedMedia, type PickedFile, type RelinkDeps } from '../renderer/src/media/relink'
import { autosaveOnce } from '../renderer/src/media/autosave'

const S = useStore.getState

/** A probe that answers when the test lets it. */
function slowProbe(): RelinkDeps & { answer: () => void } {
  let answer = (): void => undefined
  const gate = new Promise<void>((r) => (answer = r))
  return {
    answer: () => answer(),
    drop: () => undefined,
    probe: async (f: PickedFile) => {
      await gate
      return { id: 'probe', name: f.name, url: f.url, size: f.size, duration: 60, width: 1920, height: 1080, hasAudio: true, kind: 'video' } as Asset
    }
  }
}

test('E2: an autosave during the open\'s media re-read writes the re-read; the project stays saved', async () => {
  resetWorld()
  const p = fixture()
  Object.assign(p.assets.find((a) => a.id === 'vid1')!, { path: 'C:\\m\\vid1.mp4', size: 100, mtime: 5 })
  S().loadProject(p)
  // Opened repaired: unsaved.
  S().setDirty(true)
  const probe = slowProbe()
  const reread = refreshChangedMedia([{ id: 'vid1', size: 140, mtime: 9 }], probe)
  const written: Project[] = []
  const save = autosaveOnce({ enabled: () => true, path: () => 'C:\\p\\p.snipp', save: async (project) => (written.push(project), true) })
  // The probe answers a moment later (the file is being read).
  await new Promise((r) => setTimeout(r, 20))
  probe.answer()
  await reread
  const r = await save
  assert.equal(r, 'saved')
  assert.equal(written.length, 1)
  assert.equal(written[0].assets.find((a) => a.id === 'vid1')!.size, 140, 'the file holds the re-read fingerprint')
  assert.equal(S().dirty, false, 'saved, and nothing came after the save')
})

test('E2: with no re-read pending the autosave writes at once; an edit during the write keeps the project unsaved', async () => {
  resetWorld()
  S().loadProject(fixture())
  S().setDirty(true)
  let release = (): void => undefined
  const held = new Promise<void>((r) => (release = r))
  let writing = (): void => undefined
  const started = new Promise<void>((r) => (writing = r))
  const save = autosaveOnce({ enabled: () => true, path: () => 'x.snipp', save: async () => (writing(), await held, true) })
  await started
  S().addMarkerAtPlayhead()
  release()
  assert.equal(await save, 'stale')
  assert.equal(S().dirty, true)
  assert.equal(await autosaveOnce({ enabled: () => true, path: () => null, save: async () => true }), 'skipped')
})
