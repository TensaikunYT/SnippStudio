// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// One icon of the set (Lucide, ui/icons/lucide.ts; SnippStudio phase 3a.4).
// Drawn in the text colour around it; a stroke of 2, 1.75 below 16 px
// (TASARIM.md, "Simgeler"). Decorative unless it has a label: an icon that is
// the only content of a control gets its name from the control (IconButton's
// label), not from here.
import { createElement } from 'react'
import { ICONS, type IconName } from './icons/lucide'

export type { IconName } from './icons/lucide'

export interface IconProps {
  name: IconName
  /** Pixels; the design uses 14–16. */
  size?: number
  /** Only when the icon alone says something (no text beside it, not inside a named control). */
  label?: string
  className?: string
  testid?: string
}

export const iconStroke = (size: number): number => (size < 16 ? 1.75 : 2)

export function Icon({ name, size = 16, label, className, testid }: IconProps): JSX.Element {
  const nodes = ICONS[name]
  return (
    <svg
      className={className ? `ui-icon ${className}` : 'ui-icon'}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={iconStroke(size)}
      strokeLinecap="round"
      strokeLinejoin="round"
      focusable="false"
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      data-testid={testid}
      data-icon={name}
    >
      {nodes.map(([tag, attrs], i) => createElement(tag, { key: i, ...attrs }))}
    </svg>
  )
}
