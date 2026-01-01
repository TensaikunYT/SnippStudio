// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// Round 10 (the interface, redesigned): every action of the old interface is
// still reachable, and every shortcut keeps its keys.
import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { ACTIONS, defaultBindings } from '../renderer/src/shortcuts'
import { UI_MOVES } from './ui-map'

const SRC = join(__dirname, '..', '..', 'src', 'renderer', 'src')
const read = (f: string): string => readFileSync(join(SRC, f), 'utf8')

test('every place of the old interface has a place now (old → new, checked in the source)', () => {
  assert.ok(UI_MOVES.length >= 40)
  const missing: string[] = []
  const cache = new Map<string, string>()
  for (const m of UI_MOVES) {
    if (!cache.has(m.file)) cache.set(m.file, read(m.file))
    if (!cache.get(m.file)!.includes(m.find)) missing.push(`${m.action}: “${m.find}” not in ${m.file}`)
  }
  assert.deepEqual(missing, [])
  // Each old place is listed once.
  const olds = UI_MOVES.map((m) => `${m.action}|${m.old}`)
  assert.equal(new Set(olds).size, olds.length)
})

test('no thumbnail button came back', () => {
  for (const f of ['components/TopBar.tsx', 'App.tsx', 'components/TransportBar.tsx']) {
    assert.ok(!/ThumbnailDialog|Thumbnail Studio/.test(read(f)), f)
  }
})

test('the shortcut table keeps every key it had', () => {
  // As shipped before round 10: a change here is a change the user did not ask for.
  const before: Record<string, string> = {
    playPause: 'space', delete: 'backspace', split: 's', splitTool: 'b', slipTool: 'y', cutter: 'c', selectTool: 'a',
    selectAll: 'ctrl+a', undo: 'ctrl+z', redo: 'ctrl+shift+z', save: 'ctrl+s', goStart: 'home', frameBack: 'arrowleft',
    frameForward: 'arrowright', secondBack: 'shift+arrowleft', secondForward: 'shift+arrowright', nudgeLeft: 'alt+arrowleft',
    nudgeRight: 'alt+arrowright', shortIn: 'i', shortOut: 'o', zoomFit: 'shift+z', zoomSelection: 'z', prevEdit: 'arrowup',
    nextEdit: 'arrowdown', toggleLoop: 'ctrl+l', nextMarker: 'shift+m', prevMarker: 'ctrl+shift+m', toggleDisable: 'd',
    splitHere: 'ctrl+b', trimLeft: 'q', trimRight: 'w', closeGap: 'e', shuttleBack: 'j', shuttlePause: 'k', shuttleForward: 'l'
  }
  // Keys added since, and none changed: N, a work note at the playhead
  // (SnippStudio phase 1); Alt+, / Alt+. / Alt+K, from key to key and a key
  // at the playhead (phase Ç2c.2, decision 5); Ctrl+T, the default transition
  // at the nearest cut (core polish T); Ctrl+, the Settings window
  // (TERMINAL-YOK-PLAN.md).
  // VideoHub's review page's keys (ONIZLEME-UYGULA-PLAN.md, K1): new keys,
  // none of the table's changed; B and Y only inside a review.
  const { goToTime, slower, faster, previewActual, previewFit, prevNote, nextNote, narration, shortcutList, reviewBefore, reviewApprove, ...rest } = defaultBindings()
  assert.deepEqual([goToTime, slower, faster, previewActual, previewFit, prevNote, nextNote, narration, shortcutList, reviewBefore, reviewApprove], ['g', '[', ']', '1', '0', ',', '.', 'shift+c', '?', 'b', 'y'])
  for (const k of ['g', '[', ']', '1', '0', ',', '.', 'shift+c', '?']) assert.equal(Object.values(before).includes(k), false, k)
  // The preview toolbar's "Note" (DENEME-2-PLAN-N.md, K5): Shift+N, new.
  // The watch-and-note mode (IZLE-PLAN.md, K1): Shift+R, new.
  const { newNote, prevKeyframe, nextKeyframe, toggleKeyframe, addTransition, settings, pointNote, watchMode, ...kept } = rest
  assert.equal(pointNote, 'shift+n')
  assert.equal(watchMode, 'shift+r')
  assert.equal(Object.values(before).includes('shift+r'), false)
  assert.equal(Object.values(before).includes('shift+n'), false)
  assert.deepEqual(kept, before)
  assert.equal(newNote, 'n')
  assert.deepEqual([prevKeyframe, nextKeyframe, toggleKeyframe], ['alt+,', 'alt+.', 'alt+k'])
  assert.equal(addTransition, 'ctrl+t')
  assert.equal(settings, 'ctrl+,')
  for (const k of ['n', 'alt+,', 'alt+.', 'alt+k', 'ctrl+t', 'ctrl+,']) assert.equal(Object.values(before).includes(k), false, k)
  assert.equal(ACTIONS.length, Object.keys(before).length + 6 + 11 + 1 + 1)
  // The fixed keys the editor handles beside the table.
  const app = read('App.tsx')
  for (const k of ["case 'shift+delete'", "case 'delete'", "case 'ctrl+c'", "case 'ctrl+v'", "case 'ctrl+shift+v'", "case 'ctrl+d'", "case 'm'", "case 'ctrl+y'"]) {
    assert.ok(app.includes(k), k)
  }
})

