// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// The export window's name and place (REF-AB item 11, REF-AB-PLAN-P.md). The
// page names the files; the folder is always one the user chose in a system
// window (the main process keeps the list: main/ipc/export-place-ipc.ts).
// What a name may be is decided here, the same for the page (to say what is
// wrong as it is typed) and the main process (to refuse it). Pure, no
// imports: the renderer bundles it too.

/** The kinds of file an export writes (a project file never goes this way). */
export const EXPORT_EXTENSIONS: readonly string[] = ['mp4', 'webm', 'mov', 'wav', 'mp3', 'm4a', 'aac', 'ogg', 'flac', 'png', 'jpg', 'jpeg', 'webp', 'gif']

/** At most this many files in one export run (video, sound, frame, cover…). */
export const EXPORT_FILES_MAX = 6

/** A Windows device name (main/platform-path.ts WINDOWS_DEVICE_NAME; a test
 *  checks the two agree). Refused on every system: the file could not be
 *  opened on Windows. */
const DEVICE = /^(?:con|prn|aux|nul|com[0-9¹²³]|lpt[0-9¹²³]|conin\$|conout\$|clock\$) *(?:\.|$)/i

/** Why a name (without its extension) cannot be a file's: null when it can. */
export function stemProblem(stem: string): 'empty' | 'chars' | 'end' | 'device' | 'long' | null {
  if (!stem.trim()) return 'empty'
  if (stem.length > 180) return 'long'
  // eslint-disable-next-line no-control-regex
  if (/[\\/:*?"<>|\x00-\x1f]/.test(stem)) return 'chars'
  if (/[. ]$/.test(stem) || stem === '.' || stem === '..') return 'end'
  if (DEVICE.test(stem)) return 'device'
  return null
}

/** A file name the export may write: a plain name (no folder), a good stem,
 *  one of the export extensions. */
export function safeExportName(name: unknown): name is string {
  if (typeof name !== 'string') return false
  const dot = name.lastIndexOf('.')
  if (dot <= 0) return false
  const ext = name.slice(dot + 1).toLowerCase()
  return EXPORT_EXTENSIONS.includes(ext) && stemProblem(name.slice(0, dot)) === null
}

/** The files of one run: each a safe name, none twice (letter case aside),
 *  one to EXPORT_FILES_MAX. Null when the list is refused. */
export function exportFileList(files: unknown): string[] | null {
  if (!Array.isArray(files) || files.length === 0 || files.length > EXPORT_FILES_MAX) return null
  if (!files.every(safeExportName)) return null
  const seen = new Set(files.map((f: string) => f.toLowerCase()))
  return seen.size === files.length ? (files as string[]) : null
}

/** The name the window offers: the stem made a good one (the characters a
 *  file name cannot hold become a dash, the end trimmed). */
export function cleanStem(stem: string, fallback = 'export'): string {
  // eslint-disable-next-line no-control-regex
  const s = stem.replace(/[\\/:*?"<>|\x00-\x1f]+/g, '-').replace(/[. ]+$/, '').trim().slice(0, 180)
  return stemProblem(s) === null ? s : fallback
}
