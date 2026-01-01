// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// Phase 10b.1 (FAZ10-PLAN.md): a computer without an AAC encoder (desktop
// Linux), acted on Windows by saying the encoder is not there. The export
// window moves MP4 to WebM and says why; the file written is VP9 + Opus. The
// real answer is put back at the end, whatever happens.
import { existsSync, mkdirSync, rmSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { probeDuration, probeStreams, TESTDATA } from '../media.mjs'
export const name = 'faz10-export-no-aac'

export async function run({ c, app, media, lib }) {
  const { assert } = lib
  const out = join(TESTDATA, 'cikti')
  mkdirSync(out, { recursive: true })
  const file = join(out, 'e2e-export-no-aac.webm')
  rmSync(file, { force: true })
  const [other] = await lib.seedAssets(app, c, [media.other])
  await lib.seedTimeline(c, [other.id])
  await c.run(async () => (await window.__exporter()).setCodecCapsForTests({ canAac: false, canAvc: true }))
  try {
    await c.click('topbar.export')
    await c.waitId('dialog.export')
    await c.select('export.format', 'mp4')
    await c.select('export.resolution', '0.5')
    if ((await c.run(() => document.querySelector('[data-testid="export.youtube"]')?.checked)) === true) await c.click('export.youtube')
    await c.waitFor('the window moved the export to WebM', async () => (await c.run(() => document.querySelector('[data-testid="export.codec-moved"]')?.textContent ?? '')).length > 0, 10000, 100)
    const said = await c.run(() => document.querySelector('[data-testid="export.codec-moved"]').textContent)
    assert.match(said, /AAC/, 'the reason names AAC')
    const summary = await c.run(() => document.querySelector('[data-testid="export.summary"]').textContent)
    assert.match(summary, /VP9/, `the summary says VP9 (${summary})`)
    assert.match(summary, /Opus/, `the summary says Opus (${summary})`)
    lib.answer(app, { kind: 'save', path: file })
    await c.click('export.start')
    await c.waitGone('dialog.export')
    await c.waitFor('the export done', async () => {
      const st = await c.st((s) => s.exportStatus)
      if (st?.error) throw new Error('export failed: ' + st.error)
      return st?.done && existsSync(file) && statSync(file).size > 10000
    }, 120000, 250)
    const asked = lib.dialogsAsked(app).filter((e) => e.kind === 'save')
    assert.equal(asked.length, 1, 'asked where, once')
    const streams = probeStreams(file)
    const v = streams.find((s) => s.codec_type === 'video'), a = streams.find((s) => s.codec_type === 'audio')
    assert.ok(v && a, 'a video and a sound stream')
    assert.equal(v.codec_name, 'vp9')
    assert.equal(a.codec_name, 'opus')
    assert.ok(lib.near(probeDuration(file), 6, 0.15), '6 s long')
    console.log(`     no AAC: ${statSync(file).size} bytes, ${v.codec_name} + ${a.codec_name}`)
  } finally {
    await c.run(async () => (await window.__exporter()).setCodecCapsForTests(null)).catch(() => {})
  }
}
