// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// Runs the compiled smoke tests.
//
// The repository is an ES-module package, so plain `.js` output would be read
// as ESM — and the tests are compiled to CommonJS on purpose, because the
// source imports have no file extensions and Node's ESM resolver will not
// guess them. A `type: commonjs` marker beside the output settles it without
// touching how the app itself is built.
import { spawnSync } from 'node:child_process'
import { mkdirSync, readdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

const out = 'out-test'
mkdirSync(out, { recursive: true })
writeFileSync(join(out, 'package.json'), JSON.stringify({ type: 'commonjs' }) + '\n')

const dir = join(out, 'test')
const files = readdirSync(dir)
  .filter((f) => f.endsWith('.test.js'))
  .map((f) => join(dir, f))

if (files.length === 0) {
  console.error('No compiled tests found in ' + dir)
  process.exit(1)
}

// Every test file runs with the model check installed (src/test/model-check-
// setup.ts, phase Ç2a.1): an edit that breaks the model's rules fails its test.
const setup = resolve(dir, 'model-check-setup.js').replace(/\\/g, '/')
const NODE_OPTIONS = `${process.env.NODE_OPTIONS ?? ''} --require "${setup}"`.trim()
const result = spawnSync(process.execPath, ['--test', ...files], { stdio: 'inherit', env: { ...process.env, NODE_OPTIONS } })
process.exit(result.status ?? 1)
