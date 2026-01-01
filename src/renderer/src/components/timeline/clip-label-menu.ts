// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// A clip's right-click "Label" (KOLAY-PLAN.md, item 3): six colours and none,
// for the selection (or the one clip pressed). The menu block has no
// submenus: this is a second menu, opened where the first one was (as the
// agent's: components/agent/clip-agent-menu.ts). One undo step.
import type { MenuItem } from '../../ui'
import { t, type StringKey } from '../../ui/strings'
import { useStore } from '../../state/store'
import { CLIP_LABELS, type ClipLabel } from '../../types'

/** The token of a label's colour (ui/tokens.css). */
export const labelToken = (label: ClipLabel): string => `--label-${label}`
/** A label's name ("Red"). */
export const labelName = (label: ClipLabel): string => t(`kolay.label.${label}` as StringKey)

/** The rows of the second menu: the colours, then none; the one the clips
 *  have is ticked. */
export function labelMenuItems(clipId: string, ids: readonly string[]): MenuItem[] {
  const clips = useStore.getState().project.clips
  const now = new Set(ids.map((id) => clips[id]?.label ?? null))
  const one = now.size === 1 ? [...now][0] : undefined
  const set = (label: ClipLabel | null) => (): void => useStore.getState().setClipsLabel([...ids], label)
  const items: MenuItem[] = [
    ...CLIP_LABELS.map((l): MenuItem => ({ id: l, label: labelName(l), swatch: labelToken(l), checked: one === l, onSelect: set(l) })),
    { id: 'none', label: t('kolay.label.none'), checked: one === null, separatorBefore: true, onSelect: set(null) }
  ]
  return items.map((it) => ({ ...it, testid: `timeline.clip.${clipId}.label.${it.id}` }))
}
