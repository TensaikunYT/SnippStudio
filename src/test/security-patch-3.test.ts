// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// Security patch, item 3 (B-G2, B-G4, B-G6): a packaged copy does not start
// with a debugging switch, opens no DevTools and installs no test hooks,
// unless the packaged e2e gate holds in full. The decision is pure (here);
// the packaged program itself is tried by `npm run e2e -- --packaged=…`.
import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { devToolsAllowed, launchRefusal, refusedSwitch, switchName, TEST_HOOKS_ARG, testHooksAllowed } from '../main/launch-guard'

const SRC = path.join(__dirname, '..', '..', 'src')
const product = { packaged: true, testCopy: false }
const testCopy = { packaged: true, testCopy: true }
const source = { packaged: false, testCopy: false }

test('item 3: the switches a packaged copy refuses, in every spelling Chromium reads', () => {
  const exe = 'C:\\Program Files\\App\\App.exe'
  for (const [arg, name] of [
    ['--remote-debugging-port=9222', 'remote-debugging-port'],
    ['--remote-debugging-port', 'remote-debugging-port'],
    ['-remote-debugging-port=0', 'remote-debugging-port'],
    ['/remote-debugging-port=9222', 'remote-debugging-port'],
    ['--Remote-Debugging-Port=9222', 'remote-debugging-port'],
    ['--remote-debugging-pipe', 'remote-debugging-pipe'],
    ['--inspect', 'inspect'],
    ['--inspect=9229', 'inspect'],
    ['--inspect-brk=127.0.0.1:9229', 'inspect-brk'],
    ['--inspect-port=0', 'inspect-port'],
    ['--inspect-brk-node', 'inspect-brk-node'],
    ['--load-extension=C:\\x', 'load-extension']
  ] as const) {
    assert.equal(refusedSwitch([exe, arg], 'win32'), name, arg)
    assert.equal(launchRefusal([exe, 'D:\\p\\a.snipp', arg], product, 'win32'), `--${name}`, arg)
  }
  // Not switches, or other switches: nothing refused.
  for (const arg of ['D:\\film\\remote-debugging-port=1.snipp', '--agent', '--code-film=D:\\f', '--user-data-dir=D:\\p', '--e2e', '--inspector', '--show-inactive=offscreen', 'inspect', '--', '/', 'C:/x/--inspect']) {
    assert.equal(refusedSwitch([exe, arg], 'win32'), null, arg)
  }
  // POSIX: no /name switches (a path starts with /), names keep their case there.
  assert.equal(refusedSwitch(['/opt/app/app', '/remote-debugging-port=1'], 'linux'), null)
  assert.equal(refusedSwitch(['/opt/app/app', '--remote-debugging-port=1'], 'linux'), 'remote-debugging-port')
  assert.equal(switchName('--Foo=1', 'win32'), 'foo')
  assert.equal(switchName('--Foo=1', 'linux'), 'Foo')
  // What Chromium parsed is asked too.
  assert.equal(launchRefusal([exe], product, 'win32', (s) => s === 'remote-debugging-pipe'), '--remote-debugging-pipe')
  assert.equal(launchRefusal([exe], product, 'win32', (s) => s === 'inspect-brk'), '--inspect-brk')
  assert.equal(launchRefusal([exe], product, 'win32', () => false), null)
})

test('item 3: only the packaged product refuses; the full e2e gate and a source build do not', () => {
  const argv = ['App.exe', '--remote-debugging-port=9222', '--e2e', '--user-data-dir=D:\\p']
  assert.equal(launchRefusal(argv, product, 'win32'), '--remote-debugging-port')
  assert.equal(launchRefusal(argv, testCopy, 'win32'), null)
  assert.equal(launchRefusal(argv, source, 'win32'), null)
  for (const [facts, on] of [[product, false], [testCopy, true], [source, true]] as const) {
    assert.equal(devToolsAllowed(facts), on)
    assert.equal(testHooksAllowed(facts), on)
  }
})

test('item 3: the main process ends a refused launch first, and the page asks before it installs a hook', () => {
  const index = readFileSync(path.join(SRC, 'main', 'index.ts'), 'utf8')
  // The check stands before the profile folder, the single-instance lock and any window.
  const at = index.indexOf('launchRefusal(')
  assert.ok(at > 0, 'index.ts asks launchRefusal')
  for (const later of ['app.setName(', 'requestSingleInstanceLock(', 'app.whenReady()', 'registerSchemesAsPrivileged(']) assert.ok(index.indexOf(later) > at, `before ${later}`)
  assert.match(index, /devTools: devToolsAllowed\(/)
  assert.match(index, /testHooksAllowed\([^)]*\) \? \[TEST_HOOKS_ARG\]/)
  const preload = readFileSync(path.join(SRC, 'preload', 'index.ts'), 'utf8')
  assert.ok(preload.includes(`'${TEST_HOOKS_ARG}'`))
  const page = readFileSync(path.join(SRC, 'renderer', 'src', 'main.tsx'), 'utf8')
  const hook = page.indexOf('w.__store = useStore')
  const gate = page.indexOf('api?.testHooks === true')
  assert.ok(gate > 0 && hook > gate, 'the hooks are installed only behind api.testHooks')
  // No hook is set anywhere else in the page.
  assert.equal(page.slice(0, gate).includes('w.__'), false)
})
