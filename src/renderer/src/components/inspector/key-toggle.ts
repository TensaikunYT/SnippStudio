// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// What a value's ◇ does (REF-AB, item 2): a key at the playhead, or — the
// playhead on one of the value's keys — that key taken away, as the effects'
// diamonds already did (toggleFxKey). Taking away the last key leaves the
// value the picture showed there as the value's own, so nothing jumps; both
// as one undo step.
import { automationGainAt } from '../../audio/envelope'
import { clipOpacityAt, clipTransformAt } from '../../playback/render'
import { useStore } from '../../state/store'
import { keyLocalAt, keyOnFrame } from '../../timeline/key-grid'
import type { KfChannel } from '../../types'

/** The key of a channel at the playhead, if the playhead is on one. */
function hitAt<K extends { time: number }>(clip: { start: number; duration: number }, keys: readonly K[] | undefined): { local: number; key: K } | null {
  const st = useStore.getState()
  const fps = st.project.settings.fps
  const local = keyLocalAt(clip, st.currentTime, fps)
  if (local === null) return null
  const key = keyOnFrame(keys, local, fps)
  return key ? { local, key } : null
}

/** ◇ of a clip's place, size, turn or opacity. */
export function togglePropKey(clipId: string, ch: KfChannel): void {
  const st = useStore.getState()
  const clip = st.project.clips[clipId]
  if (!clip) return
  const hit = hitAt(clip, clip.channels?.[ch])
  if (!hit) return st.addPropKeyframe(clipId, ch)
  const value = ch === 'opacity' ? clipOpacityAt(clip, hit.local) : clipTransformAt(clip, hit.local)[ch]
  st.undoable(() => {
    useStore.getState().deleteClipKeyframe(clipId, ch, hit.key.id)
    const left = useStore.getState().project.clips[clipId]?.channels?.[ch]?.length ?? 0
    if (left === 0) useStore.getState().setPropValue(clipId, ch, value)
  })
}

/** ◇ of a clip's volume. */
export function toggleVolumeKey(clipId: string): void {
  const st = useStore.getState()
  const clip = st.project.clips[clipId]
  if (!clip) return
  const hit = hitAt(clip, clip.volumeKeyframes)
  if (!hit) return st.addVolumeKeyframe(clipId)
  const value = automationGainAt(clip, hit.local)
  st.undoable(() => {
    useStore.getState().deleteVolumeKeyframe(clipId, hit.key.id)
    const after = useStore.getState().project.clips[clipId]
    // (Setting the volume unmutes; a muted clip keeps its silence.)
    if (after && !after.volumeKeyframes?.length && !after.muted) useStore.getState().setClipVolume(clipId, value)
  })
}
