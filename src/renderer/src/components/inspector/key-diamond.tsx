// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// A value's keyframe diamond and its arrows (REF-AB, item 2: ‹ ◇ ›; DENEME-1, P7: "anahtar kare aktiften sağdaki
// panelde renkle aktif olduğu belli olmuyor"). Three states, told apart by
// fill and colour, not by a thin outline's tone:
//   - no keys: a hollow diamond in the quiet text grey;
//   - keyed: filled with the selection's gold (--select);
//   - the playhead on one of its keys: filled, on a gold-tinted square.
// The row it sits in (.insp-prop / .insp-pos) carries `is-keyed` as well, so
// the value's label and pill take a light gold too (inspector.css).
import { useStore } from '../../state/store'
import { keyLocalAt, keyOnFrame } from '../../timeline/key-grid'
import { stepKey } from '../../timeline/key-nav'
import { IconButton, useT } from '../../ui'

/** Whether the (paused) playhead stands on one of `keys` (clip-local
 *  times). A boolean from the store: the diamond re-renders when it changes,
 *  not on every move of the playhead. */
export function useOnKey(span: { start: number; duration: number }, keys: readonly { time: number }[] | undefined): boolean {
  return useStore((s) => {
    if (!keys?.length || s.playing) return false
    const fps = s.project.settings.fps
    const local = keyLocalAt(span, s.currentTime, fps)
    return local !== null && keyOnFrame(keys, local, fps) !== undefined
  })
}

/** The timeline times of `keys` on the span (those off it are kept by the
 *  edits but change nothing on screen), sorted. */
export function spanKeyTimes(span: { start: number; duration: number }, keys: readonly { time: number }[] | undefined): number[] {
  return (keys ?? [])
    .filter((k) => k.time >= -1e-3 && k.time <= span.duration + 1e-3)
    .map((k) => span.start + Math.min(span.duration, Math.max(0, k.time)))
    .sort((a, b) => a - b)
}

/** Whether there is a key of `keys` before / after the playhead: two
 *  booleans from the store, so the arrows re-render when one turns, not on
 *  every move of the playhead. */
function useKeySides(span: { start: number; duration: number }, keys: readonly { time: number }[] | undefined): [boolean, boolean] {
  const prev = useStore((s) => stepKey(spanKeyTimes(span, keys), s.currentTime, -1) !== undefined)
  const next = useStore((s) => stepKey(spanKeyTimes(span, keys), s.currentTime, 1) !== undefined)
  return [prev, next]
}

/** The playhead onto the value's key before (−1) or after (1) it. */
export function stepValueKey(span: { start: number; duration: number }, keys: readonly { time: number }[] | undefined, dir: 1 | -1): void {
  const st = useStore.getState()
  const to = stepKey(spanKeyTimes(span, keys), st.currentTime, dir)
  if (to !== undefined) st.setTime(to)
}

/**
 * A keyable value's ‹ ◇ › (REF-AB, item 2): ‹ and › put the playhead on this
 * value's key before or after it (quiet when there is none that way, so
 * both are quiet on a value without keys); ◇ adds a key at the playhead or,
 * on one, takes it away (`onClick`).
 */
export function KeyDiamond({
  keys,
  span,
  label,
  onClick,
  testid
}: {
  /** The value's keys (clip-local times); empty or missing: not keyed. */
  keys: readonly { time: number }[] | undefined
  span: { start: number; duration: number }
  label: string
  onClick: () => void
  testid?: string
}): JSX.Element {
  const t = useT()
  const keyed = (keys?.length ?? 0) > 0
  const at = useOnKey(span, keys)
  const [hasPrev, hasNext] = useKeySides(span, keys)
  const cls = ['insp-key', keyed && 'is-keyed', at && 'is-at'].filter(Boolean).join(' ')
  return (
    <span className="insp-keynav">
      <IconButton icon="chevron-left" size="sm" variant="ghost" className="insp-keystep" label={t('refi.key.prev')} disabled={!hasPrev} testid={testid ? `${testid}.prev` : undefined} onClick={() => stepValueKey(span, keys, -1)} />
      {/* (On one of its keys the press takes that key away: the button says so. 22 November, L12.) */}
      <IconButton icon="diamond" size="sm" variant="ghost" className={cls} label={at ? t('d22d.key.remove') : label} testid={testid} onClick={onClick} />
      <IconButton icon="chevron-right" size="sm" variant="ghost" className="insp-keystep" label={t('refi.key.next')} disabled={!hasNext} testid={testid ? `${testid}.next` : undefined} onClick={() => stepValueKey(span, keys, 1)} />
    </span>
  )
}
