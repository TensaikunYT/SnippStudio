// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// The Clip tab's speed row (core polish, part B): 0.1x – 100x on a track by
// decades and a number field that takes any speed in the range (the usual
// speeds one click away went in DENEME-2). What the row cannot show on the timeline it says in
// words: a clip held at one frame, a speed with no sound, a speed the
// preview steps through. One speed or a curve (core polish, part C): the
// curve's editor and tools are speed-curve-editor.tsx.
import { useStore } from '../../state/store'
import { PLAYABLE_MAX, SPEED_MAX, SPEED_MIN, minClipLength, speedAudible } from '../../timeline/speed'
import type { Clip } from '../../types'
import { Segmented, useT } from '../../ui'
import { clampCurveSpeed, hasCurve } from '../../timeline/speed-curve'
import { SpeedCurveEditor, SpeedCurveTools } from './speed-curve-editor'
import { UndoDecadeSlider } from './sliders'
import { SpeedShapeTiles } from './speed-shape-tiles'
import { DurationRow } from './speed-duration'

export function SpeedRow({ clip, hasSound, isVideo, curveable = true }: { clip: Clip; hasSound: boolean; isVideo: boolean; curveable?: boolean }): JSX.Element {
  const t = useT()
  const curved = hasCurve(clip)
  const fps = useStore((s) => s.project.settings.fps)
  const speed = clip.speed ?? 1
  // Held where one frame is reached: the speed asked for was not given.
  const oneFrame = speed > 1 && clip.duration <= minClipLength(fps) + 1e-6
  /** One speed or a curve: each change one undo step. */
  const mode = (to: 'one' | 'curve'): void => {
    if ((to === 'curve') === curved) return
    const st = useStore.getState()
    st.armGesture()
    // A curve starts flat at the speed it had; one speed again keeps the length (the curve's average).
    st.setClipSpeedCurve(clip.id, to === 'curve' ? { points: [{ u: 0, v: clampCurveSpeed(speed) }, { u: 1, v: clampCurveSpeed(speed) }] } : null)
    st.endGesture()
  }
  const modes = curveable || curved ? (
    <Segmented
      label={t('insp.curve.mode')}
      testid="inspector.clip.speed.mode"
      value={curved ? 'curve' : 'one'}
      onChange={mode}
      options={[
        { value: 'one', label: t('insp.curve.mode.one'), hint: t('insp.curve.mode.one.hint') },
        { value: 'curve', label: t('insp.curve.mode.curve'), hint: t('insp.curve.mode.curve.hint') }
      ]}
    />
  ) : null
  if (curved) {
    return (
      <>
        {modes}
        <SpeedShapeTiles clip={clip} />
        <SpeedCurveEditor clip={clip} />
        <SpeedCurveTools clip={clip} hasSound={hasSound} isVideo={isVideo} />
      </>
    )
  }
  return (
    <>
      {modes}
      <UndoDecadeSlider label={t('insp.clip.speed')} testid="inspector.clip.speed" value={speed} onChange={(v) => useStore.getState().setClipSpeed(clip.id, v)} min={SPEED_MIN} max={SPEED_MAX} suffix={t('insp.speed.times', { v: '' })} />
      <DurationRow clip={clip} />
      {/* (DENEME-2, item 11: the speeds one click away, 0.25× … 100×, are gone;
          the user found them needless. The slider by decades and the number stay.) */}
      {oneFrame && <div className="hint is-state" data-testid="inspector.clip.speed.one-frame">{t('insp.speed.oneFrame')}</div>}
      {hasSound && !speedAudible(speed) && <div className="hint is-state" data-testid="inspector.clip.speed.silent">{t('insp.speed.silent')}</div>}
      {isVideo && speed > PLAYABLE_MAX && <div className="hint is-state" data-testid="inspector.clip.speed.stepped">{t('insp.speed.stepped')}</div>}
    </>
  )
}
