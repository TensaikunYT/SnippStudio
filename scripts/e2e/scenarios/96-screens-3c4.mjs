// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// The windows phase 3c.4a moved onto the building blocks, photographed for a
// person to look at (beside the twelve screens of 87-screens-3c): keyboard
// shortcuts, Remove silence, the export progress (running and done), the top
// bar's unsaved dot. Runs only when SNIPP_SCREENS_3C4 names a folder
// (it adds nothing a check needs; the windows are driven by other scenarios);
// the English interface, as the app opens.
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { SUBS } from '../media.mjs'
export const name = 'screens-3c4'

export async function run({ c, app, media, lib }) {
  const dir = process.env.SNIPP_SCREENS_3C4
  if (!dir) {
    console.log('     (SNIPP_SCREENS_3C4 not set: no screens taken)')
    return
  }
  const { assert } = lib
  mkdirSync(dir, { recursive: true })
  const shot = async (n, wait = 450) => {
    await c.sleep(wait)
    await c.shot(join(dir, n))
  }
  const shotOf = async (n, id, wait = 450, pad = 4) => {
    await c.sleep(wait)
    const b = await c.box(id)
    assert.ok(b, `${id} is there`)
    const r = await c.capture({ format: 'png', clip: { x: Math.max(0, b.x - pad), y: Math.max(0, b.y - pad), width: b.w + pad * 2, height: b.h + pad * 2, scale: 1 } })
    writeFileSync(join(dir, n), Buffer.from(r.data, 'base64'))
  }

  const [talk] = await lib.seedAssets(app, c, [media.talk])
  await lib.seedTimeline(c, [talk.id])
  await lib.seedAssets(app, c, media.broll)
  await c.run((subs) => { const s = window.__store.getState(); s.setSubtitles(subs.map((x, i) => ({ id: 's' + i, ...x }))); s.setDirty(false) }, SUBS)

  // 13. Keyboard shortcuts.
  await c.click('topbar.file')
  await c.click('menu.file.shortcuts')
  await c.waitId('settings.keys')
  await shot('13-kisayollar.png')
  await c.click('settings.close')
  await c.waitGone('settings')

  // 14. Remove silence, on the talk.
  const [first] = await lib.clipList(c)
  await c.click(`timeline.clip.${first.id}`, { fx: 0.5 })
  await c.click('preview.silence')
  await c.waitId('silence')
  await c.waitFor('the silence found', async () => (await c.attr('silence.status', 'data-busy')) === '0' && (await c.st((s) => !!s.silencePreview)), 15000)
  await c.click('silence.advanced')
  await shotOf('14-sessizlik.png', 'silence', 450, 16)
  await c.click('silence.cancel')
  await c.waitGone('silence')

  // 15–16. The export progress: running, then done (its state set by hand).
  await c.run(() => window.__store.getState().setExportStatus({ kind: 'video', progress: 0.42, label: 'Encoding frame 1 260 of 3 000', startedAt: performance.now() - 12000, detail: '1920 × 1080 · 30 fps · MP4 (H.264) · High', target: 'film.mp4' }))
  await shot('15-disa-aktarma-suruyor.png', 1600)
  await c.run(() => window.__store.getState().setExportStatus({ kind: 'video', progress: 1, label: '', startedAt: performance.now() - 31000, endedAt: performance.now(), done: true, detail: '1920 × 1080 · 30 fps · MP4 (H.264) · High', path: 'C:\\Users\\me\\Videos\\film.mp4', bytes: 48_200_000 }))
  await shot('16-disa-aktarma-bitti.png', 600)
  await c.run(() => window.__store.getState().setExportStatus(null))

  // 18. The top bar's name with the unsaved dot beside it.
  await c.run(() => window.__store.getState().setDirty(true))
  await shotOf('18-ust-cubuk-kaydedilmemis.png', 'topbar.save', 300, 8)
  console.log(`     screenshots: ${dir}`)
}
