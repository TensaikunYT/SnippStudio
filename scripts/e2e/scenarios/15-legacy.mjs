// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// An old project holding narrator hands (the daily Snipp's kind) opens as a
// copy: File → Open, one line saying so, the hands gone, the file itself
// unchanged, and Save asks for a new name (here: cancelled).
import { copyFileSync, readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { join } from 'node:path'
export const name = 'legacy-project-opens-as-copy'

const sha = (f) => createHash('sha256').update(readFileSync(f)).digest('hex')

export async function run({ c, app, media, lib, work }) {
  const { assert } = lib
  const file = join(work, 'old-with-hands.snipp')
  copyFileSync(media.legacy, file)
  const before = sha(file)

  lib.answer(app, { kind: 'open', paths: [file] })
  await c.click('topbar.file')
  await c.click('menu.file.open')
  await c.waitFor('the copy opened', async () => (await c.st((s) => Object.keys(s.project.clips).length)) === 1, 15000)
  const p = await c.st((s) => s.project)
  assert.equal(p.characters, undefined, 'no hands in it')
  // The line is a toast in the one stack (phase 3c.4b: the shell's single
  // toast, test name "toast", joined notify()'s stack, names "toast.<id>").
  const said = await c.waitFor('the line saying it is a copy', () => c.run(() => [...document.querySelectorAll('[data-testid="toast.stack"] [data-testid^="toast."]')].map((e) => e.textContent ?? '').find((x) => /copy/i.test(x)) ?? null), 8000)
  assert.match(said, /copy/i, 'the line says it is a copy')
  assert.equal(await c.st((s) => s.dirty), true, 'a copy is unsaved work')

  // Save asks where (it is not bound to the old file): cancelled here.
  lib.answer(app, { kind: 'cancel' })
  await c.click('timeline.scroll', { fx: 0.95, fy: 0.97 })
  await c.key('s', ['ctrl'])
  await c.waitFor('the save dialog asked', async () => lib.dialogsAsked(app).some((e) => e.kind === 'save'))
  await c.sleep(300)
  assert.equal(sha(file), before, 'the old file is unchanged')
  assert.equal(await c.st((s) => s.dirty), true, 'still unsaved')
}
