// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// Phase Ç3 patch (haritalar/_fazc3-denetim-ses.md S-1, S-2): the sound at a
// split whose pieces have different levels, and the limiter's true peak on
// every kind of loud signal, read by a reader of the test's own.
import assert from 'node:assert/strict'
import test from 'node:test'
import { volumeAt } from '../renderer/src/audio/envelope'
import { limitAll } from '../renderer/src/audio/limiter'
import { continuesInto, declickAt, declickEdges } from '../renderer/src/export/audio-window'
import type { Clip } from '../renderer/src/types'

const SR = 48000

const clip = (id: string, start: number, duration: number, inPoint: number, extra: Partial<Clip> = {}): Clip =>
  ({ id, assetId: 'music', trackId: 'A1', start, duration, inPoint, volume: 1, transform: { x: 0, y: 0, scale: 1, rotation: 0 }, ...extra }) as Clip
const NONE = { duration: 0, pre: 0, post: 0 }

/** The largest sample step within ±6 ms of the join at 2 s: a 440 Hz tone at
 *  0.5 split into `a` and `b`, each mixed as mixSpan does (a clip at volume 0
 *  without keyframes is not mixed at all). */
function joinStep(a: Clip, b: Clip): number {
  const tone = (m: number): number => 0.5 * Math.sin(2 * Math.PI * 440 * m + 1.1)
  const track = [a, b]
  const edges = new Map(track.map((c) => [c, declickEdges(c, track, NONE, NONE)]))
  const mixed = (c: Clip): boolean => !c.muted && !(c.volume <= 0 && !c.volumeKeyframes?.length)
  let worst = 0
  let prev = 0
  for (let n = 2 * SR - 300; n < 2 * SR + 300; n++) {
    const t = n / SR
    let v = 0
    for (const c of track) {
      const local = t - c.start
      if (!mixed(c) || local < 0 || local >= c.duration) continue
      v += tone(c.inPoint + local) * volumeAt(c, local) * declickAt(local, c.duration, edges.get(c)!)
    }
    if (n > 2 * SR - 300) worst = Math.max(worst, Math.abs(v - prev))
    prev = v
  }
  return worst
}

const TONE_STEP = 2 * 0.5 * Math.sin((Math.PI * 440) / SR) // what the plain tone moves at most, 0.029

test('S-1: a split whose pieces have different levels gets the ramps at its join (the auditor\'s P7)', () => {
  for (const va of [0, 0.3]) {
    const step = joinStep(clip('a', 0, 2, 10, { volume: va }), clip('b', 2, 4, 12))
    assert.ok(step <= TONE_STEP + 0.005, `piece a at ${va * 100} %: step ${step.toFixed(3)} (a plain tone moves ${TONE_STEP.toFixed(3)})`)
  }
  // A mute on one piece, a fade at the join, a keyframe that differs there.
  assert.ok(joinStep(clip('a', 0, 2, 10, { muted: true }), clip('b', 2, 4, 12)) <= TONE_STEP + 0.005, 'a muted piece')
  assert.ok(joinStep(clip('a', 0, 2, 10), clip('b', 2, 4, 12, { volumeKeyframes: [{ id: 'k1', time: 0, value: 0.2 }, { id: 'k2', time: 1, value: 1 }] } as Partial<Clip>)) <= TONE_STEP + 0.005, 'a keyframe at the join')
})

test('S-1: a plain split (the same level on both sides) stays seamless, no dip', () => {
  const a = clip('a', 0, 2, 10)
  const b = clip('b', 2, 4, 12)
  assert.equal(continuesInto(a, b), true)
  assert.deepEqual(declickEdges(a, [a, b], NONE, NONE), { head: true, tail: false })
  assert.deepEqual(declickEdges(b, [a, b], NONE, NONE), { head: false, tail: true })
  assert.ok(joinStep(a, b) <= TONE_STEP + 1e-6)
  // The same level reached by keyframes on one side and a plain volume on the other.
  const k = clip('a', 0, 2, 10, { volume: 0.5, volumeKeyframes: [{ id: 'k1', time: 0, value: 1 }, { id: 'k2', time: 2, value: 0.5 }] } as Partial<Clip>)
  assert.equal(continuesInto(k, clip('b', 2, 4, 12, { volume: 0.5 })), true)
})

// ---- S-2: the limiter's true peak --------------------------------------------

/** An independent true-peak reader (not the limiter's): 8× oversampling,
 *  each in-between point through a 256-tap Kaiser sinc (β 10). */
const READ_T = 128
const READ_PHASES = Array.from({ length: 7 }, (_, q) => {
  const i0 = (x: number): number => {
    let s = 1
    let t = 1
    for (let k = 1; k < 60; k++) {
      t *= (x * x) / 4 / (k * k)
      s += t
    }
    return s
  }
  return Float64Array.from({ length: 2 * READ_T }, (_, j) => {
    const t = j - READ_T + 1 - (q + 1) / 8
    const r = t / (READ_T + 1)
    return ((Math.sin(Math.PI * t) / (Math.PI * t)) * i0(10 * Math.sqrt(1 - r * r))) / i0(10)
  })
})
function truePeakDb(x: Float32Array): number {
  let m = 0
  for (let i = READ_T; i < x.length - READ_T; i++) {
    const v = Math.abs(x[i])
    if (v > m) m = v
    if (v < 0.25 && Math.abs(x[i + 1]) < 0.25) continue
    for (const c of READ_PHASES) {
      let a = 0
      for (let j = 0; j < 2 * READ_T; j++) a += x[i - READ_T + 1 + j] * c[j]
      if (Math.abs(a) > m) m = Math.abs(a)
    }
  }
  return 20 * Math.log10(m)
}

const tone = (n: number, f: number, a: number, ph = 0): Float32Array => Float32Array.from({ length: n }, (_, i) => a * Math.sin((2 * Math.PI * f * i) / SR + ph))
const padded = (x: Float32Array): Float32Array => {
  const y = new Float32Array(x.length + SR / 5)
  y.set(x, SR / 10)
  return y
}

/** The auditor's loud signals (haritalar/_fazc3-denetim-ses.md P1, P1b). */
function loudSignals(): [string, Float32Array][] {
  const out: [string, Float32Array][] = []
  let seed = 7
  const rnd = (): number => {
    seed = (seed * 1103515245 + 12345) >>> 0
    return seed / 2 ** 32 - 0.5
  }
  for (const [name, fc] of [['noise low-passed 8 kHz', 8000], ['noise low-passed 16 kHz', 16000], ['noise full band', 0]] as [string, number][]) {
    const n = SR
    const x = new Float32Array(n)
    let y1 = 0
    let y2 = 0
    const k = fc ? 1 - Math.exp((-2 * Math.PI * fc) / SR) : 1
    for (let i = 0; i < n; i++) {
      y1 += k * (rnd() - y1)
      y2 += k * (y1 - y2)
      x[i] = y2
    }
    let pk = 0
    for (const v of x) pk = Math.max(pk, Math.abs(v))
    for (let i = 0; i < n; i++) x[i] *= 2 / pk // +6 dB over full scale
    out.push([name, padded(x)])
  }
  out.push(['square 2.9 kHz ±0.95', padded(Float32Array.from({ length: SR / 4 }, (_, i) => (Math.floor((i * 2 * 2900) / SR) % 2 ? -0.95 : 0.95)))])
  out.push(['square 1 kHz ±0.95', padded(Float32Array.from({ length: SR / 4 }, (_, i) => (Math.floor((i * 2 * 1000) / SR) % 2 ? -0.95 : 0.95)))])
  out.push(['fs/4 at 45°, samples 0.85', padded(Float32Array.from({ length: SR / 4 }, (_, i) => 0.85 * Math.SQRT2 * Math.sin((Math.PI * i) / 2 + Math.PI / 4)))])
  for (const f of [11025, 15000, 19000, 20000, 21000, 22000]) for (let k = 0; k < 8; k += 1) out.push([`${f} Hz amp 1.4 phase ${k}/8`, padded(tone(SR / 8, f, 1.4, (k / 8) * Math.PI))])
  const spike = tone(SR / 4, 300, 0.1)
  spike[6000] = 1.6
  spike[6001] = -1.6
  out.push(['spike ±1.6 on a bed', padded(spike)])
  const burst = new Float32Array(SR / 4)
  for (let i = 6000; i < 6480; i++) burst[i] = 2 * Math.sin((2 * Math.PI * 7000 * i) / SR)
  out.push(['7 kHz burst amp 2 after silence', padded(burst)])
  // The worker's own: two full-scale low tones summed.
  out.push(['two low tones', padded(Float32Array.from({ length: SR / 2 }, (_, i) => 0.9 * Math.sin((2 * Math.PI * 100 * i) / SR) + 0.9 * Math.sin((2 * Math.PI * 150 * i) / SR + 0.3)))])
  return out
}

test('S-2: the limiter holds −1.0 dBTP on every loud signal, read by an independent 8× reader', () => {
  const over: string[] = []
  let worst = -99
  for (const [name, x] of loudSignals()) {
    const { out } = limitAll([x, x], SR, { ceilingDb: -1 })
    const tp = truePeakDb(out[0])
    worst = Math.max(worst, tp)
    if (tp > -1.0) over.push(`${name}: ${tp.toFixed(3)} dBTP`)
  }
  console.log(`S-2: the loudest output true peak ${worst.toFixed(3)} dBTP`)
  assert.deepEqual(over, [], `worst ${worst.toFixed(3)} dBTP`)
})

test('S-2: what was right stays right: linked stereo, in step, same length, a loud 50 Hz tone undistorted', () => {
  const n = SR
  const L = tone(n, 1000, 1.5)
  const R = tone(n, 1000, 0.3, 1)
  const { out } = limitAll([L, R], SR)
  assert.equal(out[0].length, n)
  assert.equal(out[1].length, n)
  let link = 0
  for (let i = 0; i < n; i++) if (Math.abs(R[i]) > 0.05 && Math.abs(L[i]) > 0.05) link = Math.max(link, Math.abs(out[0][i] / L[i] - out[1][i] / R[i]))
  assert.ok(link < 1e-5, `linked: |gL − gR| ${link}`)
  const imp = new Float32Array(n)
  imp[30000] = 1.5
  const o = limitAll([imp], SR).out[0]
  let at = 0
  for (let i = 0; i < n; i++) if (Math.abs(o[i]) > Math.abs(o[at])) at = i
  assert.equal(at, 30000, 'in step with the input')
  // 50 Hz at +1 dBFS: the harmonics stay 50 dB under the tone.
  const f = 50
  const x = tone(SR * 2, f, 1.12)
  const y = limitAll([x], SR).out[0].subarray(SR, 2 * SR)
  const lvl = (h: number): number => {
    let re = 0
    let im = 0
    for (let i = 0; i < y.length; i++) {
      re += y[i] * Math.cos((2 * Math.PI * h * f * i) / SR)
      im += y[i] * Math.sin((2 * Math.PI * h * f * i) / SR)
    }
    return (2 * Math.hypot(re, im)) / y.length
  }
  const fund = lvl(1)
  let thd = 0
  for (let h = 2; h <= 9; h++) thd += lvl(h) ** 2
  const thdDb = 20 * Math.log10(Math.sqrt(thd) / fund)
  assert.ok(thdDb <= -50, `THD at 50 Hz ${thdDb.toFixed(1)} dB`)
})