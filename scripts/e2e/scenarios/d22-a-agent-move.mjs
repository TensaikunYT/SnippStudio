// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// D22, worker A, item 1 (the audit's A1, K8): "move all the videos 10 s
// later", said by a scripted agent over real HTTP the five ways the audit
// tried (p6-direct) and the new one. Three clips in a row on V1, each with
// its sound linked on A1, one clip on V2. Every way gives the right timeline
// or is refused with what to send instead; a scripted agent that then sends
// what the refusal says ends with the right timeline.
//   F  one op: clipIds + by                       right, one undo step
//   D  the four moves in one call                 right (one move), one undo step
//   A  one call per clip, in timeline order       the first is refused; following it: right
//   B  the same with linkAV:true                  the same
//   C  last to first                              right; the sounds come along by default
//   E  start:10 for each                          a and b refused; nothing turned round
// Then the same as a draft (accepted: right), and the words the user reads of
// a change made straight on the timeline (the audit's A13): what changed,
// never "clip.move".
// And on a V1 whose magnet is on, as a new project's is (22 Nov, worker B):
// the move is refused with the command that switches the magnet off; the
// scripted agent sends that and the move in ONE call, the draft says both in
// the user's words, and accepting it is one undo step.
import { connectAgent, versionOf } from '../agent-client.mjs'
export const name = 'agent-d22-move-all-clips'
export const timeoutMs = 150_000

const build = (ids) => {
  const S = window.__store
  const p = structuredClone(S.getState().project)
  const W = p.settings.width
  const H = p.settings.height
  const T = { x: W / 2, y: H / 2, scale: 1, rotation: 0 }
  p.tracks = [
    { id: 'V2', kind: 'video', name: 'V2', clipIds: ['d'] },
    { id: 'V1', kind: 'video', name: 'V1', clipIds: ['a', 'b', 'c'] },
    { id: 'A1', kind: 'audio', name: 'A1', clipIds: ['as', 'bs', 'cs'] }
  ]
  const v = (id, start, link) => ({ id, assetId: ids.talk, trackId: 'V1', start, inPoint: start, duration: 4, transform: T, volume: 1, linkId: link, audioExtracted: true })
  const s = (id, start, link) => ({ id, assetId: ids.talk, trackId: 'A1', start, inPoint: start, duration: 4, transform: T, volume: 1, linkId: link })
  p.clips = { a: v('a', 0, 'L1'), b: v('b', 4, 'L2'), c: v('c', 8, 'L3'), as: s('as', 0, 'L1'), bs: s('bs', 4, 'L2'), cs: s('cs', 8, 'L3'), d: { id: 'd', assetId: ids.other, trackId: 'V2', start: 2, inPoint: 0, duration: 4, transform: { ...T, scale: 0.4 }, volume: 1 } }
  p.captions = []
  S.getState().setPlaying(false)
  S.getState().loadProject(p)
  S.setState({ selectedClipIds: [], linkAV: true, pxPerSec: 30 })
}
const WAS = { a: 0, as: 0, b: 4, bs: 4, c: 8, cs: 8, d: 2 }
const WANT = { a: 10, as: 10, b: 14, bs: 14, c: 18, cs: 18, d: 12 }
const starts = async (c) => {
  const st = await c.st((s) => Object.fromEntries(Object.values(s.project.clips).map((k) => [k.id, +k.start.toFixed(2)])))
  return Object.fromEntries(Object.keys(WANT).map((k) => [k, st[k]]))
}
const REFUSED = /it would land on c \(V1 8\.00–12\.00\) and move 2 clips that are not named \(c, cs\)\. To shift several clips and keep their spacing, name them all in ONE op: clipIds:\[…\] with by\. To put it there and move those later, send push:true/

export async function run({ c, app, media, lib }) {
  const { assert } = lib
  await c.waitFor('the agent host', () => c.ev('!!window.__agent'))
  if ((await c.attr('agent.switch', 'aria-checked')) !== 'true') await lib.topBarSwitch(c)
  await c.waitFor('the agent server listening', async () => { try { await fetch(`http://127.0.0.1:${app.agentPort}/mcp`, { method: 'POST' }); return true } catch { return false } }, 15_000)
  const [talk, other] = await lib.seedAssets(app, c, [media.talk, media.other])
  const ids = { talk: talk.id, other: other.id }
  const ag = await connectAgent({ c, app, assert, client: 'claude-code' })
  // The tool list tells an agent how: the group, the link, the refusal.
  assert.match(ag.tools.find((t) => t.name === 'edit').description, /^clip\.move\{clipId\|clipIds:\[s\],start:t\|by:n\(s\),linkAV\?:bool,push\?:bool\} to start, or by ± s \(clipIds: all at once, spacing kept\)\./m)
  assert.ok(ag.defsChars <= 12_000, `the definitions: ${ag.defsChars} characters`)
  const v = async () => versionOf((await ag.call('project')).text)
  const edit = async (ops) => (await ag.call('edit', { ops, base: await v() }, { allowError: true })).text
  const fresh = async (mode) => {
    await c.run(build, ids)
    await c.waitId('timeline.clip.c')
    await c.run((m) => window.__agent.setMode(m), mode)
    await c.sleep(150)
  }
  const failed = []
  const part = async (what, body) => {
    try {
      await body()
    } catch (e) {
      failed.push(`${what}: ${e.message.split(/\r?\n/)[0]}`)
    }
  }

  await part('F one op', async () => {
    await fresh('direct')
    const depth = await lib.undoDepth(c)
    const out = await edit([{ op: 'clip.move', clipIds: ['a', 'b', 'c', 'd'], by: 10 }])
    assert.match(out, /^Applied \(one undo step\): clip\.move\. Length 12\.00 → 22\.00 s/)
    assert.deepEqual(await starts(c), WANT)
    assert.equal(await lib.undoDepth(c), depth + 1, 'one undo step')
    // A13: what changed is said in the user's words. (D22, worker C, the
    // second pass: said ONCE, in the agent bar over the timeline; no toast
    // and no label on the lanes beside it.)
    const label = await c.ev(`document.querySelector('[data-testid="agent.bar.what"]')?.innerText ?? ''`)
    assert.match(label, /^Changed: talk\.mp4 moves 10 s later \(0:00 → 0:10\), with its sound, and 3 more$/, label)
    const toasts = await c.ev(`[...document.querySelectorAll('.ui-toast')].map((e) => e.innerText).join('\\n')`)
    assert.doesNotMatch(toasts, /talk\.mp4 moves/, 'not said again in a toast')
    assert.equal(await c.ev(`!!document.querySelector('[data-testid="agent.flash.label"]')`), false, 'not said again on the lanes')
    assert.ok(await c.has('agent.bar.undo'), 'the bar has the Undo the toast spoke of')
    assert.doesNotMatch(toasts + label, /clip\.move/, 'no command name is shown to the user')
    await c.click('inspector.tab.agent')
    const steps = await c.ev(`document.querySelector('[data-testid="agent.steps"]')?.innerText ?? ''`)
    assert.match(steps, /Edited: talk\.mp4 moves 10 s later \(0:00 → 0:10\), with its sound, and 3 more/)
    assert.doesNotMatch(steps, /clip\.move/)
    await c.run(() => window.__store.getState().undo())
    assert.deepEqual(await starts(c), WAS, 'Ctrl+Z takes the whole move back')
  })

  await part('D four moves in one call', async () => {
    await fresh('direct')
    const depth = await lib.undoDepth(c)
    const out = await edit(['a', 'b', 'c', 'd'].map((id) => ({ op: 'clip.move', clipId: id, by: 10, linkAV: true })))
    assert.doesNotMatch(out, /Dropped/)
    assert.deepEqual(await starts(c), WANT)
    assert.equal(await lib.undoDepth(c), depth + 1)
  })

  for (const [what, extra] of [['A in timeline order', {}], ['B with linkAV:true', { linkAV: true }]]) {
    await part(what, async () => {
      await fresh('direct')
      const first = await edit([{ op: 'clip.move', clipId: 'a', by: 10, ...extra }])
      assert.match(first, /^Nothing applied/)
      assert.match(first, REFUSED)
      assert.deepEqual(await starts(c), WAS, 'the refused move changed nothing')
      // The scripted agent does what it was told.
      await edit([{ op: 'clip.move', clipIds: ['a', 'b', 'c', 'd'], by: 10, ...extra }])
      assert.deepEqual(await starts(c), WANT)
    })
  }

  await part('C last to first', async () => {
    await fresh('direct')
    for (const id of ['c', 'b', 'a', 'd']) assert.match(await edit([{ op: 'clip.move', clipId: id, by: 10 }]), /^Applied/)
    assert.deepEqual(await starts(c), WANT, 'right, and no sound was left behind (linkAV was not sent)')
  })

  await part('E start:10 for each', async () => {
    await fresh('direct')
    for (const id of ['a', 'b']) assert.match(await edit([{ op: 'clip.move', clipId: id, start: 10 }]), REFUSED)
    assert.deepEqual(await starts(c), WAS, 'nothing was turned round')
    // The insert a drag makes is still there, when asked for.
    const pushed = await edit([{ op: 'clip.move', clipId: 'a', start: 10, push: true }])
    assert.match(pushed, /Moved: [^\n]*a 0\.00→10\.00[^\n]*c 8\.00→14\.00/)
  })

  await part('a draft', async () => {
    await fresh('draft')
    const out = await edit(['a', 'b', 'c', 'd'].map((id) => ({ op: 'clip.move', clipId: id, by: 10 })))
    assert.match(out, /^Draft started: clip\.move\. 1 call waits? for the user/)
    assert.deepEqual(await starts(c), WAS, 'the live project waits')
    const depth = await lib.undoDepth(c)
    await c.run(() => window.__agent.accept())
    await c.waitFor('accepted', async () => (await starts(c)).a === 10)
    assert.deepEqual(await starts(c), WANT)
    assert.equal(await lib.undoDepth(c), depth + 1, 'accepted as one undo step')
  })

  await part('the magnet on V1: off + move in one draft', async () => {
    await fresh('draft')
    await c.run(() => {
      const S = window.__store
      const p = structuredClone(S.getState().project)
      p.tracks.find((t) => t.id === 'V1').autoPack = true
      S.getState().loadProject(p)
      S.setState({ selectedClipIds: [], linkAV: true, pxPerSec: 30 })
    })
    await c.waitId('timeline.clip.c')
    const magnet = () => c.st((s) => !!s.project.tracks.find((t) => t.id === 'V1').autoPack)
    const refused = await edit([{ op: 'clip.move', clipIds: ['a', 'b', 'c', 'd'], by: 10 }])
    assert.match(refused, /track V1 keeps its clips joined from 0 \(its magnet is on\), so they cannot be shifted\. Switch it off first with track\.setMagnet\{trackId:"V1",on:false\}/, refused)
    assert.doesNotMatch(refused, /tell them|track's header/, 'the agent is not sent to the user')
    assert.deepEqual(await starts(c), WAS)
    // The scripted agent sends what the refusal says, in one call.
    const out = await edit([{ op: 'track.setMagnet', trackId: 'V1', on: false }, { op: 'clip.move', clipIds: ['a', 'b', 'c', 'd'], by: 10 }])
    assert.match(out, /^Draft started: track\.setMagnet, clip\.move\./, out)
    assert.doesNotMatch(out, /Dropped/, out)
    assert.deepEqual(await starts(c), WAS, 'the live project waits')
    assert.equal(await magnet(), true, 'and its magnet is still on')
    // The user reads it in their own words, wherever the draft is shown.
    await c.waitFor('the draft says the magnet', async () => (await c.ev('document.body.innerText')).includes('The magnet of V1 is switched off'), 8000)
    assert.doesNotMatch(await c.ev(`document.querySelector('[data-testid="agent.draft.changes"]')?.innerText ?? ''`), /setMagnet/, 'no command name in the words')
    const depth = await lib.undoDepth(c)
    await c.run(() => window.__agent.accept())
    await c.waitFor('accepted', async () => (await starts(c)).a === 10)
    assert.deepEqual(await starts(c), WANT)
    assert.equal(await magnet(), false)
    assert.equal(await lib.undoDepth(c), depth + 1, 'accepted as one undo step')
    await c.run(() => window.__store.getState().undo())
    assert.deepEqual(await starts(c), WAS, 'Ctrl+Z takes both back')
    assert.equal(await magnet(), true)
  })

  await c.run(() => window.__agent.setMode('draft'))
  console.log('     ' + ag.summary('d22-a move').split('\n')[0])
  if (failed.length) throw new Error(`${failed.length} part(s) failed:\n  ${failed.join('\n  ')}`)
}
