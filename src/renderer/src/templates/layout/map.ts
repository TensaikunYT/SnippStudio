// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// The map templates (world map, map with your camera): places, travel,
// territories, the camera. Moved out of templates/model.ts in SnippStudio
// phase 2B (no change).
import { type MapKey, type TemplateBlock, type TemplateKind } from '../../types'
import { findPlace, LAT_BOTTOM, LAT_TOP } from '../world'
import { templateSlots, glide } from './common'
import { evalKeys } from '../../playback/keys'
import { gridLocal, sameFrame } from '../../timeline/key-grid'
import type { Rect } from './common'

// -- the world map --------------------------------------------------------------------

/** Each item's place: found by its name, or its own Lat/Lon when given. */
export function mapPlaces(b: Pick<TemplateBlock, 'items'>): ({ lat: number; lon: number; r: number; city: boolean } | null)[] {
  return b.items.map((it) => {
    if (typeof it.value === 'number' && typeof it.value2 === 'number' && (it.value !== 0 || it.value2 !== 0)) {
      return { lat: Math.max(-80, Math.min(84, it.value)), lon: Math.max(-180, Math.min(180, it.value2)), r: 0, city: true }
    }
    return findPlace(it.title)
  })
}

/** The beats (block time): the video pushed aside into its window, each
 *  place arrived at (its pin), the tap that brings the video back. */
export function mapTimes(b: Pick<TemplateBlock, 'duration' | 'items' | 'kind' | 'cams' | 'follow'>): { push: [number, number]; at: number[]; back: number; open: number; end: number } {
  const s = templateSlots(b)
  const at = b.kind === 'atlas' && !b.follow ? atlasArrivals(b) : b.items.map((_, i) => s.at(i))
  const D = b.duration
  return { push: [0.12, 0.72], at, back: D - 0.8, open: D - 0.72, end: D }
}

/** How long each flight to a place takes: your setting, never longer than
 *  the time between places (or the lead-in, for the first). */
export function mapTravel(b: Pick<TemplateBlock, 'duration' | 'items' | 'kind' | 'travel' | 'design'>): number {
  const s = templateSlots(b)
  return Math.max(0.2, Math.min(b.travel ?? 0.9, s.len * 0.95, s.at(0) + 0.3))
}

/** How long a place's light takes to spread over it. */
export const mapSpread = (b: Pick<TemplateBlock, 'spread'>): number => b.spread ?? 0.6

/** The window the video keeps playing in while the map is on. */
export function mapPip(left: number, W: number, H: number): Rect {
  if (W / H < 1) {
    const w = W * 0.52
    return { x: left + W * 0.06, y: H * 0.72, w, h: (w * 9) / 16 }
  }
  const w = W * 0.25
  const h = (w * 9) / 16
  return { x: left + W * 0.035, y: H - H * 0.06 - h, w, h }
}

/** Where on screen the place being shown sits (its pin). */
export function mapAnchor(left: number, W: number, H: number, design: MapDesign = 'tour'): [number, number] {
  if (design === 'territory') return W / H < 1 ? [left + W * 0.5, H * 0.34] : [left + W * 0.6, H * 0.46]
  return W / H < 1 ? [left + W * 0.5, H * 0.36] : [left + W * 0.58, H * 0.44]
}

/** Which map: a tour of the world, a tour of Türkiye (its ancient sites,
 *  its cities), or a territory growing stage by stage. */
export type MapDesign = 'tour' | 'turkey' | 'territory' | 'free'
export const mapDesign = (b: Pick<TemplateBlock, 'design'> & { kind?: TemplateKind }): MapDesign =>
  b.kind === 'atlas' ? 'free' : b.design === 'turkey' || b.design === 'territory' ? b.design : 'tour'

/** Does the video keep playing in a window while the map is on? */
export const mapHasPip = (b: Pick<TemplateBlock, 'pip' | 'kind'>): boolean => b.pip ?? b.kind === 'map'

/** Türkiye across the frame. */
export const TR_VIEW = { lon: 35.4, lat: 38.9, z: 14 }

/** How close the map comes for a place: a country filling a good part of
 *  the frame, a city closer still; in Türkiye, a site shows its region. */
export const mapZoomFor = (p: { r: number; city: boolean } | null, design: MapDesign = 'tour'): number => {
  if (design === 'turkey') return !p ? TR_VIEW.z : p.city ? 30 : Math.max(TR_VIEW.z, Math.min(30, 90 / Math.max(1, p.r)))
  return !p ? 1 : p.city ? 11 : Math.max(1.8, Math.min(12, 52 / Math.max(1, p.r)))
}

/** A patch of land a territory covers: a circle, degrees. */
export interface Region {
  lon: number
  lat: number
  r: number
}

/**
 * A territory map's stages: each item is one — its title the year (or a
 * name), its note the places it adds, commas between. A city covers a small
 * region round it, a country its own spread; an item's value, when set, is
 * the size (degrees) of every place it adds.
 */
export function territoryStages(b: Pick<TemplateBlock, 'items'>): { label: string; regions: Region[]; missing: string[] }[] {
  return b.items.map((it) => {
    const names = (it.note ?? '').split(/[,;\n|]+/).map((s) => s.trim()).filter(Boolean)
    const size = typeof it.value === 'number' && it.value > 0 ? it.value : undefined
    const regions: Region[] = []
    const missing: string[] = []
    for (const n of names) {
      const p = findPlace(n)
      if (!p) missing.push(n)
      else regions.push({ lon: p.lon, lat: p.lat, r: size ?? (p.city ? 1.2 : p.r * 0.95) })
    }
    return { label: it.title ?? '', regions, missing }
  })
}

/** A camera that has all of these regions in view. */
export function fitRegions(regions: Region[], aspect: number): { lon: number; lat: number; z: number } {
  if (!regions.length) return { lon: 12, lat: (LAT_TOP + LAT_BOTTOM) / 2, z: 1 }
  let a = Infinity
  let b = -Infinity
  let c = Infinity
  let d = -Infinity
  for (const r of regions) {
    const k = Math.max(0.2, Math.cos((r.lat * Math.PI) / 180))
    a = Math.min(a, r.lon - r.r / k)
    b = Math.max(b, r.lon + r.r / k)
    c = Math.min(c, r.lat - r.r)
    d = Math.max(d, r.lat + r.r)
  }
  const dLon = Math.max(3, b - a)
  const dLat = Math.max(2, d - c)
  const z = Math.min((0.6 * 360) / (0.95 * dLon), (0.56 * 360) / (0.95 * dLat * aspect))
  return { lon: (a + b) / 2, lat: (c + d) / 2, z: Math.max(1, Math.min(30, z)) }
}

/** Where a territory map's timeline runs, and each stage's tick on it. */
export function territoryBar(left: number, W: number, H: number, n: number): { x0: number; x1: number; y: number; tick: (i: number) => number } {
  const portrait = W / H < 1
  const x0 = portrait ? left + W * 0.08 : left + W * 0.34
  const x1 = portrait ? left + W * 0.92 : left + W * 0.94
  const y = portrait ? H * 0.64 : H * 0.9
  return { x0, x1, y, tick: (i) => (n > 1 ? x0 + ((x1 - x0) * i) / (n - 1) : (x0 + x1) / 2) }
}

/**
 * The camera at block time t: centre (lon, lat) and zoom (1: the whole
 * world across the frame). Between places it flies — pulling back as it
 * goes further, then in — on one glide.
 */
export function mapCamera(b: Pick<TemplateBlock, 'duration' | 'items' | 'kind' | 'travel' | 'design' | 'cams' | 'follow'>, t: number, aspect = 16 / 9): { lon: number; lat: number; z: number } {
  if (b.kind === 'atlas' && !b.follow) return atlasCamera(b, t)
  const T = mapTimes(b)
  const fly = mapTravel(b)
  const design = mapDesign(b)
  if (design === 'territory') {
    // Framing all the land so far, stage by stage, on one glide each.
    const stages = territoryStages(b)
    let acc: Region[] = []
    const cams = stages.map((s) => {
      acc = acc.concat(s.regions)
      return fitRegions(acc, aspect)
    })
    if (!cams.length) return { lon: 12, lat: (LAT_TOP + LAT_BOTTOM) / 2, z: 1 }
    let from = { ...cams[0], z: Math.max(1, cams[0].z * 0.62) }
    for (let i = 0; i < cams.length; i++) {
      const to = stages[i].regions.length || i === 0 ? cams[i] : from
      const t0 = T.at[i] - fly
      const t1 = T.at[i]
      if (t < t0) return from
      if (t <= t1) {
        const u = glide((t - t0) / Math.max(0.05, t1 - t0))
        return { lon: from.lon + (to.lon - from.lon) * u, lat: from.lat + (to.lat - from.lat) * u, z: Math.exp(Math.log(from.z) + (Math.log(to.z) - Math.log(from.z)) * u) }
      }
      from = to
    }
    return from
  }
  const pls = mapPlaces(b)
  const world = design === 'turkey' ? TR_VIEW : { lon: 12, lat: (LAT_TOP + LAT_BOTTOM) / 2, z: 1 }
  let from = world
  let ta = -1
  for (let i = 0; i < pls.length; i++) {
    const p = pls[i]
    if (!p) continue
    const to = { lon: p.lon, lat: p.lat, z: mapZoomFor(p, design) }
    const t0 = T.at[i] - fly
    const t1 = T.at[i]
    if (t < t0) return from
    if (t <= t1) {
      const u = glide((t - Math.max(t0, ta)) / Math.max(0.05, t1 - Math.max(t0, ta)))
      const dist = Math.hypot((to.lon - from.lon) * Math.cos((((to.lat + from.lat) / 2) * Math.PI) / 180), to.lat - from.lat)
      const dip = Math.min(design === 'turkey' ? 0.5 : 1.6, dist / 25) * Math.sin(Math.PI * u)
      const lz = Math.log(from.z) + (Math.log(to.z) - Math.log(from.z)) * u - dip
      return { lon: from.lon + (to.lon - from.lon) * u, lat: from.lat + (to.lat - from.lat) * u, z: Math.max(0.9, Math.exp(lz)) }
    }
    from = to
    ta = t1
  }
  return from
}

// -- the map with your camera ---------------------------------------------------------

export const WORLD_KEY = { lon: 12, lat: (LAT_TOP + LAT_BOTTOM) / 2, z: 1 }

/** A new your-camera map's keys: the world, then the first place. */
export function defaultAtlasKeys(b: Pick<TemplateBlock, 'items' | 'duration'>): MapKey[] {
  const keys: MapKey[] = [{ t: 0, ...WORLD_KEY }]
  const p = mapPlaces(b).find(Boolean)
  if (p) keys.push({ t: Math.min(b.duration * 0.45, 3), lon: p.lon, lat: p.lat, z: mapZoomFor(p) })
  return keys
}

/**
 * Your camera at block time t, from its keys: each stretch on one glide,
 * easing out of a key and into the next; a long way across pulls back a
 * little on the way, as the tour does.
 */
export function atlasCamera(b: Pick<TemplateBlock, 'cams'>, t: number): { lon: number; lat: number; z: number } {
  const keys = b.cams?.length ? b.cams : [{ t: 0, ...WORLD_KEY }]
  // (playback/keys.ts, on the block's clock, with the camera's own glide and
  // dip: phase Ç2c.1, decision 6.)
  const blend = (a: MapKey, c: MapKey, u: number): { lon: number; lat: number; z: number } => {
    const dist = Math.hypot((c.lon - a.lon) * Math.cos((((a.lat + c.lat) / 2) * Math.PI) / 180), c.lat - a.lat)
    const dip = Math.min(1.4, dist / 25) * Math.sin(Math.PI * u)
    const lz = Math.log(a.z) + (Math.log(c.z) - Math.log(a.z)) * u - dip
    return { lon: a.lon + (c.lon - a.lon) * u, lat: a.lat + (c.lat - a.lat) * u, z: Math.max(0.9, Math.exp(lz)) }
  }
  return evalKeys<MapKey, { lon: number; lat: number; z: number }>(keys, t, blend, {
    time: (k) => k.t,
    ease: (p) => glide(p),
    minSpan: 1e-3,
    lastInSegment: true,
    hold: (k) => ({ lon: k.lon, lat: k.lat, z: k.z })
  })!
}

export const arrivals = new Map<string, number[]>()
/**
 * When the camera reaches each place (block time): the first moment it is
 * near the middle of the frame and close enough in. Infinity: never — it
 * stays unlit and unpinned.
 */
export function atlasArrivals(b: Pick<TemplateBlock, 'items' | 'cams' | 'duration'>): number[] {
  const key = JSON.stringify([b.cams ?? [], b.items.map((it) => [it.title, it.value, it.value2]), b.duration])
  const hit = arrivals.get(key)
  if (hit) return hit
  const pls = mapPlaces(b)
  const out = pls.map(() => Infinity)
  for (let t = 0; t <= b.duration + 1e-6; t += 0.04) {
    const cam = atlasCamera(b, t)
    // The frame is 360/0.95/z degrees across: near means well inside it.
    const reach = (0.1 * 360) / 0.95 / cam.z
    pls.forEach((p, i) => {
      if (!p || Number.isFinite(out[i])) return
      if (cam.z < Math.min(3, mapZoomFor(p) * 0.35)) return
      const d = Math.hypot((p.lon - cam.lon) * Math.cos((p.lat * Math.PI) / 180), p.lat - cam.lat)
      if (d <= reach) out[i] = Math.max(0.3, t)
    })
  }
  if (arrivals.size > 200) arrivals.clear()
  arrivals.set(key, out)
  return out
}

/** A key written at block time t, on the frame grid of `fps`; one already on
 *  that frame is replaced (phase Ç2c.2, decision 1: it was a twentieth of a
 *  second, more than a frame). */
export function setAtlasKey(b: TemplateBlock, t: number, cam: { lon: number; lat: number; z: number }, fps: number): void {
  const k: MapKey = { t: Math.max(0, Math.min(b.duration, gridLocal(t, b.start, fps))), lon: Math.max(-200, Math.min(200, cam.lon)), lat: Math.max(-85, Math.min(85, cam.lat)), z: Math.max(0.9, Math.min(40, cam.z)) }
  const keys = (b.cams ?? []).filter((q) => !sameFrame(q.t, k.t, fps))
  keys.push(k)
  b.cams = keys.sort((p, q) => p.t - q.t)
}
