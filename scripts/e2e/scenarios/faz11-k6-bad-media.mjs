// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// Phase 11a, K6: broken and missing media, through the window's own Import
// and File → Open. For each case what the user is told (toasts, badges,
// dialogs) is written down; expected: a plain message, no crash, no error box.
//   missing      a saved project whose file is gone, opened again
//   truncated    an MP4 cut at 40 % (its index at the end is gone)
//   empty        a zero-byte .mp4
//   wrongExt     a PNG named .mp4, and an MP4 named .png
//   deleted      a file deleted while it is on the timeline: played, then exported
//   undecodable  ProRes (no decoder on this computer)
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { join } from 'node:path'
import { E2E_MEDIA, ffmpegBin, TESTDATA } from '../media.mjs'
import { installProbe, keepModelCount, record, tally } from '../kesif.mjs'
export const optIn = true
export const name = 'faz11-k6-bad-media'
export const timeoutMs = 10 * 60_000

const WATCH = `(() => {
  if (window.__said) return true
  window.__said = []
  const seen = new WeakSet()
  const look = () => {
    for (const e of document.querySelectorAll('[data-testid="toast.stack"] [data-testid^="toast."], [data-testid^="ask."][role="dialog"], [role="alertdialog"], [data-testid="media.undecodable"], [data-testid^="media.missing"], .is-missing')) {
      if (seen.has(e)) continue
      seen.add(e)
      const t = (e.textContent || e.getAttribute('title') || e.getAttribute('aria-label') || e.dataset.testid || '').trim()
      if (t) window.__said.push(t.slice(0, 240))
    }
  }
  new MutationObserver(look).observe(document.body, { childList: true, subtree: true, attributes: true })
  look()
  return true
})()`

export async function run({ c, app, media, lib, work }) {
  const { assert } = lib
  await installProbe(c)
  const dir = join(work, 'bad')
  mkdirSync(dir, { recursive: true })
  const cases = {}
  const said = async () => { const s = await c.ev('window.__said ?? []'); await c.ev('window.__said = [], true'); return s }
  const watch = () => c.ev(WATCH)
  const importFiles = async (paths) => {
    await watch()
    lib.answer(app, { kind: 'open', paths })
    const n0 = await c.st((s) => s.project.assets.length)
    await lib.dockPage(c, 'media')
    await c.click('media.import')
    await c.sleep(4000)
    return { added: (await c.st((s) => s.project.assets.length)) - n0, assets: await c.st((s) => s.project.assets.map((a) => ({ name: a.name, duration: a.duration, kind: a.kind, missing: !!a.missing, undecodable: !!a.undecodable }))) }
  }

  // ---- truncated, empty, wrong extension ------------------------------------
  const buf = readFileSync(media.talk)
  const truncated = join(dir, 'truncated.mp4')
  writeFileSync(truncated, buf.subarray(0, Math.floor(buf.length * 0.4)))
  const empty = join(dir, 'empty.mp4')
  writeFileSync(empty, Buffer.alloc(0))
  const pngAsMp4 = join(dir, 'picture.mp4')
  copyFileSync(media.numbered[0], pngAsMp4)
  const mp4AsPng = join(dir, 'video.png')
  copyFileSync(media.other, mp4AsPng)
  for (const [k, f] of [['truncated', truncated], ['empty', empty], ['pngAsMp4', pngAsMp4], ['mp4AsPng', mp4AsPng]]) {
    const r = await importFiles([f])
    // On the timeline too, if it came in; then a moment of playing.
    if (r.added) {
      await c.click('media.add-all').catch(() => undefined)
      await c.run(() => { const s = window.__store.getState(); s.setTime(0); s.setPlaying(true); return true })
      await c.sleep(1200)
      await c.run(() => { window.__store.getState().setPlaying(false); return true })
    }
    cases[k] = { ...r, said: await said() }
    console.log(`     ${k}: added ${r.added}; said ${JSON.stringify(cases[k].said).slice(0, 220)}`)
    await keepModelCount(c)
    await lib.reset(c)
  }

  // ---- undecodable --------------------------------------------------------
  const mov = join(E2E_MEDIA, 'prores.mov')
  if (!existsSync(mov)) spawnSync(ffmpegBin('ffmpeg'), ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc2=size=640x360:rate=30:duration=2', '-c:v', 'prores_ks', '-profile:v', '2', mov], { windowsHide: true })
  {
    const r = await importFiles([mov])
    await c.click('media.add-all').catch(() => undefined)
    await c.sleep(1500)
    cases.undecodable = { ...r, badge: await c.has('media.undecodable'), said: await said() }
    console.log(`     undecodable: badge ${cases.undecodable.badge}; said ${JSON.stringify(cases.undecodable.said).slice(0, 200)}`)
    await keepModelCount(c)
    await lib.reset(c)
  }

  // ---- deleted while on the timeline: played, exported ------------------------
  {
    const f = join(dir, 'going.mp4')
    copyFileSync(media.other, f)
    const r = await importFiles([f])
    await c.click('media.add-all')
    await c.run(() => { const s = window.__store.getState(); s.setTime(0); s.setPlaying(true); return true })
    await c.sleep(800)
    await c.run(() => { window.__store.getState().setPlaying(false); return true })
    rmSync(f, { force: true })
    await c.sleep(1500)
    await c.run(() => { const s = window.__store.getState(); s.setTime(2); s.setPlaying(true); return true })
    await c.sleep(1500)
    await c.run(() => { window.__store.getState().setPlaying(false); return true })
    const outFile = join(TESTDATA, 'cikti', 'faz11-k6-deleted.mp4')
    mkdirSync(join(TESTDATA, 'cikti'), { recursive: true })
    rmSync(outFile, { force: true })
    await c.click('topbar.export')
    await c.waitId('dialog.export')
    lib.answer(app, { kind: 'save', path: outFile })
    await c.click('export.start')
    await c.waitGone('dialog.export')
    const st = await c.waitFor('the export ends', async () => { const s = await c.st((x) => x.exportStatus); return s?.error || s?.done ? s : null }, 120000, 300)
    cases.deleted = { added: r.added, exportError: st.error ?? null, exportDone: !!st.done, written: existsSync(outFile), said: await said() }
    console.log(`     deleted: export ${st.error ? 'refused: ' + String(st.error).slice(0, 140) : 'done'}; said ${JSON.stringify(cases.deleted.said).slice(0, 200)}`)
    rmSync(outFile, { force: true })
    await keepModelCount(c)
    await lib.reset(c)
  }

  // ---- missing on open ------------------------------------------------------
  {
    const f = join(dir, 'away.mp4')
    copyFileSync(media.other, f)
    await importFiles([f])
    await c.click('media.add-all')
    const file = join(dir, 'missing.snipp')
    lib.answer(app, { kind: 'save', path: file })
    await c.click('timeline.scroll', { fx: 0.95, fy: 0.97 })
    await c.key('s', ['ctrl'])
    await c.waitFor('saved', async () => existsSync(file) && !(await c.st((s) => s.dirty)), 15000)
    rmSync(f, { force: true })
    await c.run(() => { const s = window.__store.getState(); s.newProject('16:9'); s.setDirty(false); return true })
    await watch()
    app.answers.set([{ kind: 'open', paths: [file] }])
    await c.click('topbar.file')
    await c.click('menu.file.open')
    await c.sleep(4000)
    const st = await c.st((s) => ({ assets: s.project.assets.map((a) => ({ name: a.name, missing: !!a.missing })), clips: Object.keys(s.project.clips).length }))
    const dialog = await c.run(() => [...document.querySelectorAll('[role="dialog"]')].map((d) => d.textContent.slice(0, 200)))
    cases.missing = { ...st, dialog, said: await said() }
    console.log(`     missing: ${JSON.stringify(st)}; dialog ${JSON.stringify(dialog).slice(0, 200)}`)
    // Whatever dialog it is, it can be closed.
    if (dialog.length) await c.key('Escape')
  }

  await keepModelCount(c)
  const counts = await tally(c)
  record(name, { counts, cases })
  console.log(`     counts: ${JSON.stringify({ ...counts, texts: undefined })}`)
  for (const [k, v] of Object.entries(cases)) {
    const told = (v.said?.length ?? 0) + (v.badge ? 1 : 0) + (v.dialog?.length ?? 0) + (v.exportError ? 1 : 0) + (v.assets?.some((a) => a.missing) ? 1 : 0)
    const fine = k === 'mp4AsPng' && v.added === 1 // (a video named .png that plays is not an error)
    assert.ok(told > 0 || fine, `${k}: the user is told something (${JSON.stringify(v).slice(0, 200)})`)
  }
  assert.equal(counts.boundaries, 0, 'no error box')
}
