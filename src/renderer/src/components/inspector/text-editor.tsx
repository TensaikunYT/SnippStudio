// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// A manual text's editor (its words, look, keyframes and saved text templates).
// Moved out of Inspector.tsx in SnippStudio phase 2B; onto the building blocks
// in phase 3c.3 (no change of behaviour).
import { useState } from 'react'
import { captionMotionAt } from '../../playback/render'
import { useStore } from '../../state/store'
import type { Caption, CaptionStyle, TextAnim } from '../../types'
import { defaultCaptionStyle } from '../../types'
import { Button, Field, IconButton, Section, Select, SubSection, TextArea, TextField, Toggle, Tooltip, useT } from '../../ui'
import { fmtNum, fmtPct } from '../../ui/format'
import { FontSelect, BoilControls, weightOptions } from './fonts'
import { FollowTracker } from './clip-motion'
import { ColourField } from './parts'
import { UndoSlider, UndoSliderNum } from './sliders'
import { useTypedText } from '../preview/text-edit/session'

export const TEXT_TEMPLATES_KEY = 'autocut-text-templates'
export interface TextTemplate {
  name: string
  style: CaptionStyle
  anim?: Caption['anim']
}
export function loadTextTemplates(): TextTemplate[] {
  try {
    const raw = JSON.parse(localStorage.getItem(TEXT_TEMPLATES_KEY) ?? '[]')
    return Array.isArray(raw) ? raw : []
  } catch {
    return []
  }
}

/**
 * Text motion + keyframes.
 *
 * Entrance and exit animations move a text ON and OFF. This is what moves it
 * AROUND while it is on screen — a label that follows something, a title that
 * drifts, a callout that grows into place. With no keyframes the sliders are a
 * static offset; add one and they write at the playhead instead, which is how
 * clip properties already behave.
 */
export function TextKeyframes({ caption }: { caption: Caption }): JSX.Element {
  const t = useT()
  const currentTime = useStore((s) => s.currentTime)
  const setTime = useStore((s) => s.setTime)
  const setMotion = useStore((s) => s.setCaptionMotion)
  const addKf = useStore((s) => s.addCaptionKeyframe)
  const delKf = useStore((s) => s.deleteCaptionKeyframe)
  const clearKf = useStore((s) => s.clearCaptionKeyframes)
  const local = Math.min(Math.max(0, currentTime - caption.start), Math.max(0, caption.end - caption.start))
  const m = captionMotionAt(caption, local)
  const kfs = caption.kfs ?? []
  const keyed = kfs.length > 0

  return (
    <Section id="Motion" title={t('insp.motion.title')} count={kfs.length} testid="inspector.text.sec.motion">
      <div className="hint">{keyed ? t('insp.textMotion.keyed') : t('insp.textMotion.static')}</div>
      <UndoSliderNum label={t('insp.shadow.dx')} value={m.x} onChange={(x) => setMotion(caption.id, { x })} min={-960} max={960} step={1} numStep={10} />
      <UndoSliderNum label={t('insp.shadow.dy')} value={m.y} onChange={(y) => setMotion(caption.id, { y })} min={-540} max={540} step={1} numStep={10} />
      <UndoSliderNum label={t('insp.clip.scale')} value={m.scale * 100} onChange={(v) => setMotion(caption.id, { scale: Math.max(0.02, v / 100) })} min={5} max={400} step={1} suffix="%" />
      <UndoSliderNum label={t('insp.clip.rotate')} value={(m.rot * 180) / Math.PI} onChange={(deg) => setMotion(caption.id, { rot: (deg * Math.PI) / 180 })} min={-180} max={180} step={1} suffix="°" />
      <UndoSliderNum label={t('insp.clip.opacity')} value={m.opacity * 100} onChange={(v) => setMotion(caption.id, { opacity: Math.max(0, Math.min(1, v / 100)) })} min={0} max={100} step={1} suffix="%" />
      <div className="insp-row">
        <Button size="sm" icon="plus" onClick={() => addKf(caption.id)}>{t('insp.textMotion.keyAt', { t: local.toFixed(2) })}</Button>
        {keyed && <Button size="sm" className="insp-fixed" onClick={() => clearKf(caption.id)}>{t('insp.clear')}</Button>}
      </div>
      {kfs.map((k) => (
        <div key={k.id} className="insp-kf-row">
          <span className="insp-kf-time">{t('insp.seconds', { n: fmtNum(k.time, 2, true) })}</span>
          <span className="insp-kf-value">
            {Math.round(k.x)}, {Math.round(k.y)} · {fmtPct(k.scale)} · {fmtPct(k.opacity)}
          </span>
          <IconButton icon="arrow-right" size="sm" variant="ghost" label={t('insp.kf.jump')} onClick={() => setTime(caption.start + k.time)} />
          <IconButton icon="x" size="sm" variant="ghost" label={t('insp.kf.delete')} onClick={() => delKf(caption.id, k.id)} />
        </div>
      ))}
    </Section>
  )
}

const TEXT_ANIMS = ['none', 'fade', 'slide', 'zoom', 'note', 'pop', 'blur', 'drop', 'spin', 'grow'] as const
const TEXT_IDLES = ['none', 'breathe', 'drift', 'tilt', 'bob', 'glide', 'float', 'sway', 'pulse'] as const
const TEXT_BLENDS = ['normal', 'screen', 'multiply', 'overlay', 'lighten', 'darken', 'difference'] as const
const ALIGNS = ['center', 'left', 'right'] as const

export function ManualTextEditor({ caption }: { caption: Caption }): JSX.Element {
  const t = useT()
  const setCaptionOwnStyle = useStore((s) => s.setCaptionOwnStyle)
  const updateCaption = useStore((s) => s.updateCaption)
  const deleteCaption = useStore((s) => s.deleteCaption)
  const [templates, setTemplates] = useState<TextTemplate[]>(loadTextTemplates)
  // While the title is typed in in the preview, the field shows those words.
  const shownText = useTypedText(caption.id, caption.text)
  const [templateName, setTemplateName] = useState('')
  const st = caption.style ?? defaultCaptionStyle()
  // Every edit lands on EVERY selected text, not just the one being shown.
  // Styling five lower-thirds meant five identical passes through this panel.
  const selectedIds = useStore((s) => s.selectedCaptionIds)
  const targets = selectedIds.includes(caption.id) && selectedIds.length > 1 ? selectedIds : [caption.id]
  const edit = (patch: Partial<CaptionStyle>): void => {
    if (targets.length === 1) {
      setCaptionOwnStyle(caption.id, patch)
      return
    }
    useStore.getState().undoable(() => {
      for (const id of targets) setCaptionOwnStyle(id, patch)
    })
  }

  const saveTemplate = (): void => {
    const name = templateName.trim()
    if (!name) return
    const next = [...templates.filter((x) => x.name !== name), { name, style: st, anim: caption.anim }]
    setTemplates(next)
    localStorage.setItem(TEXT_TEMPLATES_KEY, JSON.stringify(next))
  }

  return (
    <Section id="Selected text (manual)" icon="type" title={t('insp.text.title')} className="insp-own-text">
      <div className="hint">{t('insp.text.hint')}</div>
      <TextArea className="insp-wide" value={shownText} onChange={(text) => updateCaption(caption.id, { text })} rows={3} label={t('insp.text.title')} placeholder={t('insp.text.placeholder')} />
      <div className="hint">{t('insp.text.dragHint')}</div>
      {targets.length > 1 && <div className="hint">{t('insp.text.editingAll', { n: targets.length })}</div>}
      {/* What you reach for on every title, in the order you reach for it:
          four named groups, most-used first, and the two that are occasional
          start folded. */}
      <SubSection id="Type" title={t('insp.text.type')} open testid="inspector.text.sec.type">
        <Field label={t('insp.font')}>
          <FontSelect value={st.fontFamily} onChange={(fontFamily) => edit({ fontFamily })} />
        </Field>
        <Field label={t('insp.weight')}>
          <Select value={String(st.fontWeight)} options={weightOptions()} onChange={(v) => edit({ fontWeight: Number(v) })} />
        </Field>
        <Toggle label={t('yz.bar.italic')} checked={!!st.italic} onChange={(on) => edit({ italic: on })} />
        <UndoSliderNum label={t('insp.size')} value={st.fontSize} onChange={(fontSize) => edit({ fontSize })} min={8} max={900} step={1} numStep={4} suffix="px" />
        <BoilControls value={st.boil} onChange={(boil) => edit({ boil })} />
        <UndoSlider label={t('insp.position')} value={st.posY} onChange={(posY) => edit({ posY })} min={0.05} max={0.95} />
        <Field label={t('insp.text.multiAlign')}>
          <Select value={st.align ?? 'center'} options={ALIGNS.map((v) => ({ value: v, label: t(`insp.align.${v}`) }))} onChange={(v) => edit({ align: v as never })} />
        </Field>
        <UndoSlider label={t('insp.lineHeight')} value={st.lineHeight ?? 1.25} onChange={(lineHeight) => edit({ lineHeight })} min={0.9} max={2} step={0.01} />
        <Toggle label={t('insp.uppercase')} checked={st.uppercase} onChange={(on) => edit({ uppercase: on })} />
      </SubSection>
      <SubSection id="Colour & outline" title={t('insp.text.colour')} open>
        <ColourField label={t('insp.textColour')} value={st.color} onChange={(color) => edit({ color })} />
        {/* An outright switch. Text starts with a 6px black outline, and the
            only way to be rid of it was to notice that a slider called "width"
            goes to zero — which is not the same as being offered the choice. */}
        <Tooltip content={t('insp.text.outline.hint')}>
          <div>
            <Toggle label={t('insp.outline')} checked={st.outlineWidth > 0} onChange={(on) => edit({ outlineWidth: on ? 6 : 0 })} />
          </div>
        </Tooltip>
        {st.outlineWidth > 0 && (
          <>
            <ColourField label={t('insp.outline.colour')} value={st.outlineColor} onChange={(outlineColor) => edit({ outlineColor })} />
            <UndoSlider label={t('insp.outline.width')} value={st.outlineWidth} onChange={(outlineWidth) => edit({ outlineWidth })} min={0.5} max={20} step={0.5} fmt={(v) => v.toFixed(1)} />
          </>
        )}
        <Tooltip content={t('insp.text.gradient.hint')}>
          <div>
            <Toggle
              label={t('insp.text.gradient')}
              checked={st.gradient?.enabled ?? false}
              onChange={(on) =>
                edit({
                  gradient: {
                    from: st.gradient?.from ?? st.color,
                    to: st.gradient?.to ?? '#25d0c2',
                    angle: st.gradient?.angle ?? 0,
                    enabled: on
                  }
                })
              }
            />
          </div>
        </Tooltip>
        {st.gradient?.enabled && (
          <>
            <ColourField label={t('insp.text.gradient.from')} value={st.gradient.from} onChange={(from) => edit({ gradient: { ...st.gradient!, from } })} />
            <ColourField label={t('insp.text.gradient.to')} value={st.gradient.to} onChange={(to) => edit({ gradient: { ...st.gradient!, to } })} />
            <UndoSlider
              label={t('insp.text.gradient.angle')}
              value={st.gradient.angle}
              onChange={(angle) => edit({ gradient: { ...st.gradient!, angle } })}
              min={0}
              max={360}
              step={5}
              fmt={(v) => `${v.toFixed(0)}°`}
            />
          </>
        )}
        <Tooltip content={t('insp.text.blend.hint')}>
          <div>
            <Field label={t('insp.fx.blend')}>
              <Select value={st.blend ?? 'normal'} options={TEXT_BLENDS.map((v) => ({ value: v, label: t(`insp.text.blend.${v}`) }))} onChange={(v) => edit({ blend: v as never })} />
            </Field>
          </div>
        </Tooltip>
      </SubSection>
      <SubSection id="Background box" title={t('insp.text.box')}>
        <ColourField label={t('insp.hl.boxColour')} value={st.bgColor} onChange={(bgColor) => edit({ bgColor })} />
        <UndoSlider label={t('insp.text.box.opacity')} value={st.bgOpacity} onChange={(bgOpacity) => edit({ bgOpacity })} min={0} max={1} />
        <UndoSlider label={t('insp.text.box.radius')} value={st.bgRadius ?? 0} onChange={(bgRadius) => edit({ bgRadius })} min={0} max={80} step={1} fmt={(v) => v.toFixed(0)} />
        <UndoSlider label={t('insp.text.box.padX')} value={st.bgPadX ?? 0.35} onChange={(bgPadX) => edit({ bgPadX })} min={0} max={1.5} step={0.01} />
        <UndoSlider label={t('insp.text.box.padY')} value={st.bgPadY ?? 0.18} onChange={(bgPadY) => edit({ bgPadY })} min={0} max={1.5} step={0.01} />
        <ColourField label={t('insp.text.box.border')} value={st.bgBorder?.color ?? '#ffffff'} onChange={(color) => edit({ bgBorder: { color, width: st.bgBorder?.width ?? 2 } })} />
        <UndoSlider
          label={t('insp.text.box.borderWidth')}
          value={st.bgBorder?.width ?? 0}
          onChange={(width) => edit({ bgBorder: { color: st.bgBorder?.color ?? '#ffffff', width } })}
          min={0}
          max={12}
          step={0.5}
          fmt={(v) => v.toFixed(1)}
        />
      </SubSection>
      <SubSection id="Layout" title={t('insp.text.layout')}>
        <UndoSliderNum
          label={t('insp.clip.rotate')}
          value={((st.rotate ?? 0) * 180) / Math.PI}
          onChange={(deg) => edit({ rotate: (deg * Math.PI) / 180 })}
          min={-180}
          max={180}
          step={1}
          suffix="°"
        />
        <UndoSlider
          label={t('insp.fitWidth')}
          value={st.fitWidth ?? 0}
          onChange={(fitWidth) => edit({ fitWidth })}
          min={0}
          max={1}
          step={0.01}
          fmt={(v) => (v <= 0 ? t('f9y.offLower') : fmtPct(v))}
        />
      </SubSection>
      {/* (cila4, 4: the user, "style should be on top": the look first,
          then where it stands and how it moves.) */}
      <TextKeyframes caption={caption} />
      <FollowTracker value={caption.trackerId} onChange={(id) => updateCaption(caption.id, { trackerId: id ?? undefined })} />
      <Field label={t('insp.text.animIn')}>
        <Select value={caption.anim?.in ?? 'none'} options={TEXT_ANIMS.map((v) => ({ value: v, label: t(`insp.text.in.${v}`) }))} onChange={(v) => updateCaption(caption.id, { anim: { ...caption.anim, in: v as TextAnim } })} />
      </Field>
      <Field label={t('insp.text.animOut')}>
        <Select value={caption.anim?.out ?? 'none'} options={TEXT_ANIMS.map((v) => ({ value: v, label: t(`insp.text.out.${v}`) }))} onChange={(v) => updateCaption(caption.id, { anim: { ...caption.anim, out: v as TextAnim } })} />
      </Field>
      {caption.anim?.in && caption.anim.in !== 'none' && (
        <>
          <Tooltip content={t('insp.text.perChar.hint')}>
            <div>
              <Toggle label={t('insp.text.perChar')} checked={caption.anim.perChar ?? false} onChange={(on) => updateCaption(caption.id, { anim: { ...caption.anim, perChar: on } })} />
            </div>
          </Tooltip>
          {caption.anim.perChar && (
            <UndoSlider
              label={t('insp.text.charDelay')}
              value={caption.anim.charStagger ?? 0.03}
              onChange={(charStagger) => updateCaption(caption.id, { anim: { ...caption.anim, charStagger } })}
              min={0}
              max={0.2}
              step={0.005}
              fmt={(v) => v.toFixed(3)}
            />
          )}
          <UndoSlider label={t('insp.text.inDur')} value={caption.anim.inDur ?? 0.35} onChange={(inDur) => updateCaption(caption.id, { anim: { ...caption.anim, inDur } })} min={0.1} max={2} step={0.01} fmt={(v) => v.toFixed(2)} />
        </>
      )}
      {caption.anim?.out && caption.anim.out !== 'none' && (
        <UndoSlider label={t('insp.text.outDur')} value={caption.anim.outDur ?? 0.35} onChange={(outDur) => updateCaption(caption.id, { anim: { ...caption.anim, outDur } })} min={0.1} max={2} step={0.01} fmt={(v) => v.toFixed(2)} />
      )}
      <Tooltip content={t('insp.text.idle.hint')}>
        <div>
          <Field label={t('insp.text.idle')}>
            <Select value={caption.anim?.idle ?? 'none'} options={TEXT_IDLES.map((v) => ({ value: v, label: t(`insp.text.idle.${v}`) }))} onChange={(v) => updateCaption(caption.id, { anim: { ...caption.anim, idle: v as never } })} />
          </Field>
        </div>
      </Tooltip>
      {caption.anim?.idle && caption.anim.idle !== 'none' && (
        <UndoSlider label={t('insp.text.idleAmount')} value={caption.anim.idleAmt ?? 1} onChange={(idleAmt) => updateCaption(caption.id, { anim: { ...caption.anim, idleAmt } })} min={0.2} max={2} step={0.1} />
      )}
      {/* Stamping one text's look onto another is something you do once you
          have settled on the look, so it comes after the controls that make
          it — not above them. */}
      <SubSection id="Copy a look" title={t('insp.text.copyLook')}>
        <div className="insp-row">
          <Tooltip content={t('insp.text.copyStyle.hint')}>
            <Button size="sm" icon="copy" onClick={() => useStore.getState().copyCaptionStyle(caption.id)}>{t('insp.text.copyStyle')}</Button>
          </Tooltip>
          <Tooltip content={t('insp.text.pasteStyle.hint')}>
            <Button size="sm" onClick={() => useStore.getState().pasteCaptionStyle(targets)}>
              {targets.length > 1 ? t('insp.text.pasteStyleN', { n: targets.length }) : t('insp.text.pasteStyle')}
            </Button>
          </Tooltip>
        </div>
      </SubSection>
      {/* Last, and closed: saving and re-applying a look is a once-a-project
          thing, and it was sitting above the controls used on every title. */}
      <SubSection id="Templates" title={t('insp.text.templates')}>
        <Tooltip content={t('insp.text.templates.apply.hint')}>
          <div>
            <Field label={t('insp.apply')}>
              <Select
                value=""
                options={[{ value: '', label: t('insp.text.templates.pick') }, ...templates.map((x) => ({ value: x.name, label: x.name }))]}
                onChange={(v) => {
                  const tpl = templates.find((x) => x.name === v)
                  if (!tpl) return
                  setCaptionOwnStyle(caption.id, tpl.style)
                  updateCaption(caption.id, { anim: tpl.anim })
                }}
              />
            </Field>
          </div>
        </Tooltip>
        {/* window.prompt is a no-op in Electron, so the old prompt-based save
            and delete silently did nothing. Both are inline controls now. */}
        <div className="insp-row">
          <TextField value={templateName} placeholder={t('insp.text.templates.name')} label={t('insp.text.templates.name')} onChange={setTemplateName} onCommit={saveTemplate} />
          <Tooltip content={t('insp.text.templates.save.hint')}>
            <Button icon="save" className="insp-fixed" onClick={saveTemplate} disabled={!templateName.trim()}>{t('insp.save')}</Button>
          </Tooltip>
          {templates.length > 0 && (
            <IconButton
              icon="trash"
              label={t('insp.text.templates.delete')}
              disabled={!templates.some((x) => x.name === templateName.trim())}
              onClick={() => {
                const next = templates.filter((x) => x.name !== templateName.trim())
                setTemplates(next)
                localStorage.setItem(TEXT_TEMPLATES_KEY, JSON.stringify(next))
              }}
            />
          )}
        </div>
      </SubSection>
      <div className="insp-row">
        <Button size="sm" variant="danger" icon="trash" onClick={() => deleteCaption(caption.id)}>{t('insp.text.delete')}</Button>
      </div>
    </Section>
  )
}
