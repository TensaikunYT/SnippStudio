// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// Cila A: a clip's mask edited in the preview. Its corners grow it from the
// corner that is held (the top left one pulled outwards made it smaller); the
// soft-edge handle softens it; a press on a pen mask's outline puts a point
// there and drags it in the same gesture; Alt + click and a right click take a
// point off (three stay); while the outline is hidden the mask takes no press
// (the picture is picked up instead). One undo step per gesture.
export const name = 'preview-mask'

export async function run({ c, app, media, lib }) {
  const { assert } = lib
  const [a] = await lib.seedAssets(app, c, [media.numbered[0]])
  await c.run((id) => {
    const S = window.__store
    const p = structuredClone(S.getState().project)
    p.settings = { width: 1920, height: 1080, fps: 30 }
    p.tracks = [{ id: 'V1', kind: 'video', name: 'V1', clipIds: ['pic'] }, { id: 'A1', kind: 'audio', name: 'A1', clipIds: [] }]
    // 640 × 360 media at 1.5; the mask is 300 × 200 media px (450 × 300 in the frame).
    p.clips = { pic: { id: 'pic', assetId: id, trackId: 'V1', start: 0, inPoint: 0, duration: 6, volume: 1, transform: { x: 960, y: 540, scale: 1.5, rotation: 0 }, mask: { enabled: true, shape: 'rect', cx: 0, cy: 0, w: 300, h: 200, feather: 0 } } }
    p.captions = []
    S.getState().loadProject(p)
    S.setState({ selectedClipIds: ['pic'], playing: false })
    S.getState().setTime(1)
    S.getState().setPreviewView({ zoom: 1, x: 0, y: 0 })
    S.getState().setMaskOverlay('on')
  }, a.id)
  await c.sleep(300)
  const v = await c.run(() => {
    const el = document.querySelector('[data-testid="preview.canvas"]')
    const r = el.getBoundingClientRect()
    return { left: r.left, top: r.top, w: el.clientWidth, h: el.clientHeight, k: Math.min(el.clientWidth / 1920, el.clientHeight / 1080) }
  })
  // Media px (the mask's own units, the picture's middle at 0, 0) → window px.
  const M = (mx, my) => [v.left + v.w / 2 + mx * 1.5 * v.k, v.top + v.h / 2 + my * 1.5 * v.k]
  const mk = v.k * 1.5 // window px per media px
  const mask = () => c.st((s) => s.project.clips.pic.mask)
  const depth = () => lib.undoDepth(c)
  const cursor = () => c.ev(`document.querySelector('[data-testid="preview.canvas"]').style.cursor`)
  const near = (x, y, eps = 4) => Math.abs(x - y) <= eps
  // Undo leaves nothing selected (the store's rule): the picture is picked again.
  const undoAll = async (to) => {
    for (let i = 0; i < 8 && (await depth()) > to; i++) await c.st((s) => s.undo())
    await c.run(() => window.__store.setState({ selectedClipIds: ['pic'] }))
    await c.sleep(60)
  }
  const d0 = await depth()

  // The top left corner pulled outwards: larger (round its middle, so the
  // corner stays under the pointer).
  const [tlx, tly] = M(-150, -100)
  await c.mouse('mouseMoved', tlx, tly)
  await c.sleep(60)
  assert.equal(await cursor(), 'nwse-resize', 'the top left corner: the arrow along its diagonal')
  await c.dragAt(tlx, tly, tlx - 30 * mk, tly - 20 * mk, { steps: 10 })
  let m = await mask()
  assert.ok(near(m.w, 360) && near(m.h, 240), `grown by the pull on both sides (${m.w} × ${m.h})`)
  assert.equal(await depth(), d0 + 1, 'one undo step')
  await undoAll(d0)
  // …and the top right corner, on its own diagonal.
  const [trx, try_] = M(150, -100)
  await c.mouse('mouseMoved', trx, try_)
  await c.sleep(60)
  assert.equal(await cursor(), 'nesw-resize')
  await c.dragAt(trx, try_, trx + 30 * mk, try_ - 20 * mk, { steps: 10 })
  m = await mask()
  assert.ok(near(m.w, 360) && near(m.h, 240), `the top right corner grows it too (${m.w} × ${m.h})`)
  await undoAll(d0)

  // A press inside moves the mask, not the picture; 2 px is a click.
  const [bx, by] = M(20, 10)
  await c.dragAt(bx, by, bx + 2, by + 1, { steps: 2 })
  assert.deepEqual([(await mask()).cx, (await mask()).cy], [0, 0], 'a click moves nothing')
  assert.equal(await depth(), d0)
  await c.dragAt(bx, by, bx + 40 * mk, by + 20 * mk, { steps: 10 })
  m = await mask()
  assert.ok(near(m.cx, 40, 2) && near(m.cy, 20, 2), `the mask moved (${m.cx}, ${m.cy})`)
  assert.deepEqual(await c.st((s) => [s.project.clips.pic.transform.x, s.project.clips.pic.transform.y]), [960, 540], 'the picture stayed')
  await undoAll(d0)

  // The soft-edge handle: out of the right side's middle, 16 px away while the edge is hard.
  const [fx, fy] = [M(150, 0)[0] + 16, M(150, 0)[1]]
  await c.mouse('mouseMoved', fx, fy)
  await c.sleep(60)
  assert.equal(await cursor(), 'ew-resize', 'the soft-edge handle pulls sideways')
  await c.dragAt(fx, fy, fx + 30 * mk, fy, { steps: 10 })
  m = await mask()
  assert.ok(near(m.feather, 30, 2), `30 media px of soft edge (${m.feather})`)
  assert.equal(await depth(), d0 + 1)
  // Pushed back past the edge it is hard again, never negative.
  const [gx, gy] = [M(150, 0)[0] + 16 + m.feather * mk, M(150, 0)[1]]
  await c.dragAt(gx, gy, gx - 200, gy, { steps: 10 })
  assert.equal((await mask()).feather, 0)
  await undoAll(d0)

  // The outline hidden: the mask takes no press, the picture is picked up.
  await c.st((s) => s.setMaskOverlay('off'))
  await c.sleep(80)
  await c.dragAt(bx, by, bx + 40 * mk, by + 20 * mk, { steps: 10 })
  assert.deepEqual([(await mask()).cx, (await mask()).cy], [0, 0], 'hidden: the mask did not move')
  assert.ok((await c.st((s) => s.project.clips.pic.transform.x)) > 960, 'the picture did')
  await undoAll(d0)
  await c.st((s) => s.setMaskOverlay('on'))

  // A pen mask: four points (a diamond). A press on a side puts a point
  // there and drags it: one undo step for both.
  await c.st((s) => s.setClipMask('pic', { shape: 'path' }))
  await c.sleep(100)
  const d1 = await depth()
  let pts = (await mask()).points
  assert.equal(pts.length, 4)
  const mid = [(pts[0].x + pts[1].x) / 2, (pts[0].y + pts[1].y) / 2]
  const [sx, sy] = M(mid[0], mid[1])
  await c.mouse('mouseMoved', sx, sy)
  await c.sleep(60)
  assert.equal(await cursor(), 'copy', 'on the outline: a point can be put here')
  await c.dragAt(sx, sy, sx + 30 * mk, sy - 30 * mk, { steps: 10 })
  pts = (await mask()).points
  assert.equal(pts.length, 5, 'a point more')
  assert.ok(near(pts[1].x, mid[0] + 30, 3) && near(pts[1].y, mid[1] - 30, 3), `and it went with the pointer (${JSON.stringify(pts[1])})`)
  assert.equal(await depth(), d1 + 1, 'the new point and its drag are one undo step')
  // A click on the outline (no drag) puts a point too.
  const mid2 = [(pts[2].x + pts[3].x) / 2, (pts[2].y + pts[3].y) / 2]
  await c.clickAt(...M(mid2[0], mid2[1]))
  assert.equal((await mask()).points.length, 6)
  assert.equal(await depth(), d1 + 2)
  // A point dragged.
  pts = (await mask()).points
  const [px, py] = M(pts[0].x, pts[0].y)
  await c.mouse('mouseMoved', px, py)
  await c.sleep(60)
  assert.equal(await cursor(), 'move')
  await c.dragAt(px, py, px, py - 20 * mk, { steps: 8 })
  assert.ok(near((await mask()).points[0].y, pts[0].y - 20, 2))
  assert.equal(await depth(), d1 + 3)
  // Alt + click takes a point off; a right click too; three always stay.
  pts = (await mask()).points
  await c.clickAt(...M(pts[1].x, pts[1].y), { mods: ['alt'] })
  assert.equal((await mask()).points.length, 5, 'Alt + click: the point is gone')
  assert.equal(await depth(), d1 + 4)
  pts = (await mask()).points
  await c.clickAt(...M(pts[0].x, pts[0].y), { button: 'right' })
  assert.equal((await mask()).points.length, 4, 'a right click: gone too')
  pts = (await mask()).points
  await c.clickAt(...M(pts[0].x, pts[0].y), { mods: ['alt'] })
  assert.equal((await mask()).points.length, 3)
  pts = (await mask()).points
  await c.clickAt(...M(pts[0].x, pts[0].y), { mods: ['alt'] })
  assert.equal((await mask()).points.length, 3, 'three points stay')
  await undoAll(d1)
  assert.equal((await mask()).points.length, 4, 'undone: the diamond')
  await c.st((s) => s.setMaskOverlay('auto'))
  console.log('    mask: corners grow from the held corner, soft-edge handle, hidden outline takes no press, pen points put / dragged / taken off; one undo step each')
}
