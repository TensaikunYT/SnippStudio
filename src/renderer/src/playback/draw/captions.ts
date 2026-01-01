// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// Subtitles and texts: lines, layers, word animation, emoji, the marker
// highlight, the hand-drawn wobble. Moved out of playback/render.ts in
// SnippStudio phase 2B (no change).
import { markerCoversWord, markerRevealProgress } from '../../subtitles/marker'
import { captionMarker } from '../../subtitles/keywords'
import type { Caption, CaptionStyle, Project } from '../../types'
import { captionMotionAt } from '../pose'
import { trackerPosAt } from './core'
import type { Ctx2D } from './core'
import { speedRamp } from './timing'

/** A pen stroke's pace: it lands moving and eases to a stop (no slow start). */
export const penEase = (p: number): number => {
  const x = Math.min(1, Math.max(0, p))
  return 1 - (1 - x) ** 2.6
}

export const markerRgb = (hex: string): [number, number, number] => {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim())
  if (!m) return [241, 239, 0]
  const s = m[1].length === 3 ? m[1].replace(/./g, (c) => c + c) : m[1]
  const n = parseInt(s, 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}
export const markerCss = (c: [number, number, number], k: number, a: number): string =>
  `rgba(${Math.round(c[0] * k)},${Math.round(c[1] * k)},${Math.round(c[2] * k)},${Math.max(0, Math.min(1, a)).toFixed(3)})`

/** Where a highlighter's ink pools it is richer, not dirtier: the colour a
 *  little warmer round the wheel, more saturated, a touch deeper (amt 0..1). */
export function markerDeep(c: [number, number, number], amt: number, a: number): string {
  const [r, g, b] = c.map((v) => v / 255)
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  let h = 0
  let s = 0
  const l0 = (max + min) / 2
  if (max !== min) {
    const d = max - min
    s = l0 > 0.5 ? d / (2 - max - min) : d / (max + min)
    h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4
    h /= 6
  }
  h = (((h - (8 / 360) * amt) % 1) + 1) % 1
  s = Math.min(1, s + 0.12 * amt)
  const l = Math.max(0, l0 - 0.07 * amt)
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s
  const p = 2 * l - q
  const f = (t: number): number => {
    const x = ((t % 1) + 1) % 1
    return x < 1 / 6 ? p + (q - p) * 6 * x : x < 0.5 ? q : x < 2 / 3 ? p + (q - p) * (2 / 3 - x) * 6 : p
  }
  return `rgba(${Math.round(f(h + 1 / 3) * 255)},${Math.round(f(h) * 255)},${Math.round(f(h - 1 / 3) * 255)},${Math.max(0, Math.min(1, a)).toFixed(3)})`
}

/** Is a marker colour light enough for dark words on it? */
export const markerIsLight = (color: string): boolean => {
  const [r, g, b] = markerRgb(color)
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255 > 0.55
}

/**
 * Editorial highlighter: a bright, clean band laid down left to right by a
 * chisel tip — its ends cut at the tip's slant and softly rounded, the band
 * tilted a hair, its edges only just uneven (fixed per word by `seed`, so
 * they never shimmer). The ink is a touch denser where the tip landed and
 * along the edges, with a faint sheen along the felt; while it is drawing,
 * the leading edge is wet. Returns a tracer for the drawn band (for clipping
 * the words over it), or null when nothing is drawn yet. Preview and export
 * use this same geometry at every frame.
 */
export function drawMarkerStroke(
  ctx: Ctx2D,
  cx: number,
  cy: number,
  w: number,
  h: number,
  reveal: number,
  color: string,
  alpha: number,
  seed = 0
): (() => void) | null {
  if (w <= 0 || h <= 0 || reveal <= 0) return null
  const r = Math.min(1, Math.max(0, reveal))
  const rnd = (k: number): number => {
    const x = Math.sin((seed + 1) * 12.9898 + k * 78.233) * 43758.5453
    return x - Math.floor(x)
  }
  const tilt = (rnd(1) - 0.5) * 0.03
  const cos = Math.cos(tilt)
  const sin = Math.sin(tilt)
  const at = (x: number, y: number): [number, number] => [cx + x * cos - y * sin, cy + x * sin + y * cos]
  const x0 = -w / 2
  const xr = x0 + w * r
  // The tip landing: over its first half-height of travel the band comes up
  // to its full height and ink, so the very first frame is no sliver.
  const land = Math.min(1, (w * r) / (h * 0.55))
  h *= 0.72 + 0.28 * land
  const slant = Math.min(h * 0.16, w * 0.1)
  // The edges' unevenness, sampled at fixed places along the whole stroke.
  const N = Math.max(3, Math.ceil(w / (h * 0.9)))
  const wob = (i: number, side: number): number => (rnd(10 + i * 2 + side) - 0.5) * h * 0.05
  const top: [number, number][] = []
  const bot: [number, number][] = []
  for (let i = 0; i <= N; i++) {
    const x = x0 + (w * i) / N
    if (x >= xr) break
    top.push([x, -h / 2 + wob(i, 0)])
    bot.push([x, h / 2 + wob(i, 1)])
  }
  const lastTop = wob(Math.min(N, Math.floor((r * N))), 0)
  const lastBot = wob(Math.min(N, Math.floor((r * N))), 1)
  // The tip's slanted edge: top runs ahead of the bottom.
  const lead = Math.min(slant, xr - x0)
  const trace = (): void => {
    const pts: [number, number][] = []
    // The start: cut at the slant (bottom-left ahead of top-left), rounded.
    pts.push([x0 + Math.min(slant, xr - x0) * 0.5, -h / 2 + wob(0, 0)])
    for (const p of top.slice(1)) pts.push(p)
    pts.push([xr, -h / 2 + lastTop])
    pts.push([xr - lead * 0.55, h / 2 + lastBot])
    for (let i = bot.length - 1; i >= 1; i--) pts.push(bot[i])
    pts.push([x0 - Math.min(slant, xr - x0) * 0.1, h / 2 + wob(0, 1)])
    // Smooth through the midpoints so nothing is a hard corner.
    const P = pts.map(([x, y]) => at(x, y))
    const mid = (a: [number, number], b: [number, number]): [number, number] => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]
    const m0 = mid(P[P.length - 1], P[0])
    ctx.moveTo(m0[0], m0[1])
    for (let i = 0; i < P.length; i++) {
      const p = P[i]
      const m = mid(p, P[(i + 1) % P.length])
      ctx.quadraticCurveTo(p[0], p[1], m[0], m[1])
    }
    ctx.closePath()
  }
  const rgb = markerRgb(color)
  const [ax, ay] = at(x0, 0)
  const [bx, by] = at(x0 + w, 0)
  const [tx, ty] = at(0, -h / 2)
  const [ux, uy] = at(0, h / 2)
  ctx.save()
  ctx.globalAlpha *= alpha * (land * land * (3 - 2 * land))
  // The band itself, bright and clean — lifted off a busy picture by the
  // softest shadow (unless it was given one of its own).
  ctx.beginPath()
  trace()
  ctx.fillStyle = color
  if (!ctx.shadowBlur) {
    ctx.shadowColor = 'rgba(0,0,0,0.22)'
    ctx.shadowBlur = h * 0.22
    ctx.shadowOffsetY = h * 0.05
  }
  ctx.fill()
  ctx.shadowOffsetY = 0
  ctx.shadowColor = 'transparent'
  ctx.shadowBlur = 0
  ctx.clip()
  // Denser where the tip landed (and, finished, where it lifted).
  const along = ctx.createLinearGradient(ax, ay, bx, by)
  along.addColorStop(0, markerDeep(rgb, 1, 0.6))
  along.addColorStop(Math.min(0.5, (h * 0.9) / w), markerDeep(rgb, 1, 0))
  along.addColorStop(Math.max(0.5, 1 - (h * 0.7) / w), markerDeep(rgb, 1, 0))
  along.addColorStop(1, markerDeep(rgb, 1, r >= 1 ? 0.45 : 0))
  ctx.fillStyle = along
  ctx.fillRect(cx - w, cy - h, w * 2, h * 2)
  // Denser along both edges, a soft sheen down the middle of the felt.
  const across = ctx.createLinearGradient(tx, ty, ux, uy)
  across.addColorStop(0, markerDeep(rgb, 1, 0.55))
  across.addColorStop(0.17, markerDeep(rgb, 1, 0))
  across.addColorStop(0.4, 'rgba(255,255,255,0.1)')
  across.addColorStop(0.56, 'rgba(255,255,255,0)')
  across.addColorStop(0.83, markerDeep(rgb, 1, 0))
  across.addColorStop(1, markerDeep(rgb, 1, 0.6))
  ctx.fillStyle = across
  ctx.fillRect(cx - w, cy - h, w * 2, h * 2)
  // While drawing: the wet leading edge.
  if (r < 1) {
    const [lx0, ly0] = at(xr - h * 0.9, 0)
    const [lx1, ly1] = at(xr, 0)
    const wet = ctx.createLinearGradient(lx0, ly0, lx1, ly1)
    wet.addColorStop(0, markerDeep(rgb, 1, 0))
    wet.addColorStop(1, markerDeep(rgb, 1, 0.6))
    ctx.fillStyle = wet
    ctx.fillRect(cx - w, cy - h, w * 2, h * 2)
  }
  ctx.restore()
  // Still landing (faint): the words stay as they are a moment longer.
  return land >= 0.6 ? trace : null
}

/**
 * The words over a light marker turn dark where the band has reached: drawn
 * again, clipped to the band — the outline in the marker's colour (so no
 * black halo sits on it), the letters in a deep shade of it.
 */
export function inkOverMarker(ctx: Ctx2D, trace: () => void, color: string, draw: (ink: string, outline: string) => void): void {
  if (!markerIsLight(color)) return
  ctx.save()
  ctx.beginPath()
  trace()
  ctx.clip()
  ctx.shadowColor = 'transparent'
  ctx.shadowBlur = 0
  draw(markerCss(markerRgb(color), 0.13, 1), color)
  ctx.restore()
}

/** A caption's font as the canvas takes it. Upright (no `italic`): the same
 *  words as always, so nothing drawn before the field existed changes. */
export function captionFont(style: Pick<CaptionStyle, 'fontWeight' | 'fontFamily' | 'italic'>, px: number): string {
  return `${style.italic ? 'italic ' : ''}${style.fontWeight} ${px}px "${style.fontFamily}", sans-serif`
}

export function wrapCaption(text: string, maxChars: number): string[] {
  const words = text.split(/\s+/).filter(Boolean)
  const lines: string[] = []
  let line = ''
  for (const word of words) {
    if (line && line.length + 1 + word.length > maxChars) {
      lines.push(line)
      line = word
    } else {
      line = line ? line + ' ' + word : word
    }
  }
  if (line) lines.push(line)
  return lines
}

export function hexToRgba(hex: string, alpha: number): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex)
  if (!m) return hex
  const n = parseInt(m[1], 16)
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`
}

export const captionLayerOrder = new WeakMap<Caption[], Caption[]>()
/** The captions in draw order (low layer first, start order within a layer),
 *  cached against the array itself — a new one appears on every edit. */
export function captionsByLayer(captions: Caption[]): Caption[] {
  let sorted = captionLayerOrder.get(captions)
  if (!sorted) {
    sorted = [...captions].sort((a, b) => (a.layer ?? 0) - (b.layer ?? 0))
    captionLayerOrder.set(captions, sorted)
  }
  return sorted
}

/** "money=💰, warning=⚠️" → lookup map (cached per rules string). */
export let emojiRulesCache: { src: string; map: Map<string, string> } | null = null
export function parseEmojiRules(rules: string): Map<string, string> {
  if (emojiRulesCache?.src === rules) return emojiRulesCache.map
  const map = new Map<string, string>()
  for (const part of rules.split(/[,\n;]+/)) {
    const [k, v] = part.split('=')
    if (k && v && k.trim() && v.trim()) map.set(k.trim().toLowerCase(), v.trim())
  }
  emojiRulesCache = { src: rules, map }
  return map
}

/**
 * Deterministic pseudo-random in [-1, 1] from two integers.
 *
 * Deterministic is the whole requirement: the preview and the export draw the
 * same frame from the same numbers, and anything reaching for Math.random
 * would give you a wobble that looked different every time you rendered it.
 */
export function hash2(a: number, b: number): number {
  const n = Math.sin(a * 127.1 + b * 311.7) * 43758.5453
  return (n - Math.floor(n)) * 2 - 1
}

/** No entrance: full opacity, no offset. */
export const NEUTRAL_DELTA = { alpha: 1, tx: 0, ty: 0, sc: 1, rot: 0, blur: 0 }

export interface BoilOffset {
  dx: number
  dy: number
  rot: number
  scale: number
  /** Multiplier on the outline width, for the ink to vary with the line. */
  ink: number
}

export const NO_BOIL: BoilOffset = { dx: 0, dy: 0, rot: 0, scale: 1, ink: 1 }

/**
 * One character's wobble at `time`.
 *
 * The clock is quantised to the boil rate, so the letters HOLD and then jump —
 * which is what hand-drawn animation does, and what separates ink from a sine
 * wave. Everything scales with the type size so it looks the same at any size.
 */
export function boilAt(
  style: CaptionStyle,
  charIndex: number,
  time: number,
  fontSize: number
): BoilOffset {
  const b = style.boil
  if (!b?.enabled) return NO_BOIL
  const amount = Math.max(0, b.amount ?? 1)
  if (amount <= 0) return NO_BOIL
  const fps = Math.max(1, Math.min(30, b.fps ?? 10))
  const frame = Math.floor(time * fps)
  const k = amount * fontSize
  return {
    dx: hash2(charIndex, frame) * k * 0.012,
    dy: hash2(charIndex + 91, frame) * k * 0.012,
    rot: hash2(charIndex + 173, frame) * amount * 0.012,
    scale: 1 + hash2(charIndex + 251, frame) * amount * 0.008,
    ink: 1 + hash2(charIndex + 337, frame) * amount * 0.12
  }
}

export function drawCaptions(
  ctx: Ctx2D,
  captions: Caption[],
  baseStyle: CaptionStyle,
  time: number,
  outW: number,
  outH: number,
  renderScale = 1,
  /** Optional horizontal region (e.g. the shorts window) captions center in. */
  region?: { centerX: number; width: number },
  /** Motion trackers, for captions with a trackerId. */
  trackers?: Project['trackers']
): void {
  // Sorted by LAYER, low to high: a marker on layer 1 has to draw under the
  // text on layer 2. They were drawn in project order — which is start time —
  // so whether a highlight landed behind or in front of a word depended on
  // which of the two happened to start first. Stable, so order within a layer
  // is still start order.
  // Sorted ONCE per captions array, not once per frame. Filtering keeps
  // relative order, so sorting the whole list and then filtering gives exactly
  // what filtering and then sorting gave — without re-sorting every subtitle in
  // a twenty-minute transcript sixty times a second.
  const active = captionsByLayer(captions).filter((c) => time >= c.start && time < c.end)
  if (active.length === 0) return
  ctx.setTransform(renderScale, 0, 0, renderScale, 0, 0)

  const scale = outH / 1080
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.lineJoin = 'round'

  // Eased overshoot for the pop-in (back ease, strength from intensity).
  const popScale = (p: number, intensity: number): number => {
    const c = 1.2 * intensity
    const q = p - 1
    const back = 1 + (c + 1) * q * q * q + c * q * q
    return 0.35 + 0.65 * back
  }

  for (const caption of active) {
    // Manual text may carry its own full style override, independent of the
    // auto-subtitle style; any line can have its own place and font.
    const own = caption.style ?? baseStyle
    const style: CaptionStyle =
      caption.place || caption.font
        ? {
            ...own,
            ...(caption.font ? { fontFamily: caption.font } : {}),
            ...(caption.place ? { posX: caption.place === 'left' ? 0.28 : caption.place === 'right' ? 0.72 : 0.5, align: caption.place } : {})
          }
        : own
    let fontSize = style.fontSize * scale
    ctx.font = captionFont(style, fontSize)
    // Letter spacing (Chromium canvas supports this directly).
    try {
      ;(ctx as CanvasRenderingContext2D).letterSpacing = `${(style.letterSpacing ?? 0) * scale}px`
    } catch {
      /* older engines */
    }
    let lineHeight = fontSize * (style.lineHeight ?? 1.25)
    // Fit-to-width: shrink until the widest line is inside the given fraction
    // of the frame. Measured with the SAME wrap rule both draw paths use, so
    // the size the words are laid out at is the size that was measured.
    const fitFrac = style.fitWidth ?? 0
    if (fitFrac > 0) {
      const src = style.uppercase ? caption.text.toUpperCase() : caption.text
      const testLines = src
        .split(/\r?\n/)
        .flatMap((seg) => (seg.trim() ? wrapCaption(seg, style.maxLineChars) : ['']))
      const widest = Math.max(1, ...testLines.map((l) => ctx.measureText(l).width))
      const maxW = fitFrac * (region?.width ?? outW)
      if (widest > maxW) {
        fontSize = Math.max(8 * scale, fontSize * (maxW / widest))
        ctx.font = captionFont(style, fontSize)
        lineHeight = fontSize * (style.lineHeight ?? 1.25)
      }
    }
    // Per-caption horizontal anchor (manual text is draggable in the preview),
    // plus the motion-tracker ride when attached.
    let capDx = 0
    let capDy = 0
    if (caption.trackerId && trackers) {
      const trk = trackers.find((tk) => tk.id === caption.trackerId)
      if (trk && trk.keyframes.length > 0) {
        const kfs = [...trk.keyframes].sort((a, b) => a.time - b.time)
        const pos = trackerPosAt(kfs, time)
        capDx = pos.x - kfs[0].x
        capDy = pos.y - kfs[0].y
      }
    }
    // Keyframed (or static) motion offsets, on top of the placement.
    const motion = captionMotionAt(caption, time - caption.start)
    const capX =
      (region
        ? region.centerX + (caption.place ? ((style.posX ?? 0.5) - 0.5) * 0.8 * region.width : 0)
        : (style.posX ?? 0.5) * outW) +
      capDx +
      motion.x

    /** Does this text sit on a box (a fill or a border)? */
    const boxed = style.bgOpacity > 0 || (!!style.bgBorder && style.bgBorder.width > 0)
    const drawWord = (
      word: string,
      x: number,
      y: number,
      color?: string | CanvasGradient,
      /** Outline thickness multiplier — the ink varying letter to letter. */
      inkMul = 1
    ) => {
      const sh = style.shadow
      // A text on a box: the box casts the shadow (drawBg), not the letters;
      // their shadow on the box read as a second, offset copy of the words
      // (the user's "Label" look, yazı paneli).
      if (sh?.enabled && !boxed) {
        ctx.shadowColor = sh.color
        ctx.shadowBlur = sh.blur * scale
        ctx.shadowOffsetX = sh.dx * scale
        ctx.shadowOffsetY = sh.dy * scale
      }
      if (style.outlineWidth > 0) {
        ctx.strokeStyle = style.outlineColor
        ctx.lineWidth = style.outlineWidth * scale * inkMul
        ctx.strokeText(word, x, y)
        // Shadow already cast by the stroke pass; don't double it.
        if (sh?.enabled) ctx.shadowColor = 'transparent'
      }
      // An explicit colour (the karaoke highlight) wins; otherwise a gradient
      // fill if there is one. The gradient is built around THIS draw's own box,
      // so it works the same whether the word is drawn in absolute coordinates
      // (static text) or inside a per-word transform (the pop-up path).
      const grad = style.gradient
      if (color) {
        ctx.fillStyle = color
      } else if (grad?.enabled) {
        const a = ((grad.angle ?? 0) * Math.PI) / 180
        const halfW = ctx.measureText(word).width / 2
        const dx = Math.cos(a) * halfW
        const dy = Math.sin(a) * (fontSize / 2)
        const g = ctx.createLinearGradient(x - dx, y - dy, x + dx, y + dy)
        g.addColorStop(0, grad.from)
        g.addColorStop(1, grad.to)
        ctx.fillStyle = g
      } else {
        ctx.fillStyle = style.color
      }
      ctx.fillText(word, x, y)
      ctx.shadowColor = 'transparent'
      ctx.shadowBlur = 0
      ctx.shadowOffsetX = 0
      ctx.shadowOffsetY = 0
    }
    // Optional emoji decoration ("money=💰, warning=⚠️").
    const emojiMap = style.emoji?.enabled ? parseEmojiRules(style.emoji.rules) : null
    const decorate = (w: string): string => {
      if (!emojiMap) return w
      const e = emojiMap.get(w.toLowerCase().replace(/[^\p{L}\p{N}]/gu, ''))
      return e ? `${w} ${e}` : w
    }
    const border = style.bgBorder
    const drawBg = (lineWidth: number, y: number, x = capX) => {
      const hasFill = style.bgOpacity > 0
      const hasBorder = !!border && border.width > 0
      if (!hasFill && !hasBorder) return
      const sh = style.shadow
      const padX = fontSize * (style.bgPadX ?? 0.35)
      const padY = fontSize * (style.bgPadY ?? 0.18)
      const bx = x - lineWidth / 2 - padX
      const by = y - lineHeight / 2 - padY + (lineHeight - fontSize) / 2
      const bw = lineWidth + padX * 2
      const bh = fontSize + padY * 2
      const radius = Math.min((style.bgRadius ?? 0) * scale, bw / 2, bh / 2)
      ctx.beginPath()
      if (radius > 0.5 && typeof ctx.roundRect === 'function') ctx.roundRect(bx, by, bw, bh, radius)
      else ctx.rect(bx, by, bw, bh)
      if (sh?.enabled) {
        ctx.shadowColor = sh.color
        ctx.shadowBlur = sh.blur * scale
        ctx.shadowOffsetX = sh.dx * scale
        ctx.shadowOffsetY = sh.dy * scale
      }
      if (hasFill) {
        ctx.fillStyle = hexToRgba(style.bgColor, style.bgOpacity)
        ctx.fill()
        // One shadow per box: the border must not cast a second one.
        ctx.shadowColor = 'transparent'
      }
      if (hasBorder) {
        ctx.strokeStyle = border!.color
        ctx.lineWidth = border!.width * scale
        ctx.stroke()
      }
      ctx.shadowColor = 'transparent'
      ctx.shadowBlur = 0
      ctx.shadowOffsetX = 0
      ctx.shadowOffsetY = 0
    }

    // The marker is an independent background decoration. It must never clip
    // glyphs or switch off karaoke, entrance motion, or the caption's timing.
    // Its own marker, or (a subtitle) its key words.
    const capMarker = captionMarker(caption, captions, baseStyle)
    // The pen keeps its pace: the sweep setting is for a word of about six
    // letters; a short word is done sooner, a long run takes longer.
    const penTime = (sweep: number, width: number): number => sweep * Math.min(1.8, Math.max(0.5, width / (fontSize * 0.55 * 6)))
    // Each word's stroke its own small unevenness, the same every frame.
    let capSeed = 0
    for (let k = 0; k < caption.id.length; k++) capSeed = (capSeed * 31 + caption.id.charCodeAt(k)) % 9973
    const drawWordMarker = (index: number, x: number, y: number, width: number): (() => void) | null => {
      const marker = capMarker
      if (!markerCoversWord(marker, index)) return null
      const onset = caption.words?.[index]?.start ?? caption.start
      const progress = markerRevealProgress(time, onset, caption.end, penTime(marker!.duration || 0.48, width))
      if (progress <= 0) return null
      return drawMarkerStroke(ctx, x, y + fontSize * 0.01, width + fontSize * 0.4, fontSize * 1.1, progress, marker!.color || '#f1ef00', 1, capSeed + index * 7)
    }
    /** The marked words of a line, side by side ones as ONE stroke (it starts
     *  as the first is said and runs on through the rest): each stroke's
     *  tracer, with the words it covers. */
    const drawMarkerRuns = (
      words: { index: number; left: number; right: number; text: string }[],
      y: number
    ): { trace: () => void; words: { text: string; x: number }[] }[] => {
      const out: { trace: () => void; words: { text: string; x: number }[] }[] = []
      const marker = capMarker
      if (!marker?.enabled) return out
      let k = 0
      while (k < words.length) {
        if (!markerCoversWord(marker, words[k].index)) {
          k++
          continue
        }
        let j = k
        while (j + 1 < words.length && markerCoversWord(marker, words[j + 1].index)) j++
        const first = words[k]
        const last = words[j]
        if (j === k) {
          const trace = drawWordMarker(first.index, (first.left + first.right) / 2, y, first.right - first.left)
          if (trace) out.push({ trace, words: [{ text: first.text, x: (first.left + first.right) / 2 }] })
        } else {
          const onset = caption.words?.[first.index]?.start ?? caption.start
          const progress = markerRevealProgress(time, onset, caption.end, penTime(marker.duration || 0.48, last.right - first.left))
          const trace =
            progress > 0
              ? drawMarkerStroke(ctx, (first.left + last.right) / 2, y + fontSize * 0.01, last.right - first.left + fontSize * 0.4, fontSize * 1.1, progress, marker.color || '#f1ef00', 1, capSeed + first.index * 7)
              : null
          if (trace) out.push({ trace, words: words.slice(k, j + 1).map((w) => ({ text: w.text, x: (w.left + w.right) / 2 })) })
        }
        k = j + 1
      }
      return out
    }

    // Word-level layout is used for the pop-up animation AND for the karaoke
    // highlight (both need each word drawn separately).
    const popupOn = style.popup?.enabled ?? false
    const boilOn = !!style.boil?.enabled && (style.boil.amount ?? 1) > 0
    /**
     * Draws a word letter by letter, each with its own wobble — or in one go
     * when boiling is off, which is the same call it always was. Letters keep
     * the positions the layout gave them: the wobble is a transform around each
     * glyph, never a change to how wide it is, so the text cannot reflow.
     */
    const drawInk = (
      word: string,
      x: number,
      y: number,
      color?: string | CanvasGradient,
      seed = 0
    ): void => {
      if (!boilOn) {
        drawWord(word, x, y, color)
        return
      }
      const chars = Array.from(word)
      let cx = x - ctx.measureText(word).width / 2
      for (let i = 0; i < chars.length; i++) {
        const ch = chars[i]
        const cw = ctx.measureText(ch).width
        if (ch !== ' ') {
          const bo = boilAt(style, seed + i, time, fontSize)
          const px = cx + cw / 2
          ctx.save()
          if (bo.rot !== 0 || bo.scale !== 1) {
            ctx.translate(px, y)
            ctx.rotate(bo.rot)
            ctx.scale(bo.scale, bo.scale)
            ctx.translate(-px, -y)
          }
          drawWord(ch, px + bo.dx, y + bo.dy, color, bo.ink)
          ctx.restore()
        }
        cx += cw
      }
    }
    const popup = (popupOn || style.highlight?.enabled) && caption.words && caption.words.length > 0
    const centerY = style.posY * outH + capDy + motion.y
    // Static rotation, applied around the caption's own anchor so the text
    // turns in place. Wraps everything below — word-by-word popup included.
    // Blend mode for the whole caption. Reset at both exits below — a leaked
    // composite operation would repaint everything drawn after it.
    const blend = style.blend && style.blend !== 'normal' ? style.blend : null
    if (blend) ctx.globalCompositeOperation = blend as GlobalCompositeOperation
    const capRotate = (style.rotate ?? 0) + motion.rot
    // One wrapper for rotation, scale and the motion's opacity — pivoting at
    // the caption's own anchor so it turns and grows in place.
    const capXf = capRotate !== 0 || motion.scale !== 1 || motion.opacity < 1
    if (capXf) {
      ctx.save()
      ctx.globalAlpha *= Math.max(0, Math.min(1, motion.opacity))
      ctx.translate(capX, centerY)
      if (capRotate !== 0) ctx.rotate(capRotate)
      if (motion.scale !== 1) ctx.scale(motion.scale, motion.scale)
      ctx.translate(-capX, -centerY)
    }

    if (!popup) {
      // Manual text can have smooth entrance/exit animations + idle motion.
      const a = caption.anim
      const inDur = a?.inDur ?? (a?.in === 'note' ? 0.45 : 0.35)
      const outDur = a?.outDur ?? (a?.out === 'note' ? 0.45 : 0.35)
      let alpha = 1
      let tx = 0
      let ty = 0
      let sc = 1
      let rot = 0
      let blurPx = 0
      /** The offsets one entrance/exit style produces at eased progress `e`
       *  (1 = fully settled). Pure, so a per-character pass can ask for the
       *  same numbers at a different progress without disturbing the block. */
      const animDeltas = (
        name: string,
        e: number
      ): { alpha: number; tx: number; ty: number; sc: number; rot: number; blur: number } => {
        const inv = 1 - e
        const d = { alpha: e, tx: 0, ty: 0, sc: 1, rot: 0, blur: 0 }
        switch (name) {
          case 'slide':
            d.ty += inv * fontSize * 1.2
            break
          case 'zoom':
            d.sc *= 0.82 + 0.18 * e
            break
          case 'note':
            d.tx -= inv * fontSize * 2.2
            d.ty += inv * fontSize * 0.9
            break
          case 'pop':
            d.sc *= 0.5 + 0.5 * e + Math.sin(e * Math.PI) * 0.14
            break
          case 'blur':
            d.blur += inv * fontSize * 0.35
            break
          case 'drop':
            d.ty -= inv * fontSize * 1.6
            break
          case 'spin':
            d.rot += inv * 0.6
            d.sc *= 0.6 + 0.4 * e
            break
          case 'grow':
            d.sc *= e
            break
          // 'fade' → alpha only.
        }
        return d
      }
      // Applies one entrance/exit style at eased progress e (1 = settled).
      const applyAnim = (style: string, e: number): void => {
        alpha *= e
        const inv = 1 - e
        switch (style) {
          case 'slide':
            ty += inv * fontSize * 1.2
            break
          case 'zoom':
            sc *= 0.82 + 0.18 * e
            break
          case 'note':
            tx -= inv * fontSize * 2.2
            ty += inv * fontSize * 0.9
            break
          case 'pop':
            sc *= 0.5 + 0.5 * e + Math.sin(e * Math.PI) * 0.14
            break
          case 'blur':
            blurPx += inv * fontSize * 0.35
            break
          case 'drop':
            ty -= inv * fontSize * 1.6
            break
          case 'spin':
            rot += inv * 0.6
            sc *= 0.6 + 0.4 * e
            break
          case 'grow':
            sc *= e
            break
          // 'fade' → alpha only (already applied).
        }
      }
      // Per-character entrance: the BLOCK stays still and each letter animates
      // on its own delay, so the whole-block entrance is skipped.
      const charAnimName = a?.in && a.in !== 'none' ? a.in : 'fade'
      const charStagger = Math.max(0, a?.charStagger ?? 0.03)
      // Is there an entrance to animate PER CHARACTER, as opposed to the loop
      // simply being needed for something else?
      const charEntrance = !!a?.perChar && !!a?.in && a.in !== 'none'
      // Boiling needs the same letter-by-letter loop a per-character entrance
      // needs, so it turns it on too — and the two compose, because both are
      // just offsets applied to a glyph that stays where the layout put it.
      const perChar = charEntrance || boilOn
      let charIndex = 0
      if (!perChar && a?.in && a.in !== 'none' && time < caption.start + inDur) {
        const p = Math.min(1, Math.max(0, (time - caption.start) / inDur))
        applyAnim(a.in, p * p * (3 - 2 * p))
      }
      if (a?.out && a.out !== 'none' && time > caption.end - outDur) {
        const p = Math.min(1, Math.max(0, (caption.end - time) / outDur))
        applyAnim(a.out, p * p * (3 - 2 * p))
      }
      // Idle motion while displayed (smooth, continuous).
      if (a?.idle && a.idle !== 'none') {
        const k = a.idleAmt ?? 1
        const amt = k * fontSize
        const tt = time - caption.start
        /**
         * Two sines at frequencies that don't divide into each other, so the
         * pattern takes a very long time to repeat and never reads as a loop.
         * One sine is what "cheap" looks like: the eye finds the period in
         * about two seconds and then watches it tick.
         */
        const wave = (f1: number, f2: number, phase = 0): number =>
          Math.sin(tt * f1 + phase) * 0.72 + Math.sin(tt * f2 + phase * 1.7) * 0.28
        switch (a.idle) {
          // Scale, from the middle. The one that reads as "alive" without
          // anything appearing to move.
          case 'breathe':
            sc *= 1 + wave(0.62, 0.29) * 0.022 * k
            break
          // A slow wander in both axes at once — no straight lines, no
          // turning points that land together.
          case 'drift':
            tx += wave(0.37, 0.23) * amt * 0.085
            ty += wave(0.31, 0.19, 1.9) * amt * 0.06
            break
          // Rocks around its own centre, with a touch of rise on the beat so
          // it pivots rather than spins.
          case 'tilt':
            rot += wave(0.44, 0.27) * 0.017 * k
            ty += wave(0.44, 0.27, 0.8) * amt * 0.018
            break
          // Vertical, but weighted: it hangs at the top and falls through the
          // bottom, the way something with mass does.
          case 'bob': {
            const w = wave(0.68, 0.41)
            ty += Math.sign(w) * Math.pow(Math.abs(w), 1.45) * amt * 0.1
            break
          }
          // Sideways travel with the scale following a quarter-phase behind,
          // which reads as depth rather than as sliding.
          case 'glide':
            tx += wave(0.33, 0.51) * amt * 0.1
            sc *= 1 + wave(0.33, 0.51, Math.PI / 2) * 0.012 * k
            break
          case 'float':
            ty += Math.sin(tt * 1.6) * amt * 0.12
            break
          case 'sway':
            tx += Math.sin(tt * 1.2) * amt * 0.14
            break
          case 'pulse':
            sc *= 1 + Math.sin(tt * 2.2) * 0.04 * k
            break
        }
      }
      ctx.save()
      ctx.globalAlpha *= caption.shape?.kind === 'marker' && caption.shape.reveal ? 1 : Math.max(0, alpha)
      if (blurPx > 0.3) ctx.filter = `blur(${blurPx.toFixed(1)}px)`
      // A shape uses everything above — the entrance, the idle drift, the
      // motion keyframes, the blend — and draws geometry instead of glyphs.
      if (caption.shape) {
        if (sc !== 1 || rot !== 0) {
          ctx.translate(capX, centerY)
          if (rot !== 0) ctx.rotate(rot)
          if (sc !== 1) ctx.scale(sc, sc)
          ctx.translate(-capX, -centerY)
        }
        if (tx !== 0 || ty !== 0) ctx.translate(tx, ty)
        const shape = caption.shape
        const sw = Math.max(2, shape.w * outW)
        const shh = Math.max(2, shape.h * outH)
        const x0 = capX - sw / 2
        const y0 = centerY - shh / 2
        // How much of the shape is drawn, when it draws itself on.
        const revealFrac = shape.reveal
          ? speedRamp((time - caption.start) / Math.max(0.05, a?.inDur ?? 0.48))
          : 1
        // Marker has its own opaque sweep; fading the whole shape would make
        // it dull and translucent, unlike the reference editorial highlight.
        if (shape.kind === 'marker') {
          const sh3 = style.shadow
          if (sh3?.enabled) {
            ctx.shadowColor = sh3.color
            ctx.shadowBlur = sh3.blur * scale
          }
          drawMarkerStroke(
            ctx,
            capX,
            centerY,
            sw,
            shh,
            shape.reveal ? penEase((time - caption.start) / Math.max(0.05, a?.inDur ?? 0.48)) : 1,
            style.bgColor,
            style.bgOpacity,
            caption.start * 37
          )
          ctx.shadowColor = 'transparent'
          ctx.shadowBlur = 0
          ctx.restore()
          if (capXf) ctx.restore()
          if (blend) ctx.globalCompositeOperation = 'source-over'
          continue
        }
        if (revealFrac < 1) {
          ctx.beginPath()
          ctx.rect(x0 - 4, y0 - shh, sw * revealFrac, shh * 3)
          ctx.clip()
        }
        const sh2 = style.shadow
        if (sh2?.enabled) {
          ctx.shadowColor = sh2.color
          ctx.shadowBlur = sh2.blur * scale
          ctx.shadowOffsetX = sh2.dx * scale
          ctx.shadowOffsetY = sh2.dy * scale
        }
        ctx.fillStyle = hexToRgba(style.bgColor, style.bgOpacity)
        ctx.strokeStyle = style.bgBorder?.color ?? style.outlineColor
        ctx.lineWidth = Math.max(0, (style.bgBorder?.width ?? 0) * scale)
        const radius = Math.min((style.bgRadius ?? 0) * scale, sw / 2, shh / 2)
        if (shape.kind === 'circle') {
          ctx.beginPath()
          ctx.ellipse(capX, centerY, sw / 2, shh / 2, 0, 0, Math.PI * 2)
          if (style.bgOpacity > 0) ctx.fill()
          if (ctx.lineWidth > 0) ctx.stroke()
        } else if (shape.kind === 'arrow') {
          // A light editorial arrow: rounded tapered-looking stroke and an
          // open chevron, instead of a solid block that covers the footage.
          const head = Math.min(sw * 0.22, shh * 0.62)
          const tipX = x0 + sw - ctx.lineWidth / 2
          const shaftEnd = tipX - head * 0.55
          ctx.strokeStyle = hexToRgba(style.bgColor, style.bgOpacity)
          ctx.lineWidth = Math.max(2, Math.min(12, shh * 0.105))
          ctx.lineCap = 'round'
          ctx.lineJoin = 'round'
          ctx.beginPath()
          ctx.moveTo(x0 + ctx.lineWidth, centerY + shh * 0.12)
          ctx.quadraticCurveTo(x0 + sw * 0.48, centerY - shh * 0.18, shaftEnd, centerY)
          ctx.stroke()
          ctx.beginPath()
          ctx.moveTo(tipX - head, centerY - head * 0.6)
          ctx.lineTo(tipX, centerY)
          ctx.lineTo(tipX - head, centerY + head * 0.6)
          ctx.stroke()
        } else {
          // rect · marker · line — one rounded box, different defaults.
          ctx.beginPath()
          if (radius > 0.5 && typeof ctx.roundRect === 'function') ctx.roundRect(x0, y0, sw, shh, radius)
          else ctx.rect(x0, y0, sw, shh)
          if (style.bgOpacity > 0) ctx.fill()
          if (ctx.lineWidth > 0) ctx.stroke()
        }
        ctx.shadowColor = 'transparent'
        ctx.shadowBlur = 0
        ctx.restore()
        if (capXf) ctx.restore()
        if (blend) ctx.globalCompositeOperation = 'source-over'
        continue
      }
      if (sc !== 1 || rot !== 0) {
        ctx.translate(capX, centerY)
        if (rot !== 0) ctx.rotate(rot)
        if (sc !== 1) ctx.scale(sc, sc)
        ctx.translate(-capX, -centerY)
      }
      if (tx !== 0 || ty !== 0) ctx.translate(tx, ty)
      const text = style.uppercase ? caption.text.toUpperCase() : caption.text
      // Manual line breaks are honored; each paragraph wraps independently.
      const lines = text.split('\n').flatMap((seg) => (seg.trim() ? wrapCaption(seg, style.maxLineChars) : ['']))
      const blockW = Math.max(...lines.map((l) => ctx.measureText(l).width), 1)
      const top = centerY - (lines.length * lineHeight) / 2 + lineHeight / 2
      // Multi-line alignment inside the text block.
      const lineX = (lw: number): number =>
        style.align === 'left'
          ? capX - blockW / 2 + lw / 2
          : style.align === 'right'
            ? capX + blockW / 2 - lw / 2
            : capX
      // Every line's box first, then the letters: a box taller than the line
      // spacing (the Label look) covered the line above's letters when each
      // box was drawn just before its own line.
      lines.forEach((line, k) => {
        const lw = ctx.measureText(line).width
        drawBg(lw, top + k * lineHeight, lineX(lw))
      })
      let y = top
      let markerWordIndex = 0
      for (const line of lines) {
        const lw = ctx.measureText(line).width
        const lx = lineX(lw)
        // Draw only the chosen token's band, behind the original text ink.
        // Its reveal is based on that token's existing onset, never a new cue.
        const laid: { index: number; left: number; right: number; text: string }[] = []
        for (const match of line.matchAll(/\S+/gu)) {
          const left = lx - lw / 2 + ctx.measureText(line.slice(0, match.index)).width
          laid.push({ index: markerWordIndex++, left, right: left + ctx.measureText(match[0]).width, text: match[0] })
        }
        const inked = drawMarkerRuns(laid, y).flatMap((run) => run.words.map((w) => ({ trace: run.trace, word: w.text, x: w.x })))
        if (perChar) {
          // One character at a time, each on its own clock. The characters keep
          // their laid-out positions — only the entrance offsets differ — so the
          // text never reflows as it animates.
          let cx = lx - lw / 2
          for (const ch of Array.from(line)) {
            const cw = ctx.measureText(ch).width
            const delay = charIndex * charStagger
            const p = Math.min(1, Math.max(0, (time - (caption.start + delay)) / inDur))
            charIndex++
            if (ch === ' ') {
              cx += cw
              continue
            }
            const e = p * p * (3 - 2 * p)
            // No entrance means no entrance. Switching the wobble on used to
            // hand every letter a fade-in nobody asked for, because turning on
            // the letter-by-letter loop also ran the entrance maths — and with
            // no animation chosen, that maths defaults to a fade.
            const d = charEntrance ? animDeltas(charAnimName, e) : NEUTRAL_DELTA
            const bo = boilAt(style, charIndex, time, fontSize)
            ctx.save()
            ctx.globalAlpha *= Math.max(0, d.alpha)
            if (d.blur > 0.3) ctx.filter = `blur(${d.blur.toFixed(1)}px)`
            const px = cx + cw / 2
            const rot = d.rot + bo.rot
            const sc = d.sc * bo.scale
            if (sc !== 1 || rot !== 0) {
              ctx.translate(px, y)
              if (rot !== 0) ctx.rotate(rot)
              if (sc !== 1) ctx.scale(sc, sc)
              ctx.translate(-px, -y)
            }
            const tx = d.tx + bo.dx
            const ty = d.ty + bo.dy
            if (tx !== 0 || ty !== 0) ctx.translate(tx, ty)
            drawWord(ch, px, y, undefined, bo.ink)
            ctx.restore()
            cx += cw
          }
        } else {
          drawWord(line, lx, y)
          // A light marker: the words it has reached turn dark on it.
          {
            for (const m of inked) {
              inkOverMarker(ctx, m.trace, capMarker?.color || '#f1ef00', (ink, outline) => {
                if (style.outlineWidth > 0) {
                  ctx.strokeStyle = outline
                  ctx.lineWidth = style.outlineWidth * scale + 1.5
                  ctx.strokeText(m.word, m.x, y)
                }
                ctx.fillStyle = ink
                ctx.fillText(m.word, m.x, y)
              })
            }
          }
        }
        y += lineHeight
      }
      ctx.restore()
      if (capXf) ctx.restore()
      if (blend) ctx.globalCompositeOperation = 'source-over'
      continue
    }

    // Word-by-word pop-up: lay words out manually so each can animate alone.
    const dur = Math.max(0.03, style.popup?.duration ?? 0.16)
    const intensity = style.popup?.intensity ?? 1
    const words = caption.words!.map((w) => ({
      ...w,
      text: decorate(style.uppercase ? w.text.toUpperCase() : w.text)
    }))
    const spaceW = ctx.measureText(' ').width
    // Greedy wrap into lines by character budget (same rule as static mode).
    const lines: (typeof words)[] = []
    let line: typeof words = []
    let chars = 0
    for (const w of words) {
      if (line.length > 0 && chars + 1 + w.text.length > style.maxLineChars) {
        lines.push(line)
        line = []
        chars = 0
      }
      line.push(w)
      chars += (line.length > 1 ? 1 : 0) + w.text.length
    }
    if (line.length > 0) lines.push(line)

    // The spoken word for the WHOLE caption, not per line: computing it per
    // line left the previous line's last word still highlighted once speech
    // moved on, so two pills were lit at once.
    let spokenWord: (typeof words)[number] | null = null
    for (const w of words) if (time >= w.start) spokenWord = w

    let y = centerY - (lines.length * lineHeight) / 2 + lineHeight / 2
    // Every line's box first, then its words (as the static path above).
    lines.forEach((lineWords, k) => {
      const total = lineWords.reduce((a, w) => a + ctx.measureText(w.text).width, 0) + spaceW * (lineWords.length - 1)
      if (!popupOn || lineWords.some((w) => time >= w.start)) drawBg(total, y + k * lineHeight)
    })
    /** Runs across the whole caption, so the wobble seed of the first word on
     *  line two isn't the seed of the first word on line one — two lines
     *  wobbling in step is a pattern the eye finds immediately. */
    let wordSeed = 0
    for (const lineWords of lines) {
      const widths = lineWords.map((w) => ctx.measureText(w.text).width)
      const total = widths.reduce((a, b) => a + b, 0) + spaceW * (lineWords.length - 1)
      const anyVisible = !popupOn || lineWords.some((w) => time >= w.start)
      let x = capX - total / 2
      const anim = style.popup?.style ?? 'pop'
      const hl = style.highlight

      // TikTok-style highlight pill: a filled rounded box behind the word being
      // spoken, gliding from the previous word's slot rather than snapping. Drawn
      // before the words so it sits behind them. Same code path as export.
      if (hl?.enabled && hl.box && anyVisible) {
        // Slot geometry for every word on this line.
        let cursor = capX - total / 2
        const slots = widths.map((w) => {
          const r = { x: cursor, w }
          cursor += w + spaceW
          return r
        })
        const active = spokenWord ? lineWords.indexOf(spokenWord) : -1
        if (active >= 0 && time < lineWords[active].end && (!popupOn || time >= lineWords[active].start)) {
          const glide = Math.max(0, hl.boxGlide ?? 0.12)
          const from = slots[Math.max(0, active - 1)]
          const to = slots[active]
          const t0 = lineWords[active].start
          const p = glide > 0 ? Math.min(1, Math.max(0, (time - t0) / glide)) : 1
          const e = p * p * (3 - 2 * p) // smoothstep
          const bx = from.x + (to.x - from.x) * e
          const bw = from.w + (to.w - from.w) * e
          const padX = fontSize * 0.16
          const padY = fontSize * 0.1
          const bh = fontSize * 1.08 + padY * 2
          const r = Math.min(bh / 2, fontSize * 0.34)
          ctx.save()
          ctx.fillStyle = hl.boxColor || hl.color || '#25d0c2'
          ctx.beginPath()
          ctx.roundRect(bx - padX, y - fontSize * 0.72 - padY, bw + padX * 2, bh, r)
          ctx.fill()
          ctx.restore()
        }
      }
      let markerX = capX - total / 2
      const laidWords = lineWords.map((word, index) => {
        const left = markerX
        markerX += widths[index] + spaceW
        return { index: wordSeed + index, left, right: left + widths[index], text: word.text }
      })
      drawMarkerRuns(laidWords, y)
      lineWords.forEach((w, i) => {
        const cx = x + widths[i] / 2
        x += widths[i] + spaceW
        const p = popupOn ? Math.min(1, Math.max(0, (time - w.start) / dur)) : 1
        if (popupOn && time < w.start) return
        const eased = p * p * (3 - 2 * p)
        ctx.save()
        ctx.translate(cx, y)
        // Karaoke highlight: the word being spoken right now.
        const spoken = hl?.enabled && spokenWord === w && time < w.end
        if (spoken) ctx.scale(hl!.scale, hl!.scale)
        if (!popupOn || anim === 'plain') {
          /* words simply appear at their spoken time — no motion at all */
        } else if (anim === 'fluid') {
          // Always-moving: fade/rise in, then keep drifting on soft waves.
          ctx.globalAlpha *= eased
          ctx.translate(
            Math.sin(6.283 * 0.5 * time + i * 1.7) * fontSize * 0.035,
            (1 - eased) * fontSize * 0.4 + Math.sin(6.283 * 0.8 * time + i * 1.1) * fontSize * 0.055
          )
          ctx.rotate(Math.sin(6.283 * 0.35 * time + i) * 0.01)
        } else if (anim === 'pop') {
          ctx.globalAlpha *= Math.min(1, p * 2)
          const s = p >= 1 ? 1 : popScale(p, intensity)
          ctx.scale(s, s)
        } else if (anim === 'flip') {
          // rotateX in 2D: squash vertically through the turn and lift the
          // near edge slightly, which reads as depth without a 3D context.
          ctx.globalAlpha *= Math.min(1, p * 2)
          const ang = (1 - eased) * (Math.PI / 2)
          const sy = Math.max(0.02, Math.cos(ang))
          ctx.translate(0, (1 - sy) * fontSize * 0.12)
          ctx.scale(1, sy)
        } else if (anim === 'fade') {
          ctx.globalAlpha *= eased
        } else if (anim === 'focus') {
          // Focus pull: soft blur resolving into focus with a gentle settle.
          ctx.globalAlpha *= eased
          if (p < 1) {
            ctx.filter = `blur(${((1 - eased) * fontSize * 0.14).toFixed(1)}px)`
            const s = 1.08 - 0.08 * eased
            ctx.scale(s, s)
          }
        } else if (anim === 'soft') {
          // Minimalist: barely-there scale settle + fade.
          ctx.globalAlpha *= eased
          const s = 0.96 + 0.04 * eased
          ctx.scale(s, s)
        } else if (anim === 'lift') {
          // Minimalist: a few pixels of rise, calmer than 'rise'.
          ctx.globalAlpha *= eased
          ctx.translate(0, (1 - eased) * fontSize * 0.18)
        } else if (anim === 'ghost') {
          // Minimalist: pure fade with a whisper of blur, no movement.
          ctx.globalAlpha *= eased
          if (p < 1) ctx.filter = `blur(${((1 - eased) * fontSize * 0.06).toFixed(1)}px)`
        } else if (anim === 'bloom') {
          // Shorts-smooth: scale up from small with a soft blur that resolves.
          ctx.globalAlpha *= eased
          const s = 0.7 + 0.3 * eased
          ctx.scale(s, s)
          if (p < 1) ctx.filter = `blur(${((1 - eased) * fontSize * 0.1).toFixed(1)}px)`
          ctx.translate(0, Math.sin(6.283 * 0.6 * time + i) * fontSize * 0.02)
        } else if (anim === 'wave') {
          // Each word rises in a gentle wave and keeps a slow float.
          ctx.globalAlpha *= eased
          ctx.translate(0, (1 - eased) * fontSize * 0.6 + Math.sin(6.283 * 0.5 * time + i * 0.9) * fontSize * 0.045)
        } else if (anim === 'glide') {
          // Words slide in from the left, then hold.
          ctx.globalAlpha *= eased
          ctx.translate(-(1 - eased) * fontSize * 1.5, 0)
        } else if (anim === 'tilt') {
          // Rotate + rise in — playful, still smooth.
          ctx.globalAlpha *= eased
          ctx.rotate((1 - eased) * -0.25)
          ctx.translate(0, (1 - eased) * fontSize * 0.3)
        } else if (anim === 'drift') {
          // Fade in, then continuous slow vertical float (great for shorts).
          ctx.globalAlpha *= eased
          ctx.translate(0, (1 - eased) * fontSize * 0.25 + Math.sin(6.283 * 0.4 * time + i * 1.3) * fontSize * 0.05)
        } else {
          // 'rise' — a cozy drift up while fading in.
          ctx.globalAlpha *= eased
          ctx.translate(0, (1 - eased) * fontSize * 0.55)
        }
        if (anim === 'marker') {
          // A highlighter stroke that DRAWS ITSELF under the spoken word, the
          // word turning dark where it has passed (on a light marker), and
          // nothing yet under the words not reached.
          const passed = time >= w.start
          const markColor = hl?.boxColor ?? '#f1ef00'
          let trace: (() => void) | null = null
          if (passed) {
            const ww = ctx.measureText(w.text).width
            trace = drawMarkerStroke(ctx, 0, fontSize * 0.01, ww + fontSize * 0.4, fontSize * 1.1, penEase((time - w.start) / Math.min(0.38, Math.max(0.18, ww / (fontSize * 9)))), markColor, 1, wordSeed + i * 7)
          }
          drawWord(w.text, 0, 0, spoken ? hl!.color : undefined)
          if (trace) {
            inkOverMarker(ctx, trace, markColor, (ink, outline) => {
              if (style.outlineWidth > 0) {
                ctx.strokeStyle = outline
                ctx.lineWidth = style.outlineWidth * scale + 1.5
                ctx.strokeText(w.text, 0, 0)
              }
              ctx.fillStyle = ink
              ctx.fillText(w.text, 0, 0)
            })
          }
        } else if (anim === 'shimmer') {
          // A moving highlight travelling across the word: the chrome look.
          // Built per word so it works the same at any size or position.
          const ww = ctx.measureText(w.text).width
          const base = spoken && hl ? hl.color : style.color
          const g = ctx.createLinearGradient(-ww / 2, 0, ww / 2, 0)
          const head = ((time * 0.65) % 1.4) - 0.2
          const lo = Math.max(0, Math.min(1, head - 0.18))
          const mid = Math.max(0, Math.min(1, head))
          const hi = Math.max(0, Math.min(1, head + 0.18))
          g.addColorStop(0, base)
          if (lo < mid) g.addColorStop(lo, base)
          g.addColorStop(mid, '#ffffff')
          if (hi > mid) g.addColorStop(hi, base)
          g.addColorStop(1, base)
          ctx.globalAlpha *= eased
          drawWord(w.text, 0, 0, g)
        } else if (anim === 'type') {
          // Typewriter: the word is revealed letter by letter across its own
          // spoken time, with a caret on the one being typed. No movement at
          // all — the motion IS the text arriving.
          const chars = Array.from(w.text)
          const shown = popupOn ? Math.max(0, Math.min(chars.length, Math.floor(p * chars.length + 0.0001))) : chars.length
          const partial = chars.slice(0, shown).join('')
          if (partial) drawWord(partial, 0, 0, spoken ? hl!.color : undefined)
          if (popupOn && shown < chars.length) {
            // Caret sits at the right edge of what has been typed so far.
            const half = ctx.measureText(partial).width / 2
            const caretW = Math.max(1.5, fontSize * 0.06)
            ctx.fillStyle = spoken ? hl!.color : style.color
            ctx.globalAlpha *= Math.sin(time * 18) > -0.4 ? 1 : 0.25
            ctx.fillRect(half + caretW, -fontSize * 0.42, caretW, fontSize * 0.84)
          }
        } else {
          // `wi` seeds the wobble so two identical words in one line don't
          // wobble in lockstep.
          drawInk(w.text, 0, 0, spoken ? hl!.color : undefined, (wordSeed + i) * 17)
        }
        ctx.filter = 'none'
        ctx.restore()
      })
      wordSeed += lineWords.length
      y += lineHeight
    }
    if (capXf) ctx.restore()
    if (blend) ctx.globalCompositeOperation = 'source-over'
  }
  ctx.globalAlpha = 1
}
