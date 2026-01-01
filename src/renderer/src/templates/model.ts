// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// Templates as data: defaults, the edits the panels make, and the repairs a
// loaded project gets. No DOM here, so all of it is unit-tested directly.

import { TEMPLATE_DESIGNS, type MapKey, type Project, type TemplateBlock, type TemplateDesign, type TemplateItem, type TemplateKind, type TemplateStyle, type WordsLook, cutSpan, uid } from '../types'
import { TEMPLATE_INFO, TEMPLATE_KINDS, defaultTemplateStyle, hex } from './info'
import { sampleItems, headline } from './samples'
import { glide } from './layout/common'
import { cleanDeal } from './layout/scenes'
import { defaultAtlasKeys } from './layout/map'
import { cutShift, cutSpanKey } from '../timeline/cut-shift'
import { cleanRevolverLook } from './layout/chapter'
export { placeable, templatePlace, placeMap, templateBounds, placeAt } from './layout/place'
export { boxesDesign, boxesLayout, linkPoint } from './layout/boxes'
export type { BoxesDesign, BoxesLayout } from './layout/boxes'
export { wordsCaptions, wordsFromSubs, wordsPhrases } from './layout/words'
export type { TimedWord } from './layout/words'
export { chapterDesign, revolverTimes, revolverLayout, cleanRevolverLook, scopeLayout, scopeTimes, chapterLayout, chapterTimes } from './layout/chapter'
export type { ChapterDesign } from './layout/chapter'
export { cutoutLayout, cutoutTimes } from './layout/cutout'
export type { CutoutPiece } from './layout/cutout'
export { niceCeil, barsMax, barLift, lineStretch, chartTimes, PIE_PULL, piePull, barsLayout, pieLayout, lineLayout } from './layout/charts'
export type { ChartLayout } from './layout/charts'
export { mapPlaces, mapTimes, mapTravel, mapSpread, mapPip, mapAnchor, mapDesign, mapHasPip, mapZoomFor, territoryStages, territoryBar, mapCamera, defaultAtlasKeys, atlasCamera, atlasArrivals, setAtlasKey } from './layout/map'
export type { MapDesign, Region } from './layout/map'
export { terminalDesign, keyFor, keyboardLayout, terminalLayout, terminalScript } from './layout/terminal'
export type { TerminalDesign, KeyCap, TypedLine } from './layout/terminal'
export { homeDesign, homeOpens, homeTimes, homeSwipe, homeLiveCard, homeLayout, homeFocus } from './layout/home'
export type { HomeDesign, HomeLayout } from './layout/home'
export { galleryLayout, countLayout, focusLayout, compareLayout, compareKeys, compareSplit, checklistLayout, postLayout, pollLayout, cardsLayout, cardsPick, cardsTimes, cardsPickPlace, newsTimes, listLayout, listTimes, searchThumb, SEARCH_OPEN, storeLayout, storeTimes, dominoLayout, dominoTimes } from './layout/scenes'
export type { ListLayout, DominoLayout } from './layout/scenes'
export { galleryTimes, templateSlots, glide, boxesTimes } from './layout/common'
export { TEMPLATE_INFO, SCENE_KINDS, TEMPLATE_KINDS, defaultTemplateStyle, TEMPLATE_PALETTES, ownVariant, isDarkStyle, palettesFor } from './info'
export type { TemplatePalette } from './info'

/** `seed` (the hand-made jitter) from the caller: a command passes one from
 *  its env, so a seeded batch is repeatable; the UI's default is random. */
export function createTemplate(p: Project, kind: TemplateKind, start: number, seed?: number): string {
  // A new home screen is the same home screen: the chapters, their look.
  const twin = kind === 'home' || kind === 'chapter' ? p.templates?.find((t) => t.kind === kind) : undefined
  const block: TemplateBlock = {
    id: uid(),
    kind,
    start: Math.max(0, start),
    duration: TEMPLATE_INFO[kind].duration,
    title: twin ? twin.title : headline(kind),
    items: twin ? twin.items.map((it) => ({ ...it })) : sampleItems(kind).map((it) => ({ id: uid(), ...it })),
    style: twin ? { ...twin.style } : defaultTemplateStyle(kind),
    seed: seed ?? Math.floor(Math.random() * 1e6),
    ...(twin?.design ? { design: twin.design } : {})
  }
  // A chart counts down to number one.
  if (kind === 'store') block.countdown = true
  // Your-camera map: it opens on the world and flies to the first place.
  if (kind === 'atlas') block.cams = defaultAtlasKeys(block)
  p.templates = [...(p.templates ?? []), block]
  sortTemplates(p)
  return block.id
}

export function findTemplate(p: Project, id: string): TemplateBlock | undefined {
  return p.templates?.find((t) => t.id === id)
}

function sortTemplates(p: Project): void {
  p.templates?.sort((a, b) => a.start - b.start)
}

export function updateTemplate(
  p: Project,
  id: string,
  patch: Partial<Pick<TemplateBlock, 'start' | 'duration' | 'title' | 'seed' | 'kind'>>
): void {
  const t = findTemplate(p, id)
  if (!t) return
  Object.assign(t, patch)
  // Versus draws two sides; switching to it must leave it two to draw.
  while (t.kind === 'versus' && t.items.length < 2) t.items.push({ id: uid(), title: t.items.length ? 'Option B' : 'Option A' })
  t.start = Math.max(0, Number.isFinite(t.start) ? t.start : 0)
  t.duration = Math.min(120, Math.max(1, Number.isFinite(t.duration) ? t.duration : 5))
  t.title = t.title.slice(0, 80)
  // A cut the new length no longer reaches is gone.
  if (t.cut !== undefined && t.cut > t.duration - CUT_MIN_LEFT) delete t.cut
  sortTemplates(p)
}

/** Big words' settings, made safe (anything odd left to the style). */
export function cleanWordsLook(v: unknown): WordsLook {
  const o = (v ?? {}) as Record<string, unknown>
  const out: WordsLook = {}
  const n = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x)
  if (n(o.per)) out.per = Math.max(1, Math.min(8, Math.round(o.per)))
  if (o.band === false) out.band = false
  if (n(o.size)) out.size = Math.max(0.4, Math.min(2.5, o.size))
  if (n(o.dim)) out.dim = Math.max(0, Math.min(1, o.dim))
  if (n(o.y)) out.y = Math.max(0.1, Math.min(0.92, o.y))
  if (o.blend === 'overlay' || o.blend === 'soft' || o.blend === 'difference' || o.blend === 'window') out.blend = o.blend
  if (o.click === false) out.click = false
  if (n(o.clickVol)) out.clickVol = Math.max(0, Math.min(1, o.clickVol))
  return out
}

/** The least of a template left after its cut (else it is not cut at all). */
const CUT_MIN_LEFT = 0.25

/**
 * Cuts a template short at `local` seconds into it — its pace stays that of
 * its whole length; from the cut it leaves the frame. `undefined`
 * (or a cut too near either end) restores it whole.
 */
export function setTemplateCut(p: Project, id: string, local: number | undefined): void {
  const t = findTemplate(p, id)
  if (!t) return
  if (local === undefined || !Number.isFinite(local) || local < 0.3 || local > t.duration - CUT_MIN_LEFT) delete t.cut
  else t.cut = Math.round(local * 1000) / 1000
}

/** How far a cut template has been pushed off (0 → 1) at local time t. */
export const cutGone = (b: Pick<TemplateBlock, 'duration' | 'cut' | 'cutExit'>, t: number): number =>
  b.cut === undefined || t <= b.cut ? 0 : glide((t - b.cut) / cutSpan(b))

/** A cut template leaves downwards, this far (frame heights) — off the bottom. */
export const CUT_DROP = 1.06

export function setTemplateStyle(p: Project, id: string, patch: Partial<TemplateStyle>): void {
  const t = findTemplate(p, id)
  if (!t) return
  t.style = { ...t.style, ...patch }
}

export function deleteTemplate(p: Project, id: string): void {
  if (!p.templates) return
  p.templates = p.templates.filter((t) => t.id !== id)
  if (p.templates.length === 0) delete p.templates
}

export function addTemplateItem(p: Project, id: string): string | null {
  const t = findTemplate(p, id)
  if (!t || t.items.length >= TEMPLATE_INFO[t.kind].max + (t.kind === 'versus' ? 2 : 0)) return null
  const item: TemplateItem = { id: uid(), title: t.kind === 'versus' ? 'Stat' : 'New item' }
  if (t.kind === 'versus') {
    item.value = 5
    item.value2 = 5
  }
  if (t.kind === 'timeline') item.note = String(new Date().getFullYear())
  if (t.kind === 'ranking') item.value = 50
  t.items.push(item)
  return item.id
}

export function updateTemplateItem(p: Project, id: string, itemId: string, patch: Partial<Omit<TemplateItem, 'id'>>): void {
  const it = findTemplate(p, id)?.items.find((x) => x.id === itemId)
  if (!it) return
  Object.assign(it, patch)
  for (const k of Object.keys(it) as (keyof TemplateItem)[]) if (it[k] === undefined) delete it[k]
  it.title = (it.title ?? '').slice(0, 80)
  if (it.note !== undefined) it.note = it.note.slice(0, 80)
  for (const k of ['value', 'value2'] as const) {
    if (it[k] !== undefined && !Number.isFinite(it[k])) delete it[k]
  }
}

export function removeTemplateItem(p: Project, id: string, itemId: string): void {
  const t = findTemplate(p, id)
  if (!t) return
  // Versus needs its two sides; everything else needs one item.
  const floor = t.kind === 'versus' ? 2 : 1
  if (t.items.length <= floor) return
  if (t.kind === 'versus' && t.items.findIndex((x) => x.id === itemId) < 2) return
  t.items = t.items.filter((x) => x.id !== itemId)
}

export function moveTemplateItem(p: Project, id: string, itemId: string, dir: -1 | 1): void {
  const t = findTemplate(p, id)
  if (!t) return
  const i = t.items.findIndex((x) => x.id === itemId)
  const j = i + dir
  // The two sides of a versus stay where they are; only stat rows reorder.
  const lo = t.kind === 'versus' ? 2 : 0
  if (i < lo || j < lo || j >= t.items.length) return
  ;[t.items[i], t.items[j]] = [t.items[j], t.items[i]]
}

/** Whole-timeline cut a..b: blocks move with the footage and lose the part of
 *  their length that was removed. Their camera keys and box times (block
 *  seconds) follow what they sit on (phase Ç2c.2, decision 3; report K16:
 *  the camera arrived later than the narration it was timed to). */
export function rippleTemplates(p: Project, a: number, b: number): void {
  const range = b - a
  if (!p.templates || range <= 0) return
  const shift = cutShift(a, b)
  p.templates = p.templates
    // A graphic whose whole span was removed has nothing left to show.
    .filter((t) => !(t.start >= a && t.start + t.duration <= b))
    .map((t) => {
      const start = shift(t.start)
      const out = { ...t, start, duration: Math.max(1, shift(t.start + t.duration) - start) }
      // Its exit is timed to the content too (Ç2c patch, item 4); one the cut
      // took leaves at the join (not before the shortest cut, as Ctrl+B).
      if (out.cut !== undefined) out.cut = Math.max(0.3, shift(t.start + out.cut) - start)
      if (out.cut !== undefined && out.cut > out.duration - CUT_MIN_LEFT) delete out.cut
      const span = { start: t.start, end: t.start + t.duration }
      // A block the cut does not touch keeps its own seconds.
      if (span.end <= a || span.start >= b) return out
      if (t.cams?.length) {
        out.cams = t.cams.flatMap((k) => {
          const at = cutSpanKey(k.t, span, start, a, b)
          return at === null ? [] : [{ ...k, t: at }]
        })
      }
      if (t.items.some((it) => it.at !== undefined)) {
        out.items = t.items.map((it) => {
          if (it.at === undefined) return it
          const at = cutSpanKey(it.at, span, start, a, b)
          const next = { ...it }
          if (at === null) delete next.at
          else next.at = at
          return next
        })
      }
      return out
    })
  if (p.templates.length === 0) delete p.templates
}

const KINDS = new Set<string>(TEMPLATE_KINDS)
const num = (v: unknown, fallback: number, lo: number, hi: number): number =>
  typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : fallback

/** Makes loaded template data safe to draw; returns how much it repaired. */
export function sanitizeTemplates(p: Project): number {
  const raw = (p as { templates?: unknown }).templates
  if (raw === undefined) return 0
  if (!Array.isArray(raw)) {
    delete p.templates
    return 1
  }
  let fixed = 0
  const out: TemplateBlock[] = []
  // A graphic of a kind this build does not know (a newer Snipp's) is kept
  // as it was, not drawn, and written back into the file (phase Ç2a.1;
  // media/projectio.ts serializeProject). It used to be dropped silently.
  const unknown: Record<string, unknown>[] = []
  for (const t of raw as Partial<TemplateBlock>[]) {
    if (t && typeof t === 'object' && typeof t.id === 'string' && typeof t.kind === 'string' && !KINDS.has(t.kind)) {
      unknown.push(t as unknown as Record<string, unknown>)
      fixed++
      continue
    }
    if (!t || typeof t.id !== 'string' || !KINDS.has(t.kind as string)) {
      fixed++
      continue
    }
    const kind = t.kind as TemplateKind
    const def = defaultTemplateStyle(kind)
    const st = (t.style ?? {}) as Partial<TemplateStyle>
    const items: TemplateItem[] = []
    for (const it of (Array.isArray(t.items) ? t.items : []) as Partial<TemplateItem>[]) {
      if (!it || typeof it.id !== 'string') {
        fixed++
        continue
      }
      const clean: TemplateItem = { id: it.id, title: typeof it.title === 'string' ? it.title.slice(0, 80) : '' }
      if (typeof it.note === 'string') clean.note = it.note.slice(0, 80)
      if (typeof it.value === 'number' && Number.isFinite(it.value)) clean.value = it.value
      if (typeof it.value2 === 'number' && Number.isFinite(it.value2)) clean.value2 = it.value2
      if (typeof it.assetId === 'string') clean.assetId = it.assetId
      if (typeof it.at === 'number' && Number.isFinite(it.at)) clean.at = Math.max(0, Math.min(120, it.at))
      items.push(clean)
    }
    while (items.length < (kind === 'versus' ? 2 : 1)) items.push({ id: uid(), title: '' })
    out.push({
      id: t.id,
      kind,
      start: num(t.start, 0, 0, 1e6),
      duration: num(t.duration, TEMPLATE_INFO[kind].duration, 1, 120),
      title: typeof t.title === 'string' ? t.title.slice(0, 80) : '',
      items,
      style: {
        accent: hex(st.accent, def.accent),
        ink: hex(st.ink, def.ink),
        card: hex(st.card, def.card),
        font: typeof st.font === 'string' && st.font.length < 60 ? st.font : def.font,
        hand: typeof st.hand === 'boolean' ? st.hand : def.hand,
        backdrop: st.backdrop === 'none' || st.backdrop === 'dim' || st.backdrop === 'blur' || st.backdrop === 'paper' || st.backdrop === 'card' ? st.backdrop : def.backdrop
      },
      seed: num(t.seed, 1, 0, 1e9),
      ...(typeof t.open === 'number' && Number.isFinite(t.open) ? { open: Math.max(0, Math.min(50, Math.round(t.open))) } : {}),
      ...(TEMPLATE_DESIGNS.includes(t.design as TemplateDesign) ? { design: t.design } : {}),
      ...(typeof t.travel === 'number' && Number.isFinite(t.travel) ? { travel: Math.max(0.2, Math.min(6, t.travel)) } : {}),
      ...(t.from === 'left' || t.from === 'right' || t.from === 'top' ? { from: t.from } : {}),
      ...(typeof t.spread === 'number' && Number.isFinite(t.spread) ? { spread: Math.max(0.1, Math.min(6, t.spread)) } : {}),
      ...(t.place && typeof t.place === 'object' && [t.place.x, t.place.y, t.place.s].every((v) => typeof v === 'number' && Number.isFinite(v))
        ? { place: { x: Math.max(-1, Math.min(1, t.place.x)), y: Math.max(-1, Math.min(1, t.place.y)), s: Math.max(0.25, Math.min(2.5, t.place.s)) } }
        : {}),
      ...(typeof t.size === 'number' && Number.isFinite(t.size) ? { size: Math.max(0.3, Math.min(1, t.size)) } : {}),
      ...(typeof t.fen === 'string' && t.fen.length < 100 ? { fen: t.fen } : {}),
      ...(t.flip === true ? { flip: true } : {}),
      ...(typeof t.pip === 'boolean' ? { pip: t.pip } : {}),
      ...(t.follow === true ? { follow: true } : {}),
      ...(t.countdown === true ? { countdown: true } : {}),
      ...(t.own === true ? { own: true } : {}),
      ...(t.keepSubs === true ? { keepSubs: true } : {}),
      ...(t.big && typeof t.big === 'object' ? { big: cleanWordsLook(t.big) } : {}),
      ...(t.rev && typeof t.rev === 'object' ? { rev: cleanRevolverLook(t.rev) } : {}),
      ...cleanDeal(t.deal),
      ...(t.clock && typeof t.clock === 'object'
        ? (() => {
            const ck: { start?: number; total?: number } = {}
            const o = t.clock as Record<string, unknown>
            if (typeof o.start === 'number' && Number.isFinite(o.start)) ck.start = Math.max(0, Math.min(360000, o.start))
            if (typeof o.total === 'number' && Number.isFinite(o.total)) ck.total = Math.max(1, Math.min(360000, o.total))
            return ck.start !== undefined || ck.total !== undefined ? { clock: ck } : {}
          })()
        : {}),
      ...(typeof t.cut === 'number' && Number.isFinite(t.cut) && t.cut >= 0.3 && typeof t.duration === 'number' && t.cut <= t.duration - CUT_MIN_LEFT ? { cut: t.cut } : {}),
      ...(t.cutExit === 'fade' || t.cutExit === 'slide' || t.cutExit === 'cut' ? { cutExit: t.cutExit } : {}),
      ...(Array.isArray(t.cams)
        ? {
            cams: (t.cams as Partial<MapKey>[])
              .filter((k) => k && [k.t, k.lon, k.lat, k.z].every((v) => typeof v === 'number' && Number.isFinite(v)))
              .slice(0, 80)
              .map((k) => ({ t: Math.max(0, Math.min(120, k.t!)), lon: Math.max(-200, Math.min(200, k.lon!)), lat: Math.max(-85, Math.min(85, k.lat!)), z: Math.max(0.9, Math.min(40, k.z!)) }))
              .sort((a, b) => a.t - b.t)
          }
        : {})
    })
  }
  if (out.length > 0) p.templates = out.sort((a, b) => a.start - b.start)
  else delete p.templates
  if (unknown.length > 0) p.unknownTemplates = unknown
  else delete p.unknownTemplates
  return fixed
}

// -- home screens ------------------------------------------------------------------

/** Every home screen shows the same home: the chapters, the headline, the
 *  look. An edit to one is copied to the rest (each keeps its own place on
 *  the timeline and which chapter it opens). */
export function syncHomes(p: Project, fromId: string): void {
  const src = findTemplate(p, fromId)
  if (!src || (src.kind !== 'home' && src.kind !== 'chapter')) return
  for (const t of p.templates ?? []) {
    if (t.id === src.id || t.kind !== src.kind) continue
    t.title = src.title
    t.items = src.items.map((it) => ({ ...it }))
    t.style = { ...src.style }
    if (src.design) t.design = src.design
    else delete t.design
    if (src.rev) t.rev = { ...src.rev }
    else delete t.rev
  }
}

/** Sets when box `index` lights (block seconds; undefined: by itself). */
export function setBoxTime(p: Project, id: string, index: number, at: number | undefined): void {
  const t = findTemplate(p, id)
  const it = t?.items[index]
  if (!t || !it) return
  if (at === undefined || !Number.isFinite(at)) delete it.at
  else it.at = Math.round(Math.max(0, Math.min(t.duration - 0.1, at)) * 100) / 100
}

