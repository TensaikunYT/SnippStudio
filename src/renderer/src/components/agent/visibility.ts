// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// What of the agent's interface is on screen (phase 3c.Y, K2 of
// tarifler\FAZ3C-YERLESIM.md): with the top bar's "Connect agent" switch off
// the Agent tab is gone. The command box is one 28 px line whenever it is
// empty and left alone, the switch on or off (interface audit G1), so the
// Inspector gets its room back.
// Something waiting for the user (a draft to accept or reject, a call still
// running, a restore point to go back to) keeps the Agent tab even when the
// switch is off: only empty states are hidden. Pure (src/test/agent-visibility.test.ts).

export interface AgentUiState {
  /** The agent server runs (the top bar's switch is on). */
  serverOn: boolean
  /** A draft waits to be accepted or rejected. */
  draft: boolean
  /** A call of the agent has not finished. */
  running: boolean
  /** Restore points of the open project ("back to before the agent"). */
  points: number
}

/** Is the Inspector's Agent tab shown? */
export const agentTabShown = (s: AgentUiState): boolean => s.serverOn || s.draft || s.running || s.points > 0

export interface BoxState {
  /** The user left the box open by hand (kept in the profile). */
  pinned: boolean
  /** Opened for now: clicked or focused; closes again when the focus leaves
   *  it empty. */
  open: boolean
  /** What is written in it. */
  text: string
  /** A draft waits to be accepted or rejected (the box's line says so). */
  draft: boolean
  /** A call of the agent has not finished (the box's line follows it). */
  running: boolean
}

/** Is the command box folded to its one line? Whether the agent is switched
 *  on or not (interface audit G1: open and empty it took 245 px of the
 *  Inspector, at 1366×768 all but 112): never while something is written in
 *  it, while it is opened or kept open, or while a draft or a call it sent
 *  is under way. Restore points do not hold it open: they live in the Agent
 *  tab, which stays (agentTabShown), and a project keeps them for good. */
export const boxFolded = (s: BoxState): boolean => !s.pinned && !s.open && s.text.trim() === '' && !s.running

/** Something under way holds the box open (its fold button is not offered).
 *  A waiting draft does not any more (D22, worker C; the audit's A3: with
 *  the box forced open the Agent tab had 86 px left at 1366 × 768): the draft
 *  is reviewed in the strip over the timeline, not in this panel. */
export const boxHeld = (s: Pick<BoxState, 'draft' | 'running'>): boolean => s.running

/** The profile key of "left open by hand". */
export const BOX_PINNED_KEY = 'snipp-agent-box-open'

/** Does a focus moving to `next` leave the box? A dialog or a menu the box
 *  opened (recipes, the agent chooser) is still the box's. */
export function focusLeavesBox<T extends { closest: (sel: string) => unknown }>(next: T | null, box: { contains: (n: T) => boolean }): boolean {
  if (!next) return true
  if (box.contains(next)) return false
  return !next.closest('[role="dialog"], [role="menu"], .ui-menu-layer')
}
