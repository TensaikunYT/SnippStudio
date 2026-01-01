// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// Phase Ç2c.2, decision 2 (report K3, K24): a diamond dragged with the mouse
// moves the keys it was pressed on, by id. Keys at 1 and 2 s: the 1 s
// diamond dragged over the 2 s one (snapping on) and on to 2.5 s never
// leaves two keys of a channel at one instant, and the 2 s keys are where
// they were afterwards; the drag is one undo step. An Alt-drag leaves the
// keys and moves a copy that keeps its easing, as one undo step.
export const name = 'keyframe-drag'

export async function run({ c, app, media, lib }) {
  const { assert } = lib
  const [a] = await lib.seedAssets(app, c, [media.numbered[0]])
  await c.run((id) => {
    const S = window.__store
    const p = structuredClone(S.getState().project)
    p.settings.fps = 30
    p.tracks = [{ id: 'V1', kind: 'video', name: 'V1', clipIds: ['k'] }, { id: 'A1', kind: 'audio', name: 'A1', clipIds: [] }]
    p.clips = {
      k: { id: 'k', assetId: id, trackId: 'V1', start: 0, inPoint: 0, duration: 6, volume: 1, transform: { x: 960, y: 540, scale: 1, rotation: 0 } }
    }
    p.captions = []
    S.getState().loadProject(p)
    S.setState({ selectedClipIds: [], playing: false, pxPerSec: 120 })
    const s = S.getState()
    s.setTime(1)
    s.addClipKeyframe('k')
    s.setTime(2)
    s.setPropValue('k', 'x', 1300)
    s.addClipKeyframe('k')
    // The 1 s keys ease in linearly (the copy must keep it).
    for (const [ch, list] of Object.entries(S.getState().project.clips.k.channels)) s.setKeyframeEasing('k', ch, list[0].id, 'linear')
    s.setTime(4.5)
    const el = document.querySelector('.tl-scroll')
    if (el) el.scrollLeft = 0
  }, a.id)
  await c.sleep(300)

  const keyTimes = () => c.st((s) => Object.fromEntries(Object.entries(s.project.clips.k.channels).map(([ch, l]) => [ch, l.map((k) => +k.time.toFixed(4))])))
  const twins = async () => {
    const all = await keyTimes()
    return Object.entries(all).filter(([, ts]) => new Set(ts).size !== ts.length).map(([ch]) => ch)
  }
  const diamonds = async () => {
    const ids = await c.ids('timeline.clip.k.key.')
    const out = []
    for (const id of ids) out.push({ id, b: await c.box(id) })
    return out.filter((d) => d.b).sort((p, q) => p.b.cx - q.b.cx)
  }
  const pps = await c.st((s) => s.pxPerSec)
  let ds = await diamonds()
  assert.equal(ds.length, 2, `two diamonds (${ds.length})`)
  const first = ds[0].b
  const x0 = first.cx
  const y0 = first.cy

  // 1. Drag 1 → 2 (over the other diamond) → 2.5, sampling the keys on the way.
  const depth0 = await lib.undoDepth(c)
  await c.mouse('mouseMoved', x0, y0)
  await c.mouse('mousePressed', x0, y0)
  const seen = []
  for (const to of [1.3, 1.7, 2.0, 2.2, 2.5]) {
    await c.mouse('mouseMoved', x0 + (to - 1) * pps, y0, { down: true })
    await c.sleep(40)
    const tw = await twins()
    seen.push({ to, twins: tw, x: (await keyTimes()).x })
  }
  await c.mouse('mouseReleased', x0 + 1.5 * pps, y0)
  await c.sleep(150)
  for (const s of seen) assert.equal(s.twins.length, 0, `at ${s.to}: two keys at one instant on ${s.twins.join(', ')}`)
  const over = seen.find((s) => s.to === 2.0)
  assert.deepEqual(over.x, [2], `dropped over the 2 s keys, the dragged key takes their place (${JSON.stringify(over.x)})`)
  const after = await keyTimes()
  for (const [ch, ts] of Object.entries(after)) assert.deepEqual(ts, [2, 2.5], `${ch}: the 2 s key is back and the dragged one at 2.5 (${JSON.stringify(ts)})`)
  assert.equal((await lib.undoDepth(c)) - depth0, 1, 'the drag is one undo step')
  await c.st((s) => s.undo())
  const undone = await keyTimes()
  for (const [ch, ts] of Object.entries(undone)) assert.deepEqual(ts, [1, 2], `${ch} after undo (${JSON.stringify(ts)})`)

  // 2. Alt-drag the 1 s diamond to 3.5: the keys stay, a copy moves.
  await c.sleep(150)
  ds = await diamonds()
  const d1 = ds[0].b
  const depth1 = await lib.undoDepth(c)
  await c.dragAt(d1.cx, d1.cy, d1.cx + 2.5 * pps, d1.cy, { mods: ['alt'], steps: 8 })
  await c.sleep(150)
  const copied = await c.st((s) => s.project.clips.k.channels.x.map((k) => [+k.time.toFixed(4), k.easing ?? 'smooth']))
  assert.deepEqual(copied, [[1, 'linear'], [2, 'smooth'], [3.5, 'linear']], `the copy at 3.5 keeps the easing (${JSON.stringify(copied)})`)
  assert.equal((await lib.undoDepth(c)) - depth1, 1, 'the Alt-drag is one undo step')
  await c.st((s) => s.undo())
  const back = await c.st((s) => s.project.clips.k.channels.x.map((k) => +k.time.toFixed(4)))
  assert.deepEqual(back, [1, 2], 'one undo takes the copy back')
  console.log(`    drag 1 → 2 → 2.5: no two keys at one instant in ${seen.length} samples, ends [2, 2.5], 1 undo step; Alt copy keeps its easing, 1 undo step`)
}
