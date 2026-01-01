// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// The world map: the video steps aside into a window (it keeps
// playing there), and a dotted world flies to each place you name — pulling
// back as it travels, in again as it arrives — with a dashed route from the
// last one. The place lights up in the accent, a pin drops and its name
// comes up. At the end the window opens and the video
// takes the frame again.

import { glide, mapAnchor, mapCamera, mapDesign, mapHasPip, mapPip, mapPlaces, mapSpread, mapTimes, mapTravel, territoryBar, territoryStages, type Region } from './model'
import type { TemplateBlock } from '../types'
import { landDots, LAT_BOTTOM, LAT_TOP } from './world'
import { clamp01, drawCover, fontOf, imageOf, prog, roundRect, sizeOf, text, type Ctx } from './draw'
import { liveInto } from './home'

type Rect = { x: number; y: number; w: number; h: number }
const lerp = (a: number, b: number, k: number): number => a + (b - a) * k

// The dots are drawn once per ten-degree tile and scale, into a small bitmap,
// and the frame is laid from those: a moving camera then costs a few dozen
// image draws instead of tens of thousands of circles, so the map plays
// smoothly in the editor. Each bitmap is made at the next power of two of
// the pixels a degree takes, so it is only ever drawn smaller — sharp.
type Surface = HTMLCanvasElement | OffscreenCanvas
const TILE = 10
const tiles = new Map<string, { cv: Surface; pad: number } | null>()
let held = 0
function surface(w: number, h: number): Surface {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(w, h)
  const cv = document.createElement('canvas')
  cv.width = w
  cv.height = h
  return cv
}
function dotTile(step: number, tl: number, tb: number, scale: number, color: string): { cv: Surface; pad: number } | null {
  const key = `${step}:${tl}:${tb}:${scale}:${color}`
  if (tiles.has(key)) return tiles.get(key) ?? null
  const d = landDots(step, tl, tl + TILE - 1e-6, tb, tb + TILE - 1e-6)
  let out: { cv: Surface; pad: number } | null = null
  if (d.length) {
    const r = step * scale * 0.36
    const pad = Math.ceil(r + 1)
    const size = Math.ceil(TILE * scale) + 2 * pad
    const cv = surface(size, size)
    const g = cv.getContext('2d') as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D
    g.fillStyle = color
    g.beginPath()
    for (let k = 0; k < d.length; k += 2) {
      const x = pad + (d[k] - tl) * scale
      const y = pad + (tb + TILE - d[k + 1]) * scale
      g.moveTo(x + r, y)
      g.arc(x, y, r, 0, Math.PI * 2)
    }
    g.fill()
    out = { cv, pad }
  }
  // Kept to a budget of pixels: fine tiles close up are big.
  if (out) held += out.cv.width * out.cv.height
  if (tiles.size > 4000 || held > 60e6) {
    tiles.clear()
    held = out ? out.cv.width * out.cv.height : 0
  }
  tiles.set(key, out)
  return out
}

/**
 * What the camera sees at block time t: pixels per degree, where its centre
 * is drawn (the whole world centred at zoom 1, the anchor once it is close),
 * the degrees in view and how much of each dot size shows.
 */
function mapView(b: Parameters<typeof mapCamera>[0], t: number, x0: number, W: number, H: number) {
  const design = mapDesign(b)
  const cam = mapCamera(b, t, W / H)
  const [ax, ay] = mapAnchor(x0, W, H, design)
  const ppd = ((W * 0.95) / 360) * cam.z
  // Your camera: always the middle of the frame.
  const near = design === 'free' ? 0 : design === 'tour' ? clamp01((cam.z - 1) / 1.2) : 1
  const cx = lerp(x0 + W / 2, ax, near)
  const cy = lerp(H / 2, ay, near)
  const levels: [number, number][] = [
    [1.5, 1 - clamp01((cam.z - 2.2) / 1.2)],
    [0.6, clamp01((cam.z - 2.2) / 1.2) * (1 - clamp01((cam.z - 5.5) / 2))],
    [0.25, clamp01((cam.z - 5.5) / 2) * (1 - clamp01((cam.z - 18) / 6))],
    [0.12, clamp01((cam.z - 18) / 6)]
  ]
  return {
    cam,
    ppd,
    cx,
    cy,
    lonA: cam.lon - (cx - x0) / ppd - 2,
    lonB: cam.lon + (x0 + W - cx) / ppd + 2,
    latA: cam.lat - (H - cy) / ppd - 2,
    latB: cam.lat + cy / ppd + 2,
    levels
  }
}

/**
 * Works out, ahead of time and between frames, every tile of dots the map
 * will need — so playing it in the editor never stops to find the land.
 */
const warmed = new Set<string>()
const warmTokens = new Map<string, number>()
function warm(b: Parameters<typeof mapCamera>[0], x0: number, W: number, H: number, px: number, ink: string): void {
  const key = `${JSON.stringify(b.items)}:${b.design ?? ''}:${JSON.stringify(b.cams ?? [])}:${b.duration}:${b.travel ?? ''}:${W}x${H}:${px}:${ink}`
  if (warmed.has(key)) return
  warmed.add(key)
  // A few dozen plans remembered, not every one ever made.
  if (warmed.size > 64) warmed.delete(warmed.values().next().value as string)
  // The newest warm-up of a block: an older one stops at its next slice
  // (typing a place name started a whole new queue per letter, all running).
  const blockId = (b as { id?: string }).id ?? ''
  const token = (warmTokens.get(blockId) ?? 0) + 1
  warmTokens.set(blockId, token)
  const jobs: [number, number, number, number][] = []
  const seen = new Set<string>()
  for (let t = 0; t <= b.duration; t += 0.1) {
    const v = mapView(b, t, x0, W, H)
    const scale = tileScale(v.ppd, px)
    for (const [step, a] of v.levels) {
      if (a <= 0.01) continue
      for (let tl = Math.floor(v.lonA / TILE) * TILE; tl < v.lonB; tl += TILE) {
        if (tl + TILE < -180 || tl > 180) continue
        for (let tb = Math.floor(v.latA / TILE) * TILE; tb < v.latB; tb += TILE) {
          if (tb + TILE < LAT_BOTTOM || tb > LAT_TOP) continue
          const k = `${step}:${tl}:${tb}:${scale}`
          if (!seen.has(k)) {
            seen.add(k)
            jobs.push([step, tl, tb, scale])
          }
        }
      }
    }
  }
  // The land first (it takes longest), then the drawn tiles.
  const work = (): void => {
    if (warmTokens.get(blockId) !== token) return
    const until = performance.now() + 6
    while (jobs.length && performance.now() < until) {
      const [step, tl, tb, scale] = jobs.shift()!
      dotTile(step, tl, tb, scale, ink)
    }
    if (jobs.length) setTimeout(work, 0)
  }
  setTimeout(work, 0)
}

/** The bitmap scale a tile is drawn at: the next power of two of the
 *  device pixels a degree takes. */
const tileScale = (ppd: number, px: number): number => Math.min(128, Math.max(2, 2 ** Math.ceil(Math.log2(ppd * Math.max(0.1, px)))))

/** Where a point of the frame is on the map at block time t (a click on
 *  the preview picking a place). */
export function mapPointAt(b: TemplateBlock, t: number, x0: number, W: number, H: number, px: number, py: number): { lon: number; lat: number } {
  const v = mapView(b, t, x0, W, H)
  return { lon: v.cam.lon + (px - v.cx) / v.ppd, lat: v.cam.lat - (py - v.cy) / v.ppd }
}

/** Your-camera map: its places in the order the camera reaches them (the
 *  ones it never reaches left out), so the newest is always the last. */
function inArrivalOrder(b: TemplateBlock): TemplateBlock {
  if (b.kind !== 'atlas' || b.follow) return b
  const at = mapTimes(b).at
  const order = b.items.map((_, i) => i).filter((i) => Number.isFinite(at[i])).sort((p, q) => at[p] - at[q])
  return { ...b, items: order.map((i) => b.items[i]) }
}

export function drawMap(c: Ctx): void {
  const g = c.g
  const b = inArrivalOrder(c.b)
  const st = b.style
  const { x0, W, H, u, t } = c
  const T = mapTimes(b)
  const pls = mapPlaces(b)
  warm(b, x0, W, H, c.px, st.ink)
  const view = mapView(b, t, x0, W, H)
  const { cam, ppd, cx, cy, lonA, lonB, latA, latB, levels } = view
  const sx = (lon: number): number => cx + (lon - cam.lon) * ppd
  const sy = (lat: number): number => cy - (lat - cam.lat) * ppd
  const windowed = mapHasPip(b)
  // Without the window the map comes over the video and goes again by itself.
  const inA = glide(prog(t, T.push[0], 0.35)) * (windowed ? 1 : 1 - glide(prog(t, b.duration - 0.45, 0.45)))

  // Stage.
  g.save()
  g.globalAlpha *= inA
  g.fillStyle = st.card
  g.fillRect(x0, 0, W, H)

  const design = mapDesign(b)
  const territory = design === 'territory'
  // What is lit: the place now shown, its light spreading; or, on a
  // territory map, all the land so far with the newest stage spreading.
  let cur = -1
  const stages = territory ? territoryStages(b) : []
  if (territory) {
    for (let i = 0; i < stages.length; i++) if (t >= T.at[i] - 0.05) cur = i
  } else for (let i = 0; i < pls.length; i++) if (pls[i] && t >= T.at[i] - 0.05) cur = i
  const spread = cur >= 0 ? glide(prog(t, T.at[cur] - 0.05, mapSpread(b))) : 0
  const fly = mapTravel(b)
  const lit: (Region & { fresh: boolean })[] = []
  if (territory) {
    stages.forEach((s, i) => {
      if (i > cur) return
      for (const r of s.regions) lit.push({ ...r, r: i === cur ? r.r * spread : r.r, fresh: i === cur })
    })
  } else if (cur >= 0) {
    const p = pls[cur]!
    lit.push({ lon: p.lon, lat: p.lat, r: (p.city ? 0.9 : p.r * 0.95) * spread, fresh: true })
  }
  const litBox = lit.length
    ? lit.reduce(
        (bx, r) => {
          const k = Math.max(0.2, Math.cos((r.lat * Math.PI) / 180))
          return [Math.min(bx[0], r.lon - r.r / k), Math.max(bx[1], r.lon + r.r / k), Math.min(bx[2], r.lat - r.r), Math.max(bx[3], r.lat + r.r)]
        },
        [Infinity, -Infinity, Infinity, -Infinity]
      )
    : null

  // The dots: coarse for the world, finer as it comes in, cross-faded.
  const scale = tileScale(ppd, c.px)
  const kx = ppd / scale
  for (const [step, a] of levels) {
    if (a <= 0.01) continue
    const r = Math.max(0.8, step * ppd * 0.36)
    const hot: number[] = []
    const old: number[] = []
    g.save()
    g.globalAlpha *= a * 0.36
    for (let tl = Math.floor(lonA / TILE) * TILE; tl < lonB; tl += TILE) {
      if (tl + TILE < -180 || tl > 180) continue
      for (let tb = Math.floor(latA / TILE) * TILE; tb < latB; tb += TILE) {
        if (tb + TILE < LAT_BOTTOM || tb > LAT_TOP) continue
        const tile = dotTile(step, tl, tb, scale, st.ink)
        if (tile) {
          const side = tile.cv.width * kx
          g.drawImage(tile.cv as CanvasImageSource, sx(tl) - tile.pad * kx, sy(tb + TILE) - tile.pad * kx, side, side)
        }
        // What is lit: only its own tiles are looked at dot by dot.
        if (!litBox || tl > litBox[1] || tl + TILE < litBox[0] || tb > litBox[3] || tb + TILE < litBox[2]) continue
        const d = landDots(step, tl, tl + TILE - 1e-6, tb, tb + TILE - 1e-6)
        for (let q = 0; q < d.length; q += 2) {
          const lon = d[q]
          const lat = d[q + 1]
          let on = 0
          for (const L of lit) {
            if (L.r <= 0) continue
            const k = Math.max(0.2, Math.cos((L.lat * Math.PI) / 180))
            if (Math.hypot((lon - L.lon) * k, lat - L.lat) <= L.r) {
              on = L.fresh ? 2 : Math.max(on, 1)
              if (on === 2) break
            }
          }
          if (!on) continue
          const x = sx(lon)
          const y = sy(lat)
          if (x < x0 - r || x > x0 + W + r || y < -r || y > H + r) continue
          ;(on === 2 ? hot : old).push(x, y)
        }
      }
    }
    g.restore()
    g.save()
    g.globalAlpha *= a
    g.fillStyle = st.accent
    if (old.length) {
      // Land held before: the accent, a step quieter than the newest.
      g.globalAlpha *= 0.62
      g.beginPath()
      for (let k = 0; k < old.length; k += 2) {
        g.moveTo(old[k] + r * 1.1, old[k + 1])
        g.arc(old[k], old[k + 1], r * 1.1, 0, Math.PI * 2)
      }
      g.fill()
      g.globalAlpha /= 0.62
    }
    g.beginPath()
    for (let k = 0; k < hot.length; k += 2) {
      g.moveTo(hot[k] + r * 1.1, hot[k + 1])
      g.arc(hot[k], hot[k + 1], r * 1.1, 0, Math.PI * 2)
    }
    g.fill()
    g.restore()
  }

  if (territory) drawTerritory(c, stages, cur, T.at, fly)
  // The route from the last place, dashed, drawn as the camera travels.
  for (let i = 1; i < pls.length && !territory; i++) {
    const p0 = pls[i - 1]
    const p1 = pls[i]
    if (!p0 || !p1) continue
    const k = glide(prog(t, T.at[i] - fly, fly))
    if (k <= 0) continue
    const A = [sx(p0.lon), sy(p0.lat)]
    const B = [sx(p1.lon), sy(p1.lat)]
    const mx = (A[0] + B[0]) / 2
    const my = (A[1] + B[1]) / 2 - Math.hypot(B[0] - A[0], B[1] - A[1]) * 0.22
    g.save()
    g.strokeStyle = st.ink
    g.globalAlpha *= 0.55 * (1 - glide(prog(t, T.at[i] + 0.8, 0.5)))
    g.lineWidth = 3 * u
    g.setLineDash([10 * u, 9 * u])
    g.lineCap = 'round'
    g.beginPath()
    const n = 40
    for (let s = 0; s <= Math.round(n * k); s++) {
      const q = s / n
      const x = (1 - q) * (1 - q) * A[0] + 2 * (1 - q) * q * mx + q * q * B[0]
      const y = (1 - q) * (1 - q) * A[1] + 2 * (1 - q) * q * my + q * q * B[1]
      if (s === 0) g.moveTo(x, y)
      else g.lineTo(x, y)
    }
    g.stroke()
    g.restore()
  }

  // Pins: the places already shown stay as small dots; the one now drops in.
  pls.forEach((p, i) => {
    if (territory || !p || t < T.at[i] - 0.02) return
    const x = sx(p.lon)
    const y = sy(p.lat)
    const age = t - T.at[i]
    if (i !== cur) {
      g.fillStyle = st.ink
      g.beginPath()
      g.arc(x, y, 7 * u, 0, Math.PI * 2)
      g.fill()
      return
    }
    const drop = glide(age / 0.28)
    const R = 26 * u
    // The ring it makes as it lands.
    const ring = prog(age, 0.18, 0.7)
    if (ring > 0 && ring < 1) {
      g.strokeStyle = st.accent
      g.globalAlpha *= 1 - ring
      g.lineWidth = 3 * u
      g.beginPath()
      g.ellipse(x, y, R * (0.6 + 2.2 * ring), R * (0.25 + 0.9 * ring), 0, 0, Math.PI * 2)
      g.stroke()
      g.globalAlpha /= 1 - ring
    }
    g.save()
    g.translate(x, y - (1 - drop) * 60 * u)
    g.globalAlpha *= clamp01(age / 0.1)
    g.fillStyle = 'rgba(0,0,0,0.3)'
    g.beginPath()
    g.ellipse(0, (1 - drop) * 60 * u + 2 * u, R * 0.45, R * 0.16, 0, 0, Math.PI * 2)
    g.fill()
    // A teardrop: accent, ink line, a white eye.
    g.beginPath()
    g.moveTo(0, 0)
    g.bezierCurveTo(-R * 0.55, -R * 0.8, -R, -R * 1.25, -R, -R * 1.75)
    g.arc(0, -R * 1.75, R, Math.PI, 0)
    g.bezierCurveTo(R, -R * 1.25, R * 0.55, -R * 0.8, 0, 0)
    g.closePath()
    g.fillStyle = st.accent
    g.strokeStyle = st.ink
    g.lineWidth = 5 * u
    g.lineJoin = 'round'
    g.stroke()
    g.fill()
    g.fillStyle = '#ffffff'
    g.beginPath()
    g.arc(0, -R * 1.75, R * 0.38, 0, Math.PI * 2)
    g.fill()
    g.restore()
    // Its name, on a card beside it.
    const item = b.items[i]
    let lab = glide(prog(age, 0.25, 0.4)) * (1 - glide(prog(t, (T.at[i + 1] ?? T.back + 1) - 0.95, 0.3)))
    // Your camera: a name fades as the camera leaves its place.
    if (design === 'free') lab *= clamp01(Math.min(x - x0, x0 + W - x, y, H - y) / (W * 0.08))
    if (lab > 0.01 && item.title) {
      const size = H * (c.portrait ? 0.034 : 0.042)
      g.font = fontOf(size, st.font, 400)
      const tw = g.measureText(item.title).width
      g.font = fontOf(size * 0.52, 'Inter', 600)
      const nw = item.note ? g.measureText(item.note).width : 0
      // A place with a picture shows it on its card, over the name.
      const img = imageOf(c, item)
      const w = Math.max(tw, nw, img ? H * (c.portrait ? 0.26 : 0.3) : 0) + size * 1.1
      const ih = img ? ((w - size * 0.5) * 9) / 16 : 0
      const h = size * (item.note ? 2.15 : 1.5) + (img ? ih + size * 0.25 : 0)
      // Kept on the frame, beside the pin.
      const lx = Math.min(x + R * 1.5, x0 + W - w - 16 * u)
      const ly = Math.max(16 * u, Math.min(H - h - 16 * u, y - R * 2.6 - h / 2 - (img ? ih / 2 : 0)))
      g.save()
      g.globalAlpha *= lab
      g.translate((1 - lab) * 16 * u, 0)
      g.save()
      g.shadowColor = 'rgba(0,0,0,0.45)'
      g.shadowBlur = 14 * u
      g.shadowOffsetX = 5 * u
      g.shadowOffsetY = 8 * u
      g.fillStyle = st.ink
      roundRect(g, lx - 6 * u, ly - 6 * u, w + 12 * u, h + 12 * u, 14 * u)
      g.fill()
      g.restore()
      g.fillStyle = '#ffffff'
      roundRect(g, lx, ly, w, h, 10 * u)
      g.fill()
      let ty = ly
      if (img) {
        const pr = { x: lx + size * 0.25, y: ly + size * 0.25, w: w - size * 0.5, h: ih }
        g.save()
        roundRect(g, pr.x, pr.y, pr.w, pr.h, 7 * u)
        g.clip()
        const [iw, ihh] = sizeOf(img)
        if (iw > 0 && ihh > 0) drawCover(g, img, pr.x, pr.y, pr.w, pr.h)
        g.restore()
        ty += ih + size * 0.25
      }
      text(c, item.title, lx + size * 0.55, ty + size * 1.08, { size, family: st.font, weight: 400, color: st.ink, maxW: w - size * 1.1 })
      if (item.note) text(c, item.note, lx + size * 0.55, ty + size * 1.78, { size: size * 0.52, weight: 600, color: st.ink, alpha: 0.65, maxW: w - size * 1.1 })
      g.restore()
    }
  })
  g.restore()

  // The video: pushed aside into its window, brought back at the end.
  if (!windowed) return
  const pip = mapPip(x0, W, H)
  const full: Rect = { x: x0, y: 0, w: W, h: H }
  const e1 = glide(prog(t, T.push[0], T.push[1] - T.push[0]))
  const e2 = 1 - (1 - clamp01(prog(t, T.open, T.end - T.open))) ** 3.2
  const r0: Rect = { x: lerp(full.x, pip.x, e1), y: lerp(full.y, pip.y, e1), w: lerp(full.w, pip.w, e1), h: lerp(full.h, pip.h, e1) }
  const r: Rect = { x: lerp(r0.x, full.x, e2), y: lerp(r0.y, full.y, e2), w: lerp(r0.w, full.w, e2), h: lerp(r0.h, full.h, e2) }
  const rad = 16 * u * Math.min(e1, 1 - e2)
  const line = Math.min(e1, 1 - e2)
  if (line > 0.01) {
    g.save()
    g.globalAlpha *= line
    g.fillStyle = st.ink
    roundRect(g, r.x - 6 * u, r.y - 6 * u, r.w + 12 * u, r.h + 12 * u, rad + 6 * u)
    g.fill()
    g.restore()
  }
  liveInto(c, r, rad, 1, line)
}

/**
 * The territory map's words: the stage's year (or name) large in the
 * corner — the last one lifting away as the next comes up — with what it
 * adds under it, and a timeline along the bottom, lit up to where we are.
 */
function drawTerritory(c: Ctx, stages: { label: string; regions: Region[] }[], cur: number, at: number[], fly: number): void {
  const g = c.g
  const st = c.b.style
  const { x0, W, H, u, t } = c
  const n = stages.length
  if (!n) return
  // The year.
  const size = c.portrait ? W * 0.13 : H * 0.1
  const lx = x0 + (c.portrait ? W * 0.08 : W * 0.05)
  const ly = c.portrait ? H * 0.13 : H * 0.17
  for (let i = Math.max(0, cur - 1); i <= cur; i++) {
    const s = stages[i]
    const inK = glide(prog(t, at[i] - 0.05, 0.4))
    const outK = i < cur ? glide(prog(t, at[cur] - 0.05, 0.3)) : 0
    const k = inK * (1 - outK)
    if (k <= 0.01) continue
    g.save()
    g.globalAlpha *= k
    const dy = (1 - inK) * size * 0.45 - outK * size * 0.45
    text(c, s.label, lx, ly + dy, { size, family: st.font, weight: 800, color: st.ink, maxW: W * (c.portrait ? 0.84 : 0.5) })
    const note = c.b.items[i]?.note
    if (note) text(c, `+ ${note}`, lx, ly + dy + size * 0.55, { size: size * 0.24, weight: 600, color: st.ink, alpha: 0.6, maxW: W * (c.portrait ? 0.84 : 0.42) })
    g.restore()
  }
  // The timeline.
  const bar = territoryBar(x0, W, H, n)
  const fillTo = cur < 0 ? bar.x0 : cur + 1 < n && t > at[cur + 1] - fly ? bar.tick(cur) + (bar.tick(cur + 1) - bar.tick(cur)) * glide(prog(t, at[cur + 1] - fly, fly)) : bar.tick(cur)
  g.save()
  g.lineCap = 'round'
  g.strokeStyle = st.ink
  g.globalAlpha *= 0.18
  g.lineWidth = 6 * u
  g.beginPath()
  g.moveTo(bar.x0, bar.y)
  g.lineTo(bar.x1, bar.y)
  g.stroke()
  g.globalAlpha /= 0.18
  if (fillTo > bar.x0) {
    g.strokeStyle = st.accent
    g.beginPath()
    g.moveTo(bar.x0, bar.y)
    g.lineTo(fillTo, bar.y)
    g.stroke()
  }
  for (let i = 0; i < n; i++) {
    const x = bar.tick(i)
    const on = i <= cur
    g.fillStyle = on ? st.accent : st.card
    g.strokeStyle = st.ink
    g.lineWidth = 3 * u
    g.beginPath()
    g.arc(x, bar.y, (i === cur ? 11 : 8) * u, 0, Math.PI * 2)
    g.fill()
    g.stroke()
    text(c, stages[i].label, x, bar.y + 34 * u, { size: 18 * u, weight: 700, color: st.ink, align: 'center', alpha: on ? 0.9 : 0.45, maxW: Math.max(40 * u, (bar.x1 - bar.x0) / Math.max(1, n - 1) - 8 * u) })
  }
  g.restore()
}
