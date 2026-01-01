// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// Phase Ç2b.1, decision 5 (4A's K-1): a subtitle line's sound is known by the
// source file of the clip its hint names. After a cut through the line the
// hint stays on one piece while the line lies over two; the music bed under
// it (another file, holding the whole line) used to be taken for its voice,
// so deleting or trimming the other voice piece left its words behind.
import './dom-stub'
import assert from 'node:assert/strict'
import test from 'node:test'
import { defaultProject, type Caption, type Clip, type Project } from '../renderer/src/types'
import { runCommand, commandByName } from '../renderer/src/commands'
import { losesWords, wordsHold } from '../renderer/src/agent/replay'

const T0 = { x: 960, y: 540, scale: 1, rotation: 0 }

function bed(): Project {
  const p = defaultProject()
  p.tracks = [
    { id: 'V1', kind: 'video', name: 'V1', clipIds: [] },
    { id: 'A1', kind: 'audio', name: 'A1', clipIds: [] },
    // A locked bed: a cut leaves it whole, so it holds every line.
    { id: 'A2', kind: 'audio', name: 'A2', clipIds: [], locked: true }
  ]
  const a = (id: string, kind: 'video' | 'audio', duration: number) => ({ id, kind, name: id, url: `media://${id}`, size: 1, duration, width: 1920, height: 1080, hasAudio: true }) as never
  p.assets = [a('talkV', 'video', 300), a('talkA', 'audio', 300), a('music', 'audio', 300)]
  const put = (id: string, assetId: string, trackId: string, start: number, duration: number, extra: Partial<Clip> = {}) => {
    p.clips[id] = { id, assetId, trackId, start, inPoint: 3, duration, transform: { ...T0 }, volume: 1, ...extra }
    p.tracks.find((t) => t.id === trackId)!.clipIds.push(id)
  }
  put('v1', 'talkV', 'V1', 0, 20, { linkId: 'L', audioExtracted: true })
  put('a1', 'talkA', 'A1', 0, 20, { linkId: 'L' })
  put('m1', 'music', 'A2', 0, 36, { volume: 0.4 })
  // Lines of four words, 0.55 s apart, every 3.2 s; all heard in a1.
  p.captions = []
  for (let n = 0, t = 0.4; t + 2.4 < 20; n++, t += 3.2) {
    const words = Array.from({ length: 4 }, (_, i) => ({ text: `w${n}.${i}`, start: +(t + i * 0.55).toFixed(3), end: +(t + i * 0.55 + 0.42).toFixed(3) }))
    p.captions.push({ id: `L${n}`, start: words[0].start, end: words[3].end, text: words.map((w) => w.text).join(' '), words, soundClip: 'a1' } as Caption)
  }
  return p
}

const run = (p: Project, name: string, params: unknown): Project => runCommand(p, commandByName(name), params).project
const wordsIn = (p: Project, a: number, b: number): string[] => p.captions.flatMap((c) => (c.words ?? []).filter((w) => (w.start + w.end) / 2 > a && (w.start + w.end) / 2 < b).map((w) => w.text))
/** The voice piece that now plays from `t` on. */
const pieceAt = (p: Project, t: number): Clip => Object.values(p.clips).find((c) => c.trackId === 'A1' && c.start <= t + 1e-6 && c.start + c.duration > t)!

// L1 runs 3.6–5.67: a cut of 4.05–4.12 (between w1.0 and w1.1) leaves the
// line over two voice pieces, its hint on the left one, its middle over the
// right one (which does not hold the whole line; the music does).
const cutThroughLine = (): Project => run(bed(), 'timeline.cutRanges', { ranges: [[4.05, 4.12]] })

test('K-1: deleting the voice piece a cut left under half a line takes that half\'s words, over a music bed', () => {
  const p = cutThroughLine()
  const right = pieceAt(p, 5)
  assert.notEqual(right.id, 'a1')
  const gone = wordsIn(p, right.start, right.start + right.duration)
  assert.ok(gone.includes('w1.1') && gone.includes('w1.3'))
  const out = run(p, 'clip.delete', { ids: [right.id] })
  const left = wordsIn(out, 0, 100)
  for (const w of gone) assert.ok(!left.includes(w), `${w} lost its sound and is still on screen`)
  assert.ok(left.includes('w1.0') && left.includes('w0.0'), 'the words whose sound stays are kept')
})

test('K-1: trimming the head of that voice piece takes the words it trimmed off, over a music bed', () => {
  const p = cutThroughLine()
  const right = pieceAt(p, 5)
  const out = run(p, 'clip.trimHead', { clipId: right.id, edge: right.start + 1.2 })
  const left = wordsIn(out, 0, 100)
  assert.ok(!left.includes('w1.1') && !left.includes('w1.2'), left.join(' '))
  assert.ok(left.includes('w2.0') && left.includes('w1.0') && left.includes('w1.3'))
})

test('K-1: the music bed is never a line\'s sound, the hint still names its voice after the edit', () => {
  const p = cutThroughLine()
  const right = pieceAt(p, 5)
  const out = run(p, 'clip.delete', { ids: [right.id] })
  for (const c of out.captions) assert.notEqual(c.soundClip, 'm1', `${c.id} follows the music`)
  // A line whose hinted piece a cut removed whole names a piece that exists.
  const cut = run(bed(), 'timeline.cutRanges', { ranges: [[0, 6.9]] })
  for (const c of cut.captions) if (c.soundClip) assert.ok(cut.clips[c.soundClip], `${c.id} names ${c.soundClip}, which is gone`)
})

test('the agent core still refuses an edit that would lose a subtitle word whose sound stays (its guard, now that K-1 no longer trips it)', () => {
  const p = bed()
  const after: Project = { ...p, captions: p.captions.map((c) => (c.id === 'L1' ? { ...c, words: c.words!.slice(1), start: c.words![1].start } : c)) }
  assert.match(String(wordsHold(p, after, 'A1', [], true)), /a subtitle word whose sound is still there would be lost/)
  assert.equal(wordsHold(p, p, 'A1', [], true), null)
  // (The literal run's form of it, and with no anchor nothing is said.)
  assert.equal(losesWords(p, after, 'A1'), true)
  assert.equal(losesWords(p, after, null), false)
})
