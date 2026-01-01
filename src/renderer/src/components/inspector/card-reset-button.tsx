// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// The ↺ at the right of a Clip card's title (REF-AB, item 2): the card's
// values back to a new clip's, one undo step; off when there is nothing to
// put back. The rules are card-reset.ts.
import { useStore } from '../../state/store'
import { IconButton, useT } from '../../ui'
import { partIsDefault, runReset, type ResetPart } from './card-reset'

/** Puts `part` of the clip back, as one undo step. */
export function resetCard(clipId: string, part: ResetPart): void {
  const st = useStore.getState()
  const clip = st.project.clips[clipId]
  if (!clip || partIsDefault(st.project, clip, part)) return
  st.undoable(() => runReset(st.project, clip, part, useStore.getState()))
}

export function ResetCardButton({ clipId, part, title }: { clipId: string; part: ResetPart; title: string }): JSX.Element {
  const t = useT()
  // A boolean from the store: drawn again only when it turns.
  const clean = useStore((s) => {
    const c = s.project.clips[clipId]
    return !c || partIsDefault(s.project, c, part)
  })
  return (
    <IconButton
      icon="rotate-ccw"
      size="sm"
      variant="ghost"
      className="insp-reset"
      label={clean ? t('refi.reset.clean', { card: title }) : t('refi.reset', { card: title })}
      disabled={clean}
      testid={`inspector.card.${part}.reset`}
      onClick={() => resetCard(clipId, part)}
    />
  )
}
