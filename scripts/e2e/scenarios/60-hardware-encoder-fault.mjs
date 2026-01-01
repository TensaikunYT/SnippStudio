// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// Phase Ç3 patch (haritalar/_fazc3-denetim-goruntu.md G-1, G-5): the graphics
// card's encoder failing during an export (made here by the exporter's test
// fault point: the encoder throws on the second frame). The export stops with
// the plain sentence, no restart; the next export of the same choice runs on
// the software encoder and says so. When this computer's answer for the
// choice is the software encoder already, there is nothing to check: said.
import { existsSync, mkdirSync, rmSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { TESTDATA } from '../media.mjs'
export const name = 'hardware-encoder-fault'

export async function run({ c, app, media, lib }) {
  const { assert } = lib
  const out = join(TESTDATA, 'cikti', 'e2e-hw-fault')
  rmSync(out, { recursive: true, force: true })
  mkdirSync(out, { recursive: true })
  const [other] = await lib.seedAssets(app, c, [media.other])
  await lib.seedTimeline(c, [other.id])
  const file = join(out, 'hw.mp4')
  const r = await c.run(async (file) => {
    const ex = await window.__exporter()
    const [rj] = await window.__exportJob()
    const p = window.__store.getState().project
    const settings = { container: 'mp4', resolutionScale: 0.5, fps: 30, bitrateFactor: 0.08, normalize: false }
    let hw = null
    const once = async (fault) => {
      await window.api.testChooseSave(file)
      await ex.preloadImagesForExport(p)
      const ok = await rj.runExportJob('video', { target: file }, async (signal, progress) => {
        await ex.exportProjectMp4(p, {
          settings,
          signal,
          toPath: file,
          onProgress: progress,
          onEncoder: (e) => (hw = e.hw),
          ...(fault ? { fault: (stage) => { if (stage === 'encoding') throw new DOMException('Encoding failed (test fault).', 'EncodingError') } } : {})
        })
        return { path: file }
      })
      const st = window.__store.getState().exportStatus
      return { ok, hw, error: st?.error ?? null, detail: st?.detail ?? '' }
    }
    const first = await once(true)
    const second = first.hw === 'prefer-hardware' ? await once(false) : null
    return { first, second }
  }, file)
  if (r.first.hw !== 'prefer-hardware') {
    console.log(`     this computer's answer is ${r.first.hw}: nothing to check here (the cache rule is the unit test c3p-encoder)`)
    rmSync(out, { recursive: true, force: true })
    return
  }
  assert.equal(r.first.ok, false, 'the export with the failing encoder stops')
  assert.match(r.first.error ?? '', /graphics card's video encoder failed/, `a plain sentence (${r.first.error})`)
  assert.match(r.first.error ?? '', /software encoder/, 'the next export uses the software encoder, said')
  assert.equal(r.second.ok, true, `the next export works (${r.second.error})`)
  assert.equal(r.second.hw, 'prefer-software', 'on the software encoder')
  assert.match(r.second.detail, /encoder failed on this size and rate earlier/, `and says so (${r.second.detail})`)
  assert.ok(existsSync(file) && statSync(file).size > 1000, 'the file is written')
  rmSync(out, { recursive: true, force: true })
  console.log('     hardware encoder failed on frame 2: stopped with the sentence; the next export ran on software and said so')
}
