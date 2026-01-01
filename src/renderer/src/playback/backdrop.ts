// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// The canvas behind everything: what shows wherever no clip covers the frame.
// Plain black, or one of a few quiet, slowly moving designs — soft light,
// a fine grid, a halftone field, paper — each a pure function of time, so the
// preview and the export are the same frame. Drawn in project pixels.

import type { Backdrop, BackdropStyle } from '../types'

type Ctx2D = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D

export const BACKDROPS: { id: BackdropStyle; label: string; hint: string; tint: string }[] = [
  { id: 'black', label: 'Black', hint: 'Plain black', tint: '#000000' },
  { id: 'velvet', label: 'Velvet', hint: 'Black velvet under a soft light from above — barely there, very expensive', tint: '#d9ccb6' },
  { id: 'silk', label: 'Silk', hint: 'Deep silk, a slow sheen flowing across it', tint: '#8c9bd6' },
  { id: 'glass', label: 'Glass', hint: 'Frosted glass with muted color drifting behind it', tint: '#6f86b8' },
  { id: 'aurora', label: 'Aurora', hint: 'Soft color drifting on a deep ground', tint: '#5b7cfa' },
  { id: 'mesh', label: 'Mesh', hint: 'A light pastel mesh gradient, slowly moving', tint: '#f3a683' },
  { id: 'grid', label: 'Grid', hint: 'A fine grid drifting under a spotlight', tint: '#4fd1c5' },
  { id: 'dots', label: 'Dots', hint: 'A halftone field breathing with a slow wave', tint: '#ffffff' },
  { id: 'studio', label: 'Studio', hint: 'A studio backdrop with a pool of light', tint: '#ffd9a8' },
  { id: 'paper', label: 'Paper', hint: 'Warm paper, a slow sweep of light across it', tint: '#b08a5a' },
  { id: 'blueprint', label: 'Blueprint', hint: 'A design board: deep color lit in the middle, a fine grid, marks at the corners, a few soft lights — navy, graphite grey or any color', tint: '#1f4a6e' }
]

/** Ready colours for a style's tint, one click each. */
export const BACKDROP_TINTS: Partial<Record<BackdropStyle, { name: string; tint: string }[]>> = {
  blueprint: [
    { name: 'Navy', tint: '#1f4a6e' },
    { name: 'Graphite', tint: '#4b5058' },
    { name: 'Petrol', tint: '#1d5458' },
    { name: 'Plum', tint: '#43305c' },
    { name: 'Forest', tint: '#2b4a35' },
    { name: 'Ink', tint: '#24262c' }
  ]
}

const BY_ID = new Map(BACKDROPS.map((b) => [b.id, b]))

function hash(a: number, b: number): number {
  let h = (a * 374761393 + b * 668265263) | 0
  h = Math.imul(h ^ (h >>> 13), 1274126177)
  h ^= h >>> 16
  return (h >>> 0) / 4294967296
}

function rgb(hex: string): [number, number, number] {
  const n = parseInt(/^#[0-9a-f]{6}$/i.test(hex) ? hex.slice(1) : 'ffffff', 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

/** A colour turned round the hue circle by `deg`, as rgba(). */
function shifted(hex: string, deg: number, a: number): string {
  const [r, g, b] = rgb(hex).map((v) => v / 255)
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const l = (max + min) / 2
  const d = max - min
  let h = 0
  const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1))
  if (d !== 0) {
    if (max === r) h = ((g - b) / d) % 6
    else if (max === g) h = (b - r) / d + 2
    else h = (r - g) / d + 4
  }
  h = (h * 60 + deg + 360) % 360
  return `hsla(${h.toFixed(1)},${(s * 100).toFixed(1)}%,${(l * 100).toFixed(1)}%,${a.toFixed(3)})`
}

function rgba(hex: string, a: number): string {
  const [r, g, b] = rgb(hex)
  return `rgba(${r},${g},${b},${a.toFixed(3)})`
}

// -- film grain: one noise tile, offset 12 times a second ---------------------------

let grainTile: HTMLCanvasElement | OffscreenCanvas | null = null
const grainPatterns = new WeakMap<object, CanvasPattern>()

function grain(ctx: Ctx2D): CanvasPattern | null {
  if (!grainTile) {
    const size = 192
    const cv: HTMLCanvasElement | OffscreenCanvas =
      typeof document !== 'undefined' ? Object.assign(document.createElement('canvas'), { width: size, height: size }) : new OffscreenCanvas(size, size)
    const g = cv.getContext('2d') as Ctx2D | null
    if (!g) return null
    const img = g.createImageData(size, size)
    for (let i = 0; i < size * size; i++) {
      const v = Math.round(hash(i, 7) * 255)
      img.data[i * 4] = v
      img.data[i * 4 + 1] = v
      img.data[i * 4 + 2] = v
      img.data[i * 4 + 3] = 255
    }
    g.putImageData(img, 0, 0)
    grainTile = cv
  }
  let p = grainPatterns.get(ctx)
  if (!p) {
    p = ctx.createPattern(grainTile as CanvasImageSource, 'repeat') ?? undefined
    if (p) grainPatterns.set(ctx, p)
  }
  return p ?? null
}

function drawGrain(ctx: Ctx2D, t: number, W: number, H: number, amount: number, mode: GlobalCompositeOperation): void {
  const p = grain(ctx)
  if (!p) return
  const f = Math.floor(t * 12)
  ctx.save()
  ctx.globalCompositeOperation = mode
  ctx.globalAlpha = amount
  ctx.translate(Math.floor(hash(f, 1) * 192), Math.floor(hash(f, 2) * 192))
  ctx.fillStyle = p
  ctx.fillRect(-192, -192, W + 384, H + 384)
  ctx.restore()
}

function vignette(ctx: Ctx2D, W: number, H: number, a: number, color = '0,0,0'): void {
  const r = Math.hypot(W, H) / 2
  const g = ctx.createRadialGradient(W / 2, H / 2, r * 0.35, W / 2, H / 2, r)
  g.addColorStop(0, `rgba(${color},0)`)
  g.addColorStop(1, `rgba(${color},${a})`)
  ctx.fillStyle = g
  ctx.fillRect(0, 0, W, H)
}

/** A soft round light. */
function blob(ctx: Ctx2D, x: number, y: number, r: number, color: string): void {
  const g = ctx.createRadialGradient(x, y, 0, x, y, r)
  g.addColorStop(0, color)
  g.addColorStop(1, color.replace(/[\d.]+\)$/, '0)'))
  ctx.fillStyle = g
  ctx.fillRect(x - r, y - r, r * 2, r * 2)
}

/** The tint scaled towards black (k < 1) — its own colour, darker. */
function dark(hex: string, k: number, a = 1): string {
  const [r, g, bl] = rgb(hex)
  return `rgba(${Math.round(r * k)},${Math.round(g * k)},${Math.round(bl * k)},${a.toFixed(3)})`
}

/**
 * Draws the canvas background for time `t`, over the whole frame. `win`:
 * the part the viewer sees (a Short's 9:16 window) — what is framed (the
 * corner marks, the light in the middle) follows it.
 */
export function drawBackdrop(ctx: Ctx2D, b: Backdrop | undefined, t: number, W: number, H: number, win?: { cx: number; w: number }): void {
  const style = b?.style ?? 'black'
  const tint = b?.tint ?? BY_ID.get(style)?.tint ?? '#ffffff'
  // Motion 0..1: how fast things drift (0 stands still, never rushes).
  const sp = 0.25 + 1.5 * Math.min(1, Math.max(0, b?.motion ?? 0.5))
  const T = t * sp
  const M = Math.max(W, H)
  ctx.save()
  ctx.globalAlpha = 1
  ctx.globalCompositeOperation = 'source-over'
  switch (style) {
    case 'velvet': {
      // Black velvet: a soft, wide light from above falling off into the
      // dark, its warmth your colour, breathing very slowly; fine grain.
      ctx.fillStyle = '#060607'
      ctx.fillRect(0, 0, W, H)
      const breathe = 1 + 0.04 * Math.sin(T * 0.35)
      const lx = W * (0.5 + 0.04 * Math.sin(T * 0.07))
      ctx.save()
      ctx.translate(lx, -H * 0.18)
      ctx.scale(1.35, 1)
      const cone = ctx.createRadialGradient(0, 0, 0, 0, 0, H * 1.15 * breathe)
      cone.addColorStop(0, rgba(tint, 0.2))
      cone.addColorStop(0.45, rgba(tint, 0.07))
      cone.addColorStop(1, rgba(tint, 0))
      ctx.fillStyle = cone
      ctx.fillRect(-W, -H * 0.2, W * 2, H * 1.6)
      ctx.restore()
      // Where it lands, the nap of the velvet catches it.
      blob(ctx, lx, H * 0.78, M * 0.32, rgba(tint, 0.05))
      vignette(ctx, W, H, 0.7)
      drawGrain(ctx, t, W, H, 0.045, 'overlay')
      break
    }
    case 'silk': {
      // Deep silk: long soft folds of light flowing slowly across on the
      // diagonal, never brighter than a sheen.
      const bg = ctx.createLinearGradient(0, 0, W, H)
      bg.addColorStop(0, '#0b0c12')
      bg.addColorStop(1, '#101219')
      ctx.fillStyle = bg
      ctx.fillRect(0, 0, W, H)
      ctx.save()
      ctx.translate(W / 2, H / 2)
      ctx.rotate(-0.42)
      ctx.globalCompositeOperation = 'screen'
      for (let i = 0; i < 5; i++) {
        const y = (i - 2) * M * 0.22 + Math.sin(T * 0.12 + i * 1.3) * M * 0.05
        const thick = M * (0.08 + 0.05 * Math.sin(T * 0.09 + i * 2.1) ** 2)
        const band = ctx.createLinearGradient(0, y - thick, 0, y + thick)
        const a = 0.07 + 0.05 * Math.sin(T * 0.21 + i * 0.9) ** 2
        band.addColorStop(0, rgba(tint, 0))
        band.addColorStop(0.5, rgba(tint, a))
        band.addColorStop(1, rgba(tint, 0))
        ctx.fillStyle = band
        ctx.fillRect(-M, y - thick, M * 2, thick * 2)
      }
      ctx.restore()
      vignette(ctx, W, H, 0.6)
      drawGrain(ctx, t, W, H, 0.04, 'overlay')
      break
    }
    case 'glass': {
      // Frosted glass: a few big, muted colours drifting slowly behind a
      // pane — soft, low, never loud — with the pane's faint cool edge.
      ctx.fillStyle = '#0c0e13'
      ctx.fillRect(0, 0, W, H)
      ctx.globalCompositeOperation = 'screen'
      const cols = [shifted(tint, 0, 0.2), shifted(tint, 40, 0.14), shifted(tint, -60, 0.16), shifted(tint, 180, 0.08)]
      cols.forEach((col, i) => {
        const x = W * (0.5 + 0.38 * Math.sin(T * 0.06 + i * 1.9))
        const y = H * (0.5 + 0.34 * Math.cos(T * 0.05 + i * 2.4))
        blob(ctx, x, y, M * (0.42 + 0.06 * Math.sin(T * 0.04 + i)), col)
      })
      ctx.globalCompositeOperation = 'source-over'
      // The pane: a whisper of light along its top edge.
      const pane = ctx.createLinearGradient(0, 0, 0, H * 0.35)
      pane.addColorStop(0, 'rgba(255,255,255,0.045)')
      pane.addColorStop(1, 'rgba(255,255,255,0)')
      ctx.fillStyle = pane
      ctx.fillRect(0, 0, W, H)
      vignette(ctx, W, H, 0.5)
      drawGrain(ctx, t, W, H, 0.07, 'overlay')
      break
    }
    case 'aurora': {
      ctx.fillStyle = '#07080d'
      ctx.fillRect(0, 0, W, H)
      ctx.globalCompositeOperation = 'screen'
      const cols = [shifted(tint, 0, 0.42), shifted(tint, 58, 0.3), shifted(tint, -48, 0.32)]
      cols.forEach((col, i) => {
        const x = W * (0.5 + 0.34 * Math.sin(T * 0.13 + i * 2.1))
        const y = H * (0.5 + 0.3 * Math.cos(T * 0.11 + i * 1.7))
        blob(ctx, x, y, M * (0.55 + 0.1 * Math.sin(T * 0.07 + i)), col)
      })
      ctx.globalCompositeOperation = 'source-over'
      vignette(ctx, W, H, 0.55)
      drawGrain(ctx, t, W, H, 0.06, 'overlay')
      break
    }
    case 'mesh': {
      ctx.fillStyle = '#efe9df'
      ctx.fillRect(0, 0, W, H)
      const cols = [shifted(tint, 0, 0.55), shifted(tint, 150, 0.42), shifted(tint, 220, 0.4), shifted(tint, 40, 0.35)]
      cols.forEach((col, i) => {
        const x = W * (0.5 + 0.42 * Math.sin(T * 0.09 + i * 1.6))
        const y = H * (0.5 + 0.38 * Math.cos(T * 0.08 + i * 2.3))
        blob(ctx, x, y, M * (0.45 + 0.08 * Math.sin(T * 0.06 + i * 0.7)), col)
      })
      vignette(ctx, W, H, 0.12, '80,60,40')
      drawGrain(ctx, t, W, H, 0.05, 'multiply')
      break
    }
    case 'blueprint': {
      // A design board: the colour deep at the edges, lit in the middle, a
      // fine grid (every fifth line a touch stronger) drifting very slowly,
      // grain, thin marks at the corners of what is seen, and a few soft
      // lights low down, rising and fading.
      const fx = win ? win.cx - win.w / 2 : 0
      const fw = win ? win.w : W
      const cx = fx + fw / 2
      ctx.fillStyle = dark(tint, 0.26)
      ctx.fillRect(0, 0, W, H)
      const R = Math.hypot(fw, H) * 0.62
      const lit = ctx.createRadialGradient(cx, H * 0.44, 0, cx, H * 0.48, R)
      lit.addColorStop(0, dark(tint, 0.64))
      lit.addColorStop(0.5, dark(tint, 0.5))
      lit.addColorStop(1, dark(tint, 0.28))
      ctx.fillStyle = lit
      ctx.fillRect(0, 0, W, H)
      const step = H / 92
      const off = (T * step * 0.05) % (step * 5)
      ctx.lineWidth = Math.max(1, H / 1080)
      for (let i = -6; i <= Math.ceil(W / step) + 6; i++) {
        const x = Math.round(i * step + off) + 0.5
        ctx.strokeStyle = i % 5 === 0 ? 'rgba(255,255,255,0.034)' : 'rgba(255,255,255,0.02)'
        ctx.beginPath()
        ctx.moveTo(x, 0)
        ctx.lineTo(x, H)
        ctx.stroke()
      }
      for (let j = -6; j <= Math.ceil(H / step) + 6; j++) {
        const y = Math.round(j * step + off * 0.5) + 0.5
        ctx.strokeStyle = j % 5 === 0 ? 'rgba(255,255,255,0.03)' : 'rgba(255,255,255,0.018)'
        ctx.beginPath()
        ctx.moveTo(0, y)
        ctx.lineTo(W, y)
        ctx.stroke()
      }
      // A few soft lights low in the middle, rising slowly and fading.
      for (let k = 0; k < 3; k++) {
        const life = 14 + 5 * k
        // Spaced through their rise, so they never bunch up.
        const ph = ((T * 0.6) / life + k / 3 + 0.1 * hash(k, 31)) % 1
        const x = cx + (hash(k, 41) - 0.5) * fw * 0.3 + Math.sin(T * 0.2 + k) * fw * 0.015
        const y = H * (0.99 - 0.35 * ph)
        const a = 0.1 * Math.sin(Math.PI * ph)
        // A small soft disc with an edge you can just make out.
        const r = H * (0.022 + 0.006 * k)
        const d = ctx.createRadialGradient(x, y, 0, x, y, r)
        d.addColorStop(0, `rgba(200,220,255,${a.toFixed(3)})`)
        d.addColorStop(0.7, `rgba(200,220,255,${(a * 0.8).toFixed(3)})`)
        d.addColorStop(1, 'rgba(200,220,255,0)')
        ctx.fillStyle = d
        ctx.fillRect(x - r, y - r, r * 2, r * 2)
      }
      // The edges sink away (round what is seen).
      const vg = ctx.createRadialGradient(cx, H / 2, Math.min(fw, H) * 0.3, cx, H / 2, Math.hypot(fw, H) * 0.62)
      vg.addColorStop(0, 'rgba(0,0,0,0)')
      vg.addColorStop(1, 'rgba(0,0,0,0.6)')
      ctx.fillStyle = vg
      ctx.fillRect(0, 0, W, H)
      drawGrain(ctx, t, W, H, 0.11, 'overlay')
      // Thin marks at the corners of what is seen.
      const inset = Math.min(fw, H) * 0.06
      const arm = Math.min(fw, H) * 0.035
      ctx.strokeStyle = 'rgba(255,255,255,0.11)'
      ctx.lineWidth = Math.max(1, H / 900)
      ctx.lineCap = 'square'
      for (const [sx, sy] of [[1, 1], [-1, 1], [1, -1], [-1, -1]] as const) {
        const x0 = sx > 0 ? fx + inset : fx + fw - inset
        const y0 = sy > 0 ? inset : H - inset
        ctx.beginPath()
        ctx.moveTo(x0, y0 + sy * arm)
        ctx.lineTo(x0, y0)
        ctx.lineTo(x0 + sx * arm, y0)
        ctx.stroke()
      }
      break
    }
    case 'grid': {
      ctx.fillStyle = '#0b0d11'
      ctx.fillRect(0, 0, W, H)
      blob(ctx, W * (0.5 + 0.2 * Math.sin(T * 0.1)), H * (0.42 + 0.1 * Math.cos(T * 0.08)), M * 0.6, 'rgba(40,48,64,0.9)')
      blob(ctx, W * (0.5 + 0.3 * Math.cos(T * 0.07)), H * (0.6 + 0.12 * Math.sin(T * 0.09)), M * 0.45, rgba(tint, 0.1))
      const step = H / 12
      const off = (T * step * 0.12) % step
      ctx.lineWidth = Math.max(1, H / 1080)
      for (let i = -1; i <= Math.ceil(W / step) + 1; i++) {
        const x = i * step + off
        ctx.strokeStyle = (i & 3) === 0 ? 'rgba(255,255,255,0.075)' : 'rgba(255,255,255,0.035)'
        ctx.beginPath()
        ctx.moveTo(x, 0)
        ctx.lineTo(x, H)
        ctx.stroke()
      }
      for (let j = -1; j <= Math.ceil(H / step) + 1; j++) {
        const y = j * step + off * 0.6
        ctx.strokeStyle = (j & 3) === 0 ? 'rgba(255,255,255,0.075)' : 'rgba(255,255,255,0.035)'
        ctx.beginPath()
        ctx.moveTo(0, y)
        ctx.lineTo(W, y)
        ctx.stroke()
      }
      vignette(ctx, W, H, 0.6)
      drawGrain(ctx, t, W, H, 0.05, 'overlay')
      break
    }
    case 'dots': {
      ctx.fillStyle = '#0d0e12'
      ctx.fillRect(0, 0, W, H)
      const step = H / 26
      const [r0, g0, b0] = rgb(tint)
      for (let y = step / 2; y < H; y += step) {
        for (let x = step / 2; x < W; x += step) {
          const w = 0.5 + 0.5 * Math.sin(x / W * 5.2 + y / H * 3.1 - T * 0.5) * Math.cos(y / H * 2.4 - T * 0.23)
          ctx.fillStyle = `rgba(${r0},${g0},${b0},${(0.05 + 0.13 * w).toFixed(3)})`
          ctx.beginPath()
          ctx.arc(x, y, step * (0.08 + 0.12 * w), 0, Math.PI * 2)
          ctx.fill()
        }
      }
      vignette(ctx, W, H, 0.5)
      break
    }
    case 'studio': {
      const g = ctx.createLinearGradient(0, 0, 0, H)
      g.addColorStop(0, '#1d1f24')
      g.addColorStop(0.62, '#2a2c32')
      g.addColorStop(1, '#131417')
      ctx.fillStyle = g
      ctx.fillRect(0, 0, W, H)
      const breathe = 1 + 0.05 * Math.sin(T * 0.4)
      blob(ctx, W / 2, H * 0.62, M * 0.5 * breathe, rgba(tint, 0.14))
      blob(ctx, W / 2, H * 0.55, M * 0.28, 'rgba(255,255,255,0.05)')
      vignette(ctx, W, H, 0.55)
      drawGrain(ctx, t, W, H, 0.05, 'overlay')
      break
    }
    case 'paper': {
      ctx.fillStyle = '#f2eee6'
      ctx.fillRect(0, 0, W, H)
      // A slow band of light passing over it.
      const cycle = 14
      const u = ((T % cycle) + cycle) % cycle / cycle
      const cx = -0.4 * W + 1.8 * W * u
      const lg = ctx.createLinearGradient(cx - W * 0.35, 0, cx + W * 0.35, H * 0.4)
      lg.addColorStop(0, 'rgba(255,255,255,0)')
      lg.addColorStop(0.5, 'rgba(255,255,255,0.35)')
      lg.addColorStop(1, 'rgba(255,255,255,0)')
      ctx.fillStyle = lg
      ctx.fillRect(0, 0, W, H)
      vignette(ctx, W, H, 0.16, `${rgb(tint).join(',')}`)
      drawGrain(ctx, t, W, H, 0.09, 'multiply')
      break
    }
    default:
      ctx.fillStyle = '#000000'
      ctx.fillRect(0, 0, W, H)
  }
  ctx.restore()
}

/** A saved backdrop, repaired (project files are text anyone can edit). */
export function cleanBackdrop(raw: unknown): Backdrop | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const r = raw as Partial<Backdrop>
  if (!r.style || !BY_ID.has(r.style) || r.style === 'black') return undefined
  const out: Backdrop = { style: r.style }
  if (typeof r.tint === 'string' && /^#[0-9a-f]{6}$/i.test(r.tint)) out.tint = r.tint
  if (typeof r.motion === 'number' && Number.isFinite(r.motion)) out.motion = Math.min(1, Math.max(0, r.motion))
  return out
}
