// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// Phase 3c.Y, K3 (tarifler\FAZ3C-YERLESIM.md): on the N lane a plain drag
// moves the playhead and opens no note; a note opens only on purpose: a
// double click (a point note there), the label's "+" (at the playhead), right
// click → "Note here", Shift + drag (a range; 12-notes draws one).
export const name = 'notes-lane-gestures'

export async function run({ c, app, media, lib }) {
  const { assert } = lib
  const [talk] = await lib.seedAssets(app, c, [media.talk])
  await lib.seedTimeline(c, [talk.id])
  const draft = () => c.st((s) => s.noteDraft)
  const cancel = () => c.run(() => { window.__store.getState().cancelNoteDraft(); return true })
  const lane = await c.box('notes.lane')

  // A plain drag 2 s → 5 s: the playhead follows, no note.
  await lib.seek(c, 0.5)
  await c.dragAt(await lib.timeX(c, 2), lane.cy, await lib.timeX(c, 5), lane.cy, { steps: 12 })
  assert.equal(await draft(), null, 'a plain drag opens no note')
  const t1 = await c.st((s) => s.currentTime)
  assert.ok(lib.near(t1, 5, 0.15), `the playhead followed the drag (${t1})`)
  // A plain click puts the playhead there, no note.
  await c.clickAt(await lib.timeX(c, 3), lane.cy)
  assert.equal(await draft(), null, 'a click opens no note')
  assert.ok(lib.near(await c.st((s) => s.currentTime), 3, 0.15), 'the click moved the playhead')

  // A double click: a point note at that moment.
  await c.clickAt(await lib.timeX(c, 6), lane.cy, { double: true })
  const d1 = await c.waitFor('a note from a double click', draft)
  assert.ok(lib.near(d1.start, 6, 0.15) && lib.near(d1.end, d1.start, 1e-9), `a point note at 6 s (${d1.start}–${d1.end})`)
  await c.waitId('notes.draft.text')
  await cancel()

  // The label's "+": at the playhead.
  await lib.seek(c, 4)
  const now = await c.st((s) => s.currentTime)
  await c.click('notes.lane.add')
  const d2 = await c.waitFor('a note from the + button', draft)
  assert.ok(lib.near(d2.start, now, 1e-6) && lib.near(d2.end, now, 1e-6), `at the playhead (${d2.start}, ${now})`)
  await cancel()

  // Right click → Note here.
  await c.clickAt(await lib.timeX(c, 7), lane.cy, { button: 'right' })
  await c.click('notes.lane.here')
  const d3 = await c.waitFor('a note from the menu', draft)
  assert.ok(lib.near(d3.start, 7, 0.15) && lib.near(d3.end, d3.start, 1e-9), `a point note at 7 s (${d3.start})`)
  await cancel()

  // Shift + drag still marks a range.
  await c.dragAt(await lib.timeX(c, 1.5), lane.cy, await lib.timeX(c, 3.5), lane.cy, { steps: 10, mods: ['shift'] })
  const d4 = await c.waitFor('a range from Shift + drag', draft)
  assert.ok(d4.end - d4.start > 1.5, `a range (${d4.start}–${d4.end})`)
  await cancel()
  assert.equal(await c.st((s) => (s.project.notes ?? []).length), 0, 'nothing was saved on the way')
}
