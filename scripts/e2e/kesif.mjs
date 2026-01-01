// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// Phase 11a's exploratory runs (K1–K7) and the concurrent-editing runs
// ((i)–(v)): what every one of them counts, and where it writes it.
//
// Counted in the page, across its reloads (sessionStorage), from the first
// line of every document (Page.addScriptToEvaluateOnNewDocument):
//   errors       uncaught exceptions (window "error")
//   rejections   unhandled promise rejections
//   console      console.error lines (all of them, kept with their text)
//   boundaries   a panel's error box ("[snipp] the … panel failed")
//   model        model check problems (window.__modelProblems, e2e builds)
// Counted by the test: crashes (the page or the app gone).
// The scenario's own numbers go beside them; one JSON per run in
// testdata\e2e-sonuc\faz11\<name>.json.
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { TESTDATA } from './media.mjs'

const PROBE = `(() => {
  if (window.__kesif) return
  const KEY = 'faz11-kesif'
  const load = () => { try { return JSON.parse(sessionStorage.getItem(KEY) || 'null') } catch { return null } }
  const k = load() || { errors: [], rejections: [], console: [], boundaries: [], loads: 0 }
  k.loads++
  const save = () => { try { sessionStorage.setItem(KEY, JSON.stringify(k)) } catch {} }
  const cut = (s) => String(s).slice(0, 400)
  const text = (a) => a.map((x) => (x instanceof Error ? x.stack || x.message : typeof x === 'object' ? (() => { try { return JSON.stringify(x) } catch { return String(x) } })() : String(x))).join(' ')
  window.addEventListener('error', (e) => { k.errors.push(cut(e.error?.stack || e.message)); save() })
  window.addEventListener('unhandledrejection', (e) => { k.rejections.push(cut(e.reason?.stack || e.reason)); save() })
  const orig = console.error.bind(console)
  console.error = (...a) => {
    const s = text(a)
    k.console.push(cut(s))
    if (/\\[snipp\\] the .* panel failed/.test(s)) k.boundaries.push(cut(s))
    save()
    orig(...a)
  }
  window.__kesif = k
  window.__kesifModel = () => (window.__modelProblems || []).length + (k.modelBefore || 0)
  save()
})()`

/** Installs the counters in this page and every page it loads after. */
export async function installProbe(c) {
  // (Once per CDP connection; the guard in PROBE keeps a second copy idle.)
  if (!c.kesifInstalled) {
    await c.send('Page.addScriptToEvaluateOnNewDocument', { source: PROBE })
    c.kesifInstalled = true
  }
  // A fresh count for this run (an earlier run in this window left its own;
  // the model problems of this page so far are not this run's either).
  await c.ev(`(() => { try { sessionStorage.removeItem('faz11-kesif') } catch {} ; delete window.__kesif; if (window.__modelProblems) window.__modelProblems.length = 0; return true })()`)
  if (c.consoleErrors) c.consoleErrors.length = 0
  await c.ev(PROBE)
}

/** Model problems are per page load (window.__modelProblems): carried over a
 *  reload by adding them to the stored count first. Call before a reload. */
export async function keepModelCount(c) {
  await c.ev(`(() => { const k = window.__kesif; if (!k) return 0; k.modelBefore = (k.modelBefore || 0) + (window.__modelProblems || []).length; k.modelSeen = (k.modelSeen || []).concat((window.__modelProblems || []).slice(0, 5).map((p) => p.what)); try { sessionStorage.setItem('faz11-kesif', JSON.stringify(k)) } catch {} ; return k.modelBefore })()`).catch(() => 0)
}

/** The counts now (and the first few texts of each). */
export async function tally(c) {
  const k = await c.ev(`(() => { const k = window.__kesif || { errors: [], rejections: [], console: [], boundaries: [], loads: 0 }; return { ...k, model: (window.__modelProblems || []).length + (k.modelBefore || 0), modelWhat: (k.modelSeen || []).concat((window.__modelProblems || []).slice(0, 5).map((p) => p.what + ': ' + JSON.stringify(p.problems).slice(0, 300))) } })()`)
  return {
    crashes: 0,
    errors: k.errors.length + (c.consoleErrors?.length ?? 0),
    rejections: k.rejections.length,
    console: k.console.length,
    boundaries: k.boundaries.length,
    model: k.model,
    loads: k.loads,
    texts: { errors: [...k.errors, ...(c.consoleErrors ?? [])].slice(0, 8), rejections: k.rejections.slice(0, 8), console: k.console.slice(0, 12), boundaries: k.boundaries.slice(0, 4), model: k.modelWhat.slice(0, 6) }
  }
}

/** Adds two tallies (a run that relaunched the app has one per window). */
export function addTally(a, b) {
  if (!a) return b
  const out = { ...a, texts: { ...a.texts } }
  for (const k of ['crashes', 'errors', 'rejections', 'console', 'boundaries', 'model', 'loads']) out[k] = (a[k] ?? 0) + (b[k] ?? 0)
  for (const k of Object.keys(b.texts)) out.texts[k] = [...(a.texts[k] ?? []), ...b.texts[k]].slice(0, 12)
  return out
}

/** Writes the run's record (testdata\e2e-sonuc\faz11\<name>.json). */
export function record(name, data) {
  // (SNIPP_KESIF_DIR: another round's own folder, 11a's records kept: phase 11b.)
  const dir = join(TESTDATA, 'e2e-sonuc', process.env.SNIPP_KESIF_DIR || 'faz11')
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, `${name}.json`), JSON.stringify({ at: new Date().toISOString(), ...data }, null, 1))
}

/** The project's digest (what "the same project" means for K4 / K5): every
 *  field but the volatile ones, keys sorted. */
export const DIGEST = `(() => {
  const p = window.__store.getState().project
  const drop = new Set(['savedAt', 'modifiedAt', 'openedAt', 'thumb', 'waveform', 'filmstrip', 'peaks', 'probe', 'runtime'])
  const norm = (v) => Array.isArray(v) ? v.map(norm) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).filter((k) => !drop.has(k) && v[k] !== undefined).sort().map((k) => [k, norm(v[k])])) : typeof v === 'number' ? Math.round(v * 1e6) / 1e6 : v
  const s = JSON.stringify(norm(p))
  let h = 2166136261
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0 }
  return { hash: h.toString(16), length: s.length }
})()`

/** The normalized project itself (DIGEST's text), for a diff. */
export const NORMALIZED = DIGEST.replace("return { hash: h.toString(16), length: s.length }", "return s")

/** The first few paths where two normalized projects differ. */
export function diffPaths(a, b, max = 6) {
  const A = JSON.parse(a), B = JSON.parse(b), out = []
  const walk = (p, u, v) => {
    if (out.length >= max || JSON.stringify(u) === JSON.stringify(v)) return
    if (u && v && typeof u === 'object' && typeof v === 'object') { for (const k of new Set([...Object.keys(u), ...Object.keys(v)])) walk(p + '.' + k, u[k], v[k]); return }
    out.push(`${p}: ${JSON.stringify(u)?.slice(0, 100)} -> ${JSON.stringify(v)?.slice(0, 100)}`)
  }
  walk('project', A, B)
  return out
}
