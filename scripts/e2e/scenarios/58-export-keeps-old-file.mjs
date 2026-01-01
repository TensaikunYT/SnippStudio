// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// Phase Ç3 patch (haritalar/_fazc3-denetim-dayaniklilik.md R-1, R-2): a file
// of the target's name is never lost to an export that does not finish.
//  A) Cancel while the written film is checked (MP4, WebM) or while the sound
//     alone is saved (M4A, MP3, WAV): the old file is there byte for byte, no
//     .part, the card says Cancelled.
//  B) A full disk while the sound alone, the frame or a Shorts batch's sound
//     is written: the old file is there byte for byte, no .part, the sentence
//     is plain. Not enough room for the sound: refused before it is mixed.
// The file operations are slowed by the main process's test hook
// (test:disk-fault slowMs) so the Cancel lands while one is in flight.
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { TESTDATA } from '../media.mjs'
export const name = 'export-keeps-old-file'

/** The export window's outputs are ticks (DENEME-4, worker W): only `kind` ticked. */
async function only(c, kind) {
  for (const k of ['video', 'sound', 'frame']) {
    const on = await c.run((id) => document.querySelector(`[data-testid="export.out.${id}"]`)?.checked ?? null, k)
    if (on === null) continue
    if (on !== (k === kind)) await c.click(`export.out.${k}`)
  }
}

const OLD = Buffer.from('THE OLD FILE THE USER KEPT. '.repeat(400), 'latin1')

/** Cancel the running export the moment its card shows a label matching `re`. */
async function cancelOn(c, re) {
  await c.run((src) => {
    const re = new RegExp(src)
    let fired = false
    const un = window.__store.subscribe((st) => {
      if (fired || !re.test(st.exportStatus?.label ?? '')) return
      fired = true
      un()
      void window.__exportJob().then(([, job]) => job.cancelExportJob())
    })
    return true
  }, re.source)
}

async function viaWindow(c, app, lib, file, pick) {
  writeFileSync(file, OLD)
  rmSync(file + '.part', { force: true })
  await c.click('topbar.export')
  await c.waitId('dialog.export')
  await pick()
  lib.answer(app, { kind: 'save', path: file })
  await c.click('export.start')
  await c.waitGone('dialog.export')
  let st = null
  await c.waitFor('the export ended', async () => {
    st = await c.st((s) => s.exportStatus)
    return st?.done
  }, 120000, 100)
  await c.sleep(400)
  const now = existsSync(file) ? readFileSync(file) : null
  return { label: st.label, cancelled: !!st.cancelled, error: st.error ?? null, kept: !!now && now.equals(OLD), part: existsSync(file + '.part') }
}

export async function run({ c, app, media, lib }) {
  const { assert } = lib
  // Every case runs; the failures are listed together at the end.
  const bad = []
  const check = { ok: (v, m) => { if (!v) bad.push(m) }, equal: (a, b, m) => { if (a !== b) bad.push(` (${a})`) }, match: (s, re, m) => { if (!re.test(s)) bad.push(m) } }
  const out = join(TESTDATA, 'cikti', 'e2e-old-file')
  rmSync(out, { recursive: true, force: true })
  mkdirSync(out, { recursive: true })
  const [other] = await lib.seedAssets(app, c, [media.other])
  await lib.seedTimeline(c, [other.id])

  try {
    // ---- A: Cancel before the new file replaces the old one -----------------
    await c.run(() => window.api.testDiskFault({ slowMs: 600 }))
    const cases = [
      { what: 'mp4', re: /Checking the written file/, pick: async () => { await only(c, 'video'); await c.select('export.format', 'mp4') } },
      { what: 'webm', re: /Checking the written file/, pick: async () => { await only(c, 'video'); await c.select('export.format', 'webm') } },
      { what: 'm4a', re: /Saving the file/, pick: async () => { await only(c, 'sound'); await c.select('export.sound-format', 'm4a') } },
      { what: 'mp3', re: /Saving the file/, pick: async () => { await only(c, 'sound'); await c.select('export.sound-format', 'mp3') } },
      { what: 'wav', re: /Saving the file/, pick: async () => { await only(c, 'sound'); await c.select('export.sound-format', 'wav') } }
    ]
    const seen = {}
    for (const k of cases) {
      await cancelOn(c, k.re)
      const r = await viaWindow(c, app, lib, join(out, `cancel.${k.what}`), k.pick)
      seen[k.what] = r
      check.ok(r.kept, `${k.what}: the old file is untouched after a Cancel (${JSON.stringify(r)})`)
      check.equal(r.part, false, `${k.what}: no .part left`)
      check.equal(r.cancelled, true, `${k.what}: the card says Cancelled (${r.label})`)
    }

    // ---- B: a full disk while a whole file is written ---------------------------
    await c.run(() => window.api.testDiskFault({ fullAfter: 4096 }))
    const wav = await viaWindow(c, app, lib, join(out, 'full.wav'), async () => { await only(c, 'sound'); await c.select('export.sound-format', 'wav') })
    check.ok(wav.kept, `sound: the old file is untouched on a full disk (${JSON.stringify(wav)})`)
    check.equal(wav.part, false, 'sound: no .part left')
    check.match(wav.error ?? '', /^The disk is full: /, `sound: a plain sentence (${wav.error})`)
    const png = await viaWindow(c, app, lib, join(out, 'full.png'), async () => { await only(c, 'frame') })
    check.ok(png.kept, `frame: the old file is untouched on a full disk (${JSON.stringify(png)})`)
    check.equal(png.part, false, 'frame: no .part left')
    check.match(png.error ?? '', /^The disk is full: /, `frame: a plain sentence (${png.error})`)

    // Not enough room for the sound: refused before it is mixed.
    await c.run(() => window.api.testDiskFault({ free: 1000 }))
    const short = await viaWindow(c, app, lib, join(out, 'short.wav'), async () => { await only(c, 'sound'); await c.select('export.sound-format', 'wav') })
    check.ok(short.kept, 'sound, no room: the old file is untouched')
    check.match(short.error ?? '', /it needs about .* and the disk has .* free/, `sound, no room: refused with the sizes (${short.error})`)

    // A Shorts batch's sound into a folder that holds a file of its name.
    const folder = join(out, 'batch')
    mkdirSync(folder, { recursive: true })
    const segs = await c.run(() => {
      const s = window.__store.getState()
      const p = structuredClone(s.project)
      p.mode = 'shorts'
      p.name = 'batch'
      p.shortSegments = [
        { id: 'sa', name: 'A', start: 0, end: 2, keyframes: [] },
        { id: 'sb', name: 'B', start: 2, end: 4, keyframes: [] }
      ]
      s.loadProject(p)
      return window.__store.getState().project.shortSegments
    })
    const first = join(folder, 'batch - A.wav')
    writeFileSync(first, OLD)
    await c.run(() => window.api.testDiskFault({ fullAfter: 4096 }))
    lib.answer(app, { kind: 'open', paths: [folder] })
    await c.run((segs) => {
      window.__exportShorts(segs)
      return true
    }, segs)
    await c.waitId('dialog.export')
    await only(c, 'sound')
    await c.select('export.sound-format', 'wav')
    await c.click('export.start')
    await c.waitGone('dialog.export')
    let st = null
    await c.waitFor('the batch ended', async () => {
      st = await c.st((s) => s.exportStatus)
      return st?.done
    }, 120000, 100)
    await c.sleep(400)
    check.ok(readFileSync(first).equals(OLD), `batch: the old "batch - A.wav" is untouched (${st.error})`)
    check.equal(readdirSync(folder).filter((f) => f.endsWith('.part')).length, 0, 'batch: no .part left')
    check.match(st.error ?? '', /The disk is full: /, `batch: a plain sentence (${st.error})`)
    for (const b of bad) console.log('     FAILED: ' + b)
    assert.deepEqual(bad, [],'the old file kept in every case')
    console.log(`     Cancel: ${Object.keys(seen).join(', ')} kept the old file; full disk: sound, frame, batch kept it; no room: refused before the mix`)
  } finally {
    await c.run(() => window.api.testDiskFault({})).catch(() => {})
    rmSync(out, { recursive: true, force: true })
  }
}
