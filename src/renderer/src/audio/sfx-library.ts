// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
import type { LibrarySound } from '../../../preload/index'
import { importLibrarySound } from '../media/import'
import { useStore } from '../state/store'

const PREF_KEY = 'snipp-sfx-preferences'
export const SFX_PREF_CHANGED = 'snipp-sfx-preferences-changed'
export const SFX_LIBRARY_CHANGED = 'snipp-sfx-library-changed'

export interface SfxPreferences {
  id: string
  lead: number
  volume: number
}

export function readSfxPreferences(): SfxPreferences {
  try {
    const raw = JSON.parse(localStorage.getItem(PREF_KEY) ?? '{}') as Partial<SfxPreferences>
    return {
      id: typeof raw.id === 'string' ? raw.id : '',
      lead: Number.isFinite(raw.lead) ? Math.max(0, Math.min(0.5, raw.lead!)) : 0.12,
      volume: Number.isFinite(raw.volume) ? Math.max(0, Math.min(100, raw.volume!)) : 65
    }
  } catch {
    return { id: '', lead: 0.12, volume: 65 }
  }
}

export function saveSfxPreferences(patch: Partial<SfxPreferences>): SfxPreferences {
  const next = { ...readSfxPreferences(), ...patch }
  try { localStorage.setItem(PREF_KEY, JSON.stringify(next)) } catch { /* private storage */ }
  window.dispatchEvent(new Event(SFX_PREF_CHANGED))
  return next
}

/** One placement path for the dock and timeline quick action. */
export async function placeSavedSound(sound: LibrarySound, times: readonly number[], lead: number, volume: number): Promise<number> {
  if (times.length === 0) return 0
  const state = useStore.getState()
  let asset = state.project.assets.find((item) => item.kind === 'audio' && item.path === sound.path)
  if (!asset) {
    const result = await importLibrarySound(sound)
    if (result.errors.length) throw new Error(result.errors.join(' · '))
    asset = result.assets[0]
  }
  if (!asset) throw new Error('Could not read this audio file.')
  let placed = 0
  useStore.getState().undoable(() => {
    const store = useStore.getState()
    if (!store.project.assets.some((item) => item.id === asset.id)) store.addAssets([asset])
    placed = store.placeSoundEffect(asset.id, times, lead, volume)
  })
  return placed
}
