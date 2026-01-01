// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// "Cila" part D (tarifler\CILA.md "D", done measure): a .cube LUT is an asset
// of the project.
//   import a .cube (the Inspector's button, the file chooser answered) → it is
//   the clip's LUT in one undo step → Ctrl+S (the file holds its path and the
//   same file relative to the project) → close → open → the SAME frame;
//   the file deleted → open: the Inspector says so and the clip is drawn
//   without it → the file back, "Look again": the same frame again;
//   the project folder moved whole → the LUT is found beside it.
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { makeFxMedia } from '../../qa/reference/make-fx-media.mjs'
export const name = 'lut-file-save-open-missing'
export const timeoutMs = 240_000

/** A 5³ table that swaps red and blue: a picture no one mistakes. */
function swapCube() {
  const n = 5
  const lines = ['TITLE "swap"', `LUT_3D_SIZE ${n}`]
  for (let b = 0; b < n; b++) for (let g = 0; g < n; g++) for (let r = 0; r < n; r++) lines.push(`${(b / (n - 1)).toFixed(6)} ${(g / (n - 1)).toFixed(6)} ${(r / (n - 1)).toFixed(6)}`)
  return lines.join('\n') + '\n'
}

/** The export's frame at 0.5 s, as a 320 x 180 signature (plain numbers, so
 *  it can be carried from one window to the next). */
const frame = (c) =>
  c.run(async () => {
    const ex = await window.__exporter()
    const png = await ex.exportFramePng(window.__store.getState().project, 0.5, false, 'final')
    const bmp = await createImageBitmap(new Blob([png]))
    const o = new OffscreenCanvas(320, 180)
    const g = o.getContext('2d')
    g.imageSmoothingQuality = 'high'
    g.drawImage(bmp, 0, 0, 320, 180)
    return [...g.getImageData(0, 0, 320, 180).data]
  })
/** The largest difference between two signatures (0..255). */
const apart = (a, b) => a.reduce((m, v, i) => Math.max(m, Math.abs(v - b[i])), 0)

async function showClip(c, id) {
  await c.run((open) => {
    const state = JSON.parse(localStorage.getItem('snipp-sections') ?? '{}')
    for (const s of open) state[s] = true
    localStorage.setItem('snipp-sections', JSON.stringify(state))
  }, ['Clip', 'Color', 'Effects'])
  await c.click(`timeline.clip.${id}`, { fx: 0.5 })
  await c.click('inspector.tab.subs')
  await c.click('inspector.tab.clip')
  await c.waitId('inspector.color.lutImport')
  await c.run(() => document.querySelector('[data-testid="inspector.color.lutImport"]')?.scrollIntoView({ block: 'center' }))
}

async function openFile(app, c, file, clips) {
  app.answers.set([{ kind: 'open', paths: [file] }])
  await c.click('topbar.file')
  await c.click('menu.file.open')
  await c.waitFor('the project opened', async () => (await c.st((s) => Object.keys(s.project.clips).length)) === clips && (await c.st((s) => s.project.luts?.length ?? 0)) === 1, 15000)
}

export async function run({ c, app, lib, work, relaunch }) {
  const { assert } = lib
  const proj = join(work, 'film')
  mkdirSync(join(proj, 'luts'), { recursive: true })
  const cube = join(proj, 'luts', 'swap.cube')
  writeFileSync(cube, swapCube())
  const [pic] = await lib.seedAssets(app, c, [makeFxMedia(join(proj, 'media'))])
  await lib.seedTimeline(c, [pic.id])
  const [first] = await lib.clipList(c)
  const plain = await frame(c)

  // ---- import: the button, the chooser answered ---------------------------------
  await showClip(c, first.id)
  const depth = await lib.undoDepth(c)
  c.chooseFiles([cube])
  await c.click('inspector.color.lutImport')
  await c.waitFor('the LUT on the clip', async () => (await c.st((s, id) => s.project.clips[id].lut, first.id)) === 'swap', 10000)
  assert.equal(await lib.undoDepth(c), depth + 1, 'the import is one undo step')
  const lut = (await c.st((s) => s.project.luts))[0]
  assert.equal(lut.name, 'swap')
  assert.equal(lut.path.toLowerCase(), cube.toLowerCase(), 'the file’s own path is kept (nothing is copied)')
  assert.ok(lut.size > 100, 'its size, to know it again')
  assert.equal(await c.value('inspector.color.lut'), 'swap', 'the field shows it')
  assert.equal(await c.has('inspector.color.lutMissing'), false)
  const graded = await frame(c)
  assert.ok(apart(graded, plain) > 60, `the LUT changes the frame (by ${apart(graded, plain)} / 255)`)

  // Its intensity: one drag, one step; at nothing the frame is the plain one.
  await c.run((id) => window.__store.getState().setClipLutAmount(id, 0), first.id)
  assert.ok(apart(await frame(c), plain) <= 1, 'at intensity 0 the picture is as it was')
  await c.run((id) => window.__store.getState().setClipLutAmount(id, 1), first.id)
  assert.ok(apart(await frame(c), graded) <= 1)

  // ---- save: the path, and the same file relative to the project ----------------
  const file = join(proj, 'film.snipp')
  lib.answer(app, { kind: 'save', path: file })
  await c.click('timeline.scroll', { fx: 0.95, fy: 0.97 })
  await c.key('s', ['ctrl'])
  await c.waitFor('saved', async () => existsSync(file) && !(await c.st((s) => s.dirty)), 10000)
  const saved = JSON.parse(readFileSync(file, 'utf8'))
  assert.equal(saved.luts.length, 1)
  assert.equal(saved.luts[0].relPath, 'luts/swap.cube', 'written relative to the project file')
  assert.equal(Object.values(saved.clips)[0].lut, 'swap')

  // ---- close → open: the same frame ----------------------------------------------
  await c.ev('setTimeout(() => window.close(), 50), true')
  const code = await Promise.race([app.exited, new Promise((r) => setTimeout(() => r('timeout'), 15000))])
  assert.notEqual(code, 'timeout', 'the app quit when its window closed')
  const app2 = await relaunch({ profile: app.profile })
  const c2 = app2.cdp
  await openFile(app2, c2, file, 1)
  assert.ok(apart(await frame(c2), graded) <= 1, `saved, closed, opened: the same frame (apart by ${apart(await frame(c2), graded)})`)
  assert.equal(await c2.st((s) => s.dirty), false, 'opened, nothing unsaved')

  // ---- the file deleted: said, drawn without it -------------------------------------
  const kept = readFileSync(cube)
  rmSync(cube)
  await c2.run(() => { const s = window.__store.getState(); s.newProject('16:9'); s.setDirty(false) })
  await openFile(app2, c2, file, 1)
  assert.ok(apart(await frame(c2), plain) <= 1, 'a missing LUT: the clip is drawn without it')
  const [again] = await lib.clipList(c2)
  await showClip(c2, again.id)
  await c2.waitId('inspector.color.lutMissing')
  const said = await c2.run(() => document.querySelector('[data-testid="inspector.color.lutMissing"]').textContent)
  assert.match(said, /swap/, 'the Inspector names the missing file')
  assert.match(await c2.run(() => document.querySelector('[data-testid="inspector.color.lut"]').selectedOptions[0].textContent), /missing/i)
  assert.equal(await c2.st((s, id) => s.project.clips[id].lut, again.id), 'swap', 'the clip still asks for it')

  // The file back: "Look again" finds it; the same frame as before.
  writeFileSync(cube, kept)
  await c2.click('inspector.color.lutRetry')
  await c2.waitGone('inspector.color.lutMissing', 10000)
  assert.ok(apart(await frame(c2), graded) <= 1, 'the file back: the same frame again')

  // ---- the project folder moved whole: found beside the project ------------------
  const moved = join(work, 'moved')
  cpSync(proj, moved, { recursive: true })
  rmSync(cube)
  await c2.run(() => { const s = window.__store.getState(); s.newProject('16:9'); s.setDirty(false) })
  await openFile(app2, c2, join(moved, 'film.snipp'), 1)
  await c2.waitFor('the LUT found beside the moved project', async () => (await c2.st((s) => s.project.luts[0].path.toLowerCase())) === join(moved, 'luts', 'swap.cube').toLowerCase(), 10000)
  assert.equal(await c2.st((s) => s.dirty), false, 'where a file lives is no edit')
  // (The picture moved with the folder as well: the frame is the graded one.)
  assert.ok(apart(await frame(c2), graded) <= 1, 'moved with its project: the same frame')
  await c2.run(() => { const s = window.__store.getState(); s.newProject('16:9'); s.setDirty(false) })
}
