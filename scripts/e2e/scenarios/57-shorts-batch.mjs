// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// Phase Ç3b, decision 5 (report R23): the Shorts batch. Two segments into
// a chosen folder, each Short streamed to its own file (no .part left), from
// the project as it was when the batch began: the clip is deleted while the
// first Short is drawn, and the second still shows it.
import { existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { ffmpegBin, probeDuration, probeStreams, TESTDATA } from '../media.mjs'
export const name = 'shorts-batch-snapshot'

/** The mean grey of a file's frame at `at` seconds (0–255). */
function meanGrey(file, at) {
  const r = spawnSync(ffmpegBin('ffmpeg'), ['-v', 'error', '-ss', String(at), '-i', file, '-frames:v', '1', '-vf', 'scale=16:16,format=gray', '-f', 'rawvideo', '-'], { windowsHide: true, maxBuffer: 1 << 20 })
  let s = 0
  for (const v of r.stdout) s += v
  return s / Math.max(1, r.stdout.length)
}

export async function run({ c, app, media, lib }) {
  const { assert } = lib
  const folder = join(TESTDATA, 'cikti', 'e2e-shorts')
  rmSync(folder, { recursive: true, force: true })
  mkdirSync(folder, { recursive: true })
  const [other] = await lib.seedAssets(app, c, [media.other])
  await lib.seedTimeline(c, [other.id])
  // Shorts mode, two segments: 0–2 s and 3–5 s.
  const segs = await c.run(() => {
    const s = window.__store.getState()
    const p = structuredClone(s.project)
    p.mode = 'shorts'
    p.name = 'batch'
    p.shortSegments = [
      { id: 'sa', name: 'A', start: 0, end: 2, keyframes: [] },
      { id: 'sb', name: 'B', start: 3, end: 5, keyframes: [] }
    ]
    s.loadProject(p)
    return window.__store.getState().project.shortSegments
  })
  // Delete the clip once the first Short is being drawn.
  await c.run(() => {
    const S = window.__store
    let done = false
    const unsub = S.subscribe((st) => {
      const label = st.exportStatus?.label ?? ''
      if (!done && /Short 1 of 2/.test(label) && /Drawing frame/.test(label)) {
        done = true
        const id = Object.keys(st.project.clips)[0]
        st.runBatch([{ name: 'clip.delete', params: { ids: [id] } }])
        unsub()
      }
    })
    return true
  })
  lib.answer(app, { kind: 'open', paths: [folder] })
  await c.run((segs) => {
    window.__exportShorts(segs)
    return true
  }, segs)
  await c.waitId('dialog.export')
  await c.click('export.start')
  await c.waitGone('dialog.export')
  await c.waitFor('the batch done', async () => {
    const st = await c.st((s) => s.exportStatus)
    if (st?.error) throw new Error('export failed: ' + st.error)
    return st?.done
  }, 120000, 250)
  const clipsLeft = await c.st((s) => Object.keys(s.project.clips).length)
  assert.equal(clipsLeft, 0, 'the clip was deleted during the batch')
  const files = readdirSync(folder).sort()
  assert.equal(files.filter((f) => f.endsWith('.part')).length, 0, 'no .part left')
  const mp4 = files.filter((f) => f.endsWith('.mp4'))
  assert.equal(mp4.length, 2, `two Shorts (${files.join(', ')})`)
  for (const f of mp4) {
    const file = join(folder, f)
    assert.ok(lib.near(probeDuration(file), 2, 0.08), `${f}: 2 s`)
    const v = probeStreams(file).find((s) => s.codec_type === 'video')
    assert.deepEqual([v.width, v.height], [1080, 1920], `${f}: 1080 × 1920`)
  }
  // The second Short still shows the test pattern (not the black of an
  // empty timeline): it was drawn from the project as it was.
  const grey = meanGrey(join(folder, mp4[1]), 1)
  assert.ok(grey > 40, `the second Short shows the clip (mean grey ${grey.toFixed(0)})`)
  rmSync(folder, { recursive: true, force: true })
  console.log(`     2 Shorts streamed, no .part; the second drawn from the snapshot (grey ${grey.toFixed(0)})`)
}
