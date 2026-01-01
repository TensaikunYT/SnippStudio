// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// The parallel export's plan (the craft run, round 7). Pure: no DOM, so the
// tests read it.
//
// A film's frames are drawn in several lanes at once: the editor's own
// window and a few render processes (each a hidden copy of the app with its
// own GPU process: one app's windows all wait on its one GPU process). The
// film is cut into stretches (more stretches than lanes, handed out in order
// as each lane finishes one, so a heavy 3D stretch does not hold the rest
// up); each lane draws and encodes its stretches; the editor joins the
// encoded video in order, the sound mixed once. Every frame is drawn from its
// time alone (the film is seek-safe), with the same drawer, at the same
// time as the single-window export draws it.
import { frameTime } from '../timeline/rates'

/** What the lane count is picked from (the main process's view). */
export interface Machine {
  /** Logical processors (threads). */
  cpus: number
  /** Bytes. */
  totalMem: number
  /** Bytes the system can give now (Windows: "available"). */
  freeMem: number
  /** Drawing and encoding on the graphics card. */
  gpu: boolean
}

const GB = 1024 ** 3

/** At most this many lanes when the count is picked for the machine (the
 *  code-only kit's number). */
export const MAX_AUTO_LANES = 8
/** At most this many when asked for (workers=N). */
export const MAX_LANES = 16
/** Threads one lane keeps busy (its page's main thread, its GPU process's,
 *  the encoder's; measured round 7: about two cores), and those left for
 *  the person's own programs. */
export const THREADS_PER_LANE = 2.5
export const THREADS_KEPT = 2
/** Memory a render process takes while it draws, all its processes
 *  (measured round 7, with room: see the plan's notes), and what is always
 *  left free. The editor's own lane costs nothing more, but the film it
 *  builds is held in memory until it is written (its size is taken off). */
export const PROCESS_MEM_2D = 1.2 * GB
export const PROCESS_MEM_3D = 1.6 * GB
export const MEM_KEPT = 2 * GB
/** Each lane's share of the film at least, when the count is picked: a
 *  render process's start (the app, the film's own things, 3D) is paid once. */
export const MIN_SHARE_SEC = 8
/** A stretch at least (asked counts too): shorter ones cost more in starts
 *  and key frames than they save. */
export const MIN_STRETCH_SEC = 1
/** Stretches per lane: a lane that finishes early takes the next. */
export const STRETCHES_PER_LANE = 3
/** A stretch at most, so the load evens out on long films. */
export const MAX_STRETCH_SEC = 40

export interface WorkerPlan {
  /** Lanes: the editor's own and n - 1 render processes (1: the
   *  single-window export, as before). */
  n: number
  /** Why that many, for the log. */
  why: string
}

/**
 * How many lanes for an export: as asked (`workers=N`; 1 is the
 * single-window export), or picked from the machine, keeping it usable:
 * - threads: two and a half per lane, two kept for the person (12 threads: 4);
 * - no graphics card for drawing: half that (software drawing is all CPU);
 * - memory: the editor's lane, and one render process for each 1.2 GB
 *   (1.6 GB with 3D) available now above 2 GB kept and the film's own size
 *   (`outBytes`: the finished film is held in memory until it is written);
 * - the film: each lane at least 8 s of it;
 * - at most 8.
 */
export function workerCount(m: Machine, o: { frames: number; fps: number; d3: boolean; asked?: number | 'auto'; outBytes?: number }): WorkerPlan {
  const seconds = o.frames / Math.max(1, o.fps)
  const byFilm = (min: number): number => Math.max(1, Math.floor(seconds / min))
  if (typeof o.asked === 'number' && Number.isFinite(o.asked)) {
    const n = Math.max(1, Math.min(MAX_LANES, Math.floor(o.asked), byFilm(MIN_STRETCH_SEC)))
    return { n, why: n === Math.floor(o.asked) ? 'as asked' : `as asked, at most ${n} for ${seconds.toFixed(1)} s` }
  }
  if (o.asked !== 'auto') return { n: 1, why: 'one window (not asked for more)' }
  let cpu = Math.max(1, Math.floor((m.cpus - THREADS_KEPT) / THREADS_PER_LANE))
  if (!m.gpu) cpu = Math.max(1, Math.floor(cpu / 2))
  const per = o.d3 ? PROCESS_MEM_3D : PROCESS_MEM_2D
  const mem = 1 + Math.max(0, Math.floor((m.freeMem - MEM_KEPT - (o.outBytes ?? 0)) / per))
  const film = byFilm(MIN_SHARE_SEC)
  const n = Math.max(1, Math.min(MAX_AUTO_LANES, cpu, mem, film))
  const limits: [number, string][] = [
    [cpu, `${m.cpus} threads${m.gpu ? '' : ', no GPU drawing'}`],
    [mem, `${(m.freeMem / GB).toFixed(1)} GB free`],
    [film, `${seconds.toFixed(0)} s of film`],
    [MAX_AUTO_LANES, 'the most']
  ]
  const by = limits.find(([v]) => v === n)?.[1] ?? 'the machine'
  return { n, why: `${n} lane${n === 1 ? '' : 's'}, the editor and ${n - 1} render process${n - 1 === 1 ? '' : 'es'} (${by})` }
}

/** [first frame, end frame) of each stretch: about `STRETCHES_PER_LANE`
 *  per lane, each at least `MIN_STRETCH_SEC` and at most
 *  `MAX_STRETCH_SEC` (as far as the film allows), in order, covering every
 *  frame exactly once, sizes differing by at most one frame. */
export function stretchesOf(frames: number, workers: number, fps: number): [number, number][] {
  if (frames <= 0) return []
  const minF = Math.max(1, Math.round(MIN_STRETCH_SEC * fps))
  const maxF = Math.max(minF, Math.round(MAX_STRETCH_SEC * fps))
  let k = Math.max(1, workers) * (workers > 1 ? STRETCHES_PER_LANE : 1)
  k = Math.max(k, Math.ceil(frames / maxF))
  k = Math.max(1, Math.min(k, Math.floor(frames / minF) || 1))
  const out: [number, number][] = []
  const base = Math.floor(frames / k)
  const extra = frames - base * k
  let a = 0
  for (let i = 0; i < k; i++) {
    const b = a + base + (i < extra ? 1 : 0)
    out.push([a, b])
    a = b
  }
  return out
}

/** The frames whose pixels the exactness check compares: two each side of
 *  every join (the last two a lane drew going on from before, the first two
 *  the next stretch's lane drew from cold). */
export function joinFrames(stretches: [number, number][], each = 2): number[] {
  const out: number[] = []
  for (let i = 1; i < stretches.length; i++) {
    const b = stretches[i][0]
    for (let f = b - each; f < b + each; f++) if (f >= 0 && f < stretches[stretches.length - 1][1]) out.push(f)
  }
  return out
}

/** A packet of a stretch in the joined film: its time in the stretch (from
 *  0) moved to where the stretch starts. */
export function joinedTime(localSec: number, firstFrame: number, fps: number): number {
  return frameTime(firstFrame, fps) + localSec
}

/** Whether two decoder setups are the same (the stretches' encoders must
 *  agree to be joined into one track): the codec string and the setup bytes. */
type Bytes = ArrayBufferLike | ArrayBufferView | null | undefined
export function sameSetup(a: { codec: string; description?: Bytes }, b: { codec: string; description?: Bytes }): boolean {
  if (a.codec !== b.codec) return false
  const bytes = (d: Bytes): Uint8Array | null => (!d ? null : ArrayBuffer.isView(d) ? new Uint8Array(d.buffer, d.byteOffset, d.byteLength) : new Uint8Array(d))
  const x = bytes(a.description)
  const y = bytes(b.description)
  if (!x || !y) return !x && !y
  if (x.length !== y.length) return false
  for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return false
  return true
}

/** Whether an export asks for lanes at all: a video with `workers` set and
 *  not 1. Anything else (unset, 1, sound only) is the single-window export,
 *  unchanged. Nothing in the app asks for lanes today; SnippStudio phase 3.6
 *  brings them to code films. */
export function wantsParallel(workers: number | 'auto' | undefined, audioOnly: boolean): boolean {
  return workers !== undefined && workers !== 1 && !audioOnly
}

/**
 * Why a render process would draw this film differently from this window
 * (null: it would not). Fonts and LUTs the person imported live in this
 * window's profile only; a render process starts with a profile of its own,
 * where a text in an imported face falls back to another face and an
 * imported LUT is skipped, with no error. Any imported font counts, used or
 * not: a face is picked by its family's name, and that name can come from
 * anywhere (a caption's style, a film's things.js, or a face that takes the
 * name of one Snipp or Windows has), so that one is unused cannot be known.
 * A LUT counts when a clip asks for one this window has (one it lacks is
 * skipped in every lane alike).
 */
export function onlyHere(importedFonts: number, clipLuts: (string | undefined)[], lutHere: (name: string) => boolean): string | null {
  if (importedFonts > 0) return 'one window (fonts imported into this window only)'
  if (clipLuts.some((l) => !!l && lutHere(l))) return 'one window (a LUT imported into this window only)'
  return null
}

/** Hands out stretches in order to whichever lane is free. */
export class StretchQueue {
  private next = 0
  constructor(private readonly stretches: [number, number][]) {}
  /** The next stretch's index, or null when all are handed out. */
  take(): number | null {
    return this.next < this.stretches.length ? this.next++ : null
  }
  get remaining(): number {
    return this.stretches.length - this.next
  }
}

/** The frames to probe: a list as asked, the joins' frames, or none. */
export function probeSet(probe: number[] | 'joins' | undefined, joins: number[] | null): Set<number> | null {
  if (!probe) return null
  const list = probe === 'joins' ? (joins ?? []) : probe
  return list.length ? new Set(list) : null
}
