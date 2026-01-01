// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// The interface audit's patch, worker A (tarifler\YAMA-ARAYUZ.md): what the
// words say (G3, G13, the old "Auto Pack" name), each in both languages.
import assert from 'node:assert/strict'
import test from 'node:test'
import { STRINGS } from '../renderer/src/ui/strings'

const all = STRINGS as Record<string, { en: string; tr?: string }>
const both = (k: string): string[] => [all[k].en, all[k].tr ?? '']

test('G3: the notes words name the gestures the Notes lane really has', () => {
  // A plain drag on the lane moves the playhead (3c.Y K3): a range is Shift + drag.
  for (const [k, e] of Object.entries(all)) {
    if (!k.startsWith('notes.') && !k.startsWith('insp.tab.notes')) continue
    for (const s of [e.en, e.tr ?? '']) {
      assert.doesNotMatch(s, /\bN lane\b|\bN şerid/, `${k}: the lane is called Notes (${s})`)
    }
  }
  for (const s of both('notes.empty')) {
    assert.match(s, /Shift/, `notes.empty says Shift + drag (${s})`)
    assert.match(s, /\bN\b/, `notes.empty says the N key (${s})`)
  }
  for (const s of both('notes.span.hint')) assert.match(s, /Shift/, `notes.span.hint (${s})`)
})

test('G13: the code film tip says what is true today, in the user\'s words', () => {
  for (const s of both('bin.codeFilm.hint')) {
    assert.doesNotMatch(s, /renderOut|VideoHub|window\./, s)
    assert.ok(s.split(/[.!?](\s|$)/).filter((x) => x && x.trim()).length <= 1, `one sentence (${s})`)
  }
})

test('14: the empty timeline does not name the old "Auto Pack"', () => {
  for (const [k, e] of Object.entries(all)) {
    for (const s of [e.en, e.tr ?? '']) assert.doesNotMatch(s, /Auto Pack/, `${k}: ${s}`)
  }
})

// ---- the parts of the patch that are pure ------------------------------------------
import './dom-stub'
import { STRINGS_YAMA_A } from '../renderer/src/ui/strings-yama-a'
import { STRINGS_3C } from '../renderer/src/ui/strings-3c'
import { STRINGS_3C2 } from '../renderer/src/ui/strings-3c2'
import { STRINGS_3C3 } from '../renderer/src/ui/strings-3c3'
import { STRINGS_CILA_T } from '../renderer/src/ui/strings-cila-t'
import { CLIP_ANIMS, IDLE_STYLES } from '../renderer/src/types'
import { animName, idleName } from '../renderer/src/components/inspector/motion-names'
import { curveBadge, curveBadgeShown } from '../renderer/src/timeline/curve-line'
import { nudgeU } from '../renderer/src/components/inspector/speed-curve-editor'
import { nearCut, NEAR_CUT_PX } from '../renderer/src/timeline/near-cut'
import { setLang } from '../renderer/src/ui/strings'

test('worker A\'s words: English and Turkish, the same parameters, in STRINGS, no key of the earlier files', () => {
  const params = (s: string): string => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(',')
  const earlier = new Set([...Object.keys(STRINGS_3C), ...Object.keys(STRINGS_3C2), ...Object.keys(STRINGS_3C3), ...Object.keys(STRINGS_CILA_T)])
  for (const [k, e] of Object.entries(STRINGS_YAMA_A)) {
    assert.ok(e.en.trim() && e.tr.trim(), `${k}: both languages`)
    assert.equal(params(e.tr), params(e.en), `${k}: the same parameters`)
    assert.deepEqual(all[k], e, `${k} is in STRINGS`)
    assert.equal(earlier.has(k), false, `${k} repeats an earlier key`)
  }
})

test('G8: every entrance, exit and idle movement has a name, in both languages, never its id', () => {
  for (const lang of ['en', 'tr'] as const) {
    setLang(lang)
    for (const k of CLIP_ANIMS) {
      const n = animName(k)
      assert.ok(n && n !== k && !n.startsWith('insp.'), `${lang} ${k}: ${n}`)
    }
    for (const k of IDLE_STYLES) {
      const n = idleName(k)
      assert.ok(n && n !== k && !n.startsWith('insp.'), `${lang} ${k}: ${n}`)
    }
  }
  setLang('en')
})

test('E4: the remove tip names Delete only where Delete removes the transition', () => {
  for (const s of both('ct.remove.hint')) assert.match(s, /Delete/)
  for (const s of both('ct.remove.hintClip')) assert.doesNotMatch(s, /Delete/)
})

test('14: a flat curve wears no badge; a changing one does', () => {
  const flat = curveBadge({ inPoint: 0, duration: 4, speed: 1, speedCurve: { keys: [{ m: 0, v: 1 }, { m: 4, v: 1 }] } })
  assert.equal(curveBadgeShown(flat), false, `flat: ${JSON.stringify(flat)}`)
  const bent = curveBadge({ inPoint: 0, duration: 4, speed: 1, speedCurve: { keys: [{ m: 0, v: 0.5 }, { m: 2, v: 3 }, { m: 4, v: 0.5 }] } })
  assert.equal(curveBadgeShown(bent), true, `bent: ${JSON.stringify(bent)}`)
  assert.equal(curveBadgeShown(null), false)
})

test('14: ← / → move a curve point along the clip, never an end point, never past a neighbour', () => {
  const pts = [{ u: 0, v: 1 }, { u: 0.5, v: 2 }, { u: 0.52, v: 1 }, { u: 1, v: 1 }]
  assert.equal(nudgeU(pts, 0, 0.01), null, 'the first point stays')
  assert.equal(nudgeU(pts, 3, -0.01), null, 'the last point stays')
  assert.equal(nudgeU(pts, 1, -0.01), 0.49)
  assert.equal(nudgeU(pts, 1, 0.01), 0.51)
  assert.equal(nudgeU(pts, 1, 0.1), 0.51, 'held a hundredth from its neighbour')
  assert.equal(nudgeU([{ u: 0, v: 1 }, { u: 0.5, v: 2 }, { u: 0.51, v: 1 }, { u: 1, v: 1 }], 1, 0.01), null, 'already against it: no move')
})

test('G4: the cut near the pointer along the lane', () => {
  const cuts: [string, number][] = [['a', 100], ['b', 300]]
  assert.equal(nearCut(cuts, 100), 'a')
  assert.equal(nearCut(cuts, 100 + NEAR_CUT_PX), 'a')
  assert.equal(nearCut(cuts, 100 + NEAR_CUT_PX + 1), null)
  assert.equal(nearCut(cuts, 290), 'b')
  assert.equal(nearCut([], 10), null)
})
