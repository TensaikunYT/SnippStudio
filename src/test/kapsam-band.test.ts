// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// The range band and its box (KAPSAM-AJAN-PLAN.md §6; agent/scope-band.ts):
// what a send writes (the note's kind and words, limited or not), the
// user's own chips, how the work stands (working → draft ready → done), and
// the clip menu's ready notes.
import './dom-stub'
import assert from 'node:assert/strict'
import test from 'node:test'
import { useStore } from '../renderer/src/state/store'
import { resetInbox, useInbox } from '../renderer/src/agent/inbox'
import { bandSpan, bandStatus, drawBand, keepChip, dropChip, noteOf, pickChip, sendBand, sendClipChip, setBandOnly, setBandText, useScopeBand, bandForClips, closeBand } from '../renderer/src/agent/scope-band'
import { setNoteStatus } from '../renderer/src/notes/model'
import { clipOf, talk } from './agent-kit'

const S = useStore.getState
const label = (c: string): string => `[${c}]`

test('what a send writes: the chip\'s kind and words, with what was typed', () => {
  assert.equal(noteOf({ text: '  ', chip: null }, label), null)
  assert.deepEqual(noteOf({ text: 'tighter', chip: null }, label), { kind: 'fix', text: 'tighter' })
  assert.deepEqual(noteOf({ text: '', chip: { ready: 'animate' } }, label), { kind: 'animate', text: '[animate]' })
  assert.deepEqual(noteOf({ text: 'a bar chart', chip: { ready: 'animate' } }, label), { kind: 'animate', text: '[animate]: a bar chart' })
  assert.deepEqual(noteOf({ text: '', chip: { ready: 'silences' } }, label), { kind: 'cut', text: '[silences]' })
  assert.deepEqual(noteOf({ text: '', chip: { own: 'make it punchy' } }, label), { kind: 'fix', text: 'make it punchy' })
})

test('a band sent: a limited note in the inbox; the band rides the note and says how the work stands', () => {
  resetInbox()
  S().loadProject(talk(20, true))
  drawBand(9, 4)
  assert.deepEqual(useScopeBand.getState().band, { start: 4, end: 9 })
  pickChip({ ready: 'animate' })
  setBandText('chart')
  const r = sendBand(label)!
  const n = S().project.notes!.find((x) => x.id === r.id)!
  assert.deepEqual([n.start, n.end, n.kind, n.text, n.only], [4, 9, 'animate', '[animate]: chart', {}])
  assert.equal(useInbox.getState().queued, 1)
  const st = useScopeBand.getState()
  assert.equal(st.open, false)
  assert.equal(bandStatus(S().project, st.sent, false, false), 'working')
  assert.equal(bandStatus(S().project, st.sent, true, false), 'draft')
  assert.equal(bandStatus(S().project, st.sent, false, true), 'done')
  S().editNotes((p) => void setNoteStatus(p, r.id, 'ready'), false)
  assert.equal(bandStatus(S().project, st.sent, false, false), 'done')
  S().editNotes((p) => void (p.notes![0].start = 5), false)
  assert.deepEqual(bandSpan(S().project, st), [5, 9])
  closeBand()
})

test('"only" off: an ordinary note; over clips: limited to those clips', () => {
  const p = talk(20)
  p.clips.c1.duration = 10
  p.clips.c2 = clipOf('c2', 'a1', p.tracks[0].id, 10, 10, 10)
  p.tracks[0].clipIds = ['c1', 'c2']
  S().loadProject(p)
  drawBand(2, 3)
  setBandOnly(false)
  setBandText('x')
  const a = sendBand(label)!
  assert.equal(S().project.notes!.find((n) => n.id === a.id)!.only, undefined)
  assert.ok(bandForClips(S().project, ['c2'], true))
  setBandText('y')
  const b = sendBand(label)!
  const nb = S().project.notes!.find((n) => n.id === b.id)!
  assert.deepEqual([nb.start, nb.end, nb.only], [10, 20, { clips: ['c2'] }])
  const c = sendClipChip(['c1'], 'unrelated', label)!
  const nc = S().project.notes!.find((n) => n.id === c.id)!
  assert.deepEqual([nc.start, nc.end, nc.kind, nc.text, nc.only], [0, 10, 'fix', '[unrelated]', undefined])
  closeBand()
})

test('the user\'s own chips: kept from the words typed, at most 8, removed again', () => {
  for (const w of [...useScopeBand.getState().custom]) dropChip(w)
  assert.equal(keepChip('   '), false)
  assert.equal(keepChip('make it  punchy'), true)
  assert.deepEqual(useScopeBand.getState().custom, ['make it punchy'])
  assert.deepEqual(useScopeBand.getState().chip, { own: 'make it punchy' })
  assert.equal(keepChip('make it punchy'), false)
  for (let i = 0; i < 10; i++) keepChip(`c${i}`)
  assert.equal(useScopeBand.getState().custom.length, 8)
  for (const w of [...useScopeBand.getState().custom]) dropChip(w)
  assert.deepEqual(useScopeBand.getState().custom, [])
})
