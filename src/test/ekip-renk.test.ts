// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// The team mode's colours (EKIP-PLAN.md): six per program, derived from the
// program's own, readable where they are drawn, kept away from the accent,
// the selection and the clips; TASARIM.md says the same values.
import './dom-stub'
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import test from 'node:test'
import { withWorker } from '../renderer/src/agent/crew'
import { AGENT_PROGRAMS } from '../renderer/src/agent/program'
import { workerColour, CREW_COLOURS } from '../renderer/src/components/agent/crew-colour'

test('workers in the order first seen; colours by that order, the 7th takes the first again', () => {
  let order: string[] = []
  for (const w of ['kesim', 'altyazı', undefined, 'kesim', 'b-roll']) order = withWorker(order, w)
  assert.deepEqual(order, ['kesim', 'altyazı', 'b-roll'])
  assert.equal(workerColour(order, 'kesim'), 'var(--agent-w1)')
  assert.equal(workerColour(order, 'b-roll'), 'var(--agent-w3)')
  assert.equal(workerColour(order, undefined), 'var(--agent)', 'unlabelled: the program itself')
  const seven = ['a', 'b', 'c', 'd', 'e', 'f', 'g']
  assert.equal(workerColour(seven, 'g'), 'var(--agent-w1)')
  assert.equal(CREW_COLOURS, 6)
})

const SRC = join(__dirname, '..', '..', 'src', 'renderer', 'src')
const tokens = readFileSync(join(SRC, 'ui', 'tokens.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
const blocks = [...tokens.matchAll(/:root(?:\[data-agent-program='(\w+)'\])?\s*\{([^}]*)\}/g)]
/** The last block of a program that sets `name` (the crew's blocks come after the others). */
function valueOf(program: string, name: string): string {
  const sel = program === 'claude' ? undefined : program
  let v = ''
  for (const [, p, body] of blocks) {
    if (p !== sel) continue
    const m = new RegExp(`${name}\\s*:\\s*(#[0-9A-Fa-f]{6})\\s*;`).exec(body)
    if (m) v = m[1]
  }
  if (!v && program !== 'claude') return valueOf('claude', name)
  return v
}
const rootHex = (name: string): string => {
  let v = new RegExp(`${name}\\s*:\\s*([^;]+);`).exec(tokens)?.[1].trim() ?? ''
  for (let i = 0; i < 10 && /^var\(/.test(v); i++) v = new RegExp(`${v.slice(4, -1)}\\s*:\\s*([^;]+);`).exec(tokens)?.[1].trim() ?? ''
  return v
}
const rgb = (h: string): number[] => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255)
const lin = (v: number): number => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)
function contrast(a: string, b: string): number {
  const lum = (h: string): number => {
    const [r, g, bl] = rgb(h).map(lin)
    return 0.2126 * r + 0.7152 * g + 0.0722 * bl
  }
  const [x, y] = [lum(a), lum(b)]
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05)
}
function oklab(h: string): number[] {
  const [r, g, b] = rgb(h).map(lin)
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b)
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b)
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b)
  return [0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s, 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s, 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s]
}
const dist = (a: string, b: string): number => {
  const [x, y] = [oklab(a), oklab(b)]
  return Math.hypot(x[0] - y[0], x[1] - y[1], x[2] - y[2])
}
const hue = (h: string): { c: number; h: number } => {
  const [, a, b] = oklab(h)
  return { c: Math.hypot(a, b), h: ((Math.atan2(b, a) * 180) / Math.PI + 360) % 360 }
}
const W = [1, 2, 3, 4, 5, 6].map((i) => `--agent-w${i}`)

test('six worker colours per program: readable, distinct, not the accent, the selection or a clip', () => {
  const strict = ['--accent', '--select', '--clip-video-line', '--clip-audio-fill', '--clip-audio-line', '--clip-wave', '--clip-code-fill', '--clip-code-line', '--clip-image-fill', '--clip-image-line', '--clip-caption-fill', '--clip-caption-line'].map(rootHex)
  const soft = ['--warn', '--danger', '--note'].map(rootHex)
  for (const program of AGENT_PROGRAMS) {
    const on = valueOf(program, '--on-agent')
    const base = valueOf(program, '--agent')
    const set = W.map((n) => valueOf(program, n))
    assert.ok(set.every((c) => /^#[0-9A-F]{6}$/i.test(c)), `${program}: six values (${set.join(' ')})`)
    const low: string[] = []
    for (const c of set) {
      if (contrast(on, c) < 4.5) low.push(`${c}: a flag's words ${contrast(on, c).toFixed(2)}`)
      if (contrast(c, rootHex('--bg-lane')) < 3) low.push(`${c} on a lane`)
      if (contrast(c, rootHex('--clip-video-fill')) < 3) low.push(`${c} on a video clip`)
      for (const x of strict) if (dist(c, x) < 0.085) low.push(`${c} near ${x}`)
      for (const x of soft) if (dist(c, x) < 0.055) low.push(`${c} near ${x}`)
      const { c: chroma, h } = hue(c)
      const near = (h0: number, w: number): boolean => Math.abs(((h - h0 + 540) % 360) - 180) < w
      if (chroma > 0.03 && (near(95, 25) || near(130, 30))) low.push(`${c}: the gold's or the green's hue`)
      if (dist(c, base) < 0.045) low.push(`${c}: the program's own colour`)
    }
    for (let i = 0; i < set.length; i++) for (let j = i + 1; j < set.length; j++) if (dist(set[i], set[j]) < 0.055) low.push(`${set[i]} ~ ${set[j]}`)
    assert.deepEqual(low, [], program)
  }
})

const TASARIM = join(__dirname, '..', '..', '..', 'tasarim', 'TASARIM.md')
test('TASARIM.md "Ekip renkleri" = tokens.css', { skip: !existsSync(TASARIM) && 'TASARIM.md is not beside the repository' }, () => {
  const md = readFileSync(TASARIM, 'utf8')
  const part = md.slice(md.indexOf('### Ekip renkleri'))
  const names: Record<string, string> = { 'Claude Code': 'claude', Codex: 'codex', OpenCode: 'opencode', Antigravity: 'antigravity', 'Bilinmeyen program': 'other' }
  let rows = 0
  for (const m of part.matchAll(/^\|\s*([^|`]+?)\s*\|((?:\s*`#[0-9A-Fa-f]{6}`\s*\|){6})/gm)) {
    const program = names[m[1]]
    assert.ok(program, m[1])
    const values = [...m[2].matchAll(/`(#[0-9A-Fa-f]{6})`/g)].map((x) => x[1].toUpperCase())
    assert.deepEqual(values, W.map((n) => valueOf(program, n).toUpperCase()), program)
    rows++
  }
  assert.equal(rows, 5)
})

