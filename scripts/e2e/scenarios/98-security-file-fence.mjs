// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// Security patch, item 4 (B-G3, S5): a script that got into the editor page
// cannot read the user's disk over file:// by itself. The page asks for files
// outside the app's own folder in every way a script could: fetch (also
// no-cors), XMLHttpRequest, a relative and an encoded climb, import(), a
// script tag, a module script tag, an image, a stylesheet, a frame, a worker
// and a shared worker made from a blob that fetch, a service worker. Each is
// refused: by the main process's request filter (page) or by the page's own
// policy, which a blob worker inherits (connect-src names no file: address).
// The app's own page and files still load (the editor is running: that is
// the control). Runs against the packaged program too.
//
// What is left is written down here, not hidden (SECURITY-REVIEW.md, known
// limits): a worker STARTED FROM A .js FILE that already lies on the disk
// (new Worker / SharedWorker of that file, importScripts of it) runs, and a
// worker started so can read files. Chromium asks neither the request filter
// nor a protocol handler for a worker's own requests while the page is served
// from file://; the cure is serving the app from a scheme of its own with the
// GrantFileProtocolExtraPrivileges fuse off. The scenario prints what each of
// these does today, so a change shows.
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
export const name = 'security-file-fence'

const PROBE = (secret, dir, system) => `(async () => {
  const out = {}
  const tell = async (name, work) => { try { out[name] = await work() } catch (e) { out[name] = 'refused: ' + String(e && e.message || e).slice(0, 90) } }
  const SECRET = ${JSON.stringify(secret)}, DIR = ${JSON.stringify(dir)}, SYSTEM = ${JSON.stringify(system)}
  const here = location.href.split('#')[0]
  if (SYSTEM) await tell('fetch a system file', async () => 'READ ' + (await (await fetch(SYSTEM)).text()).length + ' bytes')
  await tell('fetch', async () => 'READ ' + (await (await fetch(SECRET)).text()))
  await tell('fetch no-cors', async () => { const r = await fetch(SECRET, { mode: 'no-cors' }); return 'READ ' + r.type + ' ' + (await r.text()).length })
  await tell('XMLHttpRequest', () => new Promise((res, rej) => { const x = new XMLHttpRequest(); x.open('GET', SECRET); x.onload = () => res('READ ' + x.responseText); x.onerror = () => rej(new Error('xhr error')); x.send() }))
  await tell('a relative climb', async () => 'READ ' + (await (await fetch('../'.repeat(12) + SECRET.replace(/^file:\\/\\/\\/(?:[A-Za-z]:\\/)?/, ''))).text()))
  await tell('an encoded climb', async () => 'READ ' + (await (await fetch(here.replace(/[^/]*$/, '') + '..%5c'.repeat(12) + SECRET.replace(/^file:\\/\\/\\/(?:[A-Za-z]:\\/)?/, '').replace(/\\//g, '%5c'))).text()))
  await tell('import()', async () => 'RAN ' + (await import(DIR + 'kod.js')).x)
  await tell('a script tag', () => new Promise((res, rej) => { const s = document.createElement('script'); s.src = DIR + 'kod-classic.js'; s.onload = () => res('RAN ' + globalThis.__planted); s.onerror = () => rej(new Error('script error')); document.head.appendChild(s) }))
  await tell('a module script tag', () => new Promise((res, rej) => { const s = document.createElement('script'); s.type = 'module'; s.src = DIR + 'kod.js?m'; s.onload = () => res('RAN'); s.onerror = () => rej(new Error('script error')); document.head.appendChild(s) }))
  await tell('an image', () => new Promise((res, rej) => { const i = new Image(); i.onload = () => res('READ ' + i.naturalWidth + ' px'); i.onerror = () => rej(new Error('image error')); i.src = DIR + 'dot.png' }))
  await tell('a stylesheet', () => new Promise((res, rej) => { const l = document.createElement('link'); l.rel = 'stylesheet'; l.href = DIR + 'style.css'; l.onload = () => res('READ a stylesheet'); l.onerror = () => rej(new Error('stylesheet error')); document.head.appendChild(l) }))
  await tell('a frame', () => new Promise((res) => { const f = document.createElement('iframe'); f.src = SECRET; f.style.display = 'none'; document.body.appendChild(f); setTimeout(() => { let t = ''; try { t = f.contentDocument?.body?.innerText ?? '' } catch { t = '' } f.remove(); res(t.includes('GIZLI') ? 'READ ' + t : 'refused: the frame holds nothing') }, 700) }))
  const inWorker = (body) => new Promise((res) => { let w; try { w = new Worker(URL.createObjectURL(new Blob([body], { type: 'text/javascript' }))) } catch (e) { return res('refused: no worker: ' + e.message) } const t = setTimeout(() => { w.terminate(); res('refused: no answer') }, 4000); w.onmessage = (m) => { clearTimeout(t); w.terminate(); res(m.data) }; w.onerror = (e) => { clearTimeout(t); res('refused: worker error ' + (e.message || '')) } })
  out['a blob worker: fetch'] = await inWorker('fetch(' + JSON.stringify(SECRET) + ').then((r) => r.text()).then((t) => postMessage("READ " + t), (e) => postMessage("refused: " + e.message))')
  out['a blob worker: XMLHttpRequest'] = await inWorker('try { const x = new XMLHttpRequest(); x.open("GET", ' + JSON.stringify(SECRET) + ', false); x.send(); postMessage("READ " + x.responseText) } catch (e) { postMessage("refused: " + String(e.message).slice(0, 60)) }')
  out['known limit: a blob worker starts a worker from a local .js'] = await inWorker('try { const w = new Worker(' + JSON.stringify(DIR + 'kod-worker.js') + '); w.onmessage = (m) => postMessage(m.data); w.onerror = () => postMessage("refused: worker error"); setTimeout(() => postMessage("refused: no answer"), 2500) } catch (e) { postMessage("refused: " + String(e.message).slice(0, 60)) }')
  out['known limit: a blob worker importScripts a local .js'] = await inWorker('try { importScripts(' + JSON.stringify(DIR + 'kod-classic.js') + '); postMessage("RAN " + self.__planted) } catch (e) { postMessage("refused: " + String(e.message).slice(0, 60)) }')
  const fromFile = (opts) => new Promise((res) => { try { const w = new Worker(DIR + (opts ? 'kod-worker.mjs' : 'kod-worker.js'), opts); const t = setTimeout(() => res('refused: no answer'), 2500); w.onerror = () => { clearTimeout(t); res('refused: worker error') }; w.onmessage = () => { clearTimeout(t); res('RAN') } } catch (e) { res('refused: ' + e.message) } })
  out['known limit: a worker started from a local .js'] = await fromFile()
  out['known limit: a module worker started from a local .js'] = await fromFile({ type: 'module' })
  const shared = (url) => new Promise((res) => { try { const w = new SharedWorker(url); const t = setTimeout(() => res('refused: no answer'), 2500); w.onerror = () => { clearTimeout(t); res('refused: shared worker error') }; w.port.onmessage = (m) => { clearTimeout(t); res(m.data) }; w.port.start() } catch (e) { res('refused: ' + e.message) } })
  out['known limit: a shared worker started from a local .js'] = await shared(DIR + 'kod-shared.js')
  out['a blob shared worker: fetch'] = await shared(URL.createObjectURL(new Blob(['onconnect = (e) => { const p = e.ports[0]; fetch(' + JSON.stringify(SECRET) + ').then((r) => r.text()).then((t) => p.postMessage("READ " + t), (x) => p.postMessage("refused: " + x.message)) }'], { type: 'text/javascript' })))
  await tell('a service worker', async () => { const r = await navigator.serviceWorker.register(DIR + 'sw.js'); const s = 'REGISTERED ' + r.scope; await r.unregister(); return s })
  await tell('a service worker for the app\\'s folder', async () => { const r = await navigator.serviceWorker.register(DIR + 'sw.js', { scope: './' }); const s = 'REGISTERED ' + r.scope; await r.unregister(); return s })
  return JSON.stringify(out)
})()`

export async function run({ c, lib, work }) {
  const { assert } = lib
  const dir = join(work, 'secret')
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'GIZLI.txt'), 'GIZLI-ICERIK-1234')
  writeFileSync(join(dir, 'kod.js'), 'globalThis.__planted = "MODULE"; export const x = "MODULE"\n')
  writeFileSync(join(dir, 'kod-classic.js'), 'self.__planted = "CLASSIC"\n')
  // (Run as a worker it says so, and says whether it could read the file beside it.)
  writeFileSync(join(dir, 'kod-worker.js'), 'fetch(new URL("GIZLI.txt", location.href)).then((r) => r.text()).then((t) => postMessage("RAN and READ " + t), (e) => postMessage("RAN, its fetch refused: " + e.message))\n')
  writeFileSync(join(dir, 'kod-worker.mjs'), 'postMessage("RAN")\n')
  writeFileSync(join(dir, 'kod-shared.js'), 'onconnect = (e) => e.ports[0].postMessage("RAN")\n')
  writeFileSync(join(dir, 'sw.js'), 'self.addEventListener("fetch", () => {})\n')
  writeFileSync(join(dir, 'style.css'), 'body { outline: 0 }\n')
  // (A 1 × 1 PNG.)
  writeFileSync(join(dir, 'dot.png'), Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64'))
  const system = process.platform === 'win32' && existsSync('C:/Windows/win.ini') ? 'file:///C:/Windows/win.ini' : null

  // The control: the editor itself came from the app's own files and runs.
  assert.equal(await c.ev(`location.protocol`), 'file:')
  assert.ok(await c.ev(`!!window.__store && document.querySelectorAll('script[src]').length > 0`))

  const got = JSON.parse(await c.ev(PROBE(pathToFileURL(join(dir, 'GIZLI.txt')).href, pathToFileURL(dir).href + '/', system)))
  if (process.env.SNIPP_E2E_VERBOSE) for (const [way, result] of Object.entries(got)) console.log(`     ${way.padEnd(52)} ${String(result).slice(0, 90)}`)
  const known = Object.keys(got).filter((k) => k.startsWith('known limit'))
  for (const [way, result] of Object.entries(got)) {
    if (known.includes(way)) continue
    assert.ok(String(result).startsWith('refused'), `${way}: ${result}`)
  }
  const refused = Object.keys(got).length - known.length
  assert.ok(refused >= 17, `${refused} ways tried`)
  console.log(`     ${refused} ways to read a local file from the editor page refused`)
  for (const k of known) console.log(`     ${k}: ${String(got[k]).slice(0, 60)}`)
  // The planted scripts did not run in the page.
  assert.equal(await c.ev(`typeof globalThis.__planted`), 'undefined')
}
