// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// What the read tools say (SnippStudio phase 4A, tools v2): the project, the
// transcript and the changes, as short plain text. An agent pays for every
// character and reads text better than nested JSON; the budget tests
// (src/test/agent-budget.test.ts) hold the sizes. Pure.
import { selectionText, type Selection } from './command'
import type { Caption, Clip, Project, Track } from '../types'
import { assetById, clipsOfTrack, isSubtitle, projectDuration } from '../types'
import type { Changes, IdList } from '../history/versions'
import { fpsLabel } from '../timeline/rates'
import { clipAudible, curveRange } from '../timeline/speed-curve'
import { AUDIBLE_MAX, AUDIBLE_MIN } from '../timeline/speed'
import { lookFact } from '../media/codefilm-params'
import { spokenLanguage } from '../subtitles/models'

/** The project's spoken language as the job tool names it ("tr", "en"), or
 *  its Whisper name for the others: what transcribe's language "auto" runs
 *  (phase 9 audit patch D1). */
export function spokenCode(project: Pick<Project, 'transcription'>): string {
  const l = spokenLanguage(project.transcription)
  return l === 'turkish' ? 'tr' : l === 'english' ? 'en' : l
}

/** Seconds as an agent writes them back: two decimals, no trailing noise. */
export const sec = (t: number): string => (Math.round(t * 100) / 100).toFixed(2)

/** 754.3 → "12:34.3", for the one line a person reads too. */
export function clock(t: number): string {
  const m = Math.floor(t / 60)
  const s = t - m * 60
  return `${m}:${s < 10 ? '0' : ''}${s.toFixed(1)}`
}

/** A word's offset after its line's start: ".42", "1.3", "0". */
export const off = (t: number): string => {
  const s = (Math.round(t * 100) / 100).toFixed(2).replace(/\.?0+$/, '')
  return s.startsWith('0.') ? s.slice(1) : s === '' ? '0' : s
}

// ---- project ----------------------------------------------------------------

export interface ProjectInfo {
  /** The version the agent holds, and whether it reads the draft. */
  version: string
  state: 'draft' | 'live'
  /** "3 calls pending", for the head line. */
  draft?: string
  selection?: Selection
  path?: string | null
}

/** A run of clips on one track: pieces of the same file, one after another
 *  on the timeline and in the source (a cut left them so). */
interface Run {
  clips: Clip[]
  assetId: string
}

function runsOf(project: Project, clips: Clip[]): Run[] {
  const runs: Run[] = []
  for (const c of clips) {
    const last = runs[runs.length - 1]
    const prev = last?.clips[last.clips.length - 1]
    const asset = assetById(project, c.assetId)
    const joins =
      last && prev && last.assetId === c.assetId && asset?.kind !== 'image' && !c.nested && !prev.nested &&
      Math.abs(prev.start + prev.duration - c.start) < 0.02 && c.inPoint >= prev.inPoint - 1e-6 &&
      (c.speed ?? 1) === (prev.speed ?? 1) && !c.speedCurve && !prev.speedCurve
    if (joins) last.clips.push(c)
    else runs.push({ clips: [c], assetId: c.assetId })
  }
  return runs
}

function what(project: Project, c: Clip): string {
  if (c.adjustment) return 'adjustment layer'
  if (c.nested) return `compound of ${c.nested.clips.length} clips`
  const a = assetById(project, c.assetId)
  if (!a) return c.automationMissing ? `empty slot #${c.automationMissing.number}` : 'unknown source'
  return `${a.name}${a.kind === 'code' ? ' (code clip)' : ''}${a.missing ? ' (FILE MISSING)' : ''}`
}

function runLine(project: Project, r: Run): string {
  const first = r.clips[0]
  const last = r.clips[r.clips.length - 1]
  const end = last.start + last.duration
  const a = assetById(project, r.assetId)
  const still = a?.kind === 'image'
  const extras: string[] = []
  const spd = first.speed && first.speed !== 1 ? first.speed : 1
  // (A speed curve, core polish C: the speeds it passes through, and the average.)
  const curve = curveRange(first)
  if (curve) extras.push(`speed curve ${Number(curve[0].toFixed(2))}–${Number(curve[1].toFixed(2))}x (average ${Number(spd.toFixed(2))}x)`)
  else if (spd !== 1) extras.push(`speed ${spd}x`)
  // (A clip that plays backwards, and one whose sound is not heard at its
  // speed: the preview and the export leave it out. Audit patch yama-c, D2:
  // the line said neither.)
  const sound = !!a?.hasAudio && !first.audioExtracted && first.freeze === undefined
  const heard = `${AUDIBLE_MIN}–${AUDIBLE_MAX}x`
  if (first.reversed) extras.push(sound ? 'reversed (no sound)' : 'reversed')
  else if (sound && !clipAudible(first)) extras.push(`no sound (heard only at ${heard})`)
  else if (sound && curve && (curve[0] < AUDIBLE_MIN - 1e-9 || curve[1] > AUDIBLE_MAX + 1e-9)) extras.push(`no sound where its speed is outside ${heard}`)
  if (last.transitionOut) extras.push(`→${last.transitionOut.type}`)
  // (The user locked it against agents: an op on it is not applied.)
  if (r.clips.some((c) => c.agentLock === true)) extras.push('agent-locked')
  if (r.clips.length === 1) {
    const src = still ? '' : ` src ${sec(first.inPoint)}–${sec(first.inPoint + first.duration * spd)}`
    return `  ${first.id} ${sec(first.start)}–${sec(end)} ${what(project, first)}${src}${extras.length ? ' ' + extras.join(' ') : ''}`
  }
  const srcEnd = last.inPoint + last.duration * spd
  const kept = r.clips.reduce((n, c) => n + c.duration * spd, 0)
  const removed = srcEnd - first.inPoint - kept
  // (The two ids are the first and the last PIECE: an op on one of them is an
  // op on that piece, not on the run.)
  return `  ${sec(first.start)}–${sec(end)} ${what(project, first)}: ${r.clips.length} pieces (first ${first.id}, last ${last.id}), src ${sec(first.inPoint)}–${sec(srcEnd)} (${sec(removed)} s cut out)${extras.length ? ' ' + extras.join(' ') : ''}`
}

// (D22: a track whose magnet is on says so — its clips stay joined from 0, a
// shift of them is refused — where an agent learned it only from the refusal.)
const flags = (t: Track): string => [t.hidden && 'hidden', t.muted && 'muted', t.locked && 'locked', t.autoPack && 'magnet'].filter(Boolean).join(',')

/** Rows of the project answer and of its pages. */
const MEDIA_ROWS = 40
const PAGE_MAX = 400
const unusedMedia = (project: Project): Project['assets'] => {
  const used = new Set(Object.values(project.clips).map((c) => c.assetId))
  return project.assets.filter((a) => !used.has(a.id))
}
const mediaRow = (a: Project['assets'][number]): string => `${a.id} ${a.kind} ${a.name}${a.kind === 'image' ? '' : ` ${sec(a.duration)} s`}${a.missing ? ' (FILE MISSING)' : ''}`
const markerRow = (m: NonNullable<Project['markers']>[number]): string => `${m.id} ${sec(m.time)}${m.label || m.note ? ` "${(m.label || m.note || '').slice(0, 40)}"` : ''}`
const titleRow = (c: Caption): string => `${c.id} ${sec(c.start)} "${(c.text || c.shape?.kind || '').slice(0, 30)}"`

/** The project at a glance (the `project` tool). `track`: every clip of it;
 *  "media" / "markers" / "titles": all of that kind, with their ids. */
export function projectText(project: Project, info: ProjectInfo, track?: string): string {
  const dur = projectDuration(project)
  const { width, height, fps } = project.settings
  const lines: string[] = []
  lines.push(`"${project.name || 'Untitled'}" ${width}x${height} ${fpsLabel(fps)}fps${project.mode === 'shorts' ? ' Shorts' : ''}, ${sec(dur)} s (${clock(dur)}). v ${info.version}${info.state === 'draft' ? ` (draft: ${info.draft})` : ''}`)
  if (info.path !== undefined) lines.push(`File: ${info.path ?? 'not saved'}`)
  // The pages that list ALL of a kind (phase 4A.10, C1): media not on the
  // timeline, markers, titles and shapes — each with its id.
  if (track === 'media' || track === 'markers' || track === 'titles') {
    const rows = track === 'media' ? unusedMedia(project).map(mediaRow) : track === 'markers' ? (project.markers ?? []).map(markerRow) : project.captions.filter((c) => !isSubtitle(c)).map(titleRow)
    lines.push(`${track === 'media' ? 'Media not on the timeline' : track === 'markers' ? 'Markers' : 'Titles/shapes'}: ${rows.length}`)
    lines.push(...rows.slice(0, PAGE_MAX).map((r) => `  ${r}`))
    if (rows.length > PAGE_MAX) lines.push(`  … ${rows.length - PAGE_MAX} more are not listed`)
    return lines.join('\n')
  }
  if (track) {
    const t = project.tracks.find((x) => x.id === track) ?? project.tracks.find((x) => x.name.toLowerCase() === track.toLowerCase())
    if (!t) throw new Error(`There is no track "${track}". Tracks: ${project.tracks.map((x) => `${x.id} ${x.name}`).join(', ')}`)
    const clips = clipsOfTrack(project, t).sort((a, b) => a.start - b.start)
    lines.push(`${t.id} ${t.name} (${t.kind}${flags(t) ? ',' + flags(t) : ''}): ${clips.length} clips`)
    for (const c of clips) lines.push(runLine(project, { clips: [c], assetId: c.assetId }))
    return lines.join('\n')
  }
  // Linked picture + sound: the sound track's runs that only mirror the
  // picture's (same link, same times) are said once, on the picture's row.
  const linkedTimes = new Map<string, string>()
  for (const t of project.tracks) {
    if (t.kind !== 'video') continue
    for (const c of clipsOfTrack(project, t)) if (c.linkId) linkedTimes.set(c.linkId + '@' + sec(c.start) + '-' + sec(c.duration), t.id)
  }
  lines.push('Tracks (id name: rows of clip id, start–end, source):')
  for (const t of project.tracks) {
    const clips = clipsOfTrack(project, t).sort((a, b) => a.start - b.start)
    const mirrored = t.kind === 'audio' && clips.length > 0 && clips.every((c) => c.linkId && linkedTimes.has(c.linkId + '@' + sec(c.start) + '-' + sec(c.duration)))
    const head = `${t.id} ${t.name} (${t.kind}${flags(t) ? ',' + flags(t) : ''}): ${clips.length} clip${clips.length === 1 ? '' : 's'}`
    if (mirrored) {
      lines.push(`${head}, the sound of ${linkedTimes.get(clips[0].linkId + '@' + sec(clips[0].start) + '-' + sec(clips[0].duration))}'s clips (linked)`)
      continue
    }
    lines.push(head)
    const runs = runsOf(project, clips)
    const shown = runs.slice(0, 40)
    for (const r of shown) lines.push(runLine(project, r))
    if (runs.length > shown.length) lines.push(`  … ${runs.length - shown.length} more rows: project {"track":"${t.id}"}`)
  }
  const subs = project.captions.filter(isSubtitle)
  if (subs.length) {
    const timed = subs.filter((c) => c.words?.length).length
    lines.push(`Subtitles: ${subs.length} lines ${sec(Math.min(...subs.map((c) => c.start)))}–${sec(Math.max(...subs.map((c) => c.end)))}, ${timed === subs.length ? 'word times' : timed ? `${timed} with word times` : 'no word times'}`)
  } else lines.push('Subtitles: none (job {"start":"transcribe"} makes them)')
  lines.push(`Spoken language: ${spokenCode(project)}`)
  const texts = project.captions.filter((c) => !isSubtitle(c))
  if (texts.length) lines.push(`Titles/shapes: ${texts.slice(0, 12).map(titleRow).join(', ')}${texts.length > 12 ? ` +${texts.length - 12}: project {"track":"titles"}` : ''}`)
  const markers = project.markers ?? []
  if (markers.length) lines.push(`Markers (id time): ${markers.slice(0, 20).map(markerRow).join(', ')}${markers.length > 20 ? ` +${markers.length - 20}: project {"track":"markers"}` : ''}`)
  if (project.templates?.length) lines.push(`G lane: ${project.templates.length}`)
  // Media not on the timeline, each with its id (an op places it by that).
  const unused = unusedMedia(project)
  if (unused.length) {
    lines.push(`Media not on the timeline (id kind name length): ${unused.length}`)
    lines.push(...unused.slice(0, MEDIA_ROWS).map((a) => `  ${mediaRow(a)}`))
    if (unused.length > MEDIA_ROWS) lines.push(`  … ${unused.length - MEDIA_ROWS} more: project {"track":"media"}`)
  }
  const sel = info.selection
  // (The same short line the command box sends: ids only, phase 4B.2.)
  const said = sel ? selectionText(sel, 10) : ''
  if (said) lines.push(`Selected: ${said}`)
  return lines.join('\n')
}

// ---- transcript -------------------------------------------------------------

export interface TranscriptOptions {
  start?: number
  end?: number
  words?: boolean
}

/** A transcript answer stops here and says how to ask for the rest. */
export const TRANSCRIPT_MAX_CHARS = 40_000

function wordLine(c: Caption): string {
  const ws = c.words ?? []
  if (!ws.length) return `${c.id} [${sec(c.start)}–${sec(c.end)}] ${c.text.replace(/\s+/g, ' ').trim()} (no word times)`
  const parts = ws.map((w, i) => `${i}:${w.text.trim()}@${off(w.start - c.start)}`)
  return `${c.id} @${sec(c.start)} ${parts.join(' ')} |${off(ws[ws.length - 1].end - c.start)}`
}

/** What is said and when (the `transcript` tool). */
export function transcriptText(project: Project, version: string, opts: TranscriptOptions = {}): string {
  const dur = projectDuration(project)
  const from = Math.max(0, Number.isFinite(opts.start) ? (opts.start as number) : 0)
  const to = Number.isFinite(opts.end) ? Math.min(dur, opts.end as number) : dur
  const all = project.captions.filter(isSubtitle).sort((a, b) => a.start - b.start)
  if (all.length === 0) return 'No subtitles yet, so no transcript. Make them with job {"start":"transcribe"}.'
  // (A range that is no stretch of the timeline is said so, not answered as
  // "nothing is said here": phase 4A.10, contract#11.)
  if (to - from <= 0 || from >= dur) throw new Error(`start ${sec(from)} / end ${sec(to)} is no stretch of the timeline: it runs 0.00–${sec(dur)} s.`)
  const subs = all.filter((c) => c.end > from && c.start < to)
  const lines = [`v ${version}. ${sec(from)}–${sec(to)} of ${sec(dur)} s: ${subs.length} of ${all.length} lines.`]
  if (!subs.length) lines.push('(Nothing is said here.)')
  let chars = lines[0].length
  for (let i = 0; i < subs.length; i++) {
    const c = subs[i]
    const l = opts.words ? wordLine(c) : `${c.id} [${sec(c.start)}–${sec(c.end)}] ${c.text.replace(/\s+/g, ' ').trim()}`
    if (chars + l.length + 1 > TRANSCRIPT_MAX_CHARS) {
      lines.push(`(Stopped: ${subs.length - i} more lines; call again with start ${sec(c.start)}.)`)
      break
    }
    lines.push(l)
    chars += l.length + 1
  }
  return lines.join('\n')
}

// ---- changes ----------------------------------------------------------------

const ids = (l: IdList, n = 8): string => (l.count ? `${l.count}${l.count ? ` (${l.ids.slice(0, n).join(',')}${l.count > n ? ',…' : ''})` : ''}` : '')

function part(name: string, c: { added: IdList; removed: IdList; moved: IdList; changed: IdList }, extra?: IdList): string | null {
  const bits = [
    c.added.count && `+${ids(c.added)}`,
    c.removed.count && `-${ids(c.removed)}`,
    c.moved.count && `moved ${c.moved.count}`,
    c.changed.count && `changed ${ids(c.changed)}`,
    extra?.count && `words changed ${ids(extra)}`
  ].filter(Boolean)
  return bits.length ? `${name}: ${bits.join(' ')}` : null
}

/** The `changes` answer. */
export function changesText(ch: Changes, fromToken: string, toToken: string, news: readonly string[]): string {
  const lines = [`${fromToken} → ${toToken}`]
  if (ch.cuts?.length) {
    const shown = ch.cuts.slice(0, 40)
    lines.push(`Cut (in ${fromToken}'s times; later times moved earlier): ${shown.map(([a, b]) => `[${sec(a)},${sec(b)}]`).join(' ')}${ch.cuts.length > 40 ? ` +${ch.cuts.length - 40}` : ''}`)
  }
  // (No cut list although times moved: said, so the agent does not take the
  // old seconds for the new ones.)
  else if (ch.clips.added.count + ch.clips.removed.count + ch.clips.moved.count + ch.captions.moved.count > 0) lines.push('Cuts: not known (more than cuts happened since): read again for the new times.')
  if (ch.fixedTracks?.length) lines.push(`Locked, not moved: ${ch.fixedTracks.join(',')}`)
  for (const p of [part('Clips', ch.clips), part('Lines', ch.captions, ch.captions.wordsChanged), part('Tracks', ch.tracks), part('Markers', ch.markers), part('G lane', ch.templates)]) if (p) lines.push(p)
  if (ch.other.length) lines.push(`Also: ${ch.other.join(', ')}`)
  if (lines.length === 1) lines.push('Nothing changed.')
  for (const n of news) lines.push(`Draft: ${n}`)
  return lines.join('\n')
}

/** frames context:true (phase 5e, decision 6): over the span of the times
 *  asked, what is said (in the film seconds of a code clip there, else
 *  seconds from the span's start), the safe area (90 % of the frame) and the output size. The
 *  user's own project look is added here when it is set (phase 5f): facts
 *  only, nothing of how to animate (principle 6). */
export function rangeContext(project: Project, times: readonly number[]): string {
  const a = Math.min(...times)
  const b = Math.max(...times)
  const said = project.captions
    .filter(isSubtitle)
    .filter((c) => c.end > a - 1e-6 && c.start < b + 1e-6)
    .sort((x, y) => x.start - y.start)
  const W = project.settings.width
  const H = project.settings.height
  // (Audit A5: a code clip there — the top one at the first time asked, else
  // the first that overlaps — gives its own film seconds: in point + (t −
  // start) × speed, as its page's renderOut(t) is called. None: seconds from
  // the first time asked.)
  const clipAt = (t: number): Clip | undefined =>
    project.tracks
      .flatMap((tr) => tr.clipIds.map((id) => project.clips[id]))
      .find((c) => c && !c.disabled && !c.reversed && project.assets.find((x) => x.id === c.assetId)?.kind === 'code' && c.start <= t + 1e-6 && t < c.start + c.duration - 1e-6)
  const code = clipAt(a) ?? said.map((c) => clipAt(Math.max(a, c.start))).find(Boolean)
  const at = (t: number): number => (code ? (code.inPoint ?? 0) + (Math.max(code.start, t) - code.start) * (code.speed ?? 1) : Math.max(0, t - a))
  const lines = said.slice(0, 40).map((c) => `${sec(at(c.start))}–${sec(at(c.end))} ${JSON.stringify(c.text.slice(0, 200))}`)
  // (Phase 5f: the user's project look, only when set; a fact, nothing of
  // what to do with it.)
  const look = lookFact(project.look)
  return [
    `Context ${sec(a)}–${sec(b)} s. Said (${code ? `s of code clip ${code.id}'s film` : `s from ${sec(a)}`}):${lines.length ? '' : ' nothing.'}`,
    ...lines,
    ...(said.length > 40 ? [`+${said.length - 40} more lines (transcript)`] : []),
    `Safe area (90 %): x ${Math.round(W * 0.05)}–${Math.round(W * 0.95)}, y ${Math.round(H * 0.05)}–${Math.round(H * 0.95)}. Output ${W}x${H}, ${project.settings.fps} fps.`,
    ...(look ? [look] : [])
  ].join('\n')
}
