// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// Phase Ç2c.1, done measures (decisions 1, 2, 7): a split changes no frame —
// the export's frames at five frames either side of the cut, before and
// after the split, are byte for byte the same; the preview, the export and
// the Inspector give one value for a keyed clip (the behaviour as it was,
// held by a test); a head trim keeps the keys before the new start, shown as
// one mark at the clip's edge, not as diamonds.
export const name = 'keyframes-lossless'

const exportHash = (c, t) =>
  c.run(async (t) => {
    const ex = await window.__exporter()
    const p = window.__store.getState().project
    await ex.preloadImagesForExport(p)
    const u8 = await ex.exportFramePng(p, t, true, 'final')
    const d = await crypto.subtle.digest('SHA-256', u8)
    return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('')
  }, t)
// (As 47-preview-export-transitions: the frame inside the preview canvas,
// fitted and centred, on a 32×18 signature.)
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
const exportSig = (c, t) =>
  c.run(async (t) => {
    const ex = await window.__exporter()
    const p = window.__store.getState().project
    const u8 = await ex.exportFramePng(p, t, true, 'final')
    const bmp = await createImageBitmap(new Blob([u8]))
    const o = new OffscreenCanvas(32, 18)
    const g = o.getContext('2d')
    g.drawImage(bmp, 0, 0, 32, 18)
    return [...g.getImageData(0, 0, 32, 18).data]
  }, t)
const diff = (a, b) => a.reduce((n, v, i) => n + (i % 4 === 3 ? 0 : Math.abs(v - b[i])), 0) / (a.length * 0.75)

export async function run({ c, app, media, lib }) {
  const { assert } = lib
  const [a] = await lib.seedAssets(app, c, [media.numbered[0]])
  const fps = await c.run((id) => {
    const S = window.__store
    const p = structuredClone(S.getState().project)
    const A = p.assets.find((x) => x.id === id)
    const fit = Math.min(p.settings.width / A.width, p.settings.height / A.height) * 0.6
    const W = p.settings.width
    p.tracks = [{ id: 'V1', kind: 'video', name: 'V1', clipIds: ['k'] }, { id: 'A1', kind: 'audio', name: 'A1', clipIds: [] }]
    p.clips = {
      k: {
        id: 'k', assetId: id, trackId: 'V1', start: 0, inPoint: 0, duration: 6, volume: 1,
        transform: { x: W / 2, y: p.settings.height / 2, scale: fit, rotation: 0 },
        // A slow push and a drift across the cut at 3 s (eased, linear, eased out).
        channels: {
          x: [{ id: 'x0', time: 0.5, value: W * 0.3 }, { id: 'x1', time: 5.5, value: W * 0.7, easing: 'linear' }],
          scale: [{ id: 's0', time: 0, value: fit }, { id: 's1', time: 6, value: fit * 1.6 }],
          rotation: [{ id: 'r0', time: 1, value: 0 }, { id: 'r1', time: 4.5, value: 0.4, easing: 'easeOut' }],
          opacity: [{ id: 'o0', time: 0, value: 0.6 }, { id: 'o1', time: 5, value: 1 }]
        }
      }
    }
    p.captions = []
    S.getState().loadProject(p)
    S.setState({ selectedClipIds: [], playing: false })
    return p.settings.fps
  }, a.id)

  // 1. A split changes no frame: five frames either side of the cut.
  const cut = Math.round(3 * fps) / fps
  const times = [-5, -4, -3, -2, -1, 0, 1, 2, 3, 4].map((i) => cut + i / fps)
  const before = []
  for (const t of times) before.push(await exportHash(c, t))
  const pieces = await c.st((s, t) => {
    s.splitClipAt('k', t)
    return Object.keys(window.__store.getState().project.clips).length
  }, cut)
  assert.equal(pieces, 2, 'the split made two pieces')
  let same = 0
  for (let i = 0; i < times.length; i++) if ((await exportHash(c, times[i])) === before[i]) same++
  assert.equal(same, times.length, `frames the same before and after the split: ${same} of ${times.length}`)

  // 2. Preview, export and Inspector give one value (on the right piece, between its keys).
  const right = await c.st((s) => Object.values(s.project.clips).find((x) => x.id !== 'k').id)
  const at = cut + 0.83
  await c.st((s, id, t) => {
    s.setTime(t)
    window.__store.setState({ selectedClipIds: [id] })
  }, right, at)
  await c.click('inspector.tab.clip')
  await c.waitId('inspector.clip.x')
  await c.sleep(700)
  const d = diff(await sig(c), await exportSig(c, at))
  assert.ok(d <= 3, `the preview differs from the export by ${d.toFixed(2)} / 255`)
  const shown = Number(await c.value('inspector.clip.x'))
  const want = await c.run(async (id, t) => {
    const s = window.__store.getState()
    const clip = s.project.clips[id]
    // (The value the render reads: the same evaluator, at the same local time.)
    const kf = clip.channels.x
    const u = t - clip.start
    const a = kf[0]
    const b = kf[1]
    const f = Math.min(1, Math.max(0, (u - a.time) / (b.time - a.time)))
    return a.value + (b.value - a.value) * f - s.project.settings.width / 2
  }, right, at)
  assert.ok(Math.abs(shown - Math.round(want)) <= 1, `the Inspector shows X ${shown}, the keys give ${want.toFixed(2)}`)

  // 3. A head trim keeps the keys before the new start: one mark, no diamonds for them.
  await c.st((s, id) => s.setClipHead(id, s.project.clips[id].start + 1.5), right)
  await c.sleep(300)
  const kept = await c.st((s, id) => s.project.clips[id].channels.x.map((k) => +k.time.toFixed(4)), right)
  assert.deepEqual(kept, [-4, 1], 'the right piece keeps both x keys, the first now before its start')
  await c.waitId(`timeline.clip.${right}.keys-off-before`)
  const diamonds = await c.run((id) => document.querySelectorAll(`[data-testid="timeline.clip.${id}"] .clip-kf`).length, right)
  const groups = await c.st((s, id) => {
    const c = s.project.clips[id]
    const ts = new Set()
    for (const list of Object.values(c.channels)) for (const k of list) if (k.time >= -1e-3 && k.time <= c.duration + 1e-3) ts.add(k.time.toFixed(3))
    return ts.size
  }, right)
  assert.equal(diamonds, groups, `diamonds only for keys on the clip (${diamonds} of ${groups})`)
  console.log(`    split: ${same}/${times.length} frames identical; preview vs export ${d.toFixed(2)}; Inspector X ${shown} (${want.toFixed(2)}); off-clip mark shown, ${diamonds} diamonds`)
}
