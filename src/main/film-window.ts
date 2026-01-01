// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// A code film's drawing window (phase 5d.1, tier 3): a page that shows more
// than canvases (HTML, CSS, SVG) is drawn whole by a hidden, off-screen
// window of its own, and each picture of that window is handed to the editor.
//
//   - One window per film page, never shown: offscreen rendering into a GPU
//     shared texture, see-through ground. Sandboxed, no preload, no boxes,
//     muted, in a session of its own (its storage is not the editor's) that
//     serves nothing but that film's own snippfilm://<id>/ folder; no
//     permission, no download, no new window, no navigation away.
//   - Its document is the app's host page (codefilm-host.ts, `?win=1`) with
//     the film in a frame of the same origin: the page runs on the app's
//     clock exactly as a canvas page does (tier 2), only nothing is copied:
//     the window's picture is the frame. The main process talks to the host
//     page by calling its __snippGive / __snippTake (there is no preload).
//   - Which picture is which frame: the window is one row higher than the
//     film, and the host page writes the asked frame's number into that row
//     as a colour, in the same task that brings the page to that frame. The
//     editor takes the first picture whose row carries the number it asked
//     for (measured: without the row 3 of 600 frames were another frame, 237
//     of 600 on a page that repaints by itself; with it none. FAZ5-PLAN.md).
//   - The picture crosses as a shared texture (a VideoFrame in the editor),
//     one at a time, only while a frame is waited for.
//   - A page that does not answer, or whose process holds more than 2 GB, is
//     ended and its clip marked failed (decision 3).
import { app, BrowserWindow, session, sharedTexture, type Session, type WebContents } from 'electron'
import { ipcMain } from './state'
import { FILM_SCHEME, isFilmHost } from './codefilm'
import { overMemory, PAGE_FRAME_TIMEOUT_MS, PAGE_MEMORY_CHECK_MS, PAGE_MEMORY_LIMIT_KB, PAGE_NUDGE_MS, pageMayAsk, pageWindowSize, pageWindowUrl } from './film-window-rules'
import { PRODUCT_NAME } from '../shared/product'

export interface FilmWindowDeps {
  /** Is this film id a registered folder? */
  known: (id: string) => boolean
  /** A request of a film's own session for its folder (the fence's stamp
   *  checked, then the film server). */
  serve: (request: Request) => Response | Promise<Response>
  /** An address a film was refused: for its "blocked" list. */
  noteBlocked: (id: string, url: string) => void
  /** A test run's own memory limit (KB), else null. */
  memoryLimitKb: () => number | null
}

interface Page {
  key: string
  id: string
  owner: WebContents
  win: BrowserWindow
  width: number
  height: number
  scale: number
  row: number
  rows: number
  /** Frames asked of the page and not done with (their numbers): pictures
   *  go to the editor only while there is one. */
  asked: Set<number>
  /** Those the page says it stands at, and since when: from then on a
   *  picture must come (it is asked for again when none does). */
  ripe: Map<number, number>
  /** A picture is on its way to the editor (one at a time), and since when. */
  inflight: boolean
  sentAt: number
  /** A picture came and was not sent: the next one must be asked for. */
  dropped: boolean
  seq: number
  /** Pictures that came with a texture, and without one. */
  textures: number
  bare: number
  nudgedAt: number
  closed: boolean
}

const pages = new Map<string, Page>()
const sessions = new Map<string, Session>()
/** A film's session being emptied (its last window closed): a new window of
 *  that film loads its page only after that (Y2). */
const clearing = new Map<string, Promise<void>>()
let deps: FilmWindowDeps | null = null
let memoryTimer: ReturnType<typeof setInterval> | null = null
let nudgeTimer: ReturnType<typeof setInterval> | null = null

/** A film's own session (its storage apart from the editor's and from every
 *  other film's; kept in memory only). It serves that film's folder and
 *  refuses everything else itself, whatever the page's policy says. */
function sessionOf(id: string): Session {
  let ses = sessions.get(id)
  if (ses) return ses
  ses = session.fromPartition(`snippfilm-${id}`)
  sessions.set(id, ses)
  // (index.ts secureSession ran on 'session-created': no permission, no
  // download, the fence's stamp on what the filter lets through. This
  // session's own filter is narrower: this film only.)
  ses.webRequest.onBeforeRequest((details, callback) => {
    const ok = pageMayAsk(details.url, id)
    if (!ok) deps?.noteBlocked(id, details.url)
    callback({ cancel: !ok })
  })
  ses.protocol.handle(FILM_SCHEME, (request) => {
    let host = ''
    try {
      host = new URL(request.url).hostname
    } catch {
      host = ''
    }
    if (host !== id || !deps) return new Response('Forbidden', { status: 403, headers: { 'Cache-Control': 'no-store' } })
    return deps.serve(request)
  })
  return ses
}

const toOwner = (p: Page, m: unknown): void => {
  if (!p.owner.isDestroyed()) p.owner.send('codefilm:page-msg', p.key, m)
}

/** Says something to the window's host page. */
function give(p: Page, m: unknown): void {
  if (p.closed || p.win.isDestroyed()) return
  void p.win.webContents.executeJavaScript(`window.__snippGive ? window.__snippGive(${JSON.stringify(m)}) : false`).catch(() => undefined)
}

/** Reads what the host page says, for as long as the window lives. */
async function listen(p: Page): Promise<void> {
  const wc = p.win.webContents
  while (!p.closed && !p.win.isDestroyed()) {
    let list: unknown
    try {
      list = await wc.executeJavaScript('window.__snippTake ? window.__snippTake() : new Promise((r) => setTimeout(() => r([]), 250))')
    } catch {
      // (The page went, or is being loaded again: looked at again shortly.)
      await new Promise((r) => setTimeout(r, 250))
      continue
    }
    if (p.closed || !Array.isArray(list)) continue
    for (const m of list as { type?: unknown; id?: unknown; width?: unknown; height?: unknown }[]) {
      if (!m || typeof m !== 'object') continue
      if (m.type === 'size') {
        // The film's size as the page says it: the window is made that big.
        const s = pageWindowSize(m.width, m.height, p.scale)
        p.width = s.width
        p.height = s.height
        if (!p.win.isDestroyed()) p.win.setContentSize(s.width, s.height + s.row)
        continue
      }
      if (m.type === 'painted' && typeof m.id === 'number') {
        // The page stands at this frame, its number in the marker row. A
        // picture that carried it may have come while another was on its
        // way to the editor: another one is asked for.
        if (p.asked.has(m.id)) p.ripe.set(m.id, Date.now())
        if (p.dropped && !p.inflight && p.ripe.size > 0) nudge(p)
      }
      // (An ask the page let go of, or could not draw: no picture is due.)
      if ((m.type === 'dropped' || m.type === 'error') && typeof m.id === 'number') {
        p.asked.delete(m.id)
        p.ripe.delete(m.id)
      }
      toOwner(p, m)
    }
  }
}

/** Asks the page for a new picture: a pixel of the marker row changes
 *  (invalidate() brings a paint with no texture on a shared-texture window). */
function nudge(p: Page): void {
  p.dropped = false
  p.nudgedAt = Date.now()
  give(p, { type: 'nudge' })
}

/** A frame is done with: taken by the editor, or given up on. */
function settle(p: Page, id: number): void {
  p.asked.delete(id)
  p.ripe.delete(id)
  give(p, { type: 'taken', id })
}

function onPaint(p: Page, event: Electron.Event<Electron.WebContentsPaintEventParams>): void {
  const tex = event.texture
  if (!tex) {
    // (No texture: after invalidate(), a resize, or with no GPU compositing.)
    p.bare++
    p.dropped = true
    return
  }
  p.textures++
  if (p.closed || p.owner.isDestroyed() || p.asked.size === 0 || p.inflight) {
    p.dropped = true
    tex.release()
    return
  }
  p.inflight = true
  p.sentAt = Date.now()
  const seq = ++p.seq
  const size = tex.textureInfo.codedSize
  let released = false
  const release = (): void => {
    if (released) return
    released = true
    tex.release()
  }
  try {
    const imported = sharedTexture.importSharedTexture({ textureInfo: tex.textureInfo, allReferencesReleased: release })
    sharedTexture
      .sendSharedTexture({ frame: p.owner.mainFrame, importedSharedTexture: imported }, { key: p.key, seq, width: size.width, height: size.height, rows: p.rows })
      .catch(() => {
        // (The editor did not take it in time: as if it had said "not mine".)
        acked(p, seq, 0)
      })
      .finally(() => imported.release())
  } catch {
    release()
    p.inflight = false
    p.dropped = true
  }
}

/** The editor looked at picture `seq`: it carried frame `id` (taken), or a
 *  number nobody waits for (0). */
function acked(p: Page, seq: number, id: number): void {
  if (seq !== p.seq || !p.inflight) return
  p.inflight = false
  if (id > 0 && p.asked.has(id)) settle(p, id)
  // A frame the page already stands at, and this picture was not it: the
  // one that was came meanwhile (dropped), or none will come by itself.
  if (p.ripe.size > 0) nudge(p)
}

function closePage(p: Page, kill = false): void {
  if (p.closed) return
  p.closed = true
  pages.delete(p.key)
  try {
    if (!p.win.isDestroyed()) {
      // (A page in a loop that never ends: its process is ended first.)
      if (kill) p.win.webContents.forcefullyCrashRenderer()
      p.win.destroy()
    }
  } catch {
    /* already gone */
  }
  // The film's last window gone: what it stored (IndexedDB, caches, local
  // storage of its in-memory session) is let go too. It lived in the main
  // process, unseen by the memory check, until the app quit (5c + 5d
  // audit, Y2). A film opened again starts with nothing stored.
  if (![...pages.values()].some((x) => x.id === p.id)) {
    const ses = sessions.get(p.id)
    if (ses) {
      const done = ses
        .clearStorageData()
        .catch(() => {})
        .finally(() => {
          if (clearing.get(p.id) === done) clearing.delete(p.id)
        })
      clearing.set(p.id, done)
    }
  }
  if (pages.size === 0) {
    if (memoryTimer) clearInterval(memoryTimer)
    if (nudgeTimer) clearInterval(nudgeTimer)
    memoryTimer = null
    nudgeTimer = null
  }
}

/** The window ended by the app: the editor is told why (its clip fails). */
function end(p: Page, reason: 'unresponsive' | 'memory' | 'crashed' | 'blocked', detail = ''): void {
  if (p.closed) return
  toOwner(p, { type: 'gone', reason, detail })
  closePage(p, reason === 'unresponsive' || reason === 'memory')
}

function checkMemory(): void {
  const limit = deps?.memoryLimitKb() ?? PAGE_MEMORY_LIMIT_KB
  const byPid = new Map(app.getAppMetrics().map((m) => [m.pid, m.memory.workingSetSize]))
  for (const p of [...pages.values()]) {
    if (p.win.isDestroyed()) continue
    const kb = byPid.get(p.win.webContents.getOSProcessId()) ?? 0
    if (overMemory(kb, limit)) end(p, 'memory', String(Math.round(kb / 1024)))
  }
}

function checkFrames(): void {
  const now = Date.now()
  for (const p of [...pages.values()]) {
    if (p.closed) continue
    for (const [id, since] of [...p.ripe]) {
      if (now - since < PAGE_FRAME_TIMEOUT_MS) continue
      // No picture carried this frame's number. With no texture at all the
      // window cannot hand over its picture here (no GPU compositing): the
      // page kind cannot be played on this machine.
      if (p.textures === 0) {
        end(p, 'blocked')
        break
      }
      settle(p, id)
      toOwner(p, { type: 'error', id, message: 'The picture of the page did not arrive.' })
    }
    // (A picture the editor never answered for: not waited on for ever.)
    if (!p.closed && p.inflight && now - p.sentAt > 1500) acked(p, p.seq, 0)
    if (!p.closed && p.ripe.size > 0 && !p.inflight && now - p.nudgedAt >= PAGE_NUDGE_MS) nudge(p)
  }
}

function open(owner: WebContents, o: { key?: unknown; id?: unknown; width?: unknown; height?: unknown; scale?: unknown }): { ok: boolean; error?: string } {
  const key = typeof o.key === 'string' && o.key.length > 0 && o.key.length <= 80 ? o.key : ''
  const id = typeof o.id === 'string' ? o.id : ''
  if (!key || !isFilmHost(id) || !deps?.known(id)) return { ok: false, error: 'not a registered film' }
  const old = pages.get(key)
  if (old) closePage(old)
  const size = pageWindowSize(o.width, o.height, o.scale)
  const win = new BrowserWindow({
    show: false,
    width: size.width,
    height: size.height + size.row,
    useContentSize: true,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    focusable: false,
    skipTaskbar: true,
    title: `${PRODUCT_NAME} code film`,
    webPreferences: {
      session: sessionOf(id),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true,
      spellcheck: false,
      disableDialogs: true,
      backgroundThrottling: false,
      autoplayPolicy: 'document-user-activation-required',
      offscreen: { useSharedTexture: true, ...(size.scale !== 1 ? { deviceScaleFactor: size.scale } : {}) }
    }
  })
  // (A window is made no bigger than the screen; made bigger afterwards it
  // takes the film's size: measured, FAZ5-PLAN.md U11.)
  win.setContentSize(size.width, size.height + size.row)
  const wc = win.webContents
  wc.setAudioMuted(true)
  wc.setFrameRate(240)
  wc.setWindowOpenHandler(() => ({ action: 'deny' }))
  const p: Page = { key, id, owner, win, width: size.width, height: size.height, scale: size.scale, row: size.row, rows: size.rows, asked: new Set(), ripe: new Map(), inflight: false, sentAt: 0, dropped: false, seq: 0, textures: 0, bare: 0, nudgedAt: 0, closed: false }
  pages.set(key, p)
  wc.on('paint', (event) => onPaint(p, event))
  // Decision 3: a window that does not respond is ended, its clip failed.
  win.on('unresponsive', () => end(p, 'unresponsive'))
  wc.on('render-process-gone', (_e, d) => {
    if (!p.closed && d.reason !== 'clean-exit') end(p, 'crashed', d.reason)
  })
  // It stays on its film: nothing it does takes the window elsewhere.
  wc.on('will-navigate', (e) => e.preventDefault())
  if (!memoryTimer) memoryTimer = setInterval(checkMemory, PAGE_MEMORY_CHECK_MS)
  if (!nudgeTimer) nudgeTimer = setInterval(checkFrames, PAGE_NUDGE_MS)
  // (After the film's storage was let go, if its last window just closed.)
  ;(clearing.get(id) ?? Promise.resolve())
    .then(() => (p.closed || win.isDestroyed() ? Promise.reject(new Error('closed')) : wc.loadURL(pageWindowUrl(id, size.row))))
    .then(
      () => void listen(p),
      (e: unknown) => {
        if (p.closed) return
        toOwner(p, { type: 'error', message: `The film page could not be opened: ${String(e).slice(0, 200)}` })
      }
    )
  return { ok: true }
}

/** The windows of an editor page that is gone (closed, loaded again, died). */
function closeFor(owner: WebContents): void {
  for (const p of [...pages.values()]) if (p.owner === owner) closePage(p)
}

const watched = new WeakSet<WebContents>()

export function registerFilmWindows(d: FilmWindowDeps): void {
  deps = d
  ipcMain.handle('codefilm:page-open', (event, o: unknown) => {
    const owner = event.sender
    if (!watched.has(owner)) {
      watched.add(owner)
      owner.once('destroyed', () => closeFor(owner))
      owner.on('render-process-gone', () => closeFor(owner))
      // (The editor page loaded again holds none of its films any more.)
      owner.on('did-start-navigation', (details) => {
        if (details.isMainFrame && !details.isSameDocument) closeFor(owner)
      })
    }
    return open(owner, (o ?? {}) as Record<string, unknown>)
  })
  const mine = (event: Electron.IpcMainEvent, key: unknown): Page | null => {
    const p = typeof key === 'string' ? pages.get(key) : undefined
    return p && p.owner === event.sender ? p : null
  }
  ipcMain.on('codefilm:page-send', (event, key: unknown, m: unknown) => {
    const p = mine(event, key)
    if (!p || !m || typeof m !== 'object') return
    // (A frame asked: from now on the window's pictures go to the editor.)
    const f = m as { type?: unknown; id?: unknown }
    if (f.type === 'frame' && typeof f.id === 'number') p.asked.add(f.id)
    give(p, m)
  })
  ipcMain.on('codefilm:page-ack', (event, key: unknown, seq: unknown, id: unknown) => {
    const p = mine(event, key)
    if (p) acked(p, Number(seq) || 0, Number(id) || 0)
  })
  ipcMain.on('codefilm:page-close', (event, key: unknown, kill: unknown) => {
    const p = mine(event, key)
    if (p) closePage(p, kill === true)
  })
}

/** Every drawing window, closed (the app quits). */
export function closeAllFilmWindows(): void {
  for (const p of [...pages.values()]) closePage(p)
}

/** The drawing windows open now (a test run reads them). */
export function filmWindows(): { key: string; id: string; pid: number; width: number; height: number; url: string; textures: number; bare: number }[] {
  return [...pages.values()].map((p) => ({
    key: p.key,
    id: p.id,
    pid: p.win.isDestroyed() ? 0 : p.win.webContents.getOSProcessId(),
    width: p.width,
    height: p.height,
    url: p.win.isDestroyed() ? '' : p.win.webContents.getURL(),
    textures: p.textures,
    bare: p.bare
  }))
}
