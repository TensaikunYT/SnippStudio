// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// Security patch, item 9 (S4): a project file with absurd numbers (a canvas
// of 1e9 pixels, 1e9 frames a second, a clip 1e308 seconds long) opens
// repaired: the values are brought back within what a project can hold, the
// user is told in one line (English and Turkish), and a sound project of any
// real size is not touched.
import { fixture, resetWorld } from './undo-fixture'
import assert from 'node:assert/strict'
import test from 'node:test'
import { readProjectToOpen, repairSummary, serializeProject } from '../renderer/src/media/projectio'
import { checkProject, describeProblems } from '../renderer/src/model/check'
import { PROJECT_LIMITS } from '../renderer/src/model/repair'
import { STRINGS, setLang } from '../renderer/src/ui/strings'
import { STRINGS_GUV } from '../renderer/src/ui/strings-guv'
import type { Project } from '../renderer/src/types'

type Raw = Record<string, any>

/** The fixture project as a file's object, changed by `change`, read as Open reads it. */
function opened(change: (raw: Raw) => void): { project: Project; codes: string[]; summary: string } {
  resetWorld()
  const raw = JSON.parse(serializeProject(fixture())) as Raw
  change(raw)
  const r = readProjectToOpen(JSON.stringify(raw))
  // (The identity a file without one is given on Open is not this test's.)
  const repaired = r.repaired.filter((x) => x.code !== 'uid')
  return { project: r.project, codes: repaired.map((x) => x.code), summary: repairSummary(repaired) }
}

test('item 9: the limits are sane', () => {
  assert.deepEqual(PROJECT_LIMITS, { minSide: 16, maxSide: 8192, minFps: 1, maxFps: 240, maxTime: 360_000, minSpeed: 0.01, maxSpeed: 10_000 })
})

test('item 9: a canvas of 1e9 pixels and 1e9 frames a second opens within the limits, and it is said', () => {
  for (const big of [1e9, 1e308, Number.MAX_SAFE_INTEGER]) {
    const { project, codes, summary } = opened((raw) => {
      raw.settings = { width: big, height: big, fps: big }
    })
    assert.deepEqual(project.settings, { width: 8192, height: 8192, fps: 240 }, String(big))
    assert.ok(codes.includes('limits'), `told (${codes.join(', ')})`)
    assert.match(summary, /limit/i)
    assert.equal(describeProblems(checkProject(project)), '')
  }
  const tiny = opened((raw) => {
    raw.settings = { width: 0.001, height: 3, fps: 1e-9 }
  })
  assert.deepEqual(tiny.project.settings, { width: 16, height: 16, fps: 1 })
  assert.ok(tiny.codes.includes('limits'))
})

test('item 9: times of 1e308 seconds: a clip that long is cut to the limit, one that starts there is dropped, media and texts follow', () => {
  const { project, codes } = opened((raw) => {
    raw.clips.cl.duration = 1e308 // a picture: nothing of its media ends it
    raw.clips.cc.start = 1e300 // nowhere on a timeline
    raw.clips.ov.inPoint = 1e200
    raw.clips.cb.speed = 1e308
    raw.assets.find((a: Raw) => a.id === 'aud1').duration = 1e308
    raw.clips.m1.duration = 1e307 // sound: its "media" claims to be that long too
    raw.captions.find((c: Raw) => c.id === 't1').end = 1e308
    raw.captions.find((c: Raw) => c.id === 'c3').start = 1e300
    raw.captions.find((c: Raw) => c.id === 'c3').end = 1e301
    raw.markers[0].time = 1e308
    raw.shortSegments[0].end = 1e308
  })
  const max = PROJECT_LIMITS.maxTime
  assert.equal(project.clips.cl.duration, max)
  assert.equal(project.clips.cc, undefined, 'the clip that started at 1e300 s is gone')
  assert.equal(project.clips.ov.inPoint, 0)
  assert.ok((project.clips.cb.speed ?? 1) <= PROJECT_LIMITS.maxSpeed)
  assert.equal(project.assets.find((a) => a.id === 'aud1')!.duration, max)
  assert.ok(project.clips.m1.start + project.clips.m1.duration <= max + 1e-6)
  assert.equal(project.captions.find((c) => c.id === 't1')!.end, max)
  assert.equal(project.captions.find((c) => c.id === 'c3'), undefined, 'the text that started at 1e300 s is gone')
  assert.ok(project.markers!.every((m) => m.time <= max))
  assert.ok(project.shortSegments!.every((s) => s.end <= max && s.start <= s.end))
  for (const c of Object.values(project.clips)) assert.ok(c.start + c.duration <= max + 1e-6 && c.duration > 0, c.id)
  assert.ok(codes.includes('limits'), `told (${codes.join(', ')})`)
  assert.equal(describeProblems(checkProject(project)), '')
  // Nothing in the opened project is beyond a number the app can count frames with.
  JSON.stringify(project, (_k, v) => {
    if (typeof v === 'number') assert.ok(Number.isFinite(v) && Math.abs(v) < 1e12, `a number left at ${v}`)
    return v
  })
})

test('item 9: a real project is not touched: 8K at 120 fps, a ten-hour clip, speed 4', () => {
  const { project, codes } = opened((raw) => {
    raw.settings = { width: 7680, height: 4320, fps: 120 }
    raw.assets.find((a: Raw) => a.id === 'aud1').duration = 36_000
    raw.clips.m1.duration = 36_000
    raw.clips.ov.speed = 4
  })
  assert.deepEqual(codes, [])
  assert.deepEqual(project.settings, { width: 7680, height: 4320, fps: 120 })
  assert.equal(project.clips.m1.duration, 36_000)
  // And the fixture as it is: read, nothing mended.
  assert.deepEqual(opened(() => undefined).codes, [])
})

test('item 9: the repair has its words in English and Turkish, with the same parameters', () => {
  const params = (s: string): string => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(',')
  const e = STRINGS_GUV['project.repair.limits']
  assert.ok(e.en.trim() && e.tr.trim())
  assert.equal(params(e.en), params(e.tr))
  assert.deepEqual((STRINGS as Record<string, unknown>)['project.repair.limits'], e)
  for (const lang of ['en', 'tr'] as const) {
    setLang(lang)
    assert.doesNotMatch(repairSummary([{ code: 'limits', count: 3 }]), /project\.repair|\{n\}/, lang)
    assert.match(repairSummary([{ code: 'limits', count: 3 }]), /3/)
  }
  setLang('en')
})
