// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// The export's bar by what the work really costs (phase Ç3b, decision 1;
// report R29). The sound used to have a fixed 6 % of the bar, mixed before
// the first frame: a 30-minute film sat at 5 % for 39 s with no time left
// shown, then jumped. Now the sound's windows go between the frames, and the
// bar counts both by their measured time: a window by the mean of those
// mixed so far, a frame by the mean of the first 100 (then fixed, so the
// shares stop moving). Pure: the tests read it.

/** Frames whose mean time fixes a frame's share. */
export const FRAMES_MEASURED = 100
/** A frame's cost before any is measured (ms). */
const FRAME_GUESS_MS = 10
/** A window's cost before any is measured (ms). */
const WINDOW_GUESS_MS = 1000

export class WorkBar {
  private frameMs = FRAME_GUESS_MS
  private frameSum = 0
  private framesTimed = 0
  private windowSum = 0
  private windowsTimed = 0
  private doneFrames = 0
  private doneWindows = 0
  private last = 0

  /** `frames` to draw and `windows` of sound to mix (every walk's); the bar
   *  runs from `from` to `to`. */
  constructor(private readonly frames: number, private readonly windows: number, private readonly from = 0, private readonly to = 0.98) {}

  /** A frame drawn and handed to the encoder in `ms` (the sound's windows
   *  mixed meanwhile not counted). */
  frame(ms: number): void {
    this.doneFrames++
    if (this.framesTimed < FRAMES_MEASURED) {
      this.frameSum += ms
      this.framesTimed++
      this.frameMs = Math.max(0.01, this.frameSum / this.framesTimed)
    }
  }

  /** A window of sound mixed (and encoded) in `ms`. */
  window(ms: number): void {
    this.doneWindows++
    this.windowSum += ms
    this.windowsTimed++
  }

  private get windowMs(): number {
    return this.windowsTimed ? this.windowSum / this.windowsTimed : WINDOW_GUESS_MS
  }

  /** Where the bar stands (never back). */
  fraction(): number {
    const w = this.windowMs
    const total = this.frames * this.frameMs + this.windows * w
    const done = Math.min(this.frames, this.doneFrames) * this.frameMs + Math.min(this.windows, this.doneWindows) * w
    const f = this.from + (this.to - this.from) * (total > 0 ? Math.min(1, done / total) : 1)
    this.last = Math.max(this.last, f)
    return this.last
  }
}
