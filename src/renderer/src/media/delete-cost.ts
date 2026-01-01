// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// What deleting a file from the media panel takes with it (audit G10). The
// store's deleteAsset drops every clip made from the file; the subtitles go
// along with their voice clip (subtitles/follow.ts: a subtitle is a moment of
// a recording, and a clip that is gone takes its words with it). The question
// before the delete said only "2 clips"; it says both now. Worked out the way
// the store does it (the same removal, the same follow pass), on a copy.
import { produce } from '../state/cow'
import { followClipEdits } from '../subtitles/follow'
import { findTrack } from '../commands/ops/base'
import type { Project } from '../types'

export interface DeleteCost {
  /** Clips on the timeline made from the file. */
  clips: number
  /** Subtitle lines that go with them. */
  subtitles: number
}

export function assetDeleteCost(project: Project, assetId: string): DeleteCost {
  const gone = Object.values(project.clips).filter((c) => c.assetId === assetId).map((c) => c.id)
  if (gone.length === 0) return { clips: 0, subtitles: 0 }
  const after = produce(project, (d) => {
    for (const id of gone) {
      const clip = d.clips[id]
      const track = clip && findTrack(d, clip.trackId)
      if (track) track.clipIds = track.clipIds.filter((x) => x !== id)
      delete d.clips[id]
    }
    followClipEdits(project, d)
  })
  return { clips: gone.length, subtitles: Math.max(0, (project.captions?.length ?? 0) - (after.captions?.length ?? 0)) }
}
