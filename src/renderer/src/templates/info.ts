// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// The template kinds: their names and hints, which are scenes, default styles
// and palettes. Moved out of templates/model.ts in SnippStudio phase 2B (no change).
import { type TemplateKind, type TemplateStyle } from '../types'

export const TEMPLATE_INFO: Record<
  TemplateKind,
  { label: string; icon: string; hint: string; duration: number; min: number; max: number }
> = {
  steps: { label: 'Steps', icon: '①', hint: 'Numbered steps, one after another, each with an optional photo', duration: 9, min: 1, max: 8 },
  ranking: { label: 'Top list', icon: '🏆', hint: 'A countdown to number one, with a growing leaderboard', duration: 12, min: 2, max: 10 },
  versus: { label: 'Versus', icon: '⚔', hint: 'Two sides and the stats that decide it', duration: 9, min: 2, max: 7 },
  stat: { label: 'Big number', icon: '#', hint: 'One number that counts up and lands, with context', duration: 6, min: 1, max: 4 },
  timeline: { label: 'Timeline', icon: '⟶', hint: 'Events along a line the camera travels down', duration: 12, min: 2, max: 10 },
  gallery: { label: 'Gallery', icon: '▦', hint: "A photo app: each photo opens in turn", duration: 12, min: 2, max: 9 },
  count: { label: 'Count', icon: '☝', hint: "A short list counted up — a big number goes up as each item lands", duration: 8, min: 1, max: 5 },
  focus: { label: 'Tap to open', icon: '⤢', hint: "Cards on screen; one opens to fill the frame, then the next", duration: 10, min: 1, max: 4 },
  home: { label: 'Home screen', icon: '⌂', hint: "Between chapters: the video swipes home into its place and the next chapter opens — one take, no cut. Put it over a cut", duration: 3.6, min: 1, max: 9 },
  map: { label: 'World map', icon: '◍', hint: 'The video steps aside and a dotted map flies to each place you name (the world, or Turkey and its ancient sites), or shows a territory growing stage by stage', duration: 7, min: 1, max: 8 },
  terminal: { label: 'Terminal', icon: '⌨', hint: "A keyboard rises from the dock and types your lines into a terminal, key by key", duration: 8, min: 1, max: 6 },
  compare: { label: 'Before / after', icon: '◧', hint: "Two pictures and a divider that slides from one to the other and back", duration: 7, min: 2, max: 2 },
  checklist: { label: 'Checklist', icon: '☑', hint: "A list on a card; each item is ticked off in turn", duration: 7, min: 1, max: 7 },
  post: { label: 'Comments', icon: '♥', hint: "Comments or posts slide up one by one; each heart is tapped and the count ticks on", duration: 7, min: 1, max: 3 },
  cards: { label: 'Card deck', icon: '🂠', hint: "Your pictures dealt from a deck, face down in a row, then turned over one by one", duration: 8, min: 2, max: 6 },
  chess: { label: 'Chess board', icon: '♞', hint: "A real chess game: write the moves (or play them on the little board) and each one is played on the board — captures, castling, check and mate — the game written down beside it", duration: 10, min: 1, max: 120 },
  news: { label: 'In the news', icon: '📰', hint: 'One word match-cut across page after page — papers, news sites, a phone — held dead center under the same marker, each cut quicker; each page fills the frame, paper with its grain, screens with their pixels', duration: 5, min: 2, max: 16 },
  atlas: { label: 'Map · your camera', icon: '🧭', hint: 'The dotted map with the camera yours: drag the map in the preview to move it, scroll to zoom — each a keyframe at the playhead. Places light up and pin as the camera reaches them; the video window is optional', duration: 10, min: 1, max: 12 },
  chapter: { label: 'Chapter', icon: '🎞', hint: "Between chapters, as a revolver: the video sinks back, a drum of the chapters' pictures clicks round — tak, tak — to the next one while its line snaps up onto a slab, then it opens into its footage. Or through a scope: the video narrows into a round eyepiece seen up close and the view swings to the next chapter — sharp in the glass, blurred behind — with its number and title, then the glass opens into its footage. Or as a cinema reel. Put it over the cut", duration: 3.8, min: 1, max: 12 },
  list: { label: 'List video', icon: '☰', hint: "A list, item by item: every picture small in a strip, the next one grows into the big frame with its number, heading and a line — then goes back down, ticked. Counting up, or down to number one", duration: 16, min: 2, max: 12 },
  words: { label: 'Big words', icon: 'Aa', hint: 'The narration set big on the screen in a heavy face, timed by the subtitles word by word (or your own lines): Apple, Stack, Punch or Karaoke. The subtitles under it step aside', duration: 8, min: 1, max: 30 },
  player: { label: 'Video player', icon: '▶', hint: "The picture as a video player: it pauses (freeze the picture under it in one click), skips, opens the settings for speed or quality (dropping to 144p pixelates it), turns captions on", duration: 8, min: 1, max: 12 },
  store: { label: 'Store chart', icon: '★', hint: "A store's top chart counted down — 15 to 1 — the list scrolling on a phone-like panel as each entry comes up large beside it, its icon, rank, name, stars and its GET button. Games, apps, films, anything ranked", duration: 40, min: 2, max: 30 },
  poll: { label: 'Poll', icon: '▤', hint: "A question and its answers; a vote goes in and the results fill in", duration: 7, min: 2, max: 5 },
  cutout: { label: 'Cutout title', icon: '✂', hint: "Your title as paper cutouts — each word a different paper and type — brought in from the edges and pressed down", duration: 5, min: 1, max: 12 },
  bars: { label: 'Bar chart', icon: '▮', hint: "Numbers as bars: each one rises to its value while the number counts up — the leader in the accent", duration: 8, min: 2, max: 8 },
  pie: { label: 'Pie chart', icon: '◔', hint: "A donut drawn slice by slice; each one opens and its share counts up in the middle", duration: 8, min: 2, max: 6 },
  line: { label: 'Line chart', icon: '⟋', hint: "Change over time: the line grows point by point, a second line to compare", duration: 9, min: 2, max: 12 },
  domino: { label: 'Domino', icon: '🁣', hint: "One thing leads to another: tiles stand in a row, the first falls and each falls onto the next — its word coming up under it as it goes", duration: 7, min: 2, max: 7 },
  boxes: { label: 'Box to box', icon: '⧉', hint: 'A main box and the boxes it leads to: it lights up and its light runs along a line into each one in turn — you time every glow (in the list, or by dragging the marks on the G lane). As a hub, a flow or a chain', duration: 7, min: 2, max: 7 },
  quote: { label: 'Verse / quote', icon: '❝', hint: "A verse or a quote on a panel that glides in from the side (or drops from the top), word by word, its reference under it", duration: 8, min: 1, max: 2 }
}

/** Templates that take the live picture itself and turn it into part of
 *  the scene (a card that swipes home, a picture-in-picture). */
export const SCENE_KINDS = new Set<TemplateKind>(['home', 'map', 'atlas', 'chapter', 'player'])

export const TEMPLATE_KINDS = Object.keys(TEMPLATE_INFO) as TemplateKind[]

export function defaultTemplateStyle(kind: TemplateKind): TemplateStyle {
  const base: TemplateStyle = { accent: '#ffcf3a', ink: '#161616', card: '#fbf6ea', font: 'Archivo Black', hand: true, backdrop: 'dim' }
  if (kind === 'stat') return { ...base, accent: '#44d4c8', ink: '#ffffff', card: '#101014', font: 'Anton', backdrop: 'dim' }
  if (kind === 'versus') return { ...base, accent: '#ff5c5c', card: '#fbf6ea', font: 'Bangers', backdrop: 'paper' }
  if (kind === 'timeline') return { ...base, accent: '#ff8a4c', backdrop: 'paper' }
  // A clean app screen: no hand-made tilt, a quiet dark panel.
  if (kind === 'gallery') return { accent: '#4f8cff', ink: '#f2f3f6', card: '#141519', font: 'Inter', hand: false, backdrop: 'dim' }
  // The sticker look: white, a bold black line, a sticker shadow.
  if (kind === 'count' || kind === 'focus') return { accent: '#ffd23f', ink: '#0b0b0d', card: '#ffffff', font: 'Archivo Black', hand: false, backdrop: 'dim' }
  // A home screen: a deep, quiet ground for the chapters to sit on.
  if (kind === 'home') return { accent: '#7aa2ff', ink: '#f4f5f8', card: '#0f1116', font: 'Inter', hand: false, backdrop: 'none' }
  if (kind === 'map' || kind === 'atlas') return { accent: '#ff5a3c', ink: '#0b0b0d', card: '#f3f1ea', font: 'Archivo Black', hand: false, backdrop: 'none' }
  if (kind === 'terminal') return { accent: '#7ee787', ink: '#0b0b0d', card: '#ffffff', font: 'Inter', hand: false, backdrop: 'dim' }
  // The sticker look: white cards, a bold ink line and yellow.
  if (kind === 'compare' || kind === 'checklist' || kind === 'post' || kind === 'poll' || kind === 'cards' || kind === 'list' || kind === 'domino') return { accent: '#ffd23f', ink: '#0b0b0d', card: '#ffffff', font: 'Archivo Black', hand: false, backdrop: 'dim' }
  // A store's chart: a clean light panel, one blue.
  if (kind === 'store') return { accent: '#0a84ff', ink: '#111114', card: '#ffffff', font: 'Inter', hand: false, backdrop: 'dim' }
  // A video player: its own chrome over the live picture.
  if (kind === 'player') return { accent: '#ff2a2a', ink: '#ffffff', card: '#111111', font: 'Inter', hand: false, backdrop: 'none' }
  // Big words: Snipp's own heavy face, white over the dimmed picture.
  if (kind === 'words') return { accent: '#ffd23f', ink: '#0b0b0d', card: '#ffffff', font: 'Snipp Display', hand: false, backdrop: 'dim' }
  // A cinema reel: the dark of a theatre, warm gold, a tall narrow face.
  if (kind === 'chapter') return { accent: '#e8c37a', ink: '#f4f1ea', card: '#0b0b0e', font: 'Oswald', hand: false, backdrop: 'none' }
  // A chess set: cream and stone squares, a dark frame, a warm highlight.
  if (kind === 'chess') return { accent: '#f2c14e', ink: '#141414', card: '#efe6d4', font: 'Archivo Black', hand: false, backdrop: 'dim' }
  // The word in the news: the pages bring their own look; the marker is the accent.
  if (kind === 'news') return { accent: '#ffd23f', ink: '#0b0b0d', card: '#ffffff', font: 'Archivo Black', hand: false, backdrop: 'none' }
  // Cutouts: the words are the colour; tape on them (the hand-made look).
  if (kind === 'cutout') return { accent: '#ffd23f', ink: '#0b0b0d', card: '#ffffff', font: 'Archivo Black', hand: true, backdrop: 'dim' }
  // Charts: clean over the picture, a bold ink and one accent.
  if (kind === 'bars') return { accent: '#ff5a3c', ink: '#0b0b0d', card: '#fbf6ea', font: 'Archivo Black', hand: false, backdrop: 'blur' }
  if (kind === 'pie') return { accent: '#4fa8ff', ink: '#0b0b0d', card: '#fbf6ea', font: 'Archivo Black', hand: false, backdrop: 'blur' }
  if (kind === 'line') return { accent: '#ffd23f', ink: '#0b0b0d', card: '#fbf6ea', font: 'Archivo Black', hand: false, backdrop: 'dim' }
  // Box to box: dark glass cards, one electric accent for the light.
  if (kind === 'boxes') return { accent: '#4f7dff', ink: '#eef2ff', card: '#0e1322', font: 'Inter', hand: false, backdrop: 'blur' }
  // A page of a fine book: deep ink-blue, warm white words, a gold rule.
  if (kind === 'quote') return { accent: '#c9a45c', ink: '#f3efe6', card: '#101218', font: 'Merriweather', hand: false, backdrop: 'none' }
  return base
}

/** A colour set for a template: its one accent, its ink (lines and words)
 *  and its cards. */
export interface TemplatePalette {
  name: string
  accent: string
  ink: string
  card: string
}

/** Palettes in the channel's look: the sticker ones (light cards, a bold
 *  dark line, one strong accent) and the night ones (deep cards, warm light
 *  words) — each a single accent, never a rainbow. */
export const TEMPLATE_PALETTES: TemplatePalette[] = [
  { name: 'Signal yellow', accent: '#ffd23f', ink: '#0b0b0d', card: '#ffffff' },
  { name: 'Tomato', accent: '#ff5a3c', ink: '#0b0b0d', card: '#ffffff' },
  { name: 'Cobalt', accent: '#3b6cf6', ink: '#0b0b0d', card: '#ffffff' },
  { name: 'Mint', accent: '#22c7a0', ink: '#0b0b0d', card: '#ffffff' },
  { name: 'Lilac', accent: '#9b7bff', ink: '#0b0b0d', card: '#ffffff' },
  { name: 'Bubblegum', accent: '#ff6fae', ink: '#0b0b0d', card: '#ffffff' },
  { name: 'Red on cream', accent: '#d6452f', ink: '#1d1b17', card: '#f3ecdc' },
  { name: 'Forest', accent: '#2f8f5b', ink: '#11160f', card: '#f4efe2' },
  { name: 'Coral and navy', accent: '#ff7a59', ink: '#14213d', card: '#fdf6ec' },
  { name: 'Night gold', accent: '#c9a45c', ink: '#f3efe6', card: '#101218' },
  { name: 'Night yellow', accent: '#ffd23f', ink: '#f5f5f0', card: '#121316' },
  { name: 'Deep teal', accent: '#44d4c8', ink: '#ffffff', card: '#0f1417' },
  { name: 'Ember', accent: '#ff7a45', ink: '#f6efe7', card: '#17120f' },
  { name: 'Violet night', accent: '#a78bfa', ink: '#f2f0ff', card: '#131122' },
  { name: 'Blue hour', accent: '#7aa2ff', ink: '#f4f5f8', card: '#0f1116' }
]

/** Palettes made for one template, offered in place of the shared ones.
 *  Box to box is glass and light: a deep glass tinted towards its light (or
 *  a frosted light one), the light itself strong enough to fill the main box. */
export const KIND_PALETTES: Partial<Record<TemplateKind, TemplatePalette[]>> = {
  boxes: [
    { name: 'Electric', accent: '#4f7dff', ink: '#eef2ff', card: '#0e1322' },
    { name: 'Aurora', accent: '#2dd4bf', ink: '#e9fbfa', card: '#0a1719' },
    { name: 'Lime', accent: '#4ade80', ink: '#ecfdf3', card: '#0c1612' },
    { name: 'Amber', accent: '#ffb224', ink: '#fff7e8', card: '#17120a' },
    { name: 'Sunset', accent: '#ff6b4a', ink: '#fff0ec', card: '#1a0f10' },
    { name: 'Magenta', accent: '#f050c8', ink: '#fdeeff', card: '#170d1a' },
    { name: 'Violet', accent: '#9d6bff', ink: '#f1edff', card: '#120f22' },
    { name: 'Signal yellow', accent: '#ffd23f', ink: '#f6f6f2', card: '#121214' },
    { name: 'Silver', accent: '#d9dde6', ink: '#f4f5f7', card: '#131417' },
    { name: 'Frost blue', accent: '#2f6bff', ink: '#111827', card: '#f5f7fb' },
    { name: 'Frost mint', accent: '#10b981', ink: '#0f1f1a', card: '#f3faf7' },
    { name: 'Paper coral', accent: '#f2552c', ink: '#1f1a17', card: '#fbf6f1' },
    { name: 'Frost violet', accent: '#7c4dff', ink: '#18142b', card: '#f6f4fd' }
  ]
}

export const lum = (hex: string): number => {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex)
  const n = m ? parseInt(m[1], 16) : 0
  return (0.2126 * ((n >> 16) & 255) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255)) / 255
}

/** A colour's hue, saturation and lightness moved a little (hex in, out). */
export function tune(hex: string, dSat: number, dLight: number): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex)
  const n = m ? parseInt(m[1], 16) : 0x888888
  const r = ((n >> 16) & 255) / 255
  const g = ((n >> 8) & 255) / 255
  const b = (n & 255) / 255
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  let h = 0
  let s = 0
  const l = (max + min) / 2
  const d = max - min
  if (d > 0) {
    s = d / (1 - Math.abs(2 * l - 1))
    if (max === r) h = ((g - b) / d) % 6
    else if (max === g) h = (b - r) / d + 2
    else h = (r - g) / d + 4
    h *= 60
  }
  const s2 = Math.min(1, Math.max(0, s + dSat))
  const l2 = Math.min(0.92, Math.max(0.08, l + dLight))
  const c = (1 - Math.abs(2 * l2 - 1)) * s2
  const x = c * (1 - Math.abs(((((h / 60) % 2) + 2) % 2) - 1))
  const mm = l2 - c / 2
  const [r1, g1, b1] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x]
  const to = (v: number): string => Math.round((v + mm) * 255).toString(16).padStart(2, '0')
  return `#${to(r1)}${to(g1)}${to(b1)}`
}

/**
 * A template's own colours for a dark video: deep cards, warm off-white
 * words, and its accent calmed — a touch lighter and less saturated, so it
 * glows without stinging on a dark screen. (For a template that is dark
 * already, its light version.)
 */
export function ownVariant(kind: TemplateKind): TemplatePalette {
  const own = defaultTemplateStyle(kind)
  // A template with palettes of its own: the first of the other theme.
  const made = KIND_PALETTES[kind]?.find((p) => lum(p.card) < 0.5 !== lum(own.card) < 0.5)
  if (made) return made
  if (lum(own.card) < 0.5) {
    return { name: 'Its own · light', accent: tune(own.accent, 0.05, -0.08), ink: '#16171b', card: '#f7f4ee' }
  }
  return { name: 'Its own · dark', accent: tune(own.accent, -0.12, 0.06), ink: '#ece8df', card: '#17181d' }
}

/** Is this template set in dark colours (deep cards)? */
export const isDarkStyle = (st: Pick<TemplateStyle, 'card'>): boolean => lum(st.card) < 0.5

/** The palettes to offer a template: its own and its own dark (or light)
 *  version first, then the ones of its kind, then the rest. */
export function palettesFor(kind: TemplateKind): TemplatePalette[] {
  const own = defaultTemplateStyle(kind)
  const dark = lum(own.card) < 0.5
  const same = (p: TemplatePalette): boolean => p.accent === own.accent && p.ink === own.ink && p.card === own.card
  const made = KIND_PALETTES[kind]
  if (made) {
    const variant = ownVariant(kind)
    const others = made.filter((p) => !same(p) && !(p.accent === variant.accent && p.ink === variant.ink && p.card === variant.card))
    return [
      { name: 'Its own', accent: own.accent, ink: own.ink, card: own.card },
      ...others.filter((p) => lum(p.card) < 0.5 === dark),
      variant,
      ...others.filter((p) => lum(p.card) < 0.5 !== dark)
    ]
  }
  const rest = TEMPLATE_PALETTES.filter((p) => !same(p))
  return [
    { name: 'Its own', accent: own.accent, ink: own.ink, card: own.card },
    ownVariant(kind),
    ...rest.filter((p) => lum(p.card) < 0.5 === dark),
    ...rest.filter((p) => lum(p.card) < 0.5 !== dark)
  ]
}
export const hex = (v: unknown, fallback: string): string =>
  typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v) ? v : fallback
