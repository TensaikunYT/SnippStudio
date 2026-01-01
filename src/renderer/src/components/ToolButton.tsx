// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// A toolbar's button (phase 3c.2: the preview toolbar, the transport, the
// timeline toolbar): the building blocks' Button, plain until it is on, with
// its tip. Since the visual polish ("az, çok", GORSEL-PLAN.md) a tool with an
// icon is the icon alone in its row, 28 px square: its name and shortcut are in
// the tooltip and aria-label, its words (.tb-label) show only where it is a
// menu's row (the timeline's Tools menu, the preview's View menu). A count it
// carries (silences, marks, selected clips) stays beside the icon.
import { forwardRef } from 'react'
import { Button, Tooltip, type ButtonProps } from '../ui'

export interface ToolButtonProps extends ButtonProps {
  /** Its name (the words on it unless children say otherwise). */
  label: string
  /** What it does, in the tooltip (the name when left out). */
  hint?: string
  /** Its shortcut, in the tooltip ("s", "ctrl+z"). */
  shortcut?: string
  /** The words give way to the icon in a narrow toolbar (all tools with an
   *  icon do now; kept so the call sites say which were folding before). */
  folds?: boolean
}

export const ToolButton = forwardRef<HTMLButtonElement, ToolButtonProps>(function ToolButton(
  { label, hint, shortcut, folds, children, variant = 'ghost', size = 'md', icon, className, ...rest },
  ref
) {
  void folds
  const words = children === undefined ? label : children
  // Plain words are wrapped so the row can hide them; a caller that brings its
  // own .tb-label (with a count beside it) is left as it is.
  const body = icon && typeof words === 'string' ? <span className="tb-label">{words}</span> : words
  // The empty title: the row around a customisable tool has a title of its own
  // (how to move or hide it), and two tips at once is one too many.
  return (
    <Tooltip content={hint ?? label} heading={hint && hint !== label ? label : undefined} shortcut={shortcut}>
      <Button ref={ref} variant={variant} size={size} icon={icon} className={`tb-tool${icon ? ' has-icon' : ''}${className ? ` ${className}` : ''}`} aria-label={label} title="" {...rest}>
        {body}
      </Button>
    </Tooltip>
  )
})
