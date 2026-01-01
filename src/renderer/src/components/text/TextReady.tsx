// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// The Text page's ready-made texts (YAZI-PANELI-PLAN.md §4). The quote and the
// big number ARE the Templates' own (quote, stat); the other four are built
// from plain titles: each part a title of its own (its own layer, look, place
// and animation), added together as one undo step and all selected, every
// part edited like any title. The user picks one by hand: nothing here is
// offered to the agent (principle 6).
import { useEffect, useMemo, useRef, useState } from 'react'
import { useStore } from '../../state/store'
import type { Caption, CaptionStyle, TemplateKind } from '../../types'
import { BareButton, Tooltip, getLang, t, useT, type StringKey } from '../../ui'
import { TemplateThumb, paintStandIn } from '../TemplatePanel'
import { CLEAN, SOFT_SHADOW as SOFT } from './looks'
import { Pick } from './Pick'
import { noteUsed } from './picks'
import { cropAround, fitCanvas, newFrame, paintFrame, runPicture, sampleCaption, sampleStyle, show, type Crop } from './draw'

/** One title of a ready-made text. */
interface Part {
  /** Its words (in the interface's language when added). */
  text: StringKey
  look: Partial<CaptionStyle>
  anim: NonNullable<Caption['anim']>
  /** Seconds after the first part's start. */
  delay: number
}

export type ReadyId = 'titleSub' | 'lower' | 'chapter' | 'quote' | 'stat' | 'end'
export type Ready = { id: ReadyId; parts: Part[]; seconds: number } | { id: ReadyId; template: TemplateKind }

export const READY: Ready[] = [
  {
    id: 'titleSub',
    seconds: 4,
    parts: [
      { text: 'text.ready.titleSub.a', delay: 0, anim: { in: 'slide', out: 'fade', inDur: 0.5 }, look: { fontFamily: 'Archivo Black', fontWeight: 400, fontSize: 104, color: '#ffffff', posY: 0.46, shadow: SOFT } },
      { text: 'text.ready.titleSub.b', delay: 0.3, anim: { in: 'fade', out: 'fade', inDur: 0.5 }, look: { fontFamily: 'Inter', fontWeight: 500, fontSize: 44, color: '#e8e8ec', posY: 0.57, shadow: SOFT } }
    ]
  },
  {
    id: 'lower',
    seconds: 5,
    parts: [
      { text: 'text.ready.lower.a', delay: 0, anim: { in: 'slide', out: 'fade', inDur: 0.4 }, look: { fontFamily: 'Inter', fontWeight: 700, fontSize: 50, color: '#121215', bgColor: '#ffffff', bgOpacity: 1, bgPadX: 0.5, bgPadY: 0.28, bgRadius: 6, posX: 0.24, posY: 0.8 } },
      { text: 'text.ready.lower.b', delay: 0.2, anim: { in: 'slide', out: 'fade', inDur: 0.4 }, look: { fontFamily: 'Inter', fontWeight: 500, fontSize: 32, color: '#ffffff', bgColor: '#16161a', bgOpacity: 0.92, bgPadX: 0.6, bgPadY: 0.32, bgRadius: 6, posX: 0.24, posY: 0.867 } }
    ]
  },
  {
    id: 'chapter',
    seconds: 3.5,
    parts: [
      { text: 'text.ready.chapter.a', delay: 0, anim: { in: 'fade', out: 'fade', inDur: 0.5 }, look: { fontFamily: 'Inter', fontWeight: 600, fontSize: 30, letterSpacing: 6, uppercase: true, color: '#e8c37a', posY: 0.43, shadow: SOFT } },
      { text: 'text.ready.chapter.b', delay: 0.25, anim: { in: 'blur', out: 'fade', inDur: 0.6 }, look: { fontFamily: 'Merriweather', fontWeight: 700, fontSize: 88, color: '#ffffff', posY: 0.52, shadow: SOFT } }
    ]
  },
  { id: 'quote', template: 'quote' },
  { id: 'stat', template: 'stat' },
  {
    id: 'end',
    seconds: 5,
    parts: [
      { text: 'text.ready.end.a', delay: 0, anim: { in: 'zoom', out: 'fade', inDur: 0.5 }, look: { fontFamily: 'Inter', fontWeight: 700, fontSize: 64, color: '#ffffff', posY: 0.43, shadow: SOFT } },
      { text: 'text.ready.end.b', delay: 0.45, anim: { in: 'pop', out: 'fade', inDur: 0.4 }, look: { fontFamily: 'Inter', fontWeight: 700, fontSize: 46, color: '#ffffff', bgColor: '#e5322d', bgOpacity: 1, bgPadX: 0.75, bgPadY: 0.36, bgRadius: 40, posY: 0.57 } }
    ]
  }
]

/** Adds a ready-made text at the playhead (one undo step) and selects it. */
export function addReady(ready: Ready): void {
  const s = useStore.getState()
  s.setPlaying(false)
  if ('template' in ready) {
    const id = s.insertTemplate(ready.template)
    if (id) s.selectTemplate(id)
    return
  }
  const at = s.currentTime
  const ids: string[] = []
  s.undoable(() => {
    for (const part of ready.parts) {
      // Each part made whole before the next, so the next finds its own free layer.
      const id = s.addCaptionAtPlayhead(t(part.text))
      s.updateCaption(id, { start: at + part.delay, end: at + ready.seconds, anim: part.anim })
      s.setCaptionOwnStyle(id, { ...CLEAN, ...part.look })
      ids.push(id)
    }
  })
  s.selectCaptions(ids)
}

/** The parts as sample titles (their words in the interface's language). */
function sampleParts(ready: Extract<Ready, { parts: Part[] }>, base: CaptionStyle, word: (k: StringKey) => string): Caption[] {
  return ready.parts.map((part, i) => {
    const style = sampleStyle(base, { ...CLEAN, posX: 0.5, ...part.look })
    return sampleCaption(`ready-${i}`, word(part.text), style, 0.15 + part.delay, ready.seconds, part.anim, i + 1)
  })
}

const READY_LOOP_MS = 2600

function ReadyPicture({ ready, playing }: { ready: Extract<Ready, { parts: Part[] }>; playing: boolean }): JSX.Element {
  const ref = useRef<HTMLCanvasElement>(null)
  const base = useStore((s) => s.project.captionStyle)
  const t = useT()
  // (t is one function in every language: the language is the memo's key.)
  const lang = getLang()
  const caps = useMemo(() => sampleParts(ready, base, (k) => t(k)), [ready, base, t, lang])
  useEffect(() => {
    const cv = ref.current
    if (!cv) return
    const fg = newFrame()
    // Where it sits once settled: the card shows that part of the frame.
    let crop: Crop | null = null
    const settled = 0.15 + Math.max(...ready.parts.map((p) => p.delay + (p.anim.inDur ?? 0.35))) + 0.05
    const frame = (time: number): void => {
      const g = fitCanvas(cv)
      paintStandIn(g, cv.width, cv.height)
      if (!crop) {
        paintFrame(fg, caps, base, settled)
        crop = cropAround(fg)
      }
      paintFrame(fg, caps, base, time)
      show(g, fg, crop)
    }
    return runPicture(playing, READY_LOOP_MS, () => frame(settled), (s) => frame(s))
  }, [caps, base, ready, playing])
  return <canvas ref={ref} className="text-style-thumb" aria-hidden="true" />
}

export function ReadyCard({ ready, active }: { ready: Ready; active: boolean }): JSX.Element {
  const t = useT()
  const [hot, setHot] = useState(false)
  const name = t(`text.ready.${ready.id}` as StringKey)
  const id = `ready:${ready.id}`
  return (
    <Pick id={id} name={name}>
      <Tooltip content={t(`text.ready.${ready.id}.hint` as StringKey)} heading={name}>
        <BareButton
          className="text-style"
          testid={`dock.text.ready.${ready.id}`}
          aria-label={name}
          onClick={() => {
            noteUsed(id)
            addReady(ready)
          }}
          onPointerEnter={() => setHot(true)}
          onPointerLeave={() => setHot(false)}
          onFocus={() => setHot(true)}
          onBlur={() => setHot(false)}
        >
          {'template' in ready ? <TemplateThumb kind={ready.template} active={active} className="text-style-thumb" hot={hot} /> : <ReadyPicture ready={ready} playing={hot} />}
          <span className="text-style-name">{name}</span>
        </BareButton>
      </Tooltip>
    </Pick>
  )
}

export function TextReady({ items, active }: { items: Ready[]; active: boolean }): JSX.Element {
  const t = useT()
  return (
    <div className="text-styles is-ready" role="group" aria-label={t('text.sec.ready')} data-testid="dock.text.ready">
      {items.map((r) => <ReadyCard key={r.id} ready={r} active={active} />)}
    </div>
  )
}
