// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// The twelve screens of phase 3c (tarifler\FAZ3C.md, decision 8), for a person
// to compare before and after the interface moved onto the building blocks:
// empty start, editor with media, the timeline close, Inspector clip / subs /
// project, templates, notes, the Agent tab with a draft, the export window, the
// project home (the automation window, the eleventh, was removed in cila O). Runs only when SNIPP_SCREENS_3C names a
// folder (it adds nothing a check needs: every view here is driven by other
// scenarios); the English interface, as the app opens.
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { SUBS } from '../media.mjs'
import { connectAgent, resultOf, versionOf } from '../agent-client.mjs'
import { accessOn } from '../session.mjs'
export const name = 'screens-3c'

// SNIPP_SCREENS_3C_LANG=tr takes them with the Turkish interface (phase
// 3c.4b: the "after" screens in both languages); English again at the end.
export async function run(ctx) {
  const lang = process.env.SNIPP_SCREENS_3C_LANG === 'tr' ? 'tr' : 'en'
  if (!process.env.SNIPP_SCREENS_3C || lang === 'en') return shoot(ctx)
  await ctx.c.run((l) => { window.__store.getState().setUiLang(l); return true }, lang)
  try {
    await shoot(ctx)
  } finally {
    await ctx.c.run(() => { window.__store.getState().setUiLang('en'); return true })
  }
}

async function shoot({ c, app, media, lib, work }) {
  const dir = process.env.SNIPP_SCREENS_3C
  if (!dir) {
    console.log('     (SNIPP_SCREENS_3C not set: no screens taken)')
    return
  }
  const { assert } = lib
  mkdirSync(dir, { recursive: true })
  const shot = async (n, wait = 450) => {
    await c.sleep(wait)
    await c.shot(join(dir, n))
  }
  /** Only a part of the window (the box of an element, grown a little). */
  const shotOf = async (n, id, wait = 450) => {
    await c.sleep(wait)
    const b = await c.box(id)
    assert.ok(b, `${id} is there`)
    const r = await c.capture({ format: 'png', clip: { x: Math.max(0, b.x - 4), y: Math.max(0, b.y - 4), width: b.w + 8, height: b.h + 8, scale: 1 } })
    writeFileSync(join(dir, n), Buffer.from(r.data, 'base64'))
  }

  // 1. The empty start.
  await shot('01-bos-acilis.png')

  // 2. The editor with media: two videos and a picture on the timeline, subtitles.
  const [talk, other, card] = await lib.seedAssets(app, c, [media.talk, media.other, media.numbered[2]])
  await lib.seedTimeline(c, [talk.id, other.id, card.id])
  await c.run((subs) => { const s = window.__store.getState(); s.setSubtitles(subs.map((x, i) => ({ id: 's' + i, ...x }))); s.setDirty(false) }, SUBS)
  await lib.seek(c, 2)
  await c.waitFor('three clips', async () => (await lib.clipList(c)).length === 3)
  await shot('02-medya-dolu-editor.png')

  // 3. The timeline, close.
  await shotOf('03-cizelge-yakin.png', 'timeline.scroll')

  // 4. Inspector: the selected clip.
  const [first] = await lib.clipList(c)
  await c.click(`timeline.clip.${first.id}`, { fx: 0.5 })
  await c.click('inspector.tab.clip')
  await c.waitFor('the clip selected', async () => (await c.st((s) => s.selectedClipIds.length)) >= 1)
  await shot('04-inspector-klip.png')

  // 5. Inspector: subtitles.
  await c.click('inspector.tab.subs')
  await shot('05-inspector-altyazi.png')

  // 6. Inspector: project.
  await c.click('inspector.tab.project')
  await shot('06-inspector-proje.png')

  // 7. Templates (Library → Templates in the dock).
  await lib.templatesPage(c)
  await shot('07-sablonlar.png')
  await lib.dockPage(c, 'media')

  // 8. Notes: two notes, one the agent answered.
  await c.click('inspector.tab.notes')
  const lane = await c.box('notes.lane')
  await c.dragAt(await lib.timeX(c, 1), lane.cy, await lib.timeX(c, 3), lane.cy, { steps: 8, mods: ['shift'] })
  await c.waitId('notes.draft.text')
  await c.click('notes.kind.fix')
  await c.click('notes.draft.text')
  await c.type('The title is cut off: move it up')
  await c.click('notes.draft.save')
  await c.waitFor('a note', async () => (await c.st((s) => (s.project.notes ?? []).length)) === 1)
  await c.run(() => window.__store.getState().editNotes((p) => { const n = p.notes[0]; n.status = 'ready'; n.reply = 'Moved the title up 40 px.'; n.touched = [[1, 3]] }, false))
  await shot('08-notlar.png')

  // 9. The Agent tab with a draft (a scripted agent cuts the pauses).
  await c.waitFor('the agent host', () => c.ev('!!window.__agent'))
  await c.run(() => window.__agent.setMode('draft'))
  await c.click('inspector.tab.agent')
  await accessOn(c)
  const ag = await connectAgent({ c, app, assert, client: 'screens-3c' })
  const p = await ag.call('project')
  const sil = await ag.call('analyze', { kind: 'silences' })
  await ag.call('edit', { ops: [{ op: 'apply', result: resultOf(sil.text) }], base: versionOf(sil.text) ?? versionOf(p.text) })
  await c.waitId('agent.draft')
  await shot('09-ajan-sekmesi-taslakli.png', 800)
  await c.run(() => window.__agent.reject())

  // 10. The export window.
  await c.click('topbar.export')
  await c.waitId('dialog.export')
  await shot('10-disa-aktarma.png')
  await c.click('export.cancel')
  await c.waitGone('dialog.export')

  // 12. The project home, with this project saved once (so it lists one).
  const file = join(work, 'screens 3c.snipp')
  lib.answer(app, { kind: 'save', path: file })
  await c.click('timeline.scroll', { fx: 0.95, fy: 0.97 })
  await c.key('s', ['ctrl'])
  await c.waitFor('saved', async () => !(await c.st((s) => s.dirty)), 10000)
  await c.click('topbar.file')
  await c.click('menu.file.projects')
  await shot('12-proje-ana-ekrani.png', 900)
  await c.key('Escape')
  console.log(`     screenshots: ${dir}`)
}
