// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// The operating system as the editor sees it (phase 10a, steps 5 and 6): the
// names of the modifier keys, which mouse modifier means "add to the
// selection" or "zoom", the fonts this computer has, and the font stacks of
// the few canvas texts that name a system face. Everything here is a pure
// function of a platform passed in; the default is the running window's
// (navigator.platform: the renderer has no `process`). The Windows answer of
// every function is what the code did before phase 10 (FAZ10-PLAN.md,
// decision 1): Windows does not change.
//
// No imports: types.ts, the strings and the templates use it.

export type UiPlatform = 'win32' | 'darwin' | 'linux'

/** "Win32", "MacIntel", "Linux x86_64"… → the platform. Anything that is not
 *  Windows or a Mac counts as Linux (the third platform the app is built for). */
export function platformFromNavigator(s: string | undefined | null): UiPlatform {
  if (!s) return 'win32'
  if (/^win/i.test(s)) return 'win32'
  if (/^mac/i.test(s) || /^darwin/i.test(s)) return 'darwin'
  return 'linux'
}

let forced: UiPlatform | null = null
let seen: UiPlatform | null = null

/** The platform this window runs on. */
export function uiPlatform(): UiPlatform {
  if (forced) return forced
  if (!seen) seen = platformFromNavigator(typeof navigator !== 'undefined' ? navigator.platform : undefined)
  return seen
}

/** Tests only: act as `p` (null: the real one again). */
export function setUiPlatformForTests(p: UiPlatform | null): void {
  forced = p
  captionDefault = null
}

// ---- Keys ---------------------------------------------------------------------

export type ModKey = 'ctrl' | 'meta' | 'alt' | 'shift'

// The Mac signs are written as code points: they are the names printed on a
// Mac's keys, not icons (ui-text.test.ts's glyph rule is about icons and only
// reads the interface's own files).
const CMD = String.fromCodePoint(0x2318)
const OPT = String.fromCodePoint(0x2325)
const CTL = String.fromCodePoint(0x2303)
const SHF = String.fromCodePoint(0x21e7)

const MOD_NAMES: Record<UiPlatform, Record<ModKey, string>> = {
  // Before phase 10 every platform got these (ui/logic.ts shortcutLabel).
  win32: { ctrl: 'Ctrl', meta: 'Win', alt: 'Alt', shift: 'Shift' },
  linux: { ctrl: 'Ctrl', meta: 'Super', alt: 'Alt', shift: 'Shift' },
  // A binding's "ctrl" is Ctrl OR Cmd (shortcuts.ts eventToBinding): on a Mac
  // the key a person presses, and so the one to name, is Cmd.
  darwin: { ctrl: CMD, meta: CMD, alt: OPT, shift: SHF }
}

/** The name of a modifier key on a platform. */
export function modKeyName(mod: ModKey, platform: UiPlatform = uiPlatform()): string {
  return MOD_NAMES[platform][mod]
}

/** The aria-keyshortcuts name of a binding's modifier ("ctrl" is Meta on a Mac). */
export function ariaModName(mod: ModKey, platform: UiPlatform = uiPlatform()): string {
  if (platform === 'darwin' && (mod === 'ctrl' || mod === 'meta')) return 'Meta'
  return { ctrl: 'Control', meta: 'Meta', alt: 'Alt', shift: 'Shift' }[mod]
}

/**
 * A sentence of the interface with its key names as this platform's keyboard
 * writes them. The texts (ui/strings*.ts) say "Ctrl+Z", "Alt+drag",
 * "Ctrl/Shift": on a Mac that is Cmd+Z, Option+drag, Cmd/Shift. One
 * exception: Ctrl+Space (the subtitle editor's split) is read as the Control
 * key itself (PreviewCanvas checks ctrlKey), so on a Mac it is ⌃+Space.
 * Windows and Linux: the text as written.
 */
export function keysInText(text: string, platform: UiPlatform = uiPlatform()): string {
  if (platform !== 'darwin' || !/\b(Ctrl|Alt)[+/]/.test(text)) return text
  return text
    .replace(/\bCtrl\+Space\b/g, `${CTL}+Space`)
    .replace(/\bCtrl(?=[+/])/g, CMD)
    .replace(/\bAlt(?=\+)/g, OPT)
}

interface Mods {
  ctrlKey: boolean
  metaKey: boolean
}

/** Is the "add to the selection" modifier held with a click? Ctrl on Windows
 *  and Linux (as before); on a Mac Cmd, as Finder does (Ctrl+click is a
 *  right-click there, but a pointerdown that has it still counts). */
export function addModHeld(e: Mods, platform: UiPlatform = uiPlatform()): boolean {
  return platform === 'darwin' ? e.metaKey || e.ctrlKey : e.ctrlKey
}

/** Does this wheel turn zoom the timeline? Ctrl+wheel (and a trackpad pinch,
 *  which arrives as one) everywhere; on a Mac Cmd+wheel too. */
export function zoomWheelHeld(e: Mods, platform: UiPlatform = uiPlatform()): boolean {
  return platform === 'darwin' ? e.ctrlKey || e.metaKey : e.ctrlKey
}

// ---- Fonts ----------------------------------------------------------------------

/** Measures a text in a CSS font (canvas `font` syntax): its width in pixels. */
export type MeasureFont = (font: string) => number

const PROBE_TEXT = 'mmmmmmmmmmlli WQ@#0Oo1'
const GENERICS = ['monospace', 'serif', 'sans-serif']

/**
 * Is `family` a face this computer can draw? A face that is missing falls
 * back to the generic family after it, so the text measures exactly like the
 * generic alone; an installed one differs from at least one of the three.
 * (document.fonts.check() cannot tell: it answers true for a face it knows
 * nothing about.)
 */
export function fontInstalledBy(measure: MeasureFont, family: string): boolean {
  const name = family.replace(/"/g, '')
  return GENERICS.some((g) => measure(`72px "${name}", ${g}`) !== measure(`72px ${g}`))
}

let canvasMeasure: MeasureFont | null | undefined

/** A measurer on a small canvas of this window; null where there is none (Node). */
export function windowMeasure(): MeasureFont | null {
  if (canvasMeasure !== undefined) return canvasMeasure
  canvasMeasure = null
  try {
    if (typeof document !== 'undefined') {
      const ctx = document.createElement('canvas').getContext('2d')
      if (ctx) {
        canvasMeasure = (font: string): number => {
          ctx.font = font
          return ctx.measureText(PROBE_TEXT).width
        }
      }
    }
  } catch {
    canvasMeasure = null
  }
  return canvasMeasure
}

/** The face every platform has: bundled with the app (fonts.ts). */
export const BUNDLED_FALLBACK = 'Inter'

/**
 * The subtitle font a new project starts with. Windows: Arial, as always (a
 * user's existing look must not change). Elsewhere Arial if this computer has
 * it (a Mac does), otherwise the bundled Inter, which looks the same on every
 * computer. Without a way to measure (`installed` null: Node, the tests) the
 * answer stays Arial, so a project made in a test is the same everywhere.
 */
export function defaultCaptionFont(platform: UiPlatform, installed: ((family: string) => boolean) | null): string {
  if (platform === 'win32' || !installed) return 'Arial'
  return installed('Arial') ? 'Arial' : BUNDLED_FALLBACK
}

let captionDefault: string | null = null

/** defaultCaptionFont for this window, found once. */
export function captionFontDefault(): string {
  if (captionDefault) return captionDefault
  const p = uiPlatform()
  const m = p === 'win32' ? null : windowMeasure()
  captionDefault = defaultCaptionFont(p, m ? (f) => fontInstalledBy(m, f) : null)
  return captionDefault
}

export interface FontChoice {
  family: string
  /** Named in the list (or chosen) but not on this computer. */
  missing: boolean
}

/**
 * The font list a picker shows. `always` are the faces that are always there
 * (bundled, imported). Windows: the list as it is, nothing marked (as before
 * phase 10). Elsewhere a system face this computer does not have is left out,
 * unless it is the one chosen (`current`): that one stays, marked missing.
 */
export function fontChoices(list: readonly string[], always: ReadonlySet<string>, platform: UiPlatform, installed: ((family: string) => boolean) | null, current?: string): FontChoice[] {
  if (platform === 'win32' || !installed) return list.map((family) => ({ family, missing: false }))
  const out: FontChoice[] = []
  for (const family of list) {
    const here = always.has(family) || installed(family)
    if (here) out.push({ family, missing: false })
    else if (family === current) out.push({ family, missing: true })
  }
  if (current && !list.includes(current) && !always.has(current) && !installed(current)) out.push({ family: current, missing: true })
  return out
}

/** The monospace stack of the terminal template. Windows: as before; elsewhere
 *  the bundled JetBrains Mono first (ui/fonts, loaded by fonts.ts). */
export function terminalMonoStack(platform: UiPlatform = uiPlatform()): string {
  const win = '"Cascadia Mono", Consolas, "DejaVu Sans Mono", monospace'
  return platform === 'win32' ? win : `"JetBrains Mono", ${win}`
}

/** The face of the preview's own small labels (never exported). Windows: as
 *  before; elsewhere the interface's bundled face. */
export function overlayFontStack(platform: UiPlatform = uiPlatform()): string {
  return platform === 'win32' ? '"Segoe UI", sans-serif' : '"Inter UI", "Segoe UI", sans-serif'
}
