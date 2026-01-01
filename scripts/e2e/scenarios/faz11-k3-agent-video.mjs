// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// Phase 11a, K3: a whole video with an agent (a scripted one over real HTTP,
// the app's own agent server). The 2-minute English talk with its subtitles
// (the speech model's own lines of it, testdata\ham\*.whisper.json) → the
// agent's rough cut as a draft (silences, repeats, chapter titles) →
// accepted with the card's button → three code clips straight from the agent
// (create, pages written, check) → accepted → a round of notes (the user
// writes two, the agent answers, the user approves) → a 1080p export.
// ("Look and suggest" is out of the product: phase 6 was removed.)
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { probeDuration, probeStreams, TESTDATA } from '../media.mjs'
import { connectAgent, itemsOf, resultOf, versionOf } from '../agent-client.mjs'
import { installProbe, keepModelCount, record, tally } from '../kesif.mjs'
export const optIn = true
export const name = 'faz11-k3-agent-video'
export const timeoutMs = 25 * 60_000

const PAGE = (hue) => `<!doctype html><html><head><meta charset="utf-8"></head><body style="margin:0;background:transparent"><canvas id="c" width="960" height="540"></canvas><script>
var g=document.getElementById('c').getContext('2d');
function frame(t){ g.clearRect(0,0,960,540); g.fillStyle='hsl(${hue},80%,55%)'; g.fillRect(40+t*0.08,380,220,90); g.fillStyle='#fff'; g.font='48px sans-serif'; g.fillText('Part',60+t*0.08,440); requestAnimationFrame(frame) }
requestAnimationFrame(frame);
</script></body></html>`

/** The speech model's own lines of a talk, as the app's subtitles. */
function whisperCaptions(file) {
  const j = JSON.parse(readFileSync(file, 'utf8'))
  const lines = j.captions ?? j.lines ?? j
  return lines.map((l, i) => ({ id: `w${i}`, start: l.start, end: l.end, text: l.text.trim(), words: (l.words ?? []).map((w) => ({ text: (w.text ?? w.word).trim(), start: w.start, end: w.end })) }))
}

export async function run({ c, app, lib, work }) {
  const { assert } = lib
  await installProbe(c)
  const steps = []
  const t0 = Date.now()
  const step = (what) => { steps.push({ what, s: +((Date.now() - t0) / 1000).toFixed(1) }); console.log(`     ${steps.at(-1).s}s ${what}`) }
  let out = null
  try {
    await c.waitFor('the agent host', () => c.ev('!!window.__agent'))
    const talk = join(TESTDATA, 'ham', 'ham-02dk-en.mp4')
    const [a] = await lib.seedAssets(app, c, [talk])
    await lib.seedTimeline(c, [a.id])
    const caps = whisperCaptions(join(TESTDATA, 'ham', 'ham-02dk-en.whisper.json'))
    await c.run((k) => { const s = window.__store.getState(); s.setSubtitles(k); s.setDirty(false); window.__agent.setMode('draft'); return true }, caps)
    // Saved first (code clips live beside the project file).
    const dir = join(work, 'k3')
    mkdirSync(dir, { recursive: true })
    const file = join(dir, 'k3.snipp')
    lib.answer(app, { kind: 'save', path: file })
    await c.click('timeline.scroll', { fx: 0.95, fy: 0.97 })
    await c.key('s', ['ctrl'])
    await c.waitFor('saved', async () => existsSync(file) && !(await c.st((s) => s.dirty)), 15000)
    const len0 = await c.st((s) => Math.max(...Object.values(s.project.clips).map((k) => k.start + k.duration)))
    step(`talk ${len0.toFixed(1)} s, ${caps.length} lines, saved`)

    // ---- the rough cut, as a draft -----------------------------------------
    const ag = await connectAgent({ c, app, assert, client: 'faz11-k3' })
    const v0 = versionOf((await ag.call('project')).text)
    await ag.call('transcript')
    const sil = await ag.call('analyze', { kind: 'silences' })
    const rep = await ag.call('analyze', { kind: 'repeats' })
    const ops = [{ op: 'apply', result: resultOf(sil.text) }]
    if (resultOf(rep.text) && itemsOf(rep.text).length) ops.push({ op: 'apply', result: resultOf(rep.text) })
    await ag.call('edit', { ops, base: v0 })
    const ids = caps.filter((_, i) => i % Math.ceil(caps.length / 3) === 0).slice(0, 3).map((k) => k.id)
    step('chapter anchors: ' + ids.map((id) => { const k = caps.find((x) => x.id === id); return id + '#0 "' + k.words[0]?.text + '" @' + k.words[0]?.start }).join(', '))
    await ag.call('edit', { ops: ids.map((id, i) => ({ op: 'text.add', time: `${id}#0`, text: `Chapter ${i + 1}` })), base: v0 })
    await ag.call('project')
    await c.click('inspector.tab.agent')
    await c.waitId('agent.draft', 15000)
    await c.waitFor('accept enabled', () => c.run(() => !document.querySelector('[data-testid="agent.draft.acceptAll"]')?.disabled), 30000)
    const sum1 = await c.ev(`document.querySelector('[data-testid="agent.draft.headline"]')?.textContent ?? ''`)
    const dropped1 = await c.run(() => [...document.querySelectorAll('.agent-op.is-dropped')].map((e) => e.textContent.trim().slice(0, 160)))
    await c.click('agent.draft.acceptAll')
    await c.waitGone('agent.draft', 60000)
    const len1 = await c.st((s) => Math.max(...Object.values(s.project.clips).map((k) => k.start + k.duration)))
    const chapters = await c.st((s) => s.project.captions.filter((k) => /^Chapter \d$/.test(k.text)).length)
    assert.ok(len1 < len0, `the rough cut shortened it (${len0} → ${len1})`)
    step(`rough cut accepted: ${len0.toFixed(1)} → ${len1.toFixed(1)} s; ${chapters} chapter titles; card: ${sum1}; dropped ${JSON.stringify(dropped1)}`)
    assert.ok(chapters + dropped1.length >= 3, 'each chapter title is there or dropped with its reason')

    // ---- three code clips ----------------------------------------------------
    const ranges = [[2, 5], [30, 34], [len1 - 8, len1 - 4]]
    const made = []
    for (const [i, [s0, s1]] of ranges.entries()) {
      const r = await ag.call('code_clip', { create: { name: `part${i + 1}`, start: s0, end: s1 } })
      const folder = /^Folder: (.+?) \(/.exec(r.text)?.[1]
      const clip = /clip=([A-Za-z0-9_-]+)/.exec(r.text)?.[1]
      assert.ok(folder && clip, r.text)
      writeFileSync(join(folder, 'index.html'), PAGE(40 + i * 100))
      made.push({ folder, clip })
    }
    await c.sleep(3000)
    const verdicts = []
    for (const m of made) verdicts.push((await ag.call('code_clip', { check: m.clip })).text.split('\n')[0])
    await ag.call('project')
    await c.click('inspector.tab.agent')
    await c.waitId('agent.draft', 15000)
    await c.waitFor('accept enabled', () => c.run(() => !document.querySelector('[data-testid="agent.draft.acceptAll"]')?.disabled), 30000)
    await c.click('agent.draft.acceptAll')
    await c.waitGone('agent.draft', 60000)
    const codeClips = await c.st((s) => Object.values(s.project.clips).filter((k) => s.project.assets.find((x) => x.id === k.assetId)?.kind === 'code').length)
    assert.equal(codeClips, 3, 'three code clips in the project')
    step(`code clips: ${verdicts.map((v) => v.replace(/^\S+: /, '')).join(' | ')}`)

    // ---- a round of notes ---------------------------------------------------
    await c.run(() => {
      const s = window.__store.getState()
      s.startNoteDraft({ start: 10, end: 12 }); s.patchNoteDraft({ text: 'cut this stretch', kind: 'cut' }); s.saveNoteDraft()
      s.startNoteDraft({ start: 40, end: 41 }); s.patchNoteDraft({ text: 'a title here', kind: 'fix' }); s.saveNoteDraft()
      return true
    })
    const notes = await ag.call('notes')
    assert.match(notes.text, /cut this stretch/)
    const vN = versionOf((await ag.call('project')).text)
    const noteEdit = await ag.call('edit', { ops: [{ op: 'timeline.cutRanges', ranges: [[10, 12]] }, { op: 'text.add', time: 40, text: 'Here' }], base: vN })
    step('note edit: ' + noteEdit.text.split(String.fromCharCode(10))[0].slice(0, 160))
    await ag.call('project')
    await c.click('inspector.tab.agent')
    await c.waitId('agent.draft', 15000)
    await c.waitFor('accept enabled', () => c.run(() => !document.querySelector('[data-testid="agent.draft.acceptAll"]')?.disabled), 30000)
    await c.click('agent.draft.acceptAll')
    await c.waitGone('agent.draft', 60000)
    await ag.call('notes', { update: [{ id: 1, status: 'ready', reply: 'Cut it.', touched: [[10, 10.5]] }, { id: 2, status: 'ready', reply: 'Added a title.', touched: [[38, 40]] }] })
    await c.click('inspector.tab.notes')
    await c.click('notes.review')
    await c.waitId('review.bar')
    for (let i = 0; i < 2; i++) {
      await c.click('review.approve')
      await c.sleep(400)
    }
    await c.waitFor('both approved', async () => (await c.st((s) => s.project.notes.filter((n) => n.status === 'approved').length)) === 2, 15000)
    step('notes: two written, answered, approved')

    // ---- export 1080p ---------------------------------------------------------
    const outDir = join(TESTDATA, 'cikti')
    mkdirSync(outDir, { recursive: true })
    const mp4 = join(outDir, 'faz11-k3.mp4')
    rmSync(mp4, { force: true })
    const length = await c.st((s) => Math.max(...Object.values(s.project.clips).map((k) => k.start + k.duration)))
    await c.click('topbar.export')
    await c.waitId('dialog.export')
    await c.click('export.preset.yt1080')
    lib.answer(app, { kind: 'save', path: mp4 })
    const e0 = Date.now()
    await c.click('export.start')
    await c.waitGone('dialog.export')
    await c.waitFor('the export done', async () => {
      const st = await c.st((s) => s.exportStatus)
      if (st?.error) throw new Error('export failed: ' + st.error)
      return st?.done && existsSync(mp4) && statSync(mp4).size > 10000
    }, 15 * 60_000, 1000)
    const dur = probeDuration(mp4)
    const streams = probeStreams(mp4)
    const v = streams.find((s) => s.codec_type === 'video'), au = streams.find((s) => s.codec_type === 'audio')
    assert.ok(v && au)
    assert.deepEqual([v.width, v.height], [1920, 1080])
    assert.ok(Math.abs(dur - length) < 0.3, `as long as the project (${dur} vs ${length})`)
    step(`export 1080p: ${dur.toFixed(1)} s in ${((Date.now() - e0) / 1000).toFixed(0)} s`)
    out = { len0, len1, chapters, verdicts, tokens: ag.total(), calls: ag.log.length, file: { seconds: +dur.toFixed(2), video: `${v.codec_name} ${v.width}x${v.height}`, audio: au.codec_name } }
    rmSync(mp4, { force: true })
  } finally {
    await keepModelCount(c).catch(() => undefined)
    const counts = await tally(c).catch((e) => ({ crashes: 1, error: String(e) }))
    record(name, { steps, counts, out })
    console.log(`     counts: ${JSON.stringify({ ...counts, texts: undefined })}`)
  }
}
