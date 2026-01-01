// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// "Cila" part D (tarifler\CILA.md "D"): the model's side. The new fields'
// store actions (one drag = one undo step, keys on the effect amounts that
// ride along with a split), what a look copies, the project's LUT files (the
// relative path, the reading's repairs, the export's check) and the
// eyedropper's picture of the clip alone.
import { fixture, hash, resetWorld } from './undo-fixture'
import assert from 'node:assert/strict'
import test from 'node:test'
import { useStore, type EditorState } from '../renderer/src/state/store'
import { withRelativePaths } from '../main/project-media'
import { preflight } from '../renderer/src/export/preflight'
import { repairLooks } from '../renderer/src/model/repair'
import { checkProject } from '../renderer/src/model/check'
import { parseProjectFile, serializeProject } from '../renderer/src/media/projectio'
import { fxAmountAt } from '../renderer/src/playback/pose'
import { averageHex, pointOnClip, sourceOnly } from '../renderer/src/playback/eyedropper'
import { setDeclaredLuts, setLocalLut, setProjectLut, tableOf } from '../renderer/src/playback/draw/lut-table'
import { STRINGS } from '../renderer/src/ui/strings'
import { STRINGS_3C } from '../renderer/src/ui/strings-3c'
import { STRINGS_3C3 } from '../renderer/src/ui/strings-3c3'
import { STRINGS_CILA_D } from '../renderer/src/ui/strings-cila-d'
import type { Clip, Project } from '../renderer/src/types'

type S = EditorState
const s = (): S => useStore.getState()
const start = (time = 12): void => {
  resetWorld()
  s().loadProject(fixture())
  useStore.setState({ dirty: false, currentTime: time, selectedClipIds: [], selectedCaptionIds: [] })
}
const clip = (id: string): Clip => s().project.clips[id]

// ---- one drag, one undo step --------------------------------------------------------

const between = (lo: number, hi: number, k: number): number => lo + ((hi - lo) * k) / 5
const DRAGS: { name: string; setup?: () => void; drag: (k: number) => void }[] = [
  { name: 'LUT intensity (setClipLutAmount)', setup: () => s().setClipLut('cb', 'preset:cool'), drag: (k) => s().setClipLutAmount('cb', between(1, 0.3, k)) },
  { name: 'Exposure (setClipTone)', drag: (k) => s().setClipTone('cb', { exposure: between(0, 1.5, k) }) },
  { name: 'Highlights (setClipTone)', drag: (k) => s().setClipTone('cb', { highlights: between(0, -0.8, k) }) },
  { name: 'Glow (setClipFx bloom amount)', drag: (k) => s().setClipFx('cb', { bloom: { amount: between(0, 0.8, k) } }) },
  { name: 'Glow spread (setClipFx bloom radius)', setup: () => s().setClipFx('cb', { bloom: { amount: 0.5 } }), drag: (k) => s().setClipFx('cb', { bloom: { radius: between(0.4, 0.9, k) } }) },
  { name: 'Halation (setClipFx)', drag: (k) => s().setClipFx('cb', { halation: { amount: between(0, 0.7, k) } }) },
  { name: 'Mosaic (setClipFx)', drag: (k) => s().setClipFx('cb', { mosaic: between(0, 40, k) }) },
  { name: 'Colour isolate (setClipFx)', setup: () => s().undoable(() => s().setClipFx('cb', { isolate: {} })), drag: (k) => s().setClipFx('cb', { isolate: { range: between(0.08, 0.3, k) } }) },
  { name: 'Spill removal (setClipChroma)', setup: () => s().undoable(() => s().setClipChroma('cb', { enabled: true })), drag: (k) => s().setClipChroma('cb', { spill: between(0.5, 1, k) }) },
  { name: 'A keyed glow (setClipFx writes onto the key)', setup: () => { s().setClipFx('cb', { bloom: { amount: 0.2 } }); s().toggleFxKey('cb', 'bloom') }, drag: (k) => s().setClipFx('cb', { bloom: { amount: between(0.2, 0.9, k) } }) }
]
for (const f of DRAGS) {
  test(`one drag, one undo step: ${f.name}`, () => {
    start()
    f.setup?.()
    const before = hash(s().project)
    const past0 = s().past.length
    s().armGesture()
    for (let k = 1; k <= 5; k++) f.drag(k)
    s().endGesture()
    assert.notEqual(hash(s().project), before, 'the drag changed the project')
    assert.equal(s().past.length, past0 + 1, 'one undo step for the whole drag')
    const after = hash(s().project)
    s().undo()
    assert.equal(hash(s().project), before, 'undo: the old value')
    s().redo()
    assert.equal(hash(s().project), after, 'redo: the dragged value')
    assert.deepEqual(checkProject(s().project), [], 'the model’s rules hold')
  })
}

// ---- the fields themselves ---------------------------------------------------------

test('new fields: a clip that never had them has none; neutral values leave the project’s meaning alone', () => {
  start()
  const c = clip('cb')
  for (const k of ['lutAmount', 'tone', 'bloom', 'halation', 'mosaic', 'isolate', 'fxKeys'] as const) assert.equal(c[k], undefined, k)
  assert.equal(s().project.luts, undefined)
  // A LUT at full intensity stores no amount; less than full stores it.
  s().setClipLut('cb', 'preset:cool')
  s().setClipLutAmount('cb', 1)
  assert.equal(clip('cb').lutAmount, undefined)
  s().setClipLutAmount('cb', 0.4)
  assert.equal(clip('cb').lutAmount, 0.4)
  s().setClipLutAmount('cb', 7)
  assert.equal(clip('cb').lutAmount, undefined, 'held to 0..1')
  // Mosaic at nothing is no mosaic.
  s().setClipFx('cb', { mosaic: 12 })
  assert.equal(clip('cb').mosaic, 12)
  s().setClipFx('cb', { mosaic: 0 })
  assert.equal(clip('cb').mosaic, undefined)
  // The colour dials: one object, each dial its own field; null takes them off.
  s().setClipTone('cb', { exposure: 0.5 })
  s().setClipTone('cb', { shadows: -0.2 })
  assert.deepEqual(clip('cb').tone, { exposure: 0.5, tint: 0, highlights: 0, shadows: -0.2 })
  s().setClipTone('cb', null)
  assert.equal(clip('cb').tone, undefined)
  // A second dial of an effect keeps the first.
  s().setClipFx('cb', { bloom: { amount: 0.5 } })
  s().setClipFx('cb', { bloom: { threshold: 0.3 } })
  assert.deepEqual(clip('cb').bloom, { amount: 0.5, threshold: 0.3, radius: 0.4 })
  s().setClipFx('cb', { bloom: null })
  assert.equal(clip('cb').bloom, undefined)
})

test('a key made now is the chroma keyer’s; one a project has keeps its own', () => {
  start()
  s().setClipChroma('cb', { enabled: true })
  assert.deepEqual(clip('cb').chroma, { enabled: true, color: '#00d000', method: 'chroma', spill: 0.5, similarity: 0.4, smoothness: 0.1 })
  // A project made before: no method, and patching it does not give it one.
  const p = fixture()
  p.clips.cc.chroma = { enabled: true, color: '#00d000', similarity: 0.35, smoothness: 0.12 }
  resetWorld()
  s().loadProject(p)
  s().setClipChroma('cc', { similarity: 0.5 })
  assert.deepEqual(clip('cc').chroma, { enabled: true, color: '#00d000', similarity: 0.5, smoothness: 0.12 })
  assert.equal(clip('cc').chroma!.method, undefined, 'the first keyer still')
})

// ---- keys on the effect amounts -----------------------------------------------------

test('effect keys: written at the playhead, read between, removed on their frame; the last leaves its value', () => {
  start(12) // 2 s into cb (10..20)
  s().setClipFx('cb', { bloom: { amount: 0.2 } })
  s().toggleFxKey('cb', 'bloom')
  assert.deepEqual(clip('cb').fxKeys!.bloom!.map((k) => [k.time, k.value]), [[2, 0.2]])
  useStore.setState({ currentTime: 16 })
  // Keyed: the dial writes a key where the playhead is, not the base.
  s().setClipFx('cb', { bloom: { amount: 0.8 } })
  assert.deepEqual(clip('cb').fxKeys!.bloom!.map((k) => [k.time, k.value]), [[2, 0.2], [6, 0.8]])
  assert.equal(clip('cb').bloom!.amount, 0.2, 'the base is left')
  assert.equal(fxAmountAt(clip('cb'), 'bloom', 2), 0.2)
  assert.equal(fxAmountAt(clip('cb'), 'bloom', 6), 0.8)
  const mid = fxAmountAt(clip('cb'), 'bloom', 4)
  assert.ok(mid > 0.2 && mid < 0.8, `between the keys: ${mid}`)
  assert.equal(fxAmountAt(clip('cb'), 'bloom', 9), 0.8, 'held after the last')
  // The same frame again: its value changes, no second key.
  s().setClipFx('cb', { bloom: { amount: 0.6 } })
  assert.equal(clip('cb').fxKeys!.bloom!.length, 2)
  assert.deepEqual(checkProject(s().project), [])
  // On a key: the button takes it away; the last one leaves its value as the amount.
  s().toggleFxKey('cb', 'bloom')
  assert.deepEqual(clip('cb').fxKeys!.bloom!.map((k) => k.time), [2])
  useStore.setState({ currentTime: 12 })
  s().toggleFxKey('cb', 'bloom')
  assert.equal(clip('cb').fxKeys, undefined)
  assert.equal(clip('cb').bloom!.amount, 0.2)
  // The playhead off the clip: no key is written (and nothing changes).
  useStore.setState({ currentTime: 3 })
  const before = hash(s().project)
  s().toggleFxKey('cb', 'bloom')
  assert.equal(hash(s().project), before)
  // Mosaic and colour isolate key the same way.
  useStore.setState({ currentTime: 11 })
  s().toggleFxKey('cb', 'mosaic')
  s().setClipFx('cb', { mosaic: 30 })
  assert.deepEqual(clip('cb').fxKeys!.mosaic!.map((k) => [k.time, k.value]), [[1, 30]])
  assert.equal(clip('cb').mosaic, undefined, 'the base stays off')
  s().setClipFx('cb', { mosaic: null })
  assert.equal(clip('cb').fxKeys, undefined, 'switching the effect off takes its keys')
})

test('effect keys ride along with a split: each piece shows what the clip showed there', () => {
  start(12)
  s().setClipFx('cb', { bloom: { amount: 0.1 } })
  s().toggleFxKey('cb', 'bloom')
  useStore.setState({ currentTime: 18 })
  s().setClipFx('cb', { bloom: { amount: 0.9 } })
  const whole = clip('cb')
  const want = [11, 13, 15, 17, 19].map((t) => fxAmountAt(whole, 'bloom', t - whole.start))
  useStore.setState({ currentTime: 15, selectedClipIds: ['cb'] })
  s().splitAtPlayhead()
  const pieces = s().project.tracks.find((t) => t.id === 'v1')!.clipIds.map((id) => clip(id)).filter((c) => c.assetId === 'vid2')
  assert.equal(pieces.length, 2)
  const at = (t: number): number => {
    const c = pieces.find((x) => t >= x.start && t < x.start + x.duration)!
    return fxAmountAt(c, 'bloom', t - c.start)
  }
  assert.deepEqual([11, 13, 15, 17, 19].map(at).map((v) => +v.toFixed(9)), want.map((v) => +v.toFixed(9)))
  assert.notDeepEqual(pieces[0].fxKeys!.bloom!.map((k) => k.id), pieces[1].fxKeys!.bloom!.map((k) => k.id), 'the new piece has its own key ids')
  assert.deepEqual(checkProject(s().project), [])
})

// ---- a look copied -----------------------------------------------------------------

test('paste attributes carries the LUT’s intensity, the colour dials and the four effects', () => {
  start(12)
  s().setClipLut('cb', 'preset:night')
  s().setClipLutAmount('cb', 0.6)
  s().setClipTone('cb', { exposure: 0.4, tint: -0.2 })
  s().setClipFx('cb', { bloom: { amount: 0.5 }, halation: { amount: 0.3, size: 0.7 }, mosaic: 16, isolate: { color: '#2040ff' } })
  s().toggleFxKey('cb', 'halation')
  // The clip pasted onto had keys of its own on glow.
  useStore.setState({ currentTime: 21 })
  s().setClipFx('cc', { bloom: { amount: 0.1 } })
  s().toggleFxKey('cc', 'bloom')
  useStore.setState({ clipboard: [structuredClone(clip('cb'))], selectedClipIds: ['cc'] })
  s().pasteAttributes()
  const got = clip('cc')
  assert.equal(got.lut, 'preset:night')
  assert.equal(got.lutAmount, 0.6)
  assert.deepEqual(got.tone, clip('cb').tone)
  assert.deepEqual(got.bloom, clip('cb').bloom)
  assert.deepEqual(got.halation, clip('cb').halation)
  assert.equal(got.mosaic, 16)
  assert.deepEqual(got.isolate, clip('cb').isolate)
  assert.equal(got.fxKeys, undefined, 'the look is pasted as it stands: no keys, the old ones gone')
  assert.notEqual(got.tone, clip('cb').tone, 'a copy, not the same object')
})

// ---- the project's LUT files -----------------------------------------------------------

test('a LUT file is an asset of the project: one undo step, its relative path with each save, kept through the file', () => {
  start(12)
  const past0 = s().past.length
  s().addProjectLut({ name: 'Kodak', path: 'D:\\Film\\proj\\luts\\Kodak.cube', size: 1234, mtime: 99 }, 'cb')
  assert.equal(s().past.length, past0 + 1)
  assert.deepEqual(s().project.luts, [{ name: 'Kodak', path: 'D:\\Film\\proj\\luts\\Kodak.cube', size: 1234, mtime: 99 }])
  assert.equal(clip('cb').lut, 'Kodak')
  // Imported again from another place: the same name, the new file.
  s().addProjectLut({ name: 'Kodak', path: 'D:\\Film\\proj\\Kodak.cube' })
  assert.equal(s().project.luts!.length, 1)
  assert.equal(s().project.luts![0].path, 'D:\\Film\\proj\\Kodak.cube')
  // Where a file lives is no edit: no undo step, the redo stack kept.
  const past1 = s().past.length
  s().updateProjectLut('Kodak', { path: 'E:\\moved\\Kodak.cube', size: 5 })
  assert.equal(s().past.length, past1)
  assert.equal(s().project.luts![0].path, 'E:\\moved\\Kodak.cube')
  s().undo()
  s().undo()
  assert.equal(s().project.luts, undefined)
  assert.equal(clip('cb').lut, undefined)

  // The file: written, read back, the same; main writes the relative path.
  s().redo()
  const json = serializeProject(s().project)
  const saved = JSON.parse(withRelativePaths(json, 'D:\\Film\\proj\\film.snipp'))
  assert.equal(saved.luts[0].relPath, 'luts/Kodak.cube')
  assert.equal(JSON.parse(withRelativePaths(json, 'E:\\other\\film.snipp')).luts[0].relPath, undefined, 'another drive: none')
  const back = parseProjectFile(JSON.stringify(saved))
  assert.deepEqual(back.luts, [{ name: 'Kodak', path: 'D:\\Film\\proj\\luts\\Kodak.cube', size: 1234, mtime: 99, relPath: 'luts/Kodak.cube' }])
  assert.equal(back.clips.cb.lut, 'Kodak')
})

test('a project file from before: read and written with none of the new fields', () => {
  const p = fixture()
  p.clips.cb.lut = 'MyOldLut'
  p.clips.cb.chroma = { enabled: true, color: '#00d000', similarity: 0.35, smoothness: 0.12 }
  const back = parseProjectFile(serializeProject(p))
  assert.equal(back.luts, undefined)
  assert.equal(back.clips.cb.lut, 'MyOldLut', 'the name it was imported under is kept')
  assert.deepEqual(back.clips.cb.chroma, { enabled: true, color: '#00d000', similarity: 0.35, smoothness: 0.12 })
  assert.equal(hash(back.clips), hash(p.clips))
})

test('the reading mends what it cannot read: values out of range held, unreadable ones dropped, the rest untouched', () => {
  const p = fixture() as unknown as Omit<Project, 'luts'> & { luts?: unknown }
  const c = p.clips as unknown as Record<string, Record<string, unknown>>
  c.cb.lutAmount = 3
  c.cb.tone = { exposure: 9, tint: 0, highlights: 0, shadows: 'x' }
  c.cb.bloom = { amount: 0.5, threshold: 2, radius: 0.4 }
  c.cb.halation = 'much'
  c.cb.mosaic = -4
  c.cb.isolate = { color: 'red', range: 0.1, amount: 1 }
  c.cb.chroma = { enabled: true, color: '#00d000', similarity: 0.3, smoothness: 0.1, method: 'magic', spill: 4 }
  c.cb.fxKeys = { bloom: [{ id: 'a', time: 1, value: 0.5 }], wobble: [] }
  c.cc.tone = { exposure: 0.5, tint: 0.1, highlights: -0.2, shadows: 0.3 }
  c.cc.bloom = { amount: 0.5, threshold: 0.6, radius: 0.4 }
  p.luts = [{ name: 'A', path: 'C:\\a.cube' }, { name: 'A', path: 'C:\\b.cube' }, { name: '', path: 'x' }, 'junk', { name: 'B', path: 'C:\\b.cube', size: 3 }]
  const good = structuredClone(c.cc)
  const whole = p as unknown as Project
  const n = repairLooks(whole)
  assert.ok(n >= 9, `${n} repairs`)
  assert.equal(c.cb.lutAmount, 1)
  assert.equal(c.cb.tone, undefined, 'a dial that is no number: the dials go')
  assert.deepEqual(c.cb.bloom, { amount: 0.5, threshold: 1, radius: 0.4 })
  assert.equal(c.cb.halation, undefined)
  assert.equal(c.cb.mosaic, undefined)
  assert.equal(c.cb.isolate, undefined)
  assert.deepEqual(c.cb.chroma, { enabled: true, color: '#00d000', similarity: 0.3, smoothness: 0.1, spill: 1 })
  assert.deepEqual(Object.keys(c.cb.fxKeys as object), ['bloom'])
  assert.deepEqual(c.cc, good, 'a clip with good values is not touched')
  assert.deepEqual(p.luts, [{ name: 'A', path: 'C:\\a.cube' }, { name: 'B', path: 'C:\\b.cube', size: 3 }])
  assert.equal(repairLooks(whole), 0, 'mended once')
  // A project without any of it: nothing to mend.
  assert.equal(repairLooks(fixture()), 0)
})

test('before the export: a LUT that cannot be drawn is said, once, with where', () => {
  const p = fixture()
  setDeclaredLuts(['Gone', 'Here'])
  setProjectLut('Here', tableOf((c) => c, 2))
  p.clips.ca.lut = 'Gone'
  p.clips.cb.lut = 'Gone'
  p.clips.cc.lut = 'Here'
  p.clips.ov.lut = 'preset:cool'
  const said = preflight(p).filter((i) => /LUT/.test(i.text))
  assert.equal(said.length, 1)
  assert.equal(said[0].kind, 'missing')
  assert.equal(said[0].clipId, 'ca')
  assert.match(said[0].text, /“Gone” is missing \(2 clips\)/)
  // Found again: nothing to say.
  setProjectLut('Gone', tableOf((c) => c, 2))
  assert.equal(preflight(p).filter((i) => /LUT/.test(i.text)).length, 0)
  // A name kept on another computer.
  setDeclaredLuts([])
  p.clips.cc.lut = undefined
  assert.equal(preflight(p).filter((i) => /LUT/.test(i.text)).length, 1)
  setLocalLut('Gone', tableOf((c) => c, 2))
  assert.equal(preflight(p).filter((i) => /LUT/.test(i.text)).length, 0, 'a LUT of this computer goes on working')
  setLocalLut('Gone', null)
})

// ---- the eyedropper's picture -------------------------------------------------------

test('eyedropper: the clip alone, where it stands, with nothing done to its colours', () => {
  const p = fixture()
  Object.assign(p.clips.ov, { grade: { brightness: 1.2, contrast: 1, saturation: 1, warmth: 0 }, lut: 'preset:cool', chroma: { enabled: true, color: '#00d000', similarity: 0.3, smoothness: 0.1 }, vignette: 0.5, opacity: 0.4, blendMode: 'screen', bloom: { amount: 1, threshold: 0.5, radius: 0.5 }, crop: { l: 0.1, t: 0, r: 0, b: 0 }, flipH: true, channels: { opacity: [{ id: 'o', time: 0, value: 0 }], x: [{ id: 'x', time: 0, value: 1400 }] } })
  const alone = sourceOnly(p, 'ov')!
  assert.deepEqual(Object.keys(alone.clips), ['ov'])
  assert.deepEqual(alone.tracks.map((t) => t.clipIds), [['ov']])
  assert.equal(alone.captions.length, 0)
  const c = alone.clips.ov
  for (const k of ['grade', 'lut', 'chroma', 'vignette', 'blendMode', 'bloom'] as const) assert.equal(c[k], undefined, k)
  assert.equal(c.opacity, 1)
  assert.deepEqual(Object.keys(c.channels!), ['x'], 'its motion stays, its fade does not')
  assert.deepEqual(c.transform, p.clips.ov.transform)
  assert.deepEqual(c.crop, { l: 0.1, t: 0, r: 0, b: 0 })
  assert.equal(c.flipH, true)
  assert.equal(p.clips.ov.lut, 'preset:cool', 'the project itself is not touched')
  assert.equal(sourceOnly(p, 'nope'), null)

  // ov: a 1600 × 900 picture at (1400, 300), scale 0.4 → 640 × 360 on the frame.
  const plain = { ...p.clips.ov, crop: undefined, flipH: undefined }
  assert.equal(pointOnClip(p, plain, 3, 1400, 300), true, 'its middle')
  assert.equal(pointOnClip(p, plain, 3, 1400 - 319, 300 + 179), true, 'just inside a corner')
  assert.equal(pointOnClip(p, plain, 3, 1400 - 321, 300), false, 'just outside')
  assert.equal(pointOnClip(p, plain, 3, 100, 900), false)
  // Cropped on its left by a tenth and mirrored: the cut strip is on the right.
  assert.equal(pointOnClip(p, alone.clips.ov, 3, 1400 + 300, 300), false)
  assert.equal(pointOnClip(p, alone.clips.ov, 3, 1400 - 300, 300), true)

  assert.equal(averageHex([10, 20, 30, 255, 20, 40, 50, 255]), '#0f1e28')
  assert.equal(averageHex([0, 208, 0, 255]), '#00d000')
})

// ---- the words ---------------------------------------------------------------------------

test('part D: every key has its Turkish, with the same parameters, is in STRINGS and repeats no other file’s', () => {
  const params = (x: string): string => [...x.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(',')
  const keys = Object.keys(STRINGS_CILA_D)
  assert.ok(keys.length > 30, `${keys.length} keys`)
  for (const [k, e] of Object.entries(STRINGS_CILA_D)) {
    assert.ok(e.en.trim().length > 0, `${k}: English`)
    assert.ok(e.tr.trim().length > 0, `${k}: Turkish`)
    assert.equal(params(e.tr), params(e.en), `${k}: the same parameters`)
    assert.deepEqual((STRINGS as Record<string, unknown>)[k], e, `${k} is in STRINGS`)
  }
  const other = new Set([...Object.keys(STRINGS_3C), ...Object.keys(STRINGS_3C3)])
  assert.deepEqual(keys.filter((k) => other.has(k)), [])
})
