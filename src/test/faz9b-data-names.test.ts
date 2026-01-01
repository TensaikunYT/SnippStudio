// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// Phase 9b, decision 3 (FAZ9-PLAN.md "9b"): the data modules keep their
// English (the agent reads them); the interface shows their entries by id
// through ui/data-names.ts. Every id has its words in both languages, and the
// English the interface shows is the module's own, word for word.
import assert from 'node:assert/strict'
import test from 'node:test'
import { BACKDROPS, BACKDROP_TINTS } from '../renderer/src/playback/backdrop'
import { MOVE_FEELS, MOVE_INFO } from '../renderer/src/motion/picture-moves'
import { VOICE_PRESETS } from '../renderer/src/audio/clean'
import { TEMPLATE_INFO } from '../renderer/src/templates/info'
import { backdropHint, backdropName, feelName, moveHint, moveName, templateHint, templateName, tintName, voiceHint, voiceName, whenAgo } from '../renderer/src/ui/data-names'
import { setLang } from '../renderer/src/ui/strings'

/** Every pair: [what the interface shows, what the module says]. */
function pairs(): [string, string, string][] {
  const out: [string, string, string][] = []
  for (const b of BACKDROPS) out.push([`backdrop ${b.id}`, backdropName(b.id), b.label], [`backdrop hint ${b.id}`, backdropHint(b.id), b.hint])
  for (const list of Object.values(BACKDROP_TINTS)) for (const c of list ?? []) out.push([`tint ${c.name}`, tintName(c.name), c.name])
  for (const [k, m] of Object.entries(MOVE_INFO)) out.push([`move ${k}`, moveName(k), m.label], [`move hint ${k}`, moveHint(k), m.hint])
  for (const f of MOVE_FEELS) out.push([`feel ${f.id}`, feelName(f.id), f.label])
  for (const [k, v] of Object.entries(VOICE_PRESETS)) out.push([`voice ${k}`, voiceName(k), v.label], [`voice hint ${k}`, voiceHint(k), v.hint])
  for (const [k, v] of Object.entries(TEMPLATE_INFO)) out.push([`template ${k}`, templateName(k), v.label], [`template hint ${k}`, templateHint(k), v.hint])
  return out
}

test('English: the interface shows each module entry in its own English words', () => {
  setLang('en')
  const differ = pairs().filter(([, shown, own]) => shown !== own).map(([what, shown, own]) => `${what}: "${shown}" ≠ "${own}"`)
  assert.deepEqual(differ, [])
})

test('Turkish: every entry has its own Turkish (no key name, no English left as it is)', () => {
  setLang('tr')
  try {
    const all = pairs()
    assert.ok(all.length >= 120, `entries: ${all.length}`)
    // Names that are the same in both languages (a product's or a format's name).
    const SAME = new Set(['Normal', 'Podcast', 'Terminal', 'Domino', 'Petrol'])
    const bad = all.filter(([, shown, own]) => shown.startsWith('data.') || (shown === own && !SAME.has(own))).map(([what, shown]) => `${what}: ${shown}`)
    assert.deepEqual(bad, [])
    const now = Date.UTC(2026, 10, 20, 12, 0)
    assert.equal(whenAgo(now - 30_000, now), 'az önce')
    assert.equal(whenAgo(now - 5 * 60_000, now), '5 dk önce')
    assert.equal(whenAgo(now - 3 * 3600_000, now), '3 sa önce')
    assert.equal(whenAgo(now - 2 * 86400_000, now), '2 gün önce')
  } finally {
    setLang('en')
  }
})
