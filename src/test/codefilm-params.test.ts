// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// Phase 5f, decisions 2–3: a code page's parameters and the project look
// (renderer/src/media/codefilm-params.ts), and their commands.
import './dom-stub'
import assert from 'node:assert/strict'
import test from 'node:test'
import { clampParamDefs, cleanLook, cleanValues, coerceParam, lookFact, readValuesQuery, valuesQuery } from '../renderer/src/media/codefilm-params'
import { setCodeParams, setProjectLook } from '../renderer/src/commands/codefilm'
import { defaultEnv } from '../renderer/src/commands/core'
import { defaultProject, type Asset } from '../renderer/src/types'

test('values of each type, and what a page said, bounded', () => {
  assert.equal(coerceParam('number', '12.5'), 12.5)
  assert.equal(coerceParam('number', 'x'), null)
  assert.equal(coerceParam('number', Infinity), null)
  assert.equal(coerceParam('color', '#abc'), '#abc')
  assert.equal(coerceParam('color', ''), '')
  assert.equal(coerceParam('color', 'red'), null)
  assert.equal(coerceParam('text', 'x'.repeat(3000))?.toString().length, 2000)
  const defs = clampParamDefs([
    { key: 'a', label: 'A', type: 'text', value: 'hi' },
    { key: 'a', label: 'again', type: 'text', value: 'x' },
    { key: 'n', type: 'number', value: 3, min: 5, max: 1, step: -1 },
    { key: 'bad key', type: 'text', value: 'x' },
    { key: 'c', type: 'color', value: 'blue' },
    { key: 'k', type: 'select', value: 'x' },
    null
  ])
  assert.deepEqual(defs, [{ key: 'a', label: 'A', type: 'text', value: 'hi' }, { key: 'n', label: 'n', type: 'number', value: 3, min: 5 }])
  assert.equal(clampParamDefs('no'), null)
  assert.equal(clampParamDefs(Array.from({ length: 60 }, (_, i) => ({ key: 'k' + i, type: 'number', value: i })))!.length, 40)
  assert.deepEqual(cleanValues(defs!, { a: 'yo', n: '7', zz: 1 }), { a: 'yo', n: 7 })
})

test('the values reach the page in its address, and back; none: no part at all', () => {
  assert.equal(valuesQuery(undefined, undefined), '')
  assert.equal(valuesQuery({}, {}), '')
  const q = valuesQuery({ title: 'Çağrı “ok”', n: 2 }, { accent: '#ffcc00', font: 'Inter"; x' })
  assert.match(q, /^snp=[A-Za-z0-9_-]+$/)
  assert.deepEqual(readValuesQuery('snipp=1&' + q), { v: { title: 'Çağrı “ok”', n: 2 }, l: { accent: '#ffcc00', font: 'Inter x' } })
  assert.equal(readValuesQuery('snipp=1'), null)
})

test('the project look: only what is set; said to the agent as a fact only then', () => {
  assert.equal(cleanLook({}), null)
  assert.equal(cleanLook({ accent: 'red' }), null)
  assert.deepEqual(cleanLook({ accent: '#123456', font: '  Segoe UI  ' }), { accent: '#123456', font: 'Segoe UI' })
  assert.equal(lookFact(undefined), null)
  assert.equal(lookFact({ font: 'Inter' }), 'Project look (set by the user): font "Inter".')
})

test('the commands: values set, taken back, the look set and cleared', () => {
  const p = defaultProject()
  const film: Asset = { id: 'f', kind: 'code', name: 'f', path: 'C:/p/anim/f', url: 'snippfilm://0123456789abcdef/', size: 0, duration: 4, width: 1920, height: 1080, hasAudio: false, code: { fps: 60 } }
  p.assets.push(film)
  setCodeParams.apply(p, { assetId: 'f', values: { title: 'A', n: 3 } }, defaultEnv())
  assert.deepEqual(p.assets[0].code?.params, { title: 'A', n: 3 })
  setCodeParams.apply(p, { assetId: 'f', values: { title: null, n: 4 } }, defaultEnv())
  assert.deepEqual(p.assets[0].code?.params, { n: 4 })
  setCodeParams.apply(p, { assetId: 'f', values: { n: null } }, defaultEnv())
  assert.equal(p.assets[0].code?.params, undefined)
  assert.equal(p.assets[0].code?.fps, 60)
  assert.throws(() => setCodeParams.check!(p, { assetId: 'nope', values: {} }), /no code film/)
  setProjectLook.apply(p, { look: { accent: '#ff0000' } }, defaultEnv())
  setProjectLook.apply(p, { look: { font: 'Inter' } }, defaultEnv())
  assert.deepEqual(p.look, { accent: '#ff0000', font: 'Inter' })
  setProjectLook.apply(p, { look: { accent: null, font: '' } }, defaultEnv())
  assert.equal(p.look, undefined)
})

// ---- the code templates (decision 1) ---------------------------------------------
import { mkdtempSync, readFileSync, readdirSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { addCodeTemplate, CODE_TEMPLATE_IDS } from '../main/code-templates'
import { CODE_TEMPLATES } from '../renderer/src/media/code-templates'

const TEMPLATES = path.join(__dirname, '..', '..', 'resources', 'kod-sablonlari')

test('six templates, each one page with its settings block, a fast path and no network, chance or clock', () => {
  assert.deepEqual([...CODE_TEMPLATE_IDS], [...CODE_TEMPLATES])
  assert.deepEqual(readdirSync(TEMPLATES).sort(), [...CODE_TEMPLATE_IDS].sort())
  for (const id of CODE_TEMPLATE_IDS) {
    const html = readFileSync(path.join(TEMPLATES, id, 'index.html'), 'utf8')
    assert.equal((html.match(/window\.__params = \[/g) ?? []).length, 1, id)
    assert.match(html, /window\.renderOut = draw/, id)
    assert.match(html, /window\.READY = true/, id)
    assert.match(html, /transparent: true/, id)
    assert.doesNotMatch(html, /Math\.random|Date\.now|new Date|performance\.now|https?:\/\/|fetch\(|import /, id)
  }
})

test('a template added is copied beside the saved project, never over a folder', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'snipp-tpl-'))
  const proj = path.join(dir, 'p.snipp')
  await assert.rejects(addCodeTemplate(TEMPLATES, proj, 'counter'), /save the project first/)
  writeFileSync(proj, '{}')
  await assert.rejects(addCodeTemplate(TEMPLATES, proj, '../x'), /unknown template/)
  const a = await addCodeTemplate(TEMPLATES, proj, 'counter')
  assert.equal(a.folder, path.join(dir, 'anim', 'counter'))
  assert.equal(readFileSync(path.join(a.folder, 'index.html'), 'utf8'), readFileSync(path.join(TEMPLATES, 'counter', 'index.html'), 'utf8'))
  writeFileSync(path.join(a.folder, 'index.html'), 'mine')
  const b = await addCodeTemplate(TEMPLATES, proj, 'counter')
  assert.equal(b.folder, path.join(dir, 'anim', 'counter-2'))
  assert.equal(readFileSync(path.join(a.folder, 'index.html'), 'utf8'), 'mine')
  assert.ok(existsSync(path.join(b.folder, 'index.html')))
})
