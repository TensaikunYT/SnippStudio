// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// Before the export: what would look or sound wrong in the finished video —
// stretches with nothing to see, media that is missing, a picture standing
// still too long, the same picture twice in a row, a sudden loud peak. Each
// with where it is, so one click takes you there.

import type { Clip, Project } from '../types'
import { assetById, flatClipsOfTrack, isPictureAsset, projectDuration } from '../types'
import { lutMissing } from '../playback/draw/lut-table'
import type { StringKey } from '../ui/strings'

export type PreflightKind = 'gap' | 'missing' | 'still' | 'repeat' | 'loud'

/** A finding as the interface says it (phase 9 audit patch D3): the key of
 *  its words and its values, raw (the list writes the numbers and times in
 *  the interface's language). Its English is `text` word for word. */
export interface PreflightSay {
  key: StringKey
  /** A length in seconds, written with one decimal. */
  s?: number
  /** A stretch's start and end, as times. */
  from?: number
  to?: number
  n?: number
  name?: string
  /** An engine's message (a code film's error), put into words where shown. */
  why?: string
}

export interface PreflightIssue {
  kind: PreflightKind
  /** Where (project seconds), and to where for a stretch. */
  at: number
  end?: number
  clipId?: string
  /** In English: what the agent's analyze "preflight" reads. */
  text: string
  say?: PreflightSay
}

export const PREFLIGHT_INFO: Record<PreflightKind, { icon: string; label: string }> = {
  gap: { icon: '▮', label: 'Nothing to see' },
  missing: { icon: '⚠', label: 'Missing media' },
  still: { icon: '⏸', label: 'Stands still' },
  repeat: { icon: '⧉', label: 'Twice in a row' },
  loud: { icon: '📢', label: 'Loud peak' }
}

/** The fonts a project's texts are drawn in, each once, with where it is
 *  first seen (the subtitle style, a line's own style or font, a template's
 *  headline font). Phase 10a.6. */
export function fontsUsed(p: Project): { family: string; at: number }[] {
  const at = new Map<string, number>()
  const see = (family: string | undefined, t: number): void => {
    if (!family) return
    const was = at.get(family)
    if (was === undefined || t < was) at.set(family, t)
  }
  const caps = [...(p.captions ?? [])].sort((a, b) => a.start - b.start)
  const first = caps.length ? caps[0].start : 0
  see(p.captionStyle?.fontFamily, first)
  see(p.captionStyleShorts?.fontFamily, first)
  for (const c of caps) {
    see(c.style?.fontFamily, c.start)
    see(c.font, c.start)
  }
  for (const tb of p.templates ?? []) see(tb.style?.font, tb.start)
  return [...at].map(([family, t]) => ({ family, at: t })).sort((a, b) => a.at - b.at || a.family.localeCompare(b.family))
}

const fmt = (t: number): string => `${Math.floor(t / 60)}:${(t % 60).toFixed(1).padStart(4, '0')}`

/** Does this clip put a picture on screen? */
function shows(p: Project, c: Clip): boolean {
  if (c.disabled || c.adjustment) return false
  if (c.automationMissing) return true
  if (c.nested) return true
  const a = assetById(p, c.assetId)
  return isPictureAsset(a)
}

/** Does a picture move by itself (a slow push, keyframes, a drift, an
 *  entrance or exit)? */
function moves(c: Clip): boolean {
  if (c.motionFx) return true
  const ch = c.channels
  if (ch && (['x', 'y', 'scale', 'rotation'] as const).some((k) => (ch[k]?.length ?? 0) >= 2)) return true
  if (c.idle && c.idle.amount > 0) return true
  return !!((c.anim?.in && c.anim.in !== 'none') || (c.anim?.out && c.anim.out !== 'none'))
}

/** Everything that can be found without listening. */
export function preflight(p: Project, opts: { stillMax?: number; codeFilmError?: (assetId: string) => string | null; lutMissing?: (name: string) => boolean; fontMissing?: (family: string) => boolean } = {}): PreflightIssue[] {
  const stillMax = opts.stillMax ?? 8
  const out: PreflightIssue[] = []
  const end = projectDuration(p)
  const visible = p.tracks.filter((t) => t.kind === 'video' && !t.hidden)

  // Stretches with nothing to see (templates count: they draw).
  const spans: [number, number][] = []
  for (const t of visible) for (const id of t.clipIds) {
    const c = p.clips[id]
    if (c && shows(p, c)) spans.push([c.start, c.start + c.duration])
  }
  for (const b of p.templates ?? []) spans.push([b.start, b.start + b.duration])
  spans.sort((a, b) => a[0] - b[0])
  let reach = 0
  for (const [a, b] of spans) {
    if (a - reach >= 0.1) out.push({ kind: 'gap', at: reach, end: a, text: `${(a - reach).toFixed(1)} s with nothing to see${p.backdrop ? ' (only the background)' : ' — black'} (${fmt(reach)}–${fmt(a)})`, say: { key: p.backdrop ? 'pre.f9y.gapBackdrop' : 'pre.f9y.gap', s: a - reach, from: reach, to: a } })
    reach = Math.max(reach, b)
  }
  if (end - reach >= 0.1 && spans.length) out.push({ kind: 'gap', at: reach, end, text: `The last ${(end - reach).toFixed(1)} s have nothing to see (the sound goes on)`, say: { key: 'pre.f9y.gapEnd', s: end - reach } })

  // Missing media, once per file (or per empty numbered slot).
  const seen = new Set<string>()
  for (const t of p.tracks) for (const id of t.clipIds) {
    const c = p.clips[id]
    if (!c || c.disabled || c.adjustment || c.nested) continue
    if (c.automationMissing) {
      out.push({ kind: 'missing', at: c.start, clipId: c.id, text: `Picture #${c.automationMissing.number} was never added — an empty slot`, say: { key: 'pre.f9y.slot', n: c.automationMissing.number } })
      continue
    }
    const a = assetById(p, c.assetId)
    if (a && !a.missing) continue
    const key = c.assetId || c.id
    if (seen.has(key)) continue
    seen.add(key)
    const n = Object.values(p.clips).filter((q) => q.assetId === c.assetId).length
    out.push({ kind: 'missing', at: c.start, clipId: c.id, text: `${a ? `“${a.name}”` : 'A file'} is missing${n > 1 ? ` (${n} clips)` : ''}`, say: { key: a ? (n > 1 ? 'pre.f9y.missingMany' : 'pre.f9y.missing') : n > 1 ? 'pre.f9y.fileMissingMany' : 'pre.f9y.fileMissing', name: a?.name, n } })
  }

  // A LUT that cannot be drawn ("cila" part D): its file is not where the
  // project says, or it was kept on another computer. Once per LUT; the clip
  // is drawn without it.
  const noLut = opts.lutMissing ?? lutMissing
  const saidLut = new Set<string>()
  for (const t of visible) for (const id of t.clipIds) {
    const c = p.clips[id]
    if (!c || c.disabled || !c.lut || saidLut.has(c.lut) || !noLut(c.lut)) continue
    saidLut.add(c.lut)
    const n = Object.values(p.clips).filter((q) => q.lut === c.lut).length
    out.push({ kind: 'missing', at: c.start, clipId: c.id, text: `The LUT “${c.lut}” is missing${n > 1 ? ` (${n} clips)` : ''}: drawn without it`, say: { key: n > 1 ? 'pre.f9y.lutMany' : 'pre.f9y.lut', name: c.lut, n } })
  }

  // A font this computer does not have (phase 10a.6, F1): the text is drawn
  // in the fallback face, so its width and line breaks change. Only when the
  // window says how to tell (fonts.ts fontMissingHere: never on Windows).
  if (opts.fontMissing) {
    for (const f of fontsUsed(p)) {
      if (!opts.fontMissing(f.family)) continue
      out.push({ kind: 'missing', at: f.at, text: `The font “${f.family}” is not on this computer: the text is drawn in the system’s default face instead`, say: { key: 'pre.faz10.font', name: f.family } })
    }
  }

  // A code film whose page failed draws nothing (and stops the export).
  if (opts.codeFilmError) {
    const said = new Set<string>()
    for (const t of visible) for (const id of t.clipIds) {
      const c = p.clips[id]
      const a = c && !c.disabled ? assetById(p, c.assetId) : undefined
      if (!a || a.kind !== 'code' || a.missing || said.has(a.id)) continue
      const why = opts.codeFilmError(a.id)
      if (!why) continue
      said.add(a.id)
      out.push({ kind: 'missing', at: c.start, clipId: c.id, text: `The code film “${a.name}” does not run: ${why.split(/\r?\n/)[0]}`, say: { key: 'pre.f9y.codeFilm', name: a.name, why: why.split(/\r?\n/)[0] } })
    }
  }

  for (const t of visible) {
    const clips = t.clipIds.map((id) => p.clips[id]).filter((c): c is Clip => !!c && !c.disabled && !c.adjustment).sort((a, b) => a.start - b.start)
    clips.forEach((c, i) => {
      const a = assetById(p, c.assetId)
      // A picture standing still too long.
      if (a?.kind === 'image' && c.duration >= stillMax && !moves(c)) out.push({ kind: 'still', at: c.start, clipId: c.id, text: `“${a.name}” stands still for ${c.duration.toFixed(1)} s`, say: { key: 'pre.f9y.still', name: a.name, s: c.duration } })
      // The same picture twice in a row.
      const prev = clips[i - 1]
      if (prev && prev.assetId && prev.assetId === c.assetId && c.start - (prev.start + prev.duration) <= 0.1 && a?.kind === 'image') {
        out.push({ kind: 'repeat', at: c.start, clipId: c.id, text: `“${a.name}” comes twice in a row`, say: { key: 'pre.f9y.repeat', name: a.name } })
      }
    })
  }
  return out.sort((x, y) => x.at - y.at)
}

/**
 * Sudden loud peaks in loudness windows (`win` seconds each, starting at
 * project time `offset`): a jump well above what came just before, and loud
 * in itself. One per burst.
 */
export function loudPeaks(dbs: readonly number[], win: number, offset: number, opts: { jump?: number; floor?: number } = {}): number[] {
  const jump = opts.jump ?? 14
  const floor = opts.floor ?? -12
  const back = Math.max(4, Math.round(1.5 / win))
  const out: number[] = []
  let quietUntil = -1
  for (let i = back; i < dbs.length; i++) {
    if (i < quietUntil || dbs[i] < floor) continue
    const before = dbs.slice(i - back, i).filter((v) => Number.isFinite(v)).sort((a, b) => a - b)
    const typical = before.length ? before[Math.floor(before.length / 2)] : -90
    if (dbs[i] - Math.max(typical, -60) >= jump) {
      out.push(offset + i * win)
      quietUntil = i + Math.round(1 / win)
    }
  }
  return out
}

/**
 * Code films an export of `outH` lines would enlarge (phase Ç3a, decision
 * 10; report R4): a film draws at the size it declares, and the export
 * scales that picture to its own. A film shown at its clip's scale `s` in a
 * project `height` high is enlarged when s × outH / height > 1 (a 1920 ×
 * 1080 film fitted to a 1080p project, exported at 4K: 2×). Drawing films
 * at the output's size is phase 5's work; until then this is said.
 */
export function codeFilmsEnlarged(p: Project, outH: number): { name: string; w: number; h: number }[] {
  const out = new Map<string, { name: string; w: number; h: number }>()
  for (const t of p.tracks) {
    if (t.kind !== 'video' || t.hidden) continue
    for (const id of t.clipIds) {
      const c = p.clips[id]
      const a = c && !c.disabled ? assetById(p, c.assetId) : undefined
      if (!a || a.kind !== 'code' || a.missing || out.has(a.id)) continue
      const scale = Math.max(c.transform?.scale ?? 1, ...(c.channels?.scale ?? []).map((k) => k.value))
      const k = scale * (outH / Math.max(1, p.settings.height))
      // (Phase 5d.2, decision 6: the export asks the page to draw up to 2×
      // larger. A whole page drawn by its own window always does; a canvas
      // page may not follow devicePixelRatio, so it is still said.)
      if (a.code?.mode === 'page' && k <= 2.001) continue
      if (k > 1.001) out.set(a.id, { name: a.name, w: a.width, h: a.height })
    }
  }
  return [...out.values()]
}

/** The HDR videos (HLG / PQ) the export shows in [a, b] (phase Ç3b,
 *  decision 7; report R22): said in the export window before it starts and
 *  beside the result. Their names, once each. */
export function hdrShown(p: Project, range?: [number, number]): string[] {
  const [a, b] = range ?? [0, projectDuration(p)]
  const names = new Set<string>()
  for (const track of p.tracks) {
    if (track.kind !== 'video' || track.hidden) continue
    for (const clip of flatClipsOfTrack(p, track)) {
      if (clip.disabled || clip.start >= b || clip.start + clip.duration <= a) continue
      const asset = assetById(p, clip.assetId)
      if (asset?.hdr && !asset.missing) names.add(asset.name)
    }
  }
  return [...names]
}
