// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// Çekirdek cila S, the transcript panel: only the subtitles' words are
// listed (a title is not speech); a pause between two lines is a token that
// can be cut down to a breath; the filler list is ticked and cut in one undo
// step; a selection leaves a marker and becomes a Shorts range; and a cut
// made here leaves the music alone, as the silence cut does.
import { addMusic, screen } from './97-cila-s-silence.mjs'
export const name = 'cila-s-transcript-review'

const W = (list) => list.map(([text, start, end]) => ({ text, start, end }))
const LINES = [
  { id: 'w1', words: W([['The', 0.2, 0.5], ['cat', 0.5, 0.9], ['ee,', 0.9, 1.3], ['sat', 1.3, 1.6], ['by', 1.6, 1.9], ['the', 1.9, 2.2], ['window.', 2.2, 2.8]]) },
  { id: 'w2', words: W([['Then', 4.6, 5.0], ['it', 5.0, 5.2], ['walked', 5.2, 5.8], ['over', 5.8, 6.3], ['the', 6.3, 6.6], ['bridge.', 6.6, 7.8]]) },
  { id: 'w3', words: W([['And', 9.6, 9.9], ['came', 9.9, 10.4], ['back', 10.4, 10.9], ['home.', 10.9, 11.9]]) }
]
const CAPS = [
  ...LINES.map((l) => ({ id: l.id, start: l.words[0].start, end: l.words[l.words.length - 1].end, text: l.words.map((w) => w.text).join(' '), words: l.words })),
  // A title made by hand: on the caption list, but nobody said it.
  { id: 'ttl', start: 1, end: 3, text: 'TITLECARD', manual: true }
]

/** The panel back at its top (a click scrolls its target into view; the
 *  rows at the top can then lie under the inspector's tab bar). */
const toTop = (c) => c.ev(`(() => { for (let e = document.querySelector('.transcript-root'); e; e = e.parentElement) if (e.scrollTop > 0) e.scrollTop = 0 })()`)

const top = async (c, id) => {
  await toTop(c)
  await c.click(id)
}

const talkLen = (c) => c.st((s) => Object.values(s.project.clips).filter((k) => k.trackId !== 'AM').reduce((n, k) => n + k.duration, 0))

export async function run({ c, app, media, lib }) {
  const { assert } = lib
  const [talk, other] = await lib.seedAssets(app, c, [media.talk, media.other])
  await lib.seedTimeline(c, [talk.id])
  await c.run((caps) => {
    const s = window.__store.getState()
    s.editTemplates((p) => { p.captions = caps })
    s.setDirty(false)
  }, CAPS)
  const depth0 = await lib.undoDepth(c)
  await c.click('inspector.tab.project')
  await c.click('inspector.project.script')
  await c.waitId('transcript.word.0')

  // 7. Only what was said.
  const shown = await c.ev(`[...document.querySelectorAll('[data-widx]')].map((e) => e.textContent).join(' ')`)
  assert.equal(shown, LINES.flatMap((l) => l.words.map((w) => w.text)).join(' '), 'the subtitles\' words, and no title')
  assert.ok(!/TITLECARD/.test(await c.ev(`document.querySelector('.transcript-root').textContent`)))

  // 10. The pauses between the lines are tokens (1.8 s each).
  assert.ok(await c.has('transcript.pause.6'), 'a pause after "window."')
  assert.ok(await c.has('transcript.pause.12'), 'a pause after "bridge."')
  assert.ok(!(await c.has('transcript.pause.0')))
  assert.match(await c.ev(`document.querySelector('[data-testid="transcript.pause.6"]').textContent`), /1\.8/)
  await c.click('transcript.pause.6')
  await c.waitId('transcript.delete-selection')
  await screen(c, 'cila-s-2-metin-duraklama.png')
  await top(c, 'transcript.delete-selection')
  const afterPause = await c.waitFor('the pause cut', async () => ((await talkLen(c)) < 11.9 ? talkLen(c) : null))
  // 1.8 s less the breath that stays (the silence cut's rule: 0.22 + 0.242 s).
  assert.ok(lib.near(12 - afterPause, 1.8 - 0.462, 0.01), `the pause is cut down to a breath (${(12 - afterPause).toFixed(3)} s went)`)
  assert.ok(lib.near(await c.st((s) => s.project.captions.find((x) => x.id === 'w2').start), 4.6 - (12 - afterPause), 0.005), 'the next line moved up with its words')
  assert.equal((await lib.undoDepth(c)) - depth0, 1, 'one undo step')
  await c.key('z', ['ctrl'])
  await c.waitFor('undo', async () => lib.near(await talkLen(c), 12, 0.001))

  // 8. Fillers: the list, ticked, cut in one undo step.
  await top(c, 'transcript.fillers')
  await c.waitFor('the filler list', async () => (await c.has('transcript.review')) && (await c.attr('transcript.review', 'data-busy')) === '0', 30000)
  assert.equal((await c.ids('transcript.review.row.')).length, 1)
  assert.equal(await c.attr('transcript.review.row.0', 'data-sure'), '1')
  assert.match(await c.ev(`document.querySelector('[data-testid="transcript.review.row.0"]').textContent`), /ee,/)
  await screen(c, 'cila-s-3-metin-dolgu-listesi.png')
  // None, then All: the button follows the ticks.
  await top(c, 'transcript.review.none')
  assert.equal(await c.ev(`document.querySelector('[data-testid="transcript.cut-fillers"]').disabled`), true)
  await top(c, 'transcript.review.all')
  await top(c, 'transcript.cut-fillers')
  const afterFiller = await c.waitFor('the filler cut', async () => ((await talkLen(c)) < 11.9 ? talkLen(c) : null))
  assert.ok(lib.near(12 - afterFiller, 0.44, 0.01), `"ee," went with a hair either side (${(12 - afterFiller).toFixed(3)} s)`)
  assert.ok(!(await c.has('transcript.review')), 'the list closed')
  assert.ok(!/\bee,/.test(await c.ev(`[...document.querySelectorAll('[data-widx]')].map((e) => e.textContent).join(' ')`)), 'the word is gone from the text')
  assert.equal((await lib.undoDepth(c)) - depth0, 1, 'one undo step')
  await c.key('z', ['ctrl'])
  await c.waitFor('undo', async () => lib.near(await talkLen(c), 12, 0.001))

  // 11. From a selection: a marker, a Shorts range (one undo step each).
  await c.click('transcript.word.9', { double: true })
  await c.waitId('transcript.mark-selection')
  await top(c, 'transcript.mark-selection')
  const mk = await c.waitFor('the marker', async () => {
    const m = await c.st((s) => s.project.markers ?? [])
    return m.length === 1 ? m[0] : null
  })
  assert.ok(lib.near(mk.time, 4.6, 0.001) && /Then/.test(mk.label ?? ''), `a marker at the sentence (${mk.time}, "${mk.label}")`)
  assert.equal((await lib.undoDepth(c)) - depth0, 1)
  await top(c, 'transcript.range-selection')
  const seg = await c.waitFor('the range', async () => {
    const list = await c.st((s) => s.project.shortSegments ?? [])
    return list.length === 1 ? list[0] : null
  })
  assert.ok(lib.near(seg.start, 4.6, 0.001) && lib.near(seg.end, 7.8, 0.001), `the range is the sentence (${seg.start}–${seg.end})`)
  assert.equal((await lib.undoDepth(c)) - depth0, 2, 'the range is one undo step')
  await c.key('z', ['ctrl'])
  await c.key('z', ['ctrl'])
  await c.waitFor('undo', async () => (await c.st((s) => (s.project.markers ?? []).length + (s.project.shortSegments ?? []).length)) === 0)

  // A double click while a selection is live: its first click clears the
  // selection, the bar above the words goes and the words move up before the
  // second press. The sentence under the pointer is still the one selected
  // (it used to be nothing: the second press fell between two lines).
  assert.ok(await c.has('transcript.delete-selection'), 'the sentence is still selected')
  const picked = () => c.ev(`[...document.querySelectorAll('.transcript-word.sel[data-widx]')].map((e) => e.dataset.widx).join(',')`)
  await c.click('transcript.word.2', { double: true })
  await c.waitFor('the first sentence', async () => (await picked()) === '0,1,2,3,4,5,6')

  // 12. With music under the talk: deleting a sentence leaves the music alone.
  await addMusic(c, other.id)
  const depth1 = await lib.undoDepth(c)
  await c.click('transcript.word.9', { double: true })
  await c.waitFor('the second sentence', async () => (await picked()) === '7,8,9,10,11,12')
  await c.waitId('transcript.delete-selection')
  await top(c, 'transcript.delete-selection')
  const cut = await c.waitFor('the sentence cut', async () => {
    const len = await talkLen(c)
    return len < 11 ? 12 - len : null
  }, 30000)
  assert.ok(lib.near(cut, 3.2, 0.01), `the sentence went (${cut.toFixed(3)} s)`)
  const music = await c.st((s) => s.project.tracks.find((t) => t.id === 'AM').clipIds.map((id) => ({ id, start: s.project.clips[id].start, duration: s.project.clips[id].duration })))
  assert.deepEqual(music.map((m) => [m.id, m.start]), [['m1', 0], ['m2', 6]], 'the music is not cut up and has not moved')
  assert.ok(music[0].duration === 6 && lib.near(music[1].start + music[1].duration, 12 - cut, 0.005), 'and ends with the film')
  assert.equal((await lib.undoDepth(c)) - depth1, 1, 'one undo step')
  await c.key('z', ['ctrl'])
  await c.waitFor('undo', async () => lib.near(await talkLen(c), 12, 0.001))
}
