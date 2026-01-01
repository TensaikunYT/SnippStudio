// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// Phase Ç3a: the export measurements' own sources, made with ffmpeg into
// <SnippStudio>\testdata\kaynak (outside the repository). All synthetic, so
// what is in them is known exactly.
//
//   sayac-1080p60.mp4   10 s, 1920×1080, 60 fps, H.264 long GOP (key frame every
//                       4 s), a 440 Hz tone; the frame number burnt in as a
//                       12-bit pixel code along the top (block b white = bit b)
//   sayac-2160p30.mp4   10 s, 3840×2160, 30 fps, the same (key frame every 4 s)
//   sayac-2997.mp4      10 s, 1280×720, 30000/1001 fps, the same
//   sayac-25.mp4        10 s, 1280×720, 25 fps, the same
//   izgara-8k.png       7680×4320: the top half a grid of 1 px white lines every
//                       64 px on black; the bottom half a black / white checker
//                       of 480 px squares turned 5° (sharp edges at every
//                       sub-pixel phase: a slanted-edge measure)
//   zoneplate-4000.png  4000×4000 zone plate, 0.5 cycles/px at its edge
//
// node scripts/export-rig/sources.mjs [--force]
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

export const APP_DIR = fileURLToPath(new URL('../..', import.meta.url))
export const TESTDATA = process.env.SNIPP_TESTDATA ?? join(APP_DIR, '..', 'testdata')
export const KAYNAK = join(TESTDATA, 'kaynak')
export const CIKTI = join(TESTDATA, 'cikti')
const FF_DIR = 'C:\\ffmpeg\\bin'
export const ff = (name) => (existsSync(join(FF_DIR, name + '.exe')) ? join(FF_DIR, name + '.exe') : name)
const FONT = 'C\\:/Windows/Fonts/arial.ttf'

function run(args) {
  const r = spawnSync(ff('ffmpeg'), ['-v', 'error', '-y', ...args], { encoding: 'utf8', windowsHide: true, maxBuffer: 1 << 26 })
  if (r.status !== 0) throw new Error('ffmpeg failed: ' + args.join(' ') + '\n' + r.stderr)
}

/** The counter's code: 12 blocks across the top, each `bw` wide and `bh`
 *  high; block b is white when bit b of the frame number is set. */
export const CODE_BITS = 12
export const codeBlock = (w, h) => ({ bw: Math.round(w / CODE_BITS), bh: Math.round(h / 12) })

export const SOURCES = {
  'sayac-1080p60.mp4': { w: 1920, h: 1080, rate: '60', gop: 240 },
  'sayac-2160p30.mp4': { w: 3840, h: 2160, rate: '30', gop: 120 },
  'sayac-2997.mp4': { w: 1280, h: 720, rate: '30000/1001', gop: 120 },
  'sayac-25.mp4': { w: 1280, h: 720, rate: '25', gop: 100 }
}

function counter(file, { w, h, rate, gop }) {
  const { bw, bh } = codeBlock(w, h)
  const code = `color=black:size=${w}x${bh}:rate=${rate}:duration=10,format=gray,geq=lum='255*mod(floor(N/pow(2\\,floor(X/${bw})))\\,2)'`
  run([
    '-f', 'lavfi', '-i', `testsrc2=size=${w}x${h}:rate=${rate}:duration=10`,
    '-f', 'lavfi', '-i', code,
    '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000:duration=10',
    '-filter_complex', `[0][1]overlay=0:0,drawtext=fontfile='${FONT}':text='%{n}':fontsize=${Math.round(h / 8)}:fontcolor=white:box=1:boxcolor=black:x=(w-tw)/2:y=(h-th)/2,format=yuv420p[v]`,
    '-map', '[v]', '-map', '2',
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '18', '-g', String(gop), '-keyint_min', String(gop), '-sc_threshold', '0',
    '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709',
    '-c:a', 'aac', '-b:a', '128k', '-shortest', file
  ])
}

const FILM_HTML = "<!doctype html>\n<html>\n<head>\n<meta charset=\"utf-8\">\n<title>kod-izgara</title>\n<style>html,body{margin:0;background:#000}canvas{display:block}</style>\n</head>\n<body>\n<canvas id=\"c\" width=\"1920\" height=\"1080\"></canvas>\n<script>\n// Phase Ç3a, decision 10: a code film of sharp slanted edges (a checker of\n// 120 px squares turned 5°), declared 1920×1080, to measure how soft it\n// comes out of a 4K export (drawn at its own size, then enlarged).\nwindow.__config = { width: 1920, height: 1080, fps: 30, duration: 10 };\nconst c = document.getElementById('c'), g = c.getContext('2d');\nwindow.renderOut = function (t) {\n  g.setTransform(1, 0, 0, 1, 0, 0);\n  g.fillStyle = '#000'; g.fillRect(0, 0, 1920, 1080);\n  g.translate(960, 540); g.rotate(5 * Math.PI / 180);\n  g.fillStyle = '#fff';\n  for (let y = -15; y < 15; y++) for (let x = -15; x < 15; x++) if ((x + y) & 1) g.fillRect(x * 120, y * 120, 120, 120);\n};\nwindow.renderOut(0);\nwindow.READY = true;\n</script>\n</body>\n</html>\n"

export function makeSources(force = false) {
  mkdirSync(KAYNAK, { recursive: true })
  for (const [name, spec] of Object.entries(SOURCES)) {
    const f = join(KAYNAK, name)
    if (force || !existsSync(f)) {
      console.log('making', name)
      counter(f, spec)
    }
  }
  const grid = join(KAYNAK, 'izgara-8k.png')
  if (force || !existsSync(grid)) {
    console.log('making izgara-8k.png')
    // Top half: 1 px lines every 64 px. Bottom half: 480 px checker.
    run(['-f', 'lavfi', '-i', 'color=black:size=7680x4320:d=1', '-vf', "format=gray,geq=lum='if(lt(Y\\,2160)\\,255*gt(eq(mod(X\\,64)\\,32)+eq(mod(Y\\,64)\\,32)\\,0)\\,255*mod(floor((X*0.996195+Y*0.087156)/480)+floor((Y*0.996195-X*0.087156)/480)\\,2))'", '-frames:v', '1', grid])
  }
  // Files this computer may have no decoder for (decision 6): ProRes 422 and
  // HEVC Main 10.
  const prores = join(KAYNAK, 'cozulmez-prores.mov')
  if (force || !existsSync(prores)) run(['-f', 'lavfi', '-i', 'testsrc2=size=640x360:rate=30:duration=3', '-c:v', 'prores_ks', '-profile:v', '2', prores])
  const hevc = join(KAYNAK, 'hevc10.mp4')
  if (force || !existsSync(hevc)) run(['-f', 'lavfi', '-i', 'testsrc2=size=640x360:rate=30:duration=3', '-c:v', 'libx265', '-pix_fmt', 'yuv420p10le', '-tag:v', 'hvc1', hevc])
  // A code film of slanted edges declared 1920×1080 (decision 10).
  const film = join(KAYNAK, 'kod-izgara')
  if (force || !existsSync(join(film, 'index.html'))) {
    mkdirSync(film, { recursive: true })
    writeFileSync(join(film, 'index.html'), FILM_HTML)
  }
  const zone = join(KAYNAK, 'zoneplate-4000.png')
  if (force || !existsSync(zone)) {
    console.log('making zoneplate-4000.png')
    run(['-f', 'lavfi', '-i', 'color=black:size=4000x4000:d=1', '-vf', "format=gray,geq=lum='128+127*cos(PI*((X-2000)*(X-2000)+(Y-2000)*(Y-2000))/4000)'", '-frames:v', '1', zone])
  }
  makeAudioSources(force)
}

// Phase Ç3b: the sound's own sources.
//   ton-997.wav, ton-1503.wav  6 s, 48 kHz stereo, a sine at full scale (0.999)
//   ton-440.wav                20 s, 48 kHz stereo, a 440 Hz sine at 0.5 (cut
//                              at arbitrary phases: a hard cut clicks)
//   supurme-44k.wav            10 s, 44.1 kHz stereo, a log sweep 20 Hz–20 kHz
//                              at 0.5 (resampling images)
export const AUDIO_SOURCES = {
  'ton-997.wav': ['aevalsrc=0.999*sin(2*PI*997*t)|0.999*sin(2*PI*997*t):s=48000:d=6'],
  'ton-1503.wav': ['aevalsrc=0.999*sin(2*PI*1503*t)|0.999*sin(2*PI*1503*t):s=48000:d=6'],
  'ton-440.wav': ['aevalsrc=0.5*sin(2*PI*440*t)|0.5*sin(2*PI*440*t):s=48000:d=20'],
  'supurme-44k.wav': ['aevalsrc=0.5*sin(2*PI*20*10/log(1000)*(exp(t*log(1000)/10)-1))|0.5*sin(2*PI*20*10/log(1000)*(exp(t*log(1000)/10)-1)):s=44100:d=10']
}

export function makeAudioSources(force = false) {
  mkdirSync(KAYNAK, { recursive: true })
  for (const [name, [src]] of Object.entries(AUDIO_SOURCES)) {
    const f = join(KAYNAK, name)
    if (force || !existsSync(f)) {
      console.log('making', name)
      run(['-f', 'lavfi', '-i', src, '-c:a', 'pcm_s16le', f])
    }
  }
}

/** Decision 4 (sync): `minutes` of a black 320×180 picture at 60 fps with a
 *  one-frame white flash at every whole second, and a 1 ms click at every
 *  whole second (48 kHz, or 44.1 kHz for `-44k`). Big: made when asked,
 *  deleted after the measurement. */
export function makeFlashClick(minutes = 30, rate = 48000) {
  mkdirSync(KAYNAK, { recursive: true })
  const name = `parlama-tik-${minutes}dk${rate === 44100 ? '-44k' : ''}.mp4`
  const f = join(KAYNAK, name)
  if (existsSync(f)) return f
  console.log('making', name)
  const d = minutes * 60
  run([
    '-f', 'lavfi', '-i', `color=black:size=320x180:rate=60:duration=${d},drawbox=c=white:t=fill:enable='eq(mod(n\\,60)\\,0)',format=yuv420p`,
    '-f', 'lavfi', '-i', `aevalsrc='if(lt(mod(t\\,1)\\,0.001)\\,0.8\\,0)':s=${rate}:d=${d}`,
    '-map', '0', '-map', '1',
    '-c:v', 'libx264', '-preset', 'ultrafast', '-g', '120',
    '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709',
    '-c:a', 'aac', '-b:a', '192k', '-ac', '1', '-shortest', f
  ])
  return f
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) makeSources(process.argv.includes('--force'))
