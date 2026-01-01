// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
import { AudioBufferSource, BufferTarget, CanvasSource, Mp4OutputFormat, Output, WebMOutputFormat } from 'mediabunny'
import { codecCaps } from '../export/codec-caps'
import { pickProxyCodecs } from '../export/codec-pick'
import type { Asset } from '../types'
import { getAudioSink, getVideoSink, proxyUrls } from './sources'

/**
 * Generates a 640-wide preview proxy of a video asset (video only, original
 * timestamps, ~1.5 Mbps) and registers it for playback. Export always keeps
 * using the original file.
 */
export async function generateProxy(asset: Asset, onProgress: (f: number) => void): Promise<void> {
  // A video with alpha gets no proxy (phase 5b, decision 4): an H.264 proxy
  // has none, and the preview would show it on black. It plays from itself.
  if (asset.kind !== 'video' || proxyUrls.has(asset.id) || asset.alpha) return
  const sink = await getVideoSink(asset, 640, { original: true })
  if (!sink) throw new Error('No video track found.')
  const w = 640
  const h = Math.max(2, Math.round(((asset.height || 360) * (w / (asset.width || 640))) / 2) * 2)
  const canvas = new OffscreenCanvas(w, h)
  const ctx = canvas.getContext('2d', { alpha: false })!
  const target = new BufferTarget()
  // H.264 + AAC in MP4 as before; VP9 + Opus in WebM on a computer without
  // one of them (desktop Linux; phase 10b.1).
  const pick = pickProxyCodecs(await codecCaps())
  const output = new Output({ format: pick.container === 'mp4' ? new Mp4OutputFormat({ fastStart: 'in-memory' }) : new WebMOutputFormat(), target })
  const vs = new CanvasSource(canvas, { codec: pick.video, bitrate: 1_500_000 })
  output.addVideoTrack(vs, { frameRate: 30 })
  // Keep the sound in the proxy so preview audio still works.
  let as: AudioBufferSource | null = null
  const audioSink = asset.hasAudio ? await getAudioSink(asset) : null
  if (audioSink) {
    as = new AudioBufferSource({ codec: pick.audio, bitrate: 96000 })
    output.addAudioTrack(as)
  }
  await output.start()
  try {
    if (as && audioSink) {
      for await (const wrapped of audioSink.buffers(0, asset.duration)) {
        await as.add(wrapped.buffer)
      }
      as.close()
    }
    let last = 0
    for await (const wrapped of sink.canvases(0, asset.duration)) {
      ctx.drawImage(wrapped.canvas, 0, 0, w, h)
      const dur = Math.max(1 / 60, wrapped.duration || wrapped.timestamp - last || 1 / 30)
      await vs.add(wrapped.timestamp, dur)
      last = wrapped.timestamp
      onProgress(Math.min(1, wrapped.timestamp / Math.max(0.1, asset.duration)))
    }
    vs.close()
    await output.finalize()
  } catch (err) {
    await output.cancel().catch(() => {})
    throw err
  }
  const buffer = target.buffer
  if (!buffer) throw new Error('Proxy encode produced no data.')
  proxyUrls.set(asset.id, URL.createObjectURL(new Blob([buffer], { type: pick.container === 'mp4' ? 'video/mp4' : 'video/webm' })))
}
