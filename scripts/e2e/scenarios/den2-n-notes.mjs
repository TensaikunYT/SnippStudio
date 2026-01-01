// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// The user's second try, worker N (DENEME-2-PLAN-N.md): the preview toolbar's
// "Note" button and Shift+N (click-and-type in one press, only with the
// agent's access on), each note status on the N lane (done notes only with
// the Notes tab's "All", faded), no pin of a done note over the film, and the
// review bar in its own strip under the picture: whole, never under B's
// "before" frame, at 1366 × 768 in English and Turkish.
import { accessOn } from '../session.mjs'
export const name = 'den2-n-notes'
export const timeoutMs = 180000

export async function run({ c, app, media, lib }) {
  const { assert } = lib
  const [talk] = await lib.seedAssets(app, c, [media.talk])
  await lib.seedTimeline(c, [talk.id])
  await c.st((s) => { s.setTime(3); s.selectClip?.(null) })
  await accessOn(c)

  // ---- 3. "Note" on the preview toolbar: one press, a click, type, Enter.
  await c.waitId('preview.point-note')
  await c.click('preview.point-note')
  assert.equal(await c.st((s) => s.noteTool), 'pin', 'the button turns click-and-type on')
  assert.equal(await c.attr('preview.point-note', 'aria-pressed'), 'true')
  const layer = await c.box('notes.draw.layer')
  const frame = await c.st((s) => s.project.settings)
  const fw = Math.min(layer.w, (layer.h * frame.width) / frame.height)
  const fh = (fw * frame.height) / frame.width
  const at = (fx, fy) => [layer.x + (layer.w - fw) / 2 + fw * fx, layer.y + (layer.h - fh) / 2 + fh * fy]
  await c.clickAt(...at(0.5, 0.85))
  await c.waitId('notes.quick.text')
  await c.waitFor('the box has the keyboard', async () => (await lib.focused(c)) === 'notes.quick.text', 3000)
  await c.type('Price row is cut')
  await c.key('Enter')
  await c.waitGone('notes.quick')
  const q = await c.waitFor('the note saved', () => c.st((s) => s.project.notes?.find((n) => n.text === 'Price row is cut') ?? null))
  assert.equal(q.shapes[0].type, 'pin')
  assert.equal(await c.st((s) => s.noteTool), 'pin', 'the tool stays in hand')
  // Esc closes the box; nothing said, the pin goes with it.
  await c.clickAt(...at(0.3, 0.3))
  await c.waitId('notes.quick.text')
  await c.waitFor('focused', async () => (await lib.focused(c)) === 'notes.quick.text', 3000)
  await c.key('Escape')
  await c.waitGone('notes.quick')
  assert.equal(await c.st((s) => !!s.noteDraft), false, 'Esc: no note left half made')
  assert.equal(await c.st((s) => s.project.notes.length), 1)
  assert.equal(await c.st((s) => s.noteTool), null, 'Esc puts the tool down too')
  assert.equal(await c.attr('preview.point-note', 'aria-pressed'), 'false')
  // Shift+N: the same switch.
  await c.st((s) => s.setTime(1))
  await c.key('N', ['shift'])
  assert.equal(await c.st((s) => s.noteTool), 'pin', 'Shift+N turns it on')
  await c.key('N', ['shift'])
  assert.equal(await c.st((s) => s.noteTool), null, 'and off again')
  assert.equal(await c.st((s) => s.splitToolMode || s.cutterMode), false, 'Shift+N is no other tool')

  // ---- 2. Each status on the lane; a done note only with "All", faded.
  await c.waitFor('its picture', async () => (await c.st((s, id) => s.project.notes.find((n) => n.id === id)?.regionImage?.length ?? 0, q.id)) > 1000, 15000)
  const mk = (start, text, status, pin) =>
    c.run((start, text, status, pin) => {
      const s = window.__store.getState()
      s.startNoteDraft({ start, end: start })
      window.__store.getState().patchNoteDraft({ text, ...(pin ? { shapes: [{ type: 'pin', pts: [[0.4, 0.4]], color: '#ff5a5a' }], at: start } : {}) })
      const id = window.__store.getState().saveNoteDraft()
      window.__store.getState().editNotes((p) => { p.notes.find((n) => n.id === id).status = status }, false)
      return id
    }, start, text, status, pin)
  const open = await mk(5, 'open one', 'open', true)
  const agent = await mk(7, 'with the agent', 'agent', false)
  const ready = await mk(9, 'answered', 'ready', false)
  const done = await mk(11, 'done one', 'approved', true)
  const still = await mk(13, 'sent back', 'still', false)
  await c.st((s) => { s.setPxPerSec?.(60); s.selectNote(null) })
  await c.click('inspector.tab.notes')
  await c.select('notes.filter', 'open')
  for (const [id, st] of [[open, 'open'], [agent, 'agent'], [ready, 'ready'], [still, 'still']]) {
    await c.waitId(`notes.lane.note.${id}`)
    assert.equal(await c.attr(`notes.lane.note.${id}`, 'data-status'), st, `${st} on the lane`)
  }
  assert.equal(await c.has(`notes.lane.note.${done}`), false, 'a done note is not on the lane')
  const look = (id) => c.run((s) => { const e = document.querySelector(s); const cs = getComputedStyle(e); return { opacity: Number(cs.opacity), border: cs.borderTopStyle, ring: cs.boxShadow } }, `[data-testid="notes.lane.note.${id}"]`)
  assert.equal((await look(agent)).border, 'dashed', 'with the agent: dashed')
  assert.notEqual((await look(ready)).ring, 'none', 'ready: ringed')
  assert.equal((await look(open)).opacity, 1)
  await c.select('notes.filter', 'all')
  await c.waitId(`notes.lane.note.${done}`)
  assert.equal(await c.attr(`notes.lane.note.${done}`, 'data-status'), 'approved')
  assert.ok((await look(done)).opacity < 0.6, `done: faded (${(await look(done)).opacity})`)
  await c.select('notes.filter', 'open')
  await c.waitGone(`notes.lane.note.${done}`)

  // No pin of a done note over the film; an open note's shows.
  const shapes = () => c.attr('notes.draw.layer', 'data-shapes')
  await c.st((s, id) => { s.selectNote(id); s.setTime(11) }, done)
  await c.sleep(150)
  assert.equal(await shapes(), '0', 'the done note leaves no pin')
  await c.st((s, id) => { s.selectNote(id); s.setTime(5) }, open)
  await c.waitFor('the open note\'s pin', async () => (await shapes()) === '1', 3000)

  // ---- 1. The review bar: its own strip, whole, B cannot cover it.
  await c.run((ids) => window.__store.getState().editNotes((p) => { for (const id of ids) { const n = p.notes.find((x) => x.id === id); n.status = 'ready'; n.reply = 'Done.'; n.touched = [[n.start, n.start + 1]] } }, false), [q.id])
  const BTNS = ['review.prev', 'review.replay', 'review.before', 'review.approve', 'review.still', 'review.next', 'review.end']
  const whole = () =>
    c.run((ids) => {
      const vw = innerWidth, vh = innerHeight
      const wrap = document.querySelector('.preview-canvas-wrap').getBoundingClientRect()
      const bar = document.querySelector('[data-testid="review.bar"]').getBoundingClientRect()
      const out = { overPicture: bar.top < wrap.bottom - 1 && bar.bottom > wrap.top + 1, cut: [] }
      for (const id of ids) {
        const el = document.querySelector(`[data-testid="${id}"]`)
        const r = el.getBoundingClientRect()
        const inside = r.width > 4 && r.left >= 0 && r.top >= 0 && r.right <= vw && r.bottom <= vh && r.left >= bar.left - 1 && r.right <= bar.right + 1 && r.top >= bar.top - 1 && r.bottom <= bar.bottom + 1
        const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)
        if (!inside || !(top && el.contains(top))) out.cut.push(id)
      }
      return out
    }, BTNS)
  const size = (width, height) => c.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false })
  const report = {}
  try {
    await size(1366, 768)
    await c.sleep(300)
    for (const lang of ['en', 'tr']) {
      await c.run((l) => window.__store.getState().setUiLang(l), lang)
      await c.click('notes.review')
      await c.waitId('review.bar')
      await c.sleep(200)
      let w = await whole()
      assert.equal(w.overPicture, false, `${lang}: the bar is not over the picture`)
      assert.deepEqual(w.cut, [], `${lang}: every button whole and on top`)
      // B: the frame as it was, over the picture; the bar stays whole.
      await c.key('b')
      await c.waitId('review.before.image')
      w = await whole()
      assert.deepEqual(w.cut, [], `${lang}: with B pressed every button is still whole`)
      assert.equal(await c.attr('review.before', 'aria-pressed'), 'true')
      report[lang] = await c.run(() => { const b = document.querySelector('[data-testid="review.bar"]').getBoundingClientRect(); return { w: Math.round(b.width), h: Math.round(b.height) } })
      await c.key('b')
      await c.waitGone('review.before.image')
      if (lang === 'en') {
        await c.click('review.end')
        await c.waitGone('review.bar')
      }
    }
    // Approve: the note it was on is done (the review goes on to the other
    // answered note; end it) and leaves no pin.
    await c.click('review.approve')
    await c.waitFor('approved', async () => (await c.st((s, id) => s.project.notes.find((n) => n.id === id).status, q.id)) === 'approved')
    if (await c.has('review.bar')) await c.click('review.end')
    await c.waitGone('review.bar')
    await c.st((s, id) => { s.selectNote(id); s.setPlaying(false); s.setTime(s.project.notes.find((n) => n.id === id).at) }, q.id)
    await c.sleep(150)
    assert.equal(await shapes(), '0', 'approved in the review: its pin is gone from the picture')
    // (Picking a done note makes the Notes tab show "All": on the lane it is
    // faded; back to "Open" it goes.)
    if (await c.has(`notes.lane.note.${q.id}`)) {
      assert.equal(await c.attr(`notes.lane.note.${q.id}`, 'data-status'), 'approved')
      assert.ok((await look(q.id)).opacity < 1, 'faded on the lane (less so while picked)')
    }
    await c.select('notes.filter', 'open')
    await c.waitGone(`notes.lane.note.${q.id}`)
  } finally {
    await c.run(() => window.__store.getState().setUiLang('en'))
    await c.send('Emulation.clearDeviceMetricsOverride')
  }

  // Access off: no button, Shift+N does nothing.
  await c.click('agent.switch')
  await c.waitFor('access off', async () => !(await c.ev('window.api.agentSession.status()')).server?.running, 10000)
  await c.waitGone('preview.point-note')
  await c.key('N', ['shift'])
  assert.equal(await c.st((s) => s.noteTool), null, 'access off: Shift+N does nothing')
  return { bar: report }
}
