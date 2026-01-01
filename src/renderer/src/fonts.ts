// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
import anton from './assets/fonts/Anton-Regular.ttf'
import archivoBlack from './assets/fonts/ArchivoBlack-Regular.ttf'
import bangers from './assets/fonts/Bangers-Regular.ttf'
import bebasNeue from './assets/fonts/BebasNeue-Regular.ttf'
import inter from './assets/fonts/Inter-Variable.ttf'
import luckiestGuy from './assets/fonts/LuckiestGuy-Regular.ttf'
import merriweather from './assets/fonts/Merriweather-Variable.ttf'
import oswald from './assets/fonts/Oswald-Variable.ttf'
import permanentMarker from './assets/fonts/PermanentMarker-Regular.ttf'
import rockSalt from './assets/fonts/RockSalt-Regular.ttf'
// Snipp's own heavy display face, drawn in code (scripts/make-display-font.py).
import snippDisplay from './assets/fonts/SnippDisplay.ttf'
import { fontChoices, fontInstalledBy, uiPlatform, windowMeasure, type FontChoice } from './os-platform'

/**
 * Bundled open-source fonts (SIL OFL / Apache-2.0). They must be registered
 * via the FontFace API — canvas text does not trigger lazy @font-face
 * loading on its own.
 */
/**
 * The variable ones. A FontFace registered without a weight descriptor
 * defaults to 400, which pins a variable font to a single instance — so
 * asking canvas for 900 got exactly the same glyphs as 400 and the Weight
 * control appeared to do nothing at all. Declaring the axis range is what
 * makes the other weights exist.
 */
const VARIABLE = new Set(['Inter', 'Merriweather', 'Oswald'])

const BUNDLED: [string, string][] = [
  ['Snipp Display', snippDisplay],
  ['Anton', anton],
  ['Archivo Black', archivoBlack],
  ['Bangers', bangers],
  ['Bebas Neue', bebasNeue],
  ['Inter', inter],
  ['Merriweather', merriweather],
  ['Oswald', oswald],
  ['Luckiest Guy', luckiestGuy],
  ['Permanent Marker', permanentMarker],
  ['Rock Salt', rockSalt]
]

/**
 * The handwritten pair, grouped under a heading of their own.
 *
 * The names have to be SHORT, because a closed select draws the chosen option
 * in that option's own face — and "Handwritten (marker)" set in a marker font
 * measures 130px against the 128px the box has. Measured, not guessed. The
 * group heading carries the word "handwritten" instead, in the interface font,
 * where it costs nothing.
 */
export const HANDWRITTEN_FONTS = ['Permanent Marker', 'Rock Salt']

export const FONT_LABELS: Record<string, string> = {
  'Snipp Display': 'Snipp Display',
  'Permanent Marker': 'Marker',
  'Rock Salt': 'Pen'
}

/** Subtitle font choices: bundled open-source fonts first, then system fonts. */
export const FONT_FAMILIES: string[] = [
  ...BUNDLED.map(([name]) => name),
  'Segoe UI Black',
  'Arial Black',
  'Impact',
  'Franklin Gothic Medium',
  'Bahnschrift',
  'Candara',
  'Verdana',
  'Tahoma',
  'Trebuchet MS',
  'Georgia',
  'Comic Sans MS',
  'Arial'
]

/** The faces that are always there: bundled, or imported into this window. */
function alwaysHere(): Set<string> {
  return new Set([...BUNDLED.map(([name]) => name), ...imported])
}

/** What a font picker lists (phase 10a.6, F1). Windows: FONT_FAMILIES as it
 *  is. Elsewhere the system faces this computer lacks are left out, and the
 *  chosen one, if it lacks it, stays marked. */
export function fontPickerChoices(current?: string): FontChoice[] {
  const m = uiPlatform() === 'win32' ? null : windowMeasure()
  return fontChoices(FONT_FAMILIES, alwaysHere(), uiPlatform(), m ? (f) => fontInstalledBy(m, f) : null, current)
}

/** Is `family` a face this computer cannot draw (the export check, phase
 *  10a.6, F1)? Never on Windows (as before phase 10), never for a bundled or
 *  imported face, never when it cannot be measured. */
export function fontMissingHere(family: string): boolean {
  if (uiPlatform() === 'win32' || alwaysHere().has(family)) return false
  const m = windowMeasure()
  return !!m && !fontInstalledBy(m, family)
}

// ---------------------------------------------------------------------------
// User-imported fonts: stored in IndexedDB so they survive restarts, loaded
// via FontFace at startup and appended to FONT_FAMILIES.
// ---------------------------------------------------------------------------
const FONT_DB = 'autocut-fonts'
const FONT_STORE = 'fonts'

/** The faces imported into this window (its profile's IndexedDB). A render
 *  process of the parallel export has a profile of its own, without them. */
const imported = new Set<string>()

/** How many families were imported into this window. */
export function importedFontCount(): number {
  return imported.size
}

function openFontDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(FONT_DB, 1)
    req.onupgradeneeded = () => req.result.createObjectStore(FONT_STORE)
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

async function registerFace(family: string, data: ArrayBuffer): Promise<void> {
  // An imported file may be variable too, and there is no way to know from
  // here — claiming the full range costs nothing for a static face, which
  // simply ignores it.
  const face = new FontFace(family, data, { weight: '100 900' })
  await face.load()
  document.fonts.add(face)
  imported.add(family)
  if (!FONT_FAMILIES.includes(family)) FONT_FAMILIES.push(family)
}

/** Imports a user .ttf/.otf file: registers it now and persists it. */
export async function addCustomFont(file: File): Promise<string> {
  const family = file.name.replace(/\.(ttf|otf|woff2?|TTF|OTF)$/i, '').replace(/[-_]/g, ' ').trim() || 'Custom font'
  const data = await file.arrayBuffer()
  await registerFace(family, data) // throws on an invalid font file
  const db = await openFontDb()
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(FONT_STORE, 'readwrite').objectStore(FONT_STORE).put(data, family)
    tx.onsuccess = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
  window.dispatchEvent(new Event('fonts-changed'))
  return family
}

async function loadCustomFonts(): Promise<void> {
  try {
    const db = await openFontDb()
    /**
     * Wait on the TRANSACTION, not on one request from inside another's
     * handler.
     *
     * getAllKeys() is issued first, so its success event fires first — and the
     * old code only assigned keys.onsuccess from inside vals.onsuccess, by
     * which time the keys request had already finished and its handler could
     * never run. The promise never settled. Nothing awaited it, so for a long
     * time that cost nothing; the moment the exporter started waiting for the
     * fonts, every export hung at "Preparing…" forever.
     */
    const entries = await new Promise<[IDBValidKey[], ArrayBuffer[]]>((resolve, reject) => {
      const tx = db.transaction(FONT_STORE, 'readonly')
      const store = tx.objectStore(FONT_STORE)
      const keys = store.getAllKeys()
      const vals = store.getAll()
      tx.oncomplete = () => resolve([keys.result, vals.result as ArrayBuffer[]])
      tx.onerror = () => reject(tx.error)
      tx.onabort = () => reject(tx.error)
    })
    const [keys, vals] = entries
    for (let i = 0; i < keys.length; i++) {
      try {
        await registerFace(String(keys[i]), vals[i])
      } catch {
        /* skip broken font */
      }
    }
    if (keys.length > 0) window.dispatchEvent(new Event('fonts-changed'))
  } catch {
    /* no custom fonts */
  }
}

let loaded: Promise<void> | null = null

export function loadBundledFonts(): Promise<void> {
  if (!loaded) {
    loaded = Promise.all(
      BUNDLED.map(async ([family, url]) => {
        try {
          const face = new FontFace(family, `url(${url})`, VARIABLE.has(family) ? { weight: '100 900' } : {})
          await face.load()
          document.fonts.add(face)
        } catch (err) {
          console.error(`Could not load bundled font ${family}:`, err)
        }
      })
    )
      .then(() => loadCustomFonts())
      // The terminal template draws in the bundled JetBrains Mono outside
      // Windows (os-platform.ts terminalMonoStack): canvas text does not load
      // a CSS face by itself, so load it here (phase 10a.6, F3).
      .then(() => (uiPlatform() === 'win32' ? undefined : document.fonts.load('500 16px "JetBrains Mono"').catch(() => undefined)))
      .then(() => undefined)
  }
  return loaded
}
