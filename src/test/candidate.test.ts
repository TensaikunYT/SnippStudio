// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// A candidate project (SnippStudio phase 2A.4): the preview can draw and
// play another project; the store's project, undo history and version stay
// as they are. (The drawing and the sound are tried in the app: see
// FAZ2A-PLAN.md, "Ne denendi".)
import { fixture, hash, resetWorld } from './undo-fixture'
import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { useStore } from '../renderer/src/state/store'
import { applyBatch } from '../renderer/src/commands'
import { candidate, shownProject, showingCandidate } from '../renderer/src/playback/candidate'

const S = useStore.getState

test('the candidate: set, show, back to live, clear; nothing to show without one', () => {
  resetWorld()
  S().loadProject(fixture())
  const live = S().project
  candidate.clear()
  candidate.show('candidate')
  assert.equal(showingCandidate(), false)
  assert.equal(shownProject(live), live)
  const { project: cand } = applyBatch(live, [{ name: 'timeline.cutRanges', params: { ranges: [[0, 3]] } }])
  const seen: string[] = []
  const off = candidate.subscribe((s) => seen.push(s.showing))
  candidate.set(cand)
  assert.equal(shownProject(live), live, 'set alone does not switch')
  candidate.show('candidate')
  assert.equal(shownProject(live), cand)
  candidate.show('live')
  assert.equal(shownProject(live), live)
  candidate.set(cand, true)
  assert.equal(shownProject(live), cand)
  candidate.clear()
  assert.equal(shownProject(live), live)
  assert.equal(candidate.get().project, null)
  off()
  assert.deepEqual(seen, ['live', 'candidate', 'live', 'candidate', 'live'])
})

test('showing and playing a candidate leaves the store\'s project, history, version and saved state alone', () => {
  resetWorld()
  S().loadProject(fixture())
  S().addMarkerAtPlayhead()
  S().setDirty(false)
  const before = { project: S().project, h: hash(S().project), past: S().past.length, future: S().future.length, version: S().projectVersion, dirty: S().dirty }
  const { project: cand } = applyBatch(S().project, [
    { name: 'timeline.cutRanges', params: { ranges: [[1, 4]] } },
    { name: 'text.add', params: { time: 1, text: 'Candidate' } }
  ])
  candidate.set(cand, true)
  // What the preview and the engine read while it is shown.
  assert.equal(shownProject(S().project), cand)
  S().setTime(2)
  S().setPlaying(true)
  S().setPlaying(false)
  candidate.show('live')
  candidate.clear()
  assert.equal(S().project, before.project)
  assert.equal(hash(S().project), before.h)
  assert.equal(S().past.length, before.past)
  assert.equal(S().future.length, before.future)
  assert.equal(S().projectVersion, before.version)
  assert.equal(S().dirty, before.dirty)
  // Undo is still the store's own: it takes back the marker.
  S().undo()
  assert.equal(S().project.markers!.length, 2)
})

test('the preview reads the shown project and edits nothing on a candidate (source; the engine runs for real in engine-candidate.test.ts)', () => {
  const src = (f: string) => readFileSync(join(process.cwd(), 'src', 'renderer', 'src', f), 'utf8')
  const preview = src('components/PreviewCanvas.tsx')
  assert.match(preview, /const project = shownProject\(s\.project\)/)
  assert.match(preview, /if \(candidateShown\) return/)
  assert.match(preview, /if \(showingCandidate\(\)\) return/)
})
