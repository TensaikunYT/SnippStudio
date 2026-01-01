// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// The one permission the app ever grants (REF-AB, worker S, item 8;
// REF-AB-PLAN-S.md; SECURITY-REVIEW.md): the microphone, for a voice-over,
// to the editor's own page in its top frame, right after the user pressed
// Record (the page "arms" it; one use, 15 seconds). Sound only: never the
// camera or the screen; never a code clip's frame, the clip drawing window
// or any other page. Pure: the tests read every way of being refused.

/** How long an arm lasts (the press, then Chromium's request). */
export const ARM_MS = 15_000

export interface MicRequest {
  permission: string
  /** What Chromium asks for ('audio', 'video'); empty or missing: unknown. */
  mediaTypes?: readonly string[]
  isMainFrame: boolean
  /** The asking frame is the app's own page (network.ts isTrustedDocument). */
  ownPage: boolean
  /** The asking web contents is an editor window. */
  editor: boolean
  /** When the page armed (ms), or undefined. */
  armedAt?: number
  now: number
}

/** May this request (setPermissionRequestHandler) have the microphone? */
export function micRequestAllowed(r: MicRequest): boolean {
  if (r.permission !== 'media') return false
  const types = r.mediaTypes ?? []
  if (types.length === 0 || !types.every((t) => t === 'audio')) return false
  if (!r.editor || !r.isMainFrame || !r.ownPage) return false
  return r.armedAt !== undefined && r.now - r.armedAt >= 0 && r.now - r.armedAt <= ARM_MS
}

export interface MicCheck {
  permission: string
  /** 'audio', 'video' or 'unknown' (Electron's details.mediaType). */
  mediaType?: string
  isMainFrame: boolean
  ownPage: boolean
  editor: boolean
  /** The microphone was granted to this window before (since it opened). */
  granted: boolean
  /** The page armed a moment ago (a press of Record): Chromium may check
   *  before it asks. */
  armed?: boolean
}

/** A permission check (setPermissionCheckHandler): yes only for the
 *  microphone of a window that was given it (so its page may read the
 *  microphones' names for the list) or that armed a moment ago. */
export function micCheckAllowed(c: MicCheck): boolean {
  return c.permission === 'media' && c.mediaType === 'audio' && c.editor && c.isMainFrame && c.ownPage && (c.granted || !!c.armed)
}

/** Does it look like the WAV the page makes (RIFF/WAVE, PCM, 16-bit mono)? */
export function isVoiceoverWav(b: Uint8Array): boolean {
  if (b.byteLength < 46) return false
  const s = (at: number, n: number): string => String.fromCharCode(...b.subarray(at, at + n))
  if (s(0, 4) !== 'RIFF' || s(8, 8) !== 'WAVEfmt ' || s(36, 4) !== 'data') return false
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength)
  return dv.getUint16(20, true) === 1 && dv.getUint16(22, true) === 1 && dv.getUint16(34, true) === 16 && dv.getUint32(40, true) === b.byteLength - 44
}

/** The largest take written (a little over 30 minutes at 48 kHz). */
export const MAX_WAV_BYTES = 44 + 31 * 60 * 48000 * 2

/** "2026-11-21 14.05.09": a file name's date part (no colon on Windows). */
export function fileStamp(d: Date): string {
  const p = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}.${p(d.getMinutes())}.${p(d.getSeconds())}`
}
