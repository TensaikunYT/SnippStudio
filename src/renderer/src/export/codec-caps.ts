// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// What this computer's encoders can do (phase 10b.1): asked once, the answer
// kept. export/codec-pick.ts decides from it. A test sets the answer
// (setCodecCapsForTests; the e2e reaches it through window.__exporter()).
import { canEncodeAudio, canEncodeVideo } from 'mediabunny'
import type { CodecCaps } from './codec-pick'

let forced: CodecCaps | null = null
let asked: Promise<CodecCaps> | null = null

/** AAC (48 kHz stereo, 128 kbps) and H.264 (1280 × 720) asked of the browser. */
export function codecCaps(): Promise<CodecCaps> {
  if (forced) return Promise.resolve(forced)
  asked ??= (async () => {
    const canAac = await canEncodeAudio('aac', { numberOfChannels: 2, sampleRate: 48000, bitrate: 128_000 }).catch(() => false)
    const canAvc = await canEncodeVideo('avc', { width: 1280, height: 720, bitrate: 5_000_000 }).catch(() => false)
    return { canAac, canAvc }
  })()
  return asked
}

/** Tests only: the encoders this computer is said to have (null: ask it). */
export function setCodecCapsForTests(caps: CodecCaps | null): void {
  forced = caps
  asked = null
}
