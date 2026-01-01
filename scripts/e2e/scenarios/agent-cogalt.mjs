// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// cogalt (23 Nov 2026): the user said "copy that clip" and the agent could
// not: clip.add wants a media id, the project answer gives ids only for media
// not placed yet, and there was no copy op. A scripted agent over real HTTP:
// copies a clip on the timeline (clip.duplicate, its linked sound with it),
// puts a new clip of media already on the timeline by a clip id and by the
// file name, is told what to send for a name that is nothing, sees "+ new" on
// the draft's copies, and accepting is one undo step.
import { connectAgent, versionOf } from '../agent-client.mjs'
export const name = 'agent-cogalt'
export const timeoutMs = 150_000

const build = (ids) => {
  const S = window.__store
  const p = structuredClone(S.getState().project)
  const T = { x: p.settings.width / 2, y: p.settings.height / 2, scale: 1, rotation: 0 }
  p.tracks = [
    { id: 'V2', kind: 'video', name: 'V2', clipIds: ['d'] },
    { id: 'V1', kind: 'video', name: 'V1', clipIds: ['a'] },
    { id: 'A1', kind: 'audio', name: 'A1', clipIds: ['as'] }
  ]
  p.clips = {
    a: { id: 'a', assetId: ids.talk, trackId: 'V1', start: 0, inPoint: 0, duration: 4, transform: T, volume: 1, linkId: 'L1', audioExtracted: true },
    as: { id: 'as', assetId: ids.talk, trackId: 'A1', start: 0, inPoint: 0, duration: 4, transform: T, volume: 0.5, linkId: 'L1' },
    d: { id: 'd', assetId: ids.other, trackId: 'V2', start: 1, inPoint: 0, duration: 2, transform: { ...T, scale: 0.4 }, volume: 1, opacity: 0.7 }
  }
  p.captions = []
  S.getState().setPlaying(false)
  S.getState().loadProject(p)
  S.setState({ selectedClipIds: [], linkAV: true, pxPerSec: 30 })
}

export async function run({ c, app, media, lib }) {
  const { assert } = lib
  await c.waitFor('the agent host', () => c.ev('!!window.__agent'))
  if ((await c.attr('agent.switch', 'aria-checked')) !== 'true') await lib.topBarSwitch(c)
  await c.waitFor('the agent server listening', async () => { try { await fetch(`http://127.0.0.1:${app.agentPort}/mcp`, { method: 'POST' }); return true } catch { return false } }, 15_000)
  const [talk, other] = await lib.seedAssets(app, c, [media.talk, media.other])
  const ids = { talk: talk.id, other: other.id, otherName: other.name }
  const ag = await connectAgent({ c, app, assert, client: 'claude-code' })
  const desc = ag.tools.find((t) => t.name === 'edit').description
  assert.match(desc, /clip\.\{[^}]*duplicate/, 'clip.duplicate is listed')
  assert.match(desc, /clip\.add\{[^\n]*clip id or file name/)
  assert.ok(ag.defsChars <= 12_000, `the definitions: ${ag.defsChars} characters`)
  const v = async () => versionOf((await ag.call('project')).text)
  const edit = async (ops) => (await ag.call('edit', { ops, base: await v() }, { allowError: true })).text
  const clips = () => c.st((s) => Object.values(s.project.clips).map((k) => ({ id: k.id, assetId: k.assetId, trackId: k.trackId, start: +k.start.toFixed(2), opacity: k.opacity, volume: k.volume, linkId: k.linkId ?? null })))

  // Straight on the timeline: a copy of d with its settings, a and its sound as a pair.
  await c.run(build, ids)
  await c.waitId('timeline.clip.a')
  await c.run(() => window.__agent.setMode('direct'))
  await c.sleep(150)
  let out = await edit([{ op: 'clip.duplicate', clipId: 'd' }, { op: 'clip.duplicate', clipId: 'a' }])
  assert.match(out, /^Applied \(one undo step\)/, out)
  let now = await clips()
  const dCopy = now.find((k) => k.trackId === 'V2' && k.id !== 'd')
  assert.ok(dCopy && dCopy.start === 3 && dCopy.opacity === 0.7 && dCopy.assetId === ids.other, JSON.stringify(dCopy))
  const aCopy = now.find((k) => k.trackId === 'V1' && k.id !== 'a')
  const sCopy = now.find((k) => k.trackId === 'A1' && k.id !== 'as')
  assert.ok(aCopy && sCopy && aCopy.start === 4 && sCopy.start === 4 && sCopy.volume === 0.5, JSON.stringify(now))
  assert.ok(aCopy.linkId && aCopy.linkId === sCopy.linkId && aCopy.linkId !== 'L1', 'the copies linked to each other')

  // Media already on the timeline: by a clip id, by the file name.
  out = await edit([{ op: 'clip.add', assetId: 'd', trackId: 'V2', start: 10 }, { op: 'clip.add', assetId: ids.otherName, trackId: 'V2', start: 14 }])
  assert.match(out, /^Applied/, out)
  now = await clips()
  assert.equal(now.filter((k) => k.assetId === ids.other && (k.start === 10 || k.start === 14)).length, 2, JSON.stringify(now))

  // A name that is nothing: what to send instead.
  out = await edit([{ op: 'clip.add', assetId: 'a.png', trackId: null, start: 0 }])
  assert.match(out, /no media, clip or file name "a\.png".*project \{"track":"media"\}.*clip\.duplicate/s, out)

  // As a draft: the copies marked "+ new"; accepted as one undo step.
  await c.run(build, ids)
  await c.waitId('timeline.clip.a')
  await c.run(() => window.__agent.setMode('draft'))
  await c.sleep(150)
  out = await edit([{ op: 'clip.duplicate', clipIds: ['a', 'd'], at: 20 }])
  assert.doesNotMatch(out, /error|refused/i, out)
  console.log('     draft answer: ' + out.slice(0, 140))
  await c.waitId('agent.draft')
  await c.sleep(300)
  const kinds = () => c.ev(`[...document.querySelectorAll('[data-testid="agent.mark"]')].map((e) => e.dataset.kind).join(' ')`)
  for (const view of ['live', 'candidate']) {
    if (await c.has(`agent.draft.view.${view}`)) await c.click(`agent.draft.view.${view}`)
    try {
      await c.waitFor(`the copies marked new (${view})`, async () => (await kinds()).split(' ').includes('add'), 8000)
    } catch (e) {
      throw new Error(`${e.message}; marks: "${await kinds()}"`)
    }
  }
  await c.click('agent.draft.view.live')
  const depth = await lib.undoDepth(c)
  await c.run(() => window.__agent.accept())
  await c.waitFor('accepted', async () => (await clips()).length === 6)
  now = await clips()
  assert.deepEqual(now.filter((k) => !['a', 'as', 'd'].includes(k.id)).map((k) => `${k.trackId}@${k.start}`).sort(), ['A1@20', 'V1@20', 'V2@21'])
  assert.equal(await lib.undoDepth(c), depth + 1, 'accepted as one undo step')
  await c.run(() => window.__store.getState().undo())
  assert.equal((await clips()).length, 3)
  await c.run(() => window.__agent.setMode('draft'))
}
