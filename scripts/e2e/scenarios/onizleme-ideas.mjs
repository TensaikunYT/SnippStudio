// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// VideoHub's review page's ideas in the preview (ONIZLEME-UYGULA-PLAN.md):
// the clock typed into (G), the play speed and its sound ([ ]), the frame step
// held down, the zoom (Ctrl + wheel under the pointer, 1, 0, Space + drag),
// , and . from note to note and the merged note mark, the click-and-type
// note, the review's B / Y and "still there", the three comparisons (and
// what they cost), the narration line (Shift+C) and the shortcut list (?).
export const name = 'onizleme-ideas'
export const timeoutMs = 240000

export async function run({ c, app, media, lib }) {
  const { assert } = lib
  const [talk, other] = await lib.seedAssets(app, c, [media.talk, media.other])
  await lib.seedTimeline(c, [talk.id])
  const fps = await c.st((s) => s.project.settings.fps)
  const time = () => c.st((s) => s.currentTime)
  const press = (key, code, vk, extra = {}) => c.send('Input.dispatchKeyEvent', { type: 'keyDown', key, code, windowsVirtualKeyCode: vk, ...extra })
  const release = (key, code, vk) => c.send('Input.dispatchKeyEvent', { type: 'keyUp', key, code, windowsVirtualKeyCode: vk })
  // The canvas's mean colour in a part of it (fractions of the canvas).
  const mean = (x0, y0, x1, y1) =>
    c.run((x0, y0, x1, y1) => {
      const cv = document.querySelector('[data-testid="preview.canvas"]')
      const w = cv.width, h = cv.height
      const d = cv.getContext('2d').getImageData(Math.round(w * x0), Math.round(h * y0), Math.max(1, Math.round(w * (x1 - x0))), Math.max(1, Math.round(h * (y1 - y0)))).data
      let r = 0, g = 0, b = 0
      for (let i = 0; i < d.length; i += 4) { r += d[i]; g += d[i + 1]; b += d[i + 2] }
      const n = d.length / 4
      return [r / n, g / n, b / n]
    }, x0, y0, x1, y1)
  const dist = (a, b) => Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2])

  // ---- 4. The clock: a click (or G) makes it a field; k45, +2, nonsense, Esc.
  await lib.seek(c, 1)
  await c.click('transport.time')
  await c.waitId('transport.time.field')
  await c.key('a', ['ctrl'])
  await c.type('k45')
  await c.key('Enter')
  assert.ok(lib.near(await time(), 45 / fps, 1e-6), `k45 is frame 45 (${await time()})`)
  await c.waitGone('transport.time.field')
  await c.key('g')
  await c.waitId('transport.time.field')
  assert.equal(await lib.focused(c), 'transport.time.field', 'G puts the caret in the clock')
  await c.key('a', ['ctrl'])
  await c.type('+2')
  await c.key('Enter')
  assert.ok(lib.near(await time(), 45 / fps + 2, 1 / fps), `+2 goes two seconds on (${await time()})`)
  await c.key('g')
  await c.key('a', ['ctrl'])
  await c.type('0:01,5')
  await c.key('Enter')
  assert.ok(lib.near(await time(), 1.5, 1 / fps), `0:01,5 with a Turkish comma (${await time()})`)
  await c.key('g')
  await c.key('a', ['ctrl'])
  await c.type('abc')
  await c.key('Enter')
  assert.equal(await c.attr('transport.time.field', 'aria-invalid'), 'true', 'nonsense: the field says so')
  assert.ok(lib.near(await time(), 1.5, 1e-6), 'and the playhead stays')
  await c.key('Escape')
  await c.waitGone('transport.time.field')

  // ---- 5. The frame step on the grid, held down; Shift+→ still a second.
  await c.st((s) => s.setTime(1.01))
  await c.key('ArrowRight')
  assert.ok(lib.near(await time(), 31 / fps, 1e-9) || fps !== 30, 'a step lands on the frame grid')
  const f0 = Math.round((await time()) * fps)
  await press('ArrowRight', 'ArrowRight', 39)
  for (let i = 0; i < 5; i++) await press('ArrowRight', 'ArrowRight', 39, { autoRepeat: true })
  await release('ArrowRight', 'ArrowRight', 39)
  await c.sleep(60)
  assert.equal(Math.round((await time()) * fps), f0 + 6, 'held: one frame per repeat')
  const t1 = await time()
  await c.key('ArrowRight', ['shift'])
  assert.ok(lib.near(await time(), t1 + 1, 1e-6), 'Shift+→ is a second, as before')

  // ---- 5. Speed: ] and [ step it; the clock and the element follow.
  await c.st((s) => s.setTime(1))
  await c.key(']')
  assert.equal(await c.value('transport.rate'), '1.5', '] → 1.5×')
  await c.key('[')
  await c.key('[')
  assert.equal(await c.value('transport.rate'), '0.75', '[ [ → 0.75×')
  await c.select('transport.rate', '2')
  await c.sleep(80)
  const playFor = async (ms) => {
    const a = await time()
    await c.click('transport.play')
    await c.waitFor('rolling', async () => (await time()) > a + 0.05, 8000, 20)
    const b = await time()
    const w0 = Date.now()
    await c.sleep(ms)
    const e = await time()
    const wall = (Date.now() - w0) / 1000
    const rate = await c.run(() => { const el = [...window.__engine.videos.values()][0]; return el ? { rate: el.playbackRate, pitch: el.preservesPitch, muted: el.muted } : null })
    await c.click('transport.play')
    return { pace: (e - b) / wall, el: rate }
  }
  const fast = await playFor(1200)
  assert.ok(fast.pace > 1.6 && fast.pace < 2.4, `2× plays twice as fast (${fast.pace.toFixed(2)})`)
  assert.ok(fast.el && Math.abs(fast.el.rate - 2) < 0.01, `the element at 2× (${JSON.stringify(fast.el)})`)
  assert.equal(fast.el.pitch, true, 'its pitch kept (the clip\'s own rule)')
  assert.equal(fast.el.muted, false, 'and its sound on')
  await c.select('transport.rate', '0.5')
  await c.st((s) => s.setTime(1))
  const slow = await playFor(1200)
  assert.ok(slow.pace > 0.35 && slow.pace < 0.65, `0.5× plays half as fast (${slow.pace.toFixed(2)})`)
  assert.ok(Math.abs(slow.el.rate - 0.5) < 0.01, 'the element at 0.5×')
  await c.select('transport.rate', '1')
  const proj = await c.st((s) => JSON.stringify(s.project))
  assert.ok(!proj.includes('playRate'), 'the speed is not in the project')

  // ---- 6. Zoom: Ctrl + wheel under the pointer, 1, 0, Space + drag.
  const cv = await c.box('preview.canvas')
  const px = cv.x + cv.w * 0.3
  const py = cv.y + cv.h * 0.4
  await c.mouse('mouseMoved', px, py)
  await c.send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: px, y: py, deltaX: 0, deltaY: -240, modifiers: 2, pointerType: 'mouse' })
  await c.sleep(100)
  let pv = await c.st((s) => s.previewView)
  assert.ok(pv.zoom > 1.2, `Ctrl + wheel zooms in (${pv.zoom})`)
  // The point under the pointer stayed: its world point before and after.
  const world = (v) => c.run((v, sx, sy) => {
    const s = window.__store.getState(); const cvs = document.querySelector('[data-testid="preview.canvas"]')
    const k = Math.min(cvs.clientWidth / s.project.settings.width, cvs.clientHeight / s.project.settings.height) * v.zoom
    return [(sx - cvs.clientWidth / 2 - v.x) / k, (sy - cvs.clientHeight / 2 - v.y) / k]
  }, v, px - cv.x, py - cv.y)
  const w0 = await world({ zoom: 1, x: 0, y: 0 })
  const w1 = await world(pv)
  assert.ok(Math.abs(w0[0] - w1[0]) < 1 && Math.abs(w0[1] - w1[1]) < 1, `the point under the pointer stays (${w0} → ${w1})`)
  await c.key('1')
  pv = await c.st((s) => s.previewView)
  const want = await c.run(() => { const s = window.__store.getState(); const cvs = document.querySelector('[data-testid="preview.canvas"]'); return 1 / (Math.min(cvs.clientWidth / s.project.settings.width, cvs.clientHeight / s.project.settings.height) * (window.devicePixelRatio || 1)) })
  assert.ok(Math.abs(pv.zoom - Math.min(16, want)) < 1e-6, `1: one pixel per pixel (${pv.zoom} vs ${want})`)
  const space = (type) => c.send('Input.dispatchKeyEvent', { type, key: ' ', code: 'Space', windowsVirtualKeyCode: 32, ...(type === 'keyDown' ? { text: ' ' } : {}) })
  const pvA = pv
  await c.mouse('mouseMoved', cv.cx, cv.cy)
  await space('keyDown')
  await c.dragAt(cv.cx, cv.cy, cv.cx - 60, cv.cy - 30, { steps: 6 })
  await space('keyUp')
  await c.sleep(80)
  pv = await c.st((s) => s.previewView)
  assert.ok(pv.x !== pvA.x || pv.y !== pvA.y, 'Space + drag moves the zoomed view')
  assert.equal(await c.st((s) => s.playing), false, 'and does not play')
  await c.key('0')
  assert.deepEqual(await c.st((s) => s.previewView), { zoom: 1, x: 0, y: 0 }, '0 fits')

  // ---- 7. , and . from note to note; close notes merge on the lane.
  const addNote = (start, text) => c.run((start, text) => {
    const s = window.__store.getState()
    s.startNoteDraft({ start, end: start })
    window.__store.getState().patchNoteDraft({ text })
    return window.__store.getState().saveNoteDraft()
  }, start, text)
  const n1 = await addNote(2, 'one')
  const n2 = await addNote(2.02, 'two')
  const n3 = await addNote(6, 'three')
  await c.st((s) => { s.selectNote(null); s.setTime(0) })
  await c.key('.')
  assert.equal(await c.st((s) => s.noteSel), n1, '. → the first note')
  await c.key('.')
  assert.equal(await c.st((s) => s.noteSel), n2, '. → the one right after it')
  await c.key('.')
  assert.equal(await c.st((s) => s.noteSel), n3)
  await c.key(',')
  assert.equal(await c.st((s) => s.noteSel), n2, ', → back')
  // At 40 px a second, 2 s and 2.02 s are one mark with their count.
  await c.st((s) => { s.setPxPerSec?.(40); s.selectNote(null) })
  const pps = await c.st((s) => s.pxPerSec)
  if (pps * 0.02 < 14) {
    await c.waitId(`notes.lane.group.${n1}`)
    assert.equal(await c.attr(`notes.lane.group.${n1}`, 'data-count'), '2')
    await c.click(`notes.lane.group.${n1}`)
    assert.equal(await c.st((s) => s.noteSel), n1, 'a click on the mark: the first')
    await c.click(`notes.lane.group.${n1}`)
    assert.equal(await c.st((s) => s.noteSel), n2, 'again: the next')
  }

  // ---- 2. Click-and-type: the point tool, a click while playing.
  await c.st((s) => { s.selectNote(null); s.setTime(3) })
  await c.st((s) => s.setNoteTool('pin'))
  await c.click('transport.play')
  await c.waitFor('playing', () => c.st((s) => s.playing))
  const layer = await c.box('notes.draw.layer')
  await c.clickAt(layer.x + layer.w * 0.5, layer.y + layer.h * 0.5)
  await c.waitId('notes.quick.text')
  assert.equal(await c.st((s) => s.playing), false, 'the click stops the film')
  await c.waitFor('the box has the keyboard', async () => (await lib.focused(c)) === 'notes.quick.text', 3000)
  await c.type('The logo flickers here')
  await c.key('Enter')
  await c.waitGone('notes.quick')
  const quick = await c.waitFor('the note saved', () => c.st((s) => s.project.notes.find((n) => n.text === 'The logo flickers here') ?? null))
  assert.equal(quick.shapes[0].type, 'pin')
  assert.equal(await c.st((s) => s.playing), true, 'Enter plays on')
  await c.click('transport.play')
  // Space with nothing written: the note goes, the film carries on.
  const before = await c.st((s) => s.project.notes.length)
  await c.clickAt(layer.x + layer.w * 0.4, layer.y + layer.h * 0.4)
  await c.waitId('notes.quick.text')
  await c.waitFor('focused', async () => (await lib.focused(c)) === 'notes.quick.text', 3000)
  await press(' ', 'Space', 32, { text: ' ' })
  await release(' ', 'Space', 32)
  await c.waitGone('notes.quick')
  assert.equal(await c.st((s) => s.project.notes.length), before, 'nothing saved')
  assert.equal(await c.st((s) => !!s.noteDraft), false)
  assert.equal(await c.st((s) => s.playing), true, 'Space carries on')
  await c.click('transport.play')
  await c.st((s) => s.setNoteTool(null))

  // ---- 3. The review: B shows the saved frame, Y approves, "still there" asks.
  await c.waitFor('its picture', async () => (await c.st((s, id) => s.project.notes.find((n) => n.id === id)?.regionImage?.length ?? 0, quick.id)) > 1000, 15000)
  await c.run((ids) => window.__store.getState().editNotes((p) => { for (const id of ids) { const n = p.notes.find((x) => x.id === id); n.status = 'ready'; n.reply = 'Done.'; n.touched = [[n.start, n.start + 1]] } }, false), [quick.id, n3])
  await c.click('notes.review')
  await c.waitId('review.bar')
  const first = await c.st((s) => s.noteReview.ids[s.noteReview.index])
  if (first === quick.id) {
    await c.key('b')
    await c.waitId('review.before.image')
    assert.equal(await c.st((s) => s.splitToolMode), false, 'B in a review is not the split tool')
    await c.key('b')
    await c.waitGone('review.before.image')
  }
  await c.key('y')
  await c.waitFor('the first approved', async () => (await c.st((s, id) => s.project.notes.find((n) => n.id === id).status, first)) === 'approved')
  assert.equal(await c.st((s) => s.slipToolMode), false, 'Y in a review is not the slip tool')
  const second = await c.st((s) => s.noteReview?.ids[s.noteReview.index])
  if (second === quick.id) {
    await c.key('b')
    await c.waitId('review.before.image')
  }
  await c.click('review.still')
  await c.waitId('review.still.why')
  await c.type('still blurry')
  await c.key('Enter')
  const sent = await c.waitFor('sent back', () => c.st((s, id) => { const n = s.project.notes.find((x) => x.id === id); return n.status === 'still' ? n : null }, second))
  assert.match(sent.text, /still blurry/)
  await c.waitGone('review.bar')
  await c.waitGone('review.before.image')
  // Outside a review, B is the split tool again.
  await c.key('b')
  assert.equal(await c.st((s) => s.splitToolMode), true)
  await c.key('Escape')

  // ---- 1. The comparisons: before (the project) and after (a candidate).
  await c.st((s) => { s.setTime(1); s.selectClip(null) })
  await c.sleep(300)
  const off = await mean(0.1, 0.1, 0.9, 0.9)
  // The same project as candidate: the difference is black.
  await c.run(() => { const s = window.__store.getState(); window.__candidate.set(structuredClone(s.project), { show: true, baseVersion: s.projectVersion, epoch: s.versionEpoch }); window.__candidate.compare('diff') })
  await c.waitId('compare.layer')
  const black = await c.waitFor('no difference: black', async () => { const m = await mean(0.3, 0.3, 0.7, 0.7); return m[0] + m[1] + m[2] < 12 ? m : null }, 8000)
  assert.ok(black)
  // An after with a big other clip: the difference lights up.
  await c.run((otherId) => {
    const s = window.__store.getState()
    const p = structuredClone(s.project)
    p.tracks.unshift({ id: 'CV', kind: 'video', name: 'V2', clipIds: ['cand1'] })
    p.clips.cand1 = { id: 'cand1', assetId: otherId, trackId: 'CV', start: 0, inPoint: 0, duration: 6, transform: { x: 960, y: 540, scale: 3, rotation: 0 }, volume: 1 }
    window.__candidate.set(p, { baseVersion: s.projectVersion, epoch: s.versionEpoch })
  }, other.id)
  await c.waitFor('a difference', async () => { const m = await mean(0.3, 0.3, 0.7, 0.7); return m[0] + m[1] + m[2] > 30 ? m : null }, 8000)
  // Side by side: before on the left (the project as it is), after on the right.
  await c.run(() => window.__candidate.compare('side'))
  await c.waitFor('side by side', async () => (await c.attr('compare.layer', 'data-mode')) === 'side')
  await c.sleep(300)
  await c.waitId('compare.before')
  await c.waitId('compare.after')
  const left = await mean(0.1, 0.35, 0.4, 0.65)
  const right = await mean(0.6, 0.35, 0.9, 0.65)
  assert.ok(dist(left, right) > 20, `the two halves differ (${left} / ${right})`)
  // The wipe: before left of the line, after right of it; the line is
  // dragged. (The same patch, left of the frame's middle, against each alone.)
  const patch = () => mean(0.3, 0.4, 0.45, 0.6)
  await c.run(() => window.__candidate.show('live'))
  await c.sleep(400)
  const liveRef = await patch()
  await c.run(() => window.__candidate.show('candidate'))
  await c.sleep(400)
  const candRef = await patch()
  await c.run(() => { window.__candidate.setWipe(0.6); window.__candidate.compare('wipe') })
  await c.waitId('compare.wipe')
  await c.sleep(300)
  const wl = await patch()
  const wipe0 = await c.run(() => window.__candidate.get().wipe)
  await c.drag('compare.wipe', -(cv.w * 0.3), 0, { steps: 6 })
  await c.sleep(200)
  const wipe1 = await c.run(() => window.__candidate.get().wipe)
  assert.ok(wipe1 < wipe0 - 0.1, `the line follows the drag (${wipe0} → ${wipe1})`)
  const wl2 = await patch()
  assert.ok(dist(liveRef, candRef) > 20, `the two differ there (${liveRef} / ${candRef})`)
  assert.ok(dist(wl, liveRef) < 8, `left of the line: the before (${wl} / ${liveRef})`)
  assert.ok(dist(wl2, candRef) < 8, `the line dragged past it: the after (${wl2} / ${candRef})`)
  // What it costs: a draw's time while playing, off and each mode.
  const cost = async (mode) => {
    await c.run((m) => (m === 'off' ? window.__candidate.show('candidate') : window.__candidate.compare(m)), mode)
    await c.st((s) => s.setTime(1))
    await c.run(() => {
      const e = window.__engine
      const orig = e.onDraw
      window.__drawTimes = []
      window.__drawOrig = orig
      e.onDraw = (r) => { const t0 = performance.now(); orig(r); window.__drawTimes.push(performance.now() - t0) }
    })
    await c.click('transport.play')
    await c.sleep(2000)
    await c.click('transport.play')
    return c.run(() => {
      window.__engine.onDraw = window.__drawOrig
      const a = window.__drawTimes.slice(5).sort((x, y) => x - y)
      return { n: a.length, median: a[Math.floor(a.length / 2)] ?? 0, p90: a[Math.floor(a.length * 0.9)] ?? 0 }
    })
  }
  const costs = {}
  for (const m of ['off', 'side', 'wipe', 'diff']) costs[m] = await cost(m)
  console.log('compare draw ms (median / p90 / draws in 2 s):', JSON.stringify(costs))
  await c.run(() => window.__candidate.clear())
  await c.waitGone('compare.layer')
  await c.sleep(200)
  const back = await mean(0.1, 0.1, 0.9, 0.9)
  assert.ok(dist(back, off) < 30, 'the candidate gone: the project as it was')

  // ---- 8. The narration line (Shift+C): the subtitle at the playhead, under the film.
  await c.st((s) => s.setCaptions([{ id: 'n1', start: 0.5, end: 2.5, text: 'Hello from the narrator' }]))
  await c.st((s) => s.setTime(1))
  const was = await c.has('preview.narration')
  if (was) await c.key('c', ['shift'])
  await c.key('c', ['shift'])
  await c.waitId('preview.narration')
  assert.match(await c.run(() => document.querySelector('[data-testid="preview.narration"]').textContent), /Hello from the narrator/)
  const nb = await c.box('preview.narration')
  const cb = await c.box('preview.canvas')
  assert.ok(nb.y >= cb.y + cb.h - 1, 'under the picture, not on it')
  assert.equal(await c.st((s) => s.cutterMode), false, 'Shift+C is not the cutter')
  await c.st((s) => s.setTime(4))
  await c.waitFor('nothing said now', async () => !/Hello/.test(await c.run(() => document.querySelector('[data-testid="preview.narration"]').textContent)))
  await c.key('c', ['shift'])
  await c.waitGone('preview.narration')

  // ---- 11. The shortcut list (?) and its way to all the shortcuts.
  await c.key('?')
  await c.waitId('keys.list')
  const listText = await c.run(() => document.querySelector('[data-testid="keys.list"]').textContent)
  assert.match(listText, /\[ \/ \]/, 'the speed keys are listed')
  await c.key('Escape')
  await c.waitGone('keys.list')
  await c.key('?')
  await c.click('keys.list.all')
  await c.waitId('settings.keys')
  await c.waitId('shortcuts.key.goToTime')
  await c.key('Escape')
}
