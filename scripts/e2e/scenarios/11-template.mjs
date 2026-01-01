// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// Templates: Library → Templates, "Insert at playhead" on Steps and on a bar
// chart; each lands at the playhead, selected, with the Template tab open.
export const name = 'template-insert'

export async function run({ c, app, media, lib }) {
  const { assert } = lib
  const [talk] = await lib.seedAssets(app, c, [media.talk])
  await lib.seedTimeline(c, [talk.id])
  await lib.seek(c, 2)
  const depth0 = await lib.undoDepth(c)

  await lib.templatesPage(c)
  await c.click('templates.insert.steps')
  const t1 = await c.waitFor('a Steps block', () => c.st((s) => s.project.templates?.find((x) => x.kind === 'steps') ?? null))
  assert.ok(lib.near(t1.start, 2, 0.1), `at the playhead (${t1.start})`)
  assert.equal(await c.st((s) => s.templateSel), t1.id, 'selected')
  await c.waitId('inspector.tab.tmpl')

  await lib.seek(c, 8)
  await c.click('templates.insert.bars')
  const t2 = await c.waitFor('a bar chart', () => c.st((s) => s.project.templates?.find((x) => x.kind === 'bars') ?? null))
  assert.ok(lib.near(t2.start, 8, 0.1))
  assert.equal((await lib.undoDepth(c)) - depth0, 2, 'one step each')

  // The export draws it: a frame inside the block differs from the plain clip.
  const d = await c.run(async (at) => {
    const ex = await window.__exporter()
    const p = window.__store.getState().project
    const plain = { ...p, templates: [] }
    const px = async (proj) => { const u8 = await ex.exportFramePng(proj, at, true, 'final'); const b = await createImageBitmap(new Blob([u8])); const cv = new OffscreenCanvas(32, 18); const g = cv.getContext('2d'); g.drawImage(b, 0, 0, 32, 18); return [...g.getImageData(0, 0, 32, 18).data] }
    const a = await px(p), b = await px(plain)
    return a.reduce((n, v, i) => n + Math.abs(v - b[i]), 0) / a.length
  }, t1.start + t1.duration / 2)
  assert.ok(d > 2, `the template is drawn (${d.toFixed(1)})`)
}
