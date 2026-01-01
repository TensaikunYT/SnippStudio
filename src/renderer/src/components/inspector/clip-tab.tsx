// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// The Inspector's Clip tab: the selected clip's place, size, look, motion
// and sound. Moved out of Inspector.tsx in SnippStudio phase 2B (no change).
import { ClipMoves } from '../ClipMoves'
import { hasCinematicMotion, hasGentlePanMotion } from '../../effects/cinematic'
import { channelKfs, clipOpacityAt, clipTransformAt } from '../../playback/render'
import { KeyDiamond } from './key-diamond'
import { togglePropKey } from './key-toggle'
import { ResetCardButton } from './card-reset-button'
import { useDisplayTime, useStore } from '../../state/store'
import type { Asset, Clip } from '../../types'
import { assetById } from '../../types'
import { Button, Chip, Icon, IconButton, ScrubField, Section, Toggle, Tooltip, useT, type IconName } from '../../ui'
import { fmtSec } from '../../ui/format'
import { ToolButton } from '../ToolButton'
import { UndoSlider, UndoSliderNum } from './sliders'
import { CameraLookPanel } from './camera-look'
import { BlendField, ColorSection, CropSection, EffectsBlock, ChromaSection, MaskSection } from './clip-look'
import { useGestureOnce } from '../undo-gesture'
import { PropRow, KeyframesSection, MotionBlock, FollowTracker } from './clip-motion'
import { CodeFilmSection, AudioSection } from './clip-audio'
import { SpeedRow } from './clip-speed'
import { TransitionSection } from './transition-section'
import { useTransitionUi } from '../timeline/transition-state'
import { ShapeSettings } from '../ShapesTab'
import { TextKeyframes } from './text-editor'
import { LiveBadge } from '../timeline/LiveBadge'

export function ClipTab(): JSX.Element {
  const t = useT()
  const clip = useStore((s) =>
    s.selectedClipIds.length > 0 ? s.project.clips[s.selectedClipIds[0]] : null
  )
  const realAsset = useStore((s) => (clip ? assetById(s.project, clip.assetId) : undefined))
  const setPropValue = useStore((s) => s.setPropValue)
  const project = useStore((s) => s.project)
  const setMotionFx = useStore((s) => s.setMotionFx)
  const removeClipMotionLayer = useStore((s) => s.removeClipMotionLayer)
  const setClipEffect = useStore((s) => s.setClipEffect)
  const rerollMotionFx = useStore((s) => s.rerollMotionFx)
  const setTransitionOut = useStore((s) => s.setTransitionOut)
  const currentTime = useDisplayTime()
  const hasTrackers = useStore((s) => (s.project.trackers?.length ?? 0) > 0)
  // A transition selected on the timeline (no clip selected): it alone.
  const transSel = useTransitionUi((u) => u.sel)
  const transClip = useStore((s) => (transSel ? s.project.clips[transSel] : undefined))
  const shape = useStore((s) => s.project.captions.find((c) => c.shape && s.selectedCaptionIds[0] === c.id))
  if (!clip && transClip?.transitionOut) return <TransitionSection clip={transClip} alone />
  // A shape selected on the timeline or in the preview (no clip selected):
  // its own settings here, as a transition's (DENEME-4, worker W: they were
  // on the left, where shapes are added: Text → Shapes and highlights).
  if (!clip && shape) return <ShapeSettings sel={shape} keyframes={(cap) => <TextKeyframes caption={cap} />} />

  // Adjustment layers have no media: only the grading half of the panel makes
  // sense, plus a mask to limit it to a region (secondary correction).
  if (clip?.adjustment) {
    return (
      <>
        <Section id="Adjustment layer" icon="layers" title={t('insp.clip.adjustment')}>
          <div className="hint">{t('insp.clip.adjustment.hint')}</div>
          <PropRow clip={clip} ch="opacity">
            <UndoSliderNum
              label={t('insp.clip.strength')}
              value={clipOpacityAt(clip, currentTime - clip.start) * 100}
              onChange={(v) => setPropValue(clip.id, 'opacity', Math.max(0, Math.min(1, v / 100)))}
              min={0}
              max={100}
              step={1}
              suffix="%"
            />
          </PropRow>
          <BlendField clip={clip} />
        </Section>
        <CameraLookPanel layer={clip.id} />
        <ColorSection clip={clip} />
        {/* Effects used to ride along inside ColorSection; now that it stands
            on its own it has to be named here too, or an adjustment layer
            would quietly lose every effect it had. */}
        <EffectsBlock clip={clip} />
        <MaskSection clip={clip} />
      </>
    )
  }

  // Compound clips have no asset of their own, but transform, keyframes,
  // effects and masks all apply to the rendered group — so they reuse the
  // normal panel via a stand-in asset describing the composited frame.
  const asset: Asset | undefined =
    realAsset ??
    (clip?.nested
      ? {
          id: '',
          kind: 'video',
          name: t('insp.clip.compound', { n: clip.nested.clips.length }),
          url: '',
          size: 0,
          duration: clip.duration,
          width: project.settings.width,
          height: project.settings.height,
          hasAudio: false
        }
      : undefined)

  if (!clip || !asset)
    return (
      <div className="insp-empty" data-testid="inspector.empty">
        <span className="insp-empty-mark" aria-hidden="true"><Icon name="mouse-pointer-2" size={18} /></span>
        <strong className="insp-empty-title">{t('insp.empty.title')}</strong>
        <span className="insp-empty-hint">{t('insp.empty.hint')}</span>
      </div>
    )

  const tf = clipTransformAt(clip, currentTime - clip.start)
  const fx = clip.motionFx
  const curOpacity = clipOpacityAt(clip, currentTime - clip.start)
  const visual = asset.kind !== 'audio'
  const keyAt = fmtSec(Math.max(0, Math.min(clip.duration, currentTime - clip.start)))

  // Arayüz v4 (UI-V4-PLAN.md §4): the clip's parts are cards in this order —
  // Transform, Audio, Speed, Opacity and blend, Color and LUT, Effects, Mask,
  // Crop, Green screen, Tracking, Animation, then the occasional ones
  // (cinematic motion, moves, keyframes, the transition). Every control of the
  // old panel is in one of them.
  return (
    <>
      <div className="insp-clip-head" data-testid="inspector.clip.head">
        <Icon name={KIND_ICON[asset.kind] ?? 'film'} size={15} />
        <span className="insp-clip-name">{asset.name}</span>
        {asset.kind === 'code' && <LiveBadge testid="inspector.clip.live" />}
        <span className="insp-clip-kind">{t(`f9y.kind.${asset.kind}`)}</span>
      </div>
      {visual && (hasCinematicMotion(fx) || hasGentlePanMotion(fx) || clip.ambientFx || clip.stillImageFx || clip.transitionOut || clip.anim?.in?.startsWith('ramp-') || clip.anim?.out?.startsWith('ramp-')) && (
        <Section id="Applied to this clip" icon="layers" title={t('insp.applied.title')}>
          <div className="insp-chips">
            {hasCinematicMotion(fx) && <Chip onRemove={() => removeClipMotionLayer(clip.id, 'cinematic')} removeLabel={t('insp.applied.cinematize.remove')}>{t('insp.applied.cinematize')}</Chip>}
            {hasGentlePanMotion(fx) && <Chip onRemove={() => removeClipMotionLayer(clip.id, 'gentle')} removeLabel={t('insp.applied.gentle.remove')}>{t('insp.applied.gentle')}</Chip>}
            {clip.ambientFx && <Chip onRemove={() => useStore.getState().undoable(() => setClipEffect(clip.id, { ambientFx: null }))} removeLabel={t('insp.applied.ambient.remove')}>{clip.ambientFx.style === 'living-frame' ? t('insp.applied.living') : t('insp.applied.ambient')}</Chip>}
            {clip.stillImageFx && <Chip onRemove={() => useStore.getState().undoable(() => setClipEffect(clip.id, { stillImageFx: null }))} removeLabel={t('insp.applied.still.remove')}>{t('insp.applied.still')}</Chip>}
            {clip.transitionOut && <Chip onRemove={() => useStore.getState().undoable(() => setTransitionOut(clip.id, null))} removeLabel={t('insp.applied.transition.remove')}>{t('insp.applied.transition')}</Chip>}
            {(clip.anim?.in?.startsWith('ramp-') || clip.anim?.out?.startsWith('ramp-')) && <Chip onRemove={() => useStore.getState().undoable(() => useStore.getState().setClipAnim(clip.id, { in: clip.anim?.in?.startsWith('ramp-') ? 'none' : clip.anim?.in, out: clip.anim?.out?.startsWith('ramp-') ? 'none' : clip.anim?.out }))} removeLabel={t('insp.applied.ramp.remove')}>{t('insp.applied.ramp')}</Chip>}
          </div>
        </Section>
      )}
      {asset.kind === 'code' && <CodeFilmSection assetId={asset.id} />}

      {visual && (
        /* "Keyframe all" is the card's diamond: animating a move is set value
           → key → move the playhead → set value → key, all within this card. */
        <Section
          id="Clip"
          icon="move"
          title={t('insp.card.transform')}
          testid="inspector.card.transform"
          aside={
            <>
              <ResetCardButton clipId={clip.id} part="transform" title={t('insp.card.transform')} />
              <Tooltip content={t('insp.clip.keyAll.hint')} heading={t('insp.clip.keyAll', { t: keyAt })}>
                <IconButton icon="diamond" size="sm" className="insp-key" tooltip={false} label={t('insp.clip.keyAll', { t: keyAt })} testid="inspector.clip.key-all" onClick={() => useStore.getState().addClipKeyframe(clip.id)} />
              </Tooltip>
            </>
          }
        >
          <PropRow clip={clip} ch="scale">
            <UndoSliderNum label={t('insp.clip.scale')} testid="inspector.clip.scale" value={tf.scale * 100} onChange={(v) => setPropValue(clip.id, 'scale', Math.max(0.02, v / 100))} min={2} max={400} step={1} suffix="%" />
          </PropRow>
          {/* The scale is one number for width and height (no separate width
              / height scale in the model): no lock to show (kullanım, item 4;
              the "locked" line said nothing you could change). */}
          {/* X/Y are shown RELATIVE TO THE CENTRE of the frame: 0, 0 is
              centred, positive is right/down (they are stored as canvas
              pixels). One row, each with its own diamond. */}
          <Tooltip content={t('insp.clip.centre.hint')}>
            <div className="hint compact-hint">{t('insp.clip.centre')}</div>
          </Tooltip>
          <PositionRow clip={clip} x={tf.x - project.settings.width / 2} y={tf.y - project.settings.height / 2} />
          <PropRow clip={clip} ch="rotation">
            <UndoSliderNum label={t('insp.clip.rotate')} testid="inspector.clip.rotate" value={(tf.rotation * 180) / Math.PI} onChange={(deg) => setPropValue(clip.id, 'rotation', (deg * Math.PI) / 180)} min={-180} max={180} step={1} suffix="°" />
          </PropRow>
          {/* Place and flip: one row of tools, their names in the tips. */}
          <div className="insp-row is-tight insp-tools" role="group" aria-label={t('insp.card.clipActions')}>
            <ToolButton icon="crosshair" label={t('insp.clip.center')} hint={t('insp.clip.center.hint')} testid="inspector.clip.center" onClick={() => useStore.getState().centerClip(clip.id)} />
            <ToolButton icon="maximize-2" label={t('insp.clip.fill')} hint={t('insp.clip.fill.hint')} testid="inspector.clip.fill" onClick={() => useStore.getState().fillFrame(clip.id)} />
            <ToolButton icon="scan" label={t('insp.clip.fit')} hint={t('insp.clip.fit.hint')} testid="inspector.clip.fit" onClick={() => useStore.getState().fitFrame(clip.id)} />
            <span className="insp-tools-gap" />
            <ToolButton icon="triangles-centerline-dashed-vertical" pressed={!!clip.flipH} label={t('insp.clip.flipH')} hint={t('insp.clip.flipH.hint')} onClick={() => useStore.getState().setClipFlip(clip.id, { h: !clip.flipH })} />
            <ToolButton icon="triangles-centerline-dashed-horizontal" pressed={!!clip.flipV} label={t('insp.clip.flipV')} hint={t('insp.clip.flipV.hint')} onClick={() => useStore.getState().setClipFlip(clip.id, { v: !clip.flipV })} />
            <ToolButton icon="rotate-cw" label={t('insp.clip.rotate90')} hint={t('insp.clip.rotate90.hint')} onClick={() => useStore.getState().rotate90(clip.id)} />
          </div>
        </Section>
      )}

      {/* Sound before the rest of the picture: volume, fades and mute are
          touched on almost every clip. */}
      {asset.hasAudio && !clip.audioExtracted && <AudioSection clipId={clip.id} />}
      {clip.audioExtracted && (
        <Section id="Audio" icon="volume-2" title={t('insp.audio.title')}>
          <div className="hint is-state">{t('insp.clip.audioExtracted')}</div>
        </Section>
      )}

      {asset.kind !== 'image' && (
        <Section id="Speed" icon="gauge" title={t('insp.card.speed')} testid="inspector.card.speed" aside={<ResetCardButton clipId={clip.id} part="speed" title={t('insp.card.speed')} />}>
          <SpeedRow clip={clip} hasSound={asset.hasAudio && !clip.audioExtracted} isVideo={asset.kind === 'video'} curveable={(asset.kind === 'video' || asset.kind === 'audio') && !clip.nested && clip.freeze === undefined && !clip.adjustment} />
          {asset.kind === 'video' && (
            <div className="insp-row is-tight insp-tools is-named" role="group" aria-label={t('insp.card.speed')}>
              <ToolButton icon="snowflake" testid="inspector.clip.freeze" label={t('insp.clip.freeze')} hint={t('insp.clip.freeze.hint')} onClick={() => useStore.getState().insertFreezeFrame(2)} />
              <ToolButton icon="arrow-left" testid="inspector.clip.reverse" pressed={!!clip.reversed} label={t('insp.clip.reverse')} hint={t('insp.clip.reverse.hint')} onClick={() => useStore.getState().toggleReverse(clip.id)} />
            </div>
          )}
        </Section>
      )}

      {visual && (
        <Section id="Opacity" icon="droplet" title={t('insp.card.opacity')} testid="inspector.card.opacity" aside={<ResetCardButton clipId={clip.id} part="opacity" title={t('insp.card.opacity')} />}>
          <PropRow clip={clip} ch="opacity">
            <UndoSliderNum label={t('insp.clip.opacity')} testid="inspector.clip.opacity" value={curOpacity * 100} onChange={(v) => setPropValue(clip.id, 'opacity', v / 100)} min={0} max={100} step={1} suffix="%" />
          </PropRow>
          <BlendField clip={clip} />
        </Section>
      )}
      {visual && <ColorSection clip={clip} />}
      {visual && <EffectsBlock clip={clip} />}
      {/* Masking sits near the picture's look: hide a thing, then move the hiding. */}
      {visual && <MaskSection clip={clip} />}
      {visual && <CropSection clip={clip} />}
      {visual && <ChromaSection clip={clip} />}
      {visual && hasTrackers && (
        <Section id="Tracker" icon="locate-fixed" title={t('insp.card.tracker')} aside={<ResetCardButton clipId={clip.id} part="tracker" title={t('insp.card.tracker')} />}>
          <FollowTracker value={clip.trackerId} onChange={(id) => useStore.getState().setClipTracker(clip.id, id)} />
        </Section>
      )}
      {visual && <MotionBlock clip={clip} />}
      {asset.kind !== 'audio' && (
        <Section id="Cinematic motion" icon="video" title={t('insp.cine.title')} aside={<ResetCardButton clipId={clip.id} part="cinematic" title={t('insp.cine.title')} />}>
          <Toggle
            label={t('insp.enabled')}
            checked={!!fx?.enabled}
            onChange={(on) => useStore.getState().undoable(() => (fx ? setMotionFx(clip.id, { enabled: on }) : setMotionFx(clip.id, { enabled: true })))}
          />
          {fx && (
            <>
              <UndoSlider label={t('insp.cine.zoomFrom')} value={fx.zoomFrom} onChange={(zoomFrom) => setMotionFx(clip.id, { zoomFrom })} min={0.8} max={1.4} step={0.005} />
              <UndoSlider label={t('insp.cine.zoomTo')} value={fx.zoomTo} onChange={(zoomTo) => setMotionFx(clip.id, { zoomTo })} min={0.8} max={1.4} step={0.005} />
              <UndoSlider label={t('insp.cine.driftX')} value={fx.panX} onChange={(panX) => setMotionFx(clip.id, { panX })} min={-300} max={300} step={1} fmt={(v) => v.toFixed(0)} />
              <UndoSlider label={t('insp.cine.driftY')} value={fx.panY} onChange={(panY) => setMotionFx(clip.id, { panY })} min={-300} max={300} step={1} fmt={(v) => v.toFixed(0)} />
              <UndoSlider label={t('insp.cine.shake')} value={fx.shakeAmp} onChange={(shakeAmp) => setMotionFx(clip.id, { shakeAmp })} min={0} max={30} step={0.5} fmt={(v) => v.toFixed(1)} />
              <UndoSlider label={t('insp.cine.shakeRot')} value={fx.shakeRotAmp} onChange={(shakeRotAmp) => setMotionFx(clip.id, { shakeRotAmp })} min={0} max={2} step={0.01} />
              <UndoSlider label={t('insp.cine.shakeSpeed')} value={fx.shakeSpeed} onChange={(shakeSpeed) => setMotionFx(clip.id, { shakeSpeed })} min={0.1} max={3} step={0.01} />
              <div className="insp-row">
                <Button size="sm" icon="rotate-cw" onClick={() => rerollMotionFx(clip.id)}>{t('insp.cine.reroll')}</Button>
                <Button size="sm" onClick={() => setMotionFx(clip.id, null)}>{t('insp.remove')}</Button>
              </div>
            </>
          )}
        </Section>
      )}
      {visual && <ClipMoves clip={clip} />}
      {visual && <KeyframesSection clip={clip} />}
      {visual && <TransitionSection clip={clip} />}
    </>
  )
}

/** The kinds' icons on the clip's head line. */
const KIND_ICON: Partial<Record<Asset['kind'], IconName>> = { video: 'video', image: 'image', audio: 'audio-lines', code: 'code' }

/** Position X and Y on one row (arayüz v4): each a field with its name as a
 *  drag handle, each with its keyframe diamond. */
function PositionRow({ clip, x, y }: { clip: Clip; x: number; y: number }): JSX.Element {
  const t = useT()
  const project = useStore((s) => s.project.settings)
  const setPropValue = useStore((s) => s.setPropValue)
  const gx = useGestureOnce()
  const gy = useGestureOnce()
  const keyed = (ch: 'x' | 'y'): boolean => (channelKfs(clip, ch)?.length ?? 0) > 0
  return (
    <div className={keyed('x') || keyed('y') ? 'insp-pos is-keyed' : 'insp-pos'} role="group" aria-label={t('insp.card.position')}>
      <span className="insp-pos-label">{t('insp.card.position')}</span>
      <div className="insp-pos-fields">
        <ScrubField short={t('insp.axis.x')} label={t('insp.clip.x')} testid="inspector.clip.x" value={x} step={1} min={-project.width} max={project.width} gesture={gx} onChange={(v) => setPropValue(clip.id, 'x', v + project.width / 2)} />
        <KeyDiamond keys={channelKfs(clip, 'x')} span={clip} label={t('insp.kf.addPropNamed', { name: t('insp.clip.x') })} testid="inspector.clip.x.key" onClick={() => togglePropKey(clip.id, 'x')} />
        <ScrubField short={t('insp.axis.y')} label={t('insp.clip.y')} testid="inspector.clip.y" value={y} step={1} min={-project.height} max={project.height} gesture={gy} onChange={(v) => setPropValue(clip.id, 'y', v + project.height / 2)} />
        <KeyDiamond keys={channelKfs(clip, 'y')} span={clip} label={t('insp.kf.addPropNamed', { name: t('insp.clip.y') })} testid="inspector.clip.y.key" onClick={() => togglePropKey(clip.id, 'y')} />
      </div>
    </div>
  )
}
