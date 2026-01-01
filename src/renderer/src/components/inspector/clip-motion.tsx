// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// The Clip tab's motion sections: properties, keyframes, motion, tracker.
// Moved out of Inspector.tsx in SnippStudio phase 2B; onto the building blocks
// in phase 3c.3 (no change of behaviour).
import { useState } from 'react'
import { channelKfs } from '../../playback/render'
import { useStore } from '../../state/store'
import type { Clip, ClipAnim, IdleStyle, KfChannel, PropKeyframe } from '../../types'
import { CLIP_ANIMS, IDLE_STYLES, KF_CHANNELS } from '../../types'
import { keysOffClip, onClip } from '../timeline/shared'
import { Button, Field, IconButton, Section, Segmented, Select, Tooltip, t as say, useT } from '../../ui'
import { fmtNum, fmtSec, fmtPct } from '../../ui/format'
import { keyTimes, stepKey } from '../../timeline/key-nav'
import { UndoSlider } from './sliders'
import { animName, idleName } from './motion-names'
import { KeyDiamond } from './key-diamond'
import { togglePropKey } from './key-toggle'
import { ResetCardButton } from './card-reset-button'
import { AnimGrid, type MotionPart } from './anim-grid'

/** A slider + a per-property keyframe button (lit when that channel is keyed). */
export function PropRow({ clip, ch, children }: { clip: Clip; ch: KfChannel; children: React.ReactNode }): JSX.Element {
  const t = useT()
  const keys = channelKfs(clip, ch)
  const keyed = (keys?.length ?? 0) > 0
  // (REF-AB, item 2: ‹ ◇ ›; on a key the diamond takes it away.)
  return (
    <div className={keyed ? 'insp-prop is-keyed' : 'insp-prop'}>
      <div className="insp-prop-body">{children}</div>
      <KeyDiamond keys={keys} span={clip} label={t('insp.kf.addProp')} testid={`inspector.clip.${ch}.key`} onClick={() => togglePropKey(clip.id, ch)} />
    </div>
  )
}

/** A channel's name in the keyframe list. */
export const kfLabel = (ch: KfChannel): string => say(`insp.kf.ch.${ch}`)

/** Tiny curve glyph so the easing is readable at a glance, not just by name. */
export function EasingIcon({ easing }: { easing: string }): JSX.Element {
  const d =
    easing === 'linear'
      ? 'M1 15 L15 1'
      : easing === 'easeIn'
        ? 'M1 15 C 9 15, 13 11, 15 1'
        : easing === 'easeOut'
          ? 'M1 15 C 3 5, 7 1, 15 1'
          : easing === 'hold'
            ? 'M1 15 L13 15 L13 1 L15 1' // a step
            : 'M1 15 C 6 15, 10 1, 15 1' // smooth (ease in-out)
  return (
    <svg className="ease-icon" viewBox="0 0 16 16" aria-hidden>
      <path d={d} fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  )
}

export function kfValueText(ch: KfChannel, value: number, frame: { width: number; height: number }): string {
  if (ch === 'scale') return value.toFixed(2)
  if (ch === 'rotation') return `${((value * 180) / Math.PI).toFixed(0)}°`
  if (ch === 'opacity') return fmtPct(value)
  // Centre-relative, to match the Position X/Y boxes above.
  return String(Math.round(value - (ch === 'x' ? frame.width : frame.height) / 2))
}

const EASINGS = ['smooth', 'linear', 'easeIn', 'easeOut', 'hold'] as const

/**
 * Keyframes are listed GROUPED BY TIME. "Keyframe all" writes one per channel
 * at the same instant; listing them individually produced a wall of near-
 * identical rows (Scale/X/Y/Opacity/Rotate repeated per time). Each group is
 * one row — expand it to reach the individual channels.
 */
export function KeyframesSection({ clip }: { clip: Clip }): JSX.Element {
  const t = useT()
  const setTime = useStore((s) => s.setTime)
  const frame = useStore((s) => s.project.settings)
  const deleteClipKeyframe = useStore((s) => s.deleteClipKeyframe)
  const deleteKeyframes = useStore((s) => s.deleteKeyframes)
  const clearClipKeyframes = useStore((s) => s.clearClipKeyframes)
  const [open, setOpen] = useState<string | null>(null)

  const groups = new Map<string, { time: number; items: { ch: KfChannel; k: PropKeyframe }[] }>()
  for (const ch of KF_CHANNELS) {
    // The keys on the clip; those off it are kept by every edit (phase
    // Ç2c.1) and only counted here.
    for (const k of channelKfs(clip, ch) ?? []) {
      if (!onClip(clip, k.time)) continue
      const key = k.time.toFixed(3)
      const g = groups.get(key) ?? { time: k.time, items: [] }
      g.items.push({ ch, k })
      groups.set(key, g)
    }
  }
  const rows = [...groups.values()].sort((a, b) => a.time - b.time)
  const step = (dir: 1 | -1): void => {
    const s = useStore.getState()
    const to = stepKey(keyTimes(s.project, [clip.id]), s.currentTime, dir)
    if (to !== undefined) setTime(to)
  }
  const hasKfs = rows.length > 0
  const off = keysOffClip(clip)
  const easingName = (e: (typeof EASINGS)[number]): string => (e === 'hold' ? t('keyframe.easing.hold') : t(`insp.kf.easing.${e}`))

  return (
    <Section id="Keyframes" icon="diamond" title={t('insp.kf.title')} count={rows.length}>
      <div className="hint">{t('insp.kf.hint')}</div>
      {/* From key to key, a key at the playhead (phase Ç2c.2, decision 5). */}
      <div className="insp-row is-tight insp-icons">
        <IconButton icon="chevron-left" size="sm" label={t('keyframe.prev')} shortcut="alt+," testid="inspector.keyframes.prev" onClick={() => step(-1)} />
        <IconButton icon="diamond" size="sm" label={t('keyframe.toggle')} shortcut="alt+k" testid="inspector.keyframes.toggle" onClick={() => useStore.getState().toggleKeyframeAtPlayhead()} />
        <IconButton icon="chevron-right" size="sm" label={t('keyframe.next')} shortcut="alt+." testid="inspector.keyframes.next" onClick={() => step(1)} />
      </div>
      {off.before + off.after > 0 && (
        <div className="hint is-state" data-testid="inspector.keyframes.off-clip">
          {t('keyframe.outside', { n: off.before + off.after })}
        </div>
      )}
      {(hasKfs || off.before + off.after > 0) && (
        <div className="insp-row">
          <Button size="sm" onClick={() => clearClipKeyframes(clip.id)}>{t('insp.kf.clear')}</Button>
        </div>
      )}
      <div className="insp-kf-list">
        {rows.map((g) => {
          const key = g.time.toFixed(3)
          const multi = g.items.length > 1
          const expanded = open === key
          return (
            <div key={key}>
              <div className={multi ? 'insp-kf-row is-multi' : 'insp-kf-row'}>
                <IconButton
                  icon={expanded ? 'chevron-down' : 'chevron-right'}
                  size="sm"
                  variant="ghost"
                  label={expanded ? t('insp.kf.collapse') : t('insp.kf.expand')}
                  aria-expanded={expanded}
                  onClick={() => setOpen(expanded ? null : key)}
                />
                <span className="insp-kf-time">{t('insp.seconds', { n: fmtNum(g.time, 2, true) })}</span>
                <span className="insp-kf-name">{multi ? t('insp.kf.all', { n: g.items.length }) : kfLabel(g.items[0].ch)}</span>
                <EasingIcon easing={g.items[0].k.easing ?? 'smooth'} />
                <Select
                  size="sm"
                  className="insp-kf-easing"
                  label={multi ? t('insp.kf.easing.all') : t('insp.kf.easing.one')}
                  value={g.items[0].k.easing ?? 'smooth'}
                  options={EASINGS.map((e) => ({ value: e, label: easingName(e) }))}
                  onChange={(v) => {
                    for (const it of g.items) useStore.getState().setKeyframeEasing(clip.id, it.ch, it.k.id, v as never)
                  }}
                />
                <IconButton icon="arrow-right" size="sm" variant="ghost" label={t('insp.kf.jump')} onClick={() => setTime(clip.start + g.time)} />
                <IconButton
                  icon="x"
                  size="sm"
                  variant="ghost"
                  label={multi ? t('insp.kf.deleteAll') : t('insp.kf.delete')}
                  onClick={() => deleteKeyframes(clip.id, g.items.map((it) => ({ ch: it.ch, id: it.k.id })))}
                />
              </div>
              {expanded &&
                g.items.map(({ ch, k }) => (
                  <div key={`${ch}-${k.id}`} className="insp-kf-row is-sub">
                    <span className="insp-kf-name">{kfLabel(ch)}</span>
                    <span className="insp-kf-value">{kfValueText(ch, k.value, frame)}</span>
                    <IconButton icon="x" size="sm" variant="ghost" label={t('insp.kf.deleteOne', { name: kfLabel(ch) })} onClick={() => deleteClipKeyframe(clip.id, ch, k.id)} />
                  </div>
                ))}
            </div>
          )
        })}
      </div>
    </Section>
  )
}

/** A part's name on its tab (the motion all through the clip: REF-AB, item 9). */
const partName = (part: MotionPart): string => say(part === 'idle' ? 'refi.anim.part.idle' : `insp.motion.${part}`)

/** Entrance / exit animation + idle motion for a visual clip. */
export function MotionBlock({ clip }: { clip: Clip }): JSX.Element {
  const t = useT()
  const [activePart, setActivePart] = useState<MotionPart>('in')
  const setAnim = useStore((s) => s.setClipAnim)
  const setIdle = useStore((s) => s.setClipIdle)
  const a = clip.anim
  const idle = clip.idle
  const parts: [MotionPart, string, string][] = [
    ['in', a?.in ?? 'none', animName(a?.in ?? 'none')],
    ['out', a?.out ?? 'none', animName(a?.out ?? 'none')],
    ['idle', idle?.style ?? 'none', idleName(idle?.style ?? 'none')]
  ]
  return (
    <Section id="Motion" icon="clapperboard" title={t('insp.card.anim')} data-section="motion" testid="inspector.card.motion" aside={<ResetCardButton clipId={clip.id} part="motion" title={t('insp.card.anim')} />}>
      <Segmented
        value={activePart}
        label={t('insp.motion.phase')}
        testid="inspector.clip.motion.part"
        onChange={setActivePart}
        options={parts.map(([part, value, named]) => ({
          value: part,
          // The chosen animation rides on its part, so it is read at a glance.
          label: value === 'none' ? partName(part) : `${partName(part)} · ${named}`,
          hint: t('insp.motion.part.hint', { part: partName(part), value: named })
        }))}
      />
      {/* REF-AB, item 9: the animations as pictures; the list below stays. */}
      <AnimGrid clip={clip} part={activePart} />
      {activePart === 'in' && <>
        <Field label={t('insp.motion.entrance')}>
          <Select value={a?.in ?? 'none'} testid="inspector.clip.motion.in" options={CLIP_ANIMS.map((kind) => ({ value: kind, label: animName(kind) }))} onChange={(v) => setAnim(clip.id, { in: v as ClipAnim })} />
        </Field>
        {a?.in && a.in !== 'none' && <UndoSlider label={t('insp.duration')} value={a.inDur ?? 0.5} onChange={(value) => setAnim(clip.id, { inDur: value })} min={0.1} max={3} step={0.01} fmt={(value) => fmtSec(value)} />}
      </>}
      {activePart === 'out' && <>
        <Field label={t('insp.motion.exit')}>
          <Select value={a?.out ?? 'none'} testid="inspector.clip.motion.out" options={CLIP_ANIMS.map((kind) => ({ value: kind, label: animName(kind) }))} onChange={(v) => setAnim(clip.id, { out: v as ClipAnim })} />
        </Field>
        {a?.out && a.out !== 'none' && <UndoSlider label={t('insp.duration')} value={a.outDur ?? 0.5} onChange={(value) => setAnim(clip.id, { outDur: value })} min={0.1} max={3} step={0.01} fmt={(value) => fmtSec(value)} />}
      </>}
      {activePart === 'idle' && <>
        <Field label={t('insp.motion.whileVisible')}>
          <Select value={idle?.style ?? 'none'} testid="inspector.clip.motion.idle" options={IDLE_STYLES.map((kind) => ({ value: kind, label: idleName(kind) }))} onChange={(v) => setIdle(clip.id, { style: v as IdleStyle })} />
        </Field>
        {idle && idle.style !== 'none' && <>
          <UndoSlider label={t('insp.amount')} value={idle.amount} onChange={(value) => setIdle(clip.id, { amount: value })} min={0} max={2} step={0.01} fmt={(value) => value.toFixed(2)} />
          <UndoSlider label={t('insp.speed')} value={idle.speed} onChange={(value) => setIdle(clip.id, { speed: value })} min={0.2} max={3} step={0.01} fmt={(value) => `${value.toFixed(2)}×`} />
        </>}
      </>}
    </Section>
  )
}

export function FollowTracker({ value, onChange }: { value?: string; onChange: (id: string | null) => void }): JSX.Element | null {
  const t = useT()
  const trackers = useStore((s) => s.project.trackers)
  if (!trackers || trackers.length === 0) return null
  return (
    <Tooltip content={t('insp.tracker.hint')}>
      <div>
        <Field label={t('insp.tracker')}>
          <Select value={value ?? ''} options={[{ value: '', label: t('insp.none') }, ...trackers.map((tr) => ({ value: tr.id, label: tr.name }))]} onChange={(v) => onChange(v || null)} />
        </Field>
      </div>
    </Tooltip>
  )
}
