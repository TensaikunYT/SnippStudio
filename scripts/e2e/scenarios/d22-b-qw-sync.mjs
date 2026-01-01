// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// 22 November, K3 (D22-PLAN-B.md), in the app, with the real keys: W on a
// still that has no sound, followed by a talking clip with its linked sound.
// The talking clip moves up, and its sound with it (it stayed where it was,
// 3 s late, and nothing said so). Where the sound cannot follow (another
// sound lies under the still on its track) nothing closes: the gap stays and
// the user is told; Alt + W closes every track. One Ctrl+Z takes each back.
export const name = 'd22-b-qw-sync'

export async function run({ c, app, media, lib }) {
  const { assert } = lib
  const [talk, pic] = await lib.seedAssets(app, c, [media.talk, media.broll[0]])
  const build = (withNarration) => c.run((talkId, picId, withNarration) => {
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
    S.getState().setLinkAV(true)
    S.getState().setTime(3)
    S.getState().selectClips(['pic'])
    S.getState().setDirty(false)
    return true
  }, talk.id, pic.id, withNarration)
  const lay = () => c.st((s) => Object.fromEntries(Object.values(s.project.clips).map((k) => [k.id, [+k.start.toFixed(3), +(k.start + k.duration).toFixed(3)]])))
  const toasts = () => c.run(() => [...document.querySelectorAll('[data-testid="toast.stack"] [role="status"], [data-testid="toast.stack"] > *')].map((e) => e.textContent ?? ''))
  // The keys go to the editor, not to a field.
  const focusEditor = () => c.run(() => { document.activeElement?.blur?.(); return true })

  // ---- the sound follows ------------------------------------------------------------------
  await build(false)
  await focusEditor()
  await c.key('w')
  await c.waitFor('W closed the track', async () => (await lay()).talk[0] === 3, 5000)
  assert.deepEqual(await lay(), { pic: [0, 3], talk: [3, 8], talkA: [3, 8] }, 'the talking clip and its sound moved up together')
  await c.key('z', ['ctrl'])
  await c.waitFor('one Ctrl+Z takes it back', async () => (await lay()).pic[1] === 6, 5000)
  assert.deepEqual(await lay(), { pic: [0, 6], talk: [6, 11], talkA: [6, 11] })

  // ---- the sound cannot follow: the gap stays and it is said ---------------------------------
  await build(true)
  await focusEditor()
  const before = (await toasts()).length
  await c.key('w')
  await c.waitFor('W trimmed the still', async () => (await lay()).pic[1] === 3, 5000)
  assert.deepEqual(await lay(), { pic: [0, 3], talk: [6, 11], talkA: [6, 11], narration: [0, 6] }, 'nothing moved, nothing of the narration was cut')
  await c.waitFor('the user is told', async () => (await toasts()).length > before, 5000)
  const said = (await toasts()).join(' | ')
  assert.match(said, /A1/, `the track in the way is named: ${said}`)
  assert.match(said, /Alt/, 'and the way to close every track')
  await c.key('z', ['ctrl'])
  await c.waitFor('taken back', async () => (await lay()).pic[1] === 6, 5000)

  // ---- Alt + W: every track ---------------------------------------------------------------------
  await c.run(() => { const s = window.__store.getState(); s.setTime(3); s.selectClips(['pic']); return true })
  await focusEditor()
  await c.key('w', ['alt'])
  await c.waitFor('Alt + W closed every track', async () => (await lay()).talk[0] === 3, 5000)
  assert.deepEqual(await lay(), { pic: [0, 3], talk: [3, 8], talkA: [3, 8], narration: [0, 3] })
  console.log('     W on a still: the talk and its linked sound move up together; in the way: the gap stays, said; Alt + W closes all')
}
