// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// The transitions between clips on a track (core polish T). At a cut with no
// transition: a target (24 × 24 px at the top of the lane, over the cut) that
// shows itself under the pointer; one click adds the remembered default and
// selects it. A transition is a block as long as it lasts, with its name: a
// click selects it (the Inspector edits it), either end drags its length (the
// timeline's one drag: 4 px to begin, a step per frame, Escape leaves no
// trace), right-click opens its menu (type, make default, delete), Delete
// removes it. A kind dragged from Library → Effects drops onto either. The old
// pop-up menu (its own list, names and length, no alignment) and the hidden
// double-click to delete are gone.
import { useEffect, useRef, useState } from 'react'
import { useStore } from '../../state/store'
import { JOIN_EPS } from '../../playback/render'
import { FloatingMenu } from '../FloatingMenu'
import type { Clip, Track } from '../../types'
import { HEADER_W, TRANS_MIN_CLIP_PX } from './shared'
import { junctionBox, TRANS_BLOCK_MIN_PX } from '../../timeline/junction-box'
import { TRANSITION_LIMITS } from '../../timeline/transition-links'
import { TRANSITION_KINDS, isTransitionType, kindOf, rampDirOf, typeOf, withType } from '../../timeline/transition-types'
import { Icon, useT, type MenuItem } from '../../ui'
import { gestureMemo, startDrag } from './drag'
import { addDefaultAt, makeDefault, putTransition, rememberDefault, selectTransition, setTransitionType, useTransitionUi } from './transition-state'
import { TRANSITION_DRAG_TYPE, transitionName } from '../inspector/transition-section'
import { nearCut } from '../../timeline/near-cut'
import './transitions.css'

/** A kind dragged from Library → Effects, dropped on a cut or a block. */
function dropProps(clipId: string): Pick<React.HTMLAttributes<HTMLElement>, 'onDragOver' | 'onDragLeave' | 'onDrop'> {
  return {
    onDragOver: (e) => {
      if (!e.dataTransfer.types.includes(TRANSITION_DRAG_TYPE)) return
      e.preventDefault()
      e.stopPropagation()
      e.dataTransfer.dropEffect = 'copy'
      e.currentTarget.classList.add('is-drop')
    },
    onDragLeave: (e) => e.currentTarget.classList.remove('is-drop'),
    onDrop: (e) => {
      e.currentTarget.classList.remove('is-drop')
      document.body.classList.remove('ct-dragging')
      const type = e.dataTransfer.getData(TRANSITION_DRAG_TYPE)
      if (!isTransitionType(type)) return
      e.preventDefault()
      e.stopPropagation()
      const clip = useStore.getState().project.clips[clipId]
      if (!clip) return
      if (clip.transitionOut) setTransitionType(clipId, type)
      else {
        putTransition(clipId, withType(null, type, useTransitionUi.getState().def.duration))
        rememberDefault({ type })
      }
      selectTransition(clipId)
    }
  }
}

/** A transition's right-click menu: its type, make it the default, delete. */
function menuItems(t: ReturnType<typeof useT>, clip: Clip): MenuItem[] {
  const tr = clip.transitionOut!
  const current = kindOf(tr.type).id
  const dir = rampDirOf(tr.type)
  return [
    ...TRANSITION_KINDS.map((k, i): MenuItem => ({
      id: k.id,
      label: t(k.name),
      icon: k.icon,
      checked: k.id === current,
      headingBefore: i === 0 ? t('ct.menu.type') : undefined,
      testid: `transition-menu.choice.${k.id}`,
      onSelect: () => setTransitionType(clip.id, typeOf(k.id, dir))
    })),
    { id: 'default', label: t('ct.menu.default'), hint: t('ct.menu.default.hint'), separatorBefore: true, testid: 'transition-menu.default', onSelect: () => makeDefault(clip.id) },
    { id: 'delete', label: t('ct.menu.delete'), icon: 'trash', danger: true, shortcut: 'Del', testid: 'transition-menu.delete', onSelect: () => putTransition(clip.id, null) }
  ]
}

/** The cuts of a video lane (those near the view: Timeline.tsx NearJunctions). */
export function TransitionJunctions({ track, clips }: { track: Track; clips: Clip[] }): JSX.Element | null {
  const pxPerSec = useStore((s) => s.pxPerSec)
  const project = useStore((s) => s.project)
  const sel = useTransitionUi((u) => u.sel)
  const tip = useTransitionUi((u) => u.tip)
  const def = useTransitionUi((u) => u.def)
  const t = useT()
  const [menu, setMenu] = useState<{ id: string; x: number; y: number } | null>(null)
  const picked = useStore((s) => s.selectedClipIds)
  // The "+" of a cut is a dot until the pointer comes near the cut along the
  // lane, or a clip of the cut is selected: then it is whole, 16 px, ready to
  // grab (audit G4: a 5 px dot that grew only right over its 24 px target).
  const [near, setNear] = useState<string | null>(null)
  const cuts = useRef<(readonly [string, number])[]>([])
  useEffect(() => {
    const lane = document.querySelector<HTMLElement>(`[data-track-id="${CSS.escape(track.id)}"]`)
    if (!lane) return
    const move = (e: PointerEvent): void => {
      const id = nearCut(cuts.current, e.clientX - lane.getBoundingClientRect().left)
      setNear((was) => (was === id ? was : id))
    }
    const leave = (): void => setNear(null)
    lane.addEventListener('pointermove', move)
    lane.addEventListener('pointerleave', leave)
    return () => {
      lane.removeEventListener('pointermove', move)
      lane.removeEventListener('pointerleave', leave)
    }
  }, [track.id])
  // (A locked track's cuts take no transition: phase Ç2b.1, report L7.)
  if (track.kind !== 'video' || track.locked) return null
  const ordered = [...clips].sort((a, b) => a.start - b.start)
  const defName = transitionName(t, def.type)
  const openCuts: [string, number][] = []
  cuts.current = openCuts
  return (
    <>
      {ordered.map((clip, i) => {
        const next = ordered[i + 1]
        // Only where two clips actually butt together (no visible gap) — the
        // render's own tolerance — and not between adjustment layers.
        if (!next || clip.adjustment || next.adjustment || Math.abs(next.start - (clip.start + clip.duration)) >= JOIN_EPS) return null
        const tr = clip.transitionOut
        // Too tight to aim at: no target (a transition already set stays
        // visible however far out you are).
        const roomPx = Math.min(clip.duration, next.duration) * pxPerSec
        if (!tr && roomPx < TRANS_MIN_CLIP_PX) return null
        const x = HEADER_W + (clip.start + clip.duration) * pxPerSec
        if (!tr) {
          openCuts.push([clip.id, x])
          const handy = near === clip.id || picked.includes(clip.id) || picked.includes(next.id)
          return (
            <div key={clip.id} className={`tl-trans-junction${handy ? ' is-near' : ''}`} data-testid={`timeline.junction.${clip.id}`} style={{ left: x }}>
              <BareButton
                type="button"
                className="tl-trans-target"
                data-testid={`timeline.junction.${clip.id}.add`}
                aria-label={t('ct.target', { name: defName, s: def.duration.toFixed(1) })}
                title={t('ct.target.hint', { name: defName, s: def.duration.toFixed(1) })}
                onPointerDown={(e) => e.stopPropagation()}
                onClick={(e) => {
                  e.stopPropagation()
                  addDefaultAt(clip.id)
                }}
                {...dropProps(clip.id)}
              >
                <span className="tl-trans-plus"><Icon name="plus" size={12} /></span>
              </BareButton>
            </div>
          )
        }
        // The window the render uses (report G5, phase Ç2b.2): where it sits
        // against the cut (auto, start, end) and as long as the clips let it
        // be, not the stored length centred.
        const box = junctionBox(project, clip, pxPerSec)
        const shownDur = box ? box.pre + box.post : tr.duration
        const name = transitionName(t, tr.type)
        const selected = sel === clip.id
        /** Drag either end to retime the transition. The edge moves with its
         *  side's share of the window: centred, one edge moving by d changes
         *  the duration by 2d; all after the cut, the right edge by d. */
        const startResize = (side: 'l' | 'r') => (e: React.PointerEvent) => {
          e.stopPropagation()
          if (e.button !== 0) return
          selectTransition(clip.id)
          const orig = tr.duration
          const share = box && box.pre + box.post > 0 ? (side === 'r' ? box.post : box.pre) / (box.pre + box.post) : 0.5
          const memo = gestureMemo()
          let value = orig
          startDrag(e, {
            horizontal: true,
            onStart: () => useStore.getState().beginGesture(),
            onMove: (p) => {
              const st = useStore.getState()
              const now = st.project.clips[clip.id]?.transitionOut
              if (!now) return
              const d = (p.dx / st.pxPerSec) * (side === 'r' ? 1 : -1) / Math.max(0.25, share)
              // (The one rule, G8; the block shows what the clips allow of it.)
              value = Math.max(TRANSITION_LIMITS.min, Math.min(TRANSITION_LIMITS.max, orig + d))
              st.setTransitionOut(clip.id, { ...now, duration: value })
              useTransitionUi.setState({ tip: { clipId: clip.id, text: t('ct.tip', { s: value.toFixed(2) }) } })
            },
            onEnd: (_p, moved) => {
              useTransitionUi.setState({ tip: null })
              if (moved) rememberDefault({ duration: value })
            },
            onCancel: (moved) => {
              useTransitionUi.setState({ tip: null })
              if (moved) memo.restore()
              selectTransition(clip.id)
            }
          })
        }
        return (
          <div key={clip.id} className="tl-trans-junction" data-testid={`timeline.junction.${clip.id}`} style={{ left: x }}>
            <div
              className={`tl-trans-block${selected ? ' is-selected' : ''}`}
              data-testid={`timeline.junction.${clip.id}.block`}
              aria-selected={selected}
              style={box ? { width: Math.max(TRANS_BLOCK_MIN_PX, box.width), left: `calc(50% - ${box.pre * pxPerSec}px)`, transform: 'none' } : { width: TRANS_BLOCK_MIN_PX }}
              title={t('ct.block.hint', { name, s: shownDur.toFixed(2) })}
              onPointerDown={(e) => {
                e.stopPropagation()
                if (e.button === 0) selectTransition(clip.id)
              }}
              onContextMenu={(e) => {
                e.preventDefault()
                e.stopPropagation()
                selectTransition(clip.id)
                setMenu({ id: clip.id, x: e.clientX, y: e.clientY })
              }}
              {...dropProps(clip.id)}
            >
              <span className="tt-edge l" data-testid={`timeline.junction.${clip.id}.edge-l`} onPointerDown={startResize('l')} />
              <span className="tt-mid" data-testid={`timeline.junction.${clip.id}.change`}>
                <Icon name={kindOf(tr.type).icon} size={12} />
                {shownDur * pxPerSec > 64 && <span className="tt-name">{name}</span>}
                {/* Silent unless given a sound (DENEME-3, V item 2): the mark is on the ones that sound. */}
                {(tr.sfx ?? 0) > 0 && <span className="tt-mute" title={t('trans.sounding')}><Icon name="volume-2" size={12} /></span>}
              </span>
              <span className="tt-edge r" data-testid={`timeline.junction.${clip.id}.edge-r`} onPointerDown={startResize('r')} />
            </div>
            {tip?.clipId === clip.id && <span className="tl-trans-tip" role="status" data-testid="timeline.transition-tip">{tip.text}</span>}
            {menu?.id === clip.id && (
              <>
                <div className="ctx-backdrop" onPointerDown={(e) => (e.stopPropagation(), setMenu(null))} />
                <FloatingMenu x={menu.x} y={menu.y} onPointerDown={(e) => e.stopPropagation()} label={t('ct.menu')} testid="transition-menu" onClose={() => setMenu(null)} items={menuItems(t, clip)} />
              </>
            )}
          </div>
        )
      })}
    </>
  )
}

import { BareButton } from '../../ui/Button'