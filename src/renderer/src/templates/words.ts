// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// Big words: the narration's own words — their timing from the subtitles —
// set large on the screen in a heavy face, four ways: Apple (each word
// sharpening out of a blur into a calm centred line), Stack (lines snapping
// up from below one after another, the newest on a slab of the accent),
// Punch (one word at a time, as big as the frame allows) and Karaoke (the
// line up, each word lit as it is said with the accent sliding under it).
// Each can be set your way: words to a line, the band on or off, the size,
// how much the other lines show, the height, and how the words meet the
// picture behind them.

import { wordsPhrases, type TimedWord } from './model'
import { clamp01, fontOf, outCubic, outExpo, roundRect, type Ctx } from './draw'
import { onAccent } from './extras'
import { pieces, punchWords, wordsDefaults, wordsDesign } from './words-plan'

export { wordsDefaults, wordsDesign } from './words-plan'

type G = Ctx['g']

/** How much an older line of the stack shows, by how far up it is: the one
 *  just above `dim`, each further one `dim` of the one under it. */
function fadeAt(pos: number, dim: number): number {
  if (pos <= 0) return 1
  const steps = [1, dim, dim * dim, dim * dim * dim, 0, 0]
  const f = Math.floor(pos)
  if (f >= 4) return 0
  return steps[f] + (steps[f + 1] - steps[f]) * (pos - f)
}

/** The piece on screen at t (the latest one begun). */
function current<T extends { t0: number }>(list: T[], t: number): number {
  let k = -1
  for (let i = 0; i < list.length; i++) if (t >= list[i].t0 - 0.04) k = i
  return k
}

/** Words set in lines, centred, within maxW: each word's box. */
function layout(g: G, words: string[], size: number, family: string, maxW: number, cx: number, cy: number, lead = 1.02, align: 'center' | 'left' = 'center'): { x: number; y: number; w: number }[] {
  g.font = fontOf(size, family, 900)
  const space = g.measureText(' ').width
  const lines: { idx: number[]; w: number }[] = []
  let cur: number[] = []
  let w = 0
  words.forEach((s, i) => {
    const ww = g.measureText(s).width
    if (cur.length && w + space + ww > maxW) {
      lines.push({ idx: cur, w })
      cur = []
      w = 0
    }
    w += (cur.length ? space : 0) + ww
    cur.push(i)
  })
  if (cur.length) lines.push({ idx: cur, w })
  const out: { x: number; y: number; w: number }[] = []
  const top = cy - ((lines.length - 1) * size * lead) / 2
  lines.forEach((ln, li) => {
    let x = align === 'center' ? cx - ln.w / 2 : cx
    for (const i of ln.idx) {
      const ww = g.measureText(words[i]).width
      out[i] = { x, y: top + li * size * lead, w: ww }
      x += ww + space
    }
  })
  return out
}

/** The size at which the words fit `lines` lines of maxW. */
function fitSize(g: G, words: string[], family: string, size: number, maxW: number, lines: number): number {
  g.font = fontOf(size, family, 900)
  const total = g.measureText(words.join(' ')).width
  const longest = Math.max(...words.map((w) => g.measureText(w).width))
  const k = Math.min(1, (maxW * lines * 0.92) / Math.max(1, total), maxW / Math.max(1, longest))
  return size * k
}

type Layer = HTMLCanvasElement | OffscreenCanvas
let layer: Layer | null = null

export function drawWords(c: Ctx): void {
  const blend = c.b.big?.blend ?? 'normal'
  if (blend === 'normal') {
    wordsOn(c)
    return
  }
  // Blended into the picture: the words drawn on a layer of their own, then
  // laid over it as a whole.
  const g = c.g
  const cw = g.canvas.width
  const ch = g.canvas.height
  if (!layer || layer.width !== cw || layer.height !== ch) {
    layer = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(cw, ch) : Object.assign(document.createElement('canvas'), { width: cw, height: ch })
  }
  const lg = layer.getContext('2d') as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D
  lg.setTransform(1, 0, 0, 1, 0, 0)
  lg.globalAlpha = 1
  lg.globalCompositeOperation = 'source-over'
  lg.filter = 'none'
  lg.clearRect(0, 0, cw, ch)
  lg.setTransform(g.getTransform())
  wordsOn({ ...c, g: lg })
  if (blend === 'window') {
    // A veil everywhere but the words: the picture seen through them.
    lg.save()
    lg.setTransform(1, 0, 0, 1, 0, 0)
    lg.globalCompositeOperation = 'source-out'
    lg.fillStyle = 'rgba(4,4,6,0.6)'
    lg.fillRect(0, 0, cw, ch)
    lg.restore()
  }
  g.save()
  g.setTransform(1, 0, 0, 1, 0, 0)
  g.globalCompositeOperation = blend === 'window' ? 'source-over' : blend === 'soft' ? 'soft-light' : blend
  g.drawImage(layer as CanvasImageSource, 0, 0)
  g.restore()
}

function wordsOn(c: Ctx): void {
  const { g, b, t, x0, W, H, u } = c
  const st = b.style
  const family = st.font
  const phrases = wordsPhrases(c.project, b)
  if (!phrases.length) return
  const design = wordsDesign(b)
  const def = wordsDefaults(design, c.portrait)
  const look = b.big ?? {}
  const per = look.per ?? def.per
  const band = look.band !== false
  const k0 = look.size ?? 1
  const dim = look.dim ?? def.dim
  const yAt = H * (look.y ?? def.y)
  const cx = x0 + W / 2
  const maxW = W * (c.portrait ? 0.86 : 0.8)
  g.save()
  g.textBaseline = 'middle'
  g.textAlign = 'left'
  if (design === 'apple') {
    const P = pieces(phrases, per)
    const k = current(P, t)
    for (const i of [k - 1, k]) {
      const p = P[i]
      if (!p) continue
      const leave = i < k ? clamp01((t - P[k].t0 + 0.12) / 0.32) : clamp01((t - p.t1 - 0.1) / 0.35)
      if (leave >= 1) continue
      const words = p.words.map((w) => w.text)
      const size = fitSize(g, words, family, H * (c.portrait ? 0.075 : 0.105) * k0, maxW, 3)
      const boxes = layout(g, words, size, family, maxW, cx, yAt, 1.04)
      p.words.forEach((w, j) => {
        const e = outCubic(clamp01((t - w.t0 + 0.06) / 0.42))
        if (e <= 0) return
        const a = e * (1 - leave)
        const blur = (1 - e) * 14 * u + leave * 10 * u
        const bx = boxes[j]
        g.save()
        g.globalAlpha *= a
        if (blur > 0.4) g.filter = `blur(${(blur * c.px).toFixed(1)}px)`
        g.font = fontOf(size, family, 900)
        g.fillStyle = c.onBg
        g.fillText(w.text, bx.x, bx.y + (1 - e) * size * 0.28 - leave * size * 0.18)
        g.restore()
      })
    }
  } else if (design === 'stack') {
    const P = pieces(phrases, per)
    const k = current(P, t)
    const size = Math.min(H * (c.portrait ? 0.075 : 0.12), W * 0.1) * k0
    const lh = size * 1.08
    const left = x0 + W * (c.portrait ? 0.07 : 0.08)
    const base = yAt
    const arrive = k >= 0 ? outExpo(clamp01((t - P[k].t0 + 0.04) / 0.3)) : 1
    // A line mask just under the newest line: it comes up out of it.
    g.save()
    g.beginPath()
    g.rect(x0, 0, W, base + lh * 0.55)
    g.clip()
    for (let i = Math.max(0, k - 4); i <= k; i++) {
      const p = P[i]
      const pos = k - i - (1 - arrive)
      const a = fadeAt(pos, dim)
      if (a <= 0.01) continue
      const text = p.words.map((w) => w.text).join(' ')
      const s = fitSize(g, [text], family, size, W * 0.84, 1)
      const y = base - pos * lh
      g.save()
      g.globalAlpha *= a
      g.font = fontOf(s, family, 900)
      const tw = g.measureText(text).width
      if (i === k && band) {
        // The newest on a slab of the accent, wiped in from the left.
        const wipe = outExpo(clamp01((t - p.t0 - 0.02) / 0.26))
        g.fillStyle = st.accent
        roundRect(g, left - s * 0.18, y - s * 0.52, (tw + s * 0.36) * wipe, s * 1.04, s * 0.08)
        g.fill()
        g.fillStyle = wipe > 0.5 ? onAccent(c) : c.onBg
      } else g.fillStyle = c.onBg
      g.fillText(text, left, y + s * 0.04)
      g.restore()
    }
    g.restore()
  } else if (design === 'punch') {
    // One word at a time; a little word rides with the next.
    const flat: TimedWord[] = punchWords(phrases)
    const k = current(flat, t)
    const w = flat[k]
    if (w && t < Math.max(w.t1, (flat[k + 1]?.t0 ?? w.t1 + 0.5)) + 0.05) {
      const size = fitSize(g, [w.text], family, H * (c.portrait ? 0.16 : 0.26) * k0, W * 0.86, 1)
      const e = clamp01((t - w.t0 + 0.04) / 0.14)
      const s = 1 + 0.07 * (1 - outCubic(e))
      g.save()
      g.globalAlpha *= clamp01(e * 3)
      g.translate(cx, yAt)
      g.scale(s, s)
      g.font = fontOf(size, family, 900)
      const letters = [...w.text.replace(/[^\p{L}\p{N}]/gu, '')].length
      g.fillStyle = letters >= 7 || /\d/.test(w.text) ? st.accent : c.onBg
      g.textAlign = 'center'
      g.fillText(w.text, 0, size * 0.04)
      g.restore()
    }
  } else {
    // Karaoke: the line up, words lit as said, the accent sliding under the
    // word being said.
    const P = pieces(phrases, per)
    const k = current(P, t)
    const p = P[k]
    if (p) {
      const inA = outCubic(clamp01((t - p.t0 + 0.08) / 0.25))
      const outA = 1 - clamp01((t - p.t1 + 0.02) / 0.2)
      const words = p.words.map((w) => w.text)
      const size = fitSize(g, words, family, H * (c.portrait ? 0.062 : 0.085) * k0, maxW, 2)
      const boxes = layout(g, words, size, family, maxW, cx, yAt, 1.14)
      g.save()
      const base = g.globalAlpha
      g.globalAlpha *= inA * outA
      g.translate(0, (1 - inA) * size * 0.3)
      // The slab under the word being said, gliding between words.
      let j = -1
      p.words.forEach((w, q) => {
        if (t >= w.t0 - 0.03) j = q
      })
      if (j >= 0 && band) {
        const move = outCubic(clamp01((t - p.words[j].t0 + 0.03) / 0.14))
        const A = boxes[Math.max(0, j - 1)]
        const B = boxes[j]
        const same = j === 0 || A.y !== B.y
        const x = same ? B.x : A.x + (B.x - A.x) * move
        const w = same ? B.w : A.w + (B.w - A.w) * move
        const pad = size * 0.16
        g.fillStyle = st.accent
        roundRect(g, x - pad, B.y - size * 0.55, w + pad * 2, size * 1.08, size * 0.18)
        g.fill()
      }
      g.font = fontOf(size, family, 900)
      p.words.forEach((w, q) => {
        const bx = boxes[q]
        // Without the band the word being said is lit in the accent itself.
        g.fillStyle = q === j ? (band ? onAccent(c) : st.accent) : c.onBg
        g.globalAlpha = base * (q <= j ? 1 : dim) * inA * outA
        g.fillText(w.text, bx.x, bx.y + size * 0.04)
      })
      g.restore()
    }
  }
  g.restore()
}
