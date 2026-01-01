// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// Pitch-preserving time stretch (core polish, part B, decision K6): WSOLA —
// waveform-similarity overlap-add. A clip played at 2x keeps the pitch of its
// voice in the export, as the preview's media element keeps it.
//
// The export mixes its sound in separate windows (export/audio-stream.ts), so
// the stretch must give the same samples for a stretch of the output whoever
// asks for it and from wherever: a chain that searches each frame's place
// from the frame before it would differ between two windows and click where
// they meet. So the output is laid on the CLIP'S OWN GRID:
//   - output frame k always starts at output sample k × hop;
//   - every `anchor` frames the search starts over: that frame is read at its
//     nominal place (k × hop × speed), nothing before it matters;
//   - a frame between two anchors is read where the input is most like what
//     naturally follows the frame before it (within ± reach);
//   - the last frame before an anchor also looks ahead: where what follows
//     IT is most like the anchor frame, so both joins are smooth.
// Any range of the output is therefore a function of (input, speed, sample
// index) alone: `stretch` works from the nearest anchor at or before it.
//
// Pure: arrays in, arrays out. Indices: input sample j is the media at
// (in point + j / rate), output sample m is the clip at (m / rate); nominally
// j = m × speed.

export interface StretchPlan {
  /** Output samples between two frames (half a frame: a Hann cross-fade). */
  hop: number
  /** A frame's length (2 × hop). */
  frame: number
  /** How far either side of its nominal place a frame is searched for. */
  reach: number
  /** Every this many frames the search starts over. */
  anchor: number
  /** The search looks at every `coarse`-th sample and place, then refines. */
  coarse: number
}

/** 30 ms frames, 15 ms apart, searched ±10 ms, started over every 128 frames
 *  (1.92 s of output). */
export function stretchPlan(sampleRate: number): StretchPlan {
  const hop = Math.max(8, Math.round(sampleRate * 0.015))
  return { hop, frame: hop * 2, reach: Math.max(4, Math.round(sampleRate * 0.01)), anchor: 128, coarse: Math.max(1, Math.round(sampleRate / 12000)) }
}

/** How fast the clip plays: one speed, or (a speed that changes along the
 *  clip — part C's curve) the input sample each output sample stands for, a
 *  function that never goes backwards. One speed `s` is `(m) => m * s`. */
export type StretchSpeed = number | ((outSample: number) => number)

/** A frame's nominal place in the input. */
const nominal = (k: number, speed: StretchSpeed, plan: StretchPlan): number => Math.round(typeof speed === 'number' ? k * plan.hop * speed : speed(k * plan.hop))

/** The frames output samples [outFrom, outFrom + outCount) are made of:
 *  [the anchor to start from, the first frame heard, the last]. */
function framesFor(outFrom: number, outCount: number, plan: StretchPlan): [number, number, number] {
  const first = Math.max(0, Math.floor(outFrom / plan.hop) - 1)
  const last = Math.max(first, Math.floor((outFrom + Math.max(1, outCount) - 1) / plan.hop))
  return [Math.floor(first / plan.anchor) * plan.anchor, first, last]
}

/** The input samples [from, to) that `stretch` reads for output samples
 *  [outFrom, outFrom + outCount): what the caller must have decoded (what
 *  lies outside the input it is given counts as silence). */
export function stretchInputSpan(speed: StretchSpeed, outFrom: number, outCount: number, plan: StretchPlan): [number, number] {
  const [start, , last] = framesFor(outFrom, outCount, plan)
  return [nominal(start, speed, plan) - plan.reach, nominal(last + 1, speed, plan) + plan.reach + plan.frame + plan.hop]
}

/**
 * Output samples [outFrom, outFrom + outCount) of `input` played at `speed`
 * with its pitch kept. `input[c]` is channel c from input sample
 * `inputStart` on (every channel the same length). At speed 1 the output is
 * the input.
 */
export function stretch(input: readonly Float32Array[], inputStart: number, speed: StretchSpeed, outFrom: number, outCount: number, plan: StretchPlan): Float32Array<ArrayBuffer>[] {
  const out = input.map(() => new Float32Array(Math.max(0, outCount)))
  if (outCount <= 0 || input.length === 0) return out
  const { hop, frame, reach, coarse } = plan
  const [startFrame, , lastFrame] = framesFor(outFrom, outCount, plan)
  const [spanFrom, spanTo] = stretchInputSpan(speed, outFrom, outCount, plan)
  // The search works on one channel: the channels' mean, over the whole span
  // (silence where the input does not reach), so no read needs a bound check.
  const len = input[0].length
  const mono = new Float32Array(spanTo - spanFrom)
  {
    const a = Math.max(spanFrom, inputStart)
    const b = Math.min(spanTo, inputStart + len)
    for (const ch of input) for (let j = a; j < b; j++) mono[j - spanFrom] += ch[j - inputStart]
    if (input.length > 1) for (let j = a; j < b; j++) mono[j - spanFrom] /= input.length
  }
  const terms = Math.floor(frame / coarse)
  /** How alike the input from `c` is to the input from `t` (both over one
   *  frame, every `coarse`-th sample): their correlation over the root of
   *  the candidate's energy. Indices are into `mono`. */
  const alike = (c: number, t: number): number => {
    let dot = 0
    let energy = 0
    for (let i = 0; i < terms; i++) {
      const x = mono[c + i * coarse]
      dot += x * mono[t + i * coarse]
      energy += x * x
    }
    return energy > 1e-12 ? dot / Math.sqrt(energy) : 0
  }
  // Where each frame is read from (input sample of its first sample).
  const place = new Int32Array(lastFrame - startFrame + 1)
  for (let k = startFrame; k <= lastFrame; k++) {
    const a = nominal(k, speed, plan)
    if (k % plan.anchor === 0) {
      place[k - startFrame] = a
      continue
    }
    // What naturally follows the frame before it…
    const follow = place[k - 1 - startFrame] + hop - spanFrom
    // …and, for the last frame before an anchor, the anchor it leads into.
    const ahead = (k + 1) % plan.anchor === 0 ? nominal(k + 1, speed, plan) - spanFrom : -1
    const score = (d: number): number => {
      const c = a + d - spanFrom
      return alike(c, follow) + (ahead >= 0 ? alike(c + hop, ahead) : 0)
    }
    // It follows on exactly when that is within reach (speed 1, and most
    // frames near it): nothing is more alike than the thing itself.
    const natural = follow + spanFrom - a
    let best = 0
    let bestScore = -Infinity
    if (ahead < 0 && Math.abs(natural) <= reach) {
      best = natural
    } else {
      // (Looking ahead too, following on is the first candidate: another
      // place must be strictly better to win.)
      if (Math.abs(natural) <= reach) {
        best = natural
        bestScore = score(natural)
      }
      for (let d = -reach; d <= reach; d += coarse) {
        const s = score(d)
        if (s > bestScore) {
          bestScore = s
          best = d
        }
      }
      const centre = best
      for (let d = Math.max(-reach, centre - coarse + 1); d <= Math.min(reach, centre + coarse - 1); d++) {
        if (d === centre) continue
        const s = score(d)
        if (s > bestScore) {
          bestScore = s
          best = d
        }
      }
      // Silence (or nothing alike anywhere): its nominal place.
      if (!(bestScore > 0)) best = 0
    }
    place[k - startFrame] = a + best
  }
  // Overlap-add: sample m lies in frame k1 = floor(m / hop) (rising half of
  // its Hann window) and in the one before it (falling half); the two
  // weights add up to 1. Before the first frame's second half there is only
  // frame 0: read straight.
  const rise = new Float32Array(hop)
  for (let j = 0; j < hop; j++) rise[j] = 0.5 - 0.5 * Math.cos((Math.PI * j) / hop)
  for (let c = 0; c < input.length; c++) {
    const src = input[c]
    const dst = out[c]
    const read = (j: number): number => {
      const i = j - inputStart
      return i >= 0 && i < len ? src[i] : 0
    }
    for (let n = 0; n < outCount; n++) {
      const m = outFrom + n
      if (m < 0) continue
      const k1 = Math.floor(m / hop)
      const j = m - k1 * hop
      const now = read(place[k1 - startFrame] + j)
      dst[n] = k1 === 0 ? now : rise[j] * now + (1 - rise[j]) * read(place[k1 - 1 - startFrame] + j + hop)
    }
  }
  return out
}

/** The whole of `input` at `speed` (its length ÷ speed, rounded). */
export function stretchAll(input: readonly Float32Array[], speed: number, plan: StretchPlan): Float32Array<ArrayBuffer>[] {
  const n = input.length ? Math.round(input[0].length / speed) : 0
  return stretch(input, 0, speed, 0, n, plan)
}
