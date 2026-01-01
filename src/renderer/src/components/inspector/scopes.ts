// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// Which Inspector cards are open by default for each kind of selection
// (kullanım, item 5; son, item A): only the main one; the rest fold, and
// what the user opens or folds is remembered per kind. Section ids, not
// titles. A code clip's main card is its code film (the values live there);
// an audio clip's is its sound level.
export type ScopeKind = 'clip' | 'code' | 'audio' | 'transition' | 'shape' | 'text' | 'line' | 'subs' | 'look'

export const SCOPE_OPEN: Record<ScopeKind, readonly string[]> = {
  clip: ['Clip', 'Adjustment layer', 'Camera look', 'Applied to this clip'],
  code: ['Code film', 'Clip', 'Applied to this clip'],
  audio: ['Audio', 'Applied to this clip'],
  transition: ['Transition'],
  shape: ['Selected shape'],
  text: ['Selected text (manual)', 'Motion', 'Style'],
  line: ['This line', 'Style'],
  subs: ['Style'],
  look: ['Camera look']
}

/** The kind of a selected clip, from its file's kind. */
export function clipScopeKind(assetKind: string | undefined): ScopeKind {
  return assetKind === 'code' ? 'code' : assetKind === 'audio' ? 'audio' : 'clip'
}

export const scopeOf = (kind: ScopeKind): { name: string; open: readonly string[] } => ({ name: `insp.${kind}`, open: SCOPE_OPEN[kind] })
