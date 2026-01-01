// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// Cila K, step 1: the scanner of "code values" (src/shared/codeval) on real
// pages. The fixtures are pages nobody wrote for this feature: the agent
// trials of phase 5f (r1–r5 baseline, n1–n5 in the app), the free test pages
// of phase 5c (canvas, HTML + CSS, GSAP; three.js from testdata), the two code clip test
// films, and the app's own six templates. The table is what the scanner
// finds in each; the tests after it are what it must and must not find.
import assert from 'node:assert/strict'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import test from 'node:test'
import { isScanned, scanFile, type Slot } from '../shared/codeval'
import { lexJs } from '../shared/codeval/js'

const FIX = join(process.cwd(), 'src', 'test', 'fixtures', 'codeval')
const TPL = join(process.cwd(), 'resources', 'kod-sablonlari')
const page = (name: string): string => readFileSync(name.startsWith('tpl-') ? join(TPL, name.slice(4), 'index.html') : join(FIX, name + '.html'), 'utf8')
const scan = (name: string): Slot[] => scanFile('index.html', page(name))
const of = (slots: Slot[], kind: Slot['kind']): Slot[] => slots.filter((s) => s.kind === kind)
const BS = String.fromCharCode(92)

/** page → [colours, texts, fonts, times] found. */
const TABLE: Record<string, [number, number, number, number]> = {
  r1: [10, 4, 3, 0],
  r2: [10, 3, 3, 0],
  r3: [22, 4, 3, 0],
  r4: [7, 4, 3, 0],
  r5: [13, 3, 3, 0],
  n1: [6, 3, 2, 0],
  n2: [7, 3, 2, 0],
  n3: [9, 4, 2, 0],
  n4: [5, 3, 2, 0],
  n5: [9, 3, 2, 0],
  'f1-canvas': [5, 0, 0, 0],
  'f2-html': [12, 3, 2, 4],
  'f4-gsap': [4, 0, 0, 0],
  'kod-klibi': [6, 0, 1, 0],
  'kod-klibi-saydam': [8, 0, 1, 0],
  'tpl-blank': [3, 0, 0, 0],
  'tpl-lower-third': [5, 0, 0, 0],
  'tpl-bar-chart': [5, 0, 0, 0],
  'tpl-counter': [3, 0, 0, 0],
  'tpl-arrow': [4, 0, 0, 0],
  'tpl-title-card': [6, 0, 0, 0]
}

test('21 real pages: what is found in each (colours, texts, fonts, times)', () => {
  for (const [name, want] of Object.entries(TABLE)) {
    const slots = scan(name)
    assert.deepEqual([of(slots, 'color').length, of(slots, 'text').length, of(slots, 'font').length, of(slots, 'time').length], want, name)
    // Every place is the file's own text, in order, never over another.
    const text = page(name)
    let last = 0
    for (const s of slots) {
      assert.equal(text.slice(s.at, s.end), s.raw, `${name}: the place holds its text`)
      assert.ok(s.at >= last, `${name}: in order, none over another`)
      last = s.end
      assert.equal(text.slice(0, s.at).split('\n').length, s.line, `${name}: its line`)
    }
  }
})

test('an HTML page of the agent (r1): CSS colours grouped by value, text nodes, the fonts', () => {
  const slots = scan('r1')
  const amber = of(slots, 'color').filter((s) => s.value === '#ffb703')
  assert.equal(amber.length, 3, 'the accent stands in three rules')
  assert.ok(amber.every((s) => s.form === 'hex' && s.where === 'css'))
  assert.deepEqual(of(slots, 'text').map((s) => s.value), ['NİSAN', '1986', 'SOVYET UKRAYNASI', 'Yepyeni bir şehir'])
  assert.deepEqual(of(slots, 'font').map((s) => [s.value, s.form]), [['Segoe UI', 'fontq'], ['Helvetica Neue', 'fontq'], ['Arial', 'font']])
  // rgba() is read as a colour with its transparency.
  assert.ok(of(slots, 'color').some((s) => s.raw === 'rgba(20,24,34,.82)' && s.value === '#141822d1' && s.form === 'func'))
  // Not found, on purpose: the <title>, the colour inside a template literal
  // (line 33), the id selectors (#line, #mo…), the comment's words.
  assert.ok(!slots.some((s) => s.raw.includes('r1 Nisan')), 'the <title> is not offered')
  assert.equal(of(slots, 'color').filter((s) => s.where === 'js').length, 0, 'nothing from inside a template literal')
})

test('SVG attributes, a style attribute, colours that are a whole JS string (r3, n2)', () => {
  const r3 = scan('r3')
  assert.deepEqual(of(r3, 'color').filter((s) => s.where === 'attr').map((s) => s.raw).slice(0, 3), ['rgba(18,22,32,.82)', 'rgba(255,255,255,.18)', '#ffb703'])
  assert.deepEqual(of(r3, 'color').filter((s) => s.where === 'js').map((s) => s.raw), ['#ff3b30', '#ffb703'])
  assert.ok(!r3.some((s) => s.raw === 'none'), 'fill="none" is not a colour')
  const n2 = scan('n2')
  assert.deepEqual(of(n2, 'color').filter((s) => s.where === 'style').map((s) => s.raw), ['#5fd38d', '#f5b942'])
  assert.deepEqual(of(n2, 'font').map((s) => [s.value, s.form, s.fq]), [['Segoe UI', 'font', '"'], ['Arial', 'font', '"']])
  // In n2's script: '#2e9e63' is a whole string; 'px #5fd38d' and the
  // gradient string are not (a joined string is left alone).
  assert.deepEqual(of(n2, 'color').filter((s) => s.where === 'js').map((s) => s.raw), ['#2e9e63'])
})

test('a canvas page and a three.js page: colours in JS strings and 0xRRGGBB numbers, a canvas font', () => {
  const f1 = scan('f1-canvas')
  assert.deepEqual(of(f1, 'color').map((s) => [s.raw, s.where]), [['#101418', 'css'], ['#101418', 'js'], ['#e8e8e8', 'js'], ['#4fb3ff', 'js'], ['#ffffff', 'js']])
  assert.equal(of(f1, 'font').length, 0, "'700 40px sans-serif': a generic family is not a font of the user's choosing")
  // The three.js test page (testdata, when it is there; it imports a library
  // the repository's own sources may not, so it is not copied into the fixtures).
  const three = join(process.cwd(), '..', 'testdata', 'kod-klibi-serbest', 'F3-three', 'index.html')
  if (existsSync(three)) {
    const f3 = scanFile('index.html', readFileSync(three, 'utf8'))
    assert.deepEqual(of(f3, 'color').filter((s) => s.form === 'num').map((s) => s.value), ['#15181f', '#ffffff', '#334455', '#ffffff', '#2a3040', '#ff7a3d', '#4fb3ff'])
    assert.equal(f3.length, 8)
  }
  assert.deepEqual(scanFile('scene.js', 'scene.background = new THREE.Color(0x15181f)\nscene.add(new THREE.HemisphereLight(0xffffff, 0x334455, 1.2))\nconst m = new THREE.MeshStandardMaterial({ color: 0x2a3040 })').map((s) => [s.value, s.form, s.line]), [
    ['#15181f', 'num', 1],
    ['#ffffff', 'num', 2],
    ['#334455', 'num', 2],
    ['#2a3040', 'num', 3]
  ])
  const kk = scan('kod-klibi')
  assert.deepEqual(of(kk, 'font').map((s) => [s.raw, s.form, s.fq, s.where]), [['Segoe UI', 'font', '"', 'js']])
  assert.equal(of(kk, 'text').length, 0, "fillText('kod klibi ' + …): a joined string is not offered")
})

test('CSS times (f2): animation and transition lengths, in the shorthand too', () => {
  const f2 = scan('f2-html')
  assert.deepEqual(of(f2, 'time').map((s) => [s.raw, !!s.delay]), [['4s', false], ['1.2s', false], ['1.5s', false], ['1.5s', false]])
  // gsap.from('#title' …): a selector, not a colour; 'transition' the badge's word.
  assert.deepEqual(of(f2, 'text').map((s) => s.value), ['Hello from HTML', 'CSS, SVG and GSAP, no canvas', 'transition'])
})

const html = (body: string): Slot[] => scanFile('index.html', body)
const js = (code: string): Slot[] => scanFile('a.js', code)
const css = (code: string): Slot[] => scanFile('a.css', code)

test('JS: only what a real tokenizer can be sure of', () => {
  // Found.
  assert.deepEqual(js("ctx.fillStyle = '#ff0000'; ctx.fillText('Hello', 10, 20); el.textContent = \"Bye\"; g.strokeText('X', 1, 2)").map((s) => [s.kind, s.value]), [
    ['color', '#ff0000'],
    ['text', 'Hello'],
    ['text', 'Bye'],
    ['text', 'X']
  ])
  assert.deepEqual(js("a.innerText = 'x'\nb.font = 'bold 48px \"Courier New\", monospace'").map((s) => [s.kind, s.value, s.form]), [['text', 'x', 'js'], ['font', 'Courier New', 'fontq']])
  assert.deepEqual(js('g.font = `800 ${size}px Mont`; h.font = `italic 400 ${fs2}px "Instrument Serif"`').map((s) => [s.value, s.form]), [['Mont', 'font'], ['Instrument Serif', 'fontq']])
  assert.deepEqual(js("const c = ['rgb(1, 2, 3)', 'hsl(120, 100%, 50%)', 'rgba(0,0,0,0.5)']").map((s) => s.value), ['#010203', '#00ff00', '#00000080'])
  assert.deepEqual(js('m.color.setHex(0xff8800); const o = { color: 0x112233, k: [0xAABBCC, 0x000000] }').map((s) => s.value), ['#ff8800', '#112233', '#aabbcc', '#000000'])
  assert.equal(js('el.textContent = ' + "'a" + BS + "'b" + BS + "n'")[0].value, "a'b\n", 'escapes are undone for showing')
  // Not found.
  const none = (code: string, why: string): void => assert.deepEqual(js(code).map((s) => s.raw), [], why)
  none("// ctx.fillStyle = '#ff0000'\n/* '#00ff00' */", 'comments')
  none('const s = `color: #ff0000; ${x} #00ff00`', 'template literals')
  none("el.style.cssText = 'color:#ff0000;background:#000'", 'a colour inside a longer string')
  none("document.querySelector('#add'); $('#bed'); el.closest('#face'); d3.select('#fade')", 'selectors')
  none("ctx.fillText('a' + b, 0, 0); ctx.fillText(label, 0, 0); el.textContent = 'a' + 1; el.textContent += 'x'", 'joined or computed text')
  none('const m = x & 0xff00ff; const n = 0xffffff + 1; const k = 0xffff; const big = 0x9e3779b9; y = 0xff00ff | 1', 'numbers in arithmetic, other lengths')
  none("const re = /'#ff0000'/; const ok = re.test(x) ? 1 / 2 : /[/'\"]#fff/", 'regular expressions')
  none("x.font = size + 'px Arial'", 'a font put together')
  none("const a = '#abcd1'; const b = '#ggg'; const c = 'fff'; const d = 'rgb(a, b, c)'; const e = '# fff'", 'what is not a colour')
  // A script that does not tokenize to its end gives nothing at all.
  assert.deepEqual(js("ctx.fillStyle = '#ff0000'; const broken = 'no end"), [])
  assert.deepEqual(js("ctx.fillStyle = '#ff0000'; const t = `open ${"), [])
})

test('the JS tokenizer: strings, templates with code inside, regular expressions, division', () => {
  const kinds = (code: string): string => lexJs(code)!.map((t) => t.t).join(' ')
  assert.equal(kinds('a = b / c / d'), 'id p id p id p id')
  assert.equal(kinds('a = /x[/]y/g.test(s)'), 'id p re p id p id p')
  assert.equal(kinds('`a${ {b: `c${d}`} }e`'), 'tpl p id p tpl id p')
  assert.equal(kinds('return /re/'), 'id re')
  assert.equal(kinds('x = `t` / 2'), 'id p tpl p num')
  assert.equal(kinds("f('a" + BS + "'b', \"c" + BS + '"d")'), 'id p str p str p')
  assert.equal(kinds('1e3 .5 0x1F 10n 1_000'), 'num num num num num')
  assert.equal(kinds('a?.b ?? c ||= d >>>= e'), 'id p id p id p id p id')
  assert.equal(lexJs("'unterminated"), null)
  assert.equal(lexJs('/* open'), null)
  assert.equal(lexJs('`open ${ a '), null)
})

test('CSS: values only, never selectors, at-rule heads, comments, strings or url()', () => {
  const found = css('#abc, #fade:hover { color: #ABC; background: url(#grad) no-repeat, linear-gradient(90deg, red 0%, rgba(0, 0, 0, .5) 100%); /* #123456 */ content: "#ffffff" }')
  assert.deepEqual(found.map((s) => [s.raw, s.value]), [['#ABC', '#aabbcc'], ['red', '#ff0000'], ['rgba(0, 0, 0, .5)', '#00000080']])
  assert.deepEqual(css('@media (min-width: 100px) { a:hover { color: white } .x { --accent: tomato; --n: 12px; border: 1px solid currentColor } }').map((s) => [s.raw, s.form]), [['white', 'name'], ['tomato', 'name']])
  assert.deepEqual(css('p { animation-name: red; grid-area: blue; transition: color .3s ease 1s, opacity 200ms; animation-delay: -1s }').map((s) => [s.raw, s.value, !!s.delay]), [
    ['.3s', '0.3s', false],
    ['1s', '1s', true],
    ['200ms', '200ms', false],
    ['-1s', '-1s', true]
  ])
  // Fonts: the families, quoted and bare; not the generic ones, not @font-face's own name, not var().
  assert.deepEqual(css('@font-face { font-family: Cinzel; src: url(a.woff2) } h1 { font-family: Cinzel, "Inter Tight", Segoe UI, sans-serif } p { font: italic 700 12px/1.5 Georgia, serif } i { font-family: var(--f) } b { font: inherit }').map((s) => [s.value, s.form]), [
    ['Cinzel', 'font'],
    ['Inter Tight', 'fontq'],
    ['Segoe UI', 'font'],
    ['Georgia', 'font']
  ])
  // A string that never ends: the scan stops there, what was found stays.
  assert.deepEqual(css('a { color: #111111 } b { content: "open\n; color: #222222 }').map((s) => s.raw), ['#111111'])
})

test('HTML: where text, tags, styles and scripts begin and end, as the browser reads them', () => {
  const t = (body: string): string[] => of(html(body), 'text').map((s) => s.value)
  assert.deepEqual(t('<p>Tom &amp; Jerry &lt;3 &#8212; R&D &copy; 5 < 6</p>'), ['Tom & Jerry <3 — R&D © 5 < 6'])
  assert.deepEqual(t('<p>a<!-- <b>x</b> -->b</p><!doctype html><?php x ?></>c'), ['a', 'b', 'c'])
  assert.deepEqual(t('<title>T</title><textarea><b>x</b></textarea><noscript>n</noscript><xmp><i>y</i></xmp><p>shown</p>'), ['shown'])
  assert.deepEqual(t('<p>\n   two\n   lines\n</p>'), ['two lines'])
  assert.deepEqual(t('<div title="a > b" data-x=\'<p>no</p>\'>yes</div>'), ['yes'])
  assert.deepEqual(t('<p>&unknownentity; x</p><p>ok</p><p>&amp no semicolon</p>'), ['ok'], 'a reference not known for sure: the node is left alone')
  // A script's and a style's text is never a text node; "</script>" inside a
  // JS string ends the script (as in the browser), so the rest is markup.
  assert.deepEqual(t('<script>var a = "<p>no</p>"</script><style>p{color:red}</style><p>after</p>'), ['after'])
  assert.deepEqual(html('<script type="application/json">{"c":"#ff0000"}</script><script src="x.js">g.fillStyle = "#00ff00"</script><script type="module">g.fillStyle = "#0000ff"</script>').map((s) => s.raw), ['#0000ff'])
  // SVG: colours in attributes; a <style> inside <svg> when it is plain CSS.
  assert.deepEqual(html('<svg><style>.a{fill:#ff0000}</style><rect fill="#00ff00" stroke="none"/><text fill=white>Hi</text></svg><p style="color:#0000ff">x</p>').map((s) => [s.kind, s.raw]), [
    ['color', '#ff0000'],
    ['color', '#00ff00'],
    ['color', 'white'],
    ['text', 'Hi'],
    ['color', '#0000ff'],
    ['text', 'x']
  ])
  // The first attribute of a name is the browser's; one with a character reference is left alone.
  assert.deepEqual(html('<p style="color:#111111" style="color:#222222">a</p><p style="color:&#35;333333">b</p>').map((s) => s.raw), ['#111111', 'a', 'b'])
  // A style attribute without quote marks: colours, no font name.
  assert.deepEqual(html('<p style=color:#111111;font-family:Arial>a</p>').map((s) => s.raw), ['#111111', 'a'])
})

test('where the browser\'s reading is not certain, the scan stops (nothing after is offered)', () => {
  const raws = (body: string): string[] => html(body).map((s) => s.raw)
  assert.deepEqual(raws('<p>a</p><script>x = "<!--"</script><p>b</p>'), ['a'], '"<!--" in a script')
  assert.deepEqual(raws('<p>a</p><svg><script>var c = "#ff0000"</script></svg><p>b</p>'), ['a'], '<script> inside <svg>')
  assert.deepEqual(raws('<p>a</p><svg><foreignObject><style>p{color:#ff0000}</style></foreignObject></svg><p>b</p>'), ['a'], '<style> after <foreignObject>')
  assert.deepEqual(raws('<p>a</p><select><style>p{color:#ff0000}</style></select><p>b</p>'), ['a'], '<select>')
  assert.deepEqual(raws('<p>a</p><plaintext><p>b</p>'), ['a'], '<plaintext>')
  assert.deepEqual(raws('<p>a</p><svg><![CDATA[ <p>b</p> ]]></svg>'), ['a'], 'CDATA in <svg>')
  assert.deepEqual(raws('<p>a</p><svg><style>.a{fill:#ff0000}<b></b></style></svg><p>b</p>'), ['a'], 'a <style> in <svg> that holds markup')
  assert.deepEqual(raws('<p>a</p><p title="open>b</p>'), ['a'], 'a tag the file ends in')
})

test('only pages, style sheets and scripts are scanned; never a minified library or a very long file', () => {
  assert.ok(isScanned('index.html') && isScanned('src/sets/hall.js') && isScanned('a/b.css') && isScanned('m.mjs'))
  assert.ok(!isScanned('gsap.min.js') && !isScanned('data/words.json') && !isScanned('a.svg') && !isScanned('notes.txt'))
  assert.deepEqual(scanFile('gsap.min.js', "x = '#ff0000'"), [])
  assert.deepEqual(scanFile('big.js', "x = '#ff0000';" + ' '.repeat(1024 * 1024)), [])
})

test('the big films of the test material (testdata, when it is there): found, and how long the scan takes', (t) => {
  const films = join(process.cwd(), '..', 'testdata', 'filmler')
  if (!existsSync(films)) return t.skip('no testdata')
  // Which folders they are: testdata/filmler/roles.json (scripts/e2e/harness-paths.mjs filmDir).
  let roles: Record<string, string> = {}
  try { roles = JSON.parse(readFileSync(join(films, 'roles.json'), 'utf8')) } catch { /* the role is the folder */ }
  for (const film of ['portrait', 'heavy']) {
    const root = join(films, roles[film] || film)
    if (!existsSync(root)) continue
    const files: string[] = []
    const walk = (rel: string): void => {
      for (const e of readdirSync(join(root, rel), { withFileTypes: true })) {
        const r = rel ? `${rel}/${e.name}` : e.name
        if (e.isDirectory()) {
          if (!/^(node_modules|\.videohub|snipp|\.surumler)$/.test(e.name)) walk(r)
        } else if (isScanned(r) && statSync(join(root, r)).size <= 1024 * 1024) files.push(r)
      }
    }
    walk('')
    const texts = files.map((f) => [f, readFileSync(join(root, f), 'utf8')] as const)
    const t0 = performance.now()
    const slots = texts.flatMap(([f, text]) => scanFile(f, text))
    const ms = performance.now() - t0
    const n = (k: Slot['kind']): number => of(slots, k).length
    const groups = new Set(of(slots, 'color').map((s) => s.value)).size
    console.log(`     ${film}: ${files.length} files, ${texts.reduce((a, x) => a + x[1].length, 0)} characters, ${ms.toFixed(0)} ms: colours ${n('color')} (${groups} different), texts ${n('text')}, fonts ${n('font')}, times ${n('time')}`)
    assert.ok(n('color') > 500, `${film}: its colours are found (${n('color')})`)
    assert.ok(n('font') > 5, `${film}: its canvas fonts are found (${n('font')})`)
  }
})
