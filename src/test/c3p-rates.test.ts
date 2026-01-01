// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// Phase Ç3 patch (haritalar/_fazc3-denetim-goruntu.md G-2, G-4): an empty
// project takes its first video's rate only when it has nothing at all; a
// rate the person picked in a project that has anything is never changed.
// NTSC rates are written with two decimals where the export says its rate.
import './dom-stub'
import assert from 'node:assert/strict'
import test from 'node:test'
import { firstVideoRate } from '../renderer/src/timeline/rates'
import { useStore } from '../renderer/src/state/store'
import { describeExport } from '../renderer/src/components/app/layout'
import { defaultProject, type Asset } from '../renderer/src/types'

const NTSC = 30000 / 1001
const video = (id: string, fps?: number): Asset => ({ id, kind: 'video', name: `${id}.mp4`, url: '', duration: 5, ...(fps ? { fps } : {}) }) as Asset

test('G-2: a project with a subtitle, a title, a picture or a sound keeps its rate (the auditor\'s project)', () => {
  const empty = { clips: {}, assets: [], captions: [], templates: [] }
  assert.equal(firstVideoRate(empty, [video('v', NTSC)]), NTSC, 'nothing at all: the video\'s rate')
  const project = { clips: {}, assets: [{ kind: 'image' }, { kind: 'audio' }], captions: [{ id: 'c1' }], templates: [{ id: 't1' }] }
  assert.equal(firstVideoRate(project, [video('v', NTSC)]), null, 'caption + title + image + sound: kept')
  assert.equal(firstVideoRate({ ...empty, captions: [{ id: 'c1' }] }, [video('v', NTSC)]), null, 'a subtitle line')
  assert.equal(firstVideoRate({ ...empty, templates: [{ id: 't1' }] }, [video('v', NTSC)]), null, 'a title or template')
  assert.equal(firstVideoRate({ ...empty, assets: [{ kind: 'image' }] }, [video('v', NTSC)]), null, 'a picture')
  assert.equal(firstVideoRate({ ...empty, assets: [{ kind: 'audio' }] }, [video('v', NTSC)]), null, 'a sound')
  assert.equal(firstVideoRate({ ...empty, assets: [{ kind: 'code' }] }, [video('v', NTSC)]), null, 'a code clip')
  assert.equal(firstVideoRate({ ...empty, clips: { x: {} } }, [video('v', NTSC)]), null, 'a clip')
})

test('G-2: in the store, a hand-picked 60 stays with subtitles in the project; an empty one changes in one undo step', () => {
  const s = (): ReturnType<typeof useStore.getState> => useStore.getState()
  const p = defaultProject('16:9')
  p.settings.fps = 60
  p.captions.push({ id: 'c1', start: 0, end: 2, text: 'Hello' } as never)
  s().loadProject(p)
  s().addAssets([video('a', NTSC)])
  assert.equal(s().project.settings.fps, 60, 'kept')
  s().newProject('16:9')
  const depth = s().past.length
  s().addAssets([video('b', NTSC)])
  assert.equal(s().project.settings.fps, NTSC, 'an empty project takes it')
  assert.equal(s().past.length, depth + 1, 'one undo step')
})

test('G-4: the export card writes an NTSC rate with two decimals', () => {
  const p = defaultProject('16:9')
  p.settings.fps = NTSC
  const said = describeExport(p, { fps: NTSC, resolutionScale: 1, bitrateFactor: 0.1 })
  assert.match(said, /29\.97 fps/, said)
  assert.doesNotMatch(said, /29\.970/, said)
})
