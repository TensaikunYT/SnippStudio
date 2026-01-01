// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// The app's first script in every code film page (phase 5a, FAZ5-PLAN.md;
// tarifler\FAZ5.md shared decision 2 and 5a decision 3).
//
// main/codefilm.ts puts `<script src="/__snipp/guard.js"></script>` right
// after the page's <head> and serves this program there. It runs before any of
// the page's own scripts and changes nothing the page draws (a fast-path film
// draws the same pixels with it and without it: the closing measure of every
// part of phase 5). What it does:
//   - devicePixelRatio is 1 (a film sized by it is framed as on a 100 % display);
//   - alert / confirm / prompt / print open nothing (written down, answered as
//     a person who closed the box);
//   - the page makes no sound: media elements are kept muted, an AudioContext
//     plays into no device ({ sinkId: { type: 'none' } }). The editor's own
//     sound is not touched (its autoplayPolicy stays as it is);
//   - console.error, uncaught errors and rejections, addresses refused by the
//     page's content security policy and loads that failed are written down,
//     in window.__snippGuard (the host page reads it: codefilm-host.ts).
// The record is bounded (50 entries of 500 characters per list).
//
// Like the host page, the program is made with toString(): it must stay
// self-contained (no imports, no outside names).

export interface GuardRecord {
  errors: string[]
  blocked: string[]
  failed: string[]
  dialogs: string[]
  /** Media elements the page started (each kept muted). */
  media: number
  /** Audio contexts the page made (each playing into no device). */
  audio: number
  /** window.open calls (each refused). */
  opened: number
  /** The time and chance sources the page used (phase 5c, decision 1):
   *  'raf', 'timer', 'idle', 'perf', 'date', 'random', 'crypto'. */
  uses: string[]
  /** Every error written down, uncapped (the list keeps 50): the host page
   *  tells the editor when it grows after the page was ready (phase 5e, S-6). */
  errorCount: number
  /** The parameters the page said (window.__params, its own values; phase
   *  5f, decision 2), or null when it said none. */
  params: unknown[] | null
  /** The page read the project look (window.__snippLook; phase 5f). */
  look: boolean
}

/** The app's clock in a page that runs on it (phase 5c, decisions 1–2):
 *  `window.__snippClock` in a page opened with `?vt=1`. The host page
 *  (codefilm-host.ts) moves it; the page sees time pass only then. Times
 *  in ms of the page's own clock (performance.now), which starts at 0. */
export interface SnippClock {
  /** The page's time now, ms. */
  now(): number
  /** Is a timer due at or before `ms`? */
  due(ms: number): boolean
  /** Runs the earliest timer due at or before `ms` (the clock set to its
   *  due time first); `jump`: the clock set to `ms` and an interval
   *  continued from there (a jump does not replay every tick). false when
   *  none was due. One timer per call: the caller gives each its own task. */
  timer(ms: number, jump?: boolean): boolean
  /** One animation frame at `ms` (and at `sec` seconds for the GSAP
   *  timelines in window.__timelines): the clock set to `ms`, then every
   *  requestAnimationFrame callback asked for before it. Answers how many ran. */
  frame(ms: number, sec: number): number
  /** Callbacks and timers waiting. */
  pending(): { frames: number; timers: number }
  /** (Phase 5d.2, decision 4.) The page's CSS animations and transitions,
   *  Web Animations and SVG animations made since the last look are taken on
   *  the clock (born now) and every one is set to its moment: called by the
   *  host after the task that follows each timer and each frame. */
  settle(): void
  /** Its playing `<video>` / `<audio>` set to their moment at `ms`; resolves
   *  when each has sought (or after 3 s). */
  media(ms: number): Promise<void>
  /** How many animations were first seen away from the clock's own steps
   *  (made by something the clock does not drive: a load, a network answer,
   *  an animation event). Their start depends on when the page was looked
   *  at, so the same moment may differ from one way of reaching it to
   *  another: such a page is "unsteady". */
  late(): number
}

/** Installs the guard in the window `w` (and, when the page reaches into a
 *  same-origin child frame through contentWindow / contentDocument, there too). */
export function guardMain(w: any): void {
  if (!w || w.__snippGuard) return
  const MAX = 50
  const LEN = 500
  // (Written into the page as text: these must live inside this function.
  // codefilm-limits.ts checkLines reads the same two marks.)
  const CONSOLE_LINE = 'console.error: '
  const SCRIPT_LINE = 'script '
  const rec: GuardRecord = { errors: [], blocked: [], failed: [], dialogs: [], media: 0, audio: 0, opened: 0, uses: [], errorCount: 0, params: null, look: false }
  // (`counted` false: a line kept as a fact that is not an error of the page:
  // its own console.error, audit D8a.)
  const push = (list: string[], s: unknown, counted = true): void => {
    if (list === rec.errors && counted) rec.errorCount++
    if (list.length < MAX) list.push(String(s).slice(0, LEN))
  }
  const text = (v: unknown): string => {
    try {
      if (v && typeof v === 'object' && 'stack' in (v as object) && (v as any).stack) return String((v as any).stack)
      if (v && typeof v === 'object' && 'message' in (v as object)) return String((v as any).message)
      return typeof v === 'string' ? v : JSON.stringify(v)
    } catch {
      return String(v)
    }
  }
  // The record stays in here; the page gets copies (5a/5b patch, audit C-5:
  // it could write into the lists, or define the record itself before the
  // guard ran). It is what the page says: shown to the person, never trusted
  // for a decision (the main process keeps its own list of refusals).
  const apply = Reflect.apply
  const slice = Array.prototype.slice
  const copy = (): GuardRecord => ({
    errors: apply(slice, rec.errors, []),
    blocked: apply(slice, rec.blocked, []),
    failed: apply(slice, rec.failed, []),
    dialogs: apply(slice, rec.dialogs, []),
    media: rec.media,
    audio: rec.audio,
    opened: rec.opened,
    uses: apply(slice, rec.uses, []),
    errorCount: rec.errorCount,
    params: rec.params ? apply(slice, rec.params, []) : null,
    look: rec.look
  })
  try {
    Object.defineProperty(w, '__snippGuard', { get: copy, set: () => {}, enumerable: false, configurable: false })
  } catch {
    return
  }

  // devicePixelRatio: 1, or the export's drawing scale (phase 5d.2, decision
  // 6: `?dpr=<k>`, 1 < k ≤ 2, when the page is loaded again to be exported
  // larger than its own size).
  let dpr = 1
  try {
    const m = /(?:^|[?&])dpr=([0-9.]+)(?:&|$)/.exec(String(w.location.search))
    const k = m ? +m[1] : 1
    if (Number.isFinite(k) && k > 1 && k <= 2) dpr = k
  } catch {
    dpr = 1
  }
  try {
    Object.defineProperty(w, 'devicePixelRatio', { get: () => dpr, set: () => {}, configurable: true, enumerable: true })
  } catch {
    /* kept as it was */
  }

  // Parameters and the project look (phase 5f, decisions 2–3;
  // renderer/src/media/codefilm-params.ts): `snp=<base64url of JSON>` in the
  // page's address holds the user's values ({v}) and the project look ({l}).
  // A page that says `window.__params = [{key, label, type, value}, …]` has
  // its items' values replaced by the user's (same key, same type) as it says
  // it, and what it said (its own values) is written down for the Inspector.
  // window.__snippLook is the project look (undefined when none is set). A
  // page that uses neither is not touched by them.
  let over: Record<string, unknown> = {}
  let lookVal: Record<string, string> | undefined
  try {
    const m = /(?:^|[?&])snp=([A-Za-z0-9_-]+)(?:&|$)/.exec(String(w.location.search))
    if (m) {
      const b = w.atob(m[1].replace(/-/g, '+').replace(/_/g, '/'))
      const u = new Uint8Array(b.length)
      for (let i = 0; i < b.length; i++) u[i] = b.charCodeAt(i)
      const o = JSON.parse(new w.TextDecoder().decode(u))
      if (o && typeof o.v === 'object' && o.v) over = o.v
      if (o && typeof o.l === 'object' && o.l) {
        const l: Record<string, string> = {}
        if (typeof o.l.accent === 'string') l.accent = o.l.accent
        if (typeof o.l.font === 'string') l.font = o.l.font
        lookVal = Object.freeze(l) as Record<string, string>
      }
    }
  } catch {
    over = {}
  }
  const valueOf = (type: unknown, v: unknown): unknown => {
    if (type === 'number') {
      const n = typeof v === 'string' && v.trim() !== '' ? Number(v) : v
      return typeof n === 'number' && isFinite(n) ? n : undefined
    }
    if (typeof v !== 'string') return undefined
    if (type === 'color') return v === '' || /^#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.test(v) ? v : undefined
    return type === 'text' ? v.slice(0, 2000) : undefined
  }
  let paramsVal: unknown
  try {
    Object.defineProperty(w, '__params', {
      configurable: true,
      enumerable: true,
      get: () => paramsVal,
      set: (v: unknown) => {
        paramsVal = v
        if (!Array.isArray(v)) return
        const said: unknown[] = []
        for (let i = 0; i < v.length && i < 40; i++) {
          const it = v[i]
          if (!it || typeof it !== 'object') continue
          try {
            said.push({ key: String(it.key).slice(0, 40), label: String(it.label === undefined ? it.key : it.label).slice(0, 80), type: String(it.type).slice(0, 10), value: typeof it.value === 'number' ? it.value : String(it.value).slice(0, 2000), min: it.min, max: it.max, step: it.step })
            const k = String(it.key)
            if (Object.prototype.hasOwnProperty.call(over, k)) {
              const nv = valueOf(it.type, over[k])
              if (nv !== undefined) it.value = nv
            }
          } catch {
            /* that item as the page said it */
          }
        }
        rec.params = said
      }
    })
    Object.defineProperty(w, '__snippLook', {
      configurable: true,
      enumerable: false,
      get: () => {
        rec.look = true
        return lookVal
      },
      set: () => {}
    })
  } catch {
    /* a page without them */
  }

  // The clock (phase 5c, decision 1). Two modes:
  //   - passing through (every page first; the fast path stays so): the
  //     page's time is the real one; only which sources it uses is noted;
  //   - the app's clock (`?vt=1`, a page that drew without renderOut): Date,
  //     performance.now, animation frames, timers and idle callbacks follow
  //     the clock the host page moves (SnippClock), Math.random and
  //     crypto.getRandomValues give the same numbers on every load, GSAP's
  //     lag smoothing is off and the timelines in window.__timelines are
  //     sought to the frame's second.
  const perf = w.performance
  const realNow: () => number = perf && typeof perf.now === 'function' ? perf.now.bind(perf) : () => 0
  let virtual = false
  try {
    virtual = /(?:^|[?&])vt=1(?:&|$)/.test(String(w.location.search).replace(/^\?/, ''))
  } catch {
    virtual = false
  }
  /** On the app's clock: what the page's media elements do (phase 5d.2,
   *  decision 4; the media part below asks it). */
  let mediaCtl: { play: (el: any) => Promise<void>; pause: (el: any) => void; saw: (el: any) => void; paused: (el: any) => boolean | null } | null = null
  const seen: Record<string, true> = {}
  const use = (k: string): void => {
    if (!seen[k]) {
      seen[k] = true
      rec.uses.push(k)
    }
  }
  // What the page is still loading (the host waits for it to be quiet).
  let inflight = 0
  /** On the app's clock: a real source (the network, an event, an observer)
   *  came back to the page (5c + 5d audit, S-3); and what counts those
   *  events, put in last (after the guard's own listeners). */
  let realBack: (() => void) | null = null
  let realInstall: (() => void) | null = null
  let lastNet = realNow()
  try {
    Object.defineProperty(w, '__snippNet', {
      value: () => ({ inflight, quietMs: Math.max(0, realNow() - lastNet) }),
      enumerable: false,
      configurable: false,
      writable: false
    })
    if (typeof w.PerformanceObserver === 'function') {
      new w.PerformanceObserver((list: any) => {
        for (const e of list.getEntries()) lastNet = Math.max(lastNet, e.responseEnd || 0, realNow())
      }).observe({ type: 'resource', buffered: true })
    }
  } catch {
    /* the host then waits for the load event only */
  }
  try {
    const raf0 = w.requestAnimationFrame
    const caf0 = w.cancelAnimationFrame
    const st0 = w.setTimeout
    const si0 = w.setInterval
    const ct0 = w.clearTimeout
    const ci0 = w.clearInterval
    const ric0 = w.requestIdleCallback
    const cic0 = w.cancelIdleCallback
    const D0 = w.Date
    const rnd0 = w.Math.random
    const cr = w.crypto
    const grv0 = cr && cr.getRandomValues
    const uuid0 = cr && cr.randomUUID
    if (!virtual) {
      // Passing through: each source as it was, noted when first used.
      const pass = (obj: any, name: string, k: string, f0: any): void => {
        if (typeof f0 !== 'function') return
        obj[name] = function (this: any) {
          use(k)
          return f0.apply(this === undefined || this === w ? obj : this, arguments as any)
        }
      }
      pass(w, 'requestAnimationFrame', 'raf', raf0)
      pass(w, 'setTimeout', 'timer', st0)
      pass(w, 'setInterval', 'timer', si0)
      pass(w, 'requestIdleCallback', 'idle', ric0)
      pass(w.Math, 'random', 'random', rnd0)
      if (cr) pass(cr, 'getRandomValues', 'crypto', grv0)
      if (perf) {
        const pn0 = perf.now
        Object.defineProperty(perf, 'now', {
          configurable: true,
          writable: true,
          value: function () {
            use('perf')
            return pn0.call(perf)
          }
        })
      }
      const dn0 = D0.now
      D0.now = function () {
        use('date')
        return dn0.call(D0)
      }
    } else {
      // The app's clock.
      let now = 0
      // (A fixed calendar day: the same date on every load.)
      const BASE = 1767225600000
      let nextId = 1
      type Tm = { id: number; due: number; every: number; seq: number; cb: () => void }
      const timers = new Map<number, Tm>()
      let frames: { id: number; cb: (t: number) => void }[] = []
      let seq = 0
      const report = (e: unknown): void => {
        try {
          if (typeof w.reportError === 'function') w.reportError(e)
          else push(rec.errors, text(e))
        } catch {
          push(rec.errors, text(e))
        }
      }
      const callable = (cb: unknown): ((...x: unknown[]) => void) | null =>
        typeof cb === 'function'
          ? (cb as (...x: unknown[]) => void)
          : typeof cb === 'string'
            ? () => {
                ;(0, w.eval)(cb)
              }
            : null
      const addTimer = (cb: unknown, ms: unknown, every: boolean, args: unknown[]): number => {
        const f = callable(cb)
        const id = nextId++
        if (!f) return id
        const d = Math.max(0, +(ms as number) || 0)
        timers.set(id, { id, due: now + (every ? Math.max(1, d) : d), every: every ? Math.max(1, d) : 0, seq: seq++, cb: () => (f as (...x: unknown[]) => void).apply(w, args) })
        return id
      }
      w.setTimeout = function (cb: unknown, ms?: unknown, ...args: unknown[]) {
        use('timer')
        return addTimer(cb, ms, false, args)
      }
      w.setInterval = function (cb: unknown, ms?: unknown, ...args: unknown[]) {
        use('timer')
        return addTimer(cb, ms, true, args)
      }
      w.clearTimeout = w.clearInterval = function (id: unknown) {
        timers.delete(+(id as number))
      }
      w.requestIdleCallback = function (cb: unknown) {
        use('idle')
        const deadline = { didTimeout: false, timeRemaining: () => 50 }
        return addTimer(cb, 0, false, [deadline])
      }
      w.cancelIdleCallback = function (id: unknown) {
        timers.delete(+(id as number))
      }
      w.requestAnimationFrame = function (cb: unknown) {
        use('raf')
        const id = nextId++
        if (typeof cb === 'function') frames.push({ id, cb: cb as (t: number) => void })
        return id
      }
      w.cancelAnimationFrame = function (id: unknown) {
        frames = frames.filter((f) => f.id !== +(id as number))
      }
      void raf0
      void caf0
      void st0
      void si0
      void ct0
      void ci0
      void ric0
      void cic0
      if (perf) {
        Object.defineProperty(perf, 'now', {
          configurable: true,
          writable: true,
          value: function () {
            use('perf')
            return now
          }
        })
      }
      // Date: the clock's moment for "now"; any other date as it was.
      const D = function (this: any, ...a: unknown[]) {
        if (!new.target) return new D0(BASE + now).toString()
        return a.length ? Reflect.construct(D0, a, new.target) : Reflect.construct(D0, [BASE + now], new.target)
      } as any
      D.prototype = D0.prototype
      D.now = function () {
        use('date')
        return BASE + now
      }
      D.parse = D0.parse
      D.UTC = D0.UTC
      try {
        Object.defineProperty(D0.prototype, 'constructor', { value: D, configurable: true, writable: true, enumerable: false })
      } catch {
        /* kept */
      }
      w.Date = D
      // Chance: the same numbers on every load (sfc32, a fixed seed).
      let a = 0x9e3779b9
      let b = 0x243f6a88
      let c = 0xb7e15162
      let d = 1
      const next = (): number => {
        a >>>= 0
        b >>>= 0
        c >>>= 0
        d >>>= 0
        const t = (((a + b) | 0) + d) | 0
        d = (d + 1) | 0
        a = b ^ (b >>> 9)
        b = (c + (c << 3)) | 0
        c = (c << 21) | (c >>> 11)
        c = (c + t) | 0
        return (t >>> 0) / 4294967296
      }
      for (let i = 0; i < 12; i++) next()
      w.Math.random = function () {
        use('random')
        return next()
      }
      if (cr && typeof grv0 === 'function') {
        cr.getRandomValues = function (arr: any) {
          use('crypto')
          if (!arr || !arr.buffer) return grv0.call(cr, arr)
          const u8 = new Uint8Array(arr.buffer, arr.byteOffset, arr.byteLength)
          for (let i = 0; i < u8.length; i++) u8[i] = Math.floor(next() * 256)
          return arr
        }
        if (typeof uuid0 === 'function') {
          cr.randomUUID = function () {
            use('crypto')
            const h: string[] = []
            for (let i = 0; i < 16; i++) {
              let v = Math.floor(next() * 256)
              if (i === 6) v = (v & 0x0f) | 0x40
              if (i === 8) v = (v & 0x3f) | 0x80
              h.push((v + 256).toString(16).slice(1))
            }
            const s = h.join('')
            return s.slice(0, 8) + '-' + s.slice(8, 12) + '-' + s.slice(12, 16) + '-' + s.slice(16, 20) + '-' + s.slice(20)
          }
        }
      }
      let gsapDone: any = null
      const earliest = (ms: number): Tm | null => {
        let best: Tm | null = null
        for (const t of timers.values()) if (t.due <= ms + 1e-9 && (!best || t.due < best.due || (t.due === best.due && t.seq < best.seq))) best = t
        return best
      }
      // ---- CSS / Web Animations / media / SMIL on the clock (phase 5d.2,
      // decision 4). Each animation is born the moment it is first seen at a
      // clock step (the page's stylesheet ones at 0; a transition started
      // by a timer at that timer's time), held paused, and at every frame
      // set to (now − birth) × rate. An animation first seen between steps
      // (started by a load, a network answer, an animation event) is
      // counted `late`: its birth depends on when it was looked at.
      const doc = w.document
      const AP = w.Animation && w.Animation.prototype
      const aPause: any = AP && AP.pause
      const aPlay: any = AP && AP.play
      const aFinish: any = AP && AP.finish
      const aReverse: any = AP && AP.reverse
      const ctD = AP && Object.getOwnPropertyDescriptor(AP, 'currentTime')
      const stD = AP && Object.getOwnPropertyDescriptor(AP, 'startTime')
      // (rate: the page's own playbackRate change, from that moment on: S-5.)
      // (css: a CSS animation, whose `animation-play-state` is read at every
      // step; cssHeld: that says paused, it stands at c0: S-2.)
      type Ar = { t0: number; c0: number; own: boolean; held: boolean; done: boolean; rate?: number; css?: boolean; cssHeld?: boolean }
      const anims = new WeakMap<any, Ar>()
      let lateN = 0
      let looked = false
      const roots: any[] = []
      const curOf = (a: any): number => {
        try {
          const v = ctD && ctD.get ? ctD.get.call(a) : a.currentTime
          return typeof v === 'number' && Number.isFinite(v) ? v : 0
        } catch {
          return 0
        }
      }
      const setCur = (a: any, v: number): void => {
        if (ctD && ctD.set) ctD.set.call(a, v)
        else a.currentTime = v
      }
      const rateOf = (a: any): number => {
        const r = +a.playbackRate
        return Number.isFinite(r) ? r : 1
      }
      const endOf = (a: any): number => {
        try {
          return +a.effect.getComputedTiming().endTime
        } catch {
          return Infinity
        }
      }
      /** From its moment now on, it goes on at its rate. */
      const rebase = (a: any, r: Ar): void => {
        r.t0 = now
        r.c0 = curOf(a)
      }
      const allAnims = (): any[] => {
        if (!doc || typeof doc.getAnimations !== 'function') return []
        const list: any[] = doc.getAnimations()
        if (!roots.length) return list
        const have = new Set(list)
        for (const root of roots) {
          try {
            for (const a of root.getAnimations()) {
              if (have.has(a)) continue
              have.add(a)
              list.push(a)
            }
          } catch {
            /* gone */
          }
        }
        return list
      }
      /** A CSS animation's play state as its element's computed style says
       *  (its own entry of the `animation-name` list; a pseudo-element's
       *  too); null for any other animation, or when it cannot be read. */
      const cssState = (a: any): 'paused' | 'running' | null => {
        try {
          const name = a.animationName
          const eff = a.effect
          const el = eff && eff.target
          if (typeof name !== 'string' || !el || typeof w.getComputedStyle !== 'function') return null
          const cs = w.getComputedStyle(el, eff.pseudoElement || null)
          const names = String(cs.animationName)
            .split(',')
            .map((x: string) => x.trim().replace(/^["']|["']$/g, ''))
          const states = String(cs.animationPlayState)
            .split(',')
            .map((x: string) => x.trim())
          const i = names.lastIndexOf(name)
          if (i < 0 || !states.length) return null
          return states[i % states.length] === 'paused' ? 'paused' : 'running'
        } catch {
          return null
        }
      }
      /** New animations taken on: born at `at` (steady: at a clock step). */
      const scan = (at: number, steady: boolean): any[] => {
        let list: any[] = []
        try {
          list = allAnims()
        } catch {
          return []
        }
        for (const a of list) {
          if (anims.has(a)) continue
          let paused = false
          try {
            paused = a.playState === 'paused'
          } catch {
            paused = false
          }
          const rate = rateOf(a)
          // A CSS animation: its stylesheet's play state rules it, read at
          // every step (5c + 5d audit, S-2: one that started paused and was
          // set running later ran in real time).
          const css = cssState(a)
          if (css !== null) {
            const held = css === 'paused'
            anims.set(a, { t0: at, c0: held || rate < 0 ? curOf(a) : 0, own: false, held: false, done: false, css: true, cssHeld: held })
            if (!held && !steady && looked) lateN++
            continue
          }
          // (Paused by the page itself when first seen: it is the page's to
          // move.)
          anims.set(a, { t0: at, c0: rate < 0 ? curOf(a) : 0, own: paused, held: false, done: false })
          if (!paused && !steady && looked) lateN++
        }
        return list
      }
      /** Every animation the clock holds, set to its moment `ms`. */
      const seekAnims = (ms: number, list: any[]): void => {
        for (const a of list) {
          const r = anims.get(a)
          if (!r || r.own || r.done) continue
          try {
            const rate = r.rate ?? rateOf(a)
            // (A CSS animation's `animation-play-state`, as its stylesheet
            // says now: paused, it stays where it stands; running again, it
            // goes on from there.)
            if (r.css) {
              const st = cssState(a)
              if (st === 'paused' && !r.cssHeld) {
                r.c0 = r.c0 + (ms - r.t0) * rate
                r.t0 = ms
                r.cssHeld = true
              } else if (st === 'running' && r.cssHeld) {
                r.t0 = ms
                r.cssHeld = false
              }
            }
            const local = r.cssHeld ? r.c0 : r.c0 + (ms - r.t0) * rate
            const end = endOf(a)
            if (Number.isFinite(end) && ((rate > 0 && local >= end) || (rate < 0 && local <= 0))) {
              // Over: finished (its end events and promise, as when it runs).
              r.done = true
              aFinish.call(a)
              continue
            }
            if (a.playState !== 'paused') aPause.call(a)
            r.held = true
            setCur(a, Math.max(0, local))
          } catch {
            /* an animation that cannot be held: left as it is */
          }
        }
      }
      // The page's own calls take an animation off the clock (pause), put it
      // back on it from where it stands (play, reverse, a new current time),
      // or end it (finish).
      if (AP && typeof aPause === 'function' && typeof aPlay === 'function') {
        try {
          AP.pause = function (this: any) {
            const r = anims.get(this)
            if (r) r.own = true
            else anims.set(this, { t0: now, c0: 0, own: true, held: false, done: false })
            return aPause.apply(this, arguments as any)
          }
          AP.play = function (this: any) {
            const x = aPlay.apply(this, arguments as any)
            const r = anims.get(this)
            if (r) {
              r.own = false
              r.done = false
              // (Running now by the page's word, not by itself.)
              r.held = false
              rebase(this, r)
            }
            return x
          }
          if (typeof aReverse === 'function') {
            AP.reverse = function (this: any) {
              const x = aReverse.apply(this, arguments as any)
              const r = anims.get(this)
              if (r) {
                r.rate = undefined
                r.own = false
                r.done = false
                r.held = false
                rebase(this, r)
              }
              return x
            }
          }
          if (typeof aFinish === 'function') {
            AP.finish = function (this: any) {
              const x = aFinish.apply(this, arguments as any)
              const r = anims.get(this)
              if (r) r.done = true
              return x
            }
          }
          if (ctD && ctD.get && ctD.set) {
            Object.defineProperty(AP, 'currentTime', {
              configurable: true,
              enumerable: ctD.enumerable,
              get: ctD.get,
              set(this: any, v: unknown) {
                ctD.set!.call(this, v)
                const r = anims.get(this)
                if (r && !r.own) {
                  r.done = false
                  rebase(this, r)
                }
              }
            })
          }
          // The page's own change of rate (5c + 5d audit, S-5): from its
          // moment now on; the time already past keeps the rate it had.
          const newRate = (a: any, v: unknown): void => {
            const r = anims.get(a)
            const n = +(v as number)
            if (!r || r.done || !Number.isFinite(n)) return
            if (!r.own && !r.cssHeld) r.c0 = r.c0 + (now - r.t0) * (r.rate ?? rateOf(a))
            r.t0 = now
            r.rate = n
          }
          const prD = Object.getOwnPropertyDescriptor(AP, 'playbackRate')
          if (prD && prD.get && prD.set) {
            Object.defineProperty(AP, 'playbackRate', {
              configurable: true,
              enumerable: prD.enumerable,
              get: prD.get,
              set(this: any, v: unknown) {
                newRate(this, v)
                prD.set!.call(this, v)
              }
            })
          }
          const aUpd: any = AP.updatePlaybackRate
          if (typeof aUpd === 'function') {
            AP.updatePlaybackRate = function (this: any, v: unknown) {
              newRate(this, v)
              return aUpd.apply(this, arguments as any)
            }
          }
          if (stD && stD.get && stD.set) {
            // A start time the page sets is on the clock's timeline (it read
            // document.timeline.currentTime: the clock's now).
            const tlD = w.AnimationTimeline && Object.getOwnPropertyDescriptor(w.AnimationTimeline.prototype, 'currentTime')
            Object.defineProperty(AP, 'startTime', {
              configurable: true,
              enumerable: stD.enumerable,
              get: stD.get,
              set(this: any, v: unknown) {
                const real = tlD && tlD.get && this.timeline ? tlD.get.call(this.timeline) : null
                const n = typeof v === 'number' && Number.isFinite(v) ? v : null
                stD.set!.call(this, n !== null && typeof real === 'number' ? real - (now - n) : v)
                if (n === null) return
                let r = anims.get(this)
                if (!r) {
                  r = { t0: now, c0: 0, own: false, held: false, done: false }
                  anims.set(this, r)
                }
                r.own = false
                r.done = false
                r.held = false
                r.t0 = now
                r.c0 = (now - n) * rateOf(this)
              }
            })
          }
        } catch {
          /* left as they were */
        }
      }
      try {
        if (doc && doc.timeline) Object.defineProperty(doc.timeline, 'currentTime', { get: () => now, configurable: true })
      } catch {
        /* the real timeline's time */
      }
      // Shadow roots (closed ones too): their animations are not the
      // document's.
      try {
        const EP = w.Element && w.Element.prototype
        const as0 = EP && EP.attachShadow
        if (typeof as0 === 'function') {
          EP.attachShadow = function (this: any) {
            const root = as0.apply(this, arguments as any)
            if (roots.length < 1000) roots.push(root)
            return root
          }
        }
      } catch {
        /* open roots only, through the document */
      }
      // SMIL: each outermost <svg>'s own timeline, paused, set to the clock.
      const svgBirth = new WeakMap<any, number>()
      const seekSvg = (ms: number): void => {
        try {
          const list = doc && doc.getElementsByTagName ? doc.getElementsByTagName('svg') : []
          for (let i = 0; i < list.length; i++) {
            const s = list[i]
            if (s.ownerSVGElement || typeof s.setCurrentTime !== 'function') continue
            let b = svgBirth.get(s)
            if (b === undefined) {
              b = now
              svgBirth.set(s, b)
              s.pauseAnimations()
            }
            s.setCurrentTime(Math.max(0, ms - b) / 1000)
          }
        } catch {
          /* no SVG */
        }
      }
      // Media: a <video> / <audio> the page plays is not played; it is set
      // to its moment at each drawn frame (and that seek awaited).
      type Mr = { playing: boolean; t0: number; c0: number }
      const media = new Map<any, Mr>()
      const MPv = w.HTMLMediaElement && w.HTMLMediaElement.prototype
      const mPause: any = MPv && MPv.pause
      const mCt = MPv && Object.getOwnPropertyDescriptor(MPv, 'currentTime')
      const mPausedD = MPv && Object.getOwnPropertyDescriptor(MPv, 'paused')
      const mTime = (el: any): number => {
        try {
          const v = mCt && mCt.get ? mCt.get.call(el) : el.currentTime
          return Number.isFinite(v) ? v : 0
        } catch {
          return 0
        }
      }
      const mAt = (el: any, r: Mr, ms: number): number => {
        let t = r.playing ? r.c0 + ((ms - r.t0) / 1000) * (+el.playbackRate || 1) : r.c0
        const d = +el.duration
        if (Number.isFinite(d) && d > 0) t = el.loop ? ((t % d) + d) % d : Math.min(t, d)
        return Math.max(0, t)
      }
      const realPause = (el: any): void => {
        try {
          const p = mPausedD && mPausedD.get ? mPausedD.get.call(el) : el.paused
          if (!p && typeof mPause === 'function') mPause.call(el)
        } catch {
          /* not a media element */
        }
      }
      if (MPv) {
        mediaCtl = {
          play(el) {
            const r = media.get(el)
            if (!r || !r.playing) {
              if (media.size >= 200 && !r) return Promise.resolve()
              const ended = +el.duration > 0 && mTime(el) >= +el.duration && !el.loop
              media.set(el, { playing: true, t0: now, c0: ended ? 0 : r ? r.c0 : mTime(el) })
            }
            realPause(el)
            return Promise.resolve()
          },
          pause(el) {
            const r = media.get(el)
            if (r && r.playing) {
              r.c0 = mAt(el, r, now)
              r.t0 = now
              r.playing = false
            }
          },
          // Started by itself (autoplay): from its start, now.
          saw(el) {
            const r = media.get(el)
            if (!r || !r.playing) {
              if (media.size < 200 || r) media.set(el, { playing: true, t0: now, c0: r ? r.c0 : 0 })
            }
            realPause(el)
          },
          paused(el) {
            const r = media.get(el)
            return r ? !r.playing : null
          }
        }
      }
      // An element that cannot be played (it failed to load, or has no
      // source) is not waited for; it, and one whose seek or length did not
      // come within 3 s, is written down once in the page's errors (5c + 5d
      // audit, S-7: a video that could not load held every frame 6 s, said
      // nothing, and was drawn empty).
      // (The guard's own listeners: never counted as the page's, S-3.)
      const ET0 = w.EventTarget && w.EventTarget.prototype
      const ael0: any = ET0 && ET0.addEventListener
      const rel0: any = ET0 && ET0.removeEventListener
      const on0 = (el: any, t: string, f: () => void): void => (typeof ael0 === 'function' ? ael0.call(el, t, f) : el.addEventListener(t, f))
      const off0 = (el: any, t: string, f: () => void): void => (typeof rel0 === 'function' ? rel0.call(el, t, f) : el.removeEventListener(t, f))
      const told = new WeakSet<any>()
      const tell = (el: any, what: string): void => {
        if (told.has(el)) return
        told.add(el)
        let src = ''
        try {
          src = String(el.currentSrc || el.src || '')
        } catch {
          src = ''
        }
        push(rec.errors, 'media ' + what + ': ' + (src || 'an element without a source'))
      }
      const broken = (el: any): boolean => {
        try {
          return !!el.error || +el.networkState === 3
        } catch {
          return false
        }
      }
      const seekMedia = (ms: number): Promise<void> => {
        const jobs: Promise<void>[] = []
        for (const [el, r] of media) {
          realPause(el)
          if (broken(el)) {
            tell(el, 'could not be played')
            continue
          }
          const go = (): Promise<void> =>
            new Promise<void>((res) => {
              const target = mAt(el, r, ms)
              if (Math.abs(mTime(el) - target) < 0.0005 && !el.seeking) return res()
              let timer: any = null
              const done = (): void => {
                off0(el, 'seeked', done)
                off0(el, 'error', failed)
                if (timer !== null) ct0.call(w, timer)
                res()
              }
              const failed = (): void => {
                tell(el, 'could not be played')
                done()
              }
              timer = st0.call(
                w,
                () => {
                  tell(el, 'did not seek within 3 s')
                  done()
                },
                3000
              )
              on0(el, 'seeked', done)
              on0(el, 'error', failed)
              try {
                if (mCt && mCt.set) mCt.set.call(el, target)
                else el.currentTime = target
              } catch {
                done()
              }
            })
          if (+el.readyState >= 1) jobs.push(go())
          else
            jobs.push(
              new Promise<void>((res) => {
                // (Not even its length known yet: waited for, a little; not
                // at all once it fails.)
                let timer: any = null
                const off = (): void => {
                  off0(el, 'loadedmetadata', ok)
                  off0(el, 'error', failed)
                  if (timer !== null) ct0.call(w, timer)
                }
                const ok = (): void => {
                  off()
                  go().then(res, res)
                }
                const failed = (): void => {
                  off()
                  tell(el, 'could not be played')
                  res()
                }
                timer = st0.call(
                  w,
                  () => {
                    off()
                    tell(el, 'had no length within 3 s')
                    res()
                  },
                  3000
                )
                on0(el, 'loadedmetadata', ok)
                on0(el, 'error', failed)
              })
            )
        }
        return jobs.length ? Promise.all(jobs).then(() => undefined) : Promise.resolve()
      }
      /** Everything on the clock at `ms`: animations (new ones born at `at`,
       *  steady or not) and SVG timelines. */
      const hold = (ms: number, at: number, steady: boolean): void => {
        seekAnims(ms, scan(at, steady))
        seekSvg(ms)
      }

      const clock: SnippClock = {
        now: () => now,
        due: (ms) => !!earliest(ms),
        settle() {
          hold(now, now, true)
          looked = true
        },
        media: (ms) => seekMedia(ms),
        late: () => lateN,
        timer(ms, jump) {
          const t = earliest(ms)
          if (!t) return false
          // (Anything new since the last step was made away from the clock.)
          scan(now, false)
          now = Math.max(now, jump ? ms : t.due)
          if (t.every) {
            t.due = jump ? now + t.every : t.due + t.every
            t.seq = seq++
          } else timers.delete(t.id)
          try {
            t.cb()
          } catch (e) {
            report(e)
          }
          return true
        },
        frame(ms, sec) {
          scan(now, false)
          now = ms
          // CSS / Web Animations / SMIL at this moment, before the page's
          // own callbacks read or change them.
          hold(ms, ms, true)
          try {
            const gs = w.gsap
            if (gs && gs !== gsapDone && gs.ticker && typeof gs.ticker.lagSmoothing === 'function') {
              gs.ticker.lagSmoothing(0)
              gsapDone = gs
            }
          } catch {
            /* not GSAP */
          }
          try {
            const tls = w.__timelines
            const list = Array.isArray(tls) ? tls : tls && typeof tls === 'object' ? Object.keys(tls).map((k) => tls[k]) : []
            for (const tl of list) {
              if (!tl || typeof tl.seek !== 'function') continue
              if (typeof tl.paused === 'function' && !tl.paused()) tl.pause()
              tl.seek(sec, false)
            }
          } catch (e) {
            report(e)
          }
          const run = frames
          frames = []
          for (const f of run) {
            try {
              f.cb(ms)
            } catch (e) {
              report(e)
            }
          }
          // (Started by those callbacks: born now, held at once.)
          if (run.length) hold(ms, ms, true)
          return run.length
        },
        pending: () => ({ frames: frames.length, timers: timers.size })
      }
      void aPlay
      Object.defineProperty(w, '__snippClock', { value: clock, enumerable: false, configurable: false, writable: false })

      // ---- Starts the clock does not drive (5c + 5d audit, S-3). Once the
      // host has looked at the page (its first frame), a real source coming
      // back to the page is counted late: its effect lands at a moment that
      // depends on real time, so the same frame may differ from one way of
      // reaching it to another ("unstable"). Counted where it comes back:
      // a fetch answer (above), a trusted event of these types reaching a
      // listener or an on- handler of the page, an IntersectionObserver /
      // ResizeObserver callback. Not counted: the page's own events
      // (isTrusted false), its window's script errors and load, a message
      // it posted to itself or on its own MessageChannel (schedulers), the
      // media events the clock's own seeking makes (seeking, seeked,
      // timeupdate, ended), anything before the first look.
      realBack = () => {
        if (looked) lateN++
      }
      const REAL = ['load', 'error', 'loadend', 'readystatechange', 'message', 'animationstart', 'animationend', 'animationiteration', 'animationcancel', 'transitionrun', 'transitionstart', 'transitionend', 'transitioncancel', 'loadedmetadata', 'loadeddata', 'canplay', 'canplaythrough']
      const counts = (type: string, e: any, at: any): boolean => {
        if (!looked || !e || e.isTrusted !== true) return false
        if (at === w && (type === 'error' || type === 'load')) return false
        if (type === 'message') {
          if (w.MessagePort && at instanceof w.MessagePort) return false
          if (at === w && (!e.source || e.source === w)) return false
        }
        return true
      }
      realInstall = () => {
        const ET = w.EventTarget && w.EventTarget.prototype
        if (ET && typeof ET.addEventListener === 'function') {
          const add0 = ET.addEventListener
          const rem0 = ET.removeEventListener
          const wrapped = new WeakMap<any, Map<string, any>>()
          const keyOf = (type: string, opt: any): string => type + '|' + (opt === true || (opt && opt.capture) ? 1 : 0)
          ET.addEventListener = function (this: any, type: unknown, f: any, opt?: any) {
            const t = String(type)
            if (REAL.indexOf(t) < 0 || !f || (typeof f !== 'function' && typeof f.handleEvent !== 'function')) return add0.apply(this, arguments as any)
            let m = wrapped.get(f)
            if (!m) {
              m = new Map()
              wrapped.set(f, m)
            }
            const k = keyOf(t, opt)
            let g = m.get(k)
            if (!g) {
              g = function (this: any, e: any) {
                if (counts(t, e, this)) lateN++
                return typeof f === 'function' ? f.apply(this, arguments as any) : f.handleEvent(e)
              }
              m.set(k, g)
            }
            return add0.call(this, t, g, opt)
          }
          ET.removeEventListener = function (this: any, type: unknown, f: any, opt?: any) {
            const g = f && wrapped.get(f) && wrapped.get(f)!.get(keyOf(String(type), opt))
            return g ? rem0.call(this, type, g, opt) : rem0.apply(this, arguments as any)
          }
        }
        // on- handlers (an image's onload, an element's onanimationend, an
        // XHR's onreadystatechange, a worker's onmessage).
        const protos: any[] = []
        for (const k of ['HTMLElement', 'SVGElement', 'Document', 'Window', 'XMLHttpRequestEventTarget', 'XMLHttpRequest', 'Worker']) {
          const C = w[k]
          if (C && C.prototype) protos.push(C.prototype)
        }
        for (const P of protos) {
          for (const t of REAL) {
            const n = 'on' + t
            const d = Object.getOwnPropertyDescriptor(P, n)
            if (!d || !d.set || !d.get || !d.configurable) continue
            const mine = new WeakMap<any, any>()
            Object.defineProperty(P, n, {
              configurable: true,
              enumerable: d.enumerable,
              get(this: any) {
                const g = d.get!.call(this)
                return g && mine.has(this) && mine.get(this).g === g ? mine.get(this).f : g
              },
              set(this: any, f: unknown) {
                if (typeof f !== 'function') {
                  mine.delete(this)
                  return d.set!.call(this, f)
                }
                const g = function (this: any, e: any) {
                  if (counts(t, e, this)) lateN++
                  return (f as (...x: unknown[]) => unknown).apply(this, arguments as any)
                }
                mine.set(this, { f, g })
                return d.set!.call(this, g)
              }
            })
          }
        }
        // Observers whose callbacks come at the browser's own moments.
        for (const k of ['IntersectionObserver', 'ResizeObserver']) {
          const O0 = w[k]
          if (typeof O0 !== 'function') continue
          const O = function (this: any, cb: any, opts?: any) {
            const g =
              typeof cb === 'function'
                ? function (this: any) {
                    if (looked) lateN++
                    return cb.apply(this, arguments as any)
                  }
                : cb
            return Reflect.construct(O0, [g, opts], new.target || O)
          } as any
          O.prototype = O0.prototype
          try {
            Object.defineProperty(O0.prototype, 'constructor', { value: O, configurable: true, writable: true, enumerable: false })
          } catch {
            /* kept */
          }
          w[k] = O
        }
      }
    }
  } catch {
    /* left as it was */
  }

  // The page's own boxes open nothing.
  const box = (kind: string, answer: unknown) =>
    function (msg?: unknown): unknown {
      push(rec.dialogs, kind + ': ' + (msg === undefined ? '' : String(msg)))
      return answer
    }
  try {
    w.alert = box('alert', undefined)
    w.confirm = box('confirm', false)
    w.prompt = box('prompt', null)
    w.print = box('print', undefined)
    const open0 = w.open
    w.open = function (): null {
      rec.opened++
      void open0
      return null
    }
  } catch {
    /* not writable */
  }

  // No sound from media elements: muted from the moment they exist, and kept so.
  const MP = w.HTMLMediaElement && w.HTMLMediaElement.prototype
  const mutedD = MP && Object.getOwnPropertyDescriptor(MP, 'muted')
  const hush = (el: any): void => {
    try {
      if (mutedD && mutedD.set) mutedD.set.call(el, true)
    } catch {
      /* not a media element */
    }
  }
  if (MP && mutedD && mutedD.get && mutedD.set) {
    try {
      Object.defineProperty(MP, 'muted', {
        configurable: true,
        enumerable: mutedD.enumerable,
        get(this: any) {
          return mutedD.get!.call(this)
        },
        set(this: any) {
          hush(this)
        }
      })
      const play0 = MP.play
      MP.play = function (this: any) {
        hush(this)
        rec.media++
        // (On the app's clock: not played, set to its moment at each frame.)
        if (mediaCtl) return mediaCtl.play(this)
        return play0.apply(this, arguments as any)
      }
      if (mediaCtl) {
        const ctl = mediaCtl
        const pause0 = MP.pause
        MP.pause = function (this: any) {
          ctl.pause(this)
          return pause0.apply(this, arguments as any)
        }
        const pausedD = Object.getOwnPropertyDescriptor(MP, 'paused')
        if (pausedD && pausedD.get) {
          Object.defineProperty(MP, 'paused', {
            configurable: true,
            enumerable: pausedD.enumerable,
            get(this: any) {
              const p = ctl.paused(this)
              return p === null ? pausedD.get!.call(this) : p
            }
          })
        }
      }
      const load0 = MP.load
      MP.load = function (this: any) {
        hush(this)
        return load0.apply(this, arguments as any)
      }
      if (typeof MP.setSinkId === 'function') {
        MP.setSinkId = function () {
          return Promise.resolve()
        }
      }
    } catch {
      /* left as it was */
    }
    // Made by the page (new Audio, createElement), parsed from the page, or
    // started by `autoplay`: muted before a sound can come out.
    try {
      const A0 = w.Audio
      if (typeof A0 === 'function') {
        const A = function (this: any, src?: string) {
          const el = src === undefined ? new A0() : new A0(src)
          hush(el)
          return el
        } as any
        A.prototype = A0.prototype
        w.Audio = A
      }
      const doc = w.document
      const ce0 = doc.createElement
      doc.createElement = function (this: any) {
        const el = ce0.apply(this, arguments as any)
        if (MP.isPrototypeOf(el)) hush(el)
        return el
      }
      const sweep = (n: any): void => {
        if (!n || n.nodeType !== 1) return
        if (MP.isPrototypeOf(n)) hush(n)
        if (n.querySelectorAll) for (const m of n.querySelectorAll('audio,video')) hush(m)
      }
      new w.MutationObserver((list: any[]) => {
        for (const r of list) for (const n of r.addedNodes) sweep(n)
      }).observe(doc, { childList: true, subtree: true })
      doc.addEventListener(
        'play',
        (e: any) => {
          hush(e.target)
          // (Started by itself, autoplay, on the app's clock: held, set to
          // its moment at each frame.)
          if (mediaCtl && MP.isPrototypeOf(e.target)) mediaCtl.saw(e.target)
        },
        true
      )
      doc.addEventListener('loadstart', (e: any) => hush(e.target), true)
    } catch {
      /* no document */
    }
  }

  // No sound from Web Audio: every AudioContext plays into no device.
  try {
    const AC0 = w.AudioContext || w.webkitAudioContext
    if (typeof AC0 === 'function') {
      const ACP = AC0.prototype
      const Silent = function (this: any, opts?: any) {
        const o = Object.assign({}, opts || {}, { sinkId: { type: 'none' } })
        let ctx: any
        try {
          ctx = new AC0(o)
        } catch {
          ctx = new AC0()
        }
        rec.audio++
        return ctx
      } as any
      Silent.prototype = ACP
      if (typeof ACP.setSinkId === 'function') {
        ACP.setSinkId = function () {
          return Promise.resolve()
        }
      }
      w.AudioContext = Silent
      if (w.webkitAudioContext) w.webkitAudioContext = Silent
    }
  } catch {
    /* left as it was */
  }

  // What went wrong, written down.
  try {
    const con = w.console
    const err0 = con.error
    // (Audit D8a: what the page itself logs is written down as a fact, not
    // counted as an error of the page; a script that could not load is told
    // apart — a page may carry a local copy beside a CDN address.)
    con.error = function (...args: unknown[]) {
      push(rec.errors, CONSOLE_LINE + args.map(text).join(' '), false)
      return err0.apply(this, args)
    }
    w.addEventListener(
      'error',
      (e: any) => {
        const t = e && e.target
        if (t && t !== w && t.nodeType === 1) push(rec.failed, (String(t.tagName).toUpperCase() === 'SCRIPT' ? SCRIPT_LINE : '') + (t.currentSrc || t.src || t.href || t.tagName))
        else push(rec.errors, (e.error ? text(e.error) : e.message) + (e.filename ? ' (' + e.filename + ':' + e.lineno + ')' : ''))
      },
      true
    )
    w.addEventListener('unhandledrejection', (e: any) => push(rec.errors, 'unhandled rejection: ' + text(e.reason)))
    w.document.addEventListener('securitypolicyviolation', (e: any) => push(rec.blocked, e.blockedURI || e.violatedDirective))
    const fetch0 = w.fetch
    if (typeof fetch0 === 'function') {
      w.fetch = function (this: any, input: any) {
        const p = fetch0.apply(this, arguments as any)
        inflight++
        lastNet = realNow()
        const done = (): void => {
          inflight = Math.max(0, inflight - 1)
          lastNet = realNow()
        }
        p.then(
          () => {
            done()
            if (realBack) realBack()
          },
          () => {
            done()
            if (realBack) realBack()
            push(rec.failed, input && input.url ? input.url : String(input))
          }
        )
        return p
      }
    }
  } catch {
    /* left as it was */
  }

  // The WebGL contexts the page made (5a/5b patch, audit C-4): the host page
  // asks each, after a draw, whether it was lost (a lost context draws
  // nothing, and the frame would be black). Only contexts: getContext is
  // called as the page called it, nothing else changes.
  try {
    const CP = w.HTMLCanvasElement && w.HTMLCanvasElement.prototype
    const gc0 = CP && CP.getContext
    if (typeof gc0 === 'function') {
      const gl: any[] = []
      CP.getContext = function (this: any, type: unknown) {
        const x = gc0.apply(this, arguments as any)
        if (x && /webgl/i.test(String(type)) && gl.indexOf(x) < 0) {
          if (gl.length >= 64) gl.shift()
          gl.push(x)
        }
        return x
      }
      Object.defineProperty(w, '__snippGL', { value: () => gl.slice(), enumerable: false, configurable: false, writable: false })
    }
  } catch {
    /* left as it was */
  }

  // (On the app's clock: what counts the page's real sources, last, so that
  // none of the guard's own listeners is counted. S-3.)
  try {
    if (realInstall) realInstall()
  } catch {
    /* not counted */
  }

  // A same-origin child frame the page reaches into gets the guard too.
  try {
    const IP = w.HTMLIFrameElement && w.HTMLIFrameElement.prototype
    const cw = IP && Object.getOwnPropertyDescriptor(IP, 'contentWindow')
    const cd = IP && Object.getOwnPropertyDescriptor(IP, 'contentDocument')
    const self = guardMain
    if (cw && cw.get) {
      Object.defineProperty(IP, 'contentWindow', {
        configurable: true,
        enumerable: cw.enumerable,
        get(this: any) {
          const win = cw.get!.call(this)
          try {
            if (win && !win.__snippGuard) self(win)
          } catch {
            /* another origin */
          }
          return win
        }
      })
    }
    if (cd && cd.get) {
      Object.defineProperty(IP, 'contentDocument', {
        configurable: true,
        enumerable: cd.enumerable,
        get(this: any) {
          const d = cd.get!.call(this)
          try {
            if (d && d.defaultView && !d.defaultView.__snippGuard) self(d.defaultView)
          } catch {
            /* another origin */
          }
          return d
        }
      })
    }
  } catch {
    /* left as it was */
  }
}

/** guard.js, whole. */
export const GUARD_JS = `(${guardMain.toString()})(window);\n`
