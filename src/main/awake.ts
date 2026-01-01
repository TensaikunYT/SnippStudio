// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
/**
 * Keeping Snipp awake while it works.
 *
 * Chromium and Windows slow a window down when it is covered, minimised or
 * behind others: its timers are throttled and an occluded window stops being
 * drawn on time. A film exported from the editor window then took about a
 * second a frame, and Whisper (a worker in that window) crawled. The render
 * processes of the parallel export always had these switches; every Snipp
 * process has them now (the editor, its render processes).
 *
 * And Windows may sleep in the middle of a long export or transcription: the
 * page holds the PC awake while one runs (AwakeHolds, below).
 *
 * No Electron here: the tests run it.
 */

/** Plain switches: nothing is throttled or backgrounded. */
const AWAKE_SWITCHES = ['disable-renderer-backgrounding', 'disable-background-timer-throttling', 'disable-backgrounding-occluded-windows']

/** Windows' occlusion check marks a covered window hidden (and undrawn). */
const DISABLED_FEATURES = ['CalculateNativeWinOcclusion']

/** SharedArrayBuffer without cross-origin isolation (a file:// page cannot
 *  be isolated): what onnxruntime-web needs to run Whisper's CPU backend on
 *  several threads. The film code's sandbox worker still deletes it
 *  (workers/lockdown.ts). */
const ENABLED_FEATURES = ['SharedArrayBuffer']

/** The part of Electron's app.commandLine used here. */
export interface CommandLineLike {
  appendSwitch: (name: string, value?: string) => void
  getSwitchValue: (name: string) => string
}

/** A feature list with these added, once each. Chromium keeps one value per
 *  switch (the last appended wins), so a second --disable-features would
 *  drop the first one's features (a script may pass its own on the command
 *  line). */
export function withFeatures(current: string, add: readonly string[]): string {
  const list = current
    .split(',')
    .map((f) => f.trim())
    .filter(Boolean)
  for (const f of add) if (!list.includes(f)) list.push(f)
  return list.join(',')
}

/** Before the app is ready: the switches of every Snipp process. */
export function appendAwakeSwitches(commandLine: CommandLineLike): void {
  for (const s of AWAKE_SWITCHES) commandLine.appendSwitch(s)
  commandLine.appendSwitch('disable-features', withFeatures(commandLine.getSwitchValue('disable-features'), DISABLED_FEATURES))
  commandLine.appendSwitch('enable-features', withFeatures(commandLine.getSwitchValue('enable-features'), ENABLED_FEATURES))
}

/**
 * Who is holding the PC awake, and why: one system blocker while anyone
 * holds it. Holds count (an export and a transcription can overlap, two
 * windows can export), and a page that goes away lets go of all of its own.
 */
export class AwakeHolds {
  private readonly holds = new Map<number, Map<string, number>>()
  private blocker: number | null = null

  constructor(
    private readonly start: () => number,
    private readonly stop: (id: number) => void
  ) {}

  /** One hold taken (on) or given back (off) by this owner, for this reason. */
  set(owner: number, on: boolean, why: string): void {
    const mine = this.holds.get(owner) ?? new Map<string, number>()
    const n = (mine.get(why) ?? 0) + (on ? 1 : -1)
    // A release with nothing held changes nothing.
    if (n > 0) mine.set(why, n)
    else mine.delete(why)
    if (mine.size) this.holds.set(owner, mine)
    else this.holds.delete(owner)
    this.settle()
  }

  /** Every hold of this owner (its page closed, reloaded or crashed). */
  release(owner: number): void {
    this.holds.delete(owner)
    this.settle()
  }

  get awake(): boolean {
    return this.blocker !== null
  }

  private settle(): void {
    if (this.holds.size && this.blocker === null) this.blocker = this.start()
    else if (!this.holds.size && this.blocker !== null) {
      this.stop(this.blocker)
      this.blocker = null
    }
  }
}
