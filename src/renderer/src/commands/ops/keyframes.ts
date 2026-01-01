// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// Clip keyframe helpers (moved out of state/store.ts in phase 2A). The old
// files' one shared keyframe list is converted when a file is read (phase
// Ç2c.1, decision 3: model/format.ts, format 5), so nothing here migrates.
import type { Clip } from '../../types'
import { channelKfs } from '../../types'
import { upsertKeyframe } from '../../state/animclip'
import { keyLocalAt } from '../../timeline/key-grid'

/** Upserts a keyframe on one channel. */
/** Thin alias: the implementation lives in animclip.ts, where it is tested. */
export const upsertKf = upsertKeyframe

/**
 * Puts a clip in a given pose — Centre, Fit, Fill.
 *
 * A channel that is KEYFRAMED gets a keyframe at the playhead; one that isn't
 * gets its static value. These three buttons used to delete the x/y/scale
 * keyframes outright, on the theory that a fixed pose overrides an animated
 * one. But "put it back in the middle" is something you do in the MIDDLE of an
 * animation — after a zoom, to end where you started — and paying for it with
 * every keyframe on the clip made the buttons unusable exactly when they were
 * most useful.
 */
export function poseClip(clip: Clip, local: number | null, pose: Partial<Record<'x' | 'y' | 'scale', number>>, fps: number): void {
  for (const [ch, v] of Object.entries(pose) as ['x' | 'y' | 'scale', number][]) {
    if (typeof v !== 'number') continue
    if ((channelKfs(clip, ch)?.length ?? 0) > 0) {
      // The playhead off the clip writes no key (phase Ç2c.2, K19).
      if (local !== null) upsertKf(clip, ch, local, v, { fps })
    } else clip.transform[ch] = v
  }
}

/** Clip-local time under the playhead on the frame grid, or null when the
 *  playhead is not on the clip (phase Ç2c.2, decisions 1 and 4 / K19). */
export const localAt = (clip: Clip, time: number, fps: number): number | null => keyLocalAt(clip, time, fps)
