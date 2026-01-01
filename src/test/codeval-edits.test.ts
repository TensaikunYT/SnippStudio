// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// Cila K: the user's changes against a scan (src/shared/codeval/edits.ts):
// one place, every place holding a value, a place that moved because the
// file was rewritten, a change that no longer has a place.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import test from 'node:test'
import { cleanEdits, editId, editsKey, groupKey, isEditsKey, patchText, resolveEdits, scanFile, type CodeEdit, type Slot } from '../shared/codeval'

const FIX = join(process.cwd(), 'src', 'test', 'fixtures', 'codeval')
const r1 = readFileSync(join(FIX, 'r1.html'), 'utf8')

/** The change of one place, as the panel makes it. */
function placeEdit(slots: Slot[], s: Slot, value: string): CodeEdit {
  const same = slots.filter((x) => x.file === s.file && x.kind === s.kind && x.raw === s.raw)
  return { kind: s.kind, orig: s.raw, value, file: s.file, pos: s.at, n: same.indexOf(s), of: same.length }
}
const apply = (text: string, edits: CodeEdit[], file = 'index.html'): { out: string; hits: number[]; refused: number[] } => {
  const slots = scanFile(file, text)
  const r = resolveEdits(slots, edits)
  return { out: patchText(text, slots, r.writes), hits: r.states.map((s) => s.hits), refused: r.states.map((s) => s.refused) }
}

test('every place holding a value: one change, written everywhere it stands', () => {
  const edits: CodeEdit[] = [{ kind: 'color', orig: groupKey('color', '#ffb703'), value: '#00c2ff' }]
  const { out, hits } = apply(r1, edits)
  assert.deepEqual(hits, [3])
  assert.equal((out.match(/#00c2ff/g) ?? []).length, 3)
  // The one inside a template literal is not a place: it stays (and is told as not found by the scan's table).
  assert.equal((out.match(/#ffb703/g) ?? []).length, 1)
  assert.equal(out.length, r1.length, 'nothing else moved')
  // rgba() places take the colour in their own form.
  const shadow = apply(r1, [{ kind: 'color', orig: '#00000099', value: '#102030' }])
  assert.ok(shadow.out.includes('text-shadow:0 3px 14px rgb(16,32,48)'))
})

test('one place: only it; and it wins over a change of every place', () => {
  const slots = scanFile('index.html', r1)
  const second = slots.filter((s) => s.value === '#ffb703')[1]
  const edits: CodeEdit[] = [
    { kind: 'color', orig: '#ffb703', value: '#111111' },
    placeEdit(slots, second, '#222222')
  ]
  const { out, hits } = apply(r1, edits)
  assert.deepEqual(hits, [2, 1])
  assert.equal(out.slice(second.at, second.end), '#222222')
  // Text: a node's words, read back by the browser as typed.
  const node = slots.find((s) => s.kind === 'text' && s.value === 'Yepyeni bir şehir')!
  const t = apply(r1, [placeEdit(slots, node, 'Hayalet <şehir> & "sis"')])
  assert.ok(t.out.includes('</small>Hayalet &#60;şehir&#62; &#38; &#34;sis&#34;</div>'))
  // A font: bare where it can stand bare, quoted where it must be.
  const arial = slots.find((s) => s.kind === 'font' && s.value === 'Arial')!
  assert.ok(apply(r1, [placeEdit(slots, arial, 'Inter Tight')]).out.includes('"Helvetica Neue",Inter Tight,sans-serif'))
  assert.ok(apply(r1, [placeEdit(slots, arial, 'Exo 2')]).out.includes('"Helvetica Neue","Exo 2",sans-serif'))
  assert.ok(apply(r1, [{ kind: 'font', orig: 'segoe ui', value: 'Georgia' }]).out.includes('font-family:"Georgia","Helvetica Neue"'))
})

test('the file was rewritten: a place that moved is found again; one that is gone is told', () => {
  const slots = scanFile('index.html', r1)
  const node = slots.find((s) => s.kind === 'text' && s.value === 'NİSAN')!
  const year = slots.find((s) => s.kind === 'text' && s.value === '1986')!
  const edits = [placeEdit(slots, node, 'MAYIS'), placeEdit(slots, year, '1987')]
  // The agent adds a line above (everything moves) and rewrites the year.
  const rewritten = r1.replace('<div id="s">', '<!-- a note -->\n<div id="s">').replace('>1986<', '>2026<')
  const { out, hits, refused } = apply(rewritten, edits)
  assert.deepEqual(hits, [1, 0], 'the month is found where it moved to; the year is no longer in the page')
  assert.deepEqual(refused, [0, 0])
  assert.ok(out.includes('id="mo">MAYIS<') && out.includes('>2026<'))
  // As many places with that text as there were, or it is not guessed: a second "NİSAN" appears → not written.
  const doubled = rewritten.replace('<div class="it" id="yr">', '<div>NİSAN</div><div class="it" id="yr">')
  assert.deepEqual(apply(doubled, edits).hits, [0, 0])
  // A change of every place is found wherever the value still stands…
  const group: CodeEdit[] = [{ kind: 'color', orig: '#ffb703', value: '#00c2ff' }]
  assert.deepEqual(apply(rewritten, group).hits, [3])
  // …and told as gone when the agent took the colour out of the page.
  assert.deepEqual(apply(rewritten.split('#ffb703').join('#ff0000'), group).hits, [0])
})

test('a value that cannot stand at a place is refused there, not written half', () => {
  const page = '<p style=font-family:Arial;color:#111111>x</p><script>const m = { color: 0x112233 }; g.fillStyle = "#112233"</script>'
  const r = apply(page, [{ kind: 'color', orig: '#112233', value: '#44556680' }])
  assert.deepEqual([r.hits, r.refused], [[1], [1]], 'a transparency: in the string, not in the number')
  assert.ok(r.out.includes('0x112233') && r.out.includes('"#44556680"'))
})

test('a list of changes: its name in the page address, one per place, the last said wins', () => {
  const a: CodeEdit[] = [{ kind: 'color', orig: '#ffffff', value: '#000000' }]
  assert.equal(editsKey(undefined), '')
  assert.equal(editsKey([]), '')
  assert.ok(isEditsKey(editsKey(a)))
  assert.equal(editsKey(a), editsKey(JSON.parse(JSON.stringify(a))))
  assert.notEqual(editsKey(a), editsKey([{ ...a[0], value: '#000001' }]))
  assert.ok(!isEditsKey('') && !isEditsKey('a b') && !isEditsKey('../x') && !isEditsKey(12))
  const merged = cleanEdits([a[0], { kind: 'color', orig: '#ffffff', value: '#123456' }, { kind: 'color', orig: '#FFFFFF', value: '#0000ff' }])
  assert.deepEqual(merged.map((e) => e.value), ['#123456', '#0000ff'])
  assert.equal(editId({ kind: 'text', orig: 'a', value: 'b', file: 'x.html', pos: 3 }), 's|text|x.html|3|a')
  assert.equal(editId({ kind: 'text', orig: 'a', value: 'b' }), 'g|text|a')
})
