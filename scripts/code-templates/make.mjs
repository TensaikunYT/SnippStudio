// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// The six code templates (SnippStudio phase 5f, decision 1): the user's own
// tool, never offered to the agent by a tool. Each is one self-contained page:
// a settings block (window.__params: the Inspector's Parameters section edits
// its values, the code stays), a small drawing helper (text, easing, shapes)
// and draw(t) on a transparent canvas, with the fast path (renderOut + READY).
// They use the project look (window.__snippLook) when the user set one, else
// their own defaults. No network, no chance, no clock: the same t, the same
// picture.
//   node scripts/code-templates/make.mjs     writes resources/kod-sablonlari/*/index.html
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const OUT = fileURLToPath(new URL('../../resources/kod-sablonlari/', import.meta.url))

const HELPER = String.raw`
const P = {}
for (const p of window.__params) P[p.key] = p.value
const LOOK = window.__snippLook || {}
const ACCENT = P.accent || LOOK.accent || '#ffb020'
const FONT = (LOOK.font ? '"' + LOOK.font + '", ' : '') + '"Segoe UI", system-ui, sans-serif'
const DUR = Math.max(0.5, +P.duration || 4)

// ===== Drawing helper (text, easing, shapes) =========================
const W = window.innerWidth || 1920
const H = window.innerHeight || 1080
const DPR = window.devicePixelRatio || 1
/** One unit: 1 px of a 1080-line frame. */
const U = Math.min(W, H) / 1080
const cv = document.createElement('canvas')
cv.width = Math.round(W * DPR)
cv.height = Math.round(H * DPR)
cv.style.width = W + 'px'
cv.style.height = H + 'px'
document.body.appendChild(cv)
const g = cv.getContext('2d')
const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x))
/** 0 → 1 while t goes from a to b. */
const span = (t, a, b) => clamp((t - a) / (b - a))
const easeOut = (x) => 1 - Math.pow(1 - clamp(x), 3)
const easeInOut = (x) => (x = clamp(x), x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2)
const easeBack = (x) => (x = clamp(x), 1 + 2.7 * Math.pow(x - 1, 3) + 1.7 * Math.pow(x - 1, 2))
/** 0 → 1 over the first inS seconds, 1 → 0 over the last outS. */
const life = (t, inS = 0.6, outS = 0.5) => easeOut(span(t, 0, inS)) * (1 - easeInOut(span(t, DUR - outS, DUR)))
const font = (weight, px) => weight + ' ' + Math.round(px) + 'px ' + FONT
function measure(s, weight, px) {
  g.font = font(weight, px)
  return g.measureText(String(s)).width
}
function text(s, x, y, o = {}) {
  g.save()
  g.font = font(o.weight || 700, o.size || 48 * U)
  g.textAlign = o.align || 'left'
  g.textBaseline = o.baseline || 'alphabetic'
  g.globalAlpha *= o.alpha === undefined ? 1 : o.alpha
  if (o.shadow !== false) {
    g.shadowColor = 'rgba(0,0,0,0.55)'
    g.shadowBlur = 12 * U
    g.shadowOffsetY = 3 * U
  }
  g.fillStyle = o.color || '#ffffff'
  g.fillText(String(s), x, y)
  g.restore()
}
function box(x, y, w, h, r, fill, alpha = 1) {
  if (w <= 0 || h <= 0) return
  g.save()
  g.globalAlpha *= alpha
  g.beginPath()
  g.roundRect(x, y, w, h, Math.min(r, w / 2, h / 2))
  g.fillStyle = fill
  g.fill()
  g.restore()
}
`

const page = (title, params, body) => `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<title>${title}</title>
<style>html,body{margin:0;background:transparent;overflow:hidden}canvas{display:block}</style>
</head>
<body>
<script>
// A Snipp code template: a transparent page drawn live over the video.
// Everything outside what draw(t) paints stays see-through.

// ===== Settings =====================================================
// The Inspector's "Parameters" section edits these values; the code below
// stays as it is. Types: 'text', 'color' (empty: the project look, else the
// template's own), 'number'.
window.__params = [
${params.map((p) => '  ' + JSON.stringify(p).replace(/"(\w+)":/g, '$1: ').replace(/,(?=\w+: )/g, ', ')).join(',\n')}
]
${HELPER.trim()}

// ===== The picture at second t ==========================================
function draw(t) {
  g.setTransform(DPR, 0, 0, DPR, 0, 0)
  g.clearRect(0, 0, W, H)
${body.trim().split('\n').map((l) => '  ' + l).join('\n')}
}

window.__config = { duration: DUR, transparent: true }
window.renderOut = draw
draw(0)
window.READY = true
</script>
</body>
</html>
`

const ACC = { key: 'accent', label: 'Accent', type: 'color', value: '' }
const dur = (v) => ({ key: 'duration', label: 'Length (s)', type: 'number', value: v, min: 0.5, max: 600 })

const T = {
  blank: page('Blank', [
    { key: 'text', label: 'Text', type: 'text', value: 'Your text here' },
    { key: 'size', label: 'Text size', type: 'number', value: 96, min: 12, max: 400 },
    ACC, dur(4)
  ], String.raw`
const k = life(t)
if (k <= 0) return
const size = clamp(+P.size || 96, 12, 400) * U
text(P.text, W / 2, H / 2 + (1 - k) * 30 * U, { size, align: 'center', baseline: 'middle', alpha: k, weight: 800 })
const w = measure(P.text, 800, size)
box(W / 2 - (w / 2) * k, H / 2 + size * 0.62, w * k, Math.max(4, 8 * U), 4 * U, ACCENT)
`),

  'lower-third': page('Lower third', [
    { key: 'name', label: 'Name', type: 'text', value: 'Ada Lovelace' },
    { key: 'title', label: 'Title', type: 'text', value: 'Mathematician' },
    { key: 'plate', label: 'Plate', type: 'color', value: '#101418' },
    ACC, dur(5)
  ], String.raw`
const k = life(t, 0.8, 0.5)
if (k <= 0) return
const x = W * 0.06, y = H * 0.78
const nameS = 58 * U, titleS = 34 * U
const w = Math.max(measure(P.name, 800, nameS), measure(P.title, 500, titleS)) + 64 * U
const h = nameS + titleS + 52 * U
const bar = easeOut(span(t, 0, 0.45)) * (1 - easeInOut(span(t, DUR - 0.5, DUR)))
const plate = easeOut(span(t, 0.15, 0.8)) * (1 - easeInOut(span(t, DUR - 0.5, DUR)))
box(x, y - h, 10 * U, h * bar, 3 * U, ACCENT)
g.save()
g.beginPath()
g.rect(x + 14 * U, y - h - 4 * U, (w + 8 * U) * plate, h + 8 * U)
g.clip()
box(x + 14 * U, y - h, w, h, 6 * U, P.plate || '#101418', 0.82)
text(P.name, x + 46 * U - (1 - plate) * 40 * U, y - h + 24 * U + nameS * 0.8, { size: nameS, weight: 800, alpha: plate })
text(P.title, x + 46 * U - (1 - plate) * 60 * U, y - 26 * U, { size: titleS, weight: 500, color: ACCENT, alpha: easeOut(span(t, 0.4, 1)) * k, shadow: false })
g.restore()
`),

  'bar-chart': page('Bar chart', [
    { key: 'title', label: 'Title', type: 'text', value: 'Views per month' },
    { key: 'data', label: 'Bars (label: value, …)', type: 'text', value: 'Jan: 12, Feb: 18, Mar: 9, Apr: 24' },
    { key: 'unit', label: 'After each value', type: 'text', value: 'k' },
    ACC, dur(6)
  ], String.raw`
const k = life(t, 0.6, 0.6)
if (k <= 0) return
const bars = String(P.data).split(',').map((s) => s.split(':')).map(([l, v]) => ({ label: (l || '').trim(), value: Math.max(0, +v || 0) })).filter((b) => b.label).slice(0, 12)
if (!bars.length) return
const max = Math.max(...bars.map((b) => b.value)) || 1
const pw = Math.min(W * 0.7, 1200 * U), ph = Math.min(H * 0.62, 640 * U)
const px = (W - pw) / 2, py = (H - ph) / 2
box(px, py, pw, ph, 18 * U, 'rgba(12,14,18,0.78)', k)
text(P.title, px + 40 * U, py + 70 * U, { size: 46 * U, weight: 800, alpha: k })
const top = py + 120 * U, bottom = py + ph - 70 * U
const slot = (pw - 80 * U) / bars.length
bars.forEach((b, i) => {
  const grow = easeBack(span(t, 0.5 + i * 0.15, 1.3 + i * 0.15)) * (1 - easeInOut(span(t, DUR - 0.6, DUR)))
  const bh = Math.max(0, (bottom - top) * (b.value / max) * grow)
  const bx = px + 40 * U + i * slot + slot * 0.15
  box(bx, bottom - bh, slot * 0.7, bh, 8 * U, ACCENT, k)
  const shown = b.value * clamp(grow)
  text((Number.isInteger(b.value) ? Math.round(shown) : shown.toFixed(1)) + P.unit, bx + slot * 0.35, bottom - bh - 14 * U, { size: 30 * U, weight: 700, align: 'center', alpha: k * clamp(grow * 2) })
  text(b.label, bx + slot * 0.35, bottom + 42 * U, { size: 28 * U, weight: 600, align: 'center', alpha: k, color: '#d8dde4' })
})
`),

  counter: page('Counter', [
    { key: 'from', label: 'From', type: 'number', value: 0 },
    { key: 'to', label: 'To', type: 'number', value: 1000 },
    { key: 'decimals', label: 'Decimals', type: 'number', value: 0, min: 0, max: 4, step: 1 },
    { key: 'prefix', label: 'Before the number', type: 'text', value: '' },
    { key: 'suffix', label: 'After the number', type: 'text', value: '+' },
    { key: 'label', label: 'Label', type: 'text', value: 'subscribers' },
    ACC, dur(4)
  ], String.raw`
const k = life(t, 0.4, 0.5)
if (k <= 0) return
const run = easeInOut(span(t, 0.2, Math.max(0.6, DUR - 1.2)))
const dec = clamp(Math.round(+P.decimals || 0), 0, 4)
const n = (+P.from || 0) + ((+P.to || 0) - (+P.from || 0)) * run
const s = P.prefix + n.toLocaleString('en-US', { minimumFractionDigits: dec, maximumFractionDigits: dec }) + P.suffix
const pop = 1 + 0.06 * Math.sin(Math.PI * span(t, Math.max(0.6, DUR - 1.2), Math.max(0.6, DUR - 1.2) + 0.35))
g.save()
g.translate(W / 2, H / 2)
g.scale(pop, pop)
text(s, 0, 0, { size: 170 * U, weight: 900, align: 'center', baseline: 'middle', alpha: k })
g.restore()
text(P.label, W / 2, H / 2 + 130 * U, { size: 44 * U, weight: 600, align: 'center', baseline: 'middle', color: ACCENT, alpha: k * easeOut(span(t, 0.3, 0.9)) })
`),

  arrow: page('Arrow', [
    { key: 'label', label: 'Label', type: 'text', value: 'Look here' },
    { key: 'x', label: 'Target x (%)', type: 'number', value: 62, min: 0, max: 100 },
    { key: 'y', label: 'Target y (%)', type: 'number', value: 42, min: 0, max: 100 },
    { key: 'radius', label: 'Ring size', type: 'number', value: 90, min: 10, max: 600 },
    ACC, dur(4)
  ], String.raw`
const k = life(t, 0.3, 0.5)
if (k <= 0) return
const tx = W * clamp(+P.x / 100), ty = H * clamp(+P.y / 100)
const r = clamp(+P.radius || 90, 10, 600) * U
// The arrow comes from the side with more room.
const sx = tx > W / 2 ? tx - 420 * U : tx + 420 * U
const sy = ty > H / 2 ? ty - 260 * U : ty + 260 * U
const draw1 = easeInOut(span(t, 0.2, 0.9))
const ang = Math.atan2(ty - sy, tx - sx)
const ex = tx - Math.cos(ang) * (r + 18 * U), ey = ty - Math.sin(ang) * (r + 18 * U)
const cx = sx + (ex - sx) * draw1, cy = sy + (ey - sy) * draw1
g.save()
g.globalAlpha = k
g.lineCap = 'round'
g.strokeStyle = ACCENT
g.shadowColor = 'rgba(0,0,0,0.5)'
g.shadowBlur = 10 * U
g.lineWidth = 10 * U
g.beginPath()
g.moveTo(sx, sy)
g.quadraticCurveTo((sx + cx) / 2 - (cy - sy) * 0.15, (sy + cy) / 2 + (cx - sx) * 0.15, cx, cy)
g.stroke()
if (draw1 > 0.95) {
  g.fillStyle = ACCENT
  g.beginPath()
  g.moveTo(ex + Math.cos(ang) * 6 * U, ey + Math.sin(ang) * 6 * U)
  g.lineTo(ex - Math.cos(ang - 0.5) * 42 * U, ey - Math.sin(ang - 0.5) * 42 * U)
  g.lineTo(ex - Math.cos(ang + 0.5) * 42 * U, ey - Math.sin(ang + 0.5) * 42 * U)
  g.closePath()
  g.fill()
}
const ring = easeBack(span(t, 0.7, 1.2))
const pulse = 1 + 0.04 * Math.sin(Math.max(0, t - 1.2) * 5)
g.lineWidth = 8 * U
g.beginPath()
g.arc(tx, ty, Math.max(0.1, r * ring * pulse), -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * clamp(ring))
g.stroke()
g.restore()
text(P.label, sx, sy + (sy > ty ? 56 * U : -28 * U), { size: 52 * U, weight: 800, align: 'center', alpha: k * easeOut(span(t, 0.1, 0.5)) })
`),

  'title-card': page('Title card', [
    { key: 'title', label: 'Title', type: 'text', value: 'Chapter one' },
    { key: 'subtitle', label: 'Subtitle', type: 'text', value: 'Where it all began' },
    { key: 'card', label: 'Card', type: 'color', value: '#0e1116' },
    ACC, dur(4)
  ], String.raw`
const k = life(t, 0.7, 0.6)
if (k <= 0) return
const ts = 110 * U, ss = 44 * U
const w = Math.min(W * 0.86, Math.max(measure(P.title, 900, ts), measure(P.subtitle, 500, ss)) + 160 * U)
const h = ts + ss + 150 * U
const grow = easeBack(span(t, 0, 0.7))
g.save()
g.translate(W / 2, H / 2)
g.scale(0.9 + 0.1 * grow, 0.9 + 0.1 * grow)
box(-w / 2, -h / 2, w, h, 22 * U, P.card || '#0e1116', 0.88 * k)
text(P.title, 0, -h / 2 + 70 * U + ts * 0.8, { size: ts, weight: 900, align: 'center', alpha: k * easeOut(span(t, 0.2, 0.8)) })
const line = easeInOut(span(t, 0.5, 1.1)) * (1 - easeInOut(span(t, DUR - 0.6, DUR)))
box(-w * 0.2 * line, -h / 2 + 100 * U + ts, w * 0.4 * line, 7 * U, 3 * U, ACCENT)
text(P.subtitle, 0, h / 2 - 50 * U, { size: ss, weight: 500, align: 'center', color: '#d8dde4', alpha: k * easeOut(span(t, 0.6, 1.2)), shadow: false })
g.restore()
`)
}

for (const [id, html] of Object.entries(T)) {
  mkdirSync(join(OUT, id), { recursive: true })
  writeFileSync(join(OUT, id, 'index.html'), html)
}
console.log(`${Object.keys(T).length} templates written to ${OUT}`)
