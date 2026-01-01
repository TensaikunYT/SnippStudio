// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// Phase Ç3 patch (haritalar/_fazc3-denetim-dayaniklilik.md R-3, R-5): the
// export's in and out points belong to the project they were set in, and an
// out at or before the in is never a range.
import './dom-stub'
import assert from 'node:assert/strict'
import test from 'node:test'
import { clearExportMarks, exportMarks, markedRange, setExportMark } from '../renderer/src/export/marks'
import { useStore } from '../renderer/src/state/store'
import { defaultProject } from '../renderer/src/types'

test('R-3: New project and Open (any project put in its place) clear the in and out points', () => {
  setExportMark('in', 1)
  setExportMark('out', 3)
  assert.deepEqual(exportMarks(), { in: 1, out: 3 })
  useStore.getState().newProject('16:9')
  assert.deepEqual(exportMarks(), { in: null, out: null }, 'New project')
  setExportMark('in', 1)
  setExportMark('out', 3)
  // Open, a crash snapshot, a backup: all put a project in place by loadProject.
  useStore.getState().loadProject(defaultProject('9:16'))
  assert.deepEqual(exportMarks(), { in: null, out: null }, 'Open')
})

test('R-5: an out at or before the in is no range (the marks move the other away)', () => {
  clearExportMarks()
  setExportMark('in', 3)
  setExportMark('out', 2)
  assert.deepEqual(exportMarks(), { in: null, out: 2 }, 'an out before the in drops the in')
  setExportMark('in', 2)
  assert.deepEqual(exportMarks(), { in: 2, out: null }, 'an in at the out drops the out')
  assert.deepEqual(markedRange(exportMarks(), 10), [2, 10])
  assert.equal(markedRange({ in: 3, out: 3 }, 10), null, 'out = in: no range')
  assert.equal(markedRange({ in: 4, out: 3 }, 10), null, 'out < in: no range')
  clearExportMarks()
})
