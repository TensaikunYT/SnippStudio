// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// A command's parameters, described once: the TypeScript type, the check that
// turns a bad call into a readable error, and the JSON Schema an agent tool
// will be generated from (phase 4). Small on purpose; no library.
import { PROJECT_LIMITS } from '../model/limits'


export interface JsonSchema {
  type?: 'object' | 'string' | 'number' | 'integer' | 'boolean' | 'array' | 'null'
  description?: string
  properties?: Record<string, JsonSchema>
  required?: string[]
  additionalProperties?: boolean | JsonSchema
  items?: JsonSchema
  enum?: readonly (string | number)[]
  minimum?: number
  maximum?: number
  minItems?: number
  maxItems?: number
  minLength?: number
  maxLength?: number
  pattern?: string
  anyOf?: JsonSchema[]
}

/** One rule: it checks a value (pushing "path: what is wrong" lines) and
 *  knows its JSON Schema. `T` is the type a valid value has. */
export interface Schema<T> {
  readonly json: JsonSchema
  readonly optional: boolean
  check(value: unknown, path: string, errors: string[]): void
  /** What the agent tools need to walk a value (phase 4A, agent/address.ts):
   *  which fields are timeline times, ranges or record ids, and the parts of
   *  an object, a list, a record or a nullable. Not in the JSON Schema. */
  readonly meta?: SchemaMeta
  /** Type carrier only. */
  readonly _t?: T
}

export interface SchemaMeta {
  kind?: 'time' | 'range' | 'id'
  shape?: Record<string, Schema<unknown>>
  item?: Schema<unknown>
  values?: Schema<unknown>
  inner?: Schema<unknown>
}

export type Infer<S> = S extends Schema<infer T> ? T : never

const make = <T>(json: JsonSchema, check: Schema<T>['check'], optional = false, meta?: SchemaMeta): Schema<T> => (meta ? { json, optional, check, meta } : { json, optional, check })

const where = (path: string): string => path || 'params'
const show = (v: unknown): string => {
  if (typeof v === 'string') return JSON.stringify(v.length > 40 ? v.slice(0, 40) + '…' : v)
  if (v === undefined) return 'nothing'
  if (Array.isArray(v)) return 'a list'
  if (v === null) return 'null'
  return typeof v === 'object' ? 'an object' : String(v)
}

interface NumberOpts {
  min?: number
  max?: number
  description?: string
}

function number(opts: NumberOpts = {}, integer = false): Schema<number> {
  return make<number>(
    { type: integer ? 'integer' : 'number', ...(opts.min !== undefined ? { minimum: opts.min } : {}), ...(opts.max !== undefined ? { maximum: opts.max } : {}), ...(opts.description ? { description: opts.description } : {}) },
    (v, path, errors) => {
      if (typeof v !== 'number' || !Number.isFinite(v)) return void errors.push(`${where(path)}: expected a number, got ${show(v)}`)
      if (integer && !Number.isInteger(v)) errors.push(`${where(path)}: expected a whole number, got ${v}`)
      if (opts.min !== undefined && v < opts.min) errors.push(`${where(path)}: must be at least ${opts.min}, got ${v}`)
      if (opts.max !== undefined && v > opts.max) errors.push(`${where(path)}: must be at most ${opts.max}, got ${v}`)
    }
  )
}

type Shape = Record<string, Schema<unknown>>
type OptionalKeys<S extends Shape> = { [K in keyof S]: S[K]['optional'] extends true ? K : never }[keyof S]
type RequiredKeys<S extends Shape> = Exclude<keyof S, OptionalKeys<S>>
type ObjectOf<S extends Shape> = { [K in RequiredKeys<S>]: Infer<S[K]> } & { [K in OptionalKeys<S>]?: Infer<S[K]> }
type Flat<T> = { [K in keyof T]: T[K] }

export const s = {
  string(opts: { min?: number; max?: number; description?: string } = {}): Schema<string> {
    return make<string>(
      { type: 'string', ...(opts.min !== undefined ? { minLength: opts.min } : {}), ...(opts.max !== undefined ? { maxLength: opts.max } : {}), ...(opts.description ? { description: opts.description } : {}) },
      (v, path, errors) => {
        if (typeof v !== 'string') return void errors.push(`${where(path)}: expected text, got ${show(v)}`)
        if (opts.min !== undefined && v.length < opts.min) errors.push(`${where(path)}: must be at least ${opts.min} character${opts.min === 1 ? '' : 's'}`)
        if (opts.max !== undefined && v.length > opts.max) errors.push(`${where(path)}: must be at most ${opts.max} characters`)
      }
    )
  },
  /** A colour as #rrggbb. */
  color(description?: string): Schema<string> {
    return make<string>({ type: 'string', pattern: '^#[0-9a-fA-F]{6}$', ...(description ? { description } : {}) } as JsonSchema, (v, path, errors) => {
      if (typeof v !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(v)) errors.push(`${where(path)}: expected a colour like #rrggbb, got ${show(v)}`)
    })
  },
  /** A record id: non-empty text. */
  id(description?: string): Schema<string> {
    return { ...s.string({ min: 1, max: 200, description }), meta: { kind: 'id' } }
  },
  number: (opts: NumberOpts = {}): Schema<number> => number(opts),
  integer: (opts: NumberOpts = {}): Schema<number> => number(opts, true),
  /** Seconds on the timeline: 0 or more, and no further than a project can
   *  hold (model/limits.ts: the file reader drops a clip beyond it, so a
   *  command may not put one there; 22 Nov, K9). */
  time(description?: string): Schema<number> {
    return { ...number({ min: 0, max: PROJECT_LIMITS.maxTime, description }), meta: { kind: 'time' } }
  },
  boolean(description?: string): Schema<boolean> {
    return make<boolean>({ type: 'boolean', ...(description ? { description } : {}) }, (v, path, errors) => {
      if (typeof v !== 'boolean') errors.push(`${where(path)}: expected true or false, got ${show(v)}`)
    })
  },
  enum<const V extends readonly (string | number)[]>(values: V, description?: string): Schema<V[number]> {
    return make<V[number]>({ ...(typeof values[0] === 'number' ? { type: 'number' as const } : { type: 'string' as const }), enum: values, ...(description ? { description } : {}) }, (v, path, errors) => {
      if (!values.includes(v as V[number])) errors.push(`${where(path)}: must be one of ${values.map((x) => JSON.stringify(x)).join(', ')}, got ${show(v)}`)
    })
  },
  array<T>(item: Schema<T>, opts: { min?: number; max?: number; description?: string } = {}): Schema<T[]> {
    return make<T[]>(
      { type: 'array', items: item.json, ...(opts.min !== undefined ? { minItems: opts.min } : {}), ...(opts.max !== undefined ? { maxItems: opts.max } : {}), ...(opts.description ? { description: opts.description } : {}) },
      (v, path, errors) => {
        if (!Array.isArray(v)) return void errors.push(`${where(path)}: expected a list, got ${show(v)}`)
        if (opts.min !== undefined && v.length < opts.min) errors.push(`${where(path)}: needs at least ${opts.min} item${opts.min === 1 ? '' : 's'}`)
        if (opts.max !== undefined && v.length > opts.max) errors.push(`${where(path)}: at most ${opts.max} items`)
        v.forEach((x, i) => item.check(x, `${path}[${i}]`, errors))
      },
      false,
      { item: item as Schema<unknown> }
    )
  },
  /** A [start, end] pair of seconds, start before end. */
  range(description?: string): Schema<[number, number]> {
    return make<[number, number]>({ type: 'array', items: { type: 'number', minimum: 0 }, minItems: 2, maxItems: 2, ...(description ? { description } : {}) }, (v, path, errors) => {
      if (!Array.isArray(v) || v.length !== 2 || !v.every((x) => typeof x === 'number' && Number.isFinite(x))) return void errors.push(`${where(path)}: expected [start, end] in seconds, got ${show(v)}`)
      if (v[0] < 0) errors.push(`${where(path)}: start must be 0 or more`)
      if (v[1] <= v[0]) errors.push(`${where(path)}: end (${v[1]}) must be after start (${v[0]})`)
      if (v[1] > PROJECT_LIMITS.maxTime) errors.push(`${where(path)}: end must be at most ${PROJECT_LIMITS.maxTime}, got ${v[1]}`)
    }, false, { kind: 'range' })
  },
  object<S extends Shape>(shape: S, description?: string): Schema<Flat<ObjectOf<S>>> {
    const required = Object.keys(shape).filter((k) => !shape[k].optional)
    const properties: Record<string, JsonSchema> = {}
    for (const [k, v] of Object.entries(shape)) properties[k] = v.json
    return make<Flat<ObjectOf<S>>>(
      { type: 'object', properties, required, additionalProperties: false, ...(description ? { description } : {}) },
      (v, path, errors) => {
        if (!v || typeof v !== 'object' || Array.isArray(v)) return void errors.push(`${where(path)}: expected an object, got ${show(v)}`)
        const o = v as Record<string, unknown>
        for (const k of Object.keys(o)) if (!(k in shape) && o[k] !== undefined) errors.push(`${path ? path + '.' : ''}${k}: not a known field (known: ${Object.keys(shape).join(', ')})`)
        for (const [k, rule] of Object.entries(shape)) {
          const sub = path ? `${path}.${k}` : k
          if (o[k] === undefined) {
            if (!rule.optional) errors.push(`${sub}: is required`)
            continue
          }
          rule.check(o[k], sub, errors)
        }
      },
      false,
      { shape }
    )
  },
  /** Text keys to values of one kind. */
  record<T>(value: Schema<T>, description?: string): Schema<Record<string, T>> {
    return make<Record<string, T>>({ type: 'object', additionalProperties: value.json, ...(description ? { description } : {}) }, (v, path, errors) => {
      if (!v || typeof v !== 'object' || Array.isArray(v)) return void errors.push(`${where(path)}: expected an object, got ${show(v)}`)
      for (const [k, x] of Object.entries(v as Record<string, unknown>)) value.check(x, `${path ? path + '.' : ''}${k}`, errors)
    }, false, { values: value as Schema<unknown> })
  },
  /** The value or nothing. */
  optional<T>(rule: Schema<T>): Schema<T> & { optional: true } {
    return { ...rule, optional: true }
  },
  /** The value or null (null = "remove it"). */
  nullable<T>(rule: Schema<T>): Schema<T | null> {
    return make<T | null>({ anyOf: [rule.json, { type: 'null' }] }, (v, path, errors) => {
      if (v !== null) rule.check(v, path, errors)
    }, rule.optional, { inner: rule as Schema<unknown> })
  },
  /** Anything that is an object: for structured values the app itself builds
   *  (a template block, a look), checked by the command, not here. */
  object_any(description?: string): Schema<Record<string, unknown>> {
    return make<Record<string, unknown>>({ type: 'object', ...(description ? { description } : {}) }, (v, path, errors) => {
      if (!v || typeof v !== 'object' || Array.isArray(v)) errors.push(`${where(path)}: expected an object, got ${show(v)}`)
    })
  }
}

/** Every problem with `value`, as "where: what" lines (empty when fine). */
export function validate(schema: Schema<unknown>, value: unknown): string[] {
  const errors: string[] = []
  schema.check(value, '', errors)
  return errors
}
