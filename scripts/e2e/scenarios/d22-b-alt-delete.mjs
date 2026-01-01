// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// 22 November, the addendum to K3 (D22-PLAN-B.md), in the app: Alt held on the
// toolbar's "Ripple delete" (the clips' own tracks close, nothing else). A
// still with no sound deleted so, followed by a talking clip with its linked
// sound: the talking clip moves up, and its sound with it (the sound stayed
// where it was). Where the sound cannot follow (another sound lies under the
// still on its track) the still is deleted, nothing closes, and the user is
// told. With the link switch off only the still's own track closes, as it
// always did. One Ctrl+Z takes each back.
export const name = 'd22-b-alt-delete'

export async function run({ c, app, media, lib }) {
  const { assert } = lib
  const [talk, pic] = await lib.seedAssets(app, c, [media.talk, media.broll[0]])
  const build = (withNarration, link = true) => c.run((talkId, picId, withNarration, link) => {
    const S = window.__store
    const p = structuredClone(S.getState().project)
    const T = { x: p.settings.width / 2, y: p.settings.height / 2, scale: 1, rotation: 0 }
    const clip = (id, assetId, trackId, start, duration, extra = {}) => ({ id, assetId, trackId, start, inPoint: 0, duration, transform: T, volume: 1, ...extra })
    p.tracks = [{ id: 'V1', kind: 'video', name: 'V1', clipIds: ['pic', 'talk'] }, { id: 'A1', kind: 'audio', name: 'A1', clipIds: [...(withNarration ? ['narration'] : []), 'talkA'] }]
    p.clips = {
      pic: clip('pic', picId, 'V1', 0, 6),
      talk: clip('talk', talkId, 'V1', 6, 5, { linkId: 'L1', audioExtracted: true }),
      talkA: clip('talkA', talkId, 'A1', 6, 5, { linkId: 'L1' }),
      ...(withNarration ? { narration: clip('narration', talkId, 'A1', 0, 6, { inPoint: 5 }) } : {})
    }
    p.captions = []
    S.getState().loadProject(p)
    S.getState().setLinkAV(link)
    S.getState().selectClips(['pic'])
    S.getState().setDirty(false)
    return true
  }, talk.id, pic.id, withNarration, link)
  const lay = () => c.st((s) => Object.fromEntries(Object.values(s.project.clips).map((k) => [k.id, [+k.start.toFixed(3), +(k.start + k.duration).toFixed(3)]])))
  const toasts = () => c.run(() => [...document.querySelectorAll('[data-testid="toast.stack"] > *')].map((e) => e.textContent ?? ''))
  const altDelete = async () => {
    // (Ripple delete is one of the tools behind the toolbar's "more" button.)
    if (!(await c.has('timeline.tool.ripple-delete'))) await c.click('timeline.tools-more')
    await c.waitId('timeline.tool.ripple-delete')
    await c.waitFor('the button is on', async () => (await c.run(() => document.querySelector('[data-testid="timeline.tool.ripple-delete"]')?.disabled)) === false, 5000)
    await c.click('timeline.tool.ripple-delete', { mods: ['alt'] })
    await c.waitFor('the still deleted', async () => !(await lay()).pic, 5000)
  }
  const undo = async () => {
    await c.run(() => { document.activeElement?.blur?.(); return true })
    await c.key('z', ['ctrl'])
    await c.waitFor('one Ctrl+Z takes it back', async () => !!(await lay()).pic, 5000)
  }

  try {
  // ---- the sound follows --------------------------------------------------------------------
  await build(false)
  await altDelete()
  assert.deepEqual(await lay(), { talk: [0, 5], talkA: [0, 5] }, 'the talking clip and its sound moved up together')
  await undo()
  assert.deepEqual(await lay(), { pic: [0, 6], talk: [6, 11], talkA: [6, 11] })

  // ---- the sound cannot follow: deleted, the gap stays, said ---------------------------------
  await build(true)
  const before = (await toasts()).length
  await altDelete()
  assert.deepEqual(await lay(), { talk: [6, 11], talkA: [6, 11], narration: [0, 6] }, 'nothing moved, nothing of the narration was cut')
  await c.waitFor('the user is told', async () => (await toasts()).length > before, 5000)
  const said = (await toasts()).join(' | ')
  assert.match(said, /A1/, `the track in the way is named: ${said}`)
  await undo()

  // ---- the link switch off: the still's own track alone, as before ---------------------------
  await build(false, false)
  await altDelete()
  assert.deepEqual(await lay(), { talk: [0, 5], talkA: [6, 11] }, 'the user turned the link off: the sound is not carried')
  await undo()
  } finally {
    // (The link switch is the profile's: on again for the scenarios after this one.)
    await c.run(() => { window.__store.getState().setLinkAV(true); return true })
  }
  console.log('     Alt + ripple delete of a still: the talk and its linked sound move up together; in the way: deleted, the gap stays, said; link off: as before')
}
