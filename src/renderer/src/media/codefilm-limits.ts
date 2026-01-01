// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// What a code film's page may tell the editor, and how many pages live
// (phase 5a, FAZ5-PLAN.md; tarifler\FAZ5.md 5a decisions 6 and 7).
//
// The film's page runs code the editor does not trust: anything its host page
// says (size, length, fps, frames, its record) is clamped here before the
// editor uses it. Pure: tested in Node (src/test/codefilm-guard.test.ts).

export const FILM_LIMITS = {
  /** A side of a film, CSS pixels. */
  minSide: 64,
  maxSide: 7680,
  /** The long side at most this many times the short one. */
  maxRatio: 8,
  /** Seconds. */
  maxDuration: 6 * 3600,
  minFps: 1,
  maxFps: 120
} as const

/** At most this many film pages live in a window at once. */
export const LIVE_PAGES = 4
/** A page no clip near the playhead used for this long is let go. */
export const IDLE_RELEASE_MS = 30_000
/** A page that answers nothing for this long (in the preview) is marked
 *  "not responding" and let go. */
export const UNRESPONSIVE_MS = 10_000
/** The silence after which a running page counts as not responding: 10 s,
 *  or longer for a page that has shown it legitimately holds its thread that
 *  long (twice its longest silence while starting: a big film builds its
 *  scenes in one go; three times its slowest frame), never past `cap` (the
 *  start's own limit). FAZ5-PLAN.md 5a, "karardan sapma 2". */
export function unresponsiveLimit(bootSilenceMs: number, slowestFrameMs: number, cap = 120_000): number {
  const b = Number.isFinite(bootSilenceMs) ? Math.max(0, bootSilenceMs) : 0
  const f = Number.isFinite(slowestFrameMs) ? Math.max(0, slowestFrameMs) : 0
  // (At most UNRESPONSIVE_CAP_MS whatever `cap` says: the editor passed its
  // start limit, 125 s, so the 120 s it says became 125: audit C-9.)
  return Math.min(cap, UNRESPONSIVE_CAP_MS, Math.max(UNRESPONSIVE_MS, 2 * b, 3 * f))
}
/** The longest a running page may be silent before it is not responding. */
export const UNRESPONSIVE_CAP_MS = 120_000

/** How often the editor asks a page whether it is still there. */
export const PING_MS = 2_000

const finite = (v: unknown): number | null => {
  const n = typeof v === 'number' ? v : NaN
  return Number.isFinite(n) ? n : null
}

/** A film's size: each side 64…7680, the long side at most 8 × the short
 *  one (the short side grows). Not a number: `fallback`. */
export function clampFilmSize(w: unknown, h: unknown, fallback: { width: number; height: number }): { width: number; height: number } {
  const L = FILM_LIMITS
  const side = (v: unknown, d: number): number => {
    const n = finite(v)
    const x = n !== null && n > 0 ? n : d
    return Math.round(Math.min(L.maxSide, Math.max(L.minSide, x)))
  }
  let width = side(w, fallback.width)
  let height = side(h, fallback.height)
  if (width > height * L.maxRatio) height = Math.max(L.minSide, Math.ceil(width / L.maxRatio))
  else if (height > width * L.maxRatio) width = Math.max(L.minSide, Math.ceil(height / L.maxRatio))
  return { width, height }
}

/** fps 1…120, or null when the page said nothing usable. */
export function clampFilmFps(v: unknown): number | null {
  const n = finite(v)
  return n !== null && n > 0 ? Math.min(FILM_LIMITS.maxFps, Math.max(FILM_LIMITS.minFps, n)) : null
}

/** Seconds, at most 6 hours, or null when the page said nothing usable. */
export function clampFilmDuration(v: unknown): number | null {
  const n = finite(v)
  return n !== null && n > 0 ? Math.min(FILM_LIMITS.maxDuration, n) : null
}

/** A time in ms the page reports (boot, draw): 0…10 minutes. */
export function clampMs(v: unknown): number {
  const n = finite(v)
  return n !== null && n > 0 ? Math.min(600_000, n) : 0
}

/** What the app's guard wrote down in a film page (main/codefilm-guard.ts),
 *  as the editor keeps it. */
export interface FilmRecord {
  errors: string[]
  blocked: string[]
  failed: string[]
  dialogs: string[]
  media: number
  audio: number
  opened: number
  /** The time and chance sources it used (phase 5c; at most 20 names). */
  uses: string[]
  /** Every error the page wrote down, uncapped (phase 5e). */
  errorCount?: number
  /** The parameters the page said (phase 5f; codefilm-params.ts clamps them). */
  params?: unknown[] | null
  /** The page read the project look (phase 5f). */
  look?: boolean
}

/** A record from the page, bounded: lists of at most 50 strings of at most
 *  500 characters, counts 0…1e6. Anything else: null. */
export function clampRecord(r: unknown): FilmRecord | null {
  if (!r || typeof r !== 'object') return null
  const o = r as Record<string, unknown>
  const list = (v: unknown): string[] => (Array.isArray(v) ? v.slice(0, 50).map((x) => String(x).slice(0, 500)) : [])
  const count = (v: unknown): number => {
    const n = finite(v)
    return n !== null && n > 0 ? Math.min(1e6, Math.floor(n)) : 0
  }
  return { errors: list(o.errors), blocked: list(o.blocked), failed: list(o.failed), dialogs: list(o.dialogs), media: count(o.media), audio: count(o.audio), opened: count(o.opened), uses: Array.isArray(o.uses) ? o.uses.slice(0, 20).map((x) => String(x).slice(0, 20)) : [], errorCount: count(o.errorCount), params: Array.isArray(o.params) ? o.params.slice(0, 40) : null, look: o.look === true }
}

/** A frame the page sent is the one asked for: an ImageBitmap of the asked
 *  size, or w × h × 4 bytes of pixels of the asked size. */
export function frameFits(m: { bmp?: unknown; pixels?: unknown; w?: unknown; h?: unknown }, asked: { w: number; h: number }, isBitmap: (x: unknown) => x is { width: number; height: number }): boolean {
  if (m.bmp !== undefined && m.bmp !== null) return isBitmap(m.bmp) && m.bmp.width === asked.w && m.bmp.height === asked.h
  return m.pixels instanceof ArrayBuffer && m.w === asked.w && m.h === asked.h && m.pixels.byteLength === asked.w * asked.h * 4
}

/** The frame number a marker pixel carries (phase 5d.1: a whole page drawn
 *  by a window of its own writes the number of the frame it stands at into
 *  a row under its picture, as a colour): its colour's 24 bits. `bgr`: the
 *  bytes are B, G, R, A. */
export function markerOf(px: ArrayLike<number>, bgr: boolean, at = 0): number {
  const a = px[at] & 255
  const b = px[at + 1] & 255
  const c = px[at + 2] & 255
  return bgr ? (c << 16) | (b << 8) | a : (a << 16) | (b << 8) | c
}

/** The part of a drawing window's picture that is the film (the rows above
 *  its marker row), or null when the picture is too small to hold both. */
export function pagePicture(codedWidth: number, codedHeight: number, rows: unknown): { width: number; height: number; row: number } | null {
  const r = Math.max(1, Math.min(8, Math.round(+(rows as number)) || 1))
  if (!(codedWidth > 0) || !(codedHeight > r)) return null
  return { width: codedWidth, height: codedHeight - r, row: codedHeight - 1 }
}

/** A live page, as the release rules see it. */
export interface LivePage {
  id: string
  /** When a clip near the playhead, the export or a strip last used it. */
  lastUsed: number
  /** Asks of it not answered yet. */
  busy: boolean
}

/** The pages to let go at `now`: those unused for IDLE_RELEASE_MS, then, if
 *  more than `limit` stay, the least recently used ones that are not busy
 *  (oldest first), until `limit` stay or none is left to let go. `keep` (a
 *  page just asked for) is never let go. */
export function pagesToRelease(pages: readonly LivePage[], now: number, limit: number = LIVE_PAGES, keep?: string): string[] {
  const out: string[] = []
  const left: LivePage[] = []
  for (const p of pages) {
    if (p.id !== keep && !p.busy && now - p.lastUsed > IDLE_RELEASE_MS) out.push(p.id)
    else left.push(p)
  }
  if (left.length > limit) {
    const lru = left.filter((p) => p.id !== keep && !p.busy).sort((a, b) => a.lastUsed - b.lastUsed)
    let n = left.length - limit
    for (const p of lru) {
      if (n-- <= 0) break
      out.push(p.id)
    }
  }
  return out
}

/** The query a film's page is opened with. */
export const FILM_QUERY = 'snipp=1'

/** A clip that cannot bring this many pictures a second while the preview
 *  plays (or its own frame rate, when lower) is "slow" (phase 5d.2). */
export const SLOW_FPS = 24
/** The scale an export of `outH` lines draws a film `filmH` high at (phase
 *  5d.2, decision 6; Ç3's report R4): k = outH / filmH, 1 … 2 (a page is
 *  never drawn smaller than its own size; past 2 it is enlarged, and the
 *  export window says so). */
export function exportScaleOf(outH: number, filmH: number): number {
  const fh = filmH > 0 ? filmH : 1080
  const k = outH / fh
  if (!Number.isFinite(k) || k <= 1.001) return 1
  return Math.round(Math.min(2, k) * 1000) / 1000
}

/** The query a film's page is opened with at a drawing scale. */
export function filmQuery(scale: number): string {
  return scale > 1 ? `${FILM_QUERY}&dpr=${scale}` : FILM_QUERY
}

/** A stretch of playing that brought `fps` pictures a second is "slow" for
 *  a film of `filmFps` (null: not said): under SLOW_FPS, or under its own
 *  rate when that is lower (half a picture of slack). */
export function isSlow(fps: number, filmFps: number | null): boolean {
  const need = Math.min(SLOW_FPS, filmFps && filmFps > 0 ? filmFps : SLOW_FPS)
  return fps < need - 0.5
}

/** The guard's names (codefilm-guard.ts `uses`) of the sources whose values
 *  differ from one load to the next (5c + 5d audit, K1). */
export const CHANCE_USES: readonly string[] = ['random', 'crypto', 'date', 'perf']

/** A fast-path page that read one of CHANCE_USES while it loaded: loaded
 *  again (for an export's scale) it may draw another picture than the one
 *  the preview has. */
export function chanceAtLoad(uses: unknown): boolean {
  return Array.isArray(uses) && uses.some((u) => CHANCE_USES.includes(String(u)))
}

/** May an export load a film's page again at its scale (K1)? A page on the
 *  app's clock (canvas, page) draws the same on every load: yes. A fast-path
 *  page that read no chance while it loaded: yes. One that did: only once a
 *  page loaded at the scale was found to draw what the preview's page draws
 *  (`verdict`); until then (and when its mode is not known yet) no. */
export function mayLoadAtScale(mode: string | undefined, chance: boolean | null, verdict: boolean | undefined): boolean {
  if (verdict !== undefined) return verdict
  if (mode === 'canvas' || mode === 'page') return true
  return mode === 'fast' && chance === false
}

/** Two pictures of the same size show the same moment (phase 5c's margin):
 *  at most 0.5 % of the pixels differ by more than 28 / 255 in a channel. */
export function samePicture(a: ArrayLike<number>, b: ArrayLike<number>): boolean {
  if (a.length !== b.length || a.length === 0) return false
  let bad = 0
  for (let i = 0; i < a.length; i += 4) {
    if (Math.abs(a[i] - b[i]) > 28 || Math.abs(a[i + 1] - b[i + 1]) > 28 || Math.abs(a[i + 2] - b[i + 2]) > 28 || Math.abs(a[i + 3] - b[i + 3]) > 28) bad++
  }
  return bad <= (a.length / 4) * 0.005
}

// ---- the checker (phase 5e, decision 1) --------------------------------------

/** What the checker found: `ok`; `blank` (every moment drawn is one colour or
 *  wholly clear); `unstable` (a moment drawn twice, or on a fresh load, came
 *  out beyond phase 5c's margin); `error` (lines the page wrote down: console
 *  errors, uncaught errors, refused addresses, files it could not load; or it
 *  did not start, or a frame failed). The worst one is the verdict. */
export type CheckVerdict = 'ok' | 'blank' | 'unstable' | 'error'

export interface CheckResult {
  verdict: CheckVerdict
  /** What it is about, one fact a line (at most 8, each ≤ 300 characters). */
  lines: string[]
  /** The film's length (s), size and how it is played, once it started. */
  length: number | null
  width: number
  height: number
  mode?: 'fast' | 'canvas' | 'page'
  /** The three moments drawn (film seconds). */
  moments: number[]
  /** How long the check took, ms; when it was made (Date.now()). */
  ms: number
  at: number
}

/** A page must be ready this soon for the checker (decision 1: 20 s). */
export const CHECK_READY_MS = 20_000

/** The moments of a check: 10 %, 50 % and 90 % of [a, b] (a film's second),
 *  and one in between (30 %) drawn before they are drawn again. */
export function checkMoments(a: number, b: number): { moments: number[]; between: number } {
  const lo = Math.max(0, Math.min(a, b))
  const len = Math.max(0, Math.abs(b - a))
  const at = (f: number): number => Math.round((lo + f * len) * 1000) / 1000
  return { moments: [at(0.1), at(0.5), at(0.9)], between: at(0.3) }
}

/** One colour all over (each channel within 2 / 255 of the first pixel), or
 *  wholly clear (every alpha 0). */
export function blankPicture(px: ArrayLike<number>): boolean {
  if (px.length < 4) return true
  let clear = true
  for (let i = 3; i < px.length; i += 4) if (px[i] !== 0) {
    clear = false
    break
  }
  if (clear) return true
  const r = px[0], g = px[1], b = px[2], a = px[3]
  for (let i = 4; i < px.length; i += 4) {
    if (Math.abs(px[i] - r) > 2 || Math.abs(px[i + 1] - g) > 2 || Math.abs(px[i + 2] - b) > 2 || Math.abs(px[i + 3] - a) > 2) return false
  }
  return true
}

/** The share (0…1) of pixels beyond 28 / 255 in a channel (for the lines). */
export function differingShare(a: ArrayLike<number>, b: ArrayLike<number>): number {
  if (a.length !== b.length || a.length === 0) return 1
  let bad = 0
  for (let i = 0; i < a.length; i += 4) {
    if (Math.abs(a[i] - b[i]) > 28 || Math.abs(a[i + 1] - b[i + 1]) > 28 || Math.abs(a[i + 2] - b[i + 2]) > 28 || Math.abs(a[i + 3] - b[i + 3]) > 28) bad++
  }
  return bad / (a.length / 4)
}

/** The verdict: error before blank before unstable before ok. */
export function verdictOf(o: { errors: number; blank: boolean; unstable: boolean }): CheckVerdict {
  return o.errors > 0 ? 'error' : o.blank ? 'blank' : o.unstable ? 'unstable' : 'ok'
}

/** The lines of a page's record that make it an error: its errors, the
 *  addresses refused, the files it could not load (first line of each). */
export function recordLines(r: { errors: string[]; blocked: string[]; failed: string[] } | null): string[] {
  if (!r) return []
  const one = (s: string): string => s.split('\n')[0].slice(0, 300)
  return [...r.errors.map(one), ...r.blocked.map((x) => `blocked: ${one(x)}`), ...r.failed.map((x) => `could not load: ${one(x)}`)]
}

/** A page's record split for the verdict (audit D8a). `errors` make it
 *  "error": uncaught errors and rejections, a frame that threw, a file or
 *  picture that could not load (the drawing lacks it). `facts` are kept as
 *  lines and decide nothing alone: what the page logged with console.error,
 *  addresses refused (the network is closed), a script that could not load
 *  (a page may carry its own copy; one it needed throws, and that is an
 *  error). The guard marks the two kinds (codefilm-guard.ts). */
export function checkLines(r: { errors: string[]; blocked: string[]; failed: string[] } | null): { errors: string[]; facts: string[] } {
  if (!r) return { errors: [], facts: [] }
  const one = (s: string): string => s.split('\n')[0].slice(0, 300)
  const CONSOLE = 'console.error: '
  const SCRIPT = 'script '
  const blocked = new Set(r.blocked)
  return {
    errors: [...r.errors.filter((x) => !x.startsWith(CONSOLE)).map(one), ...r.failed.filter((x) => !x.startsWith(SCRIPT)).map((x) => `could not load: ${one(x)}`)],
    facts: [
      ...r.errors.filter((x) => x.startsWith(CONSOLE)).map(one),
      ...r.blocked.map((x) => `blocked: ${one(x)}`),
      ...r.failed.filter((x) => x.startsWith(SCRIPT) && !blocked.has(x.slice(SCRIPT.length))).map((x) => `could not load: ${one(x)}`)
    ]
  }
}

/** A check as the code_clip tool answers it: the verdict, the length and
 *  size, then its lines. */
export function checkText(r: CheckResult, clipId: string): string {
  const s = (n: number): string => String(Math.round(n * 100) / 100)
  const head = `${clipId}: ${r.verdict}. Length ${r.length !== null ? s(r.length) + ' s' : 'unknown'}, ${r.width}x${r.height}; drawn at ${r.moments.map(s).join(', ')} s twice and on a fresh load (${Math.round(r.ms)} ms).`
  return [head, ...r.lines.slice(0, 8).map((l) => `- ${l}`)].join('\n')
}

/** The checker's line for a blank film. */
export const BLANK_LINE = 'every moment drawn is blank: one flat fill, or clear'
