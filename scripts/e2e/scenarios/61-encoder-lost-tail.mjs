// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// Phase Ç3 patch (haritalar/_fazc3-denetim-dayaniklilik.md R-5; report R19):
// an encoder that loses the film's tail without a word (every frame after
// the 30th dropped inside VideoEncoder.encode, as the export rig does it).
// The export counts the packets it got back and stops with that sentence:
// the guard in exporter.ts, not only the read-back after it.
import { existsSync, mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { TESTDATA } from '../media.mjs'
export const name = 'encoder-lost-tail'

export async function run({ c, app, media, lib }) {
  const { assert } = lib
  const out = join(TESTDATA, 'cikti', 'e2e-lost-tail')
  rmSync(out, { recursive: true, force: true })
  mkdirSync(out, { recursive: true })
  const [other] = await lib.seedAssets(app, c, [media.other])
  await lib.seedTimeline(c, [other.id])
  const file = join(out, 'tail.mp4')
  const r = await c.run(async (file) => {
    const ex = await window.__exporter()
    const orig = VideoEncoder.prototype.encode
    let n = 0
    VideoEncoder.prototype.encode = function (f, o) {
      if (++n > 30) return
      return orig.call(this, f, o)
    }
    try {
      await window.api.testChooseSave(file)
      await ex.exportProjectMp4(window.__store.getState().project, { settings: { container: 'mp4', resolutionScale: 0.5, fps: 30, bitrateFactor: 0.08, normalize: false, range: [0, 3] }, toPath: file, onProgress() {} })
      return { error: null }
    } catch (e) {
      return { error: String(e?.message ?? e) }
    } finally {
      VideoEncoder.prototype.encode = orig
    }
  }, file)
  assert.match(r.error ?? '', /the encoder handed back 30 of its 90 frames/, `the packet count stops it (${r.error})`)
  await c.sleep(300)
  assert.equal(existsSync(file), false, 'no file kept')
  assert.equal(existsSync(file + '.part'), false, 'no .part left')
  rmSync(out, { recursive: true, force: true })
  console.log('     30 of 90 frames handed back: stopped by the packet count, nothing kept')
}
