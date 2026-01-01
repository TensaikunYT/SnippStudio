// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// The user's second try-out, worker T, item 2 (DENEME-2-PLAN-T.md): "the
// agent said it moved the videos 10 s later, nothing changed". A scripted
// agent moves every video clip 10 s later with clip.move, on a project of
// three video lanes (one with its sound linked on A1):
//   A. "apply directly": the live project, the timeline's blocks and the
//      preview's picture follow; the linked sound comes along;
//   B. a draft: nothing changes on the timeline until accepted; the timeline
//      shows each moved clip at its new place (a ghost) with its old place
//      faint; the card says what was done ("3 moved"); the preview plays the
//      draft (After); accepting moves the clips.
// Each part on its own: one that fails is named and the next still runs.
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { connectAgent, versionOf } from '../agent-client.mjs'

/** Pictures for the plan (DENEME-2-PLAN-T.md): SnippStudio\tasarim\ekranlar\deneme2. */
export const SHOTS = join(process.cwd(), '..', 'tasarim', 'ekranlar', 'deneme2')
mkdirSync(SHOTS, { recursive: true })
export const name = 'den2-t-agent-move'
export const timeoutMs = 150_000

const build = (ids) => {
  const S = window.__store
  const p = structuredClone(S.getState().project)
  const W = p.settings.width
  const H = p.settings.height
  const T = { x: W / 2, y: H / 2, scale: 1, rotation: 0 }
  p.tracks = [
    { id: 'V3', kind: 'video', name: 'V3', clipIds: ['c'] },
    { id: 'V2', kind: 'video', name: 'V2', clipIds: ['b'] },
    { id: 'V1', kind: 'video', name: 'V1', clipIds: ['a'] },
    { id: 'A1', kind: 'audio', name: 'A1', clipIds: ['s'] }
  ]
  p.clips = {
    a: { id: 'a', assetId: ids.talk, trackId: 'V1', start: 0, inPoint: 0, duration: 12, transform: T, volume: 1, linkId: 'L', audioExtracted: true },
    s: { id: 's', assetId: ids.talk, trackId: 'A1', start: 0, inPoint: 0, duration: 12, transform: T, volume: 1, linkId: 'L' },
    b: { id: 'b', assetId: ids.other, trackId: 'V2', start: 0, inPoint: 0, duration: 6, transform: { ...T, scale: 0.5, x: W * 0.3 }, volume: 1 },
    c: { id: 'c', assetId: ids.pic, trackId: 'V3', start: 2, inPoint: 0, duration: 4, transform: { ...T, scale: 0.3, x: W * 0.75 }, volume: 1 }
  }
  p.captions = []
  S.getState().setPlaying(false)
  S.getState().loadProject(p)
  S.setState({ selectedClipIds: [], linkAV: true, pxPerSec: 30 })
}

const starts = (c) => c.st((s) => Object.fromEntries(Object.values(s.project.clips).map((k) => [k.id, k.start])))

export async function run({ c, app, media, lib }) {
  const { assert } = lib
  await c.waitFor('the agent host', () => c.ev('!!window.__agent'))
  // (A scenario before may have turned access off: the reset turns it on again; wait for the port.)
  if ((await c.attr('agent.switch', 'aria-checked')) !== 'true') await lib.topBarSwitch(c)
  await c.waitFor('the agent server listening', async () => { try { await fetch(`http://127.0.0.1:${app.agentPort}/mcp`, { method: 'POST' }); return true } catch { return false } }, 15_000)
  const [talk, other, pic] = await lib.seedAssets(app, c, [media.talk, media.other, media.broll[0]])
  const ids = { talk: talk.id, other: other.id, pic: pic.id }
  const failed = []
  const part = async (what, body) => {
    try {
      await body()
    } catch (e) {
      failed.push(`${what}: ${e.message.split(/\r?\n/)[0]}`)
    }
  }
  const ag = await connectAgent({ c, app, assert, client: 'den2-t' })
  // The user's agent: read, then one clip.move per video clip, "Read the
  // changes" between them (the user's Steps list). The first by its new
  // start (the time), with linkAV false (D22: an agent's move takes the
  // linked sound along unless it says so): the answer says its sound stayed;
  // the others by a shift (by: 10); then the sound alone by the same shift.
  const moveAll = async () => {
    const read = (await ag.call('project')).text
    let v = versionOf(read)
    const answers = []
    const ops = [
      { op: 'clip.move', clipId: 'a', start: 10, linkAV: false },
      { op: 'clip.move', clipId: 'b', by: 10 },
      { op: 'clip.move', clipId: 'c', by: 10 },
      { op: 'clip.move', clipId: 's', by: 10, linkAV: false }
    ]
    for (const op of ops) {
      const r = await ag.call('edit', { ops: [op], base: v })
      answers.push(r.text)
      const ch = await ag.call('changes', { since: v })
      v = /→ ([0-9a-z]+-\d+)/i.exec(ch.text)?.[1] ?? v
    }
    // An old base (the read before all of it): dropped, and the Steps say
    // "Nothing applied", not "Edited".
    const stale = await ag.call('edit', { ops: [{ op: 'clip.move', clipId: 'b', by: 1 }], base: versionOf(read) })
    answers.push(stale.text)
    return answers
  }

  await part('A direct', async () => {
    await c.run(build, ids)
    await c.waitId('timeline.clip.c')
    await c.run(() => window.__agent.setMode('direct'))
    const answers = await moveAll()
    console.log('     direct answers:', JSON.stringify(answers.map((a) => a.split('\n').slice(0, 3).join(' | '))))
    assert.match(answers[0], /Moved: a 0\.00→10\.00 \(\+10\.00 s\)/)
    assert.match(answers[0], /Linked partner\(s\) left in place, out of step now: s/)
    assert.match(answers[4], /^Nothing applied/)
    await c.click('inspector.tab.agent')
    const steps = await c.run(() => [...document.querySelectorAll('[data-testid^="agent.step."][data-nothing="yes"]')].length)
    assert.ok(steps >= 1, 'the dropped edit is a "Nothing applied" step')
    const st = await starts(c)
    console.log('     direct starts:', JSON.stringify(st))
    assert.deepEqual([st.a, st.b, st.c, st.s], [10, 10, 12, 10], 'every video 10 s later, the linked sound with it')
    const left = await c.run(() => {
      const r = (id) => document.querySelector(`[data-testid="timeline.clip.${id}"]`)?.getBoundingClientRect().left ?? null
      const ruler = document.querySelector('[data-testid="timeline.ruler"]').getBoundingClientRect().left
      return { a: r('a') - ruler - 110, c: r('c') - ruler - 110, px: window.__store.getState().pxPerSec }
    })
    assert.ok(Math.abs(left.a - 10 * left.px) < 2 && Math.abs(left.c - 12 * left.px) < 2, `the blocks moved on the timeline: ${JSON.stringify(left)}`)
    // The last change is marked on the timeline for a moment (item 6).
    assert.ok(await c.ev(`!!document.querySelector('[data-testid="agent.flash"]')`), 'the agent\'s last direct change glows on the timeline')
    await c.run(() => window.__agent.setMode('draft'))
  })

  await part('B draft', async () => {
    await c.run(build, ids)
    await c.waitId('timeline.clip.c')
    await c.run(() => window.__agent.setMode('draft'))
    const answers = await moveAll()
    console.log('     draft answers:', JSON.stringify(answers.map((a) => a.split('\n').slice(0, 2).join(' | '))))
    assert.match(answers[0], /the user accepts it in SnippStudio/, 'the edit answer says it is a draft the user accepts in the app')
    assert.deepEqual(Object.values(await starts(c)).sort(), [0, 0, 0, 2], 'the live project waits')
    const cand = await c.ev(`JSON.stringify(Object.fromEntries(Object.values(window.__agent.draft().project.clips).map((k) => [k.id, k.start])))`)
    console.log('     draft starts:', cand)
    assert.deepEqual(JSON.parse(cand), { a: 10, s: 10, b: 10, c: 12 })
    const view = await c.ev(`JSON.stringify(window.__agent.store.getState().draft)`)
    const d = JSON.parse(view)
    console.log('     summary:', JSON.stringify(d.summary), 'ghosts', JSON.stringify(d.marks?.ghosts?.map((g) => [g.id, g.trackId, g.start])))
    assert.equal(d.summary.moved, 4, 'the draft counts the moved clips (three and the linked sound)')
    // The timeline: a ghost at each new place, on the clip's own row.
    const tl = await c.run(() => {
      const ghosts = [...document.querySelectorAll('[data-testid="agent.mark"][data-variant="ghost"]')].map((g) => {
        const r = g.getBoundingClientRect()
        return { id: g.dataset.clip, top: r.top, left: r.left }
      })
      const rows = Object.fromEntries([...document.querySelectorAll('.tl-track[data-track-id]')].map((t) => [t.dataset.trackId, t.getBoundingClientRect().top]))
      const ruler = document.querySelector('[data-testid="timeline.ruler"]').getBoundingClientRect().left
      return { ghosts, rows, ruler, px: window.__store.getState().pxPerSec, bar: !!document.querySelector('.timeline [data-testid="agent.draft"]'), floating: !!document.querySelector('[data-testid="agent.draftbar"]') }
    })
    console.log('     timeline:', JSON.stringify(tl))
    const g = Object.fromEntries(tl.ghosts.map((x) => [x.id, x]))
    for (const [id, track, start] of [['a', 'V1', 10], ['b', 'V2', 10], ['c', 'V3', 12], ['s', 'A1', 10]]) {
      assert.ok(g[id], `a ghost for ${id}`)
      assert.ok(g[id].top >= tl.rows[track] && g[id].top < tl.rows[track] + 60, `${id}'s ghost on its own row ${track} (${g[id].top} vs ${tl.rows[track]})`)
      assert.ok(Math.abs(g[id].left - tl.ruler - 110 - start * tl.px) < 2, `${id}'s ghost at ${start} s`)
    }
    // (D22, worker C: the review strip under the timeline's toolbar took the floating bar's place.)
    assert.ok(tl.bar && !tl.floating, 'the review strip is over the timeline')
    // After: the preview shows the draft, and the timeline itself its layout; it plays.
    await c.click('agent.draft.view.candidate')
    await c.waitFor('After shown', () => c.ev(`!!document.querySelector('[data-testid="agent.after"]')`))
    const laid = await c.run(() => {
      const el = document.querySelector('[data-testid="timeline.clip.a"]')
      const ruler = document.querySelector('[data-testid="timeline.ruler"]').getBoundingClientRect().left
      return el ? (el.getBoundingClientRect().left - ruler - 110) / window.__store.getState().pxPerSec : null
    })
    assert.ok(laid !== null && Math.abs(laid - 10) < 0.1, `After: the timeline shows clip a where the draft puts it (${laid} s)`)
    await c.run(() => { const s = window.__store.getState(); s.setTime(9.5); s.setPlaying(true) })
    const playing = await c.st((s) => ({ t: s.currentTime, playing: s.playing }))
    console.log('     preview:', JSON.stringify(playing))
    assert.ok(playing.playing, 'the draft plays')
    await c.sleep(600)
    await c.shot(join(SHOTS, 'taslak-cizelge.png'))
    const t2 = await c.st((s) => s.currentTime)
    assert.ok(t2 > playing.t + 0.2, `the time runs (${playing.t} → ${t2})`)
    await c.run(() => window.__store.getState().setPlaying(false))
    await c.click('agent.draft.view.live')
    // Accepted from the strip: the clips move.
    await c.click('agent.draft.acceptAll')
    await c.waitFor('accepted', async () => (await starts(c)).a === 10)
    assert.deepEqual(await starts(c), { a: 10, s: 10, b: 10, c: 12 })
    await c.waitGone('agent.draft', 8000)
  })

  await part('C a jump and a gap', async () => {
    // "10 s" read as a time: the clip goes to 200 s; the card and the answer
    // warn; then the agent cuts the empty stretch: the timeline labels it as
    // an empty space (a lighter hatch), the card says it in words.
    await c.run(build, ids)
    await c.waitId('timeline.clip.c')
    await c.run(() => window.__agent.setMode('draft'))
    const v = versionOf((await ag.call('project')).text)
    const far = await ag.call('edit', { ops: [{ op: 'clip.move', clipId: 'b', start: 200 }], base: v })
    assert.match(far.text, /Warning: this edit makes the film longer by 194\.00 s/)
    await c.click('inspector.tab.agent')
    await c.waitId('agent.draft.jump')
    assert.match(await c.ev(`document.querySelector('[data-testid="agent.draft.jump"]').textContent`), /3:14/)
    await c.run(() => window.__agent.reject())
    await c.run(() => {
      const S = window.__store
      const p = structuredClone(S.getState().project)
      for (const id of ['a', 's', 'b', 'c']) p.clips[id].start += 190
      S.getState().loadProject(p)
      S.setState({ pxPerSec: 4 })
    })
    const v2 = versionOf((await ag.call('project')).text)
    await ag.call('edit', { ops: [{ op: 'timeline.cutRanges', ranges: [[0, 190]] }], base: v2 })
    await c.waitFor('the gap hatch', () => c.ev(`!!document.querySelector('[data-testid="agent.mark"][data-change="gap"]')`))
    const label = await c.ev(`document.querySelector('[data-testid="agent.mark"][data-change="gap"]').textContent`)
    const words = await c.ev(`document.querySelector('[data-testid="agent.draft.sentence"]').textContent`)
    assert.match(words, /^The empty space 0:00–3:10 is removed/)
    console.log('     gap:', label, '|', words, '|', await c.ev(`document.querySelector('[data-testid="agent.draft.headline"]').textContent`))
    await c.shot(join(SHOTS, 'taslak-bosluk.png'))
    await c.run(() => window.__agent.reject())
  })

  console.log('     ' + ag.summary('den2-t').split('\n')[0])
  if (failed.length) throw new Error(`${failed.length} part(s) failed:\n  ${failed.join('\n  ')}`)
}
