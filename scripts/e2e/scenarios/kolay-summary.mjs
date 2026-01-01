// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// Worker "kolay", item 4 (SnippStudio KOLAY-PLAN.md): what an agent's job
// changed, from the bar's "Done". A scripted agent over real HTTP, straight
// onto the timeline: it moves a picture and cuts two seconds out.
//   - "Done" is a button; nothing opens by itself. Pressed: one small card —
//     the length before → now (0:12 → 0:10), the changes by kind, the tokens
//     (the bar's number), "Back to before the agent".
//   - That button puts the project back as it was before the job (one undo
//     step) and closes the card.
//   - 1366 × 768 and 1920 × 1080, English and Turkish: the card whole, inside
//     the window. Screenshots to tasarim\karsilastirma\kolay when
//     SNIPP_SCREENS_KOLAY is set.
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { APP_DIR } from '../app.mjs'
import { connectAgent, versionOf } from '../agent-client.mjs'
export const name = 'kolay-summary'
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
    pic: clip('pic', ids.pic, 'V2', 2, 0, 3)
  }
  p.captions = []
  p.markers = []
  p.notes = []
  S.getState().setPlaying(false)
  S.getState().loadProject(p)
  S.setState({ selectedClipIds: [], pxPerSec: 60 })
}

const seen = () => {
  const q = (id) => document.querySelector(`[data-testid="${id}"]`)
  const card = q('agent.summary.card')
  const r = card?.getBoundingClientRect()
  const n = (id) => q(id)?.querySelector('.agent-sum-n')?.textContent ?? null
  const cut = (el) => !!el && el.scrollWidth > el.clientWidth + 1
  return {
    phase: q('agent.bar')?.dataset.phase ?? null,
    what: q('agent.bar.what')?.textContent ?? null,
    whatTag: q('agent.bar.what')?.tagName ?? null,
    card: card
      ? {
          length: n('agent.summary.length'),
          changes: n('agent.summary.changes'),
          tokens: n('agent.summary.tokens'),
          restore: !!q('agent.summary.restore'),
          inside: r.left >= 0 && r.top >= 0 && r.right <= window.innerWidth && r.bottom <= window.innerHeight,
          cut: [...card.querySelectorAll('.agent-sum-row > span, .agent-sum-title')].some(cut)
        }
      : null,
    barTokens: q('agent.bar.tokens')?.textContent ?? null,
    root: [document.documentElement.scrollTop, document.documentElement.scrollHeight - document.documentElement.clientHeight]
  }
}

export async function run({ c, app, media, lib, out }) {
  const { assert } = lib
  const dir = process.env.SNIPP_SCREENS_KOLAY ? join(APP_DIR, '..', 'tasarim', 'karsilastirma', 'kolay') : join(out, 'ekranlar-kolay')
  mkdirSync(dir, { recursive: true })
  await c.waitFor('the agent host', () => c.ev('!!window.__agent'))
  if ((await c.attr('agent.switch', 'aria-checked')) !== 'true') await lib.topBarSwitch(c)
  await c.waitFor('the agent server listening', async () => { try { await fetch(`http://127.0.0.1:${app.agentPort}/mcp`, { method: 'POST' }); return true } catch { return false } }, 15_000)
  const [talk, pic] = await lib.seedAssets(app, c, [media.talk, media.broll[0]])
  await c.run(build, { talk: talk.id, pic: pic.id })
  await c.run(() => window.__agent.setMode('direct'))
  const before = await c.run(() => { const p = window.__store.getState().project; return JSON.stringify({ clips: p.clips, tracks: p.tracks.map((t) => t.clipIds) }) })
  try {
    await c.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] })
    const claude = await connectAgent({ c, app, assert, client: 'claude-code' })
    const p = await claude.call('project')
    const r = await claude.call('edit', { ops: [{ op: 'clip.move', clipId: 'pic', by: 3 }, { op: 'timeline.cutRanges', ranges: [[9, 11]] }], base: versionOf(p.text) })
    assert.match(r.text, /^Applied/, r.text)
    const waiting = claude.call('wait', { seconds: 60 })
    waiting.catch(() => null)
    await c.waitFor('done', async () => (await c.run(seen)).phase === 'done', 30_000)
    let s = await c.run(seen)
    assert.equal(s.whatTag, 'BUTTON', '"Done" is a button')
    assert.equal(s.card, null, 'nothing opens by itself')
    console.log(`    bar: "${s.what}"`)
    await c.click('agent.bar.what')
    await c.waitId('agent.summary.card')
    s = await c.run(seen)
    console.log(`    card: ${JSON.stringify(s.card)}`)
    assert.equal(s.card.length, '0:12 → 0:10', 'the length before and now')
    assert.match(s.card.changes, /\d+ (cut|move)/, 'the changes counted')
    assert.doesNotMatch(s.card.changes, /none|not known/)
    assert.equal(s.card.tokens, s.barTokens, 'the tokens are the bar\'s')
    assert.ok(s.card.restore, 'back to before the agent')
    for (const [w, h] of [[1366, 768], [1920, 1080]]) {
      await c.send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: false })
      for (const lang of ['en', 'tr']) {
        await c.st((st, l) => st.setUiLang(l), lang)
        if (await c.has('agent.summary.card')) await c.click('agent.bar.what')
        await c.click('agent.bar.what')
        await c.waitId('agent.summary.card')
        await c.run(() => document.querySelectorAll('[data-testid^="toast."][data-testid$=".dismiss"]').forEach((b) => b.click()))
        await c.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 200, y: 420 })
        await c.sleep(300)
        s = await c.run(seen)
        assert.ok(s.card.inside && !s.card.cut, `${w} ${lang}: the card whole, inside (${JSON.stringify(s.card)})`)
        if (lang === 'tr') assert.equal(s.card.length, '0:12 → 0:10')
        assert.deepEqual(s.root, [0, 0])
        await c.shot(join(dir, `06-ajan-ozet-${w}-${lang}.png`))
      }
    }
    await c.send('Emulation.setDeviceMetricsOverride', { width: 1920, height: 1080, deviceScaleFactor: 1, mobile: false })
    await c.st((st) => st.setUiLang('en'))
    // Escape closes it; pressed again it opens; back to before the agent.
    await c.key('Escape')
    await c.waitGone('agent.summary.card')
    await c.click('agent.bar.what')
    await c.waitId('agent.summary.card')
    const undo0 = await c.st((st) => st.past.length)
    await c.click('agent.summary.restore')
    await c.waitGone('agent.summary.card')
    await c.waitFor('back to before the agent', async () => (await c.run(() => { const p = window.__store.getState().project; return JSON.stringify({ clips: p.clips, tracks: p.tracks.map((t) => t.clipIds) }) })) === before)
    assert.equal(await c.st((st) => st.past.length), undo0 + 1, 'one undo step')
  } finally {
    await c.send('Emulation.setEmulatedMedia', { features: [] }).catch(() => null)
    await c.send('Emulation.setDeviceMetricsOverride', { width: 1920, height: 1080, deviceScaleFactor: 1, mobile: false }).catch(() => null)
    await c.st((st) => st.setUiLang('en')).catch(() => null)
    await c.run(() => { window.__agent.reject(); window.__agent.choose(null); window.__agent.setMode('draft') }).catch(() => null)
  }
}
