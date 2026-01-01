// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// The analyze tool (SnippStudio phase 4A, ANA-PLAN.md §2 rules 1–2): the app
// measures, the agent decides. Every kind gives a numbered list and a result
// id; edit {"op":"apply","result":id,"except":[…]} turns the list into
// commands without the agent writing the numbers back.
import type { Caption, Clip, Project } from '../types'
import { isSubtitle } from '../types'
import type { CommandCall } from '../commands'
import { ANALYSIS_WINDOW, carriesAudio, clipLoudnessDb, autoThresholdDb, silenceRangesFromDb, type SilencePace, type SilenceSensitivity, type Cancel } from '../audio/silence'
import { bedTracks, silenceRanges } from '../commands/timeline'
import { flattenWords, guessedTime, normalizeWord, type FlatWord } from '../analysis/words'
import { speechTrack, type TrackSound } from '../analysis/voice'
import { audioIslands, fillerCutRanges, fillerDoubt, fillerHits, fillerLanguage, fillerSet } from '../analysis/fillers'
import { voiceClipIds } from '../subtitles/follow'
import { findRepeats, unwrittenRetakes } from '../analysis/repeats'
import { sec } from './format'
import { anchorTrack } from './content'
import { brollLine, fillerLine, imageLine, islandLine, keywordLine, loudnessLine, preflightLine, repeatLine, silenceLine, unwrittenLine, UNWRITTEN_HEADING, type AnalysisResult, type Item } from './answers'

export type AnalyzeKind = 'silences' | 'fillers' | 'repeats' | 'audio' | 'preflight' | 'image_plan' | 'broll_plan' | 'keywords'
export const ANALYZE_KINDS: readonly AnalyzeKind[] = ['silences', 'fillers', 'repeats', 'audio', 'preflight', 'image_plan', 'broll_plan', 'keywords']

export interface AnalyzeArgs {
  kind: AnalyzeKind
  start?: number
  end?: number
  min?: number
  sensitivity?: SilenceSensitivity
  words?: string
  beats?: boolean
  grouping?: 'cue' | 'sentence'
}

export type { AnalysisResult, Item } from './answers'

const inRange = (a: number, b: number, args: { start?: number; end?: number }): boolean => (args.start === undefined || b > args.start) && (args.end === undefined || a < args.end)

/** Overlapping or touching ranges as one. */
function union(ranges: [number, number][]): [number, number][] {
  const s = [...ranges].sort((x, y) => x[0] - y[0])
  const out: [number, number][] = []
  for (const [a, b] of s) {
    const last = out[out.length - 1]
    if (last && a <= last[1] + 1e-3) last[1] = Math.max(last[1], b)
    else out.push([a, b])
  }
  return out
}

const cutsOf = (items: Item[]): CommandCall[] => {
  const ranges = items.map((i) => i.cut).filter((r): r is [number, number] => !!r)
  return ranges.length ? [{ name: 'timeline.cutRanges', params: { ranges: union(ranges) } }] : []
}

const subtitles = (p: Project): Caption[] => p.captions.filter(isSubtitle).sort((a, b) => a.start - b.start)

/** The analysis arguments the schema knows, in a fixed order: the key of
 *  "the same question" (G6: an unknown field does not make a new one). */
export function analyzeKey(args: Record<string, unknown>): string {
  const pick = ['kind', 'start', 'end', 'min', 'sensitivity', 'words', 'beats', 'grouping'] as const
  return JSON.stringify(pick.map((k) => args[k] ?? null))
}

export type ReadLoudness = (project: Project, clip: Clip, win: number, signal?: Cancel) => Promise<number[] | null>

/**
 * The clips the speech is in, each with its loudness (0.04 s windows). When
 * more than one track sounds under the words (a voice-over under a music
 * bed, a talking video over music), the track is told by its sound: loud
 * while the words are said, quiet between them (analysis/voice.ts; phase
 * 4A.9, T3: the subtitles' own choice goes by track kind and order and named
 * the music there). With one track, or none that stands out, the subtitles'
 * choice.
 */
export async function speechClips(project: Project, words: readonly FlatWord[], read: ReadLoudness, signal?: Cancel, failed: string[] = []): Promise<{ clip: Clip; dbs: number[] }[]> {
  const get = async (clip: Clip): Promise<number[] | null> => {
    if (signal?.cancelled()) throw new Error('cancelled')
    return read(project, clip, ANALYSIS_WINDOW, signal).catch((e) => {
      if (signal?.cancelled()) throw e
      return null
    })
  }
  const sounding = Object.values(project.clips).filter((c) => carriesAudio(project, c))
  let voice = voiceClipIds(project)
  // No subtitles: the talk is the track the agent's seconds are about (the
  // talking picture's, agent/content.ts anchorTrack), never the longest
  // sound; when that cannot be told, no clip is the speech.
  if (!voice.size && !words.length) {
    const anchor = anchorTrack(project)
    voice = new Set(sounding.filter((c) => c.trackId === anchor).map((c) => c.id))
  }
  const got = new Map<string, number[] | null>()
  if (words.length > 1) {
    const a = words[0].start
    const b = words.reduce((m, w) => Math.max(m, w.end), 0)
    const under = sounding.filter((c) => c.start < b && c.start + c.duration > a)
    const tracks = [...new Set(under.map((c) => c.trackId))]
    if (tracks.length > 1) {
      const sounds: TrackSound[] = []
      for (const t of tracks) {
        const list: TrackSound['clips'] = []
        // (Two dozen clips of a track are enough to tell.)
        for (const c of under.filter((x) => x.trackId === t).slice(0, 24)) {
          const dbs = await get(c)
          got.set(c.id, dbs)
          if (dbs) list.push({ start: c.start, dbs })
        }
        sounds.push({ track: t, clips: list })
      }
      const best = speechTrack(sounds, ANALYSIS_WINDOW, words)
      if (best) voice = new Set(sounding.filter((c) => c.trackId === best).map((c) => c.id))
    }
  }
  const out: { clip: Clip; dbs: number[] }[] = []
  for (const clip of sounding) {
    if (!voice.has(clip.id)) continue
    const dbs = got.has(clip.id) ? got.get(clip.id)! : await get(clip)
    if (dbs) out.push({ clip, dbs })
    else failed.push(clip.id)
  }
  return out.sort((a, b) => a.clip.start - b.clip.start)
}

/** Clips measured one by one by analyze audio (the whole mix after them). */
export const AUDIO_CLIPS_MAX = 20

/** Words of the subtitles a silence range may not enter: a range that takes
 *  more than this of a word is not surely a pause (phase 4A.10, D1). */
const WORD_TOUCH = 0.05
/** Another clip is at speech level under a pause when it is as loud as the
 *  speech's loud level (its 85th percentile) less this many dB (phase
 *  4A.11, N3): a guest, a second speaker; a music bed mixed under the voice
 *  is not. */
const SPEECH_BELOW = 10
const loudLevel = (dbs: readonly number[]): number => {
  const s = [...dbs].sort((a, b) => a - b)
  return s.length ? s[Math.min(s.length - 1, Math.max(0, Math.round(0.85 * (s.length - 1))))] : -90
}

/** What findSilences is asked. */
export interface SilenceFindOptions {
  sensitivity?: SilenceSensitivity
  /** A dBFS threshold given by hand: the clips' own calibration is skipped. */
  thresholdDb?: number
  minDuration: number
  pad: number
  pace: SilencePace
  /** The agent's start / end: a range that reaches into them is listed whole. */
  within?: { start?: number; end?: number }
  /** The clips to listen to (the user's pick); not given: the speech
   *  (speechClips). */
  sources?: readonly Clip[]
  /** With several clips listened to: only where every one of them is quiet
   *  (commands/timeline.ts silenceRanges, the cut's own rule); not set: each
   *  one's pauses, joined (the speech lies on one track). */
  everyQuiet?: boolean
  /** Only inside this stretch of the timeline: the ranges are cut to it. */
  limit?: readonly [number, number] | null
  /** The cut leaves the music bed alone (commands/timeline.ts bedTracks):
   *  a clip there is not "another voice under the pause". */
  keepMusic?: boolean
}

/** What it found: the pauses that are surely pauses, the ones that are not
 *  (and why), each clip listened to with its loudness and threshold, the
 *  clips that could not be read. */
export interface SilenceFind {
  speech: { clip: Clip; dbs: number[] }[]
  failed: string[]
  thresholds: number[]
  thresholdDbs: Record<string, number>
  sure: [number, number][]
  unsure: { r: [number, number]; why: string }[]
  /** The tracks the cut will leave alone (keepMusic). */
  keepTracks: string[]
}

/**
 * The one silence finder (çekirdek cila S, decision 5): the agent's
 * `analyze silences` and the user's "Remove silence" window both read it.
 */
export async function findSilences(project: Project, o: SilenceFindOptions, loudness: ReadLoudness = clipLoudnessDb, signal?: Cancel): Promise<SilenceFind> {
      // Pauses of the SPEECH only (phase 4A.10, D1, analyses#1): the clips
      // fillers and repeats read, never a music bed, an effect that ends in
      // digital silence or a B-roll with an empty sound track (a cut there
      // would ripple through the talk's words).
      const words = flattenWords(subtitles(project))
      const failed: string[] = []
      let heard: { clip: Clip; dbs: number[] }[] = []
      if (o.sources) {
        // The user's pick: each clip read (one that cannot be is "failed").
        for (const clip of [...o.sources].sort((a, b) => a.start - b.start)) {
          if (signal?.cancelled()) throw new Error('cancelled')
          const dbs = await loudness(project, clip, ANALYSIS_WINDOW, signal).catch((e) => {
            if (signal?.cancelled()) throw e
            return null
          })
          if (dbs) heard.push({ clip, dbs })
          else failed.push(clip.id)
        }
      } else {
        const speech = await speechClips(project, words, loudness, signal, failed)
        heard = speech
      }
      const speech = heard
      if (signal?.cancelled()) throw new Error('cancelled')
      const opts = { minDuration: o.minDuration, pad: o.pad, pace: o.pace }
      const thresholds: number[] = []
      const thresholdDbs: Record<string, number> = {}
      const found: [number, number][] = []
      const regions: { clipId: string; start: number; end: number }[] = []
      // The level of speech (phase 4A.11, N3): the speech's own loud level
      // less SPEECH_BELOW dB, never under its silence threshold.
      let speechLevel = Infinity
      for (const { clip, dbs } of speech) {
        const thr = o.thresholdDb ?? autoThresholdDb(dbs, o.sensitivity ?? 'balanced')
        thresholds.push(thr)
        thresholdDbs[clip.id] = thr
        speechLevel = Math.min(speechLevel, Math.max(thr, loudLevel(dbs) - SPEECH_BELOW))
        for (const r of silenceRangesFromDb(dbs, thr, opts)) {
          found.push([clip.start + Math.max(0, r.start), clip.start + Math.min(clip.duration, r.end)])
          regions.push({ clipId: clip.id, start: found[found.length - 1][0], end: found[found.length - 1][1] })
        }
      }
      const mine = new Set([...speech.map((x) => x.clip.id), ...failed])
      const all = o.everyQuiet ? union(silenceRanges(project, regions, [...mine])) : union(found)
      const lim = o.limit
      const ranges = (lim ? all.map(([a, b]): [number, number] => [Math.max(a, lim[0]), Math.min(b, lim[1])]).filter(([a, b]) => b - a >= LIMIT_MIN) : all).filter(([a, b]) => inRange(a, b, o.within ?? {}))
      // A range that enters a subtitle word by more than 0.05 s is not surely
      // a pause: listed apart, cut only when named (include).
      const touches = ([a, b]: [number, number]): boolean => words.some((w) => Math.min(b, w.end) - Math.max(a, w.start) > WORD_TOUCH)
      // Nor is one under which another sounding clip (unlocked: a cut there
      // takes it too) is at speech level: a guest with no subtitles, a second
      // speaker (phase 4A.11, N3). Each such clip is read once.
      // (A clip of a track the cut leaves alone loses nothing to it.)
      const keepTracks = o.keepMusic ? bedTracks(project, [...mine]) : []
      const others = Object.values(project.clips).filter((c) => carriesAudio(project, c) && !mine.has(c.id) && !keepTracks.includes(c.trackId))
      const otherDbs = new Map<string, number[] | null>()
      const voiceUnder = async ([a, b]: [number, number]): Promise<string | null> => {
        for (const c of others) {
          if (c.start >= b || c.start + c.duration <= a) continue
          if (!otherDbs.has(c.id)) {
            if (signal?.cancelled()) throw new Error('cancelled')
            otherDbs.set(c.id, await loudness(project, c, ANALYSIS_WINDOW, signal).catch((e) => {
              if (signal?.cancelled()) throw e
              return null
            }))
          }
          const dbs = otherDbs.get(c.id)
          if (!dbs) return `${c.id} not read`
          const i0 = Math.max(0, Math.floor((a - c.start) / ANALYSIS_WINDOW))
          const i1 = Math.min(dbs.length, Math.ceil((b - c.start) / ANALYSIS_WINDOW))
          for (let i = i0; i < i1; i++) if (dbs[i] >= speechLevel) return `${c.id} at speech level`
        }
        return null
      }
      const sure: [number, number][] = []
      const unsure: { r: [number, number]; why: string }[] = []
      for (const r of ranges) {
        const why = touches(r) ? 'enters a word' : await voiceUnder(r)
        if (why) unsure.push({ r, why })
        else sure.push(r)
      }
      if (signal?.cancelled()) throw new Error('cancelled')
  return { speech, failed, thresholds, thresholdDbs, sure, unsure, keepTracks }
}

/** A piece of a pause a limit left shorter than this is not worth a cut
 *  (audio/silence.ts MIN_CUT). */
const LIMIT_MIN = 0.06

/** Runs one analysis on `project` (the view the agent reads). `signal`
 *  stops a long one between (and inside) the sound reads. `deps` is for
 *  tests (the loudness reader). */
export async function analyze(
  project: Project,
  args: AnalyzeArgs,
  id: string,
  token: string,
  signal?: Cancel,
  deps: {
    loudness?: ReadLoudness
    measureClip?: (p: Project, clipId: string, signal?: AbortSignal) => Promise<{ lufs: number; peakDb: number }>
    measureProject?: (p: Project, signal?: AbortSignal) => Promise<{ lufs: number; peakDb: number }>
    beats?: (p: Project, clipId: string, signal?: Cancel) => Promise<{ bpm: number; beats: number[] } | null>
  } = {}
): Promise<AnalysisResult> {
  const loudness = deps.loudness ?? clipLoudnessDb
  const base = { id, kind: args.kind, token, project }
  switch (args.kind) {
    case 'silences': {
      // (The finder is findSilences below: the user's silence window reads
      // the same one, çekirdek cila S, decision 5.)
      const { speech, failed, thresholds, sure, unsure } = await findSilences(project, { sensitivity: args.sensitivity, minDuration: args.min ?? 0.25, pad: 0.11, pace: 'natural', within: args }, loudness, signal)
      const words2 = unsure.filter((x) => x.why === 'enters a word').length
      const total = sure.reduce((n, [a, b]) => n + b - a, 0)
      const lo = Math.min(...thresholds)
      const hi = Math.max(...thresholds)
      const thr = !thresholds.length ? '' : `; threshold ${lo.toFixed(0)}${hi.toFixed(0) !== lo.toFixed(0) ? ` to ${hi.toFixed(0)}` : ''} dB`
      const none = !speech.length && !failed.length ? '; no clip is known to be the speech (no subtitles, and no one track of talking pictures)' : ''
      return {
        ...base,
        head: `${sure.length} pauses to cut, ${sec(total)} s (in the speech only, each keeps a natural breath${thr})${words2 ? `; ${words2} enter a subtitle word (uncertain)` : ''}${unsure.length > words2 ? `; ${unsure.length - words2} with another clip at speech level under them (uncertain)` : ''}${failed.length ? `; could not read ${failed.join(',')}` : ''}${none}`,
        items: [
          ...sure.map(([a, b]) => ({ line: silenceLine(a, b), range: [a, b] as [number, number], cut: [a, b] as [number, number] })),
          ...unsure.map(({ r: [a, b], why }) => ({ line: `${silenceLine(a, b)} (${why})`, range: [a, b] as [number, number], cut: [a, b] as [number, number], uncertain: true }))
        ],
        apply: cutsOf
      }
    }
    case 'fillers': {
      const subs = subtitles(project)
      const words = flattenWords(subs)
      // Sounds by their shape; the agent's extra words (args.words) exactly.
      // (By the subtitles' language: "er" is a sound in English, a word in Turkish.)
      const lang = fillerLanguage(project.transcription?.language, subs.map((c) => c.text).join(' '), project.transcription?.model)
      const extra = args.words ? fillerSet(args.words) : undefined
      const hits = fillerHits(words, extra, lang)
      const ranges = fillerCutRanges(words, hits)
      const items: Item[] = []
      // A line without word times has its words spread evenly over it: the
      // seconds of such a hit are a guess, so it is uncertain (T13). A sound
      // that may be a word or meant ("err", "Er", "Aa!", "Ee?") is uncertain
      // too (phase 4A.10, D4); a word the agent named itself is not.
      const guessed: Item[] = []
      const doubtful: Item[] = []
      hits.forEach((wi, k) => {
        const w = words[wi]
        if (!inRange(w.start, w.end, args)) return
        const item: Item = { line: fillerLine(w), range: [w.start, w.end], cut: ranges[k], data: { source: 'text' } }
        // (Estimated word times are a guess too: phase 4A.11, N2.)
        if (guessedTime(w)) guessed.push({ ...item, uncertain: true })
        else if (!extra?.has(normalizeWord(w.text)) && fillerDoubt(words, wi, lang)) doubtful.push({ ...item, line: `${item.line} (${fillerDoubt(words, wi, lang)})`, uncertain: true })
        else items.push(item)
      })
      for (const list of [items, doubtful, guessed]) list.sort((a, b) => a.range![0] - b.range![0])
      // The second path, uncertain (T3): sound no word covers, only in the
      // clips the subtitles are the voice of (not music, effects, B-roll),
      // listed after the text's and applied only when named (include).
      const islands: Item[] = []
      for (const { clip, dbs } of await speechClips(project, words, loudness, signal)) {
        const thr = autoThresholdDb(dbs, 'balanced')
        for (const r of audioIslands(dbs, 0.04, clip.start, thr, words)) {
          if (!inRange(r.start, r.end, args)) continue
          islands.push({ line: islandLine(r.start, r.end), range: [r.start, r.end], cut: [r.start, r.end], data: { source: 'audio' }, uncertain: true })
        }
      }
      islands.sort((a, b) => a.range![0] - b.range![0])
      return {
        ...base,
        head: `${items.length} filler sounds in the text${doubtful.length ? `; ${doubtful.length} that may be a word or meant (uncertain)` : ''}${guessed.length ? `; ${guessed.length} with no measured word times (their seconds are a guess: uncertain)` : ''}; ${islands.length} short sounds with no word (uncertain: listed apart, applied only with include)${subs.length ? '' : '; no subtitles to read'}`,
        items: [...items, ...doubtful, ...guessed, ...islands],
        apply: cutsOf
      }
    }
    case 'repeats': {
      const words = flattenWords(subtitles(project))
      const found = findRepeats(words).filter((f) => inRange(f.first[0], f.second[1], args))
      // Sentences said again that the recogniser did not write (phase 4A.8):
      // speech with no words right after a sentence, about as long as it.
      // Read from the voice's loudness; uncertain, the unwritten take is cut.
      const unwritten: Item[] = []
      for (const { clip, dbs } of words.length < 2 ? [] : await speechClips(project, words, loudness, signal)) {
        const inClip = words.filter((w) => w.start >= clip.start - 0.05 && w.end <= clip.start + clip.duration + 0.05)
        for (const u of unwrittenRetakes(inClip, dbs, 0.04, clip.start, autoThresholdDb(dbs, 'balanced'))) {
          if (!inRange(u.sentence[0], u.gap[1], args)) continue
          if (found.some((f) => f.second[0] < u.gap[1] && f.first[0] < u.gap[1] && f.second[1] > u.sentence[0])) continue
          const said = inClip.slice(u.sentenceWords[0], Math.min(u.sentenceWords[1] + 1, u.sentenceWords[0] + 3)).map((w) => w.text).join(' ')
          // (The written sentence is the take that stays.)
          unwritten.push({ line: unwrittenLine(u.sentence[0], u.gap[0], u.gap[1], said), range: [u.sentence[0], u.gap[1]], cut: u.cut, keep: [u.sentence[0], u.sentence[1]], data: u, uncertain: true, heading: UNWRITTEN_HEADING })
        }
      }
      const listed = [...found.filter((f) => !f.uncertain), ...found.filter((f) => f.uncertain)]
      return {
        ...base,
        head: `${found.filter((f) => !f.uncertain).length} sentences said twice word for word, back to back (A = B: the earlier take A is dropped)${found.some((f) => f.uncertain) ? `; ${found.filter((f) => f.uncertain).length} uncertain (read their words; each says why, ~ how alike, A → B the words that differ)` : ''}${unwritten.length ? `; ${unwritten.length} stretches of speech with no words written (not known what is said: listed apart)` : ''}`,
        // Sure ones first, then the uncertain (applied only with include).
        items: [
          // (The earlier take is cut FOR the later one: `keep`.)
          ...listed.map((f) => ({ line: repeatLine(f, words), range: [f.first[0], f.second[1]] as [number, number], cut: f.cut, keep: [f.second[0], f.second[1]] as [number, number], data: f, ...(f.uncertain ? { uncertain: true } : {}) })),
          ...unwritten
        ],
        apply: cutsOf
      }
    }
    case 'audio': {
      const real = deps.measureClip && deps.measureProject ? null : await import('../audio/normalize')
      const measureClip = deps.measureClip ?? real!.measureClip
      const measureProject = deps.measureProject ?? real!.measureProject
      const items: Item[] = []
      const sounding = Object.values(project.clips).filter((c) => carriesAudio(project, c) && inRange(c.start, c.start + c.duration, args)).sort((a, b) => a.start - b.start)
      // Every mix stops at the cancel, inside a clip's mix too (phase 4A.10,
      // D5, analyses#9: one 30-minute clip, the whole mix and the beats ran to
      // their end after a cancel and held the one analysis slot).
      const stop = new AbortController()
      const poll = setInterval(() => void (signal?.cancelled() && stop.abort()), 50)
      const cut = <T>(work: Promise<T>): Promise<T | null> =>
        work.catch((e) => {
          if (signal?.cancelled() || stop.signal.aborted) throw new Error('cancelled')
          void e
          return null
        })
      try {
        for (const clip of sounding.slice(0, AUDIO_CLIPS_MAX)) {
          if (signal?.cancelled()) throw new Error('cancelled')
          const r = await cut(measureClip(project, clip.id, stop.signal))
          if (r) items.push({ line: loudnessLine(clip.id, clip.start, clip.start + clip.duration, r.lufs, r.peakDb), range: [clip.start, clip.start + clip.duration] })
        }
        if (signal?.cancelled()) throw new Error('cancelled')
        const all = await cut(measureProject(project, stop.signal))
        if (signal?.cancelled()) throw new Error('cancelled')
        const tail: string[] = []
        if (all) tail.push(`Whole mix: ${all.lufs.toFixed(1)} LUFS, peak ${all.peakDb.toFixed(1)} dB (YouTube aims at -14).`)
        if (args.beats) {
          // The music: a clip that is not the speech, an audio file first,
          // the longest (never just the first clip in the project's order,
          // which is usually the talk).
          const voice = voiceClipIds(project)
          const assets = new Map(project.assets.map((a) => [a.id, a]))
          const rank = (c: Clip): number => (voice.has(c.id) ? 0 : 2) + (assets.get(c.assetId)?.kind === 'audio' ? 1 : 0)
          const music = [...sounding].sort((a, b) => rank(b) - rank(a) || b.duration - a.duration)[0]
          const beats = deps.beats ?? (await import('../audio/beats')).analyzeBeats
          const b = music ? await cut(beats(project, music.id, signal)) : null
          if (signal?.cancelled()) throw new Error('cancelled')
          const name = music ? assets.get(music.assetId)?.name ?? music.assetId : ''
          tail.push(b ? `Beats of ${music!.id} (${name}, ${sec(music!.start)}-${sec(music!.start + music!.duration)}): ${b.bpm} bpm, ${b.beats.length} beats, first ${b.beats.slice(0, 6).map(sec).join(' ')}` : `No beat found${music ? ` in ${music.id} (${name})` : ''}.`)
        }
        const more = sounding.length > AUDIO_CLIPS_MAX ? ` (the first ${AUDIO_CLIPS_MAX} of ${sounding.length}; start / end for the others)` : ''
        return { ...base, head: `${items.length} clips with sound${more}`, items, tail }
      } finally {
        clearInterval(poll)
      }
    }
    case 'preflight': {
      const { preflight, loudPeaks } = await import('../export/preflight')
      // Facts only, no judgement (phase 4A.10, D7, safety#7: "would look
      // wrong" for a picture held still steers how the agent animates; the
      // owner's rule). The user's own export check keeps its words.
      const assets = new Map(project.assets.map((a) => [a.id, a]))
      const fact = (x: { kind: string; clipId?: string; text: string }): string => {
        const name = assets.get((x.clipId && project.clips[x.clipId]?.assetId) || '')?.name ?? ''
        if (x.kind === 'still') return `image, no motion for ${project.clips[x.clipId!]?.duration.toFixed(1)} s, “${name}”`
        if (x.kind === 'repeat') return `same image twice in a row, “${name}”`
        return x.text
      }
      const issues = preflight(project).map((x) => ({ ...x, text: fact(x) }))
      for (const clip of Object.values(project.clips)) {
        if (!carriesAudio(project, clip)) continue
        if (signal?.cancelled()) throw new Error('cancelled')
        // (The same window as the other analyses: the sound read for
        // silences or fillers is not read again here.)
        const dbs = await loudness(project, clip, ANALYSIS_WINDOW, signal).catch(() => null)
        if (dbs) for (const at of loudPeaks(dbs, ANALYSIS_WINDOW, clip.start)) issues.push({ kind: 'loud' as const, at, clipId: clip.id, text: 'loud peak' })
      }
      const list = issues.filter((x) => inRange(x.at, x.end ?? x.at, args)).sort((a, b) => a.at - b.at)
      return {
        ...base,
        // (T10: a list of facts; nothing framed as a problem to fix.)
        head: `${list.length}: gaps, missing media, images with no motion or twice in a row, loud peaks`,
        items: list.map((x) => ({ line: preflightLine(x), range: [x.at, x.end ?? x.at] }))
      }
    }
    case 'image_plan': {
      const { buildCustomSubtitleImageSpans, buildSubtitleImageSpans, planSubtitleImageAutomation } = await import('../subtitles/automation')
      const tries: ('sentence' | 'cue')[] = args.grouping ? [args.grouping] : ['sentence', 'cue']
      let plan = planSubtitleImageAutomation(project.captions, project.assets, { grouping: tries[0], timing: 'continuous' })
      let grouping: string = tries[0] === 'cue' ? 'subtitle lines' : 'sentences'
      for (const g of tries.slice(1)) {
        if (!plan.mismatch) break
        const next = planSubtitleImageAutomation(project.captions, project.assets, { grouping: g, timing: 'continuous' })
        if (!next.mismatch) {
          plan = next
          grouping = g === 'cue' ? 'subtitle lines' : 'sentences'
        }
      }
      // Fewer images than sentences (a faceless video: 20 pictures, 43
      // sentences): the sentences in as many groups as there are images,
      // each group about as long as the others, cut only between sentences.
      if (plan.mismatch && plan.imageCount > 1) {
        const spans = buildSubtitleImageSpans(project.captions, 'sentence')
        if (plan.imageCount < spans.length) {
          const starts = evenGroupStarts(spans, plan.imageCount)
          const custom = buildCustomSubtitleImageSpans(project.captions, new Set(starts))
          const grouped = planSubtitleImageAutomation(project.captions, project.assets, { grouping: 'custom', customSpans: custom, timing: 'continuous' })
          if (!grouped.mismatch) {
            plan = grouped
            grouping = `groups of sentences (${spans.length} sentences)`
          }
        }
      }
      if (plan.mismatch) {
        return { ...base, head: `No plan: ${plan.imageCount} images, ${plan.spanCount} spans (${plan.cueCount} lines). Add images or split lines.`, items: [] }
      }
      return {
        ...base,
        head: `${plan.placements.length} images on ${grouping}, in name order, each until the next starts`,
        items: plan.placements.map((q) => ({ line: imageLine(q.assetName, q.start, q.end, q.text), range: [q.start, q.end], data: q })),
        apply: (items) => (items.length ? [{ name: 'automation.placeImages', params: { placements: items.map((i) => i.data), target: 'new' } }] : [])
      }
    }
    case 'broll_plan': {
      const { planBroll } = await import('../subtitles/broll')
      const used = new Set(Object.values(project.clips).map((c) => c.assetId))
      const media = project.assets.filter((a) => !a.missing && (a.kind === 'image' || a.kind === 'video') && !used.has(a.id))
      const plan = planBroll(project.captions.filter((c) => !c.shape && (c.layer ?? 0) === 0), media, {})
      const names = new Map(project.assets.map((a) => [a.id, a.name]))
      const list = plan.placements.filter((q) => inRange(q.start, q.end, args))
      return {
        ...base,
        head: `${list.length} pictures placed where their name is said (${plan.unmatched.length} not said)`,
        items: list.map((q) => ({ line: brollLine(names.get(q.assetId) ?? q.assetId, q.start, q.end, q.said), range: [q.start, q.end], data: q })),
        apply: (items) => (items.length ? [{ name: 'broll.place', params: { placements: items.map((i) => i.data), look: 'card' } }] : [])
      }
    }
    case 'keywords': {
      const { keyWordPlan } = await import('../subtitles/keywords')
      const subs = subtitles(project).filter((c) => inRange(c.start, c.end, args))
      const plan = keyWordPlan(subs, 'some')
      const items: Item[] = []
      for (const c of subs) {
        const idx = plan.get(c.id)
        if (!idx?.length) continue
        items.push({ line: keywordLine(c.id, c.text, idx), range: [c.start, c.end], data: { id: c.id, marks: idx } })
      }
      return {
        ...base,
        head: `${items.length} lines with key words (by word index; applying marks them)`,
        items,
        apply: (chosen) => chosen.map((i) => ({ name: 'caption.update', params: { id: (i.data as { id: string }).id, patch: { marks: (i.data as { marks: number[] }).marks } } }))
      }
    }
  }
}

/**
 * Where n groups of the spans begin (the first caption id of each), so the
 * groups are about equally long: the k-th starts at the span nearest to k/n
 * of the way. Pure.
 */
export function evenGroupStarts(spans: readonly { captionIds: string[]; start: number; end: number }[], n: number): string[] {
  if (!spans.length) return []
  const t0 = spans[0].start
  const total = spans[spans.length - 1].end - t0
  const starts = [spans[0].captionIds[0]]
  let prev = 0
  for (let k = 1; k < Math.min(n, spans.length); k++) {
    const target = t0 + (k * total) / n
    let best = prev + 1
    for (let i = prev + 1; i <= spans.length - (n - k); i++) if (Math.abs(spans[i].start - target) < Math.abs(spans[best].start - target)) best = i
    starts.push(spans[best].captionIds[0])
    prev = best
  }
  return starts
}

/** The items chosen by except / only / include (1-based numbers). An
 *  uncertain item (a sound no word covers) is chosen only when `include` or
 *  `only` names it. */
export function chosenItems(r: AnalysisResult, except?: unknown, only?: unknown, include?: unknown): Item[] {
  const nums = (v: unknown, name: string): Set<number> => {
    if (v === undefined) return new Set()
    if (!Array.isArray(v) || v.length > 2000 || !v.every((n) => Number.isInteger(n) && n >= 1 && n <= r.items.length)) throw new Error(`${name} must be item numbers 1–${r.items.length} of ${r.id}`)
    return new Set(v as number[])
  }
  const ex = nums(except, 'except')
  const on = only === undefined ? null : nums(only, 'only')
  const inc = nums(include, 'include')
  return r.items.filter((it, i) => !ex.has(i + 1) && (!on || on.has(i + 1)) && (!it.uncertain || inc.has(i + 1) || !!on?.has(i + 1)))
}
