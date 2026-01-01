// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// Cila K, the security of "code values": what the user types (or what a
// project file from anywhere claims they typed) is written into a page that
// runs. No value may become code. Three walls, each tested here:
//   1. `emit` writes only the shapes in EMITTED: characters that can end or
//      open nothing in HTML, CSS or JS (values.ts);
//   2. a change is written only at a place the scanner found in the file as
//      it is now, as the kind the scanner says (edits.ts);
//   3. so a patched page has the same structure as the page: the same
//      scripts, the same tokens in them, the same tags, the same places.
import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import test from 'node:test'
import vm from 'node:vm'
import { cleanEdit, cleanEdits, emit, EMITTED, groupKey, patchText, resolveEdits, scanFile, type CodeEdit, type Slot } from '../shared/codeval'
import { lexJs } from '../shared/codeval/js'

const FIX = join(process.cwd(), 'src', 'test', 'fixtures', 'codeval')
const TPL = join(process.cwd(), 'resources', 'kod-sablonlari')
const PAGES: [string, string][] = [
  ...readdirSync(FIX).sort().map((f): [string, string] => [f, readFileSync(join(FIX, f), 'utf8')]),
  ...readdirSync(TPL).sort().map((id): [string, string] => ['tpl-' + id, readFileSync(join(TPL, id, 'index.html'), 'utf8')])
]

const ch = String.fromCharCode
const BS = ch(92)
/** Values someone hostile would try, in every field. */
const HOSTILE: string[] = [
  '</script><script>alert(1)</script>',
  '</SCRIPT ><img src=x onerror=alert(1)>',
  '</style><script>alert(1)</script>',
  "'; alert(1); '",
  '"; alert(1); "',
  '`; alert(1); `',
  '${alert(1)}',
  BS,
  BS + "'; alert(1); //",
  BS + BS + '"; alert(1); //',
  'a' + ch(10) + 'alert(1)',
  'a' + ch(13) + ch(10) + 'alert(1)',
  'a' + ch(0x2028) + 'alert(1)' + ch(0x2029),
  'url(javascript:alert(1))',
  'expression(alert(1))',
  'red; background: url(javascript:alert(1))',
  '#fff;}body{display:none}',
  '#fff" onload="alert(1)',
  "#fff' onmouseover='alert(1)",
  '&lt;script&gt;alert(1)&lt;/script&gt;',
  '&#60;script&#62;alert(1)&#60;/script&#62;',
  '&#x3c;img src=x onerror=alert(1)&#x3e;',
  '<!-- ',
  '-->',
  ']]>',
  '*/ alert(1) /*',
  '/* ',
  '// ' + ch(10),
  ch(0) + 'x',
  ch(0xd83d) + 'lone',
  ch(0x202e) + 'rtl',
  'x'.repeat(5000),
  '</script>'.repeat(300),
  'Arial; } * { display: none',
  'Arial", serif; color: red; x: "',
  '1s; } body { display: none',
  '1e999s',
  '0x1; alert(1)',
  'rgb(0,0,0); alert(1)',
  '\\x3C/script\\x3E',
  '@import "x"',
  '<svg/onload=alert(1)>'
]
const KINDS: Slot['kind'][] = ['color', 'text', 'font', 'time']
const FORMS = Object.keys(EMITTED) as Slot['form'][]

test('wall 1: whatever is typed, only the allowed shapes are ever written', () => {
  let written = 0
  for (const kind of KINDS)
    for (const form of FORMS)
      for (const fq of ['"', "'", ''] as const)
        for (const v of [...HOSTILE, '#ff0000', '#ff000080', 'Arial', 'Exo 2', 'Inter Tight', '1.5s', '300ms', '-1s', 'Merhaba dünya', '', 12, null, undefined, {}, ['#fff']]) {
          const out = emit({ kind, form, fq, delay: true }, v)
          if (out === null) continue
          written++
          assert.match(out, EMITTED[form], `${kind}/${form}: ${JSON.stringify(String(v).slice(0, 40))} → ${JSON.stringify(out.slice(0, 60))}`)
          // None of the characters that end or open something, anywhere.
          const quotes = form === 'font' ? /[<>&`${}();:*/=\n\r]/ : form === 'html' ? /[<>"'`${}()[\]:*/=\\\n\r]/ : form === 'js' ? /[<>"'`${}()[\];:*/=&\n\r]/ : /[<>"'`${}\[\];:*/=\\&\n\r]/
          assert.ok(!quotes.test(out), `${kind}/${form}: ${JSON.stringify(out.slice(0, 60))} holds a character that could end something`)
        }
  assert.ok(written > 100, `${written} values were written`)
  // A hostile value is a colour, a font or a time for no place.
  for (const v of HOSTILE)
    for (const kind of ['color', 'font', 'time'] as const)
      for (const form of FORMS) if (!(kind === 'font' && /^[A-Za-z0-9 ]+$/.test(v))) assert.equal(emit({ kind, form, fq: '"', delay: true }, v), null, `${kind}/${form}: ${JSON.stringify(v.slice(0, 40))}`)
  // What IS written for text: every character but letters, digits and the space as a number.
  assert.equal(emit({ kind: 'text', form: 'html' }, '</script><b>&"\''), '&#60;&#47;script&#62;&#60;b&#62;&#38;&#34;&#39;')
  assert.equal(emit({ kind: 'text', form: 'js' }, "</script>'" + BS + ch(10)), `${BS}x3C${BS}x2Fscript${BS}x3E${BS}x27${BS}x5C${BS}x0A`)
  assert.equal(emit({ kind: 'text', form: 'js' }, 'İstanbul 2026 ' + ch(0x2028)), 'İstanbul 2026 ' + BS + 'u2028')
  assert.equal(emit({ kind: 'text', form: 'html' }, 'x'.repeat(2001)), null, 'longer than the limit: not written')
  // Colours in the form of the place; a transparency only where one can stand.
  assert.equal(emit({ kind: 'color', form: 'hex' }, '#FF000080'), '#ff000080')
  assert.equal(emit({ kind: 'color', form: 'func' }, '#ff000080'), 'rgba(255,0,0,0.502)')
  assert.equal(emit({ kind: 'color', form: 'func' }, '#0a0b0c'), 'rgb(10,11,12)')
  assert.equal(emit({ kind: 'color', form: 'num' }, '#0a0b0c'), '0x0a0b0c')
  assert.equal(emit({ kind: 'color', form: 'num' }, '#0a0b0c80'), null)
  assert.equal(emit({ kind: 'color', form: 'name' }, '#0a0b0c'), '#0a0b0c')
  // Fonts: bare where the name can stand bare, in the free quote mark where it cannot, refused where none is free.
  assert.equal(emit({ kind: 'font', form: 'font', fq: '"' }, 'Inter Tight'), 'Inter Tight')
  assert.equal(emit({ kind: 'font', form: 'font', fq: "'" }, 'Exo 2'), "'Exo 2'")
  assert.equal(emit({ kind: 'font', form: 'font', fq: '' }, 'Exo 2'), null)
  assert.equal(emit({ kind: 'font', form: 'fontq' }, 'Exo 2'), 'Exo 2')
  assert.equal(emit({ kind: 'time', form: 'time' }, '-1s'), null, 'a length of time is not negative')
  assert.equal(emit({ kind: 'time', form: 'time', delay: true }, '-1s'), '-1s')
})

const LONE = new RegExp('[' + ch(0xd800) + '-' + ch(0xdfff) + ']', 'g')
const AROUND_BREAK = new RegExp('[' + ch(9) + ch(12) + ch(13) + ' ]*' + ch(10) + '[' + ch(9) + ch(10) + ch(12) + ch(13) + ' ]*', 'g')
/** A typed text as a page shows it back: NUL as U+FFFD, a line break (and
 *  the blanks around it) as one space, no spaces at its two ends. */
const asPageReads = (v: string): string =>
  v
    .split(ch(0)).join(ch(0xfffd))
    .split(ch(13) + ch(10)).join(ch(10))
    .split(ch(13)).join(ch(10))
    .replace(/^ +| +$/g, '')
    .replace(AROUND_BREAK, ' ')

/** The shape of a page: its tags and, for each script, its JS tokens' kinds. */
function shape(text: string): string {
  const tags = (text.match(/<\/?[A-Za-z][A-Za-z0-9-]*/g) ?? []).join(' ')
  const scripts = [...text.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script/gi)].map((m) => (lexJs(m[1]) ?? []).map((t) => t.t).join('')).join(' | ')
  return tags + ' || ' + scripts
}

/** The scripts of a page that compile (by the JS engine itself, not by this
 *  module's tokenizer): how many, and their sources' count. Nothing is run. */
function compiled(text: string): number {
  let n = 0
  for (const m of text.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script/gi)) {
    if (/src=|importmap|json/i.test(m[1]) || /^\s*import\b/m.test(m[2])) continue
    try {
      new vm.Script(m[2])
      n++
    } catch {
      /* does not compile */
    }
  }
  return n
}

test('wall 3: every place of every real page, with every hostile value: the page keeps its shape', () => {
  let patches = 0
  for (const [name, text] of PAGES) {
    const slots = scanFile('index.html', text)
    assert.ok(slots.length > 0, name)
    const before = shape(text)
    const scripts = compiled(text)
    for (const v of HOSTILE) {
      // Every place at once, as one change each (the user's hand, or a project file's claim).
      const edits: CodeEdit[] = slots.map((s) => ({ kind: s.kind, orig: s.raw, value: v, file: s.file, pos: s.at, n: 0, of: 1 }))
      const { writes } = resolveEdits(slots, edits)
      const out = patchText(text, slots, writes)
      patches += writes.filter(Boolean).length
      assert.equal(shape(out), before, `${name} with ${JSON.stringify(v.slice(0, 30))}: the same tags, the same tokens in each script`)
      assert.equal(compiled(out), scripts, `${name} with ${JSON.stringify(v.slice(0, 30))}: every script still compiles`)
      // The patched page scans to the same places (same kinds, same order).
      const again = scanFile('index.html', out)
      assert.deepEqual(again.map((s) => `${s.kind}/${s.form.replace('fontq', 'font')}/${s.where}`), slots.map((s) => `${s.kind}/${s.form.replace('fontq', 'font')}/${s.where}`), `${name}: the same places after`)
      // Only text places took the value; what they hold reads back as typed.
      writes.forEach((w, i) => {
        if (!w) return
        if (slots[i].kind !== 'text') return void assert.ok(slots[i].kind === 'font' && /^[A-Za-z0-9 ]+$/.test(v), `${name}: only a text takes ${JSON.stringify(v.slice(0, 20))} (a font takes a plain name)`)
        // (A lone half of a pair has no escape in HTML: it is written as U+FFFD. Layout line breaks read as a space.)
        const typed = v.replace(LONE, ch(0xfffd))
        const read = again[i].value
        if (slots[i].form === 'js') assert.equal(read, typed, `${name}: the script reads the text as typed`)
        else assert.equal(read, asPageReads(typed), `${name}: the page reads the text as typed`)
      })
    }
  }
  assert.ok(patches > 500, `${patches} hostile texts were written and read back`)
})

test('wall 2: a project file cannot choose where or as what a value is written', () => {
  const text = readFileSync(join(FIX, 'r3.html'), 'utf8')
  const slots = scanFile('index.html', text)
  const color = slots.find((s) => s.kind === 'color' && s.where === 'js')!
  const node = slots.find((s) => s.kind === 'text')!
  const tries: CodeEdit[] = [
    // A text claimed where a colour stands (to get text escaping into a colour's place).
    { kind: 'text', orig: color.raw, value: "'; alert(1); '", file: 'index.html', pos: color.at, n: 0, of: 1 },
    // A text claimed in the middle of the script's code.
    { kind: 'text', orig: 'function renderOut', value: 'alert(1)', file: 'index.html', pos: text.indexOf('function renderOut'), n: 0, of: 1 },
    // The right place, a wrong original text.
    { kind: 'text', orig: 'not what is there', value: 'x', file: 'index.html', pos: node.at, n: 0, of: 1 },
    // Another file's change.
    { kind: 'text', orig: node.raw, value: 'x', file: '../../other.html', pos: node.at, n: 0, of: 1 },
    // A colour that is not one.
    { kind: 'color', orig: color.raw, value: 'red;}', file: 'index.html', pos: color.at, n: 0, of: 1 }
  ]
  const { writes, states } = resolveEdits(slots, tries)
  assert.ok(writes.every((w) => w === null), 'nothing is written')
  assert.equal(patchText(text, slots, writes), text)
  assert.deepEqual(states.map((s) => s.hits), [0, 0, 0, 0, 0])
  // And none of them is kept by a project that is opened: cleanEdits drops what is not a value of its kind or a plain path.
  assert.equal(cleanEdit(tries[3]), null, 'a path that climbs')
  assert.equal(cleanEdit(tries[4]), null, 'a colour that is not one')
  assert.equal(cleanEdit({ kind: 'script', orig: 'x', value: 'y' }), null)
  assert.equal(cleanEdit({ kind: 'text', orig: 'x', value: 'y', file: 'C:/Windows/x.html', pos: 0 }), null, 'a path with a drive')
  assert.equal(cleanEdit({ kind: 'text', orig: 'x', value: 'y', file: 'a' + BS + 'b.html', pos: 0 }), null, 'a path with a backslash')
  assert.equal(cleanEdit({ kind: 'text', orig: 'x', value: 'y'.repeat(2001), file: 'a.html', pos: 0 }), null, 'a text over the limit')
  assert.equal(cleanEdit({ kind: 'text', orig: 'x'.repeat(4001), value: 'y' }), null)
  assert.equal(cleanEdit({ kind: 'font', orig: 'arial', value: 'Arial", x: "' }), null)
  assert.equal(cleanEdit({ kind: 'time', orig: '1s', value: '1s; x' }), null)
  assert.equal(cleanEdit({ kind: 'text', orig: 'x', value: 'y', file: 'a.html', pos: -1 }), null)
  assert.equal(cleanEdit({ kind: 'text', orig: 'x', value: 'y', file: 'a.html', pos: 1.5 }), null)
  assert.equal(cleanEdits(Array.from({ length: 5000 }, (_, i) => ({ kind: 'text', orig: 'x' + i, value: 'y' }))).length, 600, 'at most 600 changes a film')
  assert.deepEqual(cleanEdits('no'), [])
  assert.deepEqual(cleanEdits([null, 1, 'x', {}, { kind: 'color', orig: '#ffffff', value: '#000000', extra: 'dropped' }]), [{ kind: 'color', orig: '#ffffff', value: '#000000' }])
})

test('a scan of another text writes nothing (the place must hold its own text)', () => {
  const text = readFileSync(join(FIX, 'n2.html'), 'utf8')
  const slots = scanFile('index.html', text)
  const edits: CodeEdit[] = [{ kind: 'color', orig: groupKey('color', '#ffffff'), value: '#ff0000' }]
  const { writes } = resolveEdits(slots, edits)
  assert.ok(writes.some(Boolean))
  const other = text.replace('#fff', '#eee')
  assert.equal(patchText(other, slots, writes).includes('#ff0000'), false, 'the old scan, a changed file: not written')
})
