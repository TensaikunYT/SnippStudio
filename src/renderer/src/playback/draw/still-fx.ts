// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// A still picture's own effects and the ambient effects. Moved out of
// playback/render.ts in SnippStudio phase 2B (no change).
import { burnFlare } from '../../effects/film-burn'
import type { Clip } from '../../types'
import { maskGeomAt } from '../pose'
import type { Ctx2D } from './core'
import { traceMaskPath } from './mask'

/** Animated light overlays for stills. They deliberately avoid transforms, so
 *  a look can stack with both Cinematize and Gentle Pan without touching
 *  either motion channel. Everything is derived from clip time + saved seed,
 *  keeping preview and export frame-identical. */
export function drawStillImageFx(ctx: Ctx2D, clip: Clip, w: number, h: number, localTime: number, baseAlpha: number): void {
  const fx = clip.stillImageFx
  if (!fx || fx.amount <= 0) return
  const amount = Math.max(0, Math.min(1, fx.amount))
  const phase = ((fx.seed >>> 0) % 1000) / 1000
  // Batch looks use one timeline clock so a cut does not restart the light.
  // Old projects without an offset retain their clip-local animation.
  const progress = fx.timeOffset === undefined
    ? (clip.duration > 0 ? Math.max(0, Math.min(1, localTime / clip.duration)) : 0)
    : (1 - Math.cos((localTime + fx.timeOffset) * Math.PI / 7)) / 2

  ctx.save()
  ctx.filter = 'none'
  ctx.beginPath()
  ctx.rect(-w / 2, -h / 2, w, h)
  ctx.clip()
  const crop = clip.crop
  if (crop && (crop.l > 0 || crop.t > 0 || crop.r > 0 || crop.b > 0)) {
    ctx.beginPath()
    ctx.rect(
      -w / 2 + crop.l * w,
      -h / 2 + crop.t * h,
      Math.max(0, w * (1 - crop.l - crop.r)),
      Math.max(0, h * (1 - crop.t - crop.b))
    )
    ctx.clip()
  }
  const mask = clip.mask
  const maskReady = mask?.enabled && mask.mode === 'cut' && !(mask.shape === 'path' && (mask.points?.length ?? 0) < 3)
  if (mask && maskReady) {
    const geometry = maskGeomAt(mask, localTime)
    ctx.beginPath()
    if (mask.invert) ctx.rect(-w, -h, w * 2, h * 2)
    traceMaskPath(ctx, mask.shape, geometry, mask.smooth ?? 0)
    ctx.clip(mask.invert ? 'evenodd' : 'nonzero')
  }
  ctx.globalCompositeOperation = 'screen'
  // One clock for the new lights: it never restarts at a cut.
  const clock = localTime + (fx.timeOffset ?? 0)
  const ph = phase * Math.PI * 2
  const S = Math.max(w, h)

  if (fx.style === 'window-light') {
    // Light through a window: the room a little darker, a few soft shafts
    // from the upper left at a slant, each its own width, drifting across
    // very slowly and breathing.
    ctx.globalCompositeOperation = 'multiply'
    ctx.globalAlpha = baseAlpha * amount * 0.5
    ctx.fillStyle = 'rgb(186,184,196)'
    ctx.fillRect(-w / 2, -h / 2, w, h)
    ctx.globalCompositeOperation = 'screen'
    ctx.save()
    ctx.rotate(-0.52)
    const drift = Math.sin(clock * 0.11 + ph) * 0.08 * S
    const shafts = [
      [-0.34, 0.1, 0.9],
      [-0.16, 0.06, 0.7],
      [0.02, 0.13, 1],
      [0.22, 0.05, 0.55]
    ] as const
    for (const [off, wid, k] of shafts) {
      const cx = off * S + drift
      const breath = 0.75 + 0.25 * Math.sin(clock * 0.37 + ph + off * 9)
      const band = ctx.createLinearGradient(cx - wid * S, 0, cx + wid * S, 0)
      band.addColorStop(0, 'rgba(255,244,222,0)')
      band.addColorStop(0.5, `rgba(255,242,215,${(0.75 * k * breath).toFixed(3)})`)
      band.addColorStop(1, 'rgba(255,244,222,0)')
      ctx.globalAlpha = baseAlpha * amount * 0.5
      ctx.fillStyle = band
      ctx.fillRect(cx - wid * S, -S, wid * 2 * S, S * 2)
    }
    ctx.restore()
    // Where the light comes in, the picture is a little brighter.
    const lift = ctx.createRadialGradient(-0.5 * w, -0.5 * h, 0, -0.5 * w, -0.5 * h, S * 0.9)
    lift.addColorStop(0, 'rgba(255,240,215,0.5)')
    lift.addColorStop(1, 'rgba(255,240,215,0)')
    ctx.globalAlpha = baseAlpha * amount * 0.22
    ctx.fillStyle = lift
    ctx.fillRect(-w / 2, -h / 2, w, h)
  } else if (fx.style === 'golden-hour') {
    // A low warm sun just off the side: warmth over everything, a bloom
    // where the sun is, the far side staying cooler.
    const side = phase > 0.5 ? 1 : -1
    const sx = side * (0.62 * w) + Math.sin(clock * 0.07 + ph) * 0.04 * w
    const sy = -0.1 * h + Math.sin(clock * 0.05 + ph) * 0.03 * h
    const breath = 0.85 + 0.15 * Math.sin(clock * 0.3 + ph)
    ctx.globalCompositeOperation = 'soft-light'
    const warm = ctx.createLinearGradient(side * w * 0.5, 0, -side * w * 0.5, 0)
    warm.addColorStop(0, 'rgba(255,170,70,0.9)')
    warm.addColorStop(1, 'rgba(255,190,120,0.15)')
    ctx.globalAlpha = baseAlpha * amount * 0.55
    ctx.fillStyle = warm
    ctx.fillRect(-w / 2, -h / 2, w, h)
    ctx.globalCompositeOperation = 'screen'
    const sun = ctx.createRadialGradient(sx, sy, 0, sx, sy, S * 0.75)
    sun.addColorStop(0, 'rgba(255,236,190,0.95)')
    sun.addColorStop(0.18, 'rgba(255,196,120,0.5)')
    sun.addColorStop(0.55, 'rgba(255,150,80,0.12)')
    sun.addColorStop(1, 'rgba(255,140,70,0)')
    ctx.globalAlpha = baseAlpha * amount * 0.42 * breath
    ctx.fillStyle = sun
    ctx.fillRect(-w / 2, -h / 2, w, h)
  } else if (fx.style === 'anamorphic') {
    // An anamorphic lens flare: a long thin blue streak across the frame
    // through a soft core, gliding slowly, with one faint ghost opposite.
    const cy = (-0.18 + 0.1 * Math.sin(clock * 0.09 + ph)) * h
    const cx = Math.sin(clock * 0.13 + ph) * 0.3 * w
    const breath = 0.8 + 0.2 * Math.sin(clock * 0.45 + ph)
    // A wide soft band of blue glow, then the thin streak through it.
    for (const [thick, a, col] of [
      [0.09, 0.35, '90,150,255'],
      [0.018, 0.9, '150,200,255']
    ] as const) {
      ctx.save()
      ctx.translate(cx, cy)
      ctx.scale(1, thick)
      const streak = ctx.createRadialGradient(0, 0, 0, 0, 0, w * 1.1)
      streak.addColorStop(0, `rgba(${col},0.95)`)
      streak.addColorStop(0.3, `rgba(${col},0.5)`)
      streak.addColorStop(1, `rgba(${col},0)`)
      ctx.globalCompositeOperation = 'lighter'
      ctx.globalAlpha = baseAlpha * amount * a * breath
      ctx.fillStyle = streak
      ctx.beginPath()
      ctx.arc(0, 0, w * 1.1, 0, Math.PI * 2)
      ctx.fill()
      ctx.restore()
    }
    ctx.globalCompositeOperation = 'screen'
    const core = ctx.createRadialGradient(cx, cy, 0, cx, cy, S * 0.12)
    core.addColorStop(0, 'rgba(235,245,255,0.8)')
    core.addColorStop(1, 'rgba(160,200,255,0)')
    ctx.globalAlpha = baseAlpha * amount * 0.45 * breath
    ctx.fillStyle = core
    ctx.fillRect(-w / 2, -h / 2, w, h)
    const gx = -cx * 0.8
    const gy = -cy * 0.8
    const ghost = ctx.createRadialGradient(gx, gy, S * 0.02, gx, gy, S * 0.07)
    ghost.addColorStop(0, 'rgba(140,190,255,0)')
    ghost.addColorStop(0.7, 'rgba(140,190,255,0.35)')
    ghost.addColorStop(1, 'rgba(140,190,255,0)')
    ctx.globalAlpha = baseAlpha * amount * 0.25
    ctx.fillStyle = ghost
    ctx.fillRect(-w / 2, -h / 2, w, h)
  } else if (fx.style === 'haze') {
    // Morning haze: soft banks of fog low in the picture, drifting slowly
    // at their own speeds, thinning upwards.
    for (let i = 0; i < 5; i++) {
      const sp = 0.012 + 0.008 * i
      const px = ((((clock * sp + phase + i * 0.29) % 1) + 1) % 1) * 1.6 - 0.8
      const x = px * w
      const y = (0.22 + 0.07 * (i % 3)) * h
      const rx = (0.45 + 0.1 * (i % 2)) * w
      const ry = 0.16 * h
      ctx.save()
      ctx.translate(x, y)
      ctx.scale(rx, ry)
      const fog = ctx.createRadialGradient(0, 0, 0, 0, 0, 1)
      fog.addColorStop(0, 'rgba(236,240,246,0.75)')
      fog.addColorStop(1, 'rgba(236,240,246,0)')
      ctx.globalAlpha = baseAlpha * amount * 0.45
      ctx.fillStyle = fog
      ctx.fillRect(-1, -1, 2, 2)
      ctx.restore()
    }
    const low = ctx.createLinearGradient(0, h * 0.5, 0, 0)
    low.addColorStop(0, 'rgba(230,236,244,0.7)')
    low.addColorStop(1, 'rgba(230,236,244,0)')
    ctx.globalAlpha = baseAlpha * amount * 0.4
    ctx.fillStyle = low
    ctx.fillRect(-w / 2, -h / 2, w, h)
  } else if (fx.style === 'dust') {
    // A beam from above with dust floating in it: the motes only show in
    // the light, drifting and turning over slowly.
    const bx = (0.12 + 0.05 * Math.sin(clock * 0.08 + ph)) * w
    ctx.save()
    ctx.rotate(0.3)
    const beam = ctx.createLinearGradient(bx - 0.22 * w, 0, bx + 0.22 * w, 0)
    beam.addColorStop(0, 'rgba(255,246,226,0)')
    beam.addColorStop(0.5, 'rgba(255,246,226,0.65)')
    beam.addColorStop(1, 'rgba(255,246,226,0)')
    ctx.globalAlpha = baseAlpha * amount * 0.38
    ctx.fillStyle = beam
    ctx.fillRect(bx - 0.22 * w, -S, 0.44 * w, 2 * S)
    ctx.restore()
    const hash = (a: number): number => {
      const n = Math.sin(a * 12.9898 + fx.seed * 0.137) * 43758.5453
      return n - Math.floor(n)
    }
    const r0 = Math.min(w, h) * 0.0042
    ctx.fillStyle = 'rgba(255,250,236,1)'
    for (let i = 0; i < 110; i++) {
      const vx = (hash(i * 3.1) - 0.5) * 0.012
      const vy = -0.006 - hash(i * 5.7) * 0.01
      const u0 = ((hash(i) + clock * vx + 0.03 * Math.sin(clock * 0.6 + i)) % 1 + 1) % 1
      const v0 = ((hash(i + 91) + clock * vy) % 1 + 1) % 1
      const x = (u0 - 0.5) * w
      const y = (v0 - 0.5) * h
      // Inside the beam only (along its slant).
      const across = (x - bx) * Math.cos(0.3) + y * Math.sin(0.3)
      const inBeam = Math.max(0, 1 - Math.abs(across) / (0.2 * w))
      if (inBeam <= 0) continue
      const tw = 0.5 + 0.5 * Math.sin(clock * (0.8 + hash(i + 7)) + i)
      ctx.globalAlpha = baseAlpha * amount * 0.85 * inBeam * tw
      ctx.beginPath()
      ctx.arc(x, y, r0 * (0.6 + hash(i + 3) * 1.2), 0, Math.PI * 2)
      ctx.fill()
    }
  } else if (fx.style === 'light-glow') {
    const pulse = 0.72 + 0.28 * Math.sin((progress * 1.25 + phase) * Math.PI * 2)
    const x = -w * 0.24 + Math.sin((progress + phase) * Math.PI) * w * 0.1
    const y = -h * 0.22
    const radius = Math.max(w, h) * (0.62 + amount * 0.18)
    const glow = ctx.createRadialGradient(x, y, 0, x, y, radius)
    glow.addColorStop(0, 'rgba(255,250,228,0.72)')
    glow.addColorStop(0.28, 'rgba(255,224,184,0.3)')
    glow.addColorStop(1, 'rgba(255,210,170,0)')
    ctx.globalAlpha = baseAlpha * amount * 0.34 * pulse
    ctx.fillStyle = glow
    ctx.fillRect(-w / 2, -h / 2, w, h)
  } else if (fx.style === 'light-leak') {
    // Travels beyond both edges, so it enters and leaves instead of sitting as
    // a permanent orange patch. A second pink fringe gives it film character.
    const travel = fx.timeOffset === undefined
      ? ((progress * 0.78 + phase) % 1) * 2.4 - 1.2
      : Math.sin((localTime + fx.timeOffset) * 0.43 + phase * Math.PI * 2) * 1.2
    const x = travel * w
    const y = (-0.2 + 0.4 * Math.sin((progress + phase) * Math.PI * 2)) * h
    const radius = Math.max(w, h) * 0.72
    const leak = ctx.createRadialGradient(x, y, 0, x, y, radius)
    leak.addColorStop(0, 'rgba(255,245,205,0.9)')
    leak.addColorStop(0.22, 'rgba(255,151,68,0.55)')
    leak.addColorStop(0.58, 'rgba(255,62,118,0.2)')
    leak.addColorStop(1, 'rgba(255,40,90,0)')
    ctx.globalAlpha = baseAlpha * amount * 0.46
    ctx.fillStyle = leak
    ctx.fillRect(-w / 2, -h / 2, w, h)
  } else {
    // A broad, soft highlight crossing the picture once. The band never turns
    // into a hard white stripe, even at full amount.
    const center = (-0.9 + progress * 1.8) * w
    const span = w * 0.38
    const shimmer = ctx.createLinearGradient(center - span, -h / 2, center + span, h / 2)
    shimmer.addColorStop(0, 'rgba(210,230,255,0)')
    shimmer.addColorStop(0.42, 'rgba(232,242,255,0.08)')
    shimmer.addColorStop(0.5, 'rgba(255,250,232,0.62)')
    shimmer.addColorStop(0.58, 'rgba(255,225,205,0.1)')
    shimmer.addColorStop(1, 'rgba(255,220,190,0)')
    ctx.globalAlpha = baseAlpha * amount * 0.38
    ctx.fillStyle = shimmer
    ctx.fillRect(-w / 2, -h / 2, w, h)
  }
  ctx.restore()
}

/** One project-time light clock. Batch-applied clips share a seed and pass
 * their start as timeOffset, so an adjacent cut never restarts the pulse. */
export function ambientPulse(seed: number, localTime: number): number {
  const phase = ((seed >>> 0) % 1000) / 1000 * Math.PI * 2
  return 0.55 + 0.45 * Math.sin(localTime * 0.72 + phase)
}

export function drawAmbientFx(ctx: Ctx2D, clip: Clip, w: number, h: number, localTime: number, baseAlpha: number, q = 1): void {
  const fx = clip.ambientFx
  // Living Frame is a frame-space treatment after all visual clips are
  // composited. Painting it here would follow the still's pan and alter only
  // that source, rather than the finished frame.
  if (!fx || fx.amount <= 0 || fx.style === 'soft-focus' || fx.style === 'living-frame') return
  const amount = Math.min(1, Math.max(0, fx.amount))
  const pulse = ambientPulse(fx.seed, localTime + (fx.timeOffset ?? 0))
  ctx.save()
  ctx.filter = 'none'
  ctx.beginPath()
  ctx.rect(-w / 2, -h / 2, w, h)
  ctx.clip()
  const crop = clip.crop
  if (crop && (crop.l > 0 || crop.t > 0 || crop.r > 0 || crop.b > 0)) {
    ctx.beginPath()
    ctx.rect(-w / 2 + crop.l * w, -h / 2 + crop.t * h, Math.max(0, w * (1 - crop.l - crop.r)), Math.max(0, h * (1 - crop.t - crop.b)))
    ctx.clip()
  }
  const mask = clip.mask
  if (mask?.enabled && mask.mode === 'cut' && !(mask.shape === 'path' && (mask.points?.length ?? 0) < 3)) {
    ctx.beginPath()
    if (mask.invert) ctx.rect(-w, -h, w * 2, h * 2)
    traceMaskPath(ctx, mask.shape, maskGeomAt(mask, localTime), mask.smooth ?? 0)
    ctx.clip(mask.invert ? 'evenodd' : 'nonzero')
  }
  if (fx.style === 'edge-glow') {
    ctx.globalCompositeOperation = 'screen'
    ctx.globalAlpha = baseAlpha * amount * (0.08 + 0.1 * pulse)
    const x = (-0.34 + 0.12 * pulse) * w
    const y = -0.25 * h
    const glow = ctx.createRadialGradient(x, y, 0, x, y, Math.max(w, h) * 0.72)
    glow.addColorStop(0, 'rgba(255,245,220,0.78)')
    glow.addColorStop(0.4, 'rgba(243,190,130,0.24)')
    glow.addColorStop(1, 'rgba(255,200,170,0)')
    ctx.fillStyle = glow
    ctx.fillRect(-w / 2, -h / 2, w, h)
  }
  if (fx.style === 'film-burn') {
    ctx.globalAlpha = 1
    burnFlare(ctx, fx.seed, localTime + (fx.timeOffset ?? 0), w, h, amount * baseAlpha, q)
  }
  if (fx.style === 'shadow-breathe') {
    ctx.globalCompositeOperation = 'source-over'
    ctx.globalAlpha = baseAlpha * amount * (0.18 + 0.12 * pulse)
    const radius = Math.hypot(w, h) * 0.54
    const shadow = ctx.createRadialGradient(0, 0, radius * 0.32, 0, 0, radius)
    shadow.addColorStop(0, 'rgba(0,0,0,0)')
    shadow.addColorStop(0.65, 'rgba(3,5,11,0.08)')
    shadow.addColorStop(1, 'rgba(3,5,11,0.8)')
    ctx.fillStyle = shadow
    ctx.fillRect(-w / 2, -h / 2, w, h)
  }
  ctx.restore()
}
