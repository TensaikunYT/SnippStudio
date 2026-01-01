// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// Phase 5d.2 (FAZ5-PLAN.md "5d.2", tarifler\FAZ5.md 5d decisions 4–6): on the
// app's clock a page's CSS animations and transitions, Web Animations, media
// and SVG (SMIL) animations follow the clock; an animation started away from
// the clock's steps is counted ("unstable"); the export's drawing scale.
// Each test fails without the part it is about.
import './dom-stub'
import assert from 'node:assert/strict'
import test from 'node:test'
import { guardMain, type SnippClock } from '../main/codefilm-guard'
import { HOST_HTML } from '../main/codefilm-host'
import { exportScaleOf, filmQuery, FILM_QUERY, isSlow } from '../renderer/src/media/codefilm-limits'
import { codeFilmsEnlarged } from '../renderer/src/export/preflight'

// ---- stand-ins -------------------------------------------------------------

/** An animation as the browser keeps it: a current time that runs with the
 *  real clock while it plays (moved by `tick`), held while paused. */
class FakeAnimation {
  static live: FakeAnimation[] = []
  playState: 'running' | 'paused' | 'finished' = 'running'
  playbackRate = 1
  private ct = 0
  effect: { getComputedTiming: () => { endTime: number } }
  timeline = null
  constructor(end = Infinity) {
    this.effect = { getComputedTiming: () => ({ endTime: end }) }
    FakeAnimation.live.push(this)
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
    if (this.playState === 'finished') this.ct = 0
    this.playState = 'running'
  }
  reverse(): void {
    this.playbackRate = -this.playbackRate
  }
  finish(): void {
    this.ct = this.effect.getComputedTiming().endTime
    this.playState = 'finished'
  }
  /** Real time passing (only a running animation moves). */
  static tick(ms: number): void {
    for (const a of FakeAnimation.live) if (a.playState === 'running') a.ct += ms * a.playbackRate
  }
}

class FakeSvg {
  ownerSVGElement = null
  paused = false
  t = -1
  pauseAnimations(): void {
    this.paused = true
  }
  setCurrentTime(s: number): void {
    this.t = s
  }
}

class FakeMediaEl {
  playbackRate = 1
  loop = false
  duration = 10
  readyState = 4
  seeking = false
  realPlays = 0
  realPauses = 0
  private ls: Record<string, (() => void)[]> = {}
  private ct = 0
  private p = true
  m = false
  get currentTime(): number {
    return this.ct
  }
  set currentTime(v: number) {
    this.ct = v
    // (The seek is done a moment later, as in a browser.)
    setTimeout(() => (this.ls.seeked ?? []).slice().forEach((f) => f()), 1)
  }
  get paused(): boolean {
    return this.p
  }
  get muted(): boolean {
    return this.m
  }
  set muted(v: boolean) {
    this.m = !!v
  }
  play(): Promise<void> {
    this.realPlays++
    this.p = false
    return Promise.resolve()
  }
  pause(): void {
    this.realPauses++
    this.p = true
  }
  load(): void {}
  addEventListener(t: string, f: () => void): void {
    ;(this.ls[t] ??= []).push(f)
  }
  removeEventListener(t: string, f: () => void): void {
    this.ls[t] = (this.ls[t] ?? []).filter((x) => x !== f)
  }
}

/** A class of its own for each window (the guard changes its prototype). */
function fresh(C: any): any {
  const K: any = class extends C {}
  for (const k of Object.getOwnPropertyNames(C.prototype)) if (k !== 'constructor') Object.defineProperty(K.prototype, k, Object.getOwnPropertyDescriptor(C.prototype, k)!)
  return K
}

function win(query: string, svgs: FakeSvg[] = []): any {
  FakeAnimation.live = []
  const w: any = {
    location: { search: query },
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
    Animation: fresh(FakeAnimation),
    HTMLMediaElement: fresh(FakeMediaEl),
    MutationObserver: class {
      observe(): void {}
    }
  }
  w.document = {
    addEventListener: () => {},
    createElement: () => ({}),
    getAnimations: () => FakeAnimation.live.filter((a) => a.playState !== 'finished'),
    getElementsByTagName: (n: string) => (n === 'svg' ? svgs : []),
    timeline: { currentTime: 123456 }
  }
  return w
}

// ---- decision 4: animations on the clock ----------------------------------

test('a CSS animation of the page is held on the clock: at frame T it stands at T − its birth, whatever real time passed', () => {
  const w = win('?vt=1')
  const a = new w.Animation() // in the page's stylesheet: there at load
  guardMain(w)
  const C: SnippClock = w.__snippClock
  FakeAnimation.tick(700) // the page loading, in real time
  C.settle() // the host's first look (at 0)
  assert.equal(a.playState, 'paused', 'held')
  assert.equal(a.currentTime, 0, 'born at 0')
  FakeAnimation.tick(5000) // real time between steps: nothing moves
  C.frame(1000, 1)
  assert.equal(a.currentTime, 1000)
  C.frame(2500, 2.5)
  assert.equal(a.currentTime, 2500)
  assert.equal(w.document.timeline.currentTime, 2500, 'document.timeline is the clock too')
  assert.equal(C.late(), 0)
})

test('a transition started by a timer is born at that timer’s time (steady); one seen between steps is "late"', () => {
  const w = win('?vt=1')
  guardMain(w)
  const C: SnippClock = w.__snippClock
  C.settle()
  const made: FakeAnimation[] = []
  w.setTimeout(() => {
    made.push(new w.Animation(1500)) // a class added: the transition appears at the next style look
  }, 2000)
  while (C.timer(2000)) C.settle() // (the host: each timer in its task, then settle)
  FakeAnimation.tick(30)
  C.frame(2500, 2.5)
  const tr = made[0]
  assert.ok(tr)
  assert.equal(tr.currentTime, 500, 'born at 2000, half a second in')
  assert.equal(C.late(), 0, 'started by the clock: steady')
  // Ends: finished (its end events and promise), no longer held.
  C.frame(3600, 3.6)
  assert.equal(tr.playState, 'finished')
  // Something the clock does not drive (an image's load) starts one between steps.
  const loose = new w.Animation()
  C.frame(3700, 3.7)
  assert.equal(C.late(), 1, 'counted: its birth depends on when it was seen')
  assert.equal(loose.playState, 'paused')
})

test('the page’s own pause / play / currentTime are kept: paused stays still; played goes on from where it stands', () => {
  const w = win('?vt=1')
  const a = new w.Animation()
  guardMain(w)
  const C: SnippClock = w.__snippClock
  C.settle()
  C.frame(1000, 1)
  ;(a as any).pause() // the page pauses it
  C.frame(2000, 2)
  assert.equal(a.currentTime, 1000, 'its own pause holds')
  ;(a as any).play()
  C.frame(2600, 2.6)
  assert.equal(a.currentTime, 1600, 'played again at 2.0: 0.6 s on')
  ;(a as any).currentTime = 100 // the page seeks it
  C.frame(3000, 3)
  assert.equal(a.currentTime, 500)
  // One the page made paused (animation-play-state: paused) is the page's.
  const own = new w.Animation()
  own.playState = 'paused'
  own.currentTime = 42
  C.frame(3100, 3.1)
  assert.equal(own.currentTime, 42)
  assert.equal(C.late(), 0, 'a paused one is not late')
})

test('SVG timelines are paused and set to the clock (seconds since the svg was first seen)', () => {
  const s = new FakeSvg()
  const w = win('?vt=1', [s])
  guardMain(w)
  const C: SnippClock = w.__snippClock
  C.settle()
  assert.equal(s.paused, true)
  C.frame(1250, 1.25)
  assert.equal(s.t, 1.25)
})

test('media on the clock: play() does not play; each frame sets it to its moment and waits for the seek', async () => {
  const w = win('?vt=1')
  guardMain(w)
  const C: SnippClock = w.__snippClock
  C.settle()
  const v: any = new w.HTMLMediaElement()
  C.frame(1000, 1)
  await v.play()
  assert.equal(v.realPlays, 0, 'never really played')
  assert.equal(v.paused, false, 'the page sees it playing')
  assert.equal(v.muted, true, 'and silent')
  await C.media(3000)
  assert.equal(v.currentTime, 2, 'played at 1 s: at 3 s it is 2 s in')
  v.loop = true
  v.duration = 1.5
  await C.media(4000)
  assert.equal(v.currentTime, 0, 'looped: 3 s into a 1.5 s loop')
  v.loop = false
  v.duration = 10
  C.frame(5000, 5)
  v.pause()
  await C.media(9000)
  assert.equal(v.currentTime, 4, 'paused at 5 s (4 s in): stays there')
  assert.equal(v.paused, true)
})

test('passing through (no ?vt=1): animations and media are the page’s own', async () => {
  const w = win('?snipp=1')
  const a = new w.Animation()
  guardMain(w)
  assert.equal(w.__snippClock, undefined)
  assert.equal(a.playState, 'running')
  const v: any = new w.HTMLMediaElement()
  await v.play()
  assert.equal(v.realPlays, 1)
})

// ---- decision 6: the export's drawing scale --------------------------------

test('devicePixelRatio: 1, or the export scale `dpr=` (1 < k ≤ 2) the page was loaded again with', () => {
  for (const [q, k] of [
    ['?snipp=1', 1],
    ['?snipp=1&dpr=2', 2],
    ['?snipp=1&dpr=1.5&vt=1', 1.5],
    ['?snipp=1&dpr=3', 1],
    ['?snipp=1&dpr=0.5', 1],
    ['?snipp=1&xdpr=2', 1]
  ] as const) {
    const w = win(q)
    guardMain(w)
    assert.equal(w.devicePixelRatio, k, q)
  }
  assert.equal(filmQuery(1), FILM_QUERY)
  assert.equal(filmQuery(2), `${FILM_QUERY}&dpr=2`)
  assert.match(HOST_HTML, /dpr=\(\[0-9\.\]\+\)/, 'the host page reads the scale from the film query')
})

test('"slow": fewer than 24 pictures a second while playing, or than its own rate when lower', () => {
  assert.equal(isSlow(29.3, 60), false)
  assert.equal(isSlow(20, 60), true)
  assert.equal(isSlow(23.6, null), false, 'half a picture of slack')
  assert.equal(isSlow(11.8, 12), false, 'a 12 fps page at 12')
  assert.equal(isSlow(8, 12), true)
})

test('k = output height / film height, between 1 and 2', () => {
  assert.equal(exportScaleOf(1080, 1080), 1)
  assert.equal(exportScaleOf(2160, 1080), 2)
  assert.equal(exportScaleOf(3840, 1920), 2, 'a 1080 × 1920 film in a 4K portrait export')
  assert.equal(exportScaleOf(1440, 1080), 1.333)
  assert.equal(exportScaleOf(4320, 1080), 2, 'past 2: enlarged')
  assert.equal(exportScaleOf(720, 1080), 1, 'never smaller than its own size')
  assert.equal(exportScaleOf(2160, 0), 2, 'no known height: 1080')
})

test('the export window no longer warns for a whole page drawn by its window within 2×; a canvas page is still named', () => {
  const film = (mode?: string) => ({ id: 'f', kind: 'code', name: 'film', url: '', size: 0, duration: 10, width: 1920, height: 1080, hasAudio: false, ...(mode ? { code: { mode } } : {}) })
  const project = (a: object, scale = 1) => ({ settings: { width: 1920, height: 1080, fps: 30 }, tracks: [{ id: 'V1', kind: 'video', name: 'V1', clipIds: ['c'] }], clips: { c: { id: 'c', assetId: 'f', trackId: 'V1', start: 0, inPoint: 0, duration: 5, transform: { x: 960, y: 540, scale, rotation: 0 }, volume: 1 } }, assets: [a] }) as never
  assert.equal(codeFilmsEnlarged(project(film('page')), 2160).length, 0)
  assert.equal(codeFilmsEnlarged(project(film('page'), 1.5), 2160).length, 1, 'past 2×: enlarged all the same')
  assert.equal(codeFilmsEnlarged(project(film('canvas')), 2160).length, 1)
  assert.equal(codeFilmsEnlarged(project(film('fast')), 2160).length, 1)
})
