// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// The icon set (SnippStudio phase 3a.4): Lucide shapes copied into the code,
// no icon package at run time, the names listed in TASARIM.md, one Icon component.
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import test from 'node:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { ICONS, ICON_SOURCE, type IconName } from '../renderer/src/ui/icons/lucide'
import { Icon, iconStroke } from '../renderer/src/ui/Icon'

const APP = join(__dirname, '..', '..')
const names = Object.keys(ICONS) as IconName[]

test('the set: about seventy and more icons, each a list of SVG shapes', () => {
  assert.ok(names.length >= 70, `${names.length} icons`)
  const shapes = new Set(['path', 'circle', 'rect', 'line', 'polyline', 'polygon', 'ellipse'])
  for (const n of names) {
    assert.ok(ICONS[n].length > 0, n)
    for (const [tag, attrs] of ICONS[n]) {
      assert.ok(shapes.has(tag), `${n}: <${tag}>`)
      for (const v of Object.values(attrs)) assert.ok(!/[<>"]|javascript:|url\(/i.test(v), `${n}: a plain value`)
    }
  }
  assert.equal(ICON_SOURCE.license, 'ISC')
})

test('no icon package at run time: lucide-static is a dev dependency only and nothing in src imports it', () => {
  const pkg = JSON.parse(readFileSync(join(APP, 'package.json'), 'utf8'))
  assert.ok(pkg.devDependencies['lucide-static'], 'a dev dependency')
  assert.equal(pkg.dependencies['lucide-static'], undefined)
  assert.equal(pkg.dependencies['lucide-react'], undefined)
  const src = readFileSync(join(APP, 'src', 'renderer', 'src', 'ui', 'Icon.tsx'), 'utf8') + readFileSync(join(APP, 'src', 'renderer', 'src', 'ui', 'icons', 'lucide.ts'), 'utf8')
  assert.equal(/from ['"]lucide/.test(src), false)
  // The licence is in the notices.
  const notices = readFileSync(join(APP, 'THIRD-PARTY-NOTICES.md'), 'utf8')
  assert.match(notices, /Lucide/)
  assert.match(notices, /ISC/)
})

test('the names in TASARIM.md are exactly the names in the code', { skip: !existsSync(join(APP, '..', 'tasarim', 'TASARIM.md')) && 'TASARIM.md is not beside the repository' }, () => {
  const md = readFileSync(join(APP, '..', 'tasarim', 'TASARIM.md'), 'utf8')
  const part = md.slice(md.indexOf('## Simge takımı'))
  const listed = [...part.matchAll(/^\|\s*`([a-z0-9-]+)`\s*\|/gm)].map((m) => m[1])
  assert.deepEqual([...listed].sort(), [...names].sort())
  assert.equal(new Set(listed).size, listed.length, 'each name once')
})

test('Icon: 24-unit box, the text colour, stroke 2 (1.75 under 16 px), decorative unless labelled', () => {
  const html = renderToStaticMarkup(createElement(Icon, { name: 'scissors', testid: 't.icon' }))
  assert.match(html, /^<svg class="ui-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"/)
  assert.match(html, /aria-hidden="true"/)
  assert.match(html, /data-testid="t.icon"/)
  assert.equal((html.match(/<(circle|path)/g) ?? []).length, ICONS.scissors.length)
  const small = renderToStaticMarkup(createElement(Icon, { name: 'x', size: 14 }))
  assert.match(small, /stroke-width="1.75"/)
  assert.equal(iconStroke(16), 2)
  const named = renderToStaticMarkup(createElement(Icon, { name: 'bot', label: 'Agent' }))
  assert.match(named, /role="img"/)
  assert.match(named, /aria-label="Agent"/)
  assert.equal(/aria-hidden/.test(named), false)
})
