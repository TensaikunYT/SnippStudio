// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// Ask the encoder first (phase Ç3a, decision 2; report R2, R18, R28, R30).
//
// The export used to find out what this computer's video encoder takes only
// at its first frame, after the whole sound had been mixed, through
// mediabunny's own technical message. Now every size × rate × codec ×
// bitrate the export window offers is asked first, twice (the hardware
// encoder, then the software one), and the answer kept: a combination
// neither takes is offered closed, with the reason; one only the software
// encoder takes is said ("slow (software)"). The export takes that answer
// (kept for the session) before it mixes the sound, and encodes with exactly
// the configuration that was asked about (`encoderConfig`): the codec string
// (its H.264 level counting the frame rate), the hardware preference, the
// bitrate, the frame rate. When the graphics card's encoder fails on a
// choice anyway (a driver, another program holding its sessions), the export
// stops and says so, and the session's answer for that choice becomes the
// software encoder (phase Ç3 patch, G-1 / G-5: `markHardwareFailed`).
//
// Pure apart from `probeEncoder`'s default (VideoEncoder.isConfigSupported).
import { fpsLabel } from '../timeline/rates'

export type VideoCodecId = 'avc' | 'vp9'
export type HwPref = 'prefer-hardware' | 'prefer-software'

export interface VideoChoice {
  codec: VideoCodecId
  width: number
  height: number
  /** Frames a second (29.97… for 30000/1001). */
  fps: number
  /** Bits a second. */
  bitrate: number
  /** The software encoder only, never the graphics card's (the export
   *  window's "Encoder: Software", cila E). Unset: the hardware one first. */
  software?: boolean
}

/** What the export window's Encoder field is set to (cila E). */
export type EncoderPref = 'auto' | 'software'

/** A choice as the window and the export ask it: "software" asks the
 *  software encoder only. */
export function videoChoice(codec: VideoCodecId, width: number, height: number, fps: number, bitrate: number, pref: EncoderPref = 'auto'): VideoChoice {
  return { codec, width, height, fps, bitrate, ...(pref === 'software' ? { software: true } : {}) }
}

/**
 * H.264 levels (ITU-T H.264 Table A-1): [level × 10, MaxMBPS (macroblocks a
 * second), MaxFS (macroblocks a frame), MaxBR (kbit/s, Baseline / Main;
 * High allows 1.25×)]. mediabunny chose by frame size and bitrate only, so
 * 1080p60 was asked as level 4.0 (4.2 is needed) and 2160p60 as 5.1 (5.2).
 */
const AVC_LEVELS: [number, number, number, number][] = [
  [10, 1485, 99, 64],
  [11, 3000, 396, 192],
  [12, 6000, 396, 384],
  [13, 11880, 396, 768],
  [20, 11880, 396, 2000],
  [21, 19800, 792, 4000],
  [22, 20250, 1620, 4000],
  [30, 40500, 1620, 10000],
  [31, 108000, 3600, 14000],
  [32, 216000, 5120, 20000],
  [40, 245760, 8192, 20000],
  [41, 245760, 8192, 50000],
  [42, 522240, 8704, 50000],
  [50, 589824, 22080, 135000],
  [51, 983040, 36864, 240000],
  [52, 2073600, 36864, 240000],
  [60, 4177920, 139264, 240000],
  [61, 8355840, 139264, 480000],
  [62, 16711680, 139264, 800000]
]

/** The H.264 (High profile) level for a frame size, rate and bitrate, × 10
 *  (42 for 4.2). Its frame must also fit √(8 × MaxFS) macroblocks a side. */
export function avcLevel(width: number, height: number, fps: number, bitrate: number): number {
  const mbw = Math.ceil(width / 16)
  const mbh = Math.ceil(height / 16)
  const fs = mbw * mbh
  const mbps = fs * fps
  for (const [level, maxMbps, maxFs, maxBr] of AVC_LEVELS) {
    const side = Math.sqrt(8 * maxFs)
    if (fs <= maxFs && mbw <= side && mbh <= side && mbps <= maxMbps + 1e-6 && bitrate <= maxBr * 1250) return level
  }
  return 62
}

/** VP9 levels (VP9 bitstream spec, Annex A): [level × 10, max picture size,
 *  max luma samples a second, max bitrate (kbit/s)]. */
const VP9_LEVELS: [number, number, number, number][] = [
  [10, 36864, 829440, 200],
  [11, 73728, 2764800, 800],
  [20, 122880, 4608000, 1800],
  [21, 245760, 9216000, 3600],
  [30, 552960, 20736000, 7200],
  [31, 983040, 36864000, 12000],
  [40, 2228224, 83558400, 18000],
  [41, 2228224, 160432128, 30000],
  [50, 8912896, 311951360, 60000],
  [51, 8912896, 588251136, 120000],
  [52, 8912896, 1176502272, 180000],
  [60, 35651584, 1176502272, 180000],
  [61, 35651584, 2353004544, 240000],
  [62, 35651584, 4706009088, 480000]
]

export function vp9Level(width: number, height: number, fps: number, bitrate: number): number {
  const size = width * height
  for (const [level, maxSize, maxRate, maxBr] of VP9_LEVELS) if (size <= maxSize && size * fps <= maxRate && bitrate <= maxBr * 1000) return level
  return 62
}

/** The codec string asked for (and encoded with). */
export function videoCodecString(c: VideoChoice): string {
  if (c.codec === 'avc') return `avc1.6400${avcLevel(c.width, c.height, c.fps, c.bitrate).toString(16).padStart(2, '0')}`
  return `vp09.00.${String(vp9Level(c.width, c.height, c.fps, c.bitrate)).padStart(2, '0')}.08`
}

/** The configuration mediabunny hands the encoder for this choice (its
 *  buildVideoEncoderConfig with our codec string, hardware preference and
 *  frame rate): what is asked is what is encoded. */
export function encoderConfig(c: VideoChoice, hw: HwPref): VideoEncoderConfig {
  return {
    codec: videoCodecString(c),
    width: c.width,
    height: c.height,
    bitrate: c.bitrate,
    framerate: c.fps,
    hardwareAcceleration: hw,
    alpha: 'discard',
    ...(c.codec === 'avc' ? { avc: { format: 'avc' as const } } : {})
  }
}

export interface EncoderVerdict {
  /** Some encoder takes it. */
  ok: boolean
  /** Which one: the hardware encoder, or (it refused) the software one. */
  hw: HwPref | null
  /** Why not (ok false), in plain words. */
  why?: string
}

const cache = new Map<string, Promise<EncoderVerdict>>()
/** Choices the graphics card's encoder failed on in this session (phase Ç3
 *  patch, G-1 / G-5): asked of the software encoder only from then on. */
const failedHw = new Set<string>()
const keyOf = (c: VideoChoice): string => `${c.codec}|${c.width}x${c.height}|${c.fps}|${Math.round(c.bitrate)}${c.software ? '|sw' : ''}`

type Asker = (config: VideoEncoderConfig) => Promise<{ supported?: boolean }>
const askBrowser: Asker = (config) => (typeof VideoEncoder === 'undefined' ? Promise.resolve({ supported: false }) : VideoEncoder.isConfigSupported(config))

/** What this computer's encoder says to a choice: the hardware encoder
 *  first, then the software one. Kept for the session (the export takes
 *  the answer the window got; asking again would get the same: the browser
 *  only reads its list). After the hardware encoder failed on the choice,
 *  the software one only. */
export function probeEncoder(c: VideoChoice, ask: Asker = askBrowser): Promise<EncoderVerdict> {
  const key = keyOf(c)
  const hit = ask === askBrowser ? cache.get(key) : undefined
  if (hit) return hit
  // (Software asked for: the graphics card's encoder is not even asked.)
  const tries = c.software || failedHw.has(key) ? (['prefer-software'] as const) : (['prefer-hardware', 'prefer-software'] as const)
  const run = (async (): Promise<EncoderVerdict> => {
    for (const hw of tries) {
      try {
        if ((await ask(encoderConfig(c, hw))).supported) return { ok: true, hw }
      } catch {
        /* the next one */
      }
    }
    return { ok: false, hw: null, why: refusal(c) }
  })()
  if (ask === askBrowser) cache.set(key, run)
  return run
}

export { fpsLabel }

/** Why a choice cannot be exported, in plain words. */
export function refusal(c: VideoChoice): string {
  return `This computer's video encoder does not take ${c.codec === 'avc' ? 'H.264' : 'VP9'} at ${c.width} × ${c.height}, ${fpsLabel(c.fps)} fps, ${(c.bitrate / 1e6).toFixed(1)} Mbps (neither its hardware nor its software encoder)`
}

/** Forget what was asked (a test, or a computer whose drivers changed). */
export function forgetEncoderAnswers(): void {
  cache.clear()
  failedHw.clear()
}

/** The graphics card's encoder failed on this choice (at its setup or while
 *  it encoded): its kept answer goes, and the rest of the session exports
 *  it with the software encoder (no restart inside the export that failed). */
export function markHardwareFailed(c: VideoChoice): void {
  const key = keyOf(c)
  failedHw.add(key)
  cache.delete(key)
}

/** How a render lane's error starts when its hardware encoder failed. */
export const ENCODER_FAULT = '[hardware encoder] '

/** Whether the hardware encoder failed on this choice in this session. */
export function hardwareFailed(c: VideoChoice): boolean {
  return failedHw.has(keyOf(c))
}

/** Whether an error thrown while frames were handed to the encoder (or it
 *  was flushed) is the encoder's own: not a Cancel, not the file refusing to
 *  be written (which comes back through the same calls). */
export function isEncoderFault(err: unknown): boolean {
  const name = (err as { name?: string } | null)?.name ?? ''
  if (name === 'AbortError') return false
  const msg = err instanceof Error ? err.message : String(err)
  if (/\bENOSPC\b|\bEACCES\b|\bEPERM\b|\bEROFS\b|no space left|permission denied|not permitted|remote method 'file:|The disk is full|did not let Snipp write/i.test(msg)) return false
  return true
}
