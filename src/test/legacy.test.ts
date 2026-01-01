// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// SnippStudio 1b.7: a project file from the user's own Snipp (hands,
// characters, Stage, the Intro/Outro/Black hole templates, hand transitions)
// opens as a copy without those parts; a file with none of it opens as before.
import assert from 'node:assert/strict'
import test from 'node:test'
import { copyNotice, stripLegacy } from '../renderer/src/media/legacy'
import { readProjectFile, serializeProject } from '../renderer/src/media/projectio'
import { checkProject, describeProblems } from '../renderer/src/model/check'
import { defaultProject, type Project } from '../renderer/src/types'

type Loose = Record<string, unknown>

function clip(id: string, assetId: string, extra: Loose = {}): Loose {
  return { id, assetId, trackId: 'v1', start: 0, inPoint: 0, duration: 2, transform: { x: 0, y: 0, scale: 1, rotation: 0, opacity: 1 }, ...extra }
}

function oldFile(): Loose {
  const p = defaultProject() as unknown as Loose
  p.name = 'Old film'
  p.characters = [{ id: 'narrator', name: 'Narrator', poses: {} }]
  p.stage = { scenes: [] }
  p.stageVersions = [{ id: 'v1' }]
  p.credits = 'Terrain: someone'
  p.assets = [
    { id: 'pose', name: 'open.png', kind: 'image', path: 'C:\\x\\open.png', url: '', duration: 0, role: 'character' },
    { id: 'pose2', name: 'point.png', kind: 'image', path: 'C:\\x\\point.png', url: '', duration: 0, role: 'character' },
    { id: 'film', name: 'demo', kind: 'code', path: 'C:\\x\\demo', url: '', duration: 5, code: { entry: 'index.html', hand: false, light: true } },
    { id: 'vid', name: 'a.mp4', kind: 'video', path: 'C:\\x\\a.mp4', url: '', duration: 5 }
  ]
  p.clips = {
    a: clip('a', 'vid', { transitionOut: { type: 'hand-swipe', duration: 0.5, hand: 'narrator' } }),
    b: clip('b', 'pose2'),
    c: clip('c', 'vid', { transitionOut: { type: 'crossfade', duration: 0.5, hand: true, color: '#fff' } }),
    d: clip('d', 'vid', { nested: { clips: [clip('e', 'vid', { transitionOut: { type: 'portal', duration: 1 } })] } })
  }
  p.templates = [
    { id: 't1', kind: 'intro', start: 0, duration: 3 },
    { id: 't2', kind: 'steps', start: 3, duration: 3 },
    { id: 't3', kind: 'blackhole', start: 6, duration: 3 }
  ]
  p.captionStyle = { ...(p.captionStyle as Loose), physics: true }
  return p
}

test('an old file opens without the hands, the Stage, the three templates and hand transitions, and says so', () => {
  const text = JSON.stringify(oldFile())
  const { project, removed, repaired } = readProjectFile(text)
  const p = project as unknown as Loose
  // (Phase Ç2a.2, decision 7: nothing else is mended, no rule is broken.)
  // This made-up file puts its four clips at 0 s on a track 'v1' it does not
  // have: the expected repair makes that track again and moves the overlaps.
  assert.deepEqual(repaired.map((r) => r.code), ['track-made', 'shape', 'track-list', 'overlap'])
  assert.equal(describeProblems(checkProject(project)), '')
  assert.deepEqual(new Set(removed), new Set(['narrator hands and characters', 'Stage', 'Intro, Outro and Black hole templates', 'hand transitions and portals', "code film's own-hand setting"]))
  for (const k of ['characters', 'stage', 'stageVersions', 'credits']) assert.equal(k in p, false, k)
  // A pose picture used nowhere goes; one on the timeline stays as a plain picture.
  assert.deepEqual(project.assets.map((a) => a.id), ['pose2', 'film', 'vid'])
  assert.equal('role' in project.assets[0], false)
  const code = (project.assets[1] as unknown as Loose).code as Loose
  assert.equal('hand' in code, false)
  assert.equal('light' in code, false)
  assert.deepEqual((project.templates ?? []).map((t) => t.kind), ['steps'])
  const clips = project.clips as unknown as Record<string, Loose>
  assert.equal(clips.a.transitionOut, undefined)
  // (It names d, the clip that meets it once the repair laid the clips out:
  // format 4 runs after the repair, Ç2b patch item 6.)
  // (An old file's transition keeps its sound: written in, DENEME-3 V item 2.)
  assert.deepEqual(clips.c.transitionOut, { type: 'crossfade', duration: 0.5, sfx: 1, to: 'd' })
  assert.equal(((clips.d.nested as Loose).clips as Loose[])[0].transitionOut, undefined)
  assert.equal('physics' in (project.captionStyle as unknown as Loose), false)
  // Nothing of it comes back when the copy is saved.
  const saved = serializeProject(project)
  for (const w of ['"characters"', '"stage"', '"stageVersions"', '"credits"', '"role"', 'hand-swipe', '"portal"', '"intro"', '"blackhole"', '"physics"']) {
    assert.equal(saved.includes(w), false, w)
  }
  // The one line the user reads.
  const line = copyNotice(removed)
  assert.match(line, /^Opened as a copy without its /)
  assert.match(line, /The file itself is unchanged; Save asks for a new name\.$/)
})

test('a file without any of it opens as before: not a copy, the same project', () => {
  const p = defaultProject() as unknown as Loose
  p.name = 'Plain'
  p.templates = [{ id: 't2', kind: 'steps', start: 3, duration: 3 }]
  const text = JSON.stringify(p)
  const { project, removed, repaired } = readProjectFile(text)
  assert.deepEqual(removed, [])
  assert.deepEqual(repaired, [], 'nothing mended (phase Ç2a.2, decision 7)')
  assert.equal(serializeProject(readProjectFile(serializeProject(project)).project), serializeProject(project))
})

test('settings that only acted on the hands are dropped quietly, without making a copy', () => {
  const p = defaultProject() as unknown as Loose
  p.assets = [{ id: 'film', name: 'demo', kind: 'code', path: 'C:\\x\\demo', url: '', duration: 5, code: { entry: 'index.html', hand: true, light: true } }]
  p.clips = { c: clip('c', 'film', { transitionOut: { type: 'crossfade', duration: 0.5, hand: true } }) }
  p.captionStyle = { ...(p.captionStyle as Loose), physics: true }
  p.characters = []
  const removed = stripLegacy(p as unknown as Project)
  assert.deepEqual(removed, [])
  assert.equal('characters' in p, false)
  assert.deepEqual((p.clips as Record<string, Loose>).c.transitionOut, { type: 'crossfade', duration: 0.5 })
})

test('the notice names one part alone, or several with "and"', () => {
  assert.match(copyNotice(['Stage']), /without its Stage:/)
  assert.match(copyNotice(['Stage', 'hand transitions and portals', 'narrator hands and characters']), /without its Stage, hand transitions and portals and narrator hands and characters:/)
})
