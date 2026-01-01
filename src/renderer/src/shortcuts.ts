// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
/**
 * User-rebindable keyboard shortcuts. Bindings are stored as normalized
 * strings (e.g. "space", "ctrl+z", "arrowleft") in localStorage; the defaults
 * below match what the app has always shipped with.
 */
import { t, type StringKey } from './ui/strings'
import { modKeyName, uiPlatform } from './os-platform'

export type ActionId =
  | 'playPause'
  | 'delete'
  | 'split'
  | 'splitTool'
  | 'slipTool'
  | 'cutter'
  | 'selectTool'
  | 'selectAll'
  | 'undo'
  | 'redo'
  | 'save'
  | 'goStart'
  | 'frameBack'
  | 'frameForward'
  | 'secondBack'
  | 'secondForward'
  | 'nudgeLeft'
  | 'nudgeRight'
  | 'splitHere'
  | 'trimLeft'
  | 'trimRight'
  | 'closeGap'
  | 'shuttleBack'
  | 'shuttlePause'
  | 'shuttleForward'
  | 'shortIn'
  | 'shortOut'
  | 'zoomFit'
  | 'zoomSelection'
  | 'prevEdit'
  | 'nextEdit'
  | 'toggleLoop'
  | 'nextMarker'
  | 'prevMarker'
  | 'toggleDisable'
  | 'newNote'
  | 'prevKeyframe'
  | 'nextKeyframe'
  | 'toggleKeyframe'
  | 'addTransition'
  | 'settings'
  | 'goToTime'
  | 'slower'
  | 'faster'
  | 'previewActual'
  | 'previewFit'
  | 'prevNote'
  | 'nextNote'
  | 'narration'
  | 'shortcutList'
  | 'reviewBefore'
  | 'reviewApprove'
  | 'pointNote'
  | 'watchMode'

/** Where a key works: everywhere (no scope), or only while that part is open
 *  (ONIZLEME-UYGULA-PLAN.md, K1). A scope's key is read before the global ones
 *  while it is open, and may share a key with a global action. */
export type ActionScope = 'review'

export interface ActionDef {
  id: ActionId
  label: string
  /** The label through t() (ui/strings.ts), for actions written since
   *  phase 3a: shown in place of `label`. */
  labelKey?: StringKey
  default: string
  scope?: ActionScope
}

export const ACTIONS: ActionDef[] = [
  { id: 'playPause', label: 'Play / Pause', labelKey: 'keys.act.playPause', default: 'space' },
  { id: 'delete', label: 'Delete selection / cut region', labelKey: 'keys.act.delete', default: 'backspace' },
  { id: 'split', label: 'Split at playhead', labelKey: 'keys.act.split', default: 's' },
  { id: 'splitTool', label: 'Split tool (click a clip to split there)', labelKey: 'keys.act.splitTool', default: 'b' },
  { id: 'slipTool', label: 'Slip tool (drag a clip to slide its footage)', labelKey: 'keys.act.slipTool', default: 'y' },
  { id: 'cutter', label: 'Toggle cutter tool', labelKey: 'keys.act.cutter', default: 'c' },
  { id: 'selectTool', label: 'Selection tool', labelKey: 'keys.act.selectTool', default: 'a' },
  { id: 'selectAll', label: 'Select everything on the timeline', labelKey: 'keys.act.selectAll', default: 'ctrl+a' },
  { id: 'undo', label: 'Undo', labelKey: 'keys.act.undo', default: 'ctrl+z' },
  { id: 'redo', label: 'Redo', labelKey: 'keys.act.redo', default: 'ctrl+shift+z' },
  { id: 'save', label: 'Save project', labelKey: 'keys.act.save', default: 'ctrl+s' },
  { id: 'goStart', label: 'Go to start', labelKey: 'keys.act.goStart', default: 'home' },
  { id: 'frameBack', label: 'Step back one frame', labelKey: 'keys.act.frameBack', default: 'arrowleft' },
  { id: 'frameForward', label: 'Step forward one frame', labelKey: 'keys.act.frameForward', default: 'arrowright' },
  { id: 'secondBack', label: 'Jump back 1 second', labelKey: 'keys.act.secondBack', default: 'shift+arrowleft' },
  { id: 'secondForward', label: 'Jump forward 1 second', labelKey: 'keys.act.secondForward', default: 'shift+arrowright' },
  { id: 'nudgeLeft', label: 'Nudge selected clips left 1 frame', labelKey: 'keys.act.nudgeLeft', default: 'alt+arrowleft' },
  { id: 'nudgeRight', label: 'Nudge selected clips right 1 frame', labelKey: 'keys.act.nudgeRight', default: 'alt+arrowright' },
  { id: 'shortIn', label: 'In point: the export range (in Shorts mode, the Short segment)', labelKey: 'keys.act.shortIn', default: 'i' },
  { id: 'shortOut', label: 'Out point: the export range (in Shorts mode, the Short segment)', labelKey: 'keys.act.shortOut', default: 'o' },
  { id: 'zoomFit', label: 'Zoom to fit whole project', labelKey: 'keys.act.zoomFit', default: 'shift+z' },
  { id: 'zoomSelection', label: 'Zoom to selected clips', labelKey: 'keys.act.zoomSelection', default: 'z' },
  { id: 'prevEdit', label: 'Jump to previous edit point', labelKey: 'keys.act.prevEdit', default: 'arrowup' },
  { id: 'nextEdit', label: 'Jump to next edit point', labelKey: 'keys.act.nextEdit', default: 'arrowdown' },
  { id: 'toggleLoop', label: 'Loop the marked range', labelKey: 'keys.act.toggleLoop', default: 'ctrl+l' },
  { id: 'nextMarker', label: 'Jump to next marker', labelKey: 'keys.act.nextMarker', default: 'shift+m' },
  { id: 'prevMarker', label: 'Jump to previous marker', labelKey: 'keys.act.prevMarker', default: 'ctrl+shift+m' },
  { id: 'toggleDisable', label: 'Disable / enable selected clips', labelKey: 'keys.act.toggleDisable', default: 'd' },
  { id: 'newNote', label: 'Work note at the playhead', labelKey: 'keys.act.newNote', default: 'n' },
  // Phase Ç2c.2, decision 5 (report D9): Alt+Left / Alt+Right nudge the
  // selection, so the keys go on Alt+, / Alt+.
  { id: 'prevKeyframe', label: 'Previous keyframe', labelKey: 'keyframe.prev', default: 'alt+,' },
  { id: 'nextKeyframe', label: 'Next keyframe', labelKey: 'keyframe.next', default: 'alt+.' },
  { id: 'toggleKeyframe', label: 'Add or remove a keyframe at the playhead', labelKey: 'keyframe.toggle', default: 'alt+k' },
  // Core polish T: Ctrl+T was free (no shortcut, menu or main-process key).
  { id: 'addTransition', label: 'Add the default transition at the nearest cut', labelKey: 'ct.shortcut', default: 'ctrl+t' },
  { id: 'splitHere', label: 'Split target clip at playhead', labelKey: 'keys.act.splitHere', default: 'ctrl+b' },
  { id: 'trimLeft', label: 'Delete the clip left of the playhead (its track closes up; Alt: every track)', labelKey: 'keys.act.trimLeft', default: 'q' },
  { id: 'trimRight', label: 'Delete the clip right of the playhead (its track closes up; Alt: every track)', labelKey: 'keys.act.trimRight', default: 'w' },
  { id: 'closeGap', label: 'Close gap at playhead', labelKey: 'keys.act.closeGap', default: 'e' },
  { id: 'shuttleBack', label: 'Shuttle rewind (J)', labelKey: 'keys.act.shuttleBack', default: 'j' },
  { id: 'shuttlePause', label: 'Shuttle pause (K)', labelKey: 'keys.act.shuttlePause', default: 'k' },
  { id: 'shuttleForward', label: 'Shuttle forward (L)', labelKey: 'keys.act.shuttleForward', default: 'l' },
  // The Settings window (TERMINAL-YOK-PLAN.md, 6): Ctrl+, (⌘, on a Mac), as most programs.
  { id: 'settings', label: 'Open the settings', labelKey: 'keys.act.settings', default: 'ctrl+,' },
  // Ideas from VideoHub's review page (ONIZLEME-UYGULA-PLAN.md, K1). C is the
  // cutter's, so the narration line is Shift+C; B and Y work only in a review.
  { id: 'goToTime', label: 'Go to a time or frame', labelKey: 'keys.act.goToTime', default: 'g' },
  { id: 'slower', label: 'Play slower', labelKey: 'keys.act.slower', default: '[' },
  { id: 'faster', label: 'Play faster', labelKey: 'keys.act.faster', default: ']' },
  { id: 'previewActual', label: 'Preview at 100 % (one pixel per pixel)', labelKey: 'keys.act.previewActual', default: '1' },
  { id: 'previewFit', label: 'Fit the preview', labelKey: 'keys.act.previewFit', default: '0' },
  { id: 'prevNote', label: 'Previous work note', labelKey: 'keys.act.prevNote', default: ',' },
  { id: 'nextNote', label: 'Next work note', labelKey: 'keys.act.nextNote', default: '.' },
  { id: 'narration', label: 'Narration line under the preview', labelKey: 'keys.act.narration', default: 'shift+c' },
  { id: 'shortcutList', label: 'Shortcut list over the preview', labelKey: 'keys.act.shortcutList', default: '?' },
  { id: 'reviewBefore', label: 'In a review: before / after', labelKey: 'keys.act.reviewBefore', default: 'b', scope: 'review' },
  { id: 'reviewApprove', label: 'In a review: approve', labelKey: 'keys.act.reviewApprove', default: 'y', scope: 'review' },
  // The preview toolbar's "Note" (DENEME-2-PLAN-N.md, K5): N stays the note
  // at the playhead, M is the app's marker; Shift+N was free in every set.
  { id: 'pointNote', label: 'Note on the preview: click, pin, type', labelKey: 'keys.act.pointNote', default: 'shift+n' },
  // The watch-and-note mode (IZLE-PLAN.md, K1): Shift+R was free in every set.
  { id: 'watchMode', label: 'Watch and note mode', labelKey: 'keys.act.watchMode', default: 'shift+r' }
]

/** The actions of one scope (undefined: the global ones). */
export const actionsOf = (scope?: ActionScope): ActionDef[] => ACTIONS.filter((a) => a.scope === scope)

const KEY = 'autocut-shortcuts'

export type Bindings = Record<ActionId, string>

export function defaultBindings(): Bindings {
  const b = {} as Bindings
  for (const a of ACTIONS) b[a.id] = a.default
  return b
}

export function loadBindings(): Bindings {
  const base = defaultBindings()
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) ?? '{}')
    for (const a of ACTIONS) if (typeof saved[a.id] === 'string') base[a.id] = saved[a.id]
  } catch {
    /* use defaults */
  }
  return base
}

export function saveBindings(b: Bindings): void {
  localStorage.setItem(KEY, JSON.stringify(b))
}

/** The parts of a key press a binding is made of (a KeyboardEvent fits). */
export interface BindingPress {
  key: string
  code?: string
  ctrlKey: boolean
  metaKey: boolean
  shiftKey: boolean
  altKey: boolean
  getModifierState?: (key: string) => boolean
}

/**
 * Normalizes a KeyboardEvent into a comparable binding string.
 *
 * A punctuation mark (one character, not a letter or a digit) is its own
 * binding whatever it took to type it: `?` is Shift+/ on one keyboard and
 * Shift+* on a Turkish Q one, `[` is AltGr+8 there (Chrome reports AltGr as
 * Ctrl+Alt). So Shift and AltGr are dropped for it; Ctrl or Alt alone stay
 * (Ctrl+, Alt+, Alt+. keep their meaning). ONIZLEME-UYGULA-PLAN.md, K1.
 */
export function eventToBinding(e: BindingPress): string {
  const key = e.code === 'Space' ? 'space' : e.key.toLowerCase()
  // Ignore lone modifier presses.
  if (['control', 'shift', 'alt', 'meta', 'altgraph'].includes(key)) return ''
  const mark = key.length === 1 && key !== ' ' && !/[\p{L}\p{N}]/u.test(key)
  const altGr = !!e.getModifierState?.('AltGraph') || (mark && e.ctrlKey && e.altKey && !e.metaKey)
  const parts: string[] = []
  if ((e.ctrlKey || e.metaKey) && !(mark && altGr)) parts.push('ctrl')
  if (e.shiftKey && !mark) parts.push('shift')
  if (e.altKey && !(mark && altGr)) parts.push('alt')
  parts.push(key)
  return parts.join('+')
}

/** What decides whether a key press on an element is typing (an HTMLElement
 *  fits; a plain object does in the tests). */
export interface KeyTarget {
  tagName: string
  isContentEditable?: boolean
  /** An input's type. */
  type?: string
}

/** The parts of a key press the decision reads (a KeyboardEvent fits). */
export interface KeyPress {
  key: string
  ctrlKey?: boolean
  metaKey?: boolean
  altKey?: boolean
}

/** The keys a slider, checkbox or select uses itself to step its value. */
const STEP_KEYS = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'PageUp', 'PageDown']

/**
 * Whether a keypress on `target` should reach the app's shortcuts.
 *
 * Blocking every INPUT meant that after you touched a SLIDER — which keeps
 * focus — Ctrl+Z, Space and every other shortcut silently stopped working
 * until you clicked somewhere else. That is not a text field; nothing is being
 * typed into it. So the block is for text entry only, and the non-text
 * controls give up just the keys they actually use themselves.
 */
export function shortcutsAllowed(target: KeyTarget | null | undefined, e: KeyPress): boolean {
  if (!target) return true
  if (target.isContentEditable) return false
  const tag = target.tagName
  if (tag === 'TEXTAREA') return false
  if (tag === 'SELECT') {
    // A select keeps focus after an option is picked (Chromium), and used to
    // swallow every key: Space opened its list instead of playing, and Ctrl+Z,
    // Ctrl+S and Delete did nothing until you clicked elsewhere. It keeps only
    // what it uses itself: the arrows and Home/End/PageUp/PageDown step through
    // its options, Enter opens it, and typing a letter jumps to an option.
    // Ctrl/⌘ combinations, Space (Play blurs it first, and the shortcut's
    // preventDefault stops the list opening), Delete/Backspace and the F-keys
    // are the app's.
    if (e.ctrlKey || e.metaKey) return true
    if (STEP_KEYS.includes(e.key) || e.key === 'Enter') return false
    if (e.key.length === 1 && e.key !== ' ' && !e.altKey) return false
    return true
  }
  if (tag !== 'INPUT') return true
  const type = target.type ?? 'text'
  const textual = ['text', 'number', 'search', 'email', 'password', 'url', 'tel', 'date', 'time']
  if (textual.includes(type)) return false
  // range / checkbox / radio / color: the control keeps the keys it uses, the
  // app keeps the rest. Space is always Play: a checkbox clicked a moment ago
  // kept the focus and swallowed it — Space
  // ticked the box on and off and the playhead never moved.
  if (STEP_KEYS.includes(e.key)) return false
  return true
}

/** A focused element as the Space decision reads it (an HTMLElement fits). */
export interface SpaceTarget extends KeyTarget {
  getAttribute?: (name: string) => string | null
}

/** The roles whose own key Space is (WAI-ARIA): a button, a switch, a check
 *  box, a radio (a segment of a Segmented), a tab, a menu's row. */
const SPACE_ROLES = new Set(['button', 'switch', 'checkbox', 'radio', 'tab', 'menuitem', 'menuitemcheckbox', 'menuitemradio', 'option'])
const SPACE_INPUTS = ['checkbox', 'radio', 'button', 'submit', 'reset']

/**
 * Whether Space works the focused control rather than Play (audit E2). On a
 * button, a tab, a switch or a check box the KEYBOARD reached, Space is that
 * control's own key: it presses it, and the playhead stays. A control a click
 * left the focus on is not "reached": there Space plays, as it always has (a
 * click on Split, then Space, plays; it must not split again). A text field
 * types (shortcutsAllowed); everywhere else Space plays.
 */
export function spaceWorksControl(target: SpaceTarget | null | undefined, cameByKeyboard: boolean): boolean {
  if (!target || !cameByKeyboard) return false
  const role = target.getAttribute?.('role') ?? null
  if (role) return SPACE_ROLES.has(role)
  if (target.tagName === 'BUTTON' || target.tagName === 'SUMMARY') return true
  return target.tagName === 'INPUT' && SPACE_INPUTS.includes(target.type ?? 'text')
}

/** The modal windows: a dialog's backdrop, the projects overlay, anything
 *  marked aria-modal. */
export const MODAL_SELECTOR = '.dialog-backdrop, .projects-overlay, [aria-modal="true"]'

/**
 * Whether a modal window is open. While one is, the editor's shortcuts must
 * not reach the timeline hidden behind it: a Backspace with the focus left on
 * the Export dialog's "Normalize loudness" box deleted the selected clips out
 * of sight, Ctrl+Z undid an edit and Space played. (Escape still passes: the
 * dialogs close on it.)
 */
export function modalOpen(root: { querySelector: (selector: string) => unknown } | null | undefined): boolean {
  return !!root?.querySelector(MODAL_SELECTOR)
}

/** One frame of the J/L shuttle, as it stands. */
export interface ShuttleFrame {
  currentTime: number
  /** The time the shuttle itself set last (null before its first frame). */
  wrote: number | null
  /** The project's length: the shuttle never runs past it. */
  duration: number
  /** -1 rewinds (J), 1 runs forward (L). */
  dir: number
  speed: number
  /** Seconds since the last frame. */
  dt: number
  playing: boolean
  exporting: boolean
}

/**
 * The shuttle's next frame: the time to set (null: leave the playhead alone)
 * and whether to keep going. It used to run until K or Space, whatever else
 * happened: with Play started from the transport both it and the engine moved
 * the clock (every <video> re-seeking, stutter), and parked at 0 or at the end
 * it wrote the same time 60 times a second, waking every store subscriber.
 */
export function shuttleStep(f: ShuttleFrame): { time: number | null; go: boolean } {
  // Play (the transport button) or an export: the engine's clock is the one.
  if (f.playing || f.exporting) return { time: null, go: false }
  // Something else moved the playhead (a scrub, a click on the ruler, a jump
  // to a marker): that move wins, the shuttle stops where it was put.
  if (f.wrote !== null && f.currentTime !== f.wrote) return { time: null, go: false }
  const time = Math.min(Math.max(0, f.currentTime + f.dir * f.speed * f.dt), Math.max(0, f.duration))
  // At either end there is nowhere left to go.
  const atEnd = f.dir < 0 ? time <= 0 : time >= Math.max(0, f.duration)
  return { time, go: !atEnd }
}

/** The keys whose names are words of the interface's language (audit E8):
 *  Space and the arrows. Ctrl, Shift, Alt, Home and the letters are written
 *  on the keys themselves. */
const NAMED_KEYS = ['space', 'left', 'right', 'up', 'down'] as const

/** Human-readable label for a binding string, in the interface's language. */
export function bindingLabel(binding: string): string {
  return binding
    .split('+')
    .map((p) => (p.startsWith('arrow') ? p.replace('arrow', '') : p))
    .map((p) => {
      const named = NAMED_KEYS.find((k) => k === p)
      if (named) return t(`keys.name.${named}`)
      // Ctrl and Alt are Cmd and Option on a Mac (phase 10a.5); elsewhere as before.
      if ((p === 'ctrl' || p === 'alt') && uiPlatform() === 'darwin') return modKeyName(p)
      return p.charAt(0).toUpperCase() + p.slice(1)
    })
    .join(' + ')
}
