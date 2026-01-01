// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// Screenshots of the look (SnippStudio phase 3a.6): the building blocks page
// (#ui-kit, when the build has it) and four views of the editor: an empty
// project, media and timeline, the Inspector on a selected clip, the Notes tab.
// Written to SNIPP_SCREENS (a folder) or testdata\e2e-sonuc\ekranlar. The
// pictures are for a person to look at; the scenario checks only that each
// view is there.
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'

export const name = 'screens-look'

/** The whole page, also below the window's fold. */
async function shotFull(c, file) {
  const { w, h } = await c.run(() => ({ w: document.documentElement.scrollWidth, h: Math.max(document.documentElement.scrollHeight, document.body.scrollHeight, document.querySelector('[data-testid="ui-kit"]')?.scrollHeight ?? 0) }))
  const r = await c.capture({ format: 'png', captureBeyondViewport: true, clip: { x: 0, y: 0, width: w, height: Math.max(h, 1080), scale: 1 } })
  const { writeFileSync } = await import('node:fs')
  writeFileSync(file, Buffer.from(r.data, 'base64'))
}

export async function run({ c, app, media, lib, out }) {
  const { assert } = lib
  const dir = process.env.SNIPP_SCREENS || join(out, 'ekranlar')
  mkdirSync(dir, { recursive: true })
  const shot = async (n) => {
    await c.sleep(400)
    await c.shot(join(dir, n))
  }

  // 0. The building blocks page, if this build has one.
  const kit = await c.run(async () => {
    location.hash = '#ui-kit'
    return true
  })
  if (kit) {
    await c.send('Page.reload', { ignoreCache: false })
    let has = false
    try {
      await c.waitFor('the building blocks page', () => c.ev(`!!document.querySelector('[data-testid="ui-kit"]') || !!document.querySelector('[data-testid="topbar.file"]')`), 15000)
      has = await c.ev(`!!document.querySelector('[data-testid="ui-kit"]')`)
    } finally {
      await c.run(() => history.replaceState(null, '', location.pathname + location.search))
    }
    if (has) {
      // The states a still picture cannot reach by itself, forced as the
      // DevTools would: a pointer over one button, the keyboard's focus on
      // another, a field being typed in.
      await c.send('CSS.enable')
      const { root } = await c.send('DOM.getDocument', { depth: 0 })
      const force = async (id, states) => {
        const { nodeId } = await c.send('DOM.querySelector', { nodeId: root.nodeId, selector: `[data-testid="${id}"]` })
        if (nodeId) await c.send('CSS.forcePseudoState', { nodeId, forcedPseudoClasses: states })
      }
      await force('kit.button.secondary', ['hover'])
      await force('kit.button.ghost', ['focus', 'focus-visible'])
      await force('kit.field.search', ['focus', 'focus-visible'])
      await force('kit.toggle.agent', ['focus', 'focus-visible'])
      await c.sleep(600)
      await shotFull(c, join(dir, '0-yapi-taslari.png'))
    }
    await lib.reset(c)
  }

  // 1. An empty project.
  await shot('1-bos-proje.png')

  // 2. Media and the timeline: two videos and a picture, the playhead at 2 s.
  const [talk, other, card] = await lib.seedAssets(app, c, [media.talk, media.other, media.numbered[2]])
  await lib.seedTimeline(c, [talk.id, other.id, card.id])
  await lib.seek(c, 2)
  await c.waitFor('three clips', async () => (await lib.clipList(c)).length === 3)
  await shot('2-medya-cizelge.png')

  // 3. The Inspector on the selected first clip.
  const [first] = await lib.clipList(c)
  await c.click(`timeline.clip.${first.id}`, { fx: 0.5 })
  await c.click('inspector.tab.clip')
  await c.waitFor('the clip selected', async () => (await c.st((s) => s.selectedClipIds.length)) >= 1)
  await shot('3-inspector.png')

  // 4. The Notes tab with two notes: one written on the N lane, one the agent answered.
  await c.click('inspector.tab.notes')
  const lane = await c.box('notes.lane')
  await c.dragAt(await lib.timeX(c, 1), lane.cy, await lib.timeX(c, 3), lane.cy, { steps: 8, mods: ['shift'] })
  await c.waitId('notes.draft.text')
  await c.click('notes.kind.fix')
  await c.click('notes.draft.text')
  await c.type('The title is cut off: move it up')
  await c.click('notes.draft.save')
  await c.waitFor('a note', async () => (await c.st((s) => (s.project.notes ?? []).length)) === 1)
  await c.dragAt(await lib.timeX(c, 5), lane.cy, await lib.timeX(c, 7), lane.cy, { steps: 8, mods: ['shift'] })
  await c.waitId('notes.draft.text')
  await c.click('notes.draft.text')
  await c.type('Cut the pause here')
  await c.click('notes.draft.save')
  await c.waitFor('two notes', async () => (await c.st((s) => (s.project.notes ?? []).length)) === 2)
  await c.run(() => window.__store.getState().editNotes((p) => { const n = p.notes[1]; n.status = 'ready'; n.reply = 'Cut 0.8 s of silence.'; n.touched = [[5, 7]] }, false))
  await shot('4-notlar.png')
  assert.ok(await c.has('notes.lane'))
}
