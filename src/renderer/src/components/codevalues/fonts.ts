// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// Cila K: the fonts offered for a code page's font value. A code film's page
// is its own document: it has the fonts installed on this computer (and its
// own @font-face files), not the editor's bundled ones. So the list is
// well-known family names that are really installed here (found by measuring
// a line of text with and without each: a name that changes nothing is not
// installed), once, when a font row is first shown.
const KNOWN = [
  'Arial', 'Arial Black', 'Arial Narrow', 'Bahnschrift', 'Calibri', 'Cambria', 'Candara', 'Cascadia Code', 'Cascadia Mono', 'Comic Sans MS', 'Consolas',
  'Constantia', 'Corbel', 'Courier New', 'Ebrima', 'Franklin Gothic Medium', 'Gabriola', 'Gadugi', 'Georgia', 'Impact', 'Ink Free', 'Lucida Console',
  'Lucida Sans Unicode', 'Malgun Gothic', 'Microsoft Sans Serif', 'Palatino Linotype', 'Segoe Print', 'Segoe Script', 'Segoe UI', 'Segoe UI Black',
  'Segoe UI Light', 'Segoe UI Semibold', 'Segoe UI Variable', 'Sitka Text', 'Sylfaen', 'Tahoma', 'Times New Roman', 'Trebuchet MS', 'Verdana',
  // macOS
  'American Typewriter', 'Avenir', 'Avenir Next', 'Baskerville', 'Chalkboard SE', 'Charter', 'Cochin', 'Copperplate', 'Didot', 'Futura', 'Geneva',
  'Gill Sans', 'Helvetica', 'Helvetica Neue', 'Hoefler Text', 'Menlo', 'Monaco', 'Optima', 'Palatino', 'SF Pro Display', 'SF Pro Text', 'Skia',
  // Linux and fonts people install
  'Cantarell', 'DejaVu Sans', 'DejaVu Sans Mono', 'DejaVu Serif', 'Liberation Mono', 'Liberation Sans', 'Liberation Serif', 'Noto Sans', 'Noto Serif', 'Ubuntu',
  'Fira Code', 'Fira Sans', 'IBM Plex Mono', 'IBM Plex Sans', 'Inter', 'Inter Tight', 'JetBrains Mono', 'Lato', 'Montserrat', 'Nunito', 'Open Sans', 'Oswald',
  'Poppins', 'Roboto', 'Roboto Mono', 'Source Sans 3', 'Source Serif 4'
]

let installed: string[] | null = null

/** The known families installed on this computer (measured once). */
export function installedFonts(): string[] {
  if (installed) return installed
  installed = []
  try {
    const g = document.createElement('canvas').getContext('2d')
    if (!g) return installed
    const sample = 'mmmmmmmmmmlliWÖğ 0123456789'
    const width = (font: string): number => {
      g.font = `72px ${font}`
      return g.measureText(sample).width
    }
    const bases = ['monospace', 'serif', 'sans-serif'] as const
    const own = bases.map((b) => width(b))
    // (A name that is itself one of the fallback's faces measures the same
    // against that fallback and differs against the others: any difference counts.)
    installed = KNOWN.filter((name) => bases.some((b, i) => width(`"${name}", ${b}`) !== own[i]))
  } catch {
    installed = []
  }
  return installed
}
