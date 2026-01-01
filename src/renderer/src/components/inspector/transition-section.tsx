// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// The one place a transition is edited (core polish T): its type (a grid of
// the kinds, each with a small moving picture of what it does), its length,
// where it sits, the ramp's settings, its own sound, "make it the default",
// "play the cut" and remove. Shown in the Clip tab under the selected clip,
// and on its own when a transition is selected on the timeline. The
// timeline's old menu (another list, other names, another default length,
// no alignment, no ramp settings) is gone. Kinds and names: the one table,
// timeline/transition-types.ts.
import { useState, type ReactNode } from 'react'
import { useStore } from '../../state/store'
import type { Clip } from '../../types'
import { assetById } from '../../types'
import { TRANSITION_LIMITS } from '../../timeline/transition-links'
import {
  RAMP_DIRS,
  TRANSITION_GROUPS,
  TRANSITION_KINDS,
  kindOf,
  rampDirOf,
  typeOf,
  type RampDir,
  type TransitionKindId,
  type TransitionType
} from '../../timeline/transition-types'
import { Button, Field, Icon, IconButton, Section, Segmented, Select, Tooltip, useT, type StringKey } from '../../ui'
import { UndoSlider } from './sliders'
import { addDefaultAt, makeDefault, playCut, putTransition, rememberDefault, setTransitionType, useTransitionUi } from '../timeline/transition-state'
import '../timeline/transitions.css'
import './transition-preview.css'
import { TransitionPreview } from './transition-preview'

const ALIGNS = ['auto', 'center', 'start', 'end'] as const
const DIRECTIONS = ['right', 'left', 'up', 'down'] as const

/** What a dragged kind carries (Library → Effects onto a cut). */
export const TRANSITION_DRAG_TYPE = 'application/x-snipp-transition'

/** A type's name through t() (`ramp-left` → "Ramp push, Left"). */
export function transitionName(t: (k: StringKey, p?: Record<string, string | number>) => string, type: TransitionType): string {
  const kind = kindOf(type)
  const dir = rampDirOf(type)
  return dir ? `${t(kind.name)}, ${t(dirKey(dir))}` : t(kind.name)
}
const dirKey = (d: RampDir): StringKey => `trans.opt.ramp${d[0].toUpperCase()}${d.slice(1)}` as StringKey

/**
 * The kinds as tiles, by group. Each shows a small picture of what the kind
 * does, drawn by the renderer itself (transition-preview.tsx: two abstract
 * frames, the first giving way to the second); pointed at or focused, it
 * plays (still under reduced motion). `draggable`:
 * a tile can be dragged onto a cut on the timeline (Library → Effects).
 */
/** `only` (the left panel's search, favourites and recents; REF-AB item 6):
 *  the kinds shown, in that order (`flat`: as one list, without the groups);
 *  `mark`: a kind's bookmark on its tile; `onDragUse`: a kind dragged out. */
export function TransitionGrid({ value, onPick, draggable, testid, only, flat, mark, onDragUse }: { value: TransitionKindId | null; onPick: (kind: TransitionKindId) => void; draggable?: boolean; testid: string; only?: readonly string[]; flat?: boolean; mark?: (kind: TransitionKindId) => ReactNode; onDragUse?: (kind: TransitionKindId) => void }): JSX.Element {
  const t = useT()
  const [hot, setHot] = useState<TransitionKindId | null>(null)
  const groups: { id: string; label: string | null; kinds: typeof TRANSITION_KINDS }[] =
    only && flat
      ? [{ id: 'only', label: null, kinds: only.map((id) => TRANSITION_KINDS.find((k) => k.id === id)).filter((k): k is (typeof TRANSITION_KINDS)[number] => !!k) }]
      : TRANSITION_GROUPS.map((g) => ({ id: g, label: t(`trans.group.${g}` as StringKey), kinds: TRANSITION_KINDS.filter((k) => k.group === g && (!only || only.includes(k.id))) })).filter((g) => g.kinds.length > 0)
  return (
    <div className="ct-grid" role="radiogroup" aria-label={t('ct.grid')} data-testid={testid}>
      {groups.map((g) => (
        <div className="ct-group" key={g.id}>
          {g.label !== null && <div className="ct-group-label">{g.label}</div>}
          <div className="ct-tiles">
            {g.kinds.map((k) => {
              const tile = (
              <BareButton
                key={k.id}
                type="button"
                role="radio"
                aria-checked={value === k.id}
                className={`ct-tile${value === k.id ? ' is-on' : ''}`}
                data-testid={`${testid}.${k.id}`}
                draggable={draggable}
                onDragStart={draggable ? (e) => {
                  e.dataTransfer.setData(TRANSITION_DRAG_TYPE, typeOf(k.id))
                  e.dataTransfer.effectAllowed = 'copy'
                  document.body.classList.add('ct-dragging')
                  onDragUse?.(k.id)
                } : undefined}
                onDragEnd={draggable ? () => document.body.classList.remove('ct-dragging') : undefined}
                onClick={() => onPick(k.id)}
                onPointerEnter={() => setHot(k.id)}
                onPointerLeave={() => setHot((h) => (h === k.id ? null : h))}
                onFocus={() => setHot(k.id)}
                onBlur={() => setHot((h) => (h === k.id ? null : h))}
              >
                <TransitionPreview type={typeOf(k.id)} playing={hot === k.id} />
                <span className="ct-tile-name">{t(k.name)}</span>
              </BareButton>
              )
              return mark ? <div className="pick-card" key={k.id}>{tile}{mark(k.id)}</div> : tile
            })}
          </div>
        </div>
      ))}
    </div>
  )
}

/** The transition `clip` leaves with: everything about it, in one place.
 *  `alone`: shown by itself (a transition selected on the timeline). */
export function TransitionSection({ clip, alone }: { clip: Clip; alone?: boolean }): JSX.Element {
  const t = useT()
  const def = useTransitionUi((u) => u.def)
  const fromName = useStore((s) => assetById(s.project, clip.assetId)?.name ?? '')
  const toName = useStore((s) => {
    const to = clip.transitionOut?.to
    const next = to ? s.project.clips[to] : undefined
    return next ? (assetById(s.project, next.assetId)?.name ?? '') : null
  })
  const tr = clip.transitionOut
  const set = useStore((s) => s.setTransitionOut)
  const defName = transitionName(t, def.type)
  const body = !tr ? (
    <div className="ct-empty">
      <div className="hint">{t('ct.none')}</div>
      <Tooltip content={t('ct.add.hint', { s: def.duration.toFixed(1) })}>
        <Button size="sm" icon="plus" testid="inspector.trans.add" onClick={() => addDefaultAt(clip.id, !!alone)}>
          {t('ct.add', { name: defName })}
        </Button>
      </Tooltip>
    </div>
  ) : (
    <>
      {alone && (
        <div className="ct-between" data-testid="inspector.trans.between">
          {toName === null ? t('ct.toEnd', { from: fromName }) : t('ct.between', { from: fromName, to: toName })}
        </div>
      )}
      <TransitionGrid
        value={kindOf(tr.type).id}
        testid="inspector.trans.kind"
        onPick={(kind) => setTransitionType(clip.id, typeOf(kind, rampDirOf(tr.type)))}
      />
      {rampDirOf(tr.type) && (
        <Field label={t('ct.dir')}>
          <Segmented
            value={rampDirOf(tr.type)!}
            label={t('ct.dir')}
            testid="inspector.trans.dir"
            options={RAMP_DIRS.map((d) => ({ value: d, label: t(dirKey(d)) }))}
            onChange={(d) => setTransitionType(clip.id, typeOf('ramp', d))}
          />
        </Field>
      )}
      <UndoSlider
        label={tr.type === 'speed-ramp' ? t('insp.trans.setup') : t('insp.trans.duration')}
        testid="inspector.trans.duration"
        value={tr.duration}
        onChange={(duration) => {
          set(clip.id, { ...tr, duration })
          rememberDefault({ duration })
        }}
        min={TRANSITION_LIMITS.min}
        max={TRANSITION_LIMITS.max}
        step={0.01}
      />
      {tr.type !== 'speed-ramp' && (
        <Tooltip content={t('insp.trans.align.hint')}>
          <div>
            <Field label={t('insp.trans.align')}>
              <Select
                value={tr.align ?? 'auto'}
                testid="inspector.trans.align"
                options={ALIGNS.map((v) => ({ value: v, label: t(`insp.trans.align.${v}`) }))}
                onChange={(v) => putTransition(clip.id, { ...tr, align: v as (typeof ALIGNS)[number] })}
              />
            </Field>
          </div>
        </Tooltip>
      )}
      {tr.type === 'speed-ramp' && (
        <>
          <UndoSlider label={t('insp.trans.peak')} value={tr.peakSpeed ?? 10} onChange={(peakSpeed) => set(clip.id, { ...tr, peakSpeed })} min={2} max={15} step={0.5} />
          <Field label={t('insp.trans.blurDir')}>
            <Select
              value={tr.direction ?? 'right'}
              options={DIRECTIONS.map((v) => ({ value: v, label: t(`insp.dir.${v}`) }))}
              onChange={(v) => putTransition(clip.id, { ...tr, direction: v as (typeof DIRECTIONS)[number] })}
            />
          </Field>
          <p className="hint">{t('insp.trans.ramp.hint')}</p>
        </>
      )}
      <div className="ct-sound">
        <IconButton
          icon={(tr.sfx ?? 0) > 0 ? 'volume-2' : 'volume-x'}
          variant="ghost"
          size="sm"
          testid="inspector.trans.mute"
          aria-pressed={(tr.sfx ?? 0) === 0}
          label={(tr.sfx ?? 0) > 0 ? t('trans.sound.silence') : t('trans.sound.restore')}
          onClick={() => {
            // A transition is silent unless given a sound (DENEME-3, V item 2):
            // no value is silent; the button gives it its full sound.
            const next = { ...tr }
            if ((tr.sfx ?? 0) > 0) delete next.sfx
            else next.sfx = 1
            putTransition(clip.id, next)
          }}
        />
        <UndoSlider
          label={t('ct.sound')}
          testid="inspector.trans.sound"
          value={tr.sfx ?? 0}
          disabled={(tr.sfx ?? 0) === 0}
          onChange={(v) => {
            const next = { ...tr }
            if (v <= 0) delete next.sfx
            else next.sfx = v
            set(clip.id, next)
          }}
          min={0}
          max={1.5}
          step={0.01}
          fmt={(v) => fmtPct(v)}
        />
      </div>
      <Tooltip content={t('ct.sound.project.hint')}>
        <Button size="sm" variant="ghost" icon="sliders-horizontal" testid="inspector.trans.project-sound" onClick={() => useStore.getState().focusInspector('transition-sound')}>
          {t('ct.sound.project')}
        </Button>
      </Tooltip>
      {/* The two actions keep their words (audit G2: squeezed beside the
          default line they were "P." and "R."); the default on its own row. */}
      <div className="insp-row is-tight ct-actions">
        <Tooltip content={t('ct.play.hint')}>
          <Button size="sm" icon="play" testid="inspector.trans.play" onClick={() => playCut(clip.id)}>{t('ct.play')}</Button>
        </Tooltip>
        {/* Delete removes it only while it is the selection (a selected clip's
            Delete removes the clip): the tip names the key only then (audit E4). */}
        <Tooltip content={alone ? t('ct.remove.hint') : t('ct.remove.hintClip')}>
          <Button size="sm" variant="ghost" icon="trash" testid="inspector.trans.remove" onClick={() => putTransition(clip.id, null)}>{t('ct.remove')}</Button>
        </Tooltip>
      </div>
      <div className="insp-row ct-default-row">
        {def.type === tr.type && Math.abs(def.duration - tr.duration) < 1e-6 ? (
          <span className="ct-is-default" data-testid="inspector.trans.is-default"><Icon name="check" size={12} /> {t('ct.default.is')}</span>
        ) : (
          <Tooltip content={t('ct.menu.default.hint')}>
            <Button size="sm" variant="ghost" testid="inspector.trans.default" onClick={() => makeDefault(clip.id)}>{t('ct.default')}</Button>
          </Tooltip>
        )}
      </div>
      <div className="hint ct-default-now">{t('ct.default.now', { name: defName, s: def.duration.toFixed(1) })}</div>
    </>
  )
  return (
    <Section id={alone ? 'Transition' : 'Transition to next clip'} icon="blend" title={alone ? t('ct.menu') : t('insp.trans.title')} data-section="transition" testid="inspector.trans">
      {body}
    </Section>
  )
}

/** Project → Sound: every transition's sound and the build-ups (they were
 *  inside a single transition's menu on the timeline). */
export function TransitionSoundSection(): JSX.Element {
  const t = useT()
  const level = useStore((s) => s.project.transitionSfx ?? 0.5)
  const risers = useStore((s) => s.project.risers ?? 0)
  return (
    <Section id="Transition sounds" icon="audio-lines" title={t('ct.projSound')} data-section="transition-sound" testid="inspector.project.trans-sound">
      <div className="hint">{t('ct.projSound.hint')}</div>
      <Tooltip content={t('trans.sound.all.hint')}>
        <div>
          <UndoSlider label={t('trans.sound.all')} testid="inspector.project.trans-sound.all" value={level} onChange={(v) => useStore.getState().setTransitionSfx(v)} min={0} max={1} step={0.01} fmt={(v) => fmtPct(v)} />
        </div>
      </Tooltip>
      <Tooltip content={t('trans.sound.risers.hint')}>
        <div>
          <UndoSlider label={t('trans.sound.risers')} testid="inspector.project.trans-sound.risers" value={risers} onChange={(v) => useStore.getState().setRisers(v)} min={0} max={1} step={0.01} fmt={(v) => fmtPct(v)} />
        </div>
      </Tooltip>
    </Section>
  )
}

import { BareButton } from '../../ui/Button'
import { fmtPct } from '../../ui/format'