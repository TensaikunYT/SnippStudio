// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// SnippStudio phase 4A.11, Bölüm B (tarifler/FAZ4A-YAMA.md): the round-2
// reviewers' probes on the analyses (R1–R17 retakes, F1–F16 fillers, S1–S4
// silences) as tests, each with its new behaviour: what a PLAIN apply
// (analyze → edit {"op":"apply"}) cuts, and why an item is only listed.
// Each rule's test fails when the rule is taken back (scripts/mutate.mjs,
// B-mutations).
import './dom-stub'
import assert from 'node:assert/strict'
import test from 'node:test'
import { useStore } from '../renderer/src/state/store'
import type { Caption, Clip, Project } from '../renderer/src/types'
import { analyze, chosenItems, type AnalysisResult } from '../renderer/src/agent/analyze'
import { runEdit } from '../renderer/src/agent/edit'
import { resultText } from '../renderer/src/agent/answers'
import { watchLive, rejectDraft } from '../renderer/src/agent/drafts'
import { alignCaptionWordsToText } from '../renderer/src/subtitles/split'
import { ctxOf, open, read, talk, kept, shown, clipOf } from './agent-kit'

const S = useStore.getState
const unwatch = watchLive()
test.after(() => {
  rejectDraft()
  unwatch()
})
const NEVER = { cancelled: () => false }
const W = 0.04

type Line = { text: string; at?: number; noWords?: boolean; estimated?: boolean; gaps?: Record<number, number> }
/** Lines; words 0.4 s apart (0.3 s long), `gaps[i]` more seconds after word
 *  i; 0.5 s between lines unless `at` is given. */
function spoken(lines: Line[], language = 'auto', length = 60): Project {
  const p = talk(length)
  p.transcription = { model: 'multilingual', language } as never
  let t = 0.5
  p.captions = lines.map((l, i) => {
    if (l.at !== undefined) t = l.at
    const words = l.text.split(' ').map((w, k) => {
      const x = { text: w, start: +t.toFixed(2), end: +(t + 0.3).toFixed(2), ...(l.estimated ? { estimated: true } : {}) }
      t += 0.4 + (l.gaps?.[k] ?? 0)
      return x
    })
    t += 0.5
    const c: Caption = { id: `t${i}`, start: words[0].start, end: words[words.length - 1].end, text: l.text, soundClip: 'c1' } as Caption
    if (!l.noWords) c.words = words
    return c
  })
  return p
}

type Run = { r: AnalysisResult; text: string; sure: string[]; unsure: string[]; lost: string[]; lostSec: number }
/** analyze → a plain apply; what it cut (words of the subtitles that are
 *  gone, seconds gone). */
async function run(p: Project, kind: 'repeats' | 'fillers' | 'silences', loud?: (p: Project, c: Clip) => Promise<number[] | null>): Promise<Run> {
  open(p, 'direct')
  const token = read()
  const r = await analyze(S().project, { kind }, 'r1', token, NEVER, { loudness: loud ?? (async () => null) })
  const sure = chosenItems(r).map((i) => i.line)
  const unsure = r.items.filter((i) => i.uncertain).map((i) => i.line)
  const done = await runEdit({ base: token, ops: [{ op: 'apply', result: 'r1' }] }, ctxOf({ results: new Map([['r1', r]]) }))
  const k = kept(S().project)
  const lost = p.captions.flatMap((c) => (c.words ?? []).map((w) => ({ ...w, line: c.id }))).filter((w) => shown(k, w.start, w.end) < 0.5 * (w.end - w.start)).map((w) => `${w.line}:${w.text}`)
  const lostSec = +(p.clips.c1.duration - k.reduce((n, [a, b]) => n + b - a, 0)).toFixed(2)
  rejectDraft()
  return { r, text: `${resultText(r, p)}\n${done.text}`, sure, unsure, lost, lostSec }
}

/** A plain apply cut nothing; the one finding is listed as uncertain, its
 *  line ending with `why`. */
function listedOnly(o: Run, why: RegExp): void {
  assert.deepEqual(o.sure, [], o.text)
  assert.deepEqual(o.lost, [], o.text)
  assert.equal(o.lostSec, 0, o.text)
  assert.equal(o.unsure.length, 1, o.text)
  assert.match(o.unsure[0], why, o.text)
}

// ---- N1: a SURE retake (all six conditions) ---------------------------------

test('N1: a sure retake — five words or more, letter for letter, same end mark, back to back, measured, twice — is cut by a plain apply', async () => {
  const o = await run(spoken([{ text: 'We will open the door.' }, { text: 'We will open the door.' }, { text: 'Then we go.' }], 'en'), 'repeats')
  assert.equal(o.sure.length, 1, o.text)
  assert.match(o.sure[0], /^0\.50-2\.40 = 3\.00… 5w "We will open"$/)
  assert.deepEqual(o.lost, ['t0:We', 't0:will', 't0:open', 't0:the', 't0:door.'])
  assert.match(o.r.head, /^1 sentences said twice word for word, back to back/)
})

test('R1 "Thank you so much." twice (gratitude): four words, listed only', async () => {
  listedOnly(await run(spoken([{ text: 'Thank you so much.' }, { text: 'Thank you so much.' }, { text: 'Now the news.' }], 'en'), 'repeats'), / = .*\(under 5 words\)$/)
})

test('R2 "Thank you. Thank you.": two words, listed only (held)', async () => {
  listedOnly(await run(spoken([{ text: 'Thank you.' }, { text: 'Thank you.' }, { text: 'Now the news.' }], 'en'), 'repeats'), /\(under 5 words\)$/)
})

test('R3 a chant "Are you ready?" twice: a question, listed only', async () => {
  listedOnly(await run(spoken([{ text: 'Are you ready?' }, { text: 'Are you ready?' }, { text: 'Let us go.' }], 'en'), 'repeats'), /\(under 5 words, ends with \?\)$/)
  // Five words and a question: still not sure (N1, 2).
  listedOnly(await run(spoken([{ text: 'Are you ready for this?' }, { text: 'Are you ready for this?' }, { text: 'Let us go.' }], 'en'), 'repeats'), /\(ends with \?\)$/)
  listedOnly(await run(spoken([{ text: 'We are ready for this!' }, { text: 'We are ready for this!' }, { text: 'Let us go.' }], 'en'), 'repeats'), /\(ends with !\)$/)
})

test('R4 a countdown "Three, two, one." twice: listed only', async () => {
  listedOnly(await run(spoken([{ text: 'Three, two, one.' }, { text: 'Three, two, one.' }, { text: 'Go.' }], 'en'), 'repeats'), /\(under 5 words\)$/)
})

test('R5 a question said again as its own answer: listed only', async () => {
  listedOnly(await run(spoken([{ text: 'Why does it matter?' }, { text: 'Why does it matter?' }, { text: 'Because it is ours.' }], 'en'), 'repeats'), /\(under 5 words, ends with \?\)$/)
})

test('R6 other end marks ("Is it true?" / "Is it true."): listed only', async () => {
  listedOnly(await run(spoken([{ text: 'Is it true?' }, { text: 'Is it true.' }, { text: 'Yes.' }], 'en'), 'repeats'), /ends with \?/)
  // Five words, a full stop and "…": not the same end (N1, 2).
  listedOnly(await run(spoken([{ text: 'It is all true, they said.' }, { text: 'It is all true, they said…' }, { text: 'Yes.' }], 'en'), 'repeats'), /\(ends differ\)$/)
})

test('R7 two list items of three words in one line: listed only', async () => {
  listedOnly(await run(spoken([{ text: 'Buy red apples. Buy red apples. And green ones.' }], 'en'), 'repeats'), /\(under 5 words\)$/)
})

test('R8 the same sentence two minutes later: not back to back, listed only', async () => {
  listedOnly(await run(spoken([{ text: 'Welcome back to the show.' }, { text: 'Welcome back to the show.', at: 130 }, { text: 'Today we cook.' }], 'en', 200), 'repeats'), /\(gap 127\.6 s\)$/)
  // 1.5 s apart is back to back; 1.6 s is not (N1, 5).
  const near = await run(spoken([{ text: 'Welcome back to the show.' }, { text: 'Welcome back to the show.', at: 3.9 }, { text: 'Today we cook.' }], 'en'), 'repeats')
  assert.equal(near.sure.length, 1, near.text)
  listedOnly(await run(spoken([{ text: 'Welcome back to the show.' }, { text: 'Welcome back to the show.', at: 4.0 }, { text: 'Today we cook.' }], 'en'), 'repeats'), /\(gap 1\.6 s\)$/)
})

test('R9 the same question 6 s apart, another voice between (no subtitles): listed only', async () => {
  listedOnly(await run(spoken([{ text: 'Did you see it?' }, { text: 'Did you see it?', at: 8 }, { text: 'Yes I did.' }], 'en'), 'repeats'), /\(under 5 words, ends with \?, gap 6\.0 s\)$/)
  listedOnly(await run(spoken([{ text: 'Did you see the new one.' }, { text: 'Did you see the new one.', at: 8 }, { text: 'Yes I did.' }], 'en'), 'repeats'), /\(gap 5\.2 s\)$/)
})

test('R10 Turkish "oldu" / "öldü": other words, listed with them', async () => {
  listedOnly(await run(spoken([{ text: 'Sonunda bu sefer her şey oldu.' }, { text: 'Sonunda bu sefer her şey öldü.' }, { text: 'Bitti.' }], 'tr'), 'repeats'), /~1\.00 .*\(oldu\. → öldü\.\)$/)
  listedOnly(await run(spoken([{ text: 'Sonunda her şey oldu.' }, { text: 'Sonunda her şey öldü.' }, { text: 'Bitti.' }], 'tr'), 'repeats'), /\(oldu\. → öldü\.\) \(under 5 words\)$/)
})

test('R11 Turkish "sınır" / "sinir": ı and i are not folded for the sure cut', async () => {
  listedOnly(await run(spoken([{ text: 'Burada artık hiç sınır yok.' }, { text: 'Burada artık hiç sinir yok.' }, { text: 'Tamam.' }], 'tr'), 'repeats'), /\(sınır → sinir\)$/)
  // Case the Turkish way is not a difference: "IŞIK" is "ışık".
  const same = await run(spoken([{ text: 'Bu ışık çok güzel geliyor.' }, { text: 'BU IŞIK ÇOK GÜZEL GELİYOR.' }, { text: 'Tamam.' }], 'tr'), 'repeats')
  assert.equal(same.sure.length, 1, same.text)
})

test('R12 Turkish "kar" / "kâr": accents are not folded for the sure cut', async () => {
  listedOnly(await run(spoken([{ text: 'Bu yıl çok kar var.' }, { text: 'Bu yıl çok kâr var.' }, { text: 'Güzel.' }], 'tr'), 'repeats'), /\(kar → kâr\)$/)
})

test('R13 a number written two ways: not found (held)', async () => {
  const o = await run(spoken([{ text: 'We sold 100 units.' }, { text: 'We sold one hundred units.' }, { text: 'Good.' }], 'en'), 'repeats')
  assert.deepEqual([o.sure, o.unsure, o.lost], [[], [], []], o.text)
})

test('R14 a refrain said three times: listed only (held)', async () => {
  listedOnly(await run(spoken([{ text: 'We will not give up.' }, { text: 'We will not give up.' }, { text: 'Then more talk here.' }, { text: 'We will not give up.', at: 40 }], 'en'), 'repeats'), /\(said 3 times\)$/)
})

test('R15 a line without word times: listed only (held)', async () => {
  listedOnly(await run(spoken([{ text: 'This is the first take.', noWords: true }, { text: 'This is the first take.' }, { text: 'Next.' }], 'en'), 'repeats'), /\(guessed times\)$/)
})

test('R16 estimated word times (a phrase\'s times spread over its words): listed only (N2)', async () => {
  listedOnly(await run(spoken([{ text: 'This is the first take.', estimated: true }, { text: 'This is the first take.', estimated: true }, { text: 'Next.' }], 'en'), 'repeats'), /\(guessed times\)$/)
  // One take estimated is enough.
  listedOnly(await run(spoken([{ text: 'This is the first take.' }, { text: 'This is the first take.', estimated: true }, { text: 'Next.' }], 'en'), 'repeats'), /\(guessed times\)$/)
})

test('R17 the user corrected the second line ("motor" → "engine"): its words are estimated, listed only (N2)', async () => {
  const p = spoken([{ text: 'We start the engine now.' }, { text: 'We start the motor now.' }, { text: 'Next.' }], 'en')
  const c = p.captions[1]
  c.text = 'We start the engine now.'
  c.words = alignCaptionWordsToText(c.words!, c.text, c.start, c.end)
  assert.equal(c.words.filter((w) => w.estimated).length, 1)
  listedOnly(await run(p, 'repeats'), /\(guessed times\)$/)
})

test('N2: speech with no words next to an estimated word is not read as an unwritten retake', async () => {
  // A sentence, then 1.5 s of speech-level sound with no words, then the
  // next line: an unwritten retake when the words' times are measured, none
  // when the sentence's last word was estimated.
  const loud = (wordsAt: [number, number][]) => async (_p: Project, c: Clip): Promise<number[] | null> =>
    c.id === 'c1' ? Array.from({ length: Math.ceil(c.duration / W) }, (_, i) => (wordsAt.some(([a, b]) => i * W >= a && i * W < b) ? -16 : -60)) : null
  const make = (estimated: boolean): Project => {
    const p = spoken([{ text: 'We built it in a week.' }, { text: 'Then we tested it.', at: 5 }], 'en')
    if (estimated) p.captions[0].words![5].estimated = true
    return p
  }
  const sound = loud([[0.5, 2.8], [3.0, 4.6], [5, 6.6]])
  const measured = await run(make(false), 'repeats', sound)
  assert.equal(measured.unsure.length, 1, measured.text)
  assert.match(measured.unsure[0], /speech, no words/)
  const guessed = await run(make(true), 'repeats', sound)
  assert.equal(guessed.unsure.length, 0, guessed.text)
})

// ---- N4 (and N2): fillers ------------------------------------------------------

test('F1 a quoted "hmm" (a word written about): listed only', async () => {
  listedOnly(await run(spoken([{ text: 'He wrote "hmm" in the margin.' }], 'en'), 'fillers'), /\(in quotes\)$/)
})

test('F2 a brand "Um" opening a sentence that goes on: listed only', async () => {
  listedOnly(await run(spoken([{ text: 'Um is our new app.' }], 'en'), 'fillers'), /"Um" t0#0 \(the sentence goes on\)$/)
  // "Um," (a comma), or a pause of 0.15 s after it: it stands apart, cut.
  for (const l of [{ text: 'Um, this is our new app.' }, { text: 'Um this is our new app.', gaps: { 0: 0.05 } }]) {
    const o = await run(spoken([l], 'en'), 'fillers')
    assert.equal(o.sure.length, 1, o.text)
    assert.deepEqual(o.lost, ['t0:' + l.text.split(' ')[0]], o.text)
  }
  // A pause just short of it: the sentence goes on.
  listedOnly(await run(spoken([{ text: 'Um this is our new app.', gaps: { 0: 0.04 } }], 'en'), 'fillers'), /\(the sentence goes on\)$/)
})

test('F3 "Umm" with a capital inside a line: listed only (held)', async () => {
  listedOnly(await run(spoken([{ text: 'We built Umm last year.' }], 'en'), 'fillers'), /\(a capital inside a sentence\)$/)
})

test('F4 a name "Emm" opening a sentence: listed only', async () => {
  listedOnly(await run(spoken([{ text: 'Emm told me so.' }], 'en'), 'fillers'), /\(the sentence goes on\)$/)
})

test('F5 Turkish "şey yani hani işte ya hı em": words, not sounds (held)', async () => {
  const o = await run(spoken([{ text: 'Şey yani hani işte ya hı em geldi.' }], 'tr'), 'fillers')
  assert.deepEqual([o.sure, o.unsure, o.lost], [[], [], []], o.text)
})

test('F6 English "like so well oh ah": words, not sounds (held)', async () => {
  const o = await run(spoken([{ text: 'Like so well oh ah it was.' }], 'en'), 'fillers')
  assert.deepEqual([o.sure, o.unsure, o.lost], [[], [], []], o.text)
})

test('F7 "uh-huh" / "mm-hmm" (yes): not sounds (held)', async () => {
  const o = await run(spoken([{ text: 'Did you? uh-huh mm-hmm yes.' }], 'en'), 'fillers')
  assert.deepEqual([o.sure, o.unsure, o.lost], [[], [], []], o.text)
})

test('F8 "two aa batteries" (lower case, the sentence goes on): listed only', async () => {
  listedOnly(await run(spoken([{ text: 'Buy two aa batteries.' }], 'en'), 'fillers'), /"aa" t0#2 \(the sentence goes on\)$/)
})

test('F9 Turkish "Aa, ne güzel!" (surprise): it opens a sentence ending in !, listed only', async () => {
  listedOnly(await run(spoken([{ text: 'Aa, ne güzel!' }], 'tr'), 'fillers'), /\(opens a sentence ending in !\)$/)
})

test('F10 Turkish "Ee, sonra ne oldu?" (ee = so): it opens a question, listed only', async () => {
  listedOnly(await run(spoken([{ text: 'Ee, sonra ne oldu?' }], 'tr'), 'fillers'), /\(opens a sentence ending in \?\)$/)
  // The same sound opening a plain sentence, with a comma: cut.
  const o = await run(spoken([{ text: 'Ee, sonra eve döndük.' }], 'tr'), 'fillers')
  assert.deepEqual(o.lost, ['t0:Ee,'], o.text)
})

test('F11 "Hmm." alone on a line after a question (an answer): listed only', async () => {
  listedOnly(await run(spoken([{ text: 'Do you agree?' }, { text: 'Hmm.' }], 'en'), 'fillers'), /"Hmm\." t1#0 \(alone after a question\)$/)
  // After a statement it is a filler: cut.
  const o = await run(spoken([{ text: 'We agree on that.' }, { text: 'Hmm.' }], 'en'), 'fillers')
  assert.deepEqual(o.lost, ['t1:Hmm.'], o.text)
})

test('F9 / D4: a sound said with ! inside a sentence (not opening it) is still listed only', async () => {
  // (N4's "opens a sentence ending in !" does not cover it: the "!" is the
  // sound's own.)
  listedOnly(await run(spoken([{ text: 'Sonra birden aa! dedi.' }], 'tr'), 'fillers'), /"aa!" t0#2 \(said with ! or \?\)$/)
})

test('F12 "auto", Turkish text with no Turkish letter: "Er" listed only (held)', async () => {
  listedOnly(await run(spoken([{ text: 'Er gec gelir dedi.' }], 'auto'), 'fillers'), /\(er \/ err is also a word\)$/)
})

test('F13 "auto", mostly English with Turkish "ııı" and "eee": both are sounds (held); they are sure only when they stand apart (N4)', async () => {
  // The probe's own timing (0.1 s to the next word): found, listed only.
  const o = await run(spoken([{ text: 'So the ııı thing is eee that we go.' }], 'auto'), 'fillers')
  assert.deepEqual(o.sure, [], o.text)
  assert.deepEqual(o.unsure.map((l) => l.split('"')[1]), ['ııı', 'eee'], o.text)
  assert.ok(o.unsure.every((l) => l.endsWith('(the sentence goes on)')), o.text)
  // A pause after each: both cut.
  const apart = await run(spoken([{ text: 'So the ııı thing is eee that we go.', gaps: { 2: 0.2, 5: 0.2 } }], 'auto'), 'fillers')
  assert.deepEqual(apart.lost, ['t0:ııı', 't0:eee'], apart.text)
  // Two sounds in a row, the second followed by a comma: both apart.
  const run2 = await run(spoken([{ text: 'So the ııı eee, thing is that we go.' }], 'auto'), 'fillers')
  assert.deepEqual(run2.lost, ['t0:ııı', 't0:eee,'], run2.text)
})

test('F14 Turkish "Ih" / "ıh" (disgust) inside sentences that go on: listed only', async () => {
  const o = await run(spoken([{ text: 'Ih bu ne böyle.' }, { text: 'Bunu ıh sevmedim.' }], 'tr'), 'fillers')
  assert.deepEqual(o.sure, [], o.text)
  assert.deepEqual(o.lost, [], o.text)
  assert.equal(o.unsure.length, 2, o.text)
})

test('F15 a filler with estimated word times: its seconds are a guess, listed only (N2)', async () => {
  listedOnly(await run(spoken([{ text: 'We eee go now.', estimated: true }], 'tr'), 'fillers'), /"eee" t0#1 \(guessed times\)$/)
  assert.match((await run(spoken([{ text: 'We eee go now.', estimated: true }], 'tr'), 'fillers')).r.head, /1 with no measured word times/)
})

test('F16 a quoted "Um" with a capital inside a line: listed only (held)', async () => {
  listedOnly(await run(spoken([{ text: 'She just said "Um" and left.' }], 'en'), 'fillers'), /\(in quotes\)$/)
})

// ---- N3: silences under another voice -----------------------------------------

/** Talk on c1 (V1), lines k*3 … k*3+1.1; a guest with no subtitles on A1
 *  (g1), speaking 1.5–2.8 s after each line starts. */
function twoVoices(): Project {
  const p = spoken(Array.from({ length: 10 }, (_, k) => ({ text: `alpha${k} beta${k} gamma${k}.`, at: k * 3 })), 'en', 30)
  p.assets.push({ id: 'guest', kind: 'audio', name: 'guest.wav', url: 'media://g', size: 1, duration: 30, hasAudio: true } as never)
  const a1 = p.tracks.find((t) => t.kind === 'audio')!
  p.clips.g1 = clipOf('g1', 'guest', a1.id, 0, 0, 30)
  a1.clipIds = ['g1']
  return p
}
const win = (dur: number, f: (t: number) => number): number[] => Array.from({ length: Math.ceil(dur / W) }, (_, i) => f(i * W))
const host = (t: number): number => (t % 3 < 1.15 ? -16 : -60)
const guest = (t: number): number => (t % 3 > 1.5 && t % 3 < 2.8 ? -16 : -60)
const both = (g: (t: number) => number | null = guest) => async (_p: Project, c: Clip): Promise<number[] | null> =>
  c.id === 'c1' ? win(c.duration, host) : c.id === 'g1' ? (g(0) === null ? null : win(c.duration, g as (t: number) => number)) : null

test('S1 two speaking tracks, the guest with no subtitles: no pause is sure, a plain apply cuts nothing of the guest', async () => {
  const o = await run(twoVoices(), 'silences', both())
  assert.deepEqual(o.sure, [], o.text)
  assert.equal(o.lostSec, 0, o.text)
  assert.equal(o.unsure.length, 10, o.text)
  assert.ok(o.unsure.every((l) => l.endsWith('(g1 at speech level)')), o.text)
  assert.match(o.r.head, /0 pauses to cut.*; 10 with another clip at speech level under them \(uncertain\)/)
  // A guest track that is quiet there (a bed 30 dB under the voice): sure.
  const quiet = await run(twoVoices(), 'silences', both((t) => (t % 3 > 1.5 && t % 3 < 2.8 ? -46 : -60)))
  assert.equal(quiet.sure.length, 10, quiet.text)
  // A clip whose sound cannot be read: not sure either.
  const unread = await run(twoVoices(), 'silences', both(() => null))
  assert.deepEqual(unread.sure, [], unread.text)
  assert.ok(unread.unsure.every((l) => l.endsWith('(g1 not read)')), unread.text)
  // A locked track is not cut with the talk: it does not count.
  const locked = twoVoices()
  locked.tracks.find((t) => t.kind === 'audio')!.locked = true
  assert.equal((await run(locked, 'silences', both())).sure.length, 10)
})

test('S1b what is left of the guest after a plain apply: all of its speech', async () => {
  const p = twoVoices()
  open(p, 'direct')
  const token = read()
  const r = await analyze(S().project, { kind: 'silences' }, 'r1', token, NEVER, { loudness: both() })
  await runEdit({ base: token, ops: [{ op: 'apply', result: 'r1' }] }, ctxOf({ results: new Map([['r1', r]]) }))
  const a1 = S().project.tracks.find((t) => t.kind === 'audio')!
  const gk = a1.clipIds.map((id) => S().project.clips[id]).map((c) => [c.inPoint, c.inPoint + c.duration])
  const speech = Array.from({ length: 10 }, (_, k) => [k * 3 + 1.5, k * 3 + 2.8])
  const keptSec = speech.reduce((n, [a, b]) => n + gk.reduce((m, [x, y]) => m + Math.max(0, Math.min(b, y) - Math.max(a, x)), 0), 0)
  rejectDraft()
  assert.equal(+keptSec.toFixed(2), 13)
})

test('S2 no subtitles, the talking picture and a guest on an audio track: no pause is sure', async () => {
  const p = twoVoices()
  p.captions = []
  const o = await run(p, 'silences', both())
  assert.deepEqual(o.sure, [], o.text)
  assert.equal(o.lostSec, 0, o.text)
  assert.equal(o.unsure.length, 10, o.text)
  assert.ok(o.unsure.every((l) => l.endsWith('(g1 at speech level)')), o.text)
})

test('S3 a pause inside a long word: listed only; the quiet after the talk is cut (held)', async () => {
  const p = spoken([{ text: 'Sooo' }, { text: 'and then.' }], 'en', 10)
  p.captions[0].words = [{ text: 'Sooo', start: 0.5, end: 2.5 }]
  p.captions[0].end = 2.5
  p.captions[1].words = [{ text: 'and', start: 3, end: 3.3 }, { text: 'then.', start: 3.4, end: 3.7 }]
  const o = await run(p, 'silences', async (_p, c) => (c.id === 'c1' ? win(c.duration, (t) => ((t >= 1.2 && t < 1.8) || t > 4 ? -60 : -16)) : null))
  assert.deepEqual(o.sure, ['4.21-10.00'], o.text)
  assert.deepEqual(o.unsure, ['1.37-1.66 (enters a word)'], o.text)
  assert.deepEqual(o.lost, [], o.text)
})

test('S4 a breath before an important word: cut to a natural breath, no word lost (held)', async () => {
  const p = spoken([{ text: 'The winner is' }, { text: 'Ayşe.', at: 2.6 }], 'en', 6)
  const o = await run(p, 'silences', async (_p, c) => (c.id === 'c1' ? win(c.duration, (t) => ((t >= 1.8 && t < 2.6) || t > 3.0 || t < 0.5 ? -60 : -16)) : null))
  assert.equal(o.sure.length, 3, o.text)
  assert.deepEqual(o.lost, [], o.text)
  // The breath keeps 0.16 s or more before "Ayşe."
  const cut = chosenItems(o.r).map((i) => i.cut!).find(([a, b]) => a > 1.5 && b < 2.6)!
  assert.ok(2.6 - cut[1] >= 0.15, JSON.stringify(cut))
})
