// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// Phase 9a, decision 7: one speech model. The left panel's Captions page
// (DENEME-4, worker W; it was the Subtitles tab) offers the
// spoken language and no model; it says the model runs offline (the model is
// there in a development copy); a choice lands in the project.
export const name = 'subs-one-model-language'

export async function run({ c, app, media, lib }) {
  const { assert } = lib
  const [talk] = await lib.seedAssets(app, c, [media.talk])
  await lib.seedTimeline(c, [talk.id])
  await lib.dockPage(c, 'captions')
  await c.waitId('subs.language')
  // A new project: English (what the English-only model used to be for).
  assert.equal(await c.value('subs.language'), 'english')
  // No model to choose: one select of languages, with Turkish second.
  const options = await c.run(() => [...document.querySelector('[data-testid="subs.language"]').options].map((o) => o.value))
  assert.deepEqual(options.slice(0, 2), ['english', 'turkish'])
  assert.ok(options.length > 90, `${options.length} languages`)
  assert.equal(options.includes('auto'), false, 'no "automatic": the model cannot tell the language')
  assert.equal(await c.run(() => [...document.querySelectorAll('select')].some((s) => [...s.options].some((o) => o.value === 'multilingual'))), false, 'no model select')
  // The model is installed here: the note, not the warning, and the button works.
  await c.waitFor('the model checked', async () => !(await c.has('subs.model.missing')) && (await c.run(() => document.body.textContent.includes('Whisper Medium, multilingual'))))
  assert.equal(await c.run(() => [...document.querySelectorAll('button')].find((b) => b.textContent.includes('Generate subtitles'))?.disabled), false)
  await c.select('subs.language', 'turkish')
  await c.waitFor('Turkish in the project', async () => (await c.st((s) => s.project.transcription?.language)) === 'turkish')
  assert.equal(await c.value('subs.language'), 'turkish')
}
