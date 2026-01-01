// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// runBatch: three commands as one undo step, and a real Ctrl+Z takes all
// three back. adoptCandidate: a candidate made from the live project (a cut)
// becomes the project in one step; Ctrl+Z, then Ctrl+Shift+Z.
export const name = 'run-batch-and-adopt-candidate'

export async function run({ c, app, media, lib }) {
  const { assert } = lib
  const [talk] = await lib.seedAssets(app, c, [media.talk])
  await lib.seedTimeline(c, [talk.id])
  const start = await c.st((s) => JSON.stringify(s.project))
  const depth0 = await lib.undoDepth(c)
  const v0 = await c.st((s) => s.projectVersion)

  const ids = await c.run(() => window.__store.getState().runBatch([
    { name: 'marker.add', params: { time: 1 } },
    { name: 'marker.add', params: { time: 2 } },
    { name: 'track.add', params: { kind: 'audio' } }
  ]))
  assert.equal(ids.length, 3)
  assert.equal((await lib.undoDepth(c)) - depth0, 1, 'one step')
  assert.equal(await c.st((s) => (s.project.markers ?? []).length), 2)
  assert.ok((await c.st((s) => s.projectVersion)) > v0, 'a new version')
  await c.click('timeline.scroll', { fx: 0.95, fy: 0.97 })
  await c.key('z', ['ctrl'])
  await c.waitFor('all three undone', async () => (await c.st((s) => JSON.stringify(s.project))) === start)

  // A candidate: the live project with 3–5 s cut out (the command, pure).
  const made = await c.run(async () => {
    const s = window.__store.getState()
    const cmds = await window.__commands()
    const { project } = cmds.applyBatch(s.project, [{ name: 'timeline.cutRanges', params: { ranges: [[3, 5]] } }])
    return { baseVersion: s.projectVersion, epoch: s.versionEpoch, total: Object.values(project.clips).reduce((n, k) => n + k.duration, 0), project }
  })
  assert.ok(lib.near(made.total, 10, 0.001))
  const depth1 = await lib.undoDepth(c)
  await c.run((m) => window.__store.getState().adoptCandidate(m.project, { baseVersion: m.baseVersion, epoch: m.epoch, cuts: [[[3, 5]]] }), made)
  assert.equal((await lib.undoDepth(c)) - depth1, 1, 'adopted in one step')
  const total = await c.st((s) => Object.values(s.project.clips).reduce((n, k) => n + k.duration, 0))
  assert.ok(lib.near(total, 10, 0.001))
  // A stale candidate (made before the project changed) is refused.
  const refused = await c.run(async (m) => { try { window.__store.getState().adoptCandidate(m.project, { baseVersion: m.baseVersion, epoch: m.epoch }); return false } catch { return true } }, made)
  assert.ok(refused, 'a stale candidate is refused')
  await c.key('z', ['ctrl'])
  await c.waitFor('adoption undone', async () => (await c.st((s) => JSON.stringify(s.project))) === start)
  await c.key('z', ['ctrl', 'shift'])
  await c.waitFor('adoption redone', async () => lib.near(await c.st((s) => Object.values(s.project.clips).reduce((n, k) => n + k.duration, 0)), 10, 0.001))
}
