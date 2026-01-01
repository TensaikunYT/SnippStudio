// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// The reference projects' footage, made with ffmpeg's own test sources (no
// downloads): two 1280x720 clips (one with a tone), a tall clip and two stills.
//   node make-media.mjs <mediaDir>
import { execFileSync } from 'node:child_process'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'

const dir = process.argv[2] ?? 'media'
mkdirSync(dir, { recursive: true })
const ff = (...args) => execFileSync('ffmpeg', ['-v', 'error', '-y', ...args], { stdio: 'inherit' })
const h264 = ['-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-g', '15']
ff('-f', 'lavfi', '-i', 'testsrc2=s=1280x720:r=30:d=6', '-f', 'lavfi', '-i', 'sine=f=440:d=6', ...h264, '-c:a', 'aac', '-shortest', join(dir, 'v1.mp4'))
ff('-f', 'lavfi', '-i', 'mandelbrot=s=1280x720:r=30', '-t', '6', ...h264, join(dir, 'v2.mp4'))
ff('-f', 'lavfi', '-i', 'testsrc=s=720x1280:r=30', '-t', '6', ...h264, join(dir, 'v3.mp4'))
ff('-f', 'lavfi', '-i', 'testsrc=s=1600x900', '-frames:v', '1', join(dir, 'img1.png'))
ff('-f', 'lavfi', '-i', 'smptehdbars=s=1080x1350', '-frames:v', '1', join(dir, 'img2.png'))
console.log('media in', dir)
