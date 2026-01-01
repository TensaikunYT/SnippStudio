// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// The team mode, step 3 (EKIP-3-PLAN.md): regions. ONE scripted agent session
// over real HTTP whose "subagents" name themselves (`as`) and take stretches
// of the timeline:
//   - three workers take three adjacent regions; a stretch that overlaps
//     another worker's is refused, and the answer says whose it is;
//   - all three write AT THE SAME TIME on the same version (a cut, a move
//     with subtitles' text, a marker): every op is applied, the move lands
//     where its region is after the other worker's cut, and the linked
//     picture and sound stay in step;
//   - under the ruler a thin line per region, in its worker's colour, none
//     over another; the Agent tab lists who has which stretch;
//   - a worker that writes in another's region is told whose it is, and the
//     user reads it as a plain sentence under that step;
//   - after "accept all" the regions lie where the film is now.
// 1920 × 1080 and 1366 × 768, English and Turkish, small lanes (S). With
// SNIPP_SHOTS_EKIP3=<folder> every moment is photographed
// (tasarim\karsilastirma\ekip-3).
import { join } from 'node:path'
import { mkdirSync } from 'node:fs'
import { connectAgent, versionOf } from '../agent-client.mjs'
export const name = 'agent-ekip-bolge'
export const timeoutMs = 300_000

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
    pic: clip('pic', ids.pic, 'V2', 5, 0, 2)
  }
  p.captions = [
    { id: 'S1', start: 0.3, end: 0.9, text: 'hello there' },
    { id: 'S2', start: 4.5, end: 6, text: 'this is the second line' },
    { id: 'S3', start: 8.5, end: 10, text: 'and the third one' }
  ]
  p.markers = []
  delete p.notes
  S.getState().setPlaying(false)
  S.getState().loadProject(p)
  S.setState({ selectedClipIds: [], pxPerSec: 60 })
}

/** What the region parts show, measured. */
const seen = () => {
  const q = (id) => document.querySelector(`[data-testid="${id}"]`)
  const qa = (id) => [...document.querySelectorAll(`[data-testid="${id}"]`)]
  const rect = (e) => (e ? e.getBoundingClientRect() : null)
  const meets = (a, b) => !!a && !!b && a.left < b.right - 0.5 && b.left < a.right - 0.5 && a.top < b.bottom - 0.5 && b.top < a.bottom - 0.5
  const lines = qa('agent.region').map((e) => ({ worker: e.dataset.worker, from: Number(e.dataset.from), to: Number(e.dataset.to), bg: getComputedStyle(e).backgroundColor, label: e.getAttribute('aria-label'), r: rect(e) }))
  const trail = rect(q('agent.trail'))
  const parts = qa('agent.trail.part').map(rect)
  const names = [...document.querySelectorAll('.tl-clip .label')].map(rect).filter((r) => r && r.width > 0)
  const rows = qa('agent.regions.row')
  return {
    lines: lines.map(({ worker, from, to, bg, label }) => ({ worker, from: Math.round(from * 100) / 100, to: Math.round(to * 100) / 100, bg, label })),
    linesOverlap: lines.some((a, i) => lines.some((b, j) => j > i && meets(a.r, b.r))),
    linesInTrail: !!trail && lines.every((l) => l.r.top >= trail.top - 0.5 && l.r.bottom <= trail.bottom + 0.5 && l.r.height >= 2),
    lineOnPart: lines.some((l) => parts.some((p) => meets(l.r, p))),
    lineOnName: lines.some((l) => names.some((n) => meets(l.r, n))),
    rows: rows.map((e) => ({ worker: e.dataset.worker, text: e.querySelector('.agent-zone-where')?.textContent ?? '', dot: getComputedStyle(e.querySelector('.agent-crew-dot')).backgroundColor, cut: e.scrollWidth > e.clientWidth + 1 })),
    stepsWide: qa('agent.steps').some((box) => { const l = box.querySelector('.agent-steps'); return !!l && l.scrollWidth > l.clientWidth + 1 }),
    // (No step's lines on the next step's.)
    stepsOverlap: qa('agent.steps').flatMap((box) => [...box.querySelectorAll('.agent-step')]).some((e, i, all) => i > 0 && rect(all[i - 1].querySelector('.agent-step-main') ?? all[i - 1]).bottom > rect(e.querySelector('.agent-step-main') ?? e).top + 0.5),
    notes: [...document.querySelectorAll('[data-testid^="agent.step.region."]')].map((e) => ({ step: e.closest('.agent-step')?.querySelector('.agent-step-text')?.textContent ?? '', seen: (() => { const r = rect(e); let box = e.closest('.agent-steps'); let ok = true; while (box) { const b = rect(box); if (getComputedStyle(box).overflowY !== 'visible' && (r.top < b.top - 0.5 || r.bottom > b.bottom + 0.5)) ok = false; box = box.parentElement } return ok })(), text: e.textContent, refused: e.dataset.refused ?? null, region: e.dataset.region ?? null, cut: e.scrollWidth > e.clientWidth + 1 })),
    root: [document.documentElement.scrollTop, document.documentElement.scrollHeight - document.documentElement.clientHeight]
  }
}

/** The Agent tab scrolled to a card of it (a picture of it). */
const show = (id) => {
  const el = document.querySelector(`[data-testid="${id}"]`)
  let box = el?.parentElement
  while (box && box.scrollHeight <= box.clientHeight + 1) box = box.parentElement
  if (el && box) box.scrollTop += el.getBoundingClientRect().top - box.getBoundingClientRect().top - 8
  // (The steps: the latest one, at the list's end.)
  const list = el?.querySelector('.agent-steps')
  if (list) list.scrollTop = list.scrollHeight
  // (And a sentence under a step: whole, inside the tab.)
  const note = [...(list?.querySelectorAll('[data-testid^="agent.step.region."]') ?? [])].pop()
  if (note && box) {
    const over = note.getBoundingClientRect().bottom - box.getBoundingClientRect().bottom + 12
    if (over > 0) box.scrollTop += over
  }
  return !!el
}

export async function run({ c, app, media, lib }) {
  const { assert } = lib
  const dir = process.env.SNIPP_SHOTS_EKIP3
  if (dir) mkdirSync(dir, { recursive: true })
  await c.waitFor('the agent host', () => c.ev('!!window.__agent'))
  if ((await c.attr('agent.switch', 'aria-checked')) !== 'true') await lib.topBarSwitch(c)
  await c.waitFor('the agent server listening', async () => { try { await fetch(`http://127.0.0.1:${app.agentPort}/mcp`, { method: 'POST' }); return true } catch { return false } }, 15_000)
  const [talk, pic] = await lib.seedAssets(app, c, [media.talk, media.broll[0]])
  await c.run(build, { talk: talk.id, pic: pic.id })
  await c.run(() => window.__agent.setMode('draft'))
  await c.ev(`window.__timelineView.getState().setTrackScale('small')`)
  await c.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] })
  /** Every layout: checked, and photographed when asked. */
  const at = async (moment, card, check) => {
    await c.ev(`(() => { for (const b of document.querySelectorAll('[data-testid^="toast."][data-testid$=".dismiss"]')) b.click(); return true })()`)
    for (const [w, h, lang] of LAYOUTS) {
      await c.send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: false })
      await c.st((s, l) => s.setUiLang(l), lang)
      await c.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 200, y: 420 })
      await c.sleep(300)
      if (card) await c.run(show, card)
      await c.sleep(100)
      const s = await c.run(seen)
      const where = `${moment} ${w}×${h} ${lang}`
      assert.deepEqual(s.root, [0, 0], `${where}: the window does not scroll`)
      assert.equal(s.linesOverlap, false, `${where}: no region line on another (${JSON.stringify(s.lines)})`)
      assert.equal(s.linesInTrail, true, `${where}: the lines lie in the row under the ruler`)
      assert.equal(s.lineOnPart, false, `${where}: no region line on the trail's parts`)
      assert.equal(s.lineOnName, false, `${where}: no region line on a clip's name`)
      assert.deepEqual(s.rows.filter((r) => r.cut), [], `${where}: no region row cut off`)
      assert.deepEqual(s.notes.filter((n) => n.cut), [], `${where}: no sentence cut off`)
      assert.equal(s.stepsOverlap, false, `${where}: no step on the next one`)
      assert.equal(s.stepsWide, false, `${where}: the steps are no wider than their card`)
      await check(s, where, lang)
      if (dir) await c.shot(join(dir, `${moment}-${w}-${lang}-S.png`))
    }
    await c.send('Emulation.clearDeviceMetricsOverride')
    await c.st((s) => s.setUiLang('en'))
    await c.sleep(300)
  }
  const draftOf = () => c.run(() => {
    const d = window.__agent.draft()
    if (!d) return null
    const p = d.project
    return { clips: p.clips, pic: p.clips.pic?.start, s2: p.captions.find((x) => x.id === 'S2')?.text, markers: (p.markers ?? []).map((m) => Math.round(m.time * 100) / 100), dropped: d.outcomes.filter((o) => !o.applied).map((o) => `${o.command}: ${o.reason}`), length: Math.max(...Object.values(p.clips).map((x) => x.start + x.duration)) }
  })
  const inStep = (p) => {
    const linked = Object.values(p.clips).filter((x) => x.linkId)
    return linked.every((x) => linked.some((o) => o.id !== x.id && o.linkId === x.linkId && Math.abs(o.start - x.start) < 1e-6 && Math.abs(o.duration - x.duration) < 1e-6))
  }
  try {
    const claude = await connectAgent({ c, app, assert, client: 'claude-code' })
    await c.click('inspector.tab.agent')
    const v0 = versionOf((await claude.call('project', { as: 'kesim' })).text)
    await claude.call('transcript', { start: 4, end: 8, as: 'altyazı' })
    await claude.call('frames', { times: [9], width: 128, as: 'b-roll' })

    // ---- three regions; an overlapping claim is refused ------------------------
    const took = await claude.call('edit', { ops: [{ op: 'region.claim', range: [0, 4] }], base: v0, as: 'kesim' })
    assert.match(took.text, /^Region 0\.00–4\.00 s is "kesim"'s/, took.text)
    await claude.call('edit', { ops: [{ op: 'region.claim', range: [4, 8] }], base: v0, as: 'altyazı' })
    const refused = await claude.call('edit', { ops: [{ op: 'region.claim', range: [3, 9] }], base: v0, as: 'b-roll' }, { allowError: true })
    assert.equal(refused.isError, true, 'an overlapping claim is refused')
    assert.match(refused.text, /^region\.claim: 3\.00–9\.00 s is taken: worker "kesim" has 0\.00–4\.00 s; nothing was applied\. Take a stretch outside it\.$/, refused.text)
    assert.equal(await c.run(() => !!window.__agent.draft()), false, 'claims make no draft')
    await at('02-reddedilen-sahiplenme', 'agent.steps', async (s, where, lang) => {
      assert.deepEqual(s.lines.map((l) => [l.worker, l.from, l.to]), [['kesim', 0, 4], ['altyazı', 4, 8]], where)
      const n = s.notes.find((x) => x.refused === 'kesim')
      assert.ok(n, `${where}: the refused claim is said under its step`)
      assert.equal(n.text, lang === 'tr' ? 'O aralık kesim işçisinde.' : 'kesim already has that stretch.', where)
      assert.equal(n.step, lang === 'tr' ? 'Bölge alınamadı' : 'Region not taken', where)
      assert.equal(n.seen, true, `${where}: the sentence is on screen`)
    })
    await claude.call('edit', { ops: [{ op: 'region.claim', range: [8, 12] }], base: v0, as: 'b-roll' })

    // ---- the three write at the same time, on the same version ------------------
    const [cut, moved, marked] = await Promise.all([
      claude.call('edit', { ops: [{ op: 'timeline.cutRanges', ranges: [[1, 2]] }], base: v0, as: 'kesim' }),
      claude.call('edit', { ops: [{ op: 'clip.move', clipId: 'pic', start: 5.5 }, { op: 'caption.update', id: 'S2', patch: { text: 'this is the second line, set right' } }], base: v0, as: 'altyazı' }),
      claude.call('edit', { ops: [{ op: 'marker.add', time: 10, note: 'b-roll' }], base: v0, as: 'b-roll' })
    ])
    for (const r of [cut, moved, marked]) assert.doesNotMatch(r.text, /dropped|not applied|Nothing applied/i, r.text)
    const d = await draftOf()
    assert.deepEqual(d.dropped, [], 'no op of the three dropped')
    // (The move was written as 5.50 s of the version read: 0.5 s into the
    // picture's region; after kesim's 1 s cut that is 4.50 s.)
    assert.ok(Math.abs(d.pic - 4.5) < 1e-6, `the move landed where its region is now (${d.pic})`)
    assert.equal(d.s2, 'this is the second line, set right')
    assert.deepEqual(d.markers, [9])
    assert.ok(Math.abs(d.length - 11) < 1e-6)
    assert.equal(inStep(d), true, 'picture and sound in step in the draft')
    await at('01-uc-isci-bolgeleriyle', 'agent.regions', async (s, where) => {
      // (The timeline is the live project until the draft is accepted.)
      assert.deepEqual(s.lines.map((l) => [l.worker, l.from, l.to]), [['kesim', 0, 4], ['altyazı', 4, 8], ['b-roll', 8, 12]], where)
      assert.equal(new Set(s.lines.map((l) => l.bg)).size, 3, `${where}: three colours ${JSON.stringify(s.lines)} ${JSON.stringify(s.rows)}`)
      assert.deepEqual(s.rows.map((r) => [r.worker, r.text]), [['kesim', '00:00–00:04'], ['altyazı', '00:04–00:08'], ['b-roll', '00:08–00:12']], where)
      assert.deepEqual(s.rows.map((r) => r.dot), s.lines.map((l) => l.bg), `${where}: a row's dot is its line's colour`)
      assert.equal(s.lines[1].label, 'altyazı · 00:04–00:08', where)
    })

    // ---- writing in another worker's region ---------------------------------------
    const v1 = versionOf((await claude.call('project', { as: 'kesim' })).text)
    const into = await claude.call('edit', { ops: [{ op: 'marker.add', time: 1.5, note: 'mine' }, { op: 'clip.set', clipId: 'pic', opacity: 0.5 }], base: v1, as: 'kesim' })
    assert.match(into.text, /clip\.set: it changes what is inside the region of worker "altyazı" \(3\.00–7\.00 s\): not applied\. Only that worker writes there/, into.text)
    assert.deepEqual((await draftOf()).markers, [1.5, 9], 'the op inside its own region was applied')
    await at('03-bolge-yuzunden-dusen', 'agent.steps', async (s, where, lang) => {
      const n = s.notes.find((x) => x.region === 'altyazı')
      assert.ok(n, `${where}: the drop is said under its step`)
      assert.equal(n.text, lang === 'tr' ? 'Uygulanmadı: altyazı işçisinin bölgesini değiştiriyordu.' : 'Not applied: it would change altyazı’s region.', where)
      assert.equal(n.seen, true, `${where}: the sentence is on screen`)
    })

    // ---- accepted: the regions lie where the film is now ---------------------------
    await c.click('agent.draft.acceptAll')
    await c.waitFor('the draft accepted', () => c.run(() => !window.__agent.draft()))
    const live = await c.run(() => {
      const p = window.__store.getState().project
      return { pic: p.clips.pic.start, clips: p.clips }
    })
    assert.ok(Math.abs(live.pic - 4.5) < 1e-6)
    assert.equal(inStep(live), true, 'picture and sound in step after accepting')
    await at('04-kabul-sonrasi', 'agent.regions', async (s, where) => {
      assert.deepEqual(s.lines.map((l) => [l.worker, l.from, l.to]), [['kesim', 0, 3], ['altyazı', 3, 7], ['b-roll', 7, 11]], where)
      assert.deepEqual(s.rows.map((r) => r.text), ['00:00–00:03', '00:03–00:07', '00:07–00:11'], where)
    })

    // ---- a region is given back; the agent's own wait ends the rest -------------------
    const v2 = versionOf((await claude.call('project', { as: 'b-roll' })).text)
    assert.equal((await claude.call('edit', { ops: [{ op: 'region.release' }], base: v2, as: 'b-roll' })).text, 'Region released ("b-roll").')
    assert.deepEqual((await c.run(seen)).lines.map((l) => l.worker), ['kesim', 'altyazı'])
    await claude.call('wait', { seconds: 5 })
    await c.waitFor('the regions gone with the work', async () => (await c.run(seen)).lines.length === 0)
    assert.equal(await c.has('agent.regions'), false, 'no region list without regions')
  } finally {
    await c.send('Emulation.clearDeviceMetricsOverride').catch(() => undefined)
    await c.st((s) => s.setUiLang('en')).catch(() => undefined)
    await c.ev(`window.__timelineView.getState().setTrackScale('medium')`).catch(() => undefined)
  }
}
