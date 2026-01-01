// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// D22, worker C (YOL-HARITASI.md, part 4): an agent's draft is reviewed ON
// the timeline. A scripted agent over real HTTP writes a draft with one
// operation of every sort (a move, a setting, a removal, a title, a marker,
// a trim, a split, a transition, a subtitle's words, a lane, a cut), all in one call:
//   - the review strip is under the timeline's toolbar (no floating bar, no
//     card in the Agent tab), whole and inside the window at 1920 × 1080 and
//     at 1366 × 768, in English and in Turkish, at the small lane height;
//   - EVERY item has a mark on the timeline, in "Before" and in "After"
//     ("no operation without a mark"), and no badge lies on a clip's name;
//   - the arrows go through the items: the count, the sentence, the mark in
//     focus and the playhead follow;
//   - "After" shows the draft's own layout on the timeline itself, read-only;
//   - one item accepted is ONE undo step and the rest still waits; one
//     rejected leaves the draft and can be brought back from the list of
//     what is not applied; "Accept all" lands the rest as one more step;
//   - the agent hears how its draft went, once, when nothing waits any more;
//   - the window itself never scrolls.
import { connectAgent, versionOf } from '../agent-client.mjs'
export const name = 'agent-d22-review-strip'
export const timeoutMs = 200_000

/** V3: pic2 14–17 · V2: pic 5–9 · V1: a 0–6, b 6–12 of talk, c 12–18 of other, each with its sound on A1 · two subtitle lines · one marker. */
const build = (ids) => {
  const S = window.__store
  const p = structuredClone(S.getState().project)
  const T = { x: p.settings.width / 2, y: p.settings.height / 2, scale: 1, rotation: 0 }
  p.tracks = [
    { id: 'V3', kind: 'video', name: 'V3', clipIds: ['pic2'] },
    { id: 'V2', kind: 'video', name: 'V2', clipIds: ['pic'] },
    { id: 'V1', kind: 'video', name: 'V1', clipIds: ['a', 'b', 'c'] },
    { id: 'A1', kind: 'audio', name: 'A1', clipIds: ['as', 'bs', 'cs'] }
  ]
  const clip = (id, assetId, trackId, start, inPoint, duration, extra = {}) => ({ id, assetId, trackId, start, inPoint, duration, transform: { ...T }, volume: 1, ...extra })
  p.clips = {
    a: clip('a', ids.talk, 'V1', 0, 0, 6, { linkId: 'L1', audioExtracted: true }),
    as: clip('as', ids.talk, 'A1', 0, 0, 6, { linkId: 'L1' }),
    b: clip('b', ids.talk, 'V1', 6, 6, 6, { linkId: 'L2', audioExtracted: true }),
    bs: clip('bs', ids.talk, 'A1', 6, 6, 6, { linkId: 'L2' }),
    c: clip('c', ids.other, 'V1', 12, 0, 6, { linkId: 'L3', audioExtracted: true }),
    cs: clip('cs', ids.other, 'A1', 12, 0, 6, { linkId: 'L3' }),
    pic: clip('pic', ids.pic, 'V2', 5, 0, 4),
    pic2: clip('pic2', ids.pic, 'V3', 14, 0, 3)
  }
  p.captions = [
    { id: 'S1', start: 0.5, end: 2.5, text: 'hello there' },
    { id: 'S2', start: 7, end: 9, text: 'we go on' }
  ]
  p.markers = [{ id: 'm1', time: 10, color: '#ffd83d', note: '', label: 'here' }]
  S.getState().setPlaying(false)
  S.getState().loadProject(p)
  S.setState({ selectedClipIds: [], pxPerSec: 60 })
  S.getState().setTime(1)
}

/** What the timeline holds of the draft now. */
const marksNow = () => {
  const strip = document.querySelector('[data-testid="agent.draft"]')
  const marks = [...document.querySelectorAll('[data-testid="agent.mark"]')].map((e) => ({ item: Number(e.dataset.item), kind: e.dataset.kind, variant: e.dataset.variant, shape: e.dataset.shape, focus: e.classList.contains('is-focus'), w: e.getBoundingClientRect().width, h: e.getBoundingClientRect().height }))
  // No badge on a clip's name (the name pills on screen).
  const names = [...document.querySelectorAll('.tl-clip .label')].map((e) => e.getBoundingClientRect()).filter((r) => r.width > 0)
  const badges = [...document.querySelectorAll('.agent-mark-badge')].filter((e) => getComputedStyle(e).display !== 'none' && e.dataset.shape !== 'chip' && e.dataset.shape !== 'chipBox').map((e) => e.getBoundingClientRect()).filter((r) => r.width > 0)
  let onName = 0
  for (const b of badges) for (const n of names) if (b.left < n.right - 0.5 && b.right > n.left + 0.5 && b.top < n.bottom - 0.5 && b.bottom > n.top + 0.5) onName++
  const r = strip?.getBoundingClientRect()
  const inside = strip ? [...strip.children].filter((e) => e.getBoundingClientRect().width > 0).every((e) => e.getBoundingClientRect().right <= r.right + 0.5 && e.getBoundingClientRect().left >= r.left - 0.5) : false
  return {
    items: Number(strip?.dataset.items ?? -1),
    view: strip?.dataset.view,
    count: document.querySelector('[data-testid="agent.draft.count"]')?.textContent,
    sentence: document.querySelector('[data-testid="agent.draft.sentence"]')?.textContent,
    marks,
    onName,
    badges: badges.length,
    strip: r ? { left: r.left, right: r.right, height: r.height, win: window.innerWidth, inside } : null,
    rootScroll: document.documentElement.scrollTop,
    rootOverflow: document.documentElement.scrollHeight - document.documentElement.clientHeight
  }
}

export async function run({ c, app, media, lib }) {
  const { assert } = lib
  await c.waitFor('the agent host', () => c.ev('!!window.__agent'))
  if ((await c.attr('agent.switch', 'aria-checked')) !== 'true') await lib.topBarSwitch(c)
  await c.waitFor('the agent server listening', async () => { try { await fetch(`http://127.0.0.1:${app.agentPort}/mcp`, { method: 'POST' }); return true } catch { return false } }, 15_000)
  const [talk, other, pic] = await lib.seedAssets(app, c, [media.talk, media.other, media.broll[0]])
  await c.run(build, { talk: talk.id, other: other.id, pic: pic.id })
  await c.run(() => window.__agent.setMode('draft'))
  const ag = await connectAgent({ c, app, assert, client: 'claude-code' })
  const scale0 = await c.ev('window.__timelineView.getState().trackScale')
  try {
    const v = versionOf((await ag.call('project')).text)
    // One operation of each sort, each on its own clip (so none leans on another).
    const OPS = [
      // (The move first: an op that moves is held to the very project it was written on.)
      ['move', { op: 'clip.move', clipId: 'pic', by: 2 }],
      ['remove', { op: 'clip.delete', ids: ['pic2'] }],
      ['set', { op: 'clip.setVolume', clipId: 'as', volume: 0.5 }],
      ['add', { op: 'text.add', time: 3, text: 'Subscribe' }],
      ['pin', { op: 'marker.add', time: 4, note: 'look' }],
      ['line', { op: 'caption.editLine', id: 'S2', text: 'we carry on' }],
      ['transition', { op: 'clip.setTransition', clipId: 'a', transition: { type: 'mix', duration: 0.5 } }],
      ['track', { op: 'track.add', kind: 'audio' }],
      ['trim', { op: 'clip.trimEnd', clipId: 'c', delta: -1 }],
      ['cut', { op: 'timeline.cutRanges', ranges: [[9.5, 10.5], [16, 16.5]] }]
    ]
    const wrote = await ag.call('edit', { ops: OPS.map(([, op]) => op), base: v }, { allowError: true })
    assert.ok(!wrote.isError, wrote.text)
    await c.waitId('agent.draft')
    await c.sleep(300)
    // The floating bar and the Agent tab's card are gone; the strip is the timeline's.
    assert.equal(await c.ev(`!!document.querySelector('[data-testid="agent.draftbar"]')`), false)
    await c.click('inspector.tab.agent')
    assert.equal(await c.ev(`!!document.querySelector('[data-testid="agent.tab"] [data-testid="agent.draft.changes"], [data-testid="agent.tab"] [data-testid="agent.draft"]')`), false, 'no draft card in the Agent tab')
    assert.ok(await c.has('agent.steps'), 'the Agent tab keeps the steps')
    assert.ok(await c.has('agent.settings'), '… and the settings')
    assert.equal(await c.ev(`document.querySelector('.timeline [data-testid="agent.draft"]') !== null`), true)

    let m = await c.run(marksNow)
    const N = m.items
    console.log(`     draft: ${N} items of ${OPS.length} ops; answer: ${wrote.text.split('\n')[0].slice(0, 160)}`)
    assert.equal(N, OPS.length, `the draft applies every op (${N} of ${OPS.length}): ${wrote.text}`)

    // ---- every item has a mark, in both views, at two sizes, two languages, small lanes
    for (const [w, h, lang, scale] of [[1920, 1080, 'en', 'medium'], [1366, 768, 'tr', 'small'], [1366, 768, 'en', 'medium'], [1920, 1080, 'tr', 'small']]) {
      await c.send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: false })
      await c.st((s, l) => s.setUiLang(l), lang)
      await c.ev(`window.__timelineView.getState().setTrackScale(${JSON.stringify(scale)})`)
      for (const view of ['live', 'candidate']) {
        await c.click(`agent.draft.view.${view}`)
        await c.sleep(450)
        m = await c.run(marksNow)
        const where = `${w}×${h} ${lang} ${scale} ${view === 'live' ? 'before' : 'after'}`
        assert.equal(m.view, view === 'live' ? 'before' : 'after', where)
        const marked = new Set(m.marks.filter((x) => x.w > 0 || x.h > 0).map((x) => x.item))
        const bare = Array.from({ length: m.items }, (_, i) => i).filter((i) => !marked.has(i))
        assert.deepEqual(bare, [], `${where}: every item has a mark on the timeline (${JSON.stringify(m.marks.map((x) => `${x.item}:${x.kind}/${x.variant}`))})`)
        assert.equal(m.onName, 0, `${where}: no badge lies on a clip's name (${m.badges} badges)`)
        assert.ok(m.strip && m.strip.left >= 0 && m.strip.right <= m.strip.win && m.strip.inside, `${where}: the strip and all its parts are inside the window (${JSON.stringify(m.strip)})`)
        assert.equal(m.strip.height, 34, `${where}: the strip is 34 high`)
        assert.deepEqual([m.rootScroll, m.rootOverflow], [0, 0], `${where}: the window itself does not scroll`)
        for (const id of ['agent.draft.acceptOne', 'agent.draft.rejectOne', 'agent.draft.reject', 'agent.draft.acceptAll', 'agent.draft.view.live', 'agent.draft.view.candidate', 'agent.draft.prev', 'agent.draft.next']) assert.ok(await c.has(id), `${where}: ${id} is on screen`)
      }
      // "After": the lanes show the draft (the new lane is there) and take no press.
      const after = await c.run(() => ({ lanes: document.querySelectorAll('.tl-track').length, readOnly: getComputedStyle(document.querySelector('.tl-track')).pointerEvents, cls: document.querySelector('[data-testid="timeline.scroll"]').classList.contains('is-agent-after') }))
      assert.deepEqual([after.lanes, after.readOnly, after.cls], [5, 'none', true], `${w}: After shows the draft's five lanes, read-only`)
      await c.click('agent.draft.view.live')
      await c.sleep(200)
      assert.equal(await c.ev(`document.querySelectorAll('.tl-track').length`), 4, 'Before: the live four lanes again')
    }
    await c.send('Emulation.setDeviceMetricsOverride', { width: 1920, height: 1080, deviceScaleFactor: 1, mobile: false })
    await c.st((s) => s.setUiLang('en'))
    await c.ev(`window.__timelineView.getState().setTrackScale('medium')`)
    await c.sleep(300)

    // ---- the marks by kind (Before)
    m = await c.run(marksNow)
    const kinds = new Set(m.marks.map((x) => x.kind))
    for (const k of ['remove', 'move', 'set', 'add', 'pin', 'line', 'transition', 'track', 'trim', 'cut']) assert.ok(kinds.has(k), `a ${k} mark is drawn (${[...kinds].join(' ')})`)

    // ---- the arrows: the count, the sentence, the focus and the playhead follow
    assert.equal(m.count, `1 / ${N}`)
    assert.match(m.sentence, /^bridge\.png moves 2 s later \(0:05 → 0:07\)$/)
    assert.ok(m.marks.some((x) => x.item === 0 && x.focus), 'the first item is in focus')
    await c.click('agent.draft.next')
    await c.sleep(250)
    m = await c.run(marksNow)
    assert.equal(m.count, `2 / ${N}`)
    assert.match(m.sentence, /^bridge\.png is removed \(0:14–0:17\)$/)
    assert.ok(m.marks.some((x) => x.item === 1 && x.focus) && !m.marks.some((x) => x.item === 0 && x.focus), 'the focus moved to the second item')
    assert.equal(await c.st((s) => s.currentTime), 14, 'the playhead went to the clip that goes')
    await c.click('agent.draft.next')
    await c.sleep(250)
    assert.match((await c.run(marksNow)).sentence, /^talk\.mp4: volume 100 % → 50 %$/)
    assert.equal(await c.st((s) => s.currentTime), 0, 'the playhead went to the clip the setting is on')
    await c.click('agent.draft.next')
    await c.sleep(250)
    assert.match((await c.run(marksNow)).sentence, /^A title "Subscribe" is added at 0:03$/)
    assert.equal(await c.st((s) => s.currentTime), 3)
    for (let i = 0; i < 3; i++) await c.click('agent.draft.prev')
    await c.sleep(250)
    assert.equal((await c.run(marksNow)).count, `1 / ${N}`)
    // A press on a mark's badge puts its item in focus.
    const badgeItem = await c.run(() => {
      const b = [...document.querySelectorAll('.agent-mark[data-kind="set"] .agent-mark-badge')].find((e) => getComputedStyle(e).display !== 'none')
      b?.click()
      return b ? Number(b.closest('.agent-mark').dataset.item) : -1
    })
    await c.sleep(200)
    assert.equal((await c.run(marksNow)).count, `${badgeItem + 1} / ${N}`, 'a press on a badge: that item')

    // ---- one item by itself must not cost another: the setting waits for the move
    // (the item in focus is the setting; the move — held to the very project
    // it was written on — would no longer apply if the setting landed first).
    await c.waitFor('the cost is known', async () => (await c.attr('agent.draft.acceptOne', 'data-blocked')) !== null)
    assert.equal(await c.attr('agent.draft.acceptOne', 'data-blocked'), '1:0', 'the setting is not accepted before the move is decided')
    const depth0 = await lib.undoDepth(c)
    // The button is not dimmed: a press says why IN THE STRIP, with "decide
    // that one first"; nothing lands. That link takes the strip to the move.
    assert.equal(await c.attr('agent.draft.acceptOne', 'disabled'), null, 'Accept can be pressed')
    await c.click('agent.draft.acceptOne')
    await c.waitId('agent.draft.blocked')
    assert.match(await c.ev(`document.querySelector('[data-testid="agent.draft.blocked"]').textContent`), /^Not by itself: .bridge\.png moves 2 s later \(0:05 → 0:07\). would be lost\.$/)
    for (const [w, h, lang] of [[1366, 768, 'tr'], [1920, 1080, 'en']]) {
      await c.send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: false })
      await c.st((s, l) => s.setUiLang(l), lang)
      await c.sleep(250)
      const box = await c.run(() => {
        const s = document.querySelector('[data-testid="agent.draft"]').getBoundingClientRect()
        const g = document.querySelector('[data-testid="agent.draft.blocked.go"]').getBoundingClientRect()
        const why = document.querySelector('[data-testid="agent.draft.blocked"]').getBoundingClientRect()
        return { go: g.left >= s.left && g.right <= s.right && g.width > 0, why: why.width, strip: s.height }
      })
      assert.ok(box.go && box.why >= 120 && box.strip === 34, `${w} ${lang}: the reason and its link are inside the strip (${JSON.stringify(box)})`)
      assert.ok((await c.run(marksNow)).strip.inside, `${w} ${lang}: the strip's parts stay inside the window`)
    }
    await c.click('agent.draft.blocked.go')
    await c.waitFor('the move is in focus', async () => (await c.run(marksNow)).count === `1 / ${N}`)
    assert.equal(await c.has('agent.draft.blocked'), false, 'the sentence of the move is back')
    assert.equal(await lib.undoDepth(c), depth0, 'nothing was accepted')
    assert.equal(await c.st((s) => s.project.clips.as.volume), 1)
    assert.equal((await c.run(marksNow)).items, N)
    // ---- "play this change": the draft, around the change, as After; then Before again
    await c.click('agent.draft.play')
    await c.waitFor('it plays the draft', async () => (await c.attr('agent.draft.play', 'data-playing')) === 'yes' && (await c.attr('agent.draft', 'data-view')) === 'after')
    const played = await c.st((s) => ({ t: s.currentTime, playing: s.playing }))
    assert.ok(played.playing && played.t >= 2.9 && played.t < 9, `from 2 s before the change: ${played.t}`)
    await c.click('agent.draft.play')
    await c.waitFor('stopped, Before again', async () => (await c.attr('agent.draft.play', 'data-playing')) === 'no' && (await c.attr('agent.draft', 'data-view')) === 'before')
    assert.equal(await c.st((s) => s.playing), false)
    // ---- "After" is read-only: a key, a store edit: nothing changes, the user is told
    await c.click('agent.draft.view.candidate')
    await c.sleep(250)
    const film = (s) => JSON.stringify([Object.keys(s.project.clips).sort(), s.project.clips.a.duration, s.project.clips.a.start, s.project.markers.length])
    const liveBefore = await c.st(film)
    const depthA = await lib.undoDepth(c)
    await c.st((s) => { s.setTime(3); s.selectClips(['a']) })
    await c.key('Delete')
    await c.st((s) => s.deleteClips(['a'], false))
    await c.st((s) => s.splitAtPlayhead())
    await c.st((s) => s.addMarkerAtPlayhead())
    assert.equal(await c.st(film), liveBefore, 'After: no edit reaches the live film')
    assert.equal(await lib.undoDepth(c), depthA, '… and no undo step is made')
    await c.waitFor('the user is told', () => c.ev(`[...document.querySelectorAll('.ui-toast')].some((e) => /After shows the draft: nothing is edited here/.test(e.innerText))`))
    assert.equal((await c.run(marksNow)).items, N, 'the draft is as it was')
    await c.click('agent.draft.view.live')
    await c.st((s) => s.selectClips([]))
    await c.sleep(200)
    // ---- one item accepted: one undo step; the rest waits
    await c.waitFor('accept one is on', async () => (await c.attr('agent.draft.acceptOne', 'disabled')) === null)
    await c.click('agent.draft.acceptOne')
    await c.waitFor('the move landed', () => c.st((s) => s.project.clips.pic.start === 7))
    assert.equal(await lib.undoDepth(c), depth0 + 1, 'ONE undo step')
    await c.waitFor('one item less', async () => (await c.run(marksNow)).items === N - 1)
    assert.equal(await c.st((s) => s.project.clips.as.volume), 1, 'the setting still waits')
    assert.ok(await c.st((s) => !!s.project.clips.pic2), '… and the removal')
    await c.st((s) => s.undo())
    assert.equal(await c.st((s) => s.project.clips.pic.start), 5, 'undo takes that one accept back')
    await c.st((s) => s.redo())
    await c.waitFor('the draft is worked out again', async () => (await c.attr('agent.draft', 'data-updating')) === 'no', 6000)
    assert.equal((await c.run(marksNow)).items, N - 1, 'an accepted item is not offered again')

    // ---- one item rejected; brought back from the list of what is not applied
    const first = (await c.run(marksNow)).sentence
    await c.click('agent.draft.rejectOne')
    await c.waitFor('one item less', async () => (await c.run(marksNow)).items === N - 2)
    assert.notEqual((await c.run(marksNow)).sentence, first)
    await c.click('agent.draft.notApplied')
    await c.waitId('agent.draft.dropped')
    const row = await c.run(() => [...document.querySelectorAll('[data-testid^="agent.draft.dropped."][data-rejected="yes"]')].map((e) => e.textContent))
    assert.equal(row.length, 1, 'the rejected one is listed')
    assert.match(row[0], /You rejected it/)
    await c.run(() => document.querySelector('[data-testid^="agent.draft.dropped."][data-rejected="yes"] button').click())
    await c.waitFor('brought back', async () => (await c.run(marksNow)).items === N - 1)
    if (await c.has('agent.draft.dropped.ok')) await c.click('agent.draft.dropped.ok')
    await c.sleep(200)

    // ---- a cut of two ranges: one is taken out from the strip's menu, the other stays
    for (let i = 0; i < N; i++) {
      if (await c.ev(`document.querySelector('.agent-mark.is-focus')?.dataset.kind === 'cut'`)) break
      await c.click('agent.draft.next')
      await c.sleep(150)
    }
    const cutSentence = (await c.run(marksNow)).sentence
    const cuts0 = await c.ev(`document.querySelectorAll('[data-testid="agent.mark"][data-kind="cut"]').length`)
    await c.click('agent.draft.more')
    await c.waitId('agent.draft.leave.1')
    assert.match(await c.ev(`document.querySelector('[data-testid="agent.draft.leave.1"]').textContent`), /Range 2: 0:16.*0:16\.5/)
    await c.click('agent.draft.leave.1')
    await c.waitFor('one range less', async () => (await c.ev(`document.querySelectorAll('[data-testid="agent.mark"][data-kind="cut"]').length`)) < cuts0)
    assert.notEqual((await c.run(marksNow)).sentence, cutSentence, 'the sentence is of the one range left')
    assert.equal(await c.has('agent.draft.leave.0'), false)

    // ---- accept all: the rest as one step; the agent hears it once
    const depth1 = await lib.undoDepth(c)
    await c.click('agent.draft.acceptAll')
    await c.waitGone('agent.draft', 8000)
    assert.equal(await lib.undoDepth(c), depth1 + 1, 'the rest: one more undo step')
    assert.equal(await c.st((s) => s.project.clips.as.volume), 0.5)
    assert.equal(await c.st((s) => s.project.tracks.length), 5)
    const got = await ag.call('wait', { seconds: 10 })
    assert.equal((got.text.match(/The user accepted/g) ?? []).length, 1, `one answer for the whole review: ${got.text}`)
    // The bar takes the strip's place and says how it went.
    await c.waitId('agent.bar')
    assert.deepEqual(await c.run(() => [document.documentElement.scrollTop, document.documentElement.scrollHeight - document.documentElement.clientHeight]), [0, 0])
  } finally {
    await c.send('Emulation.setDeviceMetricsOverride', { width: 1920, height: 1080, deviceScaleFactor: 1, mobile: false })
    await c.st((s) => s.setUiLang('en')).catch(() => null)
    await c.ev(`window.__timelineView.getState().setTrackScale(${JSON.stringify(scale0)})`).catch(() => null)
    await c.run(() => window.__agent.reject()).catch(() => null)
  }
}
