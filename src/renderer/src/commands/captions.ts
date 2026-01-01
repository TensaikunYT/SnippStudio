// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// Subtitles, titles and shapes: add a title or a shape, change a line (its
// words keep their times), delete, the subtitle style. Bodies as they were in
// state/store.ts (phase 2A); the playhead is the `time` parameter, the canvas
// text measure comes through env.
import type { Caption, CaptionShape, CaptionStyle, Project, ShapeKind } from '../types'
import { uid } from '../types'
import { alignCaptionWordsToText } from '../subtitles/split'
import { remapMarkedWords } from '../subtitles/marker'
import { clone } from './ops/base'
import { CommandError, defineCommand, type CommandEnv } from './core'
import { s } from './schema'
import { requireCaption, requireFreshId } from './require'
import { withFirstId } from '../types'

/** The style fields an agent may set (CaptionStyle), with their ranges. */
export const styleFields = s.object({
  fontFamily: s.optional(s.string({ min: 1, max: 80 })),
  fontSize: s.optional(s.number({ min: 8, max: 400, description: 'px at 1080p' })),
  fontWeight: s.optional(s.integer({ min: 100, max: 1000 })),
  color: s.optional(s.color()),
  outlineColor: s.optional(s.color()),
  outlineWidth: s.optional(s.number({ min: 0, max: 60 })),
  bgColor: s.optional(s.color()),
  bgOpacity: s.optional(s.number({ min: 0, max: 1 })),
  bgRadius: s.optional(s.number({ min: 0, max: 400 })),
  posX: s.optional(s.number({ min: 0, max: 1, description: 'Across the frame, 0..1' })),
  posY: s.optional(s.number({ min: 0, max: 1, description: 'Down the frame, 0..1' })),
  maxLineChars: s.optional(s.integer({ min: 5, max: 200 })),
  uppercase: s.optional(s.boolean()),
  wordsPerCue: s.optional(s.integer({ min: 0, max: 30 })),
  pauseThreshold: s.optional(s.number({ min: 0, max: 5 })),
  lineHeight: s.optional(s.number({ min: 0.5, max: 3 })),
  letterSpacing: s.optional(s.number({ min: -50, max: 200 })),
  align: s.optional(s.enum(['left', 'center', 'right'] as const)),
  rotate: s.optional(s.number({ min: -7, max: 7, description: 'Radians' })),
  fitWidth: s.optional(s.number({ min: 0, max: 1 }))
}, 'Subtitle style fields to change')

/** The line fields an agent may change. */
const lineFields = s.object({
  text: s.optional(s.string({ max: 2000 })),
  start: s.optional(s.time()),
  end: s.optional(s.time()),
  layer: s.optional(s.integer({ min: 0, max: 50 })),
  marks: s.optional(s.array(s.integer({ min: 0 }), { description: 'Key words, by word index' })),
  place: s.optional(s.enum(['left', 'center', 'right'] as const)),
  font: s.optional(s.string({ min: 1, max: 80 }))
}, 'Caption fields to change')

/** The first text layer (1+) with room for [start, end): manual text lives
 *  beside the subtitles, a new layer when all are busy. */
export function freeTextLayer(p: Project, start: number, end: number): number {
  let layer = 1
  while (p.captions.some((c) => (c.layer ?? 0) === layer && c.start < end && c.end > start)) layer++
  return layer
}

function addTitle(p: Project, time: number, text: string): string {
  const id = uid()
  const end = time + 2.5
  const layer = freeTextLayer(p, time, end)
  p.captions.push({
    id,
    start: time,
    end,
    text,
    manual: true,
    layer,
    // Its own independent style (starts as a copy of the auto style, no
    // pop-up animation by default).
    style: { ...clone(p.captionStyle), popup: { enabled: false, duration: 0.16, intensity: 1, style: 'pop' } }
  })
  p.captions.sort((a, b) => a.start - b.start)
  return id
}

export const addText = defineCommand({
  name: 'text.add',
  summary: 'Add a title (manual text) for 2.5 s from a time, on the first text layer free there. Returns its id.',
  params: s.object({ time: s.time(), text: s.optional(s.string({ max: 2000 })), id: s.optional(s.id('An id for the new title')) }),
  check(p, { id }) {
    requireFreshId(p, id, 'text.add')
  },
  apply(p, { time, text, id }): string {
    return withFirstId(id, () => addTitle(p, time, text ?? 'New text'))
  }
})

const SHAPE_KINDS = ['rect', 'marker', 'circle', 'line', 'arrow'] as const

function shapeOn(p: Project, id: string, kind: ShapeKind, highlightCaptionId: string | undefined, env: CommandEnv): void {
  const cap = p.captions.find((c) => c.id === id)
  if (!cap) return
  // Starting geometry per kind. Marker is the opaque yellow editorial band.
  const preset: Record<ShapeKind, { w: number; h: number; opacity: number; radius: number; reveal: boolean }> = {
    rect: { w: 0.3, h: 0.16, opacity: 0.9, radius: 12, reveal: false },
    marker: { w: 0.34, h: 0.075, opacity: 1, radius: 0, reveal: true },
    circle: { w: 0.24, h: 0.24, opacity: 0.35, radius: 0, reveal: false },
    line: { w: 0.34, h: 0.012, opacity: 1, radius: 4, reveal: true },
    arrow: { w: 0.24, h: 0.065, opacity: 1, radius: 0, reveal: true }
  }
  const d = preset[kind]
  cap.shape = { kind, w: d.w, h: d.h, reveal: d.reveal }
  cap.style = {
    ...(cap.style ?? clone(p.captionStyle)),
    // A new shape is an overlay, not a subtitle.
    posX: 0.5,
    posY: 0.5,
    bgColor: kind === 'marker' ? '#f1ef00' : kind === 'arrow' ? '#f2f7f7' : '#25d0c2',
    bgOpacity: d.opacity,
    bgRadius: d.radius,
    outlineWidth: 0
  }
  // No opacity fade for marker: a solid band expands with a ramp.
  if (kind === 'marker') cap.anim = { ...cap.anim, in: 'none', inDur: 0.48 }
  else if (d.reveal) cap.anim = { ...cap.anim, in: 'fade', inDur: 0.35 }
  if (kind === 'marker' && highlightCaptionId) {
    const text = p.captions.find((c) => c.id === highlightCaptionId && !c.shape)
    if (text) {
      const textStyle = text.style ?? p.captionStyle
      const W = p.settings.width
      const H = p.settings.height
      const fontSize = textStyle.fontSize * H / 1080
      const lines = text.text.split(/\r?\n/).flatMap((paragraph) => {
        const words = paragraph.trim().split(/\s+/)
        const groups: string[] = []
        let line = ''
        for (const word of words) {
          if (line && line.length + 1 + word.length > textStyle.maxLineChars) {
            groups.push(line)
            line = word
          } else line = line ? `${line} ${word}` : word
        }
        groups.push(line)
        return groups
      })
      const font = `${textStyle.fontWeight} ${fontSize}px "${textStyle.fontFamily}", sans-serif`
      const measure = env.measureText
      const measuredWidth = Math.max(1, ...lines.map((line) => measure ? measure(font, line) : line.length * fontSize * 0.55))
      const widest = textStyle.fitWidth ? Math.min(measuredWidth, textStyle.fitWidth * W) : measuredWidth
      cap.start = text.start
      cap.end = text.end
      cap.layer = text.layer
      cap.shape.w = Math.min(0.96, Math.max(0.04, (widest + fontSize * 0.5) / W))
      cap.shape.h = Math.min(0.7, Math.max(0.012, (fontSize * (0.92 + (lines.length - 1) * (textStyle.lineHeight ?? 1.25))) / H))
      cap.style = { ...cap.style!, posX: textStyle.posX, posY: textStyle.posY + fontSize * 0.08 / H }
      // Same lane, earlier in draw order: the ink sits behind the text.
      p.captions = p.captions.filter((c) => c.id !== id)
      p.captions.splice(p.captions.findIndex((c) => c.id === text.id), 0, cap)
    }
  }
}

export const addShape = defineCommand({
  name: 'shape.add',
  summary: 'Add a shape (rect, marker band, circle, line, arrow) for 2.5 s from a time; a marker given a title id sits behind that title. Returns its id.',
  params: s.object({ time: s.time(), kind: s.enum(SHAPE_KINDS), highlightCaptionId: s.optional(s.id()), id: s.optional(s.id('An id for the new shape')) }),
  check(p, { highlightCaptionId, id }) {
    if (highlightCaptionId) requireCaption(p, highlightCaptionId, 'shape.add')
    requireFreshId(p, id, 'shape.add')
  },
  apply(p, { time, kind, highlightCaptionId, id: given }, env): string {
    const id = withFirstId(given, () => addTitle(p, time, ''))
    shapeOn(p, id, kind, highlightCaptionId, env)
    return id
  }
})

/** The edit of one line, as the timeline and the text fields make it. */
function updateLine(p: Project, id: string, patch: Partial<Caption>): void {
  const c = p.captions.find((x) => x.id === id)
  if (!c) return
  const wasStart = c.start
  const wasEnd = c.end
  const wasText = c.text
  Object.assign(c, patch)
  if (patch.text !== undefined && c.style?.marker?.words?.length && wasText !== c.text) {
    const words = remapMarkedWords(wasText, c.text, c.style.marker.words)
    c.style.marker = { ...c.style.marker, words, enabled: words.length > 0 }
  }
  if (patch.text !== undefined && patch.marks === undefined && c.marks?.length && wasText !== c.text) {
    c.marks = remapMarkedWords(wasText, c.text, c.marks)
  }
  // Word timings are ABSOLUTE: a MOVE (both ends by the same amount) takes
  // them along; a trim moves one end and shows less of the speech.
  if (c.words && patch.start !== undefined && patch.end !== undefined) {
    const dStart = c.start - wasStart
    const dEnd = c.end - wasEnd
    if (Math.abs(dStart) > 1e-9 && Math.abs(dStart - dEnd) < 1e-6) {
      c.words = c.words.map((wd) => ({ ...wd, start: wd.start + dStart, end: wd.end + dStart }))
    }
  }
  // Its motion keys are counted from its start: a start that moved without
  // the line moving whole (a head trim) keeps them on their instants (phase
  // Ç2c.2, report K11: the whole move slid by the trim). Kept before the new
  // start too, as a clip keeps its keys.
  if (c.kfs?.length && patch.start !== undefined) {
    const dStart = c.start - wasStart
    const dEnd = c.end - wasEnd
    if (Math.abs(dStart) > 1e-9 && Math.abs(dStart - dEnd) > 1e-6) c.kfs = c.kfs.map((k) => ({ ...k, time: k.time - dStart }))
  }
  // Reconcile visible words with the recognised ones, keeping exact anchors
  // for unchanged words.
  if (patch.text !== undefined && c.words) {
    c.words = alignCaptionWordsToText(c.words, c.text, c.start, c.end)
  }
}

export const updateCaption = defineCommand({
  name: 'caption.update',
  summary: 'Change fields of a subtitle, title or shape (text, start, end, layer, style…).',
  params: s.object({ id: s.id(), patch: lineFields }),
  check(p, { id, patch }) {
    const c = requireCaption(p, id, 'caption.update')
    const a = patch.start ?? c.start
    const b = patch.end ?? c.end
    if (b <= a) throw new CommandError('caption.update', `end (${b}) must be after start (${a})`)
  },
  apply(p, { id, patch }): void {
    updateLine(p, id, patch as Partial<Caption>)
  }
})

export const editLine = defineCommand({
  name: 'caption.editLine',
  summary: 'Change a subtitle line\'s text and/or times (seconds); its words keep their times where they are unchanged.',
  params: s.object({ id: s.id(), text: s.optional(s.string({ max: 2000 })), start: s.optional(s.time()), end: s.optional(s.time()) }),
  check(p, { id }) {
    requireCaption(p, id, 'caption.editLine')
  },
  apply(p, { id, text, start, end }): void {
    const c = p.captions.find((x) => x.id === id)
    if (!c) throw new CommandError('caption.editLine', `there is no subtitle line ${id}`)
    const a = start ?? c.start
    const b = end ?? c.end
    if (b <= a) throw new CommandError('caption.editLine', `end (${b}) must be after start (${a})`)
    const patch: Partial<Caption> = {}
    if (text !== undefined) patch.text = text
    if (start !== undefined) patch.start = start
    if (end !== undefined) patch.end = end
    updateLine(p, id, patch)
  }
})

export const deleteCaptions = defineCommand({
  name: 'caption.delete',
  summary: 'Delete subtitle lines, titles or shapes by id (nothing moves).',
  params: s.object({ ids: s.array(s.id(), { min: 1 }) }),
  check(p, { ids }) {
    for (const id of ids) requireCaption(p, id, 'caption.delete')
  },
  apply(p, { ids }): void {
    p.captions = p.captions.filter((c) => !ids.includes(c.id))
  }
})

export const setCaptionStyle = defineCommand({
  name: 'caption.setStyle',
  summary: 'Change the subtitle style of the whole project (font, size, colours, position…).',
  params: s.object({ patch: styleFields }),
  apply(p, { patch }): void {
    Object.assign(p.captionStyle, patch as Partial<CaptionStyle>)
  }
})

export const setCaptionOwnStyle = defineCommand({
  name: 'caption.setOwnStyle',
  summary: 'Change the own style of one title or shape (it starts as a copy of the subtitle style).',
  params: s.object({ id: s.id(), patch: styleFields }),
  check(p, { id }) {
    requireCaption(p, id, 'caption.setOwnStyle')
  },
  apply(p, { id, patch }): void {
    const c = p.captions.find((x) => x.id === id)
    if (!c) return
    c.style = { ...(c.style ?? clone(p.captionStyle)), ...(patch as Partial<CaptionStyle>) }
  }
})

export const setCaptionShape = defineCommand({
  name: 'caption.setShape',
  summary: 'Change a shape\'s geometry (w, h as parts of the frame, kind, reveal).',
  params: s.object({
    id: s.id(),
    patch: s.object({
      kind: s.optional(s.enum(SHAPE_KINDS)),
      w: s.optional(s.number({ min: 0.005, max: 1, description: 'Width, part of the frame' })),
      h: s.optional(s.number({ min: 0.005, max: 1, description: 'Height, part of the frame' })),
      reveal: s.optional(s.boolean())
    })
  }),
  check(p, { id }) {
    requireCaption(p, id, 'caption.setShape', { shape: true })
  },
  apply(p, { id, patch }): void {
    const cap = p.captions.find((c) => c.id === id)
    if (!cap?.shape) return
    cap.shape = { ...cap.shape, ...(patch as Partial<CaptionShape>) }
  }
})
