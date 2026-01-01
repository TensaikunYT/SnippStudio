// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// The test material's talks (testdata\ham, phase 2B) as projects in the app,
// for the agent scenarios (phase 4A): the video imported and on the timeline
// the app's way, the subtitles as a perfect transcript would make them (the
// .srt's lines, the truth's word times). Transcribing ten minutes takes too
// long for every run; the transcription itself has its own scenario.
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { TESTDATA } from './media.mjs'

export const HAM = join(TESTDATA, 'ham')

export const truthOf = (name) => JSON.parse(readFileSync(join(HAM, `${name}.truth.json`), 'utf8'))

function parseSrt(text) {
  const t = (s) => { const m = /(\d+):(\d+):(\d+)[,.](\d+)/.exec(s); return +m[1] * 3600 + +m[2] * 60 + +m[3] + +m[4] / 1000 }
  return text.replace(/\r/g, '').trim().split(/\n\n+/).map((block) => {
    const lines = block.split('\n')
    const [a, b] = lines[1].split('-->')
    return { start: t(a), end: t(b), text: lines.slice(2).join(' ').trim() }
  })
}

/** Subtitle lines with word times (ids like the app's: 13 characters). */
export function captionsFor(name) {
  const truth = truthOf(name)
  const lines = parseSrt(readFileSync(join(HAM, `${name}.srt`), 'utf8'))
  let k = 0
  return lines.map((l, i) => {
    const words = []
    while (k < truth.words.length && truth.words[k].start < l.end - 1e-3) {
      const w = truth.words[k++]
      words.push({ text: w.text, start: w.start, end: w.end })
    }
    return { id: `${String(i).padStart(4, '0')}${name.slice(4, 8).replace(/\W/g, '')}-c${String(i % 1000).padStart(3, '0')}`.slice(0, 13), start: l.start, end: l.end, text: l.text, words }
  })
}

/** The loudest sample (dBFS) of [a, b] of a file's sound, by ffmpeg (an
 *  independent ear: not the app's own silence finder). */
export function peakDb(file, a, b) {
  const r = spawnSync('ffmpeg', ['-hide_banner', '-nostats', '-ss', String(a), '-t', String(Math.max(0.01, b - a)), '-i', file, '-vn', '-af', 'volumedetect', '-f', 'null', '-'], { encoding: 'utf8' })
  const m = /max_volume:\s*(-?[\d.]+|-inf) dB/.exec(r.stderr ?? '')
  return m ? (m[1] === '-inf' ? -120 : Number(m[1])) : null
}

/**
 * The silence finder's ranges against a talk's truth: inserted silences found
 * (half of it covered) / missed; ranges that overlap a word's time by more
 * than 0.05 s, and of those the ones where the file is really loud (a peak
 * over -30 dBFS; the voice peaks near -7 here) — those are the wrong ones;
 * the others are word times that run into a pause (the source's alignment),
 * their loudest kept apart (near: -35…-30).
 */
/** Ceilings of the strict "wrong" (cuts more than 0.05 s into a word's
 *  time) per talk, asserted by scenarios 22 and 28 (phase 4A.8, T7): the
 *  measured count (FAZ4A-PLAN.md 6) and a little room. */
export const SILENCE_WRONG_MAX = { 'ham-02dk-en': 4, 'ham-10dk-tr': 18, 'ham-30dk-en': 36 }
/** Cuts into a word's time where the file is really loud (a peak over
 *  -30 dBFS): speech was cut. None in the 2- and 10-minute talks; one known
 *  in the 30-minute one (phase 4A.9, T7). */
export const SILENCE_LOUD_MAX = { 'ham-02dk-en': 0, 'ham-10dk-tr': 0, 'ham-30dk-en': 1 }

/**
 * What a silence finder must hold against the truth (phase 4A.9, T7): each
 * line fails for its own kind of wrong, not for a count drifting past a
 * measured number.
 * - inserted pauses missed: at most 10 %;
 * - cuts that take loud sound inside a word (speech): SILENCE_LOUD_MAX;
 * - cuts that reach more than 0.05 s into a word's time: at most 12 % of the
 *   cuts (measured 0 %, 11 %, 8 %: word times that run into a pause);
 * - the seconds cut inside words: at most 2 % of all that is cut (measured
 *   0.04 %, 1.9 %, 1.2 %): a finder that eats words fails here whatever the
 *   number of its cuts;
 * - the total: not less than 80 % of the truth's ideal rough cut (a finder
 *   that cuts too little), and what is cut beyond the ideal is pauses, not
 *   words (the line above).
 */
export function assertSilence(assert, talk, hits) {
  assert.ok(hits.missed <= Math.ceil(hits.inserted * 0.1), `${talk}: ${hits.missed} of ${hits.inserted} inserted pauses missed`)
  assert.ok(hits.wrongLoud <= SILENCE_LOUD_MAX[talk], `${talk}: ${hits.wrongLoud} cuts take loud sound inside a word (at most ${SILENCE_LOUD_MAX[talk]}): ${JSON.stringify(hits.loud)}`)
  assert.ok(hits.wrong <= Math.ceil(hits.regions * 0.12), `${talk}: ${hits.wrong} of ${hits.regions} cuts reach into a word's time (at most 12 %)`)
  assert.ok(hits.overCutInWords <= hits.cutSeconds * 0.02, `${talk}: ${hits.overCutInWords} s of ${hits.cutSeconds} s cut lie inside words (at most 2 %)`)
  assert.ok(hits.cutSeconds >= hits.idealSeconds * 0.8, `${talk}: cut ${hits.cutSeconds} s, the ideal rough cut is ${hits.idealSeconds} s`)
}

export function silenceHits(name, truth, ranges) {
  const inserted = truth.segments.filter((s) => s.type === 'silence')
  const over = (a, b, s) => Math.max(0, Math.min(b, s.end) - Math.max(a, s.start))
  const hit = inserted.filter((s) => ranges.some(([a, b]) => over(a, b, s) >= 0.5 * (s.end - s.start)))
  // Phase 4A.8 (T7): "wrong" is strict now: every cut that goes more than
  // 0.05 s into a word's time, whatever the sound there. The loud ones (a
  // peak over -30 dBFS: the old measure) are kept apart.
  const intoWords = ranges.filter(([a, b]) => truth.words.some((w) => over(a, b, w) > 0.05))
  const file = join(HAM, `${name}.mp4`)
  const peaks = intoWords.map(([a, b]) => [a, b, peakDb(file, a, b) ?? 0])
  const loud = peaks.filter((x) => x[2] > -30)
  const near = peaks.filter((x) => x[2] > -35 && x[2] <= -30)
  const atInserted = ranges.filter(([a, b]) => inserted.some((s) => over(a, b, s) > 0)).length
  // The total cut against the truth's ideal rough cut: how much more was
  // cut, and of what (inside a word's time, or a natural pause).
  const total = ranges.reduce((n, [a, b]) => n + b - a, 0)
  const ideal = truth.cuts.reduce((n, [a, b]) => n + b - a, 0)
  const inIdeal = ranges.reduce((n, [a, b]) => n + truth.cuts.reduce((m, [x, y]) => m + Math.max(0, Math.min(b, y) - Math.max(a, x)), 0), 0)
  const inWords = ranges.reduce((n, [a, b]) => n + truth.words.reduce((m, w) => m + over(a, b, w), 0), 0)
  const r2 = (x) => Math.round(x * 100) / 100
  return {
    inserted: inserted.length, found: hit.length, missed: inserted.length - hit.length,
    wrong: intoWords.length, wrongLoud: loud.length, regions: ranges.length, naturalPauses: ranges.length - atInserted,
    cutSeconds: r2(total), idealSeconds: r2(ideal), overCutSeconds: r2(total - inIdeal), overCutInWords: r2(inWords), overCutInPauses: r2(total - inIdeal - inWords),
    loud, near
  }
}

/** The source seconds the first video track still shows (the talk is one
 *  file from 0 on the timeline, so source seconds are the truth's times). */
export const keptSource = (project) => {
  const v1 = project.tracks.find((t) => t.kind === 'video')
  return v1.clipIds.map((id) => project.clips[id]).filter(Boolean).sort((a, b) => a.start - b.start).map((k) => [k.inPoint, k.inPoint + k.duration * (k.speed ?? 1)])
}

/**
 * A rough cut against the truth, by WHICH words are left (phase 4A.8): words
 * that should stay but are more than half gone ("wrongly cut"), words of a
 * take that should go but are more than half there, and the retakes whose
 * dropped take is still more than half there ("missed").
 */
export function judgeRoughCut(truth, kept) {
  const shown = (a, b) => kept.reduce((n, [x, y]) => n + Math.max(0, Math.min(b, y) - Math.max(a, x)), 0)
  const drop = truth.segments.filter((s) => s.type === 'repeat').map((s) => truth.segments[s.retakeOf])
  const inDrop = (w) => drop.some((s) => w.start >= s.start - 1e-3 && w.end <= s.end + 1e-3)
  let wronglyCut = 0, leftOfDropped = 0, keptWords = 0
  const wrong = []
  for (const w of truth.words) {
    const frac = shown(w.start, w.end) / Math.max(1e-6, w.end - w.start)
    if (inDrop(w)) { if (frac > 0.5) leftOfDropped++ }
    else if (frac < 0.5) { wronglyCut++; if (wrong.length < 12) wrong.push(`${w.text}@${w.start}`) }
    else keptWords++
  }
  const missedRepeats = drop.filter((s) => shown(s.start, s.end) > 0.5 * (s.end - s.start)).length
  return { words: truth.words.length, keptWords, wronglyCut, leftOfDropped, retakes: drop.length, missedRepeats, wrong }
}

/** The talk imported, on the timeline, with its subtitles; the project clean. */
export async function loadTalk({ c, app, lib, name }) {
  const [asset] = await lib.seedAssets(app, c, [join(HAM, `${name}.mp4`)])
  await lib.seedTimeline(c, [asset.id])
  await c.run((caps) => {
    const s = window.__store.getState()
    s.setSubtitles(caps)
    s.setDirty(false)
  }, captionsFor(name))
  return { asset, truth: truthOf(name) }
}
