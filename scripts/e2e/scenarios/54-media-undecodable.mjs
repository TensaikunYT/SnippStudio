// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// Phase Ç3a, decision 6 (report R13): a file this computer has no decoder for
// (ProRes) comes in with a badge in the media panel, and the export stops
// before it mixes the sound, naming it; no .part is left.
import { existsSync, mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { E2E_MEDIA, ffmpegBin, TESTDATA } from '../media.mjs'
export const name = 'media-undecodable'

export async function run({ c, app, lib }) {
  const { assert } = lib
  const mov = join(E2E_MEDIA, 'prores.mov')
  if (!existsSync(mov)) spawnSync(ffmpegBin('ffmpeg'), ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc2=size=640x360:rate=30:duration=2', '-c:v', 'prores_ks', '-profile:v', '2', mov], { windowsHide: true })
  const [a] = await lib.seedAssets(app, c, [mov])
  await lib.seedTimeline(c, [a.id])
  await c.waitFor('the badge', () => c.has('media.undecodable'), 8000)
  const out = join(TESTDATA, 'cikti')
  mkdirSync(out, { recursive: true })
  const file = join(out, 'e2e-undecodable.mp4')
  rmSync(file, { force: true })
  await c.click('topbar.export')
  await c.waitId('dialog.export')
  if ((await c.run(() => document.querySelector('[data-testid="export.youtube"]')?.checked)) === true) await c.click('export.youtube')
  lib.answer(app, { kind: 'save', path: file })
  await c.click('export.start')
  await c.waitGone('dialog.export')
  const err = await c.waitFor('the export refused', async () => (await c.st((s) => s.exportStatus))?.error, 30000, 200)
  assert.match(err, /cannot be decoded on this computer: "prores\.mov"/)
  assert.ok(!existsSync(file) && !existsSync(file + '.part'), 'nothing written')
  console.log('     ' + err.slice(0, 110))
}
