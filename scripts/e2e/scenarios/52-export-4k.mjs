// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// Phase Ç3a, "Bitti ölçüsü": a short 4K export, landscape and vertical,
// through the Export window. The window says which encoder takes the choice
// and offers 25 / 50 and the NTSC rates; the files are really 3840 × 2160
// and 2160 × 3840, at the rate asked, every frame there, the H.264 level
// counting the rate, BT.709.
import { existsSync, mkdirSync, rmSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { ffmpegBin, TESTDATA } from '../media.mjs'
export const name = 'export-4k-landscape-vertical'

const probe = (file) => {
  const r = spawnSync(ffmpegBin('ffprobe'), ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height,r_frame_rate,time_base,nb_frames,level,color_primaries,color_transfer,color_space', '-of', 'json', file], { encoding: 'utf8', windowsHide: true })
  return JSON.parse(r.stdout).streams[0]
}

async function exportVia(c, app, lib, file, { scale, target }) {
  rmSync(file, { force: true })
  await c.click('topbar.export')
  await c.waitId('dialog.export')
  if (target) await c.select('export.target', target)
  await c.select('export.format', 'mp4')
  await c.select('export.resolution', String(scale))
  await c.select('export.fps', '30')
  if ((await c.run(() => document.querySelector('[data-testid="export.youtube"]')?.checked)) === true) await c.click('export.youtube')
  // The encoder asked (decision 2): hardware or software, said.
  await c.waitFor('the encoder answered', async () => /Encoder: (hardware|software)/.test(await c.run(() => document.querySelector('[data-testid="export.encoder"]')?.textContent ?? '')), 15000)
  const rates = await c.run(() => [...document.querySelectorAll('[data-testid="export.fps"] option')].map((o) => o.textContent))
  // (REF-AB, P2: the name and place are the window's own; only the first
  // export asks the save dialog. The vertical one, second, went to the
  // remembered folder under the project's name and was never found.)
  await lib.exportTo(c, app, file)
  await c.click('export.start')
  await c.waitGone('dialog.export')
  await c.waitFor('the export done', async () => {
    const st = await c.st((s) => s.exportStatus)
    if (st?.error) throw new Error('export failed: ' + st.error)
    return st?.done && existsSync(file) && statSync(file).size > 10000
  }, 180000, 250)
  // (cila4, 1: a video streamed into its file says its real size on the
  // done card, the first export (save dialog) and the second (the
  // remembered folder) alike; it said "bytes: 0" before.)
  const bytes = await c.st((s) => s.exportStatus?.bytes ?? 0)
  lib.assert.equal(bytes, statSync(file).size, `the done card's size is the file's (${bytes})`)
  await c.waitId('export.done.size')
  const shown = await c.run(() => document.querySelector('[data-testid="export.done.size"]')?.textContent ?? '')
  lib.assert.match(shown, /^\d+(\.\d+)? (KB|MB|GB)$/, `the size shown: ${shown}`)
  return rates
}

export async function run({ c, app, media, lib }) {
  const { assert } = lib
  const out = join(TESTDATA, 'cikti')
  mkdirSync(out, { recursive: true })
  const [other] = await lib.seedAssets(app, c, [media.other])
  await lib.seedTimeline(c, [other.id])
  // Two seconds are enough.
  await c.run(() => {
    const s = window.__store.getState()
    const p = structuredClone(s.project)
    for (const k of Object.values(p.clips)) k.duration = Math.min(k.duration, 2)
    s.loadProject(p)
    return true
  })
  const land = join(out, 'e2e-4k.mp4')
  const rates = await exportVia(c, app, lib, land, { scale: 2 })
  for (const r of ['23.976', '25', '29.97', '50', '59.94']) assert.ok(rates.some((x) => x.startsWith(r + ' fps')), `the rate ${r} is offered (${rates.join(', ')})`)
  const a = probe(land)
  assert.deepEqual([a.width, a.height], [3840, 2160])
  assert.equal(a.r_frame_rate, '30/1')
  assert.equal(a.time_base, '1/30')
  assert.equal(Number(a.nb_frames), 60, 'every frame of 2 s at 30')
  assert.equal(a.level, 51, 'level 5.1 for 2160p30')
  assert.equal(a.color_primaries, 'bt709')
  rmSync(land, { force: true })

  // Vertical: the project in Shorts mode, its 9:16 window at 2160 × 3840.
  await c.run(() => {
    const s = window.__store.getState()
    const p = structuredClone(s.project)
    p.mode = 'shorts'
    s.loadProject(p)
    return true
  })
  const tall = join(out, 'e2e-4k-dikey.mp4')
  await exportVia(c, app, lib, tall, { scale: 2, target: 'shorts' })
  const b = probe(tall)
  assert.deepEqual([b.width, b.height], [2160, 3840])
  assert.equal(Number(b.nb_frames), 60)
  assert.equal(b.level, 51)
  rmSync(tall, { force: true })
  console.log(`     4K: 3840×2160 and 2160×3840, 60 frames each, level ${a.level} / ${b.level}`)
}
