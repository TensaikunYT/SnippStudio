// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
import './dom-stub'
import assert from 'node:assert/strict'
import test from 'node:test'
import { defaultProject, type Asset, type Clip, type Project } from '../renderer/src/types'
import {
  batchReduction,
  canMixAudioWindow,
  describeAudioSkip,
  exportCarriesSound,
  mixedClips,
  transitionAudioFade,
  type AudioSkip
} from '../renderer/src/export/audio-window'
import { AUDIO_MIX_LIMITS, mixProjectAudio } from '../renderer/src/export/audio'
import { correctionFor, readingAtVolume, readStereo } from '../renderer/src/audio/normalize'
import { integratedLufs } from '../renderer/src/audio/loudness'

// The decoder is replaced by a fake (WebAudio and mediabunny's decoding do
// not exist in node). The mixer reads the module's export at call time.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const sources = require('../renderer/src/media/sources') as { getAudioSink: (asset: Asset, isolated?: boolean) => Promise<unknown> }

// -- SA-10: the transition sound ---------------------------------------------

const win = (pre: number, post: number, type = 'mix') => ({ duration: pre + post, pre, post, type })
const NONE = { duration: 0, pre: 0, post: 0 }

test('a centred dissolve crosses the sound over after the cut: always one in sum, no -6 dB hole', () => {
  const a = { start: 0, duration: 10 }
  const b = { start: 10, duration: 10 }
  const w = win(0.5, 0.5)
  // A holds full level up to the cut (it used to be at 0.5 there).
  assert.equal(transitionAudioFade(9.6, a, w, NONE, 30), 1)
  assert.equal(transitionAudioFade(10, a, w, NONE, 30), 1)
  // B is silent before the cut: the lead is picture only.
  assert.equal(transitionAudioFade(9.8, b, NONE, w, 30), 0)
  for (let t = 10; t <= 10.5 + 1e-9; t += 0.05) {
    const sum = transitionAudioFade(t, a, w, NONE, 30) + transitionAudioFade(t, b, NONE, w, 30)
    assert.ok(Math.abs(sum - 1) < 1e-9, `at ${t}: ${sum}`)
  }
  assert.equal(transitionAudioFade(10.5, a, w, NONE, 30), 0)
  assert.equal(transitionAudioFade(10.5, b, NONE, w, 30), 1)
})

test('a dissolve wholly before the cut cuts the sound at the cut; one after it is unchanged', () => {
  const a = { start: 0, duration: 10 }
  const b = { start: 10, duration: 10 }
  const end = win(1, 0)
  // 'end' alignment: A at full to the cut (it used to fade out over the
  // dissolve while B was still silent), B at full from it.
  assert.equal(transitionAudioFade(9.5, a, end, NONE, 30), 1)
  assert.equal(transitionAudioFade(10, a, end, NONE, 30), 1)
  assert.equal(transitionAudioFade(10, b, NONE, end, 30), 1)
  // 'start' alignment was already the rule: A 1→0 and B 0→1 over [c, c+d].
  const start = win(0, 1)
  assert.ok(Math.abs(transitionAudioFade(10.25, a, start, NONE, 30) - 0.75) < 1e-9)
  assert.ok(Math.abs(transitionAudioFade(10.25, b, NONE, start, 30) - 0.25) < 1e-9)
})

test('a speed ramp keeps its own short declick at the cut, and a plain cut has no fade at all', () => {
  const a = { start: 0, duration: 10 }
  const ramp = { duration: 0.7, pre: 0, post: 0, type: 'speed-ramp' }
  assert.equal(transitionAudioFade(9, a, ramp, NONE, 30), 1)
  assert.equal(transitionAudioFade(10, a, ramp, NONE, 30), 0)
  assert.ok(transitionAudioFade(9.93, a, ramp, NONE, 30) > 0.4)
  assert.equal(transitionAudioFade(5, a, NONE, NONE, 30), 1)
})

// -- EXP-8: compound clips carry their sound into the export ------------------

function voiceProject(over: Partial<Clip> = {}): { p: Project; clip: Clip } {
  const p = defaultProject()
  const a1 = p.tracks.find((t) => t.kind === 'audio')!
  p.assets.push({ id: 'voice', kind: 'audio', name: 'voice.wav', url: '', size: 1, duration: 60, width: 0, height: 0, hasAudio: true } as Asset)
  const clip = { id: 'v', assetId: 'voice', trackId: a1.id, start: 0, inPoint: 0, duration: 3, volume: 1, transform: { x: 0, y: 0, scale: 1, rotation: 0 }, ...over } as Clip
  p.clips[clip.id] = clip
  a1.clipIds.push(clip.id)
  return { p, clip }
}

test('footage grouped into a compound clip still gives the export a sound track', () => {
  const { p, clip } = voiceProject()
  const a1 = p.tracks.find((t) => t.kind === 'audio')!
  // The compound holds the clip in `nested`; it is gone from project.clips.
  delete p.clips[clip.id]
  const compound = { id: 'cmp', assetId: '', trackId: a1.id, start: 0, inPoint: 0, duration: 3, volume: 1, transform: { x: 0, y: 0, scale: 1, rotation: 0 }, nested: { clips: [{ ...clip, start: 0 }] } } as Clip
  p.clips[compound.id] = compound
  a1.clipIds = [compound.id]
  assert.equal(mixedClips(p).length, 1)
  assert.equal(exportCarriesSound(p, 0), true)
  // The same rule as the mixer: a muted track, or a disabled compound, is not heard.
  a1.muted = true
  assert.equal(exportCarriesSound(p, 0), false)
  a1.muted = false
  compound.disabled = true
  assert.equal(exportCarriesSound(p, 0), false)
  assert.equal(canMixAudioWindow(p, true), true)
})

// -- the memory rule: only analysis mixes are reduced -------------------------

test('a decoded batch is reduced only for an analysis mix, never for the 48 kHz stereo export', () => {
  assert.equal(batchReduction({ sampleRate: 48000, channels: 2 }, { sampleRate: 48000, channels: 2 }), null)
  // A 96 kHz or 5.1 source in the export: kept as decoded, exactly as before.
  assert.equal(batchReduction({ sampleRate: 48000, channels: 2 }, { sampleRate: 96000, channels: 6 }), null)
  assert.deepEqual(batchReduction({ sampleRate: 16000, channels: 1 }, { sampleRate: 48000, channels: 2 }), { sampleRate: 16000, channels: 1 })
  assert.deepEqual(batchReduction({ sampleRate: 16000, channels: 2 }, { sampleRate: 44100, channels: 2 }), { sampleRate: 16000, channels: 2 })
  assert.deepEqual(batchReduction({ sampleRate: 48000, channels: 1 }, { sampleRate: 48000, channels: 2 }), { sampleRate: 48000, channels: 1 })
  // Never more: a mono 8 kHz source in a 16 kHz mix is left alone.
  assert.equal(batchReduction({ sampleRate: 16000, channels: 1 }, { sampleRate: 8000, channels: 1 }), null)
})

// -- SA-9: loudness read the way the export reads it --------------------------

test('a dual-mono voice reads 3 dB louder in stereo, as the export measures it', () => {
  const sr = 48000
  const n = sr * 3
  const tone = new Float32Array(n)
  for (let i = 0; i < n; i++) tone[i] = 0.25 * Math.sin((2 * Math.PI * 997 * i) / sr)
  const stereo = { numberOfChannels: 2, getChannelData: () => tone }
  const r = readStereo(stereo, sr)
  assert.ok(Math.abs(r.lufs - (integratedLufs(tone, sr) + 10 * Math.log10(2))) < 0.01, `${r.lufs}`)
  assert.ok(Math.abs(r.peakDb - 20 * Math.log10(0.25)) < 0.01)
})

test('normalising uses the volume the reading was taken at, and shows what it really reached', () => {
  const r = { lufs: -20, peakDb: -6, volume: 0.5 }
  // +6 dB from the measured 50 %: 100 %, whatever the slider says now.
  assert.ok(Math.abs(correctionFor(r, -14, 1.5) - 0.5 * 10 ** (6 / 20)) < 1e-9)
  // Without a stored volume (an old reading), the current one, as before.
  assert.ok(Math.abs(correctionFor({ lufs: -20, peakDb: -6 }, -14, 1) - 10 ** (6 / 20)) < 1e-9)
  // Held at 200 %: the readout says where it landed, not the target.
  const quiet = { lufs: -40, peakDb: -30, volume: 1 }
  const vol = correctionFor(quiet, -14, 1)
  assert.equal(vol, 2)
  const after = readingAtVolume(quiet, vol)
  assert.ok(Math.abs(after.lufs - (-40 + 20 * Math.log10(2))) < 1e-9)
  assert.equal(after.volume, 2)
  // Pressing it again from there changes nothing more.
  assert.equal(correctionFor(after, -14, 2), 2)
  const reached = readingAtVolume(r, correctionFor(r, -14, 1))
  assert.ok(Math.abs(reached.lufs + 14) < 1e-9)
  assert.ok(Math.abs(correctionFor(reached, -14, 0.3) - reached.volume!) < 1e-9)
})

// -- the mixer itself, on a fake WebAudio ------------------------------------

class FakeParam {
  value = 0
  curves: Float32Array[] = []
  setValueAtTime(): void {}
  linearRampToValueAtTime(): void {}
  setValueCurveAtTime(curve: Float32Array): void {
    this.curves.push(curve)
  }
}

class FakeBuffer {
  data: Float32Array[]
  constructor(readonly numberOfChannels: number, readonly length: number, readonly sampleRate: number) {
    this.data = Array.from({ length: numberOfChannels }, () => new Float32Array(length))
  }
  get duration(): number {
    return this.length / this.sampleRate
  }
  getChannelData(c: number): Float32Array {
    return this.data[c]
  }
  copyToChannel(src: Float32Array, c: number, off: number): void {
    this.data[c].set(src, off)
  }
}

interface Started { buffer: FakeBuffer; when: number; offset: number; dur: number }

class FakeContext {
  static made: FakeContext[] = []
  started: Started[] = []
  rendering = false
  destination = { connect: () => undefined }
  constructor(readonly channels: number, readonly length: number, readonly sampleRate: number) {
    FakeContext.made.push(this)
  }
  private node(): { connect: () => undefined } {
    return { connect: () => undefined }
  }
  createGain(): unknown {
    return { ...this.node(), gain: new FakeParam() }
  }
  createBiquadFilter(): unknown {
    return { ...this.node(), frequency: new FakeParam(), gain: new FakeParam(), Q: new FakeParam() }
  }
  createDynamicsCompressor(): unknown {
    return { ...this.node(), threshold: new FakeParam(), ratio: new FakeParam(), knee: new FakeParam(), attack: new FakeParam(), release: new FakeParam() }
  }
  createBuffer(ch: number, len: number, sr: number): FakeBuffer {
    return new FakeBuffer(ch, len, sr)
  }
  createBufferSource(): unknown {
    const started = this.started
    const ctx = this
    const source = {
      buffer: null as FakeBuffer | null,
      playbackRate: new FakeParam(),
      connect: () => undefined,
      start(when = 0, offset = 0, dur = Infinity) {
        assert.equal(ctx.rendering, false, 'a node started on a context that is already rendering')
        started.push({ buffer: source.buffer!, when, offset, dur })
      }
    }
    return source
  }
  async startRendering(): Promise<FakeBuffer> {
    this.rendering = true
    const out = new FakeBuffer(this.channels, this.length, this.sampleRate)
    // Enough of WebAudio for a batch reduction: averaged channels, the
    // nearest source sample.
    for (const s of this.started) {
      const step = s.buffer.sampleRate / this.sampleRate
      for (let c = 0; c < this.channels; c++) {
        for (let j = 0; j < out.length; j++) {
          const i = Math.round(j * step)
          if (i >= s.buffer.length) break
          let v = 0
          const from = this.channels === 1 ? 0 : c
          const to = this.channels === 1 ? s.buffer.numberOfChannels : c + 1
          for (let k = from; k < to; k++) v += s.buffer.data[k][i]
          out.data[c][j] += v / (to - from)
        }
      }
    }
    return out
  }
}

/** Packets of `sec` seconds at 48 kHz stereo, L = 0.5 and R = -0.25 (or `fill`). */
function packet(ts: number, sec: number, fill?: (i: number) => number): { timestamp: number; duration: number; buffer: FakeBuffer } {
  const b = new FakeBuffer(2, Math.round(sec * 48000), 48000)
  for (let i = 0; i < b.length; i++) {
    b.data[0][i] = fill ? fill(i) : 0.5
    b.data[1][i] = fill ? fill(i) : -0.25
  }
  return { timestamp: ts, duration: sec, buffer: b }
}

type SinkFactory = (asset: Asset, isolated: boolean) => Promise<unknown>

async function withFakes<T>(sink: SinkFactory, run: () => Promise<T>): Promise<T> {
  const g = globalThis as unknown as { OfflineAudioContext?: unknown }
  const saved = { ctx: g.OfflineAudioContext, sink: sources.getAudioSink, limits: { ...AUDIO_MIX_LIMITS } }
  g.OfflineAudioContext = FakeContext
  sources.getAudioSink = (asset, isolated = false) => sink(asset, isolated)
  FakeContext.made = []
  try {
    return await run()
  } finally {
    g.OfflineAudioContext = saved.ctx
    sources.getAudioSink = saved.sink
    Object.assign(AUDIO_MIX_LIMITS, saved.limits)
  }
}

const steadySink = (packets: () => ReturnType<typeof packet>[]) => async () => ({
  buffers: async function* () {
    for (const p of packets()) yield p
  }
})

test('the 48 kHz stereo export mix schedules the decoded samples exactly as decoded, with no reduction (the 4 ms declick at its cut edges apart)', async () => {
  const { p } = voiceProject()
  const packets = () => [packet(0, 1), packet(1, 1), packet(2, 1)]
  await withFakes(steadySink(packets), async () => {
    const skips: AudioSkip[] = []
    await mixProjectAudio(p, 48000, 2, undefined, undefined, undefined, (s) => skips.push(s))
    assert.equal(FakeContext.made.length, 1, 'only the mix itself')
    const main = FakeContext.made[0]
    assert.equal(main.started.length, 1)
    const held = main.started[0].buffer
    assert.equal(held.sampleRate, 48000)
    assert.equal(held.numberOfChannels, 2)
    assert.equal(held.length, 3 * 48000)
    // As decoded away from the edges; at both edges (hard cuts: nothing
    // before or after it) the 4 ms raised-cosine declick (phase Ç3b, R9).
    const R = Math.round(0.004 * 48000)
    const mid = (d: Float32Array, v: number): boolean => d.subarray(R, d.length - R).every((x) => x === v)
    assert.ok(mid(held.data[0], 0.5) && mid(held.data[1], -0.25))
    assert.equal(held.data[0][0], 0)
    assert.ok(Math.abs(held.data[0][R / 2] - 0.25) < 0.01, 'half way up at 2 ms')
    assert.ok(Math.abs(held.data[1][held.length - 1]) < 0.001, 'down to nothing at the end')
    assert.equal(main.started[0].when, 0)
    assert.equal(skips.length, 0)
  })
})

test('a 16 kHz mono transcription mix holds each batch at 16 kHz mono, a sixth of the recording', async () => {
  const { p } = voiceProject()
  const packets = () => [packet(0, 1), packet(1, 1), packet(2, 1)]
  await withFakes(steadySink(packets), async () => {
    await mixProjectAudio(p, 16000, 1)
    const main = FakeContext.made[0]
    const reduce = FakeContext.made.slice(1)
    assert.equal(reduce.length, 1, 'one small render per batch')
    assert.equal(reduce[0].sampleRate, 16000)
    assert.equal(reduce[0].channels, 1)
    const held = main.started[0].buffer
    assert.equal(held.sampleRate, 16000)
    assert.equal(held.numberOfChannels, 1)
    assert.equal(held.length, 3 * 16000)
    // The speaker downmix of L 0.5, R -0.25.
    assert.ok(Math.abs(held.data[0][100] - 0.125) < 1e-7)
    assert.equal(main.started[0].offset, 0)
  })
})

test('a decode error keeps what was decoded before it and is reported with where the sound stops', async () => {
  const { p } = voiceProject({ start: 2 })
  await withFakes(async () => ({
    buffers: async function* () {
      yield packet(0, 1)
      yield packet(1, 0.5)
      throw new Error('bad packet')
    }
  }), async () => {
    const skips: AudioSkip[] = []
    await mixProjectAudio(p, 48000, 2, undefined, undefined, undefined, (s) => skips.push(s))
    const main = FakeContext.made[0]
    assert.equal(main.started.length, 1, 'the 1.5 s before the error are still in the mix')
    assert.equal(main.started[0].buffer.length, 1.5 * 48000)
    assert.deepEqual(skips, [{ clipId: 'v', name: 'voice.wav', at: 3.5, reason: 'decode-error' }])
    assert.match(describeAudioSkip(skips[0]), /"voice\.wav" from 0:03 .*could not be decoded/)
  })
})

test('a clip without a sound track, or one that does not open in time, is reported, not silently dropped', async () => {
  const { p } = voiceProject({ start: 1 })
  await withFakes(async () => null, async () => {
    const skips: AudioSkip[] = []
    await mixProjectAudio(p, 48000, 2, undefined, undefined, undefined, (s) => skips.push(s))
    assert.deepEqual(skips, [{ clipId: 'v', name: 'voice.wav', at: 1, reason: 'no-sound-track' }])
  })
  // Opens only after the mix has stopped waiting for it.
  await withFakes(() => new Promise((r) => setTimeout(() => r(null), 60)), async () => {
    AUDIO_MIX_LIMITS.openMs = 20
    const skips: AudioSkip[] = []
    await mixProjectAudio(p, 48000, 2, undefined, [2, 3], undefined, (s) => skips.push(s))
    assert.deepEqual(skips, [{ clipId: 'v', name: 'voice.wav', at: 2, reason: 'open-timeout' }])
    // (Its late answer frees the shared Input for the tests after this one.)
    await new Promise((r) => setTimeout(r, 80))
  })
})

test('a stalled decoder is abandoned: reported once, and nothing it hands over later reaches the mix', async () => {
  const { p } = voiceProject()
  let resume: () => void = () => {}
  let returned = false
  let lateYielded = false
  const iterator = {
    calls: 0,
    async next(): Promise<IteratorResult<ReturnType<typeof packet>>> {
      this.calls++
      if (this.calls === 1) return { done: false, value: packet(0, 1) }
      // Then nothing, until long after the stall guard has given up.
      await new Promise<void>((r) => { resume = r })
      lateYielded = true
      return { done: false, value: packet(1, 1) }
    },
    async return(): Promise<IteratorResult<ReturnType<typeof packet>>> {
      returned = true
      return { done: true, value: undefined }
    },
    [Symbol.asyncIterator]() { return this }
  }
  await withFakes(async () => ({ buffers: () => iterator }), async () => {
    AUDIO_MIX_LIMITS.stallMs = 25
    const skips: AudioSkip[] = []
    await mixProjectAudio(p, 48000, 2, undefined, undefined, undefined, (s) => skips.push(s))
    assert.equal(skips.length, 1)
    assert.equal(skips[0].reason, 'stalled')
    assert.equal(skips[0].at, 0, 'nothing of it had been scheduled yet')
    assert.ok(returned, 'the decoder was told to stop')
    const main = FakeContext.made[0]
    assert.equal(main.rendering, true)
    // The decoder wakes up after the render started: its packets are fenced off.
    resume()
    await new Promise((r) => setTimeout(r, 10))
    assert.ok(lateYielded)
    assert.equal(main.started.length, 0)
    assert.equal(skips.length, 1)
  })
})

test('two mixes at once never share one demuxer: the second opens its own', async () => {
  const { p } = voiceProject()
  const seen: boolean[] = []
  let release: () => void = () => {}
  const gate = new Promise<void>((r) => { release = r })
  await withFakes(async (_asset, isolated) => {
    seen.push(isolated)
    return {
      buffers: async function* () {
        if (!isolated) await gate
        yield packet(0, 1)
      }
    }
  }, async () => {
    const first = mixProjectAudio(p, 16000, 1)
    await new Promise((r) => setTimeout(r, 5))
    await mixProjectAudio(p, 16000, 1)
    release()
    await first
    // Both done: the shared Input is free again.
    await new Promise((r) => setTimeout(r, 5))
    await mixProjectAudio(p, 16000, 1)
    assert.deepEqual(seen, [false, true, false])
  })
})
