// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// Phase 11b, the user's request (tarifler/FAZ11B-EK.md): "Point" in the Notes
// tab, then one click on the preview starts a note on that frame with pin 1;
// a second click is pin 2; a click with the box tool is pin 3 (a click with any
// tool is a pin). Saved, the note's frame picture has the three numbers drawn
// on it and the agent's `notes` answer names each pin; its `image` is one
// picture. Out of "Point", a click on the preview starts no note.
import { connectAgent } from '../agent-client.mjs'
export const name = 'faz11b-pin'

export async function run({ c, app, media, lib }) {
  const { assert } = lib
  const [talk] = await lib.seedAssets(app, c, [media.talk])
  await lib.seedTimeline(c, [talk.id])
  await c.waitFor('the agent host', () => c.ev('!!window.__agent'))
  // Every number drawn on a canvas from here on (the pins' heads).
  await c.run(() => {
    window.__drawnTexts = []
    for (const K of [window.CanvasRenderingContext2D, window.OffscreenCanvasRenderingContext2D]) {
      if (!K) continue
      const f = K.prototype.fillText
      K.prototype.fillText = function (t, ...rest) {
        window.__drawnTexts.push(String(t))
        return f.call(this, t, ...rest)
      }
    }
    window.__store.getState().setTime(3)
    window.__store.setState({ selectedClipIds: [] })
    return true
  })

  await c.click('inspector.tab.notes')
  await c.click('notes.point')
  assert.equal(await c.st((s) => s.noteTool), 'pin', 'Point is on')
  assert.equal(await c.st((s) => s.noteDraft), null, 'no note yet')

  const layer = await c.box('notes.draw.layer')
  const frame = await c.run(() => window.__store.getState().project.settings)
  const fw = Math.min(layer.w, (layer.h * frame.width) / frame.height)
  const fh = (fw * frame.height) / frame.width
  const at = (fx, fy) => [layer.x + (layer.w - fw) / 2 + fw * fx, layer.y + (layer.h - fh) / 2 + fh * fy]

  // One click: a note on this frame with pin 1.
  await c.clickAt(...at(0.3, 0.4))
  const d1 = await c.waitFor('a note with pin 1', async () => { const d = await c.st((s) => s.noteDraft); return d && d.shapes.length === 1 ? d : null })
  assert.equal(d1.shapes[0].type, 'pin')
  assert.ok(lib.near(d1.shapes[0].pts[0][0], 0.3, 0.02) && lib.near(d1.shapes[0].pts[0][1], 0.4, 0.02), `pin 1 where clicked (${d1.shapes[0].pts[0]})`)
  assert.ok(lib.near(d1.at, 3, 0.05) && lib.near(d1.start, 3, 0.05), `on the playhead's frame (${d1.at})`)
  assert.deepEqual(await c.st((s) => s.selectedClipIds), [], 'the click picked no clip')

  // A second click: pin 2. A click with the box tool: pin 3. (Since the
  // click-and-type note, ONIZLEME-UYGULA-PLAN.md K7, a box to write in opens
  // to the right of the last pin: the next clicks are made off it.)
  await c.clickAt(...at(0.22, 0.75))
  await c.waitFor('pin 2', async () => (await c.st((s) => s.noteDraft?.shapes.length)) === 2)
  await c.click('notes.draw.tool.rect.bar')
  await c.clickAt(...at(0.8, 0.2))
  const d3 = await c.waitFor('pin 3', async () => { const d = await c.st((s) => s.noteDraft); return d && d.shapes.length === 3 ? d : null })
  assert.deepEqual(d3.shapes.map((s) => s.type), ['pin', 'pin', 'pin'], 'a click with the box tool is a pin')
  // (A real drag with the box tool is still a box.)
  const [x0, y0] = at(0.1, 0.6)
  const [x1, y1] = at(0.25, 0.8)
  await c.dragAt(x0, y0, x1, y1, { steps: 8 })
  await c.waitFor('a box', async () => (await c.st((s) => s.noteDraft?.shapes.length)) === 4)
  assert.equal(await c.st((s) => s.noteDraft.shapes[3].type), 'rect')

  await c.click('notes.draft.text')
  await c.type('these three')
  await c.run(() => { window.__drawnTexts = []; return true })
  await c.click('notes.draft.save')
  const note = await c.waitFor('the note saved', () => c.st((s) => (s.project.notes ?? [])[0] ?? null))
  assert.deepEqual(note.shapes.map((s) => s.type), ['pin', 'pin', 'pin', 'rect'], 'saved as drawn')
  await c.waitFor('its picture', async () => (await c.st((s) => s.project.notes[0].regionImage?.length ?? 0)) > 1000, 10000)
  const drawn = await c.ev('window.__drawnTexts')
  for (const n of ['1', '2', '3']) assert.ok(drawn.includes(n), `pin ${n} drawn on the note's picture (${drawn.join(',')})`)
  assert.equal(await c.st((s) => s.noteTool), null, 'Point ends with the note')

  // Out of Point, a click on the preview starts no note.
  await c.clickAt(...at(0.5, 0.5))
  await c.sleep(200)
  assert.equal(await c.st((s) => s.noteDraft), null, 'a plain click writes no note')

  // The agent: the pins by number, and one picture.
  const ag = await connectAgent({ c, app, assert, client: 'pin' })
  const read = await ag.call('notes')
  assert.match(read.text, /pin 1 at \(0\.3\d, 0\.\d\d\), pin 2 at \(0\.2\d, 0\.7\d\), pin 3 at \(0\.\d\d, 0\.\d\d\)/, read.text)
  const img = await ag.call('notes', { image: note.num })
  assert.equal(img.images.length, 1, 'one picture')
  return { pins: 3, drawn: drawn.filter((t) => /^\d$/.test(t)) }
}
