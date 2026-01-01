// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// son, item C: the top bar's agent chip shows a small one-colour mark for
// every program (Claude Code's rays, Codex's prompt, a round initial badge
// for OpenCode, Antigravity and any other), never a neutral dot, and the
// program's name beside it.
// With SNIPP_SON_SHOTS=<folder>: a close picture of each chip.
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { outsideAgent, textOf } from '../session.mjs'
export const name = 'son-program-marks'

const SHOTS = process.env.SNIPP_SON_SHOTS || ''

export async function run({ c, app, media, lib }) {
  const { assert } = lib
  const [talk] = await lib.seedAssets(app, c, [media.talk])
  await lib.seedTimeline(c, [talk.id])
  await c.waitFor('the agent host', () => c.ev('!!window.__agent'))
  const want = [
    ['claude-code', 'claude', null],
    ['codex-mcp-client', 'codex', null],
    ['opencode', 'opencode', 'O'],
    ['antigravity', 'antigravity', 'A']
  ]
  for (const [client, program, initial] of want) {
    const ag = await outsideAgent({ c, app, assert, client })
    await ag.call('project')
    await c.waitFor(`the chip of ${program}`, async () => (await c.attr('agent.chip', 'data-program')) === program, 10000)
    const m = await c.run(() => {
      const e = document.querySelector('[data-testid="agent.chip"] [data-mark]')
      const r = e?.getBoundingClientRect()
      return e ? { mark: e.dataset.mark, w: r.width, h: r.height, text: e.querySelector('text')?.textContent ?? null, dot: !!document.querySelector('[data-testid="agent.chip"] .is-dot') } : null
    })
    assert.ok(m, `${program}: a mark`)
    assert.equal(m.mark, program, `${program}: its own mark`)
    assert.equal(m.dot, false, `${program}: no neutral dot`)
    assert.ok(m.w >= 13 && m.w <= 16 && m.h >= 13 && m.h <= 16, `${program}: 14–16 px (${m.w}×${m.h})`)
    if (initial) assert.equal(m.text, initial, `${program}: its initial`)
    assert.ok((await textOf(c, 'agent.chip.name')).length > 1, `${program}: its name beside it`)
    console.log(`     ${program}: mark ${m.mark}${m.text ? ` "${m.text}"` : ''} ${m.w}×${m.h}, name "${await textOf(c, 'agent.chip.name')}"`)
    if (SHOTS) {
      mkdirSync(SHOTS, { recursive: true })
      const b = await c.box('agent.chip')
      const r = await c.capture({ format: 'png', clip: { x: b.x - 12, y: b.y - 8, width: b.w + 24, height: b.h + 16, scale: 3 } })
      writeFileSync(join(SHOTS, `sonra-cip-${program}.png`), Buffer.from(r.data, 'base64'))
    }
    await ag.close?.()
  }
}
