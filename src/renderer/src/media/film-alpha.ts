// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// Whether a code film's picture lets the tracks under it through (phase 5b,
// decision 2). Its asset says so once its strip sampled it (`code.hasAlpha`,
// kept in the project); until then, what this session found out (an export
// that started before the strip was done works it out itself: 5a/5b patch,
// audit S-9). Pure: no page, no store.
import type { Asset } from '../types'

const sessionAlpha = new Map<string, boolean>()

export function noteFilmAlpha(assetId: string, alpha: boolean): void {
  sessionAlpha.set(assetId, alpha)
}

/** Known at all (by the asset or this session)? */
export function filmAlphaKnown(asset: Asset): boolean {
  return typeof asset.code?.hasAlpha === 'boolean' || sessionAlpha.has(asset.id)
}

/** May the film let the tracks under it through? */
export function filmHasAlpha(asset: Asset): boolean {
  return asset.code?.hasAlpha ?? sessionAlpha.get(asset.id) ?? false
}
