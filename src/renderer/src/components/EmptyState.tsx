// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// An empty area (SnippStudio phase 9b, decision 4; TASARIM.md rule 4: "an
// empty area says what to do in its middle"): one sentence and one action.
// The action is a soft button (secondary): the screen's one filled button
// stays the main action (rule 2). REF-AB item 7: a small picture drawn in
// code above it (`art`, components/empty-art.tsx).
import { Button, type IconName } from '../ui'
import { EmptyArt, type EmptyArtKind } from './empty-art'

export function EmptyState({ text, action, icon, onAction, testid, className, art }: {
  text: string
  action: string
  icon?: IconName
  onAction: () => void
  testid: string
  className?: string
  art?: EmptyArtKind
}): JSX.Element {
  const cls = ['ui-empty', art && 'has-art', className].filter(Boolean).join(' ')
  return (
    <div className={cls} data-testid={testid}>
      {art && <EmptyArt kind={art} />}
      <span className="ui-empty-text">{text}</span>
      {/* (The area under it may take the press for itself, as the timeline
          does for seeking and marquee: the button keeps its own press.) */}
      <Button size="sm" variant="secondary" icon={icon} onPointerDown={(e) => e.stopPropagation()} onClick={onAction} testid={`${testid}.action`}>
        {action}
      </Button>
    </div>
  )
}
