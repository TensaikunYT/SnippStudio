// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// The selected clip's actions, at the right of the timeline's toolbar (v3,
// tarifler/UI-YENI.md): what makes sense while clips are selected, in words,
// where the eye already is. Each one is the store's own action, the same one
// its shortcut and the clip's right-click menu call. (Split is not repeated
// here: it is the toolbar's own featured tool, a step to the left.)
import { memo } from 'react'
import { useStore } from '../../state/store'
import { MenuTrigger, useT } from '../../ui'
import { ToolButton } from '../ToolButton'

const SPEEDS = [0.25, 0.5, 1, 1.5, 2, 4]

export const ClipActions = memo(function ClipActions(): JSX.Element | null {
  const t = useT()
  const count = useStore((s) => s.selectedClipIds.length)
  const comma = useStore((s) => s.uiLang === 'tr')
  if (count === 0) return null
  const ids = (): string[] => useStore.getState().selectedClipIds
  return (
    <div className="tl-clip-actions" role="group" aria-label={t('timeline.clipActions')} data-testid="timeline.clip-actions">
      <MenuTrigger
        testid="timeline.clip-actions.speed"
        className="tb-tool"
        icon="gauge"
        label={t('timeline.clipActions.speed')}
        hint={t('timeline.clipActions.speed.hint')}
        items={() =>
          SPEEDS.map((x) => ({
            id: `speed-${x}`,
            label: t('timeline.clipActions.speed.item', { x: comma ? String(x).replace('.', ',') : String(x) }),
            testid: `timeline.clip-actions.speed.${x}`,
            onSelect: () => {
              const s = useStore.getState()
              for (const id of ids()) s.setClipSpeed(id, x)
            }
          }))
        }
      />
      <ToolButton icon="copy" testid="timeline.clip-actions.duplicate" onClick={() => useStore.getState().duplicateSelection()} label={t('timeline.clipActions.duplicate')} hint={t('timeline.clipActions.duplicate.hint')} />
      <ToolButton icon="trash" variant="danger" testid="timeline.clip-actions.delete" onClick={() => useStore.getState().deleteClips(ids(), false)} label={t('timeline.clipActions.delete')} hint={t('timeline.clipActions.delete.hint')} />
    </div>
  )
})
