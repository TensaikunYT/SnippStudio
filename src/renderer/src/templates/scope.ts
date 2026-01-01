// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// Chapters through a scope: the video narrows into a round eyepiece and is
// seen up close through it, the world round it soft; a click on the side
// of the scope and the view swings over to the next chapter — up close in the
// glass, the whole of it blurred behind — the eyepiece pulls focus, the
// chapter's number and title come up beside it, and the glass opens out to
// the full frame and becomes the new chapter's footage. One take.

import { glide, homeOpens, scopeLayout, scopeTimes } from './model'
import { clamp01, drawCover, imageOf, outCubic, prog, text, type Ctx } from './draw'
import type { TemplateItem } from '../types'

type Surface = HTMLCanvasElement | OffscreenCanvas
const lerp = (a: number, b: number, k: number): number => a + (b - a) * k

// Film grain: one tile of noise, laid at a new offset every frame.
let grain: Surface | null = null
function grainTile(): Surface {
  if (grain) return grain
  const cv: Surface = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(192, 192) : Object.assign(document.createElement('canvas'), { width: 192, height: 192 })
  const g = cv.getContext('2d') as CanvasRenderingContext2D
  const im = g.createImageData(192, 192)
  let s = 7654321
  for (let i = 0; i < im.data.length; i += 4) {
    s = (s * 1103515245 + 12345) & 0x7fffffff
    const v = (s >> 16) & 255
    im.data[i] = v
    im.data[i + 1] = v
    im.data[i + 2] = v
    im.data[i + 3] = 255
  }
  g.putImageData(im, 0, 0)
  grain = cv
  return cv
}

/** One view of the world, over the whole frame: the live video, or a
 *  chapter's picture (a deep gradient when it has none). */
type View = { live: true } | { item: TemplateItem | undefined; i: number }

function drawView(c: Ctx, v: View): void {
  const { g, x0, W, H } = c
  if ('live' in v) {
    if (c.live) g.drawImage(c.live, c.x0 * c.px, 0, c.W * c.px, c.H * c.px, x0, 0, W, H)
    else {
      g.fillStyle = '#0e0f13'
      g.fillRect(x0, 0, W, H)
    }
    return
  }
  const img = imageOf(c, v.item)
  if (img) {
    drawCover(g, img, x0, 0, W, H)
    return
  }
  const gr = g.createLinearGradient(x0, 0, x0 + W, H)
  gr.addColorStop(0, v.i % 2 ? '#2b3445' : '#3a2f2a')
  gr.addColorStop(1, '#0e0f13')
  g.fillStyle = gr
  g.fillRect(x0, 0, W, H)
  g.fillStyle = 'rgba(255,255,255,0.06)'
  g.beginPath()
  g.arc(x0 + W * 0.66, H * 0.42, H * 0.2, 0, Math.PI * 2)
  g.fill()
}

/**
 * The world as it is at this moment: the old view going left and the new
 * coming in from the right as the scope swings (`pan` 0 → 1), `zoom` times
 * nearer round (fx, fy). `shift` is how far one view is from the next, in
 * frame widths, at 1×.
 */
function world(c: Ctx, from: View, to: View, pan: number, zoom: number, fx: number, fy: number, shift: number): void {
  const g = c.g
  const d = c.W * shift * zoom
  for (const [v, o] of [
    [from, -pan * d],
    [to, (1 - pan) * d]
  ] as [View, number][]) {
    if (Math.abs(o) > c.W * (1 + zoom)) continue
    g.save()
    g.translate(fx + o, fy)
    g.scale(zoom, zoom)
    g.translate(-fx, -fy)
    drawView(c, v)
    g.restore()
  }
}

export function drawScope(c: Ctx): void {
  const { g, b, t, x0, W, H, u } = c
  const st = b.style
  const n = b.items.length
  const T = scopeTimes(b)
  const open = Math.min(n - 1, Math.max(0, homeOpens(c.project, b)))
  const cur = b.items[open]
  const L = scopeLayout(x0, W, H)
  // Raising the scope (0 → 1), the swing to the next chapter, the glass
  // opening out to the full frame.
  const raise = glide(prog(t, 0, T.raise))
  const pan = glide(prog(t, T.swing[0], T.swing[1] - T.swing[0]))
  const out = glide(prog(t, T.open, T.end - T.open))
  const moving = Math.sin(Math.PI * clamp01((t - T.swing[0]) / (T.swing[1] - T.swing[0])))
  const from: View = { live: true }
  const to: View = { item: cur, i: open }
  // The eyepiece: from the whole frame in to its circle, and out again.
  const diag = Math.hypot(W, H) / 2 + 4 * u
  const cx = lerp(lerp(x0 + W / 2, L.cx, raise), x0 + W / 2, out)
  const cy = lerp(lerp(H / 2, L.cy, raise), H / 2, out)
  const R = lerp(lerp(diag, L.R, raise), diag, out)
  // How much nearer the glass sees, and how soft the world round it is.
  const M = lerp(lerp(1, L.zoom, raise), 1, out)
  const soft = raise * (1 - out)

  // The world round the glass: blurred and a little dark.
  g.fillStyle = '#08080a'
  g.fillRect(x0, 0, W, H)
  g.save()
  // (Blurred more as it swings, like a quick pan.)
  const bl = 14 * soft + 18 * moving
  if (bl > 0.2) g.filter = `blur(${(bl * u * c.px).toFixed(1)}px)`
  world(c, from, to, pan, 1.04, cx, cy, 1)
  g.filter = 'none'
  g.restore()
  if (soft > 0.01) {
    g.fillStyle = `rgba(6,6,8,${(0.42 * soft).toFixed(3)})`
    g.fillRect(x0, 0, W, H)
  }

  // The shadow the eyepiece throws on the world.
  if (soft > 0.01) {
    g.save()
    g.globalAlpha *= soft
    const sh = g.createRadialGradient(cx, cy, R * 0.98, cx, cy, R * 1.35)
    sh.addColorStop(0, 'rgba(0,0,0,0.7)')
    sh.addColorStop(1, 'rgba(0,0,0,0)')
    g.fillStyle = sh
    g.fillRect(x0, 0, W, H)
    g.restore()
  }

  // Through the glass: up close and sharp — softened a moment as it swings
  // and pulls focus after.
  g.save()
  g.beginPath()
  g.arc(cx, cy, R, 0, Math.PI * 2)
  g.clip()
  const focus = Math.max(moving * 0.9, 1 - clamp01((t - T.swing[1]) / 0.32)) * (t > T.swing[0] ? 1 : 0)
  if (focus > 0.02) g.filter = `blur(${(9 * focus * u * c.px).toFixed(1)}px)`
  world(c, from, to, pan, M, cx, cy, 1)
  g.filter = 'none'
  // Moving fast: a faint smear along the way it goes.
  if (moving > 0.3) {
    g.globalAlpha *= 0.16 * moving
    for (const o of [-1, 1]) {
      g.save()
      g.translate(o * 34 * u * moving, 0)
      world(c, from, to, pan, M, cx, cy, 1)
      g.restore()
    }
    g.globalAlpha = 1
  }
  // The lens: dark falling off at its rim, a faint reflection up on the left.
  if (soft > 0.01) {
    g.globalAlpha = soft
    const rim = g.createRadialGradient(cx, cy, R * 0.62, cx, cy, R)
    rim.addColorStop(0, 'rgba(0,0,0,0)')
    rim.addColorStop(0.8, 'rgba(0,0,0,0.22)')
    rim.addColorStop(1, 'rgba(0,0,0,0.7)')
    g.fillStyle = rim
    g.fillRect(cx - R, cy - R, R * 2, R * 2)
    const gl = g.createRadialGradient(cx - R * 0.45, cy - R * 0.5, 0, cx - R * 0.45, cy - R * 0.5, R * 0.75)
    gl.addColorStop(0, 'rgba(255,255,255,0.07)')
    gl.addColorStop(1, 'rgba(255,255,255,0)')
    g.fillStyle = gl
    g.fillRect(cx - R, cy - R, R * 2, R * 2)
    g.globalAlpha = 1
    reticle(c, cx, cy, R, soft * (1 - clamp01((t - T.open) / 0.25)))
  }
  g.restore()

  // The eyepiece's edge: a dark ring with a hair of colour fringe.
  if (soft > 0.01) {
    g.save()
    g.globalAlpha *= soft
    g.lineWidth = Math.max(2, L.R * 0.045)
    g.strokeStyle = '#0a0a0c'
    g.beginPath()
    g.arc(cx, cy, R + g.lineWidth / 2 - 1, 0, Math.PI * 2)
    g.stroke()
    g.lineWidth = 1.2 * u
    for (const [dx, col] of [
      [1.6, 'rgba(255,70,60,0.35)'],
      [-1.6, 'rgba(60,190,255,0.35)']
    ] as [number, string][]) {
      g.strokeStyle = col
      g.beginPath()
      g.arc(cx + dx * u, cy, R - 1.5 * u, 0, Math.PI * 2)
      g.stroke()
    }
    // The dial round it: fine ticks, turning a little as the scope swings.
    const turn = pan * 0.5 + (1 - raise) * -0.3
    g.strokeStyle = 'rgba(255,255,255,0.3)'
    for (let k = 0; k < 72; k++) {
      const a = (k / 72) * Math.PI * 2 + turn
      const long = k % 6 === 0
      const r0 = R * 1.06
      const r1 = R * (long ? 1.1 : 1.08)
      g.lineWidth = (long ? 1.6 : 1) * u
      g.beginPath()
      g.moveTo(cx + Math.cos(a) * r0, cy + Math.sin(a) * r0)
      g.lineTo(cx + Math.cos(a) * r1, cy + Math.sin(a) * r1)
      g.stroke()
    }
    // The button that swings it: a small chevron on the right.
    const bx = cx + R * 1.17
    const lit = clamp01(1 - Math.abs(t - T.swing[0]) / 0.25)
    g.strokeStyle = lit > 0 ? st.accent : 'rgba(255,255,255,0.55)'
    g.lineWidth = 2.4 * u
    g.lineCap = 'round'
    g.beginPath()
    g.moveTo(bx - 7 * u, cy - 12 * u)
    g.lineTo(bx + 5 * u, cy)
    g.lineTo(bx - 7 * u, cy + 12 * u)
    g.stroke()
    g.restore()
  }

  // The chapter's words beside the glass once it has swung there.
  const wordsIn = clamp01((t - T.swing[1] - 0.05) / 0.6)
  const wordsOut = 1 - clamp01((t - T.open) / 0.3)
  const wa = outCubic(wordsIn) * wordsOut * (1 - out)
  if (wa > 0.01 && cur) {
    const num = String(open + 1).padStart(2, '0')
    const tx = L.text.x
    const center = L.text.align === 'center'
    const mid = center ? tx + L.text.w / 2 : tx
    const size = L.text.size
    let y = L.text.y
    // The mark: the word and the number, spaced out, in the accent.
    g.save()
    g.globalAlpha *= wa
    g.font = `600 ${(size * 0.3).toFixed(1)}px "Inter", "Segoe UI", sans-serif`
    ;(g as CanvasRenderingContext2D).letterSpacing = `${(size * 0.1).toFixed(1)}px`
    g.fillStyle = st.accent
    g.textAlign = center ? 'center' : 'left'
    g.fillText(`${(b.title || 'CHAPTER').toUpperCase()} ${num} / ${String(n).padStart(2, '0')}`, mid, y)
    ;(g as CanvasRenderingContext2D).letterSpacing = '0px'
    // A hairline drawn out under it.
    const lw = L.text.w * 0.5 * outCubic(clamp01((t - T.swing[1]) / 0.7))
    g.fillRect(center ? mid - lw / 2 : tx, y + size * 0.22, lw, Math.max(1, 1.5 * u))
    g.restore()
    y += size * 0.35
    // The title, coming up from under a line.
    const titleK = outCubic(clamp01((t - T.swing[1] - 0.1) / 0.55))
    g.save()
    g.beginPath()
    g.rect(center ? x0 : tx - 10 * u, y, center ? W : L.text.w + 20 * u, size * 1.3)
    g.clip()
    g.globalAlpha *= wordsOut * (1 - out)
    text(c, cur.title, center ? mid : tx, y + size * 0.95 + (1 - titleK) * size * 1.2, { size, family: st.font, weight: 700, color: st.ink, maxW: L.text.w, ...(center ? { align: 'center' as const } : {}) })
    g.restore()
    if (cur.note) {
      const noteK = outCubic(clamp01((t - T.swing[1] - 0.3) / 0.5))
      const ny = y + size * 1.75
      text(c, cur.note, center ? mid : tx, ny, { size: size * 0.36, weight: 500, color: st.ink, alpha: 0.75 * noteK * wordsOut * (1 - out), maxW: L.text.w, ...(center ? { align: 'center' as const } : {}) })
    }
  }

  // The new chapter's footage, as the glass opens out.
  if (out > 0) {
    const k = clamp01((t - (T.end - 0.4)) / 0.35)
    if (k > 0 && c.live) {
      g.save()
      g.globalAlpha *= k
      g.beginPath()
      g.arc(cx, cy, R, 0, Math.PI * 2)
      g.clip()
      drawView(c, { live: true })
      g.restore()
    }
  }

  // Grain over it all, fading as the footage takes over.
  const gt = grainTile()
  g.save()
  g.globalAlpha *= 0.05 * soft
  g.globalCompositeOperation = 'overlay'
  const ox = Math.floor(((t * 97.3) % 1) * 192)
  const oy = Math.floor(((t * 61.7) % 1) * 192)
  const pat = g.createPattern(gt as CanvasImageSource, 'repeat')
  if (pat) {
    g.translate(-ox, -oy)
    g.fillStyle = pat
    g.fillRect(x0 + ox - 192, oy - 192, W + 384, H + 384)
  }
  g.restore()
}

/** The crosshair: fine lines with a gap in the middle, heavy posts from the
 *  rim, dots along the lines, a small mark of the accent at the centre. */
function reticle(c: Ctx, cx: number, cy: number, R: number, a: number): void {
  if (a <= 0.01) return
  const { g, u } = c
  g.save()
  g.globalAlpha *= a
  const ink = 'rgba(8,8,10,0.85)'
  g.strokeStyle = ink
  g.fillStyle = ink
  g.lineCap = 'butt'
  const gap = R * 0.07
  for (const [dx, dy] of [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1]
  ]) {
    // Heavy post from the rim in.
    g.lineWidth = Math.max(2, 6 * u)
    g.beginPath()
    g.moveTo(cx + dx * R, cy + dy * R)
    g.lineTo(cx + dx * R * 0.55, cy + dy * R * 0.55)
    g.stroke()
    // The fine line on to the middle.
    g.lineWidth = Math.max(1, 1.6 * u)
    g.beginPath()
    g.moveTo(cx + dx * R * 0.55, cy + dy * R * 0.55)
    g.lineTo(cx + dx * gap, cy + dy * gap)
    g.stroke()
    // Dots along it.
    for (let k = 1; k <= 4; k++) {
      const d = gap + ((R * 0.55 - gap) * k) / 5
      g.beginPath()
      g.arc(cx + dx * d, cy + dy * d, 2.6 * u, 0, Math.PI * 2)
      g.fill()
    }
  }
  // The centre: a small open chevron of the accent.
  g.strokeStyle = c.b.style.accent
  g.lineWidth = Math.max(1.5, 2.2 * u)
  g.beginPath()
  g.moveTo(cx - 9 * u, cy + 8 * u)
  g.lineTo(cx, cy)
  g.lineTo(cx + 9 * u, cy + 8 * u)
  g.stroke()
  g.restore()
}
