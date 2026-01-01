// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// "Run the code in this folder?" (security patch, item 6; the rules:
// main/trusted-folders.ts, the app's side: main/film-trust.ts).
//
// A code clip's folder that a project file or a launch names, that lies
// outside the project's own folder and that the user never brought in on
// this computer, does not run when the project opens: the main process gives
// the page no address for it, so its clip stays empty, and tells this window
// which folders wait. This module keeps that list for the question
// (components/security/TrustFolderAsk.tsx) and carries the answer back.
// "Run" makes the folder a trusted one and gives its clips their film;
// "Don't run" leaves them empty (the project asks again when it is opened
// again).
import { api } from '../platform'
import { useStore } from '../state/store'
import { folderKey, waitingAssets, type TrustAsk } from './trust-rules'

export { askToShow, folderKey, waitingAssets, type TrustAsk } from './trust-rules'

let asks: TrustAsk[] = []
const listeners = new Set<() => void>()
const tell = (): void => {
  for (const l of listeners) l()
}

export function subscribeTrust(fn: () => void): () => void {
  listeners.add(fn)
  return () => void listeners.delete(fn)
}

/** The folders waiting for an answer (a new list at every change). */
export const trustAsks = (): TrustAsk[] => asks

function add(ask: TrustAsk): void {
  if (!ask || typeof ask.folder !== 'string') return
  const key = folderKey(ask.folder)
  const had = asks.find((a) => folderKey(a.folder) === key)
  if (had && (had.why === ask.why || ask.why === 'project')) return
  asks = [...asks.filter((a) => folderKey(a.folder) !== key), { folder: ask.folder, why: ask.why === 'launch' ? 'launch' : 'project' }]
  tell()
}

let started = false
/** Starts listening for the main process's asks (once, when the editor starts). */
export function startTrustAsks(): void {
  if (started || !api?.codeFilm?.onTrustAsk) return
  started = true
  api.codeFilm.onTrustAsk((ask) => add(ask))
  void api.codeFilm.trustAsks().then((list) => list.forEach(add)).catch(() => undefined)
}

/**
 * The user's answer. "Run": the main process trusts the folder (only one it
 * asked this window about) and the project's clips of it get their film.
 * Returns whether a film came back ("launch": the import that waited goes on
 * by itself). "Don't run": nothing changes.
 */
export async function answerTrust(ask: TrustAsk, run: boolean): Promise<boolean> {
  asks = asks.filter((a) => folderKey(a.folder) !== folderKey(ask.folder))
  tell()
  const info = await api?.codeFilm.trust(ask.folder, run).catch(() => null)
  if (!run) return false
  if (!info) return ask.why === 'launch'
  const s = useStore.getState()
  for (const a of waitingAssets(s.project.assets, ask.folder)) if (a.missing) s.setAssetDerived(a.id, { url: info.url, missing: false })
  return true
}
