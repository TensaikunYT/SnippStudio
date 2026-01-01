// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// Phase 4A.3: a call the page answers too late is cancelled there and never
// applied afterwards. The app runs with a short call time (1.5 s, a test-only
// switch); the page is kept busy for 3 s while an edit comes in; the agent
// gets "did not answer", and when the page is free again the edit is not done.
import { WORDED, captionsOf } from './04-text-edit.mjs'
import { connectAgent } from '../agent-client.mjs'
export const name = 'agent-call-timeout-not-applied'

export async function run({ media, lib, relaunch }) {
  const { assert } = lib
  const app = await relaunch({ extraArgs: ['--e2e-agent-timeout=1500'], own: true })
  const c = app.cdp
  try {
    await lib.reset(c)
    await c.waitFor('the agent host', () => c.ev('!!window.__agent'))
    const [talk] = await lib.seedAssets(app, c, [media.talk])
    await lib.seedTimeline(c, [talk.id])
    await c.run((caps) => { const s = window.__store.getState(); s.setSubtitles(caps); s.setDirty(false); window.__agent.setMode('direct') }, captionsOf(WORDED))
    const ag = await connectAgent({ c, app, assert, client: 'timeout-check' })
    const base = /\bv ([0-9a-z]+-\d+)/.exec((await ag.call('project')).text)?.[1]
    const depth0 = await lib.undoDepth(c)
    // The page busy for 3 s (a long frame, a heavy decode…).
    const busy = c.ev('(() => { const t = Date.now(); while (Date.now() - t < 3000) {} ; return 1 })()')
    await new Promise((r) => setTimeout(r, 150))
    const late = await ag.call('edit', { ops: [{ op: 'marker.add', time: 1, note: 'late' }], base }, { allowError: true })
    await busy
    assert.equal(late.isError, true)
    assert.match(late.text, /did not answer within 2 seconds \(no answer; the call was cancelled\)\. Read changes/)
    await new Promise((r) => setTimeout(r, 500))
    assert.equal(await c.st((s) => (s.project.markers ?? []).filter((m) => m.note === 'late').length), 0, 'not applied afterwards')
    assert.equal(await lib.undoDepth(c), depth0)
    // The activity log says how it ended.
    const ev = await c.ev(`window.__agent.store.getState().events.filter((e) => e.tool === 'edit').pop()`)
    assert.match(ev.error ?? '', /cancelled/)
    // A call in time still works.
    const ok = await ag.call('edit', { ops: [{ op: 'marker.add', time: 1, note: 'in time' }], base })
    assert.match(ok.text, /^Applied/)
    await c.run(() => window.__agent.setMode('draft'))
  } finally {
    // Back to a normal app for whatever runs next.
    await relaunch({ own: true })
  }
}
