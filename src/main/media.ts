// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// Media in the main process: the sound-effect library, scanning a dropped
// folder, code films (registry, watches), the media:// protocol, and finding a
// project's media again. Moved out of src/main/index.ts in SnippStudio phase 2B
// (no change).
import { app, type WebContents } from 'electron'
import { askTrust, filmMayRun, isFilmFolder } from './film-trust'
import { createReadStream, promises as fs } from 'node:fs'
import path from 'node:path'
import { Readable } from 'node:stream'
import { isLocalFilePath } from './security'
import { corsHeaders } from './network'
import { scanMediaTree } from './media-scan'
import { FilmRegistry, registerFilm, type CodeFilmInfo } from './codefilm'
import { allowedMediaPaths, normalize, MEDIA_EXTENSIONS, MIME, pathToMediaUrl, mediaUrlToPath } from './state'
import { locateMedia } from './project-media'
import { keepVersions } from './codefilm-versions'
import { foldKey } from './platform-path'

export interface SfxEntry { id: string; name: string }
export const sfxDir = () => path.join(app.getPath('userData'), 'sfx-library')
export const sfxIndex = () => path.join(sfxDir(), 'index.json')
export async function readSfxEntries(): Promise<SfxEntry[]> {
  try {
    const data: unknown = JSON.parse(await fs.readFile(sfxIndex(), 'utf8'))
    if (!Array.isArray(data)) return []
    return data.filter((item): item is SfxEntry =>
      !!item && typeof item === 'object' &&
      typeof item.id === 'string' && /^[a-f0-9]{32}\.(mp3|wav|m4a|aac|ogg|flac|opus)$/.test(item.id) &&
      typeof item.name === 'string' && item.name.length > 0 && item.name.length <= 260)
  } catch {
    return []
  }
}

export async function listSfxFiles(): Promise<{ id: string; path: string; name: string; size: number; url: string }[]> {
  const files: { id: string; path: string; name: string; size: number; url: string }[] = []
  for (const entry of await readSfxEntries()) {
    const filePath = path.join(sfxDir(), entry.id)
    const stat = await fs.stat(filePath).catch(() => null)
    if (!stat?.isFile()) continue
    allowedMediaPaths.add(foldKey(filePath))
    files.push({ id: entry.id, path: filePath, name: entry.name, size: stat.size, url: pathToMediaUrl(filePath) })
  }
  return files
}

export interface ScannedMediaFolder {
  folder: string
  files: { path: string; name: string; size: number; mtime: number; url: string; folder: string }[]
  /** More media was there than the scan takes: only the first `files.length`
   *  of `total` (in name order) came back. */
  truncated: boolean
  total: number
}

/** Bounded folder scan for a folder dropped on the window (media-scan.ts).
 *  (Its images-only form went with the Automation folder picker, phase 3c.4b.) */
export async function scanMediaFolder(raw: string): Promise<ScannedMediaFolder | null> {
  if (!isLocalFilePath(raw)) return null
  const root = normalize(raw)
  const stat = await fs.stat(root).catch(() => null)
  if (!stat?.isDirectory()) return null

  const label = path.basename(root) || 'Folder'
  const scan = await scanMediaTree(root, { extensions: MEDIA_EXTENSIONS, maxFiles: 2000 })
  const files: ScannedMediaFolder['files'] = []
  for (const f of scan.files) {
    if (!isLocalFilePath(f.path)) continue
    const full = normalize(f.path)
    allowedMediaPaths.add(foldKey(full))
    files.push({ path: full, name: f.name, size: f.size, mtime: f.mtime, url: pathToMediaUrl(full), folder: label })
  }
  return { folder: label, files, truncated: scan.truncated, total: scan.total }
}

/** The code film folders this session may serve (by the person's consent). */
export const films = new FilmRegistry()
export const filmMedia = {
  allow: (p: string): void => void allowedMediaPaths.add(foldKey(normalize(p))),
  url: (p: string): string => pathToMediaUrl(p)
}
/** A folder as a code film, or null (not a local folder with an index.html). */
export async function codeFilmAt(raw: unknown): Promise<CodeFilmInfo | null> {
  if (typeof raw !== 'string' || !isLocalFilePath(raw)) return null
  return registerFilm(films, normalize(raw), filmMedia)
}
/** Film folders each window watches (webContents id → film id → stop). */
export const filmWatches = new Map<number, Map<string, () => void>>()

// media:// answers are CORS-readable by the editor's origin only (network.ts
// corsHeaders; phase 5a, decision 5).
export async function serveMedia(request: Request, origin = 'file://'): Promise<Response> {
  const CORS_HEADERS = corsHeaders(origin)
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS_HEADERS })
  }
  const filePath = mediaUrlToPath(request.url)
  if (!filePath || !allowedMediaPaths.has(foldKey(filePath))) {
    return new Response('Forbidden', { status: 403, headers: CORS_HEADERS })
  }
  let stat
  try {
    stat = await fs.stat(filePath)
  } catch {
    return new Response('Not found', { status: 404, headers: CORS_HEADERS })
  }
  const total = stat.size
  const mime = MIME[path.extname(filePath).toLowerCase()] ?? 'application/octet-stream'
  const rangeHeader = request.headers.get('range')

  let start = 0
  let end = total - 1
  let status = 200
  if (rangeHeader) {
    const m = /^bytes=(\d*)-(\d*)$/.exec(rangeHeader.trim())
    if (m && (m[1] !== '' || m[2] !== '')) {
      if (m[1] === '') {
        // suffix range: last N bytes
        const suffix = Math.min(parseInt(m[2], 10), total)
        start = total - suffix
      } else {
        start = parseInt(m[1], 10)
        if (m[2] !== '') end = Math.min(parseInt(m[2], 10), total - 1)
      }
      if (start > end || start >= total) {
        return new Response('Range not satisfiable', {
          status: 416,
          headers: { ...CORS_HEADERS, 'Content-Range': `bytes */${total}` }
        })
      }
      status = 206
    }
  }

  const stream = createReadStream(filePath, { start, end })
  const headers: Record<string, string> = {
    ...CORS_HEADERS,
    'Content-Type': mime,
    'Accept-Ranges': 'bytes',
    'Content-Length': String(end - start + 1)
  }
  if (status === 206) headers['Content-Range'] = `bytes ${start}-${end}/${total}`
  return new Response(Readable.toWeb(stream) as ReadableStream, { status, headers })
}

/** A path main may serve as media (by its extension). */
export const isMediaPath = (p: string): boolean => MEDIA_EXTENSIONS.has(path.extname(p).toLowerCase())

/** A project's media file as main found it: its URL, size and last-modified
 *  time (the fingerprint, phase Ç2a.2), and where it is now. */
export interface ResolvedMedia {
  url: string
  size: number
  mtime?: number
  path?: string
  /** How it was found (main/project-media.ts MediaFound). */
  via?: 'path' | 'rel' | 'name'
  /** A code film folder that is there but may not run yet: it is outside the
   *  project folder and the user never brought it in or allowed it (security
   *  patch, item 6; film-trust.ts). No address; the page asks the user. */
  untrusted?: true
}

/**
 * Checks every media path referenced by a project, allowlisting the ones that
 * exist so the renderer can load them over `media://`. Missing files come back
 * as null so the UI can flag them for re-linking. Each found file comes with
 * its fingerprint (size, mtime: phase Ç2a.2, decision 2).
 */
export async function resolveProjectMedia(
  parsed: unknown,
  /** The project file (or the file a crash snapshot was of): a moved
   *  project folder finds its media beside it (phase Ç2a.2, decision 3). */
  projectFile: string | null = null,
  /** The window the project opens in: it is told which code film folders
   *  wait for the user's answer (security patch, item 6). */
  asker: WebContents | null = null
): Promise<Record<string, ResolvedMedia | null>> {
  const assets = (parsed as { assets?: { path?: unknown }[] })?.assets
  const resolved: Record<string, ResolvedMedia | null> = {}
  if (!Array.isArray(assets)) return resolved
  for (const a of assets) {
    if (typeof a?.path !== 'string') continue
    if (!isLocalFilePath(a.path)) { resolved[a.path] = null; continue }
    if ((a as { kind?: unknown }).kind === 'code') {
      // A code film: its folder, served over snippfilm:// (and its mix as media).
      // Only a folder that may run (security patch, item 6): strictly inside
      // the project's own folder, or one the user brought in or allowed on
      // this computer. Any other is not registered, so nothing of it runs:
      // the clip stays empty and the window asks the user.
      const folder = normalize(a.path)
      if (!filmMayRun(folder, projectFile)) {
        const there = await isFilmFolder(folder)
        resolved[a.path] = there ? { url: '', size: 0, untrusted: true } : null
        if (there && asker && !asker.isDestroyed()) askTrust(asker, folder, 'project')
        continue
      }
      const film = await codeFilmAt(a.path)
      resolved[a.path] = film ? { url: film.url, size: 0 } : null
      // (Audit D4: its versions are kept from the moment the project opens,
      // not only once the Inspector shows a clip of it — the project's own
      // anim\<name> only, D3.)
      if (film && projectFile) keepVersions(normalize(a.path), projectFile)
      continue
    }
    const p = normalize(a.path)
    if (!MEDIA_EXTENSIONS.has(path.extname(p).toLowerCase())) {
      resolved[a.path] = null
      continue
    }
    const found = await locateMedia({ path: p, relPath: (a as { relPath?: unknown }).relPath, size: (a as { size?: unknown }).size }, projectFile, { accept: isMediaPath })
    if (found) {
      allowedMediaPaths.add(foldKey(found.path))
      resolved[a.path] = { url: pathToMediaUrl(found.path), size: found.size, mtime: found.mtime, path: found.path, via: found.via }
    } else {
      resolved[a.path] = null
    }
  }
  return resolved
}
