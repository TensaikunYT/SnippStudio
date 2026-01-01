// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// Every control of the Inspector can be clicked once scrolled into view, in
// every tab and Project part: nothing sticky (the Project part switcher, the
// Script panel's selection bar) or layered sits over it. With the panel short
// (the agent box under it) and scrolled down to the words, the selection bar
// used to be under the switcher, and "delete the selection" could not be
// clicked (yama-3c).
import { WORDED, captionsOf } from './04-text-edit.mjs'

export const name = 'inspector-reach'

/** In the page: the controls of the Inspector whose centre a click does not reach. */
const covered = () => {
  const bad = []
  let n = 0
  const els = [...document.querySelectorAll('.inspector [data-testid]')].filter((e) => e.matches('button, [role="button"], [role="tab"], [role="radio"], [role="checkbox"], [role="switch"], input, select, textarea, a'))
  for (const el of els) {
    if (el.offsetParent === null) continue
    el.scrollIntoView({ block: 'nearest', inline: 'nearest' })
    const r = el.getBoundingClientRect()
    if (r.width === 0 || r.height === 0) continue
    n++
    const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)
    if (!hit || !(hit === el || el.contains(hit))) bad.push(`${el.getAttribute('data-testid')} (under ${hit?.closest('[data-testid]')?.getAttribute('data-testid') ?? hit?.className ?? 'nothing'})`)
  }
  return { n, bad }
}

export async function run({ c, app, media, lib }) {
  const { assert } = lib
  const [talk] = await lib.seedAssets(app, c, [media.talk])
  await lib.seedTimeline(c, [talk.id])
  await c.run((caps) => { const s = window.__store.getState(); s.setSubtitles(caps); s.setDirty(false) }, captionsOf(WORDED))
  const sweep = async (where) => {
    const { n, bad } = await c.run(covered)
    assert.ok(n > 5, `${where}: controls found (${n})`)
    assert.deepEqual(bad, [], `${where}: every control can be clicked`)
  }

  await c.click('inspector.tab.project')
  await c.click('inspector.project.script')
  // The words are at the bottom of a short panel: a click there scrolls it
  // down. (Audit E18: the panel is made short on purpose — the command box
  // kept open, as when this was written — and the LAST word is the one
  // clicked. In the merged layout word 8 was already in sight in the 293 px
  // panel: nothing scrolled and the sweep behind this never ran; with the
  // empty box folded (G1) the panel is taller still.)
  await lib.keepBoxOpen(c)
  // (Arayüz v4's cards left the last word in sight in a 341 px panel, so
  // nothing scrolled and the check below had nothing to see: the timeline
  // is made taller, which shortens the panel until the words are below its
  // fold. Its default height comes back at the end: a double click.)
  // (DENEME-2: a fixed 220 px left no panel at all once the buttons and
  // the timeline's lanes changed size; the timeline grows in 40 px steps
  // until the last word is below the panel's fold, the panel kept at least
  // 120 px tall.)
  const words = await c.ids('transcript.word.')
  const last = words.map((id) => Number(id.split('.').pop())).filter(Number.isFinite).sort((a, b) => a - b).pop()
  const fold = () => c.run((id) => {
    const b = document.querySelector('.inspector [role="tabpanel"]').getBoundingClientRect()
    const w = document.querySelector(`[data-testid="transcript.word.${id}"]`)?.getBoundingClientRect()
    return { below: !!w && w.top > b.bottom, h: b.height }
  }, last)
  for (let i = 0; i < 8; i++) {
    const f = await fold()
    if (f.below || f.h < 160) break
    const sp = await c.box('splitter.timeline')
    await c.dragAt(sp.cx, sp.cy, sp.cx, sp.cy - 40, { steps: 4 })
    await c.sleep(150)
  }
  console.log('     panel:', JSON.stringify(await fold()))
  await c.click(`transcript.word.${last}`, { double: true })
  await c.waitId('transcript.delete-selection')
  // (The panel that scrolls is whichever ancestor scrolls: since the
  // Inspector's cards of arayüz v4 it is the tab's page, not the old .body.)
  const st = await c.run(() => {
    for (let e = document.querySelector('[data-testid="transcript.delete-selection"]'); e; e = e.parentElement) {
      const o = getComputedStyle(e).overflowY
      if ((o === 'auto' || o === 'scroll') && e.scrollHeight > e.clientHeight) return e.scrollTop
    }
    return 0
  })
  const sizes = await c.run(() => { const b = document.querySelector('.inspector [role="tabpanel"]'); return [b.clientHeight, b.scrollHeight] })
  console.log(`     the panel ${sizes[0]} px of ${sizes[1]}; word ${last} of ${words.length}: scrolled to ${st}`)
  assert.ok(st > 0, `the panel is scrolled down to the words (${st})`)
  const back = await c.box('splitter.timeline')
  await c.clickAt(back.cx, back.cy, { double: true })
  await sweep('Project, Script, a selection')
  for (const part of ['sound', 'settings']) {
    await c.click(`inspector.project.${part}`)
    await sweep(`Project, ${part}`)
  }
  await c.run(() => { const s = window.__store.getState(); s.selectClip(Object.keys(s.project.clips)[0]) })
  for (const tab of ['clip', 'subs', 'notes', 'agent', 'fx']) {
    if (!(await c.run((id) => !!document.querySelector(`[data-testid="${id}"]`), `inspector.tab.${tab}`))) continue
    await c.click(`inspector.tab.${tab}`)
    await new Promise((r) => setTimeout(r, 150))
    await sweep(tab)
  }
}
