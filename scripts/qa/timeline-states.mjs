// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// node scripts/qa/timeline-states.mjs <folder>
// Pictures of the timeline's and the preview's states that the twelve screens
// of phase 3c do not show (phase 3c.2): a selected clip, the clip's menu, the
// transition panel, the toolbar's "Tools" list, a track's menu, the preview's
// "More", the subtitle editor. For a person to look at; checks nothing.
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { launchApp } from '../e2e/app.mjs'
import { makeE2eMedia, SUBS } from '../e2e/media.mjs'
import * as lib from '../e2e/lib.mjs'

const dir = process.argv[2]
if (!dir) {
  console.error('usage: node scripts/qa/timeline-states.mjs <folder>')
  process.exit(2)
}
mkdirSync(dir, { recursive: true })
process.env.PATH = `C:\\ffmpeg\\bin;${process.env.PATH}`
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
  const [first, second] = await lib.clipList(c)
  /** A part of the window: x, y, w, h. */
  const shot = async (name, clip, wait = 500) => {
    await c.sleep(wait)
    const r = await c.capture({ format: 'png', clip: { ...clip, scale: 1 } })
    writeFileSync(join(dir, name), Buffer.from(r.data, 'base64'))
  }
  const win = await c.ev('({ w: innerWidth, h: innerHeight })')
  const tl = await c.box('timeline.scroll')
  const lower = { x: 0, y: tl.y - 300, width: 1100, height: Math.min(win.h - (tl.y - 300), 640) }

  // 1. A selected clip, the pointer on its neighbour.
  await c.click(`timeline.clip.${first.id}`, { fx: 0.5 })
  const b2 = await c.box(`timeline.clip.${second.id}`)
  await c.mouse('mouseMoved', b2.cx, b2.cy)
  await shot('a-secili-klip.png', { x: 0, y: tl.y - 34, width: 1500, height: 260 })

  // 2. The clip's menu.
  await c.clickAt(b2.cx, b2.cy, { button: 'right' })
  await shot('b-klip-menusu.png', lower)
  await c.key('Escape')

  // 3. The transition at the first cut (core polish T): one click adds the
  //    default, right-click opens its menu (type, make default, delete).
  await c.click(`timeline.junction.${first.id}.add`, { force: true })
  await c.waitId(`timeline.junction.${first.id}.block`)
  const tb = await c.box(`timeline.junction.${first.id}.block`)
  await c.clickAt(tb.cx, tb.cy, { button: 'right' })
  await c.waitId('transition-menu')
  await c.click('transition-menu.choice.wipe')
  await shot('c-gecis-paneli.png', { x: 300, y: tl.y - 60, width: 1000, height: Math.min(win.h - tl.y + 60, 520) })
  await c.key('Escape')

  // 4. The toolbar's "Tools" list.
  await c.click('timeline.tools-more')
  await shot('d-araclar.png', { x: 0, y: tl.y - 420, width: 700, height: 460 })
  await c.click('timeline.tools-more')

  // 5. A track's menu.
  const v1 = await c.st((s) => s.project.tracks.find((t) => t.kind === 'video').id)
  await c.click(`timeline.track.${v1}.more`)
  await shot('e-serit-menusu.png', { x: 0, y: tl.y, width: 600, height: 300 })
  await c.key('Escape')

  // 6. The preview's "More" and the transport.
  await c.click('preview.more')
  const pm = await c.box('preview.more')
  await shot('f-onizleme-diger.png', { x: pm.x - 30, y: pm.y - 20, width: 700, height: 220 })
  await c.click('preview.more')

  // 7. The subtitle editor with its word picker.
  await c.run(() => {
    const s = window.__store.getState()
    s.requestCaptionEdit(s.project.captions[0].id)
  })
  await shot('g-altyazi-duzenleyici.png', { x: 340, y: 60, width: 1300, height: 560 }, 800)
  await c.key('Escape')

  // 8. The Turkish interface: do the words fit the toolbars and the lane names?
  await c.run(() => window.__store.getState().setUiLang('tr'))
  await shot('h-turkce.png', { x: 0, y: 48, width: win.w, height: win.h - 48 - 260 }, 700)
  await c.run(() => window.__store.getState().setUiLang('en'))
  console.log('pictures in', dir)
} catch (e) {
  console.error('FAIL', e.stack ?? e)
  code = 1
} finally {
  await app.close()
}
process.exit(code)
