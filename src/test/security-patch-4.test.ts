// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// Security patch, item 4 (B-G3, S5): the editor page may ask over file://
// only for the app's own files (the folder its page is served from:
// out\renderer, inside app.asar when packaged). Every other file on the disk
// is refused by the main process's request filter, whatever the page's own
// policy says ('self' on a file:// page is every local file). The rule is
// pure (here); the built app itself is tried by e2e `security-file-fence`
// (page, worker, script, import, image, stylesheet), also packaged.
import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { isAllowedAppRequest, ownFilesRoot } from '../main/network'

const ENTRY = 'file:///C:/Program%20Files/App/resources/app.asar/out/renderer/index.html'
const ROOT = 'file:///C:/Program%20Files/App/resources/app.asar/out/renderer/'
const ok = (url: string, platform = 'win32'): boolean => isAllowedAppRequest(url, undefined, ownFilesRoot(ENTRY), platform)

test('item 4: the app\'s own files root is the folder of its page', () => {
  assert.equal(ownFilesRoot(ENTRY), ROOT)
  assert.equal(ownFilesRoot(ENTRY + '#render-worker'), ROOT)
  assert.equal(ownFilesRoot('file:///opt/App/resources/app.asar/out/renderer/index.html?x=1'), 'file:///opt/App/resources/app.asar/out/renderer/')
  assert.equal(ownFilesRoot('https://example.com/index.html'), null)
  assert.equal(ownFilesRoot('not a url'), null)
})

test('item 4: the page and its own files pass', () => {
  for (const url of [
    ENTRY, ENTRY + '#ui-kit', ENTRY + '?v=2',
    ROOT + 'assets/index-b_EB07yk.js', ROOT + 'assets/ort-wasm-simd-threaded.jsep-B0T3yYHD.wasm', ROOT + 'assets/Inter-Variable-VF2RPR_K.ttf',
    // (Windows compares paths without case; a space written as it is.)
    'file:///c:/program%20files/app/resources/app.asar/out/renderer/assets/a.js', 'file:///C:/Program Files/App/resources/app.asar/out/renderer/assets/a.js'
  ]) assert.equal(ok(url), true, url)
})

test('item 4: every other local file is refused', () => {
  for (const url of [
    'file:///C:/Windows/win.ini',
    'file:///C:/Users/u/Documents/notes.txt',
    'file:///C:/Users/u/Downloads/project/evil.js',
    // The app's own folders beside the page's: not the page's to read.
    'file:///C:/Program%20Files/App/resources/app.asar/out/main/index.js',
    'file:///C:/Program%20Files/App/resources/app.asar/out/preload/index.js',
    'file:///C:/Program%20Files/App/resources/models/config.json',
    // A folder that only starts with the same letters.
    'file:///C:/Program%20Files/App/resources/app.asar/out/renderer-evil/a.js',
    'file:///C:/Program%20Files/App/resources/app.asar/out/rendererx',
    // Climbing out, plainly and encoded (Chromium decodes %5c to a separator).
    ROOT + '../main/index.js', ROOT + 'assets/../../../../../../Windows/win.ini',
    ROOT + '..%5c..%5c..%5c..%5c..%5cWindows%5cwin.ini', ROOT + 'assets/..%2f..%2f..%2fmain/index.js', ROOT + '%2e%2e/%2e%2e/main/index.js', ROOT + 'assets/%2e%2e%5c%2e%2e%5cmain%5cindex.js',
    ROOT + 'assets\\..\\..\\main\\index.js',
    // A stream of one of its files, another host.
    ROOT + 'index.html::$DATA',
    'file://server/share/out/renderer/index.html', 'file:////server/share/x.js', 'file://localhost/C:/Windows/win.ini'
  ]) assert.equal(ok(url), false, url)
  // An install folder with a % or a # in its name is still the app's own.
  const odd = 'file:///D:/100%25%20apps/a%23b/out/renderer/index.html'
  assert.equal(isAllowedAppRequest('file:///D:/100%25%20apps/a%23b/out/renderer/assets/a.js', undefined, ownFilesRoot(odd), 'win32'), true)
  assert.equal(isAllowedAppRequest('file:///D:/100%25%20apps/a%23b/out/main/index.js', undefined, ownFilesRoot(odd), 'win32'), false)
  // With no root named, no local file at all.
  assert.equal(isAllowedAppRequest(ENTRY), false)
  assert.equal(isAllowedAppRequest(ENTRY, undefined, null), false)
})

test('item 4: elsewhere paths keep their case, and the other schemes are as they were', () => {
  const entry = 'file:///opt/App/resources/app.asar/out/renderer/index.html'
  const root = ownFilesRoot(entry)
  assert.equal(isAllowedAppRequest('file:///opt/App/resources/app.asar/out/renderer/assets/a.js', undefined, root, 'linux'), true)
  assert.equal(isAllowedAppRequest('file:///opt/app/resources/app.asar/out/renderer/assets/a.js', undefined, root, 'linux'), false)
  assert.equal(isAllowedAppRequest('file:///etc/passwd', undefined, root, 'linux'), false)
  assert.equal(ok('media://local/C%3A%5Cx.mp4'), true)
  assert.equal(ok('snippfilm://0123456789abcdef/index.html'), true)
  assert.equal(ok('blob:null/abc'), true)
  assert.equal(ok('https://example.com/'), false)
})

test('item 4: the main process filters every session with the app\'s own root', () => {
  const index = readFileSync(path.join(__dirname, '..', '..', 'src', 'main', 'index.ts'), 'utf8')
  assert.match(index, /isAllowedAppRequest\(details\.url, devUrl, OWN_FILES\)/)
  assert.match(index, /const OWN_FILES = ownFilesRoot\(rendererEntry\)/)
})

test('item 4: the page\'s own policy names no file: address to connect to, no remote source and no eval', () => {
  const html = readFileSync(path.join(__dirname, '..', '..', 'src', 'renderer', 'index.html'), 'utf8')
  const csp = /http-equiv="Content-Security-Policy"\s+content="([^"]+)"/.exec(html)?.[1] ?? ''
  const directive = (name: string): string[] => (csp.split(';').map((d) => d.trim().split(/\s+/)).find((d) => d[0] === name) ?? []).slice(1)
  // fetch / XMLHttpRequest (the page's, and a blob worker's: it inherits this
  // policy): media://, blob: and data: only; the two localhost entries are
  // the development server's and are taken out of the built page.
  assert.deepEqual(directive('connect-src'), ['media:', 'blob:', 'data:', 'ws://localhost:*', 'http://localhost:*'])
  assert.deepEqual(directive('script-src'), ["'self'", "'wasm-unsafe-eval'"])
  assert.deepEqual(directive('object-src'), ["'none'"])
  assert.deepEqual(directive('base-uri'), ["'none'"])
  assert.deepEqual(directive('frame-src'), ['snippfilm:'])
  // Nothing remote: every http / ws source is the development server's.
  for (const src of csp.split(/[;\s]+/).filter((x) => /^(https?|wss?):/.test(x))) assert.match(src, /^(http|ws):\/\/localhost:\*$/, src)
  assert.doesNotMatch(csp.replace("'wasm-unsafe-eval'", ''), /unsafe-eval/)
})
