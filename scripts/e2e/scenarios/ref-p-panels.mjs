// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// REF-AB, worker P2 (REF-AB-PLAN-P.md):
//  - the Projects window first at launch (nothing to recover, nothing handed
//    over), its switch in Settings → General;
//  - the media panel: "in the timeline" badge, search (and its empty state),
//    order;
//  - Effects, Transitions, Filters: search by name and group, a bookmark that
//    makes a favourite, the recents, kept in the profile;
//  - the empty states' pictures.
export const name = 'ref-p-panels'

export async function run({ c, app, media, lib }) {
  const { assert } = lib

  // ---- the Projects window at launch --------------------------------------------------
  await c.run(() => { localStorage.setItem('snipp-home-at-launch', '1'); window.__store.getState().setDirty(false); return true })
  await c.send('Page.reload', { ignoreCache: false })
  await lib.ready(c)
  let recovered = false
  for (let i = 0; i < 10; i++) {
    if (await c.has('ask.recovery')) {
      recovered = true
      await c.click('ask.recovery.discard')
      break
    }
    if (await c.has('home.panel')) break
    await c.sleep(100)
  }
  if (!recovered) {
    await c.waitId('home.panel', 6000)
    const empty = await c.run(async () => (await window.api.recentsRead())?.length ?? null).catch(() => null)
    if (empty === 0) assert.ok(await c.has('home.first'), 'an empty list: the first project to start')
    // No tour over it (the tour of a first run waits for the window).
    assert.equal(await c.has('tour'), false, 'no tour over the Projects window')
    await c.click('home.close')
    await c.waitGone('home.panel')
  }
  await c.run(() => { localStorage.setItem('snipp-home-at-launch', '0'); return true })
  // Its switch in Settings → General.
  await c.click('topbar.settings')
  await c.waitId('settings.general.homeAtLaunch')
  assert.equal(await c.attr('settings.general.homeAtLaunch', 'aria-checked'), 'false', 'the switch says what the profile keeps')
  await c.key('Escape')
  await c.waitGone('settings.general.homeAtLaunch')

  // ---- the media panel ---------------------------------------------------------------
  await lib.reset(c)
  const [one, two] = await lib.seedAssets(app, c, [media.talk, media.other])
  await lib.seedTimeline(c, [one.id])
  await lib.dockPage(c, 'media')
  await c.waitId(`media.used.${one.id}`)
  assert.equal(await c.has(`media.used.${two.id}`), false, 'not in the timeline: no badge')
  // Search by name.
  const twoName = await c.st((s, id) => s.project.assets.find((a) => a.id === id).name, two.id)
  await c.fill('media.search', twoName.slice(0, 5))
  await c.waitGone(`media.item.${one.id}`)
  assert.ok(await c.has(`media.item.${two.id}`), 'the match stays')
  await c.fill('media.search', 'zzqqxx')
  await c.waitId('media.nomatch')
  await c.click('media.nomatch.action')
  await c.waitId(`media.item.${one.id}`)
  // The order by name.
  await c.select('media.sort', 'name')
  const order = await c.run(() => [...document.querySelectorAll('[data-testid^="media.item."]')].filter((e) => /^media\.item\.[^.]+$/.test(e.dataset.testid)).map((e) => e.querySelector('.name')?.textContent ?? ''))
  assert.deepEqual(order, [...order].sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' })), `by name: ${order.join(', ')}`)
  assert.equal(await c.run(() => localStorage.getItem('snipp-bin-sort')), 'name', 'the order is kept by the profile')

  // ---- Transitions: search, a favourite, the recents ---------------------------------
  await lib.dockPage(c, 'transitions')
  await c.waitId('transitions.pick')
  await c.fill('transitions.pick.search', 'zoom')
  await c.waitGone('effects.trans.kind.mix')
  assert.ok(await c.has('effects.trans.kind.zoom'), 'the match by name')
  await c.click('pick.transitions.fav.zoom')
  assert.equal(await c.attr('pick.transitions.fav.zoom', 'aria-pressed'), 'true', 'the bookmark is on')
  await c.fill('transitions.pick.search', '')
  await c.click('transitions.pick.mode.fav')
  await c.waitGone('effects.trans.kind.mix')
  assert.ok(await c.has('effects.trans.kind.zoom'), 'the favourite')
  await c.click('transitions.pick.mode.recent')
  await c.waitId('transitions.pick.empty')
  await c.click('transitions.pick.empty.action')
  await c.waitId('effects.trans.kind.slide')
  await c.click('effects.trans.kind.slide')
  await c.click('transitions.pick.mode.recent')
  await c.waitId('effects.trans.kind.slide')
  assert.equal(await c.has('effects.trans.kind.mix'), false, 'only what was used')
  await c.click('transitions.pick.mode.all')
  await c.fill('transitions.pick.search', 'qqqzz')
  await c.waitId('transitions.pick.empty')
  await c.click('transitions.pick.empty.action')
  await c.waitId('effects.trans.kind.mix')
  const kept = await c.run(() => JSON.parse(localStorage.getItem('snipp-picks') || '{}'))
  assert.deepEqual(kept.fav?.transitions, ['zoom'], 'the favourite kept by the profile')
  assert.equal(kept.recent?.transitions?.[0], 'slide', 'the last used first')
  // The project holds none of it.
  assert.equal(await c.st((s) => JSON.stringify(s.project).includes('snipp-picks')), false)

  // ---- Effects: the moves searched (the shapes are the Text page's since the
  // Text panel was rebuilt: YAZI-PANELI-PLAN.md §5) ------------------------------------
  await lib.dockPage(c, 'effects')
  await c.waitId('effects.pick')
  await c.fill('effects.pick.search', 'pan')
  await c.waitId('effects.demo.pan')
  assert.equal(await c.has('effects.demo.cinematize'), false, 'a move that does not match is hidden')
  assert.equal(await c.has('shapes.add.arrow'), false, 'no shapes on the Effects page')
  await c.fill('effects.pick.search', '')
  await c.waitId('effects.demo.cinematize')

  // ---- Filters: no match -------------------------------------------------------------
  await lib.dockPage(c, 'filters')
  await c.waitId('filters.pick')
  await c.fill('filters.pick.search', 'qqqzz')
  await c.waitId('filters.pick.empty')
  const art = await c.run(() => document.querySelector('[data-testid="filters.pick.empty"] svg.empty-art')?.dataset.art)
  assert.equal(art, 'search', 'the empty state has its picture')
  await c.click('filters.pick.empty.action')
  await c.waitId('inspector.color.looks')

  // ---- an empty media panel: its picture ------------------------------------------------
  await lib.reset(c)
  await lib.dockPage(c, 'media')
  await c.waitId('media.empty')
  assert.equal(await c.run(() => document.querySelector('[data-testid="media.empty"] svg.empty-art')?.dataset.art), 'media')
  console.log(`     projects at launch ${recovered ? '(a snapshot was offered first)' : 'shown'}; media badge, search, order; picks kept`)
}
