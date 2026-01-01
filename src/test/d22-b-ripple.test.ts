// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// 22 November, worker B, K3 (D22-PLAN-B.md): a track-only close keeps the
// linked pairs in step. Q / W on a still with no sound moved the talking clip
// after it up and left that clip's linked sound where it was (3 s late, no
// word about it); on a pair whose sound starts earlier each half lost its own
// range and the pair itself slid apart. Now: what moves up takes its linked
// partner on another track along, a pair gets one change, and where that
// cannot be done the gap stays and the user is told. The user's rule is
// unchanged: the selected clip and its linked sound; nothing selected, the
// topmost one; Alt, every track.
import './dom-stub'
import assert from 'node:assert/strict'
import test from 'node:test'
import { defaultProject, type Clip, type Project } from '../renderer/src/types'
import { useStore } from '../renderer/src/state/store'
import { checkProject } from '../renderer/src/model/check'
import { COMMANDS, runCommand } from '../renderer/src/commands'
import { closePlan, closeTracks } from '../renderer/src/commands/ops/ripple'
import { clearToasts, currentToasts } from '../renderer/src/ui/toast-core'

const T0 = { x: 960, y: 540, scale: 1, rotation: 0 }
const S = useStore.getState

type Put = (id: string, trackId: string, start: number, duration: number, extra?: Partial<Clip>) => void

function project(build: (put: Put, p: Project) => void, tracks: [string, 'video' | 'audio'][] = [['V1', 'video'], ['A1', 'audio'], ['A2', 'audio']]): Project {
  const p = defaultProject()
  p.tracks = tracks.map(([id, kind]) => ({ id, kind, name: id, clipIds: [] }))
  p.assets = [
    { id: 'vid', kind: 'video', name: 'vid.mp4', url: 'media://vid', size: 1, duration: 1000, width: 1920, height: 1080, hasAudio: true },
    { id: 'img', kind: 'image', name: 'i.png', url: 'media://img', size: 1, duration: 0, width: 1920, height: 1080, hasAudio: false },
    { id: 'snd', kind: 'audio', name: 's.wav', url: 'media://snd', size: 1, duration: 1000, width: 0, height: 0, hasAudio: true }
  ] as Project['assets']
  const put: Put = (id, trackId, start, duration, extra = {}) => {
    p.clips[id] = { id, assetId: 'vid', trackId, start, inPoint: 10, duration, transform: { ...T0 }, volume: 1, ...extra }
    p.tracks.find((t) => t.id === trackId)!.clipIds.push(id)
  }
  build(put, p)
  for (const t of p.tracks) t.clipIds.sort((x, y) => p.clips[x].start - p.clips[y].start)
  return p
}

const load = (p: Project, time: number, sel: string[], link = true): void => {
  S().loadProject(p)
  useStore.setState({ currentTime: time, selectedClipIds: sel, linkAV: link })
}
const at = (id: string): [number, number] => {
  const c = S().project.clips[id]
  return [+c.start.toFixed(6), +(c.start + c.duration).toFixed(6)]
}
/** How far a clip's picture is ahead of its partner's sound (0: in step). */
const offset = (p: Project, v: string, a: string): number => +((p.clips[v].start - p.clips[v].inPoint) - (p.clips[a].start - p.clips[a].inPoint)).toFixed(6)
const sound = (p: Project): void => assert.deepEqual(checkProject(p), [], 'the model has no problem')
const toastTexts = (): string[] => currentToasts().map((x) => x.text)

/** A still with no sound, then a talking clip with its linked sound. */
const stillThenTalk = (more: (put: Put, p: Project) => void = () => {}): Project =>
  project((put, p) => {
    put('pic', 'V1', 0, 6, { assetId: 'img', inPoint: 0 })
    put('talk', 'V1', 6, 10, { linkId: 'L1' })
    put('talkA', 'A1', 6, 10, { linkId: 'L1' })
    more(put, p)
  })

test('W on a still with no sound: the talking clip after it moves up WITH its linked sound', () => {
  load(stillThenTalk(), 3, ['pic'])
  S().rippleTrimToPlayhead('right')
  const p = S().project
  assert.deepEqual(at('pic'), [0, 3])
  assert.deepEqual(at('talk'), [3, 13])
  assert.deepEqual(at('talkA'), [3, 13])
  assert.equal(offset(p, 'talk', 'talkA'), 0)
  sound(p)
  // One undo step gives everything back.
  S().undo()
  assert.deepEqual([at('pic'), at('talk'), at('talkA')], [[0, 6], [6, 16], [6, 16]])
})

test('the track that follows moves up whole from the cut on: a sound laid against the talk stays against it', () => {
  load(stillThenTalk((put) => {
    put('fx', 'A1', 17, 1, { assetId: 'snd', inPoint: 0 })
    put('music', 'A2', 0, 30, { assetId: 'snd', inPoint: 0 })
  }), 3, ['pic'])
  S().rippleTrimToPlayhead('right')
  assert.deepEqual(at('talkA'), [3, 13])
  assert.deepEqual(at('fx'), [14, 15])
  // A track with no partner of anything that moved is left alone.
  assert.deepEqual(at('music'), [0, 30])
})

test('the follow goes on from track to track', () => {
  // talk (V1) – talkA (A1); fx2 (A1, after) – fx2B (A2): A2 follows A1.
  load(stillThenTalk((put) => {
    put('fx2', 'A1', 20, 2, { assetId: 'snd', inPoint: 0, linkId: 'L9' })
    put('fx2B', 'A2', 20, 2, { assetId: 'snd', inPoint: 0, linkId: 'L9' })
  }), 3, ['pic'])
  const plan = closePlan(S().project, [3, 6], ['V1'], { linked: true })
  assert.deepEqual(plan.followers.sort(), ['A1', 'A2'])
  S().rippleTrimToPlayhead('right')
  assert.deepEqual([at('talkA'), at('fx2'), at('fx2B')], [[3, 13], [17, 19], [17, 19]])
})

test('material under the still on the sound track: nothing closes, the gap stays, the user is told', () => {
  load(stillThenTalk((put) => put('narration', 'A1', 0, 6, { assetId: 'snd', inPoint: 0 })), 3, ['pic'])
  clearToasts()
  S().rippleTrimToPlayhead('right')
  const p = S().project
  // The still is trimmed; nobody moved, nothing of the narration was cut.
  assert.deepEqual(at('pic'), [0, 3])
  assert.deepEqual([at('talk'), at('talkA'), at('narration')], [[6, 16], [6, 16], [0, 6]])
  assert.equal(offset(p, 'talk', 'talkA'), 0)
  sound(p)
  const said = toastTexts()
  assert.equal(said.length, 1)
  assert.match(said[0], /A1/)
  // Alt + W still closes every track.
  load(stillThenTalk((put) => put('narration', 'A1', 0, 6, { assetId: 'snd', inPoint: 0 })), 3, ['pic'])
  S().rippleTrimToPlayhead('right', true)
  assert.deepEqual([at('talk'), at('talkA'), at('narration')], [[3, 13], [3, 13], [0, 3]])
})

test('Q that cannot close: the clip begins at the playhead and the playhead stays', () => {
  load(stillThenTalk((put) => put('narration', 'A1', 0, 6, { assetId: 'snd', inPoint: 0 })), 2, ['pic'])
  S().rippleTrimToPlayhead('left')
  assert.deepEqual(at('pic'), [2, 6])
  assert.deepEqual(at('talk'), [6, 16])
  assert.equal(S().currentTime, 2)
  // …and one that can: the clip slides back to where it began, the playhead with it.
  load(stillThenTalk(), 2, ['pic'])
  S().rippleTrimToPlayhead('left')
  assert.deepEqual([at('pic'), at('talk'), at('talkA')], [[0, 4], [4, 14], [4, 14]])
  assert.equal(S().currentTime, 0)
})

test('a partner on a locked track cannot follow: the gap stays', () => {
  const p0 = stillThenTalk()
  p0.tracks.find((t) => t.id === 'A1')!.locked = true
  load(p0, 3, ['pic'])
  S().rippleTrimToPlayhead('right')
  assert.deepEqual([at('pic'), at('talk'), at('talkA')], [[0, 3], [6, 16], [6, 16]])
})

test('the link switch off: only the clip\'s own track, as it was', () => {
  load(stillThenTalk(), 3, ['pic'], false)
  S().rippleTrimToPlayhead('right')
  assert.deepEqual([at('pic'), at('talk'), at('talkA')], [[0, 3], [3, 13], [6, 16]])
})

test('Q on a pair whose sound starts earlier (a J cut): one change for both, the pair and the pairs after it in step', () => {
  load(project((put) => {
    put('a', 'V1', 2, 8, { linkId: 'L1' })
    put('aA', 'A1', 0, 10, { linkId: 'L1', inPoint: 8 })
    put('b', 'V1', 10, 10, { linkId: 'L2' })
    put('bA', 'A1', 10, 10, { linkId: 'L2' })
  }), 5, ['a'])
  assert.equal(offset(S().project, 'a', 'aA'), 0)
  S().rippleTrimToPlayhead('left')
  const p = S().project
  // The picture lost 3 s of its head; the sound lost 3 s of ITS head: it
  // still starts 2 s before the picture and is not cut in two.
  assert.deepEqual(at('a'), [2, 7])
  assert.deepEqual(at('aA'), [0, 7])
  assert.equal(p.clips.a.inPoint, 13)
  assert.equal(p.clips.aA.inPoint, 11)
  assert.equal(offset(p, 'a', 'aA'), 0)
  assert.deepEqual([at('b'), at('bA')], [[7, 17], [7, 17]])
  assert.equal(offset(p, 'b', 'bA'), 0)
  assert.equal(p.clips.a.linkId, p.clips.aA.linkId)
  assert.equal(Object.keys(p.clips).length, 4)
  sound(p)
})

test('W on a pair whose sound ends later (an L cut): the sound keeps its tail, both lose the same', () => {
  load(project((put) => {
    put('a', 'V1', 0, 8, { linkId: 'L1' })
    put('aA', 'A1', 0, 10, { linkId: 'L1' })
    put('b', 'V1', 10, 10, { linkId: 'L2' })
    put('bA', 'A1', 10, 10, { linkId: 'L2' })
  }), 5, ['a'])
  S().rippleTrimToPlayhead('right')
  const p = S().project
  assert.deepEqual([at('a'), at('aA')], [[0, 5], [0, 7]])
  assert.deepEqual([at('b'), at('bA')], [[7, 17], [7, 17]])
  assert.equal(offset(p, 'a', 'aA'), 0)
  assert.equal(offset(p, 'b', 'bA'), 0)
  sound(p)
})

test('a partner the cut does not touch is not cut: its track follows', () => {
  // The picture runs 0–10, its sound only 0–4; W at 5 takes 5–10.
  load(project((put) => {
    put('a', 'V1', 0, 10, { linkId: 'L1' })
    put('aA', 'A1', 0, 4, { linkId: 'L1' })
    put('b', 'V1', 10, 10, { linkId: 'L2' })
    put('bA', 'A1', 10, 10, { linkId: 'L2' })
  }), 5, ['a'])
  S().rippleTrimToPlayhead('right')
  const p = S().project
  assert.deepEqual([at('a'), at('aA'), at('b'), at('bA')], [[0, 5], [0, 4], [5, 15], [5, 15]])
  assert.equal(offset(p, 'b', 'bA'), 0)
})

test('the pure command: clip.rippleTrim says whether it closed and who moved with it', () => {
  const p0 = stillThenTalk()
  const ok = runCommand(p0, COMMANDS['clip.rippleTrim'], { clipId: 'pic', time: 3, side: 'tail', linkAV: true })
  assert.deepEqual(ok.result, { closed: true, movedWith: ['A1'] })
  assert.equal(ok.project.clips.talkA.start, 3)
  const p1 = stillThenTalk((put) => put('narration', 'A1', 0, 6, { assetId: 'snd', inPoint: 0 }))
  const no = runCommand(p1, COMMANDS['clip.rippleTrim'], { clipId: 'pic', time: 3, side: 'tail', linkAV: true })
  assert.deepEqual(no.result, { closed: false, movedWith: [], inTheWay: 'A1' })
  // A time outside the clip: no edit.
  assert.equal(runCommand(p0, COMMANDS['clip.rippleTrim'], { clipId: 'pic', time: 9, side: 'tail', linkAV: true }).result, null)
})

test('timeline.cutRangeOnTrack (an agent\'s call, the gap closer with Alt): the same close, the link counted by default', () => {
  const p0 = stillThenTalk()
  const out = runCommand(p0, COMMANDS['timeline.cutRangeOnTrack'], { trackId: 'V1', range: [3, 6] })
  assert.deepEqual(out.result, { closed: true, movedWith: ['A1'] })
  assert.equal(offset(out.project, 'talk', 'talkA'), 0)
  assert.equal(out.project.clips.talk.start, 3)
  sound(out.project)
  // In the way: the range goes, the gap stays, and the result says so.
  const p1 = stillThenTalk((put) => put('narration', 'A1', 0, 6, { assetId: 'snd', inPoint: 0 }))
  const kept = runCommand(p1, COMMANDS['timeline.cutRangeOnTrack'], { trackId: 'V1', range: [3, 6] })
  assert.deepEqual(kept.result, { closed: false, movedWith: [], inTheWay: 'A1' })
  assert.equal(kept.project.clips.pic.duration, 3)
  assert.equal(kept.project.clips.talk.start, 6)
  // The store's Alt + "close the gap", with the user's link switch.
  const gap = project((put) => {
    put('x', 'V1', 0, 2, { assetId: 'img', inPoint: 0 })
    put('talk', 'V1', 6, 10, { linkId: 'L1' })
    put('talkA', 'A1', 6, 10, { linkId: 'L1' })
  })
  load(gap, 4, ['x'])
  S().closeGapAtPlayhead(true)
  assert.deepEqual([at('talk'), at('talkA')], [[2, 12], [2, 12]])
  load(gap, 4, ['x'], false)
  S().closeGapAtPlayhead(true)
  assert.deepEqual([at('talk'), at('talkA')], [[2, 12], [6, 16]])
})

test('a pair cut through on two tracks at once keeps one link for its right pieces', () => {
  const p0 = project((put) => {
    put('a', 'V1', 0, 10, { linkId: 'L1' })
    put('aA', 'A1', 0, 10, { linkId: 'L1' })
  })
  // (Through the op: no command cuts a pair in its middle on its own tracks only.)
  const draft = structuredClone(p0)
  closeTracks(draft, [4, 6], ['V1', 'A1'], { linked: true })
  const pieces = Object.values(draft.clips)
  assert.equal(pieces.length, 4)
  const right = pieces.filter((c) => c.start === 4)
  assert.equal(right.length, 2)
  assert.ok(right[0].linkId && right[0].linkId === right[1].linkId && right[0].linkId !== 'L1')
})

test('whatever the layout: after Q / W with the link on, no linked pair has moved apart and the model holds', () => {
  let seed = 22
  const rnd = (): number => {
    seed = (seed + 0x6d2b79f5) | 0
    let t = seed
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  const pick = (n: number): number => Math.floor(rnd() * n)
  let closedRuns = 0
  let leftRuns = 0
  for (let round = 0; round < 300; round++) {
    // V1: stills and talking clips in a row (some gaps); each talk's sound on
    // A1 or A2, sometimes starting earlier / ending later / shorter; loose
    // sounds dropped where there is room.
    const free: Record<string, number> = { A1: 0, A2: 0 }
    const p0 = project((put) => {
      let t = 0
      for (let i = 0; i < 6; i++) {
        t += rnd() < 0.25 ? 1 + pick(3) : 0
        const len = 4 + pick(6)
        if (rnd() < 0.4) put(`s${i}`, 'V1', t, len, { assetId: 'img', inPoint: 0 })
        else {
          const tr = rnd() < 0.8 ? 'A1' : 'A2'
          const lead = rnd() < 0.3 ? Math.min(pick(3), Math.max(0, t - free[tr])) : 0
          const tail = rnd() < 0.3 ? pick(3) - 1 : 0
          const a0 = Math.max(free[tr], t - lead)
          const a1 = Math.max(a0 + 1, t + len + tail)
          put(`v${i}`, 'V1', t, len, { linkId: `L${i}`, inPoint: 50 })
          put(`a${i}`, tr, a0, a1 - a0, { linkId: `L${i}`, inPoint: 50 - (t - a0) })
          free[tr] = a1
        }
        if (rnd() < 0.3) {
          const tr = rnd() < 0.5 ? 'A1' : 'A2'
          const at0 = Math.max(free[tr], t) + pick(2)
          put(`x${i}`, tr, at0, 1 + pick(2), { assetId: 'snd', inPoint: 0 })
          free[tr] = at0 + 3
        }
        t += len
      }
    })
    assert.deepEqual(checkProject(p0), [], `round ${round}: the layout itself is sound`)
    const ids = Object.keys(p0.clips).filter((id) => p0.clips[id].trackId === 'V1' || rnd() < 0.3)
    const target = p0.clips[ids[pick(ids.length)]]
    const time = target.start + 0.5 + rnd() * (target.duration - 1)
    const pairs = (p: Project): Map<string, number> => {
      const out = new Map<string, number>()
      for (const c of Object.values(p.clips)) {
        if (!c.linkId || !/^v/.test(c.id)) continue
        const o = Object.values(p.clips).find((x) => x.linkId === c.linkId && x.id !== c.id)
        if (o) out.set(c.linkId, +((c.start - c.inPoint) - (o.start - o.inPoint)).toFixed(6))
      }
      return out
    }
    const was = pairs(p0)
    load(p0, time, [target.id])
    const side = rnd() < 0.5 ? 'left' : 'right'
    const blocked = closePlan(p0, side === 'left' ? [target.start, time] : [time, target.start + target.duration], [target.trackId], { linked: true }).blockedBy !== undefined
    S().rippleTrimToPlayhead(side)
    const p = S().project
    assert.deepEqual(checkProject(p), [], `round ${round}: ${side} on ${target.id} at ${time.toFixed(2)}`)
    const lay = (q: Project): string => Object.values(q.clips).sort((x, y) => x.trackId.localeCompare(y.trackId) || x.start - y.start).map((c) => `${c.trackId}:${c.id}[${+c.start.toFixed(2)},${+(c.start + c.duration).toFixed(2)}]`).join(' ')
    for (const [link, off] of pairs(p)) assert.equal(off, was.get(link), `round ${round}: pair ${link} after ${side} on ${target.id} at ${time.toFixed(2)}
  was ${lay(p0)}
  now ${lay(p)}`)
    if (blocked) leftRuns++
    else closedRuns++
  }
  // (Both ways are really tried.)
  assert.ok(closedRuns > 50 && leftRuns > 5, `closed ${closedRuns}, left ${leftRuns}`)
})
