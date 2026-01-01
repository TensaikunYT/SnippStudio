// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// Phase 11a, K2: a whole video without an agent. The 10-minute Turkish talk
// through Import; its language set; the ready commands of the command box,
// done here (no agent session): subtitles (the real speech model), cut
// silences, find repeats, even out loudness — each a draft accepted with the
// card's own button; three titles; a 4K export, checked with ffprobe.
import { existsSync, mkdirSync, readFileSync, rmSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { probeDuration, probeStreams, TESTDATA } from '../media.mjs'
import { installProbe, keepModelCount, record, tally } from '../kesif.mjs'
export const optIn = true
export const name = 'faz11-k2-no-agent-video'
export const timeoutMs = 60 * 60_000

const toasts = (c) => c.run(() => [...document.querySelectorAll('[data-testid="toast.stack"] [data-testid^="toast."]')].map((e) => e.textContent ?? ''))

export async function run({ c, app, lib }) {
  const { assert } = lib
  await installProbe(c)
  const steps = []
  const t0 = Date.now()
  const step = (what) => { steps.push({ what, s: +((Date.now() - t0) / 1000).toFixed(1) }); console.log(`     ${steps.at(-1).s}s ${what}`) }
  let out = null
  try {
    // The agent switched off (as a user without one has it).
    await c.run(async () => { await window.api.agent.setEnabled(false); return true })
    const talk = join(TESTDATA, 'ham', 'ham-10dk-tr.mp4')
    lib.answer(app, { kind: 'open', paths: [talk] })
    await c.click('media.import')
    await c.waitFor('the talk', async () => (await c.st((s) => s.project.assets.filter((a) => a.duration > 500).length)) === 1, 30000)
    await c.click('media.add-all')
    await c.waitFor('on the timeline', async () => (await lib.clipList(c)).length >= 1)
    const len0 = await c.st((s) => Math.max(...Object.values(s.project.clips).map((k) => k.start + k.duration)))
    step(`imported: ${len0.toFixed(1)} s`)

    // The spoken language (the left panel's Captions page), then the ready command.
    await lib.dockPage(c, 'captions')
    await c.waitId('subs.language')
    await c.select('subs.language', 'turkish')
    await c.waitFor('Turkish', async () => (await c.st((s) => s.project.transcription?.language)) === 'turkish')
    await lib.openBox(c)
    const sub0 = Date.now()
    if (process.env.SNIPP_K2_SEED_SUBS) {
      // (A rerun: the speech model's own lines of this talk, as the ready
      // command made them in the full run; saves its 8 minutes.)
      const j = JSON.parse(readFileSync(join(TESTDATA, 'ham', 'ham-10dk-tr.whisper.json'), 'utf8'))
      await c.run((caps) => { window.__store.getState().setSubtitles(caps); return true }, j.captions)
    } else await c.click('agent.ready.subtitles')
    await c.sleep(1500)
    if (await c.has('ask.confirm')) await c.click('ask.confirm.ok')
    // (If the button only opened the tab, the tab's own button.)
    if (!process.env.SNIPP_K2_SEED_SUBS && !(await c.st((s) => !!s.transcribeProgress))) {
      const pressed = await c.run(() => { const b = [...document.querySelectorAll('button')].find((x) => x.textContent.includes('Generate subtitles') && !x.disabled); b?.click(); return !!b })
      if (pressed) step('(the ready command opened the tab; its button pressed)')
    }
    const lines = await c.waitFor('subtitles', async () => {
      const n = await c.st((s) => s.project.captions.filter((k) => k.words?.length).length)
      return n > 20 && !(await c.st((s) => !!s.transcribeProgress)) ? n : null
    }, 30 * 60_000, 2000)
    step(`subtitles: ${lines} lines in ${((Date.now() - sub0) / 1000).toFixed(0)} s`)

    // Each ready command: a draft, accepted with the card's button (or "none").
    const ready = {}
    for (const id of ['silences', 'repeats', 'loudness']) {
      await lib.openBox(c)
      const before = (await toasts(c)).length
      const len = await c.st((s) => Math.max(...Object.values(s.project.clips).map((k) => k.start + k.duration)))
      await c.click(`agent.ready.${id}`)
      const got = await c.waitFor(`${id}: a draft or a word`, async () => {
        if (await c.run(() => !!window.__agent?.draft())) return 'draft'
        const t = await toasts(c)
        return t.length > before && t.at(-1).trim() ? 'toast: ' + t.at(-1) : null
      }, 180000, 300)
      if (got === 'draft') {
        await c.click('inspector.tab.agent')
        await c.waitId('agent.draft', 15000)
        await c.waitFor('accept enabled', () => c.run(() => !document.querySelector('[data-testid="agent.draft.acceptAll"]')?.disabled), 30000)
        const summary = await c.ev(`document.querySelector('[data-testid="agent.draft.headline"]')?.textContent ?? ''`)
        await c.click('agent.draft.acceptAll')
        await c.waitGone('agent.draft', 60000)
        const after = await c.st((s) => Math.max(...Object.values(s.project.clips).map((k) => k.start + k.duration)))
        ready[id] = { summary, before: +len.toFixed(2), after: +after.toFixed(2) }
      } else ready[id] = { said: got }
      step(`${id}: ${JSON.stringify(ready[id])}`)
    }

    // Three titles.
    for (const t of [1, 60, 200]) {
      await c.run((x) => { window.__store.getState().setTime(x); return true }, t)
      await lib.addText(c)
    }
    step('three titles')

    // 4K export.
    const outDir = join(TESTDATA, 'cikti')
    mkdirSync(outDir, { recursive: true })
    const mp4 = join(outDir, 'faz11-k2-4k.mp4')
    rmSync(mp4, { force: true })
    const length = await c.st((s) => Math.max(...Object.values(s.project.clips).map((k) => k.start + k.duration), ...s.project.captions.map((k) => k.end)))
    await c.click('topbar.export')
    await c.waitId('dialog.export')
    await c.click('export.preset.yt4k')
    lib.answer(app, { kind: 'save', path: mp4 })
    const e0 = Date.now()
    await c.click('export.start')
    await c.waitGone('dialog.export')
    await c.waitFor('the 4K export done', async () => {
      const st = await c.st((s) => s.exportStatus)
      if (st?.error) throw new Error('export failed: ' + st.error)
      return st?.done && existsSync(mp4) && statSync(mp4).size > 10000
    }, 40 * 60_000, 2000)
    const exportSeconds = (Date.now() - e0) / 1000
    const dur = probeDuration(mp4)
    const streams = probeStreams(mp4)
    const v = streams.find((s) => s.codec_type === 'video'), a = streams.find((s) => s.codec_type === 'audio')
    assert.ok(v && a, 'video and sound')
    assert.deepEqual([v.width, v.height], [3840, 2160])
    step(`4K export: ${dur.toFixed(1)} s (project ${length.toFixed(1)} s) in ${exportSeconds.toFixed(0)} s`)
    out = { len0, lines, ready, length: +length.toFixed(2), file: { seconds: +dur.toFixed(2), bytes: statSync(mp4).size, video: `${v.codec_name} ${v.width}x${v.height}`, audio: a.codec_name }, exportSeconds: +exportSeconds.toFixed(1), fps: +((dur * 30) / exportSeconds).toFixed(1) }
    assert.ok(Math.abs(dur - length) < 0.3, `as long as the project (${dur} vs ${length})`)
    rmSync(mp4, { force: true })
  } finally {
    await c.run(async () => { await window.api.agent.setEnabled(true); return true }).catch(() => undefined)
    await keepModelCount(c).catch(() => undefined)
    const counts = await tally(c).catch((e) => ({ crashes: 1, error: String(e) }))
    record(name, { steps, counts, out })
    console.log(`     counts: ${JSON.stringify({ ...counts, texts: undefined })}`)
  }
}
