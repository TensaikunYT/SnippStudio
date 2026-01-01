// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// node scripts/testdata/check.mjs: the raw-talk videos' truth checked against
// their own sound. Every inserted silence (inside its 0.15 s margins) must be
// quiet (max under −45 dBFS: only the room-noise floor), every sentence loud
// (max over −30 dBFS). Prints the worst of each.
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ffmpegTool } from '../e2e/harness-paths.mjs'
const TD = join(fileURLToPath(new URL('../..', import.meta.url)), '..', 'testdata')
// (The shared helper: C:\ffmpeg\bin on Windows when there, else the PATH's; phase 10a, S6.)
const FF = ffmpegTool('ffmpeg')
const level = (file, a, b) => {
  const r = spawnSync(FF, ['-v', 'info', '-ss', String(a), '-t', String(Math.max(0.05, b - a)), '-i', file, '-af', 'volumedetect', '-f', 'null', '-'], { encoding: 'utf8' })
  return Number(/max_volume: (-?[\d.]+|-inf) dB/.exec(r.stderr)?.[1] ?? -99)
}
let bad = 0
for (const name of ['ham-02dk-en', 'ham-10dk-tr', 'ham-30dk-en']) {
  const t = JSON.parse(readFileSync(join(TD, 'ham', `${name}.truth.json`), 'utf8'))
  const mp4 = join(TD, 'ham', `${name}.mp4`)
  const sil = t.segments.filter((s) => s.type === 'silence').map((s) => level(mp4, s.start + 0.15, s.end - 0.15))
  const speech = t.segments.filter((s) => s.type !== 'silence').filter((_, i) => i % 7 === 0).map((s) => level(mp4, s.start, s.end))
  const worstSil = Math.max(...sil), worstSpeech = Math.min(...speech)
  const ok = worstSil < -45 && worstSpeech > -30
  if (!ok) bad++
  console.log(`${ok ? 'ok  ' : 'BAD '} ${name}: ${sil.length} silences, loudest ${worstSil} dB; ${speech.length} sentences checked, quietest ${worstSpeech} dB`)
}
process.exit(bad ? 1 : 0)
