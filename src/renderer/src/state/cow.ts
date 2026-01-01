// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// Copy-on-write edits of the project: `produce(base, fn)` hands `fn` a draft
// that reads like `base` and records its writes, then returns a new project
// that shares every object `fn` did not touch with `base`. It replaces the
// structuredClone of the WHOLE project that every edit made (every slider
// tick, every keystroke in a caption, every pointer move of a trim): for a
// long project that was tens of milliseconds and a pile of garbage per edit,
// and it gave every sub-object a new identity, so nothing keyed by identity
// (React's memo, the compile caches) could ever see
// that a part had not changed.
//
// Only plain objects and arrays are drafted (the project is JSON); anything
// else (a typed array, a Date) is handed out as it is. While `fn` runs,
// structuredClone sees through drafts, so code that copies part of the
// project (clone(), structuredClone) keeps working on them. Pure: no DOM.

const STATE: unique symbol = Symbol('cow-draft')

interface DraftState {
  base: Record<string | number, unknown>
  /** The shallow copy, made on the first write (or the first draft of a
   *  child, which is put into it). */
  copy: Record<string | number, unknown> | null
  parent: DraftState | null
  modified: boolean
  /** The result once finalized (the same draft met twice gives one object). */
  done?: unknown
  proxy: object
}

const isDraftable = (v: unknown): v is object => {
  if (v === null || typeof v !== 'object') return false
  if (Array.isArray(v)) return true
  const proto = Object.getPrototypeOf(v)
  return proto === Object.prototype || proto === null
}

export const isDraft = (v: unknown): boolean => !!v && typeof v === 'object' && !!(v as { [STATE]?: DraftState })[STATE]
const stateOf = (v: unknown): DraftState | undefined => (v && typeof v === 'object' ? (v as { [STATE]?: DraftState })[STATE] : undefined)

const latest = (s: DraftState): Record<string | number, unknown> => s.copy ?? s.base

function prepareCopy(s: DraftState): Record<string | number, unknown> {
  if (!s.copy) s.copy = (Array.isArray(s.base) ? s.base.slice() : { ...s.base }) as Record<string | number, unknown>
  return s.copy
}

function markChanged(s: DraftState | null): void {
  while (s && !s.modified) {
    s.modified = true
    prepareCopy(s)
    s = s.parent
  }
}

const handler: ProxyHandler<object> = {
  get(target, key) {
    const s = (Array.isArray(target) ? (target as unknown as DraftState[])[0] : target) as DraftState
    if (key === STATE) return s
    const src = latest(s)
    const value = Reflect.get(src, key)
    if (typeof key === 'symbol' || !isDraftable(value) || isDraft(value)) return value
    // A child read from the original: drafted, and kept in this copy so the
    // same child is the same draft every time it is read.
    if (Object.prototype.hasOwnProperty.call(s.base, key) && value === s.base[key as string]) {
      const child = createDraft(value, s)
      prepareCopy(s)[key as string] = child
      return child
    }
    return value
  },
  set(target, key, value) {
    const s = (Array.isArray(target) ? (target as unknown as DraftState[])[0] : target) as DraftState
    const src = latest(s)
    if (typeof key !== 'symbol' && Object.prototype.hasOwnProperty.call(src, key) && src[key as string] === value && value !== undefined) return true
    markChanged(s)
    ;(s.copy as Record<string | symbol, unknown>)[key] = value
    return true
  },
  deleteProperty(target, key) {
    const s = (Array.isArray(target) ? (target as unknown as DraftState[])[0] : target) as DraftState
    if (!Object.prototype.hasOwnProperty.call(latest(s), key)) return true
    markChanged(s)
    delete (s.copy as Record<string | symbol, unknown>)[key]
    return true
  },
  has(target, key) {
    const s = (Array.isArray(target) ? (target as unknown as DraftState[])[0] : target) as DraftState
    if (key === STATE) return true
    return key in latest(s)
  },
  ownKeys(target) {
    const s = (Array.isArray(target) ? (target as unknown as DraftState[])[0] : target) as DraftState
    return Reflect.ownKeys(latest(s))
  },
  getOwnPropertyDescriptor(target, key) {
    const s = (Array.isArray(target) ? (target as unknown as DraftState[])[0] : target) as DraftState
    const src = latest(s)
    const d = Reflect.getOwnPropertyDescriptor(src, key)
    if (!d) return undefined
    // Configurable unless the proxy's own target pins it (an array's length).
    const pinned = Reflect.getOwnPropertyDescriptor(target, key)
    return { writable: true, configurable: !pinned || pinned.configurable === true, enumerable: d.enumerable, value: handler.get!(target, key, target) }
  },
  defineProperty(target, key, desc) {
    const s = (Array.isArray(target) ? (target as unknown as DraftState[])[0] : target) as DraftState
    markChanged(s)
    if ('value' in desc) (s.copy as Record<string | symbol, unknown>)[key] = desc.value
    return true
  },
  getPrototypeOf(target) {
    const s = (Array.isArray(target) ? (target as unknown as DraftState[])[0] : target) as DraftState
    return Object.getPrototypeOf(s.base)
  }
}

function createDraft(base: object, parent: DraftState | null): object {
  const s: DraftState = { base: base as Record<string, unknown>, copy: null, parent, modified: false, proxy: null as unknown as object }
  // An array's proxy wraps an array (Array.isArray is true for it); an
  // object's wraps the state itself.
  const target = Array.isArray(base) ? ([s] as unknown as object) : (s as unknown as object)
  s.proxy = new Proxy(target, handler)
  return s.proxy
}

/** `v` with every draft in it replaced by its result: a draft nothing wrote
 *  to is its original; a new object holding drafts is filled in place. */
function finalize(v: unknown, seen: Set<object>): unknown {
  const s = stateOf(v)
  if (s) {
    if (s.done !== undefined) return s.done
    if (!s.modified) {
      // Unchanged itself, but a child draft in its copy may have been
      // written (that marks this one too), so the original stands.
      s.done = s.base
      return s.base
    }
    const copy = s.copy!
    s.done = copy
    for (const k of Object.keys(copy)) copy[k] = finalize(copy[k], seen)
    return copy
  }
  // A new value (assigned by the edit): it may hold drafts.
  if (isDraftable(v) && !seen.has(v)) {
    seen.add(v)
    const o = v as Record<string, unknown>
    for (const k of Object.keys(o)) {
      const x = o[k]
      if (x && typeof x === 'object') {
        const f = finalize(x, seen)
        if (f !== x) o[k] = f
      }
    }
  }
  return v
}

/** A plain deep copy of `v` that sees through drafts (their current state). */
export function plainCopy<T>(v: T): T {
  const s = stateOf(v)
  const src = s ? latest(s) : v
  if (!isDraftable(src)) return src === v ? structuredCloneRaw(v) : (src as T)
  if (Array.isArray(src)) return src.map((x) => plainCopy(x)) as unknown as T
  const out: Record<string, unknown> = {}
  for (const k of Object.keys(src as object)) out[k] = plainCopy((src as Record<string, unknown>)[k])
  return out as T
}

const structuredCloneRaw = <T>(v: T): T => (v === null || typeof v !== 'object' ? v : nativeClone(v))
const nativeClone = globalThis.structuredClone.bind(globalThis) as <T>(v: T, options?: StructuredSerializeOptions) => T

/** Whether `v` holds a draft anywhere inside (a plain value built in the edit). */
function holdsDraft(v: unknown, depth = 0): boolean {
  if (!v || typeof v !== 'object' || depth > 64) return false
  if (isDraft(v)) return true
  if (!isDraftable(v)) return false
  for (const x of Array.isArray(v) ? v : Object.values(v)) if (holdsDraft(x, depth + 1)) return true
  return false
}

/** structuredClone while an edit runs: drafts are copied as what they hold. */
function cloneSeeingDrafts<T>(v: T, options?: StructuredSerializeOptions): T {
  return holdsDraft(v) ? plainCopy(v) : nativeClone(v, options)
}

let depth = 0

/**
 * Runs `fn` on a draft of `base` and returns the result: `base` itself when
 * nothing was written, otherwise a new object sharing every untouched part
 * with `base`. `base` is never changed.
 */
export function produce<T extends object>(base: T, fn: (draft: T) => void): T {
  const draft = createDraft(base, null) as T
  const g = globalThis as { structuredClone: typeof structuredClone }
  if (depth++ === 0) g.structuredClone = cloneSeeingDrafts as typeof structuredClone
  try {
    fn(draft)
  } finally {
    if (--depth === 0) g.structuredClone = nativeClone as typeof structuredClone
  }
  const out = finalize(draft, new Set()) as T
  if (freezing && depth === 0) deepFreeze(out)
  return out
}

/** Development and test builds freeze what `produce` returns, all the way
 *  down (phase Ç2a.1, D1): the undo history keeps the store's projects by
 *  reference, so a write into one outside `produce` would change the past.
 *  Frozen, such a write throws where it is made. */
let freezing = false
export function setFreezeResults(on: boolean): void {
  freezing = on
}
function deepFreeze(v: unknown): void {
  if (!isDraftable(v) || Object.isFrozen(v)) return
  Object.freeze(v)
  for (const k of Object.keys(v)) deepFreeze((v as Record<string, unknown>)[k])
}
