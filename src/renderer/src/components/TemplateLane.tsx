// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
import { gestureMemo, startDrag, type DragPoint } from './timeline/drag'
import { Fragment, useEffect, useState } from 'react'
import { useStore } from '../state/store'
import { deleteTemplate, findTemplate, setBoxTime, setTemplateCut, templateSlots } from '../templates/model'
import type { Project, TemplateBlock } from '../types'
import { templateEnd, TIMELINE_HEADER_W, uid } from '../types'
import { FloatingMenu } from './FloatingMenu'
import { Icon, Tooltip, useT, type MenuItem } from '../ui'
import { templateName } from '../ui/data-names'

const HEADER_W = TIMELINE_HEADER_W

function snapTimes(p: Project, now: number, skip: string): number[] {
  const out = [0, now]
  for (const m of p.markers ?? []) out.push(m.time)
  for (const tr of p.tracks) {
    for (const id of tr.clipIds) {
      const c = p.clips[id]
      if (c) out.push(c.start, c.start + c.duration)
    }
  }
  for (const t of p.templates ?? []) if (t.id !== skip) out.push(t.start, templateEnd(t))
  return out
}

/** The "G" lane: template graphics as blocks. Drag to retime, drag the right
 *  edge to give it more or less time (its items re-space themselves). A block
 *  cut short (Ctrl+B) ends at its cut: its right edge moves the cut, and past
 *  its whole length it is whole again. */
export function TemplateLane(): JSX.Element | null {
  const templates = useStore((s) => s.project.templates)
  const pxPerSec = useStore((s) => s.pxPerSec)
  const sel = useStore((s) => s.templateSel)
  const t = useT()
  const [menu, setMenu] = useState<{ id: string; x: number; y: number } | null>(null)
  // The playhead's time is read only by the open menu (its "cut at the
  // playhead"): the lane does not re-render with every frame of playback.
  const now = useStore((s) => (menu ? s.currentTime : 0))

  useEffect(() => {
    if (!menu) return
    const close = (): void => setMenu(null)
    window.addEventListener('pointerdown', close)
    window.addEventListener('blur', close)
    return () => {
      window.removeEventListener('pointerdown', close)
      window.removeEventListener('blur', close)
    }
  }, [menu])

  if (!templates || templates.length === 0) return null

  /** The rows of a block's menu (right-click). */
  const menuItems = (id: string): MenuItem[] => {
    const tpl = templates.find((x) => x.id === id)
    const local = tpl ? now - tpl.start : 0
    return [
      {
        id: 'duplicate',
        label: t('tpl.menu.duplicate'),
        icon: 'copy',
        onSelect: () => {
          const st = useStore.getState()
          let copyId = ''
          st.editTemplates((p) => {
            const from = findTemplate(p, id)
            if (!from) return
            const copy: TemplateBlock = structuredClone(from)
            copy.id = uid()
            copy.start = templateEnd(from)
            copy.items = copy.items.map((it) => ({ ...it, id: uid() }))
            p.templates!.push(copy)
            p.templates!.sort((x, y) => x.start - y.start)
            copyId = copy.id
          })
          if (copyId) st.selectTemplate(copyId)
        }
      },
      ...(tpl && tpl.cut !== undefined
        ? [{ id: 'restore', label: t('tpl.menu.restore'), icon: 'rotate-ccw' as const, onSelect: () => useStore.getState().editTemplates((p) => setTemplateCut(p, id, undefined)) }]
        : tpl
          ? [{ id: 'cut', label: t('tpl.menu.cut'), icon: 'scissors' as const, shortcut: 'ctrl+b', hint: t('tpl.menu.cut.hint'), disabled: local < 0.3 || local > tpl.duration - 0.25, onSelect: () => useStore.getState().editTemplates((p) => setTemplateCut(p, id, local)) }]
          : []),
      {
        id: 'delete',
        label: t('tpl.menu.delete'),
        icon: 'trash',
        danger: true,
        separatorBefore: true,
        onSelect: () => {
          const st = useStore.getState()
          st.editTemplates((p) => deleteTemplate(p, id))
          st.selectTemplate(null)
        }
      }
    ]
  }

  const startBlockDrag = (e: React.PointerEvent, b: TemplateBlock, mode: 'move' | 'dur'): void => {
    e.stopPropagation()
    if (e.button !== 0) return
    useStore.getState().selectTemplate(b.id)
    // (timeline/drag.ts: it begins after 4 px, a step per frame, the view's
    // own scrolling followed, Escape takes it back. Phase 3c.T.)
    const memo = gestureMemo()
    const onMove = (ev: DragPoint): void => {
      const st = useStore.getState()
      const dt = ev.dx / st.pxPerSec
      const thr = 8 / st.pxPerSec
      let guide: number | null = null
      if (mode === 'move') {
        let start = Math.max(0, b.start + dt)
        if (!ev.shiftKey) {
          let best = thr
          for (const c of snapTimes(st.project, st.currentTime, b.id)) {
            if (Math.abs(start - c) <= best) {
              best = Math.abs(start - c)
              start = c
              guide = c
            }
            const len = templateEnd(b) - b.start
            if (Math.abs(start + len - c) <= best) {
              best = Math.abs(start + len - c)
              start = c - len
              guide = c
            }
          }
        }
        st.editTemplates((p) => {
          const t = findTemplate(p, b.id)
          if (t) t.start = Math.max(0, start)
        }, false)
      } else if (b.cut !== undefined && !ev.altKey) {
        // Cut short: the edge moves the cut (where it leaves).
        let at = b.start + b.cut + dt
        if (!ev.shiftKey) {
          for (const c of snapTimes(st.project, st.currentTime, b.id)) {
            if (Math.abs(at - c) <= thr) {
              at = c
              guide = c
              break
            }
          }
        }
        // Dragged out past its whole length: whole again.
        const local = at - b.start
        st.editTemplates((p) => setTemplateCut(p, b.id, local >= b.duration - 0.25 ? undefined : Math.max(0.3, local)), false)
      } else {
        let end = Math.max(b.start + 1, b.start + b.duration + dt)
        if (!ev.shiftKey) {
          for (const c of snapTimes(st.project, st.currentTime, b.id)) {
            if (Math.abs(end - c) <= thr && c >= b.start + 1) {
              end = c
              guide = c
              break
            }
          }
        }
        st.editTemplates((p) => {
          const t = findTemplate(p, b.id)
          if (t) t.duration = Math.min(120, Math.max(1, end - b.start))
        }, false)
      }
      st.setSnapGuide(guide)
    }
    const onUp = (moved: boolean): void => {
      const st = useStore.getState()
      st.setSnapGuide(null)
      if (moved) st.editTemplates((p) => p.templates?.sort((x, y) => x.start - y.start), false)
      else if (mode === 'move') {
        st.setPlaying(false)
        // Land a little way in: at the very start nothing has appeared yet.
        st.setTime(b.start + Math.min(1.2, b.duration * 0.3))
      }
    }
    startDrag(e, {
      horizontal: true,
      onStart: () => useStore.getState().beginGesture(),
      onMove,
      onEnd: (_p, moved) => onUp(moved),
      onCancel: (moved) => {
        useStore.getState().setSnapGuide(null)
        if (moved) memo.restore()
      }
    })
  }

  return (
    <div className="tl-tpl-lane">
      <div className="tl-track-label tpl-label" onPointerDown={(e) => e.stopPropagation()}>
        <Tooltip content={t('tpl.lane.hint')}>
          <span className="tname" tabIndex={0}>
            <Icon name="layout-grid" size={14} />
            <em>{t('tpl.lane.name')}</em>
          </span>
        </Tooltip>
      </div>
      {templates.map((b) => {
        const cut = b.cut !== undefined
        const w = Math.max(14, (templateEnd(b) - b.start) * pxPerSec)
        return (
          <Fragment key={b.id}>
          {cut && (
            // The rest of it, not shown: dragging the edge out brings it back.
            <div className="tl-tpl-rest" style={{ left: HEADER_W + b.start * pxPerSec + w, width: Math.max(0, (b.start + b.duration) * pxPerSec - (b.start * pxPerSec + w)) }} />
          )}
          <div
            className={`tl-tpl-block${sel === b.id ? ' selected' : ''}${cut ? ' cut' : ''}`}
            style={{ left: HEADER_W + b.start * pxPerSec, width: w }}
            title={
              cut
                ? t('tpl.block.cut.hint', { name: `${templateName(b.kind)}${b.title ? ` — ${b.title}` : ''}`, cut: b.cut!.toFixed(1), whole: b.duration.toFixed(1) })
                : t('tpl.block.hint', { name: `${templateName(b.kind)}${b.title ? ` — ${b.title}` : ''}`, n: b.items.length })
            }
            onPointerDown={(e) => startBlockDrag(e, b, 'move')}
            onContextMenu={(e) => {
              e.preventDefault()
              e.stopPropagation()
              useStore.getState().selectTemplate(b.id)
              setMenu({ id: b.id, x: e.clientX, y: e.clientY })
            }}
          >
            <span className="ico"><Icon name="layout-grid" size={12} /></span>
            {w > 50 && <span className="lbl">{b.title || templateName(b.kind)}</span>}
            {/* Where each item arrives, so the block can be lined up with speech. */}
            {w > 60 &&
              (() => {
                const slots = templateSlots(b)
                return Array.from({ length: slots.count }, (_, i) =>
                  b.kind === 'boxes' ? (
                    // A box's glow: drag it along to time it.
                    <span
                      key={i}
                      className="beat grab"
                      title={t('tpl.box.hint', { name: b.items[i]?.title || t('tpl.box', { n: i }), time: slots.at(i).toFixed(2) })}
                      style={{ left: slots.at(i) * pxPerSec }}
                      onPointerDown={(e) => {
                        e.stopPropagation()
                        if (e.button !== 0) return
                        useStore.getState().selectTemplate(b.id)
                        const t0 = slots.at(i)
                        // timeline/drag.ts (phase 3c.4b): a step per frame, and
                        // Escape takes it back with no trace (the time, the
                        // playhead and the undo list as they were). It moves
                        // from the first pixel, as it always did.
                        const memo = gestureMemo()
                        startDrag(e, {
                          slop: 0,
                          horizontal: true,
                          onStart: () => useStore.getState().beginGesture(),
                          onMove: (ev) => {
                            const at = Math.max(0, Math.min(b.duration - 0.1, t0 + ev.dx / useStore.getState().pxPerSec))
                            useStore.getState().editTemplates((p) => setBoxTime(p, b.id, i, at), false)
                            useStore.getState().setTime(b.start + at)
                          },
                          onCancel: (moved) => {
                            if (moved) memo.restore()
                          }
                        })
                      }}
                    />
                  ) : (
                    <span key={i} className="beat" style={{ left: slots.at(i) * pxPerSec }} />
                  )
                )
              })()}
            {cut && <span className="cut-mark" style={{ left: b.cut! * pxPerSec }} />}
            <span className="grip" onPointerDown={(e) => startBlockDrag(e, b, 'dur')} />
          </div>
          </Fragment>
        )
      })}
      {menu && (
        <FloatingMenu x={menu.x} y={menu.y} onPointerDown={(e) => e.stopPropagation()} label={t('tpl.menu')} testid="templates.lane.menu" onClose={() => setMenu(null)} items={menuItems(menu.id)} />
      )}
    </div>
  )
}
