// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// The menu (SnippStudio phase 3a.2; TASARIM.md "Menü"): one surface for every
// menu — raised, the strong line, corner 8, rows of 28, the shortcut on the
// right in the monospaced face. Keyboard: the arrows, Home/End, a letter jumps,
// Enter or Space chooses, Escape and Tab close (the focus goes back to the
// button that opened it).
import { useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react'
import { createPortal } from 'react-dom'
import { Button, type ButtonVariant, type ControlSize } from './Button'
import { Icon, type IconName } from './Icon'
import { placeMenu, rovingIndex, shortcutLabel, typeahead } from './logic'
import { Tooltip } from './Tooltip'

export interface MenuItem {
  id: string
  label: string
  icon?: IconName
  shortcut?: string
  danger?: boolean
  disabled?: boolean
  /** A choice that is on or off (menuitemcheckbox). */
  checked?: boolean
  /** A line above it. */
  separatorBefore?: boolean
  /** A group's name above it (after the line, if any). */
  headingBefore?: string
  /** Its tip on hover (what it does, or why it is closed). */
  hint?: string
  /** Chosen, it leaves the menu open (a switch among other choices). */
  keepOpen?: boolean
  /** A colour shown before its words: a token's name ("--label-red"; a clip's
   *  label colours, KOLAY-PLAN.md). */
  swatch?: string
  onSelect?: () => void
  testid?: string
}

export interface MenuProps {
  items: readonly MenuItem[]
  /** The menu's name. */
  label: string
  /** Chosen, Escape, Tab or a press outside. */
  onClose?: (why: 'select' | 'escape' | 'tab') => void
  /** Focus the first (or last) enabled item when it opens. */
  focus?: 'first' | 'last' | 'none'
  id?: string
  testid?: string
}

/** A row with a tip, or the row alone. */
const withHint = (hint: string | undefined, row: JSX.Element): JSX.Element => (hint ? <Tooltip content={hint}>{row}</Tooltip> : row)

const disabledAt = (items: readonly MenuItem[]) => (i: number): boolean => !!items[i]?.disabled

/** The surface and its rows (in place; MenuTrigger puts it under its button). */
export function Menu({ items, label, onClose, focus = 'first', id, testid }: MenuProps): JSX.Element {
  const refs = useRef<(HTMLButtonElement | null)[]>([])
  const isOff = disabledAt(items)
  const first = rovingIndex(-1, 'Home', items.length, isOff, 'vertical') ?? -1
  const last = rovingIndex(items.length, 'End', items.length, isOff, 'vertical') ?? -1
  const [active, setActive] = useState(focus === 'last' ? last : first)

  useEffect(() => {
    if (focus !== 'none' && active >= 0) refs.current[active]?.focus()
    // Only when it opens.
  }, [])

  const move = (i: number): void => {
    setActive(i)
    refs.current[i]?.focus()
  }
  const choose = (i: number): void => {
    const it = items[i]
    if (!it || it.disabled) return
    // Closed first (the focus back on the button), then the action: an
    // action that opens a window gives the focus to that window.
    if (!it.keepOpen) onClose?.('select')
    it.onSelect?.()
  }
  const onKey = (e: KeyboardEvent): void => {
    if (e.key === 'Escape') {
      e.preventDefault()
      e.stopPropagation()
      onClose?.('escape')
      return
    }
    if (e.key === 'Tab') {
      onClose?.('tab')
      return
    }
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      choose(active)
      return
    }
    const i = rovingIndex(active, e.key, items.length, isOff, 'vertical') ?? (e.key.length === 1 && !e.ctrlKey && !e.altKey && !e.metaKey ? typeahead(items.map((x) => x.label), active, e.key, isOff) : null)
    if (i === null) return
    e.preventDefault()
    move(i)
  }

  return (
    <div className="ui-menu" role="menu" aria-label={label} id={id} data-testid={testid} onKeyDown={onKey}>
      {items.map((it, i) => (
        <div key={it.id} className="ui-menu-slot" role="none">
          {it.separatorBefore && <div className="ui-menu-sep" role="separator" />}
          {it.headingBefore && (
            <div className="ui-menu-head" role="presentation">
              {it.headingBefore}
            </div>
          )}
          {withHint(it.hint, <button
            ref={(el) => {
              refs.current[i] = el
            }}
            type="button"
            role={it.checked === undefined ? 'menuitem' : 'menuitemcheckbox'}
            aria-checked={it.checked}
            aria-disabled={it.disabled || undefined}
            tabIndex={i === active ? 0 : -1}
            className={['ui-menu-item', it.danger ? 'is-danger' : '', it.disabled ? 'is-disabled' : '', i === active ? 'is-active' : ''].filter(Boolean).join(' ')}
            data-testid={it.testid}
            onPointerMove={() => {
              if (!it.disabled && i !== active) move(i)
            }}
            onClick={() => choose(i)}
          >
            <span className="ui-menu-icon">{it.checked !== undefined ? it.checked && <Icon name="check" size={14} /> : it.icon && <Icon name={it.icon} size={14} />}</span>
            {it.swatch && <span className="ui-menu-swatch" style={{ background: `var(${it.swatch})` }} aria-hidden="true" />}
            <span className="ui-menu-label">{it.label}</span>
            {it.shortcut && <kbd className="ui-kbd">{shortcutLabel(it.shortcut)}</kbd>}
          </button>)}
        </div>
      ))}
    </div>
  )
}

export interface MenuTriggerProps {
  /** The button's words (or only its icon with iconLabel). */
  label?: string
  icon?: IconName
  /** The name of an icon-only trigger. */
  iconLabel?: string
  /** The items (or a function that makes them when it opens). */
  items: readonly MenuItem[] | (() => readonly MenuItem[])
  /** The button's tip on hover (default: none; an icon-only trigger shows its name). */
  hint?: string
  className?: string
  /** The menu's name (default: the button's). */
  menuLabel?: string
  variant?: ButtonVariant
  size?: ControlSize
  disabled?: boolean
  /** data-testid of the button; the menu is <testid>.menu. */
  testid?: string
}

/** A button that opens a menu under itself (aria-haspopup). Click, Enter,
 *  Space or ArrowDown opens it on its first item, ArrowUp on its last. */
export function MenuTrigger({ label, icon, iconLabel, items, hint, className, menuLabel, variant = 'ghost', size = 'md', disabled, testid }: MenuTriggerProps): JSX.Element {
  const [open, setOpen] = useState<null | 'first' | 'last'>(null)
  const [pos, setPos] = useState<{ x: number; y: number; maxH?: number } | null>(null)
  const btn = useRef<HTMLButtonElement | null>(null)
  const layer = useRef<HTMLDivElement | null>(null)
  const menuId = useId()
  const shown = open ? (typeof items === 'function' ? items() : items) : []

  const close = (refocus: boolean): void => {
    setOpen(null)
    setPos(null)
    if (refocus) btn.current?.focus()
  }

  useLayoutEffect(() => {
    if (!open || !btn.current || !layer.current) return
    const r = btn.current.getBoundingClientRect()
    const m = layer.current.getBoundingClientRect()
    const p = placeMenu({ x: r.left, y: r.top, w: r.width, h: r.height }, { w: m.width, h: m.height }, { w: window.innerWidth, h: window.innerHeight })
    setPos({ x: p.x, y: p.y, ...(p.maxH ? { maxH: p.maxH } : {}) })
  }, [open])

  // A press outside closes it (and leaves the focus where the press put it).
  useEffect(() => {
    if (!open) return
    const down = (e: PointerEvent): void => {
      const t = e.target as Node
      if (layer.current?.contains(t) || btn.current?.contains(t)) return
      close(false)
    }
    window.addEventListener('pointerdown', down, true)
    return () => window.removeEventListener('pointerdown', down, true)
  }, [open])

  const tip = hint ?? (label ? undefined : iconLabel)
  const button = (
      <Button
        ref={btn}
        className={className}
        variant={variant}
        size={size}
        icon={icon}
        iconEnd={label ? 'chevron-down' : undefined}
        disabled={disabled}
        aria-label={label ? undefined : iconLabel}
        aria-haspopup="menu"
        aria-expanded={!!open}
        aria-controls={open ? menuId : undefined}
        testid={testid}
        onClick={() => (open ? close(false) : setOpen('first'))}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            e.preventDefault()
            setOpen(e.key === 'ArrowUp' ? 'last' : 'first')
          }
        }}
      >
        {label}
      </Button>
  )
  return (
    <>
      {tip ? <Tooltip content={tip} describe={!!label}>{button}</Tooltip> : button}
      {open &&
        createPortal(
          <div ref={layer} className="ui-menu-layer" style={pos ? { left: pos.x, top: pos.y, ...(pos.maxH ? { ['--menu-max' as string]: `${pos.maxH}px` } : {}) } : { left: -9999, top: -9999 }}>
            <Menu
              id={menuId}
              items={shown}
              label={menuLabel ?? label ?? iconLabel ?? ''}
              focus={open}
              testid={testid ? `${testid}.menu` : undefined}
              onClose={(why) => close(why !== 'tab')}
            />
          </div>,
          document.body
        )}
    </>
  )
}
