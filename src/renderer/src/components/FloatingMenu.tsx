// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
import { useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Menu, type MenuItem } from '../ui'

/**
 * A pointer-anchored popup that keeps itself on screen: if there isn't room
 * below the cursor it flips above, and the same horizontally. Right-clicking a
 * clip near the bottom of the window used to open a menu that ran off the
 * screen, so the last items were unreachable.
 *
 * Given `items` (phase 3c.1), it holds the one menu surface of the building
 * blocks (ui/Menu: rows, keyboard, icons); `onClose` is then told when a row
 * is chosen or Escape is pressed. Without them it holds its own children (the
 * timeline's menus until phase 3c.2 moves them).
 */
export function FloatingMenu({
  x,
  y,
  className = 'ctx-menu',
  onPointerDown,
  children,
  items,
  label,
  onClose,
  testid
}: {
  x: number
  y: number
  className?: string
  onPointerDown?: (e: React.PointerEvent) => void
  children?: React.ReactNode
  /** The rows of a menu (ui/Menu) instead of children. */
  items?: readonly MenuItem[]
  /** The menu's name (with items). */
  label?: string
  onClose?: () => void
  /** Test name (data-testid) for the end-to-end tests. */
  testid?: string
}): JSX.Element {
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<{ left: number; top: number }>({ left: x, top: y })

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const { width, height } = el.getBoundingClientRect()
    const margin = 8
    const vw = window.innerWidth
    const vh = window.innerHeight
    // Prefer opening down/right from the cursor; flip when it wouldn't fit,
    // then clamp so it can never sit outside the window either way.
    let left = x + width + margin > vw ? x - width : x
    let top = y + height + margin > vh ? y - height : y
    left = Math.max(margin, Math.min(left, vw - width - margin))
    top = Math.max(margin, Math.min(top, vh - height - margin))
    setPos({ left, top })
  }, [x, y, children, items])

  // Rendered into <body>: inside the timeline the menu sat underneath the ruler
  // and could be clipped by scroll containers, because any transformed or
  // z-indexed ancestor traps a `position: fixed` child in its stacking context.
  // A portal has no ancestors to fight with.
  return createPortal(
    <div
      ref={ref}
      className={items ? 'ui-menu-layer' : className}
      data-testid={items ? undefined : testid}
      style={{ position: 'fixed', left: pos.left, top: pos.top, zIndex: 'var(--z-tooltip)' as unknown as number }}
      onPointerDown={onPointerDown}
    >
      {items ? <Menu items={items} label={label ?? ''} testid={testid} onClose={() => onClose?.()} /> : children}
    </div>,
    document.body
  )
}
