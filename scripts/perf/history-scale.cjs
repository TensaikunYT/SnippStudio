// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// The undo history at scale (phase Ç2a.1, report D1; FAZC2A-PLAN.md step 5).
// A made-up 2-hour project: 500 clips (300 picture pieces on V1, their 200
// sound partners on A1 and a music bed), 2000 subtitle lines with word times.
// Measures, through the store as the app runs it: one snapshot (size, time),
// one edit (split, volume: median of 15), the history after 60 edits (the
// `past` strings and the heap), and holding Ctrl+Z then Ctrl+Y through it.
//   npx tsc -p tsconfig.test.json && node --expose-gc scripts/perf/history-scale.cjs
const path = require('path')
const out = path.resolve('out-test')
require(path.join(out, 'test', 'dom-stub.js'))
const { useStore } = require(path.join(out, 'renderer', 'src', 'state', 'store.js'))
const { historySnapshot } = require(path.join(out, 'renderer', 'src', 'state', 'history.js'))
const { defaultProject } = require(path.join(out, 'renderer', 'src', 'types.js'))

const S = useStore.getState
const len = 7200 / 300
const gc = () => (global.gc ? (global.gc(), global.gc()) : undefined)
const heap = () => (gc(), process.memoryUsage().heapUsed)
const median = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)]
const ms = (fn) => {
  const t = process.hrtime.bigint()
  fn()
  return Number(process.hrtime.bigint() - t) / 1e6
}

function project() {
  const p = defaultProject()
  p.name = 'Two hours'
  const V = p.tracks[0].id
  const A = p.tracks[1].id
  p.tracks.push({ id: 'music', kind: 'audio', name: 'A2', clipIds: [] })
  p.assets = [
    { id: 'talk', kind: 'video', name: 'talk.mp4', path: 'C:\\media\\talk.mp4', url: 'media://talk', size: 4e9, duration: 7300, width: 1920, height: 1080, hasAudio: true },
    { id: 'bed', kind: 'audio', name: 'bed.wav', path: 'C:\\media\\bed.wav', url: 'media://bed', size: 1e9, duration: 7300, width: 0, height: 0, hasAudio: true }
  ]
  const T = { x: 960, y: 540, scale: 1, rotation: 0 }
  for (let i = 0; i < 300; i++) {
    const id = `v${i}`
    const linked = i < 199
    p.clips[id] = { id, assetId: 'talk', trackId: V, start: i * len, inPoint: i * len, duration: len, transform: { ...T }, volume: 1, ...(linked ? { linkId: `L${i}`, audioExtracted: true } : {}), ...(i % 5 === 0 ? { channels: { scale: [{ id: `k${i}a`, time: 0, value: 1 }, { id: `k${i}b`, time: len, value: 1.1 }] } } : {}) }
    p.tracks[0].clipIds.push(id)
    if (linked) {
      const sid = `s${i}`
      p.clips[sid] = { id: sid, assetId: 'talk', trackId: A, start: i * len, inPoint: i * len, duration: len, transform: { ...T }, volume: 1, linkId: `L${i}` }
      p.tracks[1].clipIds.push(sid)
    }
  }
  p.clips.m = { id: 'm', assetId: 'bed', trackId: 'music', start: 0, inPoint: 0, duration: 7200, transform: { ...T }, volume: 0.3 }
  p.tracks[2].clipIds.push('m')
  const WORDS = ['so', 'today', 'we', 'are', 'going', 'to', 'look', 'at', 'how', 'this', 'works', 'and', 'why', 'it', 'matters']
  for (let i = 0; i < 2000; i++) {
    const start = i * 3.6
    const words = Array.from({ length: 9 }, (_, j) => ({ text: WORDS[(i + j) % WORDS.length], start: +(start + j * 0.36).toFixed(3), end: +(start + j * 0.36 + 0.3).toFixed(3) }))
    p.captions.push({ id: `c${i}`, start: words[0].start, end: words[8].end, text: words.map((w) => w.text).join(' '), words, soundClip: `s${Math.min(198, Math.floor(start / len))}` })
  }
  return p
}

const p = project()
console.log(`project: ${Object.keys(p.clips).length} clips, ${p.captions.length} lines, ${p.captions.reduce((n, c) => n + c.words.length, 0)} words`)
S().loadProject(p)
const snapTimes = []
let snap = ''
for (let i = 0; i < 9; i++) snapTimes.push(ms(() => (snap = historySnapshot(S().project))))
console.log(typeof snap === 'string' ? `snapshot: ${(snap.length / 1e6).toFixed(2)} M characters, median ${median(snapTimes).toFixed(1)} ms` : `snapshot: the project by reference (${JSON.stringify(snap).length / 1e6} M characters as JSON), median ${median(snapTimes).toFixed(2)} ms`)

const editTimes = { split: [], volume: [] }
for (let i = 0; i < 15; i++) {
  editTimes.volume.push(ms(() => S().setClipVolume('m', 0.3 + (i % 2) * 0.1)))
  S().closeEditWindows?.()
  editTimes.split.push(ms(() => S().splitClipAt(`v${10 + i * 7}`, (10 + i * 7) * len + 3)))
}
console.log(`one edit: split median ${median(editTimes.split).toFixed(1)} ms (max ${Math.max(...editTimes.split).toFixed(1)}), volume median ${median(editTimes.volume).toFixed(1)} ms`)

S().loadProject(project())
const h0 = heap()
for (let i = 0; i < 60; i++) S().splitClipAt(`v${i * 4}`, i * 4 * len + 5)
const h1 = heap()
const pastChars = S().past.reduce((n, s) => n + (typeof s === 'string' ? s.length : 0), 0)
console.log(`history after 60 edits: ${S().past.length} steps, ${typeof S().past[0] === 'string' ? `${(pastChars / 1e6).toFixed(1)} M characters in past` : 'kept by reference'}; heap +${((h1 - h0) / 1e6).toFixed(1)} MB`)
const undoTimes = []
for (let i = 0; i < 60; i++) undoTimes.push(ms(() => S().undo()))
for (let i = 0; i < 60; i++) undoTimes.push(ms(() => S().redo()))
const h2 = heap()
console.log(`Ctrl+Z x60 then Ctrl+Y x60: median ${median(undoTimes).toFixed(1)} ms each (max ${Math.max(...undoTimes).toFixed(1)}); heap now +${((h2 - h0) / 1e6).toFixed(1)} MB over the start`)
