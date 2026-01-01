// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// The user's lock of a clip against agents, in the project file (KAPSAM-
// AJAN-PLAN.md §4; project format 8): a format-7 file opens, is written as 8
// and reads back the same; without a lock the file is the same bytes as
// before but for the format number; the lock is no change of the film (no
// new version: an agent's draft is not dropped for it) but is one undo step.
import './dom-stub'
import assert from 'node:assert/strict'
import test from 'node:test'
import { readProjectToOpen, serializeProject } from '../renderer/src/media/projectio'
import { CONVERSIONS, CURRENT_FORMAT } from '../renderer/src/model/format'
import { filmChanged } from '../renderer/src/history/equal'
import { sameFilm } from '../renderer/src/agent/replay'
import { COMMANDS, AGENT_COMMANDS, commandByName } from '../renderer/src/commands'
import { useStore } from '../renderer/src/state/store'
import { talk } from './agent-kit'

const S = useStore.getState

/** A project file as a format-7 build wrote it. */
function file7(lock = false): string {
  const p = talk(20, true)
  p.uid = 'kapsam-format-1'
  if (lock) p.clips.c1.agentLock = true
  const text = serializeProject(p)
  const raw = JSON.parse(text) as Record<string, unknown>
  raw.formatVersion = 7
  return JSON.stringify(raw, null, 2)
}

test('format 8: the lock conversion exists and is the last one', () => {
  assert.equal(CURRENT_FORMAT, 8)
  const last = CONVERSIONS[CONVERSIONS.length - 1]
  assert.equal(last.to, 8)
  const p = talk(10)
  const before = JSON.stringify(p)
  last.run(p)
  last.run(p)
  assert.equal(JSON.stringify(p), before, 'nothing to convert, twice = once')
})

test('format 8: a format-7 file opens, is saved as 8 (only the number differs) and reads back the same', () => {
  const text7 = file7()
  const opened = readProjectToOpen(text7)
  assert.deepEqual(opened.repaired, [])
  const saved = serializeProject(opened.project)
  assert.equal(JSON.parse(saved).formatVersion, 8)
  // (Byte for byte the file a format-7 build wrote, but for its number.)
  assert.equal(saved, JSON.stringify({ ...JSON.parse(text7), formatVersion: 8 }, null, 2))
  const again = serializeProject(readProjectToOpen(saved).project)
  assert.equal(again, saved)
  assert.ok(!saved.includes('agentLock'))
})

test('format 8: a lock is kept through save and open; an unknown value is no lock', () => {
  const p = talk(20)
  p.uid = 'kapsam-format-2'
  p.clips.c1.agentLock = true
  const saved = serializeProject(p)
  const back = readProjectToOpen(saved).project
  assert.equal(back.clips.c1.agentLock, true)
  assert.equal(serializeProject(back), saved)
  // (Written by hand or by another program: only true locks.)
  const odd = JSON.parse(saved)
  odd.clips.c1.agentLock = 'yes'
  assert.notEqual(readProjectToOpen(JSON.stringify(odd)).project.clips.c1.agentLock, true)
})

test('lock: not the film (no version, the same film to the agent), one undo step, the user edits a locked clip freely', () => {
  S().loadProject(talk(20))
  const before = S().project
  const v0 = S().projectVersion
  const undo0 = S().past.length
  S().setClipsAgentLock(['c1'], true)
  const after = S().project
  assert.equal(after.clips.c1.agentLock, true)
  assert.equal(filmChanged(before, after), false)
  assert.equal(sameFilm(before, after), true)
  assert.equal(S().projectVersion, v0, 'no new version: a draft is not dropped for a lock')
  assert.equal(S().past.length, undo0 + 1, 'one undo step')
  // The user's own edits do not look at the lock.
  S().runBatch([{ name: 'clip.setVolume', params: { clipId: 'c1', volume: 0.5 } }] as never)
  assert.equal(S().project.clips.c1.volume, 0.5)
  S().undo()
  assert.equal(S().project.clips.c1.volume, 1)
  assert.equal(S().project.clips.c1.agentLock, true)
  S().undo()
  assert.equal(S().project.clips.c1.agentLock, undefined)
  S().setClipsAgentLock(['c1'], true)
  S().setClipsAgentLock(['c1'], false)
  assert.equal(S().project.clips.c1.agentLock, undefined)
})

test('lock: its command is the store\'s, never an agent\'s', () => {
  assert.ok(COMMANDS['clip.setAgentLock'])
  assert.ok(!AGENT_COMMANDS['clip.setAgentLock'])
  assert.throws(() => commandByName('clip.setAgentLock'), /internal/)
})
