// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// Phase 5e (FAZ5-PLAN.md "5e"): the checker's pure parts (its moments, a
// blank picture, the verdict, its answer), the guard's uncapped error count
// (5c + 5d audit S-6) and the preview holding the last good frame of a page
// that errs (decision 2).
import './dom-stub'
import assert from 'node:assert/strict'
import test from 'node:test'
import { blankPicture, checkMoments, checkText, differingShare, recordLines, samePicture, verdictOf, type CheckResult } from '../renderer/src/media/codefilm-limits'
import { arrive, newPlan, noteAsked, pick, RING } from '../renderer/src/media/codefilm-schedule'
import { guardMain } from '../main/codefilm-guard'

test('the checker draws 10 %, 50 % and 90 % of what the clip shows, and 30 % in between', () => {
  assert.deepEqual(checkMoments(0, 10), { moments: [1, 5, 9], between: 3 })
  assert.deepEqual(checkMoments(2, 4), { moments: [2.2, 3, 3.8], between: 2.6 })
  assert.deepEqual(checkMoments(4, 2), { moments: [2.2, 3, 3.8], between: 2.6 })
})

test('blank: one colour all over, or wholly clear; anything drawn is not blank', () => {
  const pic = (n: number, px: number[]): number[] => Array.from({ length: n }, () => px).flat()
  assert.equal(blankPicture(pic(100, [0, 0, 0, 0])), true, 'clear')
  assert.equal(blankPicture(pic(100, [12, 30, 200, 255])), true, 'one colour')
  // (A clear picture whose colour channels differ is still clear.)
  assert.equal(blankPicture([...pic(50, [0, 0, 0, 0]), ...pic(50, [255, 0, 0, 0])]), true)
  const one = pic(100, [12, 30, 200, 255])
  one[4 * 57] = 255
  assert.equal(blankPicture(one), false, 'one pixel drawn')
  const faint = pic(100, [12, 30, 200, 255])
  faint[4 * 3 + 1] = 32
  assert.equal(blankPicture(faint), true, 'within 2 / 255')
  faint[4 * 3 + 1] = 33
  assert.equal(blankPicture(faint), false)
})

test('the verdict: error before blank before unstable before ok; the margin is phase 5c\'s', () => {
  assert.equal(verdictOf({ errors: 1, blank: true, unstable: true }), 'error')
  assert.equal(verdictOf({ errors: 0, blank: true, unstable: true }), 'blank')
  assert.equal(verdictOf({ errors: 0, blank: false, unstable: true }), 'unstable')
  assert.equal(verdictOf({ errors: 0, blank: false, unstable: false }), 'ok')
  const a = new Uint8ClampedArray(4 * 1000).fill(100)
  const b = new Uint8ClampedArray(a)
  for (let i = 0; i < 5; i++) b[i * 4] = 200
  assert.equal(samePicture(a, b), true, '0.5 % of the pixels')
  b[5 * 4] = 200
  assert.equal(samePicture(a, b), false)
  assert.equal(differingShare(a, b), 0.006)
  assert.deepEqual(recordLines({ errors: ['Uncaught SyntaxError: x\n  at y'], blocked: ['https://cdn.example/x.js'], failed: ['snippfilm://id/a.png'] }), ['Uncaught SyntaxError: x', 'blocked: https://cdn.example/x.js', 'could not load: snippfilm://id/a.png'])
  const r: CheckResult = { verdict: 'error', lines: ['Uncaught SyntaxError: Unexpected token'], length: 4, width: 1920, height: 1080, moments: [0.4, 2, 3.6], ms: 812, at: 0 }
  assert.equal(checkText(r, 'c1'), 'c1: error. Length 4 s, 1920x1080; drawn at 0.4, 2, 3.6 s twice and on a fresh load (812 ms).\n- Uncaught SyntaxError: Unexpected token')
})

test('S-6: the guard counts every error, also past the 50 it keeps', () => {
  const listeners: Record<string, ((e: unknown) => void)[]> = {}
  const w: Record<string, unknown> = {
    console: { error: () => {} },
    addEventListener: (k: string, f: (e: unknown) => void) => void (listeners[k] = [...(listeners[k] ?? []), f]),
    document: { addEventListener: () => {} },
    location: { search: '' },
    Math,
    Date,
    performance
  }
  try {
    guardMain(w)
  } catch {
    /* the fake window lacks parts the guard only patches */
  }
  const g = (): { errors: string[]; errorCount: number } => w.__snippGuard as { errors: string[]; errorCount: number }
  assert.equal(g().errorCount, 0)
  // (Audit D8a: uncaught errors are counted; the page's own console.error is kept as a line, not counted.)
  for (let i = 0; i < 80; i++) for (const f of listeners.error ?? []) f({ message: 'boom ' + i })
  ;(w.console as { error: (s: string) => void }).error('logged')
  assert.equal(g().errors.length, 50)
  assert.equal(g().errorCount, 80)
})

test('decision 2: a frame drawn while the page erred gives way to the last good one; the good one stays in the ring', () => {
  const plan = newPlan<string>()
  let id = 0
  const got = (t: number, bmp: string, bad = false): string[] => {
    noteAsked(plan, { id: ++id, t, w: 10, h: 10, prep: true })
    return arrive(plan, id, { t, w: 10, h: 10, bmp, ...(bad ? { bad: true as const } : {}) }, 0.01)
  }
  got(1, 'good1')
  got(2, 'good2')
  assert.equal(pick(plan, 2, 'exact', 30)?.bmp, 'good2')
  const out: string[] = []
  for (let i = 0; i < RING + 3; i++) out.push(...got(3 + i, `bad${i}`, true))
  // The newest good frame is never pushed out by bad ones.
  assert.ok(plan.frames.some((f) => f.bmp === 'good2'))
  assert.ok(!out.includes('good2'))
  assert.equal(plan.frames.length, RING)
  // Paused on an erring moment, and playing past it: the last good frame.
  assert.equal(pick(plan, 4, 'exact', 30)?.bmp, 'good2')
  assert.equal(pick(plan, 7, 'play', 30)?.bmp, 'good2')
  // A good frame again: shown.
  got(9, 'good9')
  assert.equal(pick(plan, 9, 'exact', 30)?.bmp, 'good9')
  // Only bad frames: the bad one rather than nothing.
  const p2 = newPlan<string>()
  noteAsked(p2, { id: 1, t: 1, w: 10, h: 10, prep: true })
  arrive(p2, 1, { t: 1, w: 10, h: 10, bmp: 'bad', bad: true }, 0.01)
  assert.equal(pick(p2, 1, 'exact', 30)?.bmp, 'bad')
})
