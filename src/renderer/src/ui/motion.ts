// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// The one place that says whether the interface's own motion runs (22
// November, L2). The user's machine has Windows' "Animation effects" off, so
// `prefers-reduced-motion: reduce` held and nothing in the program moved: not
// the agent's pulse, not the light at the preview's edge. Settings → General
// has the choice now: follow the system (the default), on, off.
//
// What this governs is decoration: pulses, sweeps, glows, fades, slides. The
// small pictures the user points at to SEE a transition or an animation play
// (a transition's card, a text animation's, a clip animation's) are content:
// they play whatever this says, and do not ask here.
//
// One answer for every sheet and every script: the class `motion-off` on
// <html> (the sheets), `motionOff()` (the scripts). No sheet and no other
// module reads `prefers-reduced-motion` itself (src/test/d22-d-motion.test.ts).
import { create } from 'zustand'

export type MotionPref = 'system' | 'on' | 'off'
export const MOTION_PREFS: readonly MotionPref[] = ['system', 'on', 'off']
export const MOTION_KEY = 'snipp-motion'
export const MOTION_OFF_CLASS = 'motion-off'

export const motionPrefOf = (saved: string | null | undefined): MotionPref => (saved === 'on' || saved === 'off' ? saved : 'system')

/** Whether decoration stands still: the user said off, or follows a system that asks for less motion. */
export const motionIsOff = (pref: MotionPref, systemReduced: boolean): boolean => pref === 'off' || (pref === 'system' && systemReduced)

const QUERY = '(prefers-reduced-motion: reduce)'
const systemQuery = (): MediaQueryList | null => (typeof matchMedia === 'function' ? matchMedia(QUERY) : null)
/** The system asks for less motion (now: read from the system each time). */
export const systemReduced = (): boolean => systemQuery()?.matches ?? false

const readPref = (): MotionPref => {
  try {
    return motionPrefOf(localStorage.getItem(MOTION_KEY))
  } catch {
    return 'system'
  }
}

/** The choice and what the system says, for the parts that show them (Settings). */
export const useMotion = create<{ pref: MotionPref; systemReduced: boolean; setPref: (pref: MotionPref) => void }>((set) => ({
  pref: readPref(),
  systemReduced: systemReduced(),
  setPref: (pref) => {
    try {
      if (pref === 'system') localStorage.removeItem(MOTION_KEY)
      else localStorage.setItem(MOTION_KEY, pref)
    } catch {
      /* storage blocked: the choice lasts this session */
    }
    set({ pref })
    apply()
  }
}))

/** Decoration stands still now. (The system is asked each time: a change of
 *  its setting counts at once, before the class on <html> has followed.) */
export const motionOff = (): boolean => motionIsOff(useMotion.getState().pref, systemReduced())

function apply(): void {
  if (typeof document === 'undefined') return
  const reduced = systemReduced()
  if (useMotion.getState().systemReduced !== reduced) useMotion.setState({ systemReduced: reduced })
  document.documentElement.classList.toggle(MOTION_OFF_CLASS, motionIsOff(useMotion.getState().pref, reduced))
}

let installed = false
/** Puts the class on <html> and keeps it right when the system's setting
 *  changes. Called once, before the first paint (main.tsx). */
export function installMotion(): void {
  apply()
  if (installed) return
  installed = true
  systemQuery()?.addEventListener('change', apply)
}
