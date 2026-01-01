// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// The user's notes from daily use (kullanım, 23 Nov; haritalar\_kullanim-rapor.md):
// the cutter cuts on the clicked frame (a shaking hand moves no clip; an
// edge or the playhead pulls only within 6 px, Alt never) and stands beside
// the keyframe on the bar; the Inspector's cards: only the main one open for
// each kind of selection, the user's own choice kept; the watch mode: a
// click plays or stops, a double click is a note; the top bar's
// "Transcribe" opens the Captions page.
export const name = 'kullanim-fixes'

export async function run({ c, app, media, lib }) {
  const { assert } = lib
  await lib.cardDefaults(c)
  const [talk, other] = await lib.seedAssets(app, c, [media.talk, media.other])
  await lib.seedTimeline(c, [talk.id, other.id])
  await c.st((s) => s.setPxPerSec(60))
  const [a, b] = await lib.clipList(c)
  await c.run((id) => { window.__store.getState().moveClip(id, 14); return true }, b.id)
  await c.st((s) => s.setTime(0))
  await c.sleep(200)
  const clip = (id) => c.st((s, id) => s.project.clips[id].start, id)

  // ---- 2. the cutter on the bar, beside the keyframe -----------------------------------------
  const bar = await c.run(() => [...document.querySelectorAll('.tl-toolbar > .tb-item')].map((e) => e.querySelector('[data-testid]')?.dataset.testid ?? ''))
  const at = bar.indexOf('timeline.tool.cutter')
  assert.ok(at > 0, `the cutter is on the bar (${bar.join(' ')})`)
  assert.equal(bar[at - 1], 'timeline.tool.keyframe', 'right after the keyframe')

  // ---- 1. the cutter cuts where it is clicked --------------------------------------------------
  await c.click('timeline.tool.cutter')
  assert.equal(await c.st((s) => s.cutterMode), true)
  const depth = await lib.undoDepth(c)
  const kb = await c.box(`timeline.clip.${b.id}`)
  const y = kb.y + kb.h * 0.6
  // a press that wanders 7 px before it lets go: no clip moves, no step.
  const x = kb.x + 61
  await c.mouse('mouseMoved', x, y)
  await c.mouse('mousePressed', x, y)
  for (const dx of [3, 5, 7]) await c.mouse('mouseMoved', x + dx, y, { down: true })
  await c.mouse('mouseReleased', x + 7, y)
  await c.sleep(200)
  assert.equal(await clip(b.id), 14, 'the clip under the cutter did not move')
  assert.equal(await lib.undoDepth(c), depth, 'no edit from a mark')
  assert.equal(await c.st((s) => s.currentTime), 0, 'the playhead did not jump')
  let marks = await c.st((s) => s.cutMarks)
  assert.equal(marks.length, 1)
  const want = 14 + 61 / 60
  assert.ok(Math.abs(marks[0] - want) <= 1 / 30 + 1e-6, `the mark is on the clicked frame (${marks[0]} for ${want})`)
  assert.ok(Math.abs(marks[0] * 30 - Math.round(marks[0] * 30)) < 1e-6, 'on a frame')
  // 4 px from the clip's start: the ghost says "snapped" before the click, the mark is on the edge.
  await c.st((s) => s.clearCutMarks())
  await c.mouse('mouseMoved', kb.x + 4, y)
  await c.sleep(80)
  assert.equal(await c.run(() => document.querySelector('.tl-cutmark.ghost')?.classList.contains('snapped')), true, 'the line shows the pull before the click')
  await c.clickAt(kb.x + 4, y)
  marks = await c.st((s) => s.cutMarks)
  assert.ok(Math.abs(marks[0] - 14) < 1e-6, `within 6 px it is the edge (${marks[0]})`)
  // Alt: no pull.
  await c.st((s) => s.clearCutMarks())
  await c.clickAt(kb.x + 4, y, { mods: ['alt'] })
  marks = await c.st((s) => s.cutMarks)
  assert.ok(marks[0] > 14.03, `Alt: where clicked (${marks[0]})`)
  // 12 px away: no pull.
  await c.st((s) => s.clearCutMarks())
  await c.clickAt(kb.x + 12, y)
  marks = await c.st((s) => s.cutMarks)
  assert.ok(Math.abs(marks[0] - (14 + 12 / 60)) <= 1 / 30, `12 px away: where clicked (${marks[0]})`)
  await c.st((s) => { s.clearCutMarks(); s.setCutterMode(false) })

  // ---- 5. the Inspector's cards: the main one open, by kind of selection --------------------------
  const cards = () => c.run(() => Object.fromEntries([...document.querySelectorAll('.inspector .ui-cards > .ui-section, .inspector .ui-cards > * > .ui-section')].map((s) => [s.querySelector('.ui-section-name')?.textContent ?? '', s.classList.contains('is-open')])))
  await c.st((s, id) => s.selectClip(id), a.id)
  await c.click('inspector.tab.clip')
  await c.sleep(150)
  let open = await cards()
  assert.equal(await c.attr('inspector.card.transform.head', 'aria-expanded'), 'true', 'Transform open')
  const opened = Object.entries(open).filter(([, o]) => o).map(([n]) => n)
  assert.deepEqual(opened, ['Transform'], `a clip: only Transform open (${opened.join(', ')})`)
  assert.equal(await c.run(() => !!document.querySelector('[data-testid="inspector.card.motion"] .ui-section-body')), false, 'a folded card builds no body (the animation tiles)')
  // the user opens Speed: kept for the next clip.
  await c.click('inspector.card.speed.head')
  await c.st((s, id) => s.selectClip(id), b.id)
  await c.sleep(150)
  assert.equal(await c.attr('inspector.card.speed.head', 'aria-expanded'), 'true', 'the opened card stays open for clips')
  await c.click('inspector.card.speed.head')
  // a text: its words, its style and its motion open; the rest folded.
  await lib.addText(c)
  await c.waitFor('the text tab', async () => (await c.attr('inspector.tab.subs', 'aria-selected')) === 'true')
  await c.sleep(200)
  open = await c.run(() => Object.fromEntries([...document.querySelectorAll('.inspector .ui-section.has-icon, .inspector [data-testid="inspector.text.sec.motion"]')].map((s) => [s.querySelector('.ui-section-name')?.textContent ?? '', s.classList.contains('is-open')])))
  const textOpen = Object.entries(open).filter(([, o]) => o).map(([n]) => n)
  const textShut = Object.entries(open).filter(([, o]) => !o).map(([n]) => n)
  assert.equal(textOpen.length, 3, `a text: three open (${textOpen.join(', ')})`)
  assert.ok(textShut.length >= 3, `the others folded (${textShut.join(', ')})`)
  await c.st((s) => { s.selectCaptions([]); s.selectClip(null) })

  // ---- 7. the top bar's "Transcribe" opens the Captions page --------------------------------------
  await lib.dockPage(c, 'media')
  await c.click('topbar.transcribe')
  await c.waitFor('the Captions page', async () => (await c.attr('dock.page.captions', 'aria-selected')) === 'true')

  // ---- 6. the watch mode: a click plays / stops, a double click is a note ---------------------------
  await c.click('topbar.watch')
  await c.waitId('watch')
  const layer = await c.box('notes.draw.layer')
  const [px, py] = [layer.x + layer.w / 2, layer.y + layer.h / 2]
  await c.clickAt(px, py, { after: 500 })
  assert.equal(await c.st((s) => s.playing), true, 'a click plays')
  await c.clickAt(px, py, { after: 500 })
  assert.equal(await c.st((s) => s.playing), false, 'a click stops')
  assert.equal(await c.has('watch.bubble'), false, 'no note from a click')
  const t0 = await c.st((s) => s.currentTime)
  await c.clickAt(px, py, { double: true })
  await c.waitId('watch.bubble')
  assert.equal(await c.st((s) => s.playing), false, 'a double click: stopped, a note')
  assert.ok(Math.abs((await c.st((s) => s.currentTime)) - t0) < 0.05, 'on the frame the first click found')
  await c.key('Escape')
  await c.waitGone('watch.bubble')
  await c.click('watch.note')
  await c.waitFor('a note started', () => c.st((s) => !!s.noteDraft))
  await c.key('Escape')
  await c.key('Escape')
  await c.waitGone('watch')
}
