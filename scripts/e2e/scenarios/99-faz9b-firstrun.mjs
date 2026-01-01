// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// Phase 9b (FAZ9-PLAN.md "9b"): the first run in a real window.
// - A fresh profile is English (the user's 15 November decision; no system language).
// - The tour: shown once on a fresh profile, start to end (five steps, each
//   beside its part, the window working under it), seen afterwards; again from
//   File → Help, ended there with "Skip".
// - The empty states: one sentence and one button each, and the buttons do
//   their job (media, timeline, notes, templates, exports).
// - The sample project: made by the app (≤ 10 MB, nothing of anyone's), opens
//   as a saved copy, plays, and exports.
import { existsSync, readdirSync, rmSync, statSync, mkdirSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { TESTDATA } from '../media.mjs'
export const name = 'faz9b-firstrun-tour-empty-sample'

/** The page reloaded with the tour not yet seen (as a fresh profile has it). */
async function reloadUnseen(c, lib) {
  await c.run(() => { localStorage.removeItem('snipp-tour-seen'); window.__store.getState().setDirty(false); return true })
  await c.send('Page.reload', { ignoreCache: false })
  await c.sleep(300)
  await lib.ready(c)
  for (let i = 0; i < 10; i++) {
    if (await c.has('ask.recovery')) {
      await c.click('ask.recovery.discard')
      break
    }
    await c.sleep(100)
  }
}

const dirSize = (d) => readdirSync(d, { withFileTypes: true }).reduce((n, e) => n + (e.isDirectory() ? dirSize(join(d, e.name)) : statSync(join(d, e.name)).size), 0)

export async function run({ c, app, media, lib }) {
  const { assert } = lib

  // ---- the language of a fresh profile -----------------------------------
  assert.equal(await c.st((s) => s.uiLang), 'en', 'a fresh profile is English')
  assert.equal(await c.run(() => localStorage.getItem('snipp-ui-lang')), null, 'no language was chosen for the user')

  // ---- the tour, start to end ------------------------------------------------
  await reloadUnseen(c, lib)
  await c.waitId('tour', 6000)
  const steps = []
  for (let i = 0; i < 5; i++) {
    const step = await c.attr('tour', 'data-step')
    steps.push(step)
    // Beside its part, inside the window, the part outlined.
    const where = await c.run(() => {
      const b = document.querySelector('[data-testid="tour"]').getBoundingClientRect()
      const ring = document.querySelector('.tour-ring')?.getBoundingClientRect() ?? null
      return { b: { x: b.left, y: b.top, r: b.right, btm: b.bottom }, ring: ring && { w: ring.width, h: ring.height }, vw: innerWidth, vh: innerHeight }
    })
    assert.ok(where.b.x >= 0 && where.b.r <= where.vw && where.b.y >= 0 && where.b.btm <= where.vh, `step ${step}: the bubble inside the window`)
    assert.ok(where.ring && where.ring.w > 10 && where.ring.h > 10, `step ${step}: its part outlined`)
    assert.equal(await c.ev(`document.querySelector('[data-testid="tour.count"]').textContent`), `${i + 1} / 5`)
    if (i === 1) {
      // Not modal: the window works under it (a tab of the Inspector), the bubble stays.
      await c.click('inspector.tab.project')
      assert.equal(await c.attr('inspector.tab.project', 'aria-selected'), 'true', 'a click under the tour reaches the window')
      assert.ok(await c.has('tour'), 'the tour stays')
      assert.equal(await c.ev(`document.activeElement?.closest('[data-testid="tour"]') ? 'tour' : 'other'`), 'other', 'the tour does not take the focus')
    }
    await c.click('tour.next')
    await c.sleep(150)
  }
  assert.deepEqual(steps, ['media', 'timeline', 'preview', 'agent', 'export'])
  await c.waitGone('tour')
  assert.equal(await c.run(() => localStorage.getItem('snipp-tour-seen')), '1', 'seen after Done')
  // Seen: a new start does not show it again.
  await c.send('Page.reload', { ignoreCache: false })
  await lib.ready(c)
  await c.sleep(1500)
  assert.equal(await c.has('tour'), false, 'not shown again')

  // ---- again from File → Help, and "Skip" -----------------------------------
  await c.click('topbar.file')
  await c.click('menu.file.tour')
  await c.waitId('tour')
  assert.equal(await c.attr('tour', 'data-step'), 'media', 'from the first step')
  await c.click('tour.next')
  await c.click('tour.skip')
  await c.waitGone('tour')
  // Esc ends it too.
  await c.click('topbar.file')
  await c.click('menu.file.tour')
  await c.waitId('tour')
  await c.key('Escape')
  await c.waitGone('tour')

  // ---- the empty states --------------------------------------------------------
  await lib.reset(c)
  const oneSentence = async (id) => {
    const text = await c.ev(`document.querySelector('[data-testid="${id}"] .ui-empty-text').textContent`)
    const n = text.split(/[.!?](\s|$)/).filter((x) => x && x.trim()).length
    assert.equal(n, 1, `${id}: one sentence (${text})`)
    assert.ok(await c.has(`${id}.action`), `${id}: its one button`)
  }
  await oneSentence('media.empty')
  await oneSentence('timeline.empty')
  // The timeline's button imports (the OS dialog answered: nothing chosen).
  lib.answer(app, { kind: 'open', paths: [] })
  await c.click('timeline.empty.action')
  await c.waitFor('the import dialog asked', async () => lib.dialogsAsked(app).some((d) => d.kind === 'open'))
  // Notes: its button opens a note at the playhead.
  await c.click('inspector.tab.notes')
  await oneSentence('notes.empty')
  await c.click('notes.empty.action')
  await c.waitId('notes.draft.text')
  await c.key('Escape')
  // Templates: with a template on the G lane and none selected, the button opens Library → Templates.
  await c.run(() => { const s = window.__store.getState(); s.runBatch([{ name: 'template.place', params: { kind: 'stat', time: 0 } }]); s.selectTemplate(null); return true })
  await c.click('inspector.tab.tmpl')
  await oneSentence('templates.empty')
  await c.click('templates.empty.action')
  await c.waitFor('Library → Templates', async () => (await c.attr('dock.page.templates', 'aria-selected')) === 'true')
  await lib.dockPage(c, 'media')
  // Exports: the list's button opens the export window.
  // (The exports list is the machine's, not the profile's: earlier exports
  // may fill it, and then it has no empty state to try.)
  if (await c.has('topbar.renders')) await c.click('topbar.renders')
  if (await c.has('renders.empty')) {
    await oneSentence('renders.empty')
    const [other] = await lib.seedAssets(app, c, [media.other])
    await lib.seedTimeline(c, [other.id])
    await c.click('renders.empty.action')
    await c.waitId('dialog.export')
    await c.click('export.cancel')
    await c.waitGone('dialog.export')
  } else console.log('     (the exports list is not empty on this machine: its empty state not tried)')

  // ---- the sample project --------------------------------------------------------
  await lib.reset(c)
  const samples = join(app.profile, 'samples')
  const before = existsSync(samples) ? readdirSync(samples).length : 0
  await c.click('topbar.file')
  await c.click('menu.file.sample')
  await c.waitFor('the sample project open', async () => {
    const p = await c.st((s) => ({ n: s.project.name, clips: Object.values(s.project.clips).length, dirty: s.dirty }))
    return p.clips >= 4 && !p.dirty && /Sample project/.test(p.n) && !(await c.has('ask.confirm'))
  }, 90000, 250)
  const made = await c.st((s) => ({
    kinds: s.project.assets.map((a) => a.kind).sort(),
    paths: s.project.assets.map((a) => a.path ?? ''),
    templates: (s.project.templates ?? []).length,
    titles: s.project.captions.length,
    missing: s.project.assets.filter((a) => a.missing).length
  }))
  assert.deepEqual(made.kinds, ['code', 'video', 'video', 'video'], 'three test clips and a code clip')
  assert.equal(made.templates, 1, 'a G lane template')
  assert.ok(made.titles >= 1, 'a title')
  assert.equal(made.missing, 0, 'every file there')
  assert.equal(readdirSync(samples).length, before + 1, 'one new sample folder')
  const folder = basename(dirname(made.paths.find((p) => p.endsWith('.mp4'))))
  const bytes = dirSize(join(samples, folder))
  assert.ok(bytes <= 10 * 1024 * 1024, `≤ 10 MB (${bytes})`)
  for (const p of made.paths) assert.ok(p.startsWith(samples), `inside the sample folder: ${p}`)
  assert.ok(existsSync(join(samples, folder, 'Sample project.snipp')), 'saved as a file')
  console.log(`     sample: ${folder}, ${(bytes / 1048576).toFixed(2)} MB, ${made.kinds.length} files`)

  // It plays: the playhead moves.
  await c.run(() => { const s = window.__store.getState(); s.setTime(0.5); s.setPlaying(true); return true })
  await c.sleep(1500)
  const t1 = await c.st((s) => s.currentTime)
  await c.run(() => { window.__store.getState().setPlaying(false); return true })
  assert.ok(t1 > 0.9, `it plays (${t1})`)

  // It exports (the window's own path; the save dialog answered).
  const out = join(TESTDATA, 'cikti')
  mkdirSync(out, { recursive: true })
  const mp4 = join(out, 'e2e-sample.mp4')
  rmSync(mp4, { force: true })
  await c.click('topbar.export')
  await c.waitId('dialog.export')
  if (await c.has('export.preset.yt1080')) await c.click('export.preset.yt1080')
  if ((await c.run(() => document.querySelector('[data-testid="export.youtube"]')?.checked)) === true) await c.click('export.youtube')
  lib.answer(app, { kind: 'save', path: mp4 })
  await c.click('export.start')
  await c.waitGone('dialog.export')
  await c.waitFor('the sample exported', async () => {
    const st = await c.st((s) => s.exportStatus)
    if (st?.error) throw new Error('export failed: ' + st.error)
    return st?.done && existsSync(mp4) && statSync(mp4).size > 10000
  }, 240000, 300)
  console.log(`     exported: ${(statSync(mp4).size / 1048576).toFixed(2)} MB`)
  rmSync(mp4, { force: true })

  // Again: a new copy, the first one untouched.
  await c.run(() => { window.__store.getState().setDirty(false); return true })
  await c.click('topbar.file')
  await c.click('menu.file.sample')
  await c.waitFor('a second copy', async () => readdirSync(samples).length === before + 2 && !(await c.st((s) => s.project.assets[0]?.path ?? '')).includes(join(samples, folder)), 90000, 250)
  assert.ok(existsSync(join(samples, folder, 'Sample project.snipp')), 'the first copy is still there')
}
