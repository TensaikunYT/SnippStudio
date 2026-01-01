// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// Phase Ç2b.2, decision 2 (report G1): a dissolve is a real mix. A portrait
// picture (black bars at its sides) dissolves into a landscape one; at the
// moments the mix is 10 % and 50 % through, a pixel in the side bar — where
// only the incoming picture covers — is that much of the incoming colour (it
// showed at 100 % from the first frame before), and the centre, where both
// cover, is (1 − g)·A + g·B. The export draws it (exportFramePng: the same
// renderFrame as the preview). Zoom and blur go the same way (a light leak
// too, but its glow lies over the side bar: not measured here).
import { spawnSync } from 'node:child_process'
import { join } from 'node:path'
import { ffmpegBin } from '../media.mjs'
export const name = 'dissolve-mix'

const A = [208, 64, 48]
const B = [48, 112, 224]

function card(file, w, h, rgb) {
  const hex = '0x' + rgb.map((v) => v.toString(16).padStart(2, '0')).join('')
  const r = spawnSync(ffmpegBin('ffmpeg'), ['-v', 'error', '-y', '-f', 'lavfi', '-i', `color=c=${hex}:s=${w}x${h}`, '-frames:v', '1', file], { encoding: 'utf8', windowsHide: true })
  if (r.status !== 0) throw new Error('ffmpeg: ' + r.stderr)
}

/** The time in a 1 s window starting at `w0` where smoothstep(u) = g. */
function at(w0, g) {
  let lo = 0
  let hi = 1
  for (let i = 0; i < 60; i++) {
    const u = (lo + hi) / 2
    if (u * u * (3 - 2 * u) < g) lo = u
    else hi = u
  }
  return w0 + (lo + hi) / 2
}

export async function run({ c, app, lib, work }) {
  const { assert } = lib
  const tall = join(work, 'tall.png')
  const wide = join(work, 'wide.png')
  card(tall, 360, 640, A)
  card(wide, 640, 360, B)
  const [a, b] = await lib.seedAssets(app, c, [tall, wide])
  // A 0–3 s (contain: 0.5625, so x 219–421 of 640), B 3–6 s; a 1 s dissolve
  // centred on the cut (stills have handles): the window is 2.5–3.5 s.
  const times = { g10: at(2.5, 0.1), g50: at(2.5, 0.5), after: 4.5 }
  const out = {}
  for (const type of ['mix', 'zoom', 'blur']) {
    out[type] = await c.run(async (ids, type, times) => {
      const S = window.__store
      const p = structuredClone(S.getState().project)
      const T = (scale) => ({ x: 320, y: 180, scale, rotation: 0 })
      p.settings = { ...p.settings, width: 640, height: 360, fps: 30 }
      p.tracks = [{ id: 'V1', kind: 'video', name: 'V1', clipIds: ['ca', 'cb'] }, { id: 'A1', kind: 'audio', name: 'A1', clipIds: [] }]
      p.clips = {
        ca: { id: 'ca', assetId: ids[0], trackId: 'V1', start: 0, inPoint: 0, duration: 3, transform: T(0.5625), volume: 1, transitionOut: { type, duration: 1, to: 'cb' } },
        cb: { id: 'cb', assetId: ids[1], trackId: 'V1', start: 3, inPoint: 0, duration: 3, transform: T(1), volume: 1 }
      }
      p.captions = []
      S.getState().loadProject(p)
      await new Promise((r) => setTimeout(r, 300))
      const ex = await window.__exporter()
      const proj = S.getState().project
      await ex.preloadImagesForExport(proj)
      const px = async (t) => {
        const u8 = await ex.exportFramePng(proj, t, true, 'final')
        const bmp = await createImageBitmap(new Blob([u8]))
        const cv = new OffscreenCanvas(bmp.width, bmp.height)
        const g = cv.getContext('2d')
        g.drawImage(bmp, 0, 0)
        const at = (x, y) => [...g.getImageData(x, y, 1, 1).data].slice(0, 3)
        return { side: at(40, 180), centre: at(320, 180) }
      }
      return { g10: await px(times.g10), g50: await px(times.g50), after: await px(times.after), before: await px(1) }
    }, [a.id, b.id], type, times)
  }
  const ratio = (got, of) => got.reduce((n, v, i) => n + v / of[i], 0) / got.length
  const lines = []
  for (const [type, r] of Object.entries(out)) {
    const bSide = r.after.side
    for (const [k, g] of [['g10', 0.1], ['g50', 0.5]]) {
      const side = ratio(r[k].side, bSide)
      lines.push(`${type} ${k}: side ${side.toFixed(3)}`)
      // (A zoom and a blur move the pictures; the side bar is still only B's.)
      assert.ok(Math.abs(side - g) <= 0.03, `${type} at ${k}: the side bar is ${(side * 100).toFixed(1)} % of the incoming colour, not ${g * 100} % (${JSON.stringify(r[k].side)} of ${JSON.stringify(bSide)})`)
      if (type === 'mix') {
        const want = r.before.centre.map((v, i) => (1 - g) * v + g * r.after.centre[i])
        const off = Math.max(...r[k].centre.map((v, i) => Math.abs(v - want[i]))) / 255
        lines.push(`${type} ${k}: centre off ${(off * 100).toFixed(1)} %`)
        assert.ok(off <= 0.03, `mix at ${k}: the centre is ${JSON.stringify(r[k].centre)}, not ${JSON.stringify(want.map(Math.round))}`)
      }
    }
  }
  // (The measured ratios, for the phase plan.)
  console.log('    ' + lines.join('; '))
}
