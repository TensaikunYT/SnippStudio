// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// The Windows icons (SnippStudio phase 9a, decision 4): build/icon.ico and
// build/snipp-file.ico keep every image they have, byte for byte; the sizes
// Windows asks for that are missing are added, made from the largest image
// (each .ico's 256 px one, which is also build/*.png). No new icon is drawn:
// a new design, and a 1024 px master for macOS, are the user's (SERIT-B-PLAN.md).
//
//   node scripts/package/icons.mjs [--check]   --check: exit 1 if a size is missing
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

const APP = fileURLToPath(new URL('../..', import.meta.url))
/** Windows' icon sizes: 100 % to 250 % of the small (16) and large (32) icons,
 *  the tiles and Explorer's views. */
export const ICO_SIZES = [16, 20, 24, 32, 40, 48, 64, 128, 256]
export const ICONS = ['build/icon.ico', 'build/snipp-file.ico']

/** The images of an .ico: size and bytes (PNG or BMP data as stored). */
export function readIco(buf) {
  if (buf.readUInt16LE(0) !== 0 || buf.readUInt16LE(2) !== 1) throw new Error('not an .ico')
  const n = buf.readUInt16LE(4)
  const out = []
  for (let i = 0; i < n; i++) {
    const o = 6 + i * 16
    const w = buf[o] || 256
    const h = buf[o + 1] || 256
    const size = buf.readUInt32LE(o + 8)
    const at = buf.readUInt32LE(o + 12)
    out.push({ w, h, bpp: buf.readUInt16LE(o + 6), data: buf.subarray(at, at + size) })
  }
  return out
}

/** An .ico from PNG images, smallest first. */
export function writeIco(images) {
  const list = [...images].sort((a, b) => a.w - b.w)
  const head = Buffer.alloc(6 + 16 * list.length)
  head.writeUInt16LE(0, 0)
  head.writeUInt16LE(1, 2)
  head.writeUInt16LE(list.length, 4)
  let at = head.length
  list.forEach((im, i) => {
    const o = 6 + i * 16
    head[o] = im.w >= 256 ? 0 : im.w
    head[o + 1] = im.h >= 256 ? 0 : im.h
    head[o + 2] = 0
    head[o + 3] = 0
    head.writeUInt16LE(1, o + 4)
    head.writeUInt16LE(im.bpp || 32, o + 6)
    head.writeUInt32LE(im.data.length, o + 8)
    head.writeUInt32LE(at, o + 12)
    at += im.data.length
  })
  return Buffer.concat([head, ...list.map((im) => im.data)])
}

export const missingSizes = (images) => ICO_SIZES.filter((s) => !images.some((im) => im.w === s && im.h === s))

async function main() {
  const check = process.argv.includes('--check')
  let bad = 0
  for (const rel of ICONS) {
    const file = join(APP, rel)
    const images = readIco(readFileSync(file))
    const missing = missingSizes(images)
    if (!missing.length) { console.log(`${rel}: ${images.map((i) => i.w).join(', ')} (complete)`); continue }
    if (check) { console.error(`${rel}: missing ${missing.join(', ')}`); bad++; continue }
    const master = images.reduce((a, b) => (b.w > a.w ? b : a))
    // sharp is installed with transformers.js (never packaged: it is only
    // used here, at build time).
    const sharp = createRequire(import.meta.url)('sharp')
    const added = []
    for (const s of missing) {
      const data = await sharp(Buffer.from(master.data)).resize(s, s, { kernel: 'lanczos3' }).png({ compressionLevel: 9 }).toBuffer()
      added.push({ w: s, h: s, bpp: 32, data })
    }
    writeFileSync(file, writeIco([...images, ...added]))
    console.log(`${rel}: added ${missing.join(', ')} from its ${master.w} px image`)
  }
  process.exit(bad ? 1 : 0)
}

if (process.argv[1] && fileURLToPath(import.meta.url).toLowerCase() === process.argv[1].toLowerCase()) await main()
