// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// The terminal: a tap on the keyboard in the dock, a keyboard (US, the
// English channel's) rises into place and a terminal window opens; then your
// lines are typed on it — each key goes down as it is pressed, and
// its letter appears in the window at that moment. Enter prints the output.

import { terminalDesign, terminalLayout, terminalScript, glide } from './model'
import { clamp01, prog, roundRect, text, type Ctx } from './draw'
import { drawScreen, drawSearchOpen } from './screens'
import { terminalMonoStack } from '../os-platform'

type Rect = { x: number; y: number; w: number; h: number }

// Windows: Cascadia Mono / Consolas as always; elsewhere the bundled
// JetBrains Mono first (phase 10a.6, F3).
const mono = (size: number, weight = 500): string => `${weight} ${Math.max(1, size).toFixed(1)}px ${terminalMonoStack()}`
const easeOut = (u: number): number => 1 - (1 - clamp01(u)) ** 3

/** A dock icon: keyboard, terminal, notes — drawn as simple ink marks. */
function icon(c: Ctx, r: Rect, kind: number, pressed: number): void {
  const g = c.g
  const st = c.b.style
  const s = 1 - 0.08 * pressed
  g.save()
  g.translate(r.x + r.w / 2, r.y + r.h / 2)
  g.scale(s, s)
  const w = r.w
  g.fillStyle = kind === 1 ? st.accent : '#ffffff'
  g.strokeStyle = st.ink
  g.lineWidth = w * 0.06
  roundRect(g, -w / 2, -w / 2, w, w, w * 0.24)
  g.fill()
  g.stroke()
  g.strokeStyle = st.ink
  g.fillStyle = st.ink
  g.lineCap = 'round'
  g.lineWidth = w * 0.06
  if (kind === 0) {
    // a terminal: >_
    g.beginPath()
    g.moveTo(-w * 0.22, -w * 0.14)
    g.lineTo(-w * 0.06, 0)
    g.lineTo(-w * 0.22, w * 0.14)
    g.moveTo(w * 0.02, w * 0.16)
    g.lineTo(w * 0.22, w * 0.16)
    g.stroke()
  } else if (kind === 1) {
    // a keyboard
    roundRect(g, -w * 0.3, -w * 0.18, w * 0.6, w * 0.36, w * 0.06)
    g.stroke()
    for (let row = 0; row < 2; row++)
      for (let k = 0; k < 4; k++) g.fillRect(-w * 0.22 + k * w * 0.13, -w * 0.09 + row * w * 0.1, w * 0.07, w * 0.05)
    g.fillRect(-w * 0.14, w * 0.1, w * 0.28, w * 0.04)
  } else {
    // notes
    for (let k = 0; k < 3; k++) {
      g.beginPath()
      g.moveTo(-w * 0.2, -w * 0.14 + k * w * 0.14)
      g.lineTo(w * (k === 2 ? 0.05 : 0.2), -w * 0.14 + k * w * 0.14)
      g.stroke()
    }
  }
  g.restore()
}

export function drawTerminal(c: Ctx): void {
  const g = c.g
  const b = c.b
  const st = b.style
  const u = c.u
  const t = c.t
  const L = terminalLayout(c.x0, c.W, c.H)
  const S = terminalScript(b)
  // The dock: up, tapped, away.
  const dockIn = glide(prog(t, 0.08, 0.35))
  const dockOut = glide(prog(t, S.tap + 0.18, 0.35))
  if (dockIn > 0 && dockOut < 1) {
    const dy = (1 - dockIn) * c.H * 0.2 + dockOut * c.H * 0.2
    g.save()
    g.globalAlpha *= dockIn * (1 - dockOut)
    g.translate(0, dy)
    g.save()
    g.shadowColor = 'rgba(0,0,0,0.5)'
    g.shadowBlur = 18 * u
    g.shadowOffsetX = 5 * u
    g.shadowOffsetY = 9 * u
    g.fillStyle = st.ink
    roundRect(g, L.dock.x - 6 * u, L.dock.y - 6 * u, L.dock.w + 12 * u, L.dock.h + 12 * u, L.dock.h * 0.4)
    g.fill()
    g.restore()
    g.fillStyle = 'rgba(255,255,255,0.92)'
    roundRect(g, L.dock.x, L.dock.y, L.dock.w, L.dock.h, L.dock.h * 0.36)
    g.fill()
    L.icons.forEach((r, i) => icon(c, r, i, i === 1 ? Math.sin(Math.PI * prog(t, S.tap - 0.05, 0.18)) : 0))
    g.restore()
  }
  // The keyboard rises into place.
  const kbIn = easeOut(prog(t, S.tap + 0.12, 0.55))
  const kbOut = glide(prog(t, b.duration - 0.45, 0.45))
  if (kbIn > 0) {
    const kb = L.kb
    const dy = (1 - kbIn) * c.H * 0.5 + kbOut * c.H * 0.5
    g.save()
    g.translate(0, dy)
    const p = kb.plate
    g.save()
    g.shadowColor = 'rgba(0,0,0,0.55)'
    g.shadowBlur = 22 * u
    g.shadowOffsetX = 6 * u
    g.shadowOffsetY = 12 * u
    g.fillStyle = st.ink
    roundRect(g, p.x - 7 * u, p.y - 7 * u, p.w + 14 * u, p.h + 14 * u, 22 * u)
    g.fill()
    g.restore()
    g.fillStyle = st.card
    roundRect(g, p.x, p.y, p.w, p.h, 16 * u)
    g.fill()
    // Keys: down for a moment when pressed.
    const down = new Map<string, number>()
    for (const q of S.presses) {
      const d = t - q.t
      if (d > -0.02 && d < 0.1) down.set(q.key, Math.max(down.get(q.key) ?? 0, 1 - Math.abs(d - 0.02) / 0.08))
      if (q.shift && d > -0.03 && d < 0.1) {
        // Shift on the other side from the key (the other hand holds it).
        const k = kb.keys.find((kk) => kk.id === q.key)
        const side = k && k.x + k.w / 2 < kb.plate.x + kb.plate.w / 2 ? 'rshift' : 'lshift'
        down.set(side, 1)
      }
    }
    for (const k of kb.keys) {
      const d = clamp01(down.get(k.id) ?? 0)
      const off = d * kb.unit * 0.06
      g.fillStyle = st.ink
      roundRect(g, k.x, k.y + kb.unit * 0.05, k.w, k.h, kb.unit * 0.16)
      g.fill()
      g.fillStyle = d > 0 ? '#e6e3da' : '#ffffff'
      g.strokeStyle = st.ink
      g.lineWidth = Math.max(1, kb.unit * 0.045)
      roundRect(g, k.x, k.y + off, k.w, k.h - kb.unit * 0.02, kb.unit * 0.16)
      g.fill()
      g.stroke()
      if (k.label) {
        const small = k.label.length > 1
        text(c, k.label, small ? k.x + kb.unit * 0.16 : k.x + k.w / 2, k.y + off + (small ? k.h * 0.78 : k.h * 0.64), {
          size: kb.unit * (small ? 0.2 : 0.34),
          weight: small ? 600 : 700,
          color: st.ink,
          align: small ? 'left' : 'center',
          alpha: small ? 0.6 : 1
        })
      }
    }
    g.restore()
  }
  // The window.
  const wIn = easeOut(prog(t, S.tap + 0.3, 0.45))
  if (wIn <= 0) return
  const w = L.win
  const k = 0.9 + 0.1 * wIn
  const out = glide(prog(t, b.duration - 0.45, 0.45))
  g.save()
  g.globalAlpha *= wIn * (1 - out)
  g.translate(w.x + w.w / 2, w.y + w.h / 2)
  g.scale(k, k)
  g.translate(-(w.x + w.w / 2), -(w.y + w.h / 2))
  const screen = terminalDesign(b)
  if (screen !== 'terminal') {
    drawScreen(c, screen, w, S)
    g.restore()
    // A search's picture, opened out of the window over everything.
    if (screen === 'search') drawSearchOpen(c, w, S)
    return
  }
  g.save()
  g.shadowColor = 'rgba(0,0,0,0.5)'
  g.shadowBlur = 36 * u
  g.shadowOffsetY = 14 * u
  g.fillStyle = '#15171c'
  roundRect(g, w.x, w.y, w.w, w.h, 14 * u)
  g.fill()
  g.restore()
  g.strokeStyle = 'rgba(255,255,255,0.08)'
  g.lineWidth = Math.max(1, u)
  roundRect(g, w.x, w.y, w.w, w.h, 14 * u)
  g.stroke()
  const bar = c.H * 0.045
  ;['#ff5f57', '#febc2e', '#28c840'].forEach((col, i) => {
    g.fillStyle = col
    g.globalAlpha *= 0.9
    g.beginPath()
    g.arc(w.x + bar * 0.6 + i * bar * 0.55, w.y + bar / 2, bar * 0.14, 0, Math.PI * 2)
    g.fill()
    g.globalAlpha /= 0.9
  })
  text(c, b.title, w.x + w.w / 2, w.y + bar * 0.64, { size: bar * 0.36, weight: 600, color: 'rgba(255,255,255,0.55)', align: 'center', maxW: w.w * 0.6 })
  g.fillStyle = 'rgba(255,255,255,0.06)'
  g.fillRect(w.x, w.y + bar, w.w, Math.max(1, u))
  // The lines so far.
  const size = Math.min(c.H * 0.036, w.h * 0.09)
  const lh = size * 1.55
  const x = w.x + size * 1.1
  let y = w.y + bar + lh * 1.1
  g.save()
  roundRect(g, w.x, w.y + bar, w.w, w.h - bar, 14 * u)
  g.clip()
  // Scroll up when the lines run past the bottom.
  const rows: { s: string; col: string; prompt: boolean; caret: boolean }[] = []
  for (const l of S.lines) {
    if (t < l.at[0] - 0.4 && l !== S.lines[0]) break
    const n = l.at.filter((q) => q <= t).length
    const typing = t < l.enter
    if (l.text || typing) rows.push({ s: [...l.text].slice(0, n).join(''), col: '#e6edf3', prompt: true, caret: typing })
    if (l.out && t >= l.outAt) rows.push({ s: l.out, col: 'rgba(230,237,243,0.55)', prompt: false, caret: false })
    if (typing) break
  }
  const fit = Math.floor((w.h - bar - lh * 0.6) / lh)
  const shown = rows.slice(Math.max(0, rows.length - fit))
  for (const r of shown) {
    g.font = mono(size, 600)
    g.textAlign = 'left'
    g.textBaseline = 'alphabetic'
    let px = x
    if (r.prompt) {
      g.fillStyle = st.accent
      g.fillText('$ ', px, y)
      px += g.measureText('$ ').width
    }
    g.font = mono(size, r.prompt ? 600 : 400)
    g.fillStyle = r.col
    g.fillText(r.s, px, y)
    if (r.caret && Math.floor(t * 2.2) % 2 === 0) {
      g.fillStyle = '#e6edf3'
      g.fillRect(px + g.measureText(r.s).width + size * 0.05, y - size * 0.82, size * 0.56, size * 1.02)
    }
    y += lh
  }
  // An idle prompt once everything is typed.
  const last = S.lines[S.lines.length - 1]
  if (last && t > last.outAt + 0.1 && shown.length < fit + 1) {
    g.font = mono(size, 600)
    g.fillStyle = st.accent
    g.fillText('$ ', x, y)
    if (Math.floor(t * 2.2) % 2 === 0) {
      g.fillStyle = '#e6edf3'
      g.fillRect(x + g.measureText('$ ').width, y - size * 0.82, size * 0.56, size * 1.02)
    }
  }
  g.restore()
  g.restore()
}
