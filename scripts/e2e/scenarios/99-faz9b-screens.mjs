// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// Phase 9b (FAZ9.md 9b, "bitti ölçüsü"): twelve screens in both languages,
// and no cut-off words. In each of the twelve states, English and Turkish,
// every visible button, tab and segment is measured: its words fit
// (scrollWidth ≤ clientWidth, of the label where the button has one). The
// count must be 0. With SNIPP_SCREENS_9=<folder> the screens are kept as
// <folder>\en\NN-*.png and <folder>\tr\NN-*.png (tasarim\ekranlar\9).
//   01 the empty start · 02 the editor with media · 03 the timeline close ·
//   04–06 the Inspector: clip, subtitles, project · 07 templates · 08 notes ·
//   09 the Agent tab with a draft · 10 the export window · 11 the tour ·
//   12 the projects window (with the sample card)
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { SUBS } from '../media.mjs'
import { connectAgent, resultOf, versionOf } from '../agent-client.mjs'
import { accessOn } from '../session.mjs'
export const name = 'faz9b-screens-overflow'

/** The media panel's width in a fresh profile (components/app/timeline-size.ts readLayout). */
const DEFAULT_BIN = 220

/** In the page: the visible buttons, tabs and segments whose words do not fit. */
function cutOff() {
  const vis = (el) => {
    const r = el.getBoundingClientRect()
    if (r.width < 2 || r.height < 2 || r.right <= 0 || r.bottom <= 0 || r.left >= innerWidth || r.top >= innerHeight) return false
    for (let e = el; e; e = e.parentElement) {
      const cs = getComputedStyle(e)
      if (cs.display === 'none' || cs.visibility === 'hidden' || Number(cs.opacity) === 0) return false
    }
    return true
  }
  const out = []
  for (const el of document.querySelectorAll('button, [role="button"], [role="tab"], [role="radio"], [role="menuitem"], [role="menuitemcheckbox"]')) {
    if (!vis(el)) continue
    const text = (el.textContent ?? '').trim()
    if (!text) continue
    // The part that holds the words: the label where there is one, else the element.
    const parts = [...el.querySelectorAll('.ui-btn-label, .ui-tab-label, .ui-seg-label, .ui-menu-label')].filter(vis)
    for (const p of parts.length ? parts : [el]) {
      if (p.scrollWidth > p.clientWidth + 1) out.push({ id: el.closest('[data-testid]')?.dataset.testid ?? '', text: (p.textContent ?? '').trim().slice(0, 40), scroll: p.scrollWidth, client: p.clientWidth })
    }
  }
  return out
}

export async function run({ c, app, media, lib, work }) {
  const { assert } = lib
  const dir = process.env.SNIPP_SCREENS_9
  const found = []
  try {
    for (const lang of ['en', 'tr']) await shoot({ c, app, media, lib, work, assert, lang, dir: dir ? join(dir, lang) : null, found })
  } finally {
    await c.run(() => { window.__store.getState().setUiLang('en'); return true })
  }
  if (dir) writeFileSync(join(dir, 'tasma.json'), JSON.stringify(found, null, 1))
  console.log(`     12 screens × 2 languages: ${found.length} cut-off words${dir ? ` · ${dir}` : ''}`)
  assert.deepEqual(found.map((f) => `${f.lang} ${f.screen}: ${f.id} "${f.text}" ${f.scroll}>${f.client}`), [], 'no cut-off words')
}

async function shoot({ c, app, media, lib, work, assert, lang, dir, found }) {
  await lib.reset(c)
  await c.run((l) => { window.__store.getState().setUiLang(l); return true }, lang)
  if (dir) mkdirSync(dir, { recursive: true })
  const at = async (screen, wait = 450) => {
    await c.sleep(wait)
    for (const f of await c.run(cutOff)) found.push({ lang, screen, ...f })
    if (dir) await c.shot(join(dir, `${screen}.png`))
  }

  // Phase 9 audit patch D7: a fresh profile's media panel has its default
  // width (lib.reset widens it): measured there too, with the tour's first
  // step on it, then widened again for the twelve screens.
  {
    const wide = await c.box('splitter.bin')
    await c.dragAt(wide.cx, wide.cy, DEFAULT_BIN + 3, wide.cy, { steps: 6 })
    await c.waitFor('the default width', async () => Math.abs((await c.box('splitter.bin')).x - DEFAULT_BIN) <= 2)
    await c.click('topbar.file')
    await c.click('menu.file.tour')
    await c.waitId('tour')
    await c.sleep(450)
    for (const f of await c.run(cutOff)) found.push({ lang, screen: '00-varsayilan-genislik', ...f })
    const imp = await c.box('media.import')
    const bubble = await c.box('tour')
    assert.ok(imp && bubble, 'the import button and the tour bubble are there')
    await c.click('tour.skip')
    await c.waitGone('tour')
    const narrow = await c.box('splitter.bin')
    await c.dragAt(narrow.cx, narrow.cy, 340, narrow.cy, { steps: 6 })
  }
  await at('01-bos-acilis')

  const [talk, other, card] = await lib.seedAssets(app, c, [media.talk, media.other, media.numbered[2]])
  await lib.seedTimeline(c, [talk.id, other.id, card.id])
  await c.run((subs) => { const s = window.__store.getState(); s.setSubtitles(subs.map((x, i) => ({ id: 's' + i, ...x }))); s.setDirty(false) }, SUBS)
  await lib.seek(c, 2)
  await c.waitFor('three clips', async () => (await lib.clipList(c)).length === 3)
  await at('02-medya-dolu-editor')

  // 03: the timeline, close (its own box).
  await c.sleep(300)
  for (const f of await c.run(cutOff)) found.push({ lang, screen: '03-cizelge-yakin', ...f })
  if (dir) {
    const b = await c.box('timeline.scroll')
    const r = await c.capture({ format: 'png', clip: { x: Math.max(0, b.x - 4), y: Math.max(0, b.y - 4), width: b.w + 8, height: b.h + 8, scale: 1 } })
    writeFileSync(join(dir, '03-cizelge-yakin.png'), Buffer.from(r.data, 'base64'))
  }

  const [first] = await lib.clipList(c)
  await c.click(`timeline.clip.${first.id}`, { fx: 0.5 })
  await c.click('inspector.tab.clip')
  await c.waitFor('the clip selected', async () => (await c.st((s) => s.selectedClipIds.length)) >= 1)
  await at('04-inspector-klip')
  await c.click('inspector.tab.subs')
  await at('05-inspector-altyazi')
  await c.click('inspector.tab.project')
  await at('06-inspector-proje')

  await lib.templatesPage(c)
  await at('07-sablonlar')
  await lib.dockPage(c, 'media')

  await c.click('inspector.tab.notes')
  const lane = await c.box('notes.lane')
  await c.dragAt(await lib.timeX(c, 1), lane.cy, await lib.timeX(c, 3), lane.cy, { steps: 8, mods: ['shift'] })
  await c.waitId('notes.draft.text')
  await c.click('notes.kind.fix')
  await c.click('notes.draft.text')
  await c.type(lang === 'tr' ? 'Başlık kesik: yukarı al' : 'The title is cut off: move it up')
  await c.click('notes.draft.save')
  await c.waitFor('a note', async () => (await c.st((s) => (s.project.notes ?? []).length)) === 1)
  await c.run((l) => window.__store.getState().editNotes((p) => { const n = p.notes[0]; n.status = 'ready'; n.reply = l === 'tr' ? 'Başlığı 40 px yukarı aldım.' : 'Moved the title up 40 px.'; n.touched = [[1, 3]] }, false), lang)
  await at('08-notlar')

  await c.waitFor('the agent host', () => c.ev('!!window.__agent'))
  await c.run(() => window.__agent.setMode('draft'))
  await accessOn(c)
  await lib.keepBoxOpen(c)
  await c.click('inspector.tab.agent')
  const ag = await connectAgent({ c, app, assert, client: 'faz9b-screens' })
  const p = await ag.call('project')
  const sil = await ag.call('analyze', { kind: 'silences' })
  await ag.call('edit', { ops: [{ op: 'apply', result: resultOf(sil.text) }], base: versionOf(sil.text) ?? versionOf(p.text) })
  await c.waitId('agent.draft')
  await at('09-ajan-sekmesi-taslakli', 800)
  await c.run(() => window.__agent.reject())

  await c.click('topbar.export')
  await c.waitId('dialog.export')
  await at('10-disa-aktarma')
  await c.click('export.cancel')
  await c.waitGone('dialog.export')

  await c.click('topbar.file')
  await c.click('menu.file.tour')
  await c.waitId('tour')
  await c.click('tour.next')
  await at('11-tur', 600)
  await c.click('tour.skip')
  await c.waitGone('tour')

  const file = join(work, `screens 9b ${lang}.snipp`)
  lib.answer(app, { kind: 'save', path: file })
  await c.click('timeline.scroll', { fx: 0.95, fy: 0.97 })
  await c.key('s', ['ctrl'])
  await c.waitFor('saved', async () => !(await c.st((s) => s.dirty)), 10000)
  await c.click('topbar.file')
  await c.click('menu.file.projects')
  await c.waitId('home.sample')
  await at('12-proje-ana-ekrani', 900)
  await c.key('Escape')
}
