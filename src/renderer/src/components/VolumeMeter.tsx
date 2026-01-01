// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
import { useEffect, useRef } from 'react'
import { engine } from '../playback/engine'
import { useStore } from '../state/store'
import { useT } from '../ui'

/**
 * Live output-level meter. Green → yellow → red; the red "LOUD" dot lights
 * when the signal approaches clipping (over ≈ -3 dBFS).
 */
export function VolumeMeter(): JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const playing = useStore((s) => s.playing)
  const t = useT()

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')!
    let raf = 0
    let smooth = 0
    const data = new Uint8Array(1024)
    // Rebuilt only when the canvas changes width. It used to be allocated on
    // every frame, forever.
    let grad: CanvasGradient | null = null
    let gradW = -1
    // The meter's colours are the design values (read once from the sheet).
    const css = getComputedStyle(canvas)
    const tone = (name: string): string => css.getPropertyValue(name).trim()
    const [rail, low, mid, high, idle] = [tone('--line-strong'), tone('--level-ok'), tone('--warn'), tone('--danger'), tone('--line-strong')]

    const draw = () => {
      const analyser = playing ? engine.getAnalyser() : null
      let level = 0
      if (analyser) {
        analyser.getByteTimeDomainData(data)
        let sum = 0
        for (let i = 0; i < data.length; i++) {
          const v = (data[i] - 128) / 128
          sum += v * v
        }
        level = Math.sqrt(sum / data.length)
      }
      // Fast attack, slow release.
      smooth = level > smooth ? level : smooth * 0.92
      const w = canvas.width
      const h = canvas.height
      ctx.clearRect(0, 0, w, h)
      ctx.fillStyle = rail
      ctx.fillRect(0, h / 2 - 2, w - 14, 4)
      const frac = Math.min(1, smooth * 1.6)
      if (!grad || gradW !== w) {
        grad = ctx.createLinearGradient(0, 0, w - 14, 0)
        grad.addColorStop(0, low)
        grad.addColorStop(0.7, mid)
        grad.addColorStop(1, high)
        gradW = w
      }
      ctx.fillStyle = grad
      ctx.fillRect(0, h / 2 - 2, (w - 14) * frac, 4)
      // Clipping indicator: RMS ≈ 0.5 corresponds to peaks near 0 dBFS.
      const loud = smooth > 0.45
      ctx.fillStyle = loud ? high : idle
      ctx.beginPath()
      ctx.arc(w - 5, h / 2, 4, 0, Math.PI * 2)
      ctx.fill()

      // Nothing is playing and the needle has fallen to rest: there is nothing
      // left to animate. Stop, instead of repainting an empty bar sixty times
      // a second for the rest of the session on the same thread the preview
      // draws on. Playing again re-runs the effect, which restarts the loop.
      // Keep going for as long as something is playing — the analyser can be
      // null for a moment while the audio graph comes up, and stopping there
      // would leave a dead meter until the next pause. Otherwise stop once the
      // needle has fallen to rest.
      raf = playing || smooth >= 0.001 ? requestAnimationFrame(draw) : 0
    }
    draw()
    return () => {
      if (raf) cancelAnimationFrame(raf)
    }
  }, [playing])

  return (
    <canvas
      ref={canvasRef}
      className="volume-meter"
      width={110}
      height={16}
      title={t('transport.meter.hint')}
      aria-label={t('transport.meter')}
      role="img"
    />
  )
}
