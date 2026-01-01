// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// The end-to-end test window's stand-ins for the operating system's own
// windows (SnippStudio phase 2B, scripts/e2e). Only in a source build (or a
// package the e2e run marked as a test copy: testBuild below, phase 9a)
// started with --e2e AND its own --user-data-dir: then the open /
// save / message dialogs never open. Each one takes the next answer the test
// wrote into <profile>/e2e/answers.json (a list, first in first out) and
// returns it the way the real dialog would; with no answer waiting it is
// cancelled. Opening a file or folder in Explorer, the recycle bin and the
// clipboard are kept inside the test too. Every one of these is written to
// <profile>/e2e/events.jsonl, so the test can see what the app asked.
import { app, clipboard, dialog, shell } from 'electron'
import { appendFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { filmWindows } from './film-window'

export type E2eAnswer =
  | { kind: 'open'; paths: string[] }
  | { kind: 'save'; path: string }
  | { kind: 'message'; response: number }
  | { kind: 'cancel' }

/** The file that makes a PACKAGED copy a test copy (phase 9a, decision 6:
 *  `npm run e2e -- --packaged=<folder>` puts it beside the app for its run and
 *  takes it away after). A built package never holds it
 *  (scripts/package/check.mjs); writing it needs write access to the program's
 *  own folder, which can as well replace the program itself. */
export const PACKAGED_TEST_MARKER = 'e2e-test-hooks'

/** May this copy carry the test-only handlers at all? A source build always;
 *  a packaged one only in a test run (--e2e and its own --user-data-dir) with
 *  the marker in its resources folder. */
export function testBuild(): boolean {
  if (!app.isPackaged) return true
  if (!app.commandLine.hasSwitch('e2e') || !app.commandLine.hasSwitch('user-data-dir')) return false
  try {
    return existsSync(path.join(process.resourcesPath ?? '', PACKAGED_TEST_MARKER))
  } catch {
    return false
  }
}

/** On only for a test run: a test build (above) started with --e2e AND its
 *  own --user-data-dir. */
export const e2eMode = (): boolean =>
  testBuild() && app.commandLine.hasSwitch('e2e') && app.commandLine.hasSwitch('user-data-dir')

/** The agent server's port for a test run (so it never meets a Snipp Dev the
 *  user has open on the usual port). */
export function e2eAgentPort(): number | null {
  if (!e2eMode()) return null
  const n = Number(app.commandLine.getSwitchValue('e2e-agent-port'))
  return Number.isInteger(n) && n > 1024 && n < 65536 ? n : null
}

/** A shorter time for the agent's calls in a test run (phase 4A: a call the
 *  page answers too late must not be applied). Test runs only. */
export function e2eAgentTimeout(): number | null {
  if (!e2eMode()) return null
  const n = Number(app.commandLine.getSwitchValue('e2e-agent-timeout'))
  return Number.isInteger(n) && n >= 200 && n <= 600_000 ? n : null
}

/** "Run the code in this folder?" (security patch, item 6; film-trust.ts): a
 *  test run answers "run" for the user, written down, so the scenarios that
 *  open a project with a film folder elsewhere go on as before. A run started
 *  with --e2e-trust=ask gets the product's question instead. Null outside a
 *  test run: the product always asks. */
export function e2eTrustAnswer(folder: string): 'run' | null {
  if (!e2eMode() || app.commandLine.getSwitchValue('e2e-trust') === 'ask') return null
  log({ type: 'trust', folder, answer: 'run' })
  return 'run'
}

const dir = (): string => path.join(app.getPath('userData'), 'e2e')

function log(entry: Record<string, unknown>): void {
  try {
    mkdirSync(dir(), { recursive: true })
    appendFileSync(path.join(dir(), 'events.jsonl'), JSON.stringify({ at: Date.now(), ...entry }) + '\n')
  } catch {
    /* the test reads what is there */
  }
}

function nextAnswer(kind: E2eAnswer['kind'], asked: Record<string, unknown>): E2eAnswer | null {
  const file = path.join(dir(), 'answers.json')
  let list: E2eAnswer[] = []
  try {
    if (existsSync(file)) list = JSON.parse(readFileSync(file, 'utf8')) as E2eAnswer[]
  } catch {
    list = []
  }
  const head = list.shift() ?? null
  try {
    writeFileSync(file, JSON.stringify(list))
  } catch {
    /* nothing to keep */
  }
  const fits = head && (head.kind === kind || head.kind === 'cancel')
  log({ type: 'dialog', kind, asked, answer: fits ? head : null, mismatch: head && !fits ? head : undefined })
  return fits ? head : null
}

const optionsOf = (args: unknown[]): Record<string, unknown> => {
  const o = (args.find((a) => a && typeof a === 'object' && !('webContents' in (a as object))) ?? {}) as Record<string, unknown>
  return { title: o.title, defaultPath: o.defaultPath, properties: o.properties, filters: o.filters, message: o.message, buttons: o.buttons }
}

/** The page's own alert / confirm / prompt boxes are drawn by Electron itself
 *  (not through `dialog`): in a test window they are answered in the page
 *  instead, from `window.__e2eAnswers` (confirm: true, prompt: its default
 *  when none waits), and each is listed in `window.__e2eDialogs`. So is the
 *  app's own confirmDialog() (window.__e2eConfirm). */
const PAGE_GUARD = `(() => {
  if (window.__e2eDialogs) return
  window.__e2eDialogs = []
  window.__e2eAnswers = []
  const next = (kind, msg, dflt) => {
    const a = window.__e2eAnswers.length ? window.__e2eAnswers.shift() : undefined
    const answer = a === undefined ? dflt : a
    window.__e2eDialogs.push({ kind, msg: String(msg == null ? '' : msg), answer })
    return answer
  }
  window.alert = (m) => { next('alert', m, undefined) }
  window.confirm = (m) => !!next('confirm', m, true)
  window.prompt = (m, d) => { const a = next('prompt', m, d == null ? null : d); return a == null ? null : String(a) }
  // The app's own question box (ui/confirm.ts, audit G9) is answered the same
  // way, unless a scenario sets window.__e2eShowConfirms to see it drawn.
  window.__e2eConfirm = (m) => !!next('confirm', m, true)
})()`

/** Guards a test window's page (each load) against the page's own boxes. */
export function guardE2ePage(contents: Electron.WebContents): void {
  if (!e2eMode()) return
  contents.on('dom-ready', () => {
    void contents.executeJavaScript(PAGE_GUARD).catch(() => undefined)
  })
}

/** Puts the stand-ins in place. Throws if any could not be replaced: then the
 *  test window must not start (a real dialog could open on the user's screen). */
export function installE2eHooks(): void {
  if (!e2eMode()) return
  // The app decided to quit (every window closed, the drawing windows of the
  // code films included): when, and how many drawing windows were left. The
  // process itself may take seconds more to end on a loaded machine
  // (DENEME-1-PLAN-C.md, item 5); scenario 77 reads this line.
  app.on('will-quit', () => log({ type: 'will-quit', filmWindows: filmWindows().length }))
  const d = dialog as unknown as Record<string, unknown>
  const s = shell as unknown as Record<string, unknown>
  const c = clipboard as unknown as Record<string, unknown>
  let clip = ''
  const swaps: [Record<string, unknown>, string, unknown][] = [
    [d, 'showOpenDialog', async (...args: unknown[]) => {
      const a = nextAnswer('open', optionsOf(args))
      return a && a.kind === 'open' ? { canceled: false, filePaths: a.paths } : { canceled: true, filePaths: [] }
    }],
    [d, 'showSaveDialog', async (...args: unknown[]) => {
      const a = nextAnswer('save', optionsOf(args))
      return a && a.kind === 'save' ? { canceled: false, filePath: a.path } : { canceled: true, filePath: '' }
    }],
    [d, 'showMessageBox', async (...args: unknown[]) => {
      const o = optionsOf(args)
      const a = nextAnswer('message', o)
      const cancelId = (args.find((x) => x && typeof x === 'object' && 'cancelId' in (x as object)) as { cancelId?: number } | undefined)?.cancelId ?? 0
      return { response: a && a.kind === 'message' ? a.response : cancelId, checkboxChecked: false }
    }],
    [d, 'showOpenDialogSync', (...args: unknown[]) => {
      const a = nextAnswer('open', optionsOf(args))
      return a && a.kind === 'open' ? a.paths : undefined
    }],
    [d, 'showSaveDialogSync', (...args: unknown[]) => {
      const a = nextAnswer('save', optionsOf(args))
      return a && a.kind === 'save' ? a.path : undefined
    }],
    [d, 'showMessageBoxSync', (...args: unknown[]) => {
      const a = nextAnswer('message', optionsOf(args))
      return a && a.kind === 'message' ? a.response : 0
    }],
    [d, 'showErrorBox', (title: string, content: string) => log({ type: 'error-box', title, content })],
    [s, 'openPath', async (p: string) => (log({ type: 'shell', call: 'openPath', path: p }), '')],
    [s, 'openExternal', async (u: string) => log({ type: 'shell', call: 'openExternal', url: u })],
    [s, 'showItemInFolder', (p: string) => log({ type: 'shell', call: 'showItemInFolder', path: p })],
    [s, 'trashItem', async (p: string) => {
      log({ type: 'shell', call: 'trashItem', path: p })
      rmSync(p, { recursive: true, force: true })
    }],
    [c, 'writeText', (t: string) => {
      clip = String(t)
      log({ type: 'clipboard', text: clip })
    }],
    [c, 'readText', () => clip]
  ]
  for (const [obj, name, fn] of swaps) {
    obj[name] = fn
    if (obj[name] !== fn) throw new Error(`e2e: could not replace ${name}`)
  }
  rmSync(dir(), { recursive: true, force: true })
  mkdirSync(dir(), { recursive: true })
  log({ type: 'start', pid: process.pid })
}

/** Requests the app's own schemes received in a test run (phase 5a, U12 and
 *  the media:// fence): scheme, address and the headers that can name who
 *  asked. Test runs only; the last 200. */
const seenRequests: { at: number; scheme: string; url: string; headers: Record<string, string>; admitted: boolean }[] = []
export function e2eNoteRequest(scheme: string, request: Request, admitted = true): void {
  if (!e2eMode()) return
  const headers: Record<string, string> = {}
  for (const k of ['origin', 'referer', 'sec-fetch-site', 'sec-fetch-mode', 'sec-fetch-dest', 'range']) {
    const v = request.headers.get(k)
    if (v !== null) headers[k] = v
  }
  seenRequests.push({ at: Date.now(), scheme, url: request.url.slice(0, 300), headers, admitted })
  if (seenRequests.length > 200) seenRequests.splice(0, seenRequests.length - 200)
}

/** What the session's request filter saw of the app's own schemes in a test
 *  run (5a/5b patch, the per-request film fence): who asked as Chromium names
 *  it (the frame and its ancestors, the referrer), and the fence's answer.
 *  Test runs only; the last 400. */
const seenWeb: { at: number; url: string; frames: string[]; referrer: string; type: string; film: string | null; allowed: boolean }[] = []
export function e2eNoteWebRequest(entry: { url: string; frames: string[]; referrer: string; type: string; film: string | null; allowed: boolean }): void {
  if (!e2eMode()) return
  seenWeb.push({ at: Date.now(), ...entry, url: entry.url.slice(0, 300) })
  if (seenWeb.length > 400) seenWeb.splice(0, seenWeb.length - 400)
}

let filmMemoryKb: number | null = null
/** A test run's own memory limit for the films' drawing windows (KB), else
 *  null (the product's 2 GB: film-window-rules.ts). */
export function e2eFilmMemoryKb(): number | null {
  return e2eMode() ? filmMemoryKb : null
}

let failHostPages = 0
/** A test run may have the next host page(s) of a film refused, as a start
 *  that goes wrong (phase 5d.1 step 0: the film must start all the same). */
export function e2eFailHostPage(url: string): boolean {
  if (!e2eMode() || failHostPages <= 0 || !/\/__snipp\/host\.html$/.test(url)) return false
  failHostPages--
  return true
}

let filmPolicyOff = false
/** Films are served with their content security policy (always, but in a test
 *  run that turned it off: see 'film-policy' below). */
export function e2eFilmPolicy(): boolean {
  return !(e2eMode() && filmPolicyOff)
}

/** What a test asks about the code films' frames (phase 5a): their processes
 *  (U1), whether the window sounds, the requests seen. Test runs only. */
export function e2eFilmProbe(contents: Electron.WebContents, q: unknown): unknown {
  if (!e2eMode()) return null
  const kind = (q as { kind?: unknown } | null)?.kind
  if (kind === 'frames') {
    const top = contents.mainFrame
    return {
      browserPid: process.pid,
      editorPid: top.osProcessId,
      frames: top.framesInSubtree.filter((f) => f !== top).map((f) => ({ url: f.url.slice(0, 200), pid: f.osProcessId, parent: f.parent ? f.parent.url.slice(0, 200) : null }))
    }
  }
  if (kind === 'audible') return { audible: contents.isCurrentlyAudible(), muted: contents.isAudioMuted() }
  if (kind === 'mute') {
    contents.setAudioMuted((q as { on?: unknown }).on === true)
    return { muted: contents.isAudioMuted() }
  }
  if (kind === 'requests') {
    const since = Number((q as { since?: unknown }).since) || 0
    return seenRequests.filter((r) => r.at >= since)
  }
  if (kind === 'film-policy') {
    // A test run may serve films WITHOUT their content security policy, to
    // show that the main process's fence holds on its own (film-fence.ts).
    filmPolicyOff = (q as { on?: unknown }).on === false
    return { policy: !filmPolicyOff }
  }
  if (kind === 'windows') return filmWindows()
  if (kind === 'fail-host') {
    failHostPages = Math.max(0, Math.min(10, Number((q as { n?: unknown }).n) || 0))
    return { n: failHostPages }
  }
  if (kind === 'pid-alive') {
    const pid = Number((q as { pid?: unknown }).pid)
    return { alive: app.getAppMetrics().some((m) => m.pid === pid) }
  }
  if (kind === 'film-memory') {
    // A test run may lower the drawing windows' memory limit (the product's
    // is 2 GB), to see a page past it let go without holding 2 GB.
    const mb = Number((q as { mb?: unknown }).mb)
    filmMemoryKb = Number.isFinite(mb) && mb > 0 ? Math.round(mb * 1024) : null
    return { limitKb: filmMemoryKb }
  }
  if (kind === 'web') {
    const since = Number((q as { since?: unknown }).since) || 0
    return seenWeb.filter((r) => r.at >= since)
  }
  return null
}
