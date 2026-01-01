// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// The terminal template: its keyboard, its layout and the typed script.
// Moved out of templates/model.ts in SnippStudio phase 2B (no change).
import { type TemplateBlock } from '../../types'
import type { Rect } from './common'

/** What the typing template types into. */
export type TerminalDesign = 'terminal' | 'browser' | 'chat' | 'notes' | 'search'
export const terminalDesign = (b: Pick<TemplateBlock, 'design'>): TerminalDesign =>
  b.design === 'browser' || b.design === 'chat' || b.design === 'notes' || b.design === 'search' ? b.design : 'terminal'

// -- the terminal ------------------------------------------------------------------

/** A key on the keyboard (frame pixels): what it types and what it says. */
export interface KeyCap {
  id: string
  label: string
  x: number
  y: number
  w: number
  h: number
}

/** A US (ANSI) keyboard: rows of [what it types, its label, width in keys]. */
export const US_ROWS: [string, string, number][][] = [
  [['`', '`', 1], ['1', '1', 1], ['2', '2', 1], ['3', '3', 1], ['4', '4', 1], ['5', '5', 1], ['6', '6', 1], ['7', '7', 1], ['8', '8', 1], ['9', '9', 1], ['0', '0', 1], ['-', '-', 1], ['=', '=', 1], ['backspace', '⌫', 2]],
  [['tab', 'tab', 1.5], ['q', 'Q', 1], ['w', 'W', 1], ['e', 'E', 1], ['r', 'R', 1], ['t', 'T', 1], ['y', 'Y', 1], ['u', 'U', 1], ['i', 'I', 1], ['o', 'O', 1], ['p', 'P', 1], ['[', '[', 1], [']', ']', 1], ['\\', '\\', 1.5]],
  [['caps', 'caps', 1.75], ['a', 'A', 1], ['s', 'S', 1], ['d', 'D', 1], ['f', 'F', 1], ['g', 'G', 1], ['h', 'H', 1], ['j', 'J', 1], ['k', 'K', 1], ['l', 'L', 1], [';', ';', 1], ["'", "'", 1], ['enter', 'return', 2.25]],
  [['lshift', 'shift', 2.25], ['z', 'Z', 1], ['x', 'X', 1], ['c', 'C', 1], ['v', 'V', 1], ['b', 'B', 1], ['n', 'N', 1], ['m', 'M', 1], [',', ',', 1], ['.', '.', 1], ['/', '/', 1], ['rshift', 'shift', 2.75]],
  [['ctrl', 'ctrl', 1.5], ['alt', 'alt', 1.5], [' ', '', 9], ['altr', 'alt', 1.5], ['ctrlr', 'ctrl', 1.5]]
]

/** What needs shift, and the key it is on. */
export const SHIFTED: Record<string, string> = {
  '~': '`', '!': '1', '@': '2', '#': '3', '$': '4', '%': '5', '^': '6', '&': '7', '*': '8', '(': '9', ')': '0', '_': '-', '+': '=',
  '{': '[', '}': ']', '|': '\\', ':': ';', '"': "'", '<': ',', '>': '.', '?': '/'
}

/** The key a character is typed on, and whether shift is held for it
 *  (null: not on the keyboard — skipped). */
export function keyFor(ch: string): { key: string; shift: boolean } | null {
  if (ch === '\n') return { key: 'enter', shift: false }
  if (/^[a-z0-9 `\-=[\];',./\\]$/.test(ch)) return { key: ch, shift: false }
  if (/^[A-Z]$/.test(ch)) return { key: ch.toLowerCase(), shift: true }
  if (SHIFTED[ch]) return { key: SHIFTED[ch], shift: true }
  return null
}

export function keyboardLayout(left: number, W: number, H: number): { plate: Rect; keys: KeyCap[]; unit: number } {
  const portrait = W / H < 1
  // The keyboard kept modest, its bottom row just above the dock: the
  // screen above it is what matters.
  const kw = portrait ? W * 0.88 : W * 0.46
  const unit = kw / 15
  const gap = unit * 0.08
  const top = (portrait ? H * 0.8 : H * 0.905) - 5 * unit
  const x0 = left + (W - kw) / 2
  const keys: KeyCap[] = []
  US_ROWS.forEach((row, ri) => {
    let x = x0
    for (const [id, label, w] of row) {
      keys.push({ id, label, x: x + gap / 2, y: top + ri * unit + gap / 2, w: w * unit - gap, h: unit - gap })
      x += w * unit
    }
  })
  const pad = unit * 0.28
  return { plate: { x: x0 - pad, y: top - pad, w: kw + pad * 2, h: 5 * unit + pad * 2 }, keys, unit }
}

export function terminalLayout(left: number, W: number, H: number): { win: Rect; dock: Rect; icons: Rect[]; kb: ReturnType<typeof keyboardLayout> } {
  const portrait = W / H < 1
  const win: Rect = portrait ? { x: left + W * 0.04, y: H * 0.08, w: W * 0.92, h: H * 0.44 } : { x: left + W * 0.13, y: H * 0.045, w: W * 0.74, h: H * 0.5 }
  const ds = H * (portrait ? 0.05 : 0.075)
  const n = 3
  const dw = n * ds + (n + 1) * ds * 0.32
  const dock: Rect = { x: left + W / 2 - dw / 2, y: H * 0.86 - ds * 0.66, w: dw, h: ds * 1.32 }
  const icons: Rect[] = Array.from({ length: n }, (_, i) => ({ x: dock.x + ds * 0.32 + i * ds * 1.32, y: dock.y + ds * 0.16, w: ds, h: ds }))
  return { win, dock, icons, kb: keyboardLayout(left, W, H) }
}

export interface TypedLine {
  text: string
  out?: string
  /** When each character lands (block time), the Enter, the output. */
  at: number[]
  enter: number
  outAt: number
}

/**
 * The terminal's script (block time): the tap on the keyboard in the dock,
 * the keyboard and the window coming up, then every key of every line —
 * paced to fill the block (quicker for more text, never frantic), a beat
 * after each Enter for the output.
 */
export function terminalScript(b: Pick<TemplateBlock, 'duration' | 'items' | 'design'>): { tap: number; ready: number; lines: TypedLine[]; presses: { t: number; key: string; shift: boolean }[] } {
  const tap = 0.75
  // The first key comes a beat after the tap on the dock.
  const ready = 1.85
  const chat = terminalDesign(b) === 'chat'
  // How long after Enter the answer comes (your own, or the screen's beat):
  // a chat reply waits behind its typing dots and the next message after it.
  // A search takes a moment to come back.
  const search = terminalDesign(b) === 'search'
  const wait = (v: number | undefined): number => (typeof v === 'number' && v > 0 ? Math.min(8, v) : chat ? 0.85 : search ? 1.5 : 0.22)
  const lines = b.items.map((it) => ({ text: it.title ?? '', out: it.note, wait: wait(it.value) }))
  const chars = lines.reduce((n, l) => n + [...l.text].filter((ch) => keyFor(ch)).length + (l.text ? 1 : 0), 0)
  const waits = lines.reduce((n, l) => n + (chat && l.out ? l.wait + 0.3 : search ? l.wait + 1.2 : 0.42), 0)
  const room = Math.max(0.5, b.duration - ready - 0.9 - waits)
  const dt = Math.min(0.16, Math.max(0.065, room / Math.max(1, chars)))
  const out: TypedLine[] = []
  const presses: { t: number; key: string; shift: boolean }[] = []
  let t = ready
  for (const l of lines) {
    // A line with nothing to type is only what comes back (in a chat, the
    // other side writing first).
    if (!l.text.trim()) {
      const at = t + (chat ? l.wait : 0.1)
      out.push({ text: '', out: l.out, at: [], enter: t, outAt: at })
      t = at + 0.5
      continue
    }
    const at: number[] = []
    for (const ch of l.text) {
      const k = keyFor(ch)
      at.push(t)
      if (k) {
        presses.push({ t, key: k.key, shift: k.shift })
        t += dt * (ch === ' ' ? 1.25 : 1)
      }
    }
    const enter = t + dt * 0.8
    presses.push({ t: enter, key: 'enter', shift: false })
    const outAt = enter + l.wait
    out.push({ text: l.text, out: l.out, at, enter, outAt })
    t = chat && l.out ? outAt + 0.3 : search ? outAt + 1.2 : enter + 0.42
  }
  return { tap, ready, lines: out, presses }
}
