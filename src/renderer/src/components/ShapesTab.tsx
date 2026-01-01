// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
import { useStore } from '../state/store'
import type { Caption, ShapeKind, TextAnim } from '../types'
import { toggleMarkedWords } from '../subtitles/marker'
import { Button, Field, Icon, Section, Select, Slider, SubSection, Toggle, Tooltip, useT, type IconName, type StringKey } from '../ui'
import { useGestureOnce } from './undo-gesture'
import { BareButton } from '../ui/Button'

const KINDS: [ShapeKind, IconName][] = [
  ['rect', 'square'],
  ['marker', 'highlighter'],
  ['circle', 'circle'],
  ['line', 'minus'],
  ['arrow', 'move-up-right']
]

/** The kinds a shape can be (the Effects page's search: REF-AB item 6). */
export const SHAPE_KINDS: readonly ShapeKind[] = KINDS.map(([k]) => k)

const ANIMS: TextAnim[] = ['none', 'fade', 'zoom', 'slide', 'drop', 'pop', 'grow', 'blur']
const IDLES = ['none', 'float', 'sway', 'pulse'] as const

/** The arrow's four directions: its icon and its turn in degrees. */
const DIRECTIONS: [IconName, number, StringKey][] = [
  ['arrow-right', 0, 'shapes.point.right'],
  ['arrow-down', 90, 'shapes.point.down'],
  ['arrow-left', 180, 'shapes.point.left'],
  ['arrow-up', -90, 'shapes.point.up']
]

/** A slider that edits the project: one drag, one undo step. */
function UndoSlider(props: Omit<Parameters<typeof Slider>[0], 'gesture'>): JSX.Element {
  const gesture = useGestureOnce()
  return <Slider {...props} gesture={gesture} />
}

/** A colour input in a field row. */
function ColourField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }): JSX.Element {
  return (
    <Field label={label}>
      <input type="color" className="shape-colour" value={value} onChange={(e) => onChange(e.target.value)} />
    </Field>
  )
}

/**
 * Shapes: rectangles, highlighter markers, circles, lines and arrows.
 *
 * They are captions underneath, which is why they already have timeline chips,
 * timing, layers, dragging and rotating in the preview, entrance/exit
 * animations and motion keyframes — none of that is rebuilt here.
 *
 * DENEME-4, worker W (the left adds, the right sets what is selected): this
 * only ADDS them. A selected shape's own settings are ShapeSettings, in the
 * Inspector's Clip tab; a selected text's marked word is MarkWordControls, in
 * its Subtitles tab. Since the Text page was made clearer (YAZI-PANELI-PLAN.md
 * §5) it is the Text page's "Shapes and highlights" (it was Effects → Shapes),
 * with a frame (an empty box with a line round it), and the marker goes behind
 * the selected text when one is selected (the command's own highlightCaptionId).
 */
export function ShapesTab({ show = () => true }: { show?: (name: StringKey) => boolean }): JSX.Element {
  const t = useT()
  const addShape = useStore((s) => s.addShapeAtPlayhead)
  // The text a marker band goes behind: the one selected title, if any.
  const behind = useStore((s) => {
    const one = s.selectedCaptionIds.length === 1 ? s.project.captions.find((c) => c.id === s.selectedCaptionIds[0]) : undefined
    return one && !one.shape ? one.id : undefined
  })
  const kindName = (k: ShapeKind): string => t(`shapes.kind.${k}` as StringKey)
  // The highlighter grows across its text from nothing: at the moment it
  // starts (the playhead on the title's start, where a title is added) it
  // was not to be seen, and adding it looked like doing nothing (cila4, 6).
  // The playhead goes to where it has grown, as a title being typed in
  // brings it to where the title stands.
  const addKind = (k: ShapeKind): void => {
    const id = addShape(k, k === 'marker' ? behind : undefined)
    if (k !== 'marker') return
    const s = useStore.getState()
    const cap = s.project.captions.find((c) => c.id === id)
    if (!cap) return
    const grown = cap.start + (cap.anim?.inDur ?? 0)
    if (s.currentTime >= cap.start && s.currentTime < grown && grown < cap.end) s.setTime(grown)
  }
  const addFrame = (): void => {
    const s = useStore.getState()
    s.undoable(() => {
      const id = s.addShapeAtPlayhead('rect')
      s.setCaptionOwnStyle(id, { bgOpacity: 0, bgRadius: 10, bgColor: '#ffffff', bgBorder: { color: '#ffffff', width: 5 } })
    })
  }
  return (
    <>
      <div className="hint">{t('shapes.intro')}</div>
      <div className="shape-kind-grid">
        {KINDS.filter(([k]) => show(`shapes.kind.${k}` as StringKey)).map(([k, icon]) => (
          <Tooltip key={k} content={k === 'marker' && behind ? t('text.shape.marker.behind') : t('shapes.add.hint', { kind: kindName(k).toLowerCase() })}>
            <Button variant="secondary" size="sm" icon={icon} testid={`shapes.add.${k}`} onClick={() => addKind(k)}>
              {kindName(k)}
            </Button>
          </Tooltip>
        ))}
        {show('text.shape.frame') && (
          <Tooltip content={t('text.shape.frame.hint')}>
            <Button variant="secondary" size="sm" icon="scan" testid="shapes.add.frame" onClick={addFrame}>
              {t('text.shape.frame')}
            </Button>
          </Tooltip>
        )}
      </div>
      <div className="hint">{t('w4.shapes.where')}</div>
    </>
  )
}

/** The selected text's word at the playhead, marked with a band (the
 *  Inspector's Subtitles tab, under the selected line or text). */
export function MarkWordControls({ caption }: { caption: Caption }): JSX.Element {
  const t = useT()
  const setStyle = useStore((s) => s.setCaptionOwnStyle)
  const currentTime = useStore((s) => s.currentTime)
  const textMarker = caption.style?.marker
  const playheadWord = caption.words?.length
    ? Math.max(0, caption.words.reduce((last, word, index) => word.start <= currentTime ? index : last, -1))
    : 0
  return (
    <Section id="Marked word" icon="highlighter" title={t('w4.markWord.title')} data-section="mark-word">
      <Tooltip content={t('shapes.markWord.hint')}>
        <Button
          variant="secondary"
          pressed={!!textMarker?.enabled}
          className="shape-highlight-action"
          testid="subs.mark-word"
          onClick={() =>
            useStore.getState().undoable(() =>
              setStyle(caption.id, {
                marker: toggleMarkedWords(textMarker, [playheadWord])
              })
            )
          }
        >
          {textMarker?.words?.includes(playheadWord) ? t('shapes.unmarkWord') : t('shapes.markWord')}
        </Button>
      </Tooltip>
      {textMarker?.enabled && (
        <div className="shape-text-marker-controls">
          <ColourField label={t('shapes.band')} value={textMarker.color} onChange={(color) => setStyle(caption.id, { marker: { ...textMarker, color } })} />
          <UndoSlider label={t('shapes.sweep')} value={textMarker.duration} onChange={(duration) => setStyle(caption.id, { marker: { ...textMarker, duration } })} min={0.1} max={1.5} step={0.01} unit="s" />
        </div>
      )}
    </Section>
  )
}

/** The selected shape's own settings (the Inspector's Clip tab). */
export function ShapeSettings({
  sel,
  keyframes
}: {
  sel: Caption
  /** The shared motion/keyframe panel, passed in so this file doesn't have to
   *  import back into the inspector. */
  keyframes: (caption: Caption) => JSX.Element
}): JSX.Element {
  const t = useT()
  const setShape = useStore((s) => s.setCaptionShape)
  const setStyle = useStore((s) => s.setCaptionOwnStyle)
  const updateCaption = useStore((s) => s.updateCaption)
  const deleteCaption = useStore((s) => s.deleteCaption)
  const kindName = (k: ShapeKind): string => t(`shapes.kind.${k}` as StringKey)
  const animName = (a: string): string => t(`shapes.anim.${a}` as StringKey)
  if (!sel.shape) return <div className="hint">{t('shapes.selectShape')}</div>

  return (
    <Section id="Selected shape" icon="shapes" title={kindName(sel.shape.kind)} data-section="shape" testid="inspector.shape">
          <SubSection id="Shape" title={t('shapes.sub.shape')} open>
            <Field label={t('shapes.kind')}>
              <Select value={sel.shape.kind} options={KINDS.map(([k]) => ({ value: k, label: kindName(k) }))} onChange={(v) => setShape(sel.id, { kind: v as ShapeKind })} />
            </Field>
            <UndoSlider label={t('shapes.width')} value={sel.shape.w} onChange={(w) => setShape(sel.id, { w })} min={0.01} max={1.6} step={0.005} scale={100} unit="%" decimals={0} />
            <UndoSlider label={t('shapes.height')} value={sel.shape.h} onChange={(h) => setShape(sel.id, { h })} min={0.004} max={1.6} step={0.004} scale={100} unit="%" decimals={0} />
            <Tooltip content={t('shapes.drawOn.hint')}>
              <div>
                <Toggle
                  label={t('shapes.drawOn')}
                  checked={sel.shape.reveal ?? false}
                  onChange={(on) => {
                    setShape(sel.id, { reveal: on })
                    // The wipe rides on the entrance, so make sure there is one.
                    if (on && (!sel.anim?.in || sel.anim.in === 'none')) {
                      updateCaption(sel.id, {
                        anim: { ...sel.anim, in: 'fade', inDur: sel.anim?.inDur ?? 0.35 }
                      })
                    }
                  }}
                />
              </div>
            </Tooltip>
            <ColourField label={t('shapes.fill')} value={sel.style?.bgColor ?? '#ffe14d'} onChange={(bgColor) => setStyle(sel.id, { bgColor })} />
            {(sel.shape.kind === 'marker' || sel.shape.kind === 'arrow') && (
              <div className="shape-quick-row" role="group" aria-label={t('shapes.quickColours')}>
                {['#f1ef00', '#4de5d0', '#ff79a8', '#f2f7f7'].map((color) => (
                  <Tooltip key={color} content={t('shapes.useColour', { c: color })}>
                    <BareButton
                      type="button"
                      aria-label={t('shapes.useColour', { c: color })}
                      className={sel.style?.bgColor?.toLowerCase() === color ? 'on' : ''}
                      style={{ '--swatch': color } as React.CSSProperties}
                      onClick={() => setStyle(sel.id, { bgColor: color })}
                    />
                  </Tooltip>
                ))}
              </div>
            )}
            {sel.shape.kind === 'arrow' && (
              <div className="shape-direction-row" role="group" aria-label={t('shapes.direction')}>
                {DIRECTIONS.map(([icon, deg, label]) => (
                  <Tooltip key={icon} content={t(label)}>
                    <BareButton type="button" aria-label={t(label)} onClick={() => setStyle(sel.id, { rotate: (deg * Math.PI) / 180 })}>
                      <Icon name={icon} size={14} />
                    </BareButton>
                  </Tooltip>
                ))}
              </div>
            )}
            <UndoSlider label={t('shapes.opacity')} value={sel.style?.bgOpacity ?? 0.82} onChange={(bgOpacity) => setStyle(sel.id, { bgOpacity })} min={0} max={1} step={0.01} />
            {sel.shape.kind === 'marker' && <div className="hint">{t('shapes.marker.hint')}</div>}
            {(sel.shape.kind === 'rect' || sel.shape.kind === 'line') && (
              <UndoSlider label={t('shapes.radius')} value={sel.style?.bgRadius ?? 0} onChange={(bgRadius) => setStyle(sel.id, { bgRadius })} min={0} max={80} step={1} />
            )}
            {(sel.shape.kind === 'rect' || sel.shape.kind === 'line' || sel.shape.kind === 'circle') && (
              <>
                <ColourField
                  label={t('shapes.border')}
                  value={sel.style?.bgBorder?.color ?? '#ffffff'}
                  onChange={(color) => setStyle(sel.id, { bgBorder: { color, width: sel.style?.bgBorder?.width ?? 2 } })}
                />
                <UndoSlider
                  label={t('shapes.borderWidth')}
                  value={sel.style?.bgBorder?.width ?? 0}
                  onChange={(width) => setStyle(sel.id, { bgBorder: { color: sel.style?.bgBorder?.color ?? '#ffffff', width } })}
                  min={0}
                  max={16}
                  step={0.5}
                />
              </>
            )}
            <Tooltip content={t('shapes.glow.hint')}>
              <div>
                <Toggle
                  label={t('shapes.glow')}
                  checked={sel.style?.shadow?.enabled ?? false}
                  onChange={(enabled) =>
                    setStyle(sel.id, {
                      shadow: {
                        color: sel.style?.shadow?.color ?? sel.style?.bgColor ?? '#ffe14d',
                        blur: sel.style?.shadow?.blur ?? 26,
                        dx: 0,
                        dy: 0,
                        enabled
                      }
                    })
                  }
                />
              </div>
            </Tooltip>
            {sel.style?.shadow?.enabled && (
              <>
                <ColourField label={t('shapes.glowColour')} value={sel.style.shadow.color} onChange={(color) => setStyle(sel.id, { shadow: { ...sel.style!.shadow!, color } })} />
                <UndoSlider label={t('shapes.glowSize')} value={sel.style.shadow.blur} onChange={(blur) => setStyle(sel.id, { shadow: { ...sel.style!.shadow!, blur } })} min={0} max={90} step={1} />
              </>
            )}
            <UndoSlider
              label={t('shapes.rotate')}
              value={Math.min(180, Math.max(-180, ((sel.style?.rotate ?? 0) * 180) / Math.PI))}
              onChange={(deg) => setStyle(sel.id, { rotate: (deg * Math.PI) / 180 })}
              min={-180}
              max={180}
              step={1}
              unit="°"
            />
          </SubSection>

          <SubSection id="Animation" title={t('shapes.sub.animation')}>
            <Field label={t('shapes.in')}>
              <Select value={sel.anim?.in ?? 'none'} options={ANIMS.map((v) => ({ value: v, label: animName(v) }))} onChange={(v) => updateCaption(sel.id, { anim: { ...sel.anim, in: v as TextAnim } })} />
            </Field>
            <UndoSlider label={t('shapes.inDur')} value={sel.anim?.inDur ?? 0.35} onChange={(inDur) => updateCaption(sel.id, { anim: { ...sel.anim, inDur } })} min={0.05} max={2} step={0.01} unit="s" />
            <Field label={t('shapes.out')}>
              <Select value={sel.anim?.out ?? 'none'} options={ANIMS.map((v) => ({ value: v, label: animName(v) }))} onChange={(v) => updateCaption(sel.id, { anim: { ...sel.anim, out: v as TextAnim } })} />
            </Field>
            <UndoSlider label={t('shapes.outDur')} value={sel.anim?.outDur ?? 0.35} onChange={(outDur) => updateCaption(sel.id, { anim: { ...sel.anim, outDur } })} min={0.05} max={2} step={0.01} unit="s" />
            <Field label={t('shapes.idle')}>
              <Select value={sel.anim?.idle ?? 'none'} options={IDLES.map((v) => ({ value: v, label: animName(v) }))} onChange={(v) => updateCaption(sel.id, { anim: { ...sel.anim, idle: v as never } })} />
            </Field>
          </SubSection>

          {keyframes(sel)}
          <Button variant="danger" icon="trash" className="shape-delete" testid="shapes.delete" onClick={() => deleteCaption(sel.id)}>
            {t('shapes.delete')}
          </Button>
    </Section>
  )
}
