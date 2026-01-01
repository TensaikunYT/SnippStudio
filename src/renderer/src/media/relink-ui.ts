// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// The app's side of a relink and of a file changed on disk (phase Ç2a.2):
// the real probe and cache drops for media/relink.ts, and what the user is
// told.
import { notify, t } from '../ui'
import type { AssetKind } from '../types'
import { useStore } from '../state/store'
import { dropPeaks } from './peakCache'
import { dropCachedFrames } from '../playback/scrub'
import { dropStripImage } from '../components/Filmstrip'
import { dropInput } from './sources'
import { probeMedia } from './import'
import { enrichAsset, type ChangedMedia } from './projectio'
import { refreshChangedMedia, relinkAsset, relinkTheRest, type PickedFile, type RelinkDeps } from './relink'
import { api } from '../platform'

export const relinkDeps: RelinkDeps = {
  probe: (file) => probeMedia(file),
  drop: (id) => {
    // The demuxer, decoded stills, peaks and strips are all cached per ASSET
    // ID: without dropping them the new file would never be read.
    dropInput(id)
    dropCachedFrames(id)
    dropPeaks(id)
    dropStripImage(id)
  }
}

const kindWord = (k: AssetKind): string => t(k === 'video' ? 'media.kind.video' : k === 'audio' ? 'media.kind.audio' : k === 'image' ? 'media.kind.image' : 'media.kind.code')

/** Relinks asset `assetId` to `file` and says what came of it. True: relinked. */
export async function relinkAndTell(assetId: string, file: PickedFile): Promise<boolean> {
  const name = useStore.getState().project.assets.find((a) => a.id === assetId)?.name ?? file.name
  const r = await relinkAsset(assetId, file, relinkDeps)
  if (!r.ok) {
    if (r.why === 'kind') notify({ text: t('media.relink.kind', { file: file.name, name, want: kindWord(r.want), got: kindWord(r.got) }), kind: 'error' })
    else if (r.why === 'unreadable') notify({ text: t('media.relink.unreadable', { file: file.name }), kind: 'error' })
    return false
  }
  if (r.pastEnd > 0) notify({ text: t('media.relink.pastEnd', { n: r.pastEnd, file: file.name }), kind: 'info', timeout: 0 })
  // The rest of the missing files, looked for in the same folder.
  const before = new Set(useStore.getState().project.assets.filter((a) => !a.missing).map((a) => a.id))
  const more = api ? await relinkTheRest(file, (p, names) => api!.findMediaInFolder(p, names), relinkDeps) : 0
  if (more > 0) notify({ text: t('media.relink.more', { n: more }), kind: 'info' })
  for (const asset of useStore.getState().project.assets) {
    if (asset.id === assetId || (!before.has(asset.id) && !asset.missing)) void enrichAsset(asset, (id, patch) => useStore.getState().setAssetDerived(id, patch))
  }
  return true
}

/** Reads again the media files that changed on disk since the project last
 *  read them (just opened), and says so once. */
export async function refreshChangedAndTell(changed: readonly ChangedMedia[], unconfirmed: readonly string[] = []): Promise<void> {
  // Found by relPath with no stored size to confirm them (Ç2a patch, item 1).
  if (unconfirmed.length) notify({ text: t('media.foundUnchecked', { n: unconfirmed.length, names: unconfirmed.slice(0, 5).join(', ') + (unconfirmed.length > 5 ? ', …' : '') }), kind: 'info', timeout: 0 })
  if (changed.length === 0) return
  const r = await refreshChangedMedia(changed, relinkDeps)
  const parts: string[] = []
  if (r.updated > 0) parts.push(t('media.changed', { n: r.updated }))
  if (r.failed > 0) parts.push(t('media.changed.unreadable', { n: r.failed }))
  if (r.pastEnd > 0) parts.push(t('media.changed.pastEnd', { n: r.pastEnd }))
  if (parts.length) notify({ text: parts.join(' '), kind: r.failed > 0 || r.pastEnd > 0 ? 'error' : 'info', timeout: 0 })
  // The new posters and strips (the old ones were of the old file).
  for (const ch of changed) {
    const asset = useStore.getState().project.assets.find((x) => x.id === ch.id)
    if (asset && !asset.missing) void enrichAsset(asset, (id, patch) => useStore.getState().setAssetDerived(id, patch))
  }
}
