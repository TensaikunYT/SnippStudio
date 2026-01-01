// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// The picture the effect reference frames are drawn from ("cila" part D):
// written pixel by pixel here (no download, no ffmpeg), so what is in it is
// known exactly. 1280 x 720:
//   left    a green screen, unevenly lit, with a shadow band, and a "person"
//           on it: skin above, a white shirt below with green spilled on its
//           sides, soft edges (the keyer, the despill);
//   middle  a grey ramp, the hues, and a smooth two-way gradient (a LUT's
//           bands, the colour dials, colour isolate);
//   right   a dark wall with small very bright lights, and a red, a blue and
//           a green block (glow, halation, colour isolate, mosaic).
//   node make-fx-media.mjs <mediaDir>
import { deflateSync } from 'node:zlib'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

const W = 1280
const H = 720

const mix = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t)
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v)
function hue(h) {
  const f = (n) => {
    const k = (n + h * 6) % 6
    return 0.9 * (1 - Math.max(0, Math.min(k, 4 - k, 1)))
  }
  return [f(5) * 255, f(3) * 255, f(1) * 255]
}

function pixel(x, y) {
  if (x < 480) {
    // The screen: brighter in the middle, a shadow band low down.
    const lit = 0.72 + 0.28 * Math.cos(((x - 240) / 480) * Math.PI) * Math.cos(((y - 360) / 720) * Math.PI)
    const shade = y >= 500 && y < 560 ? 0.6 : 1
    const screen = [25 * lit * shade, 200 * lit * shade, 50 * lit * shade]
    // The person: skin above 360, a white shirt below, green on its sides.
    const dx = Math.min(x - 140, 340 - x)
    const dy = Math.min(y - 160, 620 - y)
    const inside = Math.min(dx, dy)
    if (inside <= -6) return screen
    let body = y < 360 ? [224, 172, 140] : [235, 240, 235]
    if (y >= 360 && dx < 24) body = mix(body, [120, 230, 130], 0.35 * (1 - Math.max(0, dx) / 24))
    return inside >= 0 ? body : mix(screen, body, (inside + 6) / 6)
  }
  if (x < 880) {
    const u = (x - 480) / 399
    if (y < 240) return [u * 255, u * 255, u * 255]
    if (y < 480) return hue(u)
    return [40 + u * 200, 128, 40 + ((y - 480) / 239) * 200]
  }
  // The wall and its lights.
  const inBox = (x0, y0, w, h) => x >= x0 && x < x0 + w && y >= y0 && y < y0 + h
  if (inBox(960, 120, 40, 40)) return [255, 255, 255]
  if (inBox(1100, 80, 12, 200)) return [255, 240, 200]
  if (y >= 340 && y < 400 && (x - 900) % 40 < 6 && (y - 340) % 20 < 6) return [255, 255, 255]
  if (inBox(920, 460, 120, 120)) return [220, 30, 30]
  if (inBox(1080, 460, 120, 120)) return [40, 70, 220]
  if (inBox(920, 600, 280, 80)) return [40, 190, 70]
  return [18, 20, 28]
}

const crcTable = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c >>> 0
  }
  return t
})()
function crc(buf) {
  let c = 0xffffffff
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}
function chunk(type, data) {
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const out = Buffer.alloc(8 + data.length + 4)
  out.writeUInt32BE(data.length, 0)
  body.copy(out, 4)
  out.writeUInt32BE(crc(body), 8 + data.length)
  return out
}

/** The picture as PNG bytes (8-bit RGB). */
export function fxPng() {
  const raw = Buffer.alloc((W * 3 + 1) * H)
  for (let y = 0; y < H; y++) {
    const row = y * (W * 3 + 1)
    raw[row] = 0
    for (let x = 0; x < W; x++) {
      const c = pixel(x, y)
      for (let i = 0; i < 3; i++) raw[row + 1 + x * 3 + i] = Math.round(clamp01(c[i] / 255) * 255)
    }
  }
  const head = Buffer.alloc(13)
  head.writeUInt32BE(W, 0)
  head.writeUInt32BE(H, 4)
  head[8] = 8
  head[9] = 2
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', head), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))])
}

/** Writes fx.png into `dir`; returns its path. */
export function makeFxMedia(dir) {
  mkdirSync(dir, { recursive: true })
  const file = join(dir, 'fx.png')
  writeFileSync(file, fxPng())
  return file
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) console.log('written', makeFxMedia(process.argv[2] ?? 'media'))
