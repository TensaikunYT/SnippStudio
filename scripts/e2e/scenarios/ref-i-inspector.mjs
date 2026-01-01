// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// REF-AB, worker I (REF-AB-PLAN-I.md): the Inspector, driven as a user would.
//   - item 2: a card's ↺ puts it back as one undo step (off on a clean card);
//     a value's ‹ › go from key to key, quiet with none that way; its ◇
//     takes away the key the playhead is on;
//   - item 3: the scale's lock mark is shown;
//   - item 4: the Curve part's tiles write a shape (and "No curve" goes back
//     to one speed), the tile of the curve is marked; a typed length sets the
//     speed, one undo step;
//   - item 9: the animations' grid: a tile sets the entrance, the search and
//     the kinds narrow it, a pointed-at tile plays (its picture changes);
//   - in both languages, no tile's name is cut.
import { join } from 'node:path'
export const name = 'ref-i-inspector'

/** With REFI_SHOTS=<folder>: pictures of the cards, to look at. */
const shot = async (c, what) => {
  if (process.env.REFI_SHOTS) await c.shot(join(process.env.REFI_SHOTS, `${what}.png`))
}

export async function run({ c, app, media, lib }) {
  const { assert } = lib
  const [film] = await lib.seedAssets(app, c, [media.talk])
  await lib.seedTimeline(c, [film.id])
  const [clip] = await lib.clipList(c)
  const id = clip.id
  // Speed is not a clip's main card (folded by default): opened as a user would.
  await lib.openCards(c, ['Speed'])
  await c.click(`timeline.clip.${id}`, { fx: 0.5 })
  await c.click('inspector.tab.subs')
  await c.click('inspector.tab.clip')
  await c.waitId('inspector.card.transform')
  const show = (tid) => c.run((s) => document.querySelector(s)?.scrollIntoView({ block: 'center' }), `[data-testid="${tid}"]`)
  const k = (fn) => c.st(fn, id)
  const disabled = (tid) => c.run((s) => document.querySelector(s)?.disabled ?? null, `[data-testid="${tid}"]`)
  const depth = () => lib.undoDepth(c)

  // ---- item 2: a card's reset -----------------------------------------------------------
  assert.equal(await disabled('inspector.card.transform.reset'), true, 'a clean Transform card: its reset is off')
  await c.st((s, id) => { s.setTime(s.project.clips[id].start + 1); s.setPropValue(id, 'scale', 1.6); s.setPropValue(id, 'rotation', 0.4) }, id)
  await c.waitFor('the reset on', async () => (await disabled('inspector.card.transform.reset')) === false)
  const d0 = await depth()
  await c.click('inspector.card.transform.reset')
  await c.waitFor('the transform back', async () => (await k((s, id) => s.project.clips[id].transform.rotation)) === 0)
  assert.equal(await depth(), d0 + 1, 'one undo step')
  await c.st((s) => s.undo())
  assert.ok(lib.near(await k((s, id) => s.project.clips[id].transform.rotation), 0.4, 1e-6), 'undo gives it back')
  await c.st((s) => s.redo())

  // ---- item 2: ‹ ◇ › ------------------------------------------------------------------------
  const start = clip.start
  await c.st((s, id, t0) => { for (const t of [1, 3]) { s.setTime(t0 + t); s.addPropKeyframe(id, 'scale') } s.setTime(t0 + 2) }, id, start)
  await show('inspector.clip.scale.key')
  await c.waitFor('both arrows on', async () => (await disabled('inspector.clip.scale.key.prev')) === false && (await disabled('inspector.clip.scale.key.next')) === false)
  await c.click('inspector.clip.scale.key.next')
  await c.waitFor('on the key at 3 s', async () => lib.near(await c.st((s) => s.currentTime), start + 3, 0.02))
  await c.waitFor('nothing after the last key', async () => (await disabled('inspector.clip.scale.key.next')) === true)
  assert.equal(await disabled('inspector.clip.rotation.key.prev'), true, 'a value with no keys: its arrows are quiet')
  await c.click('inspector.clip.scale.key.prev')
  await c.waitFor('on the key at 1 s', async () => lib.near(await c.st((s) => s.currentTime), start + 1, 0.02))
  await shot(c, '1-transform')
  await c.click('inspector.clip.scale.key')
  await c.waitFor('the key taken away', async () => (await k((s, id) => s.project.clips[id].channels?.scale?.length ?? 0)) === 1)

  // ---- item 3 ------------------------------------------------------------------------------------
  // (kullanım, item 4: one scale, no lock to show; the "locked" line is gone.)
  assert.equal(await c.has('inspector.clip.scale.locked'), false, 'no lock line')

  // ---- item 4: the ready curves and the length ------------------------------------------------------
  await show('inspector.clip.speed.length')
  const media0 = await k((s, id) => s.project.clips[id].duration * (s.project.clips[id].speed ?? 1))
  const d1 = await depth()
  await c.fill('inspector.clip.speed.length', (media0 / 2).toFixed(2), { enter: true })
  await c.waitFor('twice the speed', async () => lib.near(await k((s, id) => s.project.clips[id].speed ?? 1), 2, 0.01))
  assert.equal(await depth(), d1 + 1, 'a typed length: one undo step')
  await c.st((s) => s.undo())
  await show('inspector.clip.speed.mode')
  await c.click('inspector.clip.speed.mode.curve')
  await c.waitId('inspector.clip.speed.shapes')
  await show('inspector.clip.speed.curve.preset.timestop')
  await c.click('inspector.clip.speed.curve.preset.timestop')
  await c.waitFor('the shape written', async () => (await k((s, id) => s.project.clips[id].speedCurve?.keys.length ?? 0)) === 4)
  await c.waitFor('its tile marked', async () => (await c.attr('inspector.clip.speed.curve.preset.timestop', 'aria-pressed')) === 'true')
  await shot(c, '2-curve')
  await c.click('inspector.clip.speed.curve.preset.none')
  await c.waitFor('one speed again', async () => (await k((s, id) => !!s.project.clips[id].speedCurve)) === false)

  // ---- item 9: the animations' grid -------------------------------------------------------------------
  await c.run(() => {
    const state = JSON.parse(localStorage.getItem('snipp-sections') ?? '{}')
    state.Motion = true
    localStorage.setItem('snipp-sections', JSON.stringify(state))
  })
  await c.click('inspector.tab.subs')
  await c.click('inspector.tab.clip')
  await c.waitId('inspector.card.motion')
  if (!(await c.has('inspector.clip.motion.grid'))) await c.click('inspector.card.motion.head')
  await show('inspector.clip.motion.grid')
  const tiles = async () => (await c.ids('inspector.clip.motion.tile.')).length
  assert.equal(await tiles(), 17, 'none and the sixteen entrances')
  await c.fill('inspector.clip.motion.search', 'zoom')
  await c.waitFor('two zooms', async () => (await tiles()) === 2)
  await c.fill('inspector.clip.motion.search', '')
  await c.click('inspector.clip.motion.kind.slide')
  await c.waitFor('four slides', async () => (await tiles()) === 4)
  await c.click('inspector.clip.motion.kind.all')
  await c.waitFor('all again', async () => (await tiles()) === 17)
  // A pointed-at tile plays: its picture changes.
  const pic = (tid) => c.run((s) => { const cv = document.querySelector(s + ' canvas'); return cv ? cv.toDataURL().length + ':' + cv.toDataURL().slice(-80) : null }, `[data-testid="${tid}"]`)
  await show('inspector.clip.motion.tile.spin')
  const b = await c.box('inspector.clip.motion.tile.spin')
  const still = await pic('inspector.clip.motion.tile.spin')
  assert.ok(still, 'the tile has a picture')
  await c.mouse('mouseMoved', b.cx, b.cy)
  await c.waitFor('the tile plays', async () => (await pic('inspector.clip.motion.tile.spin')) !== still, 4000)
  await shot(c, '3-anim')
  await c.click('inspector.clip.motion.tile.fade')
  await c.waitFor('the entrance set', async () => (await k((s, id) => s.project.clips[id].anim?.in)) === 'fade')
  assert.equal(await c.attr('inspector.clip.motion.tile.fade', 'aria-pressed'), 'true')
  assert.equal(await c.value('inspector.clip.motion.in'), 'fade', 'the list says the same')
  await c.click('inspector.clip.motion.part.idle')
  await c.waitFor('the motion all through', async () => (await tiles()) === 5)

  // ---- names in both languages ------------------------------------------------------------------------
  const cut = () =>
    c.run(() => [...document.querySelectorAll('.insp-anim-name, .insp-shape-name')].filter((e) => e.scrollHeight > e.clientHeight + 1 || e.scrollWidth > e.clientWidth + 1).map((e) => e.textContent))
  await c.click('inspector.clip.motion.part.in')
  await c.st((s, id) => s.setClipSpeedCurve(id, { points: [{ u: 0, v: 1 }, { u: 1, v: 2 }] }), id)
  for (const lang of ['en', 'tr']) {
    await c.run((l) => window.__store.getState().setUiLang(l), lang)
    await c.sleep(200)
    assert.deepEqual(await cut(), [], `no name cut (${lang})`)
    await show('inspector.clip.speed.shapes')
    await shot(c, `4-speed-${lang}`)
  }
  await c.run(() => window.__store.getState().setUiLang('en'))
}
