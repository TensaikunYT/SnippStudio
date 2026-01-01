// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// The pixel pass as plain arithmetic (SnippStudio "cila" part D): what the
// shader (playback/fxgl.ts) computes, written once more for the CPU, with no
// DOM in it so the tests can run it. Every formula here has its twin in the
// shader, in the same order; a change to one is a change to both
// (src/test/cila-d-fx.test.ts holds the numbers, e2e 96 compares the two
// paths' pictures).
//
// Order of the pass: mosaic (the source itself) → key alpha (from the source)
// → despill (the source, new keyer only) → aberration → sharpen → colour
// (exposure, tint, highlights, shadows) → duotone → LUT (mixed by its amount)
// → colour isolate → vignette → grain → whole look → glow → halation.

export interface LutTable {
  n: number
  /** n³ RGB triples, red fastest (the .cube order), 0..1. */
  data: Float32Array
}

export interface FxParams {
  /** `mode` 0: the first keyer (RGB distance; projects made before part D).
   *  1: the chroma keyer (distance on the CbCr plane, despill). `sim` and
   *  `smooth` are in the mode's own units (0: 0..255·√3; 1: CbCr). */
  chroma: { key: [number, number, number]; sim: number; smooth: number; mode?: 0 | 1; spill?: number } | null
  lut: (LutTable & { id: string }) | null
  /** How much of the LUT is mixed in, 0..1 (unset: all of it). */
  lutAmount?: number
  /** Exposure in stops, tint (+ magenta, − green), highlights, shadows (−1..1). */
  grade?: { exposure: number; tint: number; highlights: number; shadows: number } | null
  duotone: { dark: [number, number, number]; light: [number, number, number] } | null
  sharpen: number
  vignette: number
  grain: number
  /** Chromatic aberration offset, in output pixels. */
  cab: number
  time: number
  /** Whole-look index — see VIDEO_FX_INDEX. 0 is none. */
  fx?: number
  fxAmount?: number
  /** Mosaic cell, in pixels of the pass (under 1.5: off). */
  mosaic?: number
  /** Keep one hue, the rest towards black and white. */
  isolate?: { key: [number, number, number]; range: number; amount: number } | null
  /** Glow: the bright parts, blurred and laid back on. `radius` in pixels of the pass. */
  bloom?: { amount: number; threshold: number; radius: number } | null
  /** Halation: a warm red halo around the highlights. `radius` in pixels of the pass. */
  halation?: { amount: number; radius: number } | null
}

/** The shader switches on a number; this is the one place that mapping lives,
 *  so the CPU fallback and the GPU path cannot drift apart. */
export const VIDEO_FX_INDEX: Record<string, number> = {
  // 1 was a static-noise look, removed. The numbers below are left where
  // they are: they only have to agree with the shader, and renumbering buys
  // nothing but a chance for the two to drift apart.
  none: 0,
  crt: 2,
  vhs: 3,
  halftone: 4,
  posterize: 5
}

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v)
const smooth = (a: number, b: number, x: number): number => {
  const t = clamp01((x - a) / (b - a))
  return t * t * (3 - 2 * t)
}

// ---- colour planes ----------------------------------------------------------
// BT.709 luma and its CbCr plane, on 0..1 colour, full range.
export const luma709 = (r: number, g: number, b: number): number => 0.2126 * r + 0.7152 * g + 0.0722 * b
export const CB_K = 0.5389
export const CR_K = 0.635
/** [cb, cr] of an RGB colour (0..1). */
export function cbcr(r: number, g: number, b: number): [number, number] {
  const y = luma709(r, g, b)
  return [(b - y) * CB_K, (r - y) * CR_K]
}

// ---- LUT -------------------------------------------------------------------------

/** The LUT's colour for (r, g, b) in 0..1, between its eight nearest entries
 *  (trilinear), written into `out`. */
export function lutTrilinear(lut: LutTable, r: number, g: number, b: number, out: Float32Array | number[]): void {
  const n = lut.n
  const d = lut.data
  const m = n - 1
  const qr = clamp01(r) * m
  const qg = clamp01(g) * m
  const qb = clamp01(b) * m
  const r0 = Math.min(n - 2, Math.floor(qr))
  const g0 = Math.min(n - 2, Math.floor(qg))
  const b0 = Math.min(n - 2, Math.floor(qb))
  const fr = qr - r0
  const fg = qg - g0
  const fb = qb - b0
  const i000 = ((b0 * n + g0) * n + r0) * 3
  const i010 = i000 + n * 3
  const i001 = i000 + n * n * 3
  const i011 = i001 + n * 3
  for (let c = 0; c < 3; c++) {
    const x00 = d[i000 + c] + (d[i000 + 3 + c] - d[i000 + c]) * fr
    const x10 = d[i010 + c] + (d[i010 + 3 + c] - d[i010 + c]) * fr
    const x01 = d[i001 + c] + (d[i001 + 3 + c] - d[i001 + c]) * fr
    const x11 = d[i011 + c] + (d[i011 + 3 + c] - d[i011 + c]) * fr
    const y0 = x00 + (x10 - x00) * fg
    const y1 = x01 + (x11 - x01) * fg
    out[c] = y0 + (y1 - y0) * fb
  }
}

// ---- the chroma keyer (mode 1) --------------------------------------------------

/** How much of a source pixel stays (0 gone, 1 kept): its distance from the
 *  key on the CbCr plane, `sim` and `soft` in that plane's units. */
export function keyAlpha(r: number, g: number, b: number, kcb: number, kcr: number, sim: number, soft: number): number {
  const y = luma709(r, g, b)
  const dcb = (b - y) * CB_K - kcb
  const dcr = (r - y) * CR_K - kcr
  return smooth(0, 1, (Math.sqrt(dcb * dcb + dcr * dcr) - sim) / soft)
}

/**
 * Takes the key colour's cast off a pixel (0..1 in, 0..1 out in `out`): its
 * chroma along the key's direction is held to what it has across it (hues
 * more than 45° from the key are untouched, pure spill turns neutral), by
 * `spill` of the way; its luma stays.
 */
export function despill(r: number, g: number, b: number, kx: number, ky: number, spill: number, out: Float32Array | number[]): void {
  const y = luma709(r, g, b)
  const cb = (b - y) * CB_K
  const cr = (r - y) * CR_K
  const along = cb * kx + cr * ky
  if (along <= 0) {
    out[0] = r
    out[1] = g
    out[2] = b
    return
  }
  const px = cb - along * kx
  const py = cr - along * ky
  const across = Math.sqrt(px * px + py * py)
  const kept = along + (Math.min(along, across) - along) * spill
  const cb2 = px + kept * kx
  const cr2 = py + kept * ky
  const r2 = y + cr2 / CR_K
  const b2 = y + cb2 / CB_K
  out[0] = r2
  out[1] = (y - 0.2126 * r2 - 0.0722 * b2) / 0.7152
  out[2] = b2
}

// ---- colour: exposure, tint, highlights, shadows -------------------------------

/** One colour (0..1 in and out, in `v`) through the four dials. */
export function gradeColor(v: Float32Array | number[], exposure: number, tint: number, highlights: number, shadows: number): void {
  let r = clamp01(v[0])
  let g = clamp01(v[1])
  let b = clamp01(v[2])
  if (exposure !== 0) {
    // In linear light, with a shoulder so that brighter does not clip hard:
    // above `t` the values up to what white became (`kp`) are folded into
    // t..1, leaving `t` at the slope they arrived with (no pixel ends darker
    // than it was, white stays white).
    const k = Math.pow(2, exposure)
    const kp = Math.pow(k, 1 / 2.2)
    r = Math.pow(Math.pow(r, 2.2) * k, 1 / 2.2)
    g = Math.pow(Math.pow(g, 2.2) * k, 1 / 2.2)
    b = Math.pow(Math.pow(b, 2.2) * k, 1 / 2.2)
    if (exposure > 0) {
      const t = 1 - 0.25 * Math.min(1, exposure)
      const p = (kp - t) / (1 - t)
      const fold = (x: number): number => (x > t ? t + (1 - t) * (1 - Math.pow(Math.max(0, 1 - Math.min(1, (x - t) / (kp - t))), p)) : x)
      r = fold(r)
      g = fold(g)
      b = fold(b)
    }
  }
  if (tint !== 0) {
    r *= 1 + 0.1 * tint
    g *= 1 - 0.2 * tint
    b *= 1 + 0.1 * tint
  }
  if (highlights !== 0 || shadows !== 0) {
    // A bump on the upper tones and one on the lower, each leaving black and
    // white where they are; the factors keep the tone curve rising.
    const l = clamp01(luma709(r, g, b))
    const hw = 4 * l * l * (1 - l)
    const sw = 4 * l * (1 - l) * (1 - l)
    const d = (highlights > 0 ? 0.24 : 0.5) * highlights * hw + (shadows > 0 ? 0.5 : 0.24) * shadows * sw
    const k = (l + d + 0.05) / (l + 0.05)
    r *= k
    g *= k
    b *= k
  }
  v[0] = r
  v[1] = g
  v[2] = b
}

/** True when the four dials leave a colour as it is. */
export const gradeIsNeutral = (g: { exposure: number; tint: number; highlights: number; shadows: number } | null | undefined): boolean =>
  !g || (Math.abs(g.exposure) < 1e-4 && Math.abs(g.tint) < 1e-4 && Math.abs(g.highlights) < 1e-4 && Math.abs(g.shadows) < 1e-4)

// ---- colour isolate --------------------------------------------------------------

/** How much of its colour a pixel keeps (1: the kept hue, 0: black and white):
 *  the angle between its chroma and the kept colour's, 0..1 of a half turn,
 *  against `range`. (tx, ty): the kept colour's chroma direction. */
export function isolateKeep(r: number, g: number, b: number, tx: number, ty: number, range: number): number {
  const y = luma709(r, g, b)
  const cb = (b - y) * CB_K
  const cr = (r - y) * CR_K
  const mag = Math.sqrt(cb * cb + cr * cr)
  const cos = Math.max(-1, Math.min(1, (cb * tx + cr * ty) / Math.max(mag, 1e-5)))
  const ang = Math.acos(cos) / Math.PI
  const soft = Math.max(0.03, range * 0.5)
  return (1 - smooth(range, range + soft, ang)) * smooth(0.015, 0.05, mag)
}

/** A colour's direction on the CbCr plane, unit length ([0, 0]: a grey). */
export function chromaDir(rgb: readonly [number, number, number]): [number, number] {
  const [cb, cr] = cbcr(rgb[0] / 255, rgb[1] / 255, rgb[2] / 255)
  const m = Math.hypot(cb, cr)
  return m < 1e-4 ? [0, 0] : [cb / m, cr / m]
}

// ---- glow and halation: the blur buffer ------------------------------------------

/** The blur's taps either side of the centre, and their weights (a Gaussian
 *  whose sigma is a third of the radius). */
export const BLUR_TAPS = 8
export const BLUR_WEIGHTS: number[] = (() => {
  const w: number[] = []
  let sum = 0
  for (let i = -BLUR_TAPS; i <= BLUR_TAPS; i++) {
    const v = Math.exp(-0.5 * ((3 * i) / BLUR_TAPS) ** 2)
    w.push(v)
    sum += v
  }
  return w.map((v) => v / sum)
})()

/** The size of the blur's buffer for a pass of pw × ph and a radius in its
 *  pixels: half the pass, smaller still for a wide radius (the taps stay
 *  within two texels of each other), and the radius in the buffer's pixels. */
export function blurBufferSize(pw: number, ph: number, radius: number): { bw: number; bh: number; rb: number } {
  const half = radius / 2
  const s = half > 16 ? 16 / half : 1
  const bw = Math.max(2, Math.round((pw / 2) * s))
  const bh = Math.max(2, Math.round((ph / 2) * s))
  return { bw, bh, rb: (radius * bw) / pw }
}

/** Halation: where its bright pass starts, and its colour. */
export const HALATION_THRESHOLD = 0.6
export const HALATION_TINT: [number, number, number] = [1, 0.32, 0.12]
/** A glow's radius in pixels of a pass `pw` wide (0..1 → 0.4 %..4 % of the width). */
export const bloomRadiusPx = (radius: number, pw: number): number => (0.004 + 0.036 * clamp01(radius)) * pw
/** A halation's radius (0..1 → 0.6 %..3 % of the width). */
export const halationRadiusPx = (size: number, pw: number): number => (0.006 + 0.024 * clamp01(size)) * pw

/** A texture read the way GL's LINEAR filter reads one (clamped to the edge):
 *  (x, y) in texels, a texel's centre at +0.5. */
function bilinear(buf: Uint8ClampedArray | Uint8Array, w: number, h: number, x: number, y: number, c: number): number {
  const xf = x - 0.5
  const yf = y - 0.5
  const xa = Math.floor(xf)
  const ya = Math.floor(yf)
  const tx = xf - xa
  const ty = yf - ya
  const x0 = xa < 0 ? 0 : xa > w - 1 ? w - 1 : xa
  const x1 = xa + 1 < 0 ? 0 : xa + 1 > w - 1 ? w - 1 : xa + 1
  const y0 = ya < 0 ? 0 : ya > h - 1 ? h - 1 : ya
  const y1 = ya + 1 < 0 ? 0 : ya + 1 > h - 1 ? h - 1 : ya + 1
  const a = buf[(y0 * w + x0) * 4 + c]
  const b = buf[(y0 * w + x1) * 4 + c]
  const d = buf[(y1 * w + x0) * 4 + c]
  const e = buf[(y1 * w + x1) * 4 + c]
  const top = a + (b - a) * tx
  const bot = d + (e - d) * tx
  return top + (bot - top) * ty
}

const q8 = (v: number): number => Math.round(clamp01(v) * 255)

/**
 * The blurred bright parts of `d` (pw × ph, RGBA) as an RGBA buffer of
 * bw × bh: a bright pass (16 taps a pixel) into the small buffer, then the
 * blur across and down. Each pass ends in 8 bits, as the GPU's buffers do.
 */
export function brightBlur(d: Uint8ClampedArray, pw: number, ph: number, threshold: number, radius: number): { buf: Uint8Array; bw: number; bh: number } {
  const { bw, bh, rb } = blurBufferSize(pw, ph, radius)
  const fx = pw / bw
  const fy = ph / bh
  let a = new Uint8Array(bw * bh * 4)
  let b = new Uint8Array(bw * bh * 4)
  for (let y = 0; y < bh; y++) {
    for (let x = 0; x < bw; x++) {
      const cx = (x + 0.5) * fx
      const cy = (y + 0.5) * fy
      let sr = 0
      let sg = 0
      let sb = 0
      for (let j = 0; j < 4; j++) {
        for (let i = 0; i < 4; i++) {
          const sx = cx + ((i + 0.5) / 4 - 0.5) * fx
          const sy = cy + ((j + 0.5) / 4 - 0.5) * fy
          const r = bilinear(d, pw, ph, sx, sy, 0) / 255
          const g = bilinear(d, pw, ph, sx, sy, 1) / 255
          const bl = bilinear(d, pw, ph, sx, sy, 2) / 255
          const al = bilinear(d, pw, ph, sx, sy, 3) / 255
          const wgt = smooth(threshold - 0.1, threshold + 0.1, luma709(r, g, bl)) * al
          sr += r * wgt
          sg += g * wgt
          sb += bl * wgt
        }
      }
      const o = (y * bw + x) * 4
      a[o] = q8(sr / 16)
      a[o + 1] = q8(sg / 16)
      a[o + 2] = q8(sb / 16)
      a[o + 3] = 255
    }
  }
  const step = rb / BLUR_TAPS
  for (const dir of [0, 1]) {
    for (let y = 0; y < bh; y++) {
      for (let x = 0; x < bw; x++) {
        let sr = 0
        let sg = 0
        let sb = 0
        for (let i = -BLUR_TAPS; i <= BLUR_TAPS; i++) {
          const sx = x + 0.5 + (dir === 0 ? i * step : 0)
          const sy = y + 0.5 + (dir === 1 ? i * step : 0)
          const w = BLUR_WEIGHTS[i + BLUR_TAPS]
          sr += bilinear(a, bw, bh, sx, sy, 0) * w
          sg += bilinear(a, bw, bh, sx, sy, 1) * w
          sb += bilinear(a, bw, bh, sx, sy, 2) * w
        }
        const o = (y * bw + x) * 4
        b[o] = Math.round(sr)
        b[o + 1] = Math.round(sg)
        b[o + 2] = Math.round(sb)
        b[o + 3] = 255
      }
    }
    const t = a
    a = b
    b = t
  }
  return { buf: a, bw, bh }
}

/** Lays the glow and the halation (their blur buffers) on `d`, screen-blended. */
export function compositeLight(
  d: Uint8ClampedArray,
  pw: number,
  ph: number,
  glow: { buf: Uint8Array; bw: number; bh: number; amount: number } | null,
  hal: { buf: Uint8Array; bw: number; bh: number; amount: number } | null
): void {
  for (let y = 0; y < ph; y++) {
    for (let x = 0; x < pw; x++) {
      const i = (y * pw + x) * 4
      let r = d[i] / 255
      let g = d[i + 1] / 255
      let b = d[i + 2] / 255
      if (glow) {
        const k = glow.amount
        const bx = ((x + 0.5) / pw) * glow.bw
        const by = ((y + 0.5) / ph) * glow.bh
        r = 1 - (1 - r) * (1 - Math.min(1, (bilinear(glow.buf, glow.bw, glow.bh, bx, by, 0) / 255) * k))
        g = 1 - (1 - g) * (1 - Math.min(1, (bilinear(glow.buf, glow.bw, glow.bh, bx, by, 1) / 255) * k))
        b = 1 - (1 - b) * (1 - Math.min(1, (bilinear(glow.buf, glow.bw, glow.bh, bx, by, 2) / 255) * k))
      }
      if (hal) {
        const bx = ((x + 0.5) / pw) * hal.bw
        const by = ((y + 0.5) / ph) * hal.bh
        const l = luma709(bilinear(hal.buf, hal.bw, hal.bh, bx, by, 0) / 255, bilinear(hal.buf, hal.bw, hal.bh, bx, by, 1) / 255, bilinear(hal.buf, hal.bw, hal.bh, bx, by, 2) / 255)
        // The halo shows where the picture is darker than the light beside
        // it: a bright area is not painted red all over, its edge bleeds.
        const k = Math.min(1, l * hal.amount * 1.6) * (1 - clamp01(luma709(r, g, b)))
        r = 1 - (1 - r) * (1 - HALATION_TINT[0] * k)
        g = 1 - (1 - g) * (1 - HALATION_TINT[1] * k)
        b = 1 - (1 - b) * (1 - HALATION_TINT[2] * k)
      }
      d[i] = q8(r)
      d[i + 1] = q8(g)
      d[i + 2] = q8(b)
    }
  }
}

// ---- the whole pass ---------------------------------------------------------------

/** Does the pass need the second stage (the blur buffers and the composite)? */
export const hasLightPass = (p: FxParams): boolean => (!!p.bloom && p.bloom.amount > 0.001) || (!!p.halation && p.halation.amount > 0.001)

/**
 * The pixel pass on the CPU: `d` (pw × ph, RGBA, straight alpha) in place.
 * The same picture as the shader's (playback/fxgl.ts), but for the grain,
 * whose noise is another generator's.
 */
export function pixelPassCpu(d: Uint8ClampedArray, pw: number, ph: number, p: FxParams): void {
  const tmp = [0, 0, 0]

  // 1. Mosaic: the source itself becomes cells (four taps a cell, rounded).
  const m = p.mosaic ?? 0
  if (m >= 1.5) {
    const raw = new Uint8ClampedArray(d)
    const at = (x: number, y: number, c: number): number => {
      const xi = Math.max(0, Math.min(pw - 1, Math.floor(x)))
      const yi = Math.max(0, Math.min(ph - 1, Math.floor(y)))
      return raw[(yi * pw + xi) * 4 + c]
    }
    const o = m * 0.25
    // (A pixel belongs to the cell its centre lies in: see the shader.)
    for (let y = 0; y < ph; y++) {
      const cy = (Math.floor((y + 0.5) / m) + 0.5) * m
      for (let x = 0; x < pw; x++) {
        const cx = (Math.floor((x + 0.5) / m) + 0.5) * m
        const i = (y * pw + x) * 4
        for (let c = 0; c < 4; c++) d[i + c] = Math.round((at(cx - o, cy - o, c) + at(cx + o, cy - o, c) + at(cx - o, cy + o, c) + at(cx + o, cy + o, c)) / 4)
      }
    }
  }

  // 2. The chroma keyer: alpha from the source, then its cast taken off.
  const ch = p.chroma
  const keyer = ch && ch.mode === 1 ? ch : null
  if (keyer) {
    const [kcb, kcr] = cbcr(keyer.key[0] / 255, keyer.key[1] / 255, keyer.key[2] / 255)
    const km = Math.hypot(kcb, kcr)
    const kx = km < 1e-4 ? 0 : kcb / km
    const ky = km < 1e-4 ? 0 : kcr / km
    const spill = km < 1e-4 ? 0 : (keyer.spill ?? 0)
    for (let i = 0; i < d.length; i += 4) {
      const r = d[i] / 255
      const g = d[i + 1] / 255
      const b = d[i + 2] / 255
      d[i + 3] = Math.round(d[i + 3] * keyAlpha(r, g, b, kcb, kcr, keyer.sim, keyer.smooth))
      if (spill > 0.001) {
        despill(r, g, b, kx, ky, spill, tmp)
        d[i] = q8(tmp[0])
        d[i + 1] = q8(tmp[1])
        d[i + 2] = q8(tmp[2])
      }
    }
  }

  const old = ch && ch.mode !== 1 ? ch : null
  const key = old ? old.key : null
  const sim = old ? old.sim : 0
  const soft = old ? old.smooth : 1
  const lut = p.lut
  const lutAmt = p.lutAmount ?? 1
  const grade = gradeIsNeutral(p.grade) ? null : p.grade!
  const duoDark = p.duotone ? p.duotone.dark : null
  const duoLight = p.duotone ? p.duotone.light : null
  const sharpen = p.sharpen
  const vig = p.vignette
  const grain = p.grain
  const cab = p.cab
  const fxIdx = p.fx ?? 0
  const fxAmt = p.fxAmount ?? 0
  const time = p.time
  const iso = p.isolate && p.isolate.amount > 0.001 ? p.isolate : null
  const isoDir = iso ? chromaDir(iso.key) : [0, 0]
  // Analogue noise holds for a couple of frames; static that changes every
  // frame reads as digital.
  const tick = Math.floor(time * 14)
  const fxHash = (a: number, b: number, c: number): number => {
    const n = Math.sin(a * 12.9898 + b * 78.233 + c * 37.719) * 43758.5453
    return n - Math.floor(n)
  }
  const cx2 = pw / 2
  const cy2 = ph / 2
  const maxDist = Math.hypot(cx2, cy2)
  // Every effect that reads a neighbouring pixel needs an untouched copy to
  // read FROM, or it would sample pixels this same loop has already changed.
  const orig = sharpen > 0.01 || cab > 0 || fxIdx === 2 || fxIdx === 3 || fxIdx === 4 ? new Uint8ClampedArray(d) : null
  const sampleAt = (x: number, y: number, chn: number): number => {
    const xi = Math.max(0, Math.min(pw - 1, x))
    const yi = Math.max(0, Math.min(ph - 1, y))
    return orig![(yi * pw + xi) * 4 + chn]
  }
  let rnd = (time * 9973) & 0xffff

  for (let i = 0; i < d.length; i += 4) {
    const px = (i / 4) % pw
    const py = ((i / 4) / pw) | 0
    // The source pixel: what the first keyer measures (before any grade).
    const or = d[i]
    const og = d[i + 1]
    const ob = d[i + 2]
    let r = or
    let g = og
    let b = ob

    // Chromatic aberration: pull red from the left, blue from the right.
    if (cab > 0 && orig) {
      r = sampleAt(px - cab, py, 0)
      b = sampleAt(px + cab, py, 2)
    }
    // Sharpen (unsharp: centre − blurred neighbours).
    if (sharpen > 0.01 && orig) {
      const k = sharpen * 0.8
      for (let c = 0; c < 3; c++) {
        const center = orig[i + c]
        const avg =
          (sampleAt(px - 1, py, c) + sampleAt(px + 1, py, c) + sampleAt(px, py - 1, c) + sampleAt(px, py + 1, c)) / 4
        const v = center + (center - avg) * k * 2
        if (c === 0) r = v
        else if (c === 1) g = v
        else b = v
      }
    }
    // Colour: exposure, tint, highlights, shadows.
    if (grade) {
      tmp[0] = r / 255
      tmp[1] = g / 255
      tmp[2] = b / 255
      gradeColor(tmp, grade.exposure, grade.tint, grade.highlights, grade.shadows)
      r = tmp[0] * 255
      g = tmp[1] * 255
      b = tmp[2] * 255
    }
    // What colour isolate keeps is decided here, before a duotone or a LUT
    // repaints the picture.
    const keep = iso ? isolateKeep(clamp01(r / 255), clamp01(g / 255), clamp01(b / 255), isoDir[0], isoDir[1], iso.range) : 1
    // Duotone: map luminance across dark→light.
    if (duoDark && duoLight) {
      const lum = (r * 0.299 + g * 0.587 + b * 0.114) / 255
      r = duoDark[0] + (duoLight[0] - duoDark[0]) * lum
      g = duoDark[1] + (duoLight[1] - duoDark[1]) * lum
      b = duoDark[2] + (duoLight[2] - duoDark[2]) * lum
    }
    // LUT, mixed in by its amount.
    if (lut && lut.n > 1) {
      const r0 = Math.max(0, Math.min(255, r))
      const g0 = Math.max(0, Math.min(255, g))
      const b0 = Math.max(0, Math.min(255, b))
      lutTrilinear(lut, r0 / 255, g0 / 255, b0 / 255, tmp)
      r = r0 + (tmp[0] * 255 - r0) * lutAmt
      g = g0 + (tmp[1] * 255 - g0) * lutAmt
      b = b0 + (tmp[2] * 255 - b0) * lutAmt
    }
    // Colour isolate: everything but the kept hue towards black and white.
    if (iso) {
      const k = (1 - keep) * iso.amount
      const l = luma709(r, g, b)
      r += (l - r) * k
      g += (l - g) * k
      b += (l - b) * k
    }
    // Vignette.
    if (vig > 0.01) {
      const dist = Math.hypot(px - cx2, py - cy2) / maxDist
      const f = 1 - vig * Math.max(0, dist - 0.35) * 1.6
      r *= f
      g *= f
      b *= f
    }
    // Film grain (animated per frame).
    if (grain > 0.01) {
      rnd = (rnd * 1103515245 + 12345) & 0x7fffffff
      const nz = ((rnd % 512) - 256) * grain * 0.4
      r += nz
      g += nz
      b += nz
    }
    // Whole looks — the same four the shader does, in the same order, so a
    // machine without WebGL2 gets the same picture rather than a quietly
    // different one.
    if (fxIdx > 0 && fxAmt > 0.001) {
      const k = fxAmt
      if (fxIdx === 2) {
        const line = py % 3
        const lf = 1 + (line < 1 ? -0.38 : 0.06) * k
        const col = px % 3
        r *= lf * (1 + (col < 1 ? 0.06 : -0.03) * k)
        g *= lf * (1 + (col >= 1 && col < 2 ? 0.06 : -0.03) * k)
        b *= lf * (1 + (col >= 2 ? 0.06 : -0.03) * k)
        // Colour fringing, which this path was leaving out entirely — a shadow
        // mask without it is scanlines, not a picture tube.
        if (orig) {
          const fr = k * 1.5
          r += (sampleAt(Math.round(px - fr), py, 0) - r) * 0.7
          b += (sampleAt(Math.round(px + fr), py, 2) - b) * 0.7
        }
        const dist = Math.hypot((px - cx2) / cx2, (py - cy2) / cy2)
        const vf = 1 - k * 0.5 * Math.max(0, dist - 0.45)
        r = r * vf + k * 6
        g = g * vf + k * 6
        b = b * vf + k * 6
      } else if (fxIdx === 3 && orig) {
        const band = Math.floor(py / 3)
        const wob = (fxHash(band, 0, tick + 7) - 0.5) * k * 14
        const lag = k * 4
        // Red and blue come wholly from the displaced original; green keeps a
        // sixth of the graded pixel, which is what the shader does. Taking all
        // three from the original threw the colour grade away on this path
        // only, so the two would have drawn different pictures.
        r = sampleAt(Math.round(px + wob - lag), py, 0)
        g = g * 0.15 + sampleAt(Math.round(px + wob), py, 1) * 0.85
        b = sampleAt(Math.round(px + wob + lag * 0.6), py, 2)
        if (fxHash(band, 1, Math.floor(time * 6) + 21) > 1 - k * 0.035) {
          const boost = 90 * k
          r += boost
          g += boost
          b += boost
        }
        // Tape noise last, after the dropout — the order the shader uses, so
        // a dropped band is dimmed by the noise rather than the other way
        // round.
        const tapeNoise = 1 - k * 0.06 * fxHash(py, 0, tick + 3)
        r *= tapeNoise
        g *= tapeNoise
        b *= tapeNoise
      } else if (fxIdx === 4 && orig) {
        const cell = 2 + (9 - 2) * k
        const ccx = Math.floor(px / cell) * cell + cell / 2
        const ccy = Math.floor(py / cell) * cell + cell / 2
        const sr = sampleAt(Math.round(ccx), Math.round(ccy), 0)
        const sg = sampleAt(Math.round(ccx), Math.round(ccy), 1)
        const sb = sampleAt(Math.round(ccx), Math.round(ccy), 2)
        const lum = (sr * 0.299 + sg * 0.587 + sb * 0.114) / 255
        const rad = (1 - lum) * cell * 0.72
        const dist = Math.hypot(px - ccx, py - ccy)
        const ink = dist <= rad - 0.7 ? 1 : dist >= rad + 0.7 ? 0 : (rad + 0.7 - dist) / 1.4
        r += ((255 + (sr * 0.25 + 12 - 255) * ink) - r) * k
        g += ((255 + (sg * 0.25 + 12 - 255) * ink) - g) * k
        b += ((255 + (sb * 0.25 + 12 - 255) * ink) - b) * k
      } else if (fxIdx === 5) {
        const levels = Math.max(2, Math.floor(24 + (3 - 24) * k))
        const band = (v: number): number => {
          const q = Math.min(1, Math.max(0, ((v / 255 - 0.5) * (1 + k * 0.35) + 0.5)))
          return (Math.round(q * levels) / levels) * 255
        }
        r = band(r)
        g = band(g)
        b = band(b)
      }
    }
    d[i] = r
    d[i + 1] = g
    d[i + 2] = b
    // The first keyer: the SOURCE colour's distance (before grade / duotone).
    if (key) {
      const dist = Math.sqrt((or - key[0]) ** 2 + (og - key[1]) ** 2 + (ob - key[2]) ** 2)
      if (dist < sim) d[i + 3] = 0
      else if (dist < sim + soft) d[i + 3] = Math.round(d[i + 3] * ((dist - sim) / soft))
    }
  }

  // 3. Glow and halation: the bright parts, blurred, laid back on.
  if (hasLightPass(p)) {
    const glow = p.bloom && p.bloom.amount > 0.001 ? { ...brightBlur(d, pw, ph, p.bloom.threshold, p.bloom.radius), amount: p.bloom.amount } : null
    const hal = p.halation && p.halation.amount > 0.001 ? { ...brightBlur(d, pw, ph, HALATION_THRESHOLD, p.halation.radius), amount: p.halation.amount } : null
    compositeLight(d, pw, ph, glow, hal)
  }
}
