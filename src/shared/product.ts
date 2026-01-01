// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// The product's name and identity, in one place (SnippStudio phase 9a,
// decision 1). Renaming the app is one line: `name` in product.json. The
// main process, the window, the profile folder, the package
// (electron-builder.config.cjs) and the e2e harness all read it from there;
// src/test/product-name.test.ts checks that no other source file writes the
// name out.
//
//   name           what the user sees: window title, profile folder, package
//   appId          the package's application id
//   agentId        the name agents know the app's MCP server by (technical,
//                  like the project extension; kept when the name changes)
//   projectExt     the project file's extension (decision 2: .snipp stays)
//   inheritFrom    older profile folders the first start copies settings from
//                  (decision 3; never written to)
//   legacyProfiles older profile folders whose model copies "Clear cache" may
//                  remove (only the release copy; never an inheritFrom one)
import product from './product.json'

export type Channel = 'dev' | 'release'

export const PRODUCT_NAME: string = product.name
export const APP_ID: string = product.appId
export const AGENT_ID: string = product.agentId
export const PROJECT_EXT: string = product.projectExt
export const INHERIT_FROM: readonly string[] = product.inheritFrom
export const LEGACY_PROFILES: readonly string[] = product.legacyProfiles

/** The app's name for a copy: a development build is "<name> Dev" (its own
 *  profile folder and agent port, so it never meets the user's own copy). */
export const productNameFor = (channel: Channel): string => (channel === 'dev' ? `${PRODUCT_NAME} Dev` : PRODUCT_NAME)

/** The name agents know a copy's MCP server by. */
export const agentServerName = (channel: Channel): string => (channel === 'dev' ? `${AGENT_ID}-dev` : AGENT_ID)

/** The name a copy is registered under in an agent's own settings, once, by
 *  the user (`claude mcp add`, SnippStudio DIS-MCP-PLAN.md decision 1): the
 *  product's name in lower case, `-dev` for a development build, so the two
 *  copies never write over each other's entry. The app's own session files
 *  keep `agentServerName`. */
export const registeredServerName = (channel: Channel): string => {
  const base = PRODUCT_NAME.toLowerCase().replace(/[^a-z0-9-]/g, '')
  return channel === 'dev' ? `${base}-dev` : base
}

/** The environment variable Codex reads a copy's key from (`codex mcp add
 *  --bearer-token-env-var`; TERMINAL-YOK-PLAN.md, 9): one per registered
 *  name (`snippstudio` → SNIPPSTUDIO_TOKEN, `snippstudio-dev` →
 *  SNIPPSTUDIO_DEV_TOKEN), so the two copies never share one. */
export const codexTokenEnv = (name: string): string => `${name.toUpperCase().replace(/[^A-Z0-9]+/g, '_')}_TOKEN`
