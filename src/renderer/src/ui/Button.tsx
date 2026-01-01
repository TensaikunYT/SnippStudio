// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// Buttons (SnippStudio phase 3a.2; TASARIM.md "Düğme"): one family in four
// kinds — primary (the accent fill; at most one on a screen), secondary (a
// soft fill), plain (bare; the default since the visual polish, GORSEL-PLAN.md),
// danger — in two heights, 28 and 24, none with an edge. A button with only an
// icon is square and named (IconButton), and shows its name and shortcut in a
// tooltip.
import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react'
import { Icon, type IconName } from './Icon'
import { ariaShortcut } from './logic'
import { Tooltip } from './Tooltip'

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger'
export type ControlSize = 'md' | 'sm'

export interface ButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'type'> {
  variant?: ButtonVariant
  size?: ControlSize
  /** An icon before the words. */
  icon?: IconName
  /** An icon after the words (a menu's chevron). */
  iconEnd?: IconName
  /** A switched-on tool: aria-pressed and the accent's soft fill. */
  pressed?: boolean
  type?: 'button' | 'submit'
  testid?: string
  children?: ReactNode
}

export const iconSize = (size: ControlSize): number => (size === 'sm' ? 14 : 16)

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'ghost', size = 'md', icon, iconEnd, pressed, type = 'button', testid, className, children, ...rest },
  ref
) {
  const cls = ['ui-btn', `ui-btn-${variant}`, `ui-size-${size}`, pressed ? 'is-on' : '', children == null ? 'is-icon-only' : '', className ?? ''].filter(Boolean).join(' ')
  return (
    <button ref={ref} type={type} className={cls} aria-pressed={pressed === undefined ? undefined : pressed} data-testid={testid} {...rest}>
      {icon && <Icon name={icon} size={iconSize(size)} />}
      {children != null && <span className="ui-btn-label">{children}</span>}
      {iconEnd && <Icon name={iconEnd} size={iconSize(size)} className="ui-btn-end" />}
    </button>
  )
})

export interface BareButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'type'> {
  type?: 'button' | 'submit'
  testid?: string
  children?: ReactNode
}

/**
 * A button that is a surface rather than a control (phase 3c.4b): a colour
 * swatch, a card, a choice in a grid of pictures, a chip or a mark on a lane.
 * It brings no look of its own (the caller's class draws it, over the button
 * element's base in ui/base.css) but keeps a button's manners: type="button",
 * a test name, the keyboard and the one focus ring. Anything that looks like
 * a control is a Button or an IconButton.
 */
export const BareButton = forwardRef<HTMLButtonElement, BareButtonProps>(function BareButton({ type = 'button', testid, children, ...rest }, ref) {
  return (
    <button ref={ref} type={type} data-testid={testid} {...rest}>
      {children}
    </button>
  )
})

export interface IconButtonProps extends Omit<ButtonProps, 'icon' | 'iconEnd' | 'children' | 'variant'> {
  icon: IconName
  /** Its name: said by a screen reader, shown in the tooltip. Required. */
  label: string
  variant?: Exclude<ButtonVariant, 'primary'>
  /** Its shortcut, shown in the tooltip ("ctrl+d", "s"). */
  shortcut?: string
  /** Show the tooltip (on by default). */
  tooltip?: boolean
}

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { icon, label, shortcut, tooltip = true, variant = 'ghost', ...rest },
  ref
) {
  const button = (
    <Button ref={ref} {...rest} variant={variant} icon={icon} aria-label={label} aria-keyshortcuts={shortcut ? ariaShortcut(shortcut) : undefined} />
  )
  if (!tooltip) return button
  return (
    <Tooltip content={label} shortcut={shortcut} describe={false}>
      {button}
    </Tooltip>
  )
})
