// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// Phase 5b (FAZ5-PLAN.md, "5b"): a code film's frame keeps its alpha. The
// ground it is laid on is the page's own background colour (html, else body),
// unless the page's __config.transparent says otherwise; the filmstrip knows
// whether any frame lets something through.
import './dom-stub'
import assert from 'node:assert/strict'
import test from 'node:test'
import { filmGround, HOST_HTML, pickConfig } from '../main/codefilm-host'
import { anyAlpha } from '../renderer/src/media/checker'

/** A stand-in film document: html and body with computed background colours. */
const doc = (html: string, body: string, throws = false) => {
  const htmlEl = { tag: 'html' }
  const bodyEl = { tag: 'body' }
  return {
    documentElement: htmlEl,
    body: bodyEl,
    defaultView: {
      getComputedStyle: (el: { tag: string }) => {
        if (throws) throw new Error('no view')
        return { backgroundColor: el.tag === 'html' ? html : body }
      }
    }
  }
}

test('the ground is the html background, else the body one, else none', () => {
  // Today's films: body{background:#000} (and html too in the user's films).
  assert.equal(filmGround(doc('rgba(0, 0, 0, 0)', 'rgb(0, 0, 0)')), 'rgb(0, 0, 0)')
  assert.equal(filmGround(doc('rgb(0, 0, 0)', 'rgb(0, 0, 0)')), 'rgb(0, 0, 0)')
  // html wins over body (CSS: the body's background stands for the page's
  // only when the html one is transparent).
  assert.equal(filmGround(doc('rgb(10, 20, 30)', 'rgb(200, 0, 0)')), 'rgb(10, 20, 30)')
  // A transparent page: no ground at all.
  assert.equal(filmGround(doc('rgba(0, 0, 0, 0)', 'rgba(0, 0, 0, 0)')), '')
  assert.equal(filmGround(doc('transparent', 'rgba(255, 255, 255, 0)')), '')
  assert.equal(filmGround(doc('rgba(0, 0, 0, 0)', 'color(srgb 1 0 0 / 0)')), '')
  assert.equal(filmGround(doc('', '')), '')
  // Half see-through is a ground of its own (laid as it is).
  assert.equal(filmGround(doc('rgba(0, 0, 0, 0)', 'rgba(0, 0, 0, 0.5)')), 'rgba(0, 0, 0, 0.5)')
  assert.equal(filmGround(doc('rgba(0, 0, 0, 0)', 'oklch(0.5 0.1 200)')), 'oklch(0.5 0.1 200)')
  // A document that cannot be read: no ground (never a throw in a frame).
  assert.equal(filmGround(doc('rgb(0, 0, 0)', 'rgb(0, 0, 0)', true)), '')
  assert.equal(filmGround({}), '')
})

test('__config.transparent is read only when it is a yes or a no', () => {
  const none = { querySelectorAll: () => [] }
  assert.equal(pickConfig({ __config: { width: 640, height: 360, transparent: true }, document: none }).transparent, true)
  assert.equal(pickConfig({ __config: { width: 640, height: 360, transparent: false }, document: none }).transparent, false)
  assert.equal(pickConfig({ __config: { width: 640, height: 360, transparent: 'yes' }, document: none }).transparent, null)
  assert.equal(pickConfig({ VH_CONFIG: { width: 640, height: 360, transparent: true }, document: none }).transparent, true)
  assert.equal(pickConfig({ document: none }).transparent, null)
})

test('the host page composes with alpha and lays the page\'s ground', () => {
  // The page's script carries the helper it calls, and its compose surface
  // is no longer an opaque one.
  assert.match(HOST_HTML, /function filmGround/)
  assert.doesNotMatch(HOST_HTML, /alpha:\s*false/)
  assert.match(HOST_HTML, /clearRect\(0, 0, w, h\)/)
})

test('a picture lets something through when any pixel is not opaque', () => {
  assert.equal(anyAlpha([0, 0, 0, 255, 9, 9, 9, 255]), false)
  assert.equal(anyAlpha([0, 0, 0, 255, 9, 9, 9, 254]), true)
  assert.equal(anyAlpha([0, 0, 0, 0]), true)
  assert.equal(anyAlpha([]), false)
})

test('ProRes 4444 and 4444 XQ are told apart from the other ProRes kinds', async () => {
  const { isProRes4444 } = await import('../renderer/src/media/import')
  assert.equal(isProRes4444('prores', 'ap4h'), true)
  assert.equal(isProRes4444('prores', 'ap4x'), true)
  for (const p of ['apch', 'apcn', 'apcs', 'apco', null]) assert.equal(isProRes4444('prores', p), false, String(p))
  assert.equal(isProRes4444('vp9', 'ap4h'), false)
  assert.equal(isProRes4444(null, null), false)
})
