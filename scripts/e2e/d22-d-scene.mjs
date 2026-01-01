// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// The scene the 22 November interface scenarios share (d22-d-*): two video
// lanes and two sound lanes, a linked pair (talk.mp4 and its sound), a cut
// between two clips, a picture above. And the two window sizes a user really
// has: the window as it opens (no size emulation) and 1366 x 768.
export const build = (ids) => {
  const S = window.__store
  const p = structuredClone(S.getState().project)
  const W = p.settings.width
  const H = p.settings.height
  const T = { x: W / 2, y: H / 2, scale: 1, rotation: 0 }
  p.tracks = [
    { id: 'V2', kind: 'video', name: 'V2', clipIds: ['pic'] },
    { id: 'V1', kind: 'video', name: 'V1', clipIds: ['v1', 'v2', 'p2'] },
    { id: 'A1', kind: 'audio', name: 'A1', clipIds: ['snd'] },
    { id: 'A2', kind: 'audio', name: 'A2', clipIds: ['snd2'] }
  ]
  p.clips = {
    pic: { id: 'pic', assetId: ids.pic, trackId: 'V2', start: 4.5, inPoint: 0, duration: 4, transform: { ...T, scale: 0.4 }, volume: 1 },
    v1: { id: 'v1', assetId: ids.talk, trackId: 'V1', start: 0, inPoint: 0, duration: 6, transform: T, volume: 1, linkId: 'L', audioExtracted: true },
    v2: { id: 'v2', assetId: ids.other, trackId: 'V1', start: 6, inPoint: 0, duration: 6, transform: T, volume: 1 },
    p2: { id: 'p2', assetId: ids.pic2, trackId: 'V1', start: 12, inPoint: 0, duration: 4, transform: T, volume: 1 },
    snd: { id: 'snd', assetId: ids.talk, trackId: 'A1', start: 0, inPoint: 0, duration: 6, transform: T, volume: 1, linkId: 'L' },
    snd2: { id: 'snd2', assetId: ids.other, trackId: 'A2', start: 1, inPoint: 0, duration: 5, transform: T, volume: 1 }
  }
  S.getState().setPlaying(false)
  S.getState().loadProject(p)
  S.setState({ selectedClipIds: [], selectedCaptionIds: [], pxPerSec: 70 })
  return true
}

export async function scene({ c, app, lib, media }, { lang = 'en' } = {}) {
  await c.run((l) => { window.__store.getState().setUiLang(l); return true }, lang)
  // (By name: a file the project already holds is not added a second time.)
  const files = [media.talk, media.other, media.broll[0], media.numbered[1]]
  await lib.seedAssets(app, c, files)
  const [talk, other, pic, pic2] = await c.st((s, names) => names.map((n) => s.project.assets.find((a) => a.name === n)), files.map((f) => f.replace(/^.*[\\/]/, '')))
  await c.run(build, { talk: talk.id, other: other.id, pic: pic.id, pic2: pic2.id })
  await c.waitId('timeline.clip.v1')
  await lib.dockPage(c, 'media')
  await c.sleep(300)
  return { talk, other, pic, pic2 }
}

/** The window at a size: 'real' (as it opens, no emulation), or [w, h]. */
export async function windowSize(c, size) {
  if (size === 'real') await c.send('Emulation.clearDeviceMetricsOverride')
  else await c.send('Emulation.setDeviceMetricsOverride', { width: size[0], height: size[1], deviceScaleFactor: 1, mobile: false })
  await c.sleep(400)
}
/** Back to the runner's one size (cdp.mjs connect). */
export const runnerSize = (c) => windowSize(c, [1920, 1080])
