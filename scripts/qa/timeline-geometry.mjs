// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// node scripts/qa/timeline-geometry.mjs <out.json> [--compare=<before.json>]
// The timeline's geometry, measured in the built app (phase 3c.2: the timeline
// was restyled, its boxes had to stay where they were, pixel for pixel).
// Opens the app off-screen with a throw-away profile, lays out a fixed scene
// (three clips, subtitles, a note, a template block, a marker, a second audio
// track) at two zooms, and writes the box of every lane, clip, chip, handle
// and ruler tick. With --compare it lists every box that differs from an
// earlier measurement and exits 1 if any does.
import { readFileSync, writeFileSync } from 'node:fs'
import { launchApp } from '../e2e/app.mjs'
import { makeE2eMedia, SUBS } from '../e2e/media.mjs'
import * as lib from '../e2e/lib.mjs'

const out = process.argv[2]
const compare = (process.argv.find((a) => a.startsWith('--compare=')) ?? '').slice(10)
if (!out) {
  console.error('usage: node scripts/qa/timeline-geometry.mjs <out.json> [--compare=<before.json>]')
  process.exit(2)
}
process.env.PATH = `C:\\ffmpeg\\bin;${process.env.PATH}`

/** What is measured: the parts whose place and size are the timeline's geometry. */
const SELECTORS = [
  '.timeline', '.tl-scroll', '.tl-inner', '.tl-ruler', '.tl-ruler-corner', '.tl-tick', '.tl-playhead', '.tl-playhead-head',
  '.tl-note-lane', '.tl-note-lane .tl-track-label', '.tl-note-block', '.tl-caption-lane', '.tl-caption-lane .tl-track-label', '.tl-caption-chip', '.tl-caption-chip .chip-handle', '.tl-caption-chip .chip-text', '.tl-caption-chip .chip-del',
  '.tl-tpl-lane', '.tl-tpl-lane .tl-track-label', '.tl-tpl-block', '.tl-addtrack', '.tl-addtrack button', '.addtrack-head',
  '.tl-track', '.tl-track > .tl-track-label', '.tl-track-label .tname', '.tl-clip', '.tl-clip .handle', '.tl-clip .label', '.tl-clip canvas', '.tl-clip .fade-handle', '.tl-clip .strip', '.tl-clip .wave',
  '.tl-trans-junction', '.tl-marker', '.tl-tailfill', '.tl-tailhead', '.track-resize'
]

/** Boxes that hold words: their width follows the type (compared by place and height). */
const TEXT_WIDTH = new Set(['.tl-tick'])
/** The words themselves, inside a box that is compared: reported, never a failure. */
const CONTENT = new Set(['.tl-track-label .tname', '.tl-caption-chip .chip-text', '.tl-caption-chip .chip-del'])

const app = await launchApp()
const c = app.cdp
let code = 0
try {
  await lib.ready(c)
  await lib.reset(c)
  const media = makeE2eMedia()
  const [talk, other, card] = await lib.seedAssets(app, c, [media.talk, media.other, media.numbered[2]])
  await lib.seedTimeline(c, [talk.id, other.id, card.id])
  await c.run((subs) => {
    const s = window.__store.getState()
    s.setSubtitles(subs.map((x, i) => ({ id: 's' + i, ...x })))
    s.addAudioTrack()
    s.setTime(2)
    s.setDirty(false)
  }, SUBS)
  await c.waitFor('three clips', async () => (await lib.clipList(c)).length === 3)
  // A template block and a marker through the app's own controls.
  await c.click('dock.group.library')
  await lib.templatesPage(c)
  await c.click('templates.insert.steps')
  await c.waitFor('a template block', () => c.st((s) => (s.project.templates?.length ?? 0) > 0))
  await c.click('dock.group.media')
  await lib.dockPage(c, 'media')
  // A note over 1–3 s (Shift + drag on the lane), saved.
  const lane = await c.box('notes.lane')
  await c.dragAt(await lib.timeX(c, 1), lane.cy, await lib.timeX(c, 3), lane.cy, { steps: 8, mods: ['shift'] })
  await c.waitId('notes.draft.text')
  await c.click('notes.draft.text')
  await c.type('geometry')
  await c.click('notes.draft.save')
  await c.run(() => {
    const s = window.__store.getState()
    s.selectClip(null)
    s.setTime(2)
  })
  const measure = (selectors) =>
    c.run((sels) => {
      const res = {}
      for (const sel of sels) {
        res[sel] = [...document.querySelectorAll(sel)].map((el) => {
          const r = el.getBoundingClientRect()
          return [r.x, r.y, r.width, r.height].map((v) => Math.round(v * 100) / 100)
        })
      }
      return res
    }, selectors)
  const result = {}
  for (const zoom of [60, 140]) {
    await c.run((z) => {
      window.__store.getState().setPxPerSec(z)
      const el = document.querySelector('[data-testid="timeline.scroll"]')
      el.scrollLeft = 0
      el.scrollTop = 0
    }, zoom)
    await c.sleep(600)
    result[`zoom${zoom}`] = await measure(SELECTORS)
  }
  writeFileSync(out, JSON.stringify(result, null, 1))
  const count = Object.values(result).reduce((n, z) => n + Object.values(z).reduce((m, a) => m + a.length, 0), 0)
  console.log(`measured ${count} boxes -> ${out}`)
  if (compare) {
    const before = JSON.parse(readFileSync(compare, 'utf8'))
    const diffs = []
    const notes = []
    for (const z of Object.keys(before)) {
      for (const sel of Object.keys(before[z])) {
        const a = before[z][sel]
        const b = result[z]?.[sel] ?? []
        // A label is as wide as its words (type may change, the place may not).
        const cut = TEXT_WIDTH.has(sel) ? (box) => [box[0], box[1], box[3]] : (box) => box
        const into = CONTENT.has(sel) ? notes : diffs
        if (a.length !== b.length) into.push(`${z} ${sel}: ${a.length} boxes before, ${b.length} now`)
        else a.forEach((box, i) => { if (cut(box).join() !== cut(b[i]).join()) into.push(`${z} ${sel}[${i}]: ${box.join(' ')} -> ${b[i].join(' ')}`) })
      }
    }
    if (notes.length) console.log(`words inside the boxes (not geometry; ${notes.length}):\n${notes.slice(0, 12).join('\n')}`)
    console.log(diffs.length ? `DIFFERENT (${diffs.length}):\n${diffs.slice(0, 80).join('\n')}` : 'the same: every box')
    if (diffs.length) code = 1
  }
} catch (e) {
  console.error('FAIL', e.stack ?? e)
  code = 1
} finally {
  await app.close()
}
process.exit(code)
