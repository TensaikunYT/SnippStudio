// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// "Code values" (SnippStudio CILA-K-PLAN.md): the constants of a code clip's
// page the user can change by hand, found by the app itself in whatever the
// page's author wrote. No page is asked to be written in any way for this.
//
// Pure (no Node, no DOM): the main process scans and patches with it, the
// editor's panel shows and checks with it, the tests run it in Node.

export type ValueKind = 'color' | 'text' | 'font' | 'time'

/** How a value is written where it was found; decides how a new one is
 *  written there (values.ts `emit`). */
export type SlotForm =
  /** #rgb, #rgba, #rrggbb, #rrggbbaa (CSS, an attribute, a whole JS string). */
  | 'hex'
  /** rgb() / rgba() / hsl() / hsla(). */
  | 'func'
  /** A CSS colour name (white, tomato…). */
  | 'name'
  /** A JS number 0xRRGGBB. */
  | 'num'
  /** Text of an HTML text node. */
  | 'html'
  /** The inside of a JS string literal. */
  | 'js'
  /** A font family name inside quotes (the quotes stay). */
  | 'fontq'
  /** A font family name written bare. */
  | 'font'
  /** A CSS time (1.5s, 300ms). */
  | 'time'

/** One place a value stands in one file. */
export interface Slot {
  /** The file, relative to the film's folder, with "/". */
  file: string
  /** Where it starts and ends in the file's text (UTF-16 units). */
  at: number
  end: number
  /** The file's own text there. */
  raw: string
  kind: ValueKind
  form: SlotForm
  /** The value it holds, in the one way each kind is written here:
   *  a colour "#rrggbb" or "#rrggbbaa", a text as it is read (entities and
   *  escapes undone), a font's family name, a time "1.5s" / "300ms". */
  value: string
  /** A bare font name: the quote mark that may be put around a name that
   *  needs one there ('' when none may). */
  fq?: '"' | "'" | ''
  /** A time that may be negative (a delay). */
  delay?: boolean
  /** Where in the page it was found (for the panel's list). */
  where: 'css' | 'style' | 'attr' | 'html' | 'js'
  /** Its line in the file (1-based). */
  line: number
}

/** A change the user made, kept in the project (Asset.code.edits).
 *  With `file`: that one place. Without: every place holding `orig`. */
export interface CodeEdit {
  kind: ValueKind
  /** One place: the file's own text there (Slot.raw). Every place: the
   *  value they hold (Slot.value; a font's name in lower case). */
  orig: string
  /** The new value (as Slot.value is written). */
  value: string
  /** One place only: its file, where it started, and which of the places
   *  with this same text in that file it was (n of `of`, from 0): after the
   *  file is rewritten it is found again by these when its place moved. */
  file?: string
  pos?: number
  n?: number
  of?: number
}

/** The most a project keeps for one film, and the longest strings. */
export const EDITS_MAX = 600
export const VALUE_MAX = 2000
export const ORIG_MAX = 4000
/** A file longer than this is not scanned; a folder's files are scanned up
 *  to this much text in all (the versions' limit: main/codefilm-versions.ts). */
export const FILE_MAX = 1024 * 1024
export const FOLDER_MAX = 2 * 1024 * 1024
/** The files that are scanned, by extension. */
export const SCANNED = /\.(html?|css|m?js)$/i
