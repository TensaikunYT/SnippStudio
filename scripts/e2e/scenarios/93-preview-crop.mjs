// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// Cila A: the crop mode. The toolbar's Crop button puts handles on the
// selected clip's crop box in the preview: a side handle moves its side (the
// opposite side stays), Shift keeps the box's shape, Alt works from the
// middle, a drag inside slides the window, Esc takes a drag back and then
// leaves the mode. The value is the Inspector's own field (Clip.crop), and a
// drag is one undo step.
export const name = 'preview-crop'

export async function run({ c, app, media, lib }) {
  const { assert } = lib
  const [a] = await lib.seedAssets(app, c, [media.numbered[0]])
  await c.run((id) => {
    const S = window.__store
    const p = structuredClone(S.getState().project)
    p.settings = { width: 1920, height: 1080, fps: 30 }
    p.tracks = [{ id: 'V1', kind: 'video', name: 'V1', clipIds: ['pic'] }, { id: 'A1', kind: 'audio', name: 'A1', clipIds: [] }]
    // 640 × 360 media at 1.5: 960 × 540 in the frame's middle.
    p.clips = { pic: { id: 'pic', assetId: id, trackId: 'V1', start: 0, inPoint: 0, duration: 6, volume: 1, transform: { x: 960, y: 540, scale: 1.5, rotation: 0 } } }
    p.captions = []
    S.getState().loadProject(p)
    S.setState({ selectedClipIds: [], playing: false })
    S.getState().setTime(1)
    S.getState().setPreviewView({ zoom: 1, x: 0, y: 0 })
  }, a.id)
  await c.sleep(300)
  const v = await c.run(() => {
    const el = document.querySelector('[data-testid="preview.canvas"]')
    const r = el.getBoundingClientRect()
    return { left: r.left, top: r.top, w: el.clientWidth, h: el.clientHeight, k: Math.min(el.clientWidth / 1920, el.clientHeight / 1080) }
  })
  const P = (x, y) => [v.left + v.w / 2 + (x - 960) * v.k, v.top + v.h / 2 + (y - 540) * v.k]
  const crop = () => c.st((s) => s.project.clips.pic.crop ?? null)
  const depth = () => lib.undoDepth(c)
  const cursor = () => c.ev(`document.querySelector('[data-testid="preview.canvas"]').style.cursor`)
  const near = (x, y, eps = 0.012) => Math.abs(x - y) <= eps
  // Undo keeps the picture selected (the user's rule since DENEME-3, worker V:
  // Ctrl+Z does not drop the selection), so the crop mode stays on. This
  // scenario still said the older rule ("undo leaves nothing selected, the
  // mode ends") and was red from then on; 22 Nov.
  const undoAll = async (to) => {
    for (let i = 0; i < 8 && (await depth()) > to; i++) await c.st((s) => s.undo())
    await c.sleep(60)
    assert.deepEqual(await c.st((s) => s.selectedClipIds), ['pic'], 'the picture is still selected after undo')
    assert.equal(await c.attr('preview.crop-mode', 'aria-pressed'), 'true', 'still selected after undo: the crop mode stays')
  }

  // With nothing selected the button waits.
  assert.equal(await c.ev(`document.querySelector('[data-testid="preview.crop-mode"]').disabled`), true, 'no clip: nothing to crop')
  await c.clickAt(...P(960, 540))
  assert.deepEqual(await c.st((s) => s.selectedClipIds), ['pic'])
  await c.click('preview.crop-mode')
  assert.equal(await c.attr('preview.crop-mode', 'aria-pressed'), 'true', 'the crop mode is on')
  const d0 = await depth()

  // The right side in by 96 frame px: a tenth of the picture's 960.
  const [ex, ey] = P(960 + 480, 540)
  await c.mouse('mouseMoved', ex, ey)
  await c.sleep(60)
  assert.equal(await cursor(), 'ew-resize', 'on the side handle: the sideways arrow')
  await c.dragAt(ex, ey, ex - 96 * v.k, ey, { steps: 10 })
  let k = await crop()
  assert.ok(k && near(k.r, 0.1) && k.l === 0 && k.t === 0 && k.b === 0, `10 % off the right (${JSON.stringify(k)})`)
  assert.equal(await depth(), d0 + 1, 'the pull is one undo step')
  assert.deepEqual(await c.st((s) => s.project.clips.pic.transform), { x: 960, y: 540, scale: 1.5, rotation: 0 }, 'the picture itself did not move')

  // The top left corner, down and in: two sides, the others stay.
  const [nx, ny] = P(960 - 480, 540 - 270)
  await c.dragAt(nx, ny, nx + 96 * v.k, ny + 54 * v.k, { steps: 10 })
  k = await crop()
  assert.ok(near(k.l, 0.1) && near(k.t, 0.1) && near(k.r, 0.1) && k.b === 0, `the corner took the left and the top (${JSON.stringify(k)})`)
  assert.equal(await depth(), d0 + 2)

  // Inside the box: the window slides, its size stays.
  await c.dragAt(...P(960, 560), ...P(960 + 48, 560), { steps: 8 })
  const s1 = await crop()
  assert.ok(near(s1.l, 0.15) && near(s1.r, 0.05), `slid right by a twentieth (${JSON.stringify(s1)})`)
  assert.ok(near(s1.l + s1.r, k.l + k.r, 0.004) && near(s1.t, k.t, 0.004) && near(s1.b, k.b, 0.004), 'the same size')
  await undoAll(d0)
  assert.equal(await crop(), null, 'undo: no crop')

  // Shift keeps the box's shape (16 : 9 here): the bottom right corner in.
  const [sx, sy] = P(960 + 480, 540 + 270)
  await c.dragAt(sx, sy, sx - 192 * v.k, sy - 60 * v.k, { steps: 10, mods: ['shift'] })
  k = await crop()
  const shape = (1 - k.l - k.r) / (1 - k.t - k.b)
  assert.ok(near(shape, 1, 0.02), `the crop kept the picture's shape (${JSON.stringify(k)})`)
  assert.ok(k.r > 0.05 && k.b > 0.05 && k.l === 0 && k.t === 0)
  await undoAll(d0)

  // Alt: both sides alike.
  await c.dragAt(ex, ey, ex - 96 * v.k, ey, { steps: 10, mods: ['alt'] })
  k = await crop()
  assert.ok(near(k.l, 0.1) && near(k.r, 0.1), `Alt: the left side came in with the right (${JSON.stringify(k)})`)
  await undoAll(d0)

  // A side never gives up more than 45 % (the Inspector's range).
  await c.dragAt(ex, ey, ex - 800 * v.k, ey, { steps: 10 })
  assert.equal((await crop()).r, 0.45)
  await undoAll(d0)

  // Esc takes the drag back; Esc again leaves the mode.
  await c.mouse('mouseMoved', ex, ey)
  await c.mouse('mousePressed', ex, ey)
  for (let i = 1; i <= 6; i++) { await c.mouse('mouseMoved', ex - i * 12, ey, { down: true }); await c.sleep(16) }
  await c.sleep(60)
  assert.ok((await crop())?.r > 0, 'the side is being pulled')
  await c.key('Escape')
  assert.equal(await crop(), null, 'Esc: no crop')
  assert.equal(await depth(), d0, 'and no undo step')
  await c.mouse('mouseReleased', ex - 72, ey)
  assert.equal(await c.attr('preview.crop-mode', 'aria-pressed'), 'true', 'the mode is still on after the cancelled drag')
  await c.key('Escape')
  assert.equal(await c.attr('preview.crop-mode', 'aria-pressed'), 'false', 'Esc leaves the crop mode')
  // Out of the mode the corner sizes the picture again.
  await c.mouse('mouseMoved', sx, sy)
  await c.sleep(60)
  assert.equal(await cursor(), 'nwse-resize')
  console.log('    crop mode: a side, a corner, a slide, Shift (shape kept), Alt (both sides), 45 % limit, Esc; one undo step per pull')
}
