// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// D22, worker C: what a draft does, said right (the audit's A4, the list
// audit's L12).
//   - A4 (a): a draft with a cut still says its changed line and its marker;
//   - A4 (b): a clip's move rewrites the lines' inner anchor (soundClip):
//     that is no "subtitle line changes";
//   - A4 (c): a split is "split", a speed says the speed, a setting names
//     what was set, a deleted line says so;
//   - a clip that only closes up after a removal did not "move";
//   - counts: "1 change" / "3 changes", never "change(s)", in both languages
//     and in every text of the agent's interface;
//   - the agent's colour by program: each set reads on its surfaces
//     (4.5:1), and tokens.css says what TASARIM.md's table says.
import './dom-stub'
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import test from 'node:test'
import { useStore } from '../renderer/src/state/store'
import { defaultProject, type Project } from '../renderer/src/types'
import { changeCount, draftChanges } from '../renderer/src/agent/draft-words'
import { form } from '../renderer/src/agent/count'
import { AGENT_PROGRAMS } from '../renderer/src/agent/program'
import { changeText, saidOf, wordsText } from '../renderer/src/agent/said'
import { headline } from '../renderer/src/components/agent/draft-text'
import { STRINGS } from '../renderer/src/ui/strings'
import { STRINGS_D22_C } from '../renderer/src/ui/strings-d22-c'
import { clipOf, videoAsset } from './agent-kit'

const S = useStore.getState
test.after(() => S().setUiLang('en'))

/** V1: a 0–4, b 4–8 of talk (their sound linked on A1); V2: d 2–6. Two subtitle lines over a and b; one marker. */
function scene(): Project {
  const p = defaultProject()
  p.assets = [videoAsset('talk', 100), videoAsset('other', 100)]
  p.tracks = [
    { id: 'V2', kind: 'video', name: 'V2', clipIds: ['d'] },
    { id: 'V1', kind: 'video', name: 'V1', clipIds: ['a', 'b'] },
    { id: 'A1', kind: 'audio', name: 'A1', clipIds: ['as', 'bs'] }
  ]
  p.clips = {
    a: clipOf('a', 'talk', 'V1', 0, 0, 4, { linkId: 'L1', audioExtracted: true }),
    as: clipOf('as', 'talk', 'A1', 0, 0, 4, { linkId: 'L1' }),
    b: clipOf('b', 'talk', 'V1', 4, 4, 4, { linkId: 'L2', audioExtracted: true }),
    bs: clipOf('bs', 'talk', 'A1', 4, 4, 4, { linkId: 'L2' }),
    d: clipOf('d', 'other', 'V2', 2, 0, 4)
  }
  p.captions = [
    { id: 'S1', start: 1, end: 3, text: 'hello there', soundClip: 'as' },
    { id: 'S2', start: 5, end: 7, text: 'we go on', soundClip: 'bs' }
  ] as never
  p.markers = [{ id: 'm1', time: 6, color: '#ffd83d', note: '', label: 'here' }]
  return p
}
const said = (live: Project, draft: Project, cuts: [number, number][] = []): string[] => draftChanges(live, draft, cuts).map(changeText).filter(Boolean)

test('A4 (a): with a cut in the draft, a changed subtitle and a new marker are still said', () => {
  S().setUiLang('en')
  const live = scene()
  delete live.clips.d
  live.tracks[0].clipIds = []
  const draft = structuredClone(live)
  // The cut 3–4 closes; S2 is retyped; a marker is added.
  draft.clips.a.duration = 3
  draft.clips.as.duration = 3
  for (const id of ['b', 'bs']) draft.clips[id].start = 3
  draft.captions[1] = { ...draft.captions[1], start: 4, end: 6, text: 'we carry on' }
  draft.markers = [{ ...live.markers![0], time: 5 }, { id: 'm2', time: 1, color: '#ffd83d', note: 'new', label: '' }]
  const out = said(live, draft, [[3, 4]])
  assert.deepEqual(out, ['A marker “new” is added at 0:01', '0:03.0–0:04.0 is cut out of talk.mp4 (1 s); what follows moves up', 'Subtitle “we go on” becomes “we carry on”'])
})

test('A4 (b): moving a clip rewrites the lines\' inner anchor: no "subtitle line changes" beside the move', () => {
  const live = scene()
  const draft = structuredClone(live)
  draft.clips.d.start = 12
  // (What the editor does to the lines when footage moves: an inner field.)
  draft.captions = draft.captions.map((c) => ({ ...c, soundClip: 'bs' }))
  assert.deepEqual(said(live, draft), ['other.mp4 moves 10 s later (0:02 → 0:12)'])
})

test('A4 (c): a split, a speed, a named setting, a deleted line: each says what it is', () => {
  const live = scene()
  // Split d at 0:04.
  const split = structuredClone(live)
  split.clips.d.duration = 2
  split.clips.d2 = clipOf('d2', 'other', 'V2', 4, 2, 2)
  split.tracks[0].clipIds.push('d2')
  assert.deepEqual(said(live, split), ['other.mp4 is split in two at 0:04'], 'not "becomes 2 s long (was 4 s)"')
  // 2× speed.
  const fast = structuredClone(live)
  fast.clips.d = { ...fast.clips.d, speed: 2, duration: 2 }
  assert.deepEqual(said(live, fast), ['other.mp4 plays at 2× (4 s becomes 2 s)'])
  // Opacity and size together: the first said whole, the rest counted.
  const two = structuredClone(live)
  two.clips.d = { ...two.clips.d, opacity: 0.5, transform: { ...two.clips.d.transform, scale: 1.2 } }
  assert.deepEqual(said(live, two), ['other.mp4: opacity 100 % → 50 %; and one more of its settings'])
  const ch = draftChanges(live, two, [])
  assert.equal(wordsText(ch[0].badge!), 'opacity 50 % +1')
  // A deleted line.
  const gone = structuredClone(live)
  gone.captions = gone.captions.slice(0, 1)
  assert.deepEqual(said(live, gone), ['Subtitle “we go on” is removed (0:05)'], 'not "1 subtitle or title line(s) change"')
  // A transition.
  const tr = structuredClone(live)
  tr.clips.a = { ...tr.clips.a, transitionOut: { type: 'mix', duration: 0.5, to: 'b' } } as never
  assert.deepEqual(said(live, tr), ['A transition is added from talk.mp4 into talk.mp4 (0.5 s)'])
})

test('a removal with what follows closing up: the clips after it are carried, not "moved"', () => {
  const live = scene()
  const draft = structuredClone(live)
  delete draft.clips.a
  delete draft.clips.as
  draft.tracks[1].clipIds = ['b']
  draft.tracks[2].clipIds = ['bs']
  draft.clips.b.start = 0
  draft.clips.bs.start = 0
  const ch = draftChanges(live, draft, [])
  assert.deepEqual(ch.map(changeText).filter(Boolean), ['talk.mp4 is removed (0:00–0:04), with its sound; what follows closes up'])
  assert.equal(changeCount(ch), 1)
  assert.equal(saidOf(ch), 'talk.mp4 is removed (0:00–0:04), with its sound; what follows closes up')
})

test('many lines at once are said as a count; each is still a row the timeline marks', () => {
  const live = scene()
  live.captions = Array.from({ length: 9 }, (_, i) => ({ id: `L${i}`, start: i, end: i + 0.8, text: `line ${i}` })) as never
  const draft = structuredClone(live)
  draft.captions = draft.captions.map((c) => ({ ...c, text: c.text.toUpperCase() }))
  const ch = draftChanges(live, draft, [])
  assert.deepEqual(ch.map(changeText).filter(Boolean), ['9 subtitle or title lines change'])
  assert.equal(ch.filter((c) => c.kind === 'line' && c.captionId).length, 9)
})

test('L12: counts are said right in both languages; no "(s)" in the agent\'s interface', () => {
  assert.equal(form(1), 'one')
  assert.equal(form(0), 'other')
  const view = (n: number) => ({ id: 1, session: 's', client: 'claude-code', calls: [], items: Array.from({ length: n }, (_, i) => ({ seq: 1, index: i, key: `1:${i}`, command: 'marker.add', changes: [], kinds: [] })), summary: { calls: 0, cuts: 0, seconds: 0, addedClips: 0, dropped: 0 }, dropped: [], version: 'v', lengths: { live: 10, draft: 10 } }) as never
  S().setUiLang('en')
  assert.equal(headline(view(1)), '1 change · the length stays 0:10')
  assert.equal(headline(view(3)), '3 changes · the length stays 0:10')
  S().setUiLang('tr')
  assert.equal(headline(view(1)), '1 değişiklik · süre 0:10 kalır')
  assert.equal(headline(view(3)), '3 değişiklik · süre 0:10 kalır')
  S().setUiLang('en')
  for (const [k, v] of Object.entries(STRINGS_D22_C)) {
    assert.ok(v.en && v.tr, k)
    assert.equal(/\(s\)/.test(v.en + v.tr), false, `${k}: "(s)"`)
    assert.deepEqual([...v.en.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort(), [...v.tr.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort(), `${k}: the same parameters in both languages`)
  }
  // A counted text has both its keys.
  const keys = Object.keys(STRINGS_D22_C)
  for (const k of keys.filter((x) => x.endsWith('.one'))) assert.ok(keys.includes(k.replace(/\.one$/, '.other')), `${k} has its ".other"`)
  // The texts of the agent's interface that are still read (ui/strings.ts,
  // strings-den2-t.ts, strings-gonder.ts): none writes "(s)" after a count any more.
  const agentKeys = Object.entries(STRINGS as Record<string, { en: string }>).filter(([k]) => /^(agent|den2t|d22a|d22c)\./.test(k))
  assert.deepEqual(agentKeys.filter(([, e]) => /\(s\)/.test(e.en)).map(([k]) => k), [])
})

// ---- the agent's colour by program ---------------------------------------------------
const SRC = join(__dirname, '..', '..', 'src', 'renderer', 'src')
const tokens = readFileSync(join(SRC, 'ui', 'tokens.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
const NAMES = ['--agent', '--agent-text', '--agent-soft', '--agent-line', '--on-agent'] as const

function rootValue(name: string): string {
  const root = tokens.slice(0, tokens.indexOf('@media'))
  let v = new RegExp(`${name}\\s*:\\s*([^;]+);`).exec(root)?.[1].trim() ?? ''
  for (let i = 0; i < 10 && /^var\(/.test(v); i++) v = new RegExp(`${v.slice(4, -1)}\\s*:\\s*([^;]+);`).exec(root)?.[1].trim() ?? ''
  return v
}
function setOf(program: string): Record<string, string> {
  if (program === 'claude') return Object.fromEntries(NAMES.map((n) => [n, rootValue(n)]))
  const block = new RegExp(`:root\\[data-agent-program='${program}'\\]\\s*\\{([^}]*)\\}`).exec(tokens)
  assert.ok(block, `tokens.css has the ${program} set`)
  return Object.fromEntries([...block![1].matchAll(/(--[a-z-]+)\s*:\s*(#[0-9A-Fa-f]{6});/g)].map((m) => [m[1], m[2]]))
}
function contrast(a: string, b: string): number {
  const lum = (h: string): number => {
    const [r, g, bl] = [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4))
    return 0.2126 * r + 0.7152 * g + 0.0722 * bl
  }
  const [x, y] = [lum(a), lum(b)]
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05)
}

test('the agent\'s colour by program: five names each, readable on the surfaces they are used on', () => {
  const surfaces = ['--bg-well', '--bg-app', '--bg-panel', '--bg-raised', '--bg-hover', '--bg-lane'].map(rootValue)
  const text = rootValue('--text')
  for (const program of AGENT_PROGRAMS) {
    const s = setOf(program)
    assert.deepEqual(Object.keys(s).sort(), [...NAMES].sort(), `${program}: the five names`)
    const low: string[] = []
    const need = (a: string, b: string, what: string, min = 4.5): void => {
      const r = contrast(a, b)
      if (r < min) low.push(`${what}: ${r.toFixed(2)}`)
    }
    for (const bg of surfaces) need(s['--agent-text'], bg, `--agent-text on ${bg}`)
    need(s['--agent-text'], s['--agent-soft'], 'the name on the bar')
    need(text, s['--agent-soft'], 'the sentence on the bar')
    need(s['--on-agent'], s['--agent'], 'a badge')
    // The frame and the dot are seen on a lane and on a video clip (3:1, a graphic).
    need(s['--agent'], rootValue('--bg-lane'), 'the frame on a lane', 3)
    need(s['--agent'], rootValue('--clip-video-fill'), 'the frame on a video clip', 3)
    assert.deepEqual(low, [], program)
  }
  // The five agent colours are not the accent, the selection or a clip's fill.
  const others = ['--accent', '--select', '--danger', '--clip-video-fill', '--clip-audio-fill', '--clip-image-fill', '--clip-code-fill'].map(rootValue)
  for (const program of AGENT_PROGRAMS) assert.ok(!others.includes(setOf(program)['--agent'].toUpperCase()) && !others.includes(setOf(program)['--agent']), `${program}: its own colour`)
})

const TASARIM = join(__dirname, '..', '..', '..', 'tasarim', 'TASARIM.md')
test('TASARIM.md "Ajan program renkleri" = tokens.css', { skip: !existsSync(TASARIM) && 'TASARIM.md is not beside the repository' }, () => {
  const md = readFileSync(TASARIM, 'utf8')
  const part = md.slice(md.indexOf('### Ajan program renkleri'))
  const rows = [...part.matchAll(/^\|[^|]+\|\s*`([a-z]+)`[^|]*\|\s*`(#\w{6})`\s*\|\s*`(#\w{6})`\s*\|\s*`(#\w{6})`\s*\|\s*`(#\w{6})`\s*\|\s*`(#\w{6})`\s*\|/gm)]
  assert.deepEqual(rows.map((r) => r[1]), [...AGENT_PROGRAMS])
  for (const [, program, ...hex] of rows) {
    const s = setOf(program)
    assert.deepEqual(NAMES.map((n) => s[n].toUpperCase()), hex.map((h) => h.toUpperCase()), program)
  }
})
