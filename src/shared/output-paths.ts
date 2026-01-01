// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// Several outputs of one export, one name (DENEME-4, worker W): the file the
// save dialog chose, and beside it the same name with each other output's
// extension (name.mp4, name.wav, name.png). The window works out the names
// (renderer/src/export/outputs.ts); the main process lets it write the first
// because the user chose it in the save window, and the others only through
// export:approve (main/ipc/export-place-ipc.ts): export file types, in a
// folder the user chose, a file already there asked about first (22 Nov, K1).

/** The path without its extension (only the last name's, never a folder's dot). */
export function stemOf(path: string): string {
  const slash = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'))
  const dot = path.lastIndexOf('.')
  return dot > slash + 1 ? path.slice(0, dot) : path
}

/**
 * The paths of the outputs: the first as chosen, each other one beside it with
 * its own extension. Two outputs of the same extension (not made by the
 * window today) would not share a file: the later gets "-2", "-3".
 */
export function outputPaths(first: string, exts: readonly string[]): string[] {
  const stem = stemOf(first)
  const used = new Set<string>()
  return exts.map((ext, i) => {
    let p = i === 0 ? first : `${stem}.${ext}`
    for (let n = 2; used.has(p.toLowerCase()); n++) p = `${stem}-${n}.${ext}`
    used.add(p.toLowerCase())
    return p
  })
}
