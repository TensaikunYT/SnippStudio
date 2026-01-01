// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// The render processes' watchdog and their editors' stop counts
// (main/render-workers.ts). Kept apart, with no Electron in it, so a test
// can read it.

/** A render process that has drawn some of its stretch and then goes this
 *  long without drawing more (ms) is taken as stuck. It reports every ten
 *  frames, so this is minutes longer than the slowest film's ten frames. */
export const STALL_MS = 3 * 60_000
/** Before its first frames of a stretch (the film getting ready there: its
 *  3D, its terrains, its pictures, its own things), this long (ms). */
export const FIRST_BEAT_MS = 15 * 60_000

/** Why a render process counts as stuck at `now` (null: it does not): its
 *  last sign of drawing was at `lastBeat` (the stretch handed over, or its
 *  last progress), `beats` progress reports into the stretch. A stuck one
 *  (a GPU hang, a decoder that never answers) is closed, so its lane fails
 *  cleanly instead of the export standing at one frame for ever. */
export function stallOf(now: number, lastBeat: number, beats: number): string | null {
  const quiet = now - lastBeat
  if (beats > 0) return quiet > STALL_MS ? `the render process stopped drawing (no frame in ${Math.round(STALL_MS / 60_000)} minutes)` : null
  return quiet > FIRST_BEAT_MS ? `the render process did not start drawing in ${Math.round(FIRST_BEAT_MS / 60_000)} minutes` : null
}

/**
 * One stretch's watch: its signs of drawing (`beat`), looked at every few
 * seconds (`look`). A look that comes far later than it was asked for means
 * the PC slept (its clock jumped while nothing ran, the render process
 * included): the count starts again then, rather than closing a process
 * that is about to carry on.
 */
export class StallWatch {
  private lastBeat: number
  private beats = 0
  private lastLook: number

  constructor(now: number) {
    this.lastBeat = now
    this.lastLook = now
  }

  /** A progress report came. */
  beat(now: number): void {
    this.lastBeat = now
    this.beats++
  }

  /** Why the process counts as stuck now (null: it does not); `every` is
   *  how often it is looked at (ms). */
  look(now: number, every: number): string | null {
    if (now - this.lastLook > every * 3) this.lastBeat = now
    this.lastLook = now
    return stallOf(now, this.lastBeat, this.beats)
  }
}

export interface StopMark {
  stopped: number
  finished: number
}

/**
 * Each editor's stops counted: its render processes closed (render:close)
 * and its export over (render:finish, its window gone). A render:open still
 * starting when one comes (it waits for the stretches' folder, then for the
 * processes to come up) would otherwise start processes no one will use,
 * left idle for minutes, and make the folder the finish had just removed.
 */
export class StopCounts {
  private readonly counts = new Map<number, StopMark>()

  private of(owner: number): StopMark {
    let c = this.counts.get(owner)
    if (!c) {
      c = { stopped: 0, finished: 0 }
      this.counts.set(owner, c)
    }
    return c
  }

  /** Its render processes were closed. */
  stopped(owner: number): void {
    this.of(owner).stopped++
  }

  /** Its export is over (a stop too). */
  finished(owner: number): void {
    const c = this.of(owner)
    c.stopped++
    c.finished++
  }

  /** Where the counts stand now, to compare with later. */
  mark(owner: number): StopMark {
    return { ...this.of(owner) }
  }

  /** What came since the mark: nothing, a stop, or the export's end. */
  since(owner: number, mark: StopMark): 'none' | 'stopped' | 'finished' {
    const c = this.of(owner)
    if (c.finished !== mark.finished) return 'finished'
    return c.stopped !== mark.stopped ? 'stopped' : 'none'
  }
}
