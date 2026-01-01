// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// Phase Ç2c.1, decision 3 (report K8, K25, D10): an old file's one shared
// keyframe list (`clip.keyframes`) is converted once, when the file is read
// (format 5; nested children too), into the per-property channels it was
// drawn as. Afterwards no clip has a `keyframes` field, the picture is the
// one the old reading drew, the Keyframes list shows the same rows (ids
// `<key id>-<channel>`), and the edits that used to do nothing on such a clip
// (drag a diamond, change a row's easing, delete one property) work the first
// time. The reading also mends keys whatever the format: one key per instant,
// opacity held to 0..1.
import './dom-stub'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { commandByName, runCommand } from '../renderer/src/commands'
import { readProjectToOpen, serializeProject } from '../renderer/src/media/projectio'
import { checkProject, describeProblems } from '../renderer/src/model/check'
import { CONVERSIONS, CURRENT_FORMAT } from '../renderer/src/model/format'
import { clipOpacityAt, clipTransformAt } from '../renderer/src/playback/pose'
import { useStore } from '../renderer/src/state/store'
import { KF_CHANNELS, type Clip, type KfChannel } from '../renderer/src/types'

const FILE = path.join(__dirname, '..', '..', 'src', 'test', 'fixtures', 'format4-legacy-keys.snipp')
const text = (): string => readFileSync(FILE, 'utf8')

type Raw = Record<string, unknown> & { keyframes?: Record<string, unknown>[]; channels?: Record<string, { time: number; value: number; easing?: string; id: string }[]>; nested?: { clips: Raw[] }; opacity?: number; transform: Clip['transform'] }

// -- the old reading (3b6c1cf: types.ts channelKfs and playback/pose.ts), copied --------
function oldChannelKfs(clip: Raw, ch: KfChannel): { id: string; time: number; value: number; easing?: string }[] | undefined {
  const own = clip.channels?.[ch]
  if (own && own.length > 0) return own
  const legacy = clip.keyframes
  if (legacy && legacy.length > 0) {
    if (ch === 'opacity' && !legacy.some((k) => k.opacity !== undefined)) return undefined
    return legacy.map((k) => ({ id: `${k.id}-${ch}`, time: k.time as number, value: ch === 'opacity' ? ((k.opacity as number) ?? clip.opacity ?? 1) : (k[ch] as number), easing: k.easing as string | undefined }))
  }
  return undefined
}
const smooth = (t: number): number => {
  const x = Math.min(1, Math.max(0, t))
  return x * x * (3 - 2 * x)
}
const easeKf = (p: number, e?: string): number => (e === 'linear' ? p : e === 'easeIn' ? p * p : e === 'easeOut' ? p * (2 - p) : smooth(p))
function oldInterp(kfs: { time: number; value: number; easing?: string }[] | undefined, base: number, t: number): number {
  if (!kfs || kfs.length === 0) return base
  const s = [...kfs].sort((a, b) => a.time - b.time)
  if (t <= s[0].time) return s[0].value
  const last = s[s.length - 1]
  if (t >= last.time) return last.value
  for (let i = 0; i < s.length - 1; i++) {
    const a = s[i]
    const b = s[i + 1]
    if (t >= a.time && t <= b.time) return a.value + (b.value - a.value) * easeKf((t - a.time) / Math.max(1e-6, b.time - a.time), b.easing)
  }
  return last.value
}
const oldValues = (c: Raw, t: number): number[] => [
  oldInterp(oldChannelKfs(c, 'x'), c.transform.x, t),
  oldInterp(oldChannelKfs(c, 'y'), c.transform.y, t),
  oldInterp(oldChannelKfs(c, 'scale'), c.transform.scale, t),
  oldInterp(oldChannelKfs(c, 'rotation'), c.transform.rotation, t),
  oldInterp(oldChannelKfs(c, 'opacity'), c.opacity ?? 1, t)
]
const newValues = (c: Clip, t: number): number[] => {
  const tr = clipTransformAt(c, t)
  return [tr.x, tr.y, tr.scale, tr.rotation, clipOpacityAt(c, t)]
}

/** Every clip, nested ones too, of a project (or its raw file). */
function all<C extends { nested?: { clips: C[] } }>(clips: Record<string, C>): C[] {
  const out: C[] = []
  const walk = (list: C[]): void => {
    for (const c of list) {
      out.push(c)
      if (c.nested) walk(c.nested.clips)
    }
  }
  walk(Object.values(clips))
  return out
}

test('K8: an old file opens with no clip holding the old list, every one drawn as before', () => {
  const raw = JSON.parse(text()) as { formatVersion: number; clips: Record<string, Raw> }
  assert.equal(raw.formatVersion, 4)
  assert.equal(all(raw.clips).filter((c) => c.keyframes).length, 3, 'the sample holds the old list on three clips (one nested)')
  const read = readProjectToOpen(text())
  const p = read.project
  assert.equal(describeProblems(checkProject(p)), '')
  const clips = all(p.clips)
  assert.deepEqual(clips.filter((c) => 'keyframes' in c).map((c) => c.id), [], 'no clip has a keyframes field')
  const before = new Map(all(raw.clips).map((c) => [c.id as string, c]))
  for (const c of clips) {
    const o = before.get(c.id)!
    // The channels are what the old reading gave each channel (in time order).
    for (const ch of KF_CHANNELS) {
      const want = oldChannelKfs(o, ch)?.slice().sort((a, b) => a.time - b.time).map((k) => [k.id, k.time, k.value, k.easing])
      const got = c.channels?.[ch]?.map((k) => [k.id, k.time, k.value, k.easing])
      assert.deepEqual(got, want, `${c.id}.${ch}`)
    }
    for (let t = -0.5; t <= 7; t += 0.0625) assert.deepEqual(newValues(c, t), oldValues(o, t), `${c.id} at ${t}`)
  }
  // The clip with channels of its own keeps them; the empty one takes the old list.
  assert.deepEqual(p.clips.b.channels!.scale!.map((k) => k.id), ['own', 'own2'])
  assert.deepEqual(p.clips.b.channels!.x!.map((k) => k.id), ['m2-x', 'm1-x'])
  assert.equal(p.clips.b.channels!.opacity, undefined, 'no opacity on any old key: no opacity channel')
  // Written by this build and read back: the same, nothing mended.
  const again = readProjectToOpen(serializeProject(p))
  assert.deepEqual(again.repaired, [])
  assert.equal(serializeProject(again.project), serializeProject(p))
  assert.equal(JSON.parse(serializeProject(p)).formatVersion, CURRENT_FORMAT)
  // The conversion run twice is the conversion run once.
  const five = CONVERSIONS.find((c) => c.to === 5)!
  const once = structuredClone(raw) as never
  five.run(once)
  const twice = structuredClone(once)
  five.run(twice)
  assert.deepEqual(twice, once)
})

test('K8: on a converted clip a split keeps the motion, a diamond drags, a row\'s easing and a property\'s delete work the first time', () => {
  const p = readProjectToOpen(text()).project
  const orig = structuredClone(p.clips.a)
  const split = runCommand(p, commandByName('clip.split'), { clipIds: ['a'], time: 2.5 }).project
  const right = Object.values(split.clips).find((c) => c.trackId === 'v1' && Math.abs(c.start - 2.5) < 1e-9)!
  for (const u of [0.2, 1.7, 2.4]) assert.deepEqual(newValues(split.clips.a, u), newValues(orig, u))
  for (const u of [0.1, 1.3, 3.4]) {
    const a = newValues(right, u)
    const b = newValues(orig, 2.5 + u)
    assert.ok(a.every((v, i) => Math.abs(v - b[i]) < 1e-9), `right half at ${u}`)
  }
  const s = useStore.getState
  s().loadProject(readProjectToOpen(text()).project)
  s().setKeyframeEasing('a', 'x', 'k2-x', 'easeIn')
  assert.equal(s().project.clips.a.channels!.x!.find((k) => k.id === 'k2-x')!.easing, 'easeIn')
  s().deleteClipKeyframe('a', 'y', 'k3-y')
  assert.deepEqual(s().project.clips.a.channels!.y!.map((k) => k.id), ['k1-y', 'k2-y'])
  s().moveKeyframeGroup('a', 2, 3)
  assert.deepEqual(s().project.clips.a.channels!.x!.map((k) => k.time), [0, 3, 5])
})

test('K25: the reading mends keys of any format — one per instant, opacity held to 0..1', () => {
  const raw = JSON.parse(text())
  raw.formatVersion = CURRENT_FORMAT
  delete raw.clips.b.keyframes
  delete raw.clips.cmp
  raw.tracks[0].clipIds = ['a', 'b']
  delete raw.clips.a.keyframes
  raw.clips.a.channels = {
    opacity: [{ id: 'o1', time: 0, value: 1.4 }, { id: 'o2', time: 1, value: -0.2 }, { id: 'o3', time: 2, value: 0.5 }],
    x: [{ id: 'x2', time: 2, value: 5 }, { id: 'x1', time: 1, value: 10 }, { id: 'x1b', time: 1, value: 99 }, { id: 'x3', time: 1 + 1e-9, value: 7 }]
  }
  raw.captions = [{ id: 'c', text: 't', start: 0, end: 5, manual: true, kfs: [{ id: 'b', time: 2, x: 0, y: 0, scale: 1, rot: 0, opacity: 3 }, { id: 'a', time: 0, x: 0, y: 0, scale: 1, rot: 0, opacity: 1 }] }]
  const read = readProjectToOpen(JSON.stringify(raw))
  const a = read.project.clips.a
  assert.deepEqual(a.channels!.opacity!.map((k) => k.value), [1, 0, 0.5])
  assert.deepEqual(a.channels!.x!.map((k) => k.id), ['x1', 'x2'], 'of the keys at 1 s the first stays')
  assert.deepEqual(read.project.captions[0].kfs!.map((k) => [k.id, k.opacity]), [['a', 1], ['b', 1]])
  assert.ok(read.repaired.some((r) => r.code === 'keys'))
})
