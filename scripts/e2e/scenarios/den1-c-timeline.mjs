// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// The user's first try-out, the timeline's part (SnippStudio
// DENEME-1-PLAN-C.md), in the app:
//   1. Look tab, nothing selected, a drag on Grain: a look layer is made over
//      the whole video, named on the timeline, the user is told once; the tab
//      stays the Look tab and the slider stays where it was on the screen
//      (it used to jump to the Clip tab: "the menu slid down");
//   2. W with a clip selected cuts that clip (and its linked sound) only; the
//      layer above stays; with nothing selected the topmost clip's track;
//   3. two touching clips meet (no lane between their blocks); a real gap of
//      time shows as lane;
//   4. an entrance / exit, a picture move and effect keys show on the block.
export const name = 'den1-c-timeline'
export const timeoutMs = 120_000

/** A project: V2 a picture over 2–6 s, V1 two numbered cards butting at 4 s
 *  and a third after a 1 s gap, A1 the talk's sound linked to the first card
 *  (as a split video and its sound would be). */
const build = (ids) => {
  const S = window.__store
  const p = structuredClone(S.getState().project)
  const W = p.settings.width
  const H = p.settings.height
  const T = { x: W / 2, y: H / 2, scale: 1, rotation: 0 }
  p.tracks = [
    { id: 'V2', kind: 'video', name: 'V2', clipIds: ['top'] },
    { id: 'V1', kind: 'video', name: 'V1', clipIds: ['a', 'b', 'c'] },
    { id: 'A1', kind: 'audio', name: 'A1', clipIds: ['s'] }
  ]
  p.clips = {
    top: { id: 'top', assetId: ids.pic, trackId: 'V2', start: 2, inPoint: 0, duration: 4, transform: { ...T, scale: 0.4 }, volume: 1 },
    a: { id: 'a', assetId: ids.one, trackId: 'V1', start: 0, inPoint: 0, duration: 4, transform: T, volume: 1, linkId: 'L' },
    b: { id: 'b', assetId: ids.two, trackId: 'V1', start: 4, inPoint: 0, duration: 4, transform: T, volume: 1 },
    c: { id: 'c', assetId: ids.three, trackId: 'V1', start: 9, inPoint: 0, duration: 3, transform: T, volume: 1 },
    s: { id: 's', assetId: ids.talk, trackId: 'A1', start: 0, inPoint: 0, duration: 4, transform: T, volume: 1, linkId: 'L' }
  }
  p.captions = []
  S.getState().setPlaying(false)
  S.getState().loadProject(p)
  S.setState({ selectedClipIds: [], linkAV: true, pxPerSec: 60 })
}

export async function run({ c, app, media, lib }) {
  const { assert } = lib
  const [one, two, three, pic, talk] = await lib.seedAssets(app, c, [...media.numbered.slice(0, 3), media.broll[0], media.talk])
  const ids = { one: one.id, two: two.id, three: three.id, pic: pic.id, talk: talk.id }
  // Each part on its own: one that fails is named and the next still runs
  // (so a run on the old build shows every part that was wrong).
  const failed = []
  const part = async (what, body) => {
    try {
      await body()
    } catch (e) {
      failed.push(`${what}: ${e.message.split(/\r?\n/)[0]}`)
    }
  }
  await c.run(build, ids)
  await c.waitId('timeline.clip.c')

  await part('3 touching clips', async () => {
  // ---- 3. touching clips meet; a gap is lane ---------------------------------
  const edges = await c.run(() => {
    const r = (id) => document.querySelector(`[data-testid="timeline.clip.${id}"]`).getBoundingClientRect()
    const cls = (id) => document.querySelector(`[data-testid="timeline.clip.${id}"]`).className
    return { a: [r('a').left, r('a').right], b: [r('b').left, r('b').right], c: [r('c').left, r('c').right], ca: cls('a'), cb: cls('b'), cc: cls('c'), px: window.__store.getState().pxPerSec }
  })
  console.log('     edges:', JSON.stringify(edges))
  assert.ok(Math.abs(edges.a[1] - edges.b[0]) < 0.5, `a and b touch on the timeline (a ends ${edges.a[1]}, b starts ${edges.b[0]})`)
  assert.match(edges.ca, /\bjoin-r\b/)
  assert.match(edges.cb, /\bjoin-l\b/)
  assert.doesNotMatch(edges.cb, /\bjoin-r\b/)
  assert.doesNotMatch(edges.cc, /\bjoin-l\b/)
  assert.ok(Math.abs(edges.c[0] - edges.b[1] - edges.px) < 1, `the 1 s gap is ${edges.c[0] - edges.b[1]} px of lane (${edges.px} px a second)`)

  })

  await part('4 marks', async () => {
  // ---- 4. what moves a clip shows on its block ------------------------------
  await c.run(() => {
    const S = window.__store
    const p = structuredClone(S.getState().project)
    p.clips.b.anim = { in: 'fade', out: 'zoom-out', inDur: 0.8, outDur: 0.5 }
    p.clips.b.moves = { actions: [{ id: 'mv', kind: 'hop', time: 1.5, dur: 0.6 }] }
    p.clips.b.fxKeys = { bloom: [{ id: 'k1', time: 1, value: 0 }, { id: 'k2', time: 3, value: 0.5 }] }
    S.getState().loadProject(p)
    S.setState({ pxPerSec: 60 })
  })
  await c.waitId('timeline.clip.b.anim-in')
  const marks = await c.run(() => {
    const w = (id) => document.querySelector(`[data-testid="timeline.clip.b.${id}"]`)?.getBoundingClientRect().width ?? null
    return { animIn: w('anim-in'), animOut: w('anim-out'), move: w('move.mv'), fx1: w('fx-key.1.00'), fx3: w('fx-key.3.00') }
  })
  console.log('     marks on b:', JSON.stringify(marks))
  assert.ok(Math.abs(marks.animIn - 0.8 * 60) < 2, `the entrance is 0.8 s wide (${marks.animIn} px)`)
  assert.ok(Math.abs(marks.animOut - 0.5 * 60) < 2, `the exit is 0.5 s wide (${marks.animOut} px)`)
  assert.ok(Math.abs(marks.move - 0.6 * 60) < 2, `the hop is 0.6 s wide (${marks.move} px)`)
  assert.ok(marks.fx1 > 0 && marks.fx3 > 0, 'the two effect keys are marked')

  })

  await part('2 W', async () => {
  // ---- 2. W: the selected clip and its linked sound only ----------------------
  await c.run(build, ids)
  await c.waitId('timeline.clip.a')
  await c.click('timeline.clip.a', { fy: 0.75 })
  await c.st((s) => s.setTime(3))
  await c.key('w')
  const afterW = await lib.clipList(c)
  const by = (list, id) => list.find((x) => x.id === id) ?? {}
  console.log('     after W:', JSON.stringify(afterW))
  assert.equal(by(afterW, 'a').duration, 3, 'a lost 3–4 s')
  assert.equal(by(afterW, 's').duration, 3, 'its linked sound too')
  assert.equal(by(afterW, 'b').start, 3, 'its track closed up')
  assert.deepEqual([by(afterW, 'top').start, by(afterW, 'top').duration], [2, 4], 'the layer above stays')
  // Nothing selected: the topmost clip under the playhead (the picture on V2).
  await c.st((s) => { s.selectClips([]); s.setTime(5) })
  await c.key('w')
  const afterW2 = await lib.clipList(c)
  console.log('     after W, nothing selected:', JSON.stringify(afterW2))
  assert.deepEqual([by(afterW2, 'top').start, by(afterW2, 'top').duration], [2, 3], 'the picture on V2 lost 5–6 s')
  assert.equal(by(afterW2, 'b').duration, 4, 'V1 untouched')

  })

  await part('1 Grain', async () => {
  // ---- 1. Grain with nothing selected ----------------------------------------
  await c.run(build, ids)
  await c.waitId('timeline.clip.a')
  await c.click('inspector.tab.fx')
  const grain = await c.waitRole('slider', 'Grain')
  const before = await c.byRole('slider', 'Grain')
  await c.run(() => document.querySelector('[data-testid="toast.stack"]')?.replaceChildren())
  await c.dragAt(grain.x + grain.w * 0.1, grain.cy, grain.x + grain.w * 0.4, grain.cy, { steps: 6 })
  await c.sleep(300)
  const after = await c.byRole('slider', 'Grain')
  const st = await c.st((s) => {
    const layer = Object.values(s.project.clips).find((k) => k.adjustment)
    return { sel: s.selectedClipIds, layer: layer && { id: layer.id, start: layer.start, duration: layer.duration, grain: layer.cameraLook?.grain }, layers: Object.values(s.project.clips).filter((k) => k.adjustment).length }
  })
  const tab = await c.attr('inspector.tab.fx', 'aria-selected')
  const toast = await c.run(() => document.querySelector('[data-testid="toast.stack"]')?.textContent ?? '')
  const label = st.layer ? await c.run((id) => document.querySelector(`[data-testid="timeline.clip.${id}"] .label`)?.textContent ?? '', st.layer.id) : ''
  console.log('     grain:', JSON.stringify({ before: before.y, after: after?.y, st, tab, toast, label }))
  assert.equal(st.layers, 1, 'one look layer, not one per step of the drag')
  assert.deepEqual([st.layer.start, st.layer.duration], [0, 12], 'over the whole video')
  assert.ok(st.layer.grain > 0, 'the grain is on it')
  assert.deepEqual(st.sel, [st.layer.id], 'the new layer is selected')
  assert.equal(tab, 'true', 'the Look tab stays open')
  assert.ok(after && Math.abs(after.y - before.y) < 2, `the slider stayed where it was (${before.y} → ${after?.y})`)
  assert.match(toast, /Look layer added/)
  assert.match(label, /Look/)
  })
  assert.deepEqual(failed, [], 'every part holds')
}
