// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
import type { Project } from '../types'

/** Cuts where two enabled visual clips actually meet. A gap is not a cut. */
export function collectVisualCuts(project: Project, tolerance = 0.08): number[] {
  const cuts: number[] = []
  for (const track of project.tracks) {
    if (track.kind !== 'video' || track.hidden) continue
    const clips = track.clipIds
      .map((id) => project.clips[id])
      .filter((clip) => {
        if (!clip || clip.disabled || clip.automationMissing || clip.adjustment || clip.duration <= 0) return false
        const kind = project.assets.find((asset) => asset.id === clip.assetId)?.kind
        return kind === 'image' || kind === 'video' || !!clip.nested
      })
      .sort((a, b) => a.start - b.start)
    for (let index = 1; index < clips.length; index++) {
      const previous = clips[index - 1]
      const next = clips[index]
      if (Math.abs(previous.start + previous.duration - next.start) <= tolerance) cuts.push(next.start)
    }
  }
  const unique: number[] = []
  for (const time of cuts.sort((a, b) => a - b)) {
    if (unique.length === 0 || time - unique[unique.length - 1] > tolerance) unique.push(time)
  }
  return unique
}
