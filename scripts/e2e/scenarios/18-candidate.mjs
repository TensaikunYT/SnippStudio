// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// A candidate project in the preview (window.__candidate, no UI yet): with
// an extra clip only it has, it is drawn and played; switched back to the live
// project while playing, the candidate's own clip stops at once. The store's
// project, history, version and "unsaved" mark never move.
import { previewSig, sigDiff } from './13-code-clip.mjs'
export const name = 'candidate-while-playing'

export async function run({ c, app, media, lib }) {
  const { assert } = lib
  const [talk, other] = await lib.seedAssets(app, c, [media.talk, media.other])
  await lib.seedTimeline(c, [talk.id])
  const fixed = async () => c.st((s) => JSON.stringify([s.project, s.past.length, s.future.length, s.projectVersion, s.dirty]))
  const before = await fixed()

  await lib.seek(c, 1)
  await c.sleep(800)
  const live = await previewSig(c)
  await c.run((otherId) => {
    const s = window.__store.getState()
    const p = structuredClone(s.project)
    p.tracks.unshift({ id: 'CV', kind: 'video', name: 'V2', clipIds: ['cand1'] })
    p.clips.cand1 = { id: 'cand1', assetId: otherId, trackId: 'CV', start: 0, inPoint: 0, duration: 6, transform: { x: 960, y: 540, scale: 3, rotation: 0 }, volume: 1 }
    window.__candidate.set(p, { show: true, baseVersion: s.projectVersion, epoch: s.versionEpoch })
  }, other.id)
  const cand = await c.waitFor('the candidate drawn', async () => { const s = await previewSig(c); return sigDiff(s, live) > 8 ? s : null }, 8000)
  assert.ok(cand)

  // Play the candidate: its own clip's element plays.
  await c.click('transport.play')
  await c.waitFor('the candidate clip playing', () => c.run(() => { const el = window.__engine.videos.get('cand1'); return !!el && !el.paused && el.currentTime > 0.2 }), 8000)
  // Back to the live project, still playing: the candidate's clip stops.
  const t0 = Date.now()
  await c.run(() => window.__candidate.show('live'))
  await c.waitFor('the candidate clip stopped', () => c.run(() => { const el = window.__engine.videos.get('cand1'); return !el || el.paused }), 3000, 20)
  const stopMs = Date.now() - t0
  assert.ok(stopMs < 600, `stopped within ${stopMs} ms`)
  assert.equal(await c.st((s) => s.playing), true, 'the live project goes on playing')
  await c.click('transport.play')
  await c.run(() => window.__candidate.clear())
  assert.equal(await fixed(), before, 'store project, history, version and dirty untouched')
}
