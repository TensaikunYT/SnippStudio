// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { engine } from '../playback/engine'
import { useStore } from '../state/store'
import { drawTemplateAt } from '../templates/draw'
import { createTemplate, defaultTemplateStyle, TEMPLATE_KINDS } from '../templates/model'
import type { Project, TemplateBlock, TemplateKind } from '../types'
import { uid } from '../types'
import { Button, Icon, Tooltip, useT } from '../ui'
import { templateHint, templateName } from '../ui/data-names'

/** A sample block of each kind, for the gallery thumbnails. */
function sampleBlock(kind: TemplateKind): TemplateBlock {
  const scratch = { templates: [] } as unknown as Project
  createTemplate(scratch, kind, 0)
  const b = scratch.templates![0]
  return { ...b, id: `sample-${kind}`, seed: 4242, style: defaultTemplateStyle(kind), items: b.items.map((it) => ({ ...it, id: uid() })) }
}

/** The moment of each template that best shows what it does. */
const POSTER: Record<TemplateKind, number> = { steps: 6.2, ranking: 10.5, versus: 7.8, stat: 5.2, timeline: 5.4, gallery: 3.2, count: 6.5, focus: 4.2, home: 1.9, map: 3.6, terminal: 5.5, quote: 5.5, bars: 6.5, pie: 6.8, line: 7.5, cutout: 4.2, compare: 3.6, checklist: 5.2, post: 4.6, poll: 5.2, cards: 5.2, chess: 7.6, news: 2.2, atlas: 3.4, chapter: 2.4, list: 4.2, words: 2.0, player: 1.6, store: 6.5, boxes: 6.2, domino: 5.2 }

/** Stand-in footage under a thumbnail: a dusk gradient, so "dim" and "blur"
 *  have something to act on the way they will over a real shot (the Text
 *  page's ready-made texts sit on it too). */
export function paintStandIn(g: CanvasRenderingContext2D, W: number, H: number): void {
  const bg = g.createLinearGradient(0, 0, W, H)
  bg.addColorStop(0, '#3b5876')
  bg.addColorStop(0.55, '#6f7f6a')
  bg.addColorStop(1, '#2d3b2a')
  g.fillStyle = bg
  g.fillRect(0, 0, W, H)
}

/** A template's picture: its sample drawn by the templates' own renderer,
 *  playing while pointed at (the Text page's ready-made quote and big number
 *  use it too). */
export function TemplateThumb({ kind, active, className = 'tpl-thumb', hot }: { kind: TemplateKind; active: boolean; className?: string; hot?: boolean }): JSX.Element {
  const ref = useRef<HTMLCanvasElement>(null)
  const [hover, setHover] = useState(false)
  // Pointed at itself, or at the card it sits in (`hot`, given by that card).
  const playing = hot ?? hover
  const block = useRef<TemplateBlock>(sampleBlock(kind))
  useEffect(() => {
    const cv = ref.current
    if (!cv || !active) return
    const project = { ...useStore.getState().project, templates: [block.current] } as Project
    let raf = 0
    const start = performance.now()
    const draw = (): void => {
      const w = cv.clientWidth || 180
      const dpr = window.devicePixelRatio || 1
      const W = Math.round(w * dpr)
      const H = Math.round((W * 9) / 16)
      if (cv.width !== W || cv.height !== H) {
        cv.width = W
        cv.height = H
      }
      const g = cv.getContext('2d')!
      g.setTransform(1, 0, 0, 1, 0, 0)
      paintStandIn(g, W, H)
      const b = block.current
      const t = playing ? ((performance.now() - start) / 1000) % b.duration : POSTER[kind]
      drawTemplateAt(g, project, b, t, engine.resolve, W / 1920, { left: 0, width: 1920, height: 1080 })
      if (playing) raf = requestAnimationFrame(draw)
    }
    draw()
    return () => cancelAnimationFrame(raf)
  }, [kind, playing, active])
  return (
    <canvas
      ref={ref}
      className={className}
      onPointerEnter={() => setHover(true)}
      onPointerLeave={() => setHover(false)}
      aria-hidden="true"
    />
  )
}

export function TemplatePanel({ active, top }: { active: boolean; /** Laid over the gallery, in the same scroll: the ready-made texts (okunur). */ top?: ReactNode }): JSX.Element {
  const t = useT()
  const count = useStore((s) => s.project.templates?.length ?? 0)
  const insert = (kind: TemplateKind): void => {
    // At the playhead; a home screen goes over the nearest cut, centred on it
    // (commands/templates.ts, template.place).
    const s = useStore.getState()
    const id = s.insertTemplate(kind)
    if (id) s.selectTemplate(id)
  }
  return (
    <div className="tpl-panel">
      {top}
      <div className="dock-intro">
        <strong>{t('tplPanel.title')}</strong>
        <Tooltip content={t('tplPanel.intro')}>
          <span className="ui-section-info" role="note" tabIndex={0} aria-label={t('tplPanel.intro')}>
            <Icon name="info" size={14} />
          </span>
        </Tooltip>
        <span className="dock-note tpl-count">{count ? t('tplPanel.onLane', { n: count }) : t('tplPanel.hover')}</span>
      </div>
      <div className="tpl-gallery">
        {TEMPLATE_KINDS.map((kind) => {
          return (
            <div className="tpl-card" key={kind}>
              <TemplateThumb kind={kind} active={active} />
              <div className="tpl-card-body">
                <div className="tpl-card-title">
                  <strong>{templateName(kind)}</strong>
                </div>
                <span className="tpl-card-hint">{templateHint(kind)}</span>
                <Tooltip content={t('tplPanel.insert.hint')}>
                  <Button variant="secondary" size="sm" icon="plus" testid={`templates.insert.${kind}`} onClick={() => insert(kind)}>
                    {t('tplPanel.insert')}
                  </Button>
                </Tooltip>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
