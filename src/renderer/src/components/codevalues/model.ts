// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// Cila K, the code values panel's list (pure: tested in Node). What a scan
// found (the places) and what the user changed (the project's list) become
// rows: one row per value, with every place that holds it; a change of a
// row is a change of all its places, a change of one place only of it.
import { editId, emit, groupKey, resolveEdits, type CodeEdit, type Slot, type ValueKind } from '../../../../shared/codeval'

export interface Place {
  slot: Slot
  /** The change written at this place now (of the place, or of its whole row), or null. */
  edit: CodeEdit | null
  /** What the page gets here: the change's value, or the page's own. */
  value: string
  /** Its own change (or its row's) could not be written here as it is. */
  refused: boolean
}

export interface Row {
  /** `<kind>.<n>`: its place in the list of its kind as scanned (stable while the files do not change). */
  id: string
  kind: ValueKind
  /** The page's own value (what groups the places). */
  orig: string
  places: Place[]
  /** What the places hold now when they all hold the same; else null (mixed). */
  value: string | null
  changed: boolean
}

export interface Gone {
  edit: CodeEdit
  id: string
}

export interface Listing {
  rows: Row[]
  /** Changes that no longer have a place in the page (the files were rewritten). */
  gone: Gone[]
}

export const KINDS: readonly ValueKind[] = ['color', 'text', 'font', 'time']

/** The rows of a scan with the project's changes on them. Colours with the
 *  most places first; the rest in the order they stand in the files. */
export function listing(slots: readonly Slot[], edits: readonly CodeEdit[]): Listing {
  const { writes, states } = resolveEdits(slots, edits)
  const byKey = new Map<string, Row>()
  const rows: Row[] = []
  const counts: Record<string, number> = {}
  // (What the changes name: a place, or a value. A place named and not written was refused.)
  const named = new Set(edits.map((e) => (e.file === undefined ? `g|${e.kind}|${e.orig}` : `s|${e.kind}|${e.file}|${e.pos}|${e.orig}`)))
  slots.forEach((slot, i) => {
    const key = `${slot.kind}|${groupKey(slot.kind, slot.value)}`
    let row = byKey.get(key)
    if (!row) {
      const n = (counts[slot.kind] = (counts[slot.kind] ?? 0) + 1) - 1
      row = { id: `${slot.kind}.${n}`, kind: slot.kind, orig: slot.value, places: [], value: null, changed: false }
      byKey.set(key, row)
      rows.push(row)
    }
    const w = writes[i]
    const edit = w ? edits[w.edit] : null
    const refused = !w && (named.has(`s|${slot.kind}|${slot.file}|${slot.at}|${slot.raw}`) || named.has(`g|${key}`))
    row.places.push({ slot, edit, value: edit ? edit.value : slot.value, refused })
  })
  for (const row of rows) {
    const first = row.places[0].value
    const same = row.places.every((p) => groupKey(row.kind, p.value) === groupKey(row.kind, first))
    row.value = same ? first : null
    row.changed = row.places.some((p) => p.edit !== null || p.refused)
  }
  const order = (k: ValueKind): number => KINDS.indexOf(k)
  const at = new Map(rows.map((r, i) => [r, i]))
  rows.sort((a, b) => order(a.kind) - order(b.kind) || (a.kind === 'color' ? b.places.length - a.places.length : 0) || at.get(a)! - at.get(b)!)
  const gone: Gone[] = []
  states.forEach((s, i) => {
    if (s.hits === 0 && s.refused === 0) gone.push({ edit: edits[i], id: editId(edits[i]) })
  })
  return { rows, gone }
}

export interface Change {
  put: CodeEdit[]
  drop: string[]
}

/** The names of the changes of a row's own places. */
const placeIds = (row: Row): string[] => row.places.flatMap((p) => (p.edit && p.edit.file !== undefined ? [editId(p.edit)] : []))
const rowId = (row: Row): string => editId({ kind: row.kind, orig: groupKey(row.kind, row.orig), value: '' })

/** Every place of the row takes `value` (the page's own value again: the row's changes go). */
export function setRow(row: Row, value: string): Change {
  const drop = placeIds(row)
  if (groupKey(row.kind, value) === groupKey(row.kind, row.orig) && value === row.orig) return { put: [], drop: [...drop, rowId(row)] }
  return { put: [{ kind: row.kind, orig: groupKey(row.kind, row.orig), value }], drop }
}

/** The row's places are the page's own again. */
export function resetRow(row: Row): Change {
  return { put: [], drop: [...placeIds(row), rowId(row)] }
}

/** One place takes `value` (the others of its row stay as they are). */
export function setPlace(slots: readonly Slot[], row: Row, place: Place, value: string): Change {
  const s = place.slot
  const drop = place.edit && place.edit.file !== undefined ? [editId(place.edit)] : []
  const rowChanged = row.places.some((p) => p.edit !== null && p.edit.file === undefined)
  // (The page's own value, with no change of the row over it: no change at all.)
  if (value === s.value && !rowChanged) return { put: [], drop }
  const same = slots.filter((x) => x.file === s.file && x.kind === s.kind && x.raw === s.raw)
  const next: CodeEdit = { kind: s.kind, orig: s.raw, value, file: s.file, pos: s.at, n: Math.max(0, same.indexOf(s)), of: same.length }
  return { put: [next], drop: drop.filter((id) => id !== editId(next)) }
}

/** One place follows its row again (or is the page's own). */
export function resetPlace(place: Place): Change {
  return { put: [], drop: place.edit && place.edit.file !== undefined ? [editId(place.edit)] : [] }
}

/** Can `value` be written at every place of the row? (The panel marks a field whose value cannot.) */
export function fitsRow(row: Row, value: string): boolean {
  return row.places.every((p) => emit(p.slot, value) !== null)
}

/** Does the row hold `needle` (its values, its files)? */
export function matches(row: Row, needle: string): boolean {
  const q = needle.trim().toLowerCase()
  if (!q) return true
  return row.orig.toLowerCase().includes(q) || row.places.some((p) => p.value.toLowerCase().includes(q) || p.slot.file.toLowerCase().includes(q) || p.slot.raw.toLowerCase().includes(q))
}

/** A colour as the system's colour input takes it ("#rrggbb"), and its transparency part ('' or "aa"). */
export function splitColor(v: string): { rgb: string; alpha: string } {
  const m = /^#([0-9a-f]{6})([0-9a-f]{2})?$/i.exec(v)
  return m ? { rgb: '#' + m[1].toLowerCase(), alpha: (m[2] ?? '').toLowerCase() } : { rgb: '#000000', alpha: '' }
}

/** A time's number and unit ("1.5s" → 1.5, "s"). */
export function splitTime(v: string): { n: number; unit: 's' | 'ms' } {
  const m = /^(-?[\d.]+)(ms|s)$/.exec(v)
  return m ? { n: parseFloat(m[1]), unit: m[2] as 's' | 'ms' } : { n: 0, unit: 's' }
}
