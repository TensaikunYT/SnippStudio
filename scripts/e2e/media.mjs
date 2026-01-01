// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// The end-to-end tests' own small media, made once with ffmpeg into
// <SnippStudio>\testdata\e2e (outside the repository). All of it is synthetic
// (test patterns, tones, flat cards): what is in it is known exactly.
//
//   talk.mp4     12 s, 640×360 test pattern, a tone that sounds at 0–3, 4.5–8
//                and 9.5–12 s and is silent between (the silence cutter's two gaps)
//   other.mp4    6 s, colour bars, a lower tone throughout
//   numbered/    1.png … 6.png, flat colour cards with their number
//   broll/       bridge.png, cat.png (named for words the subtitles say)
//   talk.srt     four subtitle lines over talk.mp4
//   legacy-hands.snipp  an old project holding narrator hands (opens as a copy)
//   talk1080.mp4 talk.mp4's pattern and sound at 1920×1080 (phase 5b)
//   alpha.webm   VP9 with alpha, 320×180, 4 s (phase 5b; see below)
//   prores4444.mov  ProRes 4444 with alpha, 1 s (phase 5b: refused at import)
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { APP_DIR } from './app.mjs'
import { drawtextFont, ffmpegTool, filmDir, materialDir, testdataDir } from './harness-paths.mjs'

// SNIPP_TESTDATA moves it (phase 10a, S6: a CI runner's own folder).
export const TESTDATA = testdataDir(APP_DIR)
/** The two big code films of the test material, by role (harness-paths.mjs filmDir). */
export const FILM = { portrait: filmDir(TESTDATA, 'portrait'), heavy: filmDir(TESTDATA, 'heavy') }
/** The voice-over project of the test material, by role (harness-paths.mjs materialDir). */
export const VOICEOVER = materialDir(TESTDATA, 'voiceover')
export const E2E_MEDIA = join(TESTDATA, 'e2e')
export const ffmpegBin = (name) => ffmpegTool(name)

function ff(args) {
  const r = spawnSync(ffmpegBin('ffmpeg'), ['-v', 'error', '-y', ...args], { encoding: 'utf8', windowsHide: true })
  if (r.status !== 0) throw new Error('ffmpeg failed: ' + args.join(' ') + '\n' + r.stderr)
}

/** Seconds of a media file (ffprobe). */
export function probeDuration(file) {
  const r = spawnSync(ffmpegBin('ffprobe'), ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', file], { encoding: 'utf8', windowsHide: true })
  return Number(r.stdout.trim())
}

/** Video and audio streams of a file: [{ codec_type, codec_name, width, height }]. */
export function probeStreams(file) {
  const r = spawnSync(ffmpegBin('ffprobe'), ['-v', 'error', '-show_entries', 'stream=codec_type,codec_name,width,height', '-of', 'json', file], { encoding: 'utf8', windowsHide: true })
  return JSON.parse(r.stdout || '{"streams":[]}').streams
}

// Windows' Arial as before; elsewhere the app's own Inter (phase 10a, S5).
const FONT = drawtextFont(APP_DIR)
const COLORS = ['0x2f6fdf', '0xdf8a2f', '0x2fbf6f', '0xbf2f5f', '0x7f4fdf', '0x3fafbf']

export const SPEECH = [[0, 3], [4.5, 8], [9.5, 12]]
export const SUBS = [
  { start: 0.2, end: 2.8, text: 'The cat sat by the window' },
  { start: 4.6, end: 7.8, text: 'then it walked over the bridge' },
  { start: 9.6, end: 11.0, text: 'and came back home' },
  { start: 11.0, end: 11.9, text: 'at night' }
]

const srtTime = (t) => {
  const ms = Math.round(t * 1000)
  const p = (n, w = 2) => String(n).padStart(w, '0')
  return `${p(Math.floor(ms / 3600000))}:${p(Math.floor(ms / 60000) % 60)}:${p(Math.floor(ms / 1000) % 60)},${p(ms % 1000, 3)}`
}

export function makeE2eMedia(force = false) {
  const d = E2E_MEDIA
  mkdirSync(join(d, 'numbered'), { recursive: true })
  mkdirSync(join(d, 'broll'), { recursive: true })
  const talk = join(d, 'talk.mp4')
  if (force || !existsSync(talk)) {
    const on = SPEECH.map(([a, b]) => `between(t,${a},${b})`).join('+')
    ff(['-f', 'lavfi', '-i', 'testsrc2=size=640x360:rate=30:duration=12', '-f', 'lavfi', '-i', `aevalsrc='0.35*sin(2*PI*220*t)*(0.6+0.4*sin(2*PI*4*t))*(${on})':s=48000:d=12`, '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '30', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '96k', '-shortest', talk])
  }
  const other = join(d, 'other.mp4')
  if (force || !existsSync(other)) {
    ff(['-f', 'lavfi', '-i', 'smptebars=size=640x360:rate=30:duration=6', '-f', 'lavfi', '-i', 'sine=frequency=330:sample_rate=48000:duration=6', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '30', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '96k', '-shortest', other])
  }
  for (let i = 1; i <= 6; i++) {
    const f = join(d, 'numbered', `${i}.png`)
    if (force || !existsSync(f)) ff(['-f', 'lavfi', '-i', `color=c=${COLORS[i - 1]}:s=640x360:d=1`, '-vf', `drawtext=fontfile='${FONT}':text='${i}':fontsize=160:fontcolor=white:x=(w-tw)/2:y=(h-th)/2`, '-frames:v', '1', f])
  }
  for (const [name, c] of [['bridge', '0x8a6f4f'], ['cat', '0x4f6f8a']]) {
    const f = join(d, 'broll', `${name}.png`)
    if (force || !existsSync(f)) ff(['-f', 'lavfi', '-i', `color=c=${c}:s=640x360:d=1`, '-vf', `drawtext=fontfile='${FONT}':text='${name}':fontsize=90:fontcolor=white:x=(w-tw)/2:y=(h-th)/2`, '-frames:v', '1', f])
  }
  const srt = join(d, 'talk.srt')
  if (force || !existsSync(srt)) writeFileSync(srt, SUBS.map((s, i) => `${i + 1}\n${srtTime(s.start)} --> ${srtTime(s.end)}\n${s.text}\n`).join('\n'))
  const legacy = join(d, 'legacy-hands.snipp')
  if (force || !existsSync(legacy)) {
    // The shape of a project the daily Snipp wrote with a narrator hand on
    // it: the clip is plain, the "characters" list is what makes it old.
    const project = {
      version: 1, name: 'legacy-hands', settings: { width: 1280, height: 720, fps: 30 }, mode: 'frame',
      tracks: [{ id: 'V1', kind: 'video', name: 'V1', clipIds: ['c1'] }, { id: 'A1', kind: 'audio', name: 'A1', clipIds: [] }],
      clips: { c1: { id: 'c1', assetId: 'a1', trackId: 'V1', start: 0, inPoint: 0, duration: 12, transform: { x: 640, y: 360, scale: 2, rotation: 0 }, volume: 1 } },
      assets: [{ id: 'a1', kind: 'video', name: 'talk.mp4', path: talk, duration: 12, width: 640, height: 360, hasAudio: true }],
      captions: [],
      characters: [{ id: 'h1', kind: 'hand', name: 'Narrator', actions: [{ id: 'x1', time: 1, kind: 'point' }] }]
    }
    writeFileSync(legacy, JSON.stringify(project, null, 1))
  }
  // Phase 5b: talk.mp4 at the project's own size (1920×1080): the video under
  // a transparent clip with no resampling of its own (the paused preview
  // decodes at 1920 wide, the export at the file's size).
  const talk1080 = join(d, 'talk1080.mp4')
  if (force || !existsSync(talk1080)) {
    const on = SPEECH.map(([a, b]) => `between(t,${a},${b})`).join('+')
    ff(['-f', 'lavfi', '-i', 'testsrc2=size=1920x1080:rate=30:duration=12', '-f', 'lavfi', '-i', `aevalsrc='0.35*sin(2*PI*220*t)*(0.6+0.4*sin(2*PI*4*t))*(${on})':s=48000:d=12`, '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '32', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '96k', '-shortest', talk1080])
  }
  // Phase 5b: a VP9 WebM with an alpha channel. Transparent, an opaque blue
  // square whose left edge is at x = 22 + 2 × (frame number from 0; the
  // overlay's own n counts from 1; ffmpeg's decode agrees), so a frame's
  // number can be read off its pixels, a white band at 50 % alpha below it.
  const alphaWebm = join(d, 'alpha.webm')
  if (force || !existsSync(alphaWebm)) {
    ff(['-f', 'lavfi', '-i', 'color=c=black@0.0:s=320x180:r=30:d=4,format=rgba', '-f', 'lavfi', '-i', 'color=c=0x2f6fdf:s=80x80:r=30:d=4,format=rgba', '-f', 'lavfi', '-i', 'color=c=white@0.5:s=320x30:r=30:d=4,format=rgba',
      '-filter_complex', "[0][1]overlay=x='20+n*2':y=40:format=auto[a];[a][2]overlay=x=0:y=140:format=auto,format=yuva420p", '-c:v', 'libvpx-vp9', '-pix_fmt', 'yuva420p', '-auto-alt-ref', '0', '-b:v', '1M', alphaWebm])
  }
  // Phase 5b: ProRes 4444 with alpha (not supported: refused at import with
  // its own message).
  const prores = join(d, 'prores4444.mov')
  if (force || !existsSync(prores)) {
    ff(['-f', 'lavfi', '-i', 'color=c=0x2f6fdf@0.5:s=160x90:r=30:d=1,format=rgba', '-c:v', 'prores_ks', '-profile:v', '4444', '-pix_fmt', 'yuva444p10le', prores])
  }
  // 5a/5b patch: a still with alpha, the same picture as alpha.webm's frames
  // (clear top, the blue square, the 50 % white band), made directly.
  const alphaPng = join(d, 'alpha-still.png')
  if (force || !existsSync(alphaPng)) {
    ff(['-f', 'lavfi', '-i', 'color=c=black@0.0:s=320x180:d=1,format=rgba', '-f', 'lavfi', '-i', 'color=c=0x2f6fdf:s=80x80:d=1,format=rgba', '-f', 'lavfi', '-i', 'color=c=white@0.5:s=320x30:d=1,format=rgba',
      '-filter_complex', '[0][1]overlay=x=60:y=40:format=auto[a];[a][2]overlay=x=0:y=140:format=auto,format=rgba', '-frames:v', '1', alphaPng])
  }
  return {
    dir: d, talk, other, srt, legacy, alphaWebm, alphaPng, prores, talk1080,
    numbered: Array.from({ length: 6 }, (_, i) => join(d, 'numbered', `${i + 1}.png`)),
    broll: ['bridge', 'cat'].map((n) => join(d, 'broll', `${n}.png`)),
    film: join(APP_DIR, 'scripts', 'qa', 'reference', 'film-demo')
  }
}

if (process.argv[1]?.endsWith('media.mjs')) console.log(makeE2eMedia(process.argv.includes('--force')))
