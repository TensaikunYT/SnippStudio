// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// The pure part of "Run the code in this folder?" (security patch, item 6;
// security/trust.ts): which folder is the same folder, which clips wait for
// one, which ask is shown. No store, no bridge: tested alone.
import type { Asset } from '../types'

export interface TrustAsk {
  folder: string
  /** 'project': a clip of an opened project. 'launch': the app was started for this folder. */
  why: 'project' | 'launch'
}

/** The same folder, however it is written (slashes, case as Windows compares). */
export const folderKey = (p: string): string => p.replace(/[\\/]+/g, '/').replace(/\/+$/, '').toLowerCase()

/** The code clips of a project that are of this folder. */
export const waitingAssets = (assets: readonly Asset[], folder: string): Asset[] => assets.filter((a) => a.kind === 'code' && !!a.path && folderKey(a.path) === folderKey(folder))

/**
 * The ask to show now, if any: one the app was started for, or one a clip of
 * the open project waits for. (A project only offered, a crash snapshot not
 * taken yet, asks nothing until it is the open one.)
 */
export function askToShow(list: readonly TrustAsk[], assets: readonly Asset[]): TrustAsk | null {
  return list.find((a) => a.why === 'launch' || waitingAssets(assets, a.folder).some((x) => x.missing)) ?? null
}
