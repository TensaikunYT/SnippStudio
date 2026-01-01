// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// The eyedropper's click on the preview ("cila" part D): the key colour is
// read from the clip's own picture (playback/eyedropper.ts) and set in one
// undo step; a click beside the picture says so and changes nothing.
import { pickSourceColour } from '../../playback/eyedropper'
import { useStore } from '../../state/store'
import { notify } from '../../ui'
import { t } from '../../ui/strings'

/** `wx`, `wy`: the clicked point in project pixels. */
export function pickKeyColour(clipId: string, wx: number, wy: number): void {
  const s = useStore.getState()
  void pickSourceColour(s.project, clipId, s.currentTime, wx, wy)
    .catch(() => null)
    .then((hex) => {
      if (!hex) {
        notify({ text: t('insp.chroma.pickMiss'), kind: 'info' })
        return
      }
      const now = useStore.getState()
      if (!now.project.clips[clipId]) return
      now.undoable(() => now.setClipChroma(clipId, { color: hex }))
      notify({ text: t('insp.chroma.picked'), kind: 'info' })
    })
}
