// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// Where a dragged clip will land (DENEME-3, V item 4). While a clip is
// dragged it follows the pointer; on its lane a faint dashed frame shows
// where the release puts it, and where each clip it pushes aside will go.
// They are the drag's own plan (`dragPreview.positions`, the plan the release
// commits), so what is shown is what happens. Escape takes them away with
// the drag. A refused drop (a locked lane, the wrong kind) shows none.
import { memo, useMemo } from 'react'
import { useStore } from '../../state/store'
import type { Track } from '../../types'
import { HEADER_W } from './shared'
import { EPS } from '../../timeline/eps'

interface Ghost {
  id: string
  start: number
  duration: number
  /** A clip the drop pushes (not one of the dragged clips). */
  shift: boolean
}

const NONE: Ghost[] = []

export const DropGhosts = memo(function DropGhosts({ track }: { track: Track }): JSX.Element | null {
  const preview = useStore((s) => s.dragPreview)
  const clips = useStore((s) => s.project.clips)
  const px = useStore((s) => s.pxPerSec)
  const ghosts = useMemo((): Ghost[] => {
    if (!preview || preview.invalidReason) return NONE
    const out: Ghost[] = []
    for (const [id, at] of Object.entries(preview.positions)) {
      if (at.trackId !== track.id) continue
      const clip = clips[id]
      if (!clip) continue
      const carried = preview.ids.includes(id) || preview.follow?.[id] !== undefined
      // A clip the drop leaves where it is needs no ghost.
      if (!carried && at.trackId === clip.trackId && Math.abs(at.start - clip.start) < EPS) continue
      out.push({ id, start: at.start, duration: clip.duration, shift: !carried })
    }
    return out.length ? out : NONE
  }, [preview, clips, track.id])
  if (ghosts.length === 0) return null
  return (
    <>
      {ghosts.map((g) => (
        <div
          key={g.id}
          className={`tl-drop-ghost${g.shift ? ' is-shift' : ''}`}
          data-testid={`timeline.ghost.${g.id}`}
          aria-hidden="true"
          style={{ left: HEADER_W + g.start * px, width: Math.max(5, g.duration * px) }}
        />
      ))}
    </>
  )
})
