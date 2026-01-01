// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// The Inspector's Subs tab: the selected line's or text's own settings and the
// subtitles' style (presets, key words, pop-up, highlight, emoji). Making them
// (generate, .srt, the list of lines) is the left panel's Captions page
// (components/CaptionsPage.tsx; DENEME-4, worker W: the left makes, the right
// sets what is selected).
import { useState } from 'react'
import { DEFAULT_EMOJI_RULES, EMOJI_PACK_SIZE } from '../../subtitles/emojiPack'
import { useStore } from '../../state/store'
import type { Caption, CaptionStyle } from '../../types'
import { Button, Field, IconButton, Section, Segmented, Select, TextArea, TextField, Toggle, Tooltip, useT, type StringKey } from '../../ui'
import { MarkWordControls } from '../ShapesTab'
import { requestShell } from '../app/requests'
import { ColourField } from './parts'
import { UndoSlider, UndoSliderNum } from './sliders'
import { KEY_MARK_DEFAULT, keyWordPlan } from '../../subtitles/keywords'
import { FontSelect, BoilControls, AddFontButton, weightOptions } from './fonts'
import { ManualTextEditor } from './text-editor'
import { BareButton } from '../../ui/Button'
import { fmtPct } from '../../ui/format'

const PLACES = ['left', 'center', 'right'] as const
const POPUPS = ['pop', 'fade', 'rise', 'focus', 'soft', 'lift', 'ghost', 'fluid', 'plain', 'bloom', 'wave', 'glide', 'tilt', 'drift', 'type', 'marker', 'shimmer', 'flip'] as const
export function SubsTab(): JSX.Element {
  const t = useT()
  const captions = useStore((s) => s.project.captions)
  const mainStyle = useStore((s) => s.project.captionStyle)
  const shortsStyle = useStore((s) => s.project.captionStyleShorts)
  const setMainStyle = useStore((s) => s.setCaptionStyle)
  const setShortsStyle = useStore((s) => s.setCaptionStyleShorts)
  const updateCaption = useStore((s) => s.updateCaption)
  const mode = useStore((s) => s.project.mode)
  const selectedCaptionId = useStore((s) => s.selectedCaptionIds[0] ?? null)
  // A shape is not text: its editor is in the Clip tab, and none of the type
  // controls below (font, weight, uppercase, line height…) mean anything for a
  // rectangle. Showing them was clutter AND a lie about what they do.
  const selectedManual = captions.find((c) => c.id === selectedCaptionId && c.manual && !c.shape)
  const selectedLine = captions.find((c) => c.id === selectedCaptionId && !c.manual && !c.shape)
  // Which style the editors below apply to. Long-form and Shorts subtitles
  // are styled independently once the Shorts style is enabled.
  const [target, setTarget] = useState<'main' | 'shorts'>(mode === 'shorts' ? 'shorts' : 'main')
  const shortsEnabled = !!shortsStyle
  const editingShorts = target === 'shorts' && shortsEnabled
  const style = editingShorts ? shortsStyle! : mainStyle
  const setCaptionStyle = editingShorts ? setShortsStyle : setMainStyle

  return (
    <>
      {/* Making them is on the left (DENEME-4, worker W): said while there
          are none, with the way there. */}
      {!captions.some((c) => !c.shape) && (
        <div className="insp-note" data-testid="subs.make-left">
          <div>{t('w4.subs.make')}</div>
          <div className="insp-row">
            <Button size="sm" icon="captions" testid="subs.make-left.open" onClick={() => requestShell('dock:captions')}>{t('w4.subs.make.open')}</Button>
          </div>
        </div>
      )}
      {selectedManual && <ManualTextEditor caption={selectedManual} />}
      {selectedLine && (
        <Section id="This line" icon="text-align-start" title={t('insp.line.title')}>
          <Field label={t('insp.line.place')}>
            <Segmented
              value={selectedLine.place ?? 'center'}
              label={t('insp.line.place')}
              options={PLACES.map((v) => ({ value: v, label: t(`insp.line.place.${v}`) }))}
              onChange={(v) => updateCaption(selectedLine.id, { place: v === 'center' ? undefined : v })}
            />
          </Field>
          <Field label={t('insp.font')}>
            <FontSelect value={selectedLine.font ?? style.fontFamily} onChange={(font) => updateCaption(selectedLine.id, { font: font === style.fontFamily ? undefined : font })} />
          </Field>
          {(selectedLine.place || selectedLine.font) && (
            <div className="insp-row">
              <Button size="sm" variant="ghost" onClick={() => updateCaption(selectedLine.id, { place: undefined, font: undefined })}>{t('insp.line.back')}</Button>
            </div>
          )}
        </Section>
      )}
      {/* The selected text's marked word (it was in Effects → Shapes on the
          left; DENEME-4, worker W: the selected thing's settings are here). */}
      {(selectedManual || selectedLine) && <MarkWordControls caption={(selectedManual ?? selectedLine)!} />}
      <Section id="Pop-up animation" icon="sparkles" title={t('insp.popup.title')}>
        <div className="hint">{t('insp.popup.hint')}</div>
        <Toggle label={t('insp.enabled')} checked={style.popup?.enabled ?? false} onChange={(on) => setCaptionStyle({ popup: { ...style.popup, enabled: on } })} />
        {style.popup?.enabled && (
          <>
            <Field label={t('insp.style')}>
              <Select
                value={style.popup.style ?? 'pop'}
                options={POPUPS.map((v) => ({ value: v, label: t(`insp.popup.style.${v}`) }))}
                onChange={(v) => setCaptionStyle({ popup: { ...style.popup, style: v as NonNullable<CaptionStyle['popup']['style']> } })}
              />
            </Field>
            <UndoSlider
              label={t('insp.popup.speed')}
              value={style.popup.duration}
              onChange={(duration) => setCaptionStyle({ popup: { ...style.popup, duration } })}
              min={0.05}
              max={0.5}
              step={0.01}
            />
            {(style.popup.style ?? 'pop') === 'pop' && (
              <UndoSlider
                label={t('insp.popup.bounce')}
                value={style.popup.intensity}
                onChange={(intensity) => setCaptionStyle({ popup: { ...style.popup, intensity } })}
                min={0}
                max={2.5}
                step={0.01}
              />
            )}
          </>
        )}
      </Section>

      <Section id="Current-word highlight" icon="highlighter" title={t('insp.hl.title')}>
        <div className="hint">{t('insp.hl.hint')}</div>
        <Toggle
          label={t('insp.enabled')}
          checked={style.highlight?.enabled ?? false}
          onChange={(on) => setCaptionStyle({ highlight: { color: '#ffd83d', scale: 1.12, ...style.highlight, enabled: on } })}
        />
        {style.highlight?.enabled && (
          <>
            <ColourField label={t('insp.colour')} value={style.highlight.color} onChange={(color) => setCaptionStyle({ highlight: { ...style.highlight!, color } })} />
            <UndoSlider
              label={t('insp.hl.bump')}
              value={style.highlight.scale}
              onChange={(scale) => setCaptionStyle({ highlight: { ...style.highlight!, scale } })}
              min={1}
              max={1.5}
              step={0.01}
            />
            <Tooltip content={t('insp.hl.box.hint')}>
              <div>
                <Toggle
                  label={t('insp.hl.box')}
                  checked={style.highlight.box ?? false}
                  onChange={(on) => setCaptionStyle({ highlight: { boxColor: '#25d0c2', boxGlide: 0.12, ...style.highlight!, box: on } })}
                />
              </div>
            </Tooltip>
            {style.highlight.box && (
              <>
                <ColourField label={t('insp.hl.boxColour')} value={style.highlight.boxColor ?? '#25d0c2'} onChange={(boxColor) => setCaptionStyle({ highlight: { ...style.highlight!, boxColor } })} />
                <UndoSlider
                  label={t('insp.hl.glide')}
                  value={style.highlight.boxGlide ?? 0.12}
                  onChange={(boxGlide) => setCaptionStyle({ highlight: { ...style.highlight!, boxGlide } })}
                  min={0}
                  max={0.4}
                  step={0.01}
                  fmt={(v) => `${v.toFixed(2)}s`}
                />
              </>
            )}
          </>
        )}
      </Section>

      <KeyWordsSection style={style} setCaptionStyle={setCaptionStyle} captions={captions} />

      <Section id="Emoji decoration" icon="sticky-note" title={t('insp.emoji.title')}>
        <div className="hint">{t('insp.emoji.hint', { n: EMOJI_PACK_SIZE })}</div>
        <Toggle
          label={t('insp.enabled')}
          checked={style.emoji?.enabled ?? false}
          onChange={(on) => setCaptionStyle({ emoji: { rules: DEFAULT_EMOJI_RULES, ...style.emoji, enabled: on } })}
        />
        {style.emoji?.enabled && (
          <>
            <div className="insp-row">
              <Tooltip content={t('insp.emoji.load.hint', { n: EMOJI_PACK_SIZE })}>
                <Button size="sm" icon="sparkles" onClick={() => setCaptionStyle({ emoji: { ...style.emoji!, rules: DEFAULT_EMOJI_RULES } })}>{t('insp.emoji.load', { n: EMOJI_PACK_SIZE })}</Button>
              </Tooltip>
              <Tooltip content={t('insp.emoji.clear.hint')}>
                <Button size="sm" className="insp-fixed" onClick={() => setCaptionStyle({ emoji: { ...style.emoji!, rules: '' } })}>{t('insp.clear')}</Button>
              </Tooltip>
            </div>
            <div className="hint">{t('insp.emoji.active', { n: style.emoji.rules.split(/[,\n;]+/).filter((r) => r.includes('=')).length })}</div>
            <TextArea
              className="insp-wide"
              value={style.emoji.rules}
              onChange={(rules) => setCaptionStyle({ emoji: { ...style.emoji!, rules } })}
              rows={4}
              label={t('insp.emoji.title')}
              placeholder={t('insp.emoji.placeholder')}
            />
          </>
        )}
      </Section>

      <Section id="Shorts subtitles" icon="smartphone" title={t('insp.shortsSubs.title')}>
        <Toggle
          label={t('insp.shortsSubs.separate')}
          checked={shortsEnabled}
          onChange={(on) => {
            if (on) {
              setShortsStyle({}) // starts as a copy of the main style
              setTarget('shorts')
            } else {
              setShortsStyle(null)
              setTarget('main')
            }
          }}
        />
        {shortsEnabled && (
          <Segmented
            value={target}
            label={t('insp.shortsSubs.editing')}
            options={[
              { value: 'main', label: t('insp.shortsSubs.editMain') },
              { value: 'shorts', label: t('insp.shortsSubs.editShorts') }
            ]}
            onChange={setTarget}
          />
        )}
        {shortsEnabled && <div className="hint">{t(target === 'shorts' ? 'insp.shortsSubs.nowShorts' : 'insp.shortsSubs.nowMain')}</div>}
      </Section>

      <CaptionPresets style={style} apply={setCaptionStyle} label={editingShorts ? t('insp.presets.forShorts') : t('insp.presets.forMain')} />

      <Section id="Style" icon="type" title={t('insp.style')}>
        <div className="insp-with-button">
          <Field label={t('insp.font')}>
            <FontSelect value={style.fontFamily} onChange={(fontFamily) => setCaptionStyle({ fontFamily })} />
          </Field>
          <AddFontButton />
        </div>
        <UndoSliderNum label={t('insp.size')} testid="subs.style.size" value={style.fontSize} onChange={(fontSize) => setCaptionStyle({ fontSize })} min={8} max={400} step={1} numStep={2} suffix="px" />
        <BoilControls value={style.boil} onChange={(boil) => setCaptionStyle({ boil })} />
        <Field label={t('insp.weight')}>
          <Select value={String(style.fontWeight)} options={weightOptions()} onChange={(v) => setCaptionStyle({ fontWeight: Number(v) })} />
        </Field>
        <ColourField label={t('insp.textColour')} value={style.color} onChange={(color) => setCaptionStyle({ color })} />
        {/* Same switch as the selected-text panel: the outline is a thing you
            turn off, not a width you have to think your way to zero. */}
        <Tooltip content={t('insp.outline.hint')}>
          <div>
            <Toggle label={t('insp.outline')} checked={style.outlineWidth > 0} onChange={(on) => setCaptionStyle({ outlineWidth: on ? 6 : 0 })} />
          </div>
        </Tooltip>
        {style.outlineWidth > 0 && (
          <>
            <ColourField label={t('insp.outline.colour')} value={style.outlineColor} onChange={(outlineColor) => setCaptionStyle({ outlineColor })} />
            <UndoSlider label={t('insp.outline.width')} testid="subs.style.outline" value={style.outlineWidth} onChange={(outlineWidth) => setCaptionStyle({ outlineWidth })} min={0.5} max={20} step={0.5} fmt={(v) => v.toFixed(1)} />
          </>
        )}
        <ColourField label={t('insp.bg')} value={style.bgColor} onChange={(bgColor) => setCaptionStyle({ bgColor })} />
        <UndoSlider label={t('insp.bg.opacity')} value={style.bgOpacity} onChange={(bgOpacity) => setCaptionStyle({ bgOpacity })} min={0} max={1} />
        <UndoSlider label={t('insp.bg.radius')} testid="subs.style.bg-radius" value={style.bgRadius ?? 0} onChange={(bgRadius) => setCaptionStyle({ bgRadius })} min={0} max={80} step={1} fmt={(v) => v.toFixed(0)} />
        <UndoSlider label={t('insp.bg.padX')} value={style.bgPadX ?? 0.35} onChange={(bgPadX) => setCaptionStyle({ bgPadX })} min={0} max={1.5} step={0.01} />
        <UndoSlider label={t('insp.bg.padY')} value={style.bgPadY ?? 0.18} onChange={(bgPadY) => setCaptionStyle({ bgPadY })} min={0} max={1.5} step={0.01} />
        <UndoSlider
          label={t('insp.fitWidth')}
          value={style.fitWidth ?? 0}
          onChange={(fitWidth) => setCaptionStyle({ fitWidth })}
          min={0}
          max={1}
          step={0.01}
          fmt={(v) => (v <= 0 ? t('f9y.offLower') : fmtPct(v))}
        />
        <UndoSlider label={t('insp.position')} testid="subs.style.position" value={style.posY} onChange={(posY) => setCaptionStyle({ posY })} min={0.05} max={0.95} />
        <UndoSlider label={t('insp.lineLength')} value={style.maxLineChars} onChange={(maxLineChars) => setCaptionStyle({ maxLineChars: Math.round(maxLineChars) })} min={10} max={60} step={1} fmt={(v) => v.toFixed(0)} />
        <Toggle label={t('insp.uppercase')} checked={style.uppercase} onChange={(on) => setCaptionStyle({ uppercase: on })} />
        <UndoSlider label={t('insp.lineHeight')} testid="subs.style.line-height" value={style.lineHeight ?? 1.25} onChange={(lineHeight) => setCaptionStyle({ lineHeight })} min={0.9} max={2} step={0.01} />
        <UndoSlider label={t('insp.letterSpace')} value={style.letterSpacing ?? 0} onChange={(letterSpacing) => setCaptionStyle({ letterSpacing })} min={-2} max={20} step={0.5} fmt={(v) => v.toFixed(1)} />
        <Field label={t('insp.align')}>
          <Select value={style.align ?? 'center'} options={(['center', 'left', 'right'] as const).map((v) => ({ value: v, label: t(`insp.align.${v}`) }))} onChange={(v) => setCaptionStyle({ align: v as never })} />
        </Field>
        <Toggle
          label={t('insp.shadow')}
          checked={style.shadow?.enabled ?? false}
          onChange={(on) => setCaptionStyle({ shadow: { color: '#000000', blur: 12, dx: 0, dy: 4, ...style.shadow, enabled: on } })}
        />
        {style.shadow?.enabled && (
          <>
            <ColourField label={t('insp.shadow.colour')} value={style.shadow.color} onChange={(color) => setCaptionStyle({ shadow: { ...style.shadow!, color } })} />
            <UndoSlider label={t('insp.color.blur')} value={style.shadow.blur} onChange={(blur) => setCaptionStyle({ shadow: { ...style.shadow!, blur } })} min={0} max={40} step={1} fmt={(v) => v.toFixed(0)} />
            <UndoSlider label={t('insp.shadow.dx')} value={style.shadow.dx} onChange={(dx) => setCaptionStyle({ shadow: { ...style.shadow!, dx } })} min={-20} max={20} step={1} fmt={(v) => v.toFixed(0)} />
            <UndoSlider label={t('insp.shadow.dy')} value={style.shadow.dy} onChange={(dy) => setCaptionStyle({ shadow: { ...style.shadow!, dy } })} min={-20} max={20} step={1} fmt={(v) => v.toFixed(0)} />
            <div className="hint">{t('insp.shadow.tip')}</div>
          </>
        )}
      </Section>

    </>
  )
}


export const PRESETS_KEY = 'autocut-caption-presets'

/** Looks that come with Snipp. The first two are stickers: white with a bold
 *  black line and a hard shadow. */
export const BUILT_IN_LOOKS: [StringKey, Partial<CaptionStyle>, StringKey][] = [
  [
    'insp.presets.sticker',
    {
      fontFamily: 'Archivo Black',
      fontWeight: 400,
      color: '#ffffff',
      outlineColor: '#0b0b0d',
      outlineWidth: 9,
      bgOpacity: 0,
      bgBorder: undefined,
      uppercase: false,
      letterSpacing: 0.5,
      shadow: { enabled: true, color: '#0b0b0d', blur: 0, dx: 5, dy: 8 },
      popup: { enabled: true, duration: 0.2, intensity: 0.35, style: 'pop' },
      highlight: { enabled: true, color: '#ffd23f', scale: 1.06 }
    },
    'insp.presets.sticker.hint'
  ],
  [
    'insp.presets.label',
    {
      fontFamily: 'Archivo Black',
      fontWeight: 400,
      color: '#0b0b0d',
      outlineWidth: 0,
      bgColor: '#ffffff',
      bgOpacity: 1,
      bgRadius: 18,
      bgPadX: 0.45,
      bgPadY: 0.25,
      bgBorder: { color: '#0b0b0d', width: 6 },
      // Each line its own label: the box (1.5 × the size and its border) is
      // taller than the usual spacing, so the lines' boxes overlapped.
      lineHeight: 1.6,
      shadow: { enabled: true, color: '#0b0b0d', blur: 0, dx: 6, dy: 9 },
      popup: { enabled: true, duration: 0.22, intensity: 0.3, style: 'pop' },
      highlight: { enabled: false, color: '#ffd23f', scale: 1 }
    },
    'insp.presets.label.hint'
  ],
  [
    'insp.presets.serif',
    {
      fontFamily: 'Merriweather',
      fontWeight: 400,
      color: '#f3efe6',
      outlineWidth: 0,
      bgOpacity: 0,
      bgBorder: undefined,
      shadow: { enabled: true, color: '#000000', blur: 14, dx: 0, dy: 2 },
      popup: { enabled: true, duration: 0.35, intensity: 0, style: 'fade' },
      highlight: { enabled: false, color: '#c9a45c', scale: 1 }
    },
    'insp.presets.serif.hint'
  ]
]

export function loadPresets(): Record<string, CaptionStyle> {
  try {
    return JSON.parse(localStorage.getItem(PRESETS_KEY) ?? '{}')
  } catch {
    return {}
  }
}

export function CaptionPresets({
  style,
  apply,
  label
}: {
  style: CaptionStyle
  apply: (patch: Partial<CaptionStyle>) => void
  label: string
}): JSX.Element {
  const t = useT()
  const [presets, setPresets] = useState<Record<string, CaptionStyle>>(loadPresets)
  const [name, setName] = useState('')

  const save = () => {
    const trimmed = name.trim()
    if (!trimmed) return
    const next = { ...presets, [trimmed]: structuredClone(style) }
    localStorage.setItem(PRESETS_KEY, JSON.stringify(next))
    setPresets(next)
    setName('')
  }
  const remove = (key: string) => {
    const next = { ...presets }
    delete next[key]
    localStorage.setItem(PRESETS_KEY, JSON.stringify(next))
    setPresets(next)
  }

  return (
    <Section id="Style presets" icon="layout-list" title={t('insp.presets.title')}>
      <div className="hint">{t('insp.presets.appliesTo', { what: label })}</div>
      <div className="insp-grid">
        {BUILT_IN_LOOKS.map(([key, look, hint]) => (
          <Tooltip key={key} content={t(hint)}>
            <Button size="sm" onClick={() => apply(look)}>{t(key)}</Button>
          </Tooltip>
        ))}
      </div>
      <div className="insp-row">
        <TextField placeholder={t('insp.presets.name')} label={t('insp.presets.name')} value={name} onChange={setName} onCommit={save} />
        <Button icon="save" className="insp-fixed" onClick={save} disabled={!name.trim()}>{t('insp.save')}</Button>
      </div>
      {Object.keys(presets).length === 0 && <div className="hint">{t('insp.presets.hint')}</div>}
      {Object.entries(presets).map(([key, preset]) => (
        <div key={key} className="insp-kf-row">
          <span className="insp-queue-name">{key}</span>
          <Button size="sm" variant="ghost" onClick={() => apply(preset)}>{t('insp.apply')}</Button>
          <IconButton icon="x" size="sm" variant="ghost" label={t('insp.presets.delete', { name: key })} onClick={() => remove(key)} />
        </div>
      ))}
    </Section>
  )
}

const KEY_AMOUNTS = ['few', 'some', 'more'] as const
const KEY_COLOURS = ['#f1ef00', '#ffd23f', '#7ee787', '#ff9ec4', '#8fd3ff']

/** Key words: the subtitles mark what matters in a line on their own. */
export function KeyWordsSection({
  style,
  setCaptionStyle,
  captions
}: {
  style: CaptionStyle
  setCaptionStyle: (patch: Partial<CaptionStyle>) => void
  captions: Caption[]
}): JSX.Element {
  const t = useT()
  const look = style.keyMark
  const on = !!look?.enabled
  const set = (patch: Partial<NonNullable<CaptionStyle['keyMark']>>): void => setCaptionStyle({ keyMark: { ...KEY_MARK_DEFAULT, ...look, ...patch } })
  const subs = captions.filter((c) => !c.shape && !c.manual && (c.layer ?? 0) === 0 && !c.style)
  const found = on ? keyWordPlan(captions, look!.amount) : null
  const yours = subs.filter((c) => c.marks)
  const marked = on ? subs.filter((c) => (c.marks ?? found!.get(c.id) ?? []).length > 0).length : 0
  return (
    <Section id="Key words" icon="search" title={t('insp.keys.title')}>
      <div className="hint">{t('insp.keys.hint')}</div>
      <Toggle label={t('insp.enabled')} checked={on} onChange={(enabled) => set({ enabled })} />
      {on && (
        <>
          <Field label={t('insp.keys.howMany')}>
            <Segmented value={look!.amount} label={t('insp.keys.howMany')} options={KEY_AMOUNTS.map((id) => ({ value: id, label: t(`insp.keys.amount.${id}`) }))} onChange={(amount) => set({ amount })} />
          </Field>
          <ColourField label={t('insp.colour')} value={look!.color} onChange={(color) => set({ color })} />
          <div className="insp-swatches" role="group" aria-label={t('insp.keys.colours')}>
            {KEY_COLOURS.map((col) => (
              <Tooltip key={col} content={col}>
                <BareButton type="button" aria-label={col} aria-pressed={look!.color === col} className={look!.color === col ? 'is-on' : ''} style={{ '--swatch': col } as React.CSSProperties} onClick={() => set({ color: col })} />
              </Tooltip>
            ))}
          </div>
          <UndoSlider label={t('insp.keys.sweep')} value={look!.duration} onChange={(duration) => set({ duration })} min={0.1} max={1.5} step={0.01} fmt={(v) => `${v.toFixed(2)}s`} />
          <div className="hint">
            {t('insp.keys.marked', { n: marked, of: subs.length })}
            {yours.length ? ` · ${t('insp.keys.yours', { n: yours.length })}` : ''}
          </div>
          {yours.length > 0 && (
            <div className="insp-row">
              <Button
                size="sm"
                onClick={() => {
                  const store = useStore.getState()
                  store.undoable(() => {
                    for (const c of yours) store.updateCaption(c.id, { marks: undefined })
                  })
                }}
              >
                {t('insp.keys.useFound')}
              </Button>
            </div>
          )}
        </>
      )}
    </Section>
  )
}
