// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// A camera look for the whole picture, drawn in code over everything the
// camera sees (captions stay clean on top): the feel of film — a gate that
// weaves a hair, grain that changes every frame, highlights that bloom warm,
// lifted blacks, a light that breathes, dust — and a vignette that is alive:
// round, from the sides or top and bottom, breathing, drifting or sweeping.
// Pure functions of the time, so the preview shows what the export writes.

type Ctx2D = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D

export interface CameraLook {
  /** Film grain, 0..1 — new grain every frame. */
  grain: number
  /** Gate weave: the picture drifting a hair frame to frame. */
  weave: number
  /** Highlights blooming warm into the dark around them. */
  halation: number
  /** Lifted, warmed blacks — the faded print. */
  fade: number
  /** The light breathing, frame to frame. */
  flicker: number
  /** Specks of dust, a hair, the odd scratch. */
  dust: number
  /** Black and white, 0..1. */
  mono: number
  /** The vignette: how dark, its shape and how it moves. */
  vignette: number
  vShape: 'round' | 'sides' | 'bars'
  vMotion: 'still' | 'breathe' | 'drift' | 'sweep'
  vSpeed: number
  /** Cinema bars (0 off … 1 a full 2.39:1 frame). */
  bars: number
  /** A Super 8 gate: the frame's corners rounded into the dark. */
  gate: number
}

export const NO_LOOK: CameraLook = { grain: 0, weave: 0, halation: 0, fade: 0, flicker: 0, dust: 0, mono: 0, vignette: 0, vShape: 'round', vMotion: 'still', vSpeed: 1, bars: 0, gate: 0 }

export const LOOK_PRESETS: { id: string; label: string; hint: string; look: CameraLook }[] = [
  { id: 'film', label: 'Film', hint: 'Shot on film: fine grain, a weaving gate, warm highlights, soft corners', look: { ...NO_LOOK, grain: 0.45, weave: 0.35, halation: 0.35, fade: 0.3, flicker: 0.2, dust: 0.2, vignette: 0.35 } },
  { id: 'super8', label: 'Super 8', hint: 'Home movie: heavy grain and weave, a breathing light, dust, the gate’s rounded corners', look: { ...NO_LOOK, grain: 0.8, weave: 0.75, halation: 0.45, fade: 0.55, flicker: 0.5, dust: 0.55, vignette: 0.55, vMotion: 'breathe', gate: 0.8 } },
  { id: 'cinema', label: 'Cinema', hint: 'Wide bars, darkened sides that drift, a little grain and glow', look: { ...NO_LOOK, grain: 0.18, halation: 0.25, vignette: 0.45, vShape: 'sides', vMotion: 'drift', vSpeed: 0.6, bars: 0.85 } },
  { id: 'dream', label: 'Dream', hint: 'Soft blooming light, lifted shadows, a slow breathing vignette', look: { ...NO_LOOK, grain: 0.12, halation: 0.75, fade: 0.45, vignette: 0.45, vMotion: 'breathe', vSpeed: 0.7 } },
  { id: 'noir', label: 'Noir', hint: 'Black and white film, hard grain, a light that sweeps side to side', look: { ...NO_LOOK, grain: 0.6, weave: 0.3, mono: 1, flicker: 0.35, dust: 0.3, vignette: 0.6, vShape: 'sides', vMotion: 'sweep', vSpeed: 0.5 } }
]

/** A look at part strength (a layer faded or turned down): every dial
 *  scaled, the shapes and motions kept. */
export function lookAt(l: CameraLook, k: number): CameraLook {
  if (k >= 0.999) return l
  const q = Math.max(0, k)
  return { ...l, grain: l.grain * q, weave: l.weave * q, halation: l.halation * q, fade: l.fade * q, flicker: l.flicker * q, dust: l.dust * q, mono: l.mono * q, vignette: l.vignette * q, bars: l.bars * q, gate: l.gate * q }
}

/** Which preset a look is, if it is one. */
export const lookName = (l: CameraLook | undefined): string | null => {
  if (!l || !hasLook(l)) return null
  const p = LOOK_PRESETS.find((x) => JSON.stringify(x.look) === JSON.stringify(l))
  return p ? p.label : 'Custom'
}

export const hasLook = (l: CameraLook | undefined | null): l is CameraLook =>
  !!l && (l.grain > 0 || l.weave > 0 || l.halation > 0 || l.fade > 0 || l.flicker > 0 || l.dust > 0 || l.mono > 0 || l.vignette > 0 || l.bars > 0 || l.gate > 0)

const hash = (a: number, b = 0): number => {
  const n = Math.sin(a * 12.9898 + b * 78.233) * 43758.5453
  return n - Math.floor(n)
}

type Surface = HTMLCanvasElement | OffscreenCanvas
const surfaces = new Map<string, Surface>()
function surface(name: string, w: number, h: number): Surface {
  let s = surfaces.get(name)
  if (!s) {
    s = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(w, h) : Object.assign(document.createElement('canvas'), { width: w, height: h })
    surfaces.set(name, s)
  }
  if (s.width !== w || s.height !== h) {
    s.width = w
    s.height = h
  }
  return s
}

/** A tile of grain, made once: soft grey noise about the middle. */
let grainTile: Surface | null = null
function grain(): Surface {
  if (grainTile) return grainTile
  const n = 256
  const s = surface('grain', n, n)
  const g = s.getContext('2d') as Ctx2D
  const img = g.createImageData(n, n)
  let seed = 1234567
  for (let i = 0; i < n * n; i++) {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff
    const a = (seed >> 8) & 255
    seed = (seed * 1103515245 + 12345) & 0x7fffffff
    const b = (seed >> 8) & 255
    // Two uniforms averaged: rounder, filmic grain rather than flat static.
    const v = (a + b) >> 1
    img.data[i * 4] = v
    img.data[i * 4 + 1] = v
    img.data[i * 4 + 2] = v
    img.data[i * 4 + 3] = 255
  }
  g.putImageData(img, 0, 0)
  grainTile = s
  return s
}

/**
 * Lays the look over what is on `ctx` (drawn at `scale` × project pixels),
 * within the part of the frame given (the whole frame, or a Shorts window).
 */
export function drawCameraLook(ctx: Ctx2D, look: CameraLook, time: number, W: number, H: number, scale: number, region?: { left: number; width: number }): void {
  if (!hasLook(look)) return
  const left = region?.left ?? 0
  const RW = region?.width ?? W
  const frame = Math.floor(time * 24)
  const cv = ctx.canvas as Surface
  const dw = cv.width
  const dh = cv.height
  ctx.save()
  ctx.setTransform(1, 0, 0, 1, 0, 0)
  const px = (v: number): number => v * scale
  // 1. The gate weaves (and the colour goes, for black and white): the
  // picture is copied and laid back a hair off, a touch larger so no edge
  // shows.
  if (look.weave > 0 || look.mono > 0) {
    const copy = surface('look-copy', dw, dh)
    const cg = copy.getContext('2d') as Ctx2D
    cg.setTransform(1, 0, 0, 1, 0, 0)
    cg.clearRect(0, 0, dw, dh)
    cg.drawImage(cv as CanvasImageSource, 0, 0)
    const wf = Math.floor(time * 18)
    const jx = (hash(wf, 1) - 0.5) * 2.4 * look.weave + Math.sin(time * 1.3) * 0.8 * look.weave
    const jy = (hash(wf, 2) - 0.5) * 3.2 * look.weave + Math.sin(time * 0.9 + 1) * 1.2 * look.weave
    const k = 1 + 0.008 * look.weave
    ctx.filter = look.mono > 0 ? `grayscale(${look.mono.toFixed(2)}) contrast(${(1 + 0.15 * look.mono).toFixed(2)})` : 'none'
    ctx.translate(dw / 2 + px(jx), dh / 2 + px(jy))
    ctx.scale(k, k)
    ctx.drawImage(copy as CanvasImageSource, -dw / 2, -dh / 2)
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.filter = 'none'
  }
  // 2. Halation: the bright parts, warmed and blurred, bloom over the rest.
  if (look.halation > 0) {
    const sw = Math.max(2, Math.round(dw / 4))
    const sh = Math.max(2, Math.round(dh / 4))
    const small = surface('look-halo', sw, sh)
    const sg = small.getContext('2d') as Ctx2D
    sg.setTransform(1, 0, 0, 1, 0, 0)
    sg.globalCompositeOperation = 'source-over'
    sg.filter = 'brightness(0.85) contrast(2.6)'
    sg.drawImage(cv as CanvasImageSource, 0, 0, sw, sh)
    sg.filter = 'none'
    sg.globalCompositeOperation = 'multiply'
    sg.fillStyle = '#ff7a4a'
    sg.fillRect(0, 0, sw, sh)
    sg.globalCompositeOperation = 'source-over'
    ctx.globalCompositeOperation = 'screen'
    ctx.globalAlpha = 0.42 * look.halation
    ctx.filter = `blur(${Math.max(1, px(10)).toFixed(1)}px)`
    ctx.drawImage(small as CanvasImageSource, 0, 0, dw, dh)
    ctx.filter = 'none'
    ctx.globalAlpha = 1
    ctx.globalCompositeOperation = 'source-over'
  }
  ctx.setTransform(scale, 0, 0, scale, 0, 0)
  ctx.beginPath()
  ctx.rect(left, 0, RW, H)
  ctx.clip()
  // 3. The faded print: blacks lifted and warmed.
  if (look.fade > 0) {
    ctx.globalCompositeOperation = 'screen'
    ctx.fillStyle = `rgba(34,24,14,${(0.9 * look.fade).toFixed(3)})`
    ctx.fillRect(left, 0, RW, H)
    ctx.globalCompositeOperation = 'soft-light'
    ctx.fillStyle = `rgba(255,190,120,${(0.22 * look.fade).toFixed(3)})`
    ctx.fillRect(left, 0, RW, H)
    ctx.globalCompositeOperation = 'source-over'
  }
  // 4. The light breathing, frame to frame.
  if (look.flicker > 0) {
    const f = (hash(frame, 3) - 0.5) * 0.09 * look.flicker + Math.sin(time * 7.3) * 0.012 * look.flicker
    ctx.fillStyle = f > 0 ? `rgba(255,245,230,${f.toFixed(3)})` : `rgba(0,0,0,${(-f).toFixed(3)})`
    ctx.fillRect(left, 0, RW, H)
  }
  // 5. Grain, new every frame.
  if (look.grain > 0) {
    const tile = grain()
    const pat = ctx.createPattern(tile as CanvasImageSource, 'repeat')
    if (pat) {
      const ox = Math.floor(hash(frame, 5) * 256)
      const oy = Math.floor(hash(frame, 6) * 256)
      // Grain is a size on the film, not on the screen: ~2 px at 1080.
      const gs = Math.max(1, H / 540)
      pat.setTransform(new DOMMatrix([gs, 0, 0, gs, ox, oy]))
      ctx.globalCompositeOperation = 'overlay'
      ctx.globalAlpha = 0.5 * look.grain
      ctx.fillStyle = pat
      ctx.fillRect(left, 0, RW, H)
      ctx.globalAlpha = 1
      ctx.globalCompositeOperation = 'source-over'
    }
  }
  // 6. Dust, a hair, the odd scratch.
  if (look.dust > 0) {
    const n = Math.round(1 + 7 * look.dust * hash(frame, 7))
    for (let i = 0; i < n; i++) {
      const x = left + hash(frame, 10 + i) * RW
      const y = hash(frame, 30 + i) * H
      const r = (0.6 + 2.4 * hash(frame, 50 + i)) * (H / 1080)
      const bright = hash(frame, 70 + i) > 0.7
      ctx.fillStyle = bright ? 'rgba(255,250,240,0.55)' : 'rgba(10,8,6,0.6)'
      ctx.beginPath()
      ctx.ellipse(x, y, r, r * (0.6 + 0.8 * hash(frame, 90 + i)), hash(frame, 110 + i) * 3, 0, Math.PI * 2)
      ctx.fill()
    }
    // A hair now and then, for a few frames.
    const hf = Math.floor(frame / 3)
    if (hash(hf, 130) < 0.12 * look.dust) {
      const x = left + hash(hf, 131) * RW
      const y = hash(hf, 132) * H
      const s = (30 + 60 * hash(hf, 133)) * (H / 1080)
      ctx.strokeStyle = 'rgba(12,10,8,0.55)'
      ctx.lineWidth = 1.2 * (H / 1080)
      ctx.beginPath()
      ctx.moveTo(x, y)
      ctx.bezierCurveTo(x + s * 0.4, y - s * 0.3, x + s * 0.6, y + s * 0.4, x + s, y + s * 0.1)
      ctx.stroke()
    }
    // A scratch down the frame that stays a moment and wanders.
    const sf = Math.floor(time * 2)
    if (hash(sf, 140) < 0.35 * look.dust) {
      const x = left + (hash(sf, 141) + Math.sin(time * 3) * 0.004) * RW
      ctx.fillStyle = 'rgba(255,248,235,0.18)'
      ctx.fillRect(x, 0, Math.max(1, H / 1080), H)
    }
  }
  // 7. The vignette, alive.
  if (look.vignette > 0) {
    const sp = look.vSpeed || 1
    const breath = look.vMotion === 'breathe' ? 1 + 0.16 * Math.sin(time * 1.3 * sp) : 1
    const dx = look.vMotion === 'drift' ? Math.sin(time * 0.37 * sp) * 0.08 * RW : 0
    const dy = look.vMotion === 'drift' ? Math.cos(time * 0.29 * sp) * 0.05 * H : 0
    const a = Math.min(0.95, 0.9 * look.vignette)
    if (look.vShape === 'round') {
      const cx = left + RW / 2 + dx
      const cy = H / 2 + dy
      const R = Math.hypot(RW, H) / 2
      const inner = R * (0.62 - 0.3 * look.vignette) * breath
      const v = ctx.createRadialGradient(cx, cy, Math.max(1, inner), cx, cy, R * 1.05 * breath)
      v.addColorStop(0, 'rgba(0,0,0,0)')
      v.addColorStop(1, `rgba(0,0,0,${a.toFixed(3)})`)
      ctx.fillStyle = v
      ctx.fillRect(left, 0, RW, H)
    } else {
      // From two edges: the sides (or top and bottom); a sweep leans the
      // dark from one side to the other and back.
      const horiz = look.vShape === 'sides'
      const span = horiz ? RW : H
      const depth = span * (0.2 + 0.22 * look.vignette) * breath
      const lean = look.vMotion === 'sweep' ? Math.sin(time * 0.8 * sp) : 0
      for (const s of [-1, 1] as const) {
        const k = 1 + 0.6 * lean * s
        const d = depth * Math.max(0.25, k)
        const off = look.vMotion === 'drift' ? (horiz ? dx : dy) : 0
        const edge = s < 0 ? (horiz ? left : 0) : horiz ? left + RW : H
        const g = horiz ? ctx.createLinearGradient(edge, 0, edge - s * d + off, 0) : ctx.createLinearGradient(0, edge, 0, edge - s * d + off)
        g.addColorStop(0, `rgba(0,0,0,${(a * Math.min(1, k)).toFixed(3)})`)
        g.addColorStop(1, 'rgba(0,0,0,0)')
        ctx.fillStyle = g
        ctx.fillRect(left, 0, RW, H)
      }
    }
  }
  // 8. The Super 8 gate: the frame's corners rounded off into the dark.
  if (look.gate > 0) {
    const r = Math.min(RW, H) * 0.07 * look.gate
    ctx.fillStyle = '#060504'
    ctx.beginPath()
    ctx.rect(left - 2, -2, RW + 4, H + 4)
    ctx.roundRect(left + r * 0.35, r * 0.25, RW - r * 0.7, H - r * 0.5, r * 1.6)
    ctx.fill('evenodd')
  }
  // 9. Cinema bars.
  if (look.bars > 0) {
    const target = RW / 2.39
    const bh = Math.max(0, ((H - target) / 2) * look.bars)
    if (bh > 0.5) {
      ctx.fillStyle = '#000'
      ctx.fillRect(left, 0, RW, bh)
      ctx.fillRect(left, H - bh, RW, bh)
    }
  }
  ctx.restore()
}
