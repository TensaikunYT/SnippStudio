// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// The macOS and Linux icons (phase 10b.5, FAZ10-PLAN.md). macOS wants an
// .icns of at least 512 px, Linux one PNG it scales. The repository's largest
// image is build/icon.png at 256 px (no vector source, no 1024 px master: the
// user's to draw, SERIT-B-PLAN.md B1 decision 9), so the 512 and 1024 px
// images here are that 256 px image ENLARGED (lanczos3): good enough to build
// with, softer than a real master. When a 1024 px master arrives, put it at
// build/icon-master.png and run this again: everything is then made from it
// (never from build/icon-1024.png, which this script writes).
//
//   node scripts/package/icons-posix.mjs [--check]
//     writes build/icon.icns, build/snipp-file.icns, build/icon-1024.png
//     --check: exit 1 if one is missing or does not hold its sizes
//
// An .icns is a list of typed PNG images (ic07 128, ic08 256, ic09 512,
// ic10 1024): written here byte by byte, no macOS tool needed.
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

const APP = fileURLToPath(new URL('../..', import.meta.url))
export const ICNS_TYPES = [
  ['ic07', 128],
  ['ic08', 256],
  ['ic09', 512],
  ['ic10', 1024]
]
/** What is made, from what. */
export const POSIX_ICONS = [
  { src: ['build/icon-master.png', 'build/icon.png'], icns: 'build/icon.icns', png: 'build/icon-1024.png' },
  { src: ['build/snipp-file.png'], icns: 'build/snipp-file.icns' }
]

/** An .icns from [type, png bytes] pairs. */
export function writeIcns(images) {
  const parts = images.map(([type, data]) => {
    const head = Buffer.alloc(8)
    head.write(type, 0, 'ascii')
    head.writeUInt32BE(8 + data.length, 4)
    return Buffer.concat([head, data])
  })
  const body = Buffer.concat(parts)
  const head = Buffer.alloc(8)
  head.write('icns', 0, 'ascii')
  head.writeUInt32BE(8 + body.length, 4)
  return Buffer.concat([head, body])
}

/** The images of an .icns: type and the PNG's width and height. */
export function readIcns(buf) {
  if (buf.toString('ascii', 0, 4) !== 'icns' || buf.readUInt32BE(4) !== buf.length) throw new Error('not an .icns')
  const out = []
  for (let at = 8; at < buf.length; ) {
    const type = buf.toString('ascii', at, at + 4)
    const len = buf.readUInt32BE(at + 4)
    const data = buf.subarray(at + 8, at + len)
    out.push({ type, ...pngSize(data) })
    at += len
  }
  return out
}

/** A PNG's width and height from its header. */
export function pngSize(buf) {
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error('not a PNG')
  return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) }
}

const sourceOf = (src) => src.map((s) => join(APP, s)).find((f) => existsSync(f))

async function main() {
  const check = process.argv.includes('--check')
  let bad = 0
  for (const icon of POSIX_ICONS) {
    const from = sourceOf(icon.src)
    const outs = [icon.icns, icon.png].filter(Boolean).map((o) => join(APP, o)).filter((o) => o !== from)
    if (check) {
      // (By content, not by date: a checkout gives files any date.)
      for (const o of outs) {
        let ok = false
        try {
          const buf = readFileSync(o)
          ok = o.endsWith('.icns') ? readIcns(buf).map((x) => `${x.type}:${x.w}`).join(' ') === ICNS_TYPES.map(([t, s]) => `${t}:${s}`).join(' ') : pngSize(buf).w >= 1024
        } catch {
          ok = false
        }
        if (!ok) { console.error(`${o}: missing or without its sizes`); bad++ }
      }
      continue
    }
    // sharp is installed with transformers.js (build time only, never packaged).
    const sharp = createRequire(import.meta.url)('sharp')
    const master = readFileSync(from)
    const size = async (s) => (pngSize(master).w === s ? master : sharp(master).resize(s, s, { kernel: 'lanczos3' }).png({ compressionLevel: 9 }).toBuffer())
    const images = []
    for (const [type, s] of ICNS_TYPES) images.push([type, await size(s)])
    writeFileSync(join(APP, icon.icns), writeIcns(images))
    if (icon.png && join(APP, icon.png) !== from) writeFileSync(join(APP, icon.png), await size(1024))
    console.log(`${icon.icns}${icon.png ? ` and ${icon.png}` : ''}: from ${from} (${pngSize(master).w} px)`)
  }
  process.exit(bad ? 1 : 0)
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) await main()
