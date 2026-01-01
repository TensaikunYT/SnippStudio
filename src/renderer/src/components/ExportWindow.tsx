// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// The export window (phase Ç3b, decision 9): one window for a video, its
// sound alone and a still frame, made of the building blocks (ui/) with its
// words in t(). Presets YouTube 1080p, YouTube 4K and Shorts / Reels set the
// size, rate, quality and loudness; any change after makes it Custom. The
// range is the in and out points (I / O on the timeline; export/marks.ts),
// else two cut marks, else the whole film. Choices this computer cannot
// encode are closed, the reason on their tip (encoder.ts). It replaced
// Ç3a's still-frame dialog and the old Export settings dialog.
//
// DENEME-4, worker W: the outputs are ticks (video, sound alone, this frame:
// one or more, made one after another into the same folder under the same
// name, export/outputs.ts); the settings on the left, each output's under
// its own tick; on the right what will be written, the check's one line
// (Preflight.tsx) and what stops the export, red and first.
import { useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import { Button, Checkbox, Dialog, Field, Icon, NumberField, Segmented, Select, Toggle, Tooltip, useT, type SegmentOption, type SelectOption } from '../ui'
import { PreflightList } from './Preflight'
import { type ExportSettings, stillSize, type StillSize } from '../export/exporter'
import { EXPORT_FORMATS, formatOf, safeFileName, type ExportContainer } from '../export/formats'
import { chosenOutputs, outputPaths, runOutputs, type OutputKind } from '../export/outputs'
import { api } from '../platform'
import { CUSTOM_MBPS_MAX, CUSTOM_MBPS_MIN, customMbpsAtStart, QUALITY_HIGH_FACTOR, QUALITY_MAXIMUM, QUALITY_STANDARD, normalizeByDefault, outSize, resolutionChoices, scaleForLines, startPresetOf, videoBitrateOf, youtubePresetHolds } from '../export/quality'
import { fpsLabel, probeEncoder, videoChoice, type EncoderPref, type EncoderVerdict, type VideoChoice } from '../export/encoder'
import { codeFilmsEnlarged, hdrShown } from '../export/preflight'
import { exportMarks, markedRange, setExportMark, subscribeExportMarks } from '../export/marks'
import { saveStillFrame } from '../export/still-save'
import { sizeLabel } from '../export/verify'
import { fmtNum, fmtTime, localNum } from '../ui/format'
import { FRAME_RATES } from '../timeline/rates'
import { projectDuration, type ShortSegment } from '../types'
import { useStore } from '../state/store'
import { codeFilms } from '../media/codefilm'
import { codecCaps } from '../export/codec-caps'
import { pickExportFormat, type CodecCaps, type CodecReason } from '../export/codec-pick'
import { GIF_LARGE_BYTES, GIF_LONG_SEC, GIF_RATE_DEFAULT, GIF_RATES, GIF_WIDTH_DEFAULT, gifEstimate, gifSize, gifWidths } from '../export/gif'
import './export/export.css'
import { CoverPick, NamePlace, useCoverOn, useExportPlace } from './export/ExportPlace'
import { cleanStem, stemProblem } from '../../../shared/export-place'
import { stemOf } from '../export/outputs'
import { confirmDialog } from '../ui/confirm'
import { notify, t as say } from '../ui'

export type ExportKind = 'video' | 'sound' | 'frame'
export type ExportPreset = 'yt1080' | 'yt4k' | 'shorts' | 'custom'

interface Request {
  kind: ExportKind
  segments?: ShortSegment[]
  stamp: number
}

let request: Request | null = null
const listeners = new Set<() => void>()
const emit = (): void => {
  for (const fn of [...listeners]) fn()
}
const subscribe = (fn: () => void): (() => void) => {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

/** Opens the window (Export, File → This frame, the camera button, a Short's
 *  export): on its video, sound or frame part. */
export function openExportWindow(kind: ExportKind = 'video', segments?: ShortSegment[]): void {
  const ex = useStore.getState().exportStatus
  if (ex && !ex.done) return // one export at a time
  request = { kind, segments, stamp: Date.now() }
  emit()
}

export function closeExportWindow(): void {
  request = null
  emit()
}

const PRESET_KEY = 'snipp-export-preset'
const YOUTUBE_KEY = 'snipp-export-youtube'
/** The last bitrate typed by hand (Mb/s; 0: a quality choice). */
const MBPS_KEY = 'snipp-export-mbps'
const remembered = (key: string): string | null => {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}
const remember = (key: string, v: string): void => {
  try {
    localStorage.setItem(key, v)
  } catch {
    /* not kept */
  }
}

/** A video or its sound alone: `path`, its file already chosen (several
 *  outputs in one run); resolves true when the file is in place. */
type OnVideo = (s: ExportSettings, path?: string) => Promise<boolean> | void

export function ExportWindow({ onVideo, onSegments }: { onVideo: OnVideo; onSegments: (segments: ShortSegment[], s: ExportSettings) => void }): JSX.Element | null {
  const req = useSyncExternalStore(subscribe, () => request, () => request)
  if (!req) return null
  return <ExportBody key={req.stamp} req={req} onVideo={onVideo} onSegments={onSegments} />
}

function ExportBody({ req, onVideo, onSegments }: { req: Request; onVideo: OnVideo; onSegments: (segments: ShortSegment[], s: ExportSettings) => void }): JSX.Element {
  const tr = useT()
  const project = useStore((s) => s.project)
  const cutMarks = useStore((s) => s.cutMarks)
  const playhead = useStore((s) => s.currentTime)
  const marks = useSyncExternalStore(subscribeExportMarks, exportMarks, exportMarks)
  const segments = req.segments ?? null
  const forSegments = !!segments?.length
  const dur = projectDuration(project)
  const { width: pw, height: ph } = project.settings
  const shortsMode = project.mode === 'shorts'
  const vertical = ph > pw
  const shortsOk = forSegments || shortsMode || vertical

  // ---- what: the outputs, ticked (DENEME-4, worker W) ---------------------------
  // One or more of video, sound alone and this frame; a Shorts batch is one
  // kind at a time (each run asks its own folder).
  const firstKind: ExportKind = forSegments && req.kind === 'frame' ? 'video' : req.kind
  const [out, setOut] = useState<Record<OutputKind, boolean>>({ video: firstKind === 'video', gif: false, sound: firstKind === 'sound', frame: firstKind === 'frame' })
  const tick = (k: OutputKind, on: boolean): void => setOut((o) => (forSegments ? { video: k === 'video' ? on : !on, gif: false, sound: k === 'sound' ? on : !on, frame: false } : { ...o, [k]: on }))
  const outs = chosenOutputs(out)
  const moving = out.video || out.sound || out.gif

  // ---- the preset that sets the rest ------------------------------------------
  // (A YouTube preset that does not give its size in this project opens as
  // Custom, and is closed: phase Ç3 patch, R-6.)
  const startPreset: ExportPreset = startPresetOf(remembered(PRESET_KEY), { forSegments, shortsMode, vertical, width: pw, height: ph })
  const ytHolds = { yt1080: youtubePresetHolds(1080, pw, ph), yt4k: youtubePresetHolds(2160, pw, ph) }
  const settingsOf = (p: ExportPreset): { target: 'shorts' | 'landscape'; scale: number; youtube: boolean } => {
    if (p === 'shorts') {
      const target = shortsMode || forSegments ? 'shorts' : 'landscape'
      const [bw, bh] = target === 'shorts' ? [1080, 1920] : [pw, ph]
      return { target, scale: scaleForLines(bw, bh, 1080), youtube: false }
    }
    if (p === 'custom') return { target: shortsMode ? 'shorts' : 'landscape', scale: 1, youtube: remembered(YOUTUBE_KEY) !== '0' }
    return { target: 'landscape', scale: scaleForLines(pw, ph, p === 'yt4k' ? 2160 : 1080), youtube: true }
  }
  const first = settingsOf(startPreset)
  const [preset, setPreset] = useState<ExportPreset>(startPreset)
  const [target, setTarget] = useState<'shorts' | 'landscape'>(first.target)
  const [resolutionScale, setResolutionScale] = useState(first.scale)
  const [fps, setFps] = useState(project.settings.fps)
  const [bitrateFactor, setBitrateFactor] = useState(QUALITY_HIGH_FACTOR)
  // (The last one typed comes back with the Custom preset: KLISTE-PLAN.md, item 5.)
  const [customMbps, setCustomMbps] = useState(() => customMbpsAtStart(startPreset, remembered(MBPS_KEY)))
  const [videoFormat, setVideoFormat] = useState<ExportContainer>('mp4')
  const [soundFormat, setSoundFormat] = useState<ExportContainer>('m4a')
  // Normalize: its own tick for the video and for the sound alone (phase Ç3
  // patch, S-4: on by default only under a YouTube preset, not carried into
  // Sound only).
  const [videoNormalize, setVideoNormalize] = useState(normalizeByDefault('video', startPreset))
  const [soundNormalize, setSoundNormalize] = useState(false)
  const [youtube, setYoutube] = useState(first.youtube)
  // The encoder (cila E): Automatic each time the window opens; Software is
  // the way out of a graphics card's encoder that misbehaves.
  const [encoderPref, setEncoderPref] = useState<EncoderPref>('auto')
  const vFmt = formatOf(videoFormat)
  const sFmt = formatOf(soundFormat)
  // A container this computer cannot encode moves, and the window says why
  // (phase 10b.1: no AAC → WebM / MP3, no H.264 → WebM). With both encoders
  // (Windows, a Mac) nothing moves.
  const [caps, setCaps] = useState<CodecCaps | null>(null)
  useEffect(() => {
    let live = true
    void codecCaps().then((c) => live && setCaps(c))
    return () => {
      live = false
    }
  }, [])
  const [codecMoved, setCodecMoved] = useState<CodecReason[]>([])
  useEffect(() => {
    if (!caps) return
    const moved: CodecReason[] = []
    if (out.video) {
      const pick = pickExportFormat(videoFormat, caps)
      if (pick.container !== videoFormat) {
        setVideoFormat(pick.container)
        moved.push(...pick.reasons)
      }
    }
    if (out.sound) {
      const pick = pickExportFormat(soundFormat, caps)
      if (pick.container !== soundFormat) {
        setSoundFormat(pick.container)
        moved.push(...pick.reasons)
      }
    }
    if (moved.length) setCodecMoved((was) => [...new Set([...was, ...moved])])
  }, [caps, videoFormat, soundFormat, out.video, out.sound])

  const applyPreset = (p: ExportPreset): void => {
    setPreset(p)
    if (p === 'custom') return
    const s = settingsOf(p)
    setVideoFormat('mp4')
    setTarget(s.target)
    setResolutionScale(s.scale)
    setFps(project.settings.fps)
    setBitrateFactor(QUALITY_HIGH_FACTOR)
    setCustomMbps(0)
    setVideoNormalize(normalizeByDefault('video', p))
    setYoutube(s.youtube)
  }
  /** A field changed by hand: the preset no longer holds. */
  const custom = (): void => setPreset('custom')

  // ---- the frame's size and the encoder's answers ----------------------------
  const shorts = forSegments || (shortsMode && target === 'shorts')
  const baseW = shorts ? 1080 : pw
  const baseH = shorts ? 1920 : ph
  const sizes = resolutionChoices(baseW, baseH)
  useEffect(() => {
    if (!sizes.some((o) => Math.abs(o.scale - resolutionScale) < 1e-9)) setResolutionScale(1)
  }, [sizes, resolutionScale])
  const [outW, outH] = outSize(baseW, baseH, resolutionScale)
  // The GIF (KOLAY-PLAN.md, item 1): its width (none wider than the frame)
  // and frame rate; the range is the window's.
  const gifChoices = gifWidths(baseW)
  const [gifWidthAsked, setGifWidth] = useState(GIF_WIDTH_DEFAULT)
  const gifWidth = gifChoices.includes(gifWidthAsked) ? gifWidthAsked : gifChoices.filter((w) => w <= gifWidthAsked).pop() ?? gifChoices[0]
  const [gifFps, setGifFps] = useState(GIF_RATE_DEFAULT)
  const gif = gifSize(baseW, baseH, gifWidth)
  const codec = videoFormat === 'webm' ? 'vp9' : 'avc'
  const bitrateFor = (w: number, h: number, f: number): number => (customMbps > 0 ? customMbps * 1_000_000 : videoBitrateOf(w, h, f, bitrateFactor))
  const choiceOf = (w: number, h: number, f: number): VideoChoice => videoChoice(codec, w, h, f, bitrateFor(w, h, f), encoderPref)
  const keyOf = (c: VideoChoice): string => `${c.codec}|${c.width}x${c.height}|${c.fps}|${c.bitrate}${c.software ? '|sw' : ''}`
  const [verdicts, setVerdicts] = useState<Record<string, EncoderVerdict>>({})
  const sizesKey = sizes.map((o) => `${o.w}x${o.h}`).join(',')
  useEffect(() => {
    if (!out.video) return
    let live = true
    for (const o of sizes)
      for (const f of FRAME_RATES) {
        const c = choiceOf(o.w, o.h, f)
        void probeEncoder(c).then((v) => {
          if (live) setVerdicts((prev) => (prev[keyOf(c)] ? prev : { ...prev, [keyOf(c)]: v }))
        })
      }
    return () => {
      live = false
    }
    // (sizesKey stands for sizes; choiceOf reads codec and the quality.)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sizesKey, codec, bitrateFactor, customMbps, out.video, encoderPref])
  const verdictOf = (w: number, h: number, f: number): EncoderVerdict | undefined => verdicts[keyOf(choiceOf(w, h, f))]
  const refusedText = (w: number, h: number, f: number): string =>
    tr('export.encoder.refused', { codec: codec === 'avc' ? 'H.264' : 'VP9', size: `${w} × ${h}`, fps: localNum(fpsLabel(f)), mbps: fmtNum(bitrateFor(w, h, f) / 1e6, 1, true) })
  const [webmVerdict, setWebmVerdict] = useState<EncoderVerdict | undefined>()
  useEffect(() => {
    if (!out.video) return
    let live = true
    void probeEncoder(videoChoice('vp9', outW, outH, fps, videoBitrateOf(outW, outH, fps, bitrateFactor), encoderPref)).then((v) => live && setWebmVerdict(v))
    return () => {
      live = false
    }
  }, [outW, outH, fps, bitrateFactor, out.video, encoderPref])
  const current = verdictOf(outW, outH, fps)
  const noteOf = (v: EncoderVerdict | undefined): string => (!v ? '' : !v.ok ? ` (${tr('export.encoder.closed')})` : v.hw === 'prefer-software' ? ` (${tr('export.encoder.slow')})` : '')

  // ---- the range ----------------------------------------------------------
  const marked = markedRange(marks, dur) ?? (cutMarks.length >= 2 ? ([Math.min(...cutMarks), Math.max(...cutMarks)] as [number, number]) : null)
  const [rangeMode, setRangeMode] = useState<'all' | 'inout'>(marked && !forSegments ? 'inout' : 'all')
  const [inPoint, setInPoint] = useState(marked?.[0] ?? 0)
  const [outPoint, setOutPoint] = useState(marked?.[1] ?? dur)
  const setIn = (v: number): void => {
    const a = Math.max(0, Math.min(v, dur))
    setInPoint(a)
    setExportMark('in', a)
    if (outPoint <= a) setOutPoint(dur)
  }
  const setOutP = (v: number): void => {
    const b = Math.max(0, Math.min(v, dur))
    setOutPoint(b)
    setExportMark('out', b)
    if (inPoint >= b) setInPoint(0)
  }
  const ranged = !forSegments && rangeMode === 'inout' && outPoint > inPoint
  const seconds = forSegments ? segments!.reduce((n, s) => n + (s.end - s.start), 0) : ranged ? outPoint - inPoint : dur

  // ---- what is said before it starts -----------------------------------------
  const enlarged = out.video ? codeFilmsEnlarged(project, outH) : []
  // (Phase 5e: a code clip found unstable or in error is said before the export.)
  const doubtful = !moving ? [] : project.assets.filter((a) => a.kind === 'code' && Object.values(project.clips).some((c) => c.assetId === a.id)).map((a) => ({ name: a.name, v: codeFilms.verdict(a.id)?.verdict })).filter((x) => x.v === 'unstable' || x.v === 'error')
  const hdr = useMemo(() => (!moving ? [] : hdrShown(project, ranged ? [inPoint, outPoint] : undefined)), [project, moving, ranged, inPoint, outPoint])
  const soloed = project.tracks.some((t) => t.solo)
  const vBitrate = bitrateFor(outW, outH, fps)
  const audioBytes = (f: typeof vFmt): number => ((f.audioBitrate || 48_000 * 2 * 16) / 8) * seconds
  const gifBytes = gifEstimate(gif.w, gif.h, gifFps, seconds)
  const gifLong = out.gif && (seconds > GIF_LONG_SEC || gifBytes > GIF_LARGE_BYTES)
  const estBytes = (out.video ? (vBitrate / 8) * seconds + audioBytes(vFmt) : 0) + (out.sound ? audioBytes(sFmt) : 0) + (out.gif ? gifBytes : 0)
  // R28 (Ç3a, a known limit): said beside "hardware" at 2160 lines over 30 fps.
  const levelNote = out.video && codec === 'avc' && current?.ok && current.hw === 'prefer-hardware' && Math.min(outW, outH) >= 2160 && fps > 30

  // ---- the still --------------------------------------------------------------
  const [stillSz, setStillSz] = useState<StillSize>('project')
  const [stillFormat, setStillFormat] = useState<'png' | 'jpeg'>('png')
  const [stillTexts, setStillTexts] = useState(true)
  const own = stillSize(project, { size: 'project', shorts: shortsMode })
  const big = stillSize(project, { size: '4k', shorts: shortsMode })
  const still = stillSz === '4k' ? big : own

  // ---- the files, and what stops them ----------------------------------------
  const stillExt = stillFormat === 'jpeg' ? 'jpg' : 'png'
  const extOf = (k: OutputKind): string => (k === 'video' ? vFmt.ext : k === 'gif' ? 'gif' : k === 'sound' ? sFmt.ext : stillExt)
  // REF-AB item 11: the name is typed in the window (its default, as before:
  // the project's name; a frame alone, with its moment: still-save.ts), the
  // place is the last export folder, the cover a frame beside the video.
  const defaultStem = outs.length === 1 && outs[0] === 'frame' ? cleanStem(`${safeFileName(project.name, 'frame')}-${playhead.toFixed(2)}s`) : cleanStem(safeFileName(project.name))
  const [typedStem, setTypedStem] = useState<string | null>(null)
  const stem = typedStem ?? defaultStem
  const where = useExportPlace()
  const [coverOn, setCoverOn] = useCoverOn()
  const [coverAt, setCoverAt] = useState(playhead)
  const cover = coverOn && out.video && !forSegments
  const coverName = (s: string): string => `${s}-${say('refp.export.cover.suffix')}.png`
  const fileOf = (k: OutputKind): string => `${stem}.${extOf(k)}`
  // (An empty timeline has nothing to export: the button is off and the line
  // above says why. It said "All clear" and failed after the save dialog:
  // phase 11b, U3.)
  const blockers: { id: string; text: string }[] = [
    ...(outs.length === 0 ? [{ id: 'none', text: tr('w4.export.blocked.none') }] : []),
    ...(!forSegments && stemProblem(stem) !== null ? [{ id: 'name', text: tr('refp.export.name.bad') }] : []),
    ...(moving && !forSegments && dur <= 0 ? [{ id: 'empty', text: tr('err.timelineEmpty') }] : []),
    ...(out.video && current?.ok === false ? [{ id: 'encoder', text: tr('w4.export.blocked.encoder', { why: refusedText(outW, outH, fps) }) }] : [])
  ]
  const blocked = blockers.length > 0

  const settingsFor = (k: 'video' | 'sound' | 'gif'): ExportSettings =>
    k === 'gif'
      ? { resolutionScale: gif.w / baseW, fps: gifFps, bitrateFactor, target: forSegments ? 'shorts' : target, container: 'gif', gifWidth: gif.w, range: ranged ? [inPoint, outPoint] : undefined }
      : {
    resolutionScale,
    fps,
    bitrateFactor,
    target: forSegments ? 'shorts' : target,
    container: k === 'sound' ? soundFormat : videoFormat,
    normalize: k === 'sound' ? soundNormalize : videoNormalize,
    ...(k === 'video' && !forSegments && youtube ? { youtube: true } : {}),
    ...(k === 'video' && encoderPref === 'software' ? { encoder: 'software' as const } : {}),
    videoBitrate: k === 'video' && customMbps > 0 ? customMbps * 1_000_000 : undefined,
    range: ranged ? [inPoint, outPoint] : undefined
  }
  const stillChoice = { size: stillSz, format: stillFormat, captions: stillTexts }
  const keepChoices = (): void => {
    if (out.video) {
      remember(PRESET_KEY, preset)
      remember(MBPS_KEY, String(customMbps))
    }
  }
  const time = playhead
  /** The outputs (and the cover) into their approved paths, in order. */
  const runInto = (paths: (string | undefined)[], coverPath?: string): void => {
    void runOutputs([
      ...outs.map((k, i) => ({
        kind: k,
        run: async () => (k === 'frame' ? saveStillFrame(stillChoice, { path: paths[i], time }) : (await onVideo(settingsFor(k), paths[i])) !== false)
      })),
      // (The cover last: a PNG of its moment beside the video.)
      ...(coverPath ? [{ kind: 'frame' as const, run: () => saveStillFrame({ size: 'project', format: 'png', captions: true }, { path: coverPath, time: coverAt }) }] : [])
    ])
  }
  const start = (): void => {
    if (forSegments) {
      closeExportWindow()
      keepChoices()
      onSegments(segments!, settingsFor(out.sound ? 'sound' : 'video'))
      return
    }
    // The desktop app: the name and place of the window (REF-AB item 11).
    if (api?.exportPlace) {
      void startInPlace()
      return
    }
    // (The browser build: each output downloaded, one after another.)
    closeExportWindow()
    keepChoices()
    runInto(outs.map(() => undefined))
  }

  /** Named in the window, written into the place: the folder must be one the
   *  user chose (the main process checks); a file already there is asked
   *  about first. No place yet (the first export): the save window, once,
   *  and its folder is the place from then on. */
  const startInPlace = async (): Promise<void> => {
    const exts = outs.map(extOf)
    if (!where.place) {
      const k0 = outs[0]
      const f0 = k0 === 'frame' ? null : formatOf(settingsFor(k0).container)
      const chosen = await api!.chooseSavePath({ defaultName: fileOf(k0), filterName: f0?.filter ?? (stillFormat === 'jpeg' ? 'JPEG image' : 'PNG image'), extensions: [extOf(k0)] })
      if (!chosen) return
      const dir = chosen.replace(/[\\/][^\\/]*$/, '')
      where.set(dir)
      // The save window made the chosen file writable (and asked about one
      // of that name). The other outputs and the cover, beside it under its
      // name, are asked for as in a known place: a file already there is
      // said first, once (22 Nov, K1: they were written over unasked).
      const nameOf = (p: string): string => p.replace(/^.*[\\/]/, '')
      const others = [...outputPaths(chosen, exts).slice(1).map(nameOf), ...(cover ? [coverName(nameOf(stemOf(chosen)))] : [])]
      const more = await approveAsking(dir, others)
      if (!more) return
      closeExportWindow()
      keepChoices()
      runInto([chosen, ...more.slice(0, outs.length - 1)], cover ? more[outs.length - 1] : undefined)
      return
    }
    const paths = await approveAsking(where.place, [...outs.map(fileOf), ...(cover ? [coverName(stem)] : [])])
    if (!paths) return
    closeExportWindow()
    keepChoices()
    runInto(paths.slice(0, outs.length), cover ? paths[outs.length] : undefined)
  }

  /** `files` in the chosen folder made writable: the ones already there are
   *  named in one question first. Null: the user said no, or the main
   *  process refused (said). */
  const approveAsking = async (dir: string, files: string[]): Promise<string[] | null> => {
    if (files.length === 0) return []
    const xp = api!.exportPlace
    let r = await xp.approve(dir, files)
    if (!r.ok && r.exists?.length) {
      const yes = await confirmDialog({ title: say('refp.export.replace.title'), message: say('refp.export.replace.ask', { names: r.exists.join(', ') }), note: dir, confirm: say('refp.export.replace.ok'), danger: true })
      if (!yes) return null
      r = await xp.approve(dir, files, true)
    }
    if (!r.ok || !r.paths) {
      notify({ text: say('refp.export.refused', { why: r.error ?? '' }), kind: 'error' })
      return null
    }
    return r.paths
  }

  // ---- the parts --------------------------------------------------------------
  const presets: SegmentOption<ExportPreset>[] = [
    { value: 'yt1080', label: tr('export.preset.yt1080'), hint: ytHolds.yt1080 ? tr('export.preset.yt1080.hint') : tr('export.preset.yt.closed', { w: pw, h: ph, out: '1920 × 1080' }), disabled: !out.video || forSegments || !ytHolds.yt1080 },
    { value: 'yt4k', label: tr('export.preset.yt4k'), hint: ytHolds.yt4k ? tr('export.preset.yt4k.hint') : tr('export.preset.yt.closed', { w: pw, h: ph, out: '3840 × 2160' }), disabled: !out.video || forSegments || !ytHolds.yt4k },
    { value: 'shorts', label: tr('export.preset.shorts'), hint: shortsOk ? tr('export.preset.shorts.hint') : tr('export.preset.shorts.closed'), disabled: !out.video || !shortsOk },
    { value: 'custom', label: tr('export.preset.custom'), hint: tr('export.preset.custom.hint'), disabled: !out.video }
  ]
  const sizeName = (o: { scale: number; w: number; h: number }): string => {
    const short = Math.min(baseW, baseH)
    const lines = Math.min(o.w, o.h)
    const what =
      Math.abs(o.scale - 1) < 1e-9 ? tr('export.size.project') : o.scale < 1 && lines < 1080 ? tr('export.size.fast') : lines === 1440 ? tr(short > 1440 ? 'export.size.qhdDown' : 'export.size.qhd') : lines === 2160 ? tr(short < 2160 ? 'export.size.uhdUp' : 'export.size.uhd') : tr('export.size.fast')
    return `${o.w} × ${o.h} (${what})`
  }
  const sizeOptions: SelectOption[] = sizes.map((o) => {
    const v = verdictOf(o.w, o.h, fps)
    return { value: String(o.scale), label: sizeName(o) + noteOf(v), disabled: v?.ok === false, hint: v && !v.ok ? refusedText(o.w, o.h, fps) : Math.min(o.w, o.h) === 1440 ? tr('export.size.qhdHint') : undefined }
  })
  const fpsOptions: SelectOption[] = FRAME_RATES.map((f) => {
    const v = verdictOf(outW, outH, f)
    return { value: String(f), label: tr(Math.abs(f - project.settings.fps) < 1e-6 ? 'export.fps.project' : 'export.fps.option', { fps: localNum(fpsLabel(f)) }) + noteOf(v), disabled: v?.ok === false, hint: v && !v.ok ? refusedText(outW, outH, f) : undefined }
  })
  const videoFormats: SelectOption[] = EXPORT_FORMATS.filter((f) => !f.audioOnly).map((f) => ({
    value: f.id,
    label: f.label + (f.id === 'webm' && webmVerdict?.ok && webmVerdict.hw === 'prefer-software' ? ` (${tr('export.encoder.slow')})` : ''),
    hint: f.id === 'webm' && webmVerdict?.ok && webmVerdict.hw === 'prefer-software' ? tr('export.encoder.software') : undefined
  }))
  const soundFormats: SelectOption[] = EXPORT_FORMATS.filter((f) => f.audioOnly).map((f) => ({ value: f.id, label: f.short }))
  const qualityOptions: SelectOption[] = [
    { value: String(QUALITY_STANDARD), label: tr('export.quality.standard') },
    { value: String(QUALITY_HIGH_FACTOR), label: tr('export.quality.high') },
    { value: String(QUALITY_MAXIMUM), label: tr('export.quality.max') },
    { value: 'custom', label: tr('export.quality.custom') }
  ]
  const startLabel =
    outs.length > 1
      ? tr('w4.export.start.many', { n: outs.length })
      : forSegments
        ? tr('export.start.segments', { n: segments!.length })
        : outs[0] === 'frame'
          ? tr('export.start.frame')
          : outs[0] === 'gif'
            ? tr('kolay.gif.start')
          : outs[0] === 'sound'
            ? tr('export.start.sound')
            : tr('export.start.video')
  const audioLine = (f: typeof vFmt): string => tr('export.summary.audio', { codec: f.audioCodec, rate: f.audioBitrate ? `${Math.round(f.audioBitrate / 1000)} kbps` : tr('export.summary.stereo') })

  return (
    <Dialog
      open
      title={forSegments ? tr('export.title.segments', { n: segments!.length }) : tr('export.title')}
      onClose={closeExportWindow}
      width="lg"
      className="xw-dialog"
      testid="dialog.export"
      actions={
        <>
          <Button variant="secondary" testid="export.cancel" onClick={closeExportWindow}>
            {tr('export.cancel')}
          </Button>
          <Button variant="primary" testid="export.start" disabled={blocked} onClick={start}>
            {startLabel}
          </Button>
        </>
      }
    >
      <div className="xw">
        {forSegments && <p className="xw-hint">{tr('export.segments.hint')}</p>}
        {!forSegments && api && <NamePlace stem={stem} onStem={setTypedStem} place={where.place} onChoose={() => void where.choose()} />}
        <div className="xw-presets">
          <Segmented<ExportPreset> label={tr('export.preset')} testid="export.preset" value={preset} onChange={applyPreset} options={presets} />
        </div>
        <div className="xw-cols">
          {/* ---- left: the settings, each output's under its own tick ---- */}
          <div className="xw-settings">
            <div className="xw-head">{tr('export.kind')}</div>
            <div className={out.video ? 'xw-out is-on' : 'xw-out'}>
              <Checkbox testid="export.out.video" label={tr('export.kind.video')} checked={out.video} onChange={(v) => tick('video', v)} />
              {out.video && (
                <div className="xw-out-body">
                  <div className="xw-grid">
                    <Field label={tr('export.format')}>
                      <Select testid="export.format" size="sm" value={videoFormat} options={videoFormats} onChange={(v) => { setVideoFormat(v as ExportContainer); custom() }} />
                    </Field>
                    {shortsMode && !forSegments && (
                      <Field label={tr('export.target')}>
                        <Select testid="export.target" size="sm" value={target} options={[{ value: 'shorts', label: tr('export.target.shorts') }, { value: 'landscape', label: tr('export.target.landscape') }]} onChange={(v) => { setTarget(v as 'shorts' | 'landscape'); custom() }} />
                      </Field>
                    )}
                    <Field label={tr('export.resolution')}>
                      <Select testid="export.resolution" size="sm" value={String(resolutionScale)} options={sizeOptions} onChange={(v) => { setResolutionScale(Number(v)); custom() }} />
                    </Field>
                    <Field label={tr('export.fps')}>
                      <Select testid="export.fps" size="sm" value={String(fps)} options={fpsOptions} onChange={(v) => { setFps(Number(v)); custom() }} />
                    </Field>
                    <Field label={tr('export.quality')}>
                      <Select
                        testid="export.quality"
                        size="sm"
                        value={customMbps > 0 ? 'custom' : String(bitrateFactor)}
                        options={qualityOptions}
                        onChange={(v) => {
                          if (v === 'custom') setCustomMbps(customMbpsAtStart('custom', remembered(MBPS_KEY)) || 40)
                          else {
                            setCustomMbps(0)
                            setBitrateFactor(Number(v))
                          }
                          custom()
                        }}
                      />
                    </Field>
                    <Field label={tr('export.encoderChoice')}>
                      <Select
                        testid="export.encoder-choice"
                        size="sm"
                        value={encoderPref}
                        options={[
                          { value: 'auto', label: tr('export.encoderChoice.auto'), hint: tr('export.encoderChoice.auto.hint') },
                          { value: 'software', label: tr('export.encoderChoice.software'), hint: tr('export.encoderChoice.software.hint') }
                        ]}
                        onChange={(v) => setEncoderPref(v as EncoderPref)}
                      />
                    </Field>
                    {customMbps > 0 && (
                      <Field label={tr('export.mbps')}>
                        <NumberField testid="export.mbps" size="sm" value={customMbps} min={CUSTOM_MBPS_MIN} max={CUSTOM_MBPS_MAX} step={1} unit="Mb/s" onChange={(v) => setCustomMbps(v)} />
                      </Field>
                    )}
                  </div>
                  <div className="xw-checks">
                    <Checkbox testid="export.normalize" label={tr('export.normalize')} checked={videoNormalize} onChange={(v) => { setVideoNormalize(v); custom() }} />
                    {!forSegments && (
                      <Checkbox
                        testid="export.youtube"
                        label={tr('export.youtube')}
                        checked={youtube}
                        onChange={(v) => {
                          setYoutube(v)
                          remember(YOUTUBE_KEY, v ? '1' : '0')
                        }}
                      />
                    )}
                  </div>
                </div>
              )}
            </div>
            {!forSegments && (
              <div className={out.gif ? 'xw-out is-on' : 'xw-out'}>
                <Checkbox testid="export.out.gif" label={tr('kolay.gif.out')} checked={out.gif} onChange={(v) => tick('gif', v)} />
                {out.gif && (
                  <div className="xw-out-body">
                    <div className="xw-grid">
                      <Field label={tr('kolay.gif.width')}>
                        <Select testid="export.gif.width" size="sm" value={String(gifWidth)} options={gifChoices.map((w) => ({ value: String(w), label: tr('kolay.gif.width.option', { w, h: gifSize(baseW, baseH, w).h }) }))} onChange={(v) => setGifWidth(Number(v))} />
                      </Field>
                      <Field label={tr('kolay.gif.fps')}>
                        <Select testid="export.gif.fps" size="sm" value={String(gifFps)} options={GIF_RATES.map((f) => ({ value: String(f), label: tr('kolay.gif.fps.option', { fps: f }) }))} onChange={(v) => setGifFps(Number(v))} />
                      </Field>
                    </div>
                  </div>
                )}
              </div>
            )}
            <div className={out.sound ? 'xw-out is-on' : 'xw-out'}>
              <Checkbox testid="export.out.sound" label={tr('export.kind.sound')} checked={out.sound} onChange={(v) => tick('sound', v)} />
              {out.sound && (
                <div className="xw-out-body">
                  <div className="xw-grid">
                    <Field label={tr('export.format')}>
                      <Select testid="export.sound-format" size="sm" value={soundFormat} options={soundFormats} onChange={(v) => setSoundFormat(v as ExportContainer)} />
                    </Field>
                  </div>
                  <div className="xw-checks">
                    <Checkbox testid="export.sound-normalize" label={tr('export.normalize')} checked={soundNormalize} onChange={setSoundNormalize} />
                  </div>
                </div>
              )}
            </div>
            {forSegments ? (
              <p className="xw-hint">{tr('w4.export.out.segmentsOne')}</p>
            ) : (
              <div className={out.frame ? 'xw-out is-on' : 'xw-out'}>
                <Checkbox testid="export.out.frame" label={tr('export.kind.frame')} checked={out.frame} onChange={(v) => tick('frame', v)} />
                {out.frame && (
                  <div className="xw-out-body">
                    <Field label={tr('still.size')} hint={shortsMode ? tr('still.shorts') : undefined}>
                      <Segmented<StillSize>
                        label={tr('still.size')}
                        testid="still.size"
                        value={stillSz}
                        onChange={setStillSz}
                        options={[
                          { value: 'project', label: tr('still.size.project', { w: own.w, h: own.h }) },
                          { value: '4k', label: tr('still.size.uhd', { w: big.w, h: big.h }) }
                        ]}
                      />
                    </Field>
                    <Field label={tr('still.format')}>
                      <Segmented<'png' | 'jpeg'> label={tr('still.format')} testid="still.format" value={stillFormat} onChange={setStillFormat} options={[{ value: 'png', label: tr('still.format.png') }, { value: 'jpeg', label: tr('still.format.jpeg') }]} />
                    </Field>
                    <Toggle label={tr('still.captions')} checked={stillTexts} onChange={setStillTexts} testid="still.captions" />
                  </div>
                )}
              </div>
            )}
            {moving && !forSegments && (
              <>
                <Field label={tr('export.range')} hint={rangeMode === 'inout' ? tr('export.range.hint') : undefined}>
                  <Segmented<'all' | 'inout'> label={tr('export.range')} testid="export.range" value={rangeMode} onChange={setRangeMode} options={[{ value: 'all', label: tr('export.range.all') }, { value: 'inout', label: tr('export.range.inout') }]} />
                </Field>
                {rangeMode === 'inout' && (
                  <div className="xw-range">
                    <Field label={tr('export.range.in')}>
                      <NumberField testid="export.range.in" size="sm" value={+inPoint.toFixed(2)} min={0} max={dur} step={0.01} decimals={2} unit="s" onChange={setIn} />
                    </Field>
                    <Button size="sm" variant="secondary" testid="export.range.in-playhead" onClick={() => setIn(playhead)}>
                      {tr('export.range.playhead')}
                    </Button>
                    <Field label={tr('export.range.out')}>
                      <NumberField testid="export.range.out" size="sm" value={+outPoint.toFixed(2)} min={0} max={dur} step={0.01} decimals={2} unit="s" onChange={setOutP} />
                    </Field>
                    <Button size="sm" variant="secondary" testid="export.range.out-playhead" onClick={() => setOutP(playhead)}>
                      {tr('export.range.playhead')}
                    </Button>
                  </div>
                )}
              </>
            )}
          </div>

          {/* ---- right: what will be written, and what to look at first ---- */}
          <aside className="xw-side">
            {out.video && !forSegments && <CoverPick on={coverOn} onOn={setCoverOn} at={coverAt} onAt={setCoverAt} size={{ w: outW, h: outH }} />}
            {blockers.map((b) => (
              <p key={b.id} className="xw-blocked" role="alert" data-testid={b.id === 'empty' ? 'export.empty' : `export.blocked.${b.id}`}>
                <Icon name="circle-x" size={14} />
                <span>{b.text}</span>
              </p>
            ))}
            {outs.length > 0 && (
              <div className="xw-summary" data-testid="export.summary">
                <div className="xw-head">{tr('w4.export.files')}</div>
                {outs.map((k) => (
                  <div key={k} className="xw-file" data-testid={`export.file.${k}`}>
                    <span className="xw-file-name">{fileOf(k)}</span>
                    {k === 'video' && (
                      <>
                        <span>{tr('export.summary.video', { codec: codec === 'avc' ? 'H.264' : 'VP9', w: outW, h: outH, fps: localNum(fpsLabel(fps)), mbps: fmtNum(vBitrate / 1e6, 1, true) })}</span>
                        <EncoderLine current={current} refused={refusedText(outW, outH, fps)} levelNote={!!levelNote} chosen={encoderPref === 'software'} />
                        <span>{audioLine(vFmt)}</span>
                      </>
                    )}
                    {k === 'gif' && <span>{tr('kolay.gif.line', { w: gif.w, h: gif.h, fps: gifFps })}</span>}
                    {k === 'sound' && <span>{audioLine(sFmt)}</span>}
                    {k === 'frame' && <span>{tr('w4.export.frameLine', { w: still.w, h: still.h, format: stillFormat === 'jpeg' ? 'JPEG' : 'PNG', time: fmtNum(playhead, 2, true) })}</span>}
                  </div>
                ))}
                {cover && (
                  <div className="xw-file" data-testid="export.file.cover">
                    <span className="xw-file-name">{coverName(stem)}</span>
                    <span>{tr('refp.export.cover.file', { w: own.w, h: own.h, time: fmtNum(coverAt, 2, true) })}</span>
                  </div>
                )}
                {outs.length > 1 && <span className="xw-file-note">{tr('w4.export.files.same')}</span>}
                {moving && <span className="xw-total" data-testid="export.size">{tr('export.summary.size', { len: fmtTime(Math.max(0, seconds)), size: localNum(sizeLabel(estBytes)) })}</span>}
              </div>
            )}
            {moving && !forSegments && <PreflightList onGo={closeExportWindow} />}
            {codecMoved.length > 0 && moving && (
              <p className="xw-hint is-warn" data-testid="export.codec-moved">
                {codecMoved.map((r) => tr(r === 'noAac' ? 'export.codec.noAac' : 'export.codec.noAvc')).join(' ')}
              </p>
            )}
            {gifLong && (
              <p className="xw-hint is-warn" data-testid="export.gif.long">
                {tr('kolay.gif.long', { size: localNum(sizeLabel(gifBytes)) })}
              </p>
            )}
            {soloed && moving && (
              <p className="xw-hint is-warn" data-testid="export.solo">
                {tr('export.solo')}
              </p>
            )}
            {enlarged.map((f) => (
              <p key={f.name} className="xw-hint" data-testid="export.codefilm-upscaled">
                {tr('export.codeFilm.upscaled', { name: f.name, w: f.w, h: f.h, ow: outW, oh: outH })}
              </p>
            ))}
            {doubtful.map((f) => (
              <p key={`v-${f.name}`} className="xw-hint is-warn" data-testid="export.codefilm-verdict">
                {tr(f.v === 'error' ? 'export.codeFilm.error' : 'export.codeFilm.unstable', { name: f.name })}
              </p>
            ))}
            {hdr.length > 0 && (
              <p className="xw-hint is-warn" data-testid="export.hdr">
                {tr('export.hdr', { names: hdr.map((n) => `"${n}"`).join(', ') })}
              </p>
            )}
          </aside>
        </div>
      </div>
    </Dialog>
  )
}

/** "Encoder: hardware" (or software, or refused), its tip when there is
 *  something to know about it. */
function EncoderLine({ current, refused, levelNote, chosen }: { current: EncoderVerdict | undefined; refused: string; levelNote: boolean; chosen: boolean }): JSX.Element {
  const tr = useT()
  const text = !current ? tr('export.encoder.checking') : !current.ok ? refused : tr(current.hw === 'prefer-software' ? (chosen ? 'export.encoder.softwareChosen' : 'export.encoder.software') : 'export.encoder.hardware')
  const line = (
    <span data-testid="export.encoder" className={current?.ok === false ? 'xw-refused' : undefined} tabIndex={levelNote ? 0 : undefined}>
      {text}
    </span>
  )
  return levelNote ? <Tooltip content={tr('export.encoder.level51')}>{line}</Tooltip> : line
}
