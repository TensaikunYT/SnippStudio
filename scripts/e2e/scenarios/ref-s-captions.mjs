// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// REF-AB, worker S (REF-AB-PLAN-S.md, item 10): the Captions page's style
// grid (each look a tile drawn in its look; a click is one undo step) and
// where the subtitles are made from (all, a track, a clip), with the
// warnings for muted and hidden tracks; silence blocks the run.
export const name = 'ref-s-captions'

export async function run({ c, app, media, lib }) {
  const { assert } = lib
  const [talk, other] = await lib.seedAssets(app, c, [media.talk, media.other])
  await lib.seedTimeline(c, [talk.id, other.id])
  await lib.openCards(c, ['Caption looks'])
  await lib.dockPage(c, 'captions')
  await c.waitId('captions.looks')

  // ---- the grid -----------------------------------------------------------------------------
  const tiles = await c.run(() => [...document.querySelectorAll('[data-testid^="captions.look."]')].map((e) => ({ id: e.dataset.testid, on: e.getAttribute('aria-pressed'), name: e.getAttribute('aria-label') })))
  assert.ok(tiles.length >= 10, `${tiles.length} looks`)
  assert.ok(tiles.every((x) => x.name), 'each named')
  assert.equal(tiles.find((x) => x.id === 'captions.look.plain').on, 'true', 'a new project wears Plain')
  // Each tile drew something (not an empty canvas).
  const drawn = await c.run(() => [...document.querySelectorAll('[data-testid^="captions.look."] canvas')].filter((cv) => {
    const g = cv.getContext('2d')
    const d = g.getImageData(0, 0, cv.width, cv.height).data
    for (let i = 3; i < d.length; i += 4) if (d[i] > 0) return true
    return false
  }).length)
  assert.equal(drawn, tiles.length, 'every tile drawn')
  const past = await c.st((s) => s.past.length)
  await c.click('captions.look.karaoke')
  await c.waitFor('karaoke worn', async () => (await c.attr('captions.look.karaoke', 'aria-pressed')) === 'true', 3000)
  const style = await c.st((s) => s.project.captionStyle)
  assert.equal(style.highlight?.enabled, true, 'the spoken word coloured')
  assert.equal(style.fontFamily, 'Archivo Black')
  assert.equal(await c.st((s) => s.past.length), past + 1, 'one undo step')
  assert.equal(await c.attr('captions.look.plain', 'aria-pressed'), 'false')
  await c.run(() => window.__store.getState().undo())
  await c.waitFor('plain again', async () => (await c.attr('captions.look.plain', 'aria-pressed')) === 'true', 3000)

  // ---- where from ---------------------------------------------------------------------------
  const opts = await c.run(() => [...document.querySelectorAll('[data-testid="captions.source"] option')].map((o) => o.value))
  const v1 = await c.st((s) => s.project.tracks.find((t) => t.kind === 'video').id)
  const clips = await c.st((s) => Object.keys(s.project.clips))
  assert.equal(opts[0], 'all')
  assert.ok(opts.includes(`track:${v1}`), 'the video track (its sound)')
  for (const id of clips) assert.ok(opts.includes(`clip:${id}`), `clip ${id}`)
  assert.equal(await c.has('captions.source.silent'), false)

  await c.select('captions.source', `clip:${clips[0]}`)
  assert.equal(await c.value('captions.source'), `clip:${clips[0]}`)
  // Hidden: the picture only; said, not blocked.
  await c.run((id) => { const s = window.__store.getState(); const p = structuredClone(s.project); p.tracks.find((t) => t.id === id).hidden = true; s.loadProject(p); return true }, v1)
  await c.waitId('captions.source.hidden', 3000)
  // Muted: nothing to hear from that clip; the run is blocked.
  await c.run((id) => { const s = window.__store.getState(); const p = structuredClone(s.project); p.tracks.find((t) => t.id === id).muted = true; s.loadProject(p); return true }, v1)
  await c.waitId('captions.source.silent', 3000)
  assert.equal(await c.attr('dock.captions.run', 'disabled'), '', 'no run on silence')
  // All the sound: the muted track is named.
  await c.select('captions.source', 'all')
  await c.waitId('captions.source.silent', 3000)
  await c.run((id) => { const s = window.__store.getState(); const p = structuredClone(s.project); p.tracks.find((t) => t.id === id).muted = false; const a = p.tracks.find((t) => t.kind === 'audio'); a.muted = true; s.loadProject(p); return true }, v1)
  await c.waitGone('captions.source.silent', 3000)
}
