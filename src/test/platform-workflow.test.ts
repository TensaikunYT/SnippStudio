// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// Phase 10b.6 (FAZ10-PLAN.md): the build recipe for the three systems
// (.github/workflows/platforms.yml), read here. It is committed, never pushed
// or run from this PC.
import assert from 'node:assert/strict'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import test from 'node:test'

const ROOT = join(__dirname, '..', '..')
const FILE = join(ROOT, '.github', 'workflows', 'platforms.yml')
// js-yaml comes with electron-builder (package-lock.json); only read here.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const yaml = require('js-yaml') as { load: (s: string) => unknown }

interface Step {
  name?: string
  run?: string
  uses?: string
  if?: string
  env?: Record<string, string>
}
const text = readFileSync(FILE, 'utf8')
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const wf = yaml.load(text) as any
const job = wf.jobs['build-test']
const steps: Step[] = job.steps
const named = (re: RegExp): Step => {
  const s = steps.find((x) => re.test(x.name ?? x.run ?? ''))
  assert.ok(s, String(re))
  return s!
}

test('three systems, each building its own package', () => {
  const inc: { os: string; dist: string }[] = job.strategy.matrix.include
  assert.deepEqual(inc.map((x) => x.os), ['windows-latest', 'macos-latest', 'ubuntu-latest'])
  assert.match(inc[0].dist, /--win nsis/)
  assert.match(inc[1].dist, /--mac dmg zip/)
  assert.match(inc[1].dist, /--arm64/)
  assert.match(inc[1].dist, /--x64/)
  assert.match(inc[2].dist, /--linux AppImage deb/)
  assert.equal(job.strategy['fail-fast'], false)
})

test('the steps: type check, tests, build, codec probe, e2e, package, start', () => {
  const runs = steps.map((s) => s.run ?? '').join('\n')
  for (const r of ['npm ci', 'npm run typecheck', 'npm test', 'npm run build']) assert.ok(runs.includes(r), r)
  assert.match(named(/Codec probe/).run!, /AudioEncoder\.isConfigSupported/)
  assert.match(named(/Codec probe/).run!, /requestAdapter/)
  assert.match(named(/^Package$/).run!, /electron-builder \$\{\{ matrix\.dist \}\} --config electron-builder\.config\.cjs --publish never/)
  assert.match(named(/packaged app starts/).run!, /kill "\$PID"/, 'closed by its own PID, never by name')
  assert.equal(/pkill|killall|taskkill/.test(runs), false)
})

test('Linux runs under xvfb-run, with the AppArmor sysctl; no compiler (no native module since TERMINAL-YOK-PLAN.md)', () => {
  const e2e = named(/^e2e/).run!
  assert.match(e2e, /xvfb-run -a/)
  assert.match(named(/Codec probe/).run!, /xvfb-run -a npx electron/)
  assert.match(named(/packaged app starts/).run!, /xvfb-run -a "\$APP" --appimage-extract-and-run --no-sandbox/)
  assert.equal(named(/AppArmor/).if, "runner.os == 'Linux'")
  assert.match(named(/Tools/).run!, /ffmpeg xvfb/)
  assert.doesNotMatch(named(/Tools/).run!, /build-essential|python3/)
})

test('secrets only through env:, never written into a command; no personal path', () => {
  for (const s of steps) assert.equal(/secrets\./.test(s.run ?? ''), false, `${s.name ?? s.run}: a secret in a command`)
  const secretEnv = steps.flatMap((s) => Object.values(s.env ?? {})).filter((v) => /secrets\./.test(String(v)))
  assert.ok(secretEnv.length >= 6, 'the signing secrets come in as env')
  assert.equal(/[A-Z]:\\Users|\/Users\/[a-z]|\/home\/[a-z]|Desktop/i.test(text), false, 'no personal path')
  assert.equal(/@(gmail|outlook|hotmail)\./i.test(text), false)
  assert.deepEqual(wf.permissions, { contents: 'read' })
  // Never run on its own on a push: by hand, or on a pull request.
  assert.deepEqual(Object.keys(wf.on).sort(), ['pull_request', 'workflow_dispatch'])
})

test('the e2e subset names scenarios that exist and need no outside material', () => {
  const only = new RegExp(job.env.E2E_ONLY)
  const names = readdirSync(join(ROOT, 'scripts', 'e2e', 'scenarios'))
    .filter((f) => f.endsWith('.mjs'))
    .map((f) => /export const name = '([^']+)'/.exec(readFileSync(join(ROOT, 'scripts', 'e2e', 'scenarios', f), 'utf8'))?.[1])
    .filter((n): n is string => !!n)
  const picked = names.filter((n) => only.test(n))
  const listed = job.env.E2E_ONLY.replace(/^\^\(|\)\$$/g, '').split('|')
  assert.deepEqual([...picked].sort(), [...listed].sort(), 'every listed scenario exists')
  assert.ok(picked.includes('faz10-export-no-aac'))
  assert.match(job.env.SNIPP_TESTDATA, /runner\.temp/)
  assert.ok(existsSync(join(ROOT, 'scripts', 'e2e', 'harness-paths.mjs')))
})
