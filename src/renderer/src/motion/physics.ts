// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// Motion with weight: a small, closed-form physics model that moves pictures
// (motion/picture-moves.ts): a picture enters, walks, hops and turns with it.
//
// Every action is turned into "steps" — changes of a target — and
// each step is eased by a damped spring whose step response has an exact
// formula. A channel's value at any time is its start value plus the sum of
// its steps' responses, so a frame costs O(steps), needs no simulation state
// and gives the same picture whichever order frames are asked for in: preview
// scrubbing backwards and a multi-threaded export see the identical pose.
//
// Weight comes from three places:
//   * wind-up — a small move the other way before a move starts,
//   * the upper body as a damped pendulum on top of the feet, driven by their
//     acceleration: it lags behind on the way out and carries on past a stop
//     (that swing is the lean you see), solved in closed form as well,
//   * squash on crouch and landing, stretch when moving fast.

import type { MoveAction, MovePhysics, Mover } from '../types'

/** A change of target, eased by a spring. `w` = Infinity: instant (used only
 *  while the picture is off screen, where a jump can't be seen). */
export interface Step {
  t: number
  d: number
  w: number
  z: number
}

/** A ballistic hop: feet leave the ground at `t`, land `T` later. */
interface Arc {
  t: number
  T: number
  h: number
}

export type PoseSwap = NonNullable<MoveAction['swap']>

interface PoseEvent {
  /** The moment the picture changes (middle of the swap). */
  t: number
  from: string
  to: string
  swap: PoseSwap
  /** Seconds the swap is spread over. */
  win: number
}

export interface CompiledMover {
  x0: number
  y0: number
  s0: number
  o0: number
  f0: number
  x: Step[]
  y: Step[]
  s: Step[]
  o: Step[]
  f: Step[]
  r: Step[]
  q: Step[]
  arcs: Arc[]
  poses: PoseEvent[]
  rest: string
  /** Per action: when the main move is done and when it has settled. */
  spans: Map<string, { main: number; settle: number }>
}

export interface MoverFrame {
  /** Feet position, frame fractions. */
  x: number
  y: number
  /** Multiplier on the picture's size (Approach/Retreat, pop). */
  scale: number
  opacity: number
  /** Radians, around the feet. */
  rot: number
  /** Squash / stretch. */
  sx: number
  sy: number
  /** 1 = as drawn, -1 = mirrored; passes through 0 while turning. */
  face: number
  pose: string
  /** A dissolve in progress: the incoming pose and how far along it is. */
  poseB?: string
  mix: number
  /** Motion-blur shutter for this instant, seconds. */
  shutter: number
}

export interface MoverEnv {
  /** Frame width / height. */
  aspect: number
  /** Pose image width / height (for working out how far "off screen" is). */
  poseAspect: (poseId: string) => number
}

export const DEFAULT_PHYSICS: MovePhysics = {
  weight: 0.5,
  bounce: 0.35,
  lean: 0.5,
  squash: 0.4,
  gait: 0.45,
  blur: 0.5,
  idle: 0.5
}

const clamp = (v: number, a: number, b: number): number => Math.min(b, Math.max(a, v))

// -- spring step response ----------------------------------------------------

/** Value, velocity and acceleration of a unit step through a damped spring,
 *  `tau` seconds after the step. */
export function response(tau: number, w: number, z: number): [number, number, number] {
  if (tau <= 0) return [0, 0, 0]
  if (!Number.isFinite(w)) return [1, 0, 0]
  if (z >= 0.999) {
    const e = Math.exp(-w * tau)
    if (e < 1e-7) return [1, 0, 0]
    return [1 - e * (1 + w * tau), w * w * tau * e, w * w * e * (1 - w * tau)]
  }
  const a = z * w
  const e = Math.exp(-a * tau)
  if (e < 1e-7) return [1, 0, 0]
  const wd = w * Math.sqrt(1 - z * z)
  const c = Math.cos(wd * tau)
  const s = Math.sin(wd * tau)
  const k = (w * w) / wd
  return [1 - e * (c + (a / wd) * s), e * k * s, k * e * (wd * c - a * s)]
}

const riseCache = new Map<number, number>()
/** Time (at w = 1) for a step to first cover 90% of its way. Dividing it by
 *  the wanted duration gives the spring frequency, so a block's width on the
 *  timeline is how long the move takes whatever its bounce. */
export function rise90(z: number): number {
  const key = Math.round(z * 1000)
  const hit = riseCache.get(key)
  if (hit !== undefined) return hit
  let tau = 0
  while (tau < 40 && response(tau, 1, z)[0] < 0.9) tau += 0.005
  riseCache.set(key, tau)
  return tau
}

/** Time until a step stays within about 5% of its target. */
export function settleTime(w: number, z: number): number {
  if (!Number.isFinite(w)) return 0
  return (z >= 0.999 ? 4.7 : 3 / z) / w
}

/** A long track's steps by start, the running total of their changes, and
 *  the longest any of them takes to settle (see sum). */
interface SumIndex {
  n: number
  last: Step
  byT: Step[]
  acc: number[]
  reach: number
}
const sumIndex = new WeakMap<Step[], SumIndex>()

/** How long after its start a step is exactly done: response() gives 1
 *  once e^(−a·τ) < 1e-7, that is a·τ > 16.12. */
function settleSpan(st: Step): number {
  if (!Number.isFinite(st.w)) return 0
  const a = st.z >= 0.999 ? st.w : st.z * st.w
  return a > 0 ? 16.2 / a : Infinity
}

/**
 * A channel at t: its base plus every step's response so far. A long track
 * (a picture moving over a whole film) only works out the steps still moving:
 * those that started more than the longest settle ago are done, and count
 * whole from a running total — the same value, without going over every
 * move of the film for every frame.
 */
export function sum(steps: Step[], t: number, base: number): [number, number, number] {
  let v = base
  let dv = 0
  let ddv = 0
  let from = 0
  let list = steps
  if (steps.length >= 24) {
    let ix = sumIndex.get(steps)
    if (!ix || ix.n !== steps.length || ix.last !== steps[steps.length - 1]) {
      const byT = [...steps].sort((p, q) => p.t - q.t)
      const acc = [0]
      let reach = 0
      for (const st of byT) {
        acc.push(acc[acc.length - 1] + st.d)
        reach = Math.max(reach, settleSpan(st))
      }
      ix = { n: steps.length, last: steps[steps.length - 1], byT, acc, reach }
      sumIndex.set(steps, ix)
    }
    // The first step that may still be moving at t.
    const edge = t - ix.reach
    let lo = 0
    let hi = ix.byT.length
    while (lo < hi) {
      const mid = (lo + hi) >> 1
      if (ix.byT[mid].t < edge) lo = mid + 1
      else hi = mid
    }
    v += ix.acc[lo]
    from = lo
    list = ix.byT
  }
  for (let i = from; i < list.length; i++) {
    const st = list[i]
    if (t <= st.t) {
      if (list !== steps) break
      continue
    }
    const [a, b, c] = response(t - st.t, st.w, st.z)
    v += st.d * a
    dv += st.d * b
    ddv += st.d * c
  }
  return [v, dv, ddv]
}

// -- the upper body -------------------------------------------------------------
//
// A damped pendulum riding on the feet: θ'' + 2ζωθ' + ω²θ = −a(t), where a is
// the feet's acceleration. θ is the convolution of the pendulum's impulse
// response with a; each spring step's acceleration is a (complex) exponential,
// so the convolution has a closed form and no simulation is needed — the lean
// at any instant costs O(steps), exactly like the position.

type Cx = [number, number]
const cmul = (a: Cx, b: Cx): Cx => [a[0] * b[0] - a[1] * b[1], a[0] * b[1] + a[1] * b[0]]
const csub = (a: Cx, b: Cx): Cx => [a[0] - b[0], a[1] - b[1]]
const cdiv = (a: Cx, b: Cx): Cx => {
  const d = b[0] * b[0] + b[1] * b[1] || 1e-18
  return [(a[0] * b[0] + a[1] * b[1]) / d, (a[1] * b[0] - a[0] * b[1]) / d]
}
const cexp = (z: Cx): Cx => {
  const m = Math.exp(z[0])
  return [m * Math.cos(z[1]), m * Math.sin(z[1])]
}
const cscale = (a: Cx, k: number): Cx => [a[0] * k, a[1] * k]
/** ∫₀^τ e^{ps} e^{q(τ−s)} ds */
function expConv(p: Cx, q: Cx, tau: number): Cx {
  let r = csub(p, q)
  if (Math.abs(r[0]) + Math.abs(r[1]) < 1e-9) r = [1e-9, 0]
  return cdiv(csub(cexp(cscale(p, tau)), cexp(cscale(q, tau))), r)
}

/** Pendulum lag (in the steps' units) at `t` from a channel's spring steps. */
export function pendulumLag(steps: Step[], t: number, wh: number, zh: number): number {
  const beta = zh * wh
  const nu = wh * Math.sqrt(1 - zh * zh)
  const q: Cx = [-beta, nu]
  let lag = 0
  for (const st of steps) {
    const tau = t - st.t
    if (tau <= 0 || !Number.isFinite(st.w)) continue
    // Both the step's own motion and the swing it started have died away.
    if (beta * tau > 18 && st.z * st.w * tau > 18) continue
    let I: number
    if (st.z >= 0.999) {
      const w = st.w
      const p: Cx = [-w, 0]
      const r = csub(p, q)
      const e = cexp(cscale(r, tau))
      const rt = cscale(r, tau)
      // ∫₀^τ s e^{ps} e^{q(τ−s)} ds = e^{qτ} (e^{rτ}(rτ − 1) + 1) / r²
      const F = cdiv([e[0] * (rt[0] - 1) - e[1] * rt[1] + 1, e[0] * rt[1] + e[1] * (rt[0] - 1)], cmul(r, r))
      const term = csub(expConv(p, q, tau), cscale(cmul(cexp(cscale(q, tau)), F), w))
      I = ((w * w) / nu) * term[1]
    } else {
      const a = st.z * st.w
      const wd = st.w * Math.sqrt(1 - st.z * st.z)
      const k = (st.w * st.w) / wd
      const B: Cx = [k * wd, k * a]
      const p: Cx = [-a, wd]
      const pc: Cx = [-a, -wd]
      const Bc: Cx = [B[0], -B[1]]
      const sumC = [cmul(B, expConv(p, q, tau)), cmul(Bc, expConv(pc, q, tau))]
      I = ((sumC[0][1] + sumC[1][1]) / (2 * nu))
    }
    lag -= st.d * I
  }
  return lag
}

// -- tuning ------------------------------------------------------------------

/** How long a fresh action lasts by default; heavier pictures take longer. */
export function defaultDuration(kind: MoveAction['kind'], physics: MovePhysics): number {
  const k = 0.85 + 0.35 * physics.weight
  switch (kind) {
    case 'dash':
      return 0.34 * k
    case 'enter':
    case 'exit':
      return 0.7 * k
    case 'approach':
    case 'retreat':
      return 0.8 * k
    case 'point':
      return 1.8
    case 'pose':
      return 0.26
    case 'hop':
      return 0.55 * k
    case 'turn':
      return 0.22
    default:
      return 0.75 * k
  }
}

function tuning(p: MovePhysics): {
  z: number
  /** Upper-body pendulum: natural frequency (rad/s) and damping. Heavier
   *  swings slower and longer; bounce lets it ring. */
  pw: number
  pz: number
  anticFrac: number
  anticAmt: number
} {
  const z = clamp(1 - 0.8 * p.bounce - 0.08 * p.weight, 0.2, 1)
  return {
    z,
    pw: 2 * Math.PI * (1.7 - 0.8 * p.weight),
    pz: clamp(0.55 - 0.2 * p.weight - 0.25 * p.bounce, 0.15, 0.9),
    anticFrac: 0.1 + 0.2 * p.weight,
    anticAmt: 0.03 + 0.09 * p.weight
  }
}

// -- compile -----------------------------------------------------------------

const compiledCache = new WeakMap<Mover, { key: string; c: CompiledMover }>()

/** Compiles once per edit. The key is the content, not just the object: an
 *  edit builds its new project by changing a draft in place, and a compile
 *  cached against the draft half-way through (adding a block asks where the
 *  picture is) would otherwise outlive the rest of that edit. */
export function compileMover(ch: Mover, env: MoverEnv): CompiledMover {
  const key =
    env.aspect.toFixed(4) +
    '|' +
    ch.poses.map((p) => `${p.id}:${p.faces}:${env.poseAspect(p.id).toFixed(3)}`).join(',') +
    '|' +
    JSON.stringify([ch.actions, ch.physics, ch.x, ch.y, ch.size, ch.flip, ch.restPoseId, ch.pointPoseId])
  const hit = compiledCache.get(ch)
  if (hit && hit.key === key) return hit.c
  const c = build(ch, env)
  compiledCache.set(ch, { key, c })
  return c
}

function build(ch: Mover, env: MoverEnv): CompiledMover {
  const P = ch.physics
  const T = tuning(P)
  const rest = ch.poses.some((p) => p.id === ch.restPoseId) ? ch.restPoseId : ch.poses[0]?.id ?? ''
  const poseOf = (id: string | undefined) => ch.poses.find((p) => p.id === id) ?? ch.poses.find((p) => p.id === rest)
  const actions = ch.actions
    .map((a, i) => ({ a, i }))
    .sort((p, q) => p.a.time - q.a.time || p.i - q.i)
    .map((e) => e.a)

  const c: CompiledMover = {
    x0: ch.x,
    y0: ch.y,
    s0: 1,
    o0: 1,
    f0: ch.flip ? -1 : 1,
    x: [],
    y: [],
    s: [],
    o: [],
    f: [],
    r: [],
    q: [],
    arcs: [],
    poses: [],
    rest,
    spans: new Map()
  }

  // Current targets while walking through the actions in time order.
  let tx = ch.x
  let ty = ch.y
  let ts = 1
  let to = 1
  let tf = c.f0
  let tr = 0
  let pose = rest
  /** Off screen after an exit (or before a first entrance), and how it left. */
  let off: MoveAction['side'] | null = null

  const halfWidth = (scale: number): number => {
    const pa = env.poseAspect(pose)
    return (ch.size * scale * pa) / env.aspect / 2
  }
  const offX = (side: 'left' | 'right', scale: number): number => {
    // Lean and the sticker outline reach a little past the picture itself.
    const m = halfWidth(Math.max(scale, 1)) * 1.4 + 0.03
    return side === 'left' ? -m : 1 + m
  }
  const offY = (scale: number): number => 1 + ch.size * Math.max(scale, 1) * 1.08 + 0.02

  // The first action decides where the picture is before anything happens.
  const first = actions[0]
  if (first?.kind === 'enter') {
    const side = first.side ?? 'left'
    off = side
    if (side === 'left' || side === 'right') tx = offX(side, 1)
    else if (side === 'bottom') ty = offY(1)
    else if (side === 'pop') ts = 0
    else to = 0
    c.x0 = tx
    c.y0 = ty
    c.s0 = ts
    c.o0 = to
  }

  const instant = (steps: Step[], cur: number, next: number, t: number): number => {
    if (Math.abs(next - cur) > 1e-9) steps.push({ t, d: next - cur, w: Infinity, z: 1 })
    return next
  }

  /** A spring move of one channel. With wind-up, the block's start is where
   *  the wind-up begins and the main move follows it. */
  const spring = (
    steps: Step[],
    cur: number,
    next: number,
    t0: number,
    dur: number,
    opts: { antic?: boolean; z?: number; anticCap?: number } = {}
  ): number => {
    const d = next - cur
    if (Math.abs(d) < 1e-9) return next
    const z = opts.z ?? T.z
    let tMain = t0
    let main = dur
    let rest = d
    if (opts.antic && T.anticAmt > 0) {
      const A = clamp(dur * T.anticFrac, 0.04, 0.3)
      let a = -d * T.anticAmt
      if (opts.anticCap !== undefined && Math.abs(a) > opts.anticCap) a = Math.sign(a) * opts.anticCap
      const wa = rise90(1) / A
      steps.push({ t: t0, d: a, w: wa, z: 1 })
      tMain = t0 + A
      main = dur - A
      rest = d - a
    }
    const w = rise90(z) / Math.max(0.05, main)
    steps.push({ t: tMain, d: rest, w, z })
    return next
  }

  /** Jumps x — only ever while unseen, so nothing swings from it. */
  const jumpX = (next: number, t: number): void => {
    tx = instant(c.x, tx, next, t)
  }

  /** Moves the feet (x with the lagging upper body, y without). */
  const moveXY = (nx: number, ny: number, t0: number, dur: number, antic: boolean): void => {
    // Cap the wind-up at a fraction of the body so a screen-wide dash
    // doesn't back up half a screen first.
    const cap = (0.14 * ch.size * ts) / env.aspect
    tx = spring(c.x, tx, nx, t0, dur, { antic, anticCap: cap })
    ty = spring(c.y, ty, ny, t0, dur, { antic: false })
  }

  const whipDir = { n: 0 }
  /** A pose change hidden inside a quick whip (or dissolved, or cut). */
  const swapPose = (to: string, center: number, swap: PoseSwap, win: number, turnTo?: number): void => {
    if (to === pose && (turnTo === undefined || turnTo === tf)) return
    c.poses.push({ t: center, from: pose, to, swap, win })
    if (turnTo !== undefined && turnTo !== tf) {
      // A turn through edge-on, centred on the swap so the blur covers it.
      const w = swap === 'cut' ? Infinity : rise90(1) / Math.max(0.05, win * 0.55)
      const start = Number.isFinite(w) ? center - 1.68 / w : center
      c.f.push({ t: start, d: turnTo - tf, w, z: 1 })
      tf = turnTo
    }
    if (swap === 'whip') {
      // Fast twist with its peak speed exactly at the swap, then back.
      const sign = whipDir.n++ % 2 === 0 ? 1 : -1
      const amp = (5 + 5 * P.weight) * sign
      const w = 2 / Math.max(0.06, win)
      c.r.push({ t: center - 1 / w, d: amp, w, z: 1 })
      c.r.push({ t: center + 0.6 / w, d: -amp, w: w * 0.8, z: T.z })
      // A little squash-pop so the swap reads as a movement, not a cut.
      const qa = (0.03 + 0.05 * P.squash) * (0.6 + 0.8 * P.weight)
      c.q.push({ t: center - 1 / w, d: -qa, w: w * 1.2, z: 1 })
      c.q.push({ t: center, d: qa, w: w * 1.1, z: T.z })
    }
    pose = to
  }

  /** Point returns to whatever the pose would be at its end, so a Pose
   *  action inside a Point's hold still sticks. */
  const pending: { t: number; run: () => void }[] = []
  const flush = (until: number): void => {
    pending.sort((p, q) => p.t - q.t)
    while (pending.length && pending[0].t <= until) pending.shift()!.run()
  }

  for (const a of actions) {
    flush(a.time)
    const t0 = a.time
    const dur = Math.max(0.05, a.dur)
    const swap: PoseSwap = a.swap ?? 'whip'
    const win = clamp(Math.min(dur, 0.3), 0.08, 0.3)
    let main = t0 + dur
    let settle = main
    const note = (w: number, z: number, from: number): void => {
      settle = Math.max(settle, from + settleTime(w, z))
    }

    switch (a.kind) {
      case 'enter': {
        const X = a.x ?? ch.x
        const Y = a.y ?? ch.y
        const side = a.side ?? 'left'
        if (!off) {
          moveXY(X, Y, t0, dur, true)
          break
        }
        // Everything that changes before it comes into view jumps; only the
        // entrance itself is animated.
        if (side === 'left' || side === 'right') {
          ts = instant(c.s, ts, 1, t0)
          to = instant(c.o, to, 1, t0)
          ty = instant(c.y, ty, Y, t0)
          jumpX(offX(side, 1), t0)
          tx = spring(c.x, tx, X, t0, dur)
        } else if (side === 'bottom') {
          ts = instant(c.s, ts, 1, t0)
          to = instant(c.o, to, 1, t0)
          jumpX(X, t0)
          ty = instant(c.y, ty, offY(1), t0)
          ty = spring(c.y, ty, Y, t0, dur)
        } else if (side === 'pop') {
          to = instant(c.o, to, 1, t0)
          jumpX(X, t0)
          ty = instant(c.y, ty, Y, t0)
          ts = instant(c.s, ts, 0, t0)
          ts = spring(c.s, ts, 1, t0, dur, { z: Math.min(T.z, 0.42) })
        } else {
          ts = instant(c.s, ts, 1, t0)
          jumpX(X, t0)
          ty = instant(c.y, ty, Y, t0)
          to = instant(c.o, to, 0, t0)
          to = spring(c.o, to, 1, t0, dur, { z: 1 })
        }
        off = null
        break
      }
      case 'exit': {
        if (off) break
        const side = a.side ?? 'right'
        if (side === 'left' || side === 'right') moveXY(offX(side, ts), ty, t0, dur, true)
        else if (side === 'bottom') ty = spring(c.y, ty, offY(ts), t0, dur, { antic: true })
        else if (side === 'pop') ts = spring(c.s, ts, 0, t0, dur, { antic: true, z: 1 })
        else to = spring(c.o, to, 0, t0, dur, { z: 1 })
        off = side
        break
      }
      case 'move':
      case 'dash': {
        const X = a.x ?? (a.kind === 'dash' ? clamp(1 - tx, 0.08, 0.92) : tx > 0.5 ? tx - 0.25 : tx + 0.25)
        moveXY(X, a.y ?? ty, t0, dur, true)
        // Moving after an exit brings the picture back: a sideways exit
        // simply walks back in; a faded or popped one reappears on the way.
        if (off === 'fade') to = spring(c.o, to, 1, t0, dur, { z: 1 })
        if (off === 'pop') ts = spring(c.s, ts, 1, t0, dur)
        off = null
        break
      }
      case 'approach':
      case 'retreat': {
        const amt = a.amount ?? (a.kind === 'approach' ? 1.45 : 0.7)
        const next = clamp(ts * amt, 0.05, 8)
        const X = a.x ?? (a.kind === 'approach' ? tx + (0.5 - tx) * 0.2 : tx)
        // An eye-level camera: coming closer, the eyes stay about where they
        // were and the feet drop out of the bottom of the frame; stepping back,
        // the feet rise towards the horizon. Growing from the feet instead
        // pushed the head straight out of the top of the frame.
        const Y = a.y ?? ty + (next - ts) * ch.size * 0.88
        moveXY(X, Y, t0, dur, true)
        ts = spring(c.s, ts, next, t0, dur, { antic: true })
        break
      }
      case 'hop': {
        const crouch = clamp(dur * 0.26, 0.06, 0.2)
        const flight = Math.max(0.12, dur - crouch)
        const h = 0.12 * ch.size * ts * (a.amount ?? 1)
        c.arcs.push({ t: t0 + crouch, T: flight, h })
        const qa = P.squash * (0.09 + 0.08 * P.weight)
        if (qa > 0) {
          const wc = rise90(1) / crouch
          c.q.push({ t: t0, d: -qa, w: wc, z: 1 })
          const wr = 2.6 / crouch
          c.q.push({ t: t0 + crouch, d: qa, w: wr, z: T.z })
          const land = t0 + crouch + flight
          const ql = P.squash * (0.07 + 0.1 * P.weight)
          c.q.push({ t: land, d: -ql, w: 38, z: 1 })
          c.q.push({ t: land + 0.06, d: ql, w: 20, z: T.z })
          note(20, T.z, land + 0.06)
        }
        if (a.x !== undefined || a.y !== undefined) {
          tx = spring(c.x, tx, a.x ?? tx, t0 + crouch, flight * 0.9, { z: 1 })
          ty = spring(c.y, ty, a.y ?? ty, t0 + crouch, flight * 0.9, { z: 1 })
        }
        main = t0 + crouch + flight
        break
      }
      case 'turn': {
        const drawn = poseOf(pose)?.faces ?? 'right'
        const facing = tf > 0 ? drawn : drawn === 'left' ? 'right' : 'left'
        const want = a.dir ?? (facing === 'left' ? 'right' : 'left')
        const target = want === drawn ? 1 : -1
        if (target !== tf) {
          const w = rise90(1) / dur
          c.f.push({ t: t0, d: target - tf, w, z: 1 })
          tf = target
          note(w, 1, t0)
        }
        break
      }
      case 'pose': {
        const id = poseOf(a.poseId)?.id ?? rest
        swapPose(id, t0 + win / 2, swap, win)
        main = t0 + win
        break
      }
      case 'point': {
        const target = poseOf(a.poseId ?? ch.pointPoseId)
        const dir = a.dir ?? (tx < 0.5 ? 'right' : 'left')
        const back = pose
        const backFace = tf
        const mirror = target && dir !== target.faces ? -1 : 1
        // A small lean towards what it points at.
        const lean = (dir === 'right' ? 1 : -1) * (2 + 3 * P.lean)
        swapPose(target?.id ?? rest, t0 + win / 2, swap, win, mirror)
        tr = spring(c.r, tr, tr + lean, t0, win * 1.6, { z: T.z })
        const end = t0 + dur
        pending.push({
          t: end,
          run: () => {
            swapPose(back, end + win / 2, swap, win, backFace)
            tr = spring(c.r, tr, tr - lean, end, win * 1.6, { z: T.z })
          }
        })
        main = end + win
        break
      }
    }
    // The tail on the lane: until the arrival wobble and the upper body's
    // swing have faded to where they no longer read.
    const wMain = rise90(T.z) / Math.max(0.05, dur)
    note(wMain, T.z, t0)
    settle = Math.max(settle, main + 2.3 / (T.pz * T.pw))
    c.spans.set(a.id, { main, settle: Math.max(settle, main) })
  }
  flush(Infinity)
  c.poses.sort((p, q) => p.t - q.t)
  return c
}

// -- evaluate ------------------------------------------------------------------

/** Where the picture is and how it looks at time `t`. */
export function evalMover(ch: Mover, c: CompiledMover, t: number, env: MoverEnv): MoverFrame {
  const P = ch.physics
  const T = tuning(P)
  const [x, vx] = sum(c.x, t, c.x0)
  let [y, vy] = sum(c.y, t, c.y0)
  const [s0] = sum(c.s, t, c.s0)
  const [o] = sum(c.o, t, c.o0)
  const [f] = sum(c.f, t, c.f0)
  const [r] = sum(c.r, t, 0)
  const [q] = sum(c.q, t, 0)
  const scale = Math.max(0, s0)

  for (const arc of c.arcs) {
    const u = (t - arc.t) / arc.T
    if (u <= 0 || u >= 1) continue
    y -= arc.h * 4 * u * (1 - u)
    vy -= (arc.h * 4 * (1 - 2 * u)) / arc.T
  }

  // Body-relative units: how many of its own heights it moves per second.
  const bodyH = Math.max(0.04, ch.size * Math.max(scale, 0.05))
  const vBH = (vx * env.aspect) / bodyH
  const vyBH = vy / bodyH
  // Upper-body swing, in body heights (head relative to the feet).
  const lagBH = (pendulumLag(c.x, t, T.pw, T.pz) * env.aspect) / bodyH

  // Gait: a bob keyed to the distance covered, faded in with speed.
  const moving = Math.tanh(Math.abs(vBH) / 1.2)
  const stride = 0.55 * bodyH * (1 + 0.6 * P.weight)
  const phase = (x * env.aspect) / stride
  y -= P.gait * 0.022 * bodyH * moving * (1 - Math.cos(2 * Math.PI * phase)) * 0.5

  // Lean: the lagging upper body plus a forward lean at speed.
  let rotDeg =
    r +
    P.lean * ((Math.atan(lagBH) * 180) / Math.PI * (0.6 + 0.8 * P.weight) + 6 * Math.tanh(vBH / 3)) +
    P.idle * 0.9 * Math.sin((2 * Math.PI * t) / 5.3 + 0.7)
  rotDeg = clamp(rotDeg, -28, 28)

  // Squash / stretch.
  const hs = P.squash * 0.08 * Math.tanh(Math.abs(vBH) / 5)
  const qy = Math.max(0.6, 1 + q + P.squash * 0.1 * Math.tanh(Math.abs(vyBH) / 3))
  const breathe = 1 + P.idle * 0.012 * Math.sin((2 * Math.PI * t) / 3.4)
  const sx = (1 + hs) / Math.sqrt(qy)
  const sy = (qy / Math.sqrt(1 + hs)) * breathe

  // Pose (and a dissolve, if one is running).
  let pose = c.rest
  let poseB: string | undefined
  let mix = 0
  let whip = 0
  for (const e of c.poses) {
    // Cut off where it no longer changes a pixel, so still frames stay one draw.
    const u = (t - e.t) / (0.32 * e.win)
    if (e.swap === 'whip' && Math.abs(u) < 2.6) whip += Math.exp(-u * u)
    if (e.swap === 'fade' && Math.abs(t - e.t) < e.win / 2) {
      pose = e.from
      poseB = e.to
      mix = (t - (e.t - e.win / 2)) / e.win
    } else if (t >= e.t) {
      pose = e.to
      poseB = undefined
      mix = 0
    }
  }
  return {
    x,
    y,
    scale,
    opacity: clamp(o, 0, 1),
    rot: (rotDeg * Math.PI) / 180,
    sx,
    sy,
    face: clamp(f, -1, 1),
    pose,
    poseB,
    mix,
    shutter: P.blur / 30 + 0.075 * Math.min(1, whip)
  }
}

/** Main-move end and settle end per action (for drawing a lane of moves). */
export function actionSpans(
  ch: Mover,
  env: MoverEnv
): Map<string, { main: number; settle: number }> {
  return compileMover(ch, env).spans
}

/** The resting targets just before `t` — what a new action starts from. */
export function targetsBefore(
  ch: Mover,
  t: number,
  env: MoverEnv
): { x: number; y: number; scale: number } {
  const c = compileMover(ch, env)
  const at = (steps: Step[], base: number): number => {
    let v = base
    for (const st of steps) if (st.t < t) v += st.d
    return v
  }
  return { x: at(c.x, c.x0), y: at(c.y, c.y0), scale: at(c.s, c.s0) }
}

/** Internals the tests check against a brute-force simulation. */
export const physicsInternals = { pendulumLag, response }
