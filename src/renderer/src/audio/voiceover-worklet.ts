// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// The voice-over's capture (REF-AB, worker S, item 8): runs on the audio
// thread, so a busy page (the preview playing) never drops a block. It sends
// the microphone's first channel in blocks of about 85 ms, and the block's
// peak for the meter; it records only between 'start' and 'stop'.
declare class AudioWorkletProcessor {
  readonly port: MessagePort
}
declare function registerProcessor(name: string, ctor: unknown): void

const BLOCK = 4096

class VoiceoverCapture extends AudioWorkletProcessor {
  private buf = new Float32Array(BLOCK)
  private n = 0
  private on = false
  private alive = true

  constructor() {
    super()
    this.port.onmessage = (e: MessageEvent): void => {
      if (e.data === 'start') {
        this.n = 0
        this.on = true
      } else if (e.data === 'stop') {
        if (this.on && this.n > 0) this.port.postMessage({ samples: this.buf.slice(0, this.n), recording: true })
        this.on = false
        this.n = 0
        this.port.postMessage({ stopped: true })
      } else if (e.data === 'close') {
        this.alive = false
      }
    }
  }

  process(inputs: Float32Array[][]): boolean {
    const ch = inputs[0]?.[0]
    if (!ch) return this.alive
    for (let i = 0; i < ch.length; i++) {
      this.buf[this.n++] = ch[i]
      if (this.n === BLOCK) {
        this.port.postMessage({ samples: this.buf.slice(), recording: this.on })
        this.n = 0
      }
    }
    return this.alive
  }
}

registerProcessor('snipp-voiceover-capture', VoiceoverCapture)
