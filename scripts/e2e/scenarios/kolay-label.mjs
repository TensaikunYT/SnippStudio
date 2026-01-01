// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// Worker "kolay", item 3 (SnippStudio KOLAY-PLAN.md): a clip's coloured label.
//   - Right-click → Label opens a second menu: six colours (each with its
//     swatch) and "No label"; the clip's colour is ticked.
//   - A colour draws a thin line along the clip's top edge: above the name
//     pill (never on it), inside the clip; the clip keeps its kind's colour
//     and its selection outline. One undo step; Ctrl+Z takes it off.
//   - Two clips selected: both take it. The timeline search's swatch keeps
//     only the clips of that colour.
//   - 1366 × 768 and 1920 × 1080, English and Turkish: the menu whole.
//     Screenshots to tasarim\karsilastirma\kolay when SNIPP_SCREENS_KOLAY is set.
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { APP_DIR } from '../app.mjs'
export const name = 'kolay-label'
export const timeoutMs = 180_000

const build = (ids) => {
  const S = window.__store
  const p = structuredClone(S.getState().project)
  const T = { x: p.settings.width / 2, y: p.settings.height / 2, scale: 1, rotation: 0 }
  p.tracks = [
    { id: 'V1', kind: 'video', name: 'V1', clipIds: ['c1', 'c2'] },
    { id: 'A1', kind: 'audio', name: 'A1', clipIds: [] }
  ]
  p.clips = {
    c1: { id: 'c1', assetId: ids.a, trackId: 'V1', start: 0, inPoint: 0, duration: 6, transform: { ...T }, volume: 1 },
    c2: { id: 'c2', assetId: ids.b, trackId: 'V1', start: 6, inPoint: 0, duration: 5, transform: { ...T }, volume: 1 }
  }
  p.captions = []
  p.markers = []
  p.notes = []
  S.getState().setPlaying(false)
  S.getState().loadProject(p)
  S.setState({ selectedClipIds: [], pxPerSec: 80, currentTime: 0 })
}

const geometry = (id) => {
  const q = (x) => document.querySelector(`[data-testid="${x}"]`)?.getBoundingClientRect() ?? null
  const clip = q(`timeline.clip.${id}`)
  const line = q(`timeline.clip.${id}.label`)
  const name = q(`timeline.clip.${id}.name`)
  const el = document.querySelector(`[data-testid="timeline.clip.${id}"]`)
  return {
    label: document.querySelector(`[data-testid="timeline.clip.${id}.label"]`)?.dataset.label ?? null,
    lineColour: line ? getComputedStyle(document.querySelector(`[data-testid="timeline.clip.${id}.label"]`)).backgroundColor : null,
    clipColour: el ? getComputedStyle(el).backgroundColor : null,
    inside: !!line && !!clip && line.top >= clip.top && line.left >= clip.left && line.right <= clip.right && line.height >= 2 && line.height <= 4,
    clearOfName: !line || !name || line.bottom <= name.top + 0.5
  }
}

const menuSeen = () => {
  const menu = document.querySelector('[data-testid$=".label-menu"]')
  const r = menu?.getBoundingClientRect()
  const rows = [...(menu?.querySelectorAll('[role^="menuitem"]') ?? [])]
  return {
    rows: rows.map((x) => x.dataset.testid?.split('.').pop()),
    texts: rows.map((x) => x.textContent),
    checked: rows.filter((x) => x.getAttribute('aria-checked') === 'true').map((x) => x.dataset.testid?.split('.').pop()),
    swatches: menu?.querySelectorAll('.ui-menu-swatch').length ?? 0,
    cut: rows.some((x) => { const l = x.querySelector('.ui-menu-label'); return !!l && l.scrollWidth > l.clientWidth + 1 }),
    inside: !!r && r.left >= 0 && r.top >= 0 && r.right <= window.innerWidth && r.bottom <= window.innerHeight
  }
}

async function labelMenu(c, id) {
  await c.click(`timeline.clip.${id}`, { button: 'right', fx: 0.5, fy: 0.75 })
  await c.waitId(`timeline.clip.${id}.menu`)
  await c.click(`timeline.clip.${id}.menu.label`)
  await c.waitId(`timeline.clip.${id}.label-menu`)
}

export async function run({ c, app, media, lib, out }) {
  const { assert } = lib
  const dir = process.env.SNIPP_SCREENS_KOLAY ? join(APP_DIR, '..', 'tasarim', 'karsilastirma', 'kolay') : join(out, 'ekranlar-kolay')
  mkdirSync(dir, { recursive: true })
  const [a, b] = await lib.seedAssets(app, c, [media.talk, media.broll[0]])
  await c.run(build, { a: a.id, b: b.id })
  try {
    // ---- one clip: green --------------------------------------------------------
    const colour0 = (await c.run(geometry, 'c1')).clipColour
    await labelMenu(c, 'c1')
    let m = await c.run(menuSeen)
    assert.deepEqual(m.rows, ['red', 'orange', 'yellow', 'green', 'blue', 'purple', 'none'])
    assert.equal(m.swatches, 6, 'a swatch for each colour')
    assert.deepEqual(m.checked, ['none'], 'no label yet')
    assert.deepEqual(m.texts, ['Red', 'Orange', 'Yellow', 'Green', 'Blue', 'Purple', 'No label'])
    const undo0 = await c.st((s) => s.past.length)
    await c.click('timeline.clip.c1.label.green')
    await c.waitGone('timeline.clip.c1.label-menu')
    await c.waitFor('the label', () => c.st((s) => s.project.clips.c1.label === 'green'))
    assert.equal(await c.st((s) => s.past.length), undo0 + 1, 'one undo step')
    let g = await c.run(geometry, 'c1')
    assert.equal(g.label, 'green')
    assert.ok(g.inside, `the line inside the clip, thin (${JSON.stringify(g)})`)
    assert.ok(g.clearOfName, 'the line is above the name, not on it')
    assert.notEqual(g.lineColour, g.clipColour)
    const plain = await c.run(geometry, 'c2')
    assert.equal(g.clipColour, colour0, 'the clip keeps its kind\'s colour')
    assert.equal(plain.label, null)
    // Ctrl+Z takes it off, Ctrl+Shift+Z puts it back.
    await c.click('timeline.scroll', { fx: 0.9, fy: 0.9 })
    await c.key('z', ['ctrl'])
    await c.waitFor('undone', () => c.st((s) => s.project.clips.c1.label === undefined))
    await c.key('z', ['ctrl', 'shift'])
    await c.waitFor('redone', () => c.st((s) => s.project.clips.c1.label === 'green'))
    // Its menu ticks green now.
    await labelMenu(c, 'c1')
    assert.deepEqual((await c.run(menuSeen)).checked, ['green'])
    await c.key('Escape')
    await c.waitGone('timeline.clip.c1.label-menu')

    // ---- both selected: blue ----------------------------------------------------------
    await c.st((s) => s.selectClips(['c1', 'c2']))
    await labelMenu(c, 'c2')
    await c.click('timeline.clip.c2.label.blue')
    await c.waitFor('both blue', () => c.st((s) => s.project.clips.c1.label === 'blue' && s.project.clips.c2.label === 'blue'))
    g = await c.run(geometry, 'c1')
    assert.ok(g.inside && g.clearOfName, 'selected: the line still inside and clear of the name')
    // The search keeps the blue ones.
    await c.st((s) => s.setClipsLabel(['c2'], 'red'))
    await c.click('timeline.search')
    await c.waitId('timeline.search.card')
    await c.click('timeline.search.label.blue')
    await c.waitFor('only blue', async () => (await c.run(() => [...document.querySelectorAll('[data-testid^="timeline.search.hit."]')].map((h) => h.dataset.testid))).join() === 'timeline.search.hit.clip.c1')
    assert.equal(await c.attr('timeline.search.label.blue', 'aria-pressed'), 'true')
    for (const [w, h] of [[1366, 768], [1920, 1080]]) {
      await c.send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: false })
      for (const lang of ['en', 'tr']) {
        await c.st((s, l) => s.setUiLang(l), lang)
        await c.sleep(300)
        await c.shot(join(dir, `05-etiket-arama-${w}-${lang}.png`))
      }
    }
    await c.click('timeline.search.label.blue')
    await c.key('Escape')
    await c.waitGone('timeline.search.card')
    // The menu at both sizes, both languages.
    for (const [w, h] of [[1366, 768], [1920, 1080]]) {
      await c.send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: false })
      for (const lang of ['en', 'tr']) {
        await c.st((s, l) => s.setUiLang(l), lang)
        await c.sleep(200)
        await labelMenu(c, 'c1')
        m = await c.run(menuSeen)
        assert.ok(m.inside && !m.cut, `${w} ${lang}: the menu whole (${JSON.stringify(m)})`)
        if (lang === 'tr') assert.deepEqual(m.texts, ['Kırmızı', 'Turuncu', 'Sarı', 'Yeşil', 'Mavi', 'Mor', 'Etiket yok'])
        await c.shot(join(dir, `04-etiket-menu-${w}-${lang}.png`))
        await c.key('Escape')
        await c.waitGone('timeline.clip.c1.label-menu')
      }
    }
    const root = await c.run(() => [document.documentElement.scrollTop, document.documentElement.scrollHeight - document.documentElement.clientHeight])
    assert.deepEqual(root, [0, 0])
  } finally {
    await c.send('Emulation.setDeviceMetricsOverride', { width: 1920, height: 1080, deviceScaleFactor: 1, mobile: false }).catch(() => null)
    await c.st((s) => s.setUiLang('en')).catch(() => null)
  }
}
