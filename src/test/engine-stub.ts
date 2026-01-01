// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// Just enough of a browser for the playback engine (playback/engine.ts) to
// run its own tick in Node: media elements that play and pause, a canvas
// that draws nothing, an audio context whose nodes connect to nothing, timers
// that never fire on their own (the test calls tick). Imported FIRST.
export class FakeMedia {
  paused = true
  currentTime = 0
  readyState = 4
  seeking = false
  muted = false
  volume = 1
  playbackRate = 1
  preservesPitch = true
  duration = 600
  src = ''
  crossOrigin = ''
  preload = ''
  playsInline = false
  error = null
  played = 0
  dataset: Record<string, string> = {}
  style: Record<string, string> = {}
  constructor(readonly tag: string) {}
  play(): Promise<void> {
    this.paused = false
    this.played++
    return Promise.resolve()
  }
  pause(): void {
    this.paused = true
  }
  load(): void {}
  addEventListener(): void {}
  removeEventListener(): void {}
  removeAttribute(): void {}
  setAttribute(): void {}
}
export class FakeVideo extends FakeMedia {
  videoWidth = 1280
  videoHeight = 720
}
export const made: FakeMedia[] = []

const node = (): Record<string, unknown> => {
  const param = { value: 1, setValueAtTime() {}, setTargetAtTime() {}, linearRampToValueAtTime() {}, cancelScheduledValues() {} }
  return new Proxy({ connect() {}, disconnect() {}, gain: param, frequency: param, Q: param, fftSize: 0, start() {}, stop() {}, buffer: null } as Record<string, unknown>, {
    get: (t, k) => (k in t ? t[k as string] : param)
  })
}
class FakeAudioContext {
  state = 'running'
  currentTime = 0
  sampleRate = 48000
  destination = node()
  createAnalyser = node
  createGain = node
  createMediaElementSource = node
  createBiquadFilter = node
  createDynamicsCompressor = node
  createBufferSource = node
  createStereoPanner = node
  createBuffer = (ch: number, n: number) => ({ numberOfChannels: ch, length: n, getChannelData: () => new Float32Array(n) })
  resume(): Promise<void> {
    return Promise.resolve()
  }
}

const g = globalThis as unknown as Record<string, unknown>
const canvas = () => ({ width: 0, height: 0, getContext: () => null, addEventListener() {} })
g.document = {
  createElement: (tag: string) => {
    if (tag === 'video' || tag === 'audio') {
      const el = tag === 'video' ? new FakeVideo(tag) : new FakeMedia(tag)
      made.push(el)
      return el
    }
    return canvas()
  },
  visibilityState: 'visible',
  addEventListener() {},
  removeEventListener() {}
}
g.window = g
g.localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} }
g.requestAnimationFrame = () => 1
g.cancelAnimationFrame = () => {}
g.AudioContext = FakeAudioContext
// The decoder for paused frames asks for the file: never answered here (a
// pending promise does not keep Node running; a failing one is retried).
g.fetch = () => new Promise(() => undefined)
g.HTMLMediaElement = FakeMedia
g.HTMLVideoElement = FakeVideo
g.HTMLAudioElement = class extends FakeMedia {}
g.HTMLImageElement = class {}
g.HTMLCanvasElement = class {}
g.Image = class {
  dataset: Record<string, string> = {}
  crossOrigin = ''
  decoding = ''
  complete = true
  naturalWidth = 1
  onload: unknown = null
  src = ''
  removeAttribute(): void {}
}
export {}
