// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// The Clip tab's picture sections: colour, effects, chroma key, mask, crop.
// Moved out of Inspector.tsx in SnippStudio phase 2B; onto the building blocks
// in phase 3c.3 (no change of behaviour).
import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react'
import { requestShell } from '../app/requests'
import { addLut, ensureProjectLuts } from '../../luts'
import { LUT_PRESETS, PRESET_PREFIX, localLutNames, lutEpoch, lutFor, lutKind, lutMissing, onLutChange, setLutHover } from '../../playback/draw/lut-table'
import type { LutPreset } from '../../playback/draw/lut-table'
import { fxAmountAt, fxBase } from '../../playback/pose'
import { bumpFramesVersion } from '../../playback/scrub'
import { useDisplayTime, useStore } from '../../state/store'
import type { BlendMode, Clip, FxKey, VideoFxStyle, StillImageFxStyle, AmbientFxStyle } from '../../types'
import { AMBIENT_FX, BLEND_MODES, STILL_IMAGE_FX, VIDEO_FX, assetById, maskStrength, neutralTone } from '../../types'
import { Button, Field, IconButton, Section, Select, SubSection, Toggle, Tooltip, notify, useT } from '../../ui'
import { KeyDiamond } from './key-diamond'
import { ResetCardButton } from './card-reset-button'
import { fmtNum, fmtPct } from '../../ui/format'
import { ambientFxName, blendName, stillFxName, videoFxName } from '../../ui/data-names'
import type { SelectOption } from '../../ui/fields'
import type { StringKey } from '../../ui/strings'
import { ColourField, Switch } from './parts'
import { UndoSlider, UndoSliderNum } from './sliders'
import { BareButton } from '../../ui/Button'
import { theFrames } from './transition-preview'

export const LOOKS: Record<string, { brightness: number; contrast: number; saturation: number; warmth: number }> = {
  Warm: { brightness: 1.02, contrast: 1.05, saturation: 1.08, warmth: 0.45 },
  Cool: { brightness: 1.0, contrast: 1.04, saturation: 1.05, warmth: -0.5 },
  Punchy: { brightness: 1.03, contrast: 1.18, saturation: 1.25, warmth: 0.08 },
  Faded: { brightness: 1.06, contrast: 0.88, saturation: 0.82, warmth: 0.12 }
}

/** The tables the LUT list is made of change outside the store (a file read,
 *  a look made): the section follows them. */
const useLutTables = (): number => useSyncExternalStore(onLutChange, lutEpoch)

/** The picture the looks are shown on: the clip's own thumbnail, small; a
 *  swatch of hues and skin tones when it has none. */
const TILE_W = 128
const TILE_H = 72
function tileBase(thumb: string | undefined, done: (px: ImageData) => void): () => void {
  const cv = document.createElement('canvas')
  cv.width = TILE_W
  cv.height = TILE_H
  const g = cv.getContext('2d', { willReadFrequently: true })
  if (!g) return () => {}
  // No picture of the clip's own: a sample to show a look on (DENEME-2,
  // item 6): the transitions' two frames side by side (a cool night, a warm
  // dusk) over a strip of hues and skin tones, so a look's shift shows in
  // shadows, skin and colour at once, and calm enough to sit in the panel.
  const swatch = (): void => {
    const { a, b } = theFrames()
    const top = Math.round(TILE_H * 0.72)
    g.drawImage(a, 0, 0, a.width / 2, a.height, 0, 0, TILE_W / 2, top)
    g.drawImage(b, b.width / 2, 0, b.width / 2, b.height, TILE_W / 2, 0, TILE_W / 2, top)
    const hue = g.createLinearGradient(0, 0, TILE_W, 0)
    ;['#b5574c', '#c49a52', '#bdb663', '#6c9a66', '#5a8fa8', '#5f6aa8', '#8a64a0'].forEach((c, i, all) => hue.addColorStop(i / (all.length - 1), c))
    g.fillStyle = hue
    g.fillRect(0, top, TILE_W / 2, TILE_H - top)
    const tone = g.createLinearGradient(TILE_W / 2, 0, TILE_W, 0)
    tone.addColorStop(0, '#5a3d2e')
    tone.addColorStop(0.5, '#c79a7c')
    tone.addColorStop(1, '#efe2d4')
    g.fillStyle = tone
    g.fillRect(TILE_W / 2, top, TILE_W / 2, TILE_H - top)
    done(g.getImageData(0, 0, TILE_W, TILE_H))
  }
  if (!thumb) {
    swatch()
    return () => {}
  }
  let live = true
  const img = new Image()
  img.onload = () => {
    if (!live) return
    // Covered, not stretched.
    const k = Math.max(TILE_W / img.naturalWidth, TILE_H / img.naturalHeight)
    g.drawImage(img, (TILE_W - img.naturalWidth * k) / 2, (TILE_H - img.naturalHeight * k) / 2, img.naturalWidth * k, img.naturalHeight * k)
    try {
      done(g.getImageData(0, 0, TILE_W, TILE_H))
    } catch {
      swatch()
    }
  }
  img.onerror = () => live && swatch()
  img.src = thumb
  return () => {
    live = false
  }
}

/** One look, on the small picture: the look's own function on each of its
 *  9 216 pixels (its table, 36 000 colours, is not needed for that and is
 *  made when the look is pointed at or used). */
function LookTile({ base, lutKey, look, label, picked, disabled, onPick, onPoint }: { base: ImageData | null; lutKey: string | null; look?: LutPreset['look']; label: string; picked: boolean; disabled?: boolean; onPick: () => void; onPoint: (on: boolean) => void }): JSX.Element {
  const ref = useRef<HTMLCanvasElement>(null)
  const pointed = useRef(false)
  useEffect(() => {
    const g = ref.current?.getContext('2d')
    if (!g || !base) return
    const out = new ImageData(new Uint8ClampedArray(base.data), base.width, base.height)
    if (look) {
      const d = out.data
      for (let i = 0; i < d.length; i += 4) {
        const c = look([d[i] / 255, d[i + 1] / 255, d[i + 2] / 255])
        d[i] = c[0] * 255
        d[i + 1] = c[1] * 255
        d[i + 2] = c[2] * 255
      }
    }
    g.putImageData(out, 0, 0)
  }, [base, look])
  return (
    <BareButton
      type="button"
      className={picked ? 'insp-look-tile is-picked' : 'insp-look-tile'}
      aria-pressed={picked}
      disabled={disabled}
      data-testid={`inspector.color.look.${lutKey ? lutKey.slice(PRESET_PREFIX.length) : 'none'}`}
      onClick={onPick}
      // Shown when the pointer MOVES onto the tile, not when the tile passes
      // under a still pointer: scrolling the Inspector (or the Filters page)
      // with the wheel slid every tile under the pointer, and each one made
      // the preview draw its look and draw again without it (DENEME-2, item
      // 7: "sağdaki panel kaydırırken clunky"). A move is a real pointer
      // event; a tile passing under it is only an enter / leave.
      onPointerMove={() => {
        if (pointed.current) return
        pointed.current = true
        onPoint(true)
      }}
      onPointerLeave={() => {
        if (!pointed.current) return
        pointed.current = false
        onPoint(false)
      }}
      onFocus={() => onPoint(true)}
      onBlur={() => onPoint(false)}
    >
      <canvas ref={ref} width={TILE_W} height={TILE_H} aria-hidden />
      <span className="insp-look-name">{label}</span>
    </BareButton>
  )
}

/** The built-in looks as small pictures: pointing at one shows it in the
 *  preview (nothing is changed), a click makes it the clip's LUT. With no
 *  clip (the left panel's Filters page, nothing selected) they are shown on
 *  a strip of hues and skin tones, to look at only (DENEME-2, item 6). */
/** `only`, `mark`, `onUse` (the left panel's Filters page: search,
 *  favourites, recents; REF-AB item 6): the looks shown in that order ('none'
 *  or a preset's id), a look's bookmark, a look given to the clip. */
export function LookTiles({ clip, only, mark, onUse }: { clip?: Clip; only?: readonly string[]; mark?: (id: string) => ReactNode; onUse?: (id: string) => void }): JSX.Element {
  const t = useT()
  const setClipLut = useStore((s) => s.setClipLut)
  const thumb = useStore((s) => (clip ? assetById(s.project, clip.assetId)?.thumbnail : undefined))
  const [base, setBase] = useState<ImageData | null>(null)
  useEffect(() => tileBase(thumb, setBase), [thumb])
  // The preview goes back to the project when the pointer leaves or the
  // section goes away.
  const point = (lut: string | null, on: boolean): void => {
    if (!clip) return
    setLutHover(on ? { clipId: clip.id, lut } : null)
    bumpFramesVersion()
  }
  useEffect(() => () => point(null, false), [clip?.id])
  // The looks' tables are made one at a time while nothing else is going on,
  // so that the first one pointed at does not wait for its 36 000 colours.
  useEffect(() => {
    let live = true
    let i = 0
    const idle = (fn: () => void): void => void (typeof requestIdleCallback === 'function' ? requestIdleCallback(fn, { timeout: 2000 }) : setTimeout(fn, 200))
    const next = (): void => {
      if (!live || i >= LUT_PRESETS.length) return
      lutFor(PRESET_PREFIX + LUT_PRESETS[i++].id)
      idle(next)
    }
    idle(next)
    return () => {
      live = false
    }
  }, [])
  const pick = (lut: string | null): void => {
    if (!clip) return
    point(null, false)
    setClipLut(clip.id, lut)
    onUse?.(lut ? lut.slice(PRESET_PREFIX.length) : 'none')
  }
  const tiles: { id: string; el: JSX.Element }[] = [
    { id: 'none', el: <LookTile key="none" base={base} lutKey={null} label={t('insp.lut.none')} picked={!!clip && !clip.lut} disabled={!clip} onPick={() => pick(null)} onPoint={(on) => point(null, on)} /> },
    ...LUT_PRESETS.map((p) => {
      const key = PRESET_PREFIX + p.id
      return { id: p.id, el: <LookTile key={p.id} base={base} lutKey={key} look={p.look} label={t(`insp.lut.preset.${p.id}` as StringKey)} picked={clip?.lut === key} disabled={!clip} onPick={() => pick(key)} onPoint={(on) => point(key, on)} /> }
    })
  ]
  const listed = only ? only.map((id) => tiles.find((x) => x.id === id)).filter((x): x is (typeof tiles)[number] => !!x) : tiles
  return (
    <Tooltip content={t('insp.lut.looks.hint')}>
      <div className="insp-looks" role="group" aria-label={t('insp.lut.looks')} data-testid="inspector.color.looks">
        {listed.map((x) => (mark ? <div className="pick-card" key={x.id}>{x.el}{mark(x.id)}</div> : x.el))}
      </div>
    </Tooltip>
  )
}

export function ColorSection({ clip }: { clip: Clip }): JSX.Element {
  const t = useT()
  const setClipGrade = useStore((s) => s.setClipGrade)
  const setClipLut = useStore((s) => s.setClipLut)
  const setClipTone = useStore((s) => s.setClipTone)
  const projectLuts = useStore((s) => s.project.luts)
  useLutTables()
  const lutFileRef = useRef<HTMLInputElement>(null)
  const g = clip.grade ?? { brightness: 1, contrast: 1, saturation: 1, warmth: 0 }
  const tone = clip.tone ?? neutralTone()
  const missing = lutMissing(clip.lut)
  const kind = clip.lut ? lutKind(clip.lut) : null
  const lutOptions: SelectOption[] = [
    { value: '', label: t('insp.none') },
    ...LUT_PRESETS.map((p) => ({ value: PRESET_PREFIX + p.id, label: t(`insp.lut.preset.${p.id}` as StringKey), group: t('insp.lut.group.looks') })),
    ...(projectLuts ?? []).map((l) => ({ value: l.name, label: lutMissing(l.name) ? t('insp.lut.missingOption', { name: l.name }) : l.name, group: t('insp.lut.group.project') })),
    ...localLutNames().filter((n) => !(projectLuts ?? []).some((l) => l.name === n)).map((n) => ({ value: n, label: n, group: t('insp.lut.group.local') }))
  ]
  // A name nothing here knows (a LUT kept on another computer): still listed,
  // so the field says what the clip asks for.
  if (clip.lut && !lutOptions.some((o) => o.value === clip.lut)) lutOptions.push({ value: clip.lut, label: t('insp.lut.missingOption', { name: clip.lut }) })
  return (
    <Section id="Color" icon="palette" title={t('insp.color.title')} aside={<ResetCardButton clipId={clip.id} part="color" title={t('insp.color.title')} />}>
      <div className="insp-with-button">
        <Field label={t('insp.color.lut')}>
          <Select value={clip.lut ?? ''} options={lutOptions} testid="inspector.color.lut" onChange={(v) => setClipLut(clip.id, v || null)} />
        </Field>
        <IconButton icon="plus" size="sm" label={t('insp.color.lutImport')} testid="inspector.color.lutImport" onClick={() => lutFileRef.current?.click()} />
        <input
          ref={lutFileRef}
          type="file"
          accept=".cube"
          hidden
          data-testid="inspector.color.lutFile"
          onChange={(e) => {
            const f = e.target.files?.[0]
            e.target.value = ''
            if (!f) return
            // The file becomes one of the project's LUTs and this clip's, in
            // one undo step (luts.ts).
            addLut(f, clip.id).catch((err) => notify({ text: t('insp.color.lutFailed', { error: err instanceof Error ? err.message : String(err) }), kind: 'error' }))
          }}
        />
      </div>
      {clip.lut && missing && (
        <div className="hint is-warning" data-testid="inspector.color.lutMissing">
          {t(kind === 'project' ? 'insp.lut.missing' : 'insp.lut.missingLocal', { name: clip.lut })}
          <div className="insp-row">
            <Button size="sm" onClick={() => lutFileRef.current?.click()}>{t('insp.lut.find')}</Button>
            {kind === 'project' && <Button size="sm" testid="inspector.color.lutRetry" onClick={() => void ensureProjectLuts()}>{t('insp.lut.retry')}</Button>}
          </div>
        </div>
      )}
      {clip.lut && !missing && kind === 'local' && <div className="hint">{t('insp.lut.localOnly')}</div>}
      {clip.lut && (
        <UndoSlider label={t('insp.lut.amount')} testid="inspector.color.lutAmount" value={clip.lutAmount ?? 1} onChange={(v) => useStore.getState().setClipLutAmount(clip.id, v)} min={0} max={1} step={0.01} fmt={pct} />
      )}
      {/* The looks' tiles are browsed and taken in the left panel's Filters
          (DENEME-4, worker W: they were here too); the look this clip has is
          the list above, its strength the slider. */}
      <div className="insp-row">
        <Button size="sm" variant="ghost" icon="swatch-book" testid="inspector.color.browse" onClick={() => requestShell('dock:filters')}>{t('w4.color.browse')}</Button>
      </div>
      <Field label={t('insp.color.look')}>
        <Select
          value=""
          options={[{ value: '', label: t('insp.color.lookPick') }, ...Object.keys(LOOKS).map((k) => ({ value: k, label: k }))]}
          onChange={(v) => {
            const look = LOOKS[v]
            if (look) setClipGrade(clip.id, look)
          }}
        />
      </Field>
      <UndoSlider label={t('insp.color.brightness')} testid="inspector.color.brightness" value={g.brightness} onChange={(brightness) => setClipGrade(clip.id, { brightness })} min={0.5} max={1.5} step={0.01} />
      <UndoSlider label={t('insp.color.contrast')} value={g.contrast} onChange={(contrast) => setClipGrade(clip.id, { contrast })} min={0.5} max={1.5} step={0.01} />
      <UndoSlider label={t('insp.color.saturation')} value={g.saturation} onChange={(saturation) => setClipGrade(clip.id, { saturation })} min={0} max={2} step={0.01} />
      <UndoSlider label={t('insp.color.warmth')} value={g.warmth} onChange={(warmth) => setClipGrade(clip.id, { warmth })} min={-1} max={1} step={0.01} />
      {/* "cila" part D: worked in the pixel pass, before the LUT. 0 leaves the picture as it is. */}
      <UndoSlider label={t('insp.tone.exposure')} testid="inspector.color.exposure" value={tone.exposure} onChange={(exposure) => setClipTone(clip.id, { exposure })} min={-2} max={2} step={0.01} />
      <UndoSlider label={t('insp.tone.tint')} testid="inspector.color.tint" value={tone.tint} onChange={(tint) => setClipTone(clip.id, { tint })} min={-1} max={1} step={0.01} fmt={pct} />
      <UndoSlider label={t('insp.tone.highlights')} testid="inspector.color.highlights" value={tone.highlights} onChange={(highlights) => setClipTone(clip.id, { highlights })} min={-1} max={1} step={0.01} fmt={pct} />
      <UndoSlider label={t('insp.tone.shadows')} testid="inspector.color.shadows" value={tone.shadows} onChange={(shadows) => setClipTone(clip.id, { shadows })} min={-1} max={1} step={0.01} fmt={pct} />
      <UndoSlider label={t('insp.color.blur')} testid="inspector.color.blur" value={clip.blur ?? 0} onChange={(v) => useStore.getState().setClipBlur(clip.id, v)} min={0} max={60} step={0.5} fmt={(v) => v.toFixed(1)} />
      {(clip.grade || clip.tone) && (
        <div className="insp-row">
          <Button
            size="sm"
            onClick={() =>
              useStore.getState().undoable(() => {
                setClipGrade(clip.id, null)
                setClipTone(clip.id, null)
              })
            }
          >
            {t('insp.color.reset')}
          </Button>
        </div>
      )}
    </Section>
  )
}

export function CropSection({ clip }: { clip: Clip }): JSX.Element {
  const t = useT()
  const setClipCrop = useStore((s) => s.setClipCrop)
  const c = clip.crop
  const on = !!c && (c.l > 0 || c.t > 0 || c.r > 0 || c.b > 0)
  return (
    <Section id="Crop" icon="crop" title={t('insp.crop.title')} aside={<ResetCardButton clipId={clip.id} part="crop" title={t('insp.crop.title')} />}>
      <UndoSlider label={t('insp.crop.left')} testid="inspector.crop.left" value={(c?.l ?? 0) * 100} onChange={(v) => setClipCrop(clip.id, { l: v / 100 })} min={0} max={45} step={1} fmt={(v) => v.toFixed(0)} />
      <UndoSlider label={t('insp.crop.right')} value={(c?.r ?? 0) * 100} onChange={(v) => setClipCrop(clip.id, { r: v / 100 })} min={0} max={45} step={1} fmt={(v) => v.toFixed(0)} />
      <UndoSlider label={t('insp.crop.top')} value={(c?.t ?? 0) * 100} onChange={(v) => setClipCrop(clip.id, { t: v / 100 })} min={0} max={45} step={1} fmt={(v) => v.toFixed(0)} />
      <UndoSlider label={t('insp.crop.bottom')} value={(c?.b ?? 0) * 100} onChange={(v) => setClipCrop(clip.id, { b: v / 100 })} min={0} max={45} step={1} fmt={(v) => v.toFixed(0)} />
      {on && (
        <div className="insp-row">
          <Button size="sm" onClick={() => useStore.getState().undoable(() => setClipCrop(clip.id, null))}>{t('insp.crop.reset')}</Button>
        </div>
      )}
    </Section>
  )
}

const pct = (v: number): string => fmtPct(v)

/** A keyable effect amount's dial and its keyframe button (lit when the
 *  amount has keys). Keyed, the dial shows the amount at the playhead and a
 *  change is written onto the key there (state/slices/clip.ts setClipFx). */
function FxAmount({ clip, fx, label, max, step, fmt, onChange, testid }: { clip: Clip; fx: FxKey; label: string; max: number; step: number; fmt: (v: number) => string; onChange: (v: number) => void; testid?: string }): JSX.Element {
  const t = useT()
  const keyed = (clip.fxKeys?.[fx]?.length ?? 0) > 0
  return (
    <div className={keyed ? 'insp-prop is-keyed' : 'insp-prop'}>
      <div className="insp-prop-body">
        {keyed ? <KeyedFxSlider clip={clip} fx={fx} label={label} max={max} step={step} fmt={fmt} onChange={onChange} testid={testid} /> : <UndoSlider label={label} testid={testid} value={fxBase(clip, fx)} onChange={onChange} min={0} max={max} step={step} fmt={fmt} />}
      </div>
      <KeyDiamond keys={clip.fxKeys?.[fx]} span={clip} label={t('insp.fx.key')} testid={testid ? `${testid}.key` : undefined} onClick={() => useStore.getState().toggleFxKey(clip.id, fx)} />
    </div>
  )
}

/** (Its own component: only a keyed amount follows the playhead.) */
function KeyedFxSlider({ clip, fx, label, max, step, fmt, onChange, testid }: { clip: Clip; fx: FxKey; label: string; max: number; step: number; fmt: (v: number) => string; onChange: (v: number) => void; testid?: string }): JSX.Element {
  const time = useDisplayTime()
  return <UndoSlider label={label} testid={testid} value={fxAmountAt(clip, fx, time - clip.start)} onChange={onChange} min={0} max={max} step={step} fmt={fmt} />
}

/**
 * A section of its own, which it should always have been.
 *
 * These controls lived at the BOTTOM of the Color section behind a bare <h3>:
 * they could not be folded away, they were not in the panel's list of
 * sections, and anyone looking for "effects" found nothing where the word
 * should have been — including the look picker added to them.
 */
/** How the clip mixes with what is under it (arayüz v4: in the Opacity card;
 *  it was in Effects). */
export function BlendField({ clip }: { clip: Clip }): JSX.Element {
  const t = useT()
  const setBlend = useStore((s) => s.setClipBlendMode)
  return (
      <Tooltip content={t('insp.fx.blend.hint')}>
        <div>
          <Field label={t('insp.fx.blend')}>
            <Select
              value={clip.blendMode ?? 'normal'}
              options={BLEND_MODES.map((m) => ({ value: m, label: blendName(m) }))}
              onChange={(v) => setBlend(clip.id, v as BlendMode)}
            />
          </Field>
        </div>
      </Tooltip>
  )
}

export function EffectsBlock({ clip }: { clip: Clip }): JSX.Element {
  const t = useT()
  const setFx = useStore((s) => s.setClipEffect)
  const setLookFx = useStore((s) => s.setClipFx)
  const isStill = useStore((s) => assetById(s.project, clip.assetId)?.kind === 'image')
  const duo = clip.duotone
  // The first glow's dial stays for as long as this clip is shown once it had
  // one (dragged to nothing, it would vanish under the pointer).
  const classic = useRef<string | null>(null)
  if ((clip.glow ?? 0) > 0.01) classic.current = clip.id
  const classicGlow = classic.current === clip.id
  return (
    <Section id="Effects" icon="sparkles" title={t('insp.fx.title')} aside={<ResetCardButton clipId={clip.id} part="effects" title={t('insp.fx.title')} />}>
      {/* A whole look, rather than another dial. One at a time — these are
          complete treatments, not ingredients — while the sliders below still
          stack on top of whichever is chosen. */}
      <Tooltip content={t('insp.fx.look.hint')}>
        <div>
          <Field label={t('insp.color.look')}>
            <Select
              value={clip.videoFx?.style ?? 'none'}
              options={VIDEO_FX.map(([id]) => ({ value: id, label: videoFxName(id) }))}
              onChange={(v) =>
                useStore.getState().undoable(() => setFx(clip.id, { videoFx: { style: v as VideoFxStyle, amount: clip.videoFx?.amount ?? 0.6 } }))
              }
            />
          </Field>
        </div>
      </Tooltip>
      {clip.videoFx && clip.videoFx.style !== 'none' && (
        <UndoSlider
          label={t('insp.fx.lookAmount')}
          value={clip.videoFx.amount}
          onChange={(amount) => setFx(clip.id, { videoFx: { style: clip.videoFx!.style, amount } })}
          min={0.05}
          max={1}
          step={0.01}
          fmt={(v) => fmtPct(v)}
        />
      )}
      {isStill && (
        <SubSection id="Animated still light" title={t('insp.fx.still')} hint={t('insp.fx.still.hint')}>
          <Field label={t('insp.fx.light')}>
            <Select
              value={clip.stillImageFx?.style ?? 'none'}
              options={[{ value: 'none', label: t('insp.none') }, ...STILL_IMAGE_FX.map(([id]) => ({ value: id, label: stillFxName(id) }))]}
              onChange={(style) => {
                setFx(clip.id, {
                  stillImageFx: style === 'none'
                    ? null
                    : {
                        ...clip.stillImageFx,
                        style: style as StillImageFxStyle,
                        amount: clip.stillImageFx?.amount ?? 0.55,
                        seed: clip.stillImageFx?.seed ?? ((Math.random() * 0x7fffffff) | 0)
                      }
                })
              }}
            />
          </Field>
          {clip.stillImageFx && (
            <UndoSlider
              label={t('insp.fx.lightAmount')}
              value={clip.stillImageFx.amount}
              onChange={(amount) => setFx(clip.id, { stillImageFx: { ...clip.stillImageFx!, amount } })}
              min={0.1}
              max={1}
              step={0.01}
              fmt={(value) => fmtPct(value)}
            />
          )}
        </SubSection>
      )}
      <SubSection id="Ambient frame" title={t('insp.fx.ambient')} hint={t('insp.fx.ambient.hint')}>
        <Field label={t('insp.fx.ambience')}>
          <Select
            value={clip.ambientFx?.style ?? 'none'}
            options={[{ value: 'none', label: t('insp.none') }, ...AMBIENT_FX.map(([id]) => ({ value: id, label: ambientFxName(id) }))]}
            onChange={(style) => {
              setFx(clip.id, {
                ambientFx: style === 'none' ? null : {
                  ...clip.ambientFx,
                  style: style as AmbientFxStyle,
                  amount: clip.ambientFx?.amount ?? (style === 'living-frame' ? 0.6 : 0.45),
                  seed: clip.ambientFx?.seed ?? ((Math.random() * 0x7fffffff) | 0)
                }
              })
            }}
          />
        </Field>
        {clip.ambientFx && (
          <UndoSlider label={t('insp.fx.ambienceAmount')} value={clip.ambientFx.amount}
            onChange={(amount) => setFx(clip.id, { ambientFx: { ...clip.ambientFx!, amount } })}
            min={0.05} max={1} step={0.01} fmt={(value) => fmtPct(value)} />
        )}
      </SubSection>
      <UndoSlider label={t('insp.fx.sharpen')} testid="inspector.effects.sharpen" value={clip.sharpen ?? 0} onChange={(v) => setFx(clip.id, { sharpen: v })} min={0} max={1} step={0.01} fmt={(v) => v.toFixed(2)} />
      <UndoSlider label={t('insp.fx.vignette')} value={clip.vignette ?? 0} onChange={(v) => setFx(clip.id, { vignette: v })} min={0} max={1} step={0.01} fmt={(v) => v.toFixed(2)} />
      <UndoSlider label={t('insp.fx.grain')} value={clip.grain ?? 0} onChange={(v) => setFx(clip.id, { grain: v })} min={0} max={1} step={0.01} fmt={(v) => v.toFixed(2)} />
      {/* "cila" part D: glow, halation, mosaic and colour isolate, worked in
          the pixel pass (the same in the preview and in the file, whatever
          the size); each amount can be keyed. */}
      <FxAmount clip={clip} fx="bloom" label={t('insp.fx.bloom')} testid="inspector.effects.glow" max={1} step={0.01} fmt={pct} onChange={(amount) => setLookFx(clip.id, { bloom: { amount } })} />
      {(clip.bloom?.amount ?? 0) > 0 || (clip.fxKeys?.bloom?.length ?? 0) > 0 ? (
        <>
          <UndoSlider label={t('insp.fx.bloom.threshold')} value={clip.bloom?.threshold ?? 0.6} onChange={(threshold) => setLookFx(clip.id, { bloom: { threshold } })} min={0} max={1} step={0.01} fmt={pct} />
          <UndoSlider label={t('insp.fx.bloom.radius')} value={clip.bloom?.radius ?? 0.4} onChange={(radius) => setLookFx(clip.id, { bloom: { radius } })} min={0} max={1} step={0.01} fmt={pct} />
        </>
      ) : null}
      {/* The first glow (a blurred copy laid over the clip): kept, as it is
          drawn, for the clips that have it. */}
      {classicGlow && <UndoSlider label={t('insp.fx.glowClassic')} value={clip.glow ?? 0} onChange={(v) => setFx(clip.id, { glow: v })} min={0} max={1} step={0.01} fmt={(v) => v.toFixed(2)} />}
      <FxAmount clip={clip} fx="halation" label={t('insp.fx.halation')} testid="inspector.effects.halation" max={1} step={0.01} fmt={pct} onChange={(amount) => setLookFx(clip.id, { halation: { amount } })} />
      {(clip.halation?.amount ?? 0) > 0 || (clip.fxKeys?.halation?.length ?? 0) > 0 ? (
        <UndoSlider label={t('insp.fx.halation.size')} value={clip.halation?.size ?? 0.5} onChange={(size) => setLookFx(clip.id, { halation: { size } })} min={0} max={1} step={0.01} fmt={pct} />
      ) : null}
      <FxAmount clip={clip} fx="mosaic" label={t('insp.fx.mosaic')} testid="inspector.effects.mosaic" max={200} step={1} fmt={(v) => v.toFixed(0)} onChange={(mosaic) => setLookFx(clip.id, { mosaic })} />
      <Switch label={t('insp.fx.isolate')} hint={t('insp.fx.isolate.hint')} testid="inspector.effects.isolate" checked={!!clip.isolate} onChange={(on) => useStore.getState().undoable(() => setLookFx(clip.id, { isolate: on ? {} : null }))} />
      {clip.isolate && (
        <>
          <ColourField label={t('insp.fx.isolate.color')} value={clip.isolate.color} onChange={(color) => setLookFx(clip.id, { isolate: { color } })} />
          <UndoSlider label={t('insp.fx.isolate.range')} value={clip.isolate.range} onChange={(range) => setLookFx(clip.id, { isolate: { range } })} min={0.01} max={0.5} step={0.01} fmt={pct} />
          <FxAmount clip={clip} fx="isolate" label={t('insp.fx.isolate.amount')} max={1} step={0.01} fmt={pct} onChange={(amount) => setLookFx(clip.id, { isolate: { amount } })} />
        </>
      )}
      <UndoSlider label={t('insp.fx.chromaAb')} value={clip.chromaAb ?? 0} onChange={(v) => setFx(clip.id, { chromaAb: v })} min={0} max={20} step={0.5} fmt={(v) => v.toFixed(1)} />
      <Toggle label={t('insp.fx.duotone')} checked={!!duo} onChange={(on) => setFx(clip.id, { duotone: on ? { dark: '#1a0033', light: '#ffd0a0' } : null })} />
      {duo && (
        <>
          <ColourField label={t('insp.fx.shadows')} value={duo.dark} onChange={(dark) => setFx(clip.id, { duotone: { ...duo, dark } })} />
          <ColourField label={t('insp.fx.highlights')} value={duo.light} onChange={(light) => setFx(clip.id, { duotone: { ...duo, light } })} />
          <div className="insp-row">
            <Button size="sm" onClick={() => setFx(clip.id, { duotone: { dark: '#000000', light: '#ffffff' } })}>{t('insp.fx.bw')}</Button>
          </div>
        </>
      )}
    </Section>
  )
}

export function ChromaSection({ clip }: { clip: Clip }): JSX.Element {
  const t = useT()
  const setClipChroma = useStore((s) => s.setClipChroma)
  const setEyedropper = useStore((s) => s.setEyedropper)
  const eyedropperClip = useStore((s) => s.eyedropperClip)
  const ch = clip.chroma
  return (
    <Section id="Green screen (chroma key)" icon="pipette" title={t('insp.card.chroma')} aside={<ResetCardButton clipId={clip.id} part="chroma" title={t('insp.card.chroma')} />}>
      <Toggle label={t('insp.enabled')} checked={ch?.enabled ?? false} onChange={(on) => useStore.getState().undoable(() => setClipChroma(clip.id, { enabled: on }))} />
      {ch?.enabled && (
        <>
          {/* The eyedropper is a button with its name (it was a bare droplet
              the user did not find: DENEME-1, P6); the colour box beside it
              still takes a colour by hand. Esc or a second press puts it down. */}
          <ColourField label={t('insp.chroma.color')} value={ch.color} onChange={(color) => setClipChroma(clip.id, { color })}>
            <Tooltip content={t('insp.chroma.eyedropper')}>
              <Button
                size="sm"
                variant="secondary"
                icon="pipette"
                testid="inspector.chroma.eyedropper"
                pressed={eyedropperClip === clip.id}
                onClick={() => {
                  const on = eyedropperClip !== clip.id
                  setEyedropper(on ? clip.id : null)
                  if (on) notify({ text: t('insp.chroma.dropper.armed'), kind: 'info' })
                }}
              >
                {t('insp.chroma.dropper')}
              </Button>
            </Tooltip>
          </ColourField>
          <UndoSlider label={t('insp.chroma.similarity')} value={ch.similarity} onChange={(similarity) => setClipChroma(clip.id, { similarity })} min={0.02} max={0.9} step={0.01} />
          <UndoSlider label={t('insp.chroma.smoothness')} value={ch.smoothness} onChange={(smoothness) => setClipChroma(clip.id, { smoothness })} min={0} max={0.5} step={0.01} />
          {ch.method === 'chroma' ? (
            <Tooltip content={t('insp.chroma.spill.hint')}>
              <div>
                <UndoSlider label={t('insp.chroma.spill')} testid="inspector.chroma.spill" value={ch.spill ?? 0} onChange={(spill) => setClipChroma(clip.id, { spill })} min={0} max={1} step={0.01} fmt={pct} />
              </div>
            </Tooltip>
          ) : (
            // A key made before "cila" part D keeps the keyer it was made
            // with (the same picture as always); the new one is a choice.
            <>
              <div className="hint">{t('insp.chroma.old')}</div>
              <div className="insp-row">
                <Button size="sm" testid="inspector.chroma.upgrade" onClick={() => useStore.getState().undoable(() => setClipChroma(clip.id, { method: 'chroma', spill: 0.5, similarity: 0.4, smoothness: 0.1 }))}>{t('insp.chroma.upgrade')}</Button>
              </div>
            </>
          )}
          <div className="insp-row">
            <Button size="sm" onClick={() => useStore.getState().undoable(() => setClipChroma(clip.id, null))}>{t('insp.chroma.remove')}</Button>
          </div>
        </>
      )}
    </Section>
  )
}

const MASK_SHAPES = ['ellipse', 'rect', 'round', 'path'] as const
const MASK_MODES = ['cut', 'blur', 'pixelate'] as const
const MASK_OVERLAYS = ['auto', 'on', 'off'] as const

export function MaskSection({ clip }: { clip: Clip }): JSX.Element {
  const t = useT()
  const setClipMask = useStore((s) => s.setClipMask)
  // The renderer measures censor strength against the ASSET, so the panel has
  // to ask the same question or the slider would show a number the picture
  // doesn't agree with.
  const maskAsset = useStore((s) => s.project.assets.find((a) => a.id === clip.assetId))
  const addMaskKeyframe = useStore((s) => s.addMaskKeyframe)
  const deleteMaskKeyframe = useStore((s) => s.deleteMaskKeyframe)
  const setTime = useStore((s) => s.setTime)
  const currentTime = useDisplayTime()
  const maskDrawMode = useStore((s) => s.maskDrawMode)
  const setMaskDrawMode = useStore((s) => s.setMaskDrawMode)
  const maskOverlay = useStore((s) => s.maskOverlay)
  const setMaskOverlay = useStore((s) => s.setMaskOverlay)
  const mask = clip.mask
  return (
    <Section id="Mask" icon="square-dashed" title={t('insp.mask.title')} aside={<ResetCardButton clipId={clip.id} part="mask" title={t('insp.mask.title')} />}>
      <Toggle label={t('insp.enabled')} checked={mask?.enabled ?? false} onChange={(on) => useStore.getState().undoable(() => setClipMask(clip.id, { enabled: on }))} />
      {mask?.enabled && (
        <>
          <Field label={t('insp.mask.shape')}>
            <Select value={mask.shape} options={MASK_SHAPES.map((v) => ({ value: v, label: t(`insp.mask.shape.${v}`) }))} onChange={(v) => setClipMask(clip.id, { shape: v as NonNullable<Clip['mask']>['shape'] })} />
          </Field>
          <Field label={t('insp.mask.use')}>
            <Select value={mask.mode ?? 'cut'} options={MASK_MODES.map((v) => ({ value: v, label: t(`insp.mask.use.${v}`) }))} onChange={(v) => setClipMask(clip.id, { mode: v as never })} />
          </Field>
          {(mask.mode === 'blur' || mask.mode === 'pixelate') && (
            <UndoSlider label={t('insp.mask.censor')} value={mask.feather} onChange={(feather) => setClipMask(clip.id, { feather })} min={4} max={120} step={2} fmt={(v) => v.toFixed(0)} />
          )}
          <Field label={t('insp.mask.overlay')}>
            <Select value={maskOverlay} options={MASK_OVERLAYS.map((v) => ({ value: v, label: t(`insp.mask.overlay.${v}`) }))} onChange={(v) => setMaskOverlay(v as never)} />
          </Field>
          <div className="insp-row">
            <Tooltip content={t('insp.mask.draw.hint')}>
              <Button
                size="sm"
                icon={maskDrawMode ? 'check' : 'pencil'}
                pressed={maskDrawMode}
                onClick={() => {
                  if (maskDrawMode) {
                    setMaskDrawMode(false)
                    return
                  }
                  // Start a fresh hand-drawn shape: enable draw mode first so the
                  // auto-diamond is suppressed, then clear to an empty path.
                  setMaskDrawMode(true)
                  setClipMask(clip.id, { enabled: true, shape: 'path', points: [] })
                }}
              >
                {maskDrawMode ? t('insp.mask.finish') : t('insp.mask.draw')}
              </Button>
            </Tooltip>
            {mask.shape === 'path' && (mask.points?.length ?? 0) > 0 && !maskDrawMode && (
              <Tooltip content={t('insp.mask.clear.hint')}>
                <Button size="sm" className="insp-fixed" onClick={() => setClipMask(clip.id, { points: [] })}>{t('insp.clear')}</Button>
              </Tooltip>
            )}
          </div>
          {mask.shape === 'path' && (
            <UndoSlider
              label={t('insp.mask.smooth')}
              value={mask.smooth ?? 0}
              onChange={(smooth) => setClipMask(clip.id, { smooth })}
              min={0}
              max={1}
              step={0.01}
              fmt={(v) => (v < 0.01 ? t('f9y.mask.asDrawn') : fmtPct(v))}
            />
          )}
          <UndoSlider
            label={t('insp.mask.feather')}
            value={mask.feather}
            onChange={(feather) => setClipMask(clip.id, { feather })}
            min={0}
            max={120}
            step={1}
            fmt={(v) => (v < 0.5 ? 'hard' : v.toFixed(0))}
          />
          {/* Strength is its own control. It used to BE Feather in these two
              modes, so turning up "Feather" smeared the whole region instead of
              softening its edge. */}
          {(mask.mode ?? 'cut') !== 'cut' && (
            <UndoSlider
              label={mask.mode === 'pixelate' ? t('insp.mask.pixel') : t('insp.mask.blurAmount')}
              value={maskStrength(mask, maskAsset?.width || 1920, maskAsset?.height || 1080)}
              onChange={(strength) => setClipMask(clip.id, { strength })}
              min={2}
              max={200}
              step={1}
              fmt={(v) => v.toFixed(0)}
            />
          )}
          {mask.shape !== 'path' && (
            <UndoSliderNum
              label={t('insp.clip.rotate')}
              value={((mask.rot ?? 0) * 180) / Math.PI}
              onChange={(deg) => useStore.getState().editMaskGeom(clip.id, { rot: (deg * Math.PI) / 180 })}
              min={-180}
              max={180}
              step={1}
              suffix="°"
            />
          )}
          <Toggle label={t('insp.mask.invert')} checked={mask.invert ?? false} onChange={(on) => useStore.getState().undoable(() => setClipMask(clip.id, { invert: on }))} />
          <div className="hint">
            {maskDrawMode ? t('insp.mask.help.drawing') : t('insp.mask.help.edit')}
            {!maskDrawMode && mask.shape === 'path' && ` ${t('insp.mask.help.pen')}`}
          </div>
          <div className="insp-row">
            <Tooltip content={t('insp.mask.key.hint')}>
              <Button size="sm" icon="plus" onClick={() => addMaskKeyframe(clip.id)}>
                {t('insp.mask.keyAt', { t: Math.max(0, currentTime - clip.start).toFixed(2) })}
              </Button>
            </Tooltip>
          </div>
          {(mask.keyframes ?? []).map((k) => (
            <div key={k.id} className="insp-kf-row">
              <span className="insp-kf-time is-wide">{t('insp.seconds', { n: fmtNum(k.time, 2, true) })}</span>
              <IconButton icon="arrow-right" size="sm" variant="ghost" label={t('insp.kf.jump')} onClick={() => setTime(clip.start + k.time)} />
              <IconButton icon="x" size="sm" variant="ghost" label={t('insp.kf.delete')} onClick={() => deleteMaskKeyframe(clip.id, k.id)} />
            </div>
          ))}
          <div className="insp-row">
            <Button
              size="sm"
              onClick={() => {
                setMaskDrawMode(false)
                setClipMask(clip.id, null)
              }}
            >
              {t('insp.mask.remove')}
            </Button>
          </div>
        </>
      )}
    </Section>
  )
}
