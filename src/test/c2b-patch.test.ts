// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// Phase Ç2b, the narrow patch after the audit (FAZC2B-PLAN.md "Ç2b yaması").
// Each case was a failing probe of an auditor (A1–A9, C1, F1, F2, U1, U2,
// AG3), ported here and asserting the safe behaviour.
import './dom-stub'
import assert from 'node:assert/strict'
import test from 'node:test'
import { defaultProject, type Clip, type Project } from '../renderer/src/types'
import { useStore } from '../renderer/src/state/store'
import { mergeCutRanges, silenceRanges } from '../renderer/src/commands/timeline'
import { commandByName, runCommand } from '../renderer/src/commands'
import { clearToasts, currentToasts } from '../renderer/src/ui/toast-core'
import { rippleRange } from '../renderer/src/commands/ops/ripple'
import { withPartners } from '../renderer/src/commands/ops/links'

const S = useStore.getState
const T0 = { x: 960, y: 540, scale: 1, rotation: 0 }

function base(tracks: { id: string; kind: 'video' | 'audio'; autoPack?: boolean; locked?: boolean }[]): Project {
  const p = defaultProject()
  p.tracks = tracks.map((t) => ({ name: t.id, clipIds: [], ...t }))
  const a = (id: string, kind: 'video' | 'audio', duration = 100) => ({ id, kind, name: `${id}.mp4`, url: `media://${id}`, size: 1, duration, width: 1920, height: 1080, hasAudio: true }) as never
  p.assets = [a('vid', 'video'), a('vid2', 'video'), a('snd', 'audio'), a('snd2', 'audio')]
  p.captions = []
  return p
}
function put(p: Project, id: string, assetId: string, trackId: string, start: number, inPoint: number, duration: number, extra: Partial<Clip> = {}): void {
  p.clips[id] = { id, assetId, trackId, start, inPoint, duration, transform: { ...T0 }, volume: 1, ...extra }
  p.tracks.find((t) => t.id === trackId)!.clipIds.push(id)
}
const open = (p: Project, linkAV = true): void => {
  S().loadProject(p)
  useStore.setState({ linkAV, selectedClipIds: [] })
}
/** The media second a forward clip shows at timeline 0 (equal = in sync). */
const off = (c: Clip): number => c.start - c.inPoint
const shape = (c: Clip): string => JSON.stringify([c.start, c.inPoint, c.duration])

// -- item 1 (probe A6): the silence cut and a picked voice with no pause ------

test('item 1 (A6): a picked voice with no pause (or a failed analysis) is loud over its whole span', () => {
  const p = base([{ id: 'V1', kind: 'video' }, { id: 'A1', kind: 'audio' }, { id: 'A2', kind: 'audio' }])
  put(p, 'va', 'snd', 'A1', 0, 0, 20)
  put(p, 'vb', 'snd2', 'A2', 0, 0, 20)
  // The detector found a pause in va only; vb talks all through.
  assert.deepEqual(silenceRanges(p, [{ clipId: 'va', start: 5, end: 8 }], ['va', 'vb']), [])
  // Both quiet over 6–7: only that is cut.
  assert.deepEqual(mergeCutRanges(silenceRanges(p, [{ clipId: 'va', start: 5, end: 8 }, { clipId: 'vb', start: 6, end: 7 }], ['va', 'vb'])), [[6, 7]])
  // vb is picked but lies elsewhere: va's pause is cut.
  p.clips.vb.start = 30
  assert.deepEqual(silenceRanges(p, [{ clipId: 'va', start: 5, end: 8 }], ['va', 'vb']), [[5, 8]])
})

test('item 1 (A6): the store\'s silence cut keeps a picked voice that had no pause', () => {
  const p = base([{ id: 'V1', kind: 'video' }, { id: 'A1', kind: 'audio' }, { id: 'A2', kind: 'audio' }])
  put(p, 'va', 'snd', 'A1', 0, 0, 20)
  put(p, 'vb', 'snd2', 'A2', 0, 0, 20)
  open(p)
  S().applySilenceCuts([{ clipId: 'va', start: 5, end: 8 }], { picked: ['va', 'vb'] })
  const q = S().project
  assert.equal(q.clips.vb.duration, 20, 'vb\'s words stay')
  assert.equal(q.clips.va.duration, 20)
})

// -- item 2 (probes A1, A3): a linked trim or slip moves the pair together ---

test('item 2 (A1): a linked head trim on a packed track with an unpacked partner keeps sync', () => {
  const p = base([{ id: 'V1', kind: 'video', autoPack: true }, { id: 'A1', kind: 'audio' }])
  put(p, 'x', 'vid2', 'V1', 0, 0, 5)
  put(p, 'pic', 'vid', 'V1', 5, 10, 5, { linkId: 'L', audioExtracted: true })
  put(p, 'snd', 'vid', 'A1', 5, 10, 5, { linkId: 'L' })
  open(p)
  S().setClipHead('pic', 3, { start: 5, inPoint: 10, duration: 5 })
  let q = S().project
  assert.equal(off(q.clips.pic), off(q.clips.snd), `pic ${shape(q.clips.pic)} snd ${shape(q.clips.snd)}`)
  // Trimming the head in (later) on the packed track keeps it too.
  open(p)
  S().setClipHead('pic', 6, { start: 5, inPoint: 10, duration: 5 })
  q = S().project
  assert.equal(off(q.clips.pic), off(q.clips.snd), `pic ${shape(q.clips.pic)} snd ${shape(q.clips.snd)}`)
})

test('item 2 (A1): the partner\'s media limit holds the clip too', () => {
  const p = base([{ id: 'V1', kind: 'video', autoPack: true }, { id: 'A1', kind: 'audio' }])
  put(p, 'pic', 'vid', 'V1', 0, 10, 5, { linkId: 'L', audioExtracted: true })
  put(p, 'snd', 'vid', 'A1', 8, 2, 5, { linkId: 'L' }) // a J-cut on another track: 2 s of media before it
  open(p)
  const before = off(p.clips.pic) - off(p.clips.snd)
  S().setClipHead('pic', -5, { start: 0, inPoint: 10, duration: 5 })
  const q = S().project
  assert.ok(Math.abs(off(q.clips.pic) - off(q.clips.snd) - before) < 1e-9, `pic ${shape(q.clips.pic)} snd ${shape(q.clips.snd)}`)
})

test('item 2 (A3): a linked slip after an Alt head trim keeps the pair in sync', () => {
  const p = base([{ id: 'V1', kind: 'video' }, { id: 'A1', kind: 'audio' }])
  put(p, 'pic', 'vid', 'V1', 2, 12, 8, { linkId: 'L', audioExtracted: true })
  put(p, 'snd', 'vid', 'A1', 0, 10, 10, { linkId: 'L' }) // J-cut: the sound starts 2 s earlier
  open(p)
  // A drag from the picture's base, step by step past the sound's limit.
  for (const d of [-4, -8, -11]) S().slipClip('pic', d, 12)
  let q = S().project
  assert.equal(off(q.clips.pic), off(q.clips.snd), `pic in ${q.clips.pic.inPoint} snd in ${q.clips.snd.inPoint}`)
  // ...and back again: both return to where the drag began.
  S().slipClip('pic', 0, 12)
  q = S().project
  assert.equal(q.clips.pic.inPoint, 12)
  assert.equal(q.clips.snd.inPoint, 10)
})

test('item 2 (fuzz seed 2398): a head trim leaves a piece shorter than 0.1 s as long as it is', () => {
  // A cut left v2 a 0.01 s piece between v1 and the rest of the take; an
  // earlier head edge then pushed it over the rest (its limit was negative).
  const p = base([{ id: 'V1', kind: 'video' }, { id: 'A1', kind: 'audio' }])
  put(p, 'v1', 'vid2', 'V1', 0, 0, 18)
  put(p, 'v2', 'vid', 'V1', 18, 40, 0.01, { linkId: 'L', audioExtracted: true })
  put(p, 'v3', 'vid', 'V1', 18.01, 41.78, 16)
  put(p, 'c2', 'vid', 'A1', 18, 40, 0.01, { linkId: 'L' })
  open(p)
  void S().runBatch([{ name: 'clip.trimHead', params: { clipId: 'v2', edge: 16.3 } }] as never)
  const q = S().project
  assert.ok(q.clips.v2.start + q.clips.v2.duration <= q.clips.v3.start + 1e-9, shape(q.clips.v2))
  assert.equal(off(q.clips.v2), off(q.clips.c2))
})

// -- item 3 (probes A5, A5b): a ripple delete over material elsewhere ---------

/** V1: p1 [0,5] and p2 [5,10], each linked to its sound on A1. */
function twoPairs(): Project {
  const p = base([{ id: 'V1', kind: 'video' }, { id: 'A1', kind: 'audio' }])
  put(p, 'p1', 'vid', 'V1', 0, 0, 5, { linkId: 'L1', audioExtracted: true })
  put(p, 's1', 'vid', 'A1', 0, 0, 5, { linkId: 'L1' })
  put(p, 'p2', 'vid2', 'V1', 5, 0, 5, { linkId: 'L2', audioExtracted: true })
  put(p, 's2', 'vid2', 'A1', 5, 0, 5, { linkId: 'L2' })
  return p
}

test('item 3 (A5): a ripple delete with the link off and the sound left under it keeps the gap and the later pairs in sync', () => {
  open(twoPairs(), false)
  clearToasts()
  S().deleteClips(['p1'], true)
  const q = S().project
  assert.equal(q.clips.p1, undefined)
  assert.equal(q.clips.p2.start, 5, 'the gap stays')
  assert.equal(q.clips.s2.start, 5)
  assert.deepEqual(shape(q.clips.s1), shape(twoPairs().clips.s1))
  const told = currentToasts().map((x) => x.text)
  assert.equal(told.filter((x) => /gap was left/i.test(x)).length, 1, told.join(' | '))
  // Alt (only its track) stays an explicit choice: V1 closes up.
  open(twoPairs(), false)
  S().deleteClips(['p1'], true, true)
  assert.equal(S().project.clips.p2.start, 0)
})

test('item 3 (A5b): the agent\'s clip.delete with ripple follows the same rule and says the gap stayed', async () => {
  const q = runCommand(twoPairs(), commandByName('clip.delete')!, { ids: ['p1'], ripple: true }).project
  assert.equal(q.clips.p2.start, q.clips.s2.start)
  assert.equal(q.clips.p2.start, 5)
  // Through the agent's edit tool: the answer says so.
  const { editTool } = await import('../renderer/src/agent/edit')
  const { rejectDraft } = await import('../renderer/src/agent/drafts')
  const kit = await import('./agent-kit')
  const { ctxOf, read } = kit
  kit.open(twoPairs(), 'direct')
  const answer = await editTool({ ops: [{ op: 'clip.delete', ids: ['p1'], ripple: true }], base: read() }, ctxOf())
  rejectDraft()
  const text = typeof answer === 'string' ? answer : JSON.stringify(answer)
  assert.match(text, /the gap stays/, text)
})

test('item 3: with nothing elsewhere the whole timeline still closes up; a title or template wholly inside counts as material', () => {
  const p = base([{ id: 'V1', kind: 'video' }, { id: 'A1', kind: 'audio' }])
  put(p, 'a', 'vid', 'V1', 0, 0, 5)
  put(p, 'b', 'vid2', 'V1', 5, 0, 5)
  put(p, 'm', 'snd', 'A1', 6, 0, 3)
  let q = runCommand(p, commandByName('clip.delete')!, { ids: ['a'], ripple: true }).project
  assert.equal(q.clips.b.start, 0)
  assert.equal(q.clips.m.start, 1)
  const titled = structuredClone(p)
  titled.captions = [{ id: 't', start: 1, end: 3, text: 'Title', manual: true, layer: 1 }]
  q = runCommand(titled, commandByName('clip.delete')!, { ids: ['a'], ripple: true }).project
  assert.equal(q.clips.b.start, 5, 'a title inside: the gap stays')
  assert.equal(q.captions[0].start, 1)
  const templ = structuredClone(p)
  templ.templates = [{ id: 'g', kind: 'quote', start: 1, duration: 2, title: 'x', items: [], style: { accent: '#ffcc00', ink: '#ffffff', card: '#000000', font: 'Inter' }, seed: 1 } as never]
  q = runCommand(templ, commandByName('clip.delete')!, { ids: ['a'], ripple: true }).project
  assert.equal(q.clips.b.start, 5, 'a template inside: the gap stays')
  // A subtitle (it follows its voice) is no material of its own.
  const sub = structuredClone(p)
  sub.captions = [{ id: 's', start: 1, end: 3, text: 'words' }]
  q = runCommand(sub, commandByName('clip.delete')!, { ids: ['a'], ripple: true }).project
  assert.equal(q.clips.b.start, 0)
})

// -- item 4 (probe A8): a locked track is not deleted, its transitions stay ----

test('item 4 (A8): track.delete refuses a locked track; the UI says so and keeps it', () => {
  const p = base([{ id: 'V1', kind: 'video' }, { id: 'V2', kind: 'video', locked: true }, { id: 'A1', kind: 'audio' }])
  put(p, 'keep', 'vid', 'V2', 0, 0, 10)
  assert.throws(() => runCommand(p, commandByName('track.delete')!, { trackId: 'V2' }), /locked/)
  open(p)
  clearToasts()
  S().deleteTrack('V2')
  const q = S().project
  assert.ok(q.tracks.some((t) => t.id === 'V2'))
  assert.ok(q.clips.keep)
  assert.equal(S().past.length, 0, 'no undo step')
  assert.ok(currentToasts().some((x) => /locked/i.test(x.text)), currentToasts().map((x) => x.text).join(' | '))
})

test('item 4: transitions.clear leaves a locked track\'s transitions', () => {
  const p = base([{ id: 'V1', kind: 'video' }, { id: 'V2', kind: 'video', locked: true }, { id: 'A1', kind: 'audio' }])
  put(p, 'a', 'vid', 'V1', 0, 0, 5, { transitionOut: { type: 'mix', duration: 1, to: 'b' } })
  put(p, 'b', 'vid', 'V1', 5, 10, 5)
  put(p, 'c', 'vid2', 'V2', 0, 0, 5, { transitionOut: { type: 'mix', duration: 1, to: 'd' } })
  put(p, 'd', 'vid2', 'V2', 5, 10, 5)
  const q = runCommand(p, commandByName('transitions.clear')!, {}).project
  assert.equal(q.clips.a.transitionOut, undefined)
  assert.equal(q.clips.c.transitionOut?.type, 'mix')
})

// -- item 5 (probe C1): a dissolve inside a compound, sound and elements ------

/** A compound k [0,8] on V1 holding A [0,4] dissolving (1 s) into B [4,8]. */
function compound(speed?: number): Project {
  const kids: Clip[] = [
    { id: 'A', assetId: 'vid', trackId: 'V1', start: 0, inPoint: 10, duration: 4, transform: { ...T0 }, volume: 1, transitionOut: { type: 'mix', duration: 1, to: 'B' } },
    { id: 'B', assetId: 'vid', trackId: 'V1', start: 4, inPoint: 30, duration: 4, transform: { ...T0 }, volume: 1 }
  ]
  const p = base([{ id: 'V1', kind: 'video' }, { id: 'A1', kind: 'audio' }])
  put(p, 'k', '', 'V1', 0, 0, speed ? 8 / speed : 8, { nested: { clips: kids }, ...(speed ? { speed } : {}) })
  return p
}

test('item 5 (C1): the children of a compound cross: sound windows and element spans as outside one', async () => {
  const { flatClipsOfTrack } = await import('../renderer/src/types')
  const { soundWindows, outgoingTransitionWindow, incomingTransitionInfo, clipMediaAt } = await import('../renderer/src/playback/draw/timing')
  const { transitionAudioFade } = await import('../renderer/src/export/audio-window')
  const q = compound()
  const flat = flatClipsOfTrack(q, q.tracks[0])
  const fa = flat.find((c) => c.id === 'A')!
  const fb = flat.find((c) => c.id === 'B')!
  const sa = soundWindows(q, fa)
  const sb = soundWindows(q, fb)
  // As the same two clips laid on V1 directly.
  const top = base([{ id: 'V1', kind: 'video' }, { id: 'A1', kind: 'audio' }])
  for (const c of compound().clips.k.nested!.clips) put(top, c.id, c.assetId, 'V1', c.start, c.inPoint, c.duration, { transitionOut: c.transitionOut })
  assert.deepEqual(sa.out, soundWindows(top, top.clips.A).out)
  assert.deepEqual(sb.in, soundWindows(top, top.clips.B).in)
  assert.ok(sa.out.duration > 0 && sb.in.duration > 0, JSON.stringify([sa, sb]))
  // The engine keeps A's element past its end and B's before its start.
  assert.ok(outgoingTransitionWindow(q, fa).post > 0)
  assert.ok(incomingTransitionInfo(q, fb).pre > 0)
  // The sound crosses: at the middle of the window both are half heard.
  const mid = 4 + sa.out.post / 2
  const ga = transitionAudioFade(mid, fa, sa.out, sa.in, 30)
  const gb = transitionAudioFade(mid, fb, sb.out, sb.in, 30)
  assert.ok(Math.abs(ga + gb - 1) < 1e-9 && ga > 0.1 && gb > 0.1, `${ga} ${gb}`)
  // The ghost frames go on in A's media (not held at its last frame).
  assert.ok(Math.abs(clipMediaAt(q, fa, 4.25).time - 14.25) < 1e-9)
  // At twice the speed the window is on the compound's clock: half as long.
  const fast = compound(2)
  const ff = flatClipsOfTrack(fast, fast.tracks[0]).find((c) => c.id === 'A')!
  assert.ok(Math.abs(outgoingTransitionWindow(fast, ff).duration - sa.out.duration / 2) < 1e-9)
})

// -- item 6 (probes F1, F2): format 4 reads the layout the repair leaves ------

function fileOf(clips: Record<string, Partial<Clip>>, assetDur = 100): Record<string, unknown> {
  const p = defaultProject() as unknown as Record<string, unknown>
  const proj = p as unknown as Project
  proj.tracks = [{ id: 'V1', kind: 'video', name: 'V1', clipIds: Object.keys(clips) }, { id: 'A1', kind: 'audio', name: 'A1', clipIds: [] }]
  proj.assets = [{ id: 'film', kind: 'video', name: 'film.mp4', url: 'media://film', size: 1, duration: assetDur, width: 1920, height: 1080, hasAudio: true }] as never
  proj.clips = {}
  for (const [id, c] of Object.entries(clips)) proj.clips[id] = { id, assetId: 'film', trackId: 'V1', inPoint: 0, transform: { ...T0 }, volume: 1, ...c } as Clip
  p.version = 1
  delete p.formatVersion
  return p
}

test('item 6 (F1): a format-1 file with an overlap the open repairs keeps the crossfade it showed', async () => {
  const { readProjectFile } = await import('../renderer/src/media/projectio')
  const { outgoingTransitionWindow } = await import('../renderer/src/playback/draw/timing')
  const raw = fileOf({ A: { start: 0, duration: 5, inPoint: 10, transitionOut: { type: 'mix', duration: 1 } as never }, B: { start: 4.5, duration: 5, inPoint: 40 } })
  const { project } = readProjectFile(JSON.stringify(raw))
  assert.equal(project.clips.B.start, 5, 'the repair moved B to A\'s end')
  assert.equal(project.clips.A.transitionOut?.to, 'B')
  assert.ok(outgoingTransitionWindow(project, project.clips.A).post > 0)
})

test('item 6 (F2): a file whose clip the open shortens to its media keeps its fade-out', async () => {
  const { readProjectFile } = await import('../renderer/src/media/projectio')
  const { outgoingTransitionWindow } = await import('../renderer/src/playback/draw/timing')
  const raw = fileOf({ A: { start: 0, duration: 5, inPoint: 0, transitionOut: { type: 'mix', duration: 1 } as never }, B: { start: 5, duration: 5, inPoint: 40 } }, 50) as { assets: unknown[]; clips: Record<string, Clip> }
  raw.assets.push({ id: 'short', kind: 'video', name: 's.mp4', url: 'media://s', size: 1, duration: 4, width: 1920, height: 1080, hasAudio: true })
  raw.clips.A.assetId = 'short'
  const { project } = readProjectFile(JSON.stringify(raw))
  assert.ok(Math.abs(project.clips.A.duration - 4) < 1e-6)
  assert.equal(project.clips.A.transitionOut?.to, null)
  assert.ok(outgoingTransitionWindow(project, project.clips.A).duration > 0, 'a fade-out, as the file showed')
})

// -- item 7 (probes U1, U2, AG3): setting a transition again re-points it ----

test('item 7 (U1, U2): a type or length set again goes into the clip that meets it now', async () => {
  const { outgoingTransitionWindow } = await import('../renderer/src/playback/draw/timing')
  const kit = await import('./agent-kit')
  const p = kit.talk(20)
  p.assets.push({ id: 'spare', kind: 'video', name: 'spare.mp4', url: 'media://spare', size: 1, duration: 20, width: 1920, height: 1080, hasAudio: true } as never)
  kit.open(p, 'direct')
  S().setTransitionOut('c1', { type: 'mix', duration: 1 })
  assert.equal(S().project.clips.c1.transitionOut?.to, null, 'nothing after it: a fade-out')
  void S().runBatch([{ name: 'clip.add', params: { assetId: 'spare', trackId: p.tracks[0].id, start: 20, id: 'nx' } }] as never)
  // (Dropped next to it later: still the fade-out the user saw, until set again.)
  assert.equal(S().project.clips.c1.transitionOut?.to, null)
  // What the junction menu and the inspector send: the old value spread, a new type.
  S().setTransitionOut('c1', { ...S().project.clips.c1.transitionOut!, type: 'wipe' })
  let q = S().project
  assert.equal(q.clips.c1.transitionOut?.to, 'nx')
  assert.ok(outgoingTransitionWindow(q, q.clips.c1).duration > 0, 'the wipe is drawn')
  // A length set again (the inspector's slider) keeps the partner it meets.
  S().setTransitionOut('c1', { ...q.clips.c1.transitionOut!, duration: 0.5 })
  q = S().project
  assert.equal(q.clips.c1.transitionOut?.to, 'nx')
  assert.equal(q.clips.c1.transitionOut?.duration, 0.5)
})

test('item 7 (AG3): the agent setting a transition again re-points a fade-out at the clip now after it', async () => {
  const { editTool } = await import('../renderer/src/agent/edit')
  const { rejectDraft } = await import('../renderer/src/agent/drafts')
  const kit = await import('./agent-kit')
  const p = kit.talk(20)
  p.assets.push({ id: 'spare', kind: 'video', name: 'spare.mp4', url: 'media://spare', size: 1, duration: 20, width: 1920, height: 1080, hasAudio: true } as never)
  p.clips.c1.transitionOut = { type: 'mix', duration: 1, to: null }
  p.clips.nx = { ...p.clips.c1, id: 'nx', assetId: 'spare', start: 20, inPoint: 0, duration: 5, transitionOut: undefined }
  delete p.clips.nx.transitionOut
  p.tracks[0].clipIds.push('nx')
  p.captions = []
  kit.open(p, 'direct')
  await editTool({ ops: [{ op: 'clip.setTransition', clipId: 'c1', transition: { type: 'mix', duration: 1 } }], base: kit.read() }, kit.ctxOf())
  rejectDraft()
  assert.equal(S().project.clips.c1.transitionOut?.to, 'nx')
})

// -- item 8 (probe A4): a clip the move pushes takes its partner --------------

test('item 8 (A4): clip.move without linkAV pushing a linked pair moves the pair together', () => {
  const p = base([{ id: 'V1', kind: 'video' }, { id: 'A1', kind: 'audio' }])
  put(p, 'm', 'vid2', 'V1', 0, 0, 5)
  put(p, 'pic', 'vid', 'V1', 6, 10, 5, { linkId: 'L', audioExtracted: true })
  put(p, 'snd', 'vid', 'A1', 6, 10, 5, { linkId: 'L' })
  const q = runCommand(p, commandByName('clip.move')!, { clipId: 'm', start: 4 }).project
  assert.equal(q.clips.m.start, 4)
  assert.equal(q.clips.pic.start, 9, 'pushed')
  assert.equal(q.clips.pic.start - q.clips.snd.start, 0, `pic ${q.clips.pic.start} snd ${q.clips.snd.start}`)
  // The moved clip itself (link off) still moves alone.
  const own = base([{ id: 'V1', kind: 'video' }, { id: 'A1', kind: 'audio' }])
  put(own, 'pic', 'vid', 'V1', 0, 10, 5, { linkId: 'L', audioExtracted: true })
  put(own, 'snd', 'vid', 'A1', 0, 10, 5, { linkId: 'L' })
  const r = runCommand(own, commandByName('clip.move')!, { clipId: 'pic', start: 20 }).project
  assert.equal(r.clips.pic.start, 20)
  assert.equal(r.clips.snd.start, 0)
})

// -- item 9 (probe A7): a subtitle of a video whose sound was extracted -------

test('item 9 (A7): a subtitle of a video follows its sound after the sound was extracted', async () => {
  const { followClipEdits } = await import('../renderer/src/subtitles/follow')
  const p = base([{ id: 'V1', kind: 'video' }, { id: 'A1', kind: 'audio' }])
  p.assets.push({ id: 'vidA', kind: 'audio', name: 'vid.mp4 (audio)', url: 'media://vid', size: 1, duration: 100, width: 1920, height: 1080, hasAudio: true } as never)
  put(p, 'pic', 'vid', 'V1', 0, 0, 10, { linkId: 'L', audioExtracted: true })
  put(p, 'snd', 'vidA', 'A1', 0, 0, 10, { linkId: 'L' })
  // Made from the video's own sound before the extraction: it names the video clip.
  p.captions = [{ id: 'c1', text: 'hello there', start: 2, end: 3, soundClip: 'pic', words: [{ text: 'hello', start: 2, end: 2.5 }, { text: 'there', start: 2.5, end: 3 }] }]
  const next: Project = structuredClone(p)
  next.clips.pic.start = 4
  next.clips.snd.start = 4
  followClipEdits(p, next)
  assert.equal(next.captions[0].start, 6)
  assert.equal(next.captions[0].words![1].end, 7)
})

// -- item 10 (aud1 probe): the oracle's laysAsBefore --------------------------

test('item 10: laysAsBefore does not take a placement "on no talk" after talk was moved under that second', async () => {
  const { ownSoundOverMusic } = await import('./oracle/fixture')
  const { laysAsBefore } = await import('./oracle/oracle')
  const { contentAt } = await import('./oracle/sample')
  const copy = <T>(x: T): T => JSON.parse(JSON.stringify(x))
  const s = ownSoundOverMusic()
  const seen = copy(s.project)
  // The user deleted c1 (no ripple): V1 is empty 0–18. The agent reads now.
  delete seen.clips.c1
  for (const t of seen.tracks) t.clipIds = t.clipIds.filter((id) => id !== 'c1')
  assert.equal(contentAt(seen, 'V1', 5), null, 'no talk at 5 s when the agent read')
  // Then the user moved c2 from 18 to 3: talk now under 5 s.
  const now = copy(seen)
  now.clips.c2.start = 3
  assert.ok(contentAt(now, 'V1', 5), 'talk under 5 s now')
  const M = copy(now)
  M.markers = [...(M.markers ?? []), { id: 'mk', time: 5 } as never]
  const it = { fam: 'place', name: 'marker.add', ref: null, seenTime: 5 } as never
  assert.equal(laysAsBefore(seen, now, it, 5, M), false, 'talk the agent never saw there')
  // Nothing moved: the same second still means the same.
  assert.equal(laysAsBefore(seen, copy(seen), it, 5, M), true)
})

// -- acceptance (managing session): a ripple cut gives the right pieces a link of their own

test('a ripple cut through a linked pair: left pieces stay one pair, right pieces become another', () => {
  const p = base([{ id: 'V1', kind: 'video' }, { id: 'A1', kind: 'audio' }])
  put(p, 'v', 'vid', 'V1', 0, 0, 10, { linkId: 'L' })
  put(p, 's', 'snd', 'A1', 0, 0, 10, { linkId: 'L' })
  open(p)
  rippleRange(S().project, [[4, 5]], null)
  const clips = Object.values(S().project.clips)
  assert.equal(clips.length, 4)
  const left = clips.filter((c) => c.start === 0)
  const right = clips.filter((c) => c.start > 0)
  assert.equal(left.length, 2)
  assert.equal(right.length, 2)
  assert.ok(left[0].linkId && left[0].linkId === left[1].linkId)
  assert.ok(right[0].linkId && right[0].linkId === right[1].linkId)
  assert.notEqual(left[0].linkId, right[0].linkId)
  const v = left.find((c) => c.trackId === 'V1')!
  assert.deepEqual(withPartners(S().project, [v.id]).sort(), left.map((c) => c.id).sort())
})

test('a ripple cut that leaves one side of a link alone drops that link', () => {
  const p = base([{ id: 'V1', kind: 'video' }, { id: 'A1', kind: 'audio' }])
  put(p, 'v', 'vid', 'V1', 0, 0, 10, { linkId: 'L' })
  put(p, 's', 'snd', 'A1', 0, 0, 4.5, { linkId: 'L' })
  open(p)
  rippleRange(S().project, [[4, 5]], null)
  const clips = Object.values(S().project.clips)
  const vRight = clips.find((c) => c.trackId === 'V1' && c.start > 0)!
  assert.equal(vRight.linkId, undefined)
  const vLeft = clips.find((c) => c.trackId === 'V1' && c.start === 0)!
  const sLeft = clips.find((c) => c.trackId === 'A1')!
  assert.equal(vLeft.linkId, 'L')
  assert.equal(sLeft.linkId, 'L')
})
