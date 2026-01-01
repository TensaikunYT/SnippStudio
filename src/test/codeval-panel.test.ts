// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// Cila K: the code values panel's list (components/codevalues/model.ts), the
// project's side of it (the command, the store, the repair on open) and the
// page address that carries a list's name.
import './dom-stub'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import test from 'node:test'
import { editId, editsKey, scanFile, type CodeEdit, type Slot } from '../shared/codeval'
import { setCodeEdits } from '../renderer/src/commands/codefilm'
import { defaultEnv } from '../renderer/src/commands/core'
import { COMMANDS } from '../renderer/src/commands'
import { fitsRow, listing, matches, resetPlace, resetRow, setPlace, setRow, splitColor, splitTime, type Change } from '../renderer/src/components/codevalues/model'
import { codeValues } from '../renderer/src/components/codevalues/state'
import { editsQuery } from '../renderer/src/media/codefilm-values'
import { repairProject } from '../renderer/src/model/repair'
import { useStore } from '../renderer/src/state/store'
import { defaultProject, type Asset, type Project } from '../renderer/src/types'

const FIX = join(process.cwd(), 'src', 'test', 'fixtures', 'codeval')
const r1 = scanFile('index.html', readFileSync(join(FIX, 'r1.html'), 'utf8'))
const film = (edits?: CodeEdit[]): Asset => ({ id: 'f', kind: 'code', name: 'r1', path: 'C:/p/anim/r1', url: 'snippfilm://0123456789abcdef/', size: 0, duration: 6, width: 1920, height: 1080, hasAudio: false, code: { fps: 60, ...(edits ? { edits } : {}) } })
/** Applies changes to a list, as the command does. */
const run = (edits: CodeEdit[], c: Change): CodeEdit[] => {
  const p = defaultProject()
  p.assets.push(film(edits))
  setCodeEdits.apply(p, { assetId: 'f', put: c.put as never, drop: c.drop }, defaultEnv())
  return p.assets[0].code!.edits ?? []
}

test('the list: one row per value with every place that holds it; colours with the most places first', () => {
  const { rows, gone } = listing(r1, [])
  assert.deepEqual(gone, [])
  assert.deepEqual(rows.map((r) => r.kind).filter((k, i, a) => a.indexOf(k) === i), ['color', 'text', 'font'])
  const colours = rows.filter((r) => r.kind === 'color')
  assert.deepEqual(colours.slice(0, 2).map((r) => [r.orig, r.places.length]), [['#ffb703', 3], ['#ffffff', 2]])
  assert.ok(rows.every((r) => !r.changed && r.value === r.orig))
  assert.deepEqual(rows.filter((r) => r.kind === 'text').map((r) => r.orig), ['NİSAN', '1986', 'SOVYET UKRAYNASI', 'Yepyeni bir şehir'])
  // Row names are their kind and their order as scanned (stable while the files are).
  assert.deepEqual(rows.filter((r) => r.kind === 'font').map((r) => r.id), ['font.0', 'font.1', 'font.2'])
  assert.ok(matches(colours[0], 'FFB7') && matches(colours[0], 'index.html') && !matches(colours[0], 'nope') && matches(colours[0], '  '))
})

test('a row changed: all its places; one place changed: only it; reset: the page\'s own again', () => {
  let edits: CodeEdit[] = []
  let l = listing(r1, edits)
  const amber = (): (typeof l.rows)[number] => l.rows.find((r) => r.orig === '#ffb703')!
  edits = run(edits, setRow(amber(), '#00c2ff'))
  assert.deepEqual(edits, [{ kind: 'color', orig: '#ffb703', value: '#00c2ff' }])
  l = listing(r1, edits)
  assert.ok(amber().changed && amber().value === '#00c2ff' && amber().places.every((p) => p.value === '#00c2ff'))
  // One place on its own.
  edits = run(edits, setPlace(r1, amber(), amber().places[1], '#ff0000'))
  assert.equal(edits.length, 2)
  l = listing(r1, edits)
  assert.equal(amber().value, null, 'the places differ now')
  assert.deepEqual(amber().places.map((p) => p.value), ['#00c2ff', '#ff0000', '#00c2ff'])
  // That place back to its row's value.
  edits = run(edits, resetPlace(amber().places[1]))
  assert.equal(edits.length, 1)
  l = listing(r1, edits)
  // The row again: the place's own change goes with it.
  edits = run(edits, setPlace(r1, amber(), amber().places[0], '#123456'))
  l = listing(r1, edits)
  edits = run(edits, setRow(amber(), '#abcdef'))
  assert.deepEqual(edits.map((e) => e.value), ['#abcdef'])
  l = listing(r1, edits)
  // The page's own value typed back: no change left.
  assert.deepEqual(run(edits, setRow(amber(), '#ffb703')), [])
  assert.deepEqual(run(edits, resetRow(amber())), [])
  // One place set to the page's own while its row is changed: kept, as its own.
  edits = run(edits, setPlace(r1, amber(), amber().places[2], '#ffb703'))
  l = listing(r1, edits)
  assert.deepEqual(amber().places.map((p) => p.value), ['#abcdef', '#abcdef', '#ffb703'])
  // …and with no change of the row, that is no change at all.
  const plain = listing(r1, [])
  const white = plain.rows.find((r) => r.orig === '#ffffff')!
  assert.deepEqual(setPlace(r1, white, white.places[0], '#ffffff'), { put: [], drop: [] })
})

test('a change with no place any more is listed as gone; one that cannot be written is told at its place', () => {
  const edits: CodeEdit[] = [
    { kind: 'color', orig: '#123123', value: '#000000' },
    { kind: 'text', orig: 'ESKİ', value: 'YENİ', file: 'index.html', pos: 400, n: 0, of: 1 }
  ]
  const l = listing(r1, edits)
  assert.deepEqual(l.gone.map((g) => g.id), edits.map(editId))
  assert.ok(l.rows.every((r) => !r.changed))
  // A transparency for a colour written as a number: refused there, told.
  const slots = scanFile('a.js', "const m = { color: 0x112233 }\ng.fillStyle = '#112233'")
  const mixed = listing(slots, [{ kind: 'color', orig: '#112233', value: '#11223380' }])
  const row = mixed.rows[0]
  assert.deepEqual(row.places.map((p) => [p.value, p.refused]), [['#112233', true], ['#11223380', false]])
  assert.ok(row.changed && !fitsRow(row, '#11223380') && fitsRow(row, '#445566'))
  assert.deepEqual(mixed.gone, [])
})

test('the command: internal, bounded, clean; the store: one undo step per field typed in', () => {
  assert.equal(COMMANDS['code.setEdits'].internal, true)
  const dirty = run([], { put: [{ kind: 'color', orig: '#ffffff', value: 'red; }' } as never, { kind: 'text', orig: 'a', value: 'b', file: '../x', pos: 0 } as never, { kind: 'text', orig: 'a', value: 'b' }], drop: [] })
  assert.deepEqual(dirty, [{ kind: 'text', orig: 'a', value: 'b' }])
  const s = useStore.getState()
  const p = defaultProject()
  p.assets.push(film())
  s.loadProject(p)
  const depth = (): number => useStore.getState().past.length
  const before = depth()
  const put = (value: string, field: string): void => useStore.getState().setCodeEdits('f', [{ kind: 'color', orig: '#ffb703', value }], [], field)
  put('#000001', 'color.0')
  put('#000002', 'color.0')
  put('#000003', 'color.0')
  assert.equal(depth(), before + 1, 'a colour dragged is one step')
  useStore.getState().setCodeEdits('f', [{ kind: 'text', orig: 'NİSAN', value: 'MAYIS' }], [], 'text.0')
  assert.equal(depth(), before + 2, 'another field is another step')
  assert.equal(useStore.getState().project.assets[0].code!.edits!.length, 2)
  useStore.getState().undo()
  useStore.getState().undo()
  assert.equal(useStore.getState().project.assets[0].code!.edits, undefined, 'undone: the page\'s own values')
  useStore.getState().redo()
  assert.deepEqual(useStore.getState().project.assets[0].code!.edits, [{ kind: 'color', orig: '#ffb703', value: '#000003' }])
  // Not a code film: nothing.
  useStore.getState().setCodeEdits('nope', [{ kind: 'text', orig: 'a', value: 'b' }])
})

test('a project opened: its changes are kept only as clean values (a file from anywhere)', () => {
  const p = defaultProject() as Project
  p.assets.push(film([{ kind: 'color', orig: '#ffffff', value: '#000000' }, { kind: 'color', orig: '#ffffff', value: '</style><script>' } as never, { kind: 'evil', orig: 'x', value: 'y' } as never]))
  p.assets.push({ ...film(), id: 'g', code: { fps: 60, edits: 'not a list' as never } })
  const notes = repairProject(p)
  assert.deepEqual(p.assets[0].code!.edits, [{ kind: 'color', orig: '#ffffff', value: '#000000' }])
  assert.equal(p.assets[1].code!.edits, undefined)
  assert.ok(notes.some((n) => n.code === 'shape'))
  // A clean list is left as it is (no repair said).
  const q = defaultProject() as Project
  q.assets.push(film([{ kind: 'color', orig: '#ffffff', value: '#000000' }]))
  assert.deepEqual(repairProject(q), [])
})

test('the page address: a film with changes carries their name; one without is opened as before', () => {
  assert.equal(editsQuery(film(), '0123456789abcdef'), '')
  assert.equal(editsQuery(film([]), '0123456789abcdef'), '')
  const edits: CodeEdit[] = [{ kind: 'color', orig: '#ffffff', value: '#000000' }]
  assert.equal(editsQuery(film(edits), '0123456789abcdef'), 'sne=' + editsKey(edits))
  assert.notEqual(editsQuery(film(edits), 'x'), editsQuery(film([{ ...edits[0], value: '#000001' }]), 'x'))
})

test('small parts: a colour and its transparency, a time and its unit, which film the panel is open for', () => {
  assert.deepEqual(splitColor('#11223380'), { rgb: '#112233', alpha: '80' })
  assert.deepEqual(splitColor('#112233'), { rgb: '#112233', alpha: '' })
  assert.deepEqual(splitTime('1.5s'), { n: 1.5, unit: 's' })
  assert.deepEqual(splitTime('-300ms'), { n: -300, unit: 'ms' })
  let told = 0
  const off = codeValues.subscribe(() => told++)
  codeValues.toggle('a')
  assert.equal(codeValues.current(), 'a')
  codeValues.toggle('b')
  assert.equal(codeValues.current(), 'b')
  codeValues.toggle('b')
  assert.equal(codeValues.current(), null)
  codeValues.close()
  off()
  assert.equal(told, 3)
  const slot: Slot | undefined = r1[0]
  assert.ok(slot)
})
