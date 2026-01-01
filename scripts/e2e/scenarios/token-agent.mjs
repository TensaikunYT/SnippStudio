// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// Dalga 3, worker T (SnippStudio TOKEN-PLAN.md; YOL-HARITASI.md 1.3, 1.4):
// how much the app sent the agent and how far its job is, seen without
// asking it. A scripted agent over real HTTP:
//   - the bar's "≈ N tokens" opens a card: the definitions once, the
//     answers' text and frames, the total (the bar's number, and what the
//     agent itself received, counted on its side), "compared with raw";
//   - the agent's own plan (the wait's optional field) says "step 2 / 3";
//     a plan answers at once and brings nothing of the user's;
//   - the notes a job came with: "2 of 4 notes done";
//   - similar jobs: "similar jobs took ≈ 3 min" (the profile's list);
//   - "Done" says the saving; the Agent tab lists the finished jobs;
//   - 1920 × 1080 and 1366 × 768, English and Turkish: nothing cut, the
//     card inside the window. Screenshots to tasarim\karsilastirma\token
//     when SNIPP_SCREENS_TOKEN is set, else to e2e-sonuc\ekranlar-token.
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { APP_DIR } from '../app.mjs'
import { connectAgent, versionOf } from '../agent-client.mjs'
export const name = 'agent-token-card'
export const timeoutMs = 240_000

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
    pic: clip('pic', ids.pic, 'V2', 5, 0, 4)
  }
  p.captions = [
    { id: 'S1', start: 0.5, end: 2.5, text: 'hello there', words: [{ text: 'hello', start: 0.5, end: 1.2 }, { text: 'there', start: 1.3, end: 2.4 }] },
    { id: 'S2', start: 3, end: 6, text: 'this is the second line of the talk' }
  ]
  p.markers = []
  p.notes = []
  S.getState().setPlaying(false)
  S.getState().loadProject(p)
  S.setState({ selectedClipIds: [], pxPerSec: 60 })
}

/** The bar and the card as they are on screen. */
const seen = () => {
  const q = (id) => document.querySelector(`[data-testid="${id}"]`)
  const txt = (id) => q(id)?.textContent ?? null
  const bar = q('agent.bar')
  const card = q('agent.tokens.card')
  const cut = (el) => !!el && el.scrollWidth > el.clientWidth + 1
  const r = bar?.getBoundingClientRect()
  const cr = card?.getBoundingClientRect()
  return {
    phase: bar?.dataset.phase ?? null,
    what: txt('agent.bar.what'),
    tokens: txt('agent.bar.tokens'),
    progress: txt('agent.bar.progress'),
    from: q('agent.bar.progress')?.dataset.from ?? null,
    progressCut: cut(q('agent.bar.progress')),
    saved: txt('agent.bar.saved'),
    barInside: !!r && r.left >= 0 && r.right <= window.innerWidth && [...bar.children].every((e) => e.getBoundingClientRect().right <= r.right + 0.5),
    card: card
      ? {
          defs: q('agent.tokens.defs')?.querySelector('.agent-tok-n')?.textContent ?? null,
          text: q('agent.tokens.text')?.querySelector('.agent-tok-n')?.textContent ?? null,
          images: q('agent.tokens.images')?.querySelector('.agent-tok-n')?.textContent ?? null,
          total: q('agent.tokens.total')?.querySelector('.agent-tok-n')?.textContent ?? null,
          raw: q('agent.tokens.raw')?.querySelector('.agent-tok-n')?.textContent ?? null,
          saved: Number(q('agent.tokens.raw')?.dataset.saved ?? NaN),
          note: card.querySelector('.agent-tok-note')?.textContent ?? null,
          inside: cr.left >= 0 && cr.top >= 0 && cr.right <= window.innerWidth && cr.bottom <= window.innerHeight,
          cut: [...card.querySelectorAll('.agent-tok-row > span')].some(cut)
        }
      : null,
    jobs: [...document.querySelectorAll('[data-testid="agent.job"]')].map((e) => e.textContent),
    root: [document.documentElement.scrollTop, document.documentElement.scrollHeight - document.documentElement.clientHeight]
  }
}

/** "≈ 3,300" / "≈ 3.300" / "≈ 870" → 3300. */
const num = (s) => Number(String(s ?? '').replace(/[^\d]/g, ''))

export async function run({ c, app, media, lib, out }) {
  const { assert } = lib
  const dir = process.env.SNIPP_SCREENS_TOKEN ? join(APP_DIR, '..', 'tasarim', 'karsilastirma', 'token') : join(out, 'ekranlar-token')
  mkdirSync(dir, { recursive: true })
  const SIZES = [[1920, 1080], [1366, 768]]
  /** Each view at both sizes, in both languages; the card opened again
   *  after each change when `card`. Nothing may be cut or outside. */
  const shots = async (name, { card = false, tab = false } = {}) => {
    for (const [w, h] of SIZES) {
      await c.send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: false })
      for (const lang of ['en', 'tr']) {
        await c.st((st, l) => st.setUiLang(l), lang)
        if (card) {
          if (await c.has('agent.tokens.card')) await c.click('agent.bar.tokens')
          await c.click('agent.bar.tokens')
          await c.waitId('agent.tokens.card')
        }
        // (A clean picture: the toasts of the notes go, the pointer rests on the empty media list.)
        await c.run(() => document.querySelectorAll('[data-testid^="toast."][data-testid$=".dismiss"]').forEach((b) => b.click()))
        await c.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 200, y: 420 })
        await c.sleep(350)
        const s = await c.run(seen)
        assert.ok(s.barInside, `${name} ${w} ${lang}: the bar is whole (${JSON.stringify(s)})`)
        assert.ok(!s.progressCut, `${name} ${w} ${lang}: the progress is not cut ("${s.progress}")`)
        if (card) assert.ok(s.card && s.card.inside && !s.card.cut, `${name} ${w} ${lang}: the card is whole, inside the window (${JSON.stringify(s.card)})`)
        if (tab) {
          const jobsCut = await c.run(() => [...document.querySelectorAll('[data-testid="agent.job"] span')].some((e) => e.scrollWidth > e.clientWidth + 1))
          assert.ok(!jobsCut, `${name} ${w} ${lang}: a finished job's line is cut`)
        }
        assert.deepEqual(s.root, [0, 0])
        await c.shot(join(dir, `${name}-${w}-${lang}.png`))
      }
    }
    if (card && (await c.has('agent.tokens.card'))) await c.click('agent.bar.tokens')
    await c.send('Emulation.setDeviceMetricsOverride', { width: 1920, height: 1080, deviceScaleFactor: 1, mobile: false })
    await c.st((st) => st.setUiLang('en'))
  }

  await c.waitFor('the agent host', () => c.ev('!!window.__agent'))
  if ((await c.attr('agent.switch', 'aria-checked')) !== 'true') await lib.topBarSwitch(c)
  await c.waitFor('the agent server listening', async () => { try { await fetch(`http://127.0.0.1:${app.agentPort}/mcp`, { method: 'POST' }); return true } catch { return false } }, 15_000)
  const [talk, pic] = await lib.seedAssets(app, c, [media.talk, media.broll[0]])
  await c.run(build, { talk: talk.id, pic: pic.id })
  await c.run(() => window.__agent.setMode('direct'))
  // (A clean list of finished jobs: this scenario's own.)
  await c.run(() => { try { localStorage.removeItem('snipp-agent-jobs') } catch { /* none */ } window.__agent.store.setState({ jobs: [] }) })
  try {
    await c.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] })
    const claude = await connectAgent({ c, app, assert, client: 'claude-code' })
    // ---- reading: the project, the transcript with words, two frames
    const p = await claude.call('project')
    await claude.call('transcript', { words: true })
    const fr = await claude.call('frames', { times: [2, 6] })
    assert.equal(fr.images.length, 1, 'one contact sheet')
    await c.waitId('agent.bar')
    // (Each answer's raw size comes with its end.)
    await c.waitFor('every answer measured', () => c.run(() => window.__agent.store.getState().events.filter((e) => e.done && e.tool !== 'wait').every((e) => typeof e.raw === 'number')))
    await c.click('agent.bar.tokens')
    await c.waitId('agent.tokens.card')
    let s = await c.run(seen)
    // What the agent received, counted on its own side (agent-client.mjs: the same rule).
    const got = claude.log.reduce((n, l) => n + l.tokens, 0)
    const defs = Math.round(claude.defsChars / 3.6)
    assert.ok(Math.abs(num(s.card.defs) - defs) <= 25, `the definitions: ${s.card.defs} (the agent got ${defs})`)
    assert.ok(Math.abs(num(s.card.text) + num(s.card.images) - got) <= 3, `the answers: ${s.card.text} + ${s.card.images} (the agent got ${got})`)
    assert.equal(num(s.card.total), num(s.card.defs) + num(s.card.text) + num(s.card.images), 'the total is the sum of its rows')
    const sheet = fr.images[0]
    assert.ok(Math.abs(num(s.card.images) - Math.round((sheet.width * sheet.height) / 750)) <= 1, `the frames: ${s.card.images} (${sheet.width}x${sheet.height})`)
    assert.match(s.tokens, /^≈ \d+\.\dk tokens$/)
    assert.ok(Math.abs(Number(s.tokens.replace(/[^\d.]/g, '')) * 1000 - num(s.card.total)) <= 50, `the bar says the card's total (${s.tokens} / ${s.card.total})`)
    assert.ok(s.card.saved >= 1 && s.card.saved < 100, `compared with raw: ${s.card.raw}`)
    assert.match(s.card.raw, /^−\d+% · raw ≈ [\d,]+$/)
    assert.match(s.card.note, /what .+ sent the agent; the agent’s own thinking and writing are not counted here\.$/)
    // The ratio by hand: the frames raw are two full-size frames.
    const st0 = await c.run(() => { const st = window.__agent.store.getState(); const ev = st.events.filter((e) => e.done); return { raw: ev.map((e) => [e.tool, e.tokens, e.raw]), w: window.__store.getState().project.settings.width, h: window.__store.getState().project.settings.height } })
    const framesRaw = st0.raw.find((r) => r[0] === 'frames')[2]
    assert.ok(framesRaw >= Math.round((2 * st0.w * st0.h) / 750), `frames raw: ${framesRaw}`)
    assert.ok(st0.raw.every(([, tok, raw]) => raw >= tok), 'no answer is said bigger than its raw')
    await c.click('agent.bar.tokens')
    await c.waitGone('agent.tokens.card')
    await shots('01-token-karti', { card: true })

    // ---- the agent's plan: answered at once, nothing of the user's taken
    const t0 = Date.now()
    const plan1 = await claude.call('wait', { plan: ['read the talk', 'cut the pauses', 'subtitles'] })
    assert.equal(plan1.text, 'Plan noted.')
    assert.ok(Date.now() - t0 < 3000, 'a plan does not wait')
    await c.waitFor('the plan is said', async () => (await c.run(seen)).from === 'plan')
    s = await c.run(seen)
    assert.equal(s.progress, 'step 1 / 3 · read the talk')
    assert.equal(s.what, 'Wrote down its steps')
    await claude.call('wait', { plan: ['cut the pauses', 'subtitles'] })
    await c.waitFor('step 2', async () => (await c.run(seen)).progress === 'step 2 / 3 · cut the pauses')
    // A plan that is no list is refused; the plan stays.
    const bad = await claude.call('wait', { plan: 'cut' }, { allowError: true })
    assert.ok(bad.isError && /plan/.test(bad.text), bad.text)
    const moved = await claude.call('edit', { ops: [{ op: 'clip.move', clipId: 'pic', by: 3 }], base: versionOf(p.text) })
    assert.match(moved.text, /^Applied/)
    await c.waitFor('step 2 still', async () => (await c.run(seen)).progress === 'step 2 / 3 · cut the pauses')
    await shots('02-ilerleme-plan')

    // ---- done: the summary; the Agent tab's finished jobs
    const waiting = claude.call('wait', { seconds: 60 })
    // (Should a check fail while it waits, the window closes under it: not a crash of the runner.)
    waiting.catch(() => null)
    await c.waitFor('done', async () => (await c.run(seen)).phase === 'done')
    await c.waitFor('every answer measured', () => c.run(() => window.__agent.store.getState().events.filter((e) => e.done).every((e) => typeof e.raw === 'number')))
    s = await c.run(seen)
    assert.equal(s.what, 'Done · 1 change')
    assert.match(s.saved, /^−\d+% vs raw$/)
    assert.equal(s.progress, null, 'done: no progress')
    await c.click('inspector.tab.agent')
    await c.waitFor('the job is listed', async () => (await c.run(seen)).jobs.length === 1)
    s = await c.run(seen)
    assert.match(s.jobs[0], /^Claude Code · On its own\d\d:\d\d · \d+:\d\d · 1 change · ≈ \d+\.\dk tokens · −\d+% vs raw$/)
    // (The list in view: its panel scrolled, never the page.)
    await c.run(() => { const el = document.querySelector('[data-testid="agent.jobs"]'); let p = el.parentElement; while (p && !/(auto|scroll)/.test(getComputedStyle(p).overflowY)) p = p.parentElement; if (p) p.scrollTop += el.getBoundingClientRect().top - p.getBoundingClientRect().top - 40 })
    await shots('03-is-ozeti', { tab: true })

    // ---- notes sent: "2 of 4 notes done"
    await c.run(() => {
      const st = window.__store.getState()
      for (const [a, b, text] of [[0.5, 1, 'tighten'], [2, 3, 'brighter'], [4, 5, 'cut this'], [7, 8, 'title here']]) {
        st.startNoteDraft({ start: a, end: b })
        st.patchNoteDraft({ text, kind: 'fix' })
        st.saveNoteDraft()
      }
    })
    await c.click('inspector.tab.notes')
    await c.click('notes.send')
    const brought = await waiting
    assert.match(brought.text, /4 notes sent, now "with agent"/)
    await claude.call('notes', { update: [{ id: 1, status: 'ready', reply: 'Tightened.' }, { id: 2, status: 'ready', reply: 'Brighter.' }] })
    await c.waitFor('notes progress', async () => (await c.run(seen)).from === 'notes')
    s = await c.run(seen)
    assert.equal(s.progress, '2 of 4 notes done')
    await c.st((st) => st.setUiLang('tr'))
    assert.equal((await c.run(seen)).progress, '4 nottan 2’si tamam')
    await c.st((st) => st.setUiLang('en'))
    await shots('04-ilerleme-notlar')
    const waiting2 = claude.call('wait', { seconds: 60 })
    waiting2.catch(() => null)
    await c.waitFor('done again', async () => (await c.run(seen)).phase === 'done')

    // ---- similar jobs: two tasks before (the profile's list), a third one now
    await c.run(() => {
      const st = window.__agent.store.getState()
      const now = Date.now()
      st.recordJob({ client: 'claude-code', kind: 'task', start: now - 3_600_000, ms: 150_000, steps: 6, changed: 2, tokens: 4100 })
      st.recordJob({ client: 'claude-code', kind: 'task', start: now - 1_800_000, ms: 210_000, steps: 9, changed: 3, tokens: 5200 })
    })
    await c.click('inspector.tab.agent')
    if ((await c.attr('agent.box', 'data-folded')) === 'true') await c.click('agent.box.open')
    await c.fill('agent.box.text', 'make the intro shorter')
    await c.click('agent.box.send')
    assert.match((await waiting2).text, /^Task: "make the intro shorter"$/m)
    await claude.call('project')
    await c.waitFor('similar jobs', async () => (await c.run(seen)).from === 'similar')
    assert.equal((await c.run(seen)).progress, 'similar jobs took ≈ 3 min')
    await shots('05-ilerleme-gecmis')
    s = await c.run(seen)
    assert.deepEqual(s.root, [0, 0])
  } finally {
    await c.send('Emulation.setEmulatedMedia', { features: [] }).catch(() => null)
    await c.send('Emulation.setDeviceMetricsOverride', { width: 1920, height: 1080, deviceScaleFactor: 1, mobile: false }).catch(() => null)
    await c.st((st) => st.setUiLang('en')).catch(() => null)
    await c.run(() => { window.__agent.reject(); window.__agent.choose(null); window.__agent.setMode('draft') }).catch(() => null)
  }
}
