// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
import { useSyncExternalStore } from 'react'

/**
 * Show, don't tell: the panels' help texts (`.hint`) take one line each.
 *
 * The rest of a long one is a hover away (its tooltip) or a click away (it
 * opens in place); File → Long explanations shows them all in full again. The
 * text itself stays in the page, so a screen reader still reads all of it.
 */
const KEY = 'snipp-explanations'
const listeners = new Set<() => void>()

function read(): boolean {
  try {
    return localStorage.getItem(KEY) === 'long'
  } catch {
    return false
  }
}

let long = read()

function apply(): void {
  document.documentElement.classList.toggle('hints-long', long)
}

export function explanationsLong(): boolean {
  return long
}

export function setExplanationsLong(on: boolean): void {
  long = on
  try {
    localStorage.setItem(KEY, on ? 'long' : 'short')
  } catch {
    /* storage blocked: the switch still works for this session */
  }
  apply()
  for (const f of listeners) f()
}

export function useExplanationsLong(): boolean {
  return useSyncExternalStore(
    (f) => {
      listeners.add(f)
      return () => listeners.delete(f)
    },
    () => long
  )
}

/** A hint cut to its first line? (Only those get a tooltip and a click.) */
function clipped(el: HTMLElement): boolean {
  return !long && !el.classList.contains('open') && el.scrollHeight > el.clientHeight + 2
}

/**
 * Installed once: hovering a cut hint gives its whole text as the tooltip,
 * clicking it opens it in place (and again closes it). Delegated, so the
 * hundred-odd hints in the panels need nothing of their own.
 */
export function installHints(): () => void {
  apply()
  const over = (e: PointerEvent): void => {
    const el = (e.target as HTMLElement | null)?.closest?.('.hint') as HTMLElement | null
    if (!el) return
    if (clipped(el)) {
      if (!el.title) el.title = `${el.textContent ?? ''}\n\n(click to read it here)`
      el.classList.add('cut')
    } else if (!el.classList.contains('open')) {
      el.classList.remove('cut')
    }
  }
  const click = (e: MouseEvent): void => {
    const el = (e.target as HTMLElement | null)?.closest?.('.hint') as HTMLElement | null
    if (!el || long) return
    // A link or a button inside a hint keeps its own click.
    if ((e.target as HTMLElement).closest('button, a, input, select, textarea') !== el && (e.target as HTMLElement).closest('button, a, input, select, textarea')) return
    if (el.classList.contains('open')) el.classList.remove('open')
    else if (clipped(el)) {
      el.classList.add('open')
      el.removeAttribute('title')
    }
  }
  document.addEventListener('pointerover', over)
  document.addEventListener('click', click)
  return () => {
    document.removeEventListener('pointerover', over)
    document.removeEventListener('click', click)
  }
}
