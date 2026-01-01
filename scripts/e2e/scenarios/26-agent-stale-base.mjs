// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// Scripted agent (e), phase 4A.7 / 4A.3: an edit sent with an old version.
// Only cuts since → its times are carried to now; something else changed →
// only the op that names the changed thing is refused (and said why); a
// version of another session (epoch) → a plain error. Direct mode here, so
// the live project's own versions are the ones in play.
import { WORDED, captionsOf } from './04-text-edit.mjs'
import { connectAgent, versionOf } from '../agent-client.mjs'
export const name = 'agent-script-e-stale-version'

export async function run({ c, app, media, lib }) {
  const { assert } = lib
  await c.waitFor('the agent host', () => c.ev('!!window.__agent'))
  const [talk] = await lib.seedAssets(app, c, [media.talk])
  await lib.seedTimeline(c, [talk.id])
  await c.run((caps) => { const s = window.__store.getState(); s.setSubtitles(caps); s.setDirty(false); window.__agent.setMode('direct') }, captionsOf(WORDED))
  const ag = await connectAgent({ c, app, assert, client: 'script-e' })
  const v0 = versionOf((await ag.call('transcript')).text)

  // The user cuts 1.0–2.0 s; the agent, still at v0, puts a marker at 9.6 s
  // ("and", in v0's times): it lands where "and" is now, 8.6 s.
  await c.run(() => window.__store.getState().rippleDeleteMany([[1.0, 2.0]]))
  const r1 = await ag.call('edit', { ops: [{ op: 'marker.add', time: 9.6, note: 'and' }], base: v0 })
  assert.match(r1.text, /^Applied/)
  const m = await c.st((s) => s.project.markers.find((k) => k.note === 'and').time)
  assert.ok(Math.abs(m - 8.6) < 1e-6, `on the footage it named, now at 8.6 (${m})`)
  const andNow = await c.st((s) => s.project.captions.find((k) => k.id === 'w3').words[0].start)
  assert.ok(Math.abs(andNow - m) < 0.01)

  // The user retypes line w2 and drags the clip 1.5 s later. An edit at v1:
  // its new text for w2 is dropped (the user wrote it since: theirs stays),
  // its marker (2 s of v1) lands on the footage it named, now 1.5 s later.
  const v1 = versionOf((await ag.call('project')).text)
  await c.run(() => window.__store.getState().updateCaption('w2', { text: 'then it ran over the bridge' }))
  // (The user's cut left two pieces: the one that plays at 2 s.)
  const clip = await c.st((s) => Object.values(s.project.clips).find((k) => k.start <= 2 && k.start + k.duration > 2).id)
  await c.run((id) => window.__store.getState().runBatch([{ name: 'clip.move', params: { clipId: id, start: 2.5 } }]), clip)
  const r2 = await ag.call('edit', { ops: [{ op: 'caption.editLine', id: 'w2', text: 'then it strolled over the bridge' }, { op: 'marker.add', time: 2, note: 'two' }], base: v1 })
  assert.match(r2.text, /^Applied \(one undo step\): marker\.add/)
  assert.match(r2.text, /Dropped \(the rest was applied\):\n#1 caption\.editLine: the text of this line was changed after you read it \(not by you\)/)
  assert.doesNotMatch(r2.text, /\bv [0-9a-z]+-\d+/, 'an edit answer names no version')
  assert.equal(await c.st((s) => s.project.captions.find((k) => k.id === 'w2').text), 'then it ran over the bridge', 'the user\'s words stay')
  const two = await c.st((s) => s.project.markers.find((k) => k.note === 'two').time)
  assert.ok(Math.abs(two - 3.5) < 1e-6, `the marker followed the footage (${two})`)

  // A version this client was never given: refused, plainly. So is an edit
  // with no base at all.
  const r3 = await ag.call('edit', { ops: [{ op: 'marker.add', time: 1 }], base: 'zzzzz-3' }, { allowError: true })
  assert.equal(r3.isError, true)
  assert.match(r3.text, /version zzzzz-3 is too old or not one you were given here: read again/)
  const r4 = await ag.call('edit', { ops: [{ op: 'marker.add', time: 1 }] }, { allowError: true })
  assert.match(r4.text, /base:? is required/)
  await c.run(() => window.__agent.setMode('draft'))
  console.log('     ' + ag.summary('script (e)').split('\n')[0])
}
