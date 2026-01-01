// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
import assert from 'node:assert/strict'
import test from 'node:test'
import { defaultProject } from '../renderer/src/types'

Object.defineProperty(globalThis, 'document', {
  configurable: true,
  value: { createElement: () => ({ width: 0, height: 0, getContext: () => null }) }
})
Object.defineProperty(globalThis, 'localStorage', {
  configurable: true,
  value: { getItem: () => null, setItem: () => {} }
})

test('editing a word end then splitting preserves the silence and the next onset', async () => {
  const { useStore } = await import('../renderer/src/state/store')
  const project = defaultProject()
  const text = 'zihniniz bulanıklaştığında genelde'
  project.captions.push({
    id: 'cue', start: 6.9, end: 9.6, text,
    words: [
      { text: 'zihniniz', start: 6.9, end: 7.4 },
      { text: 'bulanıklaştığında', start: 7.77, end: 8.61 },
      { text: 'genelde', start: 9.12, end: 9.55 }
    ]
  })
  useStore.getState().loadProject(project)
  useStore.getState().setCaptionWordEnd('cue', 1, 8.3)
  const changed = useStore.getState().project.captions[0]
  assert.equal(changed.words?.[1].end, 8.3)
  assert.equal(changed.words?.[2].start, 9.12)

  const rightId = useStore.getState().splitCaptionAtCursor('cue', text, text.indexOf('genelde'))
  assert.ok(rightId)
  const captions = useStore.getState().project.captions
  const left = captions.find((caption) => caption.id === 'cue')!
  const right = captions.find((caption) => caption.id === rightId)!
  assert.equal(left.end, 8.3)
  assert.equal(right.start, 9.12)
  assert.equal(left.words?.at(-1)?.end, 8.3)
  assert.equal(right.words?.[0].start, 9.12)
})
