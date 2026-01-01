// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// D22, worker A, items 2–4 (the audit's A2 / K2, A8, K5): two agent programs
// on one project, two scripted clients over real HTTP ("claude-code" holds
// the project, "codex-mcp-client" was refused).
//   - A task typed in the command box while only Codex waits stays in line
//     and reaches Claude Code's next wait; the top bar does not say "Codex is
//     waiting for you" meanwhile.
//   - Codex's wait is told whose the project is: at once the first time, at
//     the end of its time after that.
//   - The user's "Reject" with a word on Claude Code's draft reaches Claude
//     Code, never Codex.
//   - Codex reads the notes and takes none; Claude Code then takes them.
//   - Handed over: what is in line then goes to Codex.
//   - Eight later sessions under Claude Code's name do not end the session
//     that works (it is in a wait): it still answers.
//   - The user's pick of the working agent (before anyone changed the
//     project): another program is refused and listed; picking it hands over.
import { connectAgent, versionOf } from '../agent-client.mjs'
export const name = 'agent-d22-two-agents-inbox'
export const timeoutMs = 150_000

const WITH_CLAUDE = /^Nothing for you: this project is with another agent \(Claude Code\) now, and what the user sends from .+ goes to it\./

export async function run({ c, app, media, lib }) {
  const { assert } = lib
  await c.waitFor('the agent host', () => c.ev('!!window.__agent'))
  if ((await c.attr('agent.switch', 'aria-checked')) !== 'true') await lib.topBarSwitch(c)
  await c.waitFor('the agent server listening', async () => { try { await fetch(`http://127.0.0.1:${app.agentPort}/mcp`, { method: 'POST' }); return true } catch { return false } }, 15_000)
  const [talk, other] = await lib.seedAssets(app, c, [media.talk, media.other])
  await lib.seedTimeline(c, [talk.id, other.id])
  await c.run(() => {
    const s = window.__store.getState()
    for (const [start, text] of [[1, 'the music is too loud here'], [4, 'cut this pause']]) {
      s.startNoteDraft({ start, end: start + 1 })
      s.patchNoteDraft({ text, kind: 'fix' })
      s.saveNoteDraft()
    }
    window.__agent.setMode('draft')
  })
  const noteStatus = () => c.st((s) => (s.project.notes ?? []).map((n) => n.status))
  /** The user types a task in the command box and sends it. */
  const say = async (text) => {
    if ((await c.attr('agent.box', 'data-folded')) === 'true') await c.click('agent.box.open')
    await c.fill('agent.box.text', text)
    await c.click('agent.box.send')
  }
  const claude = await connectAgent({ c, app, assert, client: 'claude-code' })
  const codex = await connectAgent({ c, app, assert, client: 'codex-mcp-client' })
  const clips = await lib.clipList(c)

  // The user's pick (the field the Agent tab's selector writes: holder.ts
  // chooseAgent), before any agent changed the project: only the picked
  // program may change it; picking the one that asked hands it over.
  await c.run(() => window.__agent.choose('codex-mcp-client'))
  const picked = await claude.call('edit', { ops: [{ op: 'marker.add', time: 1 }], base: versionOf((await claude.call('project')).text) }, { allowError: true })
  assert.ok(picked.isError)
  assert.match(picked.text, /The user chose another agent \(Codex\) to work on this project/)
  assert.deepEqual(await c.run(() => window.__agent.holder()), { holder: null, chosen: 'codex-mcp-client', asked: ['claude-code'] })
  await c.run(() => window.__agent.choose('claude-code'))
  const now0 = await c.run(() => window.__agent.holder())
  assert.equal(now0.holder?.client, 'claude-code', 'the session that asked holds the project now')
  assert.equal(now0.chosen, 'claude-code')
  assert.deepEqual(now0.asked, [])

  // Claude Code changes the project (a draft): it holds it. Codex is refused.
  await claude.call('edit', { ops: [{ op: 'marker.add', time: 3, note: 'here' }], base: versionOf((await claude.call('project')).text) })
  const no = await codex.call('edit', { ops: [{ op: 'marker.add', time: 5 }], base: versionOf((await codex.call('project')).text) }, { allowError: true })
  assert.match(no.text, /Another agent \(Claude Code\) is changing this project/)

  // A8: Codex reads the notes and takes none.
  const codexNotes = await codex.call('notes')
  assert.match(codexNotes.text, /2 waiting for work/)
  assert.match(codexNotes.text, /\nRead only: this project is with another agent \(Claude Code\) now; the notes stay as they are/)
  assert.doesNotMatch(codexNotes.text, /now marked "with agent"/)
  assert.deepEqual(await noteStatus(), ['open', 'open'], 'no note went "with agent" for the agent that does not work on the project')

  // A2: Codex's first wait is told at once whose the project is.
  const t0 = Date.now()
  const told = await codex.call('wait', { seconds: 30 })
  assert.match(told.text, WITH_CLAUDE)
  assert.ok(Date.now() - t0 < 5000, `at once the first time (${Date.now() - t0} ms)`)
  // Its next wait waits. The user types a task meanwhile: not handed to Codex.
  const t1 = Date.now()
  const codexWait = codex.call('wait', { seconds: 8 })
  await c.sleep(600)
  await c.click('inspector.tab.agent')
  assert.equal(await c.attr('agent.wait', 'data-state'), 'not-waiting', 'Codex waits, but a send would not reach it: the tab does not say "waiting for you"')
  await say('make the intro shorter')
  await c.waitFor('the box says it is in line (not taken by the agent that waits)', async () => (await c.attr('agent.box.status', 'data-state')) === 'queued')
  // The user rejects Claude Code's draft with a word, while only Codex waits.
  await c.waitId('agent.draft')
  // (D22, worker C: "reject and say why" is in the review strip's menu.)
  await c.click('agent.draft.more')
  await c.click('agent.draft.rejectWhy')
  await c.fill('agent.draft.why', 'too long')
  await c.click('agent.draft.whyReject')
  await c.waitFor('the draft is gone', async () => !(await c.ev('!!window.__agent.store.getState().draft')))
  const codexGot = await codexWait
  assert.match(codexGot.text, WITH_CLAUDE, 'after its whole time, the same words')
  assert.doesNotMatch(codexGot.text, /REJECTED|Task:/)
  assert.ok(Date.now() - t1 >= 7000, `the second wait waited its time (${Date.now() - t1} ms)`)
  // Claude Code's next wait gets both, at once.
  const got = await claude.call('wait', { seconds: 20 })
  assert.match(got.text, /^Task: "make the intro shorter"$/m)
  assert.match(got.text, /^The user REJECTED your draft\. In their words: "too long"$/m)

  // Claude Code takes the notes: they are its.
  const claudeNotes = await claude.call('notes')
  assert.match(claudeNotes.text, /2 of these are now marked "with agent"/)
  assert.deepEqual(await noteStatus(), ['agent', 'agent'])

  // K5: eight later sessions under Claude Code's name (every `claude`
  // started, every "check the connection") while the one that works is in
  // a wait: it is not the one that ends, and gets what is sent.
  const working = claude.call('wait', { seconds: 30 })
  await c.sleep(400)
  for (let i = 0; i < 8; i++) await connectAgent({ c, app, assert, client: 'claude-code' })
  await say('still here?')
  assert.match((await working).text, /^Task: "still here\?"$/m, 'the session that works was not ended by eight later ones')
  const after = await claude.rpc('tools/call', { name: 'project', arguments: {} })
  assert.equal(after.status, 200, 'its session is still known to the server')

  // Handed over: what is in line then goes to the new agent.
  await claude.call('edit', { ops: [{ op: 'clip.setVolume', clipId: clips[0].id, volume: 0.5 }], base: versionOf((await claude.call('project')).text) })
  await codex.call('edit', { ops: [{ op: 'marker.add', time: 6 }], base: versionOf((await codex.call('project')).text) }, { allowError: true })
  await say('add a title at the start')
  await c.waitId('agent.agents.asked.codex-mcp-client')
  await c.click('agent.agents.switch.codex-mcp-client')
  await c.waitId('agent.handover.ask')
  await c.click('agent.handover.reject')
  await c.waitFor('handed over', () => c.ev(`(document.querySelector('[data-testid="agent.agents.holder"]')?.textContent ?? '').includes('Codex')`))
  const now = await codex.call('wait', { seconds: 20 })
  assert.match(now.text, /^Task: "add a title at the start"$/m, 'the task in line went to the agent the project was handed to')
  assert.doesNotMatch(now.text, /REJECTED/, 'the answer on Claude Code\'s draft is not Codex\'s')
  const old = await claude.call('wait', { seconds: 5 }, { allowError: true })
  assert.ok(old.isError)
  assert.match(old.text, /The user handed the project to another agent \(Codex\)/)
  await c.run(() => window.__agent.reject())
}
