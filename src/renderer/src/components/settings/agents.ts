// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// The agents the Settings window knows: their names, and how each is
// installed (no style sheet here: the tests load it alone).
import type { AgentInstallation } from '../../../../preload/index'
import type { StringKey } from '../../ui'

type AgentId = AgentInstallation['id']

export const AGENT_NAME: Record<AgentId, StringKey> = {
  claude: 'agent.name.claude',
  codex: 'agent.name.codex',
  opencode: 'agent.name.opencode',
  antigravity: 'agent.name.antigravity'
}

/** How to install each agent: the maker's own command and page (as the old
 *  chooser had them; Antigravity: antigravity.google/docs/getting-started,
 *  CLI tab, read 20 Nov 2026). */
export const SETUP: Record<AgentId, { command: string; url: string }> = {
  claude: { command: 'winget install Anthropic.ClaudeCode', url: 'https://code.claude.com/docs/en/setup' },
  codex: { command: 'npm i -g @openai/codex', url: 'https://developers.openai.com/codex/cli' },
  // (Final security audit, 23 Nov 2026, G2: the line said `@opencode/cli`,
  // a package name nobody had checked, which a stranger could register;
  // OpenCode's own package on npm is `opencode-ai`, opencode.ai/docs.)
  opencode: { command: 'npm install -g opencode-ai', url: 'https://opencode.ai/docs/' },
  antigravity: { command: 'irm https://antigravity.google/cli/install.ps1 | iex', url: 'https://antigravity.google/docs/getting-started?tab=cli' }
}
