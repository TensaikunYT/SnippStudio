// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// Phase Ç3a, decision 9 (report R26): File → This frame: its size (the
// project's or 4K), PNG or JPEG; a Shorts project's still is its 9:16
// window at its size. Since phase Ç3b (decision 9) the export window's
// Frame part (Ç3a's dialog of its own is gone).
import { existsSync, mkdirSync, rmSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { ffmpegBin, TESTDATA } from '../media.mjs'
export const name = 'still-frame-4k-jpeg'

const sizeOf = (file) => {
  const r = spawnSync(ffmpegBin('ffprobe'), ['-v', 'error', '-show_entries', 'stream=codec_name,width,height', '-of', 'json', file], { encoding: 'utf8', windowsHide: true })
  return JSON.parse(r.stdout).streams[0]
}

async function save(c, app, lib, file, { size, format }) {
  rmSync(file, { force: true })
  await c.click('topbar.file')
  await c.click('menu.file.export-frame')
  await c.waitId('dialog.export')
  await c.waitFor('the frame part', () => c.has('still.size'), 5000)
  await c.click(`still.size.${size}`)
  await c.click(`still.format.${format}`)
  await lib.exportTo(c, app, file)
  await c.click('export.start')
  await c.waitFor('the still written', async () => {
    const st = await c.st((s) => s.exportStatus)
    if (st?.error) throw new Error('failed: ' + st.error)
    return st?.done && existsSync(file) && statSync(file).size > 1000
  }, 60000, 200)
}

export async function run({ c, app, media, lib }) {
  const { assert } = lib
  const [other] = await lib.seedAssets(app, c, [media.other])
  await lib.seedTimeline(c, [other.id])
  await c.st((s) => s.setTime(1))
  const out = join(TESTDATA, 'cikti')
  mkdirSync(out, { recursive: true })
  const jpg = join(out, 'e2e-kare-4k.jpg')
  await save(c, app, lib, jpg, { size: '4k', format: 'jpeg' })
  const a = sizeOf(jpg)
  assert.equal(a.codec_name, 'mjpeg')
  assert.deepEqual([a.width, a.height], [3840, 2160])
  rmSync(jpg, { force: true })
  // A Shorts project: its window, 1080 × 1920.
  await c.run(() => {
    const s = window.__store.getState()
    const p = structuredClone(s.project)
    p.mode = 'shorts'
    s.loadProject(p)
    return true
  })
  const png = join(out, 'e2e-kare-dikey.png')
  await save(c, app, lib, png, { size: 'project', format: 'png' })
  const b = sizeOf(png)
  assert.equal(b.codec_name, 'png')
  assert.deepEqual([b.width, b.height], [1080, 1920])
  rmSync(png, { force: true })
  console.log('     3840×2160 JPEG; a Short 1080×1920 PNG')
}
