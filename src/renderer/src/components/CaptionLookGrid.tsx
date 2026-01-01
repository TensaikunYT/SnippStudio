// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// The Captions page's style grid (REF-AB, worker S, item 10; REF-AB-PLAN-S.md):
// every look the subtitles can take (subtitles/caption-looks.ts), each tile a
// sample line drawn in that look by the subtitles' own renderer, at the
// moment its last word is spoken (so a karaoke colour or a word box shows).
// A click gives the whole set that look: one undo step.
import { useEffect, useMemo, useRef, useState } from 'react'
import { drawCaptions } from '../playback/draw/captions'
import { useStore } from '../state/store'
import type { Caption, CaptionStyle } from '../types'
import { gridLooks, styleWithLook, wearsLook, lookPatch, type GridLook } from '../subtitles/caption-looks'
import { BUILT_IN_LOOKS, loadPresets } from './inspector/subs-tab'
import { BareButton, Tooltip, useT, type StringKey } from '../ui'

/** The sample line's three words, timed one second each; drawn at 2.5 s. */
function sampleCaption(text: string): Caption {
  const words = text.split(/\s+/).filter(Boolean)
  return {
    id: 'sample',
    start: 0,
    end: Math.max(1, words.length),
    text,
    words: words.map((w, i) => ({ text: w, start: i, end: i + 1 }))
  } as Caption
}

/** One 1080p frame the tiles are drawn on in turn (one at a time: drawing is synchronous). */
let FRAME: OffscreenCanvas | null = null

function LookThumb({ style, text }: { style: CaptionStyle; text: string }): JSX.Element {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const cv = ref.current
    if (!cv) return
    let live = true
    const cap = sampleCaption(text)
    const at = Math.max(0, (cap.words?.length ?? 1) - 0.5)
    // In the middle of the frame at one size, whatever the project's size and
    // place are: the tile shows the look, not the layout.
    const drawn: CaptionStyle = { ...style, posX: 0.5, posY: 0.5, fontSize: 76, maxLineChars: 40, fitWidth: 0, rotate: 0 }
    const draw = (): void => {
      if (!live) return
      const dpr = window.devicePixelRatio || 1
      const W = Math.max(2, Math.round((cv.clientWidth || 140) * dpr))
      const H = Math.max(2, Math.round((W * 9) / 16))
      if (cv.width !== W || cv.height !== H) {
        cv.width = W
        cv.height = H
      }
      const frame = (FRAME ??= new OffscreenCanvas(1920, 1080))
      const fg = frame.getContext('2d')!
      fg.setTransform(1, 0, 0, 1, 0, 0)
      fg.clearRect(0, 0, 1920, 1080)
      drawCaptions(fg, [cap], drawn, at, 1920, 1080, 1)
      const g = cv.getContext('2d')!
      g.setTransform(1, 0, 0, 1, 0, 0)
      g.clearRect(0, 0, W, H)
      // The middle of the frame, as the Text page's pictures.
      g.drawImage(frame, 560, 315, 800, 450, 0, 0, W, H)
    }
    draw()
    void document.fonts?.ready.then(draw)
    return () => {
      live = false
    }
  }, [style, text])
  return <canvas ref={ref} className="cap-look-thumb" aria-hidden="true" />
}

export function CaptionLookGrid(): JSX.Element {
  const t = useT()
  const style = useStore((s) => s.project.captionStyle)
  // The user's saved presets, read again when the page shows.
  const [saved] = useState(loadPresets)
  const looks = useMemo(() => gridLooks(BUILT_IN_LOOKS, saved), [saved])
  const sample = t('caps.look.sample')
  // Each tile's style made once per change of the set's style (a tile draws
  // again only then).
  const styles = useMemo(() => looks.map((g) => styleWithLook(style, g.look)), [looks, style])
  const nameOf = (g: GridLook): string => (g.key ? t(g.key as StringKey) : (g.name ?? ''))
  const apply = (g: GridLook): void => {
    const s = useStore.getState()
    s.undoable(() => s.setCaptionStyle(lookPatch(g.look)))
  }
  return (
    <div className="cap-looks" role="group" aria-label={t('caps.looks')} data-testid="captions.looks">
      {looks.map((g, i) => {
        const on = wearsLook(style, g.look)
        const name = nameOf(g)
        return (
          <Tooltip key={g.id} content={g.saved ? t('caps.look.saved', { name }) : name}>
            <BareButton className="cap-look" aria-pressed={on} aria-label={name} testid={`captions.look.${g.id}`} onClick={() => apply(g)}>
              <LookThumb style={styles[i]} text={sample} />
              <span className="cap-look-name">{name}</span>
            </BareButton>
          </Tooltip>
        )
      })}
    </div>
  )
}
