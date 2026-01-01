// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// The ready curves as tiles, each with its small drawing (REF-AB, item 4):
// None (back to one speed), Custom (the graph below, as it is), then the
// shapes of speed-shapes.ts. A tile writes its shape into the clip's curve as
// one undo step; the tile of the shape the curve is now is marked.
import { useStore } from '../../state/store'
import { pointsOf, type CurvePoint } from '../../timeline/speed-curve'
import type { Clip } from '../../types'
import { BareButton, Icon, Tooltip, t as say, useT, type StringKey } from '../../ui'
import { formatFree } from '../../ui/logic'
import { SHAPE_KEY, SHAPE_ORDER, matchShape, shapeOf, shapePath, shapePoints, type ShapeName } from './speed-shapes'
import { revealIn } from '../../ui/reveal'

const W = 56
const H = 30

/** One change of the curve (or none: back to one speed) as one undo step. */
function commit(clipId: string, points: CurvePoint[] | null, linear: boolean): void {
  const st = useStore.getState()
  st.armGesture()
  st.setClipSpeedCurve(clipId, points ? { points, ...(linear ? { linear: true } : {}) } : null)
  st.endGesture()
}

/** A shape's name (from t()). */
export const shapeName = (name: ShapeName): string => say(SHAPE_KEY[name] as StringKey)

function Drawing({ points }: { points: readonly CurvePoint[] }): JSX.Element {
  return (
    <svg className="insp-shape-art" viewBox={`0 0 ${W} ${H}`} width={W} height={H} aria-hidden="true">
      <line className="insp-shape-one" x1={3} x2={W - 3} y1={H / 2} y2={H / 2} />
      <path className="insp-shape-line" d={shapePath(points, W, H)} />
    </svg>
  )
}

export function SpeedShapeTiles({ clip }: { clip: Clip }): JSX.Element {
  const t = useT()
  const speed = clip.speed ?? 1
  const linear = !!clip.speedCurve?.linear
  const points = pointsOf(clip)
  const now = matchShape(points)
  const tile = (id: string, on: boolean, name: string, art: JSX.Element, hint: string, act: () => void): JSX.Element => (
    <Tooltip key={id} content={hint}>
      <BareButton className={on ? 'insp-shape is-on' : 'insp-shape'} aria-pressed={on} aria-label={name} testid={`inspector.clip.speed.curve.preset.${id}`} onClick={act}>
        {art}
        <span className="insp-shape-name">{name}</span>
      </BareButton>
    </Tooltip>
  )
  return (
    <div className="insp-shapes" role="group" aria-label={t('insp.curve.presets')} data-testid="inspector.clip.speed.shapes">
      {tile('none', now === 'flat', t('refi.shape.none'), <Drawing points={[{ u: 0, v: 1 }, { u: 1, v: 1 }]} />, t('refi.shape.none.hint'), () => commit(clip.id, null, linear))}
      {tile(
        'custom',
        now === null,
        t('refi.shape.custom'),
        <span className="insp-shape-art is-icon"><Icon name="sliders-horizontal" size={18} /></span>,
        t('refi.shape.custom.hint'),
        // The graph is the custom curve's editor: to it.
        () => revealIn(document.querySelector<SVGElement>('[data-testid="inspector.clip.speed.curve"]'), 'nearest')
      )}
      {SHAPE_ORDER.map((name) =>
        tile(name, now === name, shapeName(name), <Drawing points={shapeOf(name)} />, t('insp.curve.preset.hint', { v: formatFree(speed, 2) }), () => commit(clip.id, shapePoints(name, speed), linear))
      )}
    </div>
  )
}
