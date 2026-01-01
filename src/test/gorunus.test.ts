// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// The look tour (Desktop\SnippStudio\GORUNUS-PLAN.md): its seven rules, as far
// as a stylesheet or a string can be read for them. The screens themselves are
// counted by the e2e audit (scripts/e2e/gorunus-audit.mjs, in ui3-screens).
//   1 words: the lines that always show say one short sentence
//   2 controls: a button is 28, 24 or 20 high (named exceptions below)
//   3 type: a card's title 13/600, its labels 12/500; no capitals headings,
//     no weight but 400 / 500 / 600
//   4 colour: the agent's colours stay in the agent's parts; a warning is
//     not drawn in them
//   6 spacing: the cards of a column stand 8 apart
import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import test from 'node:test'
import { STRINGS } from '../renderer/src/ui/strings'

const SRC = join(__dirname, '..', '..', 'src', 'renderer', 'src')
const walk = (dir: string): string[] => readdirSync(join(SRC, dir), { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(`${dir}/${e.name}`) : [`${dir}/${e.name}`]))
const SHEETS = walk('.').map((f) => f.slice(2)).filter((f) => f.endsWith('.css') && f !== 'ui/tokens.css')
const code = (f: string): string => readFileSync(join(SRC, f), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
/** Every rule of every sheet: [sheet, selector, body]. */
const RULES: [string, string, string][] = SHEETS.flatMap((f) => [...code(f).matchAll(/([^{}@]+)\{([^{}]*)\}/g)].map((m): [string, string, string] => [f, m[1].trim(), m[2]]))
const rule = (sheet: string, selector: string): string => {
  const r = RULES.find(([f, s]) => f === sheet && s === selector)
  assert.ok(r, `${sheet}: ${selector}`)
  return r![2]
}

test('rule 2: a button is 28, 24 or 20 high (the named exceptions aside)', () => {
  const ok = /^(var\(--ctl\)|var\(--ctl-sm\)|var\(--play\)|20px|auto|100%)$/
  // Not buttons of the control family: a picture card, a swatch row, an
  // icon inside a button, the compact track head's mini tools, a chip's ×.
  const named = ['.ctx-menu .tpl-pic-grid button', '.transport-bar .ui-btn.transport-play > .ui-icon', '.tl-track-label.compact .ticons .ui-btn.track-quick', '.ui-chip .ui-chip-remove.ui-btn', '.kapsam-cap .kapsam-cap-x']
  const bad: string[] = []
  for (const [f, sel, body] of RULES) {
    if (!/\.ui-btn|(^|[\s,>])button\b/.test(sel) || named.includes(sel) || /> \.ui-icon\b|\.ui-icon$/.test(sel)) continue
    const h = /(?:^|[;\s])height:\s*([^;]+)/.exec(body)
    if (h && !ok.test(h[1].trim())) bad.push(`${f}: ${sel} → ${h[1].trim()}`)
  }
  assert.deepEqual(bad, [])
  // The transport and its clock are plain 28 (they were 32).
  assert.match(rule('components/preview/preview.css', '.transport-bar .tb-center .ui-btn.ui-btn-ghost.is-icon-only:not(.transport-play)'), /height: var\(--ctl\)/)
  assert.match(rule('components/preview/preview.css', '.timecode'), /height: var\(--ctl\)/)
})

test('rule 3: four steps of type on the cards; no capital headings, no odd weights', () => {
  const card = ':is(.ui-section.is-card, .ui-cards .ui-section:not(.ui-section .ui-section)) > .ui-section-title > .ui-section-head.ui-section-head'
  assert.match(rule('ui/kit.css', card), /font-size: var\(--fs-13\); font-weight: var\(--fw-semibold\)/)
  for (const sel of ['.ui-field-label', '.ui-slider-label']) assert.match(rule('ui/kit.css', sel), /font-size: var\(--fs-12\); font-weight: var\(--fw-medium\)/, sel)
  assert.match(rule('ui/kit.css', '.ui-btn'), /font-size: var\(--fs-12\); font-weight: var\(--fw-medium\)/)
  assert.match(rule('ui/kit.css', '.ui-seg-part'), /font-size: var\(--fs-12\); font-weight: var\(--fw-medium\)/)
  const bad: string[] = []
  for (const [f, sel, body] of RULES) {
    if (/text-transform:\s*uppercase/.test(body)) bad.push(`${f}: ${sel} capitals`)
    for (const m of body.matchAll(/font-weight:\s*([^;]+)/g)) {
      const w = m[1].trim()
      if (!/^(var\(--fw-(regular|medium|semibold)\)|400|500|600|inherit)$/.test(w) && !/@font-face/.test(sel)) bad.push(`${f}: ${sel} weight ${w}`)
    }
  }
  assert.deepEqual(bad.filter((b) => !b.includes('100 ')), [])
})

test('rule 4: the agent colours stay in the agent\'s parts', () => {
  // Where the agent's orange may stand: its own sheets, its tab and chip, its
  // settings card, a work note it holds, the code clip it saved, watch mode's
  // agent marks.
  const own = /^(components\/agent\/|notes\/|components\/watch\/)/
  const allowed = ['.ui-tab.is-agent.is-on, .ui-tab.is-agent.is-on:hover:not(:disabled)', '.ui-tab.is-agent:not(.is-on)', '.ui-chip-agent', '.codeclip-saved', '.codeclip-writing', '.settings-card.is-agent', '.settings-card.is-agent .settings-card-title']
  const bad: string[] = []
  for (const [f, sel, body] of RULES) {
    if (own.test(f) || allowed.includes(sel)) continue
    if (/var\(--(agent|on-agent)(-text|-soft|-line|-w\d)?\)/.test(body)) bad.push(`${f}: ${sel}`)
  }
  assert.deepEqual(bad, [])
  // A warning in the Inspector is neutral, not the agent's.
  assert.doesNotMatch(rule('components/inspector/inspector.css', '.inspector .hint.is-warning'), /--agent/)
  // The track heads carry no colour bar.
  assert.match(rule('components/timeline/timeline.css', '.tl-track > .tl-track-label::before'), /content: none/)
})

test('rule 6: the cards of a column stand 8 apart, 12 inside', () => {
  const card = ':is(.ui-section.is-card, .ui-cards .ui-section:not(.ui-section .ui-section))'
  assert.match(rule('ui/kit.css', card), /margin: 0 0 var\(--space-2\); padding: 0 var\(--space-3\)/)
})

test('rule 1: the lines that always show are one short sentence', () => {
  const keys = ['insp.empty.hint', 'bin.drop.hint', 'refp.export.place.hint', 'refp.export.cover.hint', 'cs.silence.red', 'insp.duck.needTwo', 'agent.state.notConnected', 'agent.wait.off', 'den2t.inbox.hint', 'dock.filters.for', 'wiz.s2.text.win', 'wiz.s3.text.claude'] as const
  const table = STRINGS as unknown as Record<string, { en: string; tr?: string }>
  for (const k of keys) {
    for (const s of [table[k].en, table[k].tr ?? '']) {
      const sentences = s.split(/[.!?]\s+(?=\p{Lu})/u).filter((x) => x.trim()).length
      assert.ok(sentences <= 1, `${k}: one sentence ("${s}")`)
      assert.ok(s.length <= 72, `${k}: short (${s.length}): "${s}"`)
    }
  }
})
