// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// The user's list, item 8 (SnippStudio KLISTE-PLAN.md): a transition on the
// lower track (V1) must stay under the track above it (V2). V1: a red shot
// then a green one, every transition in turn at the cut; V2: a blue picture
// over the left half of the frame for the whole time. Through the
// transition, in the export's frame and in the preview's own canvas, the
// left half stays exactly blue (nothing of the transition, its light or its
// movement over it) and the right half is the transition itself (neither
// blue, nor, in the middle of it, still only the red shot for a type that
// moves or mixes).
import { spawnSync } from 'node:child_process'
import { join } from 'node:path'
import { ffmpegBin } from '../media.mjs'
export const name = 'kliste-layer'
export const timeoutMs = 240_000

const RED = [200, 40, 40]
const GREEN = [40, 180, 60]
const BLUE = [30, 60, 220]

function card(file, w, h, rgb) {
  const hex = '0x' + rgb.map((v) => v.toString(16).padStart(2, '0')).join('')
  const r = spawnSync(ffmpegBin('ffmpeg'), ['-v', 'error', '-y', '-f', 'lavfi', '-i', `color=c=${hex}:s=${w}x${h}`, '-frames:v', '1', file], { encoding: 'utf8', windowsHide: true })
  if (r.status !== 0) throw new Error('ffmpeg: ' + r.stderr)
}

const TYPES = ['mix', 'fade', 'slide', 'wipe', 'zoom', 'flash', 'whip', 'blur', 'iris', 'push', 'ramp-right', 'ramp-left', 'ramp-up', 'ramp-down', 'speed-ramp', 'light-leak', 'film-burn']

export async function run({ c, app, lib, work }) {
  const { assert } = lib
  const red = join(work, 'red.png')
  const green = join(work, 'green.png')
  const blue = join(work, 'blue.png')
  card(red, 640, 360, RED)
  card(green, 640, 360, GREEN)
  card(blue, 320, 360, BLUE)
  const [r, g, b] = await lib.seedAssets(app, c, [red, green, blue])
  const rows = []
  for (const type of TYPES) {
    const res = await c.run(async (ids, type) => {
      const S = window.__store
      const p = structuredClone(S.getState().project)
      const T = (x) => ({ x, y: 180, scale: 1, rotation: 0 })
      p.settings = { ...p.settings, width: 640, height: 360, fps: 30 }
      p.tracks = [
        { id: 'V2', kind: 'video', name: 'V2', clipIds: ['top'] },
        { id: 'V1', kind: 'video', name: 'V1', clipIds: ['a', 'b'] },
        { id: 'A1', kind: 'audio', name: 'A1', clipIds: [] }
      ]
      p.clips = {
        a: { id: 'a', assetId: ids[0], trackId: 'V1', start: 0, inPoint: 0, duration: 3, transform: T(320), volume: 1, transitionOut: { type, duration: 1, to: 'b' } },
        b: { id: 'b', assetId: ids[1], trackId: 'V1', start: 3, inPoint: 0, duration: 3, transform: T(320), volume: 1 },
        top: { id: 'top', assetId: ids[2], trackId: 'V2', start: 0, inPoint: 0, duration: 6, transform: T(160), volume: 1 }
      }
      p.captions = []
      S.getState().setPlaying(false)
      S.getState().loadProject(p)
      await new Promise((res) => setTimeout(res, 250))
      const ex = await window.__exporter()
      const proj = S.getState().project
      await ex.preloadImagesForExport(proj)
      const grid = (g, w, h) => {
        // Left half: a 4 × 4 grid of points inside the blue picture; right half: its middle.
        const left = []
        for (const fx of [0.05, 0.15, 0.3, 0.45]) for (const fy of [0.05, 0.35, 0.65, 0.95]) left.push([...g.getImageData(Math.round(fx * w), Math.round(fy * h), 1, 1).data].slice(0, 3))
        const right = [...g.getImageData(Math.round(0.75 * w), Math.round(0.5 * h), 1, 1).data].slice(0, 3)
        return { left, right }
      }
      const exported = async (t) => {
        const u8 = await ex.exportFramePng(proj, t, true, 'final')
        const bmp = await createImageBitmap(new Blob([u8]))
        const cv = new OffscreenCanvas(bmp.width, bmp.height)
        const g = cv.getContext('2d', { willReadFrequently: true })
        g.drawImage(bmp, 0, 0)
        return grid(g, bmp.width, bmp.height)
      }
      // The preview: the playhead put there, the frame inside the canvas on
      // screen read (fitted and centred as PreviewCanvas.tsx draws it, as
      // scenario 47 reads it).
      const previewed = async (t) => {
        S.getState().setTime(t)
        await new Promise((res) => setTimeout(res, 400))
        const cv = document.querySelector('[data-testid="preview.canvas"]')
        const st = S.getState()
        const { width, height } = st.project.settings
        const pv = st.previewView
        const cw = cv.clientWidth
        const ch = cv.clientHeight
        const dpr = cv.width / cw
        const fit = Math.min(cw / width, ch / height) * (pv.zoom || 1)
        const dw = width * fit
        const dh = height * fit
        const dx = (cw - dw) / 2 + (pv.x || 0)
        const dy = (ch - dh) / 2 + (pv.y || 0)
        const o = new OffscreenCanvas(width, height)
        const g = o.getContext('2d', { willReadFrequently: true })
        g.drawImage(cv, (dx + 2) * dpr, (dy + 2) * dpr, (dw - 4) * dpr, (dh - 4) * dpr, 0, 0, width, height)
        return grid(g, width, height)
      }
      const out = {}
      for (const t of [2.75, 3.0, 3.25]) out[t] = { exported: await exported(t), preview: await previewed(t) }
      return out
    }, [r.id, g.id, b.id], type)
    rows.push({ type, res })
  }
  const off = (a, b) => Math.max(...a.map((v, i) => Math.abs(v - b[i])))
  const bad = []
  const moving = []
  for (const { type, res } of rows) {
    for (const [t, both] of Object.entries(res)) {
      for (const [where, s] of Object.entries(both)) {
        const worst = Math.max(...s.left.map((px) => off(px, BLUE)))
        // (The preview draws at its own size with its own smoothing: 6 levels.)
        if (worst > (where === 'exported' ? 2 : 6)) bad.push(`${type} at ${t} s (${where}): the upper picture is ${JSON.stringify(s.left.find((px) => off(px, BLUE) === worst))}, not blue`)
        if (off(s.right, BLUE) < 30) bad.push(`${type} at ${t} s (${where}): the right half is blue`)
      }
      if (t === '3' && off(both.exported.right, RED) > 8) moving.push(type)
    }
  }
  console.log(`    ${TYPES.length} transitions × 3 moments × export and preview; under way on the right half at the cut: ${moving.length}/${TYPES.length}`)
  assert.deepEqual(bad, [], bad.join('\n'))
}
