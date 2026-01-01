// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// The package configuration (SnippStudio phase 9a, decisions 2, 4, 5 and 7):
// one file, electron-builder.config.cjs, with the fuses; no unused native
// module packaged; the one speech model; .snipp files; complete icons. The
// built package itself is checked by scripts/package/check.mjs.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import test from 'node:test'
import { APP_ID, PRODUCT_NAME } from '../shared/product'

const ROOT = join(__dirname, '..', '..')
// eslint-disable-next-line @typescript-eslint/no-require-imports
const cfg = require(join(ROOT, 'electron-builder.config.cjs')) as Record<string, any>

test('one configuration, named from the product module, with the fuses', () => {
  assert.equal(cfg.productName, PRODUCT_NAME)
  assert.equal(cfg.appId, APP_ID)
  assert.deepEqual(cfg.electronFuses, {
    runAsNode: false,
    enableNodeOptionsEnvironmentVariable: false,
    enableNodeCliInspectArguments: false,
    enableEmbeddedAsarIntegrityValidation: true,
    onlyLoadAppFromAsar: true
  })
  assert.equal(cfg.npmRebuild, false)
  const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'))
  assert.equal(pkg.build, undefined, 'no second configuration in package.json')
  assert.match(pkg.scripts.dist, /scripts\/package\/dist\.mjs/)
  assert.match(pkg.scripts['dist:dir'], /scripts\/package\/dist\.mjs --dir/)
})

test('files: the app alone; no production module (no node-pty since TERMINAL-YOK-PLAN.md, no onnxruntime-node, sharp)', () => {
  const files: string[] = cfg.files
  assert.ok(files.includes('out/**'))
  assert.ok(files.includes('!node_modules/**'), 'node_modules left out')
  assert.deepEqual(files.filter((f) => f.startsWith('node_modules/')), [])
  assert.ok(!files.some((f) => /onnxruntime|sharp|@img|huggingface/.test(f) && !f.startsWith('!')))
  assert.equal(cfg.asarUnpack, undefined)
})

test('the one speech model, three.js and the code templates beside the app', () => {
  const extra: { from: string; to: string; filter?: string[] }[] = cfg.extraResources
  const models = extra.find((e) => e.to === 'models')
  assert.equal(models?.from, 'models-dist', 'the package folder of the model, never models/ (which holds the English set too)')
  assert.ok(models?.filter?.includes('!README.md'))
  assert.ok(extra.some((e) => e.from === 'vendor/three' && e.to === 'three'))
  assert.ok(extra.some((e) => e.from === 'resources/kod-sablonlari' && e.to === 'kod-sablonlari'))
})

test('Windows: the NSIS installer; .snipp files open in the app', () => {
  assert.deepEqual(cfg.win.target, ['nsis'])
  assert.equal(cfg.win.icon, 'build/icon.ico')
  assert.equal(cfg.fileAssociations.length, 1)
  assert.equal(cfg.fileAssociations[0].ext, 'snipp')
  assert.equal(cfg.fileAssociations[0].icon, 'build/snipp-file.ico')
  assert.equal(cfg.nsis.shortcutName, PRODUCT_NAME)
  assert.equal(cfg.nsis.oneClick, false)
})

/** The sizes of an .ico's images. */
function icoSizes(file: string): number[] {
  const b = readFileSync(file)
  assert.equal(b.readUInt16LE(2), 1, `${file} is an icon`)
  const out: number[] = []
  for (let i = 0; i < b.readUInt16LE(4); i++) out.push(b[6 + i * 16] || 256)
  return out.sort((x, y) => x - y)
}

test('the icons have every Windows size (decision 4: the old images kept, the missing ones added)', () => {
  for (const f of ['icon.ico', 'snipp-file.ico']) assert.deepEqual(icoSizes(join(ROOT, 'build', f)), [16, 20, 24, 32, 40, 48, 64, 128, 256], f)
})
