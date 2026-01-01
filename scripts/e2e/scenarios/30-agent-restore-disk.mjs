// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// Phase 4A.8 (T10, G1, G2): the point before the agent, from DISK. A saved
// project, 100 direct edits by an agent, saved, the app closed; the next
// start opens the project, and the point is put back by its name from the
// profile (nothing of it in memory any more): the project is then, byte for
// byte, what it was before the agent. Then 7 agent sessions (initialize
// again) with one edit each: the point before the agent is still that state,
// and no session point piles up (the agent's own changes are not "the
// user's"). A point of another project is refused.
import { existsSync, mkdirSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { WORDED, captionsOf } from './04-text-edit.mjs'
import { connectAgent } from '../agent-client.mjs'
export const name = 'agent-restore-from-disk-after-relaunch'
export const freshWindow = true

const ops = (i, clip) => [
  { op: 'marker.add', time: (i % 11) + 0.25, note: `m${i}` },
  { op: 'text.add', time: (i % 9) + 0.5, text: `t${i}` },
  { op: 'clip.setVolume', clipId: clip, volume: 0.5 + (i % 7) / 10 },
  { op: 'clip.setOpacity', clipId: clip, opacity: 0.6 + (i % 4) / 10 },
  { op: 'timeline.cutRanges', ranges: [[0.02 * (i % 7), 0.02 * (i % 7) + 0.03]] }
][i % 5]

export async function run({ c, app, media, lib, relaunch }) {
  const { assert } = lib
  await c.waitFor('the agent host', () => c.ev('!!window.__agent'))
  const [talk] = await lib.seedAssets(app, c, [media.talk])
  await lib.seedTimeline(c, [talk.id])
  await c.run((caps) => { const s = window.__store.getState(); s.setSubtitles(caps); window.__agent.setMode('direct') }, captionsOf(WORDED))
  // Saved first: the point belongs to this file.
  // (A fresh window's profile: the runner's work folder was the old one's.)
  const work = join(app.profile, 'work-restore')
  mkdirSync(work, { recursive: true })
  const file = join(work, 'restore me.snipp')
  lib.answer(app, { kind: 'save', path: file })
  await c.click('timeline.scroll', { fx: 0.95, fy: 0.97 })
  await c.key('s', ['ctrl'])
  await c.waitFor(`saved (asked: ${JSON.stringify(lib.dialogsAsked(app))})`, async () => existsSync(file), 10000)
  await c.waitFor('not dirty', async () => !(await c.st((s) => s.dirty)), 10000)
  const before = await c.run(() => window.__agent.serialize())

  const ag = await connectAgent({ c, app, assert, client: 'restore-check' })
  for (let i = 0; i < 100; i++) {
    const clip = await c.st((s) => Object.values(s.project.clips).sort((a, b) => b.duration - a.duration)[0].id)
    // Each edit on a fresh read (phase 4A.9: base is required, and an edit
    // answer names no version).
    const v = /\bv ([0-9a-z]+-\d+)/.exec((await ag.call('project')).text)?.[1]
    const r = await ag.call('edit', { ops: [ops(i, clip)], base: v })
    assert.match(r.text, /^Applied \(one undo step\)/)
  }
  const points = await c.run(() => window.__agent.restorePoints())
  assert.equal(points.length, 1)
  assert.equal(points[0].kind, 'pre')
  const name = points[0].name
  const dir = join(app.profile, 'agent-restore')
  assert.equal(readFileSync(join(dir, name), 'utf8'), before, 'the point on disk is the project before the agent')
  // Saved with the 100 edits (quick save: no dialog), then the app closes.
  await c.click('timeline.scroll', { fx: 0.95, fy: 0.97 })
  await c.key('s', ['ctrl'])
  await c.waitFor('saved again', async () => !(await c.st((s) => s.dirty)), 10000)
  await c.ev('setTimeout(() => window.close(), 50), true')
  const code = await Promise.race([app.exited, new Promise((r) => setTimeout(() => r('timeout'), 15000))])
  assert.notEqual(code, 'timeout', 'the app quit')

  // The next start: the project opened; the point read from disk by its name.
  const app2 = await relaunch({ profile: app.profile })
  const c2 = app2.cdp
  await c2.waitFor('the agent host', () => c2.ev('!!window.__agent'))
  app2.answers.set([{ kind: 'open', paths: [file] }])
  await c2.click('topbar.file')
  await c2.click('menu.file.open')
  await c2.waitFor('the project opened', async () => (await c2.st((s) => (s.project.markers ?? []).length)) > 0, 15000)
  assert.notEqual(await c2.run(() => window.__agent.serialize()), before, 'opened with the agent\'s edits')
  assert.equal((await c2.run(() => window.__agent.restorePoints())).length, 0, 'nothing in memory after the restart')
  const r = await c2.run((n) => window.__agent.restore(n), name)
  assert.equal(r.same, true)
  assert.equal(await c2.run(() => window.__agent.serialize()), before, 'byte for byte the project before the agent')
  // Phase 4A.11 (P3): the app's save wrote a save id into the file, and the
  // profile keeps it as that file's last one (the open found the same).
  const saveId = JSON.parse(readFileSync(file, 'utf8')).saveId
  assert.match(saveId ?? '', /^s[0-9a-z]+$/)
  assert.ok(Object.values(JSON.parse(readFileSync(join(dir, 'saves.json'), 'utf8'))).includes(saveId), 'the profile knows the file by its save id')

  // 7 sessions, one edit each: the point before the agent stays that state.
  // (One agent program, seven sessions of it: since DENEME-2 one agent
  // changes a project at a time, and seven differently named ones were
  // refused from the second on. 22 Nov.)
  await c2.run(() => window.__agent.setMode('direct'))
  for (let k = 0; k < 7; k++) {
    const a = await connectAgent({ c: c2, app: app2, assert, client: 'again' })
    const p = await a.call('project')
    const base = /\bv ([0-9a-z]+-\d+)/.exec(p.text)?.[1]
    const e = await a.call('edit', { ops: [{ op: 'marker.add', time: 1 + k, note: `again${k}` }], base })
    assert.match(e.text, /^Applied/)
  }
  const after = await c2.run(() => window.__agent.restorePoints())
  assert.equal(after[0].kind, 'pre')
  assert.equal(after.length, 1, `no session point: only the agent changed the project (${JSON.stringify(after)})`)
  assert.equal(readFileSync(join(dir, after[0].name), 'utf8'), before, 'still the project before the agent')
  // On disk: this project keeps one point before the agent.
  const key = after[0].key
  // (A name carries the project's identity after its key since phase 4A.10: -pre-<key>.<identity>-.)
  assert.equal(readdirSync(dir).filter((f) => f.includes(`-pre-${key}-`) || f.includes(`-pre-${key}.`)).length, 1)
  // A point of another project is refused, and not applied.
  const live = await c2.run(() => window.__agent.serialize())
  const other = await c2.run(async () => { try { await window.__agent.restore('1700000000000-pre-f00000000-x-aaaaaa.snipp'); return 'applied' } catch (e) { return String(e.message) } })
  assert.match(other, /belongs to another project/)
  assert.equal(await c2.run(() => window.__agent.serialize()), live)
  await c2.run(() => window.__agent.setMode('draft'))
  console.log(`     restore point ${name} (${before.length} bytes): from disk after a restart, byte for byte; 7 sessions later still the same`)
}
