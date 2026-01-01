// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
import { memo, useLayoutEffect, useRef } from 'react'
import { volumeAt } from '../audio/envelope'
import { peakProgress, usePeaks } from '../media/peakCache'
import { levelForScale } from '../media/peaks'
import { useViewport } from '../playback/viewport'
import { useStore } from '../state/store'
import { heldBox, heldNeed } from '../timeline/view-math'
import { hasCurve } from '../timeline/speed-curve'
import { mediaAtLocal } from '../timeline/media-time'
import { drawingHeight, useLaneHeight, useTimelineView } from './timeline/view-state'
import { t as text } from '../ui/strings'
import type { Asset, Clip } from '../types'
import { TIMELINE_HEADER_W as HEADER_W } from '../types'

/** Runs of true silence at least this long get the dimmed treatment. */
const MIN_SILENCE_SEC = 0.15
/**
 * Below this RMS (as a fraction of the asset's peak) a column counts as dead
 * air. Judged on RMS, not on the peak: a room-tone noise floor produces small
 * peaks constantly. ~-50 dB below the asset peak dims truly quiet stretches,
 * but their bars remain visible; dimming is not a promise that Cut Silence
 * will remove the passage.
 */
const SILENCE_FLOOR = 0.003

/** The waveform's colour: --clip-wave of ui/tokens.css (palette v3.1), read once. */
let waveTone: string | null = null
function waveColour(): string {
  if (waveTone === null) waveTone = getComputedStyle(document.documentElement).getPropertyValue('--clip-wave').trim() || 'rgb(166,224,213)'
  return waveTone
}

/**
 * Canvas waveform: ONE bar per screen pixel, drawn from a multi-resolution peak
 * pyramid — the way professional editors do it.
 *
 * Two layers per column: the true min/max peak envelope in a soft tint, and the
 * RMS body in a solid tint on top. That combination is what makes the loud and
 * quiet parts readable at a glance, even zoomed out.
 *
 * Canvas rather than SVG because the old version rebuilt a path string of
 * thousands of commands on every scroll, which was the stutter; here the same
 * work is a tight loop straight onto a bitmap, and only the visible slice is
 * ever drawn (a clip can be hundreds of thousands of pixels wide when zoomed).
 */
function WaveformInner({ clip, asset }: { clip: Clip; asset: Asset }): JSX.Element | null {
  const pyramid = usePeaks(asset)
  // While the file is still being read the pyramid covers the whole duration
  // but only the first `analysed` fraction holds real data. Without knowing
  // that, the untouched tail would be drawn as dead air — a silent-looking
  // stretch that isn't silent at all.
  const analysed = peakProgress(asset)
  const pxPerSec = useStore((s) => s.pxPerSec)
  // In steps of 256 px: the drawing reaches 600 px past the view on either
  // side, so a scroll draws it again every few frames, not on every one
  // (it used to follow the view in 32 px steps; phase 3c.T).
  const viewLeft = useViewport((s) => Math.floor(s.left / 256) * 256)
  const viewWidth = useViewport((s) => s.width)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  // The lane's height (its own, at the timeline's height step): the drawing
  // is made again when it changes (phase 3c.T).
  const laneH = useLaneHeight(clip.trackId)
  // While a zoom is under way the drawing is stretched, not made again on
  // every step; it is made again when the zoom has settled.
  const zooming = useTimelineView((v) => v.zooming)
  const drawn = useRef<{ from: number; w: number; px: number } | null>(null)

  const W = Math.max(8, clip.duration * pxPerSec)
  const clipLeftPx = HEADER_W + clip.start * pxPerSec
  const margin = 600
  const visFrom = Math.max(0, Math.min(W, viewLeft - clipLeftPx - margin))
  const visTo = Math.max(visFrom, Math.min(W, viewLeft + viewWidth - clipLeftPx + margin))
  const visW = Math.max(0, Math.round(visTo - visFrom))
  const held = heldBox(zooming, drawn.current, pxPerSec, heldNeed(visFrom, visTo))

  const ready = pyramid !== 'loading' && pyramid !== null
  // Muted reads as zero here too, so a muted clip's bars flatten instead of
  // staying at full height while nothing comes out of it.
  const volume = clip.muted ? 0 : clip.volume
  const hasEnv =
    (clip.volumeKeyframes?.length ?? 0) > 0 || (clip.fadeIn ?? 0) > 0 || (clip.fadeOut ?? 0) > 0

  useLayoutEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || !ready || visW <= 0) return
    if (held) return
    drawn.current = { from: visFrom, w: visW, px: pxPerSec }
    const p = pyramid as NonNullable<Exclude<typeof pyramid, 'loading'>>
    const h = drawingHeight(canvas, laneH)
    if (h <= 0) return
    const dpr = window.devicePixelRatio || 1
    const bw = Math.max(1, Math.round(visW * dpr))
    const bh = Math.max(1, Math.round(h * dpr))
    if (canvas.width !== bw || canvas.height !== bh) {
      canvas.width = bw
      canvas.height = bh
    }
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, visW, h)

    const secPerPx = 1 / pxPerSec
    const level = levelForScale(p, secPerPx)
    const norm = 1 / p.peak
    const constGain = Math.max(0, Math.min(2, volume))
    // Bars grow UP from the baseline (CapCut style) rather than mirroring about
    // a centre line — the mirrored form wastes half the height on a duplicate
    // and is harder to read at a glance.
    const baseline = h
    const full = h - 1 // hairline of headroom so a full-scale peak isn't clipped

    // Collect per-column values first: the two passes (envelope, then RMS) each
    // need them, and silence runs are derived from the same numbers so the
    // shading can never disagree with the bars.
    const cols = visW
    const loArr = new Float32Array(cols)
    const hiArr = new Float32Array(cols)
    const rmsArr = new Float32Array(cols)
    const silent = new Uint8Array(cols)

    // Media time that has actually been analysed so far.
    const analysedUntil = analysed === undefined ? Infinity : analysed * p.duration
    // A retimed clip covers `speed` seconds of media per timeline second, so the
    // waveform has to be read at that rate or it stops matching what you hear.
    const spd = clip.speed ?? 1
    const curved = hasCurve(clip)
    let firstUnanalysed = cols
    for (let px = 0; px < cols; px++) {
      // Column → clip-local seconds → media seconds.
      const localSec = ((visFrom + px) / pxPerSec)
      // Along a speed curve (core polish T): the media the curve puts under
      // this column (timeline/media-time.ts), either way round.
      let t0 = clip.inPoint + localSec * spd
      let t1 = t0 + secPerPx * spd
      if (curved) {
        const a = mediaAtLocal(clip, localSec)
        const b = mediaAtLocal(clip, localSec + secPerPx)
        t0 = Math.min(a, b)
        t1 = Math.max(a, b)
      }
      let a = Math.floor(t0 / level.bucketDur)
      let b = Math.ceil(t1 / level.bucketDur)
      a = Math.max(0, Math.min(level.min.length - 1, a))
      b = Math.max(a + 1, Math.min(level.min.length, b))
      let lo = 0
      let hi = 0
      let energy = 0
      for (let i = a; i < b; i++) {
        if (level.min[i] < lo) lo = level.min[i]
        if (level.max[i] > hi) hi = level.max[i]
        energy += level.rms[i] * level.rms[i]
      }
      const rms = Math.sqrt(energy / (b - a))
      // volumeAt, so mute flattens the drawing: the timeline should show that
      // this clip makes no sound, the same way pulling the fader to zero does.
      const gain = hasEnv ? volumeAt(clip, localSec) : constGain
      loArr[px] = lo * norm * gain
      hiArr[px] = hi * norm * gain
      rmsArr[px] = rms * norm * gain
      silent[px] = rmsArr[px] < SILENCE_FLOOR ? 1 : 0
      if (t0 > analysedUntil && px < firstUnanalysed) firstUnanalysed = px
    }

    // ---- dead-air shading (behind the bars) --------------------------------
    const minSilenceCols = Math.max(1, Math.round(MIN_SILENCE_SEC * pxPerSec))
    ctx.fillStyle = 'rgba(0,0,0,0.24)'
    let runStart = -1
    const flushRun = (end: number): void => {
      if (runStart >= 0 && end - runStart >= minSilenceCols) {
        ctx.fillRect(runStart, 0, end - runStart, h)
      }
      runStart = -1
    }
    for (let px = 0; px < firstUnanalysed; px++) {
      if (silent[px]) {
        if (runStart < 0) runStart = px
      } else flushRun(px)
    }
    flushRun(firstUnanalysed)

    // ---- bars ---------------------------------------------------------------
    // ONE layer only. Drawing the peak envelope and the RMS body as two tones
    // read as a doubled/ghosted shape, because the RMS bar is always shorter
    // than the peak bar. A single bar per column, sized from the true peak, is
    // what the reference editors actually show.
    const wave = waveColour()
    ctx.fillStyle = wave
    ctx.globalAlpha = 0.95
    for (let px = 0; px < firstUnanalysed; px++) {
      const amp = Math.min(1, Math.max(Math.abs(loArr[px]), Math.abs(hiArr[px])))
      // Quiet audio can still be audible. Keep its actual peak visible instead
      // of erasing the bar merely because the background was dimmed.
      if (amp <= 0) continue
      const barH = Math.max(1, amp * full)
      ctx.fillRect(px, baseline - barH, 1, barH)
    }

    // ---- baseline through silence ------------------------------------------
    // A clear flat line (okunur: on the dark sound ground, "no sound here" is
    // read as plainly as the bars say "sound").
    ctx.globalAlpha = 0.8
    for (let px = 0; px < firstUnanalysed; px++) {
      if (silent[px]) ctx.fillRect(px, baseline - 1, 1, 1)
    }

    // ---- still-being-read tail ---------------------------------------------
    // A thin moving line rather than empty space, so it reads as "coming" and
    // not as "there is nothing here".
    if (firstUnanalysed < cols) {
      ctx.globalAlpha = 0.2
      ctx.fillRect(firstUnanalysed, baseline - 2, cols - firstUnanalysed, 2)
    }
    ctx.globalAlpha = 1
  }, [pyramid, ready, analysed, visFrom, visW, pxPerSec, clip, volume, hasEnv, laneH, zooming])

  if (pyramid === 'loading') return <div className="wave-loading">{text('timeline.wave.loading')}</div>
  if (!pyramid || visW <= 0) return null

  return (
    <canvas
      ref={canvasRef}
      className="wave"
      style={{ position: 'absolute', left: held ? held.left : visFrom, width: held ? held.width : visW, top: 0, bottom: 0, height: '100%' }}
    />
  )
}

export const Waveform = memo(WaveformInner)
