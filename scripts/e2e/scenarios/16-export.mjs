// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// A real export, start to end: a 6 s project, Export → MP4 at half size,
// the save dialog answered with testdata\cikti\; the file is really written,
// holds a video and a sound stream, and is as long as the project.
import { existsSync, mkdirSync, rmSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { probeDuration, probeStreams, TESTDATA } from '../media.mjs'
export const name = 'export-mp4'

export async function run({ c, app, media, lib }) {
  const { assert } = lib
  const out = join(TESTDATA, 'cikti')
  mkdirSync(out, { recursive: true })
  const file = join(out, 'e2e-export.mp4')
  rmSync(file, { force: true })
  const [other] = await lib.seedAssets(app, c, [media.other])
  await lib.seedTimeline(c, [other.id])

  await c.click('topbar.export')
  await c.waitId('dialog.export')
  await c.select('export.format', 'mp4')
  await c.select('export.resolution', '0.5')
  if ((await c.run(() => document.querySelector('[data-testid="export.youtube"]')?.checked)) === true) await c.click('export.youtube')
  lib.answer(app, { kind: 'save', path: file })
  const t0 = Date.now()
  await c.click('export.start')
  await c.waitGone('dialog.export')
  await c.waitFor('the export done', async () => {
    const st = await c.st((s) => s.exportStatus)
    if (st?.error) throw new Error('export failed: ' + st.error)
    return st?.done && existsSync(file) && statSync(file).size > 10000
  }, 120000, 250)
  const seconds = (Date.now() - t0) / 1000
  const asked = lib.dialogsAsked(app).filter((e) => e.kind === 'save')
  assert.equal(asked.length, 1, 'asked where, once')
  const dur = probeDuration(file)
  assert.ok(lib.near(dur, 6, 0.1), `6 s long (${dur})`)
  const streams = probeStreams(file)
  const v = streams.find((s) => s.codec_type === 'video'), a = streams.find((s) => s.codec_type === 'audio')
  assert.ok(v && a, 'a video and a sound stream')
  assert.equal(v.codec_name, 'h264')
  assert.deepEqual([v.width, v.height], [960, 540], 'half of 1920×1080')
  console.log(`     export: ${statSync(file).size} bytes, ${dur.toFixed(2)} s in ${seconds.toFixed(1)} s`)
}
