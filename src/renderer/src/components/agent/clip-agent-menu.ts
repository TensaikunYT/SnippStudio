// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// A clip's right-click "For the agent" (KAPSAM-AJAN-PLAN.md §6; the mock-up
// tasarim\maket-ajan, screen 4): a note left on the clips (the box opens),
// four ready notes sent at once, "work only on the selected clips" (the box
// opens, limited to them), and the lock against the agent (kept in the
// project; one undo step). The menu block has no submenus: this is the
// second menu, opened where the first one was.
import type { MenuItem } from '../../ui'
import { t } from '../../ui/strings'
import { useStore } from '../../state/store'
import { CLIP_CHIPS, bandForClips, sendClipChip } from '../../agent/scope-band'
import { chipLabel, toldSent } from './ScopeBand'

/** The rows of the second menu, for these clips (the selection, or the one
 *  clip pressed). */
export function agentMenuItems(clipId: string, ids: readonly string[]): MenuItem[] {
  const st = useStore.getState()
  const locked = ids.every((id) => st.project.clips[id]?.agentLock === true)
  const items: MenuItem[] = [
    { id: 'note', label: t('kapsam.menu.note'), icon: 'sticky-note', onSelect: () => void bandForClips(useStore.getState().project, ids, false) },
    ...CLIP_CHIPS.map((c): MenuItem => ({ id: `chip-${c}`, label: chipLabel(c), onSelect: () => toldSent(sendClipChip(ids, c, chipLabel)) })),
    { id: 'only', label: t('kapsam.menu.only'), icon: 'scan', separatorBefore: true, onSelect: () => void bandForClips(useStore.getState().project, ids, true) },
    locked
      ? { id: 'unlock', label: t('kapsam.menu.unlock'), icon: 'lock-open', onSelect: () => useStore.getState().setClipsAgentLock([...ids], false) }
      : { id: 'lock', label: t('kapsam.menu.lock'), icon: 'lock', hint: t('kapsam.lock.hint'), onSelect: () => useStore.getState().setClipsAgentLock([...ids], true) }
  ]
  return items.map((it) => ({ ...it, testid: `timeline.clip.${clipId}.agent.${it.id}` }))
}
