// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// Cila A: editing a picture in the preview with the pointer and the keys.
// A press that does not leave its place moves nothing (4 px); a drag is one
// undo step and writes the project once per frame however fast the pointer
// reports; Shift locks the axis, the frame's middle still catches; a corner
// sizes from the opposite corner, with Alt from the middle; the knob turns
// (right angles catch, Shift steps by 15°); Esc takes a drag back with no
// undo step; the arrow keys nudge (one step for a run); the cursor lies
// along the pull; the handles take a press 16 px round them; the safe-area
// frames are a choice in the guide menu.
export const name = 'preview-feel'

export async function run({ c, app, media, lib }) {
  const { assert } = lib
  const [a, b] = await lib.seedAssets(app, c, [media.numbered[0], media.numbered[1]])
  await c.run((top, under) => {
    const S = window.__store
    const p = structuredClone(S.getState().project)
    p.settings = { width: 1920, height: 1080, fps: 30 }
    p.snap = { enabled: true, distance: 12, snapEdges: true, snapCenters: true }
    p.tracks = [{ id: 'V2', kind: 'video', name: 'V2', clipIds: ['pic'] }, { id: 'V1', kind: 'video', name: 'V1', clipIds: ['bg'] }, { id: 'A1', kind: 'audio', name: 'A1', clipIds: [] }]
    p.clips = {
      // 640 × 360 media: the picture is 960 × 540 in the frame's middle.
      pic: { id: 'pic', assetId: top, trackId: 'V2', start: 0, inPoint: 0, duration: 6, volume: 1, transform: { x: 960, y: 540, scale: 1.5, rotation: 0 } },
      bg: { id: 'bg', assetId: under, trackId: 'V1', start: 0, inPoint: 0, duration: 6, volume: 1, transform: { x: 960, y: 540, scale: 3, rotation: 0 } }
    }
    p.captions = []
    S.getState().loadProject(p)
    S.setState({ selectedClipIds: [], playing: false })
    S.getState().setTime(1)
    S.getState().setPreviewView({ zoom: 1, x: 0, y: 0 })
    // The project's writes per animation frame, from here on.
    const W = (window.__pvWrites = { max: 0, total: 0 })
    let cur = 0
    S.subscribe((s, prev) => { if (s.project !== prev.project) cur++ })
    const loop = () => { W.max = Math.max(W.max, cur); W.total += cur; cur = 0; requestAnimationFrame(loop) }
    requestAnimationFrame(loop)
  }, a.id, b.id)
  await c.sleep(400)

  const view = () => c.run(() => {
    const el = document.querySelector('[data-testid="preview.canvas"]')
    const r = el.getBoundingClientRect()
    const s = window.__store.getState()
    const { width, height } = s.project.settings
    return { left: r.left, top: r.top, w: el.clientWidth, h: el.clientHeight, k: Math.min(el.clientWidth / width, el.clientHeight / height) * s.previewView.zoom, W: width, H: height }
  })
  const v = await view()
  const P = (x, y) => [v.left + v.w / 2 + (x - v.W / 2) * v.k, v.top + v.h / 2 + (y - v.H / 2) * v.k]
  const tr = () => c.st((s) => s.project.clips.pic.transform)
  const depth = () => lib.undoDepth(c)
  const cursor = () => c.ev(`document.querySelector('[data-testid="preview.canvas"]').style.cursor`)
  // Undo leaves nothing selected (the store's rule): the picture is picked again.
  const undoAll = async (to) => {
    for (let i = 0; i < 8 && (await depth()) > to; i++) await c.st((s) => s.undo())
    await c.run(() => window.__store.setState({ selectedClipIds: ['pic'] }))
    await c.sleep(60)
  }
  const near = (x, y, eps) => Math.abs(x - y) <= eps
  const px = 1.5 / v.k // a screen pixel and a half, in frame pixels
  const d0 = await depth()

  // 1. The threshold: a press that moves 2 px is a click (it selects, moves nothing).
  let [x, y] = P(1060, 590)
  await c.mouse('mouseMoved', x, y)
  await c.mouse('mousePressed', x, y)
  await c.mouse('mouseMoved', x + 2, y + 2, { down: true })
  await c.sleep(60)
  assert.deepEqual(await tr(), { x: 960, y: 540, scale: 1.5, rotation: 0 }, 'a 2 px move is not a drag')
  await c.mouse('mouseReleased', x + 2, y + 2)
  await c.sleep(60)
  assert.equal(await depth(), d0, 'a click leaves no undo step')
  assert.deepEqual(await c.st((s) => s.selectedClipIds), ['pic'], 'the click selected the picture')
  assert.equal(await cursor(), 'grab', 'over the picture: the hand')

  // 2. A move: the picture follows the pointer one to one, one undo step,
  //    and one write per frame with a move every 4 ms.
  await c.ev('window.__pvWrites.max = 0, window.__pvWrites.total = 0')
  await c.mouse('mouseMoved', x, y)
  await c.mouse('mousePressed', x, y)
  for (let i = 1; i <= 60; i++) {
    await c.mouse('mouseMoved', x + (200 * v.k * i) / 60, y + (120 * v.k * i) / 60, { down: true })
    await c.sleep(4)
  }
  await c.mouse('mouseReleased', x + 200 * v.k, y + 120 * v.k)
  await c.sleep(120)
  let t = await tr()
  assert.ok(near(t.x, 1160, px) && near(t.y, 660, px), `moved by (200, 120): ${JSON.stringify(t)}`)
  assert.equal(await depth(), d0 + 1, 'the drag is one undo step')
  const writes = await c.ev('window.__pvWrites')
  assert.ok(writes.total >= 10, `the project followed the drag (${writes.total} writes)`)
  assert.ok(writes.max <= 1, `at most one write of the project per frame (${writes.max})`)
  await undoAll(d0)
  assert.deepEqual(await tr(), { x: 960, y: 540, scale: 1.5, rotation: 0 }, 'undo: where it was')

  // 3. Snapping still catches: 8 px sideways from the frame's middle stays on it.
  await c.dragAt(x, y, x + 8, y + 120 * v.k, { steps: 10 })
  t = await tr()
  assert.equal(t.x, 960, `the frame's middle caught the picture (${t.x})`)
  assert.ok(near(t.y, 660, px), `down by 120 (${t.y})`)
  await undoAll(d0)

  // 4. Shift locks the axis (and lets the snap go).
  await c.dragAt(x, y, x + 200 * v.k, y + 30 * v.k, { steps: 10, mods: ['shift'] })
  t = await tr()
  assert.equal(t.y, 540, 'Shift: straight sideways')
  assert.ok(near(t.x, 1160, px), `by 200 (${t.x})`)
  assert.equal(await depth(), d0 + 1)
  await undoAll(d0)

  // 5. The corner: the opposite corner stays.
  let [cx, cy] = P(960 + 480, 540 + 270)
  await c.mouse('mouseMoved', cx, cy)
  await c.sleep(60)
  assert.equal(await cursor(), 'nwse-resize', 'the bottom right corner: the arrow along its diagonal')
  // 14 px out of the corner still takes the press (16 px reach); 22 px does not.
  await c.mouse('mouseMoved', cx + 14, cy + 14)
  await c.sleep(60)
  assert.equal(await cursor(), 'nwse-resize', '14 px from the handle is on it')
  await c.mouse('mouseMoved', cx + 22, cy + 22)
  await c.sleep(60)
  assert.notEqual(await cursor(), 'nwse-resize', '22 px from the handle is off it')
  await c.ev('window.__pvWrites.max = 0, window.__pvWrites.total = 0')
  await c.dragAt(cx, cy, cx + 96 * v.k, cy + 54 * v.k, { steps: 12 })
  t = await tr()
  assert.ok(near(t.scale, 1.65, 0.01), `a tenth larger (${t.scale})`)
  assert.ok(near(t.x - 320 * t.scale, 480, 2 * px) && near(t.y - 180 * t.scale, 270, 2 * px), `the top left corner stayed (${JSON.stringify(t)})`)
  assert.equal(await depth(), d0 + 1, 'the pull is one undo step')
  assert.ok((await c.ev('window.__pvWrites.max')) <= 1, 'x, y and scale are one write')
  await undoAll(d0)

  // 6. Alt: from the middle, which stays.
  await c.dragAt(cx, cy, cx + 96 * v.k, cy + 54 * v.k, { steps: 12, mods: ['alt'] })
  t = await tr()
  assert.ok(near(t.scale, 1.8, 0.012), `a fifth larger (${t.scale})`)
  assert.deepEqual([t.x, t.y], [960, 540], 'the middle stayed')
  await undoAll(d0)

  // 7. Alt on the picture itself moves nothing (it was the preview's pan) and says where the pan went.
  await c.dragAt(x, y, x + 120, y + 40, { steps: 8, mods: ['alt'] })
  assert.deepEqual(await tr(), { x: 960, y: 540, scale: 1.5, rotation: 0 }, 'Alt + drag moves no picture')
  assert.deepEqual(await c.st((s) => s.previewView), { zoom: 1, x: 0, y: 0 }, 'nor the preview')
  assert.equal(await depth(), d0)
  await c.waitFor('the note about the pan', () => c.ev(`!!document.querySelector('[data-testid^="toast."][role="status"]')`))

  // 8. The knob: a quarter turn catches the right angle; Shift steps by 15°.
  const [mx, my] = P(960, 540)
  const r0 = 270 * v.k + 26
  await c.mouse('mouseMoved', mx, my - r0)
  await c.sleep(60)
  assert.match(await cursor(), /^url\(/, 'on the knob: the turn cursor')
  const turn = async (deg, o = {}) => {
    await c.mouse('mouseMoved', mx, my - r0, o)
    await c.mouse('mousePressed', mx, my - r0, o)
    const steps = 12
    for (let i = 1; i <= steps; i++) {
      const ang = -Math.PI / 2 + ((deg * Math.PI) / 180) * (i / steps)
      await c.mouse('mouseMoved', mx + Math.cos(ang) * r0, my + Math.sin(ang) * r0, { ...o, down: true })
      await c.sleep(16)
    }
    const ang = -Math.PI / 2 + (deg * Math.PI) / 180
    await c.mouse('mouseReleased', mx + Math.cos(ang) * r0, my + Math.sin(ang) * r0, o)
    await c.sleep(100)
  }
  await turn(88)
  t = await tr()
  assert.ok(near(t.rotation, Math.PI / 2, 1e-9), `88° caught by the right angle (${t.rotation})`)
  assert.equal(await depth(), d0 + 1)
  // Turned a quarter: the corner that is now bottom right pulls along the same diagonal.
  await undoAll(d0)
  await turn(37, { mods: ['shift'] })
  t = await tr()
  assert.ok(near(t.rotation, (30 * Math.PI) / 180, 1e-9) || near(t.rotation, (45 * Math.PI) / 180, 1e-9), `Shift: a step of 15° (${(t.rotation * 180) / Math.PI})`)
  await undoAll(d0)
  // A picture turned 45°: its bottom right corner now points straight down.
  await c.st((s) => s.setPropValue('pic', 'rotation', Math.PI / 4))
  await c.sleep(80)
  const diag = Math.hypot(480, 270)
  const down = Math.atan2(270, 480) + Math.PI / 4
  const [tx, ty] = P(960 + Math.cos(down) * diag, 540 + Math.sin(down) * diag)
  await c.mouse('mouseMoved', tx, ty)
  await c.sleep(60)
  const turned = await cursor()
  assert.ok(turned === 'ns-resize' || turned === 'nesw-resize', `the cursor turned with the picture (${turned})`)
  await c.st((s) => s.undo())
  await c.sleep(60)
  const d1 = await depth()

  // 9. Esc takes a drag back: no undo step, the redo steps as they were.
  await c.st((s) => { s.setClipVolume('bg', 0.5); s.undo() })
  const redo0 = await c.st((s) => s.future.length)
  assert.equal(redo0 >= 1, true)
  await c.mouse('mouseMoved', x, y)
  await c.mouse('mousePressed', x, y)
  for (let i = 1; i <= 8; i++) { await c.mouse('mouseMoved', x + i * 15, y + i * 6, { down: true }); await c.sleep(16) }
  await c.sleep(60)
  assert.notEqual((await tr()).x, 960, 'the picture is being dragged')
  await c.key('Escape')
  assert.deepEqual(await tr(), { x: 960, y: 540, scale: 1.5, rotation: 0 }, 'Esc: back where it was')
  assert.equal(await depth(), d1, 'no undo step')
  assert.equal(await c.st((s) => s.future.length), redo0, 'the redo steps are as they were')
  assert.deepEqual(await c.st((s) => s.selectedClipIds), ['pic'], 'the picture is still picked')
  await c.mouse('mouseMoved', x + 160, y + 60, { down: true })
  await c.mouse('mouseReleased', x + 160, y + 60)
  await c.sleep(80)
  assert.deepEqual(await tr(), { x: 960, y: 540, scale: 1.5, rotation: 0 }, 'the rest of the cancelled drag moves nothing')
  assert.equal(await depth(), d1)

  // 10. The arrow keys nudge the selection while the preview has the focus:
  //     1 px, with Shift 10 px, a run of presses one undo step.
  await c.clickAt(x, y)
  assert.deepEqual(await c.st((s) => s.selectedClipIds), ['pic'])
  const time0 = await c.st((s) => s.currentTime)
  await c.key('ArrowRight')
  await c.key('ArrowRight')
  await c.key('ArrowRight')
  await c.key('ArrowDown')
  await c.key('ArrowLeft', ['shift'])
  t = await tr()
  assert.deepEqual([t.x, t.y], [953, 541], `3 right, 1 down, 10 left (${JSON.stringify(t)})`)
  assert.equal(await c.st((s) => s.currentTime), time0, 'the playhead stayed')
  assert.equal(await depth(), d1 + 1, 'the run of presses is one undo step')
  await c.key('z', ['ctrl'])
  assert.deepEqual(await tr(), { x: 960, y: 540, scale: 1.5, rotation: 0 }, 'one Ctrl+Z takes the run back')
  // With nothing selected in the preview the arrows step the playhead as before.
  await c.st((s) => s.selectClip(null))
  await c.key('ArrowRight')
  assert.ok((await c.st((s) => s.currentTime)) > time0, 'no selection: the arrow steps a frame')
  await c.st((s, tm) => s.setTime(tm), time0)

  // 10b. The view's pan: the middle button, and Space held over a zoomed
  //      preview (Alt was the pan before). Neither moves the picture; a tap
  //      of Space there still plays, on its release.
  await c.st((s) => { s.selectClip(null); s.setPreviewView({ zoom: 2, x: 0, y: 0 }) })
  await c.sleep(120)
  const d2 = await depth()
  const [qx, qy] = [v.left + v.w / 2, v.top + v.h / 2]
  // (By hand: cdp.mjs's helper gives a held button the left one's bit.)
  const M = (type, x, y, buttons) => c.send('Input.dispatchMouseEvent', { type, x, y, button: type === 'mouseMoved' && !buttons ? 'none' : 'middle', buttons, clickCount: type === 'mouseMoved' ? 0 : 1, pointerType: 'mouse' })
  await M('mouseMoved', qx, qy, 0)
  await M('mousePressed', qx, qy, 4)
  for (let i = 1; i <= 6; i++) { await M('mouseMoved', qx + i * 10, qy + i * 5, 4); await c.sleep(16) }
  await M('mouseReleased', qx + 60, qy + 30, 0)
  await c.sleep(100)
  let pv = await c.st((s) => s.previewView)
  assert.ok(pv.zoom === 2 && (pv.x !== 0 || pv.y !== 0), `the middle button moved the view (${JSON.stringify(pv)})`)
  assert.deepEqual(await tr(), { x: 960, y: 540, scale: 1.5, rotation: 0 }, 'and not the picture')
  const space = (type) => c.send('Input.dispatchKeyEvent', { type, key: ' ', code: 'Space', windowsVirtualKeyCode: 32, ...(type === 'keyDown' ? { text: ' ' } : {}) })
  const pv0 = pv
  await c.mouse('mouseMoved', qx, qy)
  await space('keyDown')
  await c.sleep(60)
  assert.equal(await cursor(), 'grab', 'Space held over a zoomed preview: the hand')
  await c.dragAt(qx, qy, qx - 80, qy - 20, { steps: 6 })
  await space('keyUp')
  await c.sleep(80)
  pv = await c.st((s) => s.previewView)
  assert.ok(pv.x !== pv0.x || pv.y !== pv0.y, `Space + drag moved the view (${JSON.stringify(pv)})`)
  assert.deepEqual(await tr(), { x: 960, y: 540, scale: 1.5, rotation: 0 }, 'and not the picture')
  assert.equal(await c.st((s) => s.playing), false, 'a Space that dragged does not play')
  assert.equal(await depth(), d2, 'a view move is no edit')
  await space('keyDown')
  await c.sleep(40)
  assert.equal(await c.st((s) => s.playing), false, 'a tap plays on its release, not on the press')
  await space('keyUp')
  await c.sleep(80)
  assert.equal(await c.st((s) => s.playing), true, 'a tap of Space over the zoomed preview still plays')
  await c.st((s, tm) => { s.setPlaying(false); s.setTime(tm); s.setPreviewView({ zoom: 1, x: 0, y: 0 }) }, time0)
  await c.sleep(120)

  // 11. The safe areas: a choice beside the guides; two frames on the picture.
  const lum = (fx, fy) => c.run((fx, fy) => {
    const cv = document.querySelector('[data-testid="preview.canvas"]')
    const s = window.__store.getState()
    const { width, height } = s.project.settings
    const dpr = window.devicePixelRatio || 1
    const k = Math.min(cv.clientWidth / width, cv.clientHeight / height)
    const dw = width * k, dh = height * k
    const dx = (cv.clientWidth - dw) / 2, dy = (cv.clientHeight - dh) / 2
    // The brightest pixel of a 5 × 5 patch round the point (the line is 1 px).
    const d = cv.getContext('2d').getImageData(Math.round((dx + dw * fx) * dpr) - 2, Math.round((dy + dh * fy) * dpr) - 2, 5, 5).data
    let m = 0
    for (let i = 0; i < d.length; i += 4) m = Math.max(m, d[i] + d[i + 1] + d[i + 2])
    return m
  }, fx, fy)
  const before5 = await lum(0.3, 0.05)
  const before10 = await lum(0.3, 0.1)
  await c.click('preview.more')
  assert.equal(await c.attr('preview.safe-areas', 'aria-pressed'), 'false')
  await c.click('preview.safe-areas')
  await c.sleep(150)
  await c.click('preview.more')
  assert.equal(await c.attr('preview.safe-areas', 'aria-pressed'), 'true', 'the safe areas are on')
  assert.ok((await lum(0.3, 0.05)) > before5 + 30, 'a line 5 % in from the top')
  assert.ok((await lum(0.3, 0.1)) > before10 + 20, 'a line 10 % in from the top')
  await c.click('preview.safe-areas')
  await c.sleep(150)
  assert.ok(Math.abs((await lum(0.3, 0.05)) - before5) <= 6, 'off again: the picture as it was')

  // The picture is never a draft at rest.
  assert.equal(await c.attr('preview.canvas', 'data-draft'), '1')
  console.log(`    4 px threshold; a move, a corner pull, a turn: one undo step each, ≤ ${writes.max} write per frame (${writes.total} in the move); Alt from the middle; Esc takes a drag back; arrows nudge; safe areas`)
}
