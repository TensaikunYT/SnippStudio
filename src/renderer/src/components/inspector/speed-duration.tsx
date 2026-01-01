// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// The Speed card's length (REF-AB, item 4): the footage's own length at 1x,
// and the length the speed gives it, which can be typed — the speed is then
// set to fit it (one speed only; a curve shows its length in words). One
// typed length is one undo step.
import { useStore } from '../../state/store'
import { SPEED_MAX, SPEED_MIN, minClipLength } from '../../timeline/speed'
import type { Clip } from '../../types'
import { NumberField, Tooltip, useT } from '../../ui'
import { formatFree } from '../../ui/logic'

/** The speed that gives footage of `media` seconds the length `d`, held to
 *  the speeds there are. Pure. */
export function speedForLength(media: number, d: number): number {
  if (!(media > 0) || !(d > 0)) return 1
  return Math.min(SPEED_MAX, Math.max(SPEED_MIN, media / d))
}

/** The lengths a typed value is held to: what the slowest and the fastest
 *  speed give (never under one frame). Pure. */
export function lengthRange(media: number, fps: number): [number, number] {
  return [Math.max(minClipLength(fps), media / SPEED_MAX), Math.max(minClipLength(fps), media / SPEED_MIN)]
}

export function DurationRow({ clip }: { clip: Clip }): JSX.Element {
  const t = useT()
  const fps = useStore((s) => s.project.settings.fps)
  const speed = clip.speed ?? 1
  const media = clip.duration * speed
  const [lo, hi] = lengthRange(media, fps)
  return (
    <Tooltip content={t('refi.speed.length.hint')}>
      <div className="insp-length" role="group" aria-label={t('refi.speed.length')} data-testid="inspector.clip.speed.length.row">
        <span className="insp-length-label">{t('refi.speed.length')}</span>
        <span className="insp-length-from" data-testid="inspector.clip.speed.length.media">{t('refi.speed.lengthFrom', { s: formatFree(media, 2) })}</span>
        <NumberField
          size="sm"
          free
          label={t('refi.speed.length')}
          value={clip.duration}
          min={lo}
          max={hi}
          step={0.1}
          decimals={2}
          unit="s"
          testid="inspector.clip.speed.length"
          onChange={(d) => {
            const st = useStore.getState()
            st.armGesture()
            st.setClipSpeed(clip.id, speedForLength(media, d))
            st.endGesture()
          }}
        />
      </div>
    </Tooltip>
  )
}
