// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// Çekirdek cila S, the transcript panel (CILA.md "S", 7–12) and the WebVTT
// writer: the pure parts the panel is made of.
import './dom-stub'
import assert from 'node:assert/strict'
import test from 'node:test'
import { defaultProject, isSubtitle, type Caption, type Clip, type Project } from '../renderer/src/types'
import { flattenWords, normalizeWord } from '../renderer/src/analysis/words'
import { fillerRows, pauseSlot, pauseTokens, repeatRows, slotRange, wordSlot, PAUSE_MIN } from '../renderer/src/analysis/transcript'
import { analyze, type ReadLoudness } from '../renderer/src/agent/analyze'
import { keptPause } from '../renderer/src/audio/silence'
import { speechBeds } from '../renderer/src/audio/silence-scope'
import { captionsToSrt, captionsToVtt } from '../renderer/src/subtitles/srt'

const T0 = { x: 960, y: 540, scale: 1, rotation: 0 }

/** One line of words: [text, start, end]. */
const line = (id: string, words: [string, number, number][], extra: Partial<Caption> = {}): Caption => ({
  id,
  start: words[0][1],
  end: words[words.length - 1][2],
  text: words.map((w) => w[0]).join(' '),
  words: words.map(([text, start, end]) => ({ text, start, end })),
  ...extra
})

function project(captions: Caption[], music = true): Project {
  const p = defaultProject()
  p.tracks = [
    { id: 'V1', kind: 'video', name: 'V1', clipIds: [] },
    { id: 'A1', kind: 'audio', name: 'A1', clipIds: [] },
    { id: 'A2', kind: 'audio', name: 'Music', clipIds: [] }
  ]
  const a = (id: string, kind: 'video' | 'audio') => ({ id, kind, name: id, url: `media://${id}`, size: 1, duration: 300, width: 1920, height: 1080, hasAudio: true }) as never
  p.assets = [a('voice', 'audio'), a('music', 'audio')]
  const put = (id: string, assetId: string, trackId: string, start: number, duration: number, extra: Partial<Clip> = {}) => {
    p.clips[id] = { id, assetId, trackId, start, inPoint: start, duration, transform: { ...T0 }, volume: 1, ...extra }
    p.tracks.find((t) => t.id === trackId)!.clipIds.push(id)
  }
  put('v1', 'voice', 'A1', 0, 40)
  if (music) put('m1', 'music', 'A2', 0, 40)
  p.captions = captions.map((c) => ({ soundClip: 'v1', ...c }))
  return p
}

/** The voice is loud while a word is said, quiet between; the music steady. */
const loudnessOf = (p: Project): ReadLoudness => async (_p, clip) => {
  const n = Math.ceil(clip.duration / 0.04)
  if (clip.assetId !== 'voice') return new Array<number>(n).fill(-18)
  const said = flattenWords(p.captions.filter(isSubtitle))
  return Array.from({ length: n }, (_, i) => {
    const t = clip.start + (i + 0.5) * 0.04
    return said.some((w) => t >= w.start && t < w.end) ? -20 : -70
  })
}

test('item 7: the panel\'s words are the subtitles\' alone (a title, a text layer and a shape are not speech)', () => {
  const caps: Caption[] = [
    line('s1', [['Hello', 1, 1.4], ['there', 1.5, 2]]),
    { id: 'title', start: 0, end: 5, text: 'BIG TITLE', manual: true } as Caption,
    { id: 'layer', start: 2, end: 4, text: 'On a layer', layer: 1 } as Caption,
    { id: 'box', start: 2, end: 4, text: '', shape: { kind: 'rect' } } as unknown as Caption
  ]
  assert.deepEqual(flattenWords(caps.filter(isSubtitle)).map((w) => w.text), ['Hello', 'there'])
  // (What the panel showed before: every one of them.)
  assert.ok(flattenWords(caps).length > 2)
})

test('item 10: a gap of 0.6 s or more between two words is a pause token; deleting it cuts the pause down to a breath (the silence cut\'s rule)', () => {
  const words = flattenWords([line('a', [['one', 0, 0.5], ['two', 1, 1.5], ['three', 2.1, 2.6], ['four', 4.6, 5]])])
  const pauses = pauseTokens(words)
  // 0.5 s is no pause; 0.6 s and 2 s are.
  assert.deepEqual([...pauses.keys()], [1, 2])
  assert.ok(Math.abs(PAUSE_MIN - 0.6) < 1e-12)
  const long = pauses.get(2)!
  assert.deepEqual([long.start, long.end], [2.6, 4.6])
  const keep = keptPause(2, 0.11, 'natural')
  assert.ok(Math.abs(long.cut[0] - (2.6 + keep * 0.55)) < 1e-9 && Math.abs(long.cut[1] - (4.6 - keep * 0.45)) < 1e-9)
  assert.ok(long.cut[1] - long.cut[0] < 2 && long.cut[1] - long.cut[0] > 1.4, 'a breath stays')
  // The pause alone: its cut. With the words around it: from the first word to the last.
  assert.deepEqual(slotRange(words, pauses, [pauseSlot(2), pauseSlot(2)]), { start: long.cut[0], end: long.cut[1], words: 0, pauses: 1, firstWord: -1, lastWord: -1 })
  assert.deepEqual(slotRange(words, pauses, [wordSlot(2), wordSlot(3)]), { start: 2.1, end: 5, words: 2, pauses: 1, firstWord: 2, lastWord: 3 })
  // A word and the pause after it: to the pause's cut end (the next word keeps its breath).
  const r = slotRange(words, pauses, [wordSlot(2), pauseSlot(2)])!
  assert.equal(r.start, 2.1)
  assert.ok(Math.abs(r.end - long.cut[1]) < 1e-9)
  // A slot that is no pause (0.5 s gap after word 0) is passed over.
  assert.deepEqual(slotRange(words, pauses, [pauseSlot(0), pauseSlot(0)]), null)
  assert.equal(slotRange(words, pauses, [wordSlot(0), pauseSlot(0)])!.end, 0.5)
})

test('item 8: fillers are the agent\'s findings, sure ones ticked, doubtful ones listed with why, the user\'s own words never doubted', async () => {
  const p = project([
    line('a', [['Bugün', 1, 1.4], ['ee,', 1.5, 1.8], ['şunu', 2, 2.4], ['anlatacağım.', 2.5, 3.2]]),
    line('b', [['Aa!', 5, 5.3], ['Ne', 5.4, 5.6], ['güzel.', 5.7, 6.2]]),
    line('c', [['Yani', 8, 8.3], ['bu', 8.4, 8.6], ['ııı', 8.7, 9.1], ['kadar.', 9.5, 10]])
  ])
  const words = flattenWords(p.captions.filter(isSubtitle))
  const r = await analyze(p, { kind: 'fillers' }, 'panel', '', undefined, { loudness: loudnessOf(p) })
  const rows = fillerRows(r.items, words, 'tr', new Set(), normalizeWord)
  assert.deepEqual(rows.map((x) => [x.text, x.sure, x.why ?? '']), [['ee,', true, ''], ['Aa!', false, 'mark'], ['ııı', true, '']])
  assert.deepEqual([rows[0].before, rows[0].after], ['Bugün', 'şunu anlatacağım. Aa!'])
  // The cut is the agent's (a hair of padding either side of the word).
  assert.deepEqual(rows[0].cut, [1.48, 1.82])
  // With "yani" as a word of the user's: found, and sure.
  const mine = await analyze(p, { kind: 'fillers', words: 'yani' }, 'panel', '', undefined, { loudness: loudnessOf(p) })
  const withMine = fillerRows(mine.items, words, 'tr', new Set(['yani']), normalizeWord)
  assert.deepEqual(withMine.map((x) => [x.text, x.sure]), [['ee,', true], ['Aa!', false], ['Yani', true], ['ııı', true]])
})

test('item 8: a sound no word covers comes as a row of its own, not ticked', async () => {
  // (Enough talk after it for the voice's level to be told from its quiet.)
  const p = project([line('a', [['Bugün', 1, 1.4], ['şunu', 3, 3.4], ['anlatacağım.', 3.5, 4.2]]), line('b', Array.from({ length: 34 }, (_, i): [string, number, number] => [`s${i}`, 5 + i, 5.9 + i]))])
  // A short sound at 2.0–2.4 with no word (the recogniser wrote nothing for "ee").
  const base = loudnessOf(p)
  const loud: ReadLoudness = async (q, clip, w, s) => {
    const dbs = (await base(q, clip, w, s))!
    if (clip.assetId === 'voice') for (let i = Math.round(2.0 / 0.04); i < Math.round(2.4 / 0.04); i++) dbs[i] = -20
    return dbs
  }
  const r = await analyze(p, { kind: 'fillers' }, 'panel', '', undefined, { loudness: loud })
  const rows = fillerRows(r.items, flattenWords(p.captions.filter(isSubtitle)), 'tr', new Set(), normalizeWord)
  assert.equal(rows.length, 1)
  assert.deepEqual([rows[0].why, rows[0].sure, rows[0].text, rows[0].before, rows[0].after], ['island', false, '', 'Bugün', 'şunu anlatacağım. s0'])
  assert.ok(rows[0].cut[0] >= 1.9 && rows[0].cut[1] <= 2.5)
})

test('item 9: repeats are the agent\'s findings: the earlier take is the one cut; a pair that is not surely a retake is listed, not ticked', async () => {
  const say = (id: string, t: number, text: string): Caption => line(id, text.split(' ').map((w, i) => [w, t + i * 0.4, t + i * 0.4 + 0.3]))
  const p = project([
    say('a', 1, 'Bu videoda size yeni özelliği gösteriyorum.'),
    say('b', 4, 'Bu videoda size yeni özelliği gösteriyorum.'),
    say('c', 8, 'Sonra ayarlara geçip kaydediyoruz.'),
    say('d', 12, 'Hayır.'),
    say('e', 13, 'Hayır.')
  ])
  const words = flattenWords(p.captions.filter(isSubtitle))
  const r = await analyze(p, { kind: 'repeats' }, 'panel', '', undefined, { loudness: loudnessOf(p) })
  const rows = repeatRows(r.items, words)
  assert.equal(rows[0].sure, true)
  assert.equal(rows[0].text, 'Bu videoda size yeni özelliği gösteriyorum.')
  // The first take (1 s … ) goes, up to where the second begins.
  assert.ok(rows[0].cut[0] < 1.01 && rows[0].cut[1] > 3 && rows[0].cut[1] <= 4.001, JSON.stringify(rows[0].cut))
  const unsure = rows.filter((x) => !x.sure)
  assert.ok(unsure.every((x) => x.why === 'repeat' || x.why === 'island'))
  assert.ok(unsure.some((x) => x.text === 'Hayır.'), JSON.stringify(rows.map((x) => [x.text, x.sure, x.detail])))
})

test('item 12: a cut made in the transcript leaves the tracks the speech\'s cut leaves (the music), found from the sound', async () => {
  const caps = [line('a', Array.from({ length: 30 }, (_, i): [string, number, number] => [`w${i}`, 1 + i, 1.5 + i]))]
  const p = project(caps)
  assert.deepEqual(await speechBeds(p, loudnessOf(p)), ['A2'])
  // (Asked again for the same project: the same answer, not found again.)
  assert.equal(speechBeds(p), speechBeds(p))
  // No music: nothing to keep.
  const q = project(caps, false)
  assert.deepEqual(await speechBeds(q, loudnessOf(q)), [])
  // No subtitles and no talking picture: the speech is not known, nothing is kept.
  const none = project([])
  assert.deepEqual(await speechBeds(none, loudnessOf(none)), [])
})

test('WebVTT: the header, a full stop before the milliseconds, the subtitles only; the SRT writer writes what it wrote', () => {
  const caps: Caption[] = [
    line('s1', [['Hello', 1, 1.4], ['there', 1.5, 2.25]]),
    { id: 's2', start: 3661.5, end: 3663, text: 'a --> b' } as Caption,
    { id: 'layer', start: 2, end: 4, text: 'On a layer', layer: 1 } as Caption
  ]
  assert.equal(captionsToVtt(caps), 'WEBVTT\n\n1\n00:00:01.000 --> 00:00:02.250\nHello there\n\n2\n01:01:01.500 --> 01:01:03.000\na -> b\n')
  assert.equal(captionsToVtt(caps, { perWord: true }).split('\n\n').length, 4, 'the header and three cues')
  assert.equal(captionsToVtt([]), '')
  assert.equal(captionsToSrt(caps), '1\n00:00:01,000 --> 00:00:02,250\nHello there\n\n2\n01:01:01,500 --> 01:01:03,000\na --> b\n')
})
