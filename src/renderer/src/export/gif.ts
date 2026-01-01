// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// An animated GIF, written here (KOLAY-PLAN.md, item 1). Neither mediabunny
// nor the browser's WebCodecs writes GIF, and no package for it ships with
// the app; the format is small and open (GIF89a: a palette of at most 256
// colours per frame, its pixels LZW-coded), so it is made here, without a
// new dependency. Each frame gets its own palette (median cut over a 5-bit
// per channel histogram), no dithering (the same frame gives the same bytes);
// a frame the same as the one before only lengthens that one. The file loops
// forever (the NETSCAPE2.0 block). Pure: no DOM, the tests run it as it is.

/** The GIF's own clock: frame delays are whole hundredths of a second. */
export const GIF_TICK = 100

/** The frame rates offered: at 30 or more a frame would last 3 cs or less,
 *  and browsers show a delay under 2 cs as 10 cs. */
export const GIF_RATES: readonly number[] = [10, 12, 15, 20, 25]
export const GIF_RATE_DEFAULT = 15
/** The widths offered (px), and the one chosen first. */
export const GIF_WIDTHS: readonly number[] = [240, 320, 480, 640, 800]
export const GIF_WIDTH_DEFAULT = 480
/** Beyond these the window says a GIF is long (seconds) or large (bytes). */
export const GIF_LONG_SEC = 15
export const GIF_LARGE_BYTES = 20 * 2 ** 20

/** The widths for a frame `baseW` wide: none wider than it (at least the
 *  smallest one). */
export function gifWidths(baseW: number): number[] {
  const ok = GIF_WIDTHS.filter((w) => w <= baseW)
  return ok.length ? ok : [GIF_WIDTHS[0]]
}

/** The GIF's size for a frame of `baseW` × `baseH` at width `w` (its height
 *  in proportion, even). */
export function gifSize(baseW: number, baseH: number, w: number): { w: number; h: number } {
  const width = Math.max(2, Math.round(w))
  return { w: width, h: Math.max(2, Math.round((width * baseH) / baseW / 2) * 2) }
}

/** Frame k's delay in hundredths of a second at `fps`, so the delays add up
 *  to the length: round(100·(k+1)/fps) − round(100·k/fps). */
export function gifDelay(k: number, fps: number): number {
  return Math.round((GIF_TICK * (k + 1)) / fps) - Math.round((GIF_TICK * k) / fps)
}

/** A rough size of the file (bytes), for the window: about a third of a byte
 *  a pixel a frame for moving pictures. */
export function gifEstimate(w: number, h: number, fps: number, seconds: number): number {
  return Math.round(w * h * Math.max(1, Math.round(seconds * fps)) * 0.35)
}

// ---- the palette -------------------------------------------------------------

interface Box {
  /** Indices into the histogram's used bins. */
  bins: Uint32Array
  count: number
}

/**
 * A palette of at most 256 colours for `rgba` and each pixel's index in it.
 * The colours are 5 bits a channel in the histogram; a box's colour is the
 * mean of the real colours in it, so a picture with few colours keeps them
 * exactly.
 */
export function quantize(rgba: Uint8Array | Uint8ClampedArray, pixels: number): { palette: Uint8Array; index: Uint8Array } {
  const count = new Uint32Array(32768)
  const sumR = new Float64Array(32768)
  const sumG = new Float64Array(32768)
  const sumB = new Float64Array(32768)
  const binOf = new Uint16Array(pixels)
  for (let i = 0, p = 0; i < pixels; i++, p += 4) {
    const r = rgba[p]
    const g = rgba[p + 1]
    const b = rgba[p + 2]
    const k = ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3)
    binOf[i] = k
    count[k]++
    sumR[k] += r
    sumG[k] += g
    sumB[k] += b
  }
  const used: number[] = []
  for (let k = 0; k < 32768; k++) if (count[k]) used.push(k)
  // The boxes: split the one with the most pixels that can still be split,
  // along its longest side, at its weighted median.
  const boxes: Box[] = [{ bins: Uint32Array.from(used), count: pixels }]
  const chan = (k: number, c: number): number => (c === 0 ? k >> 10 : c === 1 ? (k >> 5) & 31 : k & 31)
  while (boxes.length < 256) {
    let pick = -1
    for (let i = 0; i < boxes.length; i++) if (boxes[i].bins.length > 1 && (pick < 0 || boxes[i].count > boxes[pick].count)) pick = i
    if (pick < 0) break
    const box = boxes[pick]
    let best = 0
    let span = -1
    for (let c = 0; c < 3; c++) {
      let lo = 31
      let hi = 0
      for (const k of box.bins) {
        const v = chan(k, c)
        if (v < lo) lo = v
        if (v > hi) hi = v
      }
      if (hi - lo > span) {
        span = hi - lo
        best = c
      }
    }
    const sorted = Array.from(box.bins).sort((a, b) => chan(a, best) - chan(b, best) || a - b)
    let half = 0
    let cut = 1
    for (let i = 0; i < sorted.length - 1; i++) {
      half += count[sorted[i]]
      cut = i + 1
      if (half * 2 >= box.count) break
    }
    const a = Uint32Array.from(sorted.slice(0, cut))
    const b = Uint32Array.from(sorted.slice(cut))
    const sum = (bins: Uint32Array): number => bins.reduce((n, k) => n + count[k], 0)
    boxes.splice(pick, 1, { bins: a, count: sum(a) }, { bins: b, count: sum(b) })
  }
  const palette = new Uint8Array(256 * 3)
  const slot = new Uint8Array(32768)
  boxes.forEach((box, i) => {
    let r = 0
    let g = 0
    let b = 0
    for (const k of box.bins) {
      r += sumR[k]
      g += sumG[k]
      b += sumB[k]
      slot[k] = i
    }
    const n = Math.max(1, box.count)
    palette[i * 3] = Math.round(r / n)
    palette[i * 3 + 1] = Math.round(g / n)
    palette[i * 3 + 2] = Math.round(b / n)
  })
  const index = new Uint8Array(pixels)
  for (let i = 0; i < pixels; i++) index[i] = slot[binOf[i]]
  return { palette, index }
}

// ---- LZW ----------------------------------------------------------------------

/** Growing bytes. */
class Bytes {
  private buf = new Uint8Array(1 << 16)
  length = 0
  byte(b: number): void {
    if (this.length === this.buf.length) {
      const next = new Uint8Array(this.buf.length * 2)
      next.set(this.buf)
      this.buf = next
    }
    this.buf[this.length++] = b
  }
  bytes(list: ArrayLike<number>): void {
    for (let i = 0; i < list.length; i++) this.byte(list[i])
  }
  u16(v: number): void {
    this.byte(v & 255)
    this.byte((v >> 8) & 255)
  }
  text(s: string): void {
    for (let i = 0; i < s.length; i++) this.byte(s.charCodeAt(i))
  }
  done(): Uint8Array {
    return this.buf.slice(0, this.length)
  }
}

const MIN_CODE = 8
const CLEAR = 1 << MIN_CODE
const EOI = CLEAR + 1

/** The table of codes: (prefix code × 256 + next index) → code + 1 (0: none),
 *  and the slots used, to clear it quickly. */
const table = new Int32Array(4096 * 256)
const touched = new Int32Array(4096)

/** Pixel indices (8-bit) LZW-coded into sub-blocks of at most 255 bytes, the
 *  code size byte first and the empty block last. */
export function lzw(index: Uint8Array, out: Bytes): void {
  out.byte(MIN_CODE)
  let block = new Uint8Array(255)
  let blockLen = 0
  let cur = 0
  let bits = 0
  const put = (code: number, size: number): void => {
    cur |= code << bits
    bits += size
    while (bits >= 8) {
      block[blockLen++] = cur & 255
      cur >>>= 8
      bits -= 8
      if (blockLen === 255) {
        out.byte(255)
        out.bytes(block)
        block = new Uint8Array(255)
        blockLen = 0
      }
    }
  }
  let size = MIN_CODE + 1
  let next = EOI + 1
  let used = 0
  const reset = (): void => {
    for (let i = 0; i < used; i++) table[touched[i]] = 0
    used = 0
  }
  reset()
  put(CLEAR, size)
  if (index.length === 0) {
    put(EOI, size)
  } else {
    let prefix = index[0]
    for (let i = 1; i < index.length; i++) {
      const k = index[i]
      const key = prefix * 256 + k
      const code = table[key]
      if (code) {
        prefix = code - 1
        continue
      }
      put(prefix, size)
      if (next === 4096) {
        put(CLEAR, size)
        reset()
        next = EOI + 1
        size = MIN_CODE + 1
      } else {
        if (next >= 1 << size) size++
        table[key] = next + 1
        touched[used++] = key
        next++
      }
      prefix = k
    }
    put(prefix, size)
    put(EOI, size)
  }
  reset()
  if (bits > 0) put(0, 8 - bits)
  if (blockLen) {
    out.byte(blockLen)
    out.bytes(block.subarray(0, blockLen))
  }
  out.byte(0)
}

// ---- the file -------------------------------------------------------------------

/** A GIF made frame by frame: `add` each frame's RGBA pixels, then `finish`. */
export class GifWriter {
  private out = new Bytes()
  private held: { palette: Uint8Array; index: Uint8Array; delay: number; rgba: Uint32Array } | null = null
  /** Frames written (a repeat of the one before is not one). */
  frames = 0
  /** Hundredths of a second written so far. */
  ticks = 0

  constructor(readonly width: number, readonly height: number) {
    const o = this.out
    o.text('GIF89a')
    o.u16(width)
    o.u16(height)
    // No global palette; 8 bits a colour.
    o.byte(0x70)
    o.byte(0)
    o.byte(0)
    // Loop forever.
    o.byte(0x21)
    o.byte(0xff)
    o.byte(11)
    o.text('NETSCAPE2.0')
    o.byte(3)
    o.byte(1)
    o.u16(0)
    o.byte(0)
  }

  /** One frame, shown for `delay` hundredths of a second. */
  add(rgba: Uint8Array | Uint8ClampedArray, delay: number): void {
    const px = this.width * this.height
    if (rgba.length < px * 4) throw new Error('A GIF frame has fewer pixels than the picture.')
    const words = new Uint32Array(rgba.buffer.slice(rgba.byteOffset, rgba.byteOffset + px * 4))
    const h = this.held
    if (h && h.rgba.length === words.length && same(h.rgba, words)) {
      h.delay += delay
      return
    }
    this.flush()
    const { palette, index } = quantize(rgba, px)
    this.held = { palette, index, delay, rgba: words }
  }

  private flush(): void {
    const h = this.held
    if (!h) return
    this.held = null
    const o = this.out
    let delay = h.delay
    // (A delay past 655.35 s is written as frames of the longest delay.)
    while (delay > 0) {
      const d = Math.min(65535, delay)
      delay -= d
      // Graphic control: kept on screen under the next (disposal 1), no transparency.
      o.byte(0x21)
      o.byte(0xf9)
      o.byte(4)
      o.byte(0x04)
      o.u16(d)
      o.byte(0)
      o.byte(0)
      // The image, its own 256-colour palette.
      o.byte(0x2c)
      o.u16(0)
      o.u16(0)
      o.u16(this.width)
      o.u16(this.height)
      o.byte(0x80 | 7)
      o.bytes(h.palette)
      lzw(h.index, o)
      this.frames++
      this.ticks += d
    }
  }

  finish(): Uint8Array {
    this.flush()
    this.out.byte(0x3b)
    return this.out.done()
  }
}

function same(a: Uint32Array, b: Uint32Array): boolean {
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false
  return true
}
