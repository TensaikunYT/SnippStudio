// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
/**
 * Ready shortcut sets in the style of other editors (phase 10, added by the
 * managing session on 20 November 2026; FAZ10-PLAN.md "Hazır kısayol
 * takımları"). One click in the Shortcuts window sets the user's bindings;
 * each key can still be changed and "Reset to defaults" still works.
 *
 * Only keys read on the program's own public documentation are written here,
 * each with its page (read 20 Nov 2026). An action SnippStudio has no
 * counterpart for, or whose key could not be verified, keeps its default.
 * Where a set's key lands on the default key of another action, that action
 * takes the key the set freed (`moved`): two actions never share a key
 * (shortcuts-presets.test.ts). Keys the app keeps for itself (Delete,
 * Ctrl+C / V / D / Y, M…: App.tsx) are never given out.
 *
 * Bindings are written as shortcuts.ts stores them: "ctrl" is Ctrl on
 * Windows and Linux and Cmd on a Mac (eventToBinding); `mac` is a different
 * key on a Mac where the program's own Mac column differs. Labels come from
 * shortcuts.ts / os-platform.ts (⌘ on a Mac). Names are "… style": no logo,
 * no picture of any program.
 * Pure: no DOM.
 */
import { ACTIONS, defaultBindings, type ActionId, type Bindings } from './shortcuts'
import type { StringKey } from './ui/strings'
import type { UiPlatform } from './os-platform'

export type PresetId = 'snippstudio' | 'premiere' | 'davinci' | 'capcut'

export interface PresetKey {
  action: ActionId
  key: string
  /** The key on a Mac when the program's Mac column differs. */
  mac?: string
  /** The page it was read on. */
  source: string
}

export interface ShortcutPreset {
  id: PresetId
  nameKey: StringKey
  /** At least one key could be checked on the program's own documentation. */
  verified: boolean
  keys: PresetKey[]
  /** Actions with no counterpart there, moved off a key the set took. */
  moved: Partial<Record<ActionId, string>>
}

const PREMIERE_KEYS = 'https://helpx.adobe.com/premiere/desktop/get-started/keyboard-shortcuts/default-keyboard-shortcuts.html'
const PREMIERE_TOOLS = 'https://helpx.adobe.com/premiere/desktop/edit-projects/intro-to-editing/edit-video-in-premiere.html'
const CAPCUT_SPLIT = 'https://www.capcut.com/help/split-the-subtiltes'
const CAPCUT_IN_OUT = 'https://www.capcut.com/help/export-clip-of-video'

/** Keys App.tsx handles itself, before or besides the bindings: a set never uses them. */
export const RESERVED_KEYS: readonly string[] = ['delete', 'shift+delete', 'ctrl+c', 'ctrl+v', 'ctrl+shift+v', 'ctrl+d', 'ctrl+y', 'm', 'escape', 'ctrl+f', 'ctrl+space', 'f11']

export const PRESETS: ShortcutPreset[] = [
  { id: 'snippstudio', nameKey: 'keys.preset.snippstudio', verified: true, keys: [], moved: {} },
  {
    id: 'premiere',
    nameKey: 'keys.preset.premiere',
    verified: true,
    keys: [
      // Tools: "Use V to switch to the Selection tool. Use C … the Razor tool."
      { action: 'selectTool', key: 'v', source: PREMIERE_TOOLS },
      { action: 'splitTool', key: 'c', source: PREMIERE_TOOLS },
      // Sequence menu: Add Edit; Clip menu: Enable (Shift+Cmd+E on a Mac).
      { action: 'splitHere', key: 'ctrl+k', source: PREMIERE_KEYS },
      { action: 'toggleDisable', key: 'shift+e', mac: 'ctrl+shift+e', source: PREMIERE_KEYS },
      // Timeline panel: Nudge Clip Selection Left / Right One Frame (Cmd+Left / Right on a Mac).
      { action: 'nudgeLeft', key: 'alt+arrowleft', mac: 'ctrl+arrowleft', source: PREMIERE_KEYS },
      { action: 'nudgeRight', key: 'alt+arrowright', mac: 'ctrl+arrowright', source: PREMIERE_KEYS },
      // The same as SnippStudio's own (read there, kept): Undo, Redo, Save,
      // Select All, Mark In / Out, Go to Next / Previous Marker.
      { action: 'undo', key: 'ctrl+z', source: PREMIERE_KEYS },
      { action: 'redo', key: 'ctrl+shift+z', source: PREMIERE_KEYS },
      { action: 'save', key: 'ctrl+s', source: PREMIERE_KEYS },
      { action: 'selectAll', key: 'ctrl+a', source: PREMIERE_KEYS },
      { action: 'shortIn', key: 'i', source: PREMIERE_KEYS },
      { action: 'shortOut', key: 'o', source: PREMIERE_KEYS },
      { action: 'nextMarker', key: 'shift+m', source: PREMIERE_KEYS },
      { action: 'prevMarker', key: 'ctrl+shift+m', source: PREMIERE_KEYS }
    ],
    // SnippStudio's cutter (no Premiere counterpart) lived on C: it takes B,
    // which the split tool left.
    moved: { cutter: 'b' }
  },
  // No public keyboard-shortcut page of Blackmagic Design could be read: the
  // official lists are PDF downloads (not taken), the rest is forum posts.
  // Not verified: shown, closed (FAZ10-PLAN.md).
  { id: 'davinci', nameKey: 'keys.preset.davinci', verified: false, keys: [], moved: {} },
  {
    id: 'capcut',
    nameKey: 'keys.preset.capcut',
    verified: true,
    keys: [
      // "Press Ctrl+B (Windows) or Cmd+B (macOS)" to split; I and O mark in and out.
      { action: 'splitHere', key: 'ctrl+b', source: CAPCUT_SPLIT },
      { action: 'shortIn', key: 'i', source: CAPCUT_IN_OUT },
      { action: 'shortOut', key: 'o', source: CAPCUT_IN_OUT }
    ],
    moved: {}
  }
]

export const presetById = (id: PresetId): ShortcutPreset => PRESETS.find((p) => p.id === id)!

/** The bindings a set gives on a platform: the defaults, its keys, the moved ones. */
export function presetBindings(id: PresetId, platform: UiPlatform): Bindings {
  const p = presetById(id)
  const b = defaultBindings()
  for (const k of p.keys) b[k.action] = platform === 'darwin' && k.mac ? k.mac : k.key
  for (const [a, key] of Object.entries(p.moved) as [ActionId, string][]) b[a] = key
  return b
}

/** The set the bindings are exactly (null: the user's own). */
export function presetOf(bindings: Bindings, platform: UiPlatform): PresetId | null {
  for (const p of PRESETS) {
    if (!p.verified) continue
    const want = presetBindings(p.id, platform)
    if (ACTIONS.every((a) => want[a.id] === bindings[a.id])) return p.id
  }
  return null
}

/** Two actions on one key, or a key the app keeps (tests; empty when fine). */
export function bindingClashes(b: Bindings): string[] {
  const out: string[] = []
  // Each scope on its own (ONIZLEME-UYGULA-PLAN.md, K1): a review's key is
  // read before the global ones while the review is open, so it may be a
  // global action's key too; two actions of one scope never share a key.
  const seenIn = new Map<string, Map<string, ActionId>>()
  const seen = new Map<string, ActionId>()
  for (const a of ACTIONS) {
    const k = b[a.id]
    if (RESERVED_KEYS.includes(k)) out.push(`${a.id}: ${k} is kept by the app`)
    const scope = a.scope ?? ''
    let mine = seenIn.get(scope)
    if (!mine) seenIn.set(scope, (mine = scope ? new Map() : seen))
    const was = mine.get(k)
    if (was) out.push(`${was} and ${a.id}: ${k}`)
    else mine.set(k, a.id)
  }
  // The Alt forms of the three cuts are theirs too (App.tsx: alt+q / alt+w / alt+e).
  for (const a of ['trimLeft', 'trimRight', 'closeGap'] as const) {
    const alt = `alt+${b[a]}`
    const hit = seen.get(alt)
    if (hit) out.push(`${hit}: ${alt} is ${a}'s Alt form`)
  }
  return out
}
