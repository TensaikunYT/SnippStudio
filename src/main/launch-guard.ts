// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// What a PACKAGED copy refuses at launch (security patch, item 3; B-G2, B-G4,
// B-G6). A debugging port hands the whole editor to any local program that
// connects to it: every IPC call, the store, the agent session. Electron's
// fuses cannot switch that off, so the packaged app does not start at all
// when it is asked for one; its DevTools shortcut is off and the test hooks
// (window.__store …) are not installed.
//
// One exception, the same gate as the packaged e2e run (e2e-hooks.ts
// testBuild / e2eMode; phase 9a, decision 6): the marker file in the
// program's own resources folder AND --e2e AND its own --user-data-dir.
// Whoever can write that file can replace the program itself.
//
// A source build (electron .) is the developer's own: nothing is refused.
// Pure: no Electron, no relative imports.

/** The switches a packaged copy does not start with. */
export const REFUSED_SWITCHES = ['remote-debugging-port', 'remote-debugging-pipe', 'load-extension'] as const
/** …and every Node / V8 inspector switch (--inspect, --inspect-brk, --inspect-port, --inspect=…). */
export const REFUSED_PREFIX = 'inspect'
/** The inspector switches by name, for a command line Chromium already parsed. */
export const INSPECT_SWITCHES = ['inspect', 'inspect-brk', 'inspect-port', 'inspect-brk-node', 'inspect-publish-uid', 'inspect-wait'] as const

export interface LaunchFacts {
  /** app.isPackaged. */
  packaged: boolean
  /** The packaged e2e gate holds in full (e2e-hooks.ts e2eMode). */
  testCopy: boolean
}

/** A switch's name as Chromium reads it, or null (not a switch). Windows
 *  takes --name, -name and /name, and folds the name's case; elsewhere
 *  --name and -name. */
export function switchName(arg: string, platform: string): string | null {
  const m = (platform === 'win32' ? /^(?:--|-|\/)([^=\s/\\:][^=]*)(?:=|$)/ : /^(?:--|-)([^=\s][^=]*)(?:=|$)/).exec(arg)
  if (!m) return null
  return platform === 'win32' ? m[1].toLowerCase() : m[1]
}

/** The first refused switch among the arguments, or null. */
export function refusedSwitch(argv: readonly string[], platform: string): string | null {
  for (const arg of argv) {
    if (typeof arg !== 'string') continue
    const name = switchName(arg, platform)
    if (!name) continue
    const n = name.toLowerCase()
    if ((REFUSED_SWITCHES as readonly string[]).includes(n) || n === REFUSED_PREFIX || n.startsWith(REFUSED_PREFIX + '-')) return n
  }
  return null
}

/**
 * Why this launch must end before anything opens, or null. `has`: the
 * command line as Chromium parsed it (app.commandLine.hasSwitch), asked too,
 * so no spelling this file reads differently slips through.
 */
export function launchRefusal(argv: readonly string[], facts: LaunchFacts, platform: string, has: (name: string) => boolean = () => false): string | null {
  if (!facts.packaged || facts.testCopy) return null
  const found = refusedSwitch(argv, platform) ?? [...REFUSED_SWITCHES, ...INSPECT_SWITCHES].find((s) => has(s)) ?? null
  return found ? `--${found}` : null
}

/** May the editor window open DevTools (F12, Ctrl+Shift+I)? */
export const devToolsAllowed = (facts: LaunchFacts): boolean => !facts.packaged || facts.testCopy

/** May the page install its test hooks (window.__store, __exporter, …)? */
export const testHooksAllowed = (facts: LaunchFacts): boolean => !facts.packaged || facts.testCopy

/** The argument that tells the page's preload the hooks are allowed
 *  (webPreferences.additionalArguments; a page cannot change its own). */
export const TEST_HOOKS_ARG = '--snipp-test-hooks'
