// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// A media file's fingerprint (SnippStudio phase Ç2a.2, decision 2; report
// P15): its size and last-modified time, kept on the asset. A file changed on
// disk since the project last read it (a re-export under the same name) has
// another fingerprint: it is read again on open, and the user is told. Pure:
// the tests run it.
import type { Asset } from '../types'

/** What the disk says of a file now. */
export interface DiskPrint {
  size: number
  mtime?: number
}

/**
 * The asset against the file on disk: 'same'; 'fill' — the asset has no
 * time yet (saved before fingerprints) and nothing says the file changed, so
 * the disk's fingerprint is just taken; 'changed' — read the file again.
 * A code film (a folder) has none; a file that is not there is not compared.
 */
export function fingerprintState(a: Pick<Asset, 'kind' | 'size' | 'mtime'>, disk: DiskPrint | null | undefined): 'same' | 'fill' | 'changed' {
  if (!disk || a.kind === 'code' || typeof disk.mtime !== 'number') return 'same'
  if (typeof a.mtime === 'number' && Number.isFinite(a.mtime)) return a.size === disk.size && a.mtime === disk.mtime ? 'same' : 'changed'
  return Number.isFinite(a.size) && a.size > 0 && a.size !== disk.size ? 'changed' : 'fill'
}
