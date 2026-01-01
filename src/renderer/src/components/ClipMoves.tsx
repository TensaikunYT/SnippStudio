// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// A picture that moves with weight: enter, exit, walk, dash, closer, back,
// hop, turn — with the motion model's physics (motion/physics.ts), added at
// the playhead and edited here. (The moves' names and tips are data of
// motion/picture-moves.ts and stay as written there.)

import { MOVE_FEELS, MOVE_INFO, newPictureMove, PICTURE_MOVES, PICTURE_PHYSICS } from '../motion/picture-moves'
import { useStore } from '../state/store'
import { uid, type MoveSide, type Clip } from '../types'
import { Button, Field, IconButton, Section, Segmented, Select, Tooltip, useT } from '../ui'
import { feelName, moveHint, moveName } from '../ui/data-names'
import { UndoNumber, UndoSlider } from './inspector/sliders'

const SIDES: MoveSide[] = ['left', 'right', 'bottom', 'pop', 'fade']

export function ClipMoves({ clip }: { clip: Clip }): JSX.Element {
  const t = useT()
  const now = useStore((s) => s.currentTime)
  const edit = useStore((s) => s.editClipMoves)
  const moves = clip.moves?.actions ?? []
  const physics = clip.moves?.physics ?? PICTURE_PHYSICS
  const local = Math.max(0, Math.min(clip.duration - 0.2, now - clip.start))
  const feel = MOVE_FEELS.find((f) => JSON.stringify(f.physics) === JSON.stringify(physics))?.id
  return (
    <Section id="Moves" icon="move-up-right" title={t('insp.moves.title')} count={moves.length} data-section="clip-moves">
      <div className="hint">{t('insp.moves.hint')}</div>
      <div className="insp-grid">
        {PICTURE_MOVES.map((k) => (
          <Tooltip key={k} content={moveHint(k)}>
            <Button size="sm" onClick={() => edit(clip.id, (m) => void m.actions.push(newPictureMove(k, local, uid())))}>
              {moveName(k)}
            </Button>
          </Tooltip>
        ))}
      </div>
      {moves.map((a) => (
        <div key={a.id} className="insp-move-row">
          <span className="insp-move-name" style={{ color: MOVE_INFO[a.kind].color }}>
            {moveName(a.kind)}
          </span>
          {/* Each of these edits takes its own undo step (the store's editClipMoves). */}
          <UndoNumber undo={false} name={t('insp.moves.when')} value={a.time} step={0.1} digits={1} suffix="s" onChange={(v) => edit(clip.id, (m) => { const x = m.actions.find((q) => q.id === a.id); if (x) x.time = Math.max(0, v) })} />
          <UndoNumber undo={false} name={t('insp.moves.long')} value={a.dur} step={0.1} digits={1} suffix="s" onChange={(v) => edit(clip.id, (m) => { const x = m.actions.find((q) => q.id === a.id); if (x) x.dur = Math.max(0.1, Math.min(10, v)) })} />
          {(a.kind === 'enter' || a.kind === 'exit') && (
            <Select
              size="sm"
              label={t('insp.moves.side')}
              value={a.side ?? (a.kind === 'enter' ? 'left' : 'right')}
              options={SIDES.map((v) => ({ value: v, label: t(`insp.moves.side.${v}`) }))}
              onChange={(v) => edit(clip.id, (m) => { const x = m.actions.find((q) => q.id === a.id); if (x) x.side = v as MoveSide })}
            />
          )}
          {(a.kind === 'move' || a.kind === 'dash') && (
            <UndoNumber undo={false} name={t('insp.moves.where')} value={a.x ?? 0.5} step={0.01} digits={2} onChange={(v) => edit(clip.id, (m) => { const x = m.actions.find((q) => q.id === a.id); if (x) x.x = Math.max(-0.2, Math.min(1.2, v)) })} />
          )}
          {(a.kind === 'approach' || a.kind === 'retreat') && (
            <UndoNumber undo={false} name={t('insp.moves.amount')} value={a.amount ?? (a.kind === 'approach' ? 1.45 : 0.7)} step={0.01} digits={2} suffix="×" onChange={(v) => edit(clip.id, (m) => { const x = m.actions.find((q) => q.id === a.id); if (x) x.amount = Math.max(0.2, Math.min(4, v)) })} />
          )}
          <IconButton icon="x" size="sm" variant="danger" label={t('insp.remove')} onClick={() => edit(clip.id, (m) => { m.actions = m.actions.filter((q) => q.id !== a.id) })} />
        </div>
      ))}
      {moves.length > 0 && (
        <>
          <Field label={t('insp.moves.feel')}>
            <Segmented
              value={feel ?? ''}
              label={t('insp.moves.feel')}
              options={MOVE_FEELS.map((f) => ({ value: f.id, label: feelName(f.id) }))}
              onChange={(id) => edit(clip.id, (m) => { const f = MOVE_FEELS.find((q) => q.id === id); if (f) m.physics = { ...f.physics } })}
            />
          </Field>
          <UndoSlider label={t('insp.moves.weight')} value={physics.weight} min={0} max={1} step={0.01} onChange={(v) => edit(clip.id, (m) => { m.physics = { ...(m.physics ?? PICTURE_PHYSICS), weight: v } }, false)} />
          <UndoSlider label={t('insp.moves.bounce')} value={physics.bounce} min={0} max={1} step={0.01} onChange={(v) => edit(clip.id, (m) => { m.physics = { ...(m.physics ?? PICTURE_PHYSICS), bounce: v } }, false)} />
          <UndoSlider label={t('insp.moves.lean')} value={physics.lean} min={0} max={1} step={0.01} onChange={(v) => edit(clip.id, (m) => { m.physics = { ...(m.physics ?? PICTURE_PHYSICS), lean: v } }, false)} />
          <UndoSlider label={t('insp.moves.squash')} value={physics.squash} min={0} max={1} step={0.01} onChange={(v) => edit(clip.id, (m) => { m.physics = { ...(m.physics ?? PICTURE_PHYSICS), squash: v } }, false)} />
        </>
      )}
    </Section>
  )
}
