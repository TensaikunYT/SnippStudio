// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// How the focus came to where it is (audit E2): by the keyboard (Tab, the
// arrows, a menu chosen with Enter, a dialog closed with Escape) or by the
// pointer (a click, or anything a click did). The browser's :focus-visible
// cannot tell it afterwards: a key pressed on a clicked button turns it on.
// Space reads this: on a control the keyboard reached it presses that control,
// on one a click left focused it plays (shortcuts.ts, spaceWorksControl).

let lastInputWasKey = false
let focusByKey = false
let installed: Window | null = null

const onPointer = (): void => {
  lastInputWasKey = false
}
const onKey = (e: KeyboardEvent): void => {
  // A lone modifier is no way of moving the focus.
  if (e.key === 'Shift' || e.key === 'Control' || e.key === 'Alt' || e.key === 'Meta') return
  lastInputWasKey = true
}
const onFocus = (): void => {
  focusByKey = lastInputWasKey
}

/** Starts listening (once per window; the capture phase, so no handler that
 *  stops a key or a press hides it). */
export function installFocusOrigin(win: Window = window): () => void {
  if (installed === win) return () => undefined
  installed = win
  win.addEventListener('pointerdown', onPointer, true)
  win.addEventListener('keydown', onKey, true)
  win.addEventListener('focusin', onFocus, true)
  return () => {
    win.removeEventListener('pointerdown', onPointer, true)
    win.removeEventListener('keydown', onKey, true)
    win.removeEventListener('focusin', onFocus, true)
    if (installed === win) installed = null
  }
}

/** Whether the element that has the focus got it from the keyboard. */
export const focusCameByKeyboard = (): boolean => focusByKey
