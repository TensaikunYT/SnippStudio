// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// The user's list, items 5 and 6 (SnippStudio KLISTE-PLAN.md).
//   5. A bitrate typed by hand: Quality → Custom opens a Mb/s field; it takes
//      a typed number, keeps it inside 1–300, and the file comes out near it
//      (ffprobe, a picture full of noise so the encoder has to spend it).
//   6. A frame rate other than the project's: a 30 fps project exported at
//      25 fps is 25 fps, as long as the project, frame for frame, and its
//      sound still lands on its picture (a white frame and a click on every
//      whole second of the source: the white frame and the click come out
//      within a frame of each other). The frame rates offered: 23.976 … 60,
//      25 among them, in the export window and the project's settings.
import { existsSync, mkdirSync, rmSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { ffmpegBin, TESTDATA } from '../media.mjs'
export const name = 'kliste-export'
export const timeoutMs = 300_000

function ff(args) {
  const r = spawnSync(ffmpegBin('ffmpeg'), ['-v', 'error', '-y', ...args], { encoding: 'utf8', windowsHide: true, maxBuffer: 1 << 28 })
  if (r.status !== 0) throw new Error('ffmpeg: ' + r.stderr)
  return r
}
function probe(file, entries, stream = 'v:0') {
  const r = spawnSync(ffmpegBin('ffprobe'), ['-v', 'error', '-select_streams', stream, '-count_frames', '-show_entries', entries, '-of', 'json', file], { encoding: 'utf8', windowsHide: true })
  return JSON.parse(r.stdout)
}

async function exportNow(c, app, lib, file) {
  rmSync(file, { force: true })
  // (The window remembers its place after the first export of the scenario:
  // the second one types the name instead of answering a save window.)
  await lib.exportTo(c, app, file)
  await c.click('export.start')
  await c.waitGone('dialog.export')
  await c.waitFor('the export done', async () => {
    const st = await c.st((s) => s.exportStatus)
    if (st?.error) throw new Error('export failed: ' + st.error)
    return st?.done && existsSync(file) && statSync(file).size > 1000
  }, 180000, 250)
}

const valueOf = (c, id) => c.run((id) => document.querySelector(`[data-testid="${id}"]`)?.value ?? null, id)
async function typeInto(c, id, text) {
  await c.click(id)
  await c.key('a', ['ctrl'])
  await c.type(text)
  await c.key('Enter')
}

export async function run({ c, app, lib, work }) {
  const { assert } = lib
  const out = join(TESTDATA, 'cikti')
  mkdirSync(out, { recursive: true })
  // Noise (the bitrate is spent), and flashes with clicks (the sync).
  const noisy = join(work, 'noise.mp4')
  ff(['-f', 'lavfi', '-i', 'testsrc2=size=1280x720:rate=30:duration=4', '-vf', 'noise=alls=60:allf=t+u', '-c:v', 'libx264', '-crf', '8', '-pix_fmt', 'yuv420p', noisy])
  const flash = join(work, 'flash.mp4')
  ff(['-f', 'lavfi', '-i', "color=c=black:s=640x360:r=30:d=4,geq=lum='if(eq(mod(N\\,30)\\,0)*gt(N\\,0)\\,235\\,16)':cb=128:cr=128",
    '-f', 'lavfi', '-i', "aevalsrc=if(lt(mod(t\\,1)\\,0.005)*gt(t\\,0.5)\\,0.8*sin(2*PI*2000*t)\\,0):s=48000:d=4", '-shortest', '-c:v', 'libx264', '-crf', '12', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '192k', flash])
  const [noise, fl] = await lib.seedAssets(app, c, [noisy, flash])

  // ---- 5. the bitrate typed by hand ---------------------------------------------
  await c.run((id) => {
    const S = window.__store
    const p = structuredClone(S.getState().project)
    p.settings = { ...p.settings, width: 1280, height: 720, fps: 30 }
    p.tracks = [{ id: 'V1', kind: 'video', name: 'V1', clipIds: ['n'] }, { id: 'A1', kind: 'audio', name: 'A1', clipIds: [] }]
    p.clips = { n: { id: 'n', assetId: id, trackId: 'V1', start: 0, inPoint: 0, duration: 4, transform: { x: 640, y: 360, scale: 1, rotation: 0 }, volume: 1 } }
    p.captions = []
    S.getState().loadProject(p)
  }, noise.id)
  await c.click('topbar.export')
  await c.waitId('dialog.export')
  await c.click('export.preset.custom')
  assert.equal(await c.has('export.mbps'), false, 'no Mb/s field until Custom quality')
  await c.select('export.quality', 'custom')
  await c.waitId('export.mbps')
  await typeInto(c, 'export.mbps', '500')
  assert.match(await valueOf(c, 'export.mbps'), /^300\b/, 'above the top: 300 Mb/s')
  await typeInto(c, 'export.mbps', '0')
  assert.match(await valueOf(c, 'export.mbps'), /^1\b/, 'below the bottom: 1 Mb/s')
  await typeInto(c, 'export.mbps', '6')
  assert.match(await valueOf(c, 'export.mbps'), /^6\b/, 'typed: 6 Mb/s')
  const summary = await c.run(() => document.querySelector('[data-testid="export.summary"]')?.textContent ?? '')
  assert.match(summary, /(^|\D)6([.,]0)? Mb\/s/, `the summary says 6 Mb/s (${summary})`)
  const mp4 = join(out, 'kliste-mbps.mp4')
  await exportNow(c, app, lib, mp4)
  const v = probe(mp4, 'stream=bit_rate,nb_read_frames,avg_frame_rate').streams[0]
  const mbps = Number(v.bit_rate) / 1e6
  console.log(`    typed 6 Mb/s: the file's video ${mbps.toFixed(2)} Mb/s`)
  // (A variable-rate encoder on four seconds of pure noise: within 30 %.)
  assert.ok(mbps > 6 * 0.7 && mbps < 6 * 1.3, `the file's video is ${mbps.toFixed(2)} Mb/s, typed 6`)
  rmSync(mp4, { force: true })
  // Opened again: the typed bitrate is still there (the preset was Custom).
  await c.click('topbar.export')
  await c.waitId('dialog.export')
  const again = { quality: await valueOf(c, 'export.quality'), mbps: (await c.has('export.mbps')) ? await valueOf(c, 'export.mbps') : null }
  console.log(`    window opened again: quality ${again.quality}, Mb/s ${again.mbps}`)
  assert.equal(again.quality, 'custom', 'the window opens again on the custom bitrate')
  assert.match(again.mbps ?? '', /^6\b/, 'with 6 Mb/s in it')
  await c.click('export.cancel')
  await c.waitGone('dialog.export')

  // ---- 6. 25 fps out of a 30 fps project -----------------------------------------
  await c.run((id) => {
    const S = window.__store
    const p = structuredClone(S.getState().project)
    p.settings = { ...p.settings, width: 640, height: 360, fps: 30 }
    p.tracks = [{ id: 'V1', kind: 'video', name: 'V1', clipIds: ['f'] }, { id: 'A1', kind: 'audio', name: 'A1', clipIds: [] }]
    p.clips = { f: { id: 'f', assetId: id, trackId: 'V1', start: 0, inPoint: 0, duration: 4, transform: { x: 320, y: 180, scale: 1, rotation: 0 }, volume: 1 } }
    p.captions = []
    S.getState().loadProject(p)
  }, fl.id)
  await c.click('topbar.export')
  await c.waitId('dialog.export')
  const offered = await c.run(() => [...document.querySelectorAll('[data-testid="export.fps"] option')].map((o) => Number(o.value)))
  for (const want of [24000 / 1001, 24, 25, 30000 / 1001, 30, 50, 60000 / 1001, 60]) assert.ok(offered.some((f) => Math.abs(f - want) < 1e-6), `${want} fps offered (${offered.join(', ')})`)
  await c.click('export.preset.custom')
  await c.select('export.quality', '0.12')
  await c.select('export.fps', '25')
  const f25 = join(out, 'kliste-25fps.mp4')
  await exportNow(c, app, lib, f25)
  const s = probe(f25, 'stream=nb_read_frames,avg_frame_rate,duration').streams[0]
  assert.equal(s.avg_frame_rate, '25/1', `25 fps (${s.avg_frame_rate})`)
  assert.equal(Number(s.nb_read_frames), 100, `4 s at 25 fps: 100 frames (${s.nb_read_frames})`)
  // The white frames, and the clicks, from the file.
  const raw = spawnSync(ffmpegBin('ffmpeg'), ['-v', 'error', '-i', f25, '-vf', 'scale=8:8,format=gray', '-f', 'rawvideo', '-'], { windowsHide: true, maxBuffer: 1 << 26 }).stdout
  const white = []
  for (let k = 0; k * 64 < raw.length; k++) {
    let sum = 0
    for (let i = 0; i < 64; i++) sum += raw[k * 64 + i]
    if (sum / 64 > 128 && (white.length === 0 || k - white.at(-1).k > 5)) white.push({ k, t: k / 25 })
  }
  const pcm = spawnSync(ffmpegBin('ffmpeg'), ['-v', 'error', '-i', f25, '-ac', '1', '-ar', '48000', '-f', 'f32le', '-'], { windowsHide: true, maxBuffer: 1 << 26 }).stdout
  const x = new Float32Array(pcm.buffer, pcm.byteOffset, Math.floor(pcm.length / 4))
  const clicks = []
  let quiet = 0
  for (let i = 0; i < x.length; i++) {
    const loud = Math.abs(x[i]) > 0.05
    if (loud && quiet > 2400) clicks.push(i / 48000)
    quiet = loud ? 0 : quiet + 1
  }
  console.log(`    25 fps: ${s.nb_read_frames} frames; white at ${white.map((w) => w.t.toFixed(3)).join(', ')} s; clicks at ${clicks.map((t) => t.toFixed(3)).join(', ')} s`)
  assert.deepEqual(white.map((w) => w.k), [25, 50, 75], 'the white frames at 1, 2, 3 s are frames 25, 50, 75')
  assert.equal(clicks.length, 3, 'three clicks')
  for (const [i, w] of white.entries()) assert.ok(Math.abs(clicks[i] - w.t) <= 1 / 25, `the click at ${clicks[i].toFixed(3)} s with its white frame at ${w.t.toFixed(3)} s`)
  rmSync(f25, { force: true })
}
