// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Button, Checkbox, IconButton, Tooltip, useT } from '../ui'

const KEY = 'snipp-toolbar-layout'

export interface ToolbarItem {
  id: string
  /** Plain-text name shown in the customise list. */
  label: string
  node: React.ReactNode
  /** Core editing gesture: stays on the compact toolbar. */
  featured?: boolean
  /** An engaged hidden tool is surfaced so its mode is never a mystery. */
  active?: boolean
}

interface Layout {
  order: string[]
  hidden: string[]
}

function readLayout(): Layout {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<Layout>
    return { order: raw.order ?? [], hidden: raw.hidden ?? [] }
  } catch {
    return { order: [], hidden: [] }
  }
}

function writeLayout(layout: Layout): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(layout))
  } catch {
    /* storage blocked — customisation just won't persist */
  }
}

/**
 * Renders the timeline toolbar in a user-defined order, with buttons the user
 * can hide. Drag a button to move it, right-click it to hide it, and use the gear
 * menu to toggle anything back on or reset to the built-in layout.
 *
 * The order is stored as ids, so adding a new button in code simply appends it
 * (unknown ids are ignored, missing ones fall in at their natural position).
 */
export function CustomToolbar({ items }: { items: ToolbarItem[] }): JSX.Element {
  const t = useT()
  const [layout, setLayout] = useState<Layout>(readLayout)
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null)
  const [settings, setSettings] = useState(false)
  const [moreOpen, setMoreOpen] = useState(false)
  const dragId = useRef<string | null>(null)
  const [ctxId, setCtxId] = useState<string | null>(null)
  // The ⚙ lives in a fixed slot on the right of the toolbar, so it never
  // shifts around as buttons appear, disappear or get reordered.
  const [gearSlot, setGearSlot] = useState<HTMLElement | null>(null)
  useEffect(() => {
    setGearSlot(document.querySelector('.tb-gear-slot') as HTMLElement | null)
  }, [])

  useEffect(() => {
    if (!menu && !settings && !moreOpen) return
    const close = (e: PointerEvent): void => {
      if (!(e.target as HTMLElement).closest('.tb-menu,.tb-gear,.tb-more')) {
        setMenu(null)
        setSettings(false)
        setMoreOpen(false)
      }
    }
    window.addEventListener('pointerdown', close)
    return () => window.removeEventListener('pointerdown', close)
  }, [menu, settings, moreOpen])

  const save = (next: Layout): void => {
    setLayout(next)
    writeLayout(next)
  }

  // Saved order first (only ids that still exist), then anything new in code.
  const known = new Set(items.map((i) => i.id))
  const ordered: ToolbarItem[] = []
  for (const id of layout.order) {
    if (!known.has(id)) continue
    const item = items.find((i) => i.id === id)
    if (item && !ordered.includes(item)) ordered.push(item)
  }
  for (const item of items) if (!ordered.includes(item)) ordered.push(item)

  const visible = ordered.filter((i) => !layout.hidden.includes(i.id))
  const primary = visible.filter((item) => item.featured || item.active)
  const secondary = visible.filter((item) => !primary.includes(item))

  const move = (fromId: string, toId: string): void => {
    if (fromId === toId) return
    const ids = ordered.map((i) => i.id)
    const from = ids.indexOf(fromId)
    const to = ids.indexOf(toId)
    if (from < 0 || to < 0) return
    ids.splice(to, 0, ids.splice(from, 1)[0])
    save({ ...layout, order: ids })
  }

  return (
    <>
      {primary.map((item) => (
        <span
          key={item.id}
          className="tb-item"
          draggable
          onDragStart={(e) => {
            dragId.current = item.id
            e.dataTransfer.effectAllowed = 'move'
            // Firefox needs data set for a drag to start at all.
            e.dataTransfer.setData('text/plain', item.id)
          }}
          onDragOver={(e) => {
            if (dragId.current) e.preventDefault()
          }}
          onDrop={(e) => {
            e.preventDefault()
            if (dragId.current) move(dragId.current, item.id)
            dragId.current = null
          }}
          onContextMenu={(e) => {
            e.preventDefault()
            e.stopPropagation()
            setCtxId(item.id)
            setMenu({ x: e.clientX, y: e.clientY })
          }}
          title={t('toolbar.item.hint')}
        >
          {item.node}
        </span>
      ))}

      {secondary.length > 0 && (
        <div className="tb-more">
          {/* An icon, as the tools beside it (its name and what it holds in the tip). */}
          <Tooltip content={t('toolbar.more.hint')} heading={t('toolbar.more')}>
            <Button
              variant="ghost"
              icon="ellipsis"
              pressed={moreOpen ? true : undefined}
              onClick={() => setMoreOpen((value) => !value)}
              aria-expanded={moreOpen}
              aria-label={t('toolbar.more.label')}
              aria-haspopup="true"
              testid="timeline.tools-more"
            />
          </Tooltip>
          {moreOpen && (
            <div className="tb-more-menu">
              <div className="tb-more-heading">{t('toolbar.more.title')}</div>
              {secondary.map((item) => (
                <div key={item.id} className="tb-more-item" onClick={() => setMoreOpen(false)}>
                  {item.node}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {gearSlot &&
        createPortal(
          <IconButton
            variant="ghost"
            className="tb-gear"
            icon="settings"
            testid="timeline.toolbar-settings"
            label={t('toolbar.settings')}
            onClick={(e) => {
              e.stopPropagation()
              setSettings((v) => !v)
              setMenu(null)
            }}
          />,
          gearSlot
        )}

      {menu && ctxId && (
        <div className="tb-menu" style={{ left: menu.x, top: menu.y }} onPointerDown={(e) => e.stopPropagation()}>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              save({ ...layout, hidden: [...layout.hidden, ctxId] })
              setMenu(null)
            }}
          >
            {t('toolbar.hide')}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setSettings(true)
              setMenu(null)
            }}
          >
            {t('toolbar.customise')}
          </Button>
        </div>
      )}

      {settings && (
        <div className="tb-menu tb-settings" onPointerDown={(e) => e.stopPropagation()}>
          <div className="tb-settings-head">{t('toolbar.buttons')}</div>
          <div className="tb-settings-list">
            {ordered.map((item) => (
              <Checkbox
                key={item.id}
                label={item.label}
                checked={!layout.hidden.includes(item.id)}
                onChange={(on) =>
                  save({
                    ...layout,
                    hidden: on ? layout.hidden.filter((h) => h !== item.id) : [...layout.hidden, item.id]
                  })
                }
              />
            ))}
          </div>
          <Button variant="secondary" size="sm" icon="rotate-ccw" className="tb-reset" onClick={() => save({ order: [], hidden: [] })}>
            {t('toolbar.reset')}
          </Button>
        </div>
      )}
    </>
  )
}
