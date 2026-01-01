// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// okunur (23 November): the timeline's pictures for the readability work,
// one project: a sound clip cut into many pieces with Cut Silence's marks
// shown (one of them unsure), a picture cut into a run of pieces, a video
// cut in three with an entrance, an exit and a transition; at the small and
// the medium lane height, at 1366 x 768 and 1920 x 1080. Opt-in: it only
// takes pictures (SNIPP_OKUNUR_SHOTS=<folder>, file prefix SNIPP_OKUNUR_TAG).
import { writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { windowSize, runnerSize } from '../d22-d-scene.mjs'
export const name = 'okunur-shots'
export const timeoutMs = 180_000
export const optIn = true

const SHOTS = process.env.SNIPP_OKUNUR_SHOTS || null
const TAG = process.env.SNIPP_OKUNUR_TAG || 'sonra'

const build = (ids) => {
  const S = window.__store
  const p = structuredClone(S.getState().project)
  const W = p.settings.width
  const H = p.settings.height
  const T = { x: W / 2, y: H / 2, scale: 1, rotation: 0 }
  const clips = {}
  const lane = (id, list) => ({ id, kind: id.startsWith('A') ? 'audio' : 'video', name: id, clipIds: list })
  // V2: one picture cut into a run of pieces, another picture after it.
  const v2 = []
  for (let i = 0; i < 4; i++) { const id = `i${i}`; v2.push(id); clips[id] = { id, assetId: ids.pic, trackId: 'V2', start: i * 1.5, inPoint: 0, duration: 1.5, transform: T, volume: 1 } }
  clips.j0 = { id: 'j0', assetId: ids.pic2, trackId: 'V2', start: 6, inPoint: 0, duration: 2, transform: T, volume: 1 }
  clips.j1 = { id: 'j1', assetId: ids.pic2, trackId: 'V2', start: 8, inPoint: 0, duration: 2.5, transform: T, volume: 1 }
  v2.push('j0', 'j1')
  // V1: the talk cut in three (its sound inside).
  clips.t0 = { id: 't0', assetId: ids.talk, trackId: 'V1', start: 0, inPoint: 0, duration: 3.5, transform: T, volume: 1 }
  clips.t1 = { id: 't1', assetId: ids.talk, trackId: 'V1', start: 3.5, inPoint: 4, duration: 3.5, transform: T, volume: 1 }
  clips.t2 = { id: 't2', assetId: ids.talk, trackId: 'V1', start: 7, inPoint: 8, duration: 4, transform: T, volume: 1 }
  // A1: the talk's sound cut into many pieces, touching.
  const a1 = []
  let at = 0
  const cuts = [[0, 1.2], [1.6, 2.6], [3, 4.4], [4.9, 5.6], [6, 7.4], [7.8, 8.6], [9, 10.5], [10.8, 11.9]]
  cuts.forEach(([a, b], i) => { const id = `s${i}`; a1.push(id); clips[id] = { id, assetId: ids.talk, trackId: 'A1', start: at, inPoint: a, duration: b - a, transform: T, volume: 1 }; at += b - a })
  // A2: the long sound, uncut.
  clips.m0 = { id: 'm0', assetId: ids.talk, trackId: 'A2', start: 0, inPoint: 0, duration: 12, transform: T, volume: 1 }
  p.tracks = [lane('V2', v2), lane('V1', ['t0', 't1', 't2']), lane('A2', ['m0']), lane('A1', a1)]
  p.clips = clips
  S.getState().setPlaying(false)
  S.getState().loadProject(p)
  const s = S.getState()
  s.runBatch([{ name: 'clip.setTransition', params: { clipId: 't1', transition: { type: 'mix', duration: 0.8 } } }])
  s.setClipAnim('t0', { in: 'fade', inDur: 1 })
  s.setClipAnim('t2', { out: 'zoom-out', outDur: 0.8 })
  s.setClipAnim('j0', { in: 'fade', inDur: 0.6 })
  s.setClipAnim('j1', { out: 'fade', outDur: 1 })
  s.setClipAnim('i0', { in: 'fade', inDur: 0.5 })
  S.setState({ selectedClipIds: [], selectedCaptionIds: [], pxPerSec: 100 })
  // Cut Silence's marks over the long sound: three sure, one unsure.
  S.getState().setSilencePreview([[0.9, 1.6], [3.3, 4.1], [6.6, 7.2], [9.4, 10.2]].map(([a, b], i) => ({ clipId: 'm0', start: a, end: b, unsure: i === 2 })))
  s.setDirty(false)
  return true
}

export async function run({ c, app, lib, media }) {
  await c.run(() => { window.__store.getState().setUiLang('tr'); return true })
  const files = [media.talk, media.broll[0], media.numbered[1]]
  await lib.seedAssets(app, c, files)
  const names = files.map((f) => f.split(/[\\/]/).pop())
  const [talk, pic, pic2] = await c.st((s, names) => names.map((n) => s.project.assets.find((a) => a.name === n) ?? null), names)
  if (!talk || !pic || !pic2) throw new Error(`assets ${names} -> ${JSON.stringify(await c.st((s) => s.project.assets.map((a) => a.name)))}`)
  await c.run(build, { talk: talk.id, pic: pic.id, pic2: pic2.id })
  await c.waitId('timeline.clip.t0')
  await lib.dockPage(c, 'media')
  const lanes = async (scale) => {
    await c.click('topbar.settings')
    await c.waitId('settings.general.lanes')
    await c.click(`settings.general.lanes.${scale}`)
    await c.key('Escape')
    await c.waitGone('settings.nav')
    await c.sleep(250)
  }
  const shot = async (file) => {
    if (!SHOTS) return
    mkdirSync(SHOTS, { recursive: true })
    const b = await c.box('timeline.toolbar-settings')
    const w = await c.ev('innerWidth'), h = await c.ev('innerHeight')
    const y = Math.max(0, b.y - 8)
    const r = await c.capture({ format: 'png', clip: { x: 0, y, width: w, height: h - y, scale: 1 } })
    writeFileSync(join(SHOTS, file), Buffer.from(r.data, 'base64'))
  }
  try {
    for (const size of [[1366, 768], [1920, 1080]]) {
      await windowSize(c, size)
      for (const scale of ['small', 'medium']) {
        await lanes(scale)
        await c.st((s) => s.setTime(5.2))
        await c.mouse('mouseMoved', size[0] / 2, 120)
        await c.sleep(1500)
        await shot(`${TAG}-${size.join('x')}-${scale}.png`)
      }
    }
    // The Text page's two sub-pages.
    await windowSize(c, [1366, 768])
    await lib.textPage(c)
    await c.mouse('mouseMoved', 700, 250)
    await c.sleep(600)
    if (SHOTS) { const r = await c.capture({ format: 'png' }); writeFileSync(join(SHOTS, `${TAG}-yazi.png`), Buffer.from(r.data, 'base64')) }
    await lib.templatesPage(c)
    await c.mouse('mouseMoved', 700, 250)
    await c.sleep(800)
    if (SHOTS) { const r = await c.capture({ format: 'png' }); writeFileSync(join(SHOTS, `${TAG}-sablonlar.png`), Buffer.from(r.data, 'base64')) }
    await lib.dockPage(c, 'media')
  } finally {
    await c.run(() => { window.__store.getState().setUiLang('en'); return true })
    await runnerSize(c)
  }
}
