// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// The command layer is pure (SnippStudio phase 2A): no module it loads, at any
// depth, is the store, a component, the drawing module, or touches the DOM,
// window, or localStorage; and the commands themselves never read the clock,
// Math.random or the UI state. Read from the sources, so it holds for code
// paths no test runs. This file imports no DOM stub on purpose: loading the
// commands in a bare Node process must work.
import assert from 'node:assert/strict'
import test from 'node:test'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'

const SRC = resolve(process.cwd(), 'src', 'renderer', 'src')
const COMMANDS = join(SRC, 'commands')

function filesIn(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f)
    return statSync(p).isDirectory() ? filesIn(p) : /\.tsx?$/.test(f) ? [p] : []
  })
}

/** The code without comments and string contents (so a comment that says
 *  "document" is not a use of it). */
function codeOf(file: string): string {
  return readFileSync(file, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1')
    .replace(/'(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*"/g, "''")
}

/** The modules a file loads when it runs: `import type` / `export type` and
 *  type-position `import('x').Name` are erased by the compiler, so they do
 *  not count. */
function importsOf(file: string): string[] {
  const text = readFileSync(file, 'utf8')
  const out: string[] = []
  for (const m of text.matchAll(/^\s*(import|export)\s+(type\s)?[^'"]*?from\s+['"]([^'"]+)['"]|^\s*import\s+['"]([^'"]+)['"]/gm)) {
    if (m[2]) continue
    out.push(m[3] ?? m[4])
  }
  for (const m of text.matchAll(/import\(\s*['"]([^'"]+)['"]\s*\)(\.[A-Za-z_])?/g)) if (!m[2]) out.push(m[1])
  return out
}

/** Modules the commands load that name the DOM, and why that is fine. */
const DOM_OK: Record<string, string> = {
  // measure(): a text measure for the cutout title's layout, OffscreenCanvas
  // first and `document` only as a guarded fallback, made on first use. The
  // drawing and the selection box reach it; createTemplate does not.
  // (In templates/model.ts until SnippStudio phase 2B moved the layouts out.)
  'templates/layout/cutout.ts': 'guarded, lazy text measure for drawing'
}

function resolveImport(from: string, spec: string): string | null {
  if (!spec.startsWith('.')) return spec
  const base = resolve(dirname(from), spec)
  for (const c of [base + '.ts', base + '.tsx', join(base, 'index.ts')]) if (existsSync(c)) return c
  return null
}

function closure(roots: string[]): Set<string> {
  const seen = new Set<string>()
  const todo = [...roots]
  while (todo.length) {
    const f = todo.pop()!
    if (seen.has(f)) continue
    seen.add(f)
    if (!f.endsWith('.ts') && !f.endsWith('.tsx')) continue
    for (const spec of importsOf(f)) {
      const r = resolveImport(f, spec)
      if (r && !seen.has(r)) todo.push(r)
    }
  }
  return seen
}

const commandFiles = filesIn(COMMANDS)
const loaded = closure(commandFiles)
const rel = (f: string): string => (f.startsWith(SRC) ? relative(SRC, f).replace(/\\/g, '/') : f)

test('the commands load no store, component, drawing module, React or zustand, at any depth', () => {
  const bad = [...loaded].map(rel).filter((f) =>
    f === 'state/store.ts' || f.startsWith('components/') || f.startsWith('agent/') || f === 'playback/render.ts' ||
    f === 'playback/engine.ts' || f === 'App.tsx' || f.endsWith('.tsx') || f === 'react' || f === 'zustand' || f.startsWith('react-') || f.startsWith('node:')
  )
  assert.deepEqual(bad, [], 'loaded by the commands: ' + bad.join(', '))
  // Sanity: the walk did find the helpers.
  assert.ok([...loaded].map(rel).includes('commands/ops/ripple.ts'))
  assert.ok([...loaded].map(rel).includes('subtitles/follow.ts'))
})

test('nothing the commands load touches the DOM, window, localStorage or the network', () => {
  const offenders: string[] = []
  for (const f of loaded) {
    if (!f.startsWith(SRC) || DOM_OK[rel(f)]) continue
    const code = codeOf(f)
    for (const word of ['document', 'window', 'localStorage', 'sessionStorage', 'navigator', 'fetch(', 'XMLHttpRequest', 'indexedDB', 'requestAnimationFrame']) {
      const re = new RegExp(`(^|[^.\\w$])${word.replace('(', '\\(')}(?![\\w$])`)
      if (re.test(code)) offenders.push(`${rel(f)}: ${word}`)
    }
  }
  assert.deepEqual(offenders, [], offenders.join('\n'))
})

test('the commands read no UI state, clock or randomness of their own (those come in as parameters or env)', () => {
  const offenders: string[] = []
  for (const f of commandFiles) {
    const code = codeOf(f)
    for (const word of ['useStore', 'getState', 'currentTime', 'selectedClipIds', 'selectedCaptionIds', 'templateSel', 'cutMarks', 'linkAV\\(', 'Math\\.random', 'new Date\\(', 'performance\\.now', 'Date\\.now']) {
      if (new RegExp(word).test(code)) {
        // core.ts makes the default env: the one place Math.random and the
        // clock are named.
        if (rel(f) === 'commands/core.ts' && /Math\\\.random|new Date/.test(word)) continue
        offenders.push(`${rel(f)}: ${word.replace(/\\/g, '')}`)
      }
    }
  }
  assert.deepEqual(offenders, [], offenders.join('\n'))
})

/** Modules the commands load that read the clock or randomness, and why
 *  that is fine. Anything not listed here is an error. */
const CLOCK_OK: Record<string, string> = {
  // uid(): random only when no id source is set; a command run by name with
  // a seed sets one (withIds), so the ids are repeatable.
  'types.ts': 'uid default (crypto.randomUUID) behind withIds',
  // createTemplate(…, seed): Math.random only when no seed is passed (the UI);
  // template.place and the suggestions pass one from env.random.
  'templates/model.ts': 'createTemplate default seed',
  // addNote(…, now): new Date() only as the default; note.add passes env.now().
  'notes/model.ts': 'addNote default time',
  // chainParams(…, sharedSeed): Math.random only when no seed is passed;
  // motion.cinematize always passes one from env.random.
  'effects/cinematic.ts': 'chain seed default',
  // core.ts makes the default env (Math.random, the clock).
  'commands/core.ts': 'defaultEnv'
}

test('nothing the commands load reads the clock or randomness, except the named defaults', () => {
  const offenders: string[] = []
  for (const f of loaded) {
    if (!f.startsWith(SRC) || CLOCK_OK[rel(f)]) continue
    const code = codeOf(f)
    for (const re of [/Math\.random\(/, /Date\.now\(/, /new Date\(\s*\)/, /performance\.now\(/, /crypto\.randomUUID/, /crypto\.getRandomValues/]) {
      if (re.test(code)) offenders.push(`${rel(f)}: ${re.source.replace(/\\/g, '')}`)
    }
  }
  assert.deepEqual(offenders, [], offenders.join('\n'))
})

test('the commands load in a bare Node process (no DOM stub)', async () => {
  assert.equal(typeof (globalThis as { document?: unknown }).document, 'undefined')
  const mod = await import('../renderer/src/commands')
  assert.ok(Object.keys(mod.COMMANDS).length >= 50)
})
