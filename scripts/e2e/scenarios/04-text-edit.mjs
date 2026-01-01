// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// Editing by the words: in Project → Script, a stretch of words is selected
// (click, Shift+click) and deleted; the picture and the subtitles after it
// move up by exactly that stretch, in one undo step.
export const name = 'text-edit-delete-range'

/** Subtitles with word timings for talk.mp4 (the setup, not under test). */
export const WORDED = [
  { id: 'w1', start: 0.2, end: 2.8, words: [['The', 0.2, 0.5], ['cat', 0.5, 0.9], ['sat', 0.9, 1.3], ['by', 1.3, 1.6], ['the', 1.6, 1.9], ['window', 1.9, 2.8]] },
  { id: 'w2', start: 4.6, end: 7.8, words: [['then', 4.6, 5.0], ['it', 5.0, 5.2], ['walked', 5.2, 5.8], ['over', 5.8, 6.3], ['the', 6.3, 6.6], ['bridge', 6.6, 7.8]] },
  { id: 'w3', start: 9.6, end: 11.9, words: [['and', 9.6, 9.9], ['came', 9.9, 10.4], ['back', 10.4, 10.9], ['home', 10.9, 11.9]] }
]
export const captionsOf = (list) => list.map((l) => ({ id: l.id, start: l.start, end: l.end, text: l.words.map((w) => w[0]).join(' '), words: l.words.map(([text, start, end]) => ({ text, start, end })) }))

export async function run({ c, app, media, lib }) {
  const { assert } = lib
  const [talk] = await lib.seedAssets(app, c, [media.talk])
  await lib.seedTimeline(c, [talk.id])
  await c.run((caps) => { const s = window.__store.getState(); s.setSubtitles(caps); s.setDirty(false) }, captionsOf(WORDED))
  const depth0 = await lib.undoDepth(c)

  await c.click('inspector.tab.project')
  await c.click('inspector.project.script')
  // A plain click on a word seeks to it.
  await c.click('transcript.word.6')
  assert.ok(lib.near(await c.st((s) => s.currentTime), 4.6, 0.01), 'a click on a word seeks to it')
  // A double-click selects its sentence: words 6..11, the whole second line
  // ("then … bridge", 4.6–7.8 s). (Dragging across works too, but the bar
  // that appears above the text moves the words under the pointer.)
  await c.click('transcript.word.8', { double: true })
  await c.waitId('transcript.delete-selection')
  await c.click('transcript.delete-selection')

  const after = await c.waitFor('the cut', async () => {
    const p = await c.st((s) => ({ clips: Object.values(s.project.clips).map((k) => ({ start: k.start, duration: k.duration, inPoint: k.inPoint })), caps: s.project.captions.map((x) => ({ id: x.id, start: x.start, end: x.end })) }))
    return p.caps.length === 2 ? p : null
  })
  const total = after.clips.reduce((n, k) => n + k.duration, 0)
  const cut = 12 - total
  assert.ok(cut > 3 && cut < 3.6, `about 3.2 s cut from the picture (${cut.toFixed(3)})`)
  const w3 = after.caps.find((x) => x.id === 'w3')
  assert.ok(lib.near(w3.start, 9.6 - cut, 0.01), `the last line moved up by the cut (${w3.start})`)
  assert.equal((await lib.undoDepth(c)) - depth0, 1, 'one undo step')

  await c.key('z', ['ctrl'])
  await c.waitFor('undo', async () => (await c.st((s) => s.project.captions.length)) === 3)
  const back = await c.st((s) => Object.values(s.project.clips).reduce((n, k) => n + k.duration, 0))
  assert.ok(lib.near(back, 12, 0.001))
}
