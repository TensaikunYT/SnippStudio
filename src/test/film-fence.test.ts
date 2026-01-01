// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// 5a/5b patch, item 1 (audit C-1 + C-2): the main process decides per request
// who may read media:// and a film's folder (main/film-fence.ts), the film
// server puts its policy on every answer and keeps a project file kept in the
// film's folder from the film. Each test fails on 5498899 (no fence there; the
// policy only on HTML answers; the project served).
import './dom-stub'
import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { admitted, askerOf, fenceAnswer, filmIdIn } from '../main/film-fence'
import { FILM_CSP, FilmRegistry, notForFilm, serveFilm } from '../main/codefilm'

const A = '0123456789abcdef'
const B = 'fedcba9876543210'
const EDITOR = ['file:///C:/app/out/renderer/index.html', 'file://']
const filmChain = (id: string, ...inner: string[]): string[] => [...inner, `snippfilm://${id}/index.html?snipp=1`, `snippfilm://${id}`, `snippfilm://${id}/__snipp/host.html`, `snippfilm://${id}`, ...EDITOR]
const MEDIA = 'media://local/C%3A%5Cvideo.mp4'

test('who asked: the editor, a film (any frame inside it), or unknown', () => {
  assert.equal(filmIdIn(`snippfilm://${A}/x.svg`), A)
  assert.equal(filmIdIn(`snippfilm://${A}`), A)
  assert.equal(filmIdIn('snippfilm://nothex/x'), '')
  assert.equal(askerOf({ frames: EDITOR, referrer: '' }), 'editor')
  assert.equal(askerOf({ frames: ['http://localhost:5173/', 'http://localhost:5173'], referrer: '' }), 'editor')
  assert.equal(askerOf({ frames: filmChain(A), referrer: '' }), A)
  // A blank child frame (its url about:blank, its origin the film's), an svg document.
  assert.equal(askerOf({ frames: filmChain(A, 'about:blank', `snippfilm://${A}`), referrer: '' }), A)
  assert.equal(askerOf({ frames: filmChain(A, '', `snippfilm://${A}`), referrer: '' }), A)
  // The referrer alone names a film.
  assert.equal(askerOf({ frames: [], referrer: `snippfilm://${A}/w.js` }), A)
  // Nothing to tell by.
  assert.equal(askerOf({ frames: [], referrer: '' }), 'unknown')
  assert.equal(askerOf({ frames: ['about:blank', 'null'], referrer: '' }), 'unknown')
  // Two films in one chain: never legitimate.
  assert.equal(askerOf({ frames: filmChain(A, `snippfilm://${B}/index.html`), referrer: '' }), 'films')
})

test('a film never gets media:// nor another film; the editor gets both; unknown gets neither', () => {
  const film = { frames: filmChain(A), referrer: '' }
  assert.deepEqual(fenceAnswer(MEDIA, film), { allow: false, film: A })
  assert.deepEqual(fenceAnswer(`snippfilm://${B}/index.html`, film), { allow: false, film: A })
  assert.deepEqual(fenceAnswer(`snippfilm://${A}/data.json`, film), { allow: true, film: A })
  const editor = { frames: EDITOR, referrer: '' }
  assert.equal(fenceAnswer(MEDIA, editor).allow, true)
  assert.equal(fenceAnswer(`snippfilm://${B}/__snipp/host.html`, editor).allow, true)
  const unknown = { frames: [], referrer: '' }
  assert.equal(fenceAnswer(MEDIA, unknown).allow, false)
  assert.equal(fenceAnswer(`snippfilm://${A}/x`, unknown).allow, false)
  assert.equal(fenceAnswer(MEDIA, { frames: filmChain(A, `snippfilm://${B}/`), referrer: '' }).allow, false)
  // Other schemes are not this fence's.
  assert.equal(fenceAnswer('file:///C:/x', film).allow, true)
})

test('the handlers serve only what the filter stamped (a worker\'s request never passed it)', () => {
  assert.equal(admitted('GET', 's3cret', 's3cret'), true)
  assert.equal(admitted('GET', null, 's3cret'), false)
  assert.equal(admitted('GET', 'guess', 's3cret'), false)
  assert.equal(admitted('GET', '', ''), false)
  assert.equal(admitted('OPTIONS', null, 's3cret'), true)
})

test('every answer of a film folder carries the policy; a project kept there is not served', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'snipp-fence-'))
  try {
    mkdirSync(path.join(dir, 'snipp'))
    writeFileSync(path.join(dir, 'index.html'), '<!doctype html><title>t</title>')
    writeFileSync(path.join(dir, 'w.js'), 'onmessage = () => {}')
    writeFileSync(path.join(dir, 'x.svg'), '<svg xmlns="http://www.w3.org/2000/svg"/>')
    writeFileSync(path.join(dir, 'snipp', 'f.snipp'), '{"assets":[{"path":"C:\\\\secret.mp4"}]}')
    writeFileSync(path.join(dir, 'old.autocut'), '{}')
    writeFileSync(path.join(dir, 'a.snipp'), '{}')
    const reg = new FilmRegistry()
    const id = reg.idFor(dir)
    const get = (p: string) => serveFilm(reg, new Request(`snippfilm://${id}${p}`))
    for (const p of ['/index.html', '/w.js', '/x.svg', '/nope.txt', '/__snipp/guard.js', '/__snipp/host.html', '/__snipp/nothing', '/snipp/f.snipp']) {
      const r = await get(p)
      assert.equal(r.headers.get('content-security-policy'), FILM_CSP, p)
    }
    for (const p of ['/snipp/f.snipp', '/a.snipp', '/old.autocut', '/SNIPP/F.SNIPP', '/snipp/', '/snipp/other.json']) assert.equal((await get(p)).status, 403, p)
    assert.equal((await get('/w.js')).status, 200)
    assert.equal(notForFilm('snipp\\f.snipp'), true)
    assert.equal(notForFilm('src\\snippets.js'), false)
    assert.equal(notForFilm('data/x.tmp'), true)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('a film\'s refused addresses are kept for its "blocked" list, bounded', () => {
  const reg = new FilmRegistry()
  for (let i = 0; i < 60; i++) reg.noteBlocked(A, MEDIA + i)
  reg.noteBlocked(A, MEDIA + 0)
  reg.noteBlocked('not-a-film', MEDIA)
  assert.equal(reg.blocked(A).length, 50)
  assert.equal(reg.blocked(A)[0], MEDIA + 0)
  assert.deepEqual(reg.blocked(B), [])
})
