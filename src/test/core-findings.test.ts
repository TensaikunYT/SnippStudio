// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// The report's store findings of phase Ç2a.1 (haritalar/cekirdek-proje-
// mantigi.md): P5 (a paste into another project), P6 (a copy of a compound
// keeps its children's ids), P13 (undo back to the saved project), P16 (an
// asset used inside a compound). P2 (Alt+press) is the e2e scenario
// 39-alt-press: a pointer gesture.
import { fixture, resetWorld } from './undo-fixture'
import assert from 'node:assert/strict'
import test from 'node:test'
import { useStore } from '../renderer/src/state/store'
import { checkProject, describeProblems } from '../renderer/src/model/check'
import { defaultProject, type Clip, type Project } from '../renderer/src/types'

const S = useStore.getState
const all = (p: Project): Clip[] => {
  const out: Clip[] = []
  const walk = (list: Clip[]): void => list.forEach((c) => (out.push(c), c.nested && walk(c.nested.clips)))
  walk(Object.values(p.clips))
  return out
}
const clean = (what: string): void => assert.equal(describeProblems(checkProject(S().project)), '', what)

test('P5: clips copied in one project and pasted into another bring their media along (none is invisible)', () => {
  resetWorld()
  S().loadProject(fixture())
  S().selectClips(['ov', 'ca'])
  S().copySelection()
  // Another project, which has none of that media.
  S().loadProject(defaultProject())
  S().setTime(3)
  S().pasteAtPlayhead()
  const p = S().project
  const pasted = Object.values(p.clips)
  // (ca's sound sa comes with it: the link is on by default since phase
  // Ç2b.1, and the pasted pair is linked to each other.)
  assert.equal(pasted.length, 3)
  const pair = pasted.filter((c) => c.linkId)
  assert.equal(pair.length, 2)
  assert.equal(pair[0].linkId, pair[1].linkId)
  for (const c of pasted) assert.ok(p.assets.some((a) => a.id === c.assetId), `${c.id}: its media is in the project`)
  clean('after the paste')
  // Pasted again: the media is not added twice.
  S().pasteAtPlayhead()
  assert.equal(S().project.assets.length, 2)
  // A project that has the same file under another id uses its own.
  resetWorld()
  const other = defaultProject()
  const f = fixture()
  other.assets = [{ ...f.assets.find((a) => a.id === 'img1')!, id: 'mine' }]
  S().loadProject(other)
  S().pasteAtPlayhead()
  const q = S().project
  assert.equal(q.assets.filter((a) => a.path === 'C:\\media\\img1').length, 1, 'one asset of that file')
  assert.ok(Object.values(q.clips).some((c) => c.assetId === 'mine'), 'the pasted picture uses the project\'s own asset')
  clean('pasted onto the same file')
})

test('P6: a pasted, duplicated or Alt-dragged compound has new ids at every depth and its own links', () => {
  resetWorld()
  S().loadProject(fixture())
  // A compound holding a linked picture and its sound.
  S().selectClips(['ca', 'sa'])
  S().compoundSelection()
  const compound = Object.values(S().project.clips).find((c) => c.nested)!
  const ids = (): string[] => all(S().project).map((c) => c.id)
  const unique = (what: string): void => assert.equal(new Set(ids()).size, ids().length, `${what}: unique ids at every depth`)
  S().selectClips([compound.id])
  S().duplicateSelection()
  unique('duplicate')
  S().selectClips([compound.id])
  S().copySelection()
  S().setTime(60)
  S().pasteAtPlayhead()
  unique('paste')
  S().undoable(() => {
    const [copy] = S().duplicateClipsInPlace([compound.id])
    S().moveClip(copy, 90)
  })
  unique('copy in place (Alt-drag)')
  clean('after the copies')
  // Taken apart, each copy's picture and sound are linked to each other only.
  for (const c of Object.values(S().project.clips).filter((x) => x.nested)) S().uncompoundClip(c.id)
  const links = new Map<string, number>()
  for (const c of Object.values(S().project.clips)) if (c.linkId) links.set(c.linkId, (links.get(c.linkId) ?? 0) + 1)
  assert.ok([...links.values()].every((n) => n === 2), `every link joins two clips: ${JSON.stringify([...links.values()])}`)
  clean('after taking them apart')
})

test('P13: undo back to the saved project is saved again; redo away from it is not', () => {
  resetWorld()
  S().loadProject(fixture())
  assert.equal(S().dirty, false)
  S().splitClipAt('cb', 15)
  assert.equal(S().dirty, true)
  S().undo()
  assert.equal(S().dirty, false, 'back to the file as opened')
  S().redo()
  assert.equal(S().dirty, true)
  // A save makes this the file's project.
  S().setDirty(false)
  S().addMarkerAtPlayhead()
  S().undo()
  assert.equal(S().dirty, false, 'back to the file as saved')
  S().undo()
  assert.equal(S().dirty, true, 'before the save is not the file')
  // A thumbnail arriving does not make it another project.
  S().redo()
  assert.equal(S().dirty, false)
  S().setAssetDerived('img1', { thumbnail: 'data:image/jpeg;base64,AA' })
  S().addMarkerAtPlayhead()
  S().undo()
  assert.equal(S().dirty, false, 'a derived thumbnail is no change of the file')
  // Made unsaved by hand (a recovered or repaired project): nothing returns it.
  S().setDirty(true)
  S().addMarkerAtPlayhead()
  S().undo()
  assert.equal(S().dirty, true)
})

test('P16: an asset used inside a compound clip is not deleted (and nothing changes); one used only on top is', () => {
  resetWorld()
  S().loadProject(fixture())
  S().selectClips(['cb', 'cc'])
  S().compoundSelection()
  const before = S().project
  const steps = S().past.length
  assert.equal(S().deleteAsset('vid2'), false, 'cb (vid2) is inside the compound')
  assert.equal(S().project, before, 'nothing changed')
  assert.equal(S().past.length, steps)
  assert.equal(S().deleteAsset('img1'), true, 'ov (img1) is on top')
  assert.ok(!S().project.assets.some((a) => a.id === 'img1'))
  clean('after the delete')
})
