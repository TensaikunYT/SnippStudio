// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// SnippStudio phase 4A.10, part II (FAZ4A-PLAN.md 9): the analyses an agent
// runs, through the real path (analyze → edit "apply" → the timeline), on
// the cases the 4A.9 verification found (haritalar\_faz4a9-dogrulama.md,
// analyses#…, safety#7, safety#9).
import './dom-stub'
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { useStore } from '../renderer/src/state/store'
import type { Asset, Caption, Clip, Project } from '../renderer/src/types'
import { analyze, chosenItems, type AnalysisResult } from '../renderer/src/agent/analyze'
import { runEdit } from '../renderer/src/agent/edit'
import { resultText } from '../renderer/src/agent/answers'
import { watchLive, rejectDraft } from '../renderer/src/agent/drafts'
import { ctxOf, open, read, talk, clipOf, shown, kept } from './agent-kit'

const S = useStore.getState
const unwatch = watchLive()
test.after(() => unwatch())
const W = 0.04
const NEVER = { cancelled: () => false }

/** Windows of `dur` seconds, `f(t)` dB each. */
const windows = (dur: number, f: (t: number) => number): number[] => Array.from({ length: Math.ceil(dur / W) }, (_, i) => f(i * W))

/** 30 s of talk on c1 (V1), 15 lines of three words, continuous speech (a
 *  0.1 s dip every 2 s); a music bed on A1 that fades in from silence and out
 *  to it; an effect on A2 (0.3 s hit, then digital silence); a B-roll video
 *  with an empty sound track on V2. */
function busy(): Project {
  const p = talk(30)
  p.captions = Array.from({ length: 15 }, (_, k) => ({
    id: `L${k}`, start: k * 2, end: k * 2 + 1.9, text: `alpha${k} beta${k} gamma${k}`, soundClip: 'c1',
    words: [0, 1, 2].map((j) => ({ text: ['alpha', 'beta', 'gamma'][j] + k, start: k * 2 + j * 0.63, end: k * 2 + j * 0.63 + 0.6 }))
  }))
  const audio = (id: string, duration: number): Asset => ({ id, kind: 'audio', name: `${id}.wav`, url: `media://${id}`, size: 1, duration, hasAudio: true }) as Asset
  p.assets.push(audio('mus', 30), audio('sfx', 4), { id: 'br', kind: 'video', name: 'br.mp4', url: 'media://br', size: 1, duration: 6, width: 1920, height: 1080, hasAudio: true } as Asset)
  const a1 = p.tracks.find((t) => t.kind === 'audio')!
  p.clips.m1 = clipOf('m1', 'mus', a1.id, 0, 0, 30)
  a1.clipIds = ['m1']
  p.tracks.push({ id: 'a2track000001', kind: 'audio', name: 'A2', clipIds: ['s1'] } as never)
  p.clips.s1 = clipOf('s1', 'sfx', 'a2track000001', 6, 0, 4)
  p.tracks.splice(1, 0, { id: 'v2track000001', kind: 'video', name: 'V2', clipIds: ['b1'] } as never)
  p.clips.b1 = clipOf('b1', 'br', 'v2track000001', 16, 0, 6)
  return p
}

function reader(voice: (t: number) => number, bed = -24) {
  return async (_p: Project, clip: Clip): Promise<number[] | null> => {
    if (clip.id === 'c1') return windows(clip.duration, voice)
    if (clip.id === 'm1') return windows(clip.duration, (t) => (t < 3 ? -90 + ((90 + bed) * t) / 3 : t > clip.duration - 3 ? bed - ((90 + bed) * (t - (clip.duration - 3))) / 3 : bed))
    if (clip.id === 's1') return windows(clip.duration, (t) => (t < 0.3 ? -10 : -90))
    if (clip.id === 'b1') return windows(clip.duration, () => -90)
    return null
  }
}
const talking = (t: number): number => (t % 2 < 1.9 ? -16 : -45)

async function silencesThenApply(p: Project, voice: (t: number) => number): Promise<{ r: AnalysisResult; text: string; lost: string[] }> {
  open(p, 'direct')
  const token = read()
  const r = await analyze(S().project, { kind: 'silences' }, 'r1', token, NEVER, { loudness: reader(voice) })
  const done = await runEdit({ base: token, ops: [{ op: 'apply', result: 'r1' }] }, ctxOf({ results: new Map([['r1', r]]) }))
  const k = kept(S().project)
  const lost = p.captions.flatMap((c) => c.words!).filter((w) => shown(k, w.start, w.end) < 0.5 * (w.end - w.start)).map((w) => w.text)
  rejectDraft()
  return { r, text: `${resultText(r, p)}\n${done.text}`, lost }
}

test('D1 (analyses#1): silences are measured on the speech only — a fading music bed, an effect ending in digital silence and a silent B-roll cut nothing of the talk', async () => {
  const { r, text, lost } = await silencesThenApply(busy(), talking)
  assert.deepEqual(lost, [], text)
  assert.equal(r.items.filter((i) => !i.uncertain).length, 0, text)
  // The threshold said is the speech clip's (−45…−16 dB talk), not −80 of
  // an all-quiet clip.
  assert.doesNotMatch(r.head, /-80/)
  assert.match(r.head, /in the speech only/)
})

test('D1: a real pause in the speech is found; a range that enters a subtitle word by more than 0.05 s is uncertain', async () => {
  // The sound is quiet at 9.9–11.1 s although the line L5 says its words
  // are there (the subtitle and the sound disagree): only listed. At
  // 22.0–23.9 s nothing is said (L11 is not there): a pause, cut — with the
  // music bed 14 dB under the voice. A bed only 8 dB under it is at speech
  // level (phase 4A.11, N3): the pause is listed, with the bed's name.
  const p = busy()
  p.captions = p.captions.filter((c) => c.id !== 'L11')
  const quiet = (t: number): number => (t >= 9.9 && t < 11.1) || (t >= 22 && t < 23.9) ? -60 : talking(t)
  open(p, 'direct')
  const r = await analyze(S().project, { kind: 'silences' }, 'r1', read(), NEVER, { loudness: reader(quiet, -30) })
  const loud = await analyze(S().project, { kind: 'silences' }, 'r2', read(), NEVER, { loudness: reader(quiet) })
  rejectDraft()
  const sure = r.items.filter((i) => !i.uncertain).map((i) => i.cut!)
  const unsure = r.items.filter((i) => i.uncertain).map((i) => i.cut!)
  assert.equal(sure.length, 1, resultText(r, p))
  assert.ok(sure[0][0] >= 22 && sure[0][1] <= 23.9, resultText(r, p))
  assert.equal(unsure.length, 1, resultText(r, p))
  assert.ok(unsure[0][0] < 10.6 && unsure[0][1] > 10.05)
  assert.match(r.head, /1 enter a subtitle word \(uncertain\)/)
  assert.deepEqual(chosenItems(r).map((i) => i.cut), sure)
  assert.deepEqual(loud.items.map((i) => [i.line.replace(/^[\d.-]+ /, ''), !!i.uncertain]), [['(enters a word)', true], ['(m1 at speech level)', true]], resultText(loud, p))
  assert.equal(chosenItems(loud).length, 0)
})

test('D1: with no subtitles the speech is the talking picture, never the music bed; with two talking pictures it cannot be told', async () => {
  // The talk has a real pause at 14–15.5 s; the bed's fade-in and fade-out
  // are quiet but are not the speech.
  const p = busy()
  p.captions = []
  delete p.clips.b1
  p.tracks = p.tracks.filter((t) => t.id !== 'v2track000001')
  const pause = (t: number): number => (t >= 14 && t < 15.5 ? -60 : talking(t))
  const { r, text } = await silencesThenApply(p, pause)
  const cuts = r.items.map((i) => i.cut!)
  assert.equal(cuts.length, 1, text)
  assert.ok(cuts[0][0] >= 14 && cuts[0][1] <= 15.5, text)
  // A B-roll with a sound track of its own as well: which picture talks is
  // not known (agent/content.ts anchorTrack), so nothing is measured.
  const two = await silencesThenApply(Object.assign(busy(), { captions: [] }), pause)
  assert.equal(two.r.items.length, 0, two.text)
  assert.match(two.r.head, /no clip is known to be the speech/)
})

/** One subtitle line per text, its words 0.4 s apart (with word times). */
function spoken(texts: string[], language = 'auto'): Project {
  const p = talk(30)
  p.transcription = { model: 'multilingual', language } as never
  let t = 0.5
  p.captions = texts.map((text, i) => {
    const words = text.split(' ').map((w) => {
      const x = { text: w, start: +t.toFixed(2), end: +(t + 0.3).toFixed(2) }
      t += 0.4
      return x
    })
    t += 0.5
    return { id: `t${i}`, start: words[0].start, end: words[words.length - 1].end, text, words, soundClip: 'c1' }
  })
  return p
}

async function fillersApplied(p: Project): Promise<{ r: AnalysisResult; text: string; captions: string }> {
  open(p, 'direct')
  const token = read()
  const r = await analyze(S().project, { kind: 'fillers' }, 'r1', token, NEVER, { loudness: async () => null })
  const done = await runEdit({ base: token, ops: [{ op: 'apply', result: 'r1' }] }, ctxOf({ results: new Map([['r1', r]]) }))
  const captions = S().project.captions.map((c) => c.text).join(' | ')
  rejectDraft()
  return { r, text: `${resultText(r, p)}\n${done.text}`, captions }
}

test('D4 (analyses#6): English "er", "err" and a capital inside a sentence are uncertain; a plain apply cuts only "Um"', async () => {
  const { r, text, captions } = await fillersApplied(spoken(['To err is human, said Dr. Er.', 'Um, yes.', 'We er went home.'], 'en'))
  assert.deepEqual(r.items.filter((i) => !i.uncertain).map((i) => i.line.split('"')[1]), ['Um,'], text)
  assert.deepEqual(r.items.filter((i) => i.uncertain).map((i) => i.line.split('"')[1]), ['err', 'Er.', 'er'], text)
  assert.match(text, /"err" t0#1 \(er \/ err is also a word\)/)
  assert.equal(captions, 'To err is human, said Dr. Er. | yes. | We er went home.')
  // A capital inside a sentence ("then Ee said"), Turkish: a name, uncertain.
  const tr = await fillersApplied(spoken(['Sonra Eee geldi ve ee, gitti.'], 'tr'))
  assert.deepEqual(tr.r.items.map((i) => [i.line.split('"')[1], !!i.uncertain]), [['ee,', false], ['Eee', true]], tr.text)
})

test('D4 (analyses#8): a sound said with "!" or "?" is uncertain ("Aa!", "Ee?", "Hmm?")', async () => {
  const { r, text } = await fillersApplied(spoken(['Aa!', 'Ee? Sonra ne oldu?', 'Bunu eee… bilmiyorum.', 'Hmm? Peki.'], 'tr'))
  assert.deepEqual(r.items.map((i) => [i.line.split('"')[1], !!i.uncertain]), [['eee…', false], ['Aa!', true], ['Ee?', true], ['Hmm?', true]], text)
  assert.match(r.head, /3 that may be a word or meant \(uncertain\)/)
})

test('D4 (analyses#6): the "auto" language is the language most words are in, not one letter', async () => {
  const { fillerLanguage } = await import('../renderer/src/analysis/fillers')
  assert.equal(fillerLanguage('auto', 'Er ya da gec gelir'), 'tr')
  assert.equal(fillerLanguage('auto', 'I met Erdoğan, er, last year and it was good'), 'en')
  assert.equal(fillerLanguage('auto', 'bugün çok güzel'), 'tr')
  assert.equal(fillerLanguage('auto', 'It was a good day'), 'en')
  assert.equal(fillerLanguage('auto', 'bugün hava güzel', 'english'), 'en', 'the English-only model wrote it')
  // Through the analysis: an English talk naming a Turkish person keeps its
  // "um" a sound and lists its "er".
  const { r, text } = await fillersApplied(spoken(['I met Erdoğan, er, last year.', 'It was um, good and that is it.']))
  assert.deepEqual(r.items.map((i) => [i.line.split('"')[1], !!i.uncertain]), [['um,', false], ['er,', true]], text)
})

// ---- D5 (analyses#9, safety#9) -------------------------------------------------

/** A measure that takes `ms`, or stops when its signal is aborted. */
const slow = (ms: number, log: string[], name: string) => (_p: Project, ...rest: unknown[]): Promise<{ lufs: number; peakDb: number }> =>
  new Promise((resolve, reject) => {
    const signal = rest.find((x): x is AbortSignal => typeof x === 'object' && x !== null && 'aborted' in x)
    log.push(name)
    const t = setTimeout(() => resolve({ lufs: -16, peakDb: -3 }), ms)
    signal?.addEventListener('abort', () => {
      clearTimeout(t)
      reject(new DOMException('Audio rendering cancelled', 'AbortError'))
    })
  })

test('D5 (analyses#9): analyze audio stops inside one clip\'s mix, inside the whole mix and inside the beats', async () => {
  const p = talk(30)
  const log: string[] = []
  let cancel = false
  setTimeout(() => (cancel = true), 30)
  const t0 = Date.now()
  await assert.rejects(analyze(p, { kind: 'audio' }, 'r1', 'v-1', { cancelled: () => cancel }, { measureClip: slow(2000, log, 'clip'), measureProject: slow(2000, log, 'mix') }), /cancelled/)
  assert.ok(Date.now() - t0 < 1000, `stopped after ${Date.now() - t0} ms`)
  assert.deepEqual(log, ['clip'], 'the whole mix never started')
  // In the whole mix.
  log.length = 0
  cancel = false
  setTimeout(() => (cancel = true), 30)
  const t1 = Date.now()
  await assert.rejects(analyze(p, { kind: 'audio' }, 'r2', 'v-1', { cancelled: () => cancel }, { measureClip: slow(1, log, 'clip'), measureProject: slow(2000, log, 'mix') }), /cancelled/)
  assert.ok(Date.now() - t1 < 1000)
  // In the beats: the reader is asked to stop, and a cancelled call returns nothing.
  cancel = false
  let asked = 0
  const beats = async (_p: Project, _id: string, signal?: { cancelled(): boolean }): Promise<{ bpm: number; beats: number[] } | null> => {
    for (let i = 0; i < 100; i++) {
      asked++
      if (signal?.cancelled()) throw new Error('cancelled')
      if (i === 3) cancel = true
      await new Promise((r) => setTimeout(r, 5))
    }
    return { bpm: 120, beats: [0] }
  }
  await assert.rejects(analyze(p, { kind: 'audio', beats: true }, 'r3', 'v-1', { cancelled: () => cancel }, { measureClip: slow(1, log, 'clip'), measureProject: slow(1, log, 'mix'), beats }), /cancelled/)
  assert.equal(asked, 5)
})

test('D5 (analyses#9): the beats are of the music, not of the first clip with sound; the answer names it and says when clips are left out', async () => {
  const p = busy()
  let measured = ''
  const beats = async (_p: Project, id: string): Promise<{ bpm: number; beats: number[] } | null> => ((measured = id), { bpm: 100, beats: [0.6, 1.2] })
  const quick = { measureClip: slow(1, [], 'c'), measureProject: slow(1, [], 'm'), beats }
  const r = await analyze(p, { kind: 'audio', beats: true }, 'r1', 'v-1', NEVER, quick)
  assert.equal(measured, 'm1')
  assert.match(r.tail!.join('\n'), /^Beats of m1 \(mus\.wav, 0\.00-30\.00\): 100 bpm/m)
  // A talk cut in 25 pieces: 20 measured, and the answer says so.
  const cutUp = talk(50)
  const v1 = cutUp.tracks[0]
  cutUp.clips = {}
  v1.clipIds = []
  for (let i = 0; i < 25; i++) {
    cutUp.clips[`k${i}`] = clipOf(`k${i}`, 'a1', v1.id, i * 2, i * 2, 2)
    v1.clipIds.push(`k${i}`)
  }
  const many = await analyze(cutUp, { kind: 'audio' }, 'r2', 'v-1', NEVER, quick)
  assert.equal(many.items.length, 20)
  assert.match(many.head, /^20 clips with sound \(the first 20 of 25; start \/ end for the others\)$/)
})

test('D5 (safety#9): one session cannot hold every waiting analysis; frames are drawn two at a time; the server holds at most six calls of a session', async () => {
  const { createQueue } = await import('../renderer/src/agent/queue')
  const q = createQueue(8, (n) => `full ${n}`, 4, (n) => `yours ${n}`)
  const live = { cancelled: () => false }
  let release!: () => void
  const head = q.add(() => new Promise<void>((r) => (release = r)), live, 'a')
  const mine = Array.from({ length: 4 }, () => q.add(async () => 'a', live, 'a'))
  assert.throws(() => q.add(async () => 'a', live, 'a'), /yours 4/)
  const other = q.add(async () => 'b', live, 'b')
  release()
  await head
  assert.deepEqual(await Promise.all(mine), ['a', 'a', 'a', 'a'])
  assert.equal(await other, 'b')

  const { contactSheet, SHEETS_AT_ONCE } = await import('../renderer/src/agent/frames')
  let now = 0
  let most = 0
  const picture = async (): Promise<{ data: string; width: number; height: number }> => {
    most = Math.max(most, ++now)
    await new Promise((r) => setTimeout(r, 10))
    now--
    return { data: 'x', width: 1, height: 1 }
  }
  const sheets = await Promise.all(Array.from({ length: 6 }, (_, i) => contactSheet(talk(20), [i], { picture: picture as never })))
  assert.equal(sheets.filter(Boolean).length, 6)
  assert.equal(most, SHEETS_AT_ONCE)

  const { AgentHost, SESSION_CALLS_MAX } = await import('../main/agent-host')
  const contents = { id: 7, isDestroyed: () => false, send: () => undefined }
  const win = { isDestroyed: () => false, webContents: contents } as never
  const host = new AgentHost({ userData: () => '.', port: 1, version: '1', name: 'snipp', forced: false, target: () => ({ win, projectPath: null }), timeoutMs: 300 })
  const call = (host as unknown as { call: (t: string, a: unknown, s: string) => Promise<{ content: { text: string }[]; isError?: boolean }> }).call.bind(host)
  const a = host.open('agent-a')
  const b = host.open('agent-b')
  const held = Array.from({ length: SESSION_CALLS_MAX }, () => call('project', {}, a))
  const refused = await call('project', {}, a)
  assert.equal(refused.isError, true)
  assert.match(refused.content[0].text, /6 calls of this session are still waiting/)
  // Another session is not held up by it.
  const fine = call('project', {}, b)
  await Promise.all([...held, fine])
})

test('D7 (safety#7): the preflight answer says what is there, with no judgement of how it looks', async () => {
  const p = talk(20)
  p.assets.push({ id: 'ph', kind: 'image', name: 'photo.png', url: 'media://ph', size: 1, width: 640, height: 360 } as Asset)
  p.tracks.splice(1, 0, { id: 'v2track000001', kind: 'video', name: 'V2', clipIds: ['i1', 'i2'] } as never)
  p.clips.i1 = clipOf('i1', 'ph', 'v2track000001', 0, 0, 6)
  p.clips.i2 = clipOf('i2', 'ph', 'v2track000001', 6, 0, 9)
  const r = await analyze(p, { kind: 'preflight' }, 'r1', 'v-1', NEVER, { loudness: async () => null })
  const text = resultText(r, p)
  assert.match(text, /still 6\.00 i2 image, no motion for 9\.0 s, “photo\.png”/)
  assert.match(text, /repeat 6\.00 i2 same image twice in a row, “photo\.png”/)
  assert.doesNotMatch(text, /wrong|would look|should|stands still|better/i, text)
})

// ---- D6 (analyses#10): measured against the truth, by what the cuts take ------

interface Truth {
  segments: { type: string; start: number; end: number; retakeOf?: number }[]
  words: { text: string; start: number; end: number }[]
}
const HAM = path.resolve(process.cwd(), '..', 'testdata', 'ham')

/** What `cuts` do to a talk whose truth is known. Each retake is two takes
 *  of one sentence (the truth names the earlier one to drop; the same words
 *  either way): it is caught when the cuts take more than half of ONE take,
 *  and its words stay when the other take stays. A word that should stay —
 *  outside every retake, or of the take that stays — is wrongly cut when
 *  more than half of it is inside a cut; its seconds inside the cuts are
 *  over-cut. Dropped-take words left: the earlier take's words of a retake
 *  not caught. */
export function judgeCuts(t: Truth, cuts: readonly (readonly [number, number])[]): { retakes: number; caught: number; leftWords: number; wrongWords: number; overSeconds: number } {
  const inCut = (a: number, b: number): number => Math.min(b - a, cuts.reduce((n, [x, y]) => n + Math.max(0, Math.min(b, y) - Math.max(a, x)), 0))
  const within = (w: { start: number; end: number }, s: { start: number; end: number }): boolean => w.start >= s.start - 1e-3 && w.end <= s.end + 1e-3
  const pairs = t.segments.filter((s) => s.type === 'repeat').map((s) => ({ first: t.segments[s.retakeOf!], second: s }))
  const gone = (s: { start: number; end: number }): boolean => inCut(s.start, s.end) > 0.5 * (s.end - s.start)
  let leftWords = 0
  let wrongWords = 0
  let over = 0
  for (const w of t.words) {
    const f = inCut(w.start, w.end)
    const pair = pairs.find((q) => within(w, q.first) || within(w, q.second))
    if (pair) {
      const mine = within(w, pair.first) ? pair.first : pair.second
      const other = mine === pair.first ? pair.second : pair.first
      // One take of the two may go; this word must stay when the other went
      // (or, neither gone, when it is the later take).
      if (!gone(pair.first) && !gone(pair.second)) {
        if (mine === pair.first) leftWords++
        continue
      }
      if (!gone(other)) continue
    }
    over += f
    if (f > 0.5 * (w.end - w.start)) wrongWords++
  }
  const caught = pairs.filter((q) => gone(q.first) || gone(q.second)).length
  return { retakes: pairs.length, caught, leftWords, wrongWords, overSeconds: Math.round(over * 100) / 100 }
}

/** The talk as the agent's analysis gets it: one clip, its subtitle lines
 *  (the truth's sentences with the true word times, or Whisper's lines), and
 *  its loudness made from the true words (the sound itself is not read in
 *  Node: speech where a word is said, quiet elsewhere). */
async function repeatsOn(t: Truth, captions: Caption[]): Promise<AnalysisResult> {
  const end = Math.max(...t.words.map((w) => w.end)) + 1
  const p = talk(Math.ceil(end))
  p.assets[0].duration = Math.ceil(end) + 1
  p.captions = captions.map((c) => ({ ...c, soundClip: 'c1' }))
  const dbs = new Array<number>(Math.ceil(end / W)).fill(-60)
  for (const w of t.words) for (let i = Math.floor(w.start / W); i < Math.ceil(w.end / W); i++) dbs[i] = -18
  return analyze(p, { kind: 'repeats' }, 'r1', 'v-1', NEVER, { loudness: async (_p, clip) => (clip.id === 'c1' ? dbs : null) })
}

/** The truth's sentences as subtitle lines, with their true word times. */
function truthLines(t: Truth): Caption[] {
  const out: Caption[] = []
  for (const [i, s] of t.segments.entries()) {
    if (s.type !== 'speech' && s.type !== 'repeat') continue
    const words = t.words.filter((w) => w.start >= s.start - 1e-3 && w.end <= s.end + 1e-3)
    if (words.length) out.push({ id: `t${String(i).padStart(4, '0')}`, start: words[0].start, end: words[words.length - 1].end, text: words.map((w) => w.text).join(' '), words })
  }
  return out
}

export const ACCURACY: Record<string, unknown>[] = []

for (const name of ['ham-02dk-en', 'ham-10dk-tr', 'ham-30dk-en']) {
  const file = path.join(HAM, `${name}.truth.json`)
  test(`D6 (analyses#10): retakes against the truth by what the cuts take — ${name}: a plain apply cuts no word that stays`, { skip: !existsSync(file) && 'no test material' }, async () => {
    const t = JSON.parse(readFileSync(file, 'utf8')) as Truth
    const whisperFile = path.join(HAM, `${name}.whisper.json`)
    const sources: [string, Caption[]][] = [['true words', truthLines(t)]]
    if (existsSync(whisperFile)) sources.push(['Whisper words', (JSON.parse(readFileSync(whisperFile, 'utf8')) as { captions: Caption[] }).captions])
    for (const [words, caps] of sources) {
      const r = await repeatsOn(t, caps)
      const plain = chosenItems(r).map((i) => i.cut!)
      const listed = r.items.filter((i) => !i.heading).map((i) => i.cut!)
      const all = r.items.map((i) => i.cut!)
      for (const [mode, cuts] of [['plain apply', plain], ['with the uncertain', listed], ['with unwritten speech', all]] as const) {
        const j = judgeCuts(t, cuts)
        ACCURACY.push({ name, words, mode, items: cuts.length, ...j })
        console.log(`  ${name} (${words}), ${mode}: ${cuts.length} cuts, retakes caught ${j.caught}/${j.retakes}, dropped-take words left ${j.leftWords}, words cut that stay ${j.wrongWords}, over-cut ${j.overSeconds} s`)
        // What a plain apply does on its own: never a word that stays.
        if (mode === 'plain apply') {
          assert.equal(j.wrongWords, 0, `${name} ${words}: a plain apply cut words that stay`)
          assert.ok(j.overSeconds <= 0.2, `${name} ${words}: ${j.overSeconds} s of kept speech cut`)
        }
      }
    }
  })
}
