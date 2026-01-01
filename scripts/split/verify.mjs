// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// node scripts/split/verify.mjs <commit|--worktree>: a split moves code, it does
// not change it. Every line the commit removed must come back, character for
// character (leading spaces aside), among the lines it added — except import
// and export-from lines, which are rewritten. Prints the lines that vanished.
import { execFileSync } from 'node:child_process'
const ref = process.argv[2] ?? '--worktree'
const diff = execFileSync('git', ref === '--worktree' ? ['diff', 'HEAD', '-U0', '--', 'src'] : ['show', ref, '-U0', '--format=', '--', 'src'], { encoding: 'utf8', maxBuffer: 1 << 28 })
const removed = new Map(), added = new Map()
const bump = (m, k) => m.set(k, (m.get(k) ?? 0) + 1)
// Import and re-export lines (and the items of a multi-line import list) are rewritten, not moved.
const skip = (l) => /^(import\s|export\s*(type\s*)?\{[^}]*\}\s*from\s)/.test(l) || /^(type\s+)?[\w$]+(\s+as\s+[\w$]+)?,?$/.test(l) || /^\}\s*from\s/.test(l) || l === ''
for (const raw of diff.split('\n')) {
  if (raw.startsWith('---') || raw.startsWith('+++')) continue
  const l = raw.slice(1).replace(/\r$/, '').trim()
  if (raw.startsWith('-') && !skip(l)) bump(removed, l.replace(/^export\s+/, ''))
  if (raw.startsWith('+') && !skip(l)) bump(added, l.replace(/^export\s+/, ''))
}
const lost = []
for (const [l, n] of removed) if ((added.get(l) ?? 0) < n) lost.push(`${n - (added.get(l) ?? 0)}× ${l}`)
const gained = []
for (const [l, n] of added) if ((removed.get(l) ?? 0) < n && !/^\/\/|^\*|^\/\*/.test(l)) gained.push(`${n - (removed.get(l) ?? 0)}× ${l}`)
console.log(`removed ${[...removed.values()].reduce((a, b) => a + b, 0)} lines; vanished: ${lost.length}; new non-comment lines: ${gained.length}`)
for (const l of lost) console.log('  - ' + l.slice(0, 160))
for (const l of gained.slice(0, 40)) console.log('  + ' + l.slice(0, 160))
