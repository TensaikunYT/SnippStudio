// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// The undo gesture of a slider or a number field (moved out of controls.tsx in
// phase 3c.1, so the building blocks' Slider opens and closes the same window:
// one drag is one undo step; tarifler/FAZ3C.md decision 5).
import { useRef } from 'react'
import { useStore } from '../state/store'

export interface UndoGesture {
  arm: () => void
  fire: () => void
  end: () => void
}

/**
 * One undo step per slider gesture.
 *
 * The store actions behind these controls deliberately don't snapshot: a range
 * input fires `change` on every pixel, so snapshotting per change would bury the
 * undo stack under a hundred entries for a single drag. But nothing was taking a
 * snapshot at all, which left every slider edit — blur, crop, grade, animation —
 * completely un-undoable.
 *
 * So the gesture ARMS a snapshot (pointer down on the track, focusing the number
 * box, a key press) and the store spends it on the first project change. Arming
 * rather than pushing is deliberate: these same controls also drive plain UI
 * state (the silence-cut dialog, the gradient builder), and pushing up front
 * gave those an undo step that undid nothing.
 */
export function useGestureOnce(): UndoGesture {
  const armed = useRef(false)
  const open = useRef(false)
  const end = (): void => {
    armed.current = false
    if (!open.current) return
    open.current = false
    useStore.getState().endGesture()
  }
  return {
    arm: (): void => {
      if (open.current) return
      armed.current = true
    },
    fire: (): void => {
      // Already inside a gesture: the store is collapsing everything until the
      // release into one step. Re-arming here would start a NEW step on every
      // key repeat of a held arrow key.
      if (open.current || !armed.current) return
      armed.current = false
      open.current = true
      useStore.getState().armGesture()
      // The release can land anywhere — outside the input, outside the window —
      // so the close is listened for globally rather than on the control.
      const done = (): void => {
        window.removeEventListener('pointerup', done)
        window.removeEventListener('pointercancel', done)
        window.removeEventListener('keyup', done)
        end()
      }
      window.addEventListener('pointerup', done)
      window.addEventListener('pointercancel', done)
      window.addEventListener('keyup', done)
    },
    end
  }
}

