// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// Phase 11b, KF1 / KF2 (11a's K6): a cut-off MP4 (no index) came in as a
// sound of 0 s with "Imported 1 file." and put a 0 s clip on the timeline;
// an empty file was refused with the media protocol's "416 Requested Range
// Not Satisfiable". Both are now refused by name, in a plain sentence, in
// the user's language.
import './dom-stub'
import assert from 'node:assert/strict'
import test from 'node:test'
import { probeRefusal } from '../renderer/src/media/import'
import { localizeMessage } from '../renderer/src/ui/errors'
import { setLang } from '../renderer/src/ui/strings'

test('KF1: a video or sound file without a track or a length is refused; a sound one comes in', () => {
  assert.match(probeRefusal({ size: 4_000_000, kind: 'video', duration: 0, tracks: 0 })!, /unrecognizable/)
  assert.match(probeRefusal({ size: 4_000_000, kind: 'video', duration: 0, tracks: 1 })!, /unrecognizable/)
  assert.match(probeRefusal({ size: 4_000_000, kind: 'audio', duration: Number.NaN, tracks: 1 })!, /unrecognizable/)
  assert.match(probeRefusal({ size: 4_000_000, kind: 'audio', duration: 12, tracks: 0 })!, /unrecognizable/)
  assert.equal(probeRefusal({ size: 4_000_000, kind: 'video', duration: 12.5, tracks: 2 }), null)
  assert.equal(probeRefusal({ size: 4_000_000, kind: 'audio', duration: 3, tracks: 1 }), null)
  assert.equal(probeRefusal({ size: 20_000, kind: 'image' }), null)
})

test('KF2: an empty file of any kind is said to be empty, in English and Turkish', () => {
  for (const kind of ['video', 'audio', 'image'] as const) assert.equal(probeRefusal({ size: 0, kind, duration: 5, tracks: 1 }), 'The file is empty.')
  setLang('tr')
  try {
    assert.equal(localizeMessage('empty.mp4: The file is empty.'), 'empty.mp4: Dosya boş.')
    assert.equal(localizeMessage('truncated.mp4: Input has an unsupported or unrecognizable format.'), 'truncated.mp4: Dosyanın biçimi desteklenmiyor ya da tanınmıyor.')
  } finally {
    setLang('en')
  }
})
