// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// Phase Ç2a.1, report P2: Alt+press on a clip and release without moving
// used to leave an invisible copy on top of it (doubled sound, drawn twice).
// Now the press makes nothing: no copy, no undo step. An Alt-drag still
// copies, as one step, and the model check (dev / e2e window) saw no broken
// rule through any of it.
export const name = 'alt-press-no-copy'

export async function run({ c, app, media, lib }) {
  const { assert } = lib
  const [talk, other] = await lib.seedAssets(app, c, [media.talk, media.other])
  await lib.seedTimeline(c, [talk.id, other.id])
  const start = await lib.clipList(c)
  assert.equal(start.length, 2)
  const depth0 = await lib.undoDepth(c)
  const problems0 = await c.run(() => (window.__modelProblems ?? []).length)

  // Alt+press and release on the first clip, no movement.
  await c.click(`timeline.clip.${start[0].id}`, { fx: 0.5, mods: ['alt'] })
  await c.sleep(300)
  const after = await lib.clipList(c)
  assert.equal(after.length, start.length, `no copy (${after.length} clips)`)
  assert.equal(await lib.undoDepth(c), depth0, 'no undo step')

  // An Alt-drag onto a new video track copies, as one step.
  await c.click('timeline.add-video-track')
  const v2 = await c.waitFor('a second video track', async () => {
    const tr = await c.st((s) => s.project.tracks.filter((x) => x.kind === 'video').map((x) => x.id))
    return tr.length === 2 ? tr.find((x) => x !== start[0].trackId) : null
  })
  const depth1 = await lib.undoDepth(c)
  const b = await c.box(`timeline.clip.${start[0].id}`)
  const row = await c.box(`timeline.track.${v2}`)
  await c.dragAt(b.x + 30, b.cy, b.x + 30, row.cy, { steps: 10, mods: ['alt'] })
  const copied = await c.waitFor('a copy on V2', async () => {
    const l = await lib.clipList(c)
    return l.length === start.length + 1 ? l : null
  })
  assert.ok(copied.some((k) => k.trackId === v2 && k.assetId === talk.id), 'the copy is on V2')
  assert.ok(copied.some((k) => k.id === start[0].id && k.trackId === start[0].trackId), 'the original stayed')
  assert.equal(await lib.undoDepth(c), depth1 + 1, 'one step')
  const problems = await c.run(() => window.__modelProblems ?? null)
  assert.ok(Array.isArray(problems), 'the model check is installed in an e2e window')
  assert.equal(problems.length, problems0, `no broken rule: ${JSON.stringify(problems.slice(problems0)).slice(0, 400)}`)
}
