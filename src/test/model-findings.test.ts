// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// What the model checker found on its first run (phase Ç2a.1, FAZC2A-PLAN.md
// "Findings found by the checker"): each as the edit that broke a rule.
import { fixture, resetWorld } from './undo-fixture'
import assert from 'node:assert/strict'
import test from 'node:test'
import { useStore } from '../renderer/src/state/store'
import { checkProject, describeProblems } from '../renderer/src/model/check'
import { setModelCheck, throwingCheck } from '../renderer/src/model/check-hook'
import { commandByName, runCommand, seededIds, seededRandom, type CommandEnv } from '../renderer/src/commands'
import { planTimelinePlacement } from '../renderer/src/timeline/placement'
import type { Project } from '../renderer/src/types'

const S = useStore.getState
const env = (): CommandEnv => ({ random: seededRandom(3), now: () => new Date(0), newId: seededIds(3) })
const clean = (p: Project, what: string): void => assert.equal(describeProblems(checkProject(p)), '', what)
const fresh = (): void => {
  resetWorld()
  S().loadProject(fixture())
  S().setLinkAV(false)
}

test('C1: deleting one clip of a linked pair leaves no link on the other (store and command)', () => {
  fresh()
  S().deleteClips(['ca'], false)
  assert.equal(S().project.clips.sa.linkId, undefined)
  clean(S().project, 'store')
  resetWorld()
  const out = runCommand(fixture(), commandByName('clip.delete'), { ids: ['sa'] }, env()).project
  assert.equal(out.clips.ca.linkId, undefined)
  clean(out, 'clip.delete')
})

test('C2: a clip that is silence from end to end goes, and its group and link forget it', () => {
  resetWorld()
  // (Since phase Ç2b.1 the silence goes out of every unlocked track: the
  // sound's track is locked here so the sound stays, linked to nothing.)
  const p = fixture()
  p.tracks.find((t) => t.id === 'a1')!.locked = true
  const out = runCommand(p, commandByName('silence.apply'), { regions: [{ clipId: 'ca', start: 0, end: 10 }, { clipId: 'cb', start: 10, end: 20 }] }, env()).project
  assert.equal(out.clips.ca, undefined)
  assert.equal(out.clips.cb, undefined)
  assert.equal(out.clips.sa.linkId, undefined, 'the sound of the removed picture is linked to nothing')
  assert.ok(!(out.groups ?? []).some((g) => g.clipIds.includes('cb')), 'the group lets go of the removed clip')
  clean(out, 'silence.apply')
})

test('C3: revealing earlier footage never runs the clip over the next one on its track', () => {
  fresh()
  // cb [10, 20) has 2 s of footage before its in point; cc starts at 20.
  S().revealEarlier('cb', 2)
  const p = S().project
  assert.ok(p.clips.cb.start + p.clips.cb.duration <= p.clips.cc.start + 1e-9, 'cb ends where cc starts at the latest')
  clean(p, 'revealEarlier')
  // With room after it, it still grows by what was asked.
  fresh()
  S().deleteClips(['cc'], false)
  S().revealEarlier('cb', 1.5)
  assert.equal(S().project.clips.cb.duration, 11.5)
  assert.equal(S().project.clips.cb.inPoint, 0.5)
})

test('C4: a compound of one clip of a linked pair breaks the link on both sides; taking it apart leaves no lone link', () => {
  fresh()
  S().selectClips(['ca', 'ov'])
  S().compoundSelection()
  const p = S().project
  const compound = Object.values(p.clips).find((c) => c.nested)!
  assert.equal(p.clips.sa.linkId, undefined, 'the sound outside lets go')
  assert.ok(compound.nested!.clips.every((c) => !c.linkId), 'the picture inside lets go')
  clean(p, 'compoundSelection')
  S().uncompoundClip(compound.id)
  clean(S().project, 'uncompoundClip')
})

test('C7: a trim at the end never runs a clip shorter than 0.1 s over the next clip (fuzz seed 579)', () => {
  resetWorld()
  const p = fixture()
  // cb becomes a 0.06 s piece right before a clip at 10.06.
  p.clips.cb.duration = 0.06
  p.clips.cc.start = 10.06
  p.groups = undefined
  clean(p, 'the layout')
  for (const delta of [2.43, 0.01, -0.01]) {
    const out = runCommand(p, commandByName('clip.trimEnd'), { clipId: 'cb', delta }, env()).project
    assert.ok(out.clips.cb.start + out.clips.cb.duration <= out.clips.cc.start + 1e-9, `delta ${delta}: cb ends at ${out.clips.cb.start + out.clips.cb.duration}`)
    clean(out, `trimEnd ${delta}`)
  }
})

test('C5: the rules are checked on an edit window as one edit (an Alt-drag copy sits on its original until the drop); outside a window, at once', () => {
  fresh()
  setModelCheck(throwingCheck())
  try {
    // The Alt-drag as the timeline runs it: the window, the copy in place, the drop.
    S().beginGesture()
    const [copy] = S().duplicateClipsInPlace(['ov'])
    const plan = planTimelinePlacement(S().project, copy, [copy], 8, null, null, false)!
    S().applyTimelinePlacement(plan)
    assert.doesNotThrow(() => S().endGesture())
    clean(S().project, 'after the Alt-drag')
    // The same copy made outside any window is an edit of its own: refused by the check.
    assert.throws(() => S().duplicateClipsInPlace(['ov']), /model check/)
  } finally {
    setModelCheck(null)
  }
})
