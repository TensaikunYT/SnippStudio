// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// D22, worker C (YOL-HARITASI.md 1.1, 1.2, 1.5; the audit's A7, A11, A12,
// L5): what the agent does is seen without asking it. A scripted agent over
// real HTTP works straight on the timeline:
//   - the agent bar under the timeline's toolbar says each call in a
//     sentence (the project, the transcript with its range, frames, an
//     edit in the user's words), with the time, the steps and the tokens
//     the app sent; it is 30 high and inside the window at 1366 × 768 too;
//   - the top bar has ONE chip (the program's name and a state), no red
//     "error" chip after a refused call;
//   - the flag on the ruler stands at the start of the stretch touched last
//     (reading, looking, writing); the trail under the ruler holds what was
//     read (faint) and written (solid); the clip the agent changed is framed;
//   - all of it is there with motion off (still), and the flag slides with
//     motion on;
//   - "working" ends a few seconds after the last call (no 120 s counter);
//     "Done" comes when the agent waits, and stays until it is closed;
//   - Stop: the agent's next call is told the user stopped it;
//   - the agent's colour is its program's (Codex: silver);
//   - "Working on this project": the connected programs; picking the other
//     one hands the project over (a waiting draft is decided first), and the
//     new agent hears it.
import { connectAgent, versionOf } from '../agent-client.mjs'
export const name = 'agent-d22-bar-flag-trail'
export const timeoutMs = 200_000

const build = (ids) => {
  const S = window.__store
  const p = structuredClone(S.getState().project)
  const T = { x: p.settings.width / 2, y: p.settings.height / 2, scale: 1, rotation: 0 }
  p.tracks = [
    { id: 'V2', kind: 'video', name: 'V2', clipIds: ['pic'] },
    { id: 'V1', kind: 'video', name: 'V1', clipIds: ['a'] },
    { id: 'A1', kind: 'audio', name: 'A1', clipIds: ['as'] }
  ]
  const clip = (id, assetId, trackId, start, inPoint, duration, extra = {}) => ({ id, assetId, trackId, start, inPoint, duration, transform: { ...T }, volume: 1, ...extra })
  p.clips = {
    a: clip('a', ids.talk, 'V1', 0, 0, 12, { linkId: 'L1', audioExtracted: true }),
    as: clip('as', ids.talk, 'A1', 0, 0, 12, { linkId: 'L1' }),
    pic: clip('pic', ids.pic, 'V2', 5, 0, 4)
  }
  p.captions = [{ id: 'S1', start: 0.5, end: 2.5, text: 'hello there' }]
  p.markers = []
  S.getState().setPlaying(false)
  S.getState().loadProject(p)
  S.setState({ selectedClipIds: [], pxPerSec: 60 })
}

/** The bar, the chip, the flag and the trail as they are on screen. */
const seen = () => {
  const q = (id) => document.querySelector(`[data-testid="${id}"]`)
  const bar = q('agent.bar')
  const r = bar?.getBoundingClientRect()
  const flag = q('agent.flag')
  const ruler = q('timeline.ruler').getBoundingClientRect()
  const px = window.__store.getState().pxPerSec
  const scroll = q('timeline.scroll')
  return {
    bar: bar ? { phase: bar.dataset.phase, what: q('agent.bar.what')?.textContent, who: q('agent.bar.who')?.textContent, steps: q('agent.bar.steps')?.textContent, tokens: q('agent.bar.tokens')?.textContent, time: q('agent.bar.time')?.textContent, height: r.height, inside: r.left >= 0 && r.right <= window.innerWidth && [...bar.children].every((e) => e.getBoundingClientRect().right <= r.right + 0.5), stop: !!q('agent.bar.stop'), close: !!q('agent.bar.close') } : null,
    chips: document.querySelectorAll('[data-testid="agent.chip"]').length,
    chip: q('agent.activity')?.dataset.state ?? null,
    chipText: q('agent.chip.name')?.textContent ?? null,
    oldChips: ['agent.top.draft', 'agent.chip.error'].filter((id) => !!q(id)),
    flag: flag ? { doing: flag.dataset.doing, at: Number(flag.dataset.at), x: (flag.getBoundingClientRect().left - ruler.left + scroll.scrollLeft - 110) / px, height: flag.getBoundingClientRect().height, text: flag.textContent, moves: getComputedStyle(flag).transitionDuration } : null,
    trail: [...document.querySelectorAll('[data-testid="agent.trail.part"]')].map((e) => ({ wrote: e.dataset.wrote === 'yes', from: Number(e.dataset.from), to: Number(e.dataset.to), h: e.getBoundingClientRect().height, opacity: Number(getComputedStyle(e).opacity) })),
    touched: [...document.querySelectorAll('[data-testid="agent.touched"]')].map((e) => e.dataset.clip),
    program: document.documentElement.dataset.agentProgram ?? null,
    colour: getComputedStyle(document.documentElement).getPropertyValue('--agent').trim(),
    dot: bar ? getComputedStyle(bar.querySelector('.agent-dot'), '::after').animationName : null,
    root: [document.documentElement.scrollTop, document.documentElement.scrollHeight - document.documentElement.clientHeight]
  }
}

export async function run({ c, app, media, lib }) {
  const { assert } = lib
  await c.waitFor('the agent host', () => c.ev('!!window.__agent'))
  if ((await c.attr('agent.switch', 'aria-checked')) !== 'true') await lib.topBarSwitch(c)
  await c.waitFor('the agent server listening', async () => { try { await fetch(`http://127.0.0.1:${app.agentPort}/mcp`, { method: 'POST' }); return true } catch { return false } }, 15_000)
  const [talk, pic] = await lib.seedAssets(app, c, [media.talk, media.broll[0]])
  await c.run(build, { talk: talk.id, pic: pic.id })
  await c.run(() => window.__agent.setMode('direct'))
  try {
    // (This machine's system setting may ask for less motion: the scenario says which it tests.)
    await c.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }] })
    // No agent yet: no bar, no chip, no room taken.
    let s = await c.run(seen)
    assert.deepEqual([s.bar, s.chips, s.flag, s.trail.length], [null, 0, null, 0], 'nothing of the agent before it connects')
    const lanesTop0 = await c.ev(`document.querySelector('.tl-track').getBoundingClientRect().top`)

    const claude = await connectAgent({ c, app, assert, client: 'claude-code' })
    // ---- reading the project
    const p = await claude.call('project')
    await c.waitId('agent.bar')
    s = await c.run(seen)
    assert.equal(s.bar.who, 'Claude Code')
    assert.equal(s.bar.what, 'Looking at the project')
    assert.equal(s.bar.phase, 'working')
    assert.equal(s.bar.steps, '1 step')
    assert.match(s.bar.tokens, /^≈ \d+(\.\d)?k? tokens$/)
    assert.equal(s.bar.height, 30)
    assert.ok(s.bar.stop && !s.bar.close)
    assert.deepEqual([s.chips, s.chip, s.chipText, s.oldChips], [1, 'working', 'Claude Code', []], 'one chip in the top bar: the name and a state')
    assert.deepEqual([s.program, s.colour.toUpperCase()], ['claude', '#F08A3C'])
    assert.deepEqual([s.flag.doing, s.flag.at, s.flag.height], ['read', 0, 18])
    assert.ok(s.trail.length === 1 && !s.trail[0].wrote && s.trail[0].from === 0 && s.trail[0].to >= 12 && s.trail[0].h === 4 && s.trail[0].opacity < 0.5, `the trail: the whole film, faint (${JSON.stringify(s.trail)})`)
    // ---- the transcript of a range, then frames
    await claude.call('transcript', { start: 2, end: 8 })
    s = await c.run(seen)
    assert.equal(s.bar.what, 'Reading the transcript · 0:02–0:08')
    assert.deepEqual([s.flag.doing, s.flag.at, s.bar.steps], ['read', 2, '2 steps'])
    await claude.call('frames', { times: [9, 10] })
    // (With motion on the flag slides to its place: measured when it has arrived.)
    await c.waitFor('the flag at 9 s', async () => Math.abs(((await c.run(seen)).flag?.x ?? -1) - 9) < 0.1, 4000)
    s = await c.run(seen)
    assert.equal(s.bar.what, 'Looking at 2 frames · 0:09')
    assert.deepEqual([s.flag.doing, s.flag.at], ['look', 9])
    assert.ok(Math.abs(s.flag.x - 9) < 0.1, `the flag stands at 9 s on the ruler (${s.flag.x})`)
    assert.notEqual(s.flag.moves, '0s', 'with motion on the flag slides to its next place')
    // ---- an edit straight on the timeline: said in the user's words; written on the trail; the clip framed
    const wrote = await claude.call('edit', { ops: [{ op: 'clip.move', clipId: 'pic', by: 3 }], base: versionOf(p.text) })
    assert.match(wrote.text, /^Applied \(one undo step\)/)
    await c.waitFor('the edit is said', async () => /^Changed: /.test((await c.run(seen)).bar?.what ?? ''))
    s = await c.run(seen)
    assert.equal(s.bar.what, 'Changed: bridge.png moves 3 s later (0:05 → 0:08)')
    assert.deepEqual([s.flag.doing, s.flag.at, s.bar.steps], ['write', 8, '4 steps'])
    assert.ok(s.trail.some((t) => t.wrote && t.from === 8 && t.to === 12 && t.opacity === 1), `the trail: 8–12 written, solid (${JSON.stringify(s.trail)})`)
    assert.deepEqual(s.touched, ['pic'], 'the clip the agent changed is framed')
    // Said once: in the bar. No toast, no label on the lanes; the Undo the toast spoke of is the bar's.
    const twice = await c.run(() => ({ toast: [...document.querySelectorAll('.ui-toast')].filter((e) => /bridge\.png moves/.test(e.innerText)).length, label: !!document.querySelector('[data-testid="agent.flash.label"]'), glow: !!document.querySelector('[data-testid="agent.flash"]') }))
    assert.deepEqual(twice, { toast: 0, label: false, glow: true }, 'the change is said once (the bar); the changed clip still glows')
    await c.click('agent.bar.undo')
    await c.waitFor('taken back', () => c.st((st) => st.project.clips.pic.start === 5))
    assert.equal((await c.run(seen)).bar.what, 'The agent’s last change was taken back')
    assert.equal(await c.has('agent.bar.undo'), false, 'nothing more to take back')
    await c.st((st) => st.redo())
    await c.waitFor('brought again', () => c.st((st) => st.project.clips.pic.start === 8))
    await c.waitFor('the bar says the change again', async () => (await c.run(seen)).bar.what === 'Changed: bridge.png moves 3 s later (0:05 → 0:08)')
    assert.equal(s.dot, 'agent-halo', 'while it works the dot pulses')
    assert.deepEqual(s.root, [0, 0])
    const lanesTop1 = await c.ev(`document.querySelector('.tl-track').getBoundingClientRect().top`)
    console.log(`     the agent's line and trail take ${lanesTop1 - lanesTop0} px over the lanes`)

    // ---- the same with motion off, in Turkish, at 1366 × 768: all there, still
    await c.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] })
    await c.send('Emulation.setDeviceMetricsOverride', { width: 1366, height: 768, deviceScaleFactor: 1, mobile: false })
    await c.st((st) => st.setUiLang('tr'))
    await c.sleep(400)
    s = await c.run(seen)
    assert.ok(s.bar && s.bar.inside && s.bar.height === 30, `1366: the bar is whole and inside the window (${JSON.stringify(s.bar)})`)
    // (What the edit changed was said when it was made, in the language of that moment.)
    assert.match(s.bar.what, /^Değiştirdi: bridge\.png /)
    assert.match(s.bar.steps, /^4 adım$/)
    assert.ok(s.flag && s.trail.length >= 2 && s.touched.length === 1, 'motion off: the flag, the trail and the frame are still there')
    assert.equal(s.flag.moves, '0s', 'motion off: the flag jumps')
    assert.notEqual(s.dot, 'agent-halo', 'motion off: the dot is still')
    assert.deepEqual(s.root, [0, 0])
    await c.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }] })
    await c.send('Emulation.setDeviceMetricsOverride', { width: 1920, height: 1080, deviceScaleFactor: 1, mobile: false })
    await c.st((st) => st.setUiLang('en'))

    // ---- a refused call is no red chip; the bar says it in a sentence
    const bad = await claude.call('edit', { ops: [{ op: 'no.such.operation' }], base: versionOf((await claude.call('project')).text) }, { allowError: true })
    assert.ok(bad.isError)
    s = await c.run(seen)
    assert.deepEqual(s.oldChips, [], 'no "Agent: error" chip')
    assert.equal(s.bar.what, 'The agent is trying again: its last step did not go through')

    // ---- done: the agent waits; it stays until closed
    const waiting = claude.call('wait', { seconds: 20 })
    await c.waitFor('done', async () => (await c.run(seen)).bar?.phase === 'done')
    s = await c.run(seen)
    assert.equal(s.bar.what, 'Done · 1 change')
    assert.ok(s.bar.close && !s.bar.stop)
    assert.equal(s.chip, 'waiting')
    assert.match(s.bar.steps, /^6 steps$/)
    await c.sleep(1500)
    assert.equal((await c.run(seen)).bar?.phase, 'done', 'done stays')
    assert.ok((await c.run(seen)).flag, 'the flag stays where the agent worked last')
    await c.click('agent.bar.close')
    await c.waitGone('agent.bar')
    s = await c.run(seen)
    assert.equal(s.flag, null, 'closed: the flag goes with the bar')
    assert.ok(s.trail.length >= 2, 'the trail stays until the next job')
    assert.equal(s.chips, 1, 'the agent is still connected: its chip stays')
    // The user sends a job: the agent takes it, calls again: the bar is back.
    await c.click('inspector.tab.agent')
    if ((await c.attr('agent.box', 'data-folded')) === 'true') await c.click('agent.box.open')
    await c.fill('agent.box.text', 'make the intro shorter')
    await c.click('agent.box.send')
    assert.match((await waiting).text, /^Task: "make the intro shorter"$/m)
    await c.waitId('agent.bar')
    assert.equal((await c.run(seen)).bar.what, 'Took what you sent')
    const p2 = await claude.call('project')
    s = await c.run(seen)
    assert.deepEqual([s.bar.what, s.bar.steps, s.bar.phase], ['Looking at the project', '1 step', 'working'], 'a new job: its own steps')
    assert.ok(s.trail.every((t) => !t.wrote), 'the trail is the new job\'s')

    // ---- Stop: the agent's next call is told
    await c.click('agent.bar.stop')
    await c.waitFor('stopped', async () => (await c.run(seen)).bar?.phase === 'stopped')
    const stopped = await claude.call('transcript', {}, { allowError: true })
    assert.ok(stopped.isError)
    assert.match(stopped.text, /^The user pressed Stop in .+: stop working on this now and ask them what to do next\. This call was not run\.$/)
    const next = await claude.call('transcript', {})
    assert.ok(!next.isError, 'told once: the call after it runs')
    // Stopped again, and the bar closed while it says so: it goes at once.
    await c.click('agent.bar.stop')
    await c.waitFor('stopped', async () => (await c.run(seen)).bar?.phase === 'stopped')
    await c.click('agent.bar.close')
    await c.waitGone('agent.bar')
    assert.match((await claude.call('project', {}, { allowError: true })).text, /^The user pressed Stop/)
    await claude.call('project')
    await c.waitId('agent.bar')

    // ---- another program: its own colour; the selector; the hand-over
    await c.run(() => window.__agent.setMode('draft'))
    await claude.call('edit', { ops: [{ op: 'marker.add', time: 3 }], base: versionOf((await claude.call('project')).text) })
    await c.waitId('agent.draft')
    const codex = await connectAgent({ c, app, assert, client: 'codex-mcp-client' })
    await codex.call('project')
    await c.waitId('agent.agents.working')
    const options = await c.run(() => [...document.querySelector('[data-testid="agent.agents.working"]').options].map((o) => [o.value, o.textContent]))
    assert.deepEqual(options.map((o) => o[0]), ['claude-code', 'codex-mcp-client'])
    assert.match(options[0][1], /^Claude Code · connected at \d\d:\d\d$/)
    assert.match(options[1][1], /^Codex · connected at \d\d:\d\d$/)
    assert.equal(await c.value('agent.agents.working'), 'claude-code')
    // Picking Codex while Claude Code's draft waits: decided first.
    await c.run(() => { const el = document.querySelector('[data-testid="agent.agents.working"]'); const set = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set; set.call(el, 'codex-mcp-client'); el.dispatchEvent(new Event('change', { bubbles: true })) })
    await c.waitId('agent.handover.ask')
    assert.equal((await c.run(() => window.__agent.holder())).holder?.client, 'claude-code', 'not handed over before the draft is decided')
    await c.click('agent.handover.reject')
    await c.waitGone('agent.draft')
    await c.waitFor('handed over', async () => (await c.run(() => window.__agent.holder())).holder?.client === 'codex-mcp-client')
    assert.equal((await c.run(() => window.__agent.holder())).chosen, 'codex-mcp-client')
    // The new agent hears it; the old one is told on its next change.
    const heard = await codex.call('wait', { seconds: 10 })
    assert.match(heard.text, /^The user handed this project to you: you may change it now\./m)
    const told = await claude.call('edit', { ops: [{ op: 'marker.add', time: 5 }], base: versionOf((await claude.call('project', {}, { allowError: true })).text) ?? 'x-1' }, { allowError: true })
    assert.match(told.text, /handed the project to another agent \(Codex\)/)
    // Codex works: its colour, its name.
    await codex.call('transcript', { start: 0, end: 4 })
    await c.waitFor('the bar is Codex', async () => (await c.run(seen)).bar?.who === 'Codex')
    s = await c.run(seen)
    assert.deepEqual([s.program, s.colour.toUpperCase(), s.chipText], ['codex', '#DDE2EA', 'Codex'])
    assert.equal(s.flag.text, 'Codex')
    assert.deepEqual(s.root, [0, 0])
  } finally {
    await c.send('Emulation.setEmulatedMedia', { features: [] }).catch(() => null)
    await c.send('Emulation.setDeviceMetricsOverride', { width: 1920, height: 1080, deviceScaleFactor: 1, mobile: false })
    await c.st((st) => st.setUiLang('en')).catch(() => null)
    await c.run(() => { window.__agent.reject(); window.__agent.choose(null); window.__agent.setMode('draft') }).catch(() => null)
  }
}
