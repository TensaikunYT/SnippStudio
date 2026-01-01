// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// Ç2b patch, item 5: a dissolve between two children of a compound clip.
// The preview kept the children's video elements alive only over their own
// spans (their transition windows were measured against the outer tracks,
// where a child has no neighbour), so in the dissolve's lead the incoming
// shot stood on its first frame (and in its tail the outgoing one on its
// last), while the export decoded both moving. Two pieces of the moving test
// pattern inside a compound on V1, a 2 s mix centred on 3 s. The paused,
// settled preview is compared (32×18 signature, as in scenario 47) with the
// export at the same moment, and with the export of the same frame with the
// incoming shot held on its first frame (what the old preview showed).
export const name = 'compound-dissolve'

const sig = async (c) =>
  c.run(() => {
    const cv = document.querySelector('[data-testid="preview.canvas"]')
    const s = window.__store.getState()
    const { width, height } = s.project.settings
    const pv = s.previewView
    const cw = cv.clientWidth
    const ch = cv.clientHeight
    const dpr = cv.width / cw
    const fit = Math.min(cw / width, ch / height) * (pv.zoom || 1)
    const dw = width * fit
    const dh = height * fit
    const dx = (cw - dw) / 2 + (pv.x || 0)
    const dy = (ch - dh) / 2 + (pv.y || 0)
    const o = new OffscreenCanvas(32, 18)
    const g = o.getContext('2d')
    g.drawImage(cv, (dx + 2) * dpr, (dy + 2) * dpr, (dw - 4) * dpr, (dh - 4) * dpr, 0, 0, 32, 18)
    return [...g.getImageData(0, 0, 32, 18).data]
  })
/** The export's frame at t; `held`: with the incoming child held on its
 *  first frame (a freeze at its in point). */
const exportSig = (c, t, held) =>
  c.run(async (t, held) => {
    const ex = await window.__exporter()
    const p = structuredClone(window.__store.getState().project)
    if (held) {
      const kb = p.clips.k.nested.clips.find((x) => x.id === 'kb')
      kb.freeze = kb.inPoint
    }
    const u8 = await ex.exportFramePng(p, t, true, 'final')
    const bmp = await createImageBitmap(new Blob([u8]))
    const o = new OffscreenCanvas(32, 18)
    const g = o.getContext('2d')
    g.drawImage(bmp, 0, 0, 32, 18)
    return [...g.getImageData(0, 0, 32, 18).data]
  }, t, held)
const diff = (a, b) => a.reduce((n, v, i) => n + (i % 4 === 3 ? 0 : Math.abs(v - b[i])), 0) / (a.length * 0.75)

export async function run({ c, app, media, lib }) {
  const { assert } = lib
  const [talk] = await lib.seedAssets(app, c, [media.talk])
  await c.run((id) => {
    const S = window.__store
    const p = structuredClone(S.getState().project)
    const A = p.assets.find((x) => x.id === id)
    const T = { x: p.settings.width / 2, y: p.settings.height / 2, scale: Math.min(p.settings.width / A.width, p.settings.height / A.height), rotation: 0 }
    const kids = [
      { id: 'ka', assetId: id, trackId: 'V1', start: 0, inPoint: 1, duration: 3, transform: { ...T }, volume: 1, transitionOut: { type: 'mix', duration: 2, to: 'kb' } },
      { id: 'kb', assetId: id, trackId: 'V1', start: 3, inPoint: 7, duration: 3, transform: { ...T }, volume: 1 }
    ]
    p.tracks = [{ id: 'V1', kind: 'video', name: 'V1', clipIds: ['k'] }, { id: 'A1', kind: 'audio', name: 'A1', clipIds: [] }]
    p.clips = { k: { id: 'k', assetId: '', nested: { clips: kids }, trackId: 'V1', start: 0, inPoint: 0, duration: 6, transform: { x: p.settings.width / 2, y: p.settings.height / 2, scale: 1, rotation: 0 }, volume: 1 } }
    p.captions = []
    S.getState().loadProject(p)
    S.setState({ selectedClipIds: [], playing: false })
  }, talk.id)
  const out = []
  const at = async (t) => {
    await c.st((s, t) => s.setTime(t), t)
    // (Settled: the children's elements seek to the moment and show it.)
    await c.sleep(1200)
    return sig(c)
  }
  // The plain frames: what a video in the preview differs from its export by.
  let plain = 0
  for (const t of [1.0, 5.0]) plain = Math.max(plain, diff(await at(t), await exportSig(c, t, false)))
  out.push(`plain ${plain.toFixed(2)}`)
  // In the dissolve's lead (the incoming shot 0.5 s before its start), at
  // its middle (the cut) and in its tail (the outgoing shot 0.5 s past its
  // end): as close to the export as a plain frame is (measured with the fix
  // taken out: 10.3, 21.1, 12.5 against a plain 6.5; with it 7.7, 6.9,
  // 8.1), and in the lead closer to the export than to the
  // incoming shot held on its first frame (taken out: 10.3 vs 8.4).
  const res = {}
  for (const t of [2.5, 3.0, 3.5]) {
    const shown = await at(t)
    const real = diff(shown, await exportSig(c, t, false))
    const held = t < 3 ? diff(shown, await exportSig(c, t, true)) : null
    res[t] = { real, held }
    out.push(`${t.toFixed(2)} s ${real.toFixed(2)}${held === null ? '' : ` (held ${held.toFixed(2)})`}`)
  }
  console.log('    ' + out.join('; '))
  for (const [t, { real }] of Object.entries(res)) {
    assert.ok(real <= plain + 2.5, `the dissolve inside the compound at ${t} s: the preview differs from the export by ${real.toFixed(2)} / 255 (a plain frame ${plain.toFixed(2)})`)
  }
  assert.ok(res[2.5].real < res[2.5].held, `in the lead the preview is the incoming shot held on its first frame (${res[2.5].real.toFixed(2)} vs held ${res[2.5].held.toFixed(2)})`)
}
