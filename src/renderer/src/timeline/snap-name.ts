// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// What a drag snapped to, in the interface's language (phase 9 audit patch
// D6): "Playhead" / "Oynatma çizgisi", "Video · V1 end" / "Video · V1 sonu".
// English is the target's own label (timeline/snapping.ts), word for word.
import type { DragSnapTarget } from './snapping'
import { t, type StringKey } from '../ui/strings'

const WHAT: Partial<Record<DragSnapTarget['kind'], StringKey>> = { image: 'snap.f9y.image', video: 'snap.f9y.video', audio: 'snap.f9y.audio' }

export function snapTargetName(x: DragSnapTarget): string {
  const end = x.edge === 'end'
  switch (x.kind) {
    case 'image':
    case 'video':
    case 'audio':
      return t(end ? 'snap.f9y.clipEnd' : 'snap.f9y.clipStart', { what: t(WHAT[x.kind]!), track: x.trackName ?? '' })
    case 'subtitle':
      return t(end ? 'snap.f9y.subtitleEnd' : 'snap.f9y.subtitleStart')
    case 'text':
      return t(end ? 'snap.f9y.textEnd' : 'snap.f9y.textStart')
    case 'segment':
      return t(end ? 'snap.f9y.segmentEnd' : 'snap.f9y.segmentStart')
    case 'marker':
      return t('snap.f9y.marker')
    case 'playhead':
      return t('snap.f9y.playhead')
    case 'start':
      return t('snap.f9y.start')
  }
  return x.label
}
