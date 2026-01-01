// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// Which copy of the app this is (SnippStudio PLAN.md, "Tek Snipp kuralı").
//   release: the product. Its name and profile folder are the product's
//            (shared/product.ts).
//   dev:     a build of the work-in-progress branch: "<name> Dev", its own
//            profile folder (so it never reads or writes the release copy's
//            settings, recents or caches), its own single-instance lock, and
//            the branch in its title, so an open window always says which
//            copy it is.
// The values are injected at build time (electron.vite.config.ts). Under the
// unit tests (plain Node, no bundler) they are absent: that is a release copy.
import path from 'node:path'
import { agentServerName, productNameFor, type Channel } from '../shared/product'

declare const __SNIPP_CHANNEL__: string | undefined
declare const __SNIPP_BRANCH__: string | undefined

export type { Channel }

export const CHANNEL: Channel = typeof __SNIPP_CHANNEL__ !== 'undefined' && __SNIPP_CHANNEL__ === 'dev' ? 'dev' : 'release'
export const BRANCH: string = typeof __SNIPP_BRANCH__ !== 'undefined' && __SNIPP_BRANCH__ ? __SNIPP_BRANCH__ : ''

export const appNameFor = (channel: Channel): string => productNameFor(channel)

/** The window's title before its page has set one. */
export function windowTitleFor(channel: Channel, branch: string): string {
  return channel === 'dev' && branch ? `${appNameFor('dev')} · ${branch}` : appNameFor(channel)
}

/**
 * The profile folder of a copy (phase 9a, decision 1: `<appData>/<name>`, and
 * `<name> Dev` for a dev copy), or null to leave Electron's own choice alone:
 * a launch that names its folder itself (`--user-data-dir`: the film tool's
 * dev app, the render workers, the tests).
 */
export function profileDirFor(channel: Channel, appData: string, hasUserDataSwitch: boolean): string | null {
  if (hasUserDataSwitch) return null
  return path.join(appData, appNameFor(channel))
}

/** The name agents know this copy's MCP server by. */
export const agentNameFor = (channel: Channel): string => agentServerName(channel)

/** The agent server's default port: a dev copy and the daily app can both be
 *  open, so each has its own (main/agent-server.ts). */
export const agentPortFor = (channel: Channel): number => (channel === 'dev' ? 47811 : 47810)
