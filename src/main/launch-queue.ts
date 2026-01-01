// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// Launch requests that come before the app is ready (SnippStudio phase 10a,
// step 3; haritalar\cekirdek-platform.md W2). A second launch on Windows
// (argv), a Finder double-click or "Open With" on macOS (the open-file event,
// which can come before ready) both wait here, in order, and are opened once
// the app is ready; after that each opens at once. Pure.
export class LaunchQueue<T> {
  private waiting: T[] = []
  private isReady = false

  constructor(private readonly open: (item: T) => void) {}

  /** A launch: opened now when the app is ready, else kept for later. */
  push(item: T): void {
    if (this.isReady) this.open(item)
    else this.waiting.push(item)
  }

  /** The app is ready: what waited opens, in the order it came. */
  ready(): void {
    if (this.isReady) return
    this.isReady = true
    for (const item of this.waiting.splice(0)) this.open(item)
  }

  get pending(): readonly T[] {
    return this.waiting
  }
}

/** The arguments an open-file event stands for: as if the file were given on
 *  the command line (projectPathFromArgv reads it from there). */
export const argvForOpenFile = (file: string): string[] => [file]
