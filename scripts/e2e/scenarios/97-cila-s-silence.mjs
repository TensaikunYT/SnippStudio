// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// Çekirdek cila S, "Remove silence" in a project with music. Nothing is
// picked: the window listens to the speech (the talk), says what it will cut
// and what it leaves, and shows as its total exactly the time the cut takes.
// Remove: the talk and its subtitles get shorter, the music is not cut up
// and has not moved (it ends with the film, fading out), one undo step.
// "Only mark" cuts nothing and leaves a marker at each pause.
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { SPEECH } from '../media.mjs'
import { WORDED, captionsOf } from './04-text-edit.mjs'
export const name = 'cila-s-silence-with-music'

/** A "Music" track with other.mp4's steady tone under the whole talk. */
export async function addMusic(c, assetId) {
  await c.run((id) => {
    const s = window.__store.getState()
    s.editTemplates((p) => {
      const T = { x: p.settings.width / 2, y: p.settings.height / 2, scale: 1, rotation: 0 }
      p.tracks.push({ id: 'AM', kind: 'audio', name: 'Music', clipIds: ['m1', 'm2'] })
      p.clips.m1 = { id: 'm1', assetId: id, trackId: 'AM', start: 0, inPoint: 0, duration: 6, transform: { ...T }, volume: 0.4 }
      p.clips.m2 = { id: 'm2', assetId: id, trackId: 'AM', start: 6, inPoint: 0, duration: 6, transform: { ...T }, volume: 0.4 }
    })
    s.setDirty(false)
  }, assetId)
}

/** A picture of the window for a person to look at, only when
 *  SNIPP_SCREENS_CILA_S names a folder (the checks need none). */
export async function screen(c, file) {
  const dir = process.env.SNIPP_SCREENS_CILA_S
  if (!dir) return
  mkdirSync(dir, { recursive: true })
  await c.sleep(450)
  await c.shot(join(dir, file))
}

const openWindow = async (c) => {
  await c.click('preview.silence')
  await c.waitId('silence')
  await c.waitFor('the scan', async () => (await c.has('silence.listen')) && (await c.attr('silence.status', 'data-busy')) === '0', 30000)
}

export async function run({ c, app, media, lib }) {
  const { assert } = lib
  const [talk, other] = await lib.seedAssets(app, c, [media.talk, media.other])
  await lib.seedTimeline(c, [talk.id])
  await c.run((caps) => { const s = window.__store.getState(); s.setSubtitles(caps); s.setDirty(false) }, captionsOf(WORDED))
  await addMusic(c, other.id)
  const [clip] = (await lib.clipList(c)).filter((k) => k.trackId !== 'AM')
  await c.run(() => window.__store.setState({ selectedClipIds: [] }))
  const depth0 = await lib.undoDepth(c)

  // 1. Nothing picked: the speech is listened to; the music is left.
  await openWindow(c)
  assert.equal(await c.attr('silence.listen', 'data-from'), 'speech')
  assert.equal(await c.attr('silence.listen', 'data-sources'), clip.id, 'the talk is the speech, not the music')
  assert.equal(await c.attr('silence.scope', 'data-kept'), 'AM')
  assert.ok(!(await c.attr('silence.scope', 'data-cut')).split(',').includes('AM'))
  assert.equal(await c.attr('silence.status', 'data-ranges'), '2', 'the two gaps')
  const shown = Number(await c.attr('silence.status', 'data-total'))
  const marks = await c.st((s) => s.silencePreview)
  assert.ok(marks.length === 2 && marks.every((m) => m.clipId === clip.id), `red on the talk only (${JSON.stringify(marks.map((m) => m.clipId))})`)
  const gaps = [[SPEECH[0][1], SPEECH[1][0]], [SPEECH[1][1], SPEECH[2][0]]]
  marks.forEach((m, i) => assert.ok(m.start >= gaps[i][0] - 0.05 && m.end <= gaps[i][1] + 0.05, `mark ${i} inside its silence`))
  assert.ok(lib.near(shown, marks.reduce((n, m) => n + m.end - m.start, 0), 0.002), 'the total shown is the red shown')
  await screen(c, 'cila-s-1-sessizlik-muzikli.png')
  // Nothing is cut until Remove.
  assert.equal((await lib.clipList(c)).length, 3)

  // 2. Remove: the talk is cut, the music is not.
  await c.click('silence.apply')
  await c.waitGone('silence')
  const after = await c.waitFor('the cut', async () => {
    const p = await c.st((s) => ({ clips: Object.values(s.project.clips).map((k) => ({ id: k.id, trackId: k.trackId, start: k.start, duration: k.duration, fadeOut: k.fadeOut ?? 0 })), caps: s.project.captions.map((x) => ({ id: x.id, start: x.start })), music: s.project.tracks.find((t) => t.id === 'AM').clipIds }))
    return p.clips.filter((k) => k.trackId !== 'AM').length === 3 ? p : null
  })
  const talkLen = after.clips.filter((k) => k.trackId !== 'AM').reduce((n, k) => n + k.duration, 0)
  assert.ok(lib.near(12 - talkLen, shown, 0.005), `what was cut (${(12 - talkLen).toFixed(3)} s) is what the window showed (${shown.toFixed(3)} s)`)
  assert.deepEqual(after.music, ['m1', 'm2'], 'the music is the two clips it was: not cut up')
  const m1 = after.clips.find((k) => k.id === 'm1')
  const m2 = after.clips.find((k) => k.id === 'm2')
  assert.ok(m1.start === 0 && m1.duration === 6 && m2.start === 6, 'the music has not moved')
  assert.ok(lib.near(m2.start + m2.duration, talkLen, 0.005), `the music ends with the film (${(m2.start + m2.duration).toFixed(3)} / ${talkLen.toFixed(3)})`)
  assert.equal(m2.fadeOut, 1, 'and fades out there')
  // The subtitles are on their words still: the second line moved up by the
  // first gap, the third by both.
  const gap1 = marks[0].end - marks[0].start
  assert.ok(lib.near(after.caps.find((x) => x.id === 'w1').start, 0.2, 0.001))
  assert.ok(lib.near(after.caps.find((x) => x.id === 'w2').start, 4.6 - gap1, 0.005))
  assert.ok(lib.near(after.caps.find((x) => x.id === 'w3').start, 9.6 - shown, 0.005))
  assert.equal((await lib.undoDepth(c)) - depth0, 1, 'one undo step')
  await c.key('z', ['ctrl'])
  await c.waitFor('undo', async () => (await lib.clipList(c)).length === 3)
  assert.equal(await c.st((s) => s.project.clips.m2.duration), 6)

  // 3. "Only mark": nothing is cut, a marker at each pause, one undo step.
  await c.run(() => window.__store.setState({ selectedClipIds: [] }))
  await openWindow(c)
  await c.click('silence.mark')
  await c.waitGone('silence')
  const marked = await c.waitFor('the markers', async () => {
    const m = await c.st((s) => (s.project.markers ?? []).map((x) => ({ time: x.time, label: x.label ?? '' })))
    return m.length === 2 ? m : null
  })
  marked.forEach((m, i) => assert.ok(lib.near(m.time, marks[i].start, 0.005) && /\d/.test(m.label), `marker ${i} at its pause (${m.time}, "${m.label}")`))
  assert.equal((await lib.clipList(c)).length, 3, 'nothing was cut')
  assert.equal((await lib.undoDepth(c)) - depth0, 1, 'one undo step')
  await c.key('z', ['ctrl'])
  await c.waitFor('undo', async () => (await c.st((s) => (s.project.markers ?? []).length)) === 0)

  // 4. The option off: every unlocked track is in the cut, the music too.
  await c.run(() => window.__store.setState({ selectedClipIds: [] }))
  await openWindow(c)
  await c.click('silence.keep-music')
  await c.waitFor('the option off', async () => (await c.attr('silence.status', 'data-busy')) === '0' && (await c.attr('silence.scope', 'data-kept')) === '')
  assert.ok((await c.attr('silence.scope', 'data-cut')).split(',').includes('AM'))
  // (Back on: the choice is remembered, and the next scenario starts from the default.)
  await c.click('silence.keep-music')
  await c.waitFor('the option on', async () => (await c.attr('silence.scope', 'data-kept')) === 'AM')
  await c.click('silence.cancel')
  await c.waitGone('silence')
  assert.equal(await c.st((s) => s.silencePreview), null, 'the preview cleared')
}
