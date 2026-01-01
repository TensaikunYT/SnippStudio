// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// Phase Ç3 patch (haritalar/_fazc3-denetim-dayaniklilik.md R-4): a Shorts
// batch that fails or is cancelled part-way says which Short it stopped at,
// how many were saved before it and where they are. Three Shorts (0.5 s,
// 5 s, 0.5 s) into a folder: a full disk after 100 KB stops the second; a
// Cancel during the second stops it too.
import { mkdirSync, readdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { TESTDATA } from '../media.mjs'
export const name = 'shorts-batch-partial'

async function batch(c, app, lib, folder, segs, onStart) {
  rmSync(folder, { recursive: true, force: true })
  mkdirSync(folder, { recursive: true })
  await onStart()
  lib.answer(app, { kind: 'open', paths: [folder] })
  await c.run((segs) => {
    window.__exportShorts(segs)
    return true
  }, segs)
  await c.waitId('dialog.export')
  await c.click('export.start')
  await c.waitGone('dialog.export')
  let st = null
  await c.waitFor('the batch ended', async () => {
    st = await c.st((s) => s.exportStatus)
    return st?.done
  }, 120000, 100)
  await c.run(() => window.api.testDiskFault({}))
  await c.sleep(400)
  return { st, files: readdirSync(folder).filter((f) => !f.endsWith('.part')) }
}

export async function run({ c, app, media, lib }) {
  const { assert } = lib
  const folder = join(TESTDATA, 'cikti', 'e2e-batch-partial')
  const [other] = await lib.seedAssets(app, c, [media.other])
  await lib.seedTimeline(c, [other.id])
  const segs = await c.run(() => {
    const s = window.__store.getState()
    const p = structuredClone(s.project)
    p.mode = 'shorts'
    p.name = 'batch'
    p.shortSegments = [
      { id: 'sa', name: 'A', start: 0, end: 0.5, keyframes: [] },
      { id: 'sb', name: 'B', start: 0, end: 5, keyframes: [] },
      { id: 'sc', name: 'C', start: 0, end: 0.5, keyframes: [] }
    ]
    s.loadProject(p)
    return window.__store.getState().project.shortSegments
  })
  try {
    // A full disk in the second Short.
    const failed = await batch(c, app, lib, folder, segs, () => c.run(() => window.api.testDiskFault({ fullAfter: 100 * 1024 })))
    const err = failed.st.error ?? ''
    assert.match(err, /Short 2 of 3 \("B"\)/, `the Short it stopped at (${err})`)
    assert.match(err, /disk is full/i, 'why')
    assert.match(err, /Saved before it: 1 of 3/, `how many were saved (${err})`)
    assert.ok(err.includes(folder), `where they are (${err})`)
    assert.deepEqual(failed.files, ['batch - A.mp4'], 'the first Short is in the folder')

    // A Cancel in the second Short.
    const cancelled = await batch(c, app, lib, folder, segs, () =>
      c.run(() => {
        let fired = false
        const un = window.__store.subscribe((st) => {
          if (fired || !/Short 2 of 3 .*Drawing frame/.test(st.exportStatus?.label ?? '')) return
          fired = true
          un()
          void window.__exportJob().then(([, job]) => job.cancelExportJob())
        })
        return true
      })
    )
    const said = cancelled.st.detail ?? ''
    assert.equal(cancelled.st.cancelled, true, 'cancelled')
    assert.match(said, /Cancelled at Short 2 of 3 \("B"\)/, `the Short it stopped at (${said})`)
    assert.match(said, /Saved before it: 1 of 3/, `how many were saved (${said})`)
    assert.ok(said.includes(folder), `where they are (${said})`)
    assert.deepEqual(cancelled.files, ['batch - A.mp4'], 'the first Short is in the folder')
    console.log('     full disk and Cancel in Short 2 of 3: said which, 1 saved, and where')
  } finally {
    await c.run(() => window.api.testDiskFault({})).catch(() => {})
    rmSync(folder, { recursive: true, force: true })
  }
}
