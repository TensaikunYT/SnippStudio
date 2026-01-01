// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
import type { Caption } from '../types'
import { uid } from '../types'

/**
 * The text of a subtitle file from its bytes. A byte-order mark says UTF-8
 * or UTF-16 (Notepad's "Unicode"); a UTF-16 file without one is told by its
 * zero bytes; anything else is UTF-8 when it is valid UTF-8, and otherwise
 * the Turkish Windows code page (Windows-1254, a superset of the ISO-8859-9
 * letters), the usual legacy encoding of Turkish subtitle files. File.text()
 * always read UTF-8, so every ş/ğ/ı/İ of such a file came in as '�' and a
 * UTF-16 file found no subtitles at all.
 */
export function decodeSubtitleBytes(input: ArrayBuffer | Uint8Array): string {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input)
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) return new TextDecoder('utf-8').decode(bytes)
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder('utf-16le').decode(bytes)
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder('utf-16be').decode(bytes)
  // No mark: subtitle text is mostly ASCII, so UTF-16 shows as a zero in
  // every other byte (the high byte: odd places little-endian, even big).
  const probe = Math.min(bytes.length, 1024) & ~1
  if (probe >= 4) {
    let even = 0
    let odd = 0
    for (let i = 0; i < probe; i += 2) {
      if (bytes[i] === 0) even++
      if (bytes[i + 1] === 0) odd++
    }
    const pairs = probe / 2
    if (odd > pairs * 0.4 && even < pairs * 0.05) return new TextDecoder('utf-16le').decode(bytes)
    if (even > pairs * 0.4 && odd < pairs * 0.05) return new TextDecoder('utf-16be').decode(bytes)
  }
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    return new TextDecoder('windows-1254').decode(bytes)
  }
}

/** Seconds of an SRT time ("00:01:02,345"), or NaN. */
function srtSeconds(t: string): number {
  const m = /^(\d+):(\d+):(\d+)[,.](\d+)$/.exec(t.trim())
  if (!m) return NaN
  // Milliseconds: pad short fractions, but TRUNCATE long ones. Some tools
  // write microseconds (",123456"), and taking that as milliseconds put the
  // cue two minutes into the video.
  const frac = m[4].slice(0, 3).padEnd(3, '0')
  return Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) + Number(frac) / 1000
}

/** A timing line's start and end, or null when the line is not one. Some
 *  tools write position after the end time ("… X1:100 X2:600"). */
function srtTiming(line: string): { start: number; end: number } | null {
  const parts = line.split('-->')
  if (parts.length !== 2) return null
  const start = srtSeconds(parts[0])
  const end = srtSeconds(parts[1].trim().split(/\s+/)[0] ?? '')
  return Number.isFinite(start) && Number.isFinite(end) ? { start, end } : null
}

/**
 * Parses SubRip (.srt) text — or the file's bytes, see decodeSubtitleBytes —
 * into caption objects (subtitle lane).
 *
 * Line by line: every timing line starts a cue, and its text runs to the
 * first blank line. A line of only spaces after the text counts as blank (it
 * used to glue the next cue, index and timing line included, onto this
 * one's text), and a cue that follows with no blank line between takes its
 * index line back from the text before it.
 */
export function parseSrt(input: string | ArrayBuffer | Uint8Array): Caption[] {
  const text = typeof input === 'string' ? input : decodeSubtitleBytes(input)
  const out: Caption[] = []
  let cue: { start: number; end: number; body: string[] } | null = null
  let ended = false
  let lastBodyLine = -1
  const finish = (): void => {
    if (!cue) return
    const body = cue.body
      .join(' ')
      .replace(/<[^>]+>/g, '') // strip formatting tags
      .trim()
    if (cue.end > cue.start && body) out.push({ id: uid(), start: cue.start, end: cue.end, text: body })
    cue = null
  }
  const lines = text.replace(/^﻿/, '').replace(/\r+\n/g, '\n').replace(/\r/g, '\n').split('\n')
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    // The index line is optional in the wild; the timing line has the arrow.
    const timing = line.includes('-->') ? srtTiming(line) : null
    if (timing) {
      if (cue && !ended && lastBodyLine === i - 1 && /^\s*\d+\s*$/.test(cue.body[cue.body.length - 1] ?? '')) cue.body.pop()
      finish()
      cue = { ...timing, body: [] }
      ended = false
      continue
    }
    if (!line.trim()) {
      // An empty line always ends the cue; one of only spaces once its text
      // has begun (right under the timing line it was always passed over).
      if (cue && (line === '' || cue.body.length > 0)) ended = true
      continue
    }
    if (cue && !ended) {
      cue.body.push(line)
      lastBodyLine = i
    }
  }
  finish()
  return out.sort((x, y) => x.start - y.start)
}

function srtTime(seconds: number): string {
  const ms = Math.max(0, Math.round(seconds * 1000))
  const h = Math.floor(ms / 3600000)
  const m = Math.floor((ms % 3600000) / 60000)
  const s = Math.floor((ms % 60000) / 1000)
  const rest = ms % 1000
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')},${String(rest).padStart(3, '0')}`
}

/**
 * Standard SubRip (.srt) serialization of the SUBTITLE lane.
 *
 * Text layers (layer 1 and up) are on-screen graphics — titles, callouts — not
 * subtitles. Writing them into the .srt mixed them in with the spoken lines, so
 * the file uploaded to YouTube carried every title card as dialogue.
 */
/**
 * SRT from the captions.
 *
 * `perWord` writes one cue per WORD from the recogniser's own word timings
 * instead of one per sentence. Sentence cues are what a viewer reads; word
 * cues are what another tool wants when it is going to re-time or re-style
 * them, because they carry the timing at the resolution it was measured at.
 * Any caption without word timings (hand-typed text, an imported file) still
 * writes its sentence cue.
 */
export function captionsToSrt(captions: Caption[], opts: { perWord?: boolean } = {}): string {
  return cuesOf(captions, opts)
    .map((q, i) => `${i + 1}\n${srtTime(q.start)} --> ${srtTime(q.end)}\n${q.text}\n`)
    .join('\n')
}

/**
 * WebVTT (.vtt) of the same cues (çekirdek cila S): the header, a full stop
 * before the milliseconds, and "-->" inside a cue's text written as "->"
 * (the one thing a cue's text may not hold).
 */
export function captionsToVtt(captions: Caption[], opts: { perWord?: boolean } = {}): string {
  const cues = cuesOf(captions, opts)
  if (cues.length === 0) return ''
  const time = (t: number): string => srtTime(t).replace(',', '.')
  return 'WEBVTT\n\n' + cues.map((q, i) => `${i + 1}\n${time(q.start)} --> ${time(q.end)}\n${q.text.replace(/-->/g, '->')}\n`).join('\n')
}

/** The cues both writers put out. */
function cuesOf(captions: Caption[], opts: { perWord?: boolean }): { start: number; end: number; text: string }[] {
  // Layer 0 only, and never a shape — a rectangle has no line of dialogue.
  const sorted = captions
    .filter((c) => (c.layer ?? 0) === 0 && !c.shape)
    .sort((a, b) => a.start - b.start)
  const cues: { start: number; end: number; text: string }[] = []
  const pushCue = (start: number, end: number, text: string) => {
    const clean = text.trim()
    if (!clean || !Number.isFinite(start) || !Number.isFinite(end) || end <= start) return
    cues.push({ start, end, text: clean })
  }
  for (const c of sorted) {
    if (opts.perWord && c.words && c.words.length > 0) {
      for (const w of c.words) {
        pushCue(w.start, Math.max(w.end, w.start + 0.05), w.text)
      }
    } else {
      pushCue(c.start, c.end, c.text)
    }
  }
  return cues
}
