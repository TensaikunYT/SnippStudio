// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// The oracle's projects (SnippStudio phase 4A.9, A8): four small shapes for
// the random sequences (at most 60 s and 30 clips) and long ones for the size
// measurements.
//
// Which content a piece is comes from the material itself: every asset is
// used by at most ONE clip instance (a linked picture and its sound are two
// assets of one file; the generator's duplicate step first registers the
// file again under a new asset id), so (asset, source time) names content
// with no tracking, whatever id a piece got. A written-out scenario that
// needs one asset twice marks the clips with a hidden tag (`__inst`: it rides
// along because every command makes a piece with a clone or a spread). Every
// subtitle word carries one too (`__w`). The app never reads either.
import { defaultProject, type Asset, type Caption, type Clip, type Project, type Track } from '../../renderer/src/types'

export interface Shape {
  name: string
  project: Project
  /** The track the subtitles' voice is on (known by construction): one-to-one
   *  media, the thing placements and cuts are judged against. */
  voiceTrack: string
  /** Media not on the timeline yet: each is placed at most once. */
  pool: string[]
  /** Another sound (music) lies under the voice. */
  bed?: boolean
}

const T0 = { x: 960, y: 540, scale: 1, rotation: 0 }

export function tag<T extends object>(o: T, key: string, value: string): T {
  ;(o as Record<string, unknown>)[key] = value
  return o
}
export const instOf = (c: Clip): string => ((c as unknown as Record<string, unknown>).__inst as string | undefined) ?? c.assetId
export const wordTag = (w: object): string | undefined => (w as Record<string, unknown>).__w as string | undefined

export const asset = (id: string, kind: Asset['kind'], duration: number, hasAudio = kind !== 'image'): Asset =>
  ({ id, kind, name: `${id}.${kind === 'image' ? 'png' : kind === 'audio' ? 'wav' : 'mp4'}`, url: `media://${id}`, size: 1, duration, width: kind === 'audio' ? 0 : 1920, height: kind === 'audio' ? 0 : 1080, hasAudio }) as Asset

export function clip(p: Project, id: string, assetId: string, trackId: string, start: number, inPoint: number, duration: number, extra: Partial<Clip> = {}): Clip {
  const c = { id, assetId, trackId, start, inPoint, duration, transform: { ...T0 }, volume: 1, ...extra } as Clip
  p.clips[id] = c
  const t = p.tracks.find((x) => x.id === trackId)!
  t.clipIds.push(id)
  // In time order, as every track of the app is (phase Ç2a.1: the "multi"
  // shape listed s2 before b1, and a placement read the list as sorted).
  t.clipIds.sort((a, b) => p.clips[a].start - p.clips[b].start)
  return c
}

export const track = (id: string, kind: Track['kind'], extra: Partial<Track> = {}): Track => ({ id, kind, name: id, clipIds: [], ...extra })

const WORDS = ['we', 'go', 'on', 'now', 'then', 'here', 'there', 'again', 'slowly', 'home', 'north', 'south', 'river', 'stone', 'light', 'paper']

/** Subtitle lines with word times over [from, to): one every `every`
 *  seconds, `per` words each, tagged; all following `voiceClip`. */
export function lines(p: Project, from: number, to: number, voiceClip: string, every = 3.2, per = 4): void {
  let n = p.captions.length
  let w = n * per
  for (let t = from + 0.4; t + 2.4 < to; t += every) {
    const words = Array.from({ length: per }, (_, i) => {
      const start = +(t + i * 0.55).toFixed(3)
      return tag({ text: WORDS[(w + i) % WORDS.length], start, end: +(start + 0.42).toFixed(3) }, '__w', `w${w + i}`)
    })
    w += per
    const cap: Caption = { id: `L${n++}`, start: words[0].start, end: words[per - 1].end, text: words.map((x) => x.text).join(' '), words, soundClip: voiceClip }
    p.captions.push(cap)
  }
}

export function base(name: string, tracks: Track[]): Project {
  const p = defaultProject()
  p.name = name
  p.tracks = tracks
  return p
}

const POOL = (): Asset[] => [asset('poolA', 'video', 40), asset('poolB', 'audio', 40), asset('poolC', 'image', 0)]
const POOL_IDS = ['poolA', 'poolB', 'poolC']

/** One talking clip with its own sound, subtitles with word times. */
function talk(): Shape {
  const p = base('talk', [track('V1', 'video'), track('A1', 'audio')])
  p.assets = [asset('talk', 'video', 300), ...POOL()]
  clip(p, 'c1', 'talk', 'V1', 0, 5, 36)
  lines(p, 0, 36, 'c1')
  return { name: 'talk', project: p, voiceTrack: 'V1', pool: [...POOL_IDS] }
}

/** Several tracks: the picture and its linked sound (the voice), B-roll and
 *  two stings above, music below. */
function multi(): Shape {
  const p = base('multi', [track('V2', 'video'), track('V1', 'video'), track('A1', 'audio'), track('A2', 'audio')])
  p.assets = [asset('talkV', 'video', 300), asset('talkA', 'audio', 300), asset('talk2V', 'video', 300), asset('talk2A', 'audio', 300), asset('sting', 'video', 12), asset('sting2', 'video', 12), asset('broll', 'image', 0), asset('music', 'audio', 400), ...POOL()]
  clip(p, 'v1', 'talkV', 'V1', 0, 3, 20, { linkId: 'lk1', audioExtracted: true })
  clip(p, 'a1', 'talkA', 'A1', 0, 3, 20, { linkId: 'lk1' })
  clip(p, 'v2', 'talk2V', 'V1', 20, 60, 16, { linkId: 'lk2', audioExtracted: true })
  clip(p, 'a2', 'talk2A', 'A1', 20, 60, 16, { linkId: 'lk2' })
  clip(p, 's1', 'sting', 'V2', 5, 0, 4)
  clip(p, 's2', 'sting2', 'V2', 23, 0, 4)
  clip(p, 'b1', 'broll', 'V2', 12, 0, 5)
  clip(p, 'm1', 'music', 'A2', 0, 10, 36, { volume: 0.4 })
  lines(p, 0, 20, 'a1')
  lines(p, 20, 36, 'a2')
  return { name: 'multi', project: p, voiceTrack: 'A1', pool: [...POOL_IDS], bed: true }
}

/** A talk (picture and its linked sound) over a locked music bed. */
function lockedMusic(): Shape {
  const p = base('locked', [track('V1', 'video'), track('A1', 'audio'), track('A2', 'audio', { locked: true })])
  p.assets = [asset('talkV', 'video', 300), asset('talkA', 'audio', 300), asset('talk2V', 'video', 300), asset('talk2A', 'audio', 300), asset('music', 'audio', 400), ...POOL()]
  clip(p, 'v1', 'talkV', 'V1', 0, 2, 18, { linkId: 'lk1', audioExtracted: true })
  clip(p, 'c1', 'talkA', 'A1', 0, 2, 18, { linkId: 'lk1' })
  clip(p, 'v2', 'talk2V', 'V1', 18, 40, 18, { linkId: 'lk2', audioExtracted: true })
  clip(p, 'c2', 'talk2A', 'A1', 18, 40, 18, { linkId: 'lk2' })
  clip(p, 'm1', 'music', 'A2', 0, 0, 40, { volume: 0.3 })
  lines(p, 0, 18, 'c1')
  lines(p, 18, 36, 'c2')
  return { name: 'locked', project: p, voiceTrack: 'A1', pool: [...POOL_IDS], bed: true }
}

/** A talking VIDEO with its own sound over a (locked) music bed on an audio
 *  track. Left out of the random sequences until phase Ç2b.1 (plan 7.4,
 *  K-1: after a cut the subtitles' hint named the left piece and the follow
 *  pass scored the music above the video's own sound); shape 5 since. */
export function ownSoundOverMusic(): Shape {
  const p = base('own sound over music', [track('V1', 'video'), track('A1', 'audio', { locked: true })])
  p.assets = [asset('talk', 'video', 300), asset('talk2', 'video', 300), asset('music', 'audio', 400), ...POOL()]
  clip(p, 'c1', 'talk', 'V1', 0, 2, 18)
  clip(p, 'c2', 'talk2', 'V1', 18, 40, 18)
  clip(p, 'm1', 'music', 'A1', 0, 0, 40, { volume: 0.3 })
  lines(p, 0, 18, 'c1')
  lines(p, 18, 36, 'c2')
  return { name: 'own sound over music', project: p, voiceTrack: 'V1', pool: [...POOL_IDS], bed: true }
}

/** Stills back to back and a voice-over under them. */
function faceless(): Shape {
  const p = base('faceless', [track('V1', 'video'), track('A1', 'audio')])
  p.assets = [asset('vo', 'audio', 300), ...POOL()]
  for (let i = 0; i < 6; i++) {
    p.assets.push(asset(`img${i}`, 'image', 0))
    clip(p, `i${i}`, `img${i}`, 'V1', i * 6, 0, 6)
  }
  clip(p, 'vo1', 'vo', 'A1', 0, 1.5, 36)
  lines(p, 0, 36, 'vo1')
  return { name: 'faceless', project: p, voiceTrack: 'A1', pool: [...POOL_IDS] }
}

/** A talking video with its own sound over a LONGER music bed, and NO
 *  subtitles (the common state before transcription): what the agent's
 *  seconds are about is the talk, not the longest sound. B-roll footage and
 *  a held frame lie over it. (Phase 4A.10, F7.) */
function untranscribed(): Shape {
  const p = base('untranscribed', [track('V2', 'video'), track('V1', 'video'), track('A1', 'audio')])
  p.assets = [asset('talk', 'video', 300), asset('talk2', 'video', 300), asset('music', 'audio', 400), asset('cutaway', 'video', 30, false), asset('held', 'video', 30, false), ...POOL()]
  clip(p, 'c1', 'talk', 'V1', 0, 4, 16)
  clip(p, 'c2', 'talk2', 'V1', 16, 50, 14)
  clip(p, 'm1', 'music', 'A1', 0, 0, 44, { volume: 0.3 })
  clip(p, 'k1', 'cutaway', 'V2', 6, 2, 5)
  clip(p, 'f1', 'held', 'V2', 20, 3, 4, { freeze: 3 })
  return { name: 'untranscribed', project: p, voiceTrack: 'V1', pool: [...POOL_IDS], bed: true }
}

export const SHAPES: (() => Shape)[] = [talk, multi, lockedMusic, faceless, untranscribed, ownSoundOverMusic]

/** Ways to change a shape for the command-layer hunt (plan 7.4): features
 *  the random sequences leave out because a command gets them wrong. */
export const VARIANTS: Record<string, (s: Shape) => void> = {
  /** The first voice clip plays backwards. */
  reversed: (s) => {
    const c = Object.values(s.project.clips).find((x) => x.trackId === s.voiceTrack)!
    c.reversed = true
  },
  /** The first voice clip (and its linked partner) plays 1.25 times as fast. */
  speed: (s) => {
    const c = Object.values(s.project.clips).find((x) => x.trackId === s.voiceTrack)!
    for (const x of Object.values(s.project.clips)) if (x === c || (c.linkId && x.linkId === c.linkId)) x.speed = 1.25
  },
  /** With a music bed, the agent may delete and trim the voice's clips. */
  bedEdits: (s) => {
    s.bed = false
  }
}

/**
 * A long talk (I8, I6): `pieces` picture clips with their linked sound, a
 * music bed, `lineCount` subtitle lines of 10 words. For the memory and time
 * measurements, not for the random sequences. 2 hours by default; the
 * 30-minute one is `longTalk(1800, 125, 375)`.
 */
export function longTalk(total = 7200, pieces = 250, lineCount = 1500): Project {
  const p = base(`talk ${total} s`, [track('V1', 'video'), track('A1', 'audio'), track('A2', 'audio')])
  p.assets = [asset('music', 'audio', 9000)]
  const each = total / pieces
  for (let i = 0; i < pieces; i++) {
    p.assets.push(asset(`tv${i}`, 'video', 9000), asset(`ta${i}`, 'audio', 9000))
    clip(p, `v${i}`, `tv${i}`, 'V1', i * each, 100 + i * (each + 1.5), each, { linkId: `k${i}`, audioExtracted: true })
    clip(p, `a${i}`, `ta${i}`, 'A1', i * each, 100 + i * (each + 1.5), each, { linkId: `k${i}` })
  }
  clip(p, 'm1', 'music', 'A2', 0, 0, total, { volume: 0.2 })
  const gap = total / lineCount
  for (let n = 0; n < lineCount; n++) {
    const t = n * gap + 0.2
    const words = Array.from({ length: 10 }, (_, i) => ({ text: WORDS[(n + i) % WORDS.length], start: +(t + i * 0.4).toFixed(3), end: +(t + i * 0.4 + 0.3).toFixed(3) }))
    p.captions.push({ id: `L${n}`, start: words[0].start, end: words[9].end, text: words.map((x) => x.text).join(' '), words, soundClip: `a${Math.min(pieces - 1, Math.floor(t / each))}` })
  }
  return p
}
