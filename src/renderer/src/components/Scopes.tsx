// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
import { useEffect, useRef } from 'react'
import { IconButton, useT } from '../ui'

/**
 * Video scopes over the preview: luma waveform, RGB parade, and histogram.
 *
 * The grade panel has lift/gamma/gain, curves and LUTs, and no way at all to
 * see what any of them did. On one monitor, in one room, "punchy" and "the
 * highlights are clipped" look identical — you find out on someone else's
 * screen. These read the preview canvas itself, so what they measure is what
 * the export will contain, not an approximation of it.
 *
 * Sampled at ~12 Hz from a downscaled copy: a full-res readPixels every frame
 * would cost more than the render it is measuring.
 */
export type ScopeKind = 'waveform' | 'parade' | 'histogram'

const SAMPLE_W = 240
const SAMPLE_H = 135

export function Scopes({ kind, onClose }: { kind: ScopeKind; onClose: () => void }): JSX.Element {
  const t = useT()
  const outRef = useRef<HTMLCanvasElement>(null)
  const sampleRef = useRef<HTMLCanvasElement | null>(null)

  useEffect(() => {
    if (!sampleRef.current) {
      sampleRef.current = document.createElement('canvas')
      sampleRef.current.width = SAMPLE_W
      sampleRef.current.height = SAMPLE_H
    }
    const sample = sampleRef.current
    const sctx = sample.getContext('2d', { willReadFrequently: true })

    const draw = (): void => {
      const out = outRef.current
      const src = document.querySelector('.preview-canvas-wrap canvas') as HTMLCanvasElement | null
      const octx = out?.getContext('2d')
      if (!out || !src || !octx || !sctx || src.width === 0) return
      sctx.drawImage(src, 0, 0, SAMPLE_W, SAMPLE_H)
      let data: Uint8ClampedArray
      try {
        data = sctx.getImageData(0, 0, SAMPLE_W, SAMPLE_H).data
      } catch {
        return // tainted canvas — nothing we can do, and nothing to crash over
      }
      const w = out.width
      const h = out.height
      octx.fillStyle = '#0b0b0f'
      octx.fillRect(0, 0, w, h)

      /** Reference lines at black, quarter, mid, three-quarter and white.
       *  Without them a waveform is a shape with no scale, which is exactly as
       *  useful as not having one. Drawn AFTER the trace in the pixel-buffer
       *  modes — putImageData replaces pixels outright, compositing and all
       *  previous drawing included. */
      const drawGrid = (): void => {
        octx.strokeStyle = 'rgba(255,255,255,0.12)'
        octx.lineWidth = 1
        for (const f of [0, 0.25, 0.5, 0.75, 1]) {
          const y = Math.round(h - f * h) + 0.5
          octx.beginPath()
          octx.moveTo(0, y)
          octx.lineTo(w, y)
          octx.stroke()
        }
      }

      if (kind === 'histogram') {
        drawGrid()
        const bins = 64
        const r = new Float32Array(bins)
        const g = new Float32Array(bins)
        const b = new Float32Array(bins)
        for (let i = 0; i < data.length; i += 4) {
          r[(data[i] * (bins - 1)) >> 8]++
          g[(data[i + 1] * (bins - 1)) >> 8]++
          b[(data[i + 2] * (bins - 1)) >> 8]++
        }
        let max = 1
        for (let i = 0; i < bins; i++) max = Math.max(max, r[i], g[i], b[i])
        const bw = w / bins
        octx.globalCompositeOperation = 'lighter'
        const chans: [Float32Array, string][] = [
          [r, 'rgba(255,80,80,0.75)'],
          [g, 'rgba(80,255,120,0.75)'],
          [b, 'rgba(90,140,255,0.75)']
        ]
        for (const [arr, colour] of chans) {
          octx.fillStyle = colour
          for (let i = 0; i < bins; i++) {
            const bh = (arr[i] / max) * (h - 2)
            octx.fillRect(i * bw, h - bh, Math.max(1, bw - 0.5), bh)
          }
        }
        octx.globalCompositeOperation = 'source-over'
      } else {
        // Waveform / parade: one column of the scope per column of the frame,
        // a dot per pixel at its level. Additive so density reads as brightness.
        const lanes = kind === 'parade' ? 3 : 1
        const laneW = w / lanes
        const img = octx.createImageData(w, h)
        const px = img.data
        // Opaque background baked into the buffer: putImageData does not
        // composite, so anything left at alpha 0 would punch a hole through to
        // whatever is behind the canvas.
        for (let i = 0; i < px.length; i += 4) {
          px[i] = 11
          px[i + 1] = 11
          px[i + 2] = 15
          px[i + 3] = 255
        }
        const add = (x: number, y: number, ri: number, gi: number, bi: number): void => {
          if (x < 0 || x >= w || y < 0 || y >= h) return
          const o = (y * w + x) * 4
          px[o] = Math.min(255, px[o] + ri)
          px[o + 1] = Math.min(255, px[o + 1] + gi)
          px[o + 2] = Math.min(255, px[o + 2] + bi)
        }
        for (let sy = 0; sy < SAMPLE_H; sy++) {
          for (let sx = 0; sx < SAMPLE_W; sx++) {
            const o = (sy * SAMPLE_W + sx) * 4
            const rr = data[o]
            const gg = data[o + 1]
            const bb = data[o + 2]
            if (lanes === 1) {
              // Rec.709 luma — the same weighting the eye uses.
              const luma = (0.2126 * rr + 0.7152 * gg + 0.0722 * bb) / 255
              add(Math.round((sx / SAMPLE_W) * w), Math.round(h - luma * (h - 1)), 26, 34, 30)
            } else {
              const base = Math.round((sx / SAMPLE_W) * laneW)
              add(base, Math.round(h - (rr / 255) * (h - 1)), 34, 4, 6)
              add(Math.round(laneW + base), Math.round(h - (gg / 255) * (h - 1)), 4, 34, 10)
              add(Math.round(laneW * 2 + base), Math.round(h - (bb / 255) * (h - 1)), 6, 12, 34)
            }
          }
        }
        octx.putImageData(img, 0, 0)
        drawGrid()
        if (lanes === 3) {
          octx.strokeStyle = 'rgba(255,255,255,0.15)'
          for (let i = 1; i < 3; i++) {
            octx.beginPath()
            octx.moveTo(Math.round(i * laneW) + 0.5, 0)
            octx.lineTo(Math.round(i * laneW) + 0.5, h)
            octx.stroke()
          }
        }
      }
    }

    draw()
    const id = window.setInterval(draw, 80)
    return () => window.clearInterval(id)
  }, [kind])

  const label = kind === 'histogram' ? t('scopes.histogram') : kind === 'parade' ? t('scopes.parade') : t('scopes.luma')
  return (
    <div className="scopes">
      <div className="scopes-head">
        <span>{label}</span>
        <IconButton icon="x" variant="ghost" size="sm" label={t('scopes.hide')} onClick={onClose} />
      </div>
      <canvas ref={outRef} width={264} height={120} />
      <div className="scopes-scale">
        <span>100</span>
        <span>50</span>
        <span>0</span>
      </div>
    </div>
  )
}
