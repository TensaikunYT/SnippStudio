// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// Chapters as a cinema reel: the video shrinks into its frame on a reel of
// wide cinematic frames, the reel rolls down — the next chapter
// comes from above into the middle, its number large beside it, its title
// uncovered line by line — and then that frame opens to fill the screen and
// becomes the new chapter's footage. One take, no cut. The chapters, their
// pictures and words are yours; every chapter block shares them.

import { chapterLayout, chapterTimes, glide, homeOpens } from './model'
import { clamp01, drawCover, fontOf, imageOf, outCubic, prog, roundRect, text, type Ctx } from './draw'
import type { TemplateItem } from '../types'

type Rect = { x: number; y: number; w: number; h: number }
type Surface = HTMLCanvasElement | OffscreenCanvas
const lerp = (a: number, b: number, k: number): number => a + (b - a) * k

function surface(w: number, h: number): Surface {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(w, h)
  const cv = document.createElement('canvas')
  cv.width = w
  cv.height = h
  return cv
}

// A picture blurred for the room's light: drawn tiny once, then stretched.
const glows = new WeakMap<object, Surface>()
function glowOf(img: CanvasImageSource): Surface | null {
  const hit = glows.get(img as object)
  if (hit) return hit
  const cv = surface(24, 14)
  const g = cv.getContext('2d') as CanvasRenderingContext2D | null
  if (!g) return null
  try {
    g.drawImage(img, 0, 0, 24, 14)
  } catch {
    return null
  }
  glows.set(img as object, cv)
  return cv
}

// Film grain: one tile of noise, laid at a new offset every frame.
let grain: Surface | null = null
function grainTile(): Surface {
  if (grain) return grain
  const cv = surface(192, 192)
  const g = cv.getContext('2d') as CanvasRenderingContext2D
  const im = g.createImageData(192, 192)
  let s = 1234567
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

/** A chapter's picture filling r, or a deep gradient of the accent. */
function picture(c: Ctx, item: TemplateItem | undefined, i: number, r: Rect, zoom = 1): void {
  const g = c.g
  const img = imageOf(c, item)
  if (img) {
    drawCover(g, img, r.x, r.y, r.w, r.h, zoom)
    return
  }
  const gr = g.createLinearGradient(r.x, r.y, r.x + r.w, r.y + r.h)
  gr.addColorStop(0, i % 2 ? '#2b3445' : '#3a2f2a')
  gr.addColorStop(1, '#0e0f13')
  g.fillStyle = gr
  g.fillRect(r.x, r.y, r.w, r.h)
  g.fillStyle = 'rgba(255,255,255,0.06)'
  g.beginPath()
  g.arc(r.x + r.w * 0.72, r.y + r.h * 0.42, r.h * 0.3, 0, Math.PI * 2)
  g.fill()
}

/** The live video into a rect. */
function live(c: Ctx, r: Rect, alpha = 1): void {
  if (!c.live || alpha <= 0.002) return
  c.g.save()
  c.g.globalAlpha *= alpha
  c.g.drawImage(c.live, c.x0 * c.px, 0, c.W * c.px, c.H * c.px, r.x, r.y, r.w, r.h)
  c.g.restore()
}

export function drawChapter(c: Ctx): void {
  const { g, b, t, x0, W, H, u } = c
  const st = b.style
  const n = b.items.length
  const T = chapterTimes(b)
  const L = chapterLayout(b, x0, W, H, homeOpens(c.project, b))
  const open = L.open
  const cur = b.items[open]
  // How far the reel has moved (0: the old chapter in the middle, 1: the new).
  const slide = glide(prog(t, T.slide[0], T.slide[1] - T.slide[0]))
  // The video going in (0 → 1) and the new chapter opening out (0 → 1).
  const into = glide(prog(t, 0, T.land))
  const out = glide(prog(t, T.open, T.end - T.open))
  const mid = L.mid
  // The room: dark, lit by the chapter's own picture.
  g.fillStyle = '#08080a'
  g.fillRect(x0, 0, W, H)
  const img = imageOf(c, cur)
  const glow = img ? glowOf(img) : null
  if (glow) {
    g.save()
    g.globalAlpha *= 0.4 * slide
    g.imageSmoothingEnabled = true
    g.drawImage(glow as CanvasImageSource, x0 - W * 0.1, -H * 0.1, W * 1.2, H * 1.2)
    g.restore()
  }
  const vg = g.createRadialGradient(x0 + W / 2, H / 2, H * 0.2, x0 + W / 2, H / 2, Math.hypot(W, H) * 0.6)
  vg.addColorStop(0, 'rgba(8,8,10,0.1)')
  vg.addColorStop(1, 'rgba(8,8,10,0.85)')
  g.fillStyle = vg
  g.fillRect(x0, 0, W, H)

  // The reel: every frame at its place, the whole reel moved down as it is
  // pulled. Frame k sits (open - k) spacings above the middle before the
  // pull; the old one (open - 1) is in the middle.
  const frameAt = (k: number): Rect => ({ x: mid.x, y: mid.y - (k - (open - 1) - slide) * L.spacing, w: mid.w, h: mid.h })
  const blur = Math.sin(Math.PI * clamp01((t - T.slide[0]) / (T.slide[1] - T.slide[0])))
  const drawFrame = (k: number, r: Rect): void => {
    const d = Math.abs((r.y + r.h / 2 - (mid.y + mid.h / 2)) / L.spacing)
    if (d > 1.9) return
    const dim = Math.min(1, d) * 0.62
    const s = 1 - Math.min(1, d) * 0.08
    g.save()
    g.translate(r.x + r.w / 2, r.y + r.h / 2)
    g.scale(s, s)
    g.translate(-(r.x + r.w / 2), -(r.y + r.h / 2))
    g.save()
    g.shadowColor = 'rgba(0,0,0,0.75)'
    g.shadowBlur = 70 * u * c.px
    g.shadowOffsetY = 26 * u * c.px
    g.fillStyle = '#000'
    roundRect(g, r.x, r.y, r.w, r.h, 6 * u)
    g.fill()
    g.restore()
    g.save()
    roundRect(g, r.x, r.y, r.w, r.h, 6 * u)
    g.clip()
    if (k === open - 1 || (open === 0 && k === -1)) {
      // The chapter we are leaving: the video itself as it goes in, its own
      // picture once the reel has it.
      const fade = clamp01((t - T.land) / 0.35)
      if (k >= 0) picture(c, b.items[k], k, r)
      else {
        g.fillStyle = '#0e0f13'
        g.fillRect(r.x, r.y, r.w, r.h)
      }
      live(c, r, 1 - fade)
    } else if (k >= 0 && k < n) {
      // The chapter coming: a slow push in while it is up.
      picture(c, b.items[k], k, r, k === open ? 1 + 0.06 * clamp01((t - T.slide[1]) / (T.open - T.slide[1] + 0.8)) : 1)
    } else {
      g.fillStyle = '#0e0f13'
      g.fillRect(r.x, r.y, r.w, r.h)
    }
    // Words need a little dark on the left; frames away from the middle sit
    // back in the dark.
    const sh = g.createLinearGradient(r.x, 0, r.x + r.w * 0.7, 0)
    sh.addColorStop(0, 'rgba(0,0,0,0.6)')
    sh.addColorStop(1, 'rgba(0,0,0,0)')
    g.fillStyle = sh
    g.fillRect(r.x, r.y, r.w, r.h)
    if (dim > 0.01) {
      g.fillStyle = `rgba(0,0,0,${dim.toFixed(3)})`
      g.fillRect(r.x, r.y, r.w, r.h)
    }
    g.restore()
    g.restore()
  }
  // Only the frames near the middle; the one coming last so it is on top.
  const ks = [open - 2, open + 1, open - 1, open].filter((k) => k >= (open === 0 ? -1 : 0) && k < n)
  for (const k of ks) {
    const r = frameAt(k)
    if (blur > 0.05) {
      // Moving fast: a faint smear along the way it goes.
      g.save()
      g.globalAlpha *= 0.18 * blur
      for (const o of [-1, 1]) {
        g.save()
        g.translate(0, o * 18 * u * blur)
        drawFrame(k, r)
        g.restore()
      }
      g.restore()
    }
    drawFrame(k, r)
  }

  // The words of the new chapter, once it is in the middle.
  const r = frameAt(open)
  const wordsIn = clamp01((t - T.slide[1] + 0.25) / 0.6)
  const wordsOut = 1 - clamp01((t - T.open) / 0.3)
  const wa = outCubic(wordsIn) * wordsOut
  if (wa > 0.01 && cur) {
    const pad = r.h * 0.13
    const tx = r.x + pad
    // The number, large, half off the frame's left edge.
    const num = String(open + 1).padStart(2, '0')
    g.save()
    g.globalAlpha *= wa
    const ns = r.h * 0.62
    g.font = fontOf(ns, 'Anton', 400)
    g.textBaseline = 'alphabetic'
    g.textAlign = 'right'
    g.lineWidth = Math.max(1, 2.2 * u)
    g.strokeStyle = 'rgba(255,255,255,0.85)'
    const nx = r.x - r.w * 0.02 + (1 - outCubic(wordsIn)) * 30 * u
    if (!c.portrait) g.strokeText(num, nx, r.y + r.h * 0.5 + ns * 0.36)
    g.restore()
    // The chapter mark, the title uncovered from below, the note.
    g.save()
    g.globalAlpha *= wa
    g.font = `600 ${(r.h * 0.062).toFixed(1)}px "Inter", "Segoe UI", sans-serif`
    ;(g as CanvasRenderingContext2D).letterSpacing = `${(r.h * 0.02).toFixed(1)}px`
    g.fillStyle = st.accent
    g.textAlign = 'left'
    g.fillText(`${(b.title || 'CHAPTER').toUpperCase()} ${num}`, tx, r.y + r.h * 0.36)
    ;(g as CanvasRenderingContext2D).letterSpacing = '0px'
    g.restore()
    const titleK = outCubic(clamp01((t - T.slide[1] + 0.05) / 0.55))
    const size = r.h * 0.18
    g.save()
    g.beginPath()
    g.rect(tx - 10 * u, r.y + r.h * 0.4, r.w, size * 1.4)
    g.clip()
    g.globalAlpha *= wordsOut
    text(c, cur.title, tx, r.y + r.h * 0.4 + size * 0.95 + (1 - titleK) * size * 1.1, { size, family: st.font, weight: 700, color: st.ink, maxW: r.w * 0.66 })
    g.restore()
    if (cur.note) {
      const noteK = outCubic(clamp01((t - T.slide[1] - 0.2) / 0.5))
      text(c, cur.note, tx, r.y + r.h * 0.4 + size * 1.55, { size: r.h * 0.07, weight: 500, color: st.ink, alpha: 0.75 * noteK * wordsOut, maxW: r.w * 0.6 })
    }
    // A thin rule of the accent under the frame as it settles.
    g.save()
    g.globalAlpha *= wa
    g.fillStyle = st.accent
    g.fillRect(r.x, r.y + r.h + 10 * u, r.w * outCubic(clamp01((t - T.slide[1]) / 0.8)), 3 * u)
    g.restore()
  }

  // The rail on the right: a tick per chapter, the lit one moving with the reel.
  const rx = x0 + W * (c.portrait ? 0.95 : 0.93)
  const top = H * 0.32
  const bot = H * 0.68
  const at = (i: number): number => bot - ((bot - top) * i) / Math.max(1, n - 1)
  g.save()
  g.globalAlpha *= into * (1 - out)
  g.fillStyle = 'rgba(255,255,255,0.16)'
  g.fillRect(rx - 0.75 * u, top, 1.5 * u, bot - top)
  const f = Math.max(0, open - 1 + slide)
  for (let i = 0; i < n; i++) {
    g.fillStyle = i <= f + 0.01 ? st.accent : 'rgba(255,255,255,0.35)'
    g.fillRect(rx - 6 * u, at(i) - 1 * u, 12 * u, 2 * u)
  }
  g.fillStyle = st.accent
  roundRect(g, rx - 3 * u, at(Math.min(n - 1, f)) - 14 * u, 6 * u, 28 * u, 3 * u)
  g.fill()
  g.restore()

  // Letterbox bars, in with the reel and out as the chapter opens.
  const bar = H * 0.085 * into * (1 - out)
  if (bar > 0.5) {
    g.fillStyle = '#000'
    g.fillRect(x0, 0, W, bar)
    g.fillRect(x0, H - bar, W, bar)
  }

  // Going in: the video from the full frame into the old chapter's place.
  if (into < 1) {
    const r0 = frameAt(open - 1)
    const full: Rect = { x: x0, y: 0, w: W, h: H }
    const rr: Rect = { x: lerp(full.x, r0.x, into), y: lerp(full.y, r0.y, into), w: lerp(full.w, r0.w, into), h: lerp(full.h, r0.h, into) }
    g.save()
    roundRect(g, rr.x, rr.y, rr.w, rr.h, 6 * u * into)
    g.clip()
    live(c, rr)
    g.restore()
  }
  // Coming out: the new chapter's frame opens to the full frame and turns
  // into its footage.
  if (out > 0) {
    const r1 = frameAt(open)
    const full: Rect = { x: x0, y: 0, w: W, h: H }
    const rr: Rect = { x: lerp(r1.x, full.x, out), y: lerp(r1.y, full.y, out), w: lerp(r1.w, full.w, out), h: lerp(r1.h, full.h, out) }
    g.save()
    roundRect(g, rr.x, rr.y, rr.w, rr.h, 6 * u * (1 - out))
    g.clip()
    picture(c, cur, open, rr, 1.06)
    live(c, rr, clamp01((t - (T.end - 0.4)) / 0.35))
    g.restore()
  }

  // Grain over it all, and a breath of flicker — the reel is film.
  const gt = grainTile()
  g.save()
  g.globalAlpha *= 0.055 * (1 - clamp01((t - (T.end - 0.3)) / 0.3))
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
