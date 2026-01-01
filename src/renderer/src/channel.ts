// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// Which copy of the app this window belongs to (the main process's own view
// is main/channel.ts): a dev copy ("<name> Dev", its own name and profile) or
// a release. Fixed at build time (electron.vite.config.ts). Nothing is
// switched on or off by it: there is one product and one build. The name
// itself comes from shared/product.ts (phase 9a, decision 1).
import { productNameFor } from '../../shared/product'

declare const __SNIPP_CHANNEL__: string | undefined
declare const __SNIPP_BRANCH__: string | undefined

export const CHANNEL: 'dev' | 'release' = typeof __SNIPP_CHANNEL__ !== 'undefined' && __SNIPP_CHANNEL__ === 'dev' ? 'dev' : 'release'
export const BRANCH: string = typeof __SNIPP_BRANCH__ !== 'undefined' && __SNIPP_BRANCH__ ? __SNIPP_BRANCH__ : ''

/** What a dev copy's window is called, so an open window says which copy and
 *  branch it is. A release copy keeps the plain name. */
export function windowTitle(channel: 'dev' | 'release', branch: string): string {
  if (channel !== 'dev') return productNameFor('release')
  return [productNameFor('dev'), branch && `branch ${branch}`].filter(Boolean).join(' · ')
}
