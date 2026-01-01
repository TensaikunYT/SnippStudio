// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// Phase 5a (FAZ5-PLAN.md, tarifler\FAZ5.md 5a): the code film's fences.
// The app's first script in every film page (guard.js) and where it goes;
// the film server's headers (policy, no wildcard CORS, no reading another
// film); the host page's size in CSS pixels; what the editor accepts from a
// film page (clamps) and how many pages live. Each test fails without the
// guard it is about.
import './dom-stub'
import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { FILM_CSP, filmFrameMayGo, FilmRegistry, GUARD_PATH, HOST_PATH, injectGuard, serveFilm } from '../main/codefilm'
import { GUARD_JS, guardMain } from '../main/codefilm-guard'
import { corsHeaders, editorOrigin } from '../main/network'
import { HOST_HTML, pickConfig } from '../main/codefilm-host'
import { clampFilmDuration, clampFilmFps, clampFilmSize, clampMs, clampRecord, FILM_LIMITS, frameFits, IDLE_RELEASE_MS, LIVE_PAGES, pagesToRelease, UNRESPONSIVE_MS, unresponsiveLimit } from '../renderer/src/media/codefilm-limits'

const TAG = '<script src="/__snipp/guard.js"></script>'
const inj = (s: string): string => injectGuard(Buffer.from(s, 'latin1')).toString('latin1')

test('the guard is the first script of a page: before any markup, past only blanks, comments and the doctype', () => {
  assert.equal(inj('<!doctype html><html><head><meta charset="utf-8"><script type="importmap">{}</script></head></html>'), `<!doctype html>${TAG}<html><head><meta charset="utf-8"><script type="importmap">{}</script></head></html>`)
  assert.equal(inj('<HTML lang=tr><HEAD data-x="1">x'), `${TAG}<HTML lang=tr><HEAD data-x="1">x`)
  assert.equal(inj('<!DOCTYPE html><canvas></canvas>'), `<!DOCTYPE html>${TAG}<canvas></canvas>`)
  assert.equal(inj('  \n<!-- made by hand -->\n<!doctype html>\n<html>'), `  \n<!-- made by hand -->\n<!doctype html>\n${TAG}<html>`)
  assert.equal(inj('<canvas></canvas>'), `${TAG}<canvas></canvas>`)
  assert.equal(inj(''), TAG)
  // 5a/5b patch, audit C-5 "pre": a script before <head> comes after the guard.
  assert.equal(inj('<!doctype html><html><script>x()</script><head></head>'), `<!doctype html>${TAG}<html><script>x()</script><head></head>`)
  // Audit C-8: "<head>" in an earlier script string or in a leading comment misleads nothing.
  assert.equal(inj('<html><script>const tpl = "<head>"</script><head></head>'), `${TAG}<html><script>const tpl = "<head>"</script><head></head>`)
  assert.equal(inj('<!-- old: <head> --><html><head></head>'), `<!-- old: <head> -->${TAG}<html><head></head>`)
  // An unclosed comment: the guard before it (it would be inside it after).
  assert.equal(inj('<!-- never closed <html>'), `${TAG}<!-- never closed <html>`)
  // A UTF-8 byte order mark stays first; the page's own bytes are kept (latin1 in, latin1 out).
  const bom = injectGuard(Buffer.from([0xef, 0xbb, 0xbf, 0x3c, 0x70, 0x3e, 0xfe]))
  assert.deepEqual([...bom.subarray(0, 3)], [0xef, 0xbb, 0xbf])
  assert.equal(bom.subarray(3, 3 + TAG.length).toString('latin1'), TAG)
  assert.deepEqual([...bom.subarray(3 + TAG.length)], [0x3c, 0x70, 0x3e, 0xfe])
  // Audit C-8: a UTF-16 page (LE and BE): after its mark, in its own encoding, decoded whole.
  const le = injectGuard(Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from('<!doctype html><p>ğ</p>', 'utf16le')]))
  assert.deepEqual([...le.subarray(0, 2)], [0xff, 0xfe])
  assert.equal(le.subarray(2).toString('utf16le'), `<!doctype html>${TAG}<p>ğ</p>`)
  const be = injectGuard(Buffer.concat([Buffer.from([0xfe, 0xff]), Buffer.from('<p>ğ</p>', 'utf16le').swap16()]))
  assert.deepEqual([...be.subarray(0, 2)], [0xfe, 0xff])
  assert.equal(Buffer.from(be.subarray(2)).swap16().toString('utf16le'), `${TAG}<p>ğ</p>`)
  // guard.js runs the guard on its window.
  assert.match(GUARD_JS, /^\(function/)
  assert.match(GUARD_JS, /\)\(window\);\n$/)
  assert.equal(GUARD_PATH, '__snipp/guard.js')
})
function filmFolder(): { root: string; reg: FilmRegistry; id: string; other: string; done: () => void } {
  const base = mkdtempSync(path.join(tmpdir(), 'snipp-5a-'))
  const root = path.join(base, 'film')
  mkdirSync(path.join(root, 'src'), { recursive: true })
  writeFileSync(path.join(root, 'index.html'), '<!doctype html><html><head><title>t</title></head><body><script src="src/a.js"></script></body></html>')
  writeFileSync(path.join(root, 'src', 'a.js'), 'window.READY = true')
  writeFileSync(path.join(root, 'page.htm'), '<p>second page')
  const root2 = path.join(base, 'film2')
  mkdirSync(root2)
  writeFileSync(path.join(root2, 'index.html'), '<html></html>')
  const reg = new FilmRegistry()
  return { root, reg, id: reg.idFor(root), other: reg.idFor(root2), done: () => rmSync(base, { recursive: true, force: true }) }
}

test('a film page comes with the guard first, its own policy, and no CORS header for anyone', async () => {
  const f = filmFolder()
  try {
    const get = (p: string, headers: Record<string, string> = {}, method = 'GET') => serveFilm(f.reg, new Request(`snippfilm://${f.id}${p}`, { method, headers }))
    const page = await get('/index.html')
    assert.equal(page.status, 200)
    assert.equal(page.headers.get('content-security-policy'), FILM_CSP)
    assert.equal(page.headers.get('access-control-allow-origin'), null)
    const body = await page.text()
    assert.ok(body.startsWith(`<!doctype html>${TAG}<html><head><title>`), body)
    assert.equal(page.headers.get('content-length'), String(Buffer.byteLength(body)))
    // Every HTML page of the folder, ranges ignored (a page is whole).
    const second = await get('/page.htm', { range: 'bytes=0-3' })
    assert.equal(second.status, 200)
    assert.ok((await second.text()).startsWith(TAG))
    assert.equal(second.headers.get('content-security-policy'), FILM_CSP)
    // The root is the index.
    assert.ok((await (await get('/')).text()).includes(TAG))
    // HEAD: the size of the page as served, no body.
    const head = await get('/index.html', {}, 'HEAD')
    assert.equal(head.headers.get('content-length'), String(Buffer.byteLength(body)))
    // Not a page: untouched, no CORS, but the policy all the same (5a/5b
    // patch C-1: a worker started from it, or an .svg opened as a document,
    // takes the policy of its own answer).
    const js = await get('/src/a.js')
    assert.equal(await js.text(), 'window.READY = true')
    assert.equal(js.headers.get('content-security-policy'), FILM_CSP)
    assert.equal(js.headers.get('access-control-allow-origin'), null)
    // The guard itself, and the host page (with the policy).
    const g = await get('/' + GUARD_PATH)
    assert.equal(g.status, 200)
    assert.match(g.headers.get('content-type') ?? '', /javascript/)
    assert.equal(await g.text(), GUARD_JS)
    const host = await get('/' + HOST_PATH)
    assert.equal(host.headers.get('content-security-policy'), FILM_CSP)
    assert.equal(await host.text(), HOST_HTML)
    const opt = await get('/index.html', {}, 'OPTIONS')
    assert.equal(opt.headers.get('access-control-allow-origin'), null)
  } finally {
    f.done()
  }
})

test('the policy keeps a film to its own folder: no media://, no other film, no network', () => {
  const d = Object.fromEntries(FILM_CSP.split(';').map((x) => x.trim().split(/\s+/)).map(([k, ...v]) => [k, v]))
  assert.deepEqual(d['default-src'].filter((s: string) => !s.startsWith("'unsafe") && s !== "'wasm-unsafe-eval'"), ["'self'", 'data:', 'blob:'])
  assert.ok(!/media:|snippfilm:|https?:|\*/.test(FILM_CSP), FILM_CSP)
  assert.deepEqual(d['object-src'], ["'none'"])
  assert.deepEqual(d['form-action'], ["'none'"])
  assert.deepEqual(d['base-uri'], ["'self'"])
})

test('the host page sizes a film by its biggest canvas box (CSS pixels), not its pixel count', () => {
  const doc = (list: { w: number; h: number; bw: number; bh: number }[]) => ({ querySelectorAll: () => list.map((c) => ({ width: c.w, height: c.h, getBoundingClientRect: () => ({ left: 0, top: 0, width: c.bw, height: c.bh }) })) })
  // A spotlight film at 125 %: 1350 × 2400 pixels in a 1080 × 1920 box.
  assert.deepEqual(pickConfig({ document: doc([{ w: 1350, h: 2400, bw: 1080, bh: 1920 }, { w: 1350, h: 2400, bw: 1080, bh: 1920 }]) }), { width: 1080, height: 1920, fps: null, duration: null, transparent: null })
  // The biggest box wins, whatever the pixels say.
  assert.deepEqual(pickConfig({ document: doc([{ w: 4000, h: 4000, bw: 100, bh: 100 }, { w: 640, h: 360, bw: 1280, bh: 720 }]) }), { width: 1280, height: 720, fps: null, duration: null, transparent: null })
  // A box under 64: the default.
  assert.deepEqual(pickConfig({ document: doc([{ w: 1920, h: 1080, bw: 32, bh: 18 }]) }), { width: 1920, height: 1080, fps: null, duration: null, transparent: null })
  // A declared size still comes first.
  assert.deepEqual(pickConfig({ __config: { width: 720, height: 1280 }, document: doc([{ w: 1920, h: 1080, bw: 1920, bh: 1080 }]) }), { width: 720, height: 1280, fps: null, duration: null, transparent: null })
})

// ---- the guard, on a stand-in window ------------------------------------

class FakeMedia {
  private m = false
  plays = 0
  get muted(): boolean {
    return this.m
  }
  set muted(v: boolean) {
    this.m = !!v
  }
  play(): Promise<void> {
    this.plays++
    return Promise.resolve()
  }
  load(): void {}
}
class FakeAC {
  static made: unknown[] = []
  opts: unknown
  constructor(opts?: unknown) {
    this.opts = opts
    FakeAC.made.push(opts)
  }
  setSinkId(_id?: unknown): Promise<void> {
    return Promise.reject(new Error('should not be reached'))
  }
}
function fakeWindow(): any {
  const listeners: Record<string, ((e: any) => void)[]> = {}
  const docListeners: Record<string, ((e: any) => void)[]> = {}
  const observers: ((l: any[]) => void)[] = []
  const errors: unknown[][] = []
  const w: any = {
    devicePixelRatio: 1.25,
    alertShown: 0,
    alert() {
      w.alertShown++
    },
    confirm: () => true,
    prompt: () => 'x',
    print() {
      w.alertShown++
    },
    open: () => ({ opened: true }),
    console: { error: (...a: unknown[]) => errors.push(a) },
    conErrors: errors,
    HTMLMediaElement: FakeMedia,
    Audio: function (this: any) {
      return new FakeMedia()
    },
    AudioContext: FakeAC,
    MutationObserver: class {
      constructor(cb: (l: any[]) => void) {
        observers.push(cb)
      }
      observe(): void {}
    },
    observers,
    addEventListener: (t: string, f: (e: any) => void) => (listeners[t] ??= []).push(f),
    fire: (t: string, e: any) => (listeners[t] ?? []).forEach((f) => f(e)),
    fireDoc: (t: string, e: any) => (docListeners[t] ?? []).forEach((f) => f(e)),
    fetch: (u: unknown) => (String(u).startsWith('media:') ? Promise.reject(new TypeError('Failed to fetch')) : Promise.resolve({ ok: true })),
    HTMLIFrameElement: class {
      win: any
      get contentWindow(): any {
        return this.win
      }
      get contentDocument(): any {
        return this.win ? { defaultView: this.win } : null
      }
    }
  }
  w.document = {
    createElement: (name: string) => (name === 'audio' || name === 'video' ? new FakeMedia() : { nodeType: 1, tagName: name }),
    addEventListener: (t: string, f: (e: any) => void) => (docListeners[t] ??= []).push(f)
  }
  return w
}

test('in a film page: devicePixelRatio 1, no box opens, window.open refused, all written down', () => {
  const w = fakeWindow()
  guardMain(w)
  assert.equal(w.devicePixelRatio, 1)
  assert.equal(w.alert('hello'), undefined)
  assert.equal(w.confirm('sure?'), false)
  assert.equal(w.prompt('name?', 'x'), null)
  w.print()
  assert.equal(w.alertShown, 0, 'no real box was opened')
  assert.equal(w.open('https://example.com'), null)
  assert.deepEqual(w.__snippGuard.dialogs, ['alert: hello', 'confirm: sure?', 'prompt: name?', 'print: '])
  assert.equal(w.__snippGuard.opened, 1)
  // Installed once; the record cannot be replaced, nor written into, by the
  // page (5a/5b patch, audit C-5: it hands out copies).
  guardMain(w)
  w.__snippGuard = null
  assert.ok(w.__snippGuard)
  w.__snippGuard.dialogs.push('FAKE')
  w.__snippGuard.dialogs.length = 0
  assert.deepEqual(w.__snippGuard.dialogs, ['alert: hello', 'confirm: sure?', 'prompt: name?', 'print: '])
  assert.equal(Object.keys(w).includes('__snippGuard'), false)
})

test('in a film page: media elements stay muted however they start', () => {
  const w = fakeWindow()
  guardMain(w)
  // play() mutes first.
  const a = new FakeMedia()
  void a.play()
  assert.equal(a.muted, true)
  assert.equal(a.plays, 1)
  // Unmuting does not unmute.
  a.muted = false
  assert.equal(a.muted, true)
  // new Audio(), document.createElement('audio'): muted from the start.
  assert.equal(new w.Audio('x.wav').muted, true)
  assert.equal(w.document.createElement('video').muted, true)
  assert.equal(w.document.createElement('div').tagName, 'div')
  // A parsed <audio autoplay> (added to the document): muted when it appears.
  const parsed = Object.create(FakeMedia.prototype)
  parsed.nodeType = 1
  for (const cb of w.observers) cb([{ addedNodes: [parsed] }])
  assert.equal(parsed.muted, true)
  // …and when it starts playing by itself.
  const auto = new FakeMedia()
  ;(auto as any).nodeType = 1
  w.fireDoc('play', { target: auto })
  assert.equal(auto.muted, true)
  assert.equal(w.__snippGuard.media, 1)
})

test('in a film page: an AudioContext plays into no device', async () => {
  FakeAC.made = []
  const w = fakeWindow()
  guardMain(w)
  const ctx = new w.AudioContext({ latencyHint: 'interactive' })
  assert.ok(ctx instanceof FakeAC)
  assert.deepEqual(FakeAC.made, [{ latencyHint: 'interactive', sinkId: { type: 'none' } }])
  // The page cannot pick a device again.
  await ctx.setSinkId('')
  assert.equal(w.__snippGuard.audio, 1)
})

test('in a film page: errors, refused addresses and failed loads are written down, bounded', async () => {
  const w = fakeWindow()
  guardMain(w)
  w.console.error('boom', { a: 1 })
  assert.deepEqual(w.conErrors, [['boom', { a: 1 }]], 'the page\'s console still gets it')
  w.fire('error', { message: 'x is not defined', filename: 'snippfilm://id/src/a.js', lineno: 3 })
  w.fire('error', { target: { nodeType: 1, src: 'snippfilm://id/missing.png' } })
  w.fire('unhandledrejection', { reason: new Error('nope') })
  w.fireDoc('securitypolicyviolation', { blockedURI: 'media://local/C:/Users/x.mp4' })
  await w.fetch('media://local/C:/secret.mp4').catch(() => undefined)
  await new Promise((r) => setTimeout(r, 0))
  let g = w.__snippGuard
  // (Audit D8a: the page's own console.error is a fact, marked, and not counted.)
  assert.equal(g.errors[0], 'console.error: boom {"a":1}')
  assert.equal(g.errorCount, 2, 'the uncaught error and the rejection, not the console line')
  assert.equal(g.errors[1], 'x is not defined (snippfilm://id/src/a.js:3)')
  assert.match(g.errors[2], /^unhandled rejection: Error: nope/)
  assert.deepEqual(g.blocked, ['media://local/C:/Users/x.mp4'])
  assert.deepEqual(g.failed, ['snippfilm://id/missing.png', 'media://local/C:/secret.mp4'])
  for (let i = 0; i < 80; i++) w.console.error('x'.repeat(900))
  g = w.__snippGuard
  assert.equal(g.errors.length, 50)
  assert.equal(g.errors[49].length, 500)
})

test('in a film page: a same-origin child frame the page reaches into is guarded too', () => {
  const w = fakeWindow()
  guardMain(w)
  const child = fakeWindow()
  const frame = new w.HTMLIFrameElement()
  frame.win = child
  assert.equal(frame.contentWindow, child)
  assert.ok(child.__snippGuard)
  assert.equal(child.alert('x'), undefined)
  assert.equal(child.alertShown, 0)
  const child2 = fakeWindow()
  frame.win = child2
  void frame.contentDocument
  assert.ok(child2.__snippGuard)
})

// ---- what the editor takes from a film page --------------------------------

test('a film page\'s size, length and fps are clamped before the editor uses them', () => {
  const fb = { width: 1920, height: 1080 }
  assert.deepEqual(clampFilmSize(1e9, 1e9, fb), { width: 7680, height: 7680 })
  assert.deepEqual(clampFilmSize(1, 1, fb), { width: 64, height: 64 })
  assert.deepEqual(clampFilmSize(NaN, 'x', fb), { width: 1920, height: 1080 })
  assert.deepEqual(clampFilmSize(-5, 0, fb), { width: 1920, height: 1080 })
  assert.deepEqual(clampFilmSize(7680, 64, fb), { width: 7680, height: 960 })
  assert.deepEqual(clampFilmSize(100, 7000, fb), { width: 875, height: 7000 })
  assert.deepEqual(clampFilmSize(1080.4, 1920, fb), { width: 1080, height: 1920 })
  assert.equal(clampFilmFps(1000), FILM_LIMITS.maxFps)
  assert.equal(clampFilmFps(0.01), 1)
  assert.equal(clampFilmFps(0), null)
  assert.equal(clampFilmFps(Infinity), null)
  assert.equal(clampFilmDuration(1e12), 6 * 3600)
  assert.equal(clampFilmDuration(-1), null)
  assert.equal(clampFilmDuration('60'), null)
  assert.equal(clampMs(1e12), 600_000)
  assert.equal(clampMs(NaN), 0)
})

test('only the frame asked for, of the size asked for, is taken', () => {
  const isBmp = (x: unknown): x is { width: number; height: number } => !!x && typeof x === 'object' && 'width' in x
  assert.equal(frameFits({ bmp: { width: 1920, height: 1080 } }, { w: 1920, h: 1080 }, isBmp), true)
  assert.equal(frameFits({ bmp: { width: 7680, height: 7680 } }, { w: 1920, h: 1080 }, isBmp), false)
  assert.equal(frameFits({ bmp: 'not a bitmap' }, { w: 1920, h: 1080 }, isBmp), false)
  assert.equal(frameFits({ pixels: new ArrayBuffer(4 * 4 * 2), w: 4, h: 2 }, { w: 4, h: 2 }, isBmp), true)
  assert.equal(frameFits({ pixels: new ArrayBuffer(8), w: 4, h: 2 }, { w: 4, h: 2 }, isBmp), false)
  assert.equal(frameFits({ pixels: new ArrayBuffer(4 * 4 * 2), w: 2, h: 4 }, { w: 4, h: 2 }, isBmp), false)
  assert.equal(frameFits({ pixels: [1, 2, 3], w: 1, h: 1 }, { w: 1, h: 1 }, isBmp), false)
})

test('a film page\'s record is bounded', () => {
  assert.equal(clampRecord(null), null)
  assert.equal(clampRecord('x'), null)
  const r = clampRecord({ errors: Array(80).fill('e'.repeat(900)), blocked: 'not a list', dialogs: [1, 2], media: 1e12, audio: -3, opened: 'x' })!
  assert.equal(r.errors.length, 50)
  assert.equal(r.errors[0].length, 500)
  assert.deepEqual(r.blocked, [])
  assert.deepEqual(r.dialogs, ['1', '2'])
  assert.equal(r.media, 1e6)
  assert.equal(r.audio, 0)
  assert.equal(r.opened, 0)
})

test('at most four film pages live; one unused for 30 s goes; a busy or just-asked one stays', () => {
  assert.equal(LIVE_PAGES, 4)
  assert.equal(IDLE_RELEASE_MS, 30_000)
  assert.equal(UNRESPONSIVE_MS, 10_000)
  const now = 100_000
  const p = (id: string, ago: number, busy = false) => ({ id, lastUsed: now - ago, busy })
  // Idle for more than 30 s: let go; not yet: kept.
  assert.deepEqual(pagesToRelease([p('a', 31_000), p('b', 29_000)], now), ['a'])
  // Busy (an ask in flight): kept even when idle.
  assert.deepEqual(pagesToRelease([p('a', 31_000, true)], now), [])
  // Five live: the least recently used goes.
  assert.deepEqual(pagesToRelease([p('a', 5), p('b', 50), p('c', 10), p('d', 40), p('e', 0)], now), ['b'])
  // The one just asked for is never the one let go.
  assert.deepEqual(pagesToRelease([p('a', 5), p('b', 50), p('c', 10), p('d', 40), p('e', 0)], now, 4, 'b'), ['d'])
  // All busy: none can go (the limit waits).
  assert.deepEqual(pagesToRelease([p('a', 5, true), p('b', 50, true), p('c', 10, true), p('d', 40, true), p('e', 0, true)], now), [])
  // Idle ones count first.
  assert.deepEqual(pagesToRelease([p('a', 40_000), p('b', 50), p('c', 10), p('d', 40), p('e', 0)], now), ['a'])
})

test('a frame inside a film goes only to about:blank or its own film', () => {
  const A = '0123456789abcdef'
  const B = 'fedcba9876543210'
  const known = (id: string) => id === A || id === B
  const editor = 'file:///C:/app/out/renderer/index.html'
  // The editor opens any registered film's host page.
  assert.equal(filmFrameMayGo(`snippfilm://${A}/__snipp/host.html`, editor, editor, known), true)
  assert.equal(filmFrameMayGo(`snippfilm://${B}/__snipp/host.html`, editor, null, known), true)
  // The host page opens its own film.
  assert.equal(filmFrameMayGo(`snippfilm://${A}/index.html?snipp=1`, `snippfilm://${A}/__snipp/host.html`, `snippfilm://${A}/__snipp/host.html`, known), true)
  // A film page's frame never goes to another film, nor does a film page send
  // its host frame (the editor's child) there.
  assert.equal(filmFrameMayGo(`snippfilm://${B}/index.html`, `snippfilm://${A}/index.html?snipp=1`, `snippfilm://${A}/index.html?snipp=1`, known), false)
  assert.equal(filmFrameMayGo(`snippfilm://${B}/index.html`, editor, `snippfilm://${A}/index.html?snipp=1`, known), false)
  // Unregistered or malformed films, other schemes: never.
  assert.equal(filmFrameMayGo('snippfilm://0000000000000000/x.html', editor, editor, known), false)
  assert.equal(filmFrameMayGo('snippfilm://not-hex/x.html', editor, editor, known), false)
  for (const bad of ['https://example.com/', 'about:srcdoc', 'data:text/html,x', `blob:snippfilm://${A}/1234`, 'javascript:alert(1)', 'file:///C:/x.html', 'media://local/C:/a.mp4']) {
    assert.equal(filmFrameMayGo(bad, `snippfilm://${A}/index.html`, null, known), false, bad)
  }
  assert.equal(filmFrameMayGo('about:blank', `snippfilm://${A}/index.html`, null, known), true)
})

test('media:// is readable by the editor\'s origin only, never by any origin', () => {
  assert.equal(corsHeaders(editorOrigin(undefined))['Access-Control-Allow-Origin'], 'file://')
  assert.equal(corsHeaders(editorOrigin('http://localhost:5173'))['Access-Control-Allow-Origin'], 'http://localhost:5173')
  for (const o of [undefined, 'http://localhost:5173']) assert.notEqual(corsHeaders(editorOrigin(o))['Access-Control-Allow-Origin'], '*')
})

test('not responding: 10 s, longer only for a page that showed it holds its thread that long', () => {
  // A page that started at once and draws fast (the hostile loop): 10 s.
  assert.equal(unresponsiveLimit(0, 1), 10_000)
  assert.equal(unresponsiveLimit(2_000, 3_000), 10_000)
  // A big film that held its thread 30 s while building its scenes: 60 s.
  assert.equal(unresponsiveLimit(30_000, 500), 60_000)
  // Its slowest frame 5 s: 15 s.
  assert.equal(unresponsiveLimit(0, 5_000), 15_000)
  // Never past the start's own limit; nonsense counts as nothing.
  assert.equal(unresponsiveLimit(1e9, 1e9), 120_000)
  // Never past the 120 s it says, whatever cap a caller passes (5a/5b patch, audit C-9: 125 s).
  assert.equal(unresponsiveLimit(0, 600_000, 125_000), 120_000)
  assert.equal(unresponsiveLimit(NaN, -5), 10_000)
})

// ---- phase 5f, decisions 2–3: parameters and the project look -------------------
import { valuesQuery } from '../renderer/src/media/codefilm-params'

test('5f: a page\'s parameters are written down as it said them, and the user\'s values put over them', () => {
  const w = fakeWindow()
  w.atob = (s: string) => Buffer.from(s, 'base64').toString('latin1')
  w.TextDecoder = TextDecoder
  w.location = { search: '?snipp=1&' + valuesQuery({ title: 'Merhaba dünya', size: 120, accent: '#ff0000', bad: 'x' }, { accent: '#00ff00', font: 'Inter' }) }
  guardMain(w)
  // (The page has not read the look yet.)
  assert.equal(w.__snippGuard.look, false)
  const list = [
    { key: 'title', label: 'Title', type: 'text', value: 'Hello' },
    { key: 'size', label: 'Size', type: 'number', value: 96, min: 10 },
    { key: 'accent', label: 'Accent', type: 'color', value: '' },
    { key: 'other', label: 'Other', type: 'number', value: 3 }
  ]
  const same = (w.__params = list)
  assert.equal(same, list)
  assert.equal(w.__params, list)
  assert.deepEqual(list.map((x) => x.value), ['Merhaba dünya', 120, '#ff0000', 3])
  // What the page said (its own values) for the Inspector.
  assert.deepEqual((w.__snippGuard.params as { key: string; value: unknown }[]).map((x) => [x.key, x.value]), [['title', 'Hello'], ['size', 96], ['accent', ''], ['other', 3]])
  assert.deepEqual({ ...w.__snippLook }, { accent: '#00ff00', font: 'Inter' })
  assert.equal(w.__snippGuard.look, true)
})

test('5f: a value of the wrong type is not put in; a page without them is not touched', () => {
  const w = fakeWindow()
  w.atob = (s: string) => Buffer.from(s, 'base64').toString('latin1')
  w.TextDecoder = TextDecoder
  w.location = { search: '?snipp=1&' + valuesQuery({ size: 'big', accent: 'red' }, null) }
  guardMain(w)
  const list = [{ key: 'size', type: 'number', value: 5 }, { key: 'accent', type: 'color', value: '#123456' }]
  w.__params = list
  assert.deepEqual(list.map((x) => x.value), [5, '#123456'])
  assert.equal(w.__snippLook, undefined)
  const v = fakeWindow()
  v.location = { search: '?snipp=1' }
  guardMain(v)
  assert.equal(v.__snippGuard.params, null)
  assert.equal(v.__params, undefined)
  v.__params = 7
  assert.equal(v.__params, 7)
  assert.equal(v.__snippGuard.params, null)
})
