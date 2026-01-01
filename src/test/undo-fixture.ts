// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// The fixed world the undo-equivalence records (undo-baseline.test.ts) run
// in: a deterministic uid / random / clock / date, and one project with a bit
// of everything a store action can touch.
import './dom-stub'
import { createHash } from 'node:crypto'
import { defaultCaptionStyle, type Asset, type Caption, type Clip, type Project } from '../renderer/src/types'
import { createTemplate } from '../renderer/src/templates/model'
import { addNote } from '../renderer/src/notes/model'

// --- determinism --------------------------------------------------------
let uuidSeq = 0
/** `uid()` keeps the first 13 characters of a UUID: the counter goes there. */
Object.defineProperty(globalThis.crypto, 'randomUUID', {
  configurable: true,
  value: () => `${(++uuidSeq).toString(16).padStart(8, '0')}-0000-4000-8000-000000000000`
})
let seed = 1
Math.random = () => {
  // mulberry32
  seed = (seed + 0x6d2b79f5) | 0
  let t = seed
  t = Math.imul(t ^ (t >>> 15), t | 1)
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}
let clock = 1_000_000
Object.defineProperty(globalThis.performance, 'now', { configurable: true, value: () => clock })
const FIXED = Date.UTC(2026, 10, 13, 12, 0, 0)
const RealDate = Date
class FixedDate extends RealDate {
  constructor(...args: unknown[]) {
    if (args.length === 0) super(FIXED)
    else super(...(args as [number]))
  }
  static now(): number {
    return FIXED
  }
}
;(globalThis as unknown as { Date: DateConstructor }).Date = FixedDate as unknown as DateConstructor

/** Every scenario starts from the same ids, the same random numbers and a
 *  clock far from the last scenario's (no merge window carries over). */
export function resetWorld(): void {
  uuidSeq = 0
  seed = 1
  clock += 60_000
}
export function tick(ms: number): void {
  clock += ms
}

// --- hashing ------------------------------------------------------------
/** JSON with sorted keys: a rewrite that builds an object in another order
 *  is not a different project. */
export function canonical(v: unknown): string {
  return JSON.stringify(v, (k, x) => {
    if (x && typeof x === 'object' && !Array.isArray(x)) {
      // (Nor is the clip a transition goes into, `transitionOut.to`, phase
      // Ç2b.2: written by every edit since; whether the transition is there
      // at all still counts.)
      const tr = k === 'transitionOut'
      const out: Record<string, unknown> = {}
      // A clip's `instance` (phase 4A.9: which content a cut piece is a part
      // of) is not the film and was not there when the records were made:
      // a piece with it is the same project as the piece without.
      const clip = 'assetId' in x && 'trackId' in x
      for (const key of Object.keys(x).sort()) if (!(clip && key === 'instance') && !(tr && key === 'to')) out[key] = (x as Record<string, unknown>)[key]
      return out
    }
    return x
  })
}
export function hash(v: unknown): string {
  return createHash('sha256').update(canonical(v) ?? 'undefined').digest('hex').slice(0, 16)
}

// --- the project --------------------------------------------------------
const asset = (id: string, kind: Asset['kind'], duration: number, width: number, height: number, hasAudio: boolean): Asset => ({
  id, kind, name: `${id}.${kind === 'image' ? 'png' : kind === 'audio' ? 'wav' : 'mp4'}`, path: `C:\\media\\${id}`, url: `media://${id}`,
  size: 1000, duration, width, height, hasAudio
})

const clip = (id: string, assetId: string, trackId: string, start: number, duration: number, inPoint = 0, extra: Partial<Clip> = {}): Clip => ({
  id, assetId, trackId, start, duration, inPoint, volume: 1,
  transform: { x: 960, y: 540, scale: 1, rotation: 0 },
  ...extra
})

/**
 * Tracks top to bottom: V3 (locked, a still), V2 (an overlay picture), V1
 * (the main row: two videos joined by a mix and a still, A/V linked to A1),
 * A1 (the first video's sound, extracted and linked), A2 (music).
 * Subtitles with word times, a title, a shape, two markers, a group, a Shorts
 * band, a template and a work note.
 */
export function fixture(): Project {
  const p: Project = {
    version: 1,
    name: 'Fixture',
    settings: { width: 1920, height: 1080, fps: 60 },
    mode: 'frame',
    tracks: [
      { id: 'v3', kind: 'video', name: 'V3', clipIds: ['cl'], locked: true },
      { id: 'v2', kind: 'video', name: 'V2', clipIds: ['ov'] },
      { id: 'v1', kind: 'video', name: 'V1', clipIds: ['ca', 'cb', 'cc'] },
      { id: 'a1', kind: 'audio', name: 'A1', clipIds: ['sa'] },
      { id: 'a2', kind: 'audio', name: 'A2', clipIds: ['m1'] }
    ],
    clips: {
      cl: clip('cl', 'img3', 'v3', 0, 5),
      ov: clip('ov', 'img1', 'v2', 2, 4, 0, { transform: { x: 1400, y: 300, scale: 0.4, rotation: 0 } }),
      ca: clip('ca', 'vid1', 'v1', 0, 10, 5, { linkId: 'L1', audioExtracted: true, transitionOut: { type: 'mix', duration: 0.5, to: 'cb' } }),
      cb: clip('cb', 'vid2', 'v1', 10, 10, 2, { channels: { scale: [{ id: 'k1', time: 0, value: 1 }, { id: 'k2', time: 8, value: 1.3 }] } }),
      cc: clip('cc', 'img2', 'v1', 20, 4),
      sa: clip('sa', 'vid1', 'a1', 0, 10, 5, { linkId: 'L1', transform: { x: 0, y: 0, scale: 1, rotation: 0 } }),
      m1: clip('m1', 'aud1', 'a2', 0, 24, 0, { volume: 0.5, transform: { x: 0, y: 0, scale: 1, rotation: 0 } })
    },
    assets: [
      asset('vid1', 'video', 60, 1920, 1080, true),
      asset('vid2', 'video', 30, 1280, 720, true),
      asset('img1', 'image', 0, 1600, 900, false),
      asset('img2', 'image', 0, 1080, 1350, false),
      asset('img3', 'image', 0, 800, 800, false),
      asset('aud1', 'audio', 120, 0, 0, true)
    ],
    captions: [],
    captionStyle: defaultCaptionStyle(),
    transcription: { model: 'english', language: 'auto' },
    markers: [
      { id: 'mk1', time: 5, color: '#ffd83d', note: 'first' },
      { id: 'mk2', time: 15, color: '#4fa8ff', note: 'second' }
    ],
    groups: [{ id: 'g1', clipIds: ['cb', 'cc'] }],
    shortSegments: [{ id: 'seg1', name: 'Short 1', start: 1, end: 9, keyframes: [] }],
    snap: { enabled: true, distance: 12, snapEdges: true, snapCenters: true }
  }
  const words = (text: string, a: number, b: number) => {
    const list = text.split(' ')
    const step = (b - a) / list.length
    return list.map((w, i) => ({ text: w, start: +(a + i * step).toFixed(3), end: +(a + (i + 1) * step - 0.02).toFixed(3) }))
  }
  const sub = (id: string, text: string, start: number, end: number): Caption => ({ id, text, start, end, words: words(text, start, end) })
  p.captions = [
    sub('c1', 'hello there world', 0.5, 3),
    sub('c2', 'this is a test', 3.2, 6),
    sub('c3', 'second clip speaks', 10.5, 14),
    { id: 't1', text: 'Title', start: 4, end: 7, manual: true, layer: 1, style: { ...defaultCaptionStyle(), posY: 0.3 } },
    { id: 's1', text: '', start: 8, end: 10, manual: true, layer: 2, shape: { kind: 'rect', w: 0.3, h: 0.16, reveal: false }, style: { ...defaultCaptionStyle(), bgColor: '#25d0c2', bgOpacity: 0.9 } }
  ]
  p.captions.sort((a, b) => a.start - b.start)
  createTemplate(p, 'steps', 16)
  addNote(p, { start: 2, end: 3, kind: 'fix', text: 'tighten this', shapes: [] })
  return p
}
