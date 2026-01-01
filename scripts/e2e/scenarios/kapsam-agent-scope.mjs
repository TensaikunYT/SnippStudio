// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// The agent's scope (KAPSAM-AJAN-PLAN.md; the mock-up tasarim\maket-ajan,
// screens 3 and 4). A scripted agent over real HTTP:
//   - Alt + drag on the ruler draws a band in the agent's colour, the box
//     opens under it (words, ready chips, "only here" on, Send); it stays
//     inside the window at 1920 × 1080 and 1366 × 768, in both languages,
//     with small lanes;
//   - Send: a limited work note in the inbox; the band says "Working";
//   - the agent reads the note (one line says the limit; an animation gets
//     the canvas), writes one marker inside the range and one outside: the
//     inside one is in the draft, the outside one is not applied, said to
//     the agent in one sentence and to the user as "out of scope"; the band
//     says "Draft ready"; accepted, only the inside one is in the film;
//   - a clip's right-click "For the agent" → the lock: a small lock in the
//     clip's row, never over its name; the agent's write to it is dropped;
//     the user's own edit of it is not;
//   - the agent marks the note done: the band says "Done".
// With SNIPP_SHOTS_KAPSAM=<folder> every moment is photographed at the four
// layouts (tasarim\karsilastirma\kapsam\).
import { join } from 'node:path'
import { mkdirSync } from 'node:fs'
import { connectAgent, versionOf } from '../agent-client.mjs'
export const name = 'agent-kapsam'
export const timeoutMs = 240_000

const LAYOUTS = [[1920, 1080, 'tr'], [1366, 768, 'tr'], [1920, 1080, 'en'], [1366, 768, 'en']]

const build = (ids) => {
  const S = window.__store
  const p = structuredClone(S.getState().project)
  const T = { x: p.settings.width / 2, y: p.settings.height / 2, scale: 1, rotation: 0 }
  p.tracks = [
    { id: 'V2', kind: 'video', name: 'V2', clipIds: ['pic'] },
    { id: 'V1', kind: 'video', name: 'V1', clipIds: ['a'] },
    { id: 'A1', kind: 'audio', name: 'A1', clipIds: ['as'] }
  ]
  const clip = (id, assetId, trackId, start, inPoint, duration, extra = {}) => ({ id, assetId, trackId, start, inPoint, duration, transform: { ...T }, volume: 1, ...extra })
  p.clips = {
    a: clip('a', ids.talk, 'V1', 0, 0, 12, { linkId: 'L1', audioExtracted: true }),
    as: clip('as', ids.talk, 'A1', 0, 0, 12, { linkId: 'L1' }),
    pic: clip('pic', ids.pic, 'V2', 7, 0, 4)
  }
  p.captions = [{ id: 'S1', start: 2.2, end: 4.6, text: 'the numbers go up', words: [{ text: 'the', start: 2.2, end: 2.5 }, { text: 'numbers', start: 2.6, end: 3.2 }, { text: 'go', start: 3.3, end: 3.6 }, { text: 'up', start: 3.7, end: 4.6 }], soundClip: 'a' }]
  p.markers = []
  delete p.notes
  S.getState().setPlaying(false)
  S.getState().loadProject(p)
  S.setState({ selectedClipIds: [], pxPerSec: 60 })
}

/** The band, its words, the box, the lock as they are on screen. */
const seen = () => {
  const q = (id) => document.querySelector(`[data-testid="${id}"]`)
  const rect = (e) => (e ? e.getBoundingClientRect() : null)
  const inside = (r) => !!r && r.left >= 0 && r.top >= 0 && r.right <= window.innerWidth + 0.5 && r.bottom <= window.innerHeight + 0.5
  const meets = (a, b) => !!a && !!b && a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom
  const band = q('kapsam.band')
  const box = q('kapsam.box')
  const br = rect(box)
  const lock = q('timeline.clip.pic.agent-lock')
  const name = q('timeline.clip.pic.name')
  const cap = q('kapsam.band.cap')
  return {
    status: band?.dataset.status ?? null,
    shade: [...document.querySelectorAll('.kapsam-shade')].length,
    band: band ? { start: Number(band.dataset.start), end: Number(band.dataset.end) } : null,
    cap: cap?.textContent ?? null,
    capInside: inside(rect(cap)),
    capOverFlag: meets(rect(cap), rect(q('agent.flag'))),
    box: box ? { inside: inside(br), parts: [...box.querySelectorAll('button, input, .ui-chip')].every((e) => { const r = e.getBoundingClientRect(); return r.left >= br.left - 0.5 && r.right <= br.right + 0.5 }), cut: [...box.querySelectorAll('.ui-chip-text, .ui-check, .ui-btn-label')].filter((e) => e.scrollWidth > e.clientWidth + 1).map((e) => e.textContent) } : null,
    lock: lock ? { overName: meets(rect(lock), rect(name)), h: rect(lock).height } : null,
    root: [document.documentElement.scrollTop, document.documentElement.scrollHeight - document.documentElement.clientHeight]
  }
}

export async function run({ c, app, media, lib }) {
  const { assert } = lib
  const dir = process.env.SNIPP_SHOTS_KAPSAM
  if (dir) mkdirSync(dir, { recursive: true })
  await c.waitFor('the agent host', () => c.ev('!!window.__agent'))
  if ((await c.attr('agent.switch', 'aria-checked')) !== 'true') await lib.topBarSwitch(c)
  await c.waitFor('the agent server listening', async () => { try { await fetch(`http://127.0.0.1:${app.agentPort}/mcp`, { method: 'POST' }); return true } catch { return false } }, 15_000)
  const [talk, pic] = await lib.seedAssets(app, c, [media.talk, media.broll[0]])
  await c.run(build, { talk: talk.id, pic: pic.id })
  await c.run(() => window.__agent.setMode('draft'))
  await c.ev(`window.__timelineView.getState().setTrackScale('small')`)
  const scale0 = 'small'
  /** Every layout: checked, and photographed when asked. */
  const at = async (moment, check) => {
    // (The toasts of the steps before are not this moment's.)
    await c.ev(`(() => { for (const b of document.querySelectorAll('[data-testid^="toast."][data-testid$=".dismiss"]')) b.click(); return true })()`)
    for (const [w, h, lang] of LAYOUTS) {
      await c.send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: false })
      await c.st((s, l) => s.setUiLang(l), lang)
      await c.sleep(250)
      const s = await c.run(seen)
      const where = `${moment} ${w}×${h} ${lang}`
      assert.deepEqual(s.root, [0, 0], `${where}: the window does not scroll`)
      assert.equal(s.capOverFlag, false, `${where}: the band's words are not on the agent's flag`)
      await check(s, where, lang)
      if (dir) await c.shot(join(dir, `${moment}-${w}-${lang}-S.png`))
    }
    await c.send('Emulation.clearDeviceMetricsOverride')
    await c.st((s) => s.setUiLang('en'))
    // (The box and the menus place themselves after the window's size changed.)
    await c.sleep(400)
  }
  try {
    const claude = await connectAgent({ c, app, assert, client: 'claude-code' })
    // ---- Alt + drag on the ruler: the band and its box
    const ruler = await c.box('timeline.ruler')
    await c.dragAt(await lib.timeX(c, 2), ruler.cy, await lib.timeX(c, 6), ruler.cy, { mods: ['alt'] })
    await c.waitId('kapsam.box')
    let s = await c.run(seen)
    assert.equal(s.shade, 2, 'the rest of the timeline is dimmed while the work is limited')
    assert.ok(s.band && lib.near(s.band.start, 2, 0.05) && lib.near(s.band.end, 6, 0.05), `the band lies over 2–6 s (${JSON.stringify(s.band)})`)
    assert.equal(s.status, 'new')
    assert.equal(await c.st((st) => st.currentTime), 0, 'Alt + drag does not move the playhead')
    assert.equal(await c.ev(`document.querySelector('[data-testid="kapsam.box.only"]').checked`), true, '"only here" is on by default')
    await at('01-bant-kutu', async (v, where, lang) => {
      assert.ok(v.box && v.box.inside && v.box.parts, `${where}: the box and its parts inside the window (${JSON.stringify(v.box)})`)
      assert.deepEqual(v.box.cut, [], `${where}: no word cut off in the box`)
      assert.ok(v.capInside, `${where}: the band's words are on screen`)
      assert.equal(v.cap, lang === 'tr' ? 'Aralık · 4,0 sn' : 'Range · 4.0 s', where)
    })
    // ---- a chip, a few words, Send
    await c.click('kapsam.box.chip.animate')
    assert.equal(await c.attr('kapsam.box.chip.animate', 'class').then((x) => /is-on/.test(x ?? '')), true, 'the chip is chosen')
    await c.fill('kapsam.box.text', 'a simple chart')
    await c.click('kapsam.box.send')
    await c.waitGone('kapsam.box')
    const note = await c.st((st) => st.project.notes?.[0] ?? null)
    assert.ok(note, 'a note was written')
    assert.deepEqual([note.kind, note.text, note.only, note.status], ['animate', 'Add an animation here: a simple chart', {}, 'open'])
    assert.equal((await c.run(seen)).status, 'working')
    await at('02-calisiliyor', async (v, where, lang) => assert.equal(v.cap, lang === 'tr' ? 'Çalışılıyor · 4,0 sn' : 'Working · 4.0 s', where))
    // ---- the agent reads it: one line says the limit, the animation gets the canvas
    const read = await claude.call('notes')
    assert.match(read.text, /animate \(make an animation for this stretch\) · canvas \d+x\d+/)
    assert.match(read.text, /only here: the app applies no edit outside 2\.00–6\.00 s/)
    assert.match(read.text, /said there: «the numbers go up»/)
    assert.equal(await c.st((st) => st.project.notes[0].status), 'agent')
    // ---- one write inside, one outside
    const p = await claude.call('project')
    const wrote = await claude.call('edit', { ops: [{ op: 'marker.add', time: 3 }, { op: 'marker.add', time: 9 }], base: versionOf(p.text) })
    assert.match(wrote.text, /outside what the user limited this work to \(note #1: 2\.00–6\.00 s\)/, wrote.text)
    await c.waitId('agent.draft')
    await c.waitFor('the band says the draft is ready', async () => (await c.run(seen)).status === 'draft')
    await at('03-taslak-hazir', async (v, where, lang) => assert.equal(v.cap, lang === 'tr' ? 'Taslak hazır · 4,0 sn' : 'Draft ready · 4.0 s', where))
    // ---- "not applied": out of scope, in the user's words
    await c.send('Emulation.setDeviceMetricsOverride', { width: 1920, height: 1080, deviceScaleFactor: 1, mobile: false })
    await c.click('agent.draft.notApplied')
    await c.waitId('agent.draft.dropped')
    assert.equal(await c.attr('agent.draft.dropped.0', 'data-sort'), 'scope')
    await at('04-kapsam-disinda', async (v, where, lang) => {
      const why = await c.ev(`document.querySelector('[data-testid="agent.draft.dropped.0"] .agent-rev-dropped-why')?.textContent`)
      assert.equal(why, lang === 'tr' ? 'Kapsam dışında: uygulanmadı. Bu iş için verdiğin aralığın (ya da kliplerin) dışına yazıyordu.' : 'Out of scope: not applied. It wrote outside the stretch (or the clips) you gave this work.', where)
    })
    await c.send('Emulation.setDeviceMetricsOverride', { width: 1920, height: 1080, deviceScaleFactor: 1, mobile: false })
    await c.click('agent.draft.dropped.ok')
    await c.click('agent.draft.acceptAll')
    await c.waitGone('agent.draft')
    assert.deepEqual(await c.st((st) => (st.project.markers ?? []).map((m) => m.time)), [3], 'accepted: only the marker inside the range')
    // ---- a clip's menu: For the agent → the lock
    /** The clip's menu, then its "For the agent" (opened at the size it is seen at). */
    const agentMenu = async () => {
      if (await c.has('timeline.clip.pic.agent-menu')) await c.key('Escape')
      await c.waitGone('timeline.clip.pic.agent-menu')
      const blk = await c.box('timeline.clip.pic')
      await c.clickAt(blk.cx, blk.cy, { button: 'right' })
      await c.click('timeline.clip.pic.menu.agent')
      await c.waitId('timeline.clip.pic.agent-menu')
    }
    await at('05-sag-tik', async (v, where) => {
      await agentMenu()
      const m = await c.ev(`(() => { const e = document.querySelector('[data-testid="timeline.clip.pic.agent-menu"]'); const r = e.getBoundingClientRect(); return { inside: r.left >= 0 && r.top >= 0 && r.right <= innerWidth && r.bottom <= innerHeight, cut: [...e.querySelectorAll('[role^="menuitem"]')].filter((x) => x.scrollWidth > x.clientWidth + 1).length, rows: e.querySelectorAll('[role^="menuitem"]').length } })()`)
      assert.deepEqual(m, { inside: true, cut: 0, rows: 7 }, `${where}: the agent menu (${JSON.stringify(m)})`)
    })
    await agentMenu()
    await c.click('timeline.clip.pic.agent.lock')
    await c.waitId('timeline.clip.pic.agent-lock')
    assert.equal(await c.st((st) => st.project.clips.pic.agentLock), true)
    await at('06-kilitli-klip', async (v, where) => assert.ok(v.lock && !v.lock.overName, `${where}: the lock is not on the name (${JSON.stringify(v.lock)})`))
    // The agent's write to it is dropped; the user's own is not.
    const p2 = await claude.call('project')
    assert.match(p2.text, /pic .*agent-locked|agent-locked/)
    const w2 = await claude.call('edit', { ops: [{ op: 'clip.setVolume', clipId: 'pic', volume: 0.3 }], base: versionOf(p2.text) })
    assert.match(w2.text, /the user locked clip pic against agents/, w2.text)
    if (await c.has('agent.draft')) await c.click('agent.draft.reject')
    assert.equal(await c.st((st) => st.project.clips.pic.volume), 1)
    await c.st((st) => st.runBatch([{ name: 'clip.setVolume', params: { clipId: 'pic', volume: 0.5 } }]))
    assert.equal(await c.st((st) => st.project.clips.pic.volume), 0.5, 'the user edits a locked clip as always')
    // ---- the agent is done: the band says so
    await claude.call('notes', { update: [{ id: 1, status: 'ready', reply: 'Made a chart for 2–6 s.' }] })
    await c.waitFor('the band says done', async () => (await c.run(seen)).status === 'done')
    await at('07-bitti', async (v, where, lang) => assert.equal(v.cap, lang === 'tr' ? 'Bitti · 4,0 sn' : 'Done · 4.0 s', where))
    await c.click('kapsam.band.close')
    await c.waitGone('kapsam.band')
  } finally {
    await c.send('Emulation.clearDeviceMetricsOverride').catch(() => undefined)
    await c.st((s) => s.setUiLang('en')).catch(() => undefined)
    await c.ev(`window.__timelineView.getState().setTrackScale('medium')`).catch(() => undefined)
    void scale0
  }
}
