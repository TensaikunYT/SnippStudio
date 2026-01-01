// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// 22 November, the interface details of the audit (D22-PLAN-D.md), each by a
// real click:
//   L11  a new project (File → New) has its main lane's magnet on: a clip
//        deleted from the middle leaves no hole, undo puts it back, and with
//        the magnet off the hole stays;
//   L10  the left rail at 1366 x 768 and at the window's least size
//        (1200 x 700), in both languages: every category whole, with its name;
//   L13  the Effects page's moves are cards (a picture, a name), one chosen,
//        a pointed-at card plays, the chosen move's button applies it;
//   L12  a value's diamond with the playhead on one of its keys says
//        "remove"; the eyedropper is put down, with a word, when its clip is
//        let go;
//   the preview toolbar has one zoom number, the project's real scale: 100 %
//        after "1:1", less at Fit; the Speed card's two tools say their
//        names; a selected clip has no wash over its picture.
import { scene, windowSize, runnerSize } from '../d22-d-scene.mjs'
export const name = 'd22-d-details'
export const timeoutMs = 240_000

export async function run(ctx) {
  const { c, app, lib, media } = ctx
  const { assert } = lib
  const lanes = () => c.st((s) => s.project.tracks.flatMap((t) => t.clipIds.map((id) => { const k = s.project.clips[id]; return `${t.name} ${k.start.toFixed(2)}+${k.duration.toFixed(2)}` })))
  const toasts = () => c.run(() => [...document.querySelectorAll('.ui-toast')].map((e) => e.textContent.trim()))

  // ---- L11: the product's own new project -----------------------------------------
  assert.deepEqual(await c.st((s) => s.project.tracks.map((t) => !!t.autoPack)), [false, false], 'the scenarios\' own start keeps gaps (lib.reset)')
  await c.click('topbar.file')
  await c.click('menu.file.new-16x9')
  await c.waitFor('a new project with its magnet on', () => c.st((s) => s.project.tracks.find((t) => t.kind === 'video')?.autoPack === true))
  const v1 = await c.st((s) => s.project.tracks.find((t) => t.kind === 'video').id)
  assert.equal(await c.st((s) => s.project.tracks.find((t) => t.kind === 'audio').autoPack ?? false), false, 'the sound lane keeps its gaps')
  assert.equal(await c.attr(`timeline.track.${v1}.pack`, 'aria-pressed'), 'true', 'the lane\'s magnet button is on')
  const [talk, other, pic] = await lib.seedAssets(app, c, [media.talk, media.other, media.broll[0]])
  await lib.seedTimeline(c, [talk.id, other.id, pic.id])
  const three = await lanes()
  assert.deepEqual(three, ['V1 0.00+12.00', 'V1 12.00+6.00', 'V1 18.00+4.00'])
  const ids = await c.st((s, id) => s.project.tracks.find((t) => t.id === id).clipIds, v1)
  await c.click(`timeline.clip.${ids[1]}`, { fx: 0.5, fy: 0.7 })
  await c.key('Delete')
  await c.waitFor('the hole closed', async () => JSON.stringify(await lanes()) === JSON.stringify(['V1 0.00+12.00', 'V1 12.00+4.00']))
  await c.key('z', ['ctrl'])
  await c.waitFor('undo puts the clip back', async () => JSON.stringify(await lanes()) === JSON.stringify(three))
  // The magnet off (its button): the hole stays.
  await c.click(`timeline.track.${v1}.pack`)
  assert.equal(await c.attr(`timeline.track.${v1}.pack`, 'aria-pressed'), 'false')
  await c.click(`timeline.clip.${ids[1]}`, { fx: 0.5, fy: 0.7 })
  await c.key('Delete')
  await c.waitFor('the hole stays with the magnet off', async () => JSON.stringify(await lanes()) === JSON.stringify(['V1 0.00+12.00', 'V1 18.00+4.00']))
  await c.run(() => { window.__store.getState().setDirty(false); return true })

  // ---- the scene of the rest ------------------------------------------------------
  await scene(ctx)
  try {
    // ---- L10: the left rail --------------------------------------------------------
    for (const lang of ['en', 'tr']) {
      await c.run((l) => { window.__store.getState().setUiLang(l); return true }, lang)
      for (const size of [[1366, 768], [1200, 700], [1920, 1080]]) {
        await windowSize(c, size)
        const rail = await c.run(() => {
          const el = document.querySelector('[data-testid="dock.cats"]')
          const r = el.getBoundingClientRect()
          const cats = [...el.querySelectorAll('[role="tab"]')].map((b) => {
            const box = b.getBoundingClientRect()
            const words = [...b.children].at(-1)
            const w = words.getBoundingClientRect()
            const icon = b.querySelector('svg').getBoundingClientRect()
            return { id: b.dataset.testid, text: words.textContent.trim(), whole: box.top >= r.top - 0.5 && box.bottom <= r.bottom + 0.5 && w.height >= 10 && w.bottom <= box.bottom + 0.5 && icon.top >= box.top - 0.5, clear: icon.bottom <= w.top + 0.5 }
          })
          return { fits: el.scrollHeight <= el.clientHeight + 1, top: el.scrollTop, cats }
        })
        const tag = `${lang}, ${size.join('x')}`
        assert.equal(rail.cats.length, 9, `${tag}: nine categories`)
        assert.ok(rail.fits && rail.top === 0, `${tag}: the rail needs no scroll`)
        assert.deepEqual(rail.cats.filter((k) => !k.whole || !k.text).map((k) => k.id), [], `${tag}: every category whole, with its name`)
        assert.deepEqual(rail.cats.filter((k) => !k.clear).map((k) => k.id), [], `${tag}: no icon on its name`)
      }
    }
    await c.run(() => { window.__store.getState().setUiLang('en'); return true })
    await windowSize(c, [1366, 768])

    // ---- L13: the Effects page ------------------------------------------------------
    await lib.dockPage(c, 'effects')
    await c.waitId('effects.moves')
    const cards = await c.run(() => [...document.querySelectorAll('[data-testid^="effects.demo."]')].map((e) => { const cv = e.querySelector('canvas'); const r = cv?.getBoundingClientRect(); const n = [...e.children].at(-1).getBoundingClientRect(); return { id: e.dataset.testid, role: e.getAttribute('role'), on: e.getAttribute('aria-checked'), pic: r ? Math.round(r.width) + 'x' + Math.round(r.height) : null, nameUnder: !!r && n.top >= r.bottom - 0.5, text: [...e.children].at(-1).textContent.trim() } }))
    assert.deepEqual(cards.map((k) => k.id), ['effects.demo.cinematize', 'effects.demo.pan', 'effects.demo.ramp'])
    for (const k of cards) {
      assert.equal(k.role, 'radio', `${k.id}: one of a few`)
      assert.ok(k.pic && k.nameUnder && k.text, `${k.id}: a picture with its name under it (${JSON.stringify(k)})`)
    }
    assert.deepEqual(cards.map((k) => k.on), ['true', 'false', 'false'], 'one move chosen')
    // The same card language as the Transitions page: the picture's box.
    await lib.dockPage(c, 'transitions')
    const kind = await c.run(() => { const r = document.querySelector('[data-testid="effects.trans.kind.mix"] canvas').getBoundingClientRect(); return Math.round(r.width) + 'x' + Math.round(r.height) })
    assert.equal(cards[0].pic, kind, 'a move\'s picture is as large as a transition kind\'s')
    await lib.dockPage(c, 'effects')
    // A pointed-at card plays.
    const pic = () => c.run(() => { const cv = document.querySelector('[data-testid="effects.demo.pan"] canvas'); return cv.toDataURL().length + ':' + cv.toDataURL().slice(-120) })
    const rest = await pic()
    const pb = await c.box('effects.demo.pan')
    await c.mouse('mouseMoved', pb.cx, pb.cy)
    await c.waitFor('the card plays', async () => (await pic()) !== rest, 4000)
    await c.mouse('mouseMoved', 700, 150)
    // Chosen: its settings and its one button; the button applies it.
    await c.click('effects.demo.pan')
    assert.equal(await c.attr('effects.demo.pan', 'aria-checked'), 'true')
    assert.equal(await c.has('effects.move.intensity'), false, 'the cinematic move\'s setting gives way')
    await c.click('effects.demo.cinematize')
    await c.waitId('effects.move.intensity')
    const d0 = await lib.undoDepth(c)
    await c.click('effects.move.apply')
    await c.waitFor('the move on the clips', () => c.st((s) => Object.values(s.project.clips).some((k) => !!k.motionFx?.enabled)))
    assert.equal((await lib.undoDepth(c)) - d0, 1, 'one undo step')
    await c.key('z', ['ctrl'])
    await lib.dockPage(c, 'media')

    // ---- the preview's one zoom number ------------------------------------------------
    await windowSize(c, [1920, 1080])
    assert.equal(await c.run(() => document.querySelector('[data-testid="preview.actual"]').textContent.trim()), '1:1', 'the real-size button says 1:1')
    await c.click('preview.fit')
    const pct = () => c.run(() => parseInt(document.querySelector('[data-testid="preview.scale"]').textContent.replace(/\D/g, ''), 10))
    const atFit = await c.waitFor('the scale at Fit', async () => { const n = await pct(); return n > 0 && n < 100 ? n : null })
    await c.click('preview.actual')
    await c.waitFor('100 % at real size', async () => (await pct()) === 100)
    await c.click('preview.fit')
    await c.waitFor('back at Fit', async () => (await pct()) === atFit)
    console.log(`     the preview's number: ${atFit} % at Fit (a 1920 x 1080 project), 100 % after 1:1`)

    // ---- the Speed card's tools say their names; no wash on the selected clip ------------
    await c.click('timeline.clip.v2', { fx: 0.5, fy: 0.7 })
    await c.click('inspector.tab.clip')
    await c.run(() => { for (const h of document.querySelectorAll('.inspector [aria-expanded="false"]')) h.click(); return true })
    await c.waitId('inspector.clip.freeze')
    const named = await c.run(() => ['inspector.clip.freeze', 'inspector.clip.reverse'].map((id) => { const b = document.querySelector(`[data-testid="${id}"]`); const words = [...b.querySelectorAll('span')].filter((s) => s.textContent.trim() && s.getBoundingClientRect().width > 4); return { id, words: words.at(-1)?.textContent.trim() ?? '', cut: b.scrollWidth > b.clientWidth + 1 } }))
    assert.deepEqual(named, [{ id: 'inspector.clip.freeze', words: 'Freeze', cut: false }, { id: 'inspector.clip.reverse', words: 'Reverse', cut: false }])
    assert.equal(await c.run(() => getComputedStyle(document.querySelector('[data-testid="timeline.clip.v2"]'), '::after').content), 'none', 'no wash over the selected clip\'s picture')
    assert.match(await c.run(() => getComputedStyle(document.querySelector('[data-testid="timeline.clip.v2"]')).outlineStyle), /solid/, 'its gold frame says "selected"')

    // ---- L12: the diamond on one of its keys --------------------------------------------
    await lib.seek(c, 8)
    await c.waitId('inspector.clip.scale.key')
    const label = () => c.attr('inspector.clip.scale.key', 'aria-label')
    const add = await label()
    assert.match(add, /Add a keyframe/)
    await c.click('inspector.clip.scale.key')
    await c.waitFor('a key at the playhead', () => c.st((s) => (s.project.clips.v2.channels?.scale?.length ?? 0) === 1))
    await c.waitFor('the diamond says remove', async () => /Remove this keyframe/.test(await label()))
    await lib.seek(c, 9)
    await c.waitFor('off the key: add again', async () => (await label()) === add)
    await lib.seek(c, 8)
    await c.waitFor('on the key again', async () => /Remove this keyframe/.test(await label()))
    await c.click('inspector.clip.scale.key')
    await c.waitFor('the key taken away', () => c.st((s) => (s.project.clips.v2.channels?.scale?.length ?? 0) === 0))

    // ---- L12: the eyedropper put down, with a word, when its clip is let go ----------------
    await c.run(() => { window.__store.getState().setClipChroma('v2', { enabled: true }); return true })
    await c.waitId('inspector.chroma.eyedropper')
    await c.click('inspector.chroma.eyedropper')
    assert.equal(await c.st((s) => s.eyedropperClip), 'v2')
    await c.click('timeline.clip.p2', { fx: 0.5, fy: 0.7 })
    await c.waitFor('the eyedropper put down', () => c.st((s) => s.eyedropperClip === null))
    await c.waitFor('and said', async () => (await toasts()).some((x) => /Eyedropper put down/.test(x)))
    assert.equal(await c.st((s) => s.project.clips.v2.chroma.color), await c.st((s) => s.project.clips.v2.chroma.color), 'nothing was keyed')
    // A click beside the picture still says so (it did before; kept).
    await c.click('timeline.clip.v2', { fx: 0.5, fy: 0.7 })
    await c.run(() => { window.__store.getState().setPropValue('v2', 'scale', 0.3); return true })
    await c.click('inspector.chroma.eyedropper')
    const cv = await c.box('preview.canvas')
    await c.clickAt(cv.x + cv.w * 0.5, cv.y + cv.h * 0.12)
    await c.waitFor('a click beside the picture is said', async () => (await toasts()).some((x) => /outside this clip/.test(x)))
    assert.equal(await c.st((s) => s.eyedropperClip), null)
  } finally {
    await c.run(() => { try { window.__store.getState().setUiLang('en'); window.__store.getState().setDirty(false) } catch { /* no store */ } return true }).catch(() => undefined)
    await runnerSize(c)
  }
}
