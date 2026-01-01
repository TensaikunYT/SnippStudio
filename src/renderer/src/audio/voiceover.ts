// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// Voice-over recording, the pure part (REF-AB, worker S, item 8;
// REF-AB-PLAN-S.md): the samples as 16-bit PCM, the WAV around them, the
// level meter's scale, the countdowns and the length limit. The microphone
// itself is audio/recorder.ts. The tests read this file.

/** The rate the recording is made at: the export's own (no conversion later). */
export const VOICEOVER_RATE = 48000
/** Seconds before the recording starts. */
export const COUNTDOWNS = [0, 3, 5] as const
export type Countdown = (typeof COUNTDOWNS)[number]
/** The longest take (30 minutes: about 173 MB of 16-bit mono in memory). */
export const MAX_TAKE_SECONDS = 30 * 60

/** Float samples (-1..1) as 16-bit integers, clipped. */
export function toInt16(f: Float32Array): Int16Array {
  const out = new Int16Array(f.length)
  for (let i = 0; i < f.length; i++) {
    const v = Math.max(-1, Math.min(1, f[i] || 0))
    out[i] = v < 0 ? Math.round(v * 0x8000) : Math.round(v * 0x7fff)
  }
  return out
}

/** A mono 16-bit PCM WAV of the chunks, in order. */
export function wavOfChunks(chunks: readonly Int16Array[], sampleRate: number): Uint8Array {
  const frames = chunks.reduce((n, c) => n + c.length, 0)
  const data = frames * 2
  const wav = new Uint8Array(44 + data)
  const dv = new DataView(wav.buffer)
  const str = (at: number, s: string): void => {
    for (let i = 0; i < s.length; i++) wav[at + i] = s.charCodeAt(i)
  }
  str(0, 'RIFF')
  dv.setUint32(4, 36 + data, true)
  str(8, 'WAVEfmt ')
  dv.setUint32(16, 16, true)
  dv.setUint16(20, 1, true) // PCM
  dv.setUint16(22, 1, true) // mono
  dv.setUint32(24, sampleRate, true)
  dv.setUint32(28, sampleRate * 2, true)
  dv.setUint16(32, 2, true)
  dv.setUint16(34, 16, true)
  str(36, 'data')
  dv.setUint32(40, data, true)
  let at = 44
  for (const c of chunks) {
    for (let i = 0; i < c.length; i++, at += 2) dv.setInt16(at, c[i], true)
  }
  return wav
}

/** The loudest sample of a block (0..1). */
export function peakOf(f: Float32Array): number {
  let p = 0
  for (let i = 0; i < f.length; i++) {
    const v = Math.abs(f[i])
    if (v > p) p = v
  }
  return Math.min(1, p)
}

/** A peak on the meter: -60 dB at the left end, 0 dB at the right. */
export function meterFraction(peak: number): number {
  if (!(peak > 0)) return 0
  const db = 20 * Math.log10(peak)
  return Math.max(0, Math.min(1, (db + 60) / 60))
}

/** The meter's colour band: quiet, good, too loud (near clipping). */
export function meterZone(peak: number): 'low' | 'ok' | 'hot' {
  const db = peak > 0 ? 20 * Math.log10(peak) : -Infinity
  return db >= -3 ? 'hot' : db >= -30 ? 'ok' : 'low'
}

/** A countdown from what was remembered (anything else is 3). */
export function countdownOf(v: unknown): Countdown {
  const n = Number(v)
  return (COUNTDOWNS as readonly number[]).includes(n) ? (n as Countdown) : 3
}

/** "m:ss" of a take's length. */
export function takeClock(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

/** The script with a new text: put in place of it, or after it (a blank line between). */
export function scriptWith(script: string, text: string, how: 'replace' | 'append'): string {
  const add = text.trim()
  if (how === 'replace' || !script.trim()) return add
  return `${script.replace(/\s+$/, '')}\n\n${add}`
}
