// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// What an agent pays for the app's answers, estimated (SnippStudio phase 4A,
// ANA-PLAN.md §2 "A. Uygulamanın payı"). Text: characters / 3.6; a picture:
// width × height / 750 (the providers' published rule of thumb for image
// input). The agent's own thinking and writing are not in it: only what the
// tools send.

export const CHARS_PER_TOKEN = 3.6
export const PIXELS_PER_TOKEN = 750

export interface AnswerSize {
  chars: number
  images: { width: number; height: number }[]
}

export const textTokens = (chars: number): number => chars / CHARS_PER_TOKEN
export const imageTokens = (width: number, height: number): number => (width * height) / PIXELS_PER_TOKEN

export function tokensOf(size: AnswerSize): number {
  return Math.round(textTokens(size.chars) + size.images.reduce((n, im) => n + imageTokens(im.width, im.height), 0))
}

/** The size of a tool answer (MCP content: text and pictures). Pictures'
 *  sizes are read from their JPEG / PNG header. */
export function answerSize(content: readonly ({ type: 'text'; text: string } | { type: 'image'; data: string; mimeType: string })[]): AnswerSize {
  let chars = 0
  const images: { width: number; height: number }[] = []
  for (const c of content) {
    if (c.type === 'text') chars += c.text.length
    else {
      const d = imageDims(c.data)
      if (d) images.push(d)
    }
  }
  return { chars, images }
}

/** Width and height from a base64 JPEG (first SOF marker) or PNG (IHDR). */
export function imageDims(b64: string): { width: number; height: number } | null {
  const head = b64.slice(0, 64 * 1024)
  let bin: string
  try {
    bin = atob(head.slice(0, head.length - (head.length % 4)))
  } catch {
    return null
  }
  const at = (i: number): number => bin.charCodeAt(i) & 0xff
  if (at(0) === 0x89 && bin.slice(1, 4) === 'PNG') return { width: (at(16) << 24) | (at(17) << 16) | (at(18) << 8) | at(19), height: (at(20) << 24) | (at(21) << 16) | (at(22) << 8) | at(23) }
  if (at(0) !== 0xff || at(1) !== 0xd8) return null
  let i = 2
  while (i + 9 < bin.length) {
    if (at(i) !== 0xff) return null
    const marker = at(i + 1)
    const len = (at(i + 2) << 8) | at(i + 3)
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      return { height: (at(i + 5) << 8) | at(i + 6), width: (at(i + 7) << 8) | at(i + 8) }
    }
    i += 2 + len
  }
  return null
}
