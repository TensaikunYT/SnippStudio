// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// Phase 3c.Y, K2 (tarifler\FAZ3C-YERLESIM.md): with the agent switched off
// the Agent tab is gone; whatever waits for the user keeps the tab. The
// command box is one line whenever it is empty and left alone (audit G1).
import assert from 'node:assert/strict'
import test from 'node:test'
import { agentTabShown, boxFolded, boxHeld, focusLeavesBox } from '../renderer/src/components/agent/visibility'

test('the Agent tab: on with the switch, or while something waits for the user', () => {
  const off = { serverOn: false, draft: false, running: false, points: 0 }
  assert.equal(agentTabShown(off), false)
  assert.equal(agentTabShown({ ...off, serverOn: true }), true)
  assert.equal(agentTabShown({ ...off, draft: true }), true, 'a draft to accept or reject')
  assert.equal(agentTabShown({ ...off, running: true }), true, 'a call still running')
  assert.equal(agentTabShown({ ...off, points: 1 }), true, 'a restore point')
})

test('the command box folds when it is empty and nothing holds it open, the agent on or off (audit G1)', () => {
  const base = { pinned: false, open: false, text: '', draft: false, running: false }
  assert.equal(boxFolded(base), true, 'empty and left alone: one line (the switch plays no part)')
  assert.equal(boxFolded({ ...base, pinned: true }), false)
  assert.equal(boxFolded({ ...base, open: true }), false)
  assert.equal(boxFolded({ ...base, text: 'cut the pauses' }), false)
  assert.equal(boxFolded({ ...base, text: '   ' }), true, 'only spaces count as empty')
  assert.equal(boxFolded({ ...base, draft: true }), true, 'a waiting draft does not hold it open any more: it is reviewed over the timeline (D22, the audit A3)')
  assert.equal(boxFolded({ ...base, running: true }), false, 'a call under way holds it open')
  assert.equal(boxHeld({ draft: false, running: false }), false)
  assert.equal(boxHeld({ draft: true, running: false }), false)
})

test('focus leaving the box: a dialog or menu it opened is still the box', () => {
  type El = { closest: (sel: string) => unknown; id: string }
  const inside: El = { closest: () => null, id: 'in' }
  const outside: El = { closest: () => null, id: 'out' }
  const inDialog: El = { closest: (sel: string) => (sel.includes('dialog') ? {} : null), id: 'dlg' }
  const box = { contains: (n: El) => n.id === 'in' }
  assert.equal(focusLeavesBox(null, box), true)
  assert.equal(focusLeavesBox(inside, box), false)
  assert.equal(focusLeavesBox(outside, box), true)
  assert.equal(focusLeavesBox(inDialog, box), false)
})
