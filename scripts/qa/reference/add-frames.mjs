// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// node add-frames.mjs <frames.json> <pngDir> [referenceDir]
// Adds NEW reference frames to the baseline (referenceDir\baseline.json and
// referenceDir\baseline\, default <SnippStudio>\testdata\referans): the
// entries of <frames.json> (written by refs.mjs, with ONLY=<the new
// projects>) whose project | path | time the baseline does not hold yet, and
// their PNGs. A frame the baseline already holds is never changed: it is
// reported and left as it is.
//
// For a part that adds projects to refs.mjs on a branch of its own: its
// frames are kept beside the baseline until the branch is merged (a baseline
// holding frames the tree does not draw fails every other run with MISSING),
// then added with this.
import { copyFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const [framesJson, pngDir, refDir = join(fileURLToPath(new URL('../../..', import.meta.url)), '..', 'testdata', 'referans')] = process.argv.slice(2)
if (!framesJson || !pngDir) {
  console.error('usage: node add-frames.mjs <frames.json> <pngDir> [referenceDir]')
  process.exit(2)
}
const key = (r) => `${r.project}|${r.path}|${r.t}`
const file = join(refDir, 'baseline.json')
const base = JSON.parse(readFileSync(file, 'utf8'))
const have = new Map(base.map((r) => [key(r), r]))
const frames = JSON.parse(readFileSync(framesJson, 'utf8'))
const add = []
let same = 0
let other = 0
for (const r of frames) {
  const old = have.get(key(r))
  if (old) {
    if (old.sha256 === r.sha256) same++
    else {
      other++
      console.log('ALREADY THERE, DIFFERENT (left as it is):', key(r))
    }
    continue
  }
  const png = `${r.project}-${r.path}-${r.t.toFixed(2)}.png`
  if (r.path !== 'wav' && !existsSync(join(pngDir, png))) {
    console.error('no PNG for', key(r), 'in', pngDir)
    process.exit(1)
  }
  add.push(r)
}
for (const r of add) {
  const png = `${r.project}-${r.path}-${r.t.toFixed(2)}.png`
  if (r.path !== 'wav') copyFileSync(join(pngDir, png), join(refDir, 'baseline', png))
}
writeFileSync(file, JSON.stringify([...base, ...add], null, 1))
console.log(`baseline ${base.length} → ${base.length + add.length} frames (${add.length} added, ${same} already there and the same, ${other} already there and different)`)
process.exit(other ? 1 : 0)
