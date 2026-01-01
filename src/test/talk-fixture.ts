// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// The test material's talks (testdata\ham) as projects, for the agent tests
// (SnippStudio phase 4A): the video on V1, its sound on A1 (linked), the
// subtitles one per .srt line with the truth's word times (or with the words
// Whisper wrote, testdata\ham\<name>.whisper.json, phase 4A.8).
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { parseSrt } from '../renderer/src/subtitles/srt'
import { defaultProject, type Asset, type Caption, type Clip, type Project } from '../renderer/src/types'

export const HAM = path.resolve(process.cwd(), '..', 'testdata', 'ham')
export const haveTalk = (name: string): boolean => existsSync(path.join(HAM, `${name}.truth.json`))

/** A folder of the test material by role (scripts/e2e/harness-paths.mjs
 *  materialDir: <testdata>/roles.json maps the role to the folder, else the
 *  role is the folder). `voiceover`: a voice-over, its subtitles, 20 numbered
 *  pictures and proje.snipp. */
export function materialDir(role: string, testdata = path.dirname(HAM)): string {
  let roles: Record<string, unknown> = {}
  try { roles = JSON.parse(readFileSync(path.join(testdata, 'roles.json'), 'utf8')) as Record<string, unknown> } catch { /* the role is the folder */ }
  const dir = roles[role]
  return path.join(testdata, typeof dir === 'string' && dir ? dir : role)
}

export interface Truth {
  sure: number
  words: { text: string; start: number; end: number }[]
  cuts: [number, number][]
  segments: { type: string; start: number; end: number; retakeOf?: number; take?: number; text?: string }[]
}

export const truthOf = (name: string): Truth => JSON.parse(readFileSync(path.join(HAM, `${name}.truth.json`), 'utf8')) as Truth

function talkShell(name: string, seconds: number): Project {
  const p = defaultProject()
  p.name = name
  const a: Asset = { id: 'vid0000000001', kind: 'video', name: `${name}.mp4`, url: 'media://x', size: 1, duration: seconds, width: 640, height: 360, hasAudio: true }
  p.assets = [a]
  const [v1, a1] = p.tracks
  const clip = (id: string, trackId: string, extra: Partial<Clip>): Clip => ({ id, assetId: a.id, trackId, start: 0, inPoint: 0, duration: seconds, transform: { x: 320, y: 180, scale: 1, rotation: 0 }, volume: 1, linkId: 'link000000001', ...extra }) as Clip
  p.clips = { vclip00000001: clip('vclip00000001', v1.id, { audioExtracted: true }), aclip00000001: clip('aclip00000001', a1.id, {}) }
  v1.clipIds = ['vclip00000001']
  a1.clipIds = ['aclip00000001']
  return p
}

/** The talk as a project with the .srt's lines and the truth's word times. */
export function talkProject(name: string): { project: Project; truth: Truth } {
  const truth = truthOf(name)
  const p = talkShell(name, truth.sure)
  const lines = parseSrt(readFileSync(path.join(HAM, `${name}.srt`)))
  let k = 0
  p.captions = lines.map((l, i): Caption => {
    const words: Caption['words'] = []
    while (k < truth.words.length && truth.words[k].start < l.end - 1e-3) {
      const w = truth.words[k++]
      words.push({ text: w.text, start: w.start, end: w.end })
    }
    // Ids as the app makes them (13 characters).
    return { ...l, id: `${String(i).padStart(4, '0')}abcd-ef01`, words }
  })
  return { project: p, truth }
}

export const haveWhisper = (name: string): boolean => existsSync(path.join(HAM, `${name}.whisper.json`))

/** The talk with the subtitles the app's own speech model wrote for it
 *  (testdata\ham\<name>.whisper.json: the lines as transcribeProject left
 *  them, kept once so the finders are measured on real recogniser output). */
export function whisperProject(name: string): { project: Project; truth: Truth } {
  const truth = truthOf(name)
  const p = talkShell(name, truth.sure)
  const saved = JSON.parse(readFileSync(path.join(HAM, `${name}.whisper.json`), 'utf8')) as { captions: Caption[] }
  p.captions = saved.captions
  return { project: p, truth }
}
