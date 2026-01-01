// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// Phase 5d.1: a code film page that shows more than canvases is drawn whole
// by a hidden window of the main process (main/film-window.ts). The rules of
// that window that need no Electron: what its page may ask for, its size and
// marker row, the memory limit, and the frame number a marker pixel carries.
// (The window itself, its pictures and its end are measured in the app:
// scripts/e2e/scenarios/77-code-clip-page.mjs.)
import './dom-stub'
import assert from 'node:assert/strict'
import test from 'node:test'
import { overMemory, PAGE_MEMORY_LIMIT_KB, pageMayAsk, pageWindowSize, pageWindowUrl } from '../main/film-window-rules'
import { HOST_HTML } from '../main/codefilm-host'
import { markerOf, pagePicture } from '../renderer/src/media/codefilm-limits'

const A = '0123456789abcdef'
const B = 'fedcba9876543210'

test("a drawing window's page gets its own film's folder and nothing else", () => {
  assert.equal(pageMayAsk(`snippfilm://${A}/index.html?snipp=1&vt=1`, A), true)
  assert.equal(pageMayAsk(`snippfilm://${A}/__snipp/host.html?win=1&row=1`, A), true)
  assert.equal(pageMayAsk(`snippfilm://${A}`, A), true)
  assert.equal(pageMayAsk(`SNIPPFILM://${A.toUpperCase()}/x.js`, A), true)
  assert.equal(pageMayAsk('data:text/plain,hi', A), true)
  assert.equal(pageMayAsk('blob:snippfilm://0123456789abcdef/1b2c', A), true)
  assert.equal(pageMayAsk('about:blank', A), true)
  assert.equal(pageMayAsk('about:srcdoc', A), true)
  // Another film, the user's media, the network, a file, the app's pages.
  assert.equal(pageMayAsk(`snippfilm://${B}/index.html`, A), false)
  assert.equal(pageMayAsk(`snippfilm://${A}.evil/index.html`, A), false)
  assert.equal(pageMayAsk(`snippfilm://${A}@${B}/index.html`, A), false)
  assert.equal(pageMayAsk('media://local/C%3A%5Cvideo.mp4', A), false)
  assert.equal(pageMayAsk('https://example.com/', A), false)
  assert.equal(pageMayAsk('http://127.0.0.1:47811/', A), false)
  assert.equal(pageMayAsk('file:///C:/Windows/win.ini', A), false)
  assert.equal(pageMayAsk('about:config', A), false)
  assert.equal(pageMayAsk('devtools://devtools/bundled/x.html', A), false)
  assert.equal(pageMayAsk('ws://example.com/', A), false)
  // A window without a film id serves nothing.
  assert.equal(pageMayAsk(`snippfilm://${A}/index.html`, ''), false)
  assert.equal(pageMayAsk('data:text/plain,hi', 'nothex'), false)
})

test('the memory limit of a drawing window is 2 GB', () => {
  assert.equal(PAGE_MEMORY_LIMIT_KB, 2 * 1024 * 1024)
  assert.equal(overMemory(2 * 1024 * 1024), false)
  assert.equal(overMemory(2 * 1024 * 1024 + 1), true)
  assert.equal(overMemory(300 * 1024), false)
  assert.equal(overMemory(NaN), false)
  // (A test run's own limit.)
  assert.equal(overMemory(700 * 1024, 600 * 1024), true)
})

test("the window's size: the film's, clamped, with a marker row of at least one device pixel", () => {
  assert.deepEqual(pageWindowSize(1920, 1080), { width: 1920, height: 1080, scale: 1, row: 1, rows: 1 })
  assert.deepEqual(pageWindowSize(1080, 1920, 1), { width: 1080, height: 1920, scale: 1, row: 1, rows: 1 })
  // Half scale: two CSS pixels make the one device pixel of the row.
  assert.deepEqual(pageWindowSize(1920, 1080, 0.5), { width: 1920, height: 1080, scale: 0.5, row: 2, rows: 1 })
  assert.deepEqual(pageWindowSize(1920, 1080, 2), { width: 1920, height: 1080, scale: 2, row: 1, rows: 2 })
  assert.deepEqual(pageWindowSize(1920, 1080, 0.25), { width: 1920, height: 1080, scale: 0.25, row: 4, rows: 1 })
  // Whatever a page says is clamped; nonsense is 1920 x 1080 at 1.
  assert.deepEqual(pageWindowSize(1e9, 3), { width: 7680, height: 64, scale: 1, row: 1, rows: 1 })
  assert.deepEqual(pageWindowSize('x', null, 'y'), { width: 1920, height: 1080, scale: 1, row: 1, rows: 1 })
  assert.equal(pageWindowSize(1920, 1080, 99).scale, 2)
  assert.equal(pageWindowSize(1920, 1080, 0.001).scale, 0.25)
  assert.equal(pageWindowUrl(A, 1), `snippfilm://${A}/__snipp/host.html?win=1&row=1`)
  assert.equal(pageWindowUrl(A, 2), `snippfilm://${A}/__snipp/host.html?win=1&row=2`)
})

test('the marker row: every frame number of a run comes back from its colour', () => {
  // The colour the host page writes for frame n (codefilm-host.ts rowMark),
  // as a picture's bytes in both byte orders.
  const colour = (n: number): string => '#' + ((n & 0xffffff) + 0x1000000).toString(16).slice(1)
  const bytes = (c: string): number[] => [parseInt(c.slice(1, 3), 16), parseInt(c.slice(3, 5), 16), parseInt(c.slice(5, 7), 16), 255]
  for (const n of [1, 2, 255, 256, 599, 600, 65535, 65536, 0xabcdef, 0xffffff]) {
    const [r, g, b, a] = bytes(colour(n))
    assert.equal(markerOf([r, g, b, a], false), n)
    assert.equal(markerOf([b, g, r, a], true), n)
  }
  for (let n = 1; n <= 600; n++) {
    const [r, g, b, a] = bytes(colour(n))
    assert.equal(markerOf([b, g, r, a], true), n)
  }
  // Past 24 bits the number wraps (a film's page is asked far fewer frames).
  assert.equal(markerOf(bytes(colour(0x1000005)), false), 5)
  // The row before any frame (black) is no frame's number.
  assert.equal(markerOf([0, 0, 0, 255], true), 0)
  assert.equal(markerOf([9, 9, 1, 0, 0, 255], true, 2), 1)
})

test("the film's picture is the window's picture without its marker rows", () => {
  assert.deepEqual(pagePicture(1920, 1081, 1), { width: 1920, height: 1080, row: 1080 })
  assert.deepEqual(pagePicture(3840, 2162, 2), { width: 3840, height: 2160, row: 2161 })
  assert.deepEqual(pagePicture(960, 541, undefined), { width: 960, height: 540, row: 540 })
  assert.equal(pagePicture(1920, 1, 1), null)
  assert.equal(pagePicture(0, 100, 1), null)
})

test('the host page can be the whole document of a drawing window', () => {
  // Its window mode, its marker row and the two calls the main process makes.
  for (const piece of ['win=1', '__snippGive', '__snippTake', "type: 'painted'", "type: 'size'", "m.type === 'taken'", "m.type === 'nudge'", "mode = 'page'", 'rowMark(q.id)']) {
    assert.ok(HOST_HTML.includes(piece), `the host page lacks ${piece}`)
  }
  // As a frame of the editor it still waits for the editor's port.
  assert.ok(HOST_HTML.includes("e.data.type !== 'snipp-port'"))
})
