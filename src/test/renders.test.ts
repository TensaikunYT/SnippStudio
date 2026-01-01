// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
import assert from 'node:assert/strict'
import { mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import {
  askRenderCancel,
  clearRenderCancel,
  readRenderFiles,
  removeRenderFile,
  renderCancelAsked,
  renderOutput,
  rendersDirFor,
  safeRenderId,
  writeRenderFile
} from '../main/render-status'
import {
  ETA_WINDOW_MS,
  finished,
  fmtClock,
  framesDone,
  isStale,
  newRenderStatus,
  parseRenderStatus,
  renderEta,
  renderId,
  sortRenders,
  STALE_MS,
  validRenderId,
  withProgress,
  type RenderStatus
} from '../renderer/src/export/renders'

const T0 = Date.UTC(2026, 9, 12, 10, 0, 0)
const MIN = 60_000

test("a film's name becomes a file name Windows takes, and main accepts every one the page makes", () => {
  assert.equal(renderId('osmanli'), 'osmanli')
  assert.equal(renderId('Osmanlı: 600 yıl?'), 'Osmanlı- 600 yıl-')
  assert.equal(renderId('film.v2'), 'film.v2')
  // No way out of the folder.
  for (const bad of ['../../evil', '..\\x', 'C:\\Windows\\x', '...', '', ' . ', 'a/b\\c', 'x'.repeat(200)]) {
    const id = renderId(bad)
    assert.ok(safeRenderId(id), `${JSON.stringify(bad)} → ${JSON.stringify(id)} is a safe id`)
    assert.ok(validRenderId(id))
    assert.ok(!id.includes('/') && !id.includes('\\') && !id.startsWith('.'))
  }
  for (const bad of ['..', '../x', 'a\\b', '', '.hidden', 'trailing.', 'x'.repeat(81), 3]) assert.equal(safeRenderId(bad), false, String(bad))
})

test('time left and the finish time follow the last few minutes, not the whole run', () => {
  // 25 200 frames (7 min at 60 fps); a slow first ten minutes (3D), then twice as fast.
  const frames = 25_200
  let s = newRenderStatus({ name: 'osmanli', source: 'script', frames, fps: 60, workers: 4, now: T0 })
  let p = 0
  let t = T0
  for (let k = 0; k < 300; k++) {
    t += 2000
    p += 0.0005 // 0.025 %/s
    s = withProgress(s, t, p, `Drawing frame ${Math.round(p * frames)} of ${frames}`)
  }
  for (let k = 0; k < 150; k++) {
    t += 2000
    p += 0.001 // 0.05 %/s: the last 5 minutes
    s = withProgress(s, t, p)
  }
  const eta = renderEta(s.samples, s.frames, t)!
  const want = (1 - p) / 0.0005 // seconds at the recent rate
  assert.ok(Math.abs(eta.left - want) < 2, `about ${want}s left, said ${eta.left}`)
  assert.equal(eta.finishAt, t + eta.left * 1000)
  // Frames a second at the recent rate: 0.0005 a second of 25 200 frames.
  assert.ok(Math.abs(eta.speed - 0.0005 * frames) < 0.1, `speed ${eta.speed}`)
  // Read 30 s after the last write: 30 s less left.
  assert.ok(Math.abs(renderEta(s.samples, s.frames, t + 30_000)!.left - (want - 30)) < 2)
  // The file keeps only the last minutes, and its samples stay few.
  assert.ok(s.samples[0][0] >= t - 10 * MIN)
  assert.ok(s.samples.length <= 10 * 30 + 2, `${s.samples.length} samples`)
  // Not enough to say anything yet; a finished bar has nothing left.
  assert.equal(renderEta([[T0, 0]], frames, T0), null)
  assert.equal(renderEta([[T0, 0.2], [T0 + 500, 0.3]], frames, T0), null)
  assert.equal(renderEta([[T0, 0.5], [T0 + 60_000, 0.5]], frames, T0), null)
  assert.equal(renderEta([[T0, 0.5], [T0 + 5000, 1]], frames, T0 + 5000)!.left, 0)
  assert.ok(ETA_WINDOW_MS >= 2 * MIN && ETA_WINDOW_MS <= 5 * MIN)
})

test('close samples are merged, but the first stays to measure from', () => {
  let s = newRenderStatus({ name: 'a', source: 'snipp', now: T0 })
  s = withProgress(s, T0 + 100, 0.01)
  s = withProgress(s, T0 + 200, 0.02)
  s = withProgress(s, T0 + 300, 0.03)
  assert.deepEqual(s.samples[0], [T0, 0])
  assert.deepEqual(s.samples[s.samples.length - 1], [T0 + 300, 0.03])
  assert.ok(s.samples.length <= 3)
  // A heartbeat with no move keeps the bar and the label.
  const h = withProgress({ ...s, label: 'Drawing' }, T0 + 9000, NaN)
  assert.equal(h.progress, 0.03)
  assert.equal(h.label, 'Drawing')
  assert.equal(h.updatedAt, T0 + 9000)
})

test('frames drawn come from the label when it names them, else from the bar', () => {
  const base = { frames: 1000, progress: 0.5, state: 'running' as const }
  assert.equal(framesDone({ ...base, label: 'Drawing frame 812 of 1000' }), 812)
  assert.equal(framesDone({ ...base, label: 'Mixing the sound' }), 500)
  assert.equal(framesDone({ ...base, label: 'Short 1 of 2: Drawing frame 3 of 40' }), 500)
  assert.equal(framesDone({ ...base, state: 'done', label: '' }), 1000)
})

test('a running job nobody writes any more is told apart, and the list puts live ones first', () => {
  const a = newRenderStatus({ name: 'a', source: 'snipp', now: T0 })
  const b = finished(newRenderStatus({ name: 'b', source: 'script', now: T0 - 20 * MIN }), T0 - 5 * MIN, 'done', { output: 'C:\\x\\b.mp4' })
  const c = finished(newRenderStatus({ name: 'c', source: 'snipp', now: T0 - 30 * MIN }), T0 - 2 * MIN, 'cancelled')
  const d = newRenderStatus({ name: 'd', source: 'script', now: T0 - 40 * MIN })
  assert.equal(isStale(a, T0 + STALE_MS - 1), false)
  assert.equal(isStale(a, T0 + STALE_MS + 1), true)
  assert.equal(isStale(b, T0 + 60 * MIN), false)
  assert.equal(b.progress, 1)
  assert.equal(b.label, 'Done')
  assert.equal(c.endedAt, T0 - 2 * MIN)
  const order = sortRenders([b, d, c, a], T0 + 1000).map((s) => s.id)
  // a is live; d is stale (40 minutes without a write), so with the finished, newest first.
  assert.deepEqual(order, ['a', 'c', 'b', 'd'])
})

test('a status file read back is checked field by field', () => {
  let s = newRenderStatus({ name: 'osmanli', source: 'script', frames: 25_200, fps: 60, workers: 4, output: 'C:\\p\\cikti\\osmanli.mp4', now: T0 })
  s = withProgress(s, T0 + 5000, 0.1, 'Drawing frame 2520 of 25200')
  assert.deepEqual(parseRenderStatus(JSON.stringify({ ...s, pid: 42 })), { ...s, pid: 42 })
  assert.equal(parseRenderStatus('not json'), null)
  assert.equal(parseRenderStatus(JSON.stringify({ ...s, v: 2 })), null)
  assert.equal(parseRenderStatus(JSON.stringify({ ...s, id: '../x' })), null)
  assert.equal(parseRenderStatus(JSON.stringify({ ...s, state: 'odd' })), null)
  const odd = parseRenderStatus(JSON.stringify({ ...s, progress: 7, frames: -3, workers: 0, samples: [[1, 2], 'x', [3]], source: 'other' }))!
  assert.equal(odd.progress, 1)
  assert.equal(odd.frames, 0)
  assert.equal(odd.workers, 1)
  assert.deepEqual(odd.samples, [[1, 2]])
  assert.equal(odd.source, 'snipp')
})

test('the finish time reads as a clock, tomorrow when it is', () => {
  const now = new Date(2026, 9, 12, 22, 0, 0).getTime()
  assert.equal(fmtClock(new Date(2026, 9, 12, 23, 5).getTime(), now), '23:05')
  assert.equal(fmtClock(new Date(2026, 9, 13, 1, 30).getTime(), now), 'tomorrow 01:30')
})

test('the folder: written whole, read, a Cancel asked and seen, a finished job removed', async () => {
  const dir = path.join(mkdtempSync(path.join(tmpdir(), 'snipp-renders-')), 'cikti', '.renders')
  try {
    const s: RenderStatus = newRenderStatus({ name: 'osmanli', source: 'script', frames: 100, fps: 60, output: path.join(dir, '..', 'osmanli.mp4'), now: T0 })
    const file = await writeRenderFile(dir, s.id, JSON.stringify(s))
    assert.equal(file, path.join(dir, 'osmanli.json'))
    // Written again over itself (a rename onto the old file), no temp file left.
    await writeRenderFile(dir, s.id, JSON.stringify(withProgress(s, T0 + 2000, 0.5)))
    assert.deepEqual(readdirSync(dir), ['osmanli.json'])
    const texts = await readRenderFiles(dir)
    assert.equal(texts.length, 1)
    assert.equal(parseRenderStatus(texts[0])!.progress, 0.5)
    assert.equal(await renderOutput(dir, 'osmanli'), path.normalize(path.join(dir, '..', 'osmanli.mp4')))
    await assert.rejects(writeRenderFile(dir, '../x', '{}'))

    // Cancel: only for a job that is there; the writer sees it; cleared at its end.
    assert.equal(await askRenderCancel(dir, 'nothing'), false)
    assert.equal(renderCancelAsked(dir, 'osmanli'), false)
    assert.equal(await askRenderCancel(dir, 'osmanli'), true)
    assert.equal(renderCancelAsked(dir, 'osmanli'), true)
    // The .cancel file is not a status.
    assert.equal((await readRenderFiles(dir)).length, 1)
    await clearRenderCancel(dir, 'osmanli')
    assert.equal(renderCancelAsked(dir, 'osmanli'), false)

    assert.equal(await removeRenderFile(dir, 'osmanli'), true)
    assert.deepEqual(await readRenderFiles(dir), [])
    assert.equal(await removeRenderFile(dir, 'osmanli'), false)
    // A folder that is not there yet reads as empty.
    assert.deepEqual(await readRenderFiles(path.join(dir, 'none')), [])
  } finally {
    rmSync(path.dirname(path.dirname(dir)), { recursive: true, force: true })
  }
})

test("the folder is the dev app's cikti\\.renders, the packaged app's own data, or set", () => {
  const P = 'C:\\Users\\u\\Desktop\\SnippStudio\\app'
  const base = { env: {}, isPackaged: false, appPath: P, userData: 'C:\\Users\\u\\AppData\\Roaming\\Snipp' }
  assert.equal(rendersDirFor(base), path.join(P, 'cikti', '.renders'))
  assert.equal(rendersDirFor({ ...base, isPackaged: true }), path.join(base.userData, 'renders'))
  assert.equal(rendersDirFor({ ...base, env: { SNIPP_RENDERS_DIR: 'D:\\r' } }), path.resolve('D:\\r'))
})

test('an export in Snipp writes its status, and a Cancel from the panel stops it', async () => {
  const writes: RenderStatus[] = []
  let asked = false
  const fake = {
    write: async (json: string) => (writes.push(JSON.parse(json)), true),
    cancelAsked: async () => asked
  }
  const g = globalThis as unknown as { window?: unknown }
  g.window = { api: { renders: fake }, setInterval, clearInterval }
  try {
    // Loaded after the fake window: platform.ts reads window.api when it loads.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { trackRender } = require('../renderer/src/export/render-tracker') as typeof import('../renderer/src/export/render-tracker')
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { beginExportJob, endExportJob } = require('../renderer/src/export/job') as typeof import('../renderer/src/export/job')
    const signal = beginExportJob()
    const tr = trackRender({ name: 'osmanli', output: 'C:\\p\\cikti\\osmanli.mp4', fps: 60 }, signal)
    tr.plan({ frames: 25_200, workers: 4 })
    tr.progress(0.1, 'Drawing frame 2520 of 25200')
    await new Promise((r) => setTimeout(r, 10))
    assert.equal(signal.aborted, false)
    assert.equal(writes[0].state, 'running')
    assert.equal(writes[0].source, 'snipp')
    assert.equal(writes[writes.length - 1].frames, 25_200)
    assert.equal(writes[writes.length - 1].workers, 4)
    // The panel asks; the next move of the bar (2 s on) sees it and cancels the job.
    asked = true
    await new Promise((r) => setTimeout(r, 2100))
    tr.progress(0.2, 'Drawing frame 5040 of 25200')
    await new Promise((r) => setTimeout(r, 10))
    assert.equal(signal.aborted, true)
    await tr.end('cancelled')
    endExportJob(signal)
    const last = writes[writes.length - 1]
    assert.equal(last.state, 'cancelled')
    assert.equal(last.output, 'C:\\p\\cikti\\osmanli.mp4')
    // Nothing written after the end.
    const n = writes.length
    tr.progress(0.3, 'late')
    await tr.end('done')
    assert.equal(writes.length, n)
  } finally {
    delete g.window
  }
})
