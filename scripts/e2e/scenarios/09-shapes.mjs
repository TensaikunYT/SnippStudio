// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// Shapes: Text → Shapes and highlights (Effects → Shapes until
// YAZI-PANELI-PLAN.md), a box and an arrow at the playhead;
// the selected one deleted with its own button.
export const name = 'shapes-add'

export async function run({ c, app, media, lib }) {
  const { assert } = lib
  const [talk] = await lib.seedAssets(app, c, [media.talk])
  await lib.seedTimeline(c, [talk.id])
  await lib.seek(c, 4)

  await lib.textPage(c, 'shapes')
  await c.click('shapes.add.rect')
  const rect = await c.waitFor('a box', () => c.st((s) => s.project.captions.find((x) => x.shape?.kind === 'rect') ?? null))
  assert.ok(lib.near(rect.start, 4, 0.1), 'at the playhead')
  await c.waitId(`timeline.caption.${rect.id}`)
  await c.click('shapes.add.arrow')
  const arrow = await c.waitFor('an arrow', () => c.st((s) => s.project.captions.find((x) => x.shape?.kind === 'arrow') ?? null))
  assert.notEqual(arrow.layer ?? 0, rect.layer ?? 0, 'each shape on its own layer')
  // The new one is selected: deleted from the panel.
  await c.click('shapes.delete')
  await c.waitFor('the arrow gone', async () => !(await c.st((s) => s.project.captions.some((x) => x.shape?.kind === 'arrow'))))
  assert.equal(await c.st((s) => s.project.captions.filter((x) => x.shape).length), 1)
}
