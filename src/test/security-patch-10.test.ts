// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// Security patch, item 10 (S6): names Windows keeps for devices are not local
// file paths, in every spelling Windows itself takes for the device: the
// console's CONIN$ / CONOUT$, a name followed by spaces before its dot
// ("con .txt"), COM0 / LPT0 and the superscript digits. Both copies of the
// rule (platform-path.ts and recents-store.ts's own) say the same.
import assert from 'node:assert/strict'
import test from 'node:test'
import { isLocalFilePath } from '../main/platform-path'
import { isLocalFilePath as recentsLocal } from '../main/recents-store'

test('item 10: device-like names are refused on Windows, in both copies of the rule', () => {
  const refused = [
    'C:\\x\\CONIN$', 'C:\\x\\conout$', 'C:\\x\\CONIN$.txt', 'C:\\CONOUT$\\a.mp4', 'C:\\x\\CLOCK$',
    'C:\\x\\con .txt', 'C:\\x\\NUL  .mp4', 'C:\\x\\aux ', 'C:\\x\\prn .', 'C:\\con \\a.mp4',
    'C:\\x\\COM0', 'C:\\x\\lpt0.txt', 'C:\\x\\COM\u00b9', 'C:\\x\\lpt\u00b3.wav', 'C:\\x\\com\u00b2 .txt',
    // (As before.)
    'C:\\x\\con', 'C:\\x\\NUL.txt', 'C:\\x\\com1', 'C:\\x\\LPT9.png', 'C:\\aux\\a.mp4'
  ]
  for (const p of refused) {
    assert.equal(isLocalFilePath(p, 'win32'), false, p)
    assert.equal(recentsLocal(p, 'win32'), false, `recents copy: ${p}`)
    assert.equal(isLocalFilePath(p.replace(/\\/g, '/'), 'win32'), false, `${p} with /`)
  }
  // Plain names that only look alike stay local files.
  const fine = [
    'C:\\x\\console.txt', 'C:\\x\\con artist.mp4', 'C:\\x\\conin.txt', 'C:\\x\\CONIN$x.txt', 'C:\\x\\my con .txt', 'C:\\x\\com10.txt',
    'C:\\x\\common\\a.mp4', 'C:\\x\\null.txt', 'C:\\x\\auxiliary\\a.wav', 'C:\\x\\lpt.txt', 'C:\\x\\clock.png', 'C:\\x\\a.con', 'C:\\x\\$CONIN'
  ]
  for (const p of fine) {
    assert.equal(isLocalFilePath(p, 'win32'), true, p)
    assert.equal(recentsLocal(p, 'win32'), true, `recents copy: ${p}`)
  }
  // Elsewhere these are plain names.
  for (const p of ['/home/u/CONIN$', '/home/u/con .txt', '/Users/u/com0']) {
    for (const platform of ['linux', 'darwin'] as const) {
      assert.equal(isLocalFilePath(p, platform), true, `${platform} ${p}`)
      assert.equal(recentsLocal(p, platform), true, `${platform} recents copy ${p}`)
    }
  }
})
