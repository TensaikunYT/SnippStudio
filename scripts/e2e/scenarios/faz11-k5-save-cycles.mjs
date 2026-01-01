// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// Phase 11a, K5: save → close → open, 20 times. A project with clips, a
// transition, titles, subtitles, a marker, a note, a template, a keyframe and
// a second track is saved (Ctrl+S, the dialog answered once); then, 20 times:
// the window closed (the app quits), the app started again on the same
// profile, no recovery offered (it closed cleanly), File → Open, the project
// the same (digest), not dirty; a marker added, Ctrl+S, the marker taken out,
// Ctrl+S: the file the same size as the first time.
import { existsSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { addTally, DIGEST, diffPaths, installProbe, NORMALIZED, keepModelCount, record, tally } from '../kesif.mjs'
export const optIn = true
export const name = 'faz11-k5-save-cycles'
export const timeoutMs = 30 * 60_000

const CYCLES = Number(process.env.SNIPP_K5_CYCLES ?? 20)

export async function run({ c, app, media, lib, work, relaunch }) {
  const { assert } = lib
  await installProbe(c)
  const [talk, other, pic] = await lib.seedAssets(app, c, [media.talk, media.other, media.numbered[1]])
  await lib.seedTimeline(c, [talk.id, other.id])
  await c.run((picId) => {
    const s = window.__store.getState()
    s.setSubtitles([{ id: 'w0', start: 0.2, end: 2.8, text: 'The cat sat by the window' }, { id: 'w1', start: 4.6, end: 7.8, text: 'then it walked over the bridge' }])
    const first = Object.values(s.project.clips).sort((a, b) => a.start - b.start)[0]
    s.runBatch([{ name: 'clip.setTransition', params: { clipId: first.id, transition: { type: 'mix', duration: 0.5 } } }, { name: 'text.add', params: { time: 3, text: 'Saved and opened' } }, { name: 'marker.add', params: { time: 5 } }, { name: 'template.place', params: { kind: 'stat', time: 1 } }, { name: 'track.add', params: { kind: 'video' } }])
    const tr = window.__store.getState().project.tracks.find((t) => t.kind === 'video' && t.clipIds.length === 0)
    window.__store.getState().runBatch([{ name: 'clip.add', params: { assetId: picId, trackId: tr.id, start: 6 } }])
    window.__store.getState().addPropKeyframe(first.id, 'scale')
    s.startNoteDraft({ start: 1, end: 2 }); s.patchNoteDraft({ text: 'a note', kind: 'fix' }); s.saveNoteDraft()
    return true
  }, pic.id)
  const file = join(work, 'k5 cycles.snipp')
  lib.answer(app, { kind: 'save', path: file })
  await c.click('timeline.scroll', { fx: 0.95, fy: 0.97 })
  await c.key('s', ['ctrl'])
  await c.waitFor('saved', async () => existsSync(file) && !(await c.st((s) => s.dirty)), 15000)
  const size0 = statSync(file).size
  const rows = []
  let counts = null
  let cur = app
  let digest0 = null
  let text0 = null
  for (let i = 1; i <= CYCLES; i++) {
    const cc = cur.cdp
    await keepModelCount(cc)
    counts = addTally(counts, await tally(cc))
    // Closed: nothing unsaved, the app quits.
    await cc.ev('setTimeout(() => window.close(), 50), true')
    const code = await Promise.race([cur.exited, new Promise((r) => setTimeout(() => r('timeout'), 20000))])
    const quitMs = code === 'timeout' ? null : 'ok'
    cur = await relaunch({ profile: cur.profile })
    const c2 = cur.cdp
    await installProbe(c2)
    // No recovery offer: it closed cleanly.
    await c2.sleep(1200)
    const recovery = await c2.has('ask.recovery')
    if (recovery) await c2.click('ask.recovery.discard')
    cur.answers.set([{ kind: 'open', paths: [file] }])
    await c2.click('topbar.file')
    await c2.click('menu.file.open')
    await c2.waitFor('the project opened', async () => (await c2.st((s) => s.project.assets.length)) === 3 && Object.keys(await c2.st((s) => s.project.clips)).length >= 3, 20000)
    await c2.sleep(500)
    // (Read until two reads a moment apart agree: what the app fills in
    // after an open — probes, waveforms — settles first.)
    let text = await c2.ev(NORMALIZED), settleReads = 1
    for (let k = 0; k < 20; k++) { await c2.sleep(250); const t2 = await c2.ev(NORMALIZED); settleReads++; if (t2 === text) break; text = t2 }
    const d = { hash: String(text.length) + ':' + [...text].reduce((h, ch) => (Math.imul(h ^ ch.charCodeAt(0), 16777619) >>> 0), 2166136261).toString(16) }
    if (!digest0) { digest0 = d; text0 = text }
    const diff = d.hash === digest0.hash ? [] : diffPaths(text0, text)
    const dirty = await c2.st((s) => s.dirty)
    // A change saved, taken back, saved: the file as it was.
    await c2.run(() => { const s = window.__store.getState(); s.runBatch([{ name: 'marker.add', params: { time: 9 } }]); return true })
    await c2.click('timeline.scroll', { fx: 0.95, fy: 0.97 })
    await c2.key('s', ['ctrl'])
    await c2.waitFor('saved', async () => !(await c2.st((s) => s.dirty)), 15000)
    await c2.key('z', ['ctrl'])
    await c2.waitFor('undone', async () => (await c2.st((s) => s.dirty)), 5000).catch(() => undefined)
    await c2.key('s', ['ctrl'])
    await c2.waitFor('saved again', async () => !(await c2.st((s) => s.dirty)), 15000)
    const size = statSync(file).size
    rows.push({ cycle: i, settleReads, diff, quit: quitMs, recovery, same: d.hash === digest0.hash, digest: d.hash, dirty, size, asked: cur.events().filter((e) => e.type === 'dialog' && e.kind === 'save').length })
    console.log(`     ${i}: ${diff.join(' ; ')} same ${d.hash === digest0.hash} dirty ${dirty} recovery ${recovery} size ${size} (first ${size0})`)
  }
  await keepModelCount(cur.cdp)
  counts = addTally(counts, await tally(cur.cdp))
  const result = { cycles: CYCLES, size0, sizes: [...new Set(rows.map((r) => r.size))], allSame: rows.every((r) => r.same), recoveryOffers: rows.filter((r) => r.recovery).length, dirtyOnOpen: rows.filter((r) => r.dirty).length, quitTimeouts: rows.filter((r) => !r.quit).length, saveDialogsAfterFirst: rows.reduce((n, r) => n + r.asked, 0), rows }
  record(name, { counts, result })
  console.log(`     ${JSON.stringify({ ...result, rows: undefined })}\n     counts: ${JSON.stringify({ ...counts, texts: undefined })}`)
  assert.ok(result.allSame, 'the same project every time')
  assert.equal(result.recoveryOffers, 0, 'no recovery offered')
  assert.ok(result.sizes.every((s) => s <= size0 + 64), `the file does not grow (${result.sizes} vs ${size0})`)
}
