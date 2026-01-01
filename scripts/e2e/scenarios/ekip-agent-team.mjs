// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// The team mode (EKIP-PLAN.md; YOL-HARITASI.md part 3, steps 1 and 2; the
// mock-up tasarim\maket-ajan, screen 5). ONE scripted agent session over
// real HTTP whose five "subagents" name themselves on their calls (`as`):
//   - a call with a label answers the very bytes the same call without one
//     does (project, transcript, analyze, changes);
//   - five workers read at once: the bar says "Claude Code · 5 workers" with
//     five chips; five flags on the ruler (two rows at most, "+N" for the
//     rest), each in its worker's colour; the bar's sentence is the last
//     caller's;
//   - the Agent tab's steps start with their worker; a chip shows one
//     worker's steps; the token card has a row per worker and the same total;
//   - the workers write a draft: the review strip's group picker ("All · n",
//     a worker · its count); a group goes through its own changes; its marks
//     have their worker's corner, never on a clip's name;
//   - an op of one worker dropped because another worker's cut came first:
//     the user's list says after whose change; the agent's words do not;
//   - a group accepted is ONE undo step; a group rejected leaves the draft;
//   - a session that never names a worker looks exactly as before.
// 1920 × 1080 and 1366 × 768, English and Turkish, small lanes (S). With
// SNIPP_SHOTS_EKIP=<folder> every moment is photographed (tasarim\karsilastirma\ekip).
import { join } from 'node:path'
import { mkdirSync } from 'node:fs'
import { connectAgent, versionOf } from '../agent-client.mjs'
export const name = 'agent-ekip'
export const timeoutMs = 300_000

const LAYOUTS = [[1920, 1080, 'tr'], [1366, 768, 'tr'], [1920, 1080, 'en'], [1366, 768, 'en']]
const WORKERS = ['kesim', 'altyazı', 'b-roll', 'müzik', 'renk']

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
    pic: clip('pic', ids.pic, 'V2', 7, 0, 3)
  }
  p.captions = [
    { id: 'S1', start: 0.5, end: 2.5, text: 'hello there', words: [{ text: 'hello', start: 0.5, end: 1.2 }, { text: 'there', start: 1.3, end: 2.4 }] },
    { id: 'S2', start: 3, end: 6, text: 'this is the second line of the talk' },
    { id: 'S3', start: 6.5, end: 9, text: 'and the third one' }
  ]
  p.markers = []
  delete p.notes
  S.getState().setPlaying(false)
  S.getState().loadProject(p)
  S.setState({ selectedClipIds: [], pxPerSec: 60 })
}

/** What the team parts show, measured. */
const seen = () => {
  const q = (id) => document.querySelector(`[data-testid="${id}"]`)
  const qa = (id) => [...document.querySelectorAll(`[data-testid="${id}"]`)]
  const rect = (e) => (e ? e.getBoundingClientRect() : null)
  const meets = (a, b) => !!a && !!b && a.left < b.right - 0.5 && b.left < a.right - 0.5 && a.top < b.bottom - 0.5 && b.top < a.bottom - 0.5
  const cut = (e) => !!e && e.scrollWidth > e.clientWidth + 1
  const bar = q('agent.bar') ?? q('agent.draft')
  const br = rect(bar)
  const flags = qa('agent.flag').map((f) => ({ worker: f.dataset.worker ?? null, row: Number(f.dataset.row ?? 0), bg: getComputedStyle(f).backgroundColor, r: rect(f) }))
  const names = [...document.querySelectorAll('.tl-clip .label')].map(rect).filter((r) => r && r.width > 0)
  const corners = qa('agent.mark.corner').map((e) => ({ worker: e.dataset.worker, r: rect(e), colour: getComputedStyle(e).borderLeftColor }))
  return {
    who: q('agent.bar.who')?.textContent ?? null,
    crew: qa('agent.bar.worker').map((e) => e.dataset.worker),
    crewDots: qa('agent.bar.worker').map((e) => getComputedStyle(e.querySelector('.agent-crew-dot')).backgroundColor),
    whatWorker: q('agent.bar.what')?.dataset.worker ?? null,
    flags: flags.map(({ worker, row, bg }) => ({ worker, row, bg })),
    flagsOverlap: flags.some((a, i) => flags.some((b, j) => j > i && meets(a.r, b.r))),
    more: qa('agent.flag.more').map((e) => e.dataset.workers.split(',')),
    barInside: !!br && br.left >= 0 && br.right <= window.innerWidth + 0.5 && [...bar.children].every((e) => rect(e).right <= br.right + 0.5),
    barCut: [...(bar?.querySelectorAll('.agent-bar-who, .ui-btn-label') ?? [])].filter(cut).map((e) => e.textContent),
    group: q('agent.draft.group')?.textContent ?? null,
    count: q('agent.draft.count')?.textContent ?? null,
    corners: corners.map(({ worker, colour }) => ({ worker, colour })),
    cornerOnName: corners.some((c) => names.some((n) => meets(c.r, n))),
    badgeOnName: [...document.querySelectorAll('.agent-mark-badge:not(.is-out)')].map(rect).some((b) => b.width > 0 && names.some((n) => meets(b, n))),
    root: [document.documentElement.scrollTop, document.documentElement.scrollHeight - document.documentElement.clientHeight]
  }
}

/** The Agent tab scrolled to its steps (a picture of them). */
const showSteps = () => {
  const el = document.querySelector('[data-testid="agent.steps"]')
  let box = el?.parentElement
  while (box && box.scrollHeight <= box.clientHeight + 1) box = box.parentElement
  if (el && box) box.scrollTop += el.getBoundingClientRect().top - box.getBoundingClientRect().top - 8
  const list = el?.querySelector('.agent-steps')
  // (Whole: no list wider than its card.)
  return !!el && !!list && list.scrollWidth <= list.clientWidth + 1
}

export async function run({ c, app, media, lib }) {
  const { assert } = lib
  const dir = process.env.SNIPP_SHOTS_EKIP
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
  const at = async (moment, check) => {
    await c.ev(`(() => { for (const b of document.querySelectorAll('[data-testid^="toast."][data-testid$=".dismiss"]')) b.click(); return true })()`)
    for (const [w, h, lang] of LAYOUTS) {
      await c.send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: false })
      await c.st((s, l) => s.setUiLang(l), lang)
      await c.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 200, y: 420 })
      await c.sleep(300)
      const s = await c.run(seen)
      const where = `${moment} ${w}×${h} ${lang}`
      assert.deepEqual(s.root, [0, 0], `${where}: the window does not scroll`)
      assert.equal(s.badgeOnName, false, `${where}: no badge on a clip's name`)
      assert.equal(s.cornerOnName, false, `${where}: no worker's corner on a clip's name`)
      assert.equal(s.flagsOverlap, false, `${where}: no flag on another (${JSON.stringify(s.flags)})`)
      await check(s, where, lang)
      if (dir) await c.shot(join(dir, `${moment}-${w}-${lang}-S.png`))
    }
    await c.send('Emulation.clearDeviceMetricsOverride')
    await c.st((s) => s.setUiLang('en'))
    await c.sleep(300)
  }
  try {
    const claude = await connectAgent({ c, app, assert, client: 'claude-code' })
    // ---- a label never changes an answer ---------------------------------------
    for (const [tool, args] of [['project', {}], ['transcript', { start: 0, end: 6 }], ['transcript', { words: true }], ['analyze', { kind: 'preflight' }]]) {
      const plain = await claude.call(tool, args)
      const named = await claude.call(tool, { ...args, as: 'kesim' })
      assert.equal(named.text, plain.text, `${tool} ${JSON.stringify(args)}: the same bytes with a label`)
    }
    const v0 = versionOf((await claude.call('project')).text)
    const ch1 = await claude.call('changes', { since: v0 })
    const ch2 = await claude.call('changes', { since: v0, as: 'renk' })
    assert.equal(ch2.text, ch1.text, 'changes: the same bytes with a label')
    // A label is cleaned, never refused.
    const odd = await claude.call('project', { as: 'b roll !! with a long name' })
    assert.equal(odd.isError, false)
    await c.waitFor('the odd label cleaned', () => c.run(() => window.__agent.store.getState().events.some((e) => e.as === 'brollwithalo')))
    // (A clean start for what is shown: the labels of the checks above are not this team.)
    await c.run(() => { const st = window.__agent.store; st.setState({ events: [], crew: {} }) })

    // ---- five workers at once -------------------------------------------------------
    await Promise.all([
      claude.call('transcript', { start: 0, end: 3, as: 'kesim' }),
      claude.call('transcript', { start: 3, end: 6, words: true, as: 'altyazı' }),
      claude.call('frames', { times: [7.5], width: 256, as: 'b-roll' }),
      claude.call('analyze', { kind: 'audio', start: 0.2, end: 12, as: 'müzik' }),
      claude.call('frames', { times: [10.5], width: 256, as: 'renk' })
    ])
    await c.waitId('agent.bar')
    await c.waitFor('five chips', async () => (await c.run(seen)).crew.length === 5)
    let s = await c.run(seen)
    assert.deepEqual([...s.crew].sort(), [...WORKERS].sort(), 'a chip per worker')
    assert.equal(s.who, 'Claude Code · 5 workers')
    assert.equal(new Set(s.crewDots).size, 5, `five colours: ${s.crewDots}`)
    const flagged = new Set([...s.flags.map((f) => f.worker), ...s.more.flat()])
    assert.deepEqual([...flagged].sort(), [...WORKERS].sort(), `a flag (or "+N") per worker: ${JSON.stringify(s)}`)
    assert.ok(s.flags.every((f) => f.row === 0 || f.row === 1), 'two rows at most')
    assert.ok(s.flags.some((f) => f.row === 1), `kesim and müzik both at 0 s: one on the second row (${JSON.stringify(s.flags)})`)
    assert.equal(new Set(s.flags.map((f) => f.bg)).size, s.flags.length, 'each flag its worker\'s colour')
    // The bar's sentence is the last caller's.
    await claude.call('transcript', { start: 9, end: 12, as: 'renk' })
    await c.waitFor('the sentence is renk\'s', async () => (await c.run(seen)).whatWorker === 'renk')
    await at('01-bes-isci', async (v, where, lang) => {
      assert.ok(v.barInside, `${where}: the bar is whole (${JSON.stringify(v)})`)
      assert.deepEqual(v.barCut, [], `${where}: nothing cut on the bar`)
      assert.equal(v.who, lang === 'tr' ? 'Claude Code · 5 işçi' : 'Claude Code · 5 workers', where)
      assert.equal(v.crew.length, 5, where)
    })
    // Crowded: all five at one moment → two rows and "+3".
    await Promise.all(WORKERS.map((w) => claude.call('frames', { times: [4], width: 128, as: w })))
    await c.waitFor('two rows and +3', async () => { const x = await c.run(seen); return x.more.length === 1 && x.more[0].length === 3 })
    s = await c.run(seen)
    assert.equal(s.flags.length, 2)
    await at('02-kalabalik', async (v, where) => assert.equal(v.more[0].length, 3, where))

    // ---- the steps, by worker; the token card by worker ----------------------------------
    await c.click('inspector.tab.agent')
    await c.waitId('agent.steps.crew')
    const steps = await c.run(() => [...document.querySelectorAll('[data-testid^="agent.step.worker."]')].map((e) => e.dataset.worker))
    assert.ok(steps.length >= 11 && WORKERS.every((w) => steps.includes(w)), `each step says its worker: ${steps}`)
    await c.click('agent.steps.crew.renk')
    const only = await c.run(() => [...document.querySelectorAll('[data-testid^="agent.step.worker."]')].map((e) => e.dataset.worker))
    assert.ok(only.length >= 2 && only.every((w) => w === 'renk'), `only renk's steps: ${only}`)
    await at('03-adimlar', async (v, where) => assert.ok(await c.run(showSteps), where))
    await c.click('agent.steps.crew.all')
    await c.click('agent.bar.tokens')
    await c.waitId('agent.tokens.card')
    const card = await c.run(() => {
      const n = (e) => Number(String(e?.textContent ?? '').replace(/[^\d]/g, ''))
      const rows = [...document.querySelectorAll('[data-testid="agent.tokens.worker"]')]
      return { workers: rows.map((r) => r.dataset.worker), sum: rows.reduce((a, r) => a + n(r.querySelector('.agent-tok-n')), 0), text: n(document.querySelector('[data-testid="agent.tokens.text"] .agent-tok-n')), images: n(document.querySelector('[data-testid="agent.tokens.images"] .agent-tok-n')) }
    })
    assert.deepEqual([...card.workers].sort(), [...WORKERS].sort(), 'a row per worker')
    assert.equal(card.sum, card.text + card.images, `the workers' rows add up to the answers (${JSON.stringify(card)})`)
    await c.click('agent.bar.tokens')

    // ---- the workers write a draft -------------------------------------------------------
    const v1 = versionOf((await claude.call('project', { as: 'kesim' })).text)
    const cut = await claude.call('edit', { ops: [{ op: 'timeline.cutRanges', ranges: [[1, 2]] }], base: v1, as: 'kesim' })
    assert.match(cut.text, /^Applied|draft/i, cut.text)
    // b-roll wrote on the version before kesim's cut: its move is dropped (4A.8).
    const moved = await claude.call('edit', { ops: [{ op: 'clip.move', clipId: 'pic', by: 1 }], base: v1, as: 'b-roll' })
    const said = await claude.call('edit', { ops: [{ op: 'caption.update', id: 'S3', patch: { text: 'and the very third one' } }], base: v1, as: 'altyazı' })
    const vd = versionOf((await claude.call('project', { as: 'renk' })).text)
    await claude.call('edit', { ops: [{ op: 'marker.add', time: 8, note: 'colour' }], base: vd, as: 'renk' })
    await claude.call('edit', { ops: [{ op: 'marker.add', time: 3, note: 'beat' }], base: vd, as: 'müzik' })
    await claude.call('edit', { ops: [{ op: 'timeline.cutRanges', ranges: [[9, 9.5]] }], base: vd, as: 'kesim' })
    console.log('    moved:', moved.text.split('\n')[0], '| said:', said.text.split('\n')[0])
    await c.waitId('agent.draft')
    const view = await c.run(() => { const d = window.__agent.store.getState().draft; return { items: d.items.map((i) => [i.key, i.as ?? '']), dropped: d.dropped.map((x) => ({ seq: x.seq, as: x.as, after: x.after, reason: x.reason })) } })
    console.log('    draft:', JSON.stringify(view))
    const groups = new Map()
    for (const [, as] of view.items) groups.set(as, (groups.get(as) ?? 0) + 1)
    assert.ok(groups.get('kesim') >= 2, `kesim's group: ${JSON.stringify([...groups])}`)
    // The collision (4A.8, untouched): b-roll's move, written on the version
    // before kesim's cut, is dropped at once. The agent's words are as
    // always (no worker named); the user's step says after whose change.
    assert.match(moved.text, /^Nothing applied/, moved.text)
    assert.match(moved.text, /an earlier edit of yours/, moved.text)
    assert.doesNotMatch(moved.text, /kesim|b-roll|worker/, 'the agent is told nothing of workers')
    await c.waitFor('the step says after whose change', () => c.run(() => window.__agent.store.getState().events.some((e) => e.as === 'b-roll' && e.after === 'kesim')))
    s = await c.run(seen)
    assert.match(s.group, /^All · \d+$/)
    assert.ok(s.corners.length >= 3 && s.corners.every((k) => k.worker !== undefined), `every mark has its worker's corner: ${JSON.stringify(s.corners)}`)
    await at('04-gruplu-taslak', async (v, where, lang) => assert.match(v.group, lang === 'tr' ? /^Hepsi · \d+$/ : /^All · \d+$/, where))
    await c.click('agent.steps.crew.b-roll')
    await at('05-carpisma', async (v, where, lang) => {
      assert.ok(await c.run(showSteps), `${where}: the steps fit their card`)
      const w = await c.ev(`[...document.querySelectorAll('.agent-step-after')].map((e) => e.textContent).join(' | ')`)
      assert.match(w, lang === 'tr' ? /kesim işçisinin değişikliğinden sonra düştü\./ : /Dropped after kesim’s change\./, where)
      const cut = await c.ev(`[...document.querySelectorAll('.agent-step-after')].some((e) => e.scrollWidth > e.clientWidth + 1)`)
      assert.equal(cut, false, `${where}: the step's words are whole`)
    })
    await c.click('agent.steps.crew.all')
    // ---- a group: its own changes; accepted as one undo step --------------------------
    await c.click('agent.draft.group')
    await c.click('agent.draft.group.kesim')
    s = await c.run(seen)
    assert.match(s.group, /^kesim · 2$/)
    assert.equal(s.count, '1 / 2')
    await c.click('agent.draft.next')
    assert.equal((await c.run(seen)).count, '2 / 2')
    await at('06-grup-kesim', async (v, where) => assert.match(v.count, /\/ 2$/, where))
    const before = await c.st((st) => ({ len: st.past?.length ?? null, v: st.projectVersion, dur: Object.values(st.project.clips).reduce((m, x) => Math.max(m, x.start + x.duration), 0) }))
    await c.click('agent.draft.group.accept')
    await c.waitFor('kesim\'s cuts are in the film', async () => (await c.st((st) => Object.values(st.project.clips).reduce((m, x) => Math.max(m, x.start + x.duration), 0))) < before.dur - 1.4)
    const undo = await c.st((st) => { st.undo(); return Object.values(window.__store.getState().project.clips).reduce((m, x) => Math.max(m, x.start + x.duration), 0) })
    assert.ok(Math.abs(undo - before.dur) < 0.01, `one undo takes the whole group back (${undo} / ${before.dur})`)
    await c.st((st) => st.redo())
    // ---- a group rejected leaves the draft; the rest still waits
    await c.waitId('agent.draft')
    await c.click('agent.draft.group')
    await c.click('agent.draft.group.müzik')
    await c.waitFor('the draft worked out again', () => c.run(() => !window.__agent.store.getState().draft?.updating))
    await c.waitFor('the group of müzik picked', async () => /^müzik · 1$/.test((await c.run(seen)).group ?? ''))
    const rj = await c.ev(`(() => { const b = document.querySelector('[data-testid="agent.draft.group.reject"]'); return b ? { disabled: b.disabled } : null })()`)
    assert.deepEqual(rj, { disabled: false }, 'Reject group is there')
    await c.click('agent.draft.group.reject')
    await c.waitFor('müzik is out', () => c.run(() => !(window.__agent.store.getState().draft?.items ?? []).some((i) => i.as === 'müzik')))
    assert.ok(await c.has('agent.draft'), 'the other groups still wait')
    await c.click('agent.draft.acceptAll')
    await c.waitGone('agent.draft')

    // ---- a session that never names a worker: as before ------------------------------------------
    await c.run(() => window.__agent.store.setState({ events: [], crew: {} }))
    const solo = await connectAgent({ c, app, assert, client: 'claude-code' })
    await solo.call('transcript', { start: 0, end: 3 })
    await c.waitId('agent.bar')
    s = await c.run(seen)
    assert.equal(s.who, 'Claude Code')
    assert.deepEqual(s.crew, [])
    assert.ok(s.flags.length === 1 && s.flags[0].worker === null, `the one flag of old: ${JSON.stringify(s.flags)}`)
    assert.equal(await c.has('agent.steps.crew'), false, 'no worker chips on the steps')
    await at('07-etiketsiz', async (v, where) => assert.deepEqual(v.crew, [], where))
  } finally {
    await c.send('Emulation.clearDeviceMetricsOverride').catch(() => undefined)
    await c.st((s) => s.setUiLang('en')).catch(() => undefined)
    await c.ev(`window.__timelineView.getState().setTrackScale('medium')`).catch(() => undefined)
  }
}
