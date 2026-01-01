// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// 5a/5b patch, item 1 (audit C-1 + C-2, haritalar\_faz5-denetim-citler.md): a
// code film reads neither the user's media (media://) nor another film's
// folder, from ANY context it can make: its page, an .svg of its folder opened
// in a frame, a worker started from a file of its folder, a blank child frame,
// `import()`, fetch in both modes, <img>, <video>, CSS url(). The main process
// decides per request (main/film-fence.ts), so nothing reaches the media
// handler and the refusals are in the film's "blocked" list. Every answer of a
// film's folder carries the content security policy; a project file kept in
// the film's folder is not served to it; one film's localStorage is not
// another's. The editor's own reading of media:// keeps working.
// The window is muted for the whole scenario (the page tries no sound, but a
// stray one is never heard on this PC).
import { cpSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { createSocket } from 'node:dgram'
import { freePort } from '../app.mjs'
export const name = 'code-clip-fence'
export const timeoutMs = 180_000

// (5c + 5d audit patch, Y1.) A film page that opens a WebRTC connection to a
// STUN / TURN address of its choosing (an IP: no DNS): its first run is in
// the editor's frame (passing through), then, as it shows text, in a drawing
// window of its own. Each context aims at its own UDP port on this machine;
// the TURN user name is data leaving the page. Nothing may arrive.
// (Y2.) A whole page (shown in a drawing window) that counts the keys of its
// IndexedDB store, then adds one.
const IDB = `<!doctype html><html><head><meta charset="utf-8"></head><body style="margin:0"><h1 style="color:#fff">idb</h1><script>
const CTX = (() => { try { return parent.__snippGive ? 'win' : 'ed' } catch (e) { return 'x' } })()
const q = indexedDB.open('keep')
q.onupgradeneeded = () => q.result.createObjectStore('s')
q.onsuccess = () => {
  const db = q.result
  const r = db.transaction('s').objectStore('s').count()
  r.onsuccess = () => {
    const n = r.result
    const tx = db.transaction('s', 'readwrite')
    tx.objectStore('s').put(new Uint8Array(1024), 'k' + Date.now())
    tx.oncomplete = () => console.error('Z idb-' + CTX + ': ' + n)
  }
}
</script></body></html>`

const RTC = (edPort, winPort) => `<!doctype html><html><head><meta charset="utf-8"></head><body style="margin:0"><h1 style="color:#fff">rtc</h1><script>
const CTX = (() => { try { return parent.__snippGive ? 'win' : 'ed' } catch (e) { return 'x' } })()
const port = CTX === 'win' ? ${winPort} : ${edPort}
const say = (k, v) => console.error('Z ' + k + ': ' + v)
try {
  const pc = new RTCPeerConnection({ iceServers: [{ urls: 'stun:127.0.0.1:' + port }, { urls: 'turn:127.0.0.1:' + port + '?transport=udp', username: 'SECRET-FROM-' + CTX, credential: 'x' }] })
  pc.createDataChannel('x')
  pc.createOffer().then((o) => pc.setLocalDescription(o)).then(() => say('rtc-' + CTX, 'offer set'), (e) => say('rtc-' + CTX, String(e)))
} catch (e) { say('rtc-' + CTX, 'error ' + e) }
</script></body></html>`

// Each probe answers 'refused' (not read) or 'READ <n>' / 'loaded …'.
const PROBES = `
async function probes(W, T, dom) {
  const R = {}
  const tryIt = async (k, f) => { try { R[k] = await f() } catch (e) { R[k] = 'refused' } }
  await tryIt('mediaCors', async () => { const r = await W.fetch(T.media); return r.ok ? 'READ ' + (await r.arrayBuffer()).byteLength : 'refused ' + r.status })
  await tryIt('mediaNoCors', async () => { const r = await W.fetch(T.media, { mode: 'no-cors' }); return r.type === 'opaque' ? 'opaque' : 'READ ' + (await r.arrayBuffer()).byteLength })
  await tryIt('filmCors', async () => { const r = await W.fetch(T.otherFilm + 'index.html'); return r.ok ? 'READ ' + (await r.text()).length : 'refused ' + r.status })
  await tryIt('filmNoCors', async () => { const r = await W.fetch(T.otherFilm + 'index.html', { mode: 'no-cors' }); return r.type === 'opaque' ? 'opaque' : 'READ ' + (await r.text()).length })
  await tryIt('import', async () => 'READ ' + (await import(T.otherFilm + 'm.js')).secret)
  await tryIt('project', async () => { const r = await W.fetch(T.project); return r.ok ? 'READ ' + (await r.text()).length : 'refused ' + r.status })
  if (dom) {
    const D = dom
    const el = (tag) => D.createElementNS('http://www.w3.org/1999/xhtml', tag)
    R.img = await new Promise((res) => { const i = el('img'); i.onload = () => res('loaded ' + i.naturalWidth); i.onerror = () => res('refused'); i.src = T.image; setTimeout(() => res('refused (timeout)'), 4000) })
    R.video = await new Promise((res) => { const v = el('video'); v.muted = true; v.onloadedmetadata = () => res('loaded ' + v.videoWidth); v.onerror = () => res('refused'); v.src = T.media; setTimeout(() => res('refused (timeout)'), 4000) })
    R.cssUrl = await new Promise((res) => { const d = el('div'); d.style.cssText = 'width:4px;height:4px;background-image:url("' + T.image + '")'; (D.body || D.documentElement).appendChild(d); setTimeout(() => res('asked'), 800) })
  }
  return R
}`

const PAGE = `<!doctype html>
<html><head><meta charset="utf-8"></head><body style="margin:0;background:#000">
<canvas id="c" width="320" height="180"></canvas>
<script>
const say = (k, v) => console.error('Z ' + k + ': ' + (typeof v === 'string' ? v : JSON.stringify(v)))
const g = document.getElementById('c').getContext('2d')
window.__config = { width: 320, height: 180, fps: 30, duration: 10 }
window.renderOut = (t) => { g.fillStyle = '#246'; g.fillRect(0, 0, 320, 180) }
window.renderOut(0)
window.READY = true
${PROBES}
const WSRC = ${JSON.stringify(PROBES + '\nonmessage = async (e) => postMessage(await probes(self, e.data, null))')}
;(async () => {
  const T = await (await fetch('targets.json')).json()
  localStorage.setItem('snipp-secret', 'film A')
  say('page', await probes(window, T, document))
  // A blank child frame: its own realm, the page's origin.
  const f = document.createElement('iframe'); document.body.appendChild(f)
  say('blank', await probes(window[0], T, window[0].document))
  // A worker started from a file of the folder (its own answer, its own policy).
  const work = (src, k) => new Promise((res) => { let w; try { w = new Worker(src) } catch (e) { return res('error ' + e) } w.onmessage = (e) => res(e.data); w.onerror = (e) => res('error ' + (e.message || 'not started')); w.postMessage(T); setTimeout(() => res('timeout'), 8000) })
  say('worker', await work('w.js'))
  // Workers of the page's own making (blob:, data:): their requests never pass the main process's filter.
  say('blobWorker', await work(URL.createObjectURL(new Blob([WSRC], { type: 'text/javascript' }))))
  say('dataWorker', await work('data:text/javascript,' + encodeURIComponent(WSRC)))
  // An .svg of the folder in a frame: a document of its own.
  say('svg', await new Promise((res) => { addEventListener('message', (e) => { if (e.data && e.data.svg) res(e.data.svg) }); const s = document.createElement('iframe'); s.src = 'x.svg'; document.body.appendChild(s); setTimeout(() => res('timeout'), 15000) }))
  // Every answer of the folder carries the policy.
  const csp = {}
  for (const p of ['nope.txt', '/__snipp/guard.js', 'x.svg', 'w.js', 'index.html', 'targets.json']) { const r = await fetch(p); csp[p] = r.status + ' ' + (r.headers.get('content-security-policy') ? 'csp' : 'NONE') }
  say('csp', csp)
  say('done', 'yes')
})()
</script></body></html>`

const SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><script><![CDATA[
${PROBES}
;(async () => {
  let T = {}
  try { T = await (await fetch('targets.json')).json() } catch (e) {}
  const R = await probes(window, T, document)
  parent.postMessage({ svg: R }, '*')
})()
]]></script></svg>`

const WORKER = `${PROBES}
onmessage = async (e) => postMessage(await probes(self, e.data, null))`

const PEEK = `<!doctype html><html><head><meta charset="utf-8"></head><body style="margin:0;background:#000">
<canvas id="c" width="320" height="180"></canvas><script>
const g = document.getElementById('c').getContext('2d')
window.__config = { width: 320, height: 180, fps: 30, duration: 10 }
window.renderOut = (t) => { g.fillStyle = '#642'; g.fillRect(0, 0, 320, 180) }
window.renderOut(0); window.READY = true
console.error('Z peek: ' + JSON.stringify(localStorage.getItem('snipp-secret')))
console.error('Z done: yes')
</script></body></html>`

async function bootFilm(c, folder) {
  return c.run(async (folder) => {
    const S = window.__store
    const [films, imp] = await window.__codeFilm()
    const info = await window.api.codeFilm.register(folder)
    const a0 = (await imp.codeFilmImport(info)).assets.find((a) => a.kind === 'code')
    const [a] = S.getState().addAssets([a0])
    films.codeFilms.ensure(a)
    const t0 = performance.now()
    for (;;) {
      const st = films.codeFilms.status(a.id)
      if (st && st.state !== 'booting') return { id: a.id, url: a.url, state: st.state, error: st.error ?? null, steps: (await films.codeFilms.bootTrace(a.id))?.steps ?? [] }
      if (performance.now() - t0 > 30000) return { id: a.id, url: a.url, state: 'booting', trace: await films.codeFilms.bootTrace(a.id) }
      await new Promise((r) => setTimeout(r, 50))
    }
  }, folder)
}
const probe = (c, q) => c.run((q) => window.api.testFilmProbe(q), q)
const diag = (c, id) => c.run(async (id) => { const [films] = await window.__codeFilm(); // (Audit D8a: the page's own console.error lines come marked as facts; these pages report by them.)
    const r = await films.codeFilms.diag(id); return r && { ...r, errors: r.errors.map((e) => e.replace(/^console\.error: /, '')) } }, id)
const said = (rec) => Object.fromEntries(rec.errors.filter((e) => e.startsWith('Z ')).map((e) => { const [k, ...v] = e.slice(2).split(': '); const s = v.join(': '); try { return [k, JSON.parse(s)] } catch { return [k, s] } }))

export async function run({ c, media, lib, work }) {
  const { assert } = lib
  await probe(c, { kind: 'mute', on: true })
  try {
    const other = join(work, 'other')
    const peek = join(work, 'peek')
    mkdirSync(peek, { recursive: true })
    cpSync(media.film, other, { recursive: true })
    writeFileSync(join(other, 'm.js'), "export const secret = 'OTHER FILM'\n")
    const reg = await c.run(async (talk, img, other) => ({ media: (await window.api.testRegisterMedia(talk)).url, image: (await window.api.testRegisterMedia(img)).url, other: (await window.api.codeFilm.register(other)).url }), media.talk, media.broll[0], other)
    writeFileSync(join(peek, 'index.html'), PEEK)
    const otherId = /^snippfilm:\/\/([a-f0-9]{16})\//.exec(reg.other)[1]

    // Twice: as the product serves films (with their policy), then without
    // the policy (a test-only switch), where the main process's fence stands
    // alone and must refuse everything itself.
    let film = null
    let refusedInMain = 0
    let blockedN = 0
    for (const policy of [true, false]) {
      assert.equal((await probe(c, { kind: 'film-policy', on: policy })).policy, policy)
      const dir = join(work, policy ? 'fence' : 'fence-nopolicy')
      mkdirSync(join(dir, 'snipp'), { recursive: true })
      writeFileSync(join(dir, 'index.html'), PAGE)
      writeFileSync(join(dir, 'x.svg'), SVG)
      writeFileSync(join(dir, 'w.js'), WORKER)
      // The project VideoHub's "open in Snipp" keeps in the film's folder.
      writeFileSync(join(dir, 'snipp', 'fence.snipp'), JSON.stringify({ version: 1, assets: [{ path: media.talk }] }))
      writeFileSync(join(dir, 'side.autocut'), '{}')
      writeFileSync(join(dir, 'targets.json'), JSON.stringify({ media: reg.media, image: reg.image, otherFilm: reg.other, project: 'snipp/fence.snipp' }))
      const since = Date.now()
      film = await bootFilm(c, dir)
      if (film.state !== 'ready') {
        // What the main process saw of this film's requests (the filter's
        // answers, the handler's): names where a start that hangs stopped.
        const fid = /^snippfilm:\/\/([a-f0-9]{16})\//.exec(film.url)?.[1] ?? '?'
        film.web = (await probe(c, { kind: 'web', since })).filter((r) => r.url.includes(fid)).slice(0, 12)
        film.served = (await probe(c, { kind: 'requests', since })).filter((r) => r.url.includes(fid)).slice(0, 12).map((r) => ({ url: r.url, admitted: r.admitted }))
      }
      assert.equal(film.state, 'ready', JSON.stringify(film))
      console.log(`     start (policy ${policy ? 'on' : 'off'}): ${film.steps.join(', ')}`)
      const rec = await c.waitFor('the hostile page done', async () => { const r = await diag(c, film.id); return r && r.errors.includes('Z done: yes') ? r : null }, 60000, 250)
      const z = said(rec)
      console.log(`     fence (policy ${policy ? 'on' : 'off'}):`, JSON.stringify(z))
      for (const ctx of ['page', 'blank', 'worker', 'blobWorker', 'dataWorker', 'svg']) {
        const r = z[ctx]
        // A worker refused at its start reads nothing either.
        if (ctx.endsWith('orker') && typeof r === 'string' && r.startsWith('error')) continue
        assert.equal(typeof r, 'object', `${ctx} answered: ${JSON.stringify(r)}`)
        for (const k of ['mediaCors', 'filmCors', 'import']) assert.match(r[k], /^refused/, `${ctx}.${k}: ${r[k]}`)
        // (An opaque answer hides whether it was served: the handlers' log below says.)
        for (const k of ['mediaNoCors', 'filmNoCors']) assert.match(r[k], /^(refused|opaque)/, `${ctx}.${k}: ${r[k]}`)
        assert.match(r.project, /^refused/, `${ctx}.project: ${r.project}`)
        if (!ctx.endsWith('orker')) {
          assert.match(r.img, /^refused/, `${ctx}.img: ${r.img}`)
          assert.match(r.video, /^refused/, `${ctx}.video: ${r.video}`)
        }
      }
      if (policy) for (const [p, v] of Object.entries(z.csp)) assert.match(v, / csp$/, `the answer for ${p} carries the policy: ${v}`)
      // Nothing of the user's media or of the other film reached a handler.
      const seen = await probe(c, { kind: 'requests', since })
      assert.deepEqual(seen.filter((r) => r.scheme === 'media' && r.admitted).map((r) => r.url), [], 'no media:// request of the film was served')
      assert.deepEqual(seen.filter((r) => r.url.includes(otherId) && r.admitted).map((r) => r.url), [], 'no request for the other film was served')
      const web = await probe(c, { kind: 'web', since })
      assert.ok(!web.some((r) => (r.url.startsWith('media:') || r.url.includes(otherId)) && r.allowed && r.film), 'no request of a film for media:// or another film was let through')
      if (!policy) {
        // The main process refused them itself, and says so in the film's list.
        refusedInMain = web.filter((r) => (r.url.startsWith('media:') || r.url.includes(otherId)) && !r.allowed).length
        assert.ok(web.some((r) => r.url.startsWith('media:') && !r.allowed), JSON.stringify(web.slice(-10)))
        assert.ok(web.some((r) => r.url.includes(otherId) && !r.allowed), JSON.stringify(web.slice(-10)))
        assert.ok(rec.blocked.some((b) => b.startsWith('media:')), `the film's blocked list names the media address: ${JSON.stringify(rec.blocked)}`)
        blockedN = rec.blocked.length
      }
    }
    await probe(c, { kind: 'film-policy', on: true })
    // Another film does not see this one's localStorage. Its host page is
    // refused once on the way (a test-only switch): a frame that "loaded"
    // without the host page says no hello, is made again and starts all
    // the same (phase 5d.1 step 0; before, such a film stayed "booting" for
    // two minutes and then failed).
    assert.deepEqual(await probe(c, { kind: 'fail-host', n: 1 }), { n: 1 })
    const pk = await bootFilm(c, peek)
    assert.equal(pk.state, 'ready', JSON.stringify(pk))
    console.log(`     start (host page refused once): ${pk.steps.join(', ')}`)
    assert.ok(pk.steps.some((s) => /no hello in \d+ ms: the frame is made again \(1\)/.test(s)), `the frame was not made again: ${pk.steps.join(', ')}`)
    assert.deepEqual(await probe(c, { kind: 'fail-host', n: 0 }), { n: 0 })
    const prec = await c.waitFor('the peeking page done', async () => { const r = await diag(c, pk.id); return r && r.errors.includes('Z done: yes') ? r : null }, 20000, 250)
    assert.equal(said(prec).peek, null, 'one film reads nothing of another film\'s localStorage')

    // The editor still reads the user's media itself, and the films' frames.
    const ed = await c.run(async (u, id) => {
      const r = await fetch(u)
      const bytes = (await r.arrayBuffer()).byteLength
      const [films] = await window.__codeFilm()
      const a = window.__store.getState().project.assets.find((x) => x.id === id)
      const b = await films.codeFilms.exactFrame(a, 1)
      const o = new OffscreenCanvas(b.width, b.height).getContext('2d')
      o.drawImage(b, 0, 0)
      const px = [...o.getImageData(5, 5, 1, 1).data]
      b.close()
      return { status: r.status, bytes, px }
    }, reg.media, film.id)
    assert.ok(ed.bytes > 100000, JSON.stringify(ed))
    assert.deepEqual(ed.px, [0x22, 0x44, 0x66, 255])
    console.log(`     fence: ${refusedInMain} requests refused in main (policy off), blocked list ${blockedN}, editor read ${ed.bytes} bytes`)

    // (Y2) What a whole page (its drawing window) stored is let go with its
    // last window: opened again, the film finds nothing stored.
    const idbDir = join(work, 'idb')
    mkdirSync(idbDir, { recursive: true })
    writeFileSync(join(idbDir, 'index.html'), IDB)
    const kept = []
    for (let round = 0; round < 2; round++) {
      const f = await bootFilm(c, idbDir)
      assert.equal(f.state, 'ready', JSON.stringify(f))
      const r = await c.waitFor('the page read its store', async () => { const d = await diag(c, f.id); return d && d.errors.some((e) => e.startsWith('Z idb-win')) ? d : null }, 20000, 250)
      kept.push(said(r)['idb-win'])
      await c.run((id) => window.__store.getState().deleteAsset(id), f.id)
      await new Promise((res) => setTimeout(res, 2500))
    }
    console.log(`     stored keys a drawing window finds: first opening ${kept[0]}, after its film went and came back ${kept[1]}`)
    assert.deepEqual(kept, [0, 0], 'a film opened again finds nothing stored by its last window')

    // WebRTC (Y1): no UDP packet leaves a film page, from the editor's frame
    // or from its drawing window.
    const hits = { ed: 0, win: 0 }
    const socks = []
    const listen = async (tag) => {
      const p = await freePort()
      const s = createSocket('udp4')
      s.on('message', () => hits[tag]++)
      await new Promise((r) => s.bind(p, '127.0.0.1', r))
      socks.push(s)
      return p
    }
    try {
      const edPort = await listen('ed')
      const winPort = await listen('win')
      const rtcDir = join(work, 'rtc')
      mkdirSync(rtcDir, { recursive: true })
      writeFileSync(join(rtcDir, 'index.html'), RTC(edPort, winPort))
      const rtc = await bootFilm(c, rtcDir)
      assert.equal(rtc.state, 'ready', JSON.stringify(rtc))
      const mode = await c.run(async (id) => { const [films] = await window.__codeFilm(); return films.codeFilms.status(id)?.mode }, rtc.id)
      assert.equal(mode, 'page', 'the page went on to its drawing window')
      const rrec = await c.waitFor('the window page made its offer', async () => { const r = await diag(c, rtc.id); return r && r.errors.some((e) => e.startsWith('Z rtc-win')) ? r : null }, 20000, 250)
      // (Candidates are gathered for a few seconds; frames asked meanwhile.)
      for (let i = 0; i < 8; i++) {
        await c.run(async (id, t) => { const [films] = await window.__codeFilm(); const a = window.__store.getState().project.assets.find((x) => x.id === id); try { (await films.codeFilms.exactFrame(a, t, undefined, 160)).close() } catch {} }, rtc.id, i * 0.5)
        await new Promise((r) => setTimeout(r, 500))
      }
      console.log(`     WebRTC: UDP packets from the editor's frame ${hits.ed}, from the drawing window ${hits.win} (${said(rrec)['rtc-win']})`)
      assert.deepEqual(hits, { ed: 0, win: 0 }, 'no UDP packet left a film page')
    } finally {
      for (const s of socks) s.close()
    }
  } finally {
    await probe(c, { kind: 'film-policy', on: true })
    await probe(c, { kind: 'fail-host', n: 0 })
    await probe(c, { kind: 'mute', on: false })
  }
}
