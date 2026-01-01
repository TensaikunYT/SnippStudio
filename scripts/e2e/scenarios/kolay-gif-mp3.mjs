// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// Worker "kolay", item 1 (SnippStudio KOLAY-PLAN.md): the GIF and the MP3.
//   - The export window has a GIF output of its own: width (480 px first, none
//     wider than the frame) and frame rate (15 fps first); its line says the
//     size; a long GIF is said to be large.
//   - GIF and MP3 ticked together, a range of 1–3 s: two files, one name, one
//     save window. ffprobe opens both: the GIF is 480 × 270, about 2 s, its
//     frames change; the MP3 is MP3, stereo, about 2 s.
//   - 1366 × 768 and 1920 × 1080, English and Turkish: the window's GIF parts
//     whole. Screenshots to tasarim\karsilastirma\kolay when SNIPP_SCREENS_KOLAY
//     is set, else to e2e-sonuc\ekranlar-kolay.
import { existsSync, mkdirSync, rmSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { APP_DIR } from '../app.mjs'
import { ffmpegBin, TESTDATA } from '../media.mjs'
export const name = 'kolay-gif-mp3'
export const timeoutMs = 300_000

function ff(args) {
  const r = spawnSync(ffmpegBin('ffmpeg'), ['-v', 'error', '-y', ...args], { encoding: 'utf8', windowsHide: true, maxBuffer: 1 << 28 })
  if (r.status !== 0) throw new Error('ffmpeg: ' + r.stderr)
  return r
}
function probe(file, args) {
  const r = spawnSync(ffmpegBin('ffprobe'), ['-v', 'error', ...args, '-of', 'json', file], { encoding: 'utf8', windowsHide: true })
  if (r.status !== 0) throw new Error('ffprobe: ' + r.stderr)
  return JSON.parse(r.stdout)
}

async function tickOnly(c, kinds) {
  for (const k of ['video', 'gif', 'sound', 'frame']) {
    const on = await c.run((id) => document.querySelector(`[data-testid="export.out.${id}"]`)?.checked ?? null, k)
    if (on === null) continue
    if (on !== kinds.includes(k)) await c.click(`export.out.${k}`)
  }
}

/** The window's GIF parts as they are on screen: their words not cut. */
const seen = () => {
  const q = (id) => document.querySelector(`[data-testid="${id}"]`)
  const cut = (el) => !!el && el.scrollWidth > el.clientWidth + 1
  const dlg = q('dialog.export')?.getBoundingClientRect()
  const parts = ['export.out.gif', 'export.gif.width', 'export.gif.fps', 'export.file.gif', 'export.gif.long', 'export.size'].map(q).filter(Boolean)
  return {
    gifLine: q('export.file.gif')?.textContent ?? null,
    long: q('export.gif.long')?.textContent ?? null,
    width: q('export.gif.width')?.value ?? null,
    fps: q('export.gif.fps')?.value ?? null,
    widths: [...document.querySelectorAll('[data-testid="export.gif.width"] option')].map((o) => o.value),
    start: q('export.start')?.textContent ?? null,
    cut: parts.filter((e) => cut(e) || [...e.querySelectorAll('span,label')].some(cut)).map((e) => e.dataset.testid),
    inside: !!dlg && dlg.left >= 0 && dlg.top >= 0 && dlg.right <= window.innerWidth && dlg.bottom <= window.innerHeight,
    root: [document.documentElement.scrollTop, document.documentElement.scrollHeight - document.documentElement.clientHeight]
  }
}

export async function run({ c, app, lib, work, out }) {
  const { assert } = lib
  const dir = process.env.SNIPP_SCREENS_KOLAY ? join(APP_DIR, '..', 'tasarim', 'karsilastirma', 'kolay') : join(out, 'ekranlar-kolay')
  mkdirSync(dir, { recursive: true })
  const outDir = join(TESTDATA, 'cikti', 'kolay')
  rmSync(outDir, { recursive: true, force: true })
  mkdirSync(outDir, { recursive: true })
  // 20 s of a moving test picture with a tone.
  const src = join(work, 'moving.mp4')
  ff(['-f', 'lavfi', '-i', 'testsrc2=size=1280x720:rate=30:duration=20', '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000:duration=20', '-ac', '2', '-shortest', '-c:v', 'libx264', '-crf', '20', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '192k', src])
  const [asset] = await lib.seedAssets(app, c, [src])
  await c.run((id) => {
    const S = window.__store
    const p = structuredClone(S.getState().project)
    p.settings = { ...p.settings, width: 1280, height: 720, fps: 30 }
    p.tracks = [{ id: 'V1', kind: 'video', name: 'V1', clipIds: ['m'] }, { id: 'A1', kind: 'audio', name: 'A1', clipIds: [] }]
    p.clips = { m: { id: 'm', assetId: id, trackId: 'V1', start: 0, inPoint: 0, duration: 20, transform: { x: 640, y: 360, scale: 1, rotation: 0 }, volume: 1 } }
    p.captions = []
    p.name = 'kolay'
    S.getState().loadProject(p)
  }, asset.id)

  try {
    // ---- the window: GIF's own part, its defaults ---------------------------------
    await c.click('topbar.export')
    await c.waitId('dialog.export')
    await tickOnly(c, ['gif', 'sound'])
    await c.select('export.sound-format', 'mp3')
    let s = await c.run(seen)
    assert.equal(s.width, '480', 'the GIF is 480 px wide first')
    assert.equal(s.fps, '15', 'at 15 fps first')
    assert.deepEqual(s.widths, ['240', '320', '480', '640', '800'], 'the widths of a 1280 px frame')
    assert.match(s.gifLine, /GIF · 480 × 270 · 15 fps · no sound/)
    // The whole 20 s: a long GIF is said to be large.
    assert.match(s.long ?? '', /^A GIF this long is large \(about [\d.,]+ MB\)/, `the long-GIF line (${s.long})`)
    for (const [w, h] of [[1366, 768], [1920, 1080]]) {
      await c.send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: false })
      for (const lang of ['en', 'tr']) {
        await c.st((st, l) => st.setUiLang(l), lang)
        await c.sleep(300)
        s = await c.run(seen)
        assert.deepEqual(s.cut, [], `${w} ${lang}: nothing of the GIF part is cut (${JSON.stringify(s)})`)
        assert.ok(s.inside, `${w} ${lang}: the window inside the screen`)
        assert.deepEqual(s.root, [0, 0])
        if (lang === 'tr') assert.match(s.gifLine, /GIF · 480 × 270 · 15 fps · sessiz/)
        await c.shot(join(dir, `01-gif-mp3-uzun-${w}-${lang}.png`))
      }
    }
    await c.send('Emulation.setDeviceMetricsOverride', { width: 1920, height: 1080, deviceScaleFactor: 1, mobile: false })
    await c.st((st) => st.setUiLang('en'))

    // ---- 1–3 s: no warning; GIF and MP3 written beside each other ----------------
    await c.click('export.range.inout')
    await c.fill('export.range.in', '1', { enter: true })
    await c.fill('export.range.out', '3', { enter: true })
    await c.waitFor('the long line gone', async () => (await c.run(seen)).long === null)
    for (const [w, h] of [[1366, 768], [1920, 1080]]) {
      await c.send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: false })
      for (const lang of ['en', 'tr']) {
        await c.st((st, l) => st.setUiLang(l), lang)
        await c.sleep(300)
        s = await c.run(seen)
        assert.deepEqual(s.cut, [], `${w} ${lang}: nothing cut (short range)`)
        await c.shot(join(dir, `02-gif-mp3-aralik-${w}-${lang}.png`))
      }
    }
    await c.send('Emulation.setDeviceMetricsOverride', { width: 1920, height: 1080, deviceScaleFactor: 1, mobile: false })
    await c.st((st) => st.setUiLang('en'))
    assert.equal((await c.run(seen)).start, 'Export 2 files', 'two outputs')
    const gifFile = join(outDir, 'kolay.gif')
    const mp3File = join(outDir, 'kolay.mp3')
    await lib.exportTo(c, app, gifFile)
    await c.click('export.start')
    await c.waitGone('dialog.export')
    await c.waitFor('both files', async () => {
      const st = await c.st((s) => s.exportStatus)
      if (st?.error) throw new Error('export failed: ' + st.error)
      return existsSync(gifFile) && existsSync(mp3File) && statSync(mp3File).size > 1000 && st?.done
    }, 180000, 250)
    // (The last job done: the MP3 after the GIF.)
    await c.sleep(500)

    const g = probe(gifFile, ['-count_frames', '-show_entries', 'stream=codec_name,width,height,nb_read_frames:format=duration'])
    const gs = g.streams[0]
    console.log(`    GIF: ${gs.codec_name} ${gs.width}x${gs.height}, ${gs.nb_read_frames} frames, ${g.format.duration} s, ${statSync(gifFile).size} bytes`)
    assert.equal(gs.codec_name, 'gif')
    assert.equal(gs.width, 480)
    assert.equal(gs.height, 270)
    assert.ok(Math.abs(Number(g.format.duration) - 2) <= 0.08, `the GIF lasts 2 s (${g.format.duration})`)
    assert.ok(Number(gs.nb_read_frames) >= 25 && Number(gs.nb_read_frames) <= 30, `about 30 frames at 15 fps (${gs.nb_read_frames})`)
    // Its pictures move (testsrc2 changes every frame): the first and the last differ.
    const frame = (n) => spawnSync(ffmpegBin('ffmpeg'), ['-v', 'error', '-i', gifFile, '-vf', `select=eq(n\\,${n}),scale=16:9,format=gray`, '-frames:v', '1', '-f', 'rawvideo', '-'], { windowsHide: true, maxBuffer: 1 << 24 }).stdout
    const a = frame(0)
    const b = frame(Number(gs.nb_read_frames) - 1)
    assert.equal(a.length, 144)
    assert.ok(!a.equals(b), 'the first and last frames differ')

    const m = probe(mp3File, ['-show_entries', 'stream=codec_name,channels,sample_rate:format=duration'])
    const ms = m.streams[0]
    console.log(`    MP3: ${ms.codec_name} ${ms.channels} ch ${ms.sample_rate} Hz, ${m.format.duration} s, ${statSync(mp3File).size} bytes`)
    assert.equal(ms.codec_name, 'mp3')
    assert.equal(ms.channels, 2)
    assert.ok(Math.abs(Number(m.format.duration) - 2) <= 0.1, `the MP3 lasts 2 s (${m.format.duration})`)
    // The tone is there.
    const pcm = spawnSync(ffmpegBin('ffmpeg'), ['-v', 'error', '-i', mp3File, '-ac', '1', '-ar', '48000', '-f', 'f32le', '-'], { windowsHide: true, maxBuffer: 1 << 26 }).stdout
    const x = new Float32Array(pcm.buffer, pcm.byteOffset, Math.floor(pcm.length / 4))
    let peak = 0
    for (let i = 4800; i < x.length - 4800; i++) peak = Math.max(peak, Math.abs(x[i]))
    assert.ok(peak > 0.1, `the MP3 carries the tone (peak ${peak.toFixed(3)})`)
  } finally {
    await c.send('Emulation.setDeviceMetricsOverride', { width: 1920, height: 1080, deviceScaleFactor: 1, mobile: false }).catch(() => null)
    await c.st((st) => st.setUiLang('en')).catch(() => null)
  }
}
