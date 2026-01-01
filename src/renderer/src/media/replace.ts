// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
import type { Asset, Project } from '../types'
import { assetById } from '../types'

export interface ReplaceTimelineImageResult {
  assetId: string
  addedAsset: boolean
  changed: boolean
}

/**
 * Swaps only the media reference of an image clip.
 *
 * Keeping the existing Clip object is the important contract: its timeline
 * range, transform/crop, motion FX, keyframes, fades and outgoing transition
 * all survive. The previous clip's outgoing transition also survives because
 * no neighbouring clip is touched.
 */
export function replaceTimelineImage(
  project: Project,
  clipId: string,
  replacement: Asset
): ReplaceTimelineImageResult | null {
  if (replacement.kind !== 'image' || replacement.missing) return null
  const clip = project.clips[clipId]
  const current = clip ? assetById(project, clip.assetId) : undefined
  const track = clip ? project.tracks.find((candidate) => candidate.id === clip.trackId) : undefined
  if (!clip || current?.kind !== 'image' || !track || track.locked) return null

  const pathKey = replacement.path?.toLocaleLowerCase()
  const existing = pathKey
    ? project.assets.find((asset) => asset.path?.toLocaleLowerCase() === pathKey)
    : project.assets.find((asset) => asset.id === replacement.id)
  const reusable = existing?.kind === 'image' ? existing : undefined
  const target = reusable ?? replacement
  const addedAsset = !reusable
  if (addedAsset) project.assets.push(replacement)
  if (clip.assetId === target.id) return { assetId: target.id, addedAsset, changed: false }

  clip.assetId = target.id
  return { assetId: target.id, addedAsset, changed: true }
}
