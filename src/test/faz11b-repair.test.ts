// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// Phase 11b, the audit's DG1–DG3: a project file damaged in the transition,
// the asset list, a clip's channels or a list of markers opens repaired (and
// says so) instead of throwing on open, in the drawing list or in the
// model's own check.
import './dom-stub'
import { fixture, resetWorld } from './undo-fixture'
import assert from 'node:assert/strict'
import test from 'node:test'
import { readProjectToOpen, serializeProject } from '../renderer/src/media/projectio'
import { checkProject, describeProblems } from '../renderer/src/model/check'
import { renderList } from '../renderer/src/playback/draw/timing'
import type { Project } from '../renderer/src/types'

type Raw = Record<string, any>

function opened(change: (raw: Raw) => void): { project: Project; codes: string[] } {
  resetWorld()
  const raw = JSON.parse(serializeProject(fixture())) as Raw
  change(raw)
  const r = readProjectToOpen(JSON.stringify(raw))
  return { project: r.project, codes: r.repaired.filter((x) => x.code !== 'uid').map((x) => x.code) }
}

/** Every drawing-list instant across the fixture's mix (ca → cb at 10 s). */
function drawsAround(p: Project): void {
  for (let t = 9.5; t <= 10.5; t += 0.05) renderList(p, t)
}

test('DG1: a transition of no kind, a number kind or no length goes on open; the drawing list draws its window', () => {
  for (const [label, tr] of [
    ['no type', { duration: 0.5, to: 'cb' }],
    ['number type', { type: 1, duration: 0.5, to: 'cb' }],
    ['null', null],
    ['no duration', { type: 'mix', to: 'cb' }],
    ['a string', 'mix']
  ] as const) {
    const { project, codes } = opened((raw) => {
      raw.clips.ca.transitionOut = tr
    })
    assert.equal(project.clips.ca.transitionOut, undefined, label)
    assert.ok(codes.includes('reference'), `${label}: told (${codes.join(', ')})`)
    assert.doesNotThrow(() => drawsAround(project), label)
    assert.equal(describeProblems(checkProject(project)), '', label)
  }
})

test('DG1: a sound transition, and one of a name the app does not know (drawn as a mix), is not touched', () => {
  for (const type of ['mix', 'spin-3d']) {
    const { project, codes } = opened((raw) => {
      raw.clips.ca.transitionOut.type = type
    })
    assert.deepEqual(project.clips.ca.transitionOut, { type, duration: 0.5, to: 'cb' })
    assert.ok(!codes.includes('reference'), codes.join(', '))
    assert.doesNotThrow(() => drawsAround(project))
  }
})

test('DG2: a null in the asset list opens (the repair drops it), no TypeError', () => {
  const { project, codes } = opened((raw) => {
    raw.assets.push(null)
  })
  assert.ok(project.assets.every((a) => a && typeof a === 'object'))
  assert.ok(codes.length > 0)
  assert.equal(describeProblems(checkProject(project)), '')
})

test('DG2: channels that are a string, a number or a list open without them', () => {
  for (const bad of ['x', 3, [1, 2]]) {
    const { project, codes } = opened((raw) => {
      raw.clips.cb.channels = bad
    })
    assert.equal(project.clips.cb.channels, undefined, String(bad))
    assert.ok(codes.includes('keys'), `${String(bad)}: told`)
    assert.doesNotThrow(() => renderList(project, 12))
  }
})

test('DG3: a null among markers, Shorts ranges, trackers or templates goes; checkProject does not throw', () => {
  const { project, codes } = opened((raw) => {
    raw.markers.push(null)
    raw.shortSegments.unshift(null, 4)
    raw.trackers = [null]
    raw.templates = ['x', null]
  })
  assert.deepEqual(project.markers?.map((m) => m.id), ['mk1', 'mk2'])
  assert.deepEqual(project.shortSegments?.map((s) => s.id), ['seg1'])
  assert.deepEqual(project.trackers ?? [], [])
  assert.deepEqual(project.templates ?? [], [])
  assert.ok(codes.includes('shape'), codes.join(', '))
  assert.doesNotThrow(() => checkProject(project))
  assert.equal(describeProblems(checkProject(project)), '')
})

test('A4: a work note, a stroke or a background that cannot be read goes, and the opening says so', () => {
  const { project, codes } = opened((raw) => {
    raw.notes = [
      { id: 'n1', num: 1, start: 2, end: 3, kind: 'fix', text: 'ok', status: 'open', created: '2026-11-20T00:00:00Z', at: 2, shapes: [{ type: 'rect', pts: [[0.1, 0.1], [0.2, 0.2]], color: '#ffffff' }, { type: 'blob', pts: [] }, 7] },
      { id: 'n2', num: 2, text: 'no time' },
      'x'
    ]
    raw.backdrop = { style: 'no-such-style' }
  })
  assert.deepEqual(project.notes?.map((n) => n.id), ['n1'])
  assert.equal(project.notes?.[0].shapes?.length, 1)
  assert.equal(project.backdrop, undefined)
  assert.ok(codes.includes('note-dropped'), codes.join(', '))
  assert.ok(codes.includes('look'), codes.join(', '))
  // A sound file says nothing of the kind.
  const sound = opened((raw) => {
    raw.notes = [{ id: 'n1', num: 1, start: 2, end: 3, kind: 'fix', text: 'ok', status: 'open', created: '2026-11-20T00:00:00Z' }]
    raw.backdrop = { style: 'black' }
  })
  assert.ok(!sound.codes.includes('note-dropped') && !sound.codes.includes('look'), sound.codes.join(', '))
})
