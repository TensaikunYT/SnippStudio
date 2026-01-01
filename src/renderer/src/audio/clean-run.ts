// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// Cleaning a whole recording: its sound decoded twice — once to hear what
// the noise under it is, once to take it out (and soften the esses) — and
// written, as it goes, into a new WAV in the app's own folder. Mono, the
// recording's own sample rate, in step with the original to the sample.

import { audioPresentationOffset, getAudioSink } from '../media/sources'
import { api } from '../platform'
import type { Asset } from '../types'
import { CLEAN_FRAME, framePower, noiseProfile, pcm16, VoiceCleaner, wavHeader, type CleanSettings } from './clean'

export interface CleanedFile {
  path: string
  name: string
  size: number
  url: string
}

const yieldUi = (): Promise<void> => new Promise((r) => setTimeout(r, 0))

/** One channel: the buffer's channels averaged. */
function mono(buf: AudioBuffer): Float32Array {
  const n = buf.numberOfChannels
  if (n === 1) return buf.getChannelData(0)
  const out = new Float32Array(buf.length)
  for (let c = 0; c < n; c++) {
    const d = buf.getChannelData(c)
    for (let i = 0; i < d.length; i++) out[i] += d[i] / n
  }
  return out
}

/**
 * The asset's sound, cleaned, as a new file — or null when its sound can't
 * be read or written. `onProgress` gets 0..1.
 */
export async function cleanRecording(asset: Asset, opts: CleanSettings, onProgress: (k: number) => void): Promise<CleanedFile | null> {
  if (!api?.saveProcessed) return null
  const shift = await audioPresentationOffset(asset)
  const total = Math.max(0, asset.duration)
  // 1) What the noise is: frames from all through the recording.
  const sink1 = await getAudioSink(asset, true)
  if (!sink1) return null
  const frames: Float64Array[] = []
  const acc = new Float32Array(CLEAN_FRAME)
  let fill = 0
  let count = 0
  let sr = 0
  let k = 0
  for await (const w of sink1.buffers(0, total)) {
    sr = sr || w.buffer.sampleRate
    const x = mono(w.buffer)
    for (let i = 0; i < x.length; i++) {
      acc[fill++] = x[i]
      if (fill === CLEAN_FRAME) {
        fill = 0
        // Every eighth frame is plenty to know the noise by.
        if (count++ % 8 === 0 && frames.length < 8000) frames.push(framePower(acc))
      }
    }
    if (++k % 40 === 0) {
      onProgress(0.35 * Math.min(1, (w.timestamp + shift) / Math.max(0.1, total)))
      await yieldUi()
    }
  }
  if (!sr) return null
  const profile = noiseProfile(frames)

  // 2) Cleaned, in step: gaps filled with silence, overlaps skipped.
  const sink2 = await getAudioSink(asset, true)
  if (!sink2) return null
  const cleaner = new VoiceCleaner(sr, profile, opts)
  const id = Array.from({ length: 20 }, () => 'abcdefghijklmnopqrstuvwxyz0123456789'[Math.floor(Math.random() * 36)]).join('')
  const name = `${asset.name.replace(/\.[^.]+$/, '')} (cleaned)`
  const want = Math.round(total * sr)
  let given = 0
  let made = 0
  let first = true
  let pending: Uint8Array[] = [wavHeader(sr, 1, 0)]
  let pendingBytes = 44
  const send = async (last: boolean): Promise<CleanedFile | null> => {
    const chunk = new Uint8Array(pendingBytes)
    let o = 0
    for (const p of pending) {
      chunk.set(p, o)
      o += p.length
    }
    pending = []
    pendingBytes = 0
    const res = await api!.saveProcessed({ id, chunk: chunk.buffer, first, last, name })
    first = false
    if (!res) throw new Error('could not write the cleaned file')
    return last && 'path' in res ? res : null
  }
  const out = async (y: Float32Array): Promise<void> => {
    if (!y.length) return
    const room = Math.max(0, want - made)
    const take = y.length > room ? y.subarray(0, room) : y
    made += take.length
    const b = pcm16(take)
    pending.push(b)
    pendingBytes += b.length
    if (pendingBytes >= 4 * 1024 * 1024) await send(false)
  }
  k = 0
  for await (const w of sink2.buffers(0, total)) {
    const at = Math.round((w.timestamp + shift) * sr)
    let x = mono(w.buffer)
    if (at > given) {
      // A gap in the stream: silence, so everything after stays in step.
      const gap = Math.min(at - given, want - given)
      if (gap > 0) {
        await out(cleaner.push(new Float32Array(gap)))
        given += gap
      }
    } else if (at < given) x = x.subarray(Math.min(x.length, given - at))
    if (given + x.length > want) x = x.subarray(0, Math.max(0, want - given))
    if (!x.length) continue
    await out(cleaner.push(x))
    given += x.length
    if (++k % 30 === 0) {
      onProgress(0.35 + 0.65 * Math.min(1, given / Math.max(1, want)))
      await yieldUi()
    }
  }
  if (given < want) {
    await out(cleaner.push(new Float32Array(want - given)))
    given = want
  }
  await out(cleaner.flush(want, made))
  onProgress(1)
  return send(true)
}
