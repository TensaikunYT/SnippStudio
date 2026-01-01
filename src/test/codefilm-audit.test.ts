// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// The 5c + 5d audit patch (FAZ5-PLAN.md "5c + 5d denetim yaması";
// haritalar\_faz5-denetim-kare.md, -saat.md, -yasam.md). Each test fails
// without the part it is about. What only a real page shows is in e2e 65,
// 79 and 80.
import './dom-stub'
import assert from 'node:assert/strict'
import test from 'node:test'
import { chanceAtLoad, mayLoadAtScale, samePicture } from '../renderer/src/media/codefilm-limits'
import { guardMain, type SnippClock } from '../main/codefilm-guard'

// ---- K1: a fast-path page with chance at load is not loaded again blindly ----

test('K1: chance or the clock read while loading is "chance at load"', () => {
  assert.equal(chanceAtLoad(['raf', 'random']), true)
  assert.equal(chanceAtLoad(['crypto']), true)
  assert.equal(chanceAtLoad(['date']), true)
  assert.equal(chanceAtLoad(['perf', 'raf']), true)
  assert.equal(chanceAtLoad(['raf', 'timer', 'idle']), false)
  assert.equal(chanceAtLoad([]), false)
  assert.equal(chanceAtLoad(undefined), false)
})

test('K1: an export loads a page again at its scale only when that cannot change its picture, or was checked', () => {
  // On the app's clock: the same on every load.
  assert.equal(mayLoadAtScale('canvas', null, undefined), true)
  assert.equal(mayLoadAtScale('page', null, undefined), true)
  // Fast path, no chance at load.
  assert.equal(mayLoadAtScale('fast', false, undefined), true)
  // Fast path with chance at load, or not known yet: not before the check.
  assert.equal(mayLoadAtScale('fast', true, undefined), false)
  assert.equal(mayLoadAtScale(undefined, null, undefined), false)
  assert.equal(mayLoadAtScale('fast', null, undefined), false)
  // The check's verdict decides.
  assert.equal(mayLoadAtScale('fast', true, true), true)
  assert.equal(mayLoadAtScale('fast', true, false), false)
  assert.equal(mayLoadAtScale('canvas', null, false), false)
})

test('K1: the same picture is phase 5c’s margin (≤ 0.5 % of the pixels beyond 28 / 255)', () => {
  const a = new Uint8ClampedArray(4 * 1000)
  const b = new Uint8ClampedArray(a)
  assert.equal(samePicture(a, b), true)
  for (let i = 0; i < 5; i++) b[i * 4] = 29
  assert.equal(samePicture(a, b), true, '5 of 1000 pixels: within')
  b[5 * 4 + 1] = 200
  assert.equal(samePicture(a, b), false, '6 of 1000: not')
  assert.equal(samePicture(a, new Uint8ClampedArray(8)), false, 'other sizes')
})

// ---- stand-ins for the guard on the app's clock (as codefilm-time.test.ts) ----

/** An animation as the browser keeps it; a CSS animation has a name and a
 *  target whose computed `animation-play-state` the test sets. */
class FakeAnim {
  static live: FakeAnim[] = []
  playState: 'running' | 'paused' | 'finished' = 'running'
  private rate = 1
  private ct = 0
  effect: { target: any; pseudoElement: string | null; getComputedTiming: () => { endTime: number } }
  timeline = null
  animationName?: string
  constructor(end = Infinity, css?: { name: string; el: any }) {
    this.effect = { target: css ? css.el : null, pseudoElement: null, getComputedTiming: () => ({ endTime: end }) }
    if (css) this.animationName = css.name
    FakeAnim.live.push(this)
  }
  get playbackRate(): number {
    return this.rate
  }
  set playbackRate(v: number) {
    this.rate = v
  }
  updatePlaybackRate(v: number): void {
    this.rate = v
  }
  get currentTime(): number {
    return this.ct
  }
  set currentTime(v: number) {
    this.ct = v
  }
  get startTime(): number | null {
    return null
  }
  set startTime(_v: number | null) {}
  pause(): void {
    this.playState = 'paused'
  }
  play(): void {
    this.playState = 'running'
  }
  reverse(): void {
    this.rate = -this.rate
  }
  finish(): void {
    this.ct = this.effect.getComputedTiming().endTime
    this.playState = 'finished'
  }
  static tick(ms: number): void {
    for (const a of FakeAnim.live) if (a.playState === 'running') a.ct += ms * a.rate
  }
}

class FakeMedia {
  playbackRate = 1
  loop = false
  duration = NaN
  readyState = 0
  networkState = 2
  error: { code: number } | null = null
  seeking = false
  src = 'broken.mp4'
  currentSrc = 'broken.mp4'
  private ls: Record<string, (() => void)[]> = {}
  private ct = 0
  get currentTime(): number {
    return this.ct
  }
  set currentTime(v: number) {
    this.ct = v
  }
  get paused(): boolean {
    return true
  }
  get muted(): boolean {
    return true
  }
  set muted(_v: boolean) {}
  play(): Promise<void> {
    return Promise.resolve()
  }
  pause(): void {}
  load(): void {}
  addEventListener(t: string, f: () => void): void {
    ;(this.ls[t] ??= []).push(f)
  }
  removeEventListener(t: string, f: () => void): void {
    this.ls[t] = (this.ls[t] ?? []).filter((x) => x !== f)
  }
  fire(t: string): void {
    for (const f of (this.ls[t] ?? []).slice()) f()
  }
}

/** A class of its own for each window (the guard changes its prototype). */
function own(C: any): any {
  const K: any = class extends C {}
  for (const k of Object.getOwnPropertyNames(C.prototype)) if (k !== 'constructor') Object.defineProperty(K.prototype, k, Object.getOwnPropertyDescriptor(C.prototype, k)!)
  return K
}

/** A page's window on the app's clock; `css` maps an element to its computed
 *  animation-name / animation-play-state. */
function clockWin(css = new Map<any, { animationName: string; animationPlayState: string }>()): any {
  FakeAnim.live = []
  const w: any = {
    location: { search: '?vt=1' },
    performance: { now: () => 0 },
    Date,
    Math: Object.create(Math),
    crypto: { getRandomValues: (a: Uint8Array) => a },
    requestAnimationFrame: () => 1,
    cancelAnimationFrame: () => {},
    setTimeout: (f: () => void, ms: number) => setTimeout(f, ms),
    clearTimeout: (id: any) => clearTimeout(id),
    setInterval: () => 1,
    clearInterval: () => {},
    console: { error: () => {} },
    addEventListener: () => {},
    getComputedStyle: (el: any) => css.get(el) ?? { animationName: 'none', animationPlayState: 'running' },
    Animation: own(FakeAnim),
    HTMLMediaElement: own(FakeMedia),
    MutationObserver: class {
      observe(): void {}
    }
  }
  w.document = {
    addEventListener: () => {},
    createElement: () => ({}),
    getAnimations: () => FakeAnim.live.filter((a) => a.playState !== 'finished'),
    getElementsByTagName: () => [],
    timeline: { currentTime: 0 }
  }
  return w
}

// ---- S-5: the page's playbackRate from where the animation stands ----------

test('S-5: a playbackRate the page sets applies from now on, not to the time already past', () => {
  const w = clockWin()
  guardMain(w)
  const C: SnippClock = w.__snippClock
  const a: any = new w.Animation(10000)
  C.settle()
  C.frame(1000, 1)
  assert.equal(a.currentTime, 1000)
  a.playbackRate = 2 // at 1 s
  C.frame(1500, 1.5)
  assert.equal(a.currentTime, 2000, '1 s at 1×, then 0.5 s at 2×')
  a.updatePlaybackRate(0.5) // at 1.5 s
  C.frame(2500, 2.5)
  assert.equal(a.currentTime, 2500, '+ 1 s at 0.5×')
})

// ---- S-7: a video that cannot load is not waited for -----------------------

test('S-7: a media element that cannot load is not waited for, and is reported once', async () => {
  const w = clockWin()
  guardMain(w)
  const C: SnippClock = w.__snippClock
  C.settle()
  const v: any = new w.HTMLMediaElement()
  C.frame(500, 0.5)
  await v.play()
  // Its load fails a moment later (no metadata ever).
  setTimeout(() => {
    v.error = { code: 4 }
    v.networkState = 3
    v.fire('error')
  }, 20)
  let t0 = Date.now()
  await C.media(1000)
  assert.ok(Date.now() - t0 < 1000, `the first frame waited ${Date.now() - t0} ms`)
  t0 = Date.now()
  await C.media(2000)
  assert.ok(Date.now() - t0 < 100, `a later frame waited ${Date.now() - t0} ms`)
  const errs: string[] = w.__snippGuard.errors.filter((e: string) => /broken\.mp4/.test(e))
  assert.equal(errs.length, 1, JSON.stringify(w.__snippGuard.errors))
})

test('S-7: a seek that never ends is given up after 3 s and reported', async () => {
  const w = clockWin()
  guardMain(w)
  const C: SnippClock = w.__snippClock
  C.settle()
  const v: any = new w.HTMLMediaElement()
  v.readyState = 4
  v.duration = 10
  v.src = v.currentSrc = 'slow.mp4'
  C.frame(0, 0)
  await v.play()
  const t0 = Date.now()
  await C.media(1500) // no 'seeked' ever comes
  const took = Date.now() - t0
  assert.ok(took >= 2900 && took < 4000, `waited ${took} ms`)
  assert.ok(w.__snippGuard.errors.some((e: string) => /slow\.mp4/.test(e)), JSON.stringify(w.__snippGuard.errors))
})

// ---- S-2: animation-play-state changed by the page's CSS later -------------

test('S-2: a CSS animation paused, then running, then paused again by its CSS runs only in between, on the clock', () => {
  const el = {}
  const style = { animationName: 'k', animationPlayState: 'paused' }
  const w = clockWin(new Map([[el, style]]))
  const a: any = new w.Animation(Infinity, { name: 'k', el })
  a.playState = 'paused' // animation-play-state: paused, from the stylesheet
  guardMain(w)
  const C: SnippClock = w.__snippClock
  C.settle()
  FakeAnim.tick(400)
  C.frame(1000, 1)
  assert.equal(a.currentTime, 0, 'paused by its CSS: stays at 0')
  style.animationPlayState = 'running' // a class added by a timer at 1 s
  C.settle()
  FakeAnim.tick(5000) // real time: nothing moves
  C.frame(2000, 2)
  assert.equal(a.currentTime, 1000, 'running since 1 s')
  C.frame(3000, 3)
  style.animationPlayState = 'paused' // and paused again at 3 s
  C.settle()
  FakeAnim.tick(5000)
  C.frame(3500, 3.5)
  assert.equal(a.currentTime, 2000, 'held where it stood at 3 s')
  assert.equal(C.late(), 0)
})

test('S-2: a running CSS animation its CSS pauses later is held there', () => {
  const el = {}
  const style = { animationName: 'spin, k', animationPlayState: 'running, running' }
  const w = clockWin(new Map([[el, style]]))
  const a: any = new w.Animation(Infinity, { name: 'k', el })
  guardMain(w)
  const C: SnippClock = w.__snippClock
  C.settle()
  C.frame(1500, 1.5)
  assert.equal(a.currentTime, 1500)
  style.animationPlayState = 'running, paused'
  C.settle()
  C.frame(4000, 4)
  assert.equal(a.currentTime, 1500, 'its own entry of the list says paused')
  style.animationPlayState = 'running, running'
  C.settle()
  C.frame(5000, 5)
  assert.equal(a.currentTime, 2500, 'going on from where it stood')
})

// ---- S-3: starts the clock does not drive are counted at their source ------

/** An event target as the browser keeps it (listeners by type; `fire`
 *  dispatches a trusted event, `fake` one the page made itself). */
class FakeTarget {
  private ls: Record<string, ((e: any) => void)[]> = {}
  addEventListener(t: string, f: (e: any) => void): void {
    ;(this.ls[t] ??= []).push(f)
  }
  removeEventListener(t: string, f: (e: any) => void): void {
    this.ls[t] = (this.ls[t] ?? []).filter((x) => x !== f)
  }
  fire(t: string, more: Record<string, unknown> = {}, trusted = true): void {
    const e = { type: t, isTrusted: trusted, currentTarget: this, target: this, ...more }
    for (const f of (this.ls[t] ?? []).slice()) f.call(this, e)
    // (The handler as the browser keeps it, not through the page's getter.)
    const h = (this as any).__h?.['on' + t]
    if (typeof h === 'function') h.call(this, e)
  }
}

function eventWin(): any {
  const w = clockWin()
  const ET: any = own(FakeTarget)
  // An element's `onanimationend` / `onload` handler, as GlobalEventHandlers keeps it.
  const EL: any = class extends ET {}
  for (const n of ['onload', 'onerror', 'onanimationend', 'ontransitionend']) {
    const key = Symbol(n)
    Object.defineProperty(EL.prototype, n, {
      configurable: true,
      get(this: any) {
        return this[key] ?? null
      },
      set(this: any, f: unknown) {
        this[key] = f
        ;(this.__h ??= {})[n] = f
      }
    })
  }
  w.EventTarget = ET
  w.HTMLElement = EL
  w.Worker = class extends ET {}
  w.MessagePort = class extends ET {}
  w.addEventListener = ET.prototype.addEventListener
  w.fire = FakeTarget.prototype.fire
  Object.setPrototypeOf(w, ET.prototype)
  w.ls = {}
  let answer: (v: unknown) => void = () => {}
  w.fetch = () => new Promise((r) => (answer = r))
  ;(w as any).answer = (v: unknown) => answer(v)
  const observers: any[] = []
  w.IntersectionObserver = class {
    constructor(public cb: (e: unknown[]) => void) {
      observers.push(this)
    }
    observe(): void {}
  }
  w.ResizeObserver = w.IntersectionObserver
  ;(w as any).observers = observers
  return w
}

test('S-3: a network answer, an animation event, an observer or a worker\'s message after the first look counts as late', async () => {
  const w = eventWin()
  guardMain(w)
  const C: SnippClock = w.__snippClock
  // Before the first look (while loading): nothing counts.
  const early = w.fetch('a.json')
  w.answer({ ok: true })
  await early
  C.settle()
  C.frame(0, 0)
  assert.equal(C.late(), 0)
  // A fetch made by a timer, answered between steps.
  const p = w.fetch('b.json').then(() => 1)
  w.answer({ ok: true })
  await p
  assert.equal(C.late(), 1, 'the network answer')
  // An animationend listener (a chain).
  const el = new w.HTMLElement()
  el.addEventListener('animationend', () => {})
  el.fire('animationend')
  assert.equal(C.late(), 2, 'the animation event, by addEventListener')
  el.onload = () => {}
  el.fire('load')
  assert.equal(C.late(), 3, 'an image\'s load, by onload')
  const io = new w.IntersectionObserver(() => {})
  io.cb([])
  assert.equal(C.late(), 4, 'an IntersectionObserver callback')
  const wk = new w.Worker()
  wk.addEventListener('message', () => {})
  wk.fire('message')
  assert.equal(C.late(), 5, 'a worker\'s message')
})

test('S-3: no false alarm: the page\'s own events, its window\'s errors, its own channel, listeners that never run', () => {
  const w = eventWin()
  guardMain(w)
  const C: SnippClock = w.__snippClock
  C.settle()
  C.frame(0, 0)
  const el = new w.HTMLElement()
  let ran = 0
  const f = (): void => {
    ran++
  }
  el.addEventListener('transitionend', f)
  el.fire('transitionend', {}, false) // dispatched by the page itself
  el.removeEventListener('transitionend', f)
  el.fire('transitionend')
  assert.equal(ran, 1, 'removed: the wrapped listener is gone too')
  w.addEventListener('error', () => {})
  w.fire('error') // a script error of the page: on the clock's steps
  w.addEventListener('message', () => {})
  w.fire('message', { source: w }) // posted to itself
  const port = new w.MessagePort()
  port.addEventListener('message', () => {})
  port.fire('message') // its own MessageChannel (a scheduler)
  el.addEventListener('click', () => {})
  el.fire('click')
  assert.equal(C.late(), 0)
})
