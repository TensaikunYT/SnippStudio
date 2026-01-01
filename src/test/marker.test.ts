// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
import assert from 'node:assert/strict'
import test from 'node:test'
import { markerCoversWord, markerRevealProgress, remapMarkedWords, splitMarkerAtWordIndex, toggleMarkedWords, wordIndicesAtSelection } from '../renderer/src/subtitles/marker'
import { defaultProject } from '../renderer/src/types'

Object.defineProperty(globalThis, 'document', {
  configurable: true,
  value: { createElement: () => ({ width: 0, height: 0, getContext: () => null }) }
})
Object.defineProperty(globalThis, 'localStorage', {
  configurable: true,
  value: { getItem: () => null, setItem: () => {} }
})

test('marker selection targets only the chosen word, including a caret at its start', () => {
  const text = 'zihniniz bulanıklaştığında genelde'
  const selected = wordIndicesAtSelection(text, text.indexOf('bulanık'), text.indexOf('bulanık') + 6)
  assert.deepEqual(selected, [1])
  assert.deepEqual(wordIndicesAtSelection(text, text.indexOf('genelde'), text.indexOf('genelde')), [2])
  const marker = toggleMarkedWords(undefined, selected)
  assert.equal(markerCoversWord(marker, 0), false)
  assert.equal(markerCoversWord(marker, 1), true)
  assert.equal(markerCoversWord(marker, 2), false)
  assert.equal(toggleMarkedWords(marker, selected).enabled, false)
  const both = toggleMarkedWords(marker, [2])
  const [left, right] = splitMarkerAtWordIndex(both, 2)
  assert.deepEqual(left?.words, [1])
  assert.deepEqual(right?.words, [0])
  assert.equal(markerRevealProgress(2.5, 2.5, 3, 0.48), 0)
  assert.equal(markerRevealProgress(2.9, 2.5, 3, 0.48), 1)
  assert.equal(markerRevealProgress(2.98, 2.9, 3, 0.48), 1)
})

test('marker targets survive a nearby text edit without changing cue or word times', async () => {
  const { useStore } = await import('../renderer/src/state/store')
  const project = defaultProject()
  project.captions.push({
    id: 'cue', start: 2, end: 5, text: 'A highlighted phrase', layer: 0,
    words: [
      { text: 'A', start: 2, end: 2.3 },
      { text: 'highlighted', start: 2.5, end: 3.8 },
      { text: 'phrase', start: 4, end: 5 }
    ]
  })
  useStore.getState().loadProject(project)
  const before = useStore.getState().project.captions[0]
  const times = before.words?.map(({ start, end }) => [start, end])
  useStore.getState().undoable(() => useStore.getState().setCaptionOwnStyle('cue', {
    marker: toggleMarkedWords(undefined, [1])
  }))
  const after = useStore.getState().project.captions[0]
  assert.equal(after.start, 2)
  assert.equal(after.end, 5)
  assert.deepEqual(after.words?.map(({ start, end }) => [start, end]), times)
  assert.deepEqual(after.style?.marker?.words, [1])
  assert.deepEqual(remapMarkedWords('A highlighted phrase', 'A very highlighted phrase', [1]), [2])
})

/** A stand-in canvas that records the marker bands (solid fills in the marker
 *  colour) and every word drawn, with the colour it was drawn in. */
function recorder() {
  const bands: unknown[] = []
  const ink: { text: string; color: unknown }[] = []
  const values: Record<string, unknown> = { globalAlpha: 1 }
  const gradient = { addColorStop: () => {} }
  const ctx = new Proxy(values, {
    get(target, key) {
      if (key === 'measureText') return (text: string) => ({ width: text.length * 12 })
      if (key === 'fill') return () => bands.push(target.fillStyle)
      if (key === 'fillText') return (text: string) => ink.push({ text, color: target.fillStyle })
      if (key === 'createLinearGradient' || key === 'createRadialGradient') return () => gradient
      return target[String(key)] ?? (() => {})
    },
    set(target, key, value) { target[String(key)] = value; return true }
  }) as unknown as CanvasRenderingContext2D
  return { ctx, bands, ink }
}

const cue = {
  id: 'cue', start: 2, end: 5, text: 'A highlighted phrase', layer: 0,
  words: [
    { text: 'A', start: 2, end: 2.3 },
    { text: 'highlighted', start: 2.5, end: 3.8 },
    { text: 'phrase', start: 4, end: 5 }
  ]
}

test('the preview renderer paints only the selected word behind normal karaoke text', async () => {
  const { drawCaptions } = await import('../renderer/src/playback/render')
  const style = defaultProject().captionStyle
  style.highlight = { enabled: true, color: '#ffffff', scale: 1, box: false }
  style.marker = { enabled: true, color: '#f1ef00', duration: 0.48, words: [1] }
  const { ctx, bands, ink } = recorder()
  drawCaptions(ctx, [cue], style, 2.75, 1920, 1080)
  assert.equal(bands.filter((c) => c === '#f1ef00').length, 1)
  assert.ok(ink.some((w) => w.text === 'highlighted'))
})

test('on a light marker the word turns dark where the stroke has reached; not before it is said', async () => {
  const { drawCaptions } = await import('../renderer/src/playback/render')
  const style = defaultProject().captionStyle
  style.marker = { enabled: true, color: '#f1ef00', duration: 0.48, words: [1] }
  const before = recorder()
  drawCaptions(before.ctx, [cue], style, 2.3, 1920, 1080)
  assert.equal(before.bands.filter((c) => c === '#f1ef00').length, 0)
  const after = recorder()
  drawCaptions(after.ctx, [cue], style, 3.2, 1920, 1080)
  assert.equal(after.bands.filter((c) => c === '#f1ef00').length, 1)
  // The line in its own colour, then the marked word again in a deep shade.
  const dark = after.ink.filter((w) => w.text === 'highlighted' && typeof w.color === 'string' && /^rgba\(\d+,\d+,\d+,1\.000\)$/.test(w.color))
  assert.equal(dark.length, 1, JSON.stringify(after.ink))
  // A dark marker leaves the words as they are.
  style.marker = { ...style.marker, color: '#1d2a6b' }
  const navy = recorder()
  drawCaptions(navy.ctx, [cue], style, 3.2, 1920, 1080)
  assert.equal(navy.ink.filter((w) => w.text === 'highlighted').length, 0)
})
