// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// The export's picture and sound quality in one place (the craft run, round
// 5b): the editor's choices (Standard, High, Maximum, a custom bitrate), the
// films' default, and the 1440p size. Pure: no DOM, so the tests can read it.

/** The editor's quality choices: bits per pixel per frame. */
export const QUALITY_STANDARD = 0.08
export const QUALITY_HIGH_FACTOR = 0.12
export const QUALITY_MAXIMUM = 0.2
/** The films' default: about 35 Mbps for
 *  1080p60, scaled by pixels × frames a second. */
export const FILM_BITRATE_FACTOR = 35_000_000 / (1920 * 1080 * 60)
/** The films' sound: AAC at 320 kbps, 48 kHz (the mix is always 48 kHz). The
 *  encoder's best at or under it is used where the system's AAC encoder
 *  stops lower (Windows' stops at 192 kbps). */
export const FILM_AUDIO_BITRATE = 320_000
/** The sound's bitrate otherwise (AAC in MP4). */
export const AUDIO_BITRATE = 192_000
/** AAC bitrates to try, best first, at or under the one asked. */
export const AAC_STEPS = [320_000, 256_000, 192_000, 160_000, 128_000]

const MIN_VIDEO = 4_000_000
/** At most 60 Mbps for the editor's choices; a film at its default keeps
 *  its scaling further (a 1440p60 film is about 62 Mbps). */
const MAX_VIDEO = 60_000_000
const MAX_FILM_VIDEO = 100_000_000

/**
 * YouTube's recommended upload bitrates (Mb/s), the floor of the High and
 * Maximum qualities and the films' default (phase Ç3a, decision 8; report
 * R18): 1080p 8 (30 fps) / 12 (60 fps), 1440p 16 / 24, 2160p 45 / 68, by the
 * frame's short side (a Short is 1080 wide); a rate above 30 counts as 60.
 * High gave 1080p30 7.5, 2160p30 29.9 and 2160p60 59.7 (capped at 60).
 */
export function bitrateFloor(w: number, h: number, fps: number): number {
  const lines = Math.min(w, h)
  const high = fps > 31
  if (lines >= 2160) return (high ? 68 : 45) * 1e6
  if (lines >= 1440) return (high ? 24 : 16) * 1e6
  if (lines >= 1080) return (high ? 12 : 8) * 1e6
  if (lines >= 720) return (high ? 7.5 : 5) * 1e6
  return 0
}

/** The video bitrate (bits/s) for a frame size, a frame rate and a factor.
 *  High and above never under YouTube's rate for the size (bitrateFloor);
 *  Standard ("smaller file") as before. */
export function videoBitrateOf(w: number, h: number, fps: number, factor: number): number {
  const floor = factor >= QUALITY_HIGH_FACTOR - 1e-9 ? bitrateFloor(w, h, fps) : 0
  const cap = Math.max(floor, factor >= FILM_BITRATE_FACTOR - 1e-9 ? MAX_FILM_VIDEO : MAX_VIDEO)
  return Math.min(cap, Math.max(MIN_VIDEO, floor, Math.round(w * h * fps * factor)))
}

/** The quality's name for a factor (the export's summary). */
export function qualityName(factor: number): string {
  if (factor >= FILM_BITRATE_FACTOR - 1e-9) return 'Film'
  if (factor >= QUALITY_MAXIMUM) return 'Maximum'
  if (factor >= QUALITY_HIGH_FACTOR) return 'High'
  return 'Standard'
}

/** The AAC bitrates to ask the encoder for, best first: the one asked, then
 *  each step under it. */
export function aacSteps(asked: number): number[] {
  return [asked, ...AAC_STEPS.filter((b) => b < asked)]
}

/** The resolution scale that gives a frame `lines` high on its short side
 *  (1440: 2560 × 1440, or 1440 × 2560 for a tall frame) from a base frame. */
export function scaleForLines(baseW: number, baseH: number, lines: number): number {
  return lines / Math.max(1, Math.min(baseW, baseH))
}

/** An output size as the exporter makes it: each side even. */
export const outSize = (baseW: number, baseH: number, scale: number): [number, number] => [Math.round((baseW * scale) / 2) * 2, Math.round((baseH * scale) / 2) * 2]

/**
 * The export window's resolutions for a frame: half (fast), the project's
 * own, 1440p and 4K, each by its short side, so the names hold for any
 * project. They were fixed scales (× 4/3 "1440p", × 2 "4K upscale"): a 4K
 * project was offered 5120 × 2880 as "1440p" and 7680 × 4320 as "4K"
 * (round 12b). A size that is the project's own is offered once.
 */
export function resolutionChoices(baseW: number, baseH: number): { scale: number; w: number; h: number; label: string; title?: string }[] {
  const short = Math.max(1, Math.min(baseW, baseH))
  const out: { scale: number; w: number; h: number; label: string; title?: string }[] = []
  const add = (scale: number, label: string, title?: string): void => {
    const [w, h] = outSize(baseW, baseH, scale)
    if (out.some((o) => o.w === w && o.h === h)) return
    out.push({ scale, w, h, label: `${w} × ${h} (${label})`, ...(title ? { title } : {}) })
  }
  add(1, 'project')
  add(0.5, 'fast')
  add(scaleForLines(baseW, baseH, 1440), short > 1440 ? '1440p, smaller' : '1440p', 'YouTube gives 1440p uploads a better codec, even for viewers at 1080p; it takes longer to render')
  add(scaleForLines(baseW, baseH, 2160), short < 2160 ? '4K upscale' : '4K')
  return out.sort((a, b) => a.scale - b.scale)
}

/** The project sizes the Project tab offers (its menu). */
const MENU_SIZES = ['1920x1080', '3840x2160', '1080x1920', '2160x3840', '1080x1080', '2160x2160']

/**
 * Whether a YouTube preset (1080 or 2160 lines) gives what its name says in
 * a project of this size (phase Ç3 patch, R-6). A size of the menu: as
 * before. Any other size: only when the output is 1920 × 1080 (3840 × 2160)
 * at a size the window offers; a 1280 × 720 project stayed 1280 × 720 under
 * the name `YouTube 1080p`.
 */
export function youtubePresetHolds(lines: 1080 | 2160, baseW: number, baseH: number): boolean {
  if (MENU_SIZES.includes(`${baseW}x${baseH}`)) return true
  const s = scaleForLines(baseW, baseH, lines)
  if (!resolutionChoices(baseW, baseH).some((o) => Math.abs(o.scale - s) < 1e-9)) return false
  const [w, h] = outSize(baseW, baseH, s)
  return lines === 1080 ? w === 1920 && h === 1080 : w === 3840 && h === 2160
}

/** The export window's preset when it opens: the last one used (remembered),
 *  else Shorts / Reels for a vertical or Shorts project, else YouTube 1080p;
 *  a YouTube preset that does not hold for this project's size is Custom
 *  (phase Ç3 patch, R-6). */
export function startPresetOf(kept: string | null, p: { forSegments: boolean; shortsMode: boolean; vertical: boolean; width: number; height: number }): 'yt1080' | 'yt4k' | 'shorts' | 'custom' {
  const holds = (k: 'yt1080' | 'yt4k'): boolean => youtubePresetHolds(k === 'yt4k' ? 2160 : 1080, p.width, p.height)
  const shortsOk = p.forSegments || p.shortsMode || p.vertical
  if (p.forSegments) return 'shorts'
  if (kept === 'custom') return 'custom'
  if (kept === 'yt1080' || kept === 'yt4k') return p.shortsMode ? 'shorts' : holds(kept) ? kept : 'custom'
  if (kept === 'shorts' && shortsOk) return 'shorts'
  if (p.shortsMode || p.vertical) return 'shorts'
  return holds('yt1080') ? 'yt1080' : 'custom'
}

/** Whether `Normalize (−14 LUFS)` starts ticked (phase Ç3 patch, S-4): for a
 *  video under a YouTube preset only; the sound alone starts unticked (a
 *  −9 LUFS master was turned down 5 dB without a word). */
export function normalizeByDefault(kind: string, preset: string): boolean {
  return kind === 'video' && (preset === 'yt1080' || preset === 'yt4k')
}

/** The export window's typed bitrate (Mb/s): the field's range. */
export const CUSTOM_MBPS_MIN = 1
export const CUSTOM_MBPS_MAX = 300

/**
 * The typed bitrate the export window opens with (the user's list, item 5,
 * SnippStudio KLISTE-PLAN.md): the last one typed comes back when the window
 * opens on the Custom preset, kept in the field's range as a whole number;
 * 0 (the quality choices) for any other preset or anything else read back.
 */
export function customMbpsAtStart(preset: string, stored: string | null): number {
  if (preset !== 'custom' || stored === null) return 0
  const n = Number(stored)
  if (!Number.isFinite(n) || n <= 0) return 0
  return Math.min(CUSTOM_MBPS_MAX, Math.max(CUSTOM_MBPS_MIN, Math.round(n)))
}
