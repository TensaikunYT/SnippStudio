// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// Which code film folders may run, in the app (security patch, item 6; the
// rules themselves: trusted-folders.ts). A folder a project file or a launch
// names runs only when it is trusted; otherwise the window that met it is
// told, the clip stays empty, and the user answers once: "Run the code in
// this folder" (the folder joins the profile's list) or "Don't run".
//
// The page cannot trust a folder of its choosing: an answer counts only for
// a folder THIS window was asked about by the main process.
import { app, type WebContents } from 'electron'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { e2eTrustAnswer } from './e2e-hooks'
import { pathKey } from './platform-path'
import { editorState } from './state'
import { filmTrust, TrustedFolders } from './trusted-folders'

/** The profile's trusted folders (trusted-folders.json). */
export const trustedFolders = new TrustedFolders(() => app.getPath('userData'))

/** Asks one window keeps at most (a project naming more: the oldest are let go, unanswered = not run). */
export const TRUST_ASKS_MAX = 100

/** May this folder run now, unasked? (A test run answers "run" for the user
 *  unless it was started to see the question: e2e-hooks.ts.) */
export function filmMayRun(folder: string, projectFile: string | null): boolean {
  if (filmTrust(folder, projectFile, trustedFolders)) return true
  if (e2eTrustAnswer(folder) === 'run') {
    trustedFolders.add(folder)
    return true
  }
  return false
}

/** A folder the user brought in by their own hand (the folder dialog, a
 *  drop, a template, the agent's create): trusted from now on, unless it is
 *  the open project's own already. */
export function trustOwnHand(folder: string, projectFile: string | null): void {
  if (!filmTrust(folder, projectFile, trustedFolders)) trustedFolders.add(folder)
}

/** Is there a page to run in the folder at all? (Else it is just missing.) */
export async function isFilmFolder(folder: string): Promise<boolean> {
  const st = await fs.stat(path.join(folder, 'index.html')).catch(() => null)
  return !!st?.isFile()
}

/** This window waits for the user's answer about `folder`: remembered, and
 *  its page told. With `wait`, resolves with the answer (false when the
 *  window goes first). */
export function askTrust(contents: WebContents, folder: string, why: 'project' | 'launch', wait: true): Promise<boolean>
export function askTrust(contents: WebContents, folder: string, why: 'project' | 'launch', wait?: false): void
export function askTrust(contents: WebContents, folder: string, why: 'project' | 'launch', wait = false): Promise<boolean> | void {
  const asks = editorState(contents).trustAsks
  const key = pathKey(folder)
  // (A window that goes leaves no one waiting.)
  if (!watched.has(contents.id)) {
    const id = contents.id
    watched.add(id)
    contents.once('destroyed', () => {
      watched.delete(id)
      for (const a of asks.values()) for (const done of a.waiting) done(false)
      asks.clear()
    })
  }
  let ask = asks.get(key)
  if (!ask) {
    ask = { folder, why, waiting: [] }
    asks.set(key, ask)
    // (Bounded: the oldest unanswered go, as "not run".)
    while (asks.size > TRUST_ASKS_MAX) {
      const [oldKey, old] = asks.entries().next().value as [string, typeof ask]
      asks.delete(oldKey)
      for (const done of old.waiting) done(false)
    }
  } else if (why === 'launch') ask.why = 'launch'
  if (!contents.isDestroyed()) contents.send('codefilm:trust-ask', { folder: ask.folder, why: ask.why })
  if (!wait) return
  return new Promise<boolean>((resolve) => ask.waiting.push(resolve))
}
const watched = new Set<number>()

/** The folders this window waits for an answer about. */
export function trustAsksOf(contents: WebContents): { folder: string; why: 'project' | 'launch' }[] {
  return [...editorState(contents).trustAsks.values()].map((a) => ({ folder: a.folder, why: a.why }))
}

/**
 * The user's answer from this window's page. Counts only for a folder this
 * window was asked about; returns that folder when the answer is "run" (it
 * is trusted from now on), else null. Whoever waited is told either way.
 */
export function answerTrust(contents: WebContents, raw: unknown, run: boolean): string | null {
  if (typeof raw !== 'string') return null
  const asks = editorState(contents).trustAsks
  let key: string
  try {
    key = pathKey(raw)
  } catch {
    return null
  }
  const ask = asks.get(key)
  if (!ask) return null
  asks.delete(key)
  if (run) trustedFolders.add(ask.folder)
  for (const done of ask.waiting) done(run)
  return run ? ask.folder : null
}
