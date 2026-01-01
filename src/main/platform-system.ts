// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// What the system says, read the same way on every platform (SnippStudio
// phase 10a, step 4; haritalar\cekirdek-platform.md P8, P9, P10). Pure.
import { systemTool } from './system-tool'

/**
 * Where the speech model store writes (P8). Windows (unchanged): the folder
 * inside the program when it can be written (a copy of the program folder then
 * carries the model), else the profile's. macOS and Linux: always the
 * profile's: writing inside a signed .app breaks its signature, and an
 * AppImage or /opt install is read-only anyway.
 */
export function modelWriteDirFor(o: { platform: NodeJS.Platform; packaged: boolean; inAppWritable: boolean; inApp: string; userDir: string }): string {
  if (o.platform === 'win32' && o.packaged && o.inAppWritable) return o.inApp
  return o.userDir
}

/** May the store even try the folder inside the program? */
export const mayWriteInsideApp = (platform: NodeJS.Platform, packaged: boolean): boolean => platform === 'win32' && packaged

/**
 * The memory macOS can hand out now, from `vm_stat`'s text (P9): free,
 * inactive, speculative and purgeable pages times the page size. Node's
 * os.freemem() leaves the inactive (cached) pages out there and reads far too
 * low. Null when the text cannot be read.
 */
export function parseVmStat(text: string): number | null {
  const size = /page size of (\d+) bytes/.exec(text)
  if (!size) return null
  const page = Number(size[1])
  const count = (label: string): number => {
    const m = new RegExp(`^${label}:\\s+(\\d+)\\.?\\s*$`, 'm').exec(text)
    return m ? Number(m[1]) : 0
  }
  const pages = count('Pages free') + count('Pages inactive') + count('Pages speculative') + count('Pages purgeable')
  return pages > 0 ? pages * page : null
}

/** The free memory the app plans with: macOS from vm_stat when it could be
 *  read, every other platform (and macOS without it) os.freemem() as before. */
export function availableMemory(platform: NodeJS.Platform, freemem: number, vmStatText: string | null): number {
  if (platform !== 'darwin' || !vmStatText) return freemem
  const v = parseVmStat(vmStatText)
  return v !== null ? Math.max(freemem, v) : freemem
}

/** The file mode of the files that hold the agent's secret token (P10):
 *  readable and writable by the user alone. (Windows keeps its own access
 *  lists; Node applies only the read-only bit there, so nothing changes.) */
export const SECRET_FILE_MODE = 0o600

/** vm_stat's text on macOS (null elsewhere, or when it cannot run). */
export function readVmStat(platform: NodeJS.Platform, run: (cmd: string) => string | null): string | null {
  return platform === 'darwin' ? run(systemTool('vm_stat', platform)) : null
}
