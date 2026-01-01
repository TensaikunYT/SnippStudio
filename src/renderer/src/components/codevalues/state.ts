// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// Cila K: which code film the "code values" panel is open for (none: closed).
// A small store of its own: the Inspector's button opens it, the panel reads
// it; nothing of it is kept in the project or the profile.
let open: string | null = null
const subs = new Set<() => void>()
const tell = (): void => {
  for (const s of subs) s()
}

export const codeValues = {
  /** Opens the panel for this film (again: closes it). */
  toggle(assetId: string): void {
    open = open === assetId ? null : assetId
    tell()
  },
  open(assetId: string): void {
    if (open === assetId) return
    open = assetId
    tell()
  },
  close(): void {
    if (open === null) return
    open = null
    tell()
  },
  current: (): string | null => open,
  subscribe(fn: () => void): () => void {
    subs.add(fn)
    return () => void subs.delete(fn)
  }
}
