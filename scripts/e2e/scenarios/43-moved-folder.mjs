// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// Phase Ç2a.2, decision 3 (report P9, D6): a project saved in a folder with
// its media (here with Turkish letters in the name), the folder copied
// elsewhere and the original gone: it opens with no missing media (the paths
// relative to the project file, written with the save). Then the media moved
// to another folder: relinking one finds the rest in the same folder.
import { copyFileSync, cpSync, existsSync, mkdirSync, readFileSync, renameSync } from 'node:fs'
import { join } from 'node:path'
export const name = 'moved-project-folder'

/** A rename, tried again while a reader (a decoder of the app) still holds a file. */
async function renameRetry(from, to) {
  for (let i = 0; ; i++) {
    try {
      return renameSync(from, to)
    } catch (e) {
      if (i > 40) throw e
      await new Promise((r) => setTimeout(r, 250))
    }
  }
}

export async function run({ c, app, media, lib, work }) {
  const { assert } = lib
  const toast = (re) => c.run((src) => [...document.querySelectorAll('[data-testid^="toast."]')].map((e) => e.textContent ?? '').find((x) => new RegExp(src, 'i').test(x)) ?? null, re.source)
  const home = join(work, 'Proje Çekim ğüşiöç')
  mkdirSync(join(home, 'media'), { recursive: true })
  const talk = join(home, 'media', 'konuşma.mp4')
  const other = join(home, 'media', 'ara çekim.mp4')
  copyFileSync(media.talk, talk)
  copyFileSync(media.other, other)

  // Saved by the app, beside its media.
  const [a, b] = await lib.seedAssets(app, c, [talk, other])
  await lib.seedTimeline(c, [a.id, b.id])
  await c.st((s) => s.setProjectName('Taşınan'))
  const file = join(home, 'film.snipp')
  lib.answer(app, { kind: 'save', path: file })
  await c.click('timeline.scroll', { fx: 0.95, fy: 0.97 })
  await c.key('s', ['ctrl'])
  await c.waitFor('saved', async () => existsSync(file) && !(await c.st((s) => s.dirty)), 10000)
  const saved = JSON.parse(readFileSync(file, 'utf8'))
  assert.deepEqual(saved.assets.map((x) => x.relPath).sort(), ['media/ara çekim.mp4', 'media/konuşma.mp4'], 'the paths relative to the project file')

  // The folder copied elsewhere, the original gone.
  const moved = join(work, 'taşındı', 'Proje Çekim ğüşiöç')
  cpSync(home, moved, { recursive: true })
  await renameRetry(home, `${home} (eski)`)
  await c.st((s) => s.newProject('16:9'))
  lib.answer(app, { kind: 'open', paths: [join(moved, 'film.snipp')] })
  await c.click('topbar.file')
  await c.click('menu.file.open')
  await c.waitFor('the moved project', async () => (await c.st((s) => s.project.name)) === 'Taşınan', 15000)
  await c.sleep(300)
  const p = await c.st((s) => s.project)
  assert.equal(p.assets.filter((x) => x.missing).length, 0, '0 missing media')
  assert.deepEqual(p.assets.map((x) => x.path).sort(), [join(moved, 'media', 'ara çekim.mp4'), join(moved, 'media', 'konuşma.mp4')].sort(), 'the media where the project is now')
  assert.equal(await c.has('dialog.missing-media'), false, 'no missing-media dialog')

  // The media moved again, away from the project: one relinked, the rest found.
  const away = join(work, 'başka yer')
  await renameRetry(join(moved, 'media'), away)
  await c.st((s) => s.newProject('16:9'))
  lib.answer(app, { kind: 'open', paths: [join(moved, 'film.snipp')] })
  await c.click('topbar.file')
  await c.click('menu.file.open')
  await c.waitId('dialog.missing-media', 15000)
  lib.answer(app, { kind: 'open', paths: [join(away, 'konuşma.mp4')] })
  await c.click(`missing-media.locate.${a.id}`)
  await c.waitFor('both relinked', async () => (await c.st((s) => s.project.assets.filter((x) => x.missing).length)) === 0, 10000)
  assert.ok(await c.waitFor('the "found more" notice', () => toast(/found 1 more/), 5000))
  assert.deepEqual((await c.st((s) => s.project.assets.map((x) => x.path))).sort(), [join(away, 'ara çekim.mp4'), join(away, 'konuşma.mp4')].sort())
}
