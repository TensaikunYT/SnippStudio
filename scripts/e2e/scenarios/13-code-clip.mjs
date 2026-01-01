// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// A code clip: a film folder (index.html drawing any second) added from the
// media panel (the folder dialog answered), put on the timeline; its code is
// changed on disk and the paused preview redraws by itself.
import { cpSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
export const name = 'code-clip-live-refresh'

/** A small signature of the preview canvas (16×9 mean colours). */
export const previewSig = (c) =>
  c.run(() => {
    const cv = document.querySelector('[data-testid="preview.canvas"]')
    const o = new OffscreenCanvas(16, 9)
    const g = o.getContext('2d')
    g.drawImage(cv, 0, 0, 16, 9)
    return [...g.getImageData(0, 0, 16, 9).data]
  })
export const sigDiff = (a, b) => a.reduce((n, v, i) => n + Math.abs(v - b[i]), 0) / a.length

export async function run({ c, app, media, lib, work }) {
  const { assert } = lib
  const film = join(work, 'film-live')
  cpSync(media.film, film, { recursive: true })

  lib.answer(app, { kind: 'open', paths: [film] })
  await lib.dockPage(c, 'code')
  await c.click('media.code-film')
  const asset = await c.waitFor('the film in the project', () => c.st((s) => s.project.assets.find((a) => a.kind === 'code') ?? null), 15000)
  assert.ok(asset.duration > 0, `a length (${asset.duration})`)
  // (Arayüz v4: the film is added on the Code page; it is in the Media page.)
  await lib.dockPage(c, 'media')
  // The bin shows a film as its folder: opened with a double-click.
  if (asset.folder && !(await c.has(`media.item.${asset.id}`))) await c.click(`media.folder.${asset.folder}`, { double: true })
  await c.click(`media.item.${asset.id}.add`)
  const [clip] = await c.waitFor('a code clip', async () => { const l = await lib.clipList(c); return l.length ? l : null })
  assert.equal(clip.assetId, asset.id)

  await lib.seek(c, 1)
  // The film itself on the preview: its blue ground across the lower part.
  const row = 7 * 16 * 4 + 8 * 4
  const before = await c.waitFor('the film drawn in the preview', async () => { const s = await previewSig(c); return s[row + 2] > s[row] + 40 ? s : null }, 30000)
  // The film's code changes: its ground goes from blue to red.
  const html = join(film, 'index.html')
  writeFileSync(html, readFileSync(html, 'utf8').replace("g.fillStyle = '#2f6f8f'", "g.fillStyle = '#d02020'"))
  const after = await c.waitFor('the preview redrawn from the new code', async () => {
    const s = await previewSig(c)
    return sigDiff(s, before) > 4 ? s : null
  }, 15000)
  // The lower part of the frame turned red.
  assert.ok(after[row] > after[row + 2] + 60, `red below (${after.slice(row, row + 3)})`)
}
