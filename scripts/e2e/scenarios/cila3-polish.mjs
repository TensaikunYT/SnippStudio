// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// Small polish, worker cila3 (SnippStudio haritalar/_cila3-rapor.md):
//   - the watch mode: a pin put down while seven notes exist says "8", the
//     number the list gives it; Ctrl+Z takes the saved note back and Ctrl+Y
//     brings it again, while a film edit waits for the editor; the box and
//     the arrow draw in the chosen colour;
//   - the agent's range: the box's words take two lines (Shift+Enter), Enter
//     sends them, lines kept; the band's end edge and its body move it,
//     snapping to a clip's edge;
//   - the token number opens its card when the pointer rests on it; a press
//     pins it (the pointer may leave);
//   - Effects: the three cards differ at rest;
//   - Settings → General: one short line each, the long one in the info
//     mark's tooltip;
//   - a refused agent call: "the agent is trying again" until its next call.
import { connectAgent, versionOf } from '../agent-client.mjs'
import { accessOn } from '../session.mjs'
export const name = 'cila3-polish'
export const timeoutMs = 180_000

export async function run({ c, app, media, lib }) {
  const { assert } = lib
  const [talk] = await lib.seedAssets(app, c, [media.talk])
  await lib.seedTimeline(c, [talk.id])
  await c.st((s) => s.setUiLang('en'))

  // ---- Settings → General: short lines, the long ones behind the info marks
  await c.click('topbar.settings')
  await c.waitId('settings')
  const set = await c.run(() => {
    const page = document.querySelector('[data-testid="settings.general"]')
    const shown = (e) => { const r = e.getBoundingClientRect(); return r.width > 2 && r.height > 2 }
    return {
      marks: page.querySelectorAll('.ui-info-mark').length,
      shortLines: [...page.querySelectorAll('.ui-field-short')].filter(shown).map((e) => e.textContent),
      longShown: [...page.querySelectorAll('.ui-field-more')].filter(shown).length,
      longText: [...page.querySelectorAll('.ui-field-more')].map((e) => e.textContent),
      height: page.getBoundingClientRect().height
    }
  })
  assert.equal(set.marks, 5, 'four rows and autosave have an info mark')
  assert.equal(set.longShown, 0, 'the long explanations are not on the page')
  assert.ok(set.shortLines.every((x) => x.split('. ').length === 1 && x.length <= 60), `one short sentence each (${set.shortLines})`)
  assert.ok(set.longText.some((x) => /Alt \+ wheel/.test(x)) && set.longText.some((x) => /10 seconds/.test(x)), 'nothing is lost: the long words are there, for a screen reader and the tooltip')
  const mark = await c.run(() => { const r = document.querySelectorAll('.settings-page .ui-info-mark')[1].getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2] })
  await c.mouse('mouseMoved', mark[0], mark[1])
  await c.waitFor('the tooltip of the info mark', () => c.ev(`[...document.querySelectorAll('[role="tooltip"]')].some((e) => /Alt \\+ wheel/.test(e.textContent))`), 4000)
  // File → Long explanations: the long ones in place of the short ones.
  await c.ev(`document.documentElement.classList.add('hints-long')`)
  const long = await c.run(() => [...document.querySelectorAll('[data-testid="settings.general"] .ui-field-more')].filter((e) => e.getBoundingClientRect().height > 2).length)
  assert.equal(long, 5, 'long explanations: shown in place')
  await c.ev(`document.documentElement.classList.remove('hints-long')`)
  await c.key('Escape')
  await c.waitGone('settings')

  // ---- Effects: three cards, three different pictures at rest
  await lib.dockPage(c, 'effects')
  await c.waitId('effects.demo.ramp')
  await c.sleep(400)
  const sums = await c.run(() => ['cinematize', 'pan', 'ramp'].map((id) => {
    const cv = document.querySelector(`[data-testid="effects.demo.${id}"] canvas`)
    const d = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data
    let h = 0
    for (let i = 0; i < d.length; i += 4 * 7) h = (h * 31 + d[i] + d[i + 1] * 3 + d[i + 2] * 7) % 1000000007
    return h
  }))
  assert.equal(new Set(sums).size, 3, `the cards differ at rest (${sums})`)
  await lib.dockPage(c, 'media')

  // ---- the watch mode
  await accessOn(c)
  await c.run(() => {
    const s = window.__store.getState
    for (let i = 1; i <= 7; i++) {
      s().setTime(i * 1.2)
      s().startNoteDraft()
      s().patchNoteDraft({ text: `note ${i}` })
      s().saveNoteDraft()
    }
    s().setTime(0.5)
  })
  await c.click('topbar.watch')
  await c.waitId('watch')
  const frameAt = async (fx, fy) => {
    const layer = await c.box('notes.draw.layer')
    const f = await c.st((s) => s.project.settings)
    const fw = Math.min(layer.w, (layer.h * f.width) / f.height)
    const fh = (fw * f.height) / f.width
    return [layer.x + (layer.w - fw) / 2 + fw * fx, layer.y + (layer.h - fh) / 2 + fh * fy]
  }
  let [x, y] = await frameAt(0.35, 0.45)
  // (A note is a double click on the film since kullanım, item 6.)
  await c.clickAt(x, y, { double: true })
  await c.waitId('watch.bubble')
  assert.equal(await c.attr('notes.draw.layer', 'data-pins'), '8', 'the pin says the number the list will give the note')
  await c.type('logo')
  await c.key('Enter')
  await c.waitGone('watch.bubble')
  const listed = await c.run(() => [...document.querySelectorAll('[data-testid^="watch.note."][role="listitem"]')].map((e) => e.querySelector('.watch-num').textContent))
  assert.equal(listed[0], '8', `the new note is first in the list, number 8 (${listed})`)
  await c.click('watch.note.8.go')
  await c.waitFor('the picked note\'s pin says 8', async () => (await c.attr('notes.draw.layer', 'data-pins')) === '8')
  // Ctrl+Z: the note goes; Ctrl+Y: it comes back. A film edit stays.
  await c.ev('document.activeElement?.blur?.() ?? true')
  await c.key('z', ['ctrl'])
  await c.waitFor('Ctrl+Z took the note back', async () => (await c.st((s) => s.project.notes.length)) === 7)
  await c.key('y', ['ctrl'])
  await c.waitFor('Ctrl+Y brought it again', async () => (await c.st((s) => s.project.notes.length)) === 8)
  const clip = await c.st((s) => Object.keys(s.project.clips)[0])
  await c.st((s, id) => s.setClipVolume(id, 0.4), clip)
  await c.key('z', ['ctrl'])
  await c.sleep(300)
  assert.equal(await c.st((s, id) => s.project.clips[id].volume, clip), 0.4, 'a film edit is not taken back while watching')
  assert.ok(await c.ev(`[...document.querySelectorAll('[data-testid^="toast."]')].some((e) => /undo it in the editor/.test(e.textContent))`), 'and a toast says where it is')
  // The box and the arrow, in the chosen colour.
  await c.click('watch.colour.3')
  await c.click('watch.rect')
  await c.waitId('watch.bubble')
  let [x0, y0] = await frameAt(0.2, 0.25)
  let [x1, y1] = await frameAt(0.45, 0.6)
  await c.dragAt(x0, y0, x1, y1)
  await c.click('watch.arrow')
  ;[x0, y0] = await frameAt(0.75, 0.75)
  ;[x1, y1] = await frameAt(0.5, 0.55)
  await c.dragAt(x0, y0, x1, y1)
  const drawn = await c.st((s) => s.noteDraft.shapes.map((x) => `${x.type}:${x.color}`))
  assert.deepEqual(drawn, ['rect:#5aa9ff', 'arrow:#5aa9ff'])
  await c.ev('document.activeElement?.blur?.() ?? true')
  await c.key('z', ['ctrl'])
  assert.deepEqual(await c.st((s) => s.noteDraft.shapes.map((x) => x.type)), ['rect'], 'Ctrl+Z in a note being drawn: its last stroke')
  await c.key('Escape')
  await c.key('Escape')
  await c.waitGone('watch')
  await c.st((s) => s.editNotes((p) => { p.notes = [] }, false))

  // ---- the range: two lines, the edges and the body by hand
  await c.st((s) => s.setPxPerSec?.(60))
  await c.sleep(200)
  const ruler = await c.box('timeline.ruler')
  await c.dragAt(await lib.timeX(c, 2), ruler.cy, await lib.timeX(c, 6), ruler.cy, { mods: ['alt'] })
  await c.waitId('kapsam.box')
  await c.click('kapsam.box.text')
  const h0 = (await c.box('kapsam.box.text')).h
  await c.type('first line')
  await c.key('Enter', ['shift'])
  await c.type('second line')
  assert.ok(await c.has('kapsam.box'), 'Shift+Enter does not send')
  assert.ok((await c.box('kapsam.box.text')).h > h0, 'the field grows with its lines')
  const clipEnd = await c.st((s) => { const k = Object.values(s.project.clips)[0]; return k.start + k.duration })
  const end = await c.box('kapsam.band.end')
  await c.dragAt(end.cx, end.cy, (await lib.timeX(c, clipEnd)) + 3, end.cy, { steps: 12 })
  let band = await c.run(() => { const b = document.querySelector('[data-testid="kapsam.band"]'); return [Number(b.dataset.start), Number(b.dataset.end)] })
  assert.ok(lib.near(band[0], 2, 0.05) && lib.near(band[1], clipEnd, 0.001), `the end edge snaps to the clip's end (${band}, ${clipEnd})`)
  const mv = await c.box('kapsam.band.move')
  await c.dragAt(mv.cx, mv.cy, mv.cx - 60, mv.cy, { steps: 8 })
  const moved = await c.run(() => { const b = document.querySelector('[data-testid="kapsam.band"]'); return [Number(b.dataset.start), Number(b.dataset.end)] })
  assert.ok(lib.near(moved[1] - moved[0], band[1] - band[0], 0.01) && lib.near(moved[0], band[0] - 1, 0.1), `the body moves the band whole (${moved})`)
  await c.click('kapsam.box.text')
  await c.key('Enter')
  await c.waitGone('kapsam.box')
  assert.equal(await c.st((s) => s.project.notes?.[0]?.text), 'first line\nsecond line', 'Enter sent the note, its lines kept')
  await c.click('kapsam.band.close')

  // ---- the token card on hover; a refused call
  const claude = await connectAgent({ c, app, assert, client: 'claude-code' })
  await c.run(() => window.__agent.setMode('direct'))
  const proj = await claude.call('project')
  await c.waitId('agent.bar.tokens', 10000)
  const tb = await c.box('agent.bar.tokens')
  await c.mouse('mouseMoved', tb.cx, tb.cy - 60)
  await c.mouse('mouseMoved', tb.cx, tb.cy)
  await c.waitId('agent.tokens.card', 3000)
  assert.equal(await c.attr('agent.tokens.card', 'data-mode'), 'hover')
  await c.mouse('mouseMoved', tb.cx, tb.cy - 120)
  await c.waitGone('agent.tokens.card', 3000)
  await c.click('agent.bar.tokens')
  await c.waitId('agent.tokens.card')
  assert.equal(await c.attr('agent.tokens.card', 'data-mode'), 'pinned')
  await c.mouse('mouseMoved', tb.cx, tb.cy - 120)
  await c.sleep(600)
  assert.ok(await c.has('agent.tokens.card'), 'a pinned card stays when the pointer leaves')
  await c.key('Escape')
  await c.waitGone('agent.tokens.card')

  const what = () => c.ev(`document.querySelector('[data-testid="agent.bar.what"]')?.textContent ?? null`)
  const bad = await claude.call('edit', { ops: [{ op: 'no.such.operation' }], base: versionOf(proj.text) }, { allowError: true })
  assert.ok(bad.isError)
  await c.waitFor('the bar says the agent tries again', async () => /trying again/.test((await what()) ?? ''))
  await claude.call('project')
  await c.waitFor('the next call takes it away', async () => !/trying again/.test((await what()) ?? ''), 3000)
}
