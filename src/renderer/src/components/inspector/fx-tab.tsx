// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// The effects tab (the Look tab and the dock's Effects page): cuts, motion and
// shapes for many clips, the camera look. Moved out of Inspector.tsx in
// SnippStudio phase 2B (no change).
import { useMemo, useState, type ReactNode } from 'react'
import { BareButton } from '../../ui/Button'
import type { GentlePanDirection } from '../../effects/cinematic'
import { useStore } from '../../state/store'
import type { Clip, ClipAnim, StillImageFxStyle, AmbientFxStyle } from '../../types'
import { AMBIENT_FX, STILL_IMAGE_FX, assetById } from '../../types'
import { Button, Field, Section, Segmented, Select, SubSection, Tooltip, useT, type StringKey } from '../../ui'
import { camel } from './parts'
import { ambientFxName, stillFxName } from '../../ui/data-names'
import { UndoSlider } from './sliders'
import { BeatSync } from '../BeatSync'
import { ScopesSection, CameraLookPanel } from './camera-look'
import { TransitionGrid, transitionName } from './transition-section'
import { DEFAULT_DURATION, kindOf, rampDirOf, typeOf, type TransitionType } from '../../timeline/transition-types'
import { fmtPct } from '../../ui/format'
import { cinematize, gentlePan } from '../../commands/effects'
import type { CommandEnv } from '../../commands/core'
import type { Project } from '../../types'
import { CLIP_PREVIEW_S, MOVE_LOOP_MS, PreviewCanvas, moveProject } from './transition-preview'
import './transition-preview.css'

/** The commands' own work on the preview's one clip, with a fixed seed (the
 *  same picture every time). */
const SEEDED: CommandEnv = { random: () => 0.37, now: () => new Date(0) }

/** The Effects page's moves (22 November, L13: cards, as the Transitions
 *  page's kinds), by the name the left panel's search knows them by. */
const MOVES = ['cinematize', 'pan', 'ramp'] as const
type MoveId = (typeof MOVES)[number]
const MOVE_NAME: Record<MoveId, StringKey> = { cinematize: 'refp.fx.cinematize', pan: 'insp.fxtab.pan', ramp: 'insp.fxtab.ramps' }
const across = (phase: number): number => phase * CLIP_PREVIEW_S * 2
/** How much stronger a move is drawn on its card at rest (cila3, 3). */
const STILL_GAIN = 4
// (The push is drawn twice that: a few percent of zoom is the least visible move.)

const PANS = ['left-to-right', 'right-to-left', 'bottom-to-top', 'top-to-bottom', 'alternate-horizontal', 'alternate-vertical', 'mixed'] as const
const RAMPS = ['ramp-right', 'ramp-left', 'ramp-down', 'ramp-up'] as const
const MEDIA_KINDS = ['all', 'image', 'video'] as const

/** The left panel's search, favourites and recents (REF-AB item 6,
 *  components/picks/): what is shown, a thing's bookmark, a thing used. With
 *  none given, the tab is as it was. */
export interface FxPick {
  narrowed: boolean
  shows: (id: string) => boolean
  mark: (id: string) => ReactNode
  use: (id: string) => void
  /** The Transitions page: the kinds shown, in order, and as one list. */
  only?: readonly string[]
  flat?: boolean
}

export function FxTab({ view = 'batch', pick }: { view?: 'batch' | 'transitions' | 'look'; pick?: FxPick }): JSX.Element {
  const t = useT()
  // (Searching the Effects page looks through both of its parts at once.)
  const narrowed = !!pick?.narrowed && view === 'batch'
  const shows = (id: string): boolean => !pick || pick.shows(id)
  // The left dock: cuts, motion and shapes. The right Look tab: the camera
  // look, the living frame, light and ambience — everything a picture looks
  // like, in one place.
  // (The shapes, Effects' second part, are the Text page's "Shapes and
  // highlights" since YAZI-PANELI-PLAN.md §5: Effects is the clips' motion.)
  const shown: 'cuts' | 'motion' | 'light' = view === 'look' ? 'light' : view === 'transitions' ? 'cuts' : 'motion'
  const motionShown = narrowed ? ['cinematize', 'pan', 'ramp'].some(shows) : shown === 'motion'
  const [intensity, setIntensity] = useState(1)
  const [gentlePanDirection, setGentlePanDirection] = useState<GentlePanDirection>('left-to-right')
  const [gentlePanAmount, setGentlePanAmount] = useState(2.5)
  const [stillFxStyle, setStillFxStyle] = useState<StillImageFxStyle>('light-glow')
  const [stillFxAmount, setStillFxAmount] = useState(0.55)
  const [mixDuration, setMixDuration] = useState(DEFAULT_DURATION)
  const [transitionPreset, setTransitionPreset] = useState<TransitionType>('mix')
  const [ambientStyle, setAmbientStyle] = useState<AmbientFxStyle>('living-frame')
  const [ambientAmount, setAmbientAmount] = useState(0.6)
  const [ambientMediaKind, setAmbientMediaKind] = useState<'all' | 'image' | 'video'>('all')
  const [rampDirection, setRampDirection] = useState<Extract<ClipAnim, `ramp-${string}`>>('ramp-right')
  const [rampAnimDuration, setRampAnimDuration] = useState(0.45)
  const [fxTrack, setFxTrack] = useState('') // '' = all tracks
  // The moves' pictures (DENEME-2): the command's result on a sample clip.
  const cinePic = useMemo(() => moveProject((_c, p) => cinematize.apply(p, { intensity }, SEEDED)), [intensity])
  const panPic = useMemo(() => moveProject((_c, p) => gentlePan.apply(p, { direction: gentlePanDirection, amount: gentlePanAmount }, SEEDED)), [gentlePanDirection, gentlePanAmount])
  // The still of each card (cila3, 3): the same move, made stronger so it
  // reads on a card a hand wide (the real move is a few percent of the
  // frame: on 110 px, two or three pixels). Pointed at, the card plays the
  // move as it will be applied.
  const cineStill = useMemo(() => moveProject((_c, p) => cinematize.apply(p, { intensity: STILL_GAIN * 2 }, SEEDED)), [])
  const panStill = useMemo(() => moveProject((_c, p) => gentlePan.apply(p, { direction: gentlePanDirection, amount: Math.min(50, Math.max(gentlePanAmount * STILL_GAIN, 10)) }, SEEDED)), [gentlePanDirection, gentlePanAmount])
  const rampPic = useMemo(() => moveProject((c) => { c.anim = { in: rampDirection, out: rampDirection, inDur: rampAnimDuration, outDur: rampAnimDuration } }), [rampDirection, rampAnimDuration])
  // The ramp: its entrance in the first half of the loop, its exit in the second.
  const rampAt = (phase: number): number => (phase < 0.5 ? (phase / 0.5) * (rampAnimDuration + 0.3) : CLIP_PREVIEW_S * 2 - rampAnimDuration - 0.3 + ((phase - 0.5) / 0.5) * (rampAnimDuration + 0.3))
  // The chosen move (its settings and button show under the cards); with the
  // search narrowing the cards, the first one still shown.
  const [picked, setMove] = useState<MoveId>('cinematize')
  const move: MoveId = shows(picked) ? picked : MOVES.find((id) => shows(id)) ?? picked
  const [hot, setHot] = useState<MoveId | null>(null)
  const movePic: Record<MoveId, Project> = { cinematize: cinePic, pan: panPic, ramp: rampPic }
  const moveAt: Record<MoveId, (phase: number) => number> = { cinematize: across, pan: across, ramp: rampAt }
  // At rest (cila3, 3): a moment from the middle of each move, with the
  // moments before it faint over it, so the three cards differ before they
  // are pointed at: the push grows, the pan travels, the ramp slides in.
  const moveStill: Record<MoveId, Project> = { cinematize: cineStill, pan: panStill, ramp: rampPic }
  // (The ramp, cila4: most of the way in, the picture sharp and a strip of
  // the card still dark, its light's trail drawn lightening only: it was a
  // dark blur, the ramp's middle and its dark moments over it.)
  const moveRest: Record<MoveId, number> = { cinematize: across(0.5), pan: across(0.5), ramp: rampAnimDuration * 0.62 }
  const moveGhosts: Record<MoveId, number[]> = {
    cinematize: [0, 0.97].map(across),
    pan: [0, 0.25].map(across),
    ramp: [0.47, 0.55].map((k) => rampAnimDuration * k)
  }
  const project = useStore((s) => s.project)
  const videoTracks = project.tracks.filter((tr) => tr.kind === 'video')
  const cinematizeAll = useStore((s) => s.cinematizeAll)
  const applyGentlePan = useStore((s) => s.applyGentlePan)
  const applyStillImageFx = useStore((s) => s.applyStillImageFx)
  const clearStillImageFx = useStore((s) => s.clearStillImageFx)
  const applyAmbientFx = useStore((s) => s.applyAmbientFx)
  const clearAmbientFx = useStore((s) => s.clearAmbientFx)
  const clearAllMotionFx = useStore((s) => s.clearAllMotionFx)
  const applyTransitionPreset = useStore((s) => s.applyTransitionPreset)
  const applyRampInOut = useStore((s) => s.applyRampInOut)
  const clearTransitions = useStore((s) => s.clearTransitions)
  const allVisualClips = Object.values(project.clips).filter((clip) => {
    if (!videoTracks.some((track) => track.id === clip.trackId)) return false
    const kind = assetById(project, clip.assetId)?.kind
    return kind === 'image' || kind === 'video'
  })
  const scopedVisualClips = allVisualClips.filter((clip) => !fxTrack || clip.trackId === fxTrack)
  const livingCount = allVisualClips.filter((clip) => clip.ambientFx?.style === 'living-frame').length
  const clipCount = scopedVisualClips.length
  const transitionCount = Object.values(project.clips).filter((clip) => clip.transitionOut).length
  const scopedStillClips = Object.values(project.clips).filter((clip) => {
    if (fxTrack && clip.trackId !== fxTrack) return false
    return assetById(project, clip.assetId)?.kind === 'image'
  })
  const ambientTargets = scopedVisualClips.filter((clip) => ambientMediaKind === 'all' || assetById(project, clip.assetId)?.kind === ambientMediaKind)
  // Where the Look tab's effects go: the selected clips, or every clip.
  const selectedIds = useStore((s) => s.selectedClipIds)
  const selVisual = selectedIds.filter((id) => allVisualClips.some((c) => c.id === id))
  const [scope, setScope] = useState<'selected' | 'all'>('selected')
  const only = scope === 'selected' && selVisual.length ? selVisual : undefined
  const inScope = (list: Clip[]): Clip[] => (only ? list.filter((c) => only.includes(c.id)) : list)
  const livingIn = inScope(allVisualClips)
  const stillIn = inScope(scopedStillClips)
  const ambientIn = inScope(ambientTargets)

  const livingOn = livingIn.filter((c) => c.ambientFx?.style === 'living-frame').length
  const trackOptions = [{ value: '', label: t('insp.fxtab.allTracks') }, ...videoTracks.map((tr) => ({ value: tr.id, label: tr.name }))]

  return (
    <>
      {(view === 'batch' || view === 'transitions' || view === 'look') && <>
      {view === 'look' && (
        <Field label={t('insp.fxtab.applyTo')}>
          <Segmented
            value={only ? 'selected' : 'all'}
            label={t('insp.fxtab.applyTo')}
            options={[
              { value: 'selected', label: t('insp.fxtab.selected', { n: selVisual.length }), disabled: selVisual.length === 0, hint: selVisual.length ? t('insp.fxtab.selected.hint') : t('insp.fxtab.selected.none') },
              { value: 'all', label: t('insp.fxtab.everyClip') }
            ]}
            onChange={setScope}
          />
        </Field>
      )}
      {view === 'look' && <CameraLookPanel only={only} />}
      {view === 'look' && <>
      <div className="insp-note">
        <strong>{t('insp.fxtab.living')}</strong>
        <div>{t('insp.fxtab.living.hint', { on: livingOn, n: livingIn.length })}</div>
        <div className="insp-row">
          <Tooltip content={only ? t('insp.fxtab.living.applySel') : t('insp.fxtab.living.applyAll')}>
            <Button size="sm" disabled={livingIn.length === 0} onClick={() => applyAmbientFx('living-frame', 0.6, undefined, undefined, only)}>
              {t(!only && livingCount === allVisualClips.length && livingCount > 0 ? 'insp.fxtab.reapplyN' : 'insp.fxtab.applyN', { n: livingIn.length })}
            </Button>
          </Tooltip>
          <Tooltip content={t('insp.fxtab.living.remove')}>
            <Button size="sm" disabled={livingOn === 0} onClick={() => clearAmbientFx(undefined, undefined, 'living-frame', only)}>
              {t('insp.fxtab.removeN', { n: livingOn })}
            </Button>
          </Tooltip>
        </div>
      </div>
      </>}
      {shown === 'cuts' && <>
      <Section id="Transitions" icon="blend" title={t('insp.fxtab.transitions')}>
        {/* The kinds of the one table (core polish T): drag one onto a cut,
            or pick one for every cut below. */}
        <div className="hint">{t('ct.dock.hint')}</div>
        <TransitionGrid
          value={kindOf(transitionPreset).id}
          draggable
          testid="effects.trans.kind"
          only={pick?.only}
          flat={pick?.flat}
          mark={pick ? (k) => pick.mark(k) : undefined}
          onDragUse={(k) => pick?.use(k)}
          onPick={(k) => {
            setTransitionPreset(typeOf(k, rampDirOf(transitionPreset)))
            pick?.use(k)
          }}
        />
        <Field label={t('insp.fxtab.track')}>
          <Select value={fxTrack} options={trackOptions} onChange={setFxTrack} />
        </Field>
        <UndoSlider label={t('insp.trans.duration')} value={mixDuration} onChange={setMixDuration} min={0.2} max={2} step={0.01} />
        <div className="insp-row">
          <Tooltip content={t('ct.dock.apply.hint')}>
            <Button size="sm" icon="wand-sparkles" testid="effects.trans.apply" disabled={clipCount < 2} onClick={() => {
              applyTransitionPreset(transitionPreset, Math.max(kindOf(transitionPreset).minDuration ?? 0, mixDuration), fxTrack || undefined)
              pick?.use(kindOf(transitionPreset).id)
            }}>{t('ct.dock.apply', { name: transitionName(t, transitionPreset) })}</Button>
          </Tooltip>
        </div>
        <div className="insp-row">
          <Tooltip content={t('insp.fxtab.clearCuts.hint')}>
            <Button size="sm" disabled={transitionCount === 0} onClick={clearTransitions}>{t('insp.fxtab.clearCuts', { n: transitionCount })}</Button>
          </Tooltip>
        </div>
      </Section>
      </>}
      {/* Arayüz v4: the Transitions page opens on its kinds; beat sync under them. */}
      {shown === 'cuts' && <BeatSync />}

      {(motionShown || shown === 'light') && <Section id={shown !== 'light' ? 'Clip motion' : 'Light & ambience'} icon={shown !== 'light' ? 'video' : 'sun'} title={shown !== 'light' ? t('insp.fxtab.clipMotion') : t('insp.fxtab.light')}>
        {/* 22 November, L13: the moves are cards, in the Transitions page's
            language: the picture is the card (what the move does, drawn by the
            renderer from the command's own result; it plays when pointed at),
            its name under it, the chosen one in the selection's gold. The
            chosen move's settings and its one button follow. It was a form
            with a small picture beside each button. */}
        {motionShown && <>
        <div className="hint">{t('d22d.fx.hint')}</div>
        <div className="ct-grid" role="radiogroup" aria-label={t('insp.fxtab.clipMotion')} data-testid="effects.moves">
          <div className="ct-tiles">
            {MOVES.filter(shows).map((id) => {
              const tile = (
                <BareButton
                  key={id}
                  type="button"
                  role="radio"
                  aria-checked={move === id}
                  className={`ct-tile${move === id ? ' is-on' : ''}`}
                  data-testid={`effects.demo.${id}`}
                  onClick={() => setMove(id)}
                  onPointerEnter={() => setHot(id)}
                  onPointerLeave={() => setHot((h) => (h === id ? null : h))}
                  onFocus={() => setHot(id)}
                  onBlur={() => setHot((h) => (h === id ? null : h))}
                >
                  <PreviewCanvas project={movePic[id]} still={moveStill[id]} rest={moveRest[id]} ghosts={moveGhosts[id]} light={id === 'ramp'} at={moveAt[id]} loopMs={MOVE_LOOP_MS} playing={hot === id} />
                  <span className="ct-tile-name">{t(MOVE_NAME[id])}</span>
                </BareButton>
              )
              return pick ? <div className="pick-card" key={id}>{tile}{pick.mark(id)}</div> : tile
            })}
          </div>
        </div>
        </>}
        <Tooltip content={t('insp.fxtab.scope.hint')}>
          <div>
            <Field label={t('insp.fxtab.applyTo')}>
              <Select value={fxTrack} options={[{ value: '', label: t('insp.fxtab.allTracks') }, ...videoTracks.map((tr) => ({ value: tr.id, label: t('insp.fxtab.trackOnly', { name: tr.name }) }))]} onChange={setFxTrack} />
            </Field>
          </div>
        </Tooltip>
        {motionShown && move === 'cinematize' && <>
        <UndoSlider label={t('insp.fxtab.intensity')} testid="effects.move.intensity" value={intensity} onChange={setIntensity} min={0.2} max={2.5} step={0.01} />
        <div className="insp-row">
          <Button size="sm" icon="sparkles" testid="effects.move.apply" disabled={clipCount === 0} onClick={() => {
            cinematizeAll(intensity, fxTrack || undefined)
            pick?.use('cinematize')
          }}>
            {fxTrack ? t('insp.fxtab.cinematizeTrack', { name: videoTracks.find((tr) => tr.id === fxTrack)?.name ?? '' }) : t(clipCount === 1 ? 'insp.fxtab.cinematizeOne' : 'insp.fxtab.cinematizeN', { n: clipCount })}
          </Button>
        </div>
        </>}
        {motionShown && move === 'pan' && <>
        <Tooltip content={t('insp.fxtab.pan.hint')}>
          <div>
            <Field label={t('insp.fxtab.direction')}>
              <Select value={gentlePanDirection} options={PANS.map((v) => ({ value: v, label: t(`insp.fxtab.pan.${camel(v)}` as StringKey) }))} onChange={(v) => setGentlePanDirection(v as GentlePanDirection)} />
            </Field>
          </div>
        </Tooltip>
        <UndoSlider
          label={t('insp.fxtab.panAmount')}
          value={gentlePanAmount}
          onChange={setGentlePanAmount}
          min={0.5}
          max={8}
          step={0.25}
          fmt={(value) => value.toFixed(2)}
        />
        <div className="insp-row">
          <Button size="sm" icon="arrow-left-right" testid="effects.move.apply" disabled={clipCount === 0} onClick={() => {
            applyGentlePan(gentlePanDirection, gentlePanAmount, fxTrack || undefined)
            pick?.use('pan')
          }}>{t('insp.fxtab.applyPan')}</Button>
        </div>
        </>}
        {shown === 'light' && <>
        <SubSection id="Still image light effects" title={t('insp.fxtab.stillLight')} open>
          <Field label={t('insp.fxtab.effect')}>
            <Select value={stillFxStyle} options={STILL_IMAGE_FX.map(([id]) => ({ value: id, label: stillFxName(id) }))} onChange={(v) => setStillFxStyle(v as StillImageFxStyle)} />
          </Field>
          <UndoSlider
            label={t('insp.fxtab.effectAmount')}
            value={stillFxAmount}
            onChange={setStillFxAmount}
            min={0.1}
            max={1}
            step={0.01}
            fmt={(value) => fmtPct(value)}
          />
          <div className="insp-row">
            <Button size="sm" icon="wand-sparkles" disabled={stillIn.length === 0} onClick={() => applyStillImageFx(stillFxStyle, stillFxAmount, fxTrack || undefined, only)}>
              {t(stillIn.length === 1 ? 'insp.fxtab.applyStill' : 'insp.fxtab.applyStills', { n: stillIn.length })}
            </Button>
            <Tooltip content={t('insp.fxtab.removeStill.hint')}>
              <Button size="sm" className="insp-fixed" disabled={stillIn.every((c) => !c.stillImageFx)} onClick={() => clearStillImageFx(fxTrack || undefined, only)}>
                {t('insp.fxtab.removeN', { n: stillIn.filter((c) => !!c.stillImageFx).length })}
              </Button>
            </Tooltip>
          </div>
        </SubSection>
        <SubSection id="Ambient frame · stills and video" title={t('insp.fxtab.ambient')} open>
          <Field label={t('insp.fxtab.useOn')}>
            <Select value={ambientMediaKind} options={MEDIA_KINDS.map((v) => ({ value: v, label: t(`insp.fxtab.useOn.${v}`) }))} onChange={(v) => setAmbientMediaKind(v as 'all' | 'image' | 'video')} />
          </Field>
          <Field label={t('insp.fxtab.treatment')}>
            <Select value={ambientStyle} options={AMBIENT_FX.map(([id]) => ({ value: id, label: ambientFxName(id) }))} onChange={(v) => setAmbientStyle(v as AmbientFxStyle)} />
          </Field>
          <UndoSlider label={t('insp.amount')} value={ambientAmount} onChange={setAmbientAmount}
            min={0.05} max={1} step={0.01} fmt={(value) => fmtPct(value)} />
          <div className="insp-row">
            <Button size="sm" disabled={ambientIn.length === 0}
              onClick={() => applyAmbientFx(ambientStyle, ambientAmount, fxTrack || undefined, ambientMediaKind === 'all' ? undefined : ambientMediaKind, only)}>
              {t(ambientIn.length === 1 ? 'insp.fxtab.applyClip' : 'insp.fxtab.applyClips', { n: ambientIn.length })}
            </Button>
            <Button size="sm" className="insp-fixed" disabled={ambientIn.every((c) => !c.ambientFx)} onClick={() => clearAmbientFx(fxTrack || undefined, ambientMediaKind === 'all' ? undefined : ambientMediaKind, undefined, only)}>
              {t('insp.fxtab.removeN', { n: ambientIn.filter((c) => !!c.ambientFx).length })}
            </Button>
          </div>
        </SubSection>
        </>}
        {motionShown && move === 'ramp' && <>
        <Field label={t('insp.fxtab.direction')}>
          <Select value={rampDirection} options={RAMPS.map((v) => ({ value: v, label: t(`insp.dir.${v.replace('ramp-', '') as 'right' | 'left' | 'up' | 'down'}`) }))} onChange={(v) => setRampDirection(v as Extract<ClipAnim, `ramp-${string}`>)} />
        </Field>
        <UndoSlider label={t('insp.fxtab.rampDuration')} value={rampAnimDuration} onChange={setRampAnimDuration}
          min={0.15} max={1.5} step={0.01} fmt={(value) => `${value.toFixed(2)}s`} />
        <div className="insp-row">
          <Button size="sm" icon="wand-sparkles" testid="effects.move.apply" disabled={clipCount === 0} onClick={() => {
            applyRampInOut(rampDirection, rampAnimDuration, fxTrack || undefined)
            pick?.use('ramp')
          }}>
            {t('insp.fxtab.applyClips', { n: clipCount })}
          </Button>
        </div>
        </>}
        {motionShown && !narrowed && (
        <div className="insp-row">
          <Button size="sm" variant="ghost" testid="effects.move.remove" onClick={clearAllMotionFx}>{t('insp.fxtab.removeMotion')}</Button>
        </div>
        )}
      </Section>}
      {/* Last: a grading instrument you reach for occasionally, not a control. */}
      {shown === 'light' && <ScopesSection />}
      </>}
    </>
  )
}
