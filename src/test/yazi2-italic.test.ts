// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// A title's slant (CaptionStyle.italic; SnippStudio YAZI2-PLAN.md, D3 and the
// addendum): it is in the saved file and is the same after opening it; a
// value that is no boolean is taken off when the file is read (the text
// stands upright) and said; the commands an agent changes a title with leave
// it as it was; upright, the font the canvas is given is the one it always was.
import { fixture, resetWorld } from './undo-fixture'
import assert from 'node:assert/strict'
import test from 'node:test'
import { readProjectFile, serializeProject } from '../renderer/src/media/projectio'
import { applyBatch } from '../renderer/src/commands'
import { captionFont } from '../renderer/src/playback/draw/captions'
import { defaultCaptionStyle, type Project } from '../renderer/src/types'

/** The fixture with one slanted title (and the subtitles' own style slanted too). */
function slanted(): { p: Project; id: string } {
  resetWorld()
  const p = fixture()
  const made = applyBatch(p, [{ name: 'text.add', params: { time: 1, text: 'Leaning' } }])
  const id = made.results[0] as string
  const out = structuredClone(made.project)
  const cap = out.captions.find((c) => c.id === id)!
  cap.style = { ...(cap.style ?? defaultCaptionStyle()), italic: true }
  out.captionStyle = { ...out.captionStyle, italic: true }
  return { p: out, id }
}
const italicOf = (p: Project, id: string): unknown => p.captions.find((c) => c.id === id)?.style?.italic

test('italic is in the saved file and the same after opening it; false stays false', () => {
  const { p, id } = slanted()
  const text = serializeProject(p)
  assert.match(text, /"italic":\s*true/)
  const back = readProjectFile(text)
  assert.equal(italicOf(back.project, id), true)
  assert.equal(back.project.captionStyle.italic, true)
  assert.deepEqual(back.repaired, [], 'nothing to mend')
  // Saved again: the same file.
  assert.equal(serializeProject(back.project), text)
  const upright = structuredClone(p)
  upright.captions.find((c) => c.id === id)!.style!.italic = false
  assert.equal(italicOf(readProjectFile(serializeProject(upright)).project, id), false)
})

test('an italic that is no boolean is taken off when the file is read, and said', () => {
  for (const bad of ['yes', 1, null, 'false', {}, []]) {
    const { p, id } = slanted()
    const raw = JSON.parse(serializeProject(p)) as { captions: { id: string; style: Record<string, unknown> }[]; captionStyle: Record<string, unknown> }
    raw.captions.find((c) => c.id === id)!.style.italic = bad
    raw.captionStyle.italic = bad
    const back = readProjectFile(JSON.stringify(raw))
    const cap = back.project.captions.find((c) => c.id === id)!
    assert.equal('italic' in cap.style!, false, `${JSON.stringify(bad)} on a title`)
    assert.equal('italic' in back.project.captionStyle, false, `${JSON.stringify(bad)} on the subtitles' style`)
    assert.ok(back.repaired.some((r) => r.code === 'shape' && r.count >= 2), `${JSON.stringify(bad)} is said`)
    // The rest of the style is as it was.
    assert.equal(cap.style!.fontFamily, p.captions.find((c) => c.id === id)!.style!.fontFamily)
    assert.equal(cap.text, 'Leaning')
  }
})

test('the commands an agent changes a title with leave its slant as it was', () => {
  const { p, id } = slanted()
  const after = applyBatch(p, [
    { name: 'caption.setOwnStyle', params: { id, patch: { fontSize: 90, color: '#ffcc00', align: 'left' } } },
    { name: 'caption.update', params: { id, patch: { text: 'Still leaning', start: 2, end: 5 } } },
    { name: 'caption.editLine', params: { id, text: 'Still leaning, edited' } },
    { name: 'caption.setStyle', params: { patch: { fontSize: 70 } } }
  ]).project
  const cap = after.captions.find((c) => c.id === id)!
  assert.equal(cap.style!.italic, true)
  assert.equal(cap.style!.fontSize, 90)
  assert.equal(cap.text, 'Still leaning, edited')
  assert.equal(after.captionStyle.italic, true, 'the subtitles\' own style too')
  // And through a save and an open after those.
  assert.equal(italicOf(readProjectFile(serializeProject(after)).project, id), true)
})

test('upright, the canvas gets the font it always got', () => {
  const st = { fontWeight: 800, fontFamily: 'Inter' }
  assert.equal(captionFont(st, 64), '800 64px "Inter", sans-serif')
  assert.equal(captionFont({ ...st, italic: false }, 64), '800 64px "Inter", sans-serif')
  assert.equal(captionFont({ ...st, italic: true }, 64), 'italic 800 64px "Inter", sans-serif')
})
