// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// 22 November, worker B, addendum 4 (D22-PLAN-B.md): an agent can switch a
// track's magnet. A new project's V1 keeps its clips joined (the magnet is on
// by default since that day), and on such a track "move every clip 10 s
// later" is refused; the refusal used to send the agent to the user ("tell
// them to switch it off on the track's header"). The header's button is a
// pure command now, track.setMagnet, which an agent's edit can send first,
// in the same call, and which the draft says in the user's words.
import './dom-stub'
import assert from 'node:assert/strict'
import test from 'node:test'
import { defaultProject, type Clip, type Project } from '../renderer/src/types'
import { useStore } from '../renderer/src/state/store'
import { checkProject } from '../renderer/src/model/check'
import { AGENT_COMMANDS, COMMANDS, applyBatch, runCommand } from '../renderer/src/commands'
import { draftChanges } from '../renderer/src/agent/draft-words'
import { editOperations, opsHelp } from '../renderer/src/agent/tools'
import { STRINGS } from '../renderer/src/ui/strings'

const T0 = { x: 960, y: 540, scale: 1, rotation: 0 }
const S = useStore.getState

/** Three talking clips in a row on V1, each with its sound linked on A1;
 *  V1's magnet as a new project has it. */
function joined(magnet = true): Project {
  const p = defaultProject()
  p.tracks = [{ id: 'V1', kind: 'video', name: 'V1', clipIds: [], autoPack: magnet }, { id: 'A1', kind: 'audio', name: 'A1', clipIds: [] }]
  p.assets = [{ id: 'vid', kind: 'video', name: 'vid.mp4', url: 'media://vid', size: 1, duration: 1000, width: 1920, height: 1080, hasAudio: true }] as Project['assets']
  const put = (id: string, trackId: string, start: number, extra: Partial<Clip> = {}): void => {
    p.clips[id] = { id, assetId: 'vid', trackId, start, inPoint: start, duration: 4, transform: { ...T0 }, volume: 1, ...extra }
    p.tracks.find((t) => t.id === trackId)!.clipIds.push(id)
  }
  for (const [i, id] of ['a', 'b', 'c'].entries()) {
    put(id, 'V1', i * 4, { linkId: `L${i}`, audioExtracted: true })
    put(id + 's', 'A1', i * 4, { linkId: `L${i}` })
  }
  return p
}
const starts = (p: Project): Record<string, number> => Object.fromEntries(Object.values(p.clips).map((c) => [c.id, +c.start.toFixed(3)]))
const ALL = { clipIds: ['a', 'b', 'c'], by: 10, linkAV: true }

test('track.setMagnet: off changes nothing but the switch; on gathers the track at 0, linked partners along', () => {
  const off = runCommand(joined(), COMMANDS['track.setMagnet'], { trackId: 'V1', on: false }).project
  assert.equal(off.tracks[0].autoPack, false)
  assert.deepEqual(starts(off), starts(joined()))
  // Moved apart while it was off, then switched on again: every gap closes.
  const apart = runCommand(off, COMMANDS['clip.move'], ALL).project
  assert.deepEqual(starts(apart), { a: 10, as: 10, b: 14, bs: 14, c: 18, cs: 18 })
  const on = runCommand(apart, COMMANDS['track.setMagnet'], { trackId: 'V1', on: true }).project
  assert.equal(on.tracks[0].autoPack, true)
  assert.deepEqual(starts(on), { a: 0, as: 0, b: 4, bs: 4, c: 8, cs: 8 }, 'gathered, each sound with its picture')
  assert.deepEqual(checkProject(on), [])
  // A locked track keeps its clips where they are (the switch is still set).
  const locked = structuredClone(apart)
  locked.tracks[0].locked = true
  const kept = runCommand(locked, COMMANDS['track.setMagnet'], { trackId: 'V1', on: true }).project
  assert.deepEqual(starts(kept), starts(apart))
  assert.throws(() => runCommand(joined(), COMMANDS['track.setMagnet'], { trackId: 'nope', on: false }), /there is no track "nope"/)
  // Its summary says what switching it on does.
  assert.match(COMMANDS['track.setMagnet'].summary, /switching it on again closes every gap/)
})

test('on a track that keeps its clips joined, the refusal names the command to send, not the user', () => {
  let said = ''
  try {
    runCommand(joined(), COMMANDS['clip.move'], ALL)
  } catch (e) {
    said = (e as Error).message
  }
  assert.match(said, /track V1 keeps its clips joined from 0 \(its magnet is on\)/)
  assert.match(said, /track\.setMagnet\{trackId:"V1",on:false\}/)
  assert.match(said, /in a draft the user sees it/)
  assert.doesNotMatch(said, /tell them|track's header/)
  // What it says to send works, in one call.
  const out = applyBatch(joined(), [{ name: 'track.setMagnet', params: { trackId: 'V1', on: false } }, { name: 'clip.move', params: ALL }]).project
  assert.deepEqual(starts(out), { a: 10, as: 10, b: 14, bs: 14, c: 18, cs: 18 })
  assert.equal(out.tracks[0].autoPack, false)
})

test('the header\'s magnet button is the command: one undo step each way', () => {
  S().loadProject(joined(false))
  S().runBatch([{ name: 'clip.move', params: ALL }])
  const depth = S().past.length
  S().setTrackMagnet('V1', true)
  assert.equal(S().past.length, depth + 1)
  assert.deepEqual(starts(S().project), { a: 0, as: 0, b: 4, bs: 4, c: 8, cs: 8 })
  S().undo()
  assert.equal(S().project.tracks[0].autoPack, false)
  assert.deepEqual(starts(S().project), { a: 10, as: 10, b: 14, bs: 14, c: 18, cs: 18 })
  S().setTrackMagnet('V1', false) // as it is: no step
  assert.equal(S().past.length, depth)
})

test('an agent can send it: in the edit tool\'s list by name, with its fields on help, inside the size limit', () => {
  assert.ok(AGENT_COMMANDS['track.setMagnet'], 'not internal')
  const ops = editOperations()
  assert.match(ops, /^Also: .*track\.\{[^}]*setMagnet[^}]*\}/m, 'named in the "Also:" list')
  assert.match(opsHelp(['track.setMagnet']), /track\.setMagnet\{trackId:s,on:bool\}[^\n]*switching it on again closes every gap/)
})

test('through the agent\'s edit, as a draft: switch off + move in one call; the draft says the magnet in the user\'s words', async () => {
  const { editTool } = await import('../renderer/src/agent/edit')
  const { rejectDraft, currentDraft, marksOf } = await import('../renderer/src/agent/drafts')
  const kit = await import('./agent-kit')
  const say = (x: unknown): string => (typeof x === 'string' ? x : JSON.stringify(x))
  kit.open(joined(), 'draft')
  const refused = say(await editTool({ ops: [{ op: 'clip.move', clipIds: ['a', 'b', 'c'], by: 10 }], base: kit.read() }, kit.ctxOf()))
  assert.match(refused, /track\.setMagnet\{trackId:"V1",on:false\}/, refused)
  rejectDraft()
  kit.open(joined(), 'draft')
  const out = say(await editTool({ ops: [{ op: 'track.setMagnet', trackId: 'V1', on: false }, { op: 'clip.move', clipIds: ['a', 'b', 'c'], by: 10 }], base: kit.read() }, kit.ctxOf()))
  assert.doesNotMatch(out, /Dropped|Nothing applied/, out)
  const d = currentDraft()!
  assert.deepEqual(starts(d.project), { a: 10, as: 10, b: 14, bs: 14, c: 18, cs: 18 })
  assert.equal(d.project.tracks[0].autoPack, false)
  assert.equal(S().project.tracks[0].autoPack, true, 'the live project waits')
  const changes = draftChanges(d.on, d.project, marksOf(d).cuts)
  const magnet = changes.find((c) => c.key === 'd22b.change.magnetOff')
  assert.deepEqual(magnet?.params, { track: 'V1' })
  assert.equal(changes.filter((c) => c.key === 'den2t.change.moveLater').length, 3)
  rejectDraft()
  // Both sentences, both languages, the track's name in each.
  for (const key of ['d22b.change.magnetOff', 'd22b.change.magnetOn'] as const) for (const lang of ['en', 'tr'] as const) assert.match(STRINGS[key][lang], /\{track\}/, `${key} ${lang}`)
  const back = draftChanges(joined(false), joined(true), [])
  assert.deepEqual(back.map((c) => c.key), ['d22b.change.magnetOn'])
})
