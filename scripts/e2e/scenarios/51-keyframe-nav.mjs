// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// Phase Ç2c.2, decision 5 (report D9) and the timeline's parts of decision 4:
// Alt+. / Alt+, move the playhead from key to key of the selected clip
// (its channels and its volume), Alt+K writes a key at the playhead and takes
// it off again, the Inspector's buttons do the same; a video's own volume
// keys are marked on the clip (K27); "Paste all keyframes, stretched to this
// clip" spreads a copied move over another clip's length (K20).
export const name = 'keyframe-nav'

export async function run({ c, app, media, lib }) {
  const { assert } = lib
  const [talk] = await lib.seedAssets(app, c, [media.talk])
  await c.run((id) => {
    const S = window.__store
    const p = structuredClone(S.getState().project)
    p.settings.fps = 30
    const T = { x: p.settings.width / 2, y: p.settings.height / 2, scale: 1, rotation: 0 }
    p.tracks = [{ id: 'V1', kind: 'video', name: 'V1', clipIds: ['k', 'w'] }, { id: 'A1', kind: 'audio', name: 'A1', clipIds: [] }]
    p.clips = {
      k: {
        id: 'k', assetId: id, trackId: 'V1', start: 0, inPoint: 0, duration: 6, volume: 1, transform: { ...T },
        channels: { x: [{ id: 'x0', time: 1, value: 800 }, { id: 'x1', time: 4, value: 1100 }] },
        volumeKeyframes: [{ id: 'v0', time: 2.5, value: 0.4 }]
      },
      w: { id: 'w', assetId: id, trackId: 'V1', start: 7, inPoint: 6, duration: 4, volume: 1, transform: { ...T }, channels: { x: [{ id: 'w0', time: 0.5, value: 900 }] } }
    }
    p.captions = []
    S.getState().loadProject(p)
    S.setState({ selectedClipIds: ['k'], selectedCaptionIds: [], playing: false, pxPerSec: 100 })
    S.getState().setTime(0)
  }, talk.id)
  await c.sleep(300)
  const now = () => c.st((s) => +s.currentTime.toFixed(4))
  // (The keys reach the window: nothing focused that types.)
  await c.run(() => document.activeElement instanceof HTMLElement && document.activeElement.blur())

  // 1. Alt+. and Alt+, from key to key (x at 1 and 4, volume at 2.5).
  const seen = []
  for (let i = 0; i < 4; i++) {
    await c.key('.', ['alt'])
    seen.push(await now())
  }
  assert.deepEqual(seen, [1, 2.5, 4, 4], `Alt+. went ${JSON.stringify(seen)}`)
  await c.key(',', ['alt'])
  assert.equal(await now(), 2.5, 'Alt+, back one')

  // 2. Alt+K: a key at the playhead (3 s), then off again.
  await c.st((s) => s.setTime(3))
  const depth = await lib.undoDepth(c)
  await c.key('k', ['alt'])
  const added = await c.st((s) => s.project.clips.k.channels.x.map((k) => +k.time.toFixed(4)))
  assert.deepEqual(added, [1, 3, 4], `Alt+K keyed the playhead (${JSON.stringify(added)})`)
  await c.key('k', ['alt'])
  const removed = await c.st((s) => s.project.clips.k.channels.x.map((k) => +k.time.toFixed(4)))
  assert.deepEqual(removed, [1, 4], `Alt+K again took it off (${JSON.stringify(removed)})`)
  assert.equal((await lib.undoDepth(c)) - depth, 2, 'one undo step each')

  // 3. The Inspector's buttons (in the Keyframes section, folded by
  // default: opened as a user leaves it open, then the clip shown again).
  await lib.openCards(c, ['Keyframes'])
  await c.run(() => window.__store.setState({ selectedClipIds: [] }))
  await c.sleep(200)
  await c.st(() => window.__store.setState({ selectedClipIds: ['k'] }))
  await c.click('inspector.tab.clip')
  await c.st((s) => s.setTime(0))
  await c.click('inspector.keyframes.next')
  assert.equal(await now(), 1, 'the next-key button')
  await c.click('inspector.keyframes.next')
  await c.click('inspector.keyframes.prev')
  assert.equal(await now(), 1, 'the previous-key button')

  // 4. K27: the video's own volume key is marked on the clip.
  await c.waitId('timeline.clip.k.volume-key.v0')

  // 5. K20: the 6 s clip's move pasted onto the 4 s clip, stretched, from
  // the menu of the 4 s clip's diamond.
  await c.st((s) => s.copyClipAnimation('k'))
  const [wd] = await c.ids('timeline.clip.w.key.')
  const wb = await c.box(wd)
  await c.clickAt(wb.cx, wb.cy, { button: 'right' })
  await c.click('timeline.clip.w.paste-keys-scaled')
  const stretched = await c.st((s) => s.project.clips.w.channels.x.map((k) => +k.time.toFixed(4)))
  assert.deepEqual(stretched, [0.6667, 2.6667], `stretched to 4 s: ${JSON.stringify(stretched)}`)
  // (The section folded again, as the next scenario expects it.)
  await c.run(() => {
    const k = 'snipp-sections'
    const st = JSON.parse(localStorage.getItem(k) ?? '{}')
    delete st.Keyframes
    localStorage.setItem(k, JSON.stringify(st))
  })
  console.log(`    Alt+. ${JSON.stringify(seen)}, Alt+, 2.5; Alt+K on / off, 1 step each; Inspector prev / next; volume key marked; stretched paste ${JSON.stringify(stretched)}`)
}
