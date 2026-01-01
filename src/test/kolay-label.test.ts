// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// A clip's coloured label (KOLAY-PLAN.md, item 3), in the project file: the
// format stays 8; a file without labels is the same bytes as before; a label
// is kept through save and open; a value that is no colour is dropped when the
// file is read (and said); a label is no change of the film (no new version:
// an agent's draft is not dropped for it) but is one undo step; its command is
// the store's, never an agent's; the timeline search filters by it.
import './dom-stub'
import assert from 'node:assert/strict'
import test from 'node:test'
import { readProjectToOpen, serializeProject } from '../renderer/src/media/projectio'
import { CURRENT_FORMAT } from '../renderer/src/model/format'
import { filmChanged } from '../renderer/src/history/equal'
import { sameFilm } from '../renderer/src/agent/replay'
import { AGENT_COMMANDS, COMMANDS, commandByName } from '../renderer/src/commands'
import { useStore } from '../renderer/src/state/store'
import { searchTimeline } from '../renderer/src/timeline/search'
import { talk } from './agent-kit'

const S = useStore.getState

test('label: the format stays 8; without labels the file is the same bytes', () => {
  assert.equal(CURRENT_FORMAT, 8)
  const p = talk(20, true)
  p.uid = 'kolay-label-1'
  const text = serializeProject(p)
  assert.ok(!text.includes('"label"'))
  const opened = readProjectToOpen(text)
  assert.deepEqual(opened.repaired, [])
  assert.equal(serializeProject(opened.project), text)
})

test('label: kept through save and open; a value that is no colour is dropped and said', () => {
  const p = talk(20)
  p.uid = 'kolay-label-2'
  p.clips.c1.label = 'purple'
  const saved = serializeProject(p)
  const back = readProjectToOpen(saved)
  assert.equal(back.project.clips.c1.label, 'purple')
  assert.deepEqual(back.repaired, [])
  assert.equal(serializeProject(back.project), saved)
  for (const odd of ['magenta', 3, null, { c: 'red' }]) {
    const raw = JSON.parse(saved)
    raw.clips.c1.label = odd
    const r = readProjectToOpen(JSON.stringify(raw))
    assert.equal(r.project.clips.c1.label, undefined, `${JSON.stringify(odd)} is dropped`)
    assert.ok(r.repaired.length > 0, `${JSON.stringify(odd)}: the repair is said`)
  }
})

test('label: not the film, one undo step, the same colour again is no step', () => {
  S().loadProject(talk(20))
  const before = S().project
  const v0 = S().projectVersion
  const undo0 = S().past.length
  S().setClipsLabel(['c1'], 'green')
  const after = S().project
  assert.equal(after.clips.c1.label, 'green')
  assert.equal(filmChanged(before, after), false)
  assert.equal(sameFilm(before, after), true)
  assert.equal(S().projectVersion, v0, 'no new version: a draft is not dropped for a label')
  assert.equal(S().past.length, undo0 + 1, 'one undo step')
  S().setClipsLabel(['c1'], 'green')
  assert.equal(S().past.length, undo0 + 1, 'the same colour again: nothing')
  S().undo()
  assert.equal(S().project.clips.c1.label, undefined)
  S().redo()
  assert.equal(S().project.clips.c1.label, 'green')
  S().setClipsLabel(['c1'], null)
  assert.equal(S().project.clips.c1.label, undefined)
  assert.ok(!('label' in S().project.clips.c1), 'none: the field goes')
})

test('label: its command is the store\'s, never an agent\'s; the agent tools do not grow', () => {
  assert.ok(COMMANDS['clip.setLabel'])
  assert.ok(!AGENT_COMMANDS['clip.setLabel'])
  assert.throws(() => commandByName('clip.setLabel'), /internal/)
})

test('label: the timeline search keeps only the clips of a colour', () => {
  const p = talk(20)
  const ids = Object.keys(p.clips)
  p.clips[ids[0]].label = 'red'
  const pick = (id: string): boolean => p.clips[id]?.label === 'red'
  const hits = searchTimeline(p, '', pick)
  assert.deepEqual(hits.map((h) => h.id), [ids[0]])
  assert.ok(hits.every((h) => h.kind === 'clip'))
  assert.deepEqual(searchTimeline(p, 'no such name at all', pick), [])
})
