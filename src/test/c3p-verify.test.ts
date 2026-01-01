// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// Phase Ç3 patch (haritalar/_fazc3-denetim-dayaniklilik.md, R-1 and R-5): the
// written film read back before it is kept. The check reads a bounded part
// of the file (a WebM's whole file used to go back through IPC: 3 GB for a
// 3 GB film), counts the frames for WebM as for MP4, and stops on Cancel.
// The files are muxed here by mediabunny itself from made-up packets (the
// container is what the check reads; nothing is decoded).
import './dom-stub'
import assert from 'node:assert/strict'
import test from 'node:test'
import { BufferTarget, EncodedAudioPacketSource, EncodedPacket, EncodedVideoPacketSource, Mp4OutputFormat, Output, StreamSource, WebMOutputFormat } from 'mediabunny'
import { verifyWritten } from '../renderer/src/export/verify'

const FPS = 30

/** A film of `frames` frames (`written` of them in the file) with sound. */
async function film(kind: 'webm' | 'mp4', frames: number, written = frames, packetBytes = 4000): Promise<Uint8Array> {
  const target = new BufferTarget()
  const out = new Output({ format: kind === 'webm' ? new WebMOutputFormat() : new Mp4OutputFormat({ fastStart: 'in-memory' }), target })
  const v = new EncodedVideoPacketSource(kind === 'webm' ? 'vp9' : 'avc')
  const a = new EncodedAudioPacketSource(kind === 'webm' ? 'opus' : 'aac')
  out.addVideoTrack(v, { frameRate: FPS })
  out.addAudioTrack(a)
  await out.start()
  const data = new Uint8Array(packetBytes).fill(7)
  const vcfg: VideoDecoderConfig =
    kind === 'webm'
      ? { codec: 'vp09.00.10.08', codedWidth: 320, codedHeight: 240 }
      : { codec: 'avc1.42001f', codedWidth: 320, codedHeight: 240, description: new Uint8Array([1, 0x42, 0, 0x1f, 0xff, 0xe1, 0, 4, 0x67, 0x42, 0, 0x1f, 1, 0, 4, 0x68, 0xce, 0x3c, 0x80]) }
  const acfg: AudioDecoderConfig = kind === 'webm' ? { codec: 'opus', numberOfChannels: 2, sampleRate: 48000 } : { codec: 'mp4a.40.2', numberOfChannels: 2, sampleRate: 48000, description: new Uint8Array([0x11, 0x90]) }
  const adur = kind === 'webm' ? 0.02 : 1024 / 48000
  const end = frames / FPS
  let at = 0
  for (let i = 0; i < written; i++) {
    const t = i / FPS
    while (at <= t + 0.5 && at < end) {
      await a.add(new EncodedPacket(new Uint8Array(200).fill(3), 'key', at, adur), at === 0 ? { decoderConfig: acfg } : undefined)
      at += adur
    }
    await v.add(new EncodedPacket(data, i % (2 * FPS) === 0 ? 'key' : 'delta', t, 1 / FPS), i === 0 ? { decoderConfig: vcfg } : undefined)
  }
  while (at < end) {
    await a.add(new EncodedPacket(new Uint8Array(200).fill(3), 'key', at, adur), at === 0 ? { decoderConfig: acfg } : undefined)
    at += adur
  }
  v.close()
  a.close()
  await out.finalize()
  return new Uint8Array(target.buffer!)
}

/** A source over `buf` that counts what is read (as file:stream-read does
 *  through IPC, one call a read). */
function counted(buf: Uint8Array, onRead?: () => void): { source: InstanceType<typeof StreamSource>; bytes: () => number } {
  let bytes = 0
  const source = new StreamSource({
    getSize: async () => buf.length,
    read: async (s, e) => {
      onRead?.()
      bytes += e - s
      return buf.subarray(s, e)
    }
  })
  return { source, bytes: () => bytes }
}

const want = (frames: number) => ({ frames, duration: frames / FPS, fps: FPS, audio: true })

test('R-1: the check reads a bounded part of a WebM (not the whole file), as of an MP4', async () => {
  for (const kind of ['webm', 'mp4'] as const) {
    const short = await film(kind, 900)
    const long = await film(kind, 3600)
    const a = counted(short)
    const b = counted(long)
    assert.equal(await verifyWritten(a.source, want(900)), null, `${kind}: 900 frames found`)
    assert.equal(await verifyWritten(b.source, want(3600)), null, `${kind}: 3600 frames found`)
    // Four times the film, not four times the reading: the head, the index,
    // the last cluster.
    assert.ok(b.bytes() < long.length * 0.1, `${kind}: read ${b.bytes()} of ${long.length} bytes`)
    assert.ok(b.bytes() < a.bytes() * 1.5 + 64 * 1024, `${kind}: ${b.bytes()} read for 3600 frames, ${a.bytes()} for 900`)
  }
})

test('R-5: a written film missing frames is not kept (the check counts them, WebM and MP4)', async () => {
  for (const kind of ['webm', 'mp4'] as const) {
    const cut = await film(kind, 300, 100)
    const why = await verifyWritten(counted(cut).source, want(300))
    assert.ok(why && /100 frames of 300/.test(why), `${kind}: ${why}`)
  }
})

test('R-1: Cancel stops the check, before it or while it reads', async () => {
  const buf = await film('webm', 600)
  const before = new AbortController()
  before.abort()
  await assert.rejects(verifyWritten(counted(buf).source, want(600), before.signal), (e: Error) => e.name === 'AbortError')
  const during = new AbortController()
  let reads = 0
  const src = counted(buf, () => {
    if (++reads === 2) during.abort()
  })
  await assert.rejects(verifyWritten(src.source, want(600), during.signal), (e: Error) => e.name === 'AbortError')
})
