// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// The Text page's styles grid (REF-AB, item 10): each card writes the style's
// own name in that style, drawn by the subtitles' renderer. A click gives the
// look to the selected texts (their words and places stay), or adds a title in
// it at the playhead. One undo step either way.
import { useEffect, useRef } from 'react'
import { useStore } from '../../state/store'
import type { Caption, CaptionStyle } from '../../types'
import { BareButton, Tooltip, getLang, useT } from '../../ui'
import { cleanLook, type TextLook } from './looks'
import { Pick } from './Pick'
import { noteUsed } from './picks'
import { fitCanvas, newFrame, paintFrame, sampleCaption, sampleStyle, show, type Crop } from './draw'
import { endTyping, startTyping } from '../preview/text-edit/session'
import { startCardDrag } from '../preview/text-edit/card-drag'

/** The frame's middle third: the name, fitted to 26 % of the frame's width, sits inside it. */
const THIRD: Crop = { x: 640, y: 360, w: 640, h: 360 }

/** The selected texts (titles, not subtitles or shapes). */
export function selectedTitles(): Caption[] {
  const s = useStore.getState()
  return s.selectedCaptionIds.map((id) => s.project.captions.find((c) => c.id === id)).filter((c): c is Caption => !!c && !!c.manual && !c.shape)
}

/** The look on the selected texts, or a title in it at the playhead (one undo
 *  step); the title selected, so the Inspector shows it. */
export function applyLook(look: Partial<CaptionStyle> | null): void {
  const s = useStore.getState()
  const sel = selectedTitles()
  const patch = cleanLook(look)
  if (sel.length) {
    s.undoable(() => {
      for (const c of sel) {
        // The project's own style ("Plain"), its place kept; or the look over what it has.
        const own = c.style ?? s.project.captionStyle
        s.setCaptionOwnStyle(c.id, patch ?? { ...s.project.captionStyle, posX: own.posX, posY: own.posY, popup: { enabled: false, duration: 0.16, intensity: 1, style: 'pop' } })
      }
    })
    return
  }
  addTitle(look)
}

/** How long a title added by hand stays (YAZI2-PLAN.md, 2.1). */
export const NEW_TITLE_SECONDS = 3

/**
 * A title in `look` (null: the project's own style): at the playhead (or at
 * `time`), in the middle of the frame (or at `at`, parts of the frame), three
 * seconds long on the first text lane free for them. One undo step. It is
 * selected and typed in at once, all its words selected: the first key
 * replaces the placeholder (YAZI2-PLAN.md, 2.1). `type: false` only adds it.
 */
export function addTitle(look: Partial<CaptionStyle> | null, o: { at?: { x: number; y: number }; time?: number; type?: boolean } = {}): string {
  endTyping()
  const s = useStore.getState()
  const patch = cleanLook(look)
  s.setPlaying(false)
  if (o.time !== undefined) s.setTime(Math.max(0, o.time))
  let id = ''
  s.undoable(() => {
    id = s.addCaptionAtPlayhead()
    s.setCaptionOwnStyle(id, { ...patch, posX: o.at?.x ?? 0.5, posY: o.at?.y ?? 0.5 })
    const now = useStore.getState().project.captions
    const cap = now.find((c) => c.id === id)
    if (!cap) return
    const end = cap.start + NEW_TITLE_SECONDS
    let layer = 1
    while (now.some((c) => c.id !== id && (c.layer ?? 0) === layer && c.start < end && c.end > cap.start)) layer++
    s.updateCaption(id, { end, layer })
  })
  s.selectCaptions([id])
  if (s.selectedClipIds.length) s.selectClip(null)
  if (o.type !== false) startTyping(id, 'all')
  return id
}

/** A style's picture: its own name, in its own look. */
function StylePicture({ look, word }: { look: Partial<CaptionStyle> | null; word: string }): JSX.Element {
  const ref = useRef<HTMLCanvasElement>(null)
  const base = useStore((s) => s.project.captionStyle)
  useEffect(() => {
    const cv = ref.current
    if (!cv) return
    let live = true
    // Large, and never wider than the card shows (fitted to 26 % of the frame).
    const style = sampleStyle(base, cleanLook(look), { fontSize: Math.min(110, Math.max(80, (look ?? base).fontSize ?? 96)), fitWidth: 0.26 })
    const caps = [sampleCaption('sample', word, style, 0, 10)]
    const draw = (): void => {
      if (!live) return
      const g = fitCanvas(cv)
      g.clearRect(0, 0, cv.width, cv.height)
      const fg = newFrame()
      paintFrame(fg, caps, style, 5)
      show(g, fg, THIRD)
    }
    draw()
    void document.fonts?.ready.then(draw)
    return () => {
      live = false
    }
  }, [base, look, word])
  return <canvas ref={ref} className="text-style-thumb" aria-hidden="true" />
}

export function StyleCard({ item }: { item: TextLook }): JSX.Element {
  const t = useT()
  const name = t(item.name)
  // (The name is the picture: its language is part of what is drawn.)
  const lang = getLang()
  const id = `style:${item.id}`
  return (
    <Pick id={id} name={name}>
      <Tooltip side="right" delay={500} content={t(item.hint)}>
        <BareButton
          className="text-style"
          testid={`dock.text.style.${item.id}`}
          aria-label={name}
          // Dragged out, it is put where it is dropped: on the preview or
          // the timeline (text-edit/card-drag.tsx). A press alone is the click.
          onPointerDown={(e) => startCardDrag(e, { name, look: item.look })}
          onClick={() => {
            noteUsed(id)
            applyLook(item.look)
          }}
        >
          {/* The name is in the picture, in the style itself: no line under it. */}
          <StylePicture key={lang} look={item.look} word={name} />
        </BareButton>
      </Tooltip>
    </Pick>
  )
}

export function TextStyles({ items }: { items: TextLook[] }): JSX.Element {
  const t = useT()
  return (
    <div className="text-styles" role="group" aria-label={t('text.sec.styles')} data-testid="dock.text.styles">
      {items.map((item) => <StyleCard key={item.id} item={item} />)}
    </div>
  )
}
