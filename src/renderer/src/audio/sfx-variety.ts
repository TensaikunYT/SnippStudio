// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// Variety (the craft run's round 6; the user on the Moon v2: one "ding"
// repeated constantly gets boring). The same sound never plays twice alike
// in a row: each short sound takes its kind's next variant in turn (five,
// sfx-synth.ts and sfx-synth2.ts make each a little different), and a small
// step of pitch, so a run of taps or pops is a hand at work, not a loop.
// The tuned ones (a chime, a marimba, a bell…) walk the film's key instead:
// a pentatonic step up or down from the note before, never the same note
// twice in a row, as a soft tune rather than one ding.
//
// Pure: a function of the sounds in time order, so the preview, the export
// and the review hear the same, and a jump hears what playing through does.

import { BED, LONG, type SfxEvent } from './sfx-synth'
/** The tuned sounds' own notes (MIDI): a chime, a marimba, a bell… walked
 *  the film's key. None of them is made any more (their recipes went in
 *  SnippStudio phase 2B, nothing in the product asked for them); the walk
 *  stays for a tuned sound that comes back. */
const TUNED: Record<string, number> = {}

/** How many variants a kind has (seed % 5 in the synths). */
export const VARIANTS = 5

/** The untuned sounds' small steps of pitch (semitones), one per variant:
 *  felt as the same hand, a different touch. */
const TOK_STEPS = [0, -0.8, 0.7, -1.4, 1.2]

/** The major pentatonic (semitones over the key's root). */
const PENTA = [0, 2, 4, 7, 9]

/** A kind's own small shuffle of its variants (so two kinds sounding
 *  together do not step in lockstep). */
function orderOf(kind: string): number[] {
  let h = 2166136261
  for (let i = 0; i < kind.length; i++) h = Math.imul(h ^ kind.charCodeAt(i), 16777619)
  const o = [0, 1, 2, 3, 4]
  for (let i = o.length - 1; i > 0; i--) {
    h = Math.imul(h ^ (h >>> 15), 2246822519) >>> 0
    const j = h % (i + 1)
    ;[o[i], o[j]] = [o[j], o[i]]
  }
  return o
}

/** A seeded 0..1 from a kind and a count. */
function hash01(kind: string, n: number): number {
  let h = 2166136261 ^ Math.imul(n + 1, 0x9e3779b1)
  for (let i = 0; i < kind.length; i++) h = Math.imul(h ^ kind.charCodeAt(i), 16777619)
  h ^= h >>> 13
  h = Math.imul(h, 0x5bd1e995)
  h ^= h >>> 15
  return (h >>> 0) / 4294967296
}

/** The notes of the key's pentatonic within reach of a tuned sound's own
 *  note (MIDI; a sixth under it to a fourth over it: warmer low than bright
 *  high). */
function notesNear(base: number, keyMidi: number): number[] {
  const out: number[] = []
  for (let m = base - 9; m <= base + 5; m++) {
    const d = (((m - keyMidi) % 12) + 12) % 12
    if (PENTA.includes(d)) out.push(m)
  }
  return out
}

/** A key's root (Hz) as a MIDI note. */
export const keyMidiOf = (hz: number): number => Math.round(69 + 12 * Math.log2(Math.max(20, hz) / 440))

/** Does this sound take part (a short sound, not a bed, not a held one)? */
const varies = (e: SfxEvent): boolean => !LONG.has(e.kind) && !BED.has(e.kind) && !e.bed

/**
 * Gives every short sound its variant and its pitch, in time order (the
 * events are sorted by t): each kind takes
 * the next of its five variants in turn, the untuned a small step of pitch
 * with it, the tuned a step along the key's pentatonic (`keyHz`: the film's
 * key, A by default). A sound that already has a variant or a pitch keeps it.
 */
export function varyEvents(events: SfxEvent[], keyHz = 220): SfxEvent[] {
  const keyMidi = keyMidiOf(keyHz)
  const count = new Map<string, number>()
  const lastNote = new Map<string, number>()
  for (const e of events) {
    if (!varies(e)) continue
    const id = e.kind
    const n = count.get(id) ?? 0
    count.set(id, n + 1)
    if (e.variant === undefined) e.variant = orderOf(id)[n % VARIANTS]
    if (e.pitch !== undefined) continue
    const base = TUNED[e.kind]
    if (base === undefined) {
      e.pitch = TOK_STEPS[e.variant % VARIANTS]
      continue
    }
    // A tuned sound: the next note a step or two along the pentatonic from
    // the one before (the first on the key's note nearest its own).
    const notes = notesNear(base, keyMidi)
    const prev = lastNote.get(id)
    let idx: number
    if (prev === undefined) {
      idx = notes.reduce((best, m, i) => (Math.abs(m - base) < Math.abs(notes[best] - base) ? i : best), 0)
    } else {
      const at = Math.max(0, notes.indexOf(prev))
      const step = (hash01(id, n) < 0.5 ? 1 : 2) * (hash01(id, n + 977) < 0.5 ? -1 : 1)
      idx = at + step
      // Bounced back inside the reach, never landing where it was.
      if (idx < 0) idx = at + Math.abs(step)
      if (idx >= notes.length) idx = at - Math.abs(step)
      idx = Math.max(0, Math.min(notes.length - 1, idx))
      if (idx === at) idx = at > 0 ? at - 1 : at + 1
    }
    const note = notes[idx]
    lastNote.set(id, note)
    e.pitch = note - base
  }
  return events
}
