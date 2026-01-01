// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// Phase Ç2c.2, decision 3 (report D8, K10, K11, K16, K18): the project's
// timeline-timed lists are walked from one register by a whole-timeline cut
// and by time put in. The register test reads the Project type (types.ts,
// with the TypeScript compiler) and fails for a timed field nobody moves. The
// others: after a ripple and after a freeze frame, what a tracker, a title's
// keys, a map's camera, a keyed still and the Shorts pan show at a fixed
// instant of their content is what they showed there before.
import './dom-stub'
import assert from 'node:assert/strict'
import test from 'node:test'
import { join } from 'node:path'
import ts from 'typescript'
import { useStore } from '../renderer/src/state/store'
import { defaultProject, type Caption, type Clip, type Project, type TemplateBlock } from '../renderer/src/types'
import { CLIP_FIELDS, NOT_TIMELINE, TIMED_LISTS } from '../renderer/src/timeline/timed-lists'
import { rippleRange, insertTimeElsewhere } from '../renderer/src/commands/ops/ripple'
import { updateCaption } from '../renderer/src/commands/captions'
import { captionMotionAt, clipTransformAt, shortsWindowAt } from '../renderer/src/playback/pose'
import { trackerPosAt } from '../renderer/src/playback/draw/core'
import { atlasCamera } from '../renderer/src/templates/model'
import { produce } from '../renderer/src/state/cow'

/** Every number field of Project (at any depth) named like a time. */
function timedFields(): string[] {
  const file = join(process.cwd(), 'src', 'renderer', 'src', 'types.ts')
  const program = ts.createProgram([file], { strict: true, skipLibCheck: true, noEmit: true, target: ts.ScriptTarget.ES2022 })
  const checker = program.getTypeChecker()
  const sf = program.getSourceFile(file)!
  let project: ts.Type | undefined
  ts.forEachChild(sf, (n) => {
    if (ts.isInterfaceDeclaration(n) && n.name.text === 'Project') project = checker.getTypeAtLocation(n)
  })
  assert.ok(project, 'Project is in types.ts')
  const out = new Set<string>()
  const NAMES = /^(time|start|end|t|at|from|to|cut)$/
  const walk = (type: ts.Type, path: string, seen: Set<ts.Type>): void => {
    if (type.isUnion()) {
      for (const u of type.types) walk(u, path, seen)
      return
    }
    const item = checker.getIndexTypeOfType(type, ts.IndexKind.Number)
    if (item && (checker.isArrayType(type) || checker.isTupleType(type))) return walk(item, path + '[]', seen)
    if (!(type.flags & ts.TypeFlags.Object) || seen.has(type)) return
    const inner = new Set(seen).add(type)
    const entry = checker.getIndexTypeOfType(type, ts.IndexKind.String)
    if (entry) walk(entry, path + '{}', inner)
    for (const prop of checker.getPropertiesOfType(type)) {
      const t = checker.getNonNullableType(checker.getTypeOfSymbolAtLocation(prop, prop.valueDeclaration ?? prop.declarations?.[0] ?? sf))
      const p = path ? `${path}.${prop.name}` : prop.name
      if (NAMES.test(prop.name) && t.flags & ts.TypeFlags.NumberLike) out.add(p)
      walk(t, p, inner)
    }
  }
  walk(project!, '', new Set())
  return [...out].sort()
}

test('decision 3: every timed field of the project is in the register (or the clip pass, or named as no timeline time)', () => {
  const found = timedFields()
  assert.ok(found.length >= 25, `the walk finds the timed fields (${found.length})`)
  const owned = new Map<string, string>()
  for (const list of TIMED_LISTS) for (const f of list.fields) owned.set(f, list.name)
  for (const f of CLIP_FIELDS) owned.set(f, 'the clip pass')
  for (const f of Object.keys(NOT_TIMELINE)) owned.set(f, 'not a timeline time')
  const orphans = found.filter((f) => !owned.has(f))
  assert.deepEqual(orphans, [], `timed fields no cut and no insert moves: ${orphans.join(', ')}`)
  const stale = [...owned.keys()].filter((f) => !found.includes(f))
  assert.deepEqual(stale, [], `names in the register that the Project type no longer has: ${stale.join(', ')}`)
})

// --- the lists, after a ripple and after a freeze frame -------------------

function project(): Project {
  const p = defaultProject()
  p.settings.fps = 30
  p.tracks = [
    { id: 'V2', kind: 'video', name: 'V2', clipIds: ['still'] },
    { id: 'V1', kind: 'video', name: 'V1', clipIds: ['v'] }
  ]
  p.assets = [
    { id: 'vid', kind: 'video', name: 'v', url: 'media://v', size: 1, duration: 100, width: 10, height: 10, hasAudio: false } as never,
    { id: 'img', kind: 'image', name: 'i', url: 'media://i', size: 1, duration: 0, width: 10, height: 10, hasAudio: false } as never
  ]
  const base = { inPoint: 0, volume: 1, transform: { x: 0, y: 0, scale: 1, rotation: 0 } }
  p.clips.v = { ...base, id: 'v', assetId: 'vid', trackId: 'V1', start: 0, duration: 20 } as Clip
  // A keyed still (Ken Burns by keys) across the whole film.
  p.clips.still = {
    ...base, id: 'still', assetId: 'img', trackId: 'V2', start: 0, duration: 20,
    channels: { x: [{ id: 'x0', time: 2, value: 0 }, { id: 'x1', time: 4, value: 100 }, { id: 'x2', time: 12, value: 400, easing: 'linear' }, { id: 'x3', time: 18, value: 500 }] }
  } as Clip
  p.captions = [
    { id: 'title', start: 6, end: 16, text: 'T', layer: 1, manual: true, kfs: [{ id: 'k0', time: 0.5, x: 0, y: 0, scale: 1, rot: 0, opacity: 1 }, { id: 'k1', time: 3, x: 300, y: 0, scale: 1, rot: 0, opacity: 1 }, { id: 'k2', time: 8, x: 600, y: 50, scale: 2, rot: 0, opacity: 1 }] } as Caption
  ]
  p.trackers = [{ id: 'trk', name: 'T', keyframes: [{ id: 'a', time: 1, x: 0, y: 0 }, { id: 'b', time: 9, x: 80, y: 0 }, { id: 'c', time: 14, x: 200, y: 40 }] }]
  p.shorts = { baseX: 500, keyframes: [{ id: 's1', time: 3, x: 200 }, { id: 's2', time: 15, x: 900 }] }
  p.templates = [{ id: 'map', kind: 'atlas', start: 4, duration: 14, items: [], cams: [{ t: 1, lon: 0, lat: 0, z: 2 }, { t: 6, lon: 30, lat: 10, z: 6 }, { t: 12, lon: -20, lat: 40, z: 3 }] } as unknown as TemplateBlock]
  return p
}

/** The poses of every list at timeline instant t. */
function poses(p: Project, t: number) {
  const cap = p.captions.find((c) => c.id === 'title')!
  const map = p.templates!.find((b) => b.id === 'map')!
  const still = p.clips.still
  const at = trackerPosAt(p.trackers![0].keyframes, t)
  return {
    tracker: { x: at.x, y: at.y },
    title: captionMotionAt(cap, t - cap.start),
    map: (({ lon, lat, z }) => ({ lon, lat, z }))(atlasCamera(map, t - map.start)),
    still: clipTransformAt(still, t - still.start).x,
    shorts: shortsWindowAt(p, t).cx
  }
}
const close = (a: unknown, b: unknown, where: string): void => {
  const flat = (v: unknown): number[] => (typeof v === 'number' ? [v] : v && typeof v === 'object' ? Object.values(v).flatMap(flat) : [])
  const x = flat(a)
  const y = flat(b)
  assert.equal(x.length, y.length)
  x.forEach((v, i) => assert.ok(Math.abs(v - y[i]) < 1e-9, `${where}: ${JSON.stringify(a)} vs ${JSON.stringify(b)}`))
}

test('K10, K11, K16, D8: after a whole-timeline cut through every list, each shows at a fixed instant of its content what it showed there before', () => {
  const before = project()
  // [7, 8]: through the title (its middle), the map block (its middle), the
  // tracker's 1 → 9 s segment, the still's 4 → 12 s segment, the pan's
  // 3 → 15 s segment; [16.5, 17]: after the title, inside the map's tail.
  const after = produce(before, (p) => {
    rippleRange(p, [[7, 8], [16.5, 17]], null)
  })
  const map = (t: number): number => (t <= 7 ? t : t >= 8 && t <= 16.5 ? t - 1 : t - 1.5)
  // Instants outside the segments the cuts went through.
  for (const t of [0.5, 1, 15, 15.5, 16, 19.5]) close(poses(after, map(t)).shorts, poses(before, t).shorts, `Shorts pan at ${t}`)
  // (The middle of the segments wholly between the cuts too.)
  for (const t of [0.5, 1, 10, 12, 15, 19.5]) close(poses(after, map(t)).tracker, poses(before, t).tracker, `tracker at ${t}`)
  for (const t of [6.2, 6.5, 10, 12, 14.5, 15.5]) close(poses(after, map(t)).title, poses(before, t).title, `title at ${t}`)
  for (const t of [4.5, 5, 11, 13, 16.2, 16.4]) close(poses(after, map(t)).map, poses(before, t).map, `map camera at ${t}`)
  // The keys after the cut moved with the content: the title's 8 s key (at
  // 14 s) is at 13 s, the map's 12 s key (16 s) at 15 s, the tracker's 9 s
  // key at 8 s, the 14 s one at 13 s.
  const cap = after.captions.find((c) => c.id === 'title')!
  assert.deepEqual(cap.kfs!.map((k) => +(cap.start + k.time).toFixed(9)), [6.5, 8, 13])
  assert.deepEqual(after.trackers![0].keyframes.map((k) => k.time), [1, 8, 13])
  const blk = after.templates!.find((b) => b.id === 'map')!
  assert.deepEqual(blk.cams!.map((k) => +(blk.start + k.t).toFixed(9)), [5, 9, 15])
})

test('K11: a title trimmed at its head keeps its keys on their instants; the right half of a split keeps them too', () => {
  const p = produce(project(), (d) => {
    updateCaption.apply(d, { id: 'title', patch: { start: 7.5 } }, { random: Math.random, now: () => new Date() })
  })
  const was = project().captions[0]
  const cap = p.captions[0]
  for (const t of [7.5, 8, 9, 10, 13, 15]) close(captionMotionAt(cap, t - cap.start), captionMotionAt(was, t - was.start), `trimmed title at ${t}`)
  // The split (the text lane's: cursor in the text).
  const S = useStore.getState
  const q = project()
  q.captions[0] = { ...q.captions[0], text: 'One two', end: 16 }
  S().loadProject(q)
  S().setTime(10)
  const right = S().splitCaptionAtCursor('title', 'One two', 4)
  assert.ok(right, 'split')
  const now = S().project.captions
  const l = now.find((c) => c.id === 'title')!
  const r = now.find((c) => c.id === right)!
  for (const t of [6.5, l.end - 0.1]) close(captionMotionAt(l, t - l.start), captionMotionAt(q.captions[0], t - 6), `left at ${t}`)
  for (const t of [r.start, r.start + 1, 15]) close(captionMotionAt(r, t - r.start), captionMotionAt(q.captions[0], t - 6), `right at ${t}`)
})

test('K10, K18, D8: after a freeze frame each list shows after the hold what it showed before it', () => {
  const S = useStore.getState
  const before = project()
  S().loadProject(before)
  S().setTime(13)
  useStore.setState({ selectedClipIds: ['v'] })
  S().insertFreezeFrame(2)
  const after = S().project
  // The hold [13, 15]: what was at t ≥ 13 is at t + 2. Instants outside the
  // segments running through 13 (the still's 12 → 18, the tracker's 9 → 14,
  // the pan's 3 → 15, the map's 12 → … its last key at 16).
  for (const t of [0.5, 1, 2, 3]) close(poses(after, t).shorts, poses(before, t).shorts, `Shorts pan at ${t}`)
  for (const t of [0.5, 1, 2, 3, 9]) close(poses(after, t).tracker, poses(before, t).tracker, `tracker at ${t}`)
  for (const t of [0.5, 1, 2, 3, 9, 12]) close(poses(after, t).still, poses(before, t).still, `still at ${t}`)
  for (const t of [14, 16, 18, 19.5]) close(poses(after, t + 2).tracker, poses(before, t).tracker, `tracker at ${t} + 2`)
  for (const t of [15, 16, 18, 19.5]) close(poses(after, t + 2).shorts, poses(before, t).shorts, `Shorts pan at ${t} + 2`)
  for (const t of [18, 19.5]) close(poses(after, t + 2).still, poses(before, t).still, `still at ${t} + 2`)
  // The still's keys after the freeze moved by the hold; those before stayed.
  assert.deepEqual(after.clips.still.channels!.x!.map((k) => k.time), [2, 4, 12, 20])
  assert.equal(after.clips.still.duration, 22)
})

test('insertTimeElsewhere alone moves the register too (markers, trackers, the pan, the bands)', () => {
  const p = produce(project(), (d) => {
    d.markers = [{ id: 'm', time: 10, color: '#fff', note: '' }]
    insertTimeElsewhere(d, 5, 1, 'none')
  })
  assert.deepEqual(p.markers!.map((m) => m.time), [11])
  assert.deepEqual(p.trackers![0].keyframes.map((k) => k.time), [1, 10, 15])
  assert.deepEqual(p.shorts!.keyframes.map((k) => k.time), [3, 16])
})

// --- every field of the register is moved by its cut and by its insert ----
// (Ç2c patch, item 4: a template's exit `cut` was in no entry — the walk's
// names did not hold it — and the insert of the captions and of the
// templates moved only whole records, not the keys of one running through.)

/** The numbers at a register path (`.` a field, `[]` a list, `{}` a map). */
function valuesAt(root: unknown, path: string): number[] {
  let at: unknown[] = [root]
  for (const seg of path.split('.')) {
    const name = seg.replace(/(\[\]|\{\})+$/, '')
    const next: unknown[] = []
    for (const x of at) {
      if (!x || typeof x !== 'object') continue
      let v: unknown = (x as Record<string, unknown>)[name]
      if (seg.endsWith('[]')) v = Array.isArray(v) ? v : []
      else if (seg.endsWith('{}')) v = v && typeof v === 'object' ? Object.values(v) : []
      if (Array.isArray(v) && (seg.endsWith('[]') || seg.endsWith('{}'))) next.push(...v)
      else next.push(v)
    }
    at = next
  }
  return at.filter((v): v is number => typeof v === 'number').sort((a, b) => a - b)
}

/** One record of every list: one wholly after the points used below, one
 *  (of a list whose times are counted from its own start) running through
 *  them with its inner times after them. */
function everyList(): Project {
  const p = defaultProject()
  const kf = (id: string, time: number) => ({ id, time, x: 0, y: 0, scale: 1, rot: 0, opacity: 1 })
  p.captions = [
    { id: 'after', start: 30, end: 32, text: 'a', layer: 1, manual: true, words: [{ text: 'a', start: 30.2, end: 30.5 }], kfs: [kf('a1', 1)] } as Caption,
    { id: 'through', start: 5, end: 40, text: 'b', layer: 1, manual: true, words: [{ text: 'b', start: 25, end: 25.5 }], kfs: [kf('b1', 20)] } as Caption
  ]
  p.markers = [{ id: 'm', time: 30, color: '#fff', note: '' }]
  p.notes = [{ id: 'n', num: 1, start: 30, end: 31, at: 30.5, kind: 'fix', text: 'x', clip: { id: 'gone', assetId: 'gone', from: 1, to: 2 } } as never]
  p.shortSegments = [{ id: 's', name: 's', start: 30, end: 32, keyframes: [{ id: 'sk', time: 31, x: 10 }] } as never]
  p.shorts = { baseX: 500, keyframes: [{ id: 'pk', time: 31, x: 200 }] }
  p.trackers = [{ id: 'trk', name: 'T', keyframes: [{ id: 'a', time: 31, x: 0, y: 0 }, { id: 'b', time: 33, x: 1, y: 0 }] }]
  p.templates = [
    { id: 'tA', kind: 'atlas', start: 30, duration: 3, items: [] } as unknown as TemplateBlock,
    { id: 'tB', kind: 'atlas', start: 5, duration: 35, cut: 25, items: [{ id: 'i', title: 'x', at: 20 }], cams: [{ t: 20, lon: 0, lat: 0, z: 2 }] } as unknown as TemplateBlock
  ]
  return p
}

test('Ç2c patch, item 4: every field of the register is moved by its cut and by its insert', () => {
  for (const list of TIMED_LISTS) {
    for (const f of list.fields) {
      const was = valuesAt(everyList(), f)
      assert.ok(was.length > 0, `the test project holds ${f}`)
      const cut = produce(everyList(), (d) => list.cut(d, 10, 12))
      assert.notDeepEqual(valuesAt(cut, f), was, `${f} (${list.name}) is not moved by its cut`)
      const ins = produce(everyList(), (d) => list.insert(d, 15, 2))
      assert.notDeepEqual(valuesAt(ins, f), was, `${f} (${list.name}) is not moved by its insert`)
    }
  }
})
