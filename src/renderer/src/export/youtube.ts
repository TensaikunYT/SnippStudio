// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// The YouTube package (Snipp next run, round 9): one text file beside an
// exported video with what the upload page asks for — the chapters with
// their timestamps (from the timeline's chapter cards and home screens) and a
// description draft that holds them. A draft to read before publishing, never
// posted by itself.

import { homeOpens } from '../templates/model'
import { projectDuration, type Project } from '../types'
import { PRODUCT_NAME } from '../../../shared/product'

export interface Chapter {
  t: number
  title: string
}

/** The film's chapters, by time: the timeline's chapter cards (the chapter
 *  each one opens). */
export function filmChapters(project: Project): Chapter[] {
  const out: Chapter[] = []
  for (const b of project.templates ?? []) {
    if (b.kind !== 'chapter' && b.kind !== 'home') continue
    const k = homeOpens(project, b)
    const title = (b.items[k]?.title ?? '').trim()
    if (title) out.push({ t: b.start, title })
  }
  return out.sort((p, q) => p.t - q.t)
}

/** A timestamp as YouTube reads it: 0:00, 12:05, 1:02:03 (whole seconds,
 *  never later than the moment). */
export function stamp(t: number): string {
  const s = Math.max(0, Math.floor(t + 1e-6))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const ss = String(s % 60).padStart(2, '0')
  return h ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`
}

/** The chapters as YouTube wants them for a video of `len` seconds that
 *  starts at the film's `from`: the first at 0:00 ("Intro" when the film's
 *  first chapter comes later), and what YouTube will not accept, said. */
export function youtubeChapters(chapters: Chapter[], from: number, len: number): { list: Chapter[]; notes: string[] } {
  const notes: string[] = []
  let list = chapters.map((c) => ({ t: c.t - from, title: c.title })).filter((c) => c.t > -0.5 && c.t < len - 1)
  // A chapter that begins just before the stretch exported starts it.
  const before = chapters.filter((c) => c.t - from <= -0.5).pop()
  if (before && !list.some((c) => c.t < 0.5)) list.unshift({ t: 0, title: before.title })
  if (!list.length) return { list, notes }
  if (list[0].t >= 0.5) list.unshift({ t: 0, title: 'Intro' })
  else list[0] = { ...list[0], t: 0 }
  // Two marks on the same second: the later one wins.
  list = list.filter((c, i) => i + 1 >= list.length || Math.floor(list[i + 1].t) !== Math.floor(c.t))
  if (list.length < 3) notes.push(`YouTube shows chapters only when there are at least three; this video has ${list.length}.`)
  list.forEach((c, i) => {
    const end = i + 1 < list.length ? list[i + 1].t : len
    if (end - c.t < 10) notes.push(`"${c.title}" is ${Math.floor(Math.max(0, end - c.t) * 10) / 10} s long; YouTube wants every chapter to be 10 s or more.`)
  })
  return { list, notes }
}

/** The narration's opening, for the description's first lines: its first
 *  sentence or two (three short ones at most, up to about 220 letters). */
export function narrationHook(project: Project): string {
  const words = project.captions.filter((c) => (c.layer ?? 0) === 0).sort((a, b) => a.start - b.start).map((c) => c.text)
  const text = words.join(' ').replace(/\s+/g, ' ').trim()
  if (!text) return ''
  const sentences = text.match(/[^.!?…]+[.!?…]+["”’)]*|[^.!?…]+$/gu) ?? [text]
  let out = ''
  let n = 0
  for (const s of sentences) {
    const next = (out ? out + ' ' : '') + s.trim()
    if (out && next.length > 220) break
    out = next
    n++
    if (out.length > 120 || n >= 3 || (n >= 2 && out.length > 60)) break
  }
  return out
}

/**
 * The package's text: the title, a description draft with the chapters, and
 * notes on what YouTube will not take. `range`: the
 * stretch of the film exported (its timestamps start at its beginning).
 */
export function youtubePackage(project: Project, opts: { range?: [number, number]; name?: string } = {}): string {
  const name = (opts.name ?? project.name ?? 'Untitled').trim() || 'Untitled'
  const from = opts.range?.[0] ?? 0
  const len = opts.range ? opts.range[1] - opts.range[0] : projectDuration(project)
  const { list, notes } = youtubeChapters(filmChapters(project), from, len)
  const hook = narrationHook(project)
  const lines: string[] = []
  lines.push(`YouTube package: ${name}`)
  lines.push(`(Made by ${PRODUCT_NAME} beside the video: a draft to read and change before you publish.)`)
  lines.push('')
  lines.push('TITLE')
  lines.push(name)
  lines.push('')
  lines.push('DESCRIPTION (paste from the line under this one)')
  if (hook) {
    lines.push(hook)
    lines.push('')
  }
  if (list.length) {
    lines.push('Chapters')
    for (const c of list) lines.push(`${stamp(c.t)} ${c.title}`)
    lines.push('')
  }
  lines.push('NOTES')
  if (!list.length) lines.push('- No chapters: add chapter cards on the timeline to get them.')
  for (const n of notes) lines.push(`- ${n}`)
  if (list.length && !notes.length) lines.push('- The chapters follow YouTube\'s rules (the first at 0:00, at least three, each 10 s or longer).')
  return lines.join('\n') + '\n'
}
