// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// Work notes: a range dragged on the N lane, a kind and a sentence, a box drawn
// on the frame, saved (with the frame as a picture); then, once the agent has
// answered (set here in the store), the review tour plays it and Approve closes it.
export const name = 'notes-draw-review'

export async function run({ c, app, media, lib }) {
  const { assert } = lib
  const [talk] = await lib.seedAssets(app, c, [media.talk])
  await lib.seedTimeline(c, [talk.id])

  // Drag 2 s → 4 s on the N lane.
  const lane = await c.box('notes.lane')
  await c.dragAt(await lib.timeX(c, 2), lane.cy, await lib.timeX(c, 4), lane.cy, { steps: 10, mods: ['shift'] })
  const draft = await c.waitFor('a note being written', () => c.st((s) => s.noteDraft))
  assert.ok(lib.near(draft.start, 2, 0.1) && lib.near(draft.end, 4, 0.1), `range 2–4 s (${draft.start}–${draft.end})`)
  await c.waitId('notes.draft.text')
  await c.click('notes.kind.fix')
  await c.click('notes.draft.text')
  await c.type('The title is cut off: move it up')

  // A box on the frame, drawn on the preview.
  await c.click('notes.draw.tool.rect')
  const layer = await c.box('notes.draw.layer')
  // (Phase 3c.Y, K1: the taller timeline leaves the preview row wider than
  // 16:9, so the frame sits inside the layer: the points are the frame's.)
  const fw = Math.min(layer.w, (layer.h * 16) / 9)
  const fh = (fw * 9) / 16
  const cv = { x: layer.x + (layer.w - fw) / 2, y: layer.y + (layer.h - fh) / 2, w: fw, h: fh }
  await c.dragAt(cv.x + cv.w * 0.3, cv.y + cv.h * 0.3, cv.x + cv.w * 0.6, cv.y + cv.h * 0.55, { steps: 8 })
  await c.waitFor('one stroke', async () => (await c.st((s) => s.noteDraft?.shapes.length)) === 1)
  await c.click('notes.draft.save')
  const note = await c.waitFor('the note saved', () => c.st((s) => (s.project.notes ?? [])[0] ?? null))
  assert.equal(note.kind, 'fix')
  assert.equal(note.text, 'The title is cut off: move it up')
  assert.equal(note.shapes.length, 1)
  assert.equal(note.shapes[0].type, 'rect')
  const [x0, y0] = note.shapes[0].pts[0]
  assert.ok(lib.near(x0, 0.3, 0.05) && lib.near(y0, 0.3, 0.05), `the box where it was drawn (${x0.toFixed(2)}, ${y0.toFixed(2)})`)
  await c.waitFor('its picture', async () => (await c.st((s) => s.project.notes[0].regionImage?.length ?? 0)) > 1000, 10000)
  await c.waitId(`notes.card.${note.id}`)
  await c.waitId(`notes.lane.note.${note.id}`)

  // The agent's answer (what note_update would write), then the review.
  await c.run((id) => window.__store.getState().editNotes((p) => { const n = p.notes.find((x) => x.id === id); n.status = 'ready'; n.reply = 'Moved it up.'; n.touched = [[2, 4]] }, false), note.id)
  await c.click('notes.review')
  await c.waitId('review.bar')
  const loop = await c.st((s) => s.loopRange)
  assert.ok(loop && loop[0] <= 2 && loop[1] >= 4, `the changed stretch loops (${loop})`)
  await c.click('review.approve')
  await c.waitFor('approved', async () => (await c.st((s) => s.project.notes[0].status)) === 'approved')
  await c.waitGone('review.bar')
  assert.equal(await c.st((s) => s.playing), false, 'the review stopped playing')
}
