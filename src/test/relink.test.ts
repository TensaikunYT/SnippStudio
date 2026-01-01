// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// Phase Ç2a.2, decision 2 (report P7, P12, P15): a relink reads the new file
// (stand-in probe), refuses another kind and counts the clips past a shorter
// file's end; a file changed on disk is found by its fingerprint on open
// (its clips are not shortened to the old duration) and read again; a proxy
// goes with a relink and with the project.
import { stubApi } from './api-stub'
import './dom-stub'
import { fixture, resetWorld } from './undo-fixture'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { useStore } from '../renderer/src/state/store'
import type { Asset } from '../renderer/src/types'
import { clipsPastEnd, refreshChangedMedia, relinkAsset, type PickedFile, type RelinkDeps } from '../renderer/src/media/relink'
import { fingerprintState } from '../renderer/src/media/fingerprint'
import { openProjectByPath, serializeProject, setLastProjectPath } from '../renderer/src/media/projectio'
import { dropInput, proxyUrls, releaseAllMedia } from '../renderer/src/media/sources'
import { checkProject } from '../renderer/src/model/check'

const S = useStore.getState
const asset = (id: string): Asset => S().project.assets.find((a) => a.id === id)!

/** A probe that reads what the test says each file is. */
function deps(files: Record<string, Partial<Asset> | null>): RelinkDeps & { dropped: string[] } {
  const dropped: string[] = []
  return {
    dropped,
    drop: (id) => void dropped.push(id),
    probe: async (f: PickedFile) => {
      const got = files[f.path]
      if (!got) return null
      return { id: 'probe', name: f.name, url: f.url, size: f.size, duration: 0, width: 0, height: 0, hasAudio: false, kind: 'video', ...got } as Asset
    }
  }
}
const file = (p: string, size = 500, mtime = 1_700_000_000_000): PickedFile => ({ url: `media://local/${encodeURIComponent(p)}`, name: path.basename(p), path: p, size, mtime })

function missingVid1(): void {
  resetWorld()
  const p = fixture()
  Object.assign(p.assets.find((a) => a.id === 'vid1')!, { url: '', missing: true, path: 'C:\\gone\\vid1.mp4' })
  useStore.getState().loadProject(p)
}

test('P7: a relink reads the new file — its duration, size, picture and sound — and counts the clips past a shorter end', async () => {
  missingVid1()
  // vid1's clips: ca and sa read 5..15 s of it.
  const d = deps({ 'D:\\new\\vid1.mp4': { kind: 'video', duration: 12, width: 1280, height: 720, hasAudio: false } })
  const r = await relinkAsset('vid1', file('D:\\new\\vid1.mp4'), d)
  assert.deepEqual(r, { ok: true, pastEnd: 2 }, 'ca and sa run past 12 s')
  const a = asset('vid1')
  assert.equal(a.duration, 12)
  assert.equal(a.width, 1280)
  assert.equal(a.hasAudio, false)
  assert.equal(a.size, 500)
  assert.equal(a.mtime, 1_700_000_000_000)
  assert.equal(a.path, 'D:\\new\\vid1.mp4')
  assert.ok(!a.missing)
  assert.deepEqual(d.dropped, ['vid1'], 'its caches dropped')
  assert.equal(S().past.length, 0, 'a relink is no undo step')
  // Edit, then undo: still relinked, with the new file's numbers (decision 1).
  S().setTime(3)
  S().addMarkerAtPlayhead()
  S().undo()
  assert.ok(!asset('vid1').missing)
  assert.equal(asset('vid1').duration, 12)
})

test('P7: a file of another kind, or no media at all, is refused and nothing changes', async () => {
  missingVid1()
  const before = S().project
  const d = deps({ 'D:\\pic.png': { kind: 'image', width: 100, height: 100 } })
  assert.deepEqual(await relinkAsset('vid1', file('D:\\pic.png'), d), { ok: false, why: 'kind', want: 'video', got: 'image' })
  assert.deepEqual(await relinkAsset('vid1', file('D:\\notes.txt'), d), { ok: false, why: 'unreadable' })
  assert.equal(S().project, before, 'the project is as it was')
  assert.deepEqual(d.dropped, [], 'no cache dropped')
})

test('clipsPastEnd counts inside compounds and leaves a frozen still alone', () => {
  resetWorld()
  const p = fixture()
  p.clips.ca.freeze = 2
  assert.equal(clipsPastEnd(p, 'vid1', 12), 1, 'sa only: ca is a still')
  assert.equal(clipsPastEnd(p, 'vid1', 60), 0)
})

test('P15: the fingerprint — same, taken from the disk (none stored yet), or changed', () => {
  const a = { kind: 'video' as const, size: 100, mtime: 5 }
  assert.equal(fingerprintState(a, { size: 100, mtime: 5 }), 'same')
  assert.equal(fingerprintState(a, { size: 100, mtime: 6 }), 'changed')
  assert.equal(fingerprintState(a, { size: 101, mtime: 5 }), 'changed')
  assert.equal(fingerprintState({ kind: 'video', size: 100 }, { size: 100, mtime: 9 }), 'fill')
  assert.equal(fingerprintState({ kind: 'video', size: 100 }, { size: 120, mtime: 9 }), 'changed')
  assert.equal(fingerprintState({ kind: 'code', size: 0 }, { size: 0, mtime: 9 }), 'same')
  assert.equal(fingerprintState(a, null), 'same', 'a missing file is not compared')
})

test('P15 and the Ç2a.1 risk: a file changed on disk is listed on open, and its clips are NOT shortened to the stored duration', async () => {
  resetWorld()
  const dir = mkdtempSync(path.join(tmpdir(), 'snipp-print-'))
  const projectFile = path.join(dir, 'p.snipp')
  const p = fixture()
  // vid1 was 60 s and saved with its fingerprint; vid2 is unchanged but its
  // stored duration (30) is shorter than a clip reads (a damaged file).
  Object.assign(p.assets.find((a) => a.id === 'vid1')!, { path: 'C:\\m\\vid1.mp4', size: 100, mtime: 5, duration: 8 })
  Object.assign(p.assets.find((a) => a.id === 'vid2')!, { path: 'C:\\m\\vid2.mp4', size: 200, mtime: 7, duration: 11 })
  writeFileSync(projectFile, JSON.stringify(p))
  const resolved = {
    'C:\\m\\vid1.mp4': { url: 'media://1', size: 140, mtime: 9 }, // re-exported: changed
    'C:\\m\\vid2.mp4': { url: 'media://2', size: 200, mtime: 7 } // the same file
  }
  stubApi({ setCurrentProjectPath: () => {}, openProjectPath: (f: string) => ({ json: readFileSync(f, 'utf8'), path: f, resolved }) })
  const r = await openProjectByPath(projectFile)
  assert.ok(r)
  assert.deepEqual(r.changed, [{ id: 'vid1', size: 140, mtime: 9 }])
  // ca / sa read vid1 from 5 to 15 s: past the stored 8 s, but the file
  // changed, so they are kept for the new file to be read.
  assert.equal(r.project.clips.ca.duration, 10, 'ca kept whole')
  assert.equal(r.project.clips.sa.duration, 10, 'sa kept whole')
  // cb reads vid2 2..12 s, past its 11 s: the file did not change, so the
  // repair shortens it as before.
  assert.ok(r.project.clips.cb.duration < 10, 'cb shortened to its media')
  assert.ok(r.repaired.some((x) => x.code === 'media-end'))
  setLastProjectPath(null)

  // Read again (stand-in probe): vid1 is 60 s now, nothing runs past it.
  S().loadProject(r.project)
  const d = deps({ 'C:\\m\\vid1.mp4': { kind: 'video', duration: 60, width: 1920, height: 1080, hasAudio: true } })
  const out = await refreshChangedMedia(r.changed, d)
  assert.deepEqual(out, { updated: 1, failed: 0, pastEnd: 0 })
  assert.equal(asset('vid1').duration, 60)
  assert.equal(asset('vid1').size, 140)
  assert.equal(asset('vid1').mtime, 9, 'the new fingerprint, saved with the next save')
  assert.equal(S().dirty, true)
  assert.equal(checkProject(S().project).length, 0, 'no rule broken once read again')
})

test('P15: a file saved before fingerprints takes the disk\'s, quietly', async () => {
  resetWorld()
  const dir = mkdtempSync(path.join(tmpdir(), 'snipp-print-'))
  const projectFile = path.join(dir, 'p.snipp')
  const p = fixture()
  Object.assign(p.assets.find((a) => a.id === 'vid1')!, { path: 'C:\\m\\vid1.mp4', size: 100 })
  writeFileSync(projectFile, JSON.stringify(p))
  stubApi({ setCurrentProjectPath: () => {}, openProjectPath: (f: string) => ({ json: readFileSync(f, 'utf8'), path: f, resolved: { 'C:\\m\\vid1.mp4': { url: 'media://1', size: 100, mtime: 42 } } }) })
  const r = await openProjectByPath(projectFile)
  assert.ok(r)
  assert.deepEqual(r.changed, [])
  assert.equal(r.project.assets.find((a) => a.id === 'vid1')!.mtime, 42)
  setLastProjectPath(null)
})

// == Ç2a patch, item 2 (auditor probe AUDIT 2): a changed file that cannot be
// read again, or reads as another kind, does not stay linked. ==
test('Ç2a patch 2: a changed file read again as another kind, or not at all: the asset is missing at its ORIGINAL path (the relink button shows) and a save writes that path', async () => {
  resetWorld()
  const dir = mkdtempSync(path.join(tmpdir(), 'snipp-print-'))
  const projectFile = path.join(dir, 'p.snipp')
  const p = fixture()
  // vid1: found beside the project by its name and size (main checked it),
  // but modified since: read again. vid2: at its own path, changed.
  Object.assign(p.assets.find((a) => a.id === 'vid1')!, { path: 'Q:\\gone\\vid1.mp4', size: 100, mtime: 5, duration: 60 })
  Object.assign(p.assets.find((a) => a.id === 'vid2')!, { path: 'C:\\m\\vid2.mp4', size: 200, mtime: 7, duration: 30 })
  writeFileSync(projectFile, JSON.stringify(p))
  const beside = path.join(dir, 'media', 'vid1.mp4')
  const resolved = {
    'Q:\\gone\\vid1.mp4': { url: 'media://beside', size: 100, mtime: 9, path: beside, via: 'name' },
    'C:\\m\\vid2.mp4': { url: 'media://2', size: 210, mtime: 8, path: 'C:\\m\\vid2.mp4', via: 'path' }
  }
  stubApi({ setCurrentProjectPath: () => {}, openProjectPath: (f: string) => ({ json: readFileSync(f, 'utf8'), path: f, resolved }) })
  const r = await openProjectByPath(projectFile)
  setLastProjectPath(null)
  assert.ok(r)
  assert.equal(r.changed.length, 2)
  S().loadProject(r.project)
  // vid1's file is sound only now; vid2's is not media any more.
  const out = await refreshChangedMedia(r.changed, deps({ [beside]: { kind: 'audio', duration: 4 } }))
  assert.equal(out.failed, 2)
  assert.equal(asset('vid1').missing, true, 'vid1 missing: the relink button shows')
  assert.equal(asset('vid1').path, 'Q:\\gone\\vid1.mp4', 'its original path')
  assert.equal(asset('vid1').url, '')
  assert.equal(asset('vid1').duration, 60, 'its details as stored')
  assert.equal(asset('vid2').missing, true)
  assert.equal(asset('vid2').path, 'C:\\m\\vid2.mp4')
  assert.equal(asset('vid2').url, '')
  const saved = JSON.parse(serializeProject(S().project)).assets as Asset[]
  assert.equal(saved.find((a) => a.id === 'vid1')!.path, 'Q:\\gone\\vid1.mp4', 'a save writes the original path')
})

test('P12: a relink and another project let go of the proxy (the preview no longer shows the old file)', () => {
  const blob = (): string => URL.createObjectURL(new Blob(['proxy']))
  proxyUrls.set('x', blob())
  proxyUrls.set('y', blob())
  dropInput('x')
  assert.equal(proxyUrls.has('x'), false, 'gone with the relink')
  assert.equal(proxyUrls.has('y'), true)
  releaseAllMedia()
  assert.equal(proxyUrls.size, 0, 'gone with the project')
})
