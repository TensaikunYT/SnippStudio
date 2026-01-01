// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// A transition between two clips, the way it is made and edited since core
// polish T: one click on the cut adds the default (one step, selected, the
// Inspector shows it); the Inspector changes its type and length; an end
// dragged on the timeline changes the length (one step); right-click opens
// its menu; Delete removes it, Ctrl+Z brings it back; Ctrl+T adds the
// remembered default at the cut nearest the playhead; a narrow cut still
// offers its target. The export draws it (a frame in the middle of the wipe
// is neither clip's own).
export const name = 'transition-add'

export async function run({ c, app, media, lib }) {
  const { assert } = lib
  const [talk, other] = await lib.seedAssets(app, c, [media.talk, media.other])
  await lib.seedTimeline(c, [talk.id, other.id])
  const [first] = await lib.clipList(c)
  const tr = () => c.st((s, id) => s.project.clips[id].transitionOut ?? null, first.id)
  const depth = () => lib.undoDepth(c)
  // A known default to begin with (the profile is a throw-away one).
  await c.run(() => localStorage.removeItem('snipp-transition-default'))

  // 1. One click on the cut: the default (a dissolve, 0.5 s), one step, selected.
  let d0 = await depth()
  await c.click(`timeline.junction.${first.id}.add`, { force: true })
  const added = await c.waitFor('a transition', tr)
  assert.equal(added.type, 'mix')
  assert.ok(Math.abs(added.duration - 0.5) < 1e-6, `0.5 s (${added.duration})`)
  assert.equal((await depth()) - d0, 1, 'one step')
  await c.waitId(`timeline.junction.${first.id}.block`)
  assert.equal(await c.attr(`timeline.junction.${first.id}.block`, 'aria-selected'), 'true')
  await c.waitId('inspector.trans.kind')
  assert.deepEqual(await c.st((s) => s.selectedClipIds), [], 'the transition is what is selected')

  // 2. The Inspector: a wipe, then 0.8 s typed; a step each.
  d0 = await depth()
  await c.click('inspector.trans.kind.wipe')
  await c.waitFor('a wipe', async () => (await tr())?.type === 'wipe')
  await c.fill('inspector.trans.duration.value', '0.8', { enter: true })
  await c.waitFor('0.8 s', async () => Math.abs((await tr()).duration - 0.8) < 0.01)
  assert.equal((await depth()) - d0, 2, 'two steps (type, length)')

  // 3. The right end dragged on the timeline: longer, one step; Escape on a
  //    second drag leaves no trace.
  d0 = await depth()
  await c.drag(`timeline.junction.${first.id}.edge-r`, 30, 0, { steps: 8 })
  const longer = (await tr()).duration
  assert.ok(longer > 0.85, `longer (${longer})`)
  assert.equal((await depth()) - d0, 1, 'one drag, one step')
  // A second drag, Escape before letting go: the length and the undo list as they were.
  const e = await c.box(`timeline.junction.${first.id}.edge-r`)
  d0 = await depth()
  await c.mouse('mouseMoved', e.cx, e.cy)
  await c.mouse('mousePressed', e.cx, e.cy)
  for (let i = 1; i <= 6; i++) { await c.mouse('mouseMoved', e.cx + i * 6, e.cy, { down: true }); await c.sleep(20) }
  await c.waitFor('the length label', () => c.has('timeline.transition-tip'))
  await c.key('Escape')
  await c.mouse('mouseReleased', e.cx + 36, e.cy)
  assert.ok(Math.abs((await tr()).duration - longer) < 1e-9, 'Escape put the length back')
  assert.equal(await depth(), d0, 'and left no step')
  assert.equal(await c.has('timeline.transition-tip'), false)

  // 4. Right-click: its menu; a type from there (one step).
  const blk = await c.box(`timeline.junction.${first.id}.block`)
  await c.clickAt(blk.cx, blk.cy, { button: 'right' })
  await c.waitId('transition-menu')
  d0 = await depth()
  await c.click('transition-menu.choice.iris')
  await c.waitFor('an iris', async () => (await tr())?.type === 'iris')
  assert.equal((await depth()) - d0, 1)

  // 5. Delete removes the selected transition; Ctrl+Z brings it back.
  await c.click(`timeline.junction.${first.id}.change`, { force: true })
  d0 = await depth()
  await c.key('Delete')
  await c.waitFor('removed', async () => (await tr()) === null)
  assert.equal((await depth()) - d0, 1)
  await c.waitId(`timeline.junction.${first.id}.add`)
  await c.key('z', ['ctrl'])
  await c.waitFor('back', async () => (await tr())?.type === 'iris')

  // 6. Ctrl+T, nothing selected: the remembered default (the iris, its
  //    length) at the cut nearest the playhead.
  await c.run((id) => { const s = window.__store.getState(); s.setTransitionOut(id, null); s.selectClip(null) }, first.id)
  await c.key('Escape')
  const cut = await c.st((s, id) => s.project.clips[id].start + s.project.clips[id].duration, first.id)
  await c.st((s, at) => s.setTime(at), cut - 1.5)
  d0 = await depth()
  await c.key('t', ['ctrl'])
  const byKey = await c.waitFor('Ctrl+T', tr)
  assert.equal(byKey.type, 'iris', 'the remembered type')
  assert.ok(Math.abs(byKey.duration - longer) < 0.01, `the remembered length (${byKey.duration}, ${longer})`)
  assert.equal((await depth()) - d0, 1)

  // 7. A narrow cut still has its target: zoomed out until the shorter clip
  //    is 20 px wide.
  await c.run((id) => { const s = window.__store.getState(); s.setTransitionOut(id, null); const p = s.project; const lane = p.tracks.find((t) => t.kind === 'video'); const [a, b] = lane.clipIds.map((x) => p.clips[x]); s.setPxPerSec(20 / Math.min(a.duration, b.duration)) }, first.id)
  await c.waitId(`timeline.junction.${first.id}.add`)
  const tb = await c.box(`timeline.junction.${first.id}.add`)
  assert.ok(tb.w >= 24 && tb.h >= 24, `a 24 px target (${tb.w} × ${tb.h})`)
  await c.click(`timeline.junction.${first.id}.add`, { force: true })
  await c.waitFor('added on a narrow cut', tr)

  // 8. A kind dragged from Library → Effects onto the cut (the drop the tile
  //    makes: its type under the transition's own drag type).
  await c.run((id) => window.__store.getState().setTransitionOut(id, null), first.id)
  await c.waitId(`timeline.junction.${first.id}.add`)
  d0 = await depth()
  await c.run((sel) => {
    const el = document.querySelector(sel)
    const dt = new DataTransfer()
    dt.setData('application/x-snipp-transition', 'zoom')
    for (const type of ['dragenter', 'dragover', 'drop']) el.dispatchEvent(new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer: dt }))
  }, `[data-testid="timeline.junction.${first.id}.add"]`)
  await c.waitFor('a zoom, dropped', async () => (await tr())?.type === 'zoom')
  assert.equal((await depth()) - d0, 1)

  // What the export draws at the junction is a mix of both clips.
  await c.run((id) => { const s = window.__store.getState(); s.setTransitionOut(id, { type: 'wipe', duration: 0.8 }) }, first.id)
  const sig = await c.run(async (at) => {
    const ex = await window.__exporter()
    const p = window.__store.getState().project
    const png = async (t) => { const u8 = await ex.exportFramePng(p, t, true, 'final'); const b = await createImageBitmap(new Blob([u8])); const cv = new OffscreenCanvas(32, 18); const g = cv.getContext('2d'); g.drawImage(b, 0, 0, 32, 18); return [...g.getImageData(0, 0, 32, 18).data] }
    const d = (a, b) => a.reduce((n, v, i) => n + Math.abs(v - b[i]), 0) / a.length
    const mid = await png(at), before = await png(at - 2), after = await png(at + 2)
    return { toBefore: d(mid, before), toAfter: d(mid, after) }
  }, cut)
  assert.ok(sig.toBefore > 3 && sig.toAfter > 3, `the junction frame is neither clip alone (${sig.toBefore.toFixed(1)}, ${sig.toAfter.toFixed(1)})`)
}
