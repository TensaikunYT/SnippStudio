// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// Worker "kolay", item 2 (SnippStudio KOLAY-PLAN.md): searching the timeline.
//   - The toolbar's search opens a card: typed words list the hits (an icon,
//     the name, the time) in timeline order: clips by name, subtitles,
//     texts, markers, notes.
//   - The arrows go through them, Enter goes to one: the playhead there, the
//     timeline scrolled sideways to it (its own scroll; the page does not
//     move), the clip selected. Escape closes. Ctrl+F opens it (when the
//     Transcript panel is not on screen). The project is not changed.
//   - 1366 × 768 and 1920 × 1080, English and Turkish: the card inside the
//     window, no name cut but by its ellipsis. Screenshots to
//     tasarim\karsilastirma\kolay when SNIPP_SCREENS_KOLAY is set.
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { APP_DIR } from '../app.mjs'
export const name = 'kolay-search'
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
    c1: { id: 'c1', assetId: ids.a, trackId: 'V1', start: 0, inPoint: 0, duration: 8, transform: { ...T }, volume: 1 },
    c2: { id: 'c2', assetId: ids.b, trackId: 'V1', start: 60, inPoint: 0, duration: 6, transform: { ...T }, volume: 1 }
  }
  p.captions = [
    { id: 's1', start: 2, end: 4, text: 'the quokka over the river at dawn' },
    { id: 't1', start: 30, end: 33, text: 'Chapter two: the quokka', manual: true, layer: 1 }
  ]
  p.markers = [{ id: 'm1', time: 45, color: '#e0b050', note: 'quokka music drop', label: 'Drop' }]
  p.notes = []
  S.getState().setPlaying(false)
  S.getState().loadProject(p)
  S.setState({ selectedClipIds: [], pxPerSec: 120, currentTime: 0 })
}

const seen = () => {
  const q = (id) => document.querySelector(`[data-testid="${id}"]`)
  const card = q('timeline.search.card')
  const r = card?.getBoundingClientRect()
  const hits = [...document.querySelectorAll('[data-testid^="timeline.search.hit."]')]
  return {
    open: !!card,
    hits: hits.map((h) => h.dataset.testid.replace('timeline.search.hit.', '')),
    active: hits.findIndex((h) => h.classList.contains('is-active')),
    texts: hits.map((h) => h.textContent),
    // (A name may end in its ellipsis; the time and the icon may not be cut.)
    cut: hits.some((h) => { const t = h.querySelector('.tsr-time'); return !!t && t.scrollWidth > t.clientWidth + 1 }) || (!!r && [...card.querySelectorAll('.tsr-hit')].some((h) => h.getBoundingClientRect().right > r.right + 0.5)),
    inside: !!r && r.left >= 0 && r.top >= 0 && r.right <= window.innerWidth && r.bottom <= window.innerHeight,
    scrollLeft: q('timeline.scroll')?.scrollLeft ?? null,
    root: [document.documentElement.scrollTop, document.documentElement.scrollHeight - document.documentElement.clientHeight]
  }
}

export async function run({ c, app, media, lib, out }) {
  const { assert } = lib
  const dir = process.env.SNIPP_SCREENS_KOLAY ? join(APP_DIR, '..', 'tasarim', 'karsilastirma', 'kolay') : join(out, 'ekranlar-kolay')
  mkdirSync(dir, { recursive: true })
  const [a, b] = await lib.seedAssets(app, c, [media.talk, media.broll[0]])
  await c.run(build, { a: a.id, b: b.id })
  const bName = await c.run((id) => window.__store.getState().project.assets.find((x) => x.id === id).name, b.id)
  const before = await c.run(() => JSON.stringify(window.__store.getState().project))
  try {
    await c.click('timeline.search')
    await c.waitId('timeline.search.card')
    await c.waitFor('the field has the focus', () => c.run(() => document.activeElement?.dataset?.testid === 'timeline.search.input'))
    await c.type('quokka')
    await c.waitFor('the hits', async () => (await c.run(seen)).hits.length > 0).catch(async (e) => { console.log('    seen:', JSON.stringify(await c.run(seen)), await c.run(() => document.activeElement?.outerHTML?.slice(0, 200))); throw e })
    await c.sleep(200)
    let s = await c.run(seen)
    assert.deepEqual(s.hits, ['subtitle.s1', 'text.t1', 'marker.m1'], `subtitle, text, marker in timeline order: ${JSON.stringify(s.hits)} ${JSON.stringify(await c.st((x) => x.project.markers))}`)
    assert.match(s.texts[0], /the quokka over the river at dawn0:02\.0$/)
    // A clip by its media's name: the second clip, a minute in.
    await c.fill('timeline.search.input', bName.replace(/\.[^.]+$/, '').toUpperCase())
    await c.waitFor('the clip', async () => (await c.run(seen)).hits.includes('clip.c2'))
    s = await c.run(seen)
    const i = s.hits.indexOf('clip.c2')
    for (let k = 0; k < i; k++) await c.key('ArrowDown')
    await c.key('Enter')
    await c.waitFor('the playhead at the clip', () => c.st((st) => Math.abs(st.currentTime - 60) < 1e-6))
    const st = await c.st((x) => ({ sel: x.selectedClipIds, t: x.currentTime }))
    assert.deepEqual(st.sel, ['c2'], 'the clip is selected')
    s = await c.run(seen)
    assert.ok(s.scrollLeft > 60 * 120 - 2000, `the timeline scrolled to it (${s.scrollLeft})`)
    const clipBox = await c.box('timeline.clip.c2')
    const scrollBox = await c.box('timeline.scroll')
    assert.ok(clipBox.x >= scrollBox.x && clipBox.x < scrollBox.x + scrollBox.w, 'the clip is in view')
    assert.deepEqual(s.root, [0, 0], 'the page did not move')
    // The arrows: up goes to the hit before and the playhead with it.
    await c.fill('timeline.search.input', 'quokka')
    await c.waitFor('three hits', async () => (await c.run(seen)).hits.length === 3)
    await c.key('ArrowDown')
    await c.waitFor('on the text', () => c.st((x) => Math.abs(x.currentTime - 30) < 1e-6))
    await c.key('ArrowDown')
    await c.waitFor('on the marker', () => c.st((x) => Math.abs(x.currentTime - 45) < 1e-6))
    assert.equal((await c.run(seen)).active, 2)
    // Screens: both sizes, both languages.
    for (const [w, h] of [[1366, 768], [1920, 1080]]) {
      await c.send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: false })
      for (const lang of ['en', 'tr']) {
        await c.st((x, l) => x.setUiLang(l), lang)
        await c.sleep(300)
        s = await c.run(seen)
        assert.ok(s.open && s.inside, `${w} ${lang}: the card inside the window (${JSON.stringify(s)})`)
        assert.ok(!s.cut, `${w} ${lang}: nothing cut`)
        assert.deepEqual(s.root, [0, 0])
        await c.shot(join(dir, `03-arama-${w}-${lang}.png`))
      }
    }
    await c.send('Emulation.setDeviceMetricsOverride', { width: 1920, height: 1080, deviceScaleFactor: 1, mobile: false })
    await c.st((x) => x.setUiLang('en'))
    // Nothing found says so.
    await c.fill('timeline.search.input', 'zebra crossing')
    await c.waitId('timeline.search.none')
    await c.key('Escape')
    await c.waitGone('timeline.search.card')
    // Ctrl+F opens it again (the Transcript panel not on screen).
    const transcript = await c.run(() => { const el = document.querySelector('.transcript-root'); return !!el && el.getClientRects().length > 0 })
    if (!transcript) {
      await c.click('timeline.scroll', { fx: 0.5, fy: 0.05 })
      await c.key('f', ['ctrl'])
      await c.waitId('timeline.search.card')
      await c.key('Escape')
      await c.waitGone('timeline.search.card')
    } else console.log('    the Transcript panel is on screen: Ctrl+F is its own (not tried here)')
    const after = await c.run(() => JSON.stringify(window.__store.getState().project))
    assert.equal(after, before, 'the project is not changed')
  } finally {
    await c.send('Emulation.setDeviceMetricsOverride', { width: 1920, height: 1080, deviceScaleFactor: 1, mobile: false }).catch(() => null)
    await c.st((x) => x.setUiLang('en')).catch(() => null)
  }
}
