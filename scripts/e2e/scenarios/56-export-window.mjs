// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// Phase Ç3b, decision 9: the export window. Its presets set the size and the
// loudness (YouTube 4K: 3840 × 2160 of a 1080p project, −14 LUFS); a closed
// preset says why on its tip (Shorts / Reels in a landscape project). The
// in and out points (I / O on the timeline) are its range: the file is that
// long. Sound only writes the sound. An HDR source is said before the export
// (decision 7) and badged in the media panel.
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { E2E_MEDIA, ffmpegBin, probeDuration, probeStreams, TESTDATA } from '../media.mjs'
export const name = 'export-window'

/** The export window's outputs are ticks (DENEME-4, worker W): only `kind` ticked. */
async function only(c, kind) {
  for (const k of ['video', 'sound', 'frame']) {
    const on = await c.run((id) => document.querySelector(`[data-testid="export.out.${id}"]`)?.checked ?? null, k)
    if (on === null) continue
    if (on !== (k === kind)) await c.click(`export.out.${k}`)
  }
}

/** An HLG HEVC file whose colr box names its transfer (as a phone's does). */
function hlgSource() {
  const f = join(E2E_MEDIA, 'hdr-hlg.mp4')
  if (existsSync(f)) return f
  spawnSync(ffmpegBin('ffmpeg'), ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc2=size=640x360:rate=30:duration=2', '-c:v', 'libx265', '-pix_fmt', 'yuv420p10le', '-tag:v', 'hvc1', '-x265-params', 'colorprim=bt2020:transfer=arib-std-b67:colormatrix=bt2020nc', '-color_primaries', 'bt2020', '-color_trc', 'arib-std-b67', '-colorspace', 'bt2020nc', '-movflags', '+write_colr', f], { windowsHide: true })
  const b = readFileSync(f)
  const i = b.indexOf('colrnclx')
  if (i >= 0) {
    b.writeUInt16BE(9, i + 8)
    b.writeUInt16BE(18, i + 10)
    writeFileSync(f, b)
  }
  return f
}

async function exportNow(c, app, lib, file) {
  rmSync(file, { force: true })
  await lib.exportTo(c, app, file)
  await c.click('export.start')
  await c.waitGone('dialog.export')
  await c.waitFor('the export done', async () => {
    const st = await c.st((s) => s.exportStatus)
    if (st?.error) throw new Error('export failed: ' + st.error)
    return st?.done && existsSync(file) && statSync(file).size > 1000
  }, 120000, 250)
}

export async function run({ c, app, media, lib }) {
  const { assert } = lib
  const out = join(TESTDATA, 'cikti')
  mkdirSync(out, { recursive: true })
  const [other] = await lib.seedAssets(app, c, [media.other])
  await lib.seedTimeline(c, [other.id])

  // The presets: YouTube 4K sets 3840 × 2160 and the loudness; Shorts /
  // Reels is closed in a landscape project, its reason on its tip.
  await c.click('topbar.export')
  await c.waitId('dialog.export')
  await c.click('export.preset.yt4k')
  assert.equal(await c.run(() => document.querySelector('[data-testid="export.resolution"]').value), '2', 'YouTube 4K: twice the 1080p project')
  assert.equal(await c.run(() => document.querySelector('[data-testid="export.normalize"]').checked), true, 'loudness on')
  const shorts = await c.run(() => { const b = document.querySelector('[data-testid="export.preset.shorts"]'); return { disabled: b.disabled, tip: b.title } })
  assert.equal(shorts.disabled, true)
  assert.match(shorts.tip, /landscape/, 'the reason on its tip')
  // A field changed by hand: Custom.
  await c.select('export.fps', '25')
  assert.equal(await c.run(() => document.querySelector('[data-testid="export.preset.custom"]').getAttribute('aria-checked')), 'true')
  await c.click('export.cancel')
  await c.waitGone('dialog.export')

  // In at 1 s, out at 3 s (I / O at the playhead), drawn on the timeline.
  await c.st((s) => s.setTime(1))
  await c.key('i')
  await c.st((s) => s.setTime(3))
  await c.key('o')
  assert.ok((await c.has('timeline.export-in')) && (await c.has('timeline.export-out')), 'the in and out points on the timeline')
  await c.click('topbar.export')
  await c.waitId('dialog.export')
  await c.click('export.preset.yt1080')
  assert.equal(await c.run(() => document.querySelector('[data-testid="export.range.inout"]').getAttribute('aria-checked')), 'true', 'the range is in to out')
  if ((await c.run(() => document.querySelector('[data-testid="export.youtube"]')?.checked)) === true) await c.click('export.youtube')
  const mp4 = join(out, 'e2e-window.mp4')
  await exportNow(c, app, lib, mp4)
  const d = probeDuration(mp4)
  assert.ok(lib.near(d, 2, 0.08), `in to out: 2 s (${d})`)
  const v = probeStreams(mp4).find((s) => s.codec_type === 'video')
  assert.deepEqual([v.width, v.height], [1920, 1080], 'YouTube 1080p')
  rmSync(mp4, { force: true })

  // Sound only (WAV), the same range.
  await c.click('topbar.export')
  await c.waitId('dialog.export')
  await only(c, 'sound')
  await c.select('export.sound-format', 'wav')
  const wav = join(out, 'e2e-window.wav')
  await exportNow(c, app, lib, wav)
  const streams = probeStreams(wav)
  assert.equal(streams.length, 1)
  assert.equal(streams[0].codec_type, 'audio')
  assert.ok(lib.near(probeDuration(wav), 2, 0.05), 'the sound of in to out')
  rmSync(wav, { force: true })

  // An HDR source: badged, and said in the window before the export.
  const [hlg] = await lib.seedAssets(app, c, [hlgSource()])
  await lib.seedTimeline(c, [hlg.id])
  await c.waitFor('the HDR badge', () => c.has('media.hdr'), 8000)
  await c.click('topbar.export')
  await c.waitId('dialog.export')
  await c.click('export.range.all')
  await c.waitFor('the HDR sentence', () => c.has('export.hdr'), 5000)
  await c.click('export.cancel')
  console.log('     presets, closed Shorts with its reason, in/out 2 s MP4 and WAV, HDR said')
}
