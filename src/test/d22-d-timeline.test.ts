// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// 22 November, L7 / L8: nothing lies on a clip's name pill. The pill and the
// clip's marks are one row (components/timeline/clip-block.tsx, .clip-top),
// and a transition's block over a cut pushes that row's ends in by what
// `cutReach` says. The layout itself is checked by boxes in the end-to-end
// scenario d22-d-pill-clear; here the geometry and the sheet's own rules.
import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { defaultProject, type Clip, type Project } from '../renderer/src/types'
import { cutReach, junctionBox, TRANS_BLOCK_MIN_PX } from '../renderer/src/timeline/junction-box'

const SRC = resolve(process.cwd(), 'src', 'renderer', 'src')
const T0 = { x: 960, y: 540, scale: 1, rotation: 0 }

/** V1: A 0–4, B 4–6, C 6–10, plenty of media round each. */
function abc(): Project {
  const p = defaultProject()
  p.tracks = [{ id: 'V1', kind: 'video', name: 'V1', clipIds: [] }]
  p.assets = [{ id: 'film', kind: 'video', name: 'film.mp4', url: 'media://film', size: 1, duration: 100, width: 1920, height: 1080, hasAudio: false }] as never
  const put = (id: string, start: number, duration: number, extra: Partial<Clip> = {}): void => {
    p.clips[id] = { id, assetId: 'film', trackId: 'V1', start, inPoint: 10, duration, transform: { ...T0 }, volume: 1, ...extra }
    p.tracks[0].clipIds.push(id)
  }
  put('A', 0, 4, { transitionOut: { type: 'mix', duration: 1, to: 'B' } })
  put('B', 4, 2)
  put('C', 6, 4)
  return p
}
const clipsOf = (p: Project): Clip[] => p.tracks[0].clipIds.map((id) => p.clips[id])

test('cutReach: the block\'s two sides of the cut, as the block itself is drawn', () => {
  const p = abc()
  const px = 100
  const box = junctionBox(p, p.clips.A, px)!
  const reach = cutReach(p, clipsOf(p), px)
  assert.deepEqual([...reach.keys()].sort(), ['A', 'B'])
  // Into the clip that ends at the cut: the part of the window before the cut.
  assert.equal(reach.get('A')!.right, box.pre * px)
  assert.equal(reach.get('A')!.left, 0)
  // Into the clip that starts there: the rest of the block.
  assert.equal(reach.get('B')!.left, Math.max(TRANS_BLOCK_MIN_PX, box.width) - box.pre * px)
  assert.equal(reach.get('B')!.right, 0)
  // Together: the block's whole width.
  assert.equal(reach.get('A')!.right + reach.get('B')!.left, Math.max(TRANS_BLOCK_MIN_PX, box.width))
})

test('cutReach: zoomed far out the block keeps its least width, and both clips make room for it', () => {
  const p = abc()
  const reach = cutReach(p, clipsOf(p), 4)
  assert.equal(reach.get('A')!.right + reach.get('B')!.left, TRANS_BLOCK_MIN_PX)
  assert.ok(reach.get('B')!.left > 0)
})

test('cutReach: no transition, a gap at the cut, or an adjustment layer: nothing to keep clear of', () => {
  const none = abc()
  delete none.clips.A.transitionOut
  assert.equal(cutReach(none, clipsOf(none), 100).size, 0)
  const gap = abc()
  gap.clips.B.start = 4.5
  assert.equal(cutReach(gap, clipsOf(gap), 100).size, 0)
  const adj = abc()
  adj.clips.B.adjustment = true
  assert.equal(cutReach(adj, clipsOf(adj), 100).size, 0)
})

test('the clip\'s top row is one row laid out by the page: the pill, the marks and the badges are not placed on their own', () => {
  const css = readFileSync(join(SRC, 'components', 'timeline', 'timeline.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
  const rule = (sel: string): string => {
    const m = new RegExp(`(?:^|\\})\\s*${sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\{([^}]*)\\}`, 'm').exec(css)
    assert.ok(m, `the rule ${sel}`)
    return m![1]
  }
  assert.match(rule('.tl-clip .clip-top'), /display:\s*flex/)
  assert.match(rule('.tl-clip .clip-top'), /pointer-events:\s*none/)
  // (No z-index on the row: its parts keep their own level among the handles and keys.)
  assert.doesNotMatch(rule('.tl-clip .clip-top'), /z-index/)
  for (const part of ['.tl-clip .label', '.tl-clip .idle-badge', '.tl-clip .clip-badges', '.motion-quick']) assert.doesNotMatch(rule(part), /position:\s*absolute/, `${part} is a part of the row`)
  // Only the name gives way when room runs out.
  assert.match(rule('.tl-clip .label'), /flex:\s*0 1 auto/)
  for (const part of ['.tl-clip .idle-badge', '.tl-clip .clip-badges', '.motion-quick']) assert.match(rule(part), /flex:\s*none/, part)
  // A low lane keeps its name: one row with its controls.
  assert.match(rule('.tl-track-label.compact'), /flex-direction:\s*row/)
  assert.doesNotMatch(rule('.tl-track-label.compact .tname'), /display:\s*none/)
})
