// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
import { api, browserFiles, pickFilesBrowser } from '../platform'
import type { CodeFilmInfo, ImportedFile } from '../../../preload/index'
import type { Asset, AssetKind } from '../types'
import { uid } from '../types'
import { dropInput, getInput, getVideoSink } from './sources'
import { snapFps } from '../timeline/rates'
import { hdrOf } from './hdr'
import { t } from '../ui/strings'
import { drawChecker } from './checker'
import { PRODUCT_NAME } from '../../../shared/product'

const VIDEO_EXT = /\.(mp4|mov|webm|mkv|avi|m4v)$/i
const AUDIO_EXT = /\.(mp3|wav|m4a|aac|ogg|flac|opus)$/i
const IMAGE_EXT = /\.(png|jpe?g|webp|gif|bmp|avif)$/i

/** ProRes 4444 / 4444 XQ (sample entry `ap4h` / `ap4x`), the ProRes kinds
 *  that carry alpha. */
export function isProRes4444(codec: string | null | undefined, param: string | null | undefined): boolean {
  return codec === 'prores' && /^ap4[hx]/i.test(String(param ?? ''))
}

export function kindOfName(name: string): AssetKind | null {
  if (VIDEO_EXT.test(name)) return 'video'
  if (AUDIO_EXT.test(name)) return 'audio'
  if (IMAGE_EXT.test(name)) return 'image'
  return null
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    // media:// is another origin; without this the image taints canvases.
    img.crossOrigin = 'anonymous'
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('Could not load image'))
    img.src = url
  })
}

function makeThumb(source: CanvasImageSource, sw: number, sh: number, checker = false): string {
  const w = 160
  const h = Math.max(2, Math.round((w * sh) / Math.max(1, sw)))
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')!
  // A picture with alpha: a checker under it (a JPEG keeps none; phase 5b).
  if (checker) drawChecker(ctx, 0, 0, w, h)
  ctx.drawImage(source, 0, 0, w, h)
  return canvas.toDataURL('image/jpeg', 0.7)
}

/** Why a probed file is refused although its name is media (phase 11b,
 *  KF1 / KF2), in English (`ui/errors.ts` says it in the user's language);
 *  null: it comes in. An empty file is said as such (it read as an HTTP
 *  "416" of the media protocol); a video or sound file with no track or no
 *  length (a cut-off MP4 without its index) is unreadable — it came in as a
 *  sound of 0 s, "imported", and put a 0 s clip on the timeline. */
export function probeRefusal(f: { size: number; kind: AssetKind; duration?: number; tracks?: number }): string | null {
  if (f.size === 0) return 'The file is empty.'
  if (f.kind === 'image') return null
  if (f.tracks === 0 || !(typeof f.duration === 'number' && Number.isFinite(f.duration) && f.duration > 0)) return 'Input has an unsupported or unrecognizable format.'
  return null
}

async function probe(
  base: { url: string; name: string; path?: string; size: number; mtime?: number },
  id: string
): Promise<Asset | null> {
  const kind = kindOfName(base.name)
  if (!kind) return null
  if (base.size === 0) throw new Error(probeRefusal({ size: 0, kind })!)
  const asset: Asset = {
    id,
    kind,
    name: base.name,
    path: base.path,
    url: base.url,
    size: base.size,
    // The file's fingerprint (phase Ç2a.2, decision 2).
    ...(typeof base.mtime === 'number' ? { mtime: base.mtime } : {}),
    duration: 0,
    width: 0,
    height: 0,
    hasAudio: kind === 'audio'
  }

  if (kind === 'image') {
    const img = await loadImage(base.url)
    asset.width = img.naturalWidth
    asset.height = img.naturalHeight
    asset.thumbnail = makeThumb(img, img.naturalWidth, img.naturalHeight)
    return asset
  }

  // Video/audio: probe container with mediabunny for reliable metadata.
  const input = getInput(asset)
  asset.duration = await input.computeDuration()
  const videoTrack = await input.getPrimaryVideoTrack()
  const audioTrack = await input.getPrimaryAudioTrack()
  asset.hasAudio = audioTrack !== null
  const refused = probeRefusal({ size: base.size, kind, duration: asset.duration, tracks: (videoTrack ? 1 : 0) + (audioTrack ? 1 : 0) })
  if (refused) throw new Error(refused)
  if (videoTrack) {
    // ProRes 4444 (with or without its alpha) is not supported (phase 5b,
    // decision 5): refused here, said plainly, not let in as a black clip.
    if (isProRes4444(videoTrack.codec, await videoTrack.getCodecParameterString().catch(() => null))) throw new Error(t('media.prores4444'))
    asset.width = videoTrack.displayWidth
    asset.height = videoTrack.displayHeight
    // Alpha (phase 5b, decision 4): a VP9 WebM with an alpha channel is
    // decoded with it.
    if (await videoTrack.canBeTransparent().catch(() => false)) asset.alpha = true
    // Its frame rate (phase Ç3a, decision 4): packets a second over the first
    // few seconds, snapped to the rate it means (29.97 is 30000/1001).
    // Decodable on this computer? Said in the media panel (phase Ç3a,
    // decision 6); the export refuses it with the same check.
    if (!(await videoTrack.canDecode().catch(() => true))) asset.undecodable = true
    // HDR (phase Ç3b, decision 7): badged, said before the export.
    const hdr = hdrOf(await videoTrack.getColorSpace().catch(() => null))
    if (hdr) asset.hdr = hdr
    try {
      const stats = await videoTrack.computePacketStats(120)
      if (stats.averagePacketRate > 0) asset.fps = snapFps(stats.averagePacketRate)
    } catch {
      /* unknown: the project keeps its rate */
    }
    // (No poster for one this computer cannot decode: it came in with the
    // decoder's message and no file at all.)
    if (!asset.undecodable) {
      const sink = await getVideoSink(asset, 160)
      const wrapped = await sink?.getCanvas(Math.min(0.5, asset.duration / 2))
      if (wrapped) asset.thumbnail = makeThumb(wrapped.canvas, wrapped.canvas.width, wrapped.canvas.height, !!asset.alpha)
    }
  } else if (kind === 'video') {
    // Extension said video but the file has no video track: treat as audio.
    asset.kind = 'audio'
  }
  return asset
}

/** Reads one file as media without adding it anywhere (a relink, a file
 *  changed on disk: phase Ç2a.2): its kind, duration, size, picture size and
 *  sound, and a poster. Null: not a media file. */
export async function probeMedia(base: { url: string; name: string; path?: string; size: number; mtime?: number }): Promise<Asset | null> {
  const id = `probe-${uid()}`
  try {
    return await probe(base, id)
  } finally {
    dropInput(id)
  }
}

/**
 * Builds a horizontal filmstrip: N frames sampled evenly across the whole
 * asset, drawn edge-to-edge into one wide image. The timeline clip maps its
 * own media range onto this strip, so trimming reveals different frames
 * instead of the old single tiled thumbnail. Runs after import (non-blocking).
 */
export async function computeFilmstrip(
  asset: Asset,
  update: (id: string, patch: Partial<Asset>) => void
): Promise<void> {
  if (asset.kind !== 'video' || asset.duration <= 0) return
  try {
    // Already analysed this exact file before? Restore instantly — decoding a
    // few dozen frames again would be pure repeat work.
    if (api && asset.path) {
      const cached = await api.analysisGet(asset.path, 'strip').catch(() => null)
      if (cached && cached.byteLength > 0) {
        const text = new TextDecoder().decode(cached)
        const sep = text.indexOf('|')
        const cols = Number(text.slice(0, sep))
        const dataUrl = text.slice(sep + 1)
        if (cols > 0 && dataUrl.startsWith('data:')) {
          update(asset.id, { filmstrip: dataUrl, filmstripCols: cols })
          return
        }
      }
    }
    // The strip is stretched across the asset's whole duration, so more frames
    // means less horizontal stretch. Capped because each one costs a seek.
    const cols = Math.max(8, Math.min(48, Math.round(asset.duration / 2)))
    const cellW = 96
    const cellH = 54
    const strip = document.createElement('canvas')
    strip.width = cellW * cols
    strip.height = cellH
    const ctx = strip.getContext('2d')!

    const publish = (): void =>
      update(asset.id, { filmstrip: strip.toDataURL('image/jpeg', 0.55), filmstripCols: cols })

    // 1) Fill every cell with the poster frame we ALREADY have and publish at
    //    once. Decoding all the frames takes seconds; waiting for that left the
    //    clip blank right after it was dropped, which is what made the timeline
    //    feel slow. Now something correct-shaped is there immediately and the
    //    real frames replace it as they arrive.
    if (asset.thumbnail) {
      const poster = new Image()
      poster.src = asset.thumbnail
      await poster.decode().catch(() => {})
      if (poster.complete && poster.naturalWidth > 0) {
        const scale = Math.max(cellW / poster.naturalWidth, cellH / poster.naturalHeight)
        const dw = poster.naturalWidth * scale
        const dh = poster.naturalHeight * scale
        for (let i = 0; i < cols; i++) {
          ctx.drawImage(poster, (cellW - dw) / 2 + i * cellW, (cellH - dh) / 2, dw, dh)
        }
        publish()
      }
    }

    const sink = await getVideoSink(asset, cellW)
    if (!sink) return

    // 2) Decode in a coarse-to-fine order (halves, then quarters, …) so the
    //    strip becomes representative early instead of only being right once the
    //    left-to-right pass reaches the end.
    const order: number[] = []
    for (let step = cols; step >= 1; step = Math.floor(step / 2)) {
      for (let i = 0; i < cols; i += step) if (!order.includes(i)) order.push(i)
      if (step === 1) break
    }
    for (let i = 0; i < cols; i++) if (!order.includes(i)) order.push(i)

    let lastPublish = performance.now()
    for (const i of order) {
      const t = ((i + 0.5) / cols) * asset.duration
      const wrapped = await sink.getCanvas(Math.max(0, Math.min(asset.duration - 0.05, t))).catch(() => null)
      if (!wrapped) continue
      const fw = wrapped.canvas.width
      const fh = wrapped.canvas.height
      const scale = Math.max(cellW / fw, cellH / fh)
      const dw = fw * scale
      const dh = fh * scale
      // (A video with alpha: a checker under its cell; phase 5b.)
      if (asset.alpha) drawChecker(ctx, i * cellW, 0, cellW, cellH)
      ctx.drawImage(wrapped.canvas, (cellW - dw) / 2 + i * cellW, (cellH - dh) / 2, dw, dh)
      // Re-encoding the whole strip is not free, so refresh a few times a
      // second rather than after every frame.
      if (performance.now() - lastPublish > 350) {
        lastPublish = performance.now()
        publish()
      }
    }
    publish()
    // Keep it for next time (cheap: one small JPEG per file).
    if (api && asset.path) {
      const payload = `${cols}|${strip.toDataURL('image/jpeg', 0.55)}`
      void api.analysisPut(asset.path, 'strip', new TextEncoder().encode(payload)).catch(() => {})
    }
  } catch {
    /* non-fatal: the plain thumbnail still shows */
  }
}

export interface ImportResult {
  assets: Asset[]
  errors: string[]
}

interface ImportBase {
  url: string
  name: string
  path?: string
  size: number
  mtime?: number
  file?: File
  /** Folder this came from, when imported as a folder — the bin groups by it. */
  folder?: string
}

/** Opens the platform file picker and probes everything selected. */
export async function importMediaFiles(): Promise<ImportResult> {
  const bases: ImportBase[] = []
  if (api) {
    const files = await api.openMediaDialog()
    for (const f of files) bases.push({ url: f.url, name: f.name, path: f.path, size: f.size, mtime: f.mtime })
  } else {
    const files = await pickFilesBrowser('video/*,audio/*,image/*', true)
    for (const f of files) bases.push({ url: URL.createObjectURL(f), name: f.name, size: f.size, file: f })
  }
  return importBases(bases)
}

/** Files the main process wrote and allowed (the sample project's clips,
 *  phase 9b), probed as an import. */
export async function importWrittenFiles(files: readonly ImportedFile[]): Promise<ImportResult> {
  return importBases(files.map((f) => ({ url: f.url, name: f.name, path: f.path, size: f.size, mtime: f.mtime })))
}

/** Probe a previously user-picked sound from Snipp's persistent local library. */
export async function importLibrarySound(file: ImportedFile): Promise<ImportResult> {
  if (kindOfName(file.name) !== 'audio') return { assets: [], errors: [`${file.name}: not an audio file`] }
  return importBases([{ url: file.url, name: file.name, path: file.path, size: file.size, mtime: file.mtime }])
}

/** Picks and probes one still image without adding it to the project yet. */
export async function importReplacementImage(): Promise<ImportResult> {
  const bases: ImportBase[] = []
  if (api) {
    const file = await api.openImageDialog()
    if (file) bases.push({ url: file.url, name: file.name, path: file.path, size: file.size, mtime: file.mtime })
  } else {
    const file = (await pickFilesBrowser('image/*', false))[0]
    if (file) bases.push({ url: URL.createObjectURL(file), name: file.name, size: file.size, file })
  }
  return importBases(bases)
}

/** A code film folder (main registered it) as assets: the film itself
 *  (kind 'code') and its sound, audio/mix.wav, probed as any audio file. */
export async function codeFilmImport(info: CodeFilmInfo): Promise<ImportResult> {
  const errors: string[] = []
  let mix: Asset | undefined
  if (info.mix) {
    const r = await importBases([{ url: info.mix.url, name: `${info.name} mix.wav`, path: info.mix.path, size: info.mix.size, folder: info.name }])
    mix = r.assets[0]
    errors.push(...r.errors)
  }
  // (No audio/mix.wav: a silent film, which is normal; nothing to warn of.
  // Interface audit G13.)
  const code: Asset = {
    id: uid(),
    kind: 'code',
    name: info.name,
    path: info.root,
    url: info.url,
    size: 0,
    // Known for sure once its page runs (media/codefilm.ts corrects these).
    // A page that says nothing and has no mix: 10 s (phase 5c, decision 6:
    // a dropped folder; the page's own length replaces it once it runs).
    duration: info.meta.duration ?? mix?.duration ?? 10,
    width: 1920,
    height: 1080,
    // Its sound is its own clip (the mix, linked under it): this asset is
    // never read for sound.
    hasAudio: false,
    folder: info.name,
    code: { fps: info.meta.fps ?? 60, ...(mix ? { mixAssetId: mix.id } : {}) }
  }
  return { assets: mix ? [code, mix] : [code], errors }
}

/** The folder dialog for a code film (a folder with an index.html). */
export async function importCodeFilm(): Promise<ImportResult | null> {
  if (!api) return { assets: [], errors: [`Code films need the ${PRODUCT_NAME} app (not the browser preview).`] }
  const info = await api.codeFilm.pick()
  return info ? codeFilmImport(info) : null
}

/** Imports files — or whole folders — dropped onto the editor window. */
export async function importDroppedFiles(files: File[]): Promise<ImportResult> {
  const bases: ImportBase[] = []
  const errors: string[] = []
  const films: Asset[] = []
  for (const f of files) {
    if (api) {
      const p = api.getPathForFile(f)
      if (!p) {
        errors.push(`${f.name}: unsupported or unreadable file`)
        continue
      }
      // A film folder (an index.html at its root) comes in as a code film.
      const film = await api.codeFilm.registerDropped(f).catch(() => null)
      if (film) {
        const r = await codeFilmImport(film)
        films.push(...r.assets)
        errors.push(...r.errors)
        continue
      }
      // A drop can be a folder. Ask first: main returns null for anything that
      // isn't a directory, so a normal file falls straight through.
      const dir = await api.registerDroppedFolder(f).catch(() => null)
      if (dir) {
        if (dir.files.length === 0) errors.push(`${dir.folder}: no media in that folder`)
        for (const file of dir.files) {
          bases.push({ url: file.url, name: file.name, path: file.path, size: file.size, mtime: file.mtime, folder: dir.folder })
        }
        continue
      }
      const reg = await api.registerDroppedMedia(f)
      if (reg) bases.push({ url: reg.url, name: reg.name, path: reg.path, size: reg.size, mtime: reg.mtime })
      else errors.push(`${f.name}: unsupported or unreadable file`)
    } else {
      bases.push({ url: URL.createObjectURL(f), name: f.name, size: f.size, file: f })
    }
  }
  const result = await importBases(bases)
  result.assets.unshift(...films)
  result.errors.unshift(...errors)
  return result
}

async function importBases(bases: ImportBase[]): Promise<ImportResult> {
  const assets: Asset[] = []
  const errors: string[] = []
  for (const base of bases) {
    try {
      // Register the File before probing so mediabunny can use BlobSource.
      const id = uid()
      if (base.file) browserFiles.set(id, base.file)
      const asset = await probe(base, id)
      if (!asset) {
        if (base.file) browserFiles.delete(id)
        errors.push(`${base.name}: unsupported file type`)
        continue
      }
      if (base.folder) asset.folder = base.folder
      assets.push(asset)
    } catch (err) {
      errors.push(`${base.name}: ${err instanceof Error ? err.message : String(err)}`)
    }
  }
  return { assets, errors }
}
