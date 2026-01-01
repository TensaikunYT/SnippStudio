// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// The host page of a code film (CODE-FILM-CLIP-PLAN.md, D1/D2).
//
// Served as snippfilm://<id>/__snipp/host.html and opened by the editor in a
// cross-origin iframe. It opens the film's own index.html in a nested iframe
// of the SAME origin, so it can do what VideoHub's live preview does
// (VideoHub ui/review/live.js): wait for window.READY, read the film's size,
// call PREP(T) and renderOut(T), and copy the film's canvases. Only this page
// talks to the editor, over a MessagePort the editor hands it.
//
// The page's script is made from the functions below with toString(): they
// must stay self-contained (no imports, no outside names but each other).

import { PRODUCT_NAME } from '../shared/product'

/** The film's size, fps and length, in VideoHub's order: its __config (or
 *  VH_CONFIG), its DATA size, its biggest canvas, else 1920 × 1080. And its
 *  `transparent` (phase 5b, decision 1): true or false when the page says so,
 *  else null (the page's own background decides, see filmGround). */
export function pickConfig(win: any): { width: number; height: number; fps: number | null; duration: number | null; transparent: boolean | null } {
  let c: any = null
  try {
    c = win.__config || win.VH_CONFIG || null
    if (!c && win.DATA && +win.DATA.width > 0 && +win.DATA.height > 0) c = { width: +win.DATA.width, height: +win.DATA.height }
  } catch {
    c = null
  }
  let width = c ? +(c.outWidth || c.width) || 0 : 0
  let height = c ? +(c.outHeight || c.height) || 0 : 0
  if (!(width > 0 && height > 0)) {
    width = 0
    height = 0
    try {
      // The biggest canvas's box in CSS pixels (phase 5a, decision 4), not
      // its pixel count: a page that sizes its canvases by devicePixelRatio
      // is framed the same on every display.
      const boxes = Array.prototype.slice.call(win.document.querySelectorAll('canvas')).map((cv: any) => {
        const r = cv.getBoundingClientRect()
        return { width: r.width, height: r.height }
      }) as { width: number; height: number }[]
      boxes.sort((a, b) => b.width * b.height - a.width * a.height)
      const cv = boxes[0]
      if (cv && cv.width >= 64 && cv.height >= 64) {
        width = cv.width
        height = cv.height
      }
    } catch {
      /* no document yet */
    }
  }
  if (!(width > 0 && height > 0)) {
    width = 1920
    height = 1080
  }
  const fps = c && +c.fps > 0 ? +c.fps : null
  const duration = c && +c.duration > 0 ? +c.duration : null
  const transparent = c && typeof c.transparent === 'boolean' ? c.transparent : null
  return { width: Math.round(width), height: Math.round(height), fps, duration, transparent }
}

/** The ground a film frame is laid on (phase 5b, decision 1): the computed
 *  background colour of the film's `html`, or of its `body` when the `html`
 *  one is transparent (CSS lets the body's background stand for the page's
 *  then). '' when both are transparent or cannot be read. Only the colour:
 *  a background image is not part of the frame (the frame is the canvases). */
export function filmGround(doc: any): string {
  try {
    const view = doc.defaultView
    // (Any colour of alpha 0: rgba(r, g, b, 0), or the slash forms of the
    // newer colour functions.)
    const clear = (c: string): boolean => !c || c === 'transparent' || /^rgba\([^)]*,\s*0(\.0*)?\s*\)$/.test(c) || /\/\s*0(\.0*)?%?\s*\)$/.test(c)
    const of = (el: any): string => (el && view ? String(view.getComputedStyle(el).backgroundColor || '') : '')
    const html = of(doc.documentElement)
    if (!clear(html)) return html
    const body = of(doc.body)
    return clear(body) ? '' : body
  } catch {
    return ''
  }
}

/** The canvases that make the film's picture, in document order: laid out,
 *  not display:none or visibility:hidden, not empty. */
export function visibleCanvases(doc: any): any[] {
  const out: any[] = []
  const view = doc.defaultView
  for (const cv of Array.prototype.slice.call(doc.querySelectorAll('canvas'))) {
    if (!(cv.width > 0 && cv.height > 0)) continue
    const r = cv.getBoundingClientRect()
    if (!(r.width > 0 && r.height > 0)) continue
    const st = view ? view.getComputedStyle(cv) : null
    if (st && (st.display === 'none' || st.visibility === 'hidden')) continue
    out.push(cv)
  }
  return out
}

/** Something the page shows outside its canvases (phase 5c, decision 3):
 *  visible text, an img / svg / video (and the like), or a painted box (a
 *  background, a border, a shadow) of any element but html and body (their
 *  colour is the ground). '' when the picture is canvases only. Then the
 *  page can be played on the app's clock by copying its canvases (tier 2);
 *  otherwise it needs the whole page drawn (tier 3, phase 5d). */
export function pageContent(doc: any): string {
  try {
    const view = doc.defaultView
    const VW = view.innerWidth
    const VH = view.innerHeight
    const clear = (c: string): boolean => !c || c === 'transparent' || /^rgba\([^)]*,\s*0(\.0*)?\s*\)$/.test(c) || /\/\s*0(\.0*)?%?\s*\)$/.test(c)
    const shown = (el: any): boolean => {
      const r = el.getBoundingClientRect()
      return r.width > 0 && r.height > 0 && r.right > 0 && r.bottom > 0 && r.left < VW && r.top < VH
    }
    const words = (el: any, st: any): string => {
      if (clear(st.color) || !(parseFloat(st.fontSize) > 0)) return ''
      for (const n of Array.prototype.slice.call(el.childNodes)) if (n.nodeType === 3 && /\S/.test(n.nodeValue || '')) return 'text "' + String(n.nodeValue).trim().slice(0, 40) + '"'
      return ''
    }
    const body = doc.body
    if (!body) return ''
    const bst = view.getComputedStyle(body)
    if (bst.visibility === 'visible') {
      const w = words(body, bst)
      if (w) return w
    }
    for (const el of Array.prototype.slice.call(body.querySelectorAll('*'))) {
      const tag = String(el.tagName).toLowerCase()
      if (/^(script|style|head|meta|link|title|template|noscript|canvas|br|wbr)$/.test(tag)) continue
      const st = view.getComputedStyle(el)
      if (st.display === 'none' || st.visibility !== 'visible' || +st.opacity === 0) continue
      if (!shown(el)) continue
      if (/^(img|svg|video|picture|object|embed|iframe|input|textarea|select|button|math|audio)$/.test(tag)) return '<' + tag + '>'
      if (!clear(st.backgroundColor) || (st.backgroundImage && st.backgroundImage !== 'none') || (st.boxShadow && st.boxShadow !== 'none')) return 'a painted <' + tag + '>'
      for (const s of ['Top', 'Right', 'Bottom', 'Left']) {
        if (parseFloat(st['border' + s + 'Width']) > 0 && st['border' + s + 'Style'] !== 'none' && !clear(st['border' + s + 'Color'])) return 'a painted <' + tag + '>'
      }
      const w = words(el, st)
      if (w) return w
    }
    return ''
  } catch {
    return ''
  }
}

/** The length of a page that does not say it (phase 5c, decision 6), in
 *  seconds, or null: its __config, else its GSAP timelines (those in
 *  window.__timelines, else GSAP's global one), the end of its CSS / Web
 *  Animations, the length of its media. Only finite lengths under 6 hours. */
export function pageDuration(win: any): number | null {
  try {
    const ok = (v: unknown): number => {
      const n = +(v as number)
      return Number.isFinite(n) && n > 0 && n < 21600 ? n : 0
    }
    const c = win.__config || win.VH_CONFIG
    if (c && ok(c.duration)) return ok(c.duration)
    const of = (tl: any): number => (tl ? ok(typeof tl.totalDuration === 'function' ? tl.totalDuration() : typeof tl.duration === 'function' ? tl.duration() : 0) : 0)
    let d = 0
    const tls = win.__timelines
    const list = Array.isArray(tls) ? tls : tls && typeof tls === 'object' ? Object.keys(tls).map((k) => tls[k]) : []
    for (const tl of list) d = Math.max(d, of(tl))
    if (!d && win.gsap && win.gsap.globalTimeline) d = of(win.gsap.globalTimeline)
    if (d) return d
    const doc = win.document
    if (doc && typeof doc.getAnimations === 'function') {
      for (const a of doc.getAnimations()) {
        try {
          d = Math.max(d, ok(+a.effect.getComputedTiming().endTime / 1000))
        } catch {
          /* no effect */
        }
      }
    }
    if (d) return d
    if (doc) for (const m of Array.prototype.slice.call(doc.querySelectorAll('video,audio'))) d = Math.max(d, ok(m.duration))
    return d || null
  } catch {
    return null
  }
}

/** Two pictures of the same size are the same moment (phase 5c, "Bitti
 *  ölçüsü"): at most 0.5 % of the pixels differ, by more than 28 / 255 in a
 *  channel. */
export function sameFrame(a: ArrayLike<number>, b: ArrayLike<number>): boolean {
  if (a.length !== b.length || a.length === 0) return false
  let bad = 0
  const px = a.length / 4
  for (let i = 0; i < a.length; i += 4) {
    if (Math.abs(a[i] - b[i]) > 28 || Math.abs(a[i + 1] - b[i + 1]) > 28 || Math.abs(a[i + 2] - b[i + 2]) > 28 || Math.abs(a[i + 3] - b[i + 3]) > 28) bad++
  }
  return bad <= px * 0.005
}

/** The host page's own program (runs in the host page; see the top). */
function hostMain(): void {
  const W0 = window as any
  let port: MessagePort | null = null
  let film: HTMLIFrameElement | null = null
  let fw: any = null
  let ready = false
  let W = 1920
  let H = 1080
  let queue: { id: number; t: number; prep: boolean; w: number; h: number }[] = []
  let busy = false
  let bitmaps = true
  let off: OffscreenCanvas | null = null
  let og: OffscreenCanvasRenderingContext2D | null = null
  let opened = 0
  /** The page's __config.transparent turned round: true (laid on black),
   *  false (no ground at all), null (its own background decides). */
  let opaque: boolean | null = null
  /** How the page is played (phase 5c, shared decision 1): 'fast' (its own
   *  renderOut), 'canvas' (the app's clock, its canvases copied). */
  let mode: 'fast' | 'canvas' | 'page' = 'fast'
  /** This page is the whole document of a hidden drawing window of the main
   *  process (phase 5d, tier 3: main/film-window.ts), not a frame of the
   *  editor: the window's picture IS the frame (HTML, CSS, SVG and all), so
   *  nothing is copied here. It talks through __snippGive / __snippTake
   *  (the main process calls them), and under the film it keeps a marker
   *  row: `ROW` pixels whose colour is the number of the frame last drawn
   *  (the editor takes the first picture that carries the number it asked). */
  const WIN = W0.parent === W0 && /[?&]win=1(?:&|$)/.test(String(location.search))
  const ROW = WIN ? Math.max(1, Math.min(8, +(/[?&]row=(\d+)/.exec(String(location.search)) || [0, 1])[1] || 1)) : 0
  let rowEl: HTMLElement | null = null
  let outbox: any[] = []
  let takeWaiter: (() => void) | null = null
  const takenWaiters: Record<number, () => void> = {}
  /** What the editor said when it opened the page. */
  let base = ''
  let hint: string | null = null
  let fps = 60
  /** The export's drawing scale (phase 5d.2, decision 6): 1, or up to 2
   *  when the page was loaded again to be exported larger (`dpr=` in its
   *  query: the guard tells the page that devicePixelRatio). */
  let scale = 1
  let fbW = 1920
  let fbH = 1080
  /** The app's clock: where the page stands (seconds of its last frame; -1
   *  before its first), whether it is "pure in time" (decision 4: a moment
   *  drawn by stepping and by jumping is the same; then it is jumped both
   *  ways), and the last frame whole (a moment asked again is answered from
   *  it: a page that turns a little on every frame is not drawn twice). */
  let at = -1
  let pure = false
  let full: OffscreenCanvas | null = null
  let fullG: OffscreenCanvasRenderingContext2D | null = null
  let fullAt = -1
  let duration: number | null = null
  /** A page found to have its own renderOut once it ran on the app's clock
   *  goes back to the fast path, once. */
  let flipped = false
  /** Where the start stands, for a boot that hangs (5d.1 step 0: the boot
   *  trace names the step it stopped at). */
  let stage = 'waiting for open'
  const stageInfo = (): string => {
    let f = 'no frame'
    try {
      const w = filmWin()
      if (w) f = String(w.location.href).replace(/^snippfilm:\/\/[^/]*/, '') + ' ' + (w.document ? w.document.readyState : '-') + ' READY=' + String(w.READY === true) + ' renderOut=' + typeof w.renderOut + ' guard=' + (typeof w.__snippNet === 'function')
    } catch (e) {
      f = 'frame unreadable: ' + String(e).slice(0, 80)
    }
    return (stage + ' | ' + f + ' | opened ' + opened + ' ready ' + ready + ' queue ' + queue.length + ' busy ' + busy).slice(0, 400)
  }

  const say = (m: any, transfer?: Transferable[]): void => {
    if (WIN) {
      outbox.push(m)
      if (takeWaiter) takeWaiter()
    } else if (port) port.postMessage(m, transfer || [])
  }
  /** A WebGL context of a canvas that makes the picture was lost (5a/5b
   *  patch, audit C-4): it draws nothing, so a frame would be black. The
   *  guard lists the page's WebGL contexts (codefilm-guard.ts, __snippGL). */
  let lost = false
  const glLost = (): boolean => {
    try {
      const list = fw && fw.__snippGL
      if (typeof list !== 'function') return false
      const vis = visibleCanvases(fw.document)
      return list().some((x: any) => x && vis.indexOf(x.canvas) >= 0 && typeof x.isContextLost === 'function' && x.isContextLost())
    } catch {
      return false
    }
  }
  const setLost = (on: boolean): void => {
    if (on === lost) return
    lost = on
    say({ type: on ? 'lost' : 'restored' })
  }
  const errText = (e: any): string => String((e && (e.stack || e.message)) || e).slice(0, 2000)
  /** What the app's guard in the film page wrote down (codefilm-guard.ts). */
  const record = (): any => {
    try {
      const g = film && (film.contentWindow as any).__snippGuard
      if (!g) return null
      const list = (l: any): string[] => (Array.isArray(l) ? l.slice(0, 50).map((x: any) => String(x).slice(0, 500)) : [])
      return { errors: list(g.errors), blocked: list(g.blocked), failed: list(g.failed), dialogs: list(g.dialogs), media: +g.media || 0, audio: +g.audio || 0, opened: +g.opened || 0, uses: list(g.uses).slice(0, 20), errorCount: +g.errorCount || 0, params: Array.isArray(g.params) ? g.params.slice(0, 40) : null, look: g.look === true }
    } catch {
      return null
    }
  }
  /** What the page said of its parameters and whether it read the project
   *  look (phase 5f): sent with ready (the editor's Inspector shows them). */
  const said = (): { params: unknown[] | null; look: boolean } => {
    const r = record()
    return { params: r ? r.params : null, look: !!(r && r.look) }
  }
  /** How many errors the page's guard wrote down so far (uncapped): sent with
   *  ready, every frame and every pong, so the editor sees an error list that
   *  grows after the page was ready (phase 5e, S-6). */
  // (Counted over every load of the page: going back loads it again and its
  // guard starts from 0; the editor compares with the count at ready.)
  let errBefore = 0
  let errLast = 0
  const errCount = (): number => {
    let n = 0
    try {
      const g = film && (film.contentWindow as any).__snippGuard
      n = g ? +g.errorCount || 0 : 0
    } catch {
      n = 0
    }
    // A new load (its guard counts from 0 again): what the loads before
    // counted is kept.
    if (n < errLast) {
      errBefore += errLast
      errLast = 0
    }
    errLast = Math.max(errLast, n)
    return errBefore + errLast
  }
  /** The page's first written-down error, for a message. */
  const firstError = (): string => {
    const r = record()
    const e = r && (r.errors[0] || (r.blocked[0] ? 'blocked: ' + r.blocked[0] : '') || (r.failed[0] ? 'could not load: ' + r.failed[0] : ''))
    return e ? ' The page said: ' + String(e).split('\n')[0].slice(0, 300) : ''
  }

  const size = (w: number, h: number): void => {
    W = w
    H = h
    document.body.style.width = w + 'px'
    document.body.style.height = h + 'px'
    if (film) {
      film.style.width = w + 'px'
      film.style.height = h + 'px'
    }
    if (rowEl) rowEl.style.top = h + 'px'
    // (The drawing window is made that big by the main process.)
    if (WIN) say({ type: 'size', width: w, height: h })
  }
  /** The drawing window has the film's size (plus the marker row). */
  const winSized = async (): Promise<void> => {
    const t0 = performance.now()
    while ((window.innerWidth !== W || window.innerHeight !== H + ROW) && performance.now() - t0 < 3000) await sleep(20)
  }
  /** The marker row shows frame number `n` (its low 24 bits, as a colour). */
  const rowMark = (n: number): void => {
    if (rowEl) rowEl.style.background = '#' + ((n & 0xffffff) + 0x1000000).toString(16).slice(1)
  }

  const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))
  /** One real task (the page's own tasks, its promises and its loads run
   *  in between: the film shares this page's thread). */
  const task = (): Promise<void> =>
    new Promise((r) => {
      const ch = new MessageChannel()
      ch.port1.onmessage = () => r()
      ch.port2.postMessage(0)
    })

  /** A new film frame: the page at `/index.html?<query>`. */
  const frameFor = (q: string, w: number, h: number): number => {
    const my = ++opened
    fw = null
    if (film) film.remove()
    film = document.createElement('iframe')
    film.setAttribute('scrolling', 'no')
    // (In a drawing window nothing lies under the film: where the page is
    // see-through, so is the frame.)
    film.style.cssText = 'position:absolute;left:0;top:0;border:0;margin:0;padding:0;display:block;background:' + (WIN ? 'transparent' : '#000')
    size(w, h)
    // From the folder's root (this page lives in __snipp/).
    film.src = '/index.html' + (q ? '?' + q : '')
    document.body.appendChild(film)
    return my
  }
  const filmWin = (): any => {
    try {
      return film ? film.contentWindow : null
    } catch {
      return null
    }
  }
  /** Loaded, its fonts in, nothing being fetched for `ms` (the guard counts). */
  const settled = (w: any, ms: number): boolean => {
    try {
      // (The film's own document, with the guard in it: not the frame's
      // first empty one, which is "complete" at once.)
      if (typeof w.__snippNet !== 'function' || /^about:/i.test(String(w.location.href))) return false
      const d = w.document
      if (!d || d.readyState !== 'complete') return false
      if (d.fonts && d.fonts.status !== 'loaded') return false
      const n = w.__snippNet()
      return n.inflight === 0 && n.quietMs >= ms
    } catch {
      return false
    }
  }
  const listenLost = (w: any): void => {
    lost = false
    try {
      w.addEventListener('webglcontextlost', () => setLost(true), true)
      w.addEventListener('webglcontextrestored', () => setTimeout(() => setLost(glLost()), 0), true)
    } catch {
      /* checked after each draw all the same */
    }
  }

  const open = (m: { query?: string; width?: number; height?: number; mode?: string; fps?: number; fallbackWidth?: number; fallbackHeight?: number }): void => {
    ready = false
    queue = []
    base = m.query ? String(m.query) : ''
    {
      const k = +((/(?:^|&)dpr=([0-9.]+)(?:&|$)/.exec(base) || [0, 1])[1] as number)
      scale = Number.isFinite(k) && k > 1 && k <= 2 ? k : 1
    }
    hint = typeof m.mode === 'string' ? m.mode : null
    fps = +(m.fps || 0) > 0 ? Math.min(120, +m.fps!) : 60
    fbW = +(m.fallbackWidth || 0) > 0 ? +m.fallbackWidth! : 1920
    fbH = +(m.fallbackHeight || 0) > 0 ? +m.fallbackHeight! : 1080
    flipped = false
    const w = +(m.width || 0) > 0 ? +m.width! : 1920
    const h = +(m.height || 0) > 0 ? +m.height! : 1080
    stage = 'opened'
    if (WIN) void startPage()
    else if (hint === 'canvas') void startClock()
    else probe(w, h)
  }

  /** Every page first runs as it is (the clock passing through). With a
   *  renderOut and READY: the fast path, as before. Without a renderOut
   *  once it has loaded and been quiet for 2 s: shown outside its canvases →
   *  tier 3 (not yet: an error naming what it shows); else it is opened
   *  again on the app's clock (tier 2). */
  const probe = (w: number, h: number): void => {
    mode = 'fast'
    stage = 'probe'
    const my = frameFor(base, w, h)
    const t0 = performance.now()
    const wait = setInterval(() => {
      if (my !== opened) return clearInterval(wait)
      const win = filmWin()
      try {
        if (win && win.__vhError) {
          clearInterval(wait)
          say({ type: 'error', message: String(win.__vhError) })
          return
        }
        if (win && win.READY === true && typeof win.renderOut === 'function') {
          clearInterval(wait)
          // (Phase 5f, found by the real-agent trial: a page with its own
          // renderOut that draws HTML and no canvas at all came out blank on
          // the fast path, which copies canvases. Such a page is drawn whole,
          // by a window of its own, its renderOut called at each moment:
          // looked at after renderOut drew its middle, then 0 again. A page
          // with a canvas keeps the fast path exactly as before.)
          // (Audit O1: looked at one moment only, a page empty there stayed on
          // the fast path and every frame came out blank. With no visible
          // canvas the fast path can show nothing but its ground: such a page
          // is drawn whole, not probed.)
          if (!WIN && !visibleCanvases(win.document).length) {
            say({ type: 'error', kind: 'page', what: pageContent(win.document) || 'no canvas; its own renderOut' })
            return
          }
          fw = win
          listenLost(win)
          const c = pickConfig(win)
          size(c.width, c.height)
          opaque = c.transparent === null ? null : !c.transparent
          ready = true
          stage = 'ready (fast)'
          // (What time and chance sources it used while it loaded: a page
          // that read Math.random or the clock then may draw another picture
          // when it is loaded again; 5c + 5d audit, K1.)
          const rec = record()
          say({ type: 'ready', width: c.width, height: c.height, fps: c.fps, duration: c.duration, transparent: c.transparent, prep: typeof win.PREP === 'function', ms: Math.round(performance.now() - t0), mode: 'fast', uses: rec ? rec.uses : [], errs: errCount(), ...said() })
          void pump()
          return
        }
        if (!flipped && win && typeof win.renderOut !== 'function' && settled(win, 2000)) {
          clearInterval(wait)
          const what = pageContent(win.document)
          if (what) {
            say({ type: 'error', kind: 'page', what })
            return
          }
          void startClock()
          return
        }
      } catch (e) {
        clearInterval(wait)
        say({ type: 'error', message: errText(e) })
        return
      }
      if (performance.now() - t0 > 120000) {
        clearInterval(wait)
        say({ type: 'error', message: 'The film page was not ready in 2 minutes (window.READY never became true).' + firstError() })
      }
    }, 50)
  }

  /** The page opened on the app's clock and brought to its first frame
   *  (at 0). Throws when it does not get there in 2 minutes, or turns out
   *  to have a renderOut of its own (it goes back to the fast path). */
  const freshClock = async (): Promise<void> => {
    const my = frameFor(base + (base ? '&' : '') + 'vt=1', fbW, fbH)
    const t0 = performance.now()
    for (;;) {
      if (my !== opened) throw new Error('stale')
      const win = filmWin()
      if (win && win.__vhError) throw new Error(String(win.__vhError))
      if (win && typeof win.renderOut === 'function' && !flipped) throw new Error('own renderOut')
      if (win && settled(win, 300)) {
        if (!win.__snippClock) throw new Error('The app could not run its clock in this page.')
        fw = win
        break
      }
      if (performance.now() - t0 > 120000) throw new Error('The film page did not finish loading in 2 minutes.' + firstError())
      await sleep(50)
    }
    listenLost(fw)
    const c = pickConfig(fw)
    // The size it says, else its biggest canvas's box, else the project's
    // (decision 6; the frame was opened at the project's size).
    const said = !!(fw.__config || fw.VH_CONFIG || fw.DATA)
    // (A whole page that says no size is the project's size, canvas or not.)
    if (said || (mode !== 'page' && fw.document.querySelector('canvas'))) size(c.width, c.height)
    opaque = c.transparent === null ? null : !c.transparent
    if (WIN) {
      // A page that says `transparent: false` is laid on black.
      document.body.style.background = opaque === true ? '#000' : 'transparent'
      // One that says `transparent: true` has no ground (phase 5b, decision
      // 1, as for a canvas page; 5d.2): its html / body background is not
      // painted.
      if (opaque === false) {
        try {
          const st = fw.document.createElement('style')
          st.textContent = 'html,body{background:transparent !important}'
          ;(fw.document.head || fw.document.documentElement).appendChild(st)
        } catch {
          /* its own background stays */
        }
      }
      await winSized()
    }
    if (c.fps) fps = Math.min(120, c.fps)
    at = -1
    fullAt = -1
    // Its stylesheet's animations, its SVG timelines: born at 0.
    settle()
    // Its first frame, at 0: the same start on every load (kept whole, so
    // an ask for 0 does not draw a second one).
    await runTimers(0, false)
    if (!drawAt(0)) throw new Error("The film's WebGL context was lost.")
    await task()
    duration = pageDuration(fw)
  }

  /** After a step's task: what the step started (CSS transitions, animations)
   *  taken on the clock (phase 5d.2, decision 4). */
  const settle = (): void => {
    const C = fw && fw.__snippClock
    if (C && typeof C.settle === 'function') C.settle()
  }
  /** How many of the page's animations started away from the clock's steps. */
  const lateCount = (): number => {
    try {
      const C = fw && fw.__snippClock
      return C && typeof C.late === 'function' ? +C.late() || 0 : 0
    } catch {
      return 0
    }
  }

  /** Runs the timers due by `sec`, each in its own task. */
  const runTimers = async (sec: number, jump: boolean): Promise<void> => {
    const C = fw.__snippClock
    let n = 0
    while (C.due(sec * 1000) && n < 2000) {
      C.timer(sec * 1000, jump)
      n++
      await task()
      settle()
    }
  }

  /** Brings the page to `T` s, its last frame NOT drawn yet (the caller
   *  draws it and copies the canvases in the same task: WebGL is readable
   *  only there). Stepping: every frame of its grid on the way. Jumping
   *  (a page pure in time): straight there. */
  const bringTo = async (T: number, jump: boolean): Promise<void> => {
    const C = fw.__snippClock
    if (!jump) {
      const kT = Math.round(T * fps)
      for (let k = Math.floor(at * fps + 1e-6) + 1; k < kT; k++) {
        const s = k / fps
        await runTimers(s, false)
        C.frame(s * 1000, s)
        at = s
        await task()
        settle()
      }
    }
    await runTimers(T, jump)
    // The page's playing media set to T (each seek awaited) before its frame.
    if (typeof C.media === 'function') await C.media(T * 1000)
  }

  /** Draws the page's frame at `T` (the clock moved there) into `full`,
   *  whole. Answers false when its graphics context was lost. */
  const drawAt = (T: number): boolean => {
    fw.__snippClock.frame(T * 1000, T)
    at = T
    if (glLost()) return false
    // (A whole page: the window's own picture is the frame.)
    if (mode === 'page') return true
    // (At the export's scale, phase 5d.2 decision 6: the page's canvases
    // are that much bigger when it follows devicePixelRatio.)
    const fW = Math.max(1, Math.round(W * scale))
    const fH = Math.max(1, Math.round(H * scale))
    if (!full || full.width !== fW || full.height !== fH) {
      full = new OffscreenCanvas(fW, fH)
      fullG = full.getContext('2d') as OffscreenCanvasRenderingContext2D
    }
    composeInto(fullG!, fW, fH)
    fullAt = T
    return true
  }

  /** A small copy of the frame in `full`, for the purity probe. */
  const sample = (): Uint8ClampedArray => {
    const sw = Math.min(480, W)
    const sh = Math.max(1, Math.round((H * sw) / W))
    const o = new OffscreenCanvas(sw, sh)
    const g = o.getContext('2d') as OffscreenCanvasRenderingContext2D
    g.drawImage(full!, 0, 0, sw, sh)
    return g.getImageData(0, 0, sw, sh).data
  }

  /** Tier 2: the page on the app's clock. Loaded, checked that its picture
   *  is canvases only (decision 3), probed once for purity (decision 4: a
   *  moment drawn by jumping straight to it and by stepping to it). */
  const startClock = async (): Promise<void> => {
    mode = 'canvas'
    stage = 'clock'
    const t0 = performance.now()
    try {
      await freshClock()
      const what = pageContent(fw.document)
      if (what) {
        say({ type: 'error', kind: 'page', what })
        return
      }
      // No canvas at all: nothing to show (often a script that could not
      // load: its address is named, decision 5).
      if (!visibleCanvases(fw.document).length) {
        // (Phase 5e: a page with nothing in it yet and nothing written down
        // — the code_clip tool's empty page — is a whole page that shows
        // nothing: it plays, clear, and the checker calls it "blank".)
        const r = record()
        if (r && !r.errors.length && !r.blocked.length && !r.failed.length) {
          say({ type: 'error', kind: 'page', what: 'nothing yet' })
          return
        }
        throw new Error('The film page shows nothing: it has no canvas with a picture.')
      }
      // Pure in time? (5c + 5d audit, S-1: one look at 1 s found pages
      // "pure" that only start later.) A page that uses timers, intervals,
      // idle callbacks or GSAP's own ticker keeps state between frames: not
      // pure, not probed. Any other is drawn at two moments, 1 s (or half
      // its length) and 3 s (or half its length), by jumping and by
      // stepping, on its grid; pure only if both are the same.
      const stateful = (): boolean => {
        const r = record()
        const u: string[] = r ? r.uses : []
        return u.indexOf('timer') >= 0 || u.indexOf('idle') >= 0 || !!fw.gsap
      }
      pure = false
      if (!stateful()) {
        const P1 = Math.max(1, Math.round(Math.min(1, duration ? duration / 2 : 1) * fps)) / fps
        const P2 = Math.max(P1, Math.round(Math.min(3, duration ? duration / 2 : 3) * fps) / fps)
        const moments = P2 > P1 ? [P1, P2] : [P1]
        const jumped: Uint8ClampedArray[] = []
        for (const P of moments) {
          await bringTo(P, true)
          if (!drawAt(P)) throw new Error("The film's WebGL context was lost.")
          jumped.push(sample())
        }
        await freshClock()
        let same = true
        for (let i = 0; i < moments.length; i++) {
          await bringTo(moments[i], false)
          if (!drawAt(moments[i])) throw new Error("The film's WebGL context was lost.")
          if (!sameFrame(jumped[i], sample())) same = false
        }
        pure = same && !stateful()
      }
      ready = true
      stage = 'ready (canvas)'
      say({ type: 'ready', width: W, height: H, fps: null, duration, transparent: opaque === null ? null : !opaque, prep: false, ms: Math.round(performance.now() - t0), mode: 'canvas', pure, errs: errCount(), ...said() })
      void pump()
    } catch (e) {
      const msg = errText(e)
      if (msg.indexOf('stale') >= 0 && msg.length < 40) return
      if (msg.indexOf('own renderOut') >= 0) {
        // It draws by itself after all: the fast path, as it was written.
        flipped = true
        probe(fbW, fbH)
        return
      }
      say({ type: 'error', message: msg.split('\n')[0].replace(/^Error: /, '') + (msg.indexOf('The page said') < 0 ? firstError() : '') })
    }
  }

  /** Tier 3 (phase 5d.1): the page on the app's clock in a drawing window of
   *  its own. Stepped on its frame grid, opened again to go back (no purity
   *  probe: nothing is read back here). */
  const startPage = async (): Promise<void> => {
    mode = 'page'
    stage = 'page'
    // (Its own renderOut, if it has one, is not looked for here.)
    flipped = true
    pure = false
    const t0 = performance.now()
    try {
      await freshClock()
      // (A page with its own renderOut: drawn by it at 0; phase 5f.)
      if (typeof fw.renderOut === 'function') fw.renderOut(0)
      ready = true
      stage = 'ready (page)'
      say({ type: 'ready', width: W, height: H, fps: null, duration, transparent: opaque === null ? null : !opaque, prep: false, ms: Math.round(performance.now() - t0), mode: 'page', pure: false, errs: errCount(), ...said() })
      void pump()
    } catch (e) {
      const msg = errText(e)
      if (msg.indexOf('stale') >= 0 && msg.length < 40) return
      say({ type: 'error', message: msg.split('\n')[0].replace(/^Error: /, '') + (msg.indexOf('The page said') < 0 ? firstError() : '') })
    }
  }

  /** The frame at second t on the app's clock (into `full`). A page pure in
   *  time is jumped forward to t; any other is stepped forward on its frame
   *  grid (t is taken to its grid frame). Going back, every page is opened
   *  again (5c + 5d audit, S-1: a page taken for pure and jumped back saw
   *  its clock go backwards). */
  const clockFrame = async (t: number): Promise<boolean> => {
    const T = pure ? Math.max(0, t) : Math.floor(Math.max(0, t) * fps + 1e-6) / fps
    if (mode === 'page') {
      if (at >= 0 && Math.abs(T - at) < 1e-9) return true
    } else if (fullAt >= 0 && Math.abs(T - fullAt) < 1e-9 && full) return true
    // A whole page with its own renderOut (phase 5f): drawn by it at T, on
    // the app's clock (its CSS and its own loop at T too).
    const own = (): void => {
      if (mode === 'page' && fw && typeof fw.renderOut === 'function') fw.renderOut(T)
    }
    if (T < at - 1e-9) {
      await freshClock()
      // (The load drew its frame at 0 and kept it: not a second time. A
      // page that counts its frames was one ahead; 5c + 5d audit, S-4.)
      if (T === 0) {
        own()
        return true
      }
    }
    await bringTo(T, pure)
    const ok = drawAt(T)
    own()
    if (ok && mode !== 'page') {
      // (What the frame's callbacks started, once their promises ran: on
      // the clock from this moment. A drawing window does it after its
      // marker is written: pump.)
      await task()
      settle()
    }
    return ok
  }

  /** The film's canvases, as one picture of w × h, into g. Called in the
   *  same task as renderOut (or the clock's frame): a WebGL canvas is only
   *  readable there. */
  const composeInto = (g: OffscreenCanvasRenderingContext2D, w: number, h: number): void => {
    g.setTransform(1, 0, 0, 1, 0, 0)
    g.globalAlpha = 1
    g.globalCompositeOperation = 'source-over'
    g.imageSmoothingEnabled = true
    g.imageSmoothingQuality = 'high'
    g.clearRect(0, 0, w, h)
    // The ground: the page's own background colour (a film with
    // body{background:#000} comes out on black, as it always did); a page
    // that says __config.transparent = false is laid on black first.
    if (opaque === true) {
      g.fillStyle = '#000'
      g.fillRect(0, 0, w, h)
    }
    if (opaque !== false) {
      const ground = filmGround(fw.document)
      if (ground) {
        // (A colour the canvas cannot read leaves the fill as it was: made
        // transparent first, so it paints nothing then.)
        g.fillStyle = 'rgba(0,0,0,0)'
        g.fillStyle = ground
        g.fillRect(0, 0, w, h)
      }
    }
    const kx = w / W
    const ky = h / H
    for (const cv of visibleCanvases(fw.document)) {
      const r = cv.getBoundingClientRect()
      g.drawImage(cv, r.left * kx, r.top * ky, r.width * kx, r.height * ky)
    }
  }
  const target = (w: number, h: number): OffscreenCanvasRenderingContext2D => {
    if (!off || off.width !== w || off.height !== h) {
      off = new OffscreenCanvas(w, h)
      // With alpha (phase 5b, decision 1): where the page is transparent the
      // frame is too, and the tracks under the clip show through.
      og = off.getContext('2d') as OffscreenCanvasRenderingContext2D
    }
    return og!
  }
  const compose = (w: number, h: number): OffscreenCanvasRenderingContext2D => {
    const g = target(w, h)
    composeInto(g, w, h)
    return g
  }
  /** The frame in `full`, w × h. */
  const fromFull = (w: number, h: number): OffscreenCanvasRenderingContext2D => {
    const g = target(w, h)
    g.setTransform(1, 0, 0, 1, 0, 0)
    g.globalAlpha = 1
    g.globalCompositeOperation = 'copy'
    g.imageSmoothingEnabled = true
    g.imageSmoothingQuality = 'high'
    g.drawImage(full!, 0, 0, w, h)
    g.globalCompositeOperation = 'source-over'
    return g
  }

  const pump = async (): Promise<void> => {
    if (busy || !ready) return
    busy = true
    try {
      while (queue.length && ready) {
        const q = queue.shift()!
        const a = performance.now()
        try {
          let g: OffscreenCanvasRenderingContext2D
          if (mode === 'page') {
            if (!(await clockFrame(q.t))) {
              setLost(true)
              say({ type: 'error', id: q.id, t: q.t, message: 'The film\'s WebGL context was lost.', lost: true })
              continue
            }
            if (lost) setLost(false)
            // The page stands at q.t: its number goes into the marker row in
            // this same task, so one picture of the window carries both. The
            // page then waits until that picture was taken (or given up on).
            rowMark(q.id)
            say({ type: 'painted', id: q.id, t: q.t, ms: Math.round((performance.now() - a) * 10) / 10, late: lateCount(), errs: errCount() })
            await task()
            settle()
            await new Promise<void>((r) => {
              const timer = setTimeout(() => {
                delete takenWaiters[q.id]
                r()
              }, 8000)
              takenWaiters[q.id] = () => {
                clearTimeout(timer)
                delete takenWaiters[q.id]
                r()
              }
            })
            continue
          }
          if (mode === 'canvas') {
            if (!(await clockFrame(q.t))) {
              setLost(true)
              say({ type: 'error', id: q.id, t: q.t, message: 'The film\'s WebGL context was lost.', lost: true })
              continue
            }
            if (lost) setLost(false)
            g = fromFull(q.w, q.h)
          } else {
            if (q.prep && typeof fw.PREP === 'function') await fw.PREP(q.t)
            fw.renderOut(q.t)
            // A lost context drew nothing: an error, never a black frame.
            if (glLost()) {
              setLost(true)
              say({ type: 'error', id: q.id, t: q.t, message: 'The film\'s WebGL context was lost.', lost: true })
              continue
            }
            if (lost) setLost(false)
            g = compose(q.w, q.h)
          }
          const ms = Math.round((performance.now() - a) * 10) / 10
          const late = mode === 'canvas' ? lateCount() : 0
          if (bitmaps) {
            const bmp = off!.transferToImageBitmap()
            try {
              say({ type: 'frame', id: q.id, t: q.t, bmp, ms, late, errs: errCount() }, [bmp])
              continue
            } catch {
              // An ImageBitmap that cannot cross to the editor: the pixels
              // instead, from now on.
              bitmaps = false
              bmp.close()
              if (mode === 'canvas') fromFull(q.w, q.h)
              else compose(q.w, q.h)
            }
          }
          const px = g.getImageData(0, 0, q.w, q.h)
          say({ type: 'frame', id: q.id, t: q.t, w: q.w, h: q.h, pixels: px.data.buffer, ms, late, errs: errCount() }, [px.data.buffer])
        } catch (e) {
          say({ type: 'error', id: q.id, message: errText(e) })
        }
      }
    } finally {
      busy = false
    }
  }

  /** What the editor says (over its port; in a drawing window, through the
   *  main process). */
  const onPort = (m: any): void => {
      if (!m) return
      if (m.type === 'open') open(m)
      else if (m.type === 'ping') say({ type: 'pong', n: +m.n || 0, errs: errCount() })
      else if (m.type === 'diag') say({ type: 'diag', n: +m.n || 0, record: record(), where: stageInfo() })
      else if (m.type === 'frame') {
        queue.push({ id: +m.id, t: +m.t || 0, prep: !!m.prep, w: Math.max(1, Math.round(+m.w || W)), h: Math.max(1, Math.round(+m.h || H)) })
        void pump()
      } else if (m.type === 'drop' && Array.isArray(m.ids)) {
        // Asks not started yet that the editor no longer wants (a newer
        // scrub position): each answered 'dropped', so it can let go of it.
        const gone = new Set(m.ids)
        const left: typeof queue = []
        for (const q of queue) {
          if (gone.has(q.id)) {
            say({ type: 'dropped', id: q.id })
          } else left.push(q)
        }
        queue = left
      } else if (m.type === 'taken') {
        // (Drawing window: the picture that carries this number was taken.)
        const w = takenWaiters[+m.id]
        if (w) w()
      } else if (m.type === 'nudge' && rowEl) {
        // (Drawing window: no picture came; a changed pixel asks for one.)
        const k = rowEl.firstChild as HTMLElement | null
        if (k) k.style.background = k.style.background === 'rgb(1, 1, 1)' ? 'rgb(2, 2, 2)' : 'rgb(1, 1, 1)'
      }
  }
  if (WIN) {
    // Nothing under the film but the window, which is see-through.
    document.documentElement.style.background = 'transparent'
    document.body.style.background = 'transparent'
    rowEl = document.createElement('div')
    // The row: its colour is the frame's number (all of it but its last
    // pixel, which only ever changes to ask for a new picture).
    rowEl.style.cssText = 'position:fixed;left:0;top:' + H + 'px;width:100%;height:' + ROW + 'px;background:#000;z-index:2147483647;pointer-events:none'
    const nudge = document.createElement('div')
    nudge.style.cssText = 'position:absolute;right:0;top:0;width:1px;height:100%;background:rgb(1, 1, 1)'
    rowEl.appendChild(nudge)
    document.documentElement.appendChild(rowEl)
    W0.__snippGive = (m: any): boolean => {
      onPort(m)
      return true
    }
    W0.__snippTake = (): Promise<any[]> =>
      new Promise((res) => {
        const give = (): void => {
          takeWaiter = null
          const l = outbox
          outbox = []
          res(l)
        }
        if (outbox.length) return give()
        const timer = setTimeout(give, 10000)
        takeWaiter = () => {
          clearTimeout(timer)
          give()
        }
      })
    say({ type: 'hello' })
  } else {
    window.addEventListener('message', (e: MessageEvent) => {
      if (e.source !== window.parent || port || !e.data || e.data.type !== 'snipp-port' || !e.ports[0]) return
      port = e.ports[0]
      port.onmessage = (ev: MessageEvent) => onPort(ev.data || {})
      say({ type: 'hello' })
    })
  }
  W0.__snippHost = true
}

/** The host page, whole. */
export const HOST_HTML = `<!doctype html><html><head><meta charset="utf-8"><title>${PRODUCT_NAME} code film</title>
<style>html,body{margin:0;padding:0;overflow:hidden;background:#000}</style></head><body>
<script>
${pickConfig.toString()}
${filmGround.toString()}
${visibleCanvases.toString()}
${pageContent.toString()}
${pageDuration.toString()}
${sameFrame.toString()}
(${hostMain.toString()})()
</script></body></html>`
