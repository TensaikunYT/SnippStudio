// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// GONDER2-PLAN.md: a send to an agent that is not waiting stays in line and
// its line offers Copy; Copy puts the plain text for the agent's chat on the
// clipboard and takes it out of the line (the next wait brings nothing). A
// send to an agent whose wait is open: "was waiting: it has it". The chip's
// phases in its words: Working, Quiet, Waiting for you, Awaits your reply,
// Draft ready. What goes to the agent is unchanged (the definitions' size).
// With GONDER2_SHOTS=<folder>: pictures at 1366×768 and 1920×1080, English
// and Turkish.
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { versionOf } from '../agent-client.mjs'
import { outsideAgent, textOf } from '../session.mjs'
export const name = 'gonder2-copy'

const SHOTS = process.env.GONDER2_SHOTS || ''

export async function run({ c, app, media, lib }) {
  const { assert } = lib
  const clipboard = () => app.events().filter((e) => e.type === 'clipboard').at(-1)?.text
  const [talk] = await lib.seedAssets(app, c, [media.talk])
  await lib.seedTimeline(c, [talk.id])
  await c.waitFor('the agent host', () => c.ev('!!window.__agent'))
  await c.run(() => window.__agent.setMode('draft'))
  const ag = await outsideAgent({ c, app, assert, client: 'claude-code' })
  const phase = async () => c.attr('agent.chip', 'data-state')
  const said = async () => textOf(c, 'agent.chip.state')
  const shots = async (tag, crop = false) => {
    if (!SHOTS) return
    mkdirSync(SHOTS, { recursive: true })
    for (const lang of ['en', 'tr']) {
      // (A toast keeps the language it was said in: none in the Turkish pictures.)
      if (lang === 'tr') await c.run(() => document.querySelectorAll('[data-testid^="toast."][data-testid$=".dismiss"]').forEach((b) => b.click()))
      await c.run((l) => window.__store.getState().setUiLang(l), lang)
      for (const [w, h] of [[1366, 768], [1920, 1080]]) {
        await c.send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: false })
        await c.sleep(350)
        await c.shot(join(SHOTS, `${tag}-${w}-${lang}.png`))
        if (crop && w === 1366) {
          const b = await c.box('agent.chip')
          const r = await c.capture({ format: 'png', clip: { x: b.x - 12, y: b.y - 8, width: b.w + 24, height: b.h + 16, scale: 3 } })
          const { writeFileSync } = await import('node:fs')
          writeFileSync(join(SHOTS, `chip-${tag}-${lang}.png`), Buffer.from(r.data, 'base64'))
        }
      }
    }
    await c.run(() => window.__store.getState().setUiLang('en'))
    await c.send('Emulation.setDeviceMetricsOverride', { width: 1920, height: 1080, deviceScaleFactor: 1, mobile: false })
  }

  // 1. A call: the chip says Working, its ring turns.
  const p = await ag.call('project')
  await c.waitFor('working', async () => (await phase()) === 'working', 8000)
  assert.equal(await said(), 'Working')
  assert.match(await textOf(c, 'agent.chip.name'), /^Claude Code/)
  assert.equal(await c.ev(`!!document.querySelector('[data-testid="agent.chip"] .agent-pill-ring.is-live')`), true)
  assert.equal(await c.ev(`document.querySelector('[data-testid="agent.chip"] [data-mark]')?.dataset.mark`), 'claude')
  await shots('working', true)
  // Quiet a few seconds after its last call.
  await c.waitFor('quiet', async () => (await phase()) === 'quiet', 15000)
  assert.equal(await said(), 'Quiet')
  await shots('quiet', true)

  // 2. A job sent while nobody waits: in line, Copy; Copy takes it out of the line.
  if ((await c.attr('agent.box', 'data-folded')) === 'true') await c.click('agent.box.open')
  await c.fill('agent.box.text', 'tighten the intro')
  await c.click('agent.box.send')
  await c.waitFor('in line', async () => (await c.attr('agent.box.status', 'data-state')) === 'queued')
  assert.equal(await textOf(c, 'agent.box.status.text'), 'In line · paste it into the chat')
  await shots('box-queued')
  await c.click('agent.box.status.copy')
  await c.waitFor('copied', async () => (await c.attr('agent.box.status', 'data-state')) === 'copied')
  assert.equal(clipboard(), ['A job from SnippStudio: "tighten the intro"', `(In the project "${await c.st((s) => s.project.name)}" open in SnippStudio.)`].join('\n'))
  const none = await ag.call('wait', { seconds: 5 })
  assert.equal(none.text, 'Nothing from the user yet; call wait again.', 'the copied job is not delivered again')

  // 3. Notes sent while nobody waits: the line under the button, and Copy.
  // (After the wait's short grace: the chip no longer says "waiting".)
  await c.waitFor('not waiting', async () => (await phase()) !== 'waiting', 8000)
  await c.run(() => {
    const s = window.__store.getState()
    s.startNoteDraft({ start: 1, end: 2 })
    s.patchNoteDraft({ text: 'shorter here', kind: 'fix' })
    s.saveNoteDraft()
  })
  await c.click('inspector.tab.notes')
  await c.click('notes.send')
  await c.waitFor('the notes line says in line', async () => (await c.attr('notes.sendLine', 'data-state')) === 'queued')
  // (The command box folded, for the panel's room in the pictures.)
  if (SHOTS && (await c.has('agent.box.collapse'))) await c.click('agent.box.collapse')
  await shots('notes-queued')
  await c.click('notes.sendLine.copy')
  await c.waitFor('notes copied', async () => (await c.attr('notes.sendLine', 'data-state')) === 'copied')
  assert.equal(clipboard().split('\n').slice(0, 2).join('\n'), '1 work note from SnippStudio:\n#1 · 0:01.0–0:02.0 · Fix · "shorter here"')
  assert.doesNotMatch(clipboard(), /token|127\.0\.0\.1|Bearer/i)
  // The always-there copy (nothing sent).
  await c.click('notes.copyText')
  await c.waitFor('copied by the button', async () => /#1 · 0:01\.0–0:02\.0/.test(clipboard() ?? ''))
  // Watch mode: its line and its copy button.
  await c.click('topbar.watch')
  await c.waitId('watch.copyText')
  assert.equal(await c.attr('watch.sendLine', 'data-state'), 'copied')
  await shots('watch')
  await c.click('topbar.watch')

  // 4. The wait is open: the chip says Waiting for you; a job reaches it at once.
  const open = ag.call('wait', { seconds: 60 })
  await c.waitFor('waiting for you', async () => (await phase()) === 'waiting', 8000)
  assert.equal(await said(), 'Waiting for you')
  await shots('waiting', true)
  await c.click('inspector.tab.agent')
  if ((await c.attr('agent.box', 'data-folded')) === 'true') await c.click('agent.box.open')
  await c.fill('agent.box.text', 'add a title')
  await c.click('agent.box.send')
  const got = await open
  assert.match(got.text, /^Task: "add a title"$/m)
  assert.match(got.text, /When done, call wait again\.$/, 'the answer is as it was')
  await c.waitFor('taken', async () => (await c.attr('agent.box.status', 'data-state')) === 'taken')
  await shots('box-taken')
  // 5. A minute after its last call, no wait: it awaits the user's reply in
  // its chat. (The page's clock is moved on before the chip's next timer.)
  await c.run(() => {
    const real = Date.now
    window.__realNow = real
    Date.now = () => real() + 70_000
  })
  await c.waitFor('taken', async () => (await c.attr('agent.box.status', 'data-state')) === 'taken')
  assert.equal(await textOf(c, 'agent.box.status.text'), 'Claude Code was waiting: it has it')
  await c.waitFor('awaits your reply', async () => (await phase()) === 'reply', 15000)
  assert.equal(await said(), 'Awaits your reply')
  assert.equal(await c.attr('agent.bar.phase', 'data-state'), 'reply')
  assert.equal(await textOf(c, 'agent.bar.phase'), 'Awaits your reply in the chat')
  // A send now stays in line; the bar offers Copy too.
  await c.fill('agent.box.text', 'one more thing')
  await c.click('agent.box.send')
  await c.waitFor('in line again', async () => (await c.attr('agent.box.status', 'data-state')) === 'queued')
  await c.waitId('agent.bar.sendLine.copy')
  await c.run(() => {
    Date.now = window.__realNow
  })
  await shots('reply', true)

  // 6. A draft: Draft ready. The next wait takes the job in line.
  const later = await ag.call('wait', { seconds: 10 })
  assert.match(later.text, /^Task: "one more thing"$/m)
  await ag.call('edit', { ops: [{ op: 'text.add', time: 0.5, text: 'Agent title' }], base: versionOf(p.text) })
  await c.waitFor('draft ready', async () => (await phase()) === 'draft', 15000)
  assert.equal(await said(), 'Draft ready')
  await shots('draft', true)
}
