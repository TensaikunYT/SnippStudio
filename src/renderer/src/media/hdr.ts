// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// HDR sources (phase Ç3b, decision 7; report R22): a video whose transfer is
// HLG or PQ (an iPhone's, a camera's HDR mode). The editor draws every frame
// through an 8-bit SDR canvas, which the browser converts in its own way, so
// such a picture may look different from the file. It is badged in the media
// panel and said before an export; nothing is converted by the app.

/** 'hlg' or 'pq' for an HDR video's colour space, else null. */
export function hdrOf(cs: { transfer?: string | null } | null | undefined): 'hlg' | 'pq' | null {
  const tr = cs?.transfer
  return tr === 'hlg' ? 'hlg' : tr === 'pq' ? 'pq' : null
}
