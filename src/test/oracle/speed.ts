// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// The oracle's speed invariants (core polish, part B): after a step that
// changed a clip's speed, by brute force from the two projects alone —
//   - its speed is inside 0.1x – 100x and it lasts one frame or more;
//   - it shows no media it did not show before (the same range, or less of
//     it when the next clip holds its length);
//   - what rides on it is at the same moment of the media as before: its
//     keys, the subtitle words under it (the talk's track), the work notes
//     tied to it.
// Nothing here is shared with the commands: only types.ts and the oracle's
// own reading (sample.ts).
import type { Clip, Project } from '../../renderer/src/types'
import { curveK, curved, speedOf, srcAt, timeAt } from './sample'
import type { Violation } from './oracle'

const RANGE: [number, number] = [0.1, 100]
const EPS = 1e-6
/** A follower may be this far (seconds of the timeline) from its moment. */
const NEAR = 2e-3

const windowOf = (c: Clip): [number, number] => [c.inPoint, c.inPoint + c.duration * speedOf(c)]
const moving = (c: Clip): boolean => c.freeze === undefined && !c.nested && !c.adjustment

/** `direct`: the step was the speed change itself (not its undo or redo —
 *  taking back a change the next clip had held gives the media back, and a
 *  step taken back may leave a clip as short as it was). */
export function speedProblems(before: Project, after: Project, voiceTrack: string, direct: boolean): Violation[] {
  const out: Violation[] = []
  const bad = (kind: string, detail: string): void => void out.push({ kind, detail })
  const frame = 1 / Math.max(1, after.settings.fps || 30)
  // Every clip of the timeline: inside the range.
  for (const c of Object.values(after.clips)) {
    if (c.speed !== undefined && (c.speed < RANGE[0] - EPS || c.speed > RANGE[1] + EPS)) bad('speed-range', `clip ${c.id} plays at ${c.speed}x`)
  }
  // (A speed curve put on, changed or taken away retimes it too: core polish C.)
  const retimed = Object.values(after.clips).filter((c) => before.clips[c.id] && (speedOf(before.clips[c.id]) !== speedOf(c) || JSON.stringify(before.clips[c.id].speedCurve) !== JSON.stringify(c.speedCurve)) && moving(c) && moving(before.clips[c.id]))
  for (const c of retimed) {
    const was = before.clips[c.id]
    if (direct && c.duration < frame - 1e-9) bad('speed-short', `clip ${c.id} at ${c.speed}x is ${c.duration} s long: under one frame (${frame})`)
    // A curve the step put on: the clip plays the speeds its points say (its
    // length is the one they ask for), each point inside the range.
    if (direct && curved(c) && JSON.stringify(was.speedCurve) !== JSON.stringify(c.speedCurve)) {
      const k = curveK(c)
      if (Math.abs(k - 1) > 1e-4) bad('curve-length', `clip ${c.id} lasts ${c.duration} s, its points ask for ${c.duration * k} s`)
      for (const key of c.speedCurve.keys) if (key.v < RANGE[0] - EPS || key.v > RANGE[1] + EPS) bad('speed-range', `clip ${c.id} has a point at ${key.v}x`)
    }
    const [a0, a1] = windowOf(was)
    const [b0, b1] = windowOf(c)
    // (A clip already shorter than one frame is brought to one, the core's
    // floor, and shows that frame's media: a cut through a curved clip's
    // fast head left such a piece — wild seed 582, in the audit patch's
    // report.)
    if (direct && was.duration >= frame - 1e-9 && (b0 < a0 - EPS || b1 > a1 + EPS)) bad('speed-media-grew', `clip ${c.id} showed media ${a0}–${a1}, at ${c.speed}x it shows ${b0}–${b1}`)
    // Its keys: each on the second of the media it was on.
    for (const [ch, keys] of Object.entries(c.channels ?? {})) {
      for (const k of keys ?? []) {
        const old = (was.channels as Record<string, { id: string; time: number }[] | undefined> | undefined)?.[ch]?.find((x) => x.id === k.id)
        if (!old) continue
        const m0 = srcAt(was, was.start + old.time)
        const m1 = srcAt(c, c.start + k.time)
        if (Math.abs(m1 - m0) > NEAR * Math.max(speedOf(c), speedOf(was))) bad('speed-key-moved', `clip ${c.id} ${ch} key ${k.id} was on media ${m0}, now on ${m1}`)
      }
    }
    // The work notes tied to it.
    for (const n of after.notes ?? []) {
      const old = (before.notes ?? []).find((x) => x.id === n.id)
      if (!old?.clip || old.clip.id !== c.id || n.clip?.id !== c.id) continue
      const m = old.clip.from
      if (m < b0 - EPS || m > b1 + EPS || m < a0 - EPS || m > a1 + EPS) continue
      // (Where it was on the clip before, it is on the clip now.)
      if (Math.abs(srcAt(was, old.start) - m) > NEAR * speedOf(was)) continue
      const want = timeAt(c, m)
      if (Math.abs(n.start - want) > NEAR) bad('speed-note-moved', `note #${n.num} on media ${m} of clip ${c.id} is at ${n.start}, its media plays at ${want}`)
    }
  }
  // The subtitle words under a retimed clip of the talk's track.
  const voice = retimed.filter((c) => c.trackId === voiceTrack && before.clips[c.id].trackId === voiceTrack)
  if (voice.length) {
    for (const cap of after.captions) {
      if (cap.manual || cap.shape || !cap.words?.length) continue
      const old = before.captions.find((x) => x.id === cap.id)
      if (!old?.words || old.words.length !== cap.words.length) continue
      cap.words.forEach((w, i) => {
        const ow = old.words![i]
        if (ow.text !== w.text) return
        const mid = (ow.start + ow.end) / 2
        const c = voice.find((k) => {
          const was = before.clips[k.id]
          return ow.start >= was.start - EPS && mid < was.start + was.duration
        })
        if (!c) return
        const was = before.clips[c.id]
        const m = srcAt(was, ow.start)
        const [b0, b1] = windowOf(c)
        if (m < b0 + EPS || m > b1 - EPS) return
        const want = timeAt(c, m)
        if (Math.abs(w.start - want) > NEAR) bad('speed-word-moved', `line ${cap.id} word ${i} "${w.text}" (media ${m.toFixed(3)} of clip ${c.id}) is at ${w.start}, its sound plays at ${want}`)
      })
    }
  }
  return out
}
