// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// Render processes for the parallel export (the craft run, round 7).
//
// Why processes and not windows: every window of one app draws its 2D
// canvases through that app's single GPU process, and that process's main
// thread is what a film frame waits on (measured: one window 15 fps, three
// windows of one app 13.6 fps together; two apps 23 fps together). So each
// render worker is a second copy of the app started in a special mode
// (`--snipp-render-worker`): its own user data folder (a slot under this
// app's), its own GPU process, one hidden window that loads the app's page
// with `#render-worker` (export/render-worker.ts) and never shows (no
// focus, nothing on screen, no taskbar button), not throttled while hidden.
// The editor draws one share of the film itself; the workers draw the rest.
//
// The editor (this app's main process, the parent) talks to a worker over
// Node's IPC channel: it hands it a stretch of the film and the file to
// write it to; the worker's window draws and encodes it, its main process
// writes the bytes; the editor joins the files. Workers end when the export
// is over, cancelled or failed, when the editor that opened them reloads or
// closes, when the parent goes (their channel closes), or after five idle
// minutes. A worker that dies fails the export cleanly.
import { app, BrowserWindow, ipcMain, webContents } from 'electron'
import type { IpcMainEvent, IpcMainInvokeEvent, WebContents } from 'electron'
import { execFileSync, spawn, type ChildProcess } from 'node:child_process'
import { promises as fs } from 'node:fs'
import type { FileHandle } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { StallWatch, StopCounts } from './render-watchdog'
import { PRODUCT_NAME } from '../shared/product'
import { availableMemory, readVmStat } from './platform-system'
import { systemToolCwd } from './system-tool'

/** The switch that starts the app as a render worker. */
export const RENDER_WORKER_SWITCH = 'snipp-render-worker'
export const isRenderWorkerProcess = (): boolean => process.argv.includes(`--${RENDER_WORKER_SWITCH}`)

/** A worker left without a stretch this long is closed. */
const IDLE_MS = 5 * 60_000

interface Shared {
  /** The sender is our own page (its main frame). */
  isOurPage: (event: IpcMainEvent | IpcMainInvokeEvent) => boolean
  preload: string
  /** Loads the app's page into a window with this hash. */
  load: (win: BrowserWindow, hash: string) => void
}

export interface ParentDeps extends Shared {
  /** The sender is one of our own editor windows. */
  isEditor: (event: IpcMainEvent | IpcMainInvokeEvent) => boolean
  /** The paths among these media:// addresses the editor may already read. */
  allowedMediaOf: (urls: string[]) => string[]
  /** Lets the renderer read this file over media:// (a stretch, for the join). */
  allowMedia: (p: string) => string
  forgetMedia: (p: string) => void
}

// -- the parent: the editor's app ----------------------------------------------------------------

type Answer = { ok: boolean; error?: string; probes?: Record<number, string> }

interface Worker {
  id: number
  owner: number
  proc: ChildProcess
  slot: number
  ready: Promise<void>
  onReady: () => void
  failStart: (e: Error) => void
  settle: ((r: Answer) => void) | null
  idle: NodeJS.Timeout | null
  /** The watchdog of the stretch it is drawing (render-watchdog.ts). */
  watch: StallWatch | null
}

const workers = new Map<number, Worker>()
/** How often a busy render process's watchdog looks (render-watchdog.ts). */
const WATCH_EVERY_MS = 10_000
const stops = new StopCounts()
let nextWorker = 1
/** Each editor's export in progress: its folder of stretches, the open
 *  files of the stretches it draws itself, and the paths let out. */
interface Job {
  dir: string
  open: Map<number, FileHandle>
  allowed: Set<string>
}
const jobs = new Map<number, Job>()
const watched = new Set<number>()

const jobsRoot = (): string => path.join(app.getPath('userData'), 'render-jobs')

function closeWorker(id: number, why?: string): void {
  const w = workers.get(id)
  if (!w) return
  workers.delete(id)
  if (w.idle) clearTimeout(w.idle)
  w.failStart(new Error(why ?? 'a render process ended'))
  w.settle?.({ ok: false, error: why ?? 'the render process ended' })
  w.settle = null
  try {
    if (w.proc.connected) w.proc.disconnect()
  } catch {
    /* gone */
  }
  if (w.proc.exitCode === null && w.proc.signalCode === null) w.proc.kill()
}

function idleClose(id: number): void {
  const w = workers.get(id)
  if (!w) return
  if (w.idle) clearTimeout(w.idle)
  w.idle = setTimeout(() => closeWorker(id, 'the render process was idle'), IDLE_MS)
}

function closeOwned(owner: number, why?: string): void {
  for (const [id, w] of [...workers]) if (w.owner === owner) closeWorker(id, why)
}

async function finishJob(owner: number, deps: ParentDeps): Promise<void> {
  stops.finished(owner)
  closeOwned(owner, 'the export is over')
  const job = jobs.get(owner)
  if (!job) return
  jobs.delete(owner)
  for (const f of job.open.values()) await f.close().catch(() => {})
  for (const p of job.allowed) deps.forgetMedia(p)
  await fs.rm(job.dir, { recursive: true, force: true }).catch(() => {})
}

/** Stretch folders left by an export that never finished (older than an hour). */
async function sweepJobs(): Promise<void> {
  const root = jobsRoot()
  const names = await fs.readdir(root).catch(() => [] as string[])
  const live = new Set([...jobs.values()].map((j) => path.basename(j.dir)))
  for (const n of names) {
    if (live.has(n)) continue
    const st = await fs.stat(path.join(root, n)).catch(() => null)
    if (st && Date.now() - st.mtimeMs > 3600_000) await fs.rm(path.join(root, n), { recursive: true, force: true }).catch(() => {})
  }
}

async function jobOf(owner: number): Promise<Job> {
  let job = jobs.get(owner)
  if (job) return job
  const dir = path.join(jobsRoot(), `${process.pid}-${owner}-${Date.now().toString(36)}`)
  await fs.mkdir(dir, { recursive: true })
  job = jobs.get(owner)
  if (job) return job
  job = { dir, open: new Map(), allowed: new Set() }
  jobs.set(owner, job)
  return job
}

function watchOwner(owner: WebContents, deps: ParentDeps): void {
  if (watched.has(owner.id)) return
  watched.add(owner.id)
  const id = owner.id
  const end = (): void => void finishJob(id, deps)
  owner.once('destroyed', () => {
    watched.delete(id)
    end()
  })
  owner.on('did-start-navigation', (details) => {
    if (details.isMainFrame && !details.isSameDocument) end()
  })
  owner.on('render-process-gone', end)
}

/** A free slot: its user data folder (kept between exports, so the GPU's
 *  shader cache stays warm). */
function freeSlot(): number {
  const used = new Set([...workers.values()].map((w) => w.slot))
  let s = 0
  while (used.has(s)) s++
  return s
}

function startWorker(owner: number): Worker {
  const slot = freeSlot()
  const profile = path.join(app.getPath('userData'), 'render-profiles', String(slot))
  const args = [...(app.isPackaged ? [] : [app.getAppPath()]), `--${RENDER_WORKER_SWITCH}`, `--user-data-dir=${profile}`]
  const env = { ...process.env }
  delete env.ELECTRON_RUN_AS_NODE
  // (Started in the profile folder, whatever the app's own current folder is:
  // a project opened by a double click can make that the project's folder.
  // Security patch, item 2.)
  const proc = spawn(process.execPath, args, { cwd: app.getPath('userData'), stdio: ['ignore', 'ignore', 'ignore', 'ipc'], windowsHide: true, env })
  // Below normal (its GPU and page processes inherit it on Windows): it
  // draws at full speed while the PC is idle and gives way to the person's
  // own programs when they are busy.
  try {
    if (proc.pid) os.setPriority(proc.pid, os.constants.priority.PRIORITY_BELOW_NORMAL)
  } catch {
    /* not allowed here: normal priority */
  }
  const id = nextWorker++
  let onReady = (): void => {}
  let failStart = (_e: Error): void => {}
  const ready = new Promise<void>((ok, no) => {
    onReady = ok
    failStart = no
  })
  ready.catch(() => {})
  const w: Worker = { id, owner, proc, slot, ready, onReady, failStart, settle: null, idle: null, watch: null }
  workers.set(id, w)
  proc.on('message', (m: unknown) => {
    const msg = (m ?? {}) as { type?: string; frames?: unknown; ok?: unknown; error?: unknown; probes?: unknown }
    if (msg.type === 'ready') {
      idleClose(id)
      w.onReady()
    } else if (msg.type === 'progress') {
      w.watch?.beat(Date.now())
      const o = webContents.fromId(w.owner)
      if (o && !o.isDestroyed()) o.send('render:progress', { id, frames: Number(msg.frames) || 0 })
    } else if (msg.type === 'done' && w.settle) {
      const probes: Record<number, string> = {}
      if (msg.probes && typeof msg.probes === 'object')
        for (const [k, v] of Object.entries(msg.probes as Record<string, unknown>)) if (typeof v === 'string' && v.length <= 16_000_000) probes[Number(k)] = v
      w.settle({ ok: msg.ok === true, ...(typeof msg.error === 'string' ? { error: msg.error.slice(0, 2000) } : {}), probes })
    }
  })
  proc.on('error', (e) => closeWorker(id, `a render process could not start (${e.message})`))
  proc.on('exit', (code, signal) => closeWorker(id, `a render process ended (${signal ?? code})`))
  return w
}

/** What the worker count is picked from (export/parallel-plan.ts). */
function machine(): { cpus: number; totalMem: number; freeMem: number; gpu: boolean } {
  let gpu = true
  try {
    const s = app.getGPUFeatureStatus()
    gpu = s.gpu_compositing?.startsWith('enabled') !== false && s['2d_canvas']?.startsWith('enabled') !== false
  } catch {
    /* unknown: assume there is one */
  }
  return { cpus: typeof os.availableParallelism === 'function' ? os.availableParallelism() : os.cpus().length, totalMem: os.totalmem(), freeMem: availableMemory(process.platform, os.freemem(), readVmStat(process.platform, (cmd) => { try { return execFileSync(cmd, { cwd: systemToolCwd(), encoding: 'utf8', timeout: 2000, windowsHide: true }) } catch { return null } })), gpu }
}

const stretchName = (k: unknown): string => {
  const n = Number(k)
  if (!Number.isInteger(n) || n < 0 || n > 9999) throw new Error('bad stretch number')
  return `stretch-${String(n).padStart(4, '0')}.mp4`
}

export function registerRenderWorkers(deps: ParentDeps): void {
  const editor = (event: IpcMainInvokeEvent): void => {
    if (!deps.isEditor(event)) throw new Error('Untrusted IPC sender')
  }
  ipcMain.handle('render:machine', (event) => {
    editor(event)
    return machine()
  })
  // n render processes, each up with its window listening (or an error).
  ipcMain.handle('render:open', async (event, n: unknown) => {
    editor(event)
    const count = Math.max(1, Math.min(15, Math.floor(Number(n) || 0)))
    const owner = event.sender.id
    watchOwner(event.sender, deps)
    void sweepJobs()
    // The export stopped (closed, or over) while these were starting: none
    // left running idle, and no folder left made again after its finish.
    const mark = stops.mark(owner)
    const list: Worker[] = []
    const stillWanted = async (): Promise<void> => {
      const what = stops.since(owner, mark)
      if (what === 'none') return
      for (const w of list) closeWorker(w.id, 'the export was stopped')
      if (what === 'finished') await finishJob(owner, deps)
      throw new Error('the export was stopped')
    }
    await jobOf(owner)
    await stillWanted()
    for (let i = 0; i < count; i++) list.push(startWorker(owner))
    let timer: NodeJS.Timeout | undefined
    const late = new Promise<never>((_r, rej) => (timer = setTimeout(() => rej(new Error('the render processes did not start in time')), 90_000)))
    try {
      await Promise.race([Promise.all(list.map((w) => w.ready)), late])
    } catch (e) {
      for (const w of list) closeWorker(w.id)
      throw e
    } finally {
      clearTimeout(timer)
    }
    await stillWanted()
    return list.map((w) => w.id)
  })
  // A stretch for one worker: resolves with its answer and the stretch's
  // address (media://) for the join.
  ipcMain.handle('render:run', async (event, id: unknown, raw: unknown) => {
    editor(event)
    const w = workers.get(Number(id))
    if (!w || w.owner !== event.sender.id) throw new Error('no such render process')
    if (w.settle) throw new Error('that render process is busy')
    const job = (raw ?? {}) as { k?: unknown; project?: { assets?: { url?: unknown }[] } }
    const owned = await jobOf(event.sender.id)
    const file = path.join(owned.dir, stretchName(job.k))
    // The footage and pictures the editor may read itself, and no others.
    const urls = (job.project?.assets ?? []).map((a) => a?.url).filter((u): u is string => typeof u === 'string')
    const allow = deps.allowedMediaOf(urls)
    if (w.idle) clearTimeout(w.idle)
    w.idle = null
    const r = await new Promise<Answer>((resolve) => {
      // The watchdog: a process that stops drawing without ending (a GPU
      // hang, a decoder that never answers) is closed, and its lane fails
      // cleanly (render-watchdog.ts), instead of the export standing still.
      const watch = new StallWatch(Date.now())
      w.watch = watch
      const dog = setInterval(() => {
        const why = watch.look(Date.now(), WATCH_EVERY_MS)
        if (why) closeWorker(w.id, why)
      }, WATCH_EVERY_MS)
      w.settle = (res) => {
        clearInterval(dog)
        if (w.watch === watch) w.watch = null
        w.settle = null
        resolve(res)
        if (workers.has(w.id)) idleClose(w.id)
      }
      w.proc.send({ type: 'job', job: raw, file, allow }, (err) => {
        if (err) w.settle?.({ ok: false, error: `the stretch could not be handed over (${err.message})` })
      })
    })
    if (!r.ok) return r
    owned.allowed.add(file)
    return { ...r, url: deps.allowMedia(file) }
  })
  // The stretches the editor draws itself: written into the same folder.
  ipcMain.handle('render:write', async (event, k: unknown, position: unknown, data: unknown) => {
    editor(event)
    if (!(data instanceof Uint8Array) || !Number.isSafeInteger(position) || (position as number) < 0) throw new Error('bad write')
    const job = await jobOf(event.sender.id)
    const n = Number(k)
    const name = stretchName(n)
    let f = job.open.get(n)
    if (!f) {
      f = await fs.open(path.join(job.dir, name), 'w')
      job.open.set(n, f)
    }
    await f.write(data, 0, data.byteLength, position as number)
    return true
  })
  ipcMain.handle('render:written', async (event, k: unknown) => {
    editor(event)
    const job = await jobOf(event.sender.id)
    const n = Number(k)
    const file = path.join(job.dir, stretchName(n))
    await job.open.get(n)?.close()
    job.open.delete(n)
    job.allowed.add(file)
    return deps.allowMedia(file)
  })
  // Every worker of this editor closed (the stretches stay for the join).
  ipcMain.handle('render:close', (event) => {
    editor(event)
    stops.stopped(event.sender.id)
    closeOwned(event.sender.id, 'the export was stopped')
    return true
  })
  // The export is over: the workers closed, the stretches deleted.
  ipcMain.handle('render:finish', async (event) => {
    editor(event)
    await finishJob(event.sender.id, deps)
    return true
  })
}

/** The parent is quitting: its workers go with it. */
export function closeAllRenderWorkers(): void {
  for (const id of [...workers.keys()]) closeWorker(id, 'the app is closing')
}

// -- the child: a render worker ------------------------------------------------------------------

export interface ChildDeps extends Shared {
  /** Lets the window read these files over media:// (the film's footage). */
  allowMedia: (paths: string[]) => void
}

/** A render worker's main process: one hidden window, the parent's channel. */
export function startRenderWorker(deps: ChildDeps): void {
  const send = (m: unknown): void => {
    try {
      process.send?.(m)
    } catch {
      /* the parent is gone: the disconnect below ends us */
    }
  }
  // No parent (started by hand, or the parent died before we came up).
  if (!process.send || !process.connected) {
    app.exit(0)
    return
  }
  process.on('disconnect', () => app.exit(0))
  const win = new BrowserWindow({
    show: false,
    width: 480,
    height: 270,
    focusable: false,
    skipTaskbar: true,
    paintWhenInitiallyHidden: false,
    backgroundColor: '#000000',
    title: `${PRODUCT_NAME} render`,
    webPreferences: {
      preload: deps.preload,
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true,
      spellcheck: false,
      backgroundThrottling: false
    }
  })
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  win.webContents.on('render-process-gone', (_e, d) => {
    send({ type: 'done', ok: false, error: `the render window stopped (${d.reason})` })
    app.exit(1)
  })
  const wc = win.webContents.id
  const ours = (e: IpcMainEvent | IpcMainInvokeEvent): boolean => e.sender.id === wc && e.senderFrame === e.sender.mainFrame && deps.isOurPage(e)
  let file: FileHandle | null = null
  ipcMain.on('render-worker:ready', (e) => {
    if (ours(e)) send({ type: 'ready' })
  })
  ipcMain.on('render-worker:progress', (e, frames: unknown) => {
    if (ours(e)) send({ type: 'progress', frames: Number(frames) || 0 })
  })
  ipcMain.handle('render-worker:write', async (e, position: unknown, data: unknown) => {
    if (!ours(e) || !file) throw new Error('no stretch is being written')
    if (!(data instanceof Uint8Array) || !Number.isSafeInteger(position) || (position as number) < 0) throw new Error('bad write')
    await file.write(data, 0, data.byteLength, position as number)
    return true
  })
  ipcMain.on('render-worker:done', (e, r: unknown) => {
    if (!ours(e)) return
    const f = file
    file = null
    void (f ? f.close() : Promise.resolve()).catch(() => {}).then(() => send({ type: 'done', ...((r ?? {}) as object) }))
  })
  // Its GPU and page processes below normal too (Chromium gives them their
  // own priorities): the person's own programs come first when they are busy.
  const giveWay = (): void => {
    for (const m of app.getAppMetrics()) {
      try {
        if (m.pid !== process.pid) os.setPriority(m.pid, os.constants.priority.PRIORITY_BELOW_NORMAL)
      } catch {
        /* not allowed here: as it is */
      }
    }
  }
  process.on('message', (m: unknown) => {
    const msg = (m ?? {}) as { type?: string; job?: unknown; file?: unknown; allow?: unknown }
    if (msg.type !== 'job' || typeof msg.file !== 'string') return
    giveWay()
    if (Array.isArray(msg.allow)) deps.allowMedia(msg.allow.filter((p): p is string => typeof p === 'string'))
    void fs
      .open(msg.file, 'w')
      .then((f) => {
        file = f
        win.webContents.send('render-worker:job', msg.job)
      })
      .catch((err: Error) => send({ type: 'done', ok: false, error: `the stretch's file could not be made (${err.message})` }))
  })
  deps.load(win, 'render-worker')
}
