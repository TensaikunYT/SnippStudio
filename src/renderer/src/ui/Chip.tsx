// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// A chip (SnippStudio phase 3a.2): a short state or tag, round ends (the
// corner is half its height). Tones: neutral, accent ("live"), agent (amber:
// only for what the agent does), note, danger. A chip can be pressed (a filter)
// or removed.
import type { ReactNode } from 'react'
import { IconButton } from './Button'
import { Icon, type IconName } from './Icon'
import { useT } from './strings'

export type ChipTone = 'neutral' | 'accent' | 'agent' | 'note' | 'danger'

export interface ChipProps {
  children: ReactNode
  tone?: ChipTone
  icon?: IconName
  /** A pulsing dot before the words (the agent at work; still under reduced motion). */
  pulse?: boolean
  /** Makes it a button (a filter): pressed shows it chosen. */
  onClick?: () => void
  pressed?: boolean
  /** A remove button; its name says what goes. */
  onRemove?: () => void
  removeLabel?: string
  testid?: string
}

export function Chip({ children, tone = 'neutral', icon, pulse, onClick, pressed, onRemove, removeLabel, testid }: ChipProps): JSX.Element {
  const t = useT()
  const cls = ['ui-chip', `ui-chip-${tone}`, pressed ? 'is-on' : '', onClick ? 'is-button' : ''].filter(Boolean).join(' ')
  const inner = (
    <>
      {pulse && <span className="ui-chip-pulse" aria-hidden="true" />}
      {icon && <Icon name={icon} size={12} />}
      <span className="ui-chip-text">{children}</span>
    </>
  )
  return (
    <span className={cls} data-testid={testid}>
      {onClick ? (
        <button type="button" className="ui-chip-press" aria-pressed={pressed ?? undefined} onClick={onClick}>
          {inner}
        </button>
      ) : (
        inner
      )}
      {onRemove && (
        <IconButton
          icon="x"
          label={t('ui.chip.remove', { label: removeLabel ?? (typeof children === 'string' ? children : '') })}
          variant="ghost"
          size="sm"
          tooltip={false}
          className="ui-chip-remove"
          testid={testid ? `${testid}.remove` : undefined}
          onClick={onRemove}
        />
      )}
    </span>
  )
}
