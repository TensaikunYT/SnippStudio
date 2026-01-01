// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
import { ALL_FORMATS, AudioBufferSink, BlobSource, CanvasSink, EncodedPacketSink, Input, UrlSource } from 'mediabunny'
import { browserFiles } from '../platform'
import type { Asset } from '../types'

/**
 * Cache of demuxer inputs per asset. `media://` URLs (Electron) support Range
 * requests, so UrlSource reads only what it needs; in browser-fallback mode
 * we hold the picked File and use BlobSource.
 */
const inputs = new Map<string, Input>()

export function getInput(asset: Asset): Input {
  let input = inputs.get(asset.id)
  if (!input) {
    const file = browserFiles.get(asset.id)
    input = new Input({
      formats: ALL_FORMATS,
      source: file ? new BlobSource(file) : new UrlSource(asset.url)
    })
    inputs.set(asset.id, input)
  }
  return input
}

export function dropInput(assetId: string): void {
  inputs.delete(assetId)
  audioInputs.delete(assetId)
  proxyInputs.delete(assetId)
  // A proxy is of the file the id pointed at: a relink points it at another
  // (phase Ç2a.2, report P12: the preview showed the old file's proxy while
  // the export read the new file).
  dropProxy(assetId)
  // Relinking points the id at a DIFFERENT file, which has its own offset.
  videoOffsets.delete(assetId)
}

/**
 * A SEPARATE demuxer input per asset, used only for audio extraction (mixing,
 * transcription). The preview's paused-frame decoder reads the shared video
 * Input concurrently; a mediabunny Input isn't safe to iterate from a video
 * sink and an audio sink at the same time, which deadlocked the first
 * "Extracting audio…" while the preview was still decoding. Decoupling the
 * audio onto its own Input removes that contention.
 */
const audioInputs = new Map<string, Input>()
function createAudioInput(asset: Asset): Input {
  const file = browserFiles.get(asset.id)
  return new Input({
    formats: ALL_FORMATS,
    source: file ? new BlobSource(file) : new UrlSource(asset.url)
  })
}
function getAudioInput(asset: Asset): Input {
  let input = audioInputs.get(asset.id)
  if (!input) {
    input = createAudioInput(asset)
    audioInputs.set(asset.id, input)
  }
  return input
}

// ---------------------------------------------------------------------------
// Proxies: low-res preview copies of heavy videos. Preview uses them when
// enabled; EXPORT always uses the originals.
// ---------------------------------------------------------------------------
export const proxyUrls = new Map<string, string>()
/** Lets go of an asset's proxy (its memory too). */
function dropProxy(assetId: string): void {
  const url = proxyUrls.get(assetId)
  if (url === undefined) return
  proxyUrls.delete(assetId)
  try {
    URL.revokeObjectURL(url)
  } catch {
    /* not a blob URL */
  }
}
/** Another project: every decoder and proxy of the last one goes (report
 *  P12: whole MP4s held in memory were never freed on a project switch). */
export function releaseAllMedia(): void {
  for (const id of [...proxyUrls.keys()]) dropProxy(id)
  inputs.clear()
  audioInputs.clear()
  proxyInputs.clear()
  videoOffsets.clear()
}
let proxyMode = false
export function setProxyMode(on: boolean): void {
  proxyMode = on
}
export function proxyModeOn(): boolean {
  return proxyMode
}
/** The URL playback should use right now (proxy when enabled + available). */
export function playbackUrlFor(asset: Asset): string {
  return proxyMode && proxyUrls.has(asset.id) ? proxyUrls.get(asset.id)! : asset.url
}

const proxyInputs = new Map<string, Input>()
function getProxyInput(asset: Asset): Input {
  let input = proxyInputs.get(asset.id)
  if (!input) {
    input = new Input({ formats: ALL_FORMATS, source: new UrlSource(proxyUrls.get(asset.id)!) })
    proxyInputs.set(asset.id, input)
  }
  return input
}

export async function getVideoSink(
  asset: Asset,
  width?: number,
  opts?: { original?: boolean }
): Promise<CanvasSink | null> {
  const useProxy = !opts?.original && proxyMode && proxyUrls.has(asset.id)
  const input = useProxy ? getProxyInput(asset) : getInput(asset)
  const track = await input.getPrimaryVideoTrack()
  if (!track) return null
  // A video with alpha is decoded with it (phase 5b, decision 4, step a:
  // mediabunny decodes VP9's alpha side data); every other one as before.
  const extra = asset.alpha === true ? { alpha: true } : {}
  return new CanvasSink(track, width ? { width, poolSize: 2, ...extra } : { poolSize: 2, ...extra })
}

/**
 * Where the VIDEO track's own timestamps sit relative to presentation time
 * zero, in seconds.
 *
 * A media element defines time 0 as the first frame you are meant to see. The
 * decoder does not: it hands over the track's raw timestamps, which a container
 * can offset — an edit list, a track that starts late, B-frame composition
 * offsets. On such a file `sink.getCanvas(t)` and `element.currentTime = t` are
 * NOT the same moment, and the gap is whole seconds on some recordings.
 *
 * That gap is why a trim handle could show a frame from a second or two before
 * the cut: the handle reads the decoder while playback reads the element. The
 * export reads the decoder too, so it was shifted by the same amount — the one
 * thing that must never differ between preview and export.
 *
 * Everything that talks to the decoder in ELEMENT time adds this. Files with no
 * offset get 0 and are untouched.
 */
const videoOffsets = new Map<string, Promise<number>>()
export function videoPresentationOffset(asset: Asset): Promise<number> {
  // Measured (2026-10-16, Electron 43): the <video> element's time IS the
  // container's own timestamps, the decoder's too — for MP4, WebM and MKV
  // whose streams start late (an MP4 with both streams from 1 s, one with
  // the picture 1 s after the sound, a WebM from 1 s, an MKV from 0.022 s).
  // Shifting the decoder by the video track's first timestamp moved the
  // exported picture that far ahead of its sound (1 s in the first three, a
  // frame in the last), and the paused preview's frames off the playing ones.
  // So nothing is shifted; kept as a function for its callers.
  let p = videoOffsets.get(asset.id)
  if (!p) {
    p = Promise.resolve(0)
    videoOffsets.set(asset.id, p)
  }
  return p
}

/**
 * When the video's last frame starts, in the decoder's time (null: no video
 * track, or it could not be read). A freeze on the last frame or a reversed
 * clip starting at the end reads it there (phase Ç3a, decision 7; report
 * R27: they were held 50 ms before the end, three frames at 60 fps).
 */
const lastFrames = new Map<string, Promise<number | null>>()
export function lastVideoFrameTime(asset: Asset): Promise<number | null> {
  const key = `${asset.id}|${asset.url}`
  let p = lastFrames.get(key)
  if (!p) {
    p = (async () => {
      try {
        const track = await getInput(asset).getPrimaryVideoTrack()
        if (!track) return null
        const last = await new EncodedPacketSink(track).getPacket(Infinity, { metadataOnly: true })
        return last ? last.timestamp : null
      } catch {
        return null
      }
    })()
    lastFrames.set(key, p)
  }
  return p
}

export async function getAudioSink(asset: Asset, isolated = false): Promise<AudioBufferSink | null> {
  // Own Input (see getAudioInput) so audio extraction never contends with the
  // preview's video decoder on the same demuxer. Long-running waveform and
  // silence scans need separate inputs from EACH OTHER as well: two active
  // sink iterators on one input can steal reads or stall one another.
  const track = await (isolated ? createAudioInput(asset) : getAudioInput(asset)).getPrimaryAudioTrack()
  if (!track) return null
  return new AudioBufferSink(track)
}

/**
 * How far the audio track's raw timestamps sit BEFORE presentation time zero,
 * as a positive number of seconds (0 when there is no such offset).
 *
 * Compressed formats carry priming samples the decoder must chew through before
 * real audio comes out, and containers express that as a negative first
 * timestamp. A media element hides it — playback starts at the first sample you
 * are meant to hear — but the decoder hands those packets over with their raw
 * timestamps, so anything drawn from them (the waveform) sits shifted against
 * what you hear by exactly that much. Only negative offsets are compensated: a
 * track that genuinely starts late really is preceded by silence.
 */
export async function audioPresentationOffset(asset: Asset): Promise<number> {
  try {
    const track = await getAudioInput(asset).getPrimaryAudioTrack()
    if (!track) return 0
    const first = await track.getFirstTimestamp()
    return Number.isFinite(first) && first < 0 ? -first : 0
  } catch {
    return 0
  }
}
