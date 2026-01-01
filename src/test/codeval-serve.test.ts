// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// Cila K, step 2: the user's values written into a film's files AS THEY ARE
// SERVED (main/codefilm-values.ts, main/codefilm.ts serveFilm), and "Write to
// the files" through the version keeper. Real folders in the temp folder,
// the real protocol handler.
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { FilmRegistry, serveFilm } from '../main/codefilm'
import { decodeText, FilmValues, scanFolder, scanSet, writeValues } from '../main/codefilm-values'
import { VersionKeeper, versionNumbers } from '../main/codefilm-versions'
import { editsKey, type CodeEdit } from '../shared/codeval'

const tmp = (): string => mkdtempSync(path.join(tmpdir(), 'snipp-cila-k-'))
const PAGE = '<!doctype html>\n<html><head><meta charset="utf-8"><link rel="stylesheet" href="style.css"><style>h1{color:#ffb703}</style></head>\n<body><h1>Başlık</h1><script src="src/a.js"></script></body></html>\n'
const CSS = 'body{background:#101418;font-family:"Segoe UI",sans-serif}\n'
const JS = "const g = c.getContext('2d')\ng.fillStyle = '#ffb703'\ng.fillText('Merhaba', 10, 10)\n"

function film(): { root: string; reg: FilmRegistry; id: string } {
  const root = path.join(tmp(), 'film')
  mkdirSync(path.join(root, 'src'), { recursive: true })
  writeFileSync(path.join(root, 'index.html'), PAGE)
  writeFileSync(path.join(root, 'style.css'), CSS)
  writeFileSync(path.join(root, 'src', 'a.js'), JS)
  const reg = new FilmRegistry()
  return { root, reg, id: reg.idFor(root) }
}
const get = async (reg: FilmRegistry, id: string, p: string, values: FilmValues | null): Promise<{ status: number; body: string; length: string | null }> => {
  const r = await serveFilm(reg, new Request(`snippfilm://${id}/${p}`), true, null, values)
  return { status: r.status, body: Buffer.from(await r.arrayBuffer()).toString('utf8'), length: r.headers.get('content-length') }
}
const EDITS: CodeEdit[] = [
  { kind: 'color', orig: '#ffb703', value: '#00c2ff' },
  { kind: 'text', orig: 'Başlık', value: 'Yeni <başlık>' },
  { kind: 'text', orig: 'Merhaba', value: "Selam'; alert(1); '" },
  { kind: 'font', orig: 'segoe ui', value: 'Georgia' }
]

test('a film with no values set is served byte for byte as before', async () => {
  const { reg, id } = film()
  const values = new FilmValues(50)
  for (const p of ['index.html?snipp=1', 'style.css', 'src/a.js', 'index.html?snipp=1&dpr=2']) {
    assert.deepEqual(await get(reg, id, p, values), await get(reg, id, p, null), p)
  }
  assert.equal(values.planKey(id), null)
})

test('the values are written into the page, its style sheet and its script as they are served; the files are not touched', async () => {
  const { root, reg, id } = film()
  const values = new FilmValues(50)
  const key = editsKey(EDITS)
  assert.ok(values.put(id, key, EDITS))
  const page = await get(reg, id, `index.html?snipp=1&sne=${key}`, values)
  assert.equal(page.status, 200)
  assert.ok(page.body.startsWith('<!doctype html>\n<script src="/__snipp/guard.js"></script>'), 'the guard is still the first script')
  assert.ok(page.body.includes('h1{color:#00c2ff}') && page.body.includes('<h1>Yeni &#60;başlık&#62;</h1>'), page.body)
  assert.equal(page.length, String(Buffer.byteLength(page.body)))
  const css = await get(reg, id, 'style.css', values)
  assert.equal(css.body, 'body{background:#101418;font-family:"Georgia",sans-serif}\n')
  const js = await get(reg, id, 'src/a.js', values)
  const BS = String.fromCharCode(92)
  assert.equal(js.body, `const g = c.getContext('2d')\ng.fillStyle = '#00c2ff'\ng.fillText('Selam${BS}x27${BS}x3B alert${BS}x281${BS}x29${BS}x3B ${BS}x27', 10, 10)\n`)
  assert.equal(js.length, String(Buffer.byteLength(js.body)))
  // On disk: as written.
  assert.equal(readFileSync(path.join(root, 'index.html'), 'utf8'), PAGE)
  assert.equal(readFileSync(path.join(root, 'style.css'), 'utf8'), CSS)
  assert.equal(readFileSync(path.join(root, 'src', 'a.js'), 'utf8'), JS)
  // A load of the page without values: everything as it is again.
  assert.equal((await get(reg, id, 'index.html?snipp=1', values)).body, (await get(reg, id, 'index.html?snipp=1', null)).body)
  assert.equal((await get(reg, id, 'src/a.js', values)).body, JS)
})

test('a page waits for the values its address names; without them it is not served', async () => {
  const { reg, id } = film()
  const values = new FilmValues(300)
  const key = editsKey(EDITS)
  // The request first, the editor's message a moment later.
  const asked = get(reg, id, `index.html?snipp=1&sne=${key}`, values)
  setTimeout(() => values.put(id, key, EDITS), 40)
  assert.ok((await asked).body.includes('#00c2ff'))
  // Values that never come: no page (an export never draws a page without the user's values).
  const never = await get(reg, id, 'index.html?snipp=1&sne=zzzz', values)
  assert.equal(never.status, 503)
  assert.equal((await get(reg, id, 'index.html?snipp=1&sne=../x', values)).status, 503, 'a name that is not one')
  // Another page of the film (no mark of the app) is served with the current values.
  values.put(id, key, EDITS)
  await get(reg, id, `index.html?snipp=1&sne=${key}`, values)
  assert.ok((await get(reg, id, 'index.html', values)).body.includes('#00c2ff'))
})

test('what the editor sends is cleaned: a change that is not a value of its kind never reaches a page', async () => {
  const { reg, id } = film()
  const values = new FilmValues(50)
  const hostile = [
    { kind: 'color', orig: '#ffb703', value: 'red;}</style><script>alert(1)</script>' },
    { kind: 'font', orig: 'segoe ui', value: 'x", serif; } body { display: none' },
    { kind: 'text', orig: 'Başlık', value: '</h1><script>alert(1)</script>' }
  ]
  assert.ok(values.put(id, 'k1', hostile))
  const page = await get(reg, id, 'index.html?snipp=1&sne=k1', values)
  assert.ok(page.body.includes('h1{color:#ffb703}'), 'the colour that is not one is dropped')
  assert.ok(page.body.includes('<h1>&#60;&#47;h1&#62;&#60;script&#62;alert&#40;1&#41;&#60;&#47;script&#62;</h1>'), page.body)
  assert.equal((page.body.match(/<script/g) ?? []).length, 2, 'the guard and the page\'s own script, no third')
  assert.equal((await get(reg, id, 'style.css', values)).body, CSS)
  assert.ok(!values.put(id, 'not a key!', hostile))
})

test('which files are scanned: pages, style sheets, scripts; not libraries, versions, links out, or what is not UTF-8', async () => {
  const { root, reg, id } = film()
  mkdirSync(path.join(root, 'node_modules', 'lib'), { recursive: true })
  writeFileSync(path.join(root, 'node_modules', 'lib', 'index.js'), "x = '#ffb703'")
  mkdirSync(path.join(root, '.surumler', '1'), { recursive: true })
  writeFileSync(path.join(root, '.surumler', '1', 'index.html'), PAGE)
  writeFileSync(path.join(root, 'gsap.min.js'), "x = '#ffb703'")
  writeFileSync(path.join(root, 'data.json'), '{"c":"#ffb703"}')
  writeFileSync(path.join(root, 'big.js'), "x = '#ffb703';" + ' '.repeat(1024 * 1024))
  writeFileSync(path.join(root, 'latin.js'), Buffer.concat([Buffer.from("x = '#ffb703' // "), Buffer.from([0xe7, 0xf6]), Buffer.from('\n')]))
  // A folder outside, linked in.
  const outside = path.join(path.dirname(root), 'outside')
  mkdirSync(outside)
  writeFileSync(path.join(outside, 'secret.js'), "x = '#ffb703'")
  let linked = true
  try {
    symlinkSync(outside, path.join(root, 'link'), 'junction')
  } catch {
    linked = false
  }
  const set = await scanSet(root)
  assert.deepEqual(set.files, ['index.html', 'latin.js', 'src/a.js', 'style.css'])
  assert.equal(set.skipped, 1, 'big.js is too long')
  const scan = await scanFolder(root)
  assert.deepEqual([...new Set(scan.slots.map((s) => s.file))], ['index.html', 'src/a.js', 'style.css'], 'a file that is not UTF-8 gives nothing')
  assert.equal(decodeText(readFileSync(path.join(root, 'latin.js'))), null)
  assert.equal(decodeText(Buffer.from([0xff, 0xfe, 0x41, 0x00])), null, 'UTF-16')
  assert.deepEqual(decodeText(Buffer.from([0xef, 0xbb, 0xbf, 0x41])), { text: 'A', bom: true })
  // Served: only the scanned files take values.
  const values = new FilmValues(50)
  const all: CodeEdit[] = [{ kind: 'color', orig: '#ffb703', value: '#00c2ff' }]
  values.put(id, 'k', all)
  await get(reg, id, 'index.html?snipp=1&sne=k', values)
  for (const p of ['gsap.min.js', 'latin.js', 'node_modules/lib/index.js']) assert.ok(!(await get(reg, id, p, values)).body.includes('#00c2ff'), p)
  if (linked) assert.equal((await get(reg, id, 'link/secret.js', values)).status, 403, 'the fence is as it was')
})

test('"Write to the files": the files as they were are kept as a version first; "back" puts them back', async () => {
  const root = path.join(tmp(), 'proj', 'anim', 'title')
  mkdirSync(path.join(root, 'src'), { recursive: true })
  writeFileSync(path.join(root, 'index.html'), PAGE)
  writeFileSync(path.join(root, 'style.css'), CSS)
  writeFileSync(path.join(root, 'src', 'a.js'), JS)
  const k = new VersionKeeper(root, 1e9)
  const r = await writeValues(root, EDITS, k)
  assert.deepEqual(r, { files: 3, places: 5, version: 1 })
  assert.ok(readFileSync(path.join(root, 'index.html'), 'utf8').includes('h1{color:#00c2ff}'))
  assert.ok(readFileSync(path.join(root, 'style.css'), 'utf8').includes('"Georgia"'))
  assert.equal(readFileSync(path.join(root, '.surumler', '1', 'index.html'), 'utf8'), PAGE, 'version 1 is the page as it was')
  // The write itself makes no second version (it is the state the keeper has seen).
  assert.equal(await k.settle(), null)
  assert.deepEqual(await versionNumbers(root), [1])
  // The same changes again: none has a place any more.
  await assert.rejects(writeValues(root, EDITS, k), /none of the changes has a place/)
  // Back: the files as they were (and what was written becomes a version).
  const back = await k.back()
  assert.equal(back.n, 1)
  assert.equal(readFileSync(path.join(root, 'index.html'), 'utf8'), PAGE)
  assert.equal(readFileSync(path.join(root, 'src', 'a.js'), 'utf8'), JS)
  k.stop()
})

test('"Write to the files" writes nothing when the state before cannot be kept, or a file changed meanwhile', async () => {
  const root = path.join(tmp(), 'proj', 'anim', 'big')
  mkdirSync(root, { recursive: true })
  writeFileSync(path.join(root, 'index.html'), PAGE)
  writeFileSync(path.join(root, 'notes.txt'), 'x'.repeat(2 * 1024 * 1024 + 10))
  const k = new VersionKeeper(root, 1e9)
  await assert.rejects(writeValues(root, EDITS, k), (e: Error & { reason?: string }) => e.reason === 'over-limit')
  assert.equal(readFileSync(path.join(root, 'index.html'), 'utf8'), PAGE)
  assert.ok(!existsSync(path.join(root, '.surumler')))
  rmSync(path.join(root, 'notes.txt'))
  k.stop()
  // The agent rewrites the page between the read and the write.
  const k2 = new VersionKeeper(root, 1e9)
  const racing = { keepThen: (work: () => Promise<void>) => k2.keepThen(async () => (writeFileSync(path.join(root, 'index.html'), PAGE.replace('Başlık', 'Ajan')), work())) }
  await assert.rejects(writeValues(root, EDITS, racing), (e: Error & { reason?: string }) => e.reason === 'changed')
  assert.ok(readFileSync(path.join(root, 'index.html'), 'utf8').includes('Ajan') && !readFileSync(path.join(root, 'index.html'), 'utf8').includes('#00c2ff'))
  await assert.rejects(writeValues(root, [], k2), /nothing to write/)
  k2.stop()
})
