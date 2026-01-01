// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// Phase Ç3b (FAZC3B-PLAN.md): the robustness's pure parts — a disk error in
// a sentence (R25), the size said, HDR sources found and named (R22). The
// faults themselves are made in the export rig (scripts/export-rig, task
// "faults" and "robust") and in e2e 56.
import './dom-stub'
import assert from 'node:assert/strict'
import test from 'node:test'
import { plainFileError } from '../renderer/src/export/file-target'
import { sizeLabel } from '../renderer/src/export/verify'
import { hdrOf } from '../renderer/src/media/hdr'
import { hdrShown } from '../renderer/src/export/preflight'
import { defaultProject, type Asset, type Clip, type Project } from '../renderer/src/types'
import { t } from '../renderer/src/ui/strings'

test('R25: a full disk and a refused file are said in a sentence, not in Node\'s words through IPC', () => {
  const ipc = (m: string): Error => new Error(`Error invoking remote method 'file:stream-write': Error: ${m}`)
  assert.equal(plainFileError(ipc('ENOSPC: no space left on device, write')).message, t('export.disk.full'))
  assert.equal(plainFileError(ipc("EACCES: permission denied, open 'C:\\x.mp4.part'")).message, t('export.disk.denied'))
  assert.equal(plainFileError(ipc("EPERM: operation not permitted, rename 'a' -> 'b'")).message, t('export.disk.denied'))
  // Any other main-process error keeps its words, without the wrapper.
  const busy = plainFileError(new Error("Error invoking remote method 'file:stream-open': Error: x.mp4 is open in another program (a video player?). Close it there, then export again."))
  assert.equal(busy.message, 'x.mp4 is open in another program (a video player?). Close it there, then export again.')
  // An error of the renderer's own is the same error.
  const own = new Error('Export cancelled')
  assert.equal(plainFileError(own), own)
})

test('R25: sizes in the free-space sentence', () => {
  assert.equal(sizeLabel(194 * 2 ** 20), '194 MB')
  assert.equal(sizeLabel(1.25 * 2 ** 30), '1.3 GB')
  assert.equal(sizeLabel(10), '1 MB')
})

test('R22: HLG and PQ sources are HDR; others are not', () => {
  assert.equal(hdrOf({ transfer: 'hlg' }), 'hlg')
  assert.equal(hdrOf({ transfer: 'pq' }), 'pq')
  assert.equal(hdrOf({ transfer: 'bt709' }), null)
  assert.equal(hdrOf({}), null)
  assert.equal(hdrOf(null), null)
})

test('R22: the export names the HDR videos it shows, once each, not a hidden or disabled one', () => {
  const p: Project = structuredClone(defaultProject())
  const asset = (id: string, hdr?: 'hlg' | 'pq'): Asset => ({ id, kind: 'video', name: `${id}.mp4`, path: `C:\\${id}.mp4`, url: id, duration: 10, width: 640, height: 360, hasAudio: false, ...(hdr ? { hdr } : {}) }) as Asset
  p.assets = [asset('a', 'hlg'), asset('b'), asset('c', 'pq'), asset('d', 'pq')]
  const clip = (id: string, assetId: string, trackId: string, start: number, extra: Partial<Clip> = {}): Clip =>
    ({ id, assetId, trackId, start, duration: 2, inPoint: 0, volume: 1, transform: { x: 0, y: 0, scale: 1, rotation: 0 }, ...extra }) as Clip
  p.tracks = [
    { id: 'V1', kind: 'video', name: 'V1', clipIds: ['k1', 'k2', 'k3', 'k5'] },
    { id: 'V2', kind: 'video', name: 'V2', clipIds: ['k4'], hidden: true }
  ]
  p.clips = { k1: clip('k1', 'a', 'V1', 0), k2: clip('k2', 'b', 'V1', 2), k3: clip('k3', 'a', 'V1', 4), k5: clip('k5', 'c', 'V1', 6, { disabled: true }), k4: clip('k4', 'd', 'V2', 0) }
  assert.deepEqual(hdrShown(p), ['a.mp4'])
  assert.deepEqual(hdrShown(p, [2, 4]), [])
})
