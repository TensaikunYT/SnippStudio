// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
import assert from 'node:assert/strict'
import test from 'node:test'
import { createTemplate, cutGone, sanitizeTemplates, setTemplateCut, updateTemplate } from '../renderer/src/templates/model'
import { defaultProject, projectDuration, templateEnd } from '../renderer/src/types'

test('a template cut short: its pace stays, it leaves at the cut, and it can be made whole again', () => {
  const p = defaultProject()
  const id = createTemplate(p, 'gallery', 2)
  const b = p.templates!.find((t) => t.id === id)!
  b.duration = 8
  setTemplateCut(p, id, 3)
  assert.equal(b.cut, 3)
  assert.equal(b.duration, 8)
  // Gone from the screen once it has left.
  assert.ok(Math.abs(templateEnd(b) - (2 + 3 + 0.6)) < 1e-9)
  assert.ok(projectDuration(p) >= templateEnd(b) - 1e-9)
  assert.equal(cutGone(b, 2.9), 0)
  assert.ok(cutGone(b, 3.3) > 0 && cutGone(b, 3.3) < 1)
  assert.equal(cutGone(b, 3.6), 1)
  // Too near the end is no cut; a shorter length drops a cut it passes.
  setTemplateCut(p, id, 7.9)
  assert.equal(b.cut, undefined)
  setTemplateCut(p, id, 6)
  updateTemplate(p, id, { duration: 5 })
  assert.equal(b.cut, undefined)
  setTemplateCut(p, id, 3)
  setTemplateCut(p, id, undefined)
  assert.equal(b.cut, undefined)
  // Kept on load; nonsense dropped.
  setTemplateCut(p, id, 2.5)
  sanitizeTemplates(p)
  assert.equal(p.templates![0].cut, 2.5)
  ;(p.templates![0] as { cut?: unknown }).cut = 99
  sanitizeTemplates(p)
  assert.equal(p.templates![0].cut, undefined)
})
