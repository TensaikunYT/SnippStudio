// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// Shared steps for the scenarios. Setting a scene up may go through the store
// (window.__store) or the test-only bridge; the step a scenario is about goes
// through the window: clicks, drags and keys on elements found by test name.
import assert from 'node:assert/strict'
export { assert }

/** Waits until the editor is drawn and its store is there. */
export async function ready(c, timeout = 20000) {
  await c.waitFor('the editor', () => c.ev(`!!(window.__store && document.querySelector('[data-testid="topbar.file"]'))`), timeout, 150)
}

/** The editor with nothing over it, in a profile's first window: since REF-AB
 *  a new profile opens the Projects window first, which covers the editor
 *  (the speed measurements wheel and drag on the timeline: scripts/perf; found
 *  on 22 November, `tl.pan: the view scrolled 0 px`). Off, as `reset` has it
 *  for the scenarios, and the page again. */
export async function editorAlone(c) {
  await c.ev(`(() => { try { localStorage.setItem('snipp-home-at-launch', '0') } catch {} ; return true })()`)
  await c.send('Page.reload', { ignoreCache: false })
  await c.sleep(300)
  await ready(c)
}

/** A clean editor: the page reloaded (no React state of the last scenario
 *  left), an autosave offer discarded, an empty project. The first-run tour
 *  counts as seen (phase 9b; its own scenario shows it again), the Projects
 *  window at launch is off and no export folder is remembered (REF-AB, P2:
 *  the first export of a scenario asks the save dialog, as before). */
export async function reset(c) {
  // What the app asked before this scenario is not this scenario's.
  c.scenarioStart = Date.now()
  await c.ev(`(() => { try { const s = window.__store.getState(); s.setPlaying(false); s.setDirty(false) } catch {} ; try { localStorage.removeItem('snipp-toolbar-layout') } catch {} ; try { localStorage.removeItem('snipp-agent-box-open') } catch {} ; try { localStorage.setItem('snipp-tour-seen', '1') } catch {} ; try { localStorage.setItem('snipp-home-at-launch', '0') } catch {} ; try { localStorage.removeItem('snipp-export-dir') } catch {} ; try { localStorage.removeItem('snipp-export-cover') } catch {} ; try { localStorage.removeItem('snipp-picks') } catch {} ; try { localStorage.removeItem('snipp-bin-sort') } catch {} ; try { localStorage.removeItem('snipp-dock-open') } catch {} ; try { localStorage.removeItem('snipp-dock-text-sub') } catch {} ; try { localStorage.setItem('snipp-track-scale', 'medium') } catch {} ; return true })()`).catch(() => undefined)
  // A scenario that turned the agent server off gets it back (phase 4B).
  // (The app starts no agent session since the terminal went, 215afc21:
  // agentSession has no stop() any more. Calling it threw, the catch ate
  // the throw and the server stayed off for every later scenario; seen on
  // 23 November as notes-lane-gestures, after agent-off-layout, finding no
  // N lane.)
  await c.ev(`(async () => { try { const s = await window.api.agentSession.status(); if (s.server && !s.server.running) await window.api.agent.setEnabled(true) } catch {} ; return true })()`).catch(() => undefined)
  // (DENEME-2: the notes lane shows only with agent access on: wait until
  // the page says so again.)
  await c.waitFor('agent access shown', () => c.ev(`(async () => { try { const s = await window.api.agentSession.status(); return !s.server?.running || document.querySelector('[data-testid="agent.switch"]')?.getAttribute('aria-checked') === 'true' } catch { return true } })()`), 5000).catch(() => undefined)
  await c.send('Page.reload', { ignoreCache: false })
  await c.sleep(300)
  await ready(c)
  // A crash snapshot of an earlier scenario may be offered: not ours to keep.
  for (let i = 0; i < 10; i++) {
    if (await c.has('ask.recovery')) {
      await c.click('ask.recovery.discard')
      break
    }
    await c.sleep(100)
  }
  // (A new project's V1 closes its gaps by itself since 22 November, L11. The
  // scenarios were written for lanes that keep their gaps, and say so here:
  // the lane magnet off. Its own scenario, d22-d-details, turns to the
  // product's new project through File → New.)
  await c.ev(`(() => { const s = window.__store.getState(); s.newProject('16:9'); const p = window.__store.getState().project; s.loadProject({ ...p, tracks: p.tracks.map(({ autoPack, ...t }) => t) }); s.setDirty(false); return true })()`)
  // The media panel wide enough for its own buttons (its width is the
  // user's; the default cuts its header off). Kept by the profile.
  const bin = await c.box('splitter.bin')
  if (bin && bin.x < 330) await c.dragAt(bin.cx, bin.cy, 340, bin.cy, { steps: 6 })
  // The dock on its media files page (it remembers the last page), open.
  await dockPage(c, 'media')
  await c.sleep(100)
}

/** The left panel open on a category's page. A click on the open page's
 *  icon closes the panel (DENEME-1, P2), so a scenario that only wants the
 *  page clicks when it is not already showing. */
export async function dockPage(c, id) {
  const on = await c.attr(`dock.page.${id}`, 'aria-selected')
  if (on !== 'true') await c.click(`dock.page.${id}`)
}

/** Text → Templates: the template gallery (a sub-page of Text since DENEME-1, P1). */
export async function templatesPage(c) {
  await dockPage(c, 'templates')
  await c.waitId('dock.text.tab.templates')
  if ((await c.attr('dock.text.tab.templates', 'aria-selected')) !== 'true') await c.click('dock.text.tab.templates')
}

/** Text → its text sub-page (Add text, ready-made texts, styles, animations,
 *  shapes and highlights, font: YAZI-PANELI-PLAN.md), a section opened when
 *  `section` is given (dock.text.sec.<id>; they fold and are remembered). */
export async function textPage(c, section) {
  await dockPage(c, 'templates')
  await c.waitId('dock.text.tab.text')
  if ((await c.attr('dock.text.tab.text', 'aria-selected')) !== 'true') await c.click('dock.text.tab.text')
  if (section && (await c.attr(`dock.text.sec.${section}.head`, 'aria-expanded')) !== 'true') await c.click(`dock.text.sec.${section}.head`)
}

/** A title at the playhead the way a user adds one: Text → Add text in the
 *  left panel (the preview toolbar's "Add text" is gone since DENEME-3, item 4). */
export async function addText(c) {
  await dockPage(c, 'templates')
  await c.waitId('dock.text.tab.text')
  if ((await c.attr('dock.text.tab.text', 'aria-selected')) !== 'true') await c.click('dock.text.tab.text')
  await c.click('dock.text.add')
}

/** The window itself has not scrolled and has nothing to scroll (22 November,
 *  L1: a path scrolled the whole app up and it stayed there, the top bar out
 *  of reach). Checked by the runner after every scenario; throws with what it
 *  found. The page is put back first, so one scenario's shift is not the
 *  next one's. */
export async function rootStill(c) {
  // (A scenario that ends with no page to ask, its window closed or on its
  // way to another address, has nothing to measure.)
  const s = await c.run(() => {
    // (The building blocks page, #ui-kit, is a long document that scrolls by
    // design: ui/kit/kit-page.css. Unpackaged builds only; not the editor.)
    if (document.querySelector('[data-testid="ui-kit"]')) return []
    const de = document.documentElement
    const parts = { html: de, body: document.body, root: document.getElementById('root') }
    const moved = Object.entries(parts).filter(([, e]) => e && (e.scrollTop !== 0 || e.scrollLeft !== 0)).map(([k, e]) => `${k} scrolled to ${e.scrollLeft}, ${e.scrollTop}`)
    if (de.scrollHeight !== de.clientHeight || de.scrollWidth !== de.clientWidth) moved.push(`the page is ${de.scrollWidth} x ${de.scrollHeight} in a window of ${de.clientWidth} x ${de.clientHeight}`)
    for (const e of Object.values(parts)) if (e) { e.scrollTop = 0; e.scrollLeft = 0 }
    return moved
  }).catch(() => [])
  if (s.length) throw new Error(`the window scrolled: ${s.join('; ')}`)
}

/** The system's "less motion" as the page sees it: 'reduce', 'no-preference',
 *  or null for the machine's own. Waits until the page has followed (22
 *  November, L2: the sheets read the class ui/motion.ts puts on <html>, a
 *  frame after the system's setting changes), so a style read right after
 *  this is the settled one. */
export async function systemMotion(c, value) {
  await c.send('Emulation.setEmulatedMedia', { features: value ? [{ name: 'prefers-reduced-motion', value }] : [] })
  await c.waitFor('the page following the motion setting', () => c.run(() => {
    let pref = null
    try { pref = localStorage.getItem('snipp-motion') } catch { /* blocked */ }
    const want = pref === 'off' || (pref !== 'on' && matchMedia('(prefers-reduced-motion: reduce)').matches)
    return document.documentElement.classList.contains('motion-off') === want
  }), 4000)
}

export const project = (c) => c.st((s) => s.project)
export const undoDepth = (c) => c.st((s) => s.past.length)
export const clipList = (c) =>
  c.st((s) => Object.values(s.project.clips).map((k) => ({ id: k.id, trackId: k.trackId, start: +k.start.toFixed(3), duration: +k.duration.toFixed(3), inPoint: +k.inPoint.toFixed(3), assetId: k.assetId })).sort((a, b) => a.trackId.localeCompare(b.trackId) || a.start - b.start))

/** Registers files the test way (no dialog) and puts them in a fresh project
 *  as assets; returns the assets. For scenes whose import is not under test. */
export async function seedAssets(app, c, files) {
  // The app's own import (probes duration, size, sound) with the open dialog
  // answered, without the media panel's button.
  app.answers.set([{ kind: 'open', paths: files }])
  return c.run(async () => {
    const S = window.__store
    const [imp] = await window.__media()
    const r = await imp.importMediaFiles()
    if (r.errors.length) throw new Error(r.errors.join('; '))
    const added = S.getState().addAssets(r.assets)
    return added.map((a) => ({ id: a.id, name: a.name, kind: a.kind, duration: a.duration, hasAudio: a.hasAudio }))
  })
}

/** Puts assets on the timeline the store's way (append, in order). */
export async function seedTimeline(c, assetIds) {
  await c.run((ids) => {
    const s = window.__store.getState()
    for (const id of ids) s.addToTimeline(id)
    s.setDirty(false)
  }, assetIds)
  await c.sleep(100)
}

/** The answers the next OS dialogs give (e2e-hooks.ts). */
export const answer = (app, ...list) => app.answers.set(list)

/** The export window (open) set to write `file` (REF-AB, P2: the name and
 *  place are the window's own). With no place yet, the first export of a
 *  scenario asks the save dialog: answered with `file`. With a place (an
 *  earlier export of the scenario), the name typed and, for another folder,
 *  the folder window answered. A file already there is replaced (the app's
 *  own question, answered yes by the test window). */
export async function exportTo(c, app, file) {
  const place = (await c.value('export.place').catch(() => '')) ?? ''
  if (!place) {
    answer(app, { kind: 'save', path: file })
    return
  }
  const dir = file.replace(/[\\/][^\\/]*$/, '')
  const base = file.slice(dir.length + 1)
  await c.fill('export.name', base.replace(/\.[^.]*$/, ''))
  if (dir.toLowerCase() !== place.toLowerCase()) {
    answer(app, { kind: 'open', paths: [dir] })
    await c.click('export.place.choose')
    await c.waitFor('the export place', async () => ((await c.value('export.place')) ?? '').toLowerCase() === dir.toLowerCase(), 8000)
  }
}

/** Every dialog the app asked for since `since` (events.jsonl). */
export const dialogsAsked = (app, since = app.cdp?.scenarioStart ?? 0) => app.events().filter((e) => e.type === 'dialog' && e.at >= since)

export const near = (a, b, eps = 0.05) => Math.abs(a - b) <= eps

/** Screen x of a timeline time: the ruler's box (it scrolls with the
 *  timeline), its header column (110 px) and the zoom. */
export async function timeX(c, t) {
  const r = await c.box('timeline.ruler')
  const px = await c.st((s) => s.pxPerSec)
  return r.x + 110 + t * px
}

/** Seeks by a click on the ruler. */
export async function seek(c, t) {
  const r = await c.box('timeline.ruler')
  await c.clickAt(await timeX(c, t), r.cy)
}

/** The building blocks page (#ui-kit, phase 3a): the page reloaded at that
 *  address. closeKit puts the address back (the next reset reloads the editor)
 *  and the language back to English. */
export async function openKit(c) {
  await c.run(() => {
    location.hash = '#ui-kit'
    return true
  })
  await c.send('Page.reload', { ignoreCache: false })
  await c.waitFor('the building blocks page', () => c.ev(`!!document.querySelector('[data-testid="ui-kit"]')`), 15000)
}
export async function closeKit(c) {
  await c.run(() => {
    try { window.__store.getState().setUiLang('en') } catch { /* no store */ }
    history.replaceState(null, '', location.pathname + location.search)
    return true
  })
}

/** Phase 3c.Y (K2): with the agent switched off the command box is one line
 *  and the Agent tab is gone; the top bar's switch is the way in. Waits for
 *  the switch to take a click (it is closed until the session's state is
 *  read), then clicks it (off → the agent chooser opens; on → off). */
export async function topBarSwitch(c) {
  await c.waitFor('the agent switch', () => c.ev(`(() => { const b = document.querySelector('[data-testid="agent.switch"]'); return !!b && !b.disabled })()`))
  await c.click('agent.switch')
}

/** Opens the folded command box for now (agent off; K2): as a click on its
 *  line does. Nothing to do when it is open. */
export async function openBox(c) {
  await c.waitId('agent.box', 20000)
  if ((await c.attr('agent.box', 'data-folded')) === 'true') await c.click('agent.box.open')
  await c.waitFor('the command box open', async () => (await c.attr('agent.box', 'data-folded')) === 'false')
}

/** Keeps the command box open (its arrow: "keep open", kept in the profile
 *  until lib.reset), for the scenarios about the agent's work rather than
 *  the box's folding (interface audit G1: the empty box is one line with the
 *  agent on too). Nothing to do when it is open. */
export async function keepBoxOpen(c) {
  await c.waitId('agent.box', 20000)
  if ((await c.attr('agent.box', 'data-folded')) === 'true') await c.click('agent.box.expand')
  await c.waitFor('the command box kept open', async () => (await c.attr('agent.box', 'data-folded')) === 'false')
}

/** The timeline's height now (phase 3c.Y, K1): the window under its splitter. */
export async function timelineHeight(c) {
  const s = await c.box('splitter.timeline')
  const h = await c.ev('window.innerHeight')
  // (v3: the window's frame under the timeline's card is not the timeline.)
  const frame = await c.ev(`parseFloat(getComputedStyle(document.querySelector('.app')).paddingBottom) || 0`)
  return h - (s.y + s.h) - frame
}

/** The test name of the element that has the focus (null if none). */
export const focused = (c) => c.ev(`document.activeElement?.closest('[data-testid]')?.dataset.testid ?? null`)

/** A window a scenario just launched (its `relaunch`): the Projects window a
 *  new profile shows at launch (REF-AB, P2) is closed and turned off, as
 *  `reset` does for the runner's own window. It covers the whole editor: the
 *  scenarios that launch again with a new profile timed out on their first
 *  click (D22, worker A: agent-settings-frames-and-change,
 *  agent-audit-stop-and-quit, dis-mcp-register). A profile that has it off
 *  already (the same profile again) is not waited for. */
export async function homeClosedAtLaunch(c) {
  const off = await c.ev(`(() => { try { const was = localStorage.getItem('snipp-home-at-launch'); localStorage.setItem('snipp-home-at-launch', '0'); return was === '0' } catch { return true } })()`).catch(() => true)
  if (off) return
  // (It opens a moment after the editor is drawn: once nothing else has
  // anything to show.)
  for (let i = 0; i < 20; i++) {
    if (await c.has('home.panel')) {
      await c.click('home.close')
      await c.waitGone('home.panel')
      return
    }
    await c.sleep(100)
  }
}

/** Opens these Inspector / left panel cards (section ids) for every kind of
 *  selection, before the panel mounts them (kullanım, item 5: cards fold by
 *  default and are remembered per kind: `<scope>/<id>`). */
export const SECTION_SCOPES = ['insp.clip', 'insp.code', 'insp.audio', 'insp.transition', 'insp.shape', 'insp.text', 'insp.line', 'insp.subs', 'insp.look', 'dock.text', 'dock.captions']
export async function openCards(c, ids, open = true) {
  await c.run((ids, scopes, open) => {
    const state = JSON.parse(localStorage.getItem('snipp-sections') ?? '{}')
    for (const id of ids) { state[id] = open; for (const s of scopes) state[`${s}/${id}`] = open }
    localStorage.setItem('snipp-sections', JSON.stringify(state))
  }, ids, SECTION_SCOPES, open)
}
/** Forgets every card choice made per kind of selection (the defaults again). */
export async function cardDefaults(c) {
  await c.run(() => {
    const state = JSON.parse(localStorage.getItem('snipp-sections') ?? '{}')
    for (const k of Object.keys(state)) if (k.includes('/')) delete state[k]
    localStorage.setItem('snipp-sections', JSON.stringify(state))
  })
}
