// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
/** The folder the app's own page and its files are served from, as a file:
 *  address ending in "/" (out/renderer; inside app.asar when packaged), from
 *  the page's own address. Null when that is not a local file. */
export function ownFilesRoot(entry: string): string | null {
  try {
    const url = new URL(entry)
    if (url.protocol !== 'file:' || url.hostname !== '') return null
    url.hash = ''
    url.search = ''
    return url.href.slice(0, url.href.lastIndexOf('/') + 1)
  } catch { return null }
}

/** A file: address as the path the system would open (forward slashes), or
 *  null when it is not a plain local path: another host, a climb (..) left
 *  after decoding (%2e%2e, a %5c that becomes a separator), a stream (":"
 *  past the drive). Decoded once, as Chromium does. */
function localPathOf(url: URL): string | null {
  if (url.hostname !== '') return null
  let p: string
  try { p = decodeURIComponent(url.pathname).replace(/\\/g, '/') } catch { return null }
  if (p.startsWith('//') || /[\x00-\x1f]/.test(p)) return null
  if (p.split('/').some((part) => part === '..' || part === '.')) return null
  if (p.replace(/^\/[a-z]:/i, '').includes(':')) return null
  return p
}

/** Renderer/worker request firewall. A packaged build permits no HTTP(S) or
 * WebSocket origin; development permits only the exact loopback Vite origin.
 * Over file: only the app's own files pass (security patch, item 4; B-G3,
 * S5): the folder `ownFiles` names (ownFilesRoot) and what is in it. Every
 * other local file is refused, so a script that got into the editor page
 * cannot read the user's disk through fetch, a worker, a script or an image
 * ('self' in the page's own policy is every file: address). */
export function isAllowedAppRequest(rawUrl: string, devUrl?: string, ownFiles?: string | null, platform: string = process.platform): boolean {
  let url: URL
  try { url = new URL(rawUrl) } catch { return false }
  if (url.protocol === 'file:') {
    if (!ownFiles) return false
    let root: string | null
    try { root = localPathOf(new URL(ownFiles)) } catch { return false }
    const asked = localPathOf(url)
    if (!root || !asked || !root.endsWith('/')) return false
    // (Windows compares paths without case.)
    const fold = (s: string): string => (platform === 'win32' ? s.toLowerCase() : s)
    return fold(asked).startsWith(fold(root))
  }
  if (url.protocol === 'media:') return url.hostname === 'local'
  // A code film's own folder (main/codefilm.ts serves only registered ids).
  if (url.protocol === 'snippfilm:') return /^[a-f0-9]{16}$/.test(url.hostname)
  if (['blob:', 'data:', 'devtools:'].includes(url.protocol)) return true
  if (!devUrl) return false
  let dev: URL
  try { dev = new URL(devUrl) } catch { return false }
  if (!['localhost', '127.0.0.1', '[::1]'].includes(dev.hostname)) return false
  if (dev.protocol !== 'http:' && dev.protocol !== 'https:') return false
  if (url.hostname !== dev.hostname || url.port !== dev.port) return false
  return url.protocol === dev.protocol ||
    (dev.protocol === 'http:' && url.protocol === 'ws:') ||
    (dev.protocol === 'https:' && url.protocol === 'wss:')
}

/** A release must never honor development URLs inherited from its environment. */
export function developmentOrigin(packaged: boolean, raw?: string): string | undefined {
  if (packaged || !raw) return undefined
  try {
    const url = new URL(raw)
    return isAllowedAppRequest(url.href, raw) && ['http:', 'https:'].includes(url.protocol)
      ? url.origin : undefined
  } catch { return undefined }
}

export function isTrustedDocument(raw: string, entry: string, dev?: string): boolean {
  try {
    const url = new URL(raw)
    if (dev) return url.origin === dev && url.pathname === '/'
    url.hash = ''
    url.search = ''
    return url.href === entry
  } catch { return false }
}

/** CORS headers of a media:// answer. The renderer runs on a different origin
 *  (http://localhost in dev, file:// in production), so media:// must be
 *  CORS-readable by IT, or fetch() fails and pictures drawn from it taint
 *  canvases. Only by it (phase 5a, decision 5; until then `*`): a code film
 *  page (snippfilm://) gets no matching answer, so it cannot read the user's
 *  media even where its page policy would let a request out. protocol.handle
 *  sees no Origin header to answer with (FAZ5-PLAN.md U12): the editor's origin
 *  is named, not echoed. */
export function corsHeaders(editorOrigin: string): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': editorOrigin,
    'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
    'Access-Control-Allow-Headers': 'Range, Content-Type',
    'Access-Control-Expose-Headers': 'Content-Range, Content-Length, Accept-Ranges'
  }
}

/** The editor's origin as Chromium's CORS check sees it: the development
 *  server's, or file:// for the built app. */
export function editorOrigin(devOrigin: string | undefined): string {
  return devOrigin ?? 'file://'
}
