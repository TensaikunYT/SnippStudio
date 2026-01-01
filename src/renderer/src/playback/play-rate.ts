// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// How fast the preview plays (ONIZLEME-UYGULA-PLAN.md, K3; the idea is
// VideoHub's speed select and its [ / ] keys). How the film is watched, never
// an edit: no undo step, nothing in the project, the export untouched. The
// engine reads it every tick (playback/engine.ts).
import { create } from 'zustand'

export const PLAY_RATES = [0.25, 0.5, 0.75, 1, 1.5, 2] as const

/** The rate one step slower (-1) or faster (1) than `rate`, kept in the list. */
export function stepRate(rate: number, dir: -1 | 1): number {
  const i = PLAY_RATES.findIndex((r) => Math.abs(r - rate) < 1e-6)
  const at = i >= 0 ? i : PLAY_RATES.indexOf(1)
  return PLAY_RATES[Math.min(PLAY_RATES.length - 1, Math.max(0, at + dir))]
}

/** A rate from anywhere (a saved value, the select) made one of the list. */
export const cleanRate = (v: unknown): number => {
  const n = Number(v)
  return PLAY_RATES.find((r) => Math.abs(r - n) < 1e-6) ?? 1
}

export const usePlayRate = create<{ rate: number; setRate: (rate: number) => void }>((set) => ({
  rate: 1,
  setRate: (rate) => set({ rate: cleanRate(rate) })
}))

/** The rate now (the engine's read). */
export const playRate = (): number => usePlayRate.getState().rate
