// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// 22 November, worker B, the addendum to K3 (D22-PLAN-B.md): Alt + ripple
// delete (clip.delete with onlyItsTrack) closes the deleted clips' own tracks
// and keeps the linked pairs after them in step. Each track used to close on
// its own: a still deleted before a talking clip moved that clip up and left
// its linked sound where it was. Now the tracks are closed together
// (ops/ripple.ts closeSpans): what moves up takes its linked partner along;
// where a pair could not stay in step nothing closes, the gaps stay, and it
// is said (to the user: a toast; to an agent: a note on its answer and on
// the draft's row). The same note for timeline.cutRangeOnTrack.
import './dom-stub'
import assert from 'node:assert/strict'
import test from 'node:test'
import { defaultProject, type Clip, type Project } from '../renderer/src/types'
import { useStore } from '../renderer/src/state/store'
import { checkProject } from '../renderer/src/model/check'
import { COMMANDS, runCommand } from '../renderer/src/commands'
import { closeSpansPlan } from '../renderer/src/commands/ops/ripple'
import { ownTrackClosePlan } from '../renderer/src/commands/clips'
import { clearToasts, currentToasts } from '../renderer/src/ui/toast-core'

const T0 = { x: 960, y: 540, scale: 1, rotation: 0 }
const S = useStore.getState
type Put = (id: string, trackId: string, start: number, duration: number, extra?: Partial<Clip>) => void

function project(build: (put: Put, p: Project) => void, tracks: [string, 'video' | 'audio'][] = [['V2', 'video'], ['V1', 'video'], ['A1', 'audio'], ['A2', 'audio']]): Project {
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
const still = { assetId: 'img', inPoint: 0 }
const sound = { assetId: 'snd', inPoint: 0 }
const load = (p: Project, link = true): void => {
  S().loadProject(p)
  useStore.setState({ linkAV: link, selectedClipIds: [] })
}
const at = (id: string, p: Project = S().project): [number, number] => [+p.clips[id].start.toFixed(6), +(p.clips[id].start + p.clips[id].duration).toFixed(6)]
const offset = (p: Project, v: string, a: string): number => +((p.clips[v].start - p.clips[v].inPoint) - (p.clips[a].start - p.clips[a].inPoint)).toFixed(6)
const told = (): string[] => currentToasts().map((x) => x.text)

/** A still with no sound, then a talking clip with its linked sound. */
const stillThenTalk = (more: (put: Put) => void = () => {}): Project =>
  project((put) => {
    put('pic', 'V1', 0, 6, still)
    put('talk', 'V1', 6, 10, { linkId: 'L1' })
    put('talkA', 'A1', 6, 10, { linkId: 'L1' })
    more(put)
  })

test('Alt + ripple delete of a still: the talking clip after it moves up WITH its linked sound', () => {
  load(stillThenTalk((put) => put('fx', 'A1', 17, 1, sound)))
  S().deleteClips(['pic'], true, true)
  const p = S().project
  assert.equal(p.clips.pic, undefined)
  assert.deepEqual([at('talk'), at('talkA')], [[0, 10], [0, 10]])
  assert.equal(offset(p, 'talk', 'talkA'), 0)
  // The sound track followed whole: what was laid against the talk stays against it.
  assert.deepEqual(at('fx'), [11, 12])
  assert.deepEqual(checkProject(p), [])
  S().undo()
  assert.deepEqual([at('pic'), at('talk'), at('talkA'), at('fx')], [[0, 6], [6, 16], [6, 16], [17, 18]])
})

test('material under the still on the sound track: deleted, nothing closes, the user is told', () => {
  load(stillThenTalk((put) => put('narration', 'A1', 0, 6, sound)))
  clearToasts()
  S().deleteClips(['pic'], true, true)
  const p = S().project
  assert.equal(p.clips.pic, undefined)
  assert.deepEqual([at('talk'), at('talkA'), at('narration')], [[6, 16], [6, 16], [0, 6]], 'the gap stays; nothing of the narration is cut')
  assert.equal(told().length, 1)
  assert.match(told()[0], /A1/)
  assert.deepEqual(checkProject(p), [])
})

test('the link switch off: the clip\'s own track alone, as it was', () => {
  load(stillThenTalk(), false)
  clearToasts()
  S().deleteClips(['pic'], true, true)
  assert.deepEqual([at('talk'), at('talkA')], [[0, 10], [6, 16]])
  assert.equal(told().length, 0)
})

test('a linked pair deleted with Alt: both its tracks close, the pairs after it together', () => {
  load(project((put) => {
    put('a', 'V1', 0, 5, { linkId: 'L1' })
    put('aA', 'A1', 0, 5, { linkId: 'L1' })
    put('b', 'V1', 5, 5, { linkId: 'L2' })
    put('bA', 'A1', 5, 5, { linkId: 'L2' })
    put('music', 'A2', 0, 20, sound)
  }))
  S().deleteClips(['a'], true, true) // the store names the partner (the link is on)
  assert.deepEqual([at('b'), at('bA'), at('music')], [[0, 5], [0, 5], [0, 20]])
})

test('stretches that overlap across tracks: planned on the timeline as it is, no clip is cut or laid over another', () => {
  // V1 loses 5–10, V2 loses 6–12; each track's pair after it has its sound on a track of its own.
  const make = (): Project => project((put) => {
    put('x', 'V1', 0, 5, still)
    put('d1', 'V1', 5, 5, still)
    put('t1', 'V1', 10, 6, { linkId: 'L1' })
    put('t1A', 'A1', 10, 6, { linkId: 'L1' })
    put('d2', 'V2', 6, 6, still)
    put('t2', 'V2', 12, 6, { linkId: 'L2' })
    put('t2A', 'A2', 12, 6, { linkId: 'L2' })
  })
  const p0 = make()
  const plan = ownTrackClosePlan(p0, ['d1', 'd2'])
  assert.equal(plan.blockedBy, undefined)
  assert.deepEqual(plan.cuts, { V1: [[5, 10]], V2: [[6, 12]], A1: [[5, 10]], A2: [[6, 12]] })
  assert.deepEqual(plan.followers.sort(), ['A1', 'A2'])
  load(make())
  S().deleteClips(['d1', 'd2'], true, true)
  const p = S().project
  assert.deepEqual([at('t1'), at('t1A'), at('t2'), at('t2A'), at('x')], [[5, 11], [5, 11], [6, 12], [6, 12], [0, 5]])
  assert.deepEqual(checkProject(p), [])
  // One sound track for both pairs: it would have to lose 5–10 for one and
  // 6–12 for the other, and the first pair's sound lies in 6–12 → nothing closes.
  const tight = project((put) => {
    put('d1', 'V1', 5, 5, still)
    put('t1', 'V1', 10, 2, { linkId: 'L1' })
    put('t1A', 'A1', 10, 2, { linkId: 'L1' })
    put('d2', 'V2', 6, 6, still)
    put('t2', 'V2', 12, 6, { linkId: 'L2' })
    put('t2A', 'A1', 12, 6, { linkId: 'L2' })
  })
  assert.equal(ownTrackClosePlan(tight, ['d1', 'd2']).blockedBy, 'A1')
  load(tight)
  S().deleteClips(['d1', 'd2'], true, true)
  assert.deepEqual([at('t1'), at('t1A'), at('t2'), at('t2A')], [[10, 12], [10, 12], [12, 18], [12, 18]])
})

test('several deleted clips on one track, and a follower that takes on each of their places', () => {
  load(project((put) => {
    put('s1', 'V1', 0, 2, still)
    put('t1', 'V1', 2, 4, { linkId: 'L1' })
    put('t1A', 'A1', 2, 4, { linkId: 'L1' })
    put('s2', 'V1', 6, 3, still)
    put('t2', 'V1', 9, 4, { linkId: 'L2' })
    put('t2A', 'A1', 9, 4, { linkId: 'L2' })
  }))
  S().deleteClips(['s1', 's2'], true, true)
  const p = S().project
  assert.deepEqual([at('t1'), at('t1A'), at('t2'), at('t2A')], [[0, 4], [0, 4], [4, 8], [4, 8]])
  assert.equal(offset(p, 't1', 't1A') + offset(p, 't2', 't2A'), 0)
})

test('the pure command: an agent\'s clip.delete counts the link by default; locked follower → the gaps stay', () => {
  const out = runCommand(stillThenTalk(), COMMANDS['clip.delete'], { ids: ['pic'], ripple: true, onlyItsTrack: true }).project
  assert.deepEqual([at('talk', out), at('talkA', out)], [[0, 10], [0, 10]])
  const locked = stillThenTalk()
  locked.tracks.find((t) => t.id === 'A1')!.locked = true
  assert.equal(ownTrackClosePlan(locked, ['pic']).blockedBy, 'A1')
  const kept = runCommand(locked, COMMANDS['clip.delete'], { ids: ['pic'], ripple: true, onlyItsTrack: true }).project
  assert.equal(kept.clips.pic, undefined)
  assert.deepEqual([at('talk', kept), at('talkA', kept)], [[6, 16], [6, 16]])
  // No link asked for: nothing follows, nothing is in the way.
  assert.deepEqual(closeSpansPlan(locked, [{ trackId: 'V1', range: [0, 6] }], { linked: false }), { cuts: { V1: [[0, 6]] }, followers: [] })
})

test('the agent is told when a track-only close left its gap: clip.delete and timeline.cutRangeOnTrack, applied and in a draft', async () => {
  const { editTool } = await import('../renderer/src/agent/edit')
  const { rejectDraft, currentDraft } = await import('../renderer/src/agent/drafts')
  const kit = await import('./agent-kit')
  const inTheWay = (): Project => stillThenTalk((put) => put('narration', 'A1', 0, 6, sound))
  const say = (x: unknown): string => (typeof x === 'string' ? x : JSON.stringify(x))
  for (const mode of ['direct', 'draft'] as const) {
    kit.open(inTheWay(), mode)
    const del = say(await editTool({ ops: [{ op: 'clip.delete', ids: ['pic'], ripple: true, onlyItsTrack: true }], base: kit.read() }, kit.ctxOf()))
    assert.match(del, /could not move up \(track A1 is locked or has material there\): deleted, the gaps stay/, `${mode}: ${del}`)
    // (The card's row of an op shows its outcome's notes: drafts.ts opsOf.)
    if (mode === 'draft') assert.match(JSON.stringify(currentDraft()?.outcomes), /deleted, the gaps stay/, 'the draft keeps the note for its row on the card')
    rejectDraft()
    kit.open(inTheWay(), mode)
    const cut = say(await editTool({ ops: [{ op: 'timeline.cutRangeOnTrack', trackId: 'V1', range: [3, 6] }], base: kit.read() }, kit.ctxOf()))
    assert.match(cut, /could not move up \(track A1 is locked or has material there\): the range was cut out, the gap stays/, `${mode}: ${cut}`)
    rejectDraft()
    // …and nothing is said when it closed.
    kit.open(stillThenTalk(), mode)
    const fine = say(await editTool({ ops: [{ op: 'clip.delete', ids: ['pic'], ripple: true, onlyItsTrack: true }], base: kit.read() }, kit.ctxOf()))
    assert.doesNotMatch(fine, /gaps? stay/, `${mode}: ${fine}`)
    rejectDraft()
  }
})

test('whatever the layout: after Alt + ripple delete with the link on, no linked pair has moved apart, nothing is cut, nothing overlaps', () => {
  let seed = 2211
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
  for (let round = 0; round < 400; round++) {
    // Two picture tracks of stills and talking clips (some gaps); each talk's
    // sound on A1 or A2, sometimes starting earlier or ending later; loose
    // sounds where there is room.
    const free: Record<string, number> = { A1: 0, A2: 0 }
    const p0 = project((put) => {
      for (const [track, n] of [['V1', 6], ['V2', 3]] as const) {
        let t = track === 'V2' ? pick(6) : 0
        for (let i = 0; i < n; i++) {
          t += rnd() < 0.3 ? 1 + pick(3) : 0
          const len = 3 + pick(6)
          const id = `${track}${i}`
          if (rnd() < 0.45) put(`s${id}`, track, t, len, still)
          else {
            const tr = rnd() < 0.6 ? 'A1' : 'A2'
            const lead = rnd() < 0.3 ? Math.min(pick(3), Math.max(0, t - free[tr])) : 0
            const a0 = Math.max(free[tr], t - lead)
            const a1 = Math.max(a0 + 1, t + len + (rnd() < 0.3 ? pick(3) - 1 : 0))
            put(`v${id}`, track, t, len, { linkId: `L${id}`, inPoint: 50 })
            put(`a${id}`, tr, a0, a1 - a0, { linkId: `L${id}`, inPoint: 50 - (t - a0) })
            free[tr] = a1
          }
          if (rnd() < 0.25) {
            const tr = rnd() < 0.5 ? 'A1' : 'A2'
            const at0 = Math.max(free[tr], t) + pick(2)
            put(`x${id}`, tr, at0, 1 + pick(2), sound)
            free[tr] = at0 + 3
          }
          t += len
        }
      }
    })
    assert.deepEqual(checkProject(p0), [], `round ${round}: the layout itself is sound`)
    // One to three clips of the picture tracks (sometimes a sound too).
    const all = Object.keys(p0.clips)
    const ids = [...new Set(Array.from({ length: 1 + pick(3) }, () => all[pick(all.length)]))]
    const pairs = (p: Project): Map<string, number> => {
      const out = new Map<string, number>()
      for (const c of Object.values(p.clips)) {
        if (!c.linkId || !/^v/.test(c.id)) continue
        const o = Object.values(p.clips).find((x) => x.linkId === c.linkId && x.id !== c.id)
        if (o) out.set(c.linkId, +((c.start - c.inPoint) - (o.start - o.inPoint)).toFixed(6))
      }
      return out
    }
    const shape = (p: Project): Map<string, string> => new Map(Object.values(p.clips).map((c) => [c.id, `${c.duration}|${c.inPoint}|${c.trackId}`]))
    const was = pairs(p0)
    const shapes = shape(p0)
    load(p0)
    const taken = new Set(Object.keys(p0.clips).filter((id) => ids.includes(id) || ids.some((x) => p0.clips[x].linkId && p0.clips[x].linkId === p0.clips[id].linkId)))
    const blocked = ownTrackClosePlan(p0, [...taken]).blockedBy !== undefined
    S().deleteClips(ids, true, true)
    const p = S().project
    const lay = (q: Project): string => Object.values(q.clips).sort((x, y) => x.trackId.localeCompare(y.trackId) || x.start - y.start).map((c) => `${c.trackId}:${c.id}[${+c.start.toFixed(2)},${+(c.start + c.duration).toFixed(2)}]`).join(' ')
    const where = `round ${round}: delete ${ids.join(', ')}\n  was ${lay(p0)}\n  now ${lay(p)}`
    assert.deepEqual(Object.keys(p.clips).sort(), all.filter((id) => !taken.has(id)).sort(), where)
    assert.deepEqual(checkProject(p), [], where)
    for (const [link, off] of pairs(p)) assert.equal(off, was.get(link), `pair ${link}: ${where}`)
    for (const [id, sh] of shape(p)) assert.equal(sh, shapes.get(id), `${id} was cut or changed: ${where}`)
    // Blocked: nobody moved at all. Closed: nobody moved later.
    for (const c of Object.values(p.clips)) {
      if (blocked) assert.equal(c.start, p0.clips[c.id].start, `${c.id} moved though nothing may close: ${where}`)
      else assert.ok(c.start <= p0.clips[c.id].start + 1e-9, `${c.id} moved later: ${where}`)
    }
    if (blocked) leftRuns++
    else closedRuns++
  }
  assert.ok(closedRuns > 60 && leftRuns > 20, `closed ${closedRuns}, left ${leftRuns}`)
})
