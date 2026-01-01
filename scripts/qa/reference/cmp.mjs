// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// node cmp.mjs a.json b.json [aPngDir bPngDir] [skipRegex]
// Same hash: identical. A different one: the pixels that differ are counted
// (ffmpeg decodes both PNGs); the frames known to wobble a few pixels from run
// to run before any change (FLAKY) are reported apart.
import { readFileSync, existsSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { join } from 'node:path'
const [a, b] = [2, 3].map((i) => JSON.parse(readFileSync(process.argv[i], 'utf8')))
const [da, db] = [process.argv[4], process.argv[5]]
const skip = process.argv[6] ? new RegExp(process.argv[6]) : null
// tpl-stat 3.8 and 5.6: seen wobbling by 1 px (step 1) in SnippStudio phase 2A.5, gone on a rerun of the same build.
const FLAKY = new Set(['tpl-ranking|exportFramePng|3.2', 'tpl-stat|exportFramePng|1.7', 'tpl-stat|exportFramePng|3.8', 'tpl-stat|exportFramePng|5.6', 'tpl-outro|exportFramePng|1.25', 'tpl-compare|exportFramePng|1.95', 'tpl-compare|exportFramePng|4.4', 'tpl-compare|exportFramePng|6.5',
  // These two match when drawn alone and differ by a few pixels after the
  // whole run before them (an order effect, not a change; both kinds left
  // the product in phase 1b).
  'tpl-intro|exportFramePng|3.98', 'tpl-outro|exportFramePng|2.72'])
const key = (r) => `${r.project}|${r.path}|${r.t}`
const B = new Map(b.map((r) => [key(r), r]))
const raw = (f) => execFileSync('ffmpeg', ['-v', 'error', '-i', f, '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], { maxBuffer: 1 << 28 })
const pixels = (r) => {
  const name = `${r.project}-${r.path}-${r.t.toFixed(2)}.png`
  const fa = join(da, name), fb = join(db, name)
  if (!da || !existsSync(fa) || !existsSync(fb)) return null
  const x = raw(fa), y = raw(fb)
  if (x.length !== y.length) return Infinity
  let n = 0, max = 0
  for (let i = 0; i < x.length; i += 3) {
    const d = Math.max(Math.abs(x[i] - y[i]), Math.abs(x[i + 1] - y[i + 1]), Math.abs(x[i + 2] - y[i + 2]))
    if (d) { n++; if (d > max) max = d }
  }
  return `${n} px (max step ${max})`
}
let same = 0, flaky = 0, diff = 0, missing = 0, skipped = 0
for (const r of a) {
  if (skip && skip.test(r.project)) { skipped++; continue }
  const o = B.get(key(r))
  if (!o) { missing++; console.log('MISSING', key(r)); continue }
  if (o.sha256 === r.sha256) { same++; continue }
  const px = r.path === 'wav' ? 'sound' : pixels(r)
  if (FLAKY.has(key(r))) { flaky++; console.log('flaky (known before any change)', key(r), px) }
  else { diff++; console.log('DIFF', key(r), px) }
}
console.log(`identical ${same}, known-flaky differing ${flaky}, DIFFERENT ${diff}, missing ${missing}, skipped ${skipped}`)
process.exit(diff || missing ? 1 : 0)
