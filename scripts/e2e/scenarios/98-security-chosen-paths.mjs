// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// 22 November, K1 and K4 (D22-PLAN-B.md): "the user chose this file" cannot
// be said by the page.
//
// K4: a project or media file counts as dropped only when the bridge was
// handed the dropped File; a path as text registers nothing, so a script in
// the page cannot make any project file on the disk writable, renamable or
// binnable (it could: project:register-dropped took the path from the page).
// (A real drop still opens the project: scenario kliste-projects; and a real
// drop of a code clip's folder still brings it in: the end of this one.)
//
// K1: the save window makes writable the ONE file chosen in it. The files
// beside it under the same name (an export's other outputs) are no longer
// opened with it ("siblings": a tanitim.wav beside the chosen tanitim.mp4
// was written over with no question, and .snipp / .json / .txt could be
// named too). They are asked for with export:approve, which names the files
// already there instead of opening them, and knows export file types only.
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
export const name = 'security-chosen-paths'

export async function run({ c, app, lib, work, media }) {
  const { assert } = lib
  const dir = join(work, 'chosen')
  mkdirSync(dir, { recursive: true })

  // ---- K4: a path as text is not a drop ------------------------------------------------
  const a = join(dir, 'baska-proje.snipp'), b = join(dir, 'ikinci.snipp'), d = join(dir, 'ucuncu.autocut'), m = join(dir, 'ses.wav')
  const mine = JSON.stringify({ version: 1, name: 'the user\'s other project', clips: {}, tracks: [], assets: [] })
  for (const f of [a, b, d]) writeFileSync(f, mine)
  writeFileSync(m, 'RIFF')
  app.answers.set([])
  const dropped = await c.run(async (a, b, d, m) => {
    const r = {}
    r.project = await window.api.registerDroppedProject(a)
    r.save = await window.api.saveProjectDirect(a, '{"version":1,"name":"WRITTEN BY THE PAGE"}', true)
    await window.api.registerDroppedProject(b)
    r.rename = await window.api.renameProject(b, 'yeniad')
    await window.api.registerDroppedProject(d)
    r.trash = await window.api.trashProject(d)
    r.media = await window.api.registerDroppedMedia(m)
    r.folder = await window.api.registerDroppedFolder(a.replace(/[\\/][^\\/]*$/, ''))
    // A File a script made has no path either.
    r.made = await window.api.registerDroppedProject(new File(['{}'], 'baska-proje.snipp'))
    return r
  }, a, b, d, m)
  assert.equal(dropped.project, null, 'a path as text registers no project')
  assert.equal(dropped.made, null, 'nor does a File the page made')
  assert.equal(dropped.save.saved, false)
  assert.notEqual(dropped.rename?.ok, true)
  assert.notEqual(dropped.trash?.ok, true)
  assert.equal(dropped.media, null, 'a path as text registers no media')
  assert.equal(dropped.folder, null, 'nor a folder')
  for (const f of [a, b, d]) assert.equal(readFileSync(f, 'utf8'), mine, `${f} is as the user left it`)
  assert.deepEqual(readdirSync(dir).sort(), ['baska-proje.snipp', 'ikinci.snipp', 'ses.wav', 'ucuncu.autocut'])

  // ---- K1: the save window opens the chosen file, nothing beside it ---------------------
  const beside = { wav: 'USER NARRATION RECORDING (the only copy)', png: 'the user\'s picture', snipp: mine, txt: 'user notes', json: '{"user":"data"}' }
  for (const [ext, text] of Object.entries(beside)) writeFileSync(join(dir, `tanitim.${ext}`), text)
  const saveWindows = () => app.events().filter((e) => e.type === 'dialog' && e.kind === 'save').length
  const shown = saveWindows()
  app.answers.set([{ kind: 'save', path: join(dir, 'tanitim.mp4') }])
  const saved = await c.run(async () => {
    const chosen = await window.api.chooseSavePath({ defaultName: 'tanitim.mp4', filterName: 'MP4 video', extensions: ['mp4'], siblings: ['wav', 'png', 'snipp', 'txt', 'json'] })
    const stem = chosen.replace(/\.mp4$/, '')
    const bytes = new TextEncoder().encode('OVERWRITTEN BY THE PAGE')
    const r = { chosen: await window.api.writeChosenFile(chosen, bytes) }
    for (const ext of ['wav', 'png', 'snipp', 'txt', 'json']) r[ext] = await window.api.writeChosenFile(stem + '.' + ext, bytes)
    const place = chosen.replace(/[\\/][^\\/]*$/, '')
    // The window's way: the files already there come back named, not opened.
    r.ask = await window.api.exportPlace.approve(place, ['tanitim.wav', 'tanitim.png'])
    r.afterAsk = await window.api.writeChosenFile(stem + '.wav', bytes)
    // Not an export's file type: never, whatever the page says about replacing.
    r.project = await window.api.exportPlace.approve(place, ['tanitim.snipp'], true)
    r.text = await window.api.exportPlace.approve(place, ['tanitim.txt'], true)
    r.climb = await window.api.exportPlace.approve(place, ['..\\tanitim.wav'], true)
    return r
  })
  assert.equal(saved.chosen.saved, true, 'the chosen file is written')
  for (const ext of Object.keys(beside)) {
    assert.equal(saved[ext].saved, false, `tanitim.${ext} beside the chosen file is not writable`)
    assert.equal(readFileSync(join(dir, `tanitim.${ext}`), 'utf8'), beside[ext], `tanitim.${ext} is as the user left it`)
  }
  assert.equal(saved.ask.ok, false)
  assert.deepEqual(saved.ask.exists, ['tanitim.wav', 'tanitim.png'], 'the files already there are named')
  assert.equal(saved.afterAsk.saved, false, 'asking opened nothing')
  for (const k of ['project', 'text', 'climb']) assert.equal(saved[k].ok, false, `${k}: refused`)
  assert.equal(readFileSync(join(dir, 'tanitim.wav'), 'utf8'), beside.wav)
  assert.ok(existsSync(join(dir, 'tanitim.mp4')))
  assert.equal(saveWindows(), shown + 1, 'one save window was shown')

  // ---- a REAL drop still comes in: a code clip's folder dropped on the timeline -----------
  // (Its path is the one the bridge takes from the dropped File: codeFilm.registerDropped.)
  const films = () => c.st((s) => s.project.assets.filter((x) => x.kind === 'code').map((x) => x.path))
  assert.deepEqual(await films(), [])
  const box = await c.box('timeline.scroll')
  const drop = { items: [], files: [media.film], dragOperationsMask: 1 }
  for (const type of ['dragEnter', 'dragOver', 'drop']) await c.send('Input.dispatchDragEvent', { type, x: box.cx, y: box.cy, data: drop })
  await c.waitFor('the dropped folder came in as a code clip', async () => (await films()).length === 1, 15000)
  assert.equal((await films())[0].toLowerCase(), media.film.toLowerCase())
}
