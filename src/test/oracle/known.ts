// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// The high findings of the second review (haritalar/_faz4a-dogrulama.md),
// written out as sequences the oracle judges (SnippStudio phase 4A.9, A8):
// on the core of 57b03ed each must give a violation (the oracle sees it); on
// the rebuilt core each must give none.
import { useStore } from '../../renderer/src/state/store'
import type { Project } from '../../renderer/src/types'
import { asset, base, clip, tag, track, type Shape } from './fixture'
import { Run, type Found, type Step } from './run'

const live = (): Project => useStore.getState().project

/** A 20 s talk: one clip, two subtitle lines with words. */
function small(): Shape {
  const p = base('small', [track('V1', 'video'), track('A1', 'audio')])
  p.assets = [asset('talk', 'video', 60)]
  clip(p, 'c1', 'talk', 'V1', 0, 0, 20)
  const w = (text: string, start: number, end: number, id: string) => tag({ text, start, end }, '__w', id)
  p.captions = [
    { id: 'L1', start: 1, end: 3, text: 'hello there friends', words: [w('hello', 1, 1.5, 'h'), w('there', 1.6, 2.2, 't'), w('friends', 2.3, 3, 'f')], soundClip: 'c1' },
    { id: 'L2', start: 6, end: 8, text: 'we go on', words: [w('we', 6, 6.4, 'we'), w('go', 6.5, 7, 'go'), w('on', 7.1, 8, 'on')], soundClip: 'c1' }
  ]
  return { name: 'small', project: p, voiceTrack: 'V1', pool: [] }
}

/** The same file twice on one track, both from its first second (a sting, a
 *  loop): two instances of one asset, told apart by a tag. */
function twice(): Shape {
  const p = base('twice', [track('V1', 'video'), track('A1', 'audio')])
  p.assets = [asset('a1', 'video', 60)]
  tag(clip(p, 'c1', 'a1', 'V1', 0, 0, 10), '__inst', 'first')
  tag(clip(p, 'c2', 'a1', 'V1', 10, 0, 10), '__inst', 'second')
  return { name: 'twice', project: p, voiceTrack: 'V1', pool: [] }
}

/** A 30 s talk on V1 with B-roll footage over it (V2, 8–14 s, its source
 *  0–6) and media in the pool. */
function withBroll(): Shape {
  const p = base('with broll', [track('V2', 'video'), track('V1', 'video'), track('A1', 'audio')])
  p.assets = [asset('talk', 'video', 60), asset('broll', 'video', 30), asset('poolA', 'video', 40)]
  clip(p, 'c1', 'talk', 'V1', 0, 0, 30)
  clip(p, 'b1', 'broll', 'V2', 8, 0, 6)
  return { name: 'with broll', project: p, voiceTrack: 'V1', pool: ['poolA'] }
}

/** A talking video with its own sound and a LONGER music bed under it; no
 *  subtitles (the common state before transcription). */
function noSubtitles(): Shape {
  const p = base('no subtitles', [track('V1', 'video'), track('A1', 'audio')])
  p.assets = [asset('talk', 'video', 80), asset('music', 'audio', 120)]
  clip(p, 'c1', 'talk', 'V1', 0, 0, 50)
  clip(p, 'm1', 'music', 'A1', 0, 0, 60, { volume: 0.3 })
  return { name: 'no subtitles', project: p, voiceTrack: 'V1', pool: [] }
}

/** A talk with a still picture over its first ten seconds. */
function withImage(): Shape {
  const p = base('with image', [track('V2', 'video'), track('V1', 'video'), track('A1', 'audio')])
  p.assets = [asset('talk', 'video', 60), asset('pic', 'image', 0)]
  clip(p, 'c1', 'talk', 'V1', 0, 0, 30)
  clip(p, 'i1', 'pic', 'V2', 0, 0, 10)
  return { name: 'with image', project: p, voiceTrack: 'V1', pool: [] }
}

export interface Known {
  /** The findings it stands for. */
  ids: string
  what: string
  /** Does the core of 57b03ed get it wrong? (One is a fault of the first
   *  redesign draft, which the old core avoided by dropping the op.) */
  old: boolean
  /** The core of this tree still gets it wrong and the oracle must SEE it
   *  (a violation of this kind): red until its fix lands (plan 8.0), then
   *  this line goes. */
  red?: string
  run: () => Promise<Found[]>
}

async function play(shape: Shape, mode: 'draft' | 'direct', script: (run: Run, go: (st: Step) => Promise<boolean>) => Promise<void>): Promise<Found[]> {
  const run = new Run(shape, mode, 7)
  try {
    await script(run, (st) => run.exec(st))
    return run.violations
  } finally {
    run.dispose()
  }
}

const user = (cls: string, name: string, params: Record<string, unknown>): Step => ({ k: 'user', cls, act: { t: 'batch', name, params } })
const pieceOf = (p: Project, inst: string, inPoint: number): string =>
  Object.values(p.clips).find((c) => (c as unknown as { __inst?: string }).__inst === inst && Math.abs(c.inPoint - inPoint) < 0.01)!.id

export const KNOWN: Known[] = [
  {
    ids: 'D2, V-rebuild-1',
    what: 'the user takes back a cut: the agent\'s mark is applied to a line whose word came back',
    old: true,
    run: () =>
      play(small(), 'draft', async (_run, go) => {
        await go({ k: 'user', cls: 'cut', act: { t: 'cut', range: [6.45, 7.05] } })
        await go({ k: 'read' })
        await go({ k: 'edit', from: 0, ops: [{ op: 'caption.update', id: 'L2', patch: { marks: [1] } }] })
        await go({ k: 'user', cls: 'undo', act: { t: 'undo' } })
      })
  },
  {
    ids: 'D4, V-accept-ids-3',
    what: 'two pieces that look the same: after the user\'s cut the opacity lands on the other one',
    old: true,
    run: () =>
      play(twice(), 'draft', async (run, go) => {
        await go({ k: 'read' })
        await go({ k: 'edit', from: 0, ops: [{ op: 'timeline.cutRanges', ranges: [[3, 4], [13, 14]] }] })
        await go({ k: 'read' })
        await go({ k: 'edit', from: 0, ops: [{ op: 'clip.setOpacity', clipId: pieceOf(run.seen!.project, 'second', 4), opacity: 0 }] })
        await go({ k: 'user', cls: 'cut', act: { t: 'cut', range: [12.5, 14.5] } })
      })
  },
  {
    ids: 'D7, V-rebuild-5',
    what: 'a silence cut counted as "moves nothing": the title after it is put in the wrong frame',
    old: true,
    run: () =>
      play(small(), 'draft', async (_run, go) => {
        await go({ k: 'read' })
        await go({ k: 'edit', from: 0, ops: [{ op: 'silence.apply', regions: [{ clipId: 'c1', start: 9, end: 14 }] }] })
        await go({ k: 'read' })
        await go({ k: 'edit', from: 0, ops: [{ op: 'text.add', time: 12, text: 'T' }] })
        await go({ k: 'user', cls: 'cut', act: { t: 'cut', range: [0.2, 0.7] } })
      })
  },
  {
    ids: 'V-edit-frames-2',
    what: 'a word address into a line whose words changed since base names another word',
    old: true,
    run: () =>
      play(small(), 'direct', async (_run, go) => {
        await go({ k: 'read' })
        await go({ k: 'user', cls: 'cut', act: { t: 'cut', range: [5.95, 6.45] } })
        await go({ k: 'edit', from: 0, ops: [{ op: 'text.add', time: 'L2#1>', text: 'Go!' }] })
      })
  },
  {
    ids: 'V-edit-frames-5',
    what: 'a range of a word address and a second: the second stays in the old frame',
    old: true,
    run: () =>
      play(small(), 'direct', async (_run, go) => {
        await go({ k: 'read' })
        await go({ k: 'user', cls: 'cut', act: { t: 'cut', range: [0.1, 0.9] } })
        await go({ k: 'edit', from: 0, ops: [{ op: 'timeline.cutRanges', ranges: [['L2#0', 7.5]] }] })
      })
  },
  {
    ids: 'V-accept-ids-4',
    what: 'only the second call accepted: a setting meant for a piece lands on the whole clip',
    old: true,
    run: () =>
      play(small(), 'draft', async (_run, go) => {
        await go({ k: 'read' })
        await go({ k: 'edit', from: 0, ops: [{ op: 'timeline.cutRanges', ranges: [[10, 11]] }] })
        await go({ k: 'read' })
        await go({ k: 'edit', from: 0, ops: [{ op: 'clip.setVolume', clipId: 'c1', volume: 0 }] })
        await go({ k: 'accept', seqs: [2] })
      })
  },
  {
    ids: 'V-rebuild-4',
    what: 'the user\'s cut splits the clip: the agent\'s split is kept in the draft and does nothing',
    old: true,
    run: () =>
      play(small(), 'draft', async (_run, go) => {
        await go({ k: 'read' })
        await go({ k: 'edit', from: 0, ops: [{ op: 'clip.split', clipIds: ['c1'], time: 12 }] })
        await go({ k: 'user', cls: 'cut', act: { t: 'cut', range: [5, 6] } })
      })
  },
  {
    ids: 'S2 / B9 (a user split under a named clip)',
    what: 'the user splits the clip the agent muted: only the left half is muted',
    old: false,
    run: () =>
      play(small(), 'draft', async (_run, go) => {
        await go({ k: 'read' })
        await go({ k: 'edit', from: 0, ops: [{ op: 'clip.setVolume', clipId: 'c1', volume: 0 }] })
        await go(user('split', 'clip.split', { clipIds: ['c1'], time: 7 }))
      })
  },
  // ---- the high findings of the 4A.9 verification (haritalar/_faz4a9-dogrulama.md) ----
  {
    ids: 'core#1 (P1), oracle#1',
    what: 'the user slides B-roll that lay under a waiting cut: the cut takes footage of it the agent never saw there',
    old: false,
    run: () =>
      play(withBroll(), 'draft', async (_run, go) => {
        await go({ k: 'read' })
        await go({ k: 'edit', from: 0, ops: [{ op: 'timeline.cutRanges', ranges: [[10, 12]] }] })
        await go(user('move', 'clip.move', { clipId: 'b1', start: 11 }))
      })
  },
  {
    ids: 'core#1 (P1d)',
    what: 'the user moves a title that only touched a waiting cut wholly into it: the cut deletes the title',
    old: false,
    run: () =>
      play(small(), 'draft', async (_run, go) => {
        await go(user('mark', 'text.add', { time: 11.5, text: 'Chapter', id: 'T1' }))
        await go({ k: 'read' })
        await go({ k: 'edit', from: 0, ops: [{ op: 'timeline.cutRanges', ranges: [[10, 12]] }] })
        await go(user('mark', 'caption.update', { id: 'T1', patch: { start: 10.2, end: 11 } }))
      })
  },
  {
    ids: 'core#2 (P29)',
    what: 'no subtitles and a music bed longer than the talk: the cut follows the music, not the speech',
    old: false,
    run: () =>
      play(noSubtitles(), 'draft', async (_run, go) => {
        await go({ k: 'read' })
        await go({ k: 'edit', from: 0, ops: [{ op: 'timeline.cutRanges', ranges: [[10, 12]] }] })
        await go(user('move', 'clip.move', { clipId: 'm1', start: 5 }))
      })
  },
  {
    ids: 'core#3 (P4), drafts#2',
    what: 'another program\u2019s marker lands in the range of a cut written before it: the cut deletes a marker it never saw',
    old: false,
    run: () =>
      play(small(), 'direct', async (_run, go) => {
        await go({ k: 'read', who: 2 })
        await go({ k: 'read', who: 0 })
        await go({ k: 'edit', from: 0, who: 0, ops: [{ op: 'marker.add', time: 11, note: 'by A' }] })
        await go({ k: 'edit', from: 0, who: 2, ops: [{ op: 'timeline.cutRanges', ranges: [[10, 13]] }] })
      })
  },
  {
    ids: 'drafts#2 (draft), core#3 (P31)',
    what: 'the user accepts one agent\u2019s title; another agent\u2019s cut written before it shortens that title',
    old: false,
    run: () =>
      play(small(), 'draft', async (_run, go) => {
        await go({ k: 'read', who: 2 })
        await go({ k: 'read', who: 0 })
        await go({ k: 'edit', from: 0, who: 0, ops: [{ op: 'text.add', time: 15, text: 'Chapter' }] })
        await go({ k: 'accept' })
        await go({ k: 'edit', from: 0, who: 2, ops: [{ op: 'timeline.cutRanges', ranges: [[14, 16]] }] })
      })
  },
  {
    ids: 'drafts#3',
    what: 'a second session of the same program overwrites the first session\u2019s value with an old read',
    old: false,
    run: () =>
      play(small(), 'direct', async (_run, go) => {
        await go({ k: 'read', who: 1 })
        await go({ k: 'read', who: 0 })
        await go({ k: 'edit', from: 0, who: 0, ops: [{ op: 'clip.setVolume', clipId: 'c1', volume: 0.2 }] })
        await go({ k: 'edit', from: 0, who: 1, ops: [{ op: 'clip.setVolume', clipId: 'c1', volume: 0.9 }] })
      })
  },
  {
    ids: 'core#4 (P2)',
    what: 'the user cuts a still in two after the agent set its opacity: only one half gets it',
    old: false,
    run: () =>
      play(withImage(), 'draft', async (_run, go) => {
        await go({ k: 'read' })
        await go({ k: 'edit', from: 0, ops: [{ op: 'clip.setOpacity', clipId: 'i1', opacity: 0.3 }] })
        await go(user('split', 'clip.split', { clipIds: ['i1'], time: 5 }))
      })
  },
  {
    ids: 'core#4 (P2b)',
    what: 'the user cuts a still in two after the agent deleted it: half of it stays and the delete is reported applied',
    old: false,
    run: () =>
      play(withImage(), 'draft', async (_run, go) => {
        await go({ k: 'read' })
        await go({ k: 'edit', from: 0, ops: [{ op: 'clip.delete', ids: ['i1'] }] })
        await go(user('split', 'clip.split', { clipIds: ['i1'], time: 5 }))
      })
  },
  {
    ids: 'core#5 (P15)',
    what: 'the user splits off the head of a clip and moves it to another track: the agent\u2019s head trim deletes it there',
    old: false,
    run: () =>
      play(withBroll(), 'draft', async (_run, go) => {
        await go({ k: 'read' })
        await go({ k: 'edit', from: 0, ops: [{ op: 'clip.trimHead', clipId: 'c1', edge: 10 }] })
        await go(user('split', 'clip.split', { clipIds: ['c1'], time: 4 }))
        await go(user('move', 'clip.moveToTrack', { clipId: 'c1', trackId: 'V2' }))
        await go(user('move', 'clip.move', { clipId: 'c1', start: 40 }))
      })
  },
  {
    ids: 'core#6 (P30)',
    what: 'the user marks another word of a line after the agent marked one: the agent\u2019s marks replace the user\u2019s',
    old: false,
    run: () =>
      play(small(), 'draft', async (_run, go) => {
        await go({ k: 'read' })
        await go({ k: 'edit', from: 0, ops: [{ op: 'caption.update', id: 'L1', patch: { marks: [0] } }] })
        await go(user('capMarks', 'caption.update', { id: 'L1', patch: { marks: [2] } }))
      })
  },
  {
    ids: 'core#9 (P28)',
    what: 'a transition out of a clip is applied although another clip follows it now',
    old: false,
    run: () =>
      play(withBroll(), 'draft', async (_run, go) => {
        await go(user('split', 'clip.split', { clipIds: ['c1'], time: 5 }))
        await go({ k: 'read' })
        await go({ k: 'edit', from: 0, ops: [{ op: 'clip.setTransition', clipId: 'c1', transition: { type: 'mix', duration: 0.5 } }] })
        const right = Object.values(live().clips).find((c) => c.trackId === 'V1' && c.id !== 'c1')!.id
        await go(user('delete', 'clip.delete', { ids: [right] }))
        await go(user('add', 'clip.add', { assetId: 'poolA', trackId: 'V1', start: 5 }))
      })
  },
  {
    ids: 'drafts#1',
    what: 'the agent\u2019s own cut went through a user\u2019s clip; the user drags the piece into the range of an older cut: the piece counts as "made by the agent" and goes',
    old: false,
    run: () =>
      play(withBroll(), 'direct', async (_run, go) => {
        await go({ k: 'read' })
        await go({ k: 'edit', from: 0, ops: [{ op: 'timeline.cutRanges', ranges: [[10, 11]] }] })
        await go({ k: 'read' })
        const piece = Object.values(live().clips).find((c) => c.trackId === 'V2' && c.id !== 'b1')!.id
        await go(user('move', 'clip.move', { clipId: piece, start: 20 }))
        await go({ k: 'edit', from: 0, ops: [{ op: 'timeline.cutRanges', ranges: [[19, 23]] }] })
      })
  },
  {
    ids: 'analyses#5',
    what: 'a retake result is applied after the user removed the take it was kept for: the only take left is cut',
    old: false,
    run: () =>
      play(small(), 'direct', async (_run, go) => {
        await go({ k: 'analyze', ranges: [[1, 3]], keeps: [[6, 8]] })
        await go({ k: 'user', cls: 'cut', act: { t: 'cut', range: [5.9, 8.1] } })
        await go({ k: 'edit', from: 0, ops: [{ op: 'apply', result: 'r1' }] })
      })
  },
  {
    ids: 'oracle#2 (M03)',
    what: 'a structural op of a waiting draft runs again after the user put a marker and a title on the timeline',
    old: false,
    run: () =>
      play(small(), 'draft', async (_run, go) => {
        await go({ k: 'read' })
        await go({ k: 'edit', from: 0, ops: [{ op: 'silence.apply', regions: [{ clipId: 'c1', start: 10, end: 11.6 }] }] })
        await go(user('mark', 'marker.add', { time: 10.8 }))
        await go(user('mark', 'text.add', { time: 10.5, text: 'User title' }))
        await go({ k: 'accept' })
      })
  }
]
