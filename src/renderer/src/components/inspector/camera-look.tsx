// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// The camera look panel (on clips or as a look layer) and the scopes section.
// Moved out of Inspector.tsx in SnippStudio phase 2B (no change).
import { useMemo } from 'react'
import { hasLook, LOOK_PRESETS, lookName, NO_LOOK, type CameraLook } from '../../effects/look'
import { useStore } from '../../state/store'
import type { Clip } from '../../types'
import { projectDuration } from '../../types'
import { Button, Field, Section, Segmented, Select, Tooltip, useT } from '../../ui'
import { lookPresetHint, lookPresetName, lookShown } from '../../ui/data-names'
import { UndoSlider } from './sliders'
import { fmtPct } from '../../ui/format'
import { notify } from '../../ui/toast-core'

/**
 * Scope switch, in the Effects tab beside the colour tools.
 *
 * It used to be a button in the preview toolbar, which is the strip you touch
 * dozens of times an hour — and scopes are something you turn on for ten
 * minutes of grading and then forget for a week. Wrong place for it.
 */
const SCOPES = ['', 'waveform', 'parade', 'histogram'] as const

export function ScopesSection(): JSX.Element {
  const t = useT()
  const kind = useStore((s) => s.scopeKind)
  const setKind = useStore((s) => s.setScopeKind)
  return (
    <Section id="Scopes" icon="sliders-horizontal" title={t('insp.scopes.title')}>
      <div className="hint">{t('insp.scopes.hint')}</div>
      <Field label={t('insp.scopes.show')}>
        <Select value={kind ?? ''} options={SCOPES.map((v) => ({ value: v, label: t(`insp.scopes.kind.${v || 'off'}`) }))} onChange={(v) => setKind((v || null) as never)} />
      </Field>
    </Section>
  )
}
/**
 * The camera look: on the selected clips' own picture, or as a look layer —
 * a layer on the timeline with a length, lying over the tracks below it, or
 * those and the graphics, or everything but the subtitles. With nothing
 * selected a preset makes a new layer at the playhead.
 */
const LOOK_OVER = ['below', 'graphics', 'all'] as const
const V_SHAPES = ['round', 'sides', 'bars'] as const
const V_MOTIONS = ['still', 'breathe', 'drift', 'sweep'] as const
type Dial = 'grain' | 'weave' | 'halation' | 'fade' | 'flicker' | 'dust' | 'mono' | 'vignette' | 'bars' | 'gate'

/** Puts the focus back in the field named `label` once the panel is drawn
 *  again (a few frames: the new layer's panel may take one to appear). */
export function refocusField(label: string, tries = 4): void {
  requestAnimationFrame(() => {
    if (document.activeElement instanceof HTMLInputElement && document.activeElement.getAttribute('aria-label') === label) return
    const el = [...document.querySelectorAll('input')].find((x) => x.getAttribute('aria-label') === label && x.offsetParent !== null)
    if (el) el.focus()
    else if (tries > 1) refocusField(label, tries - 1)
  })
}

/** The first look layer the panel makes in a run is announced (once). */
let toldLookLayer = false

/** Scrolls the panel that holds `el` so it is back at `top` (px from the
 *  window's top) once the page is drawn again: the next two frames. */
export function keepOnScreen(el: HTMLElement, top: number, tries = 2): void {
  requestAnimationFrame(() => {
    if (el.isConnected) {
      const delta = el.getBoundingClientRect().top - top
      if (Math.abs(delta) >= 1) {
        let box: HTMLElement | null = el.parentElement
        while (box && !(box.scrollHeight > box.clientHeight + 1 && /(auto|scroll)/.test(getComputedStyle(box).overflowY))) box = box.parentElement
        if (box) box.scrollTop += delta
      }
    }
    if (tries > 1) keepOnScreen(el, top, tries - 1)
  })
}

export function CameraLookPanel({ only, layer }: { only?: string[]; layer?: string }): JSX.Element {
  const t = useT()
  const projectLook = useStore((s) => s.project.cameraLook)
  const firstLook = useStore((s) => (only?.length ? s.project.clips[only[0]]?.look : undefined))
  // A look layer: the one given, or the one selected.
  const selLayer = useStore((s) => {
    if (layer) return layer
    const id = s.selectedClipIds.length === 1 ? s.selectedClipIds[0] : null
    return id && s.project.clips[id]?.adjustment ? id : null
  })
  const layerClip = useStore((s) => (selLayer ? s.project.clips[selLayer] : undefined))
  const lTracks = useStore((s) => s.project.tracks)
  const lClips = useStore((s) => s.project.clips)
  const layers = useMemo(
    () => lTracks.flatMap((tr) => (tr.kind === 'video' ? tr.clipIds : [])).map((id) => lClips[id]).filter((c): c is Clip => !!c?.adjustment && !!c.cameraLook && hasLook(c.cameraLook)),
    [lTracks, lClips]
  )
  const setProjectLook = useStore((s) => s.setCameraLook)
  const setClipLook = useStore((s) => s.setClipLook)
  const asLayer = !only && !!layerClip
  const look = only ? firstLook : asLayer ? layerClip!.cameraLook : undefined
  const setLook = (l: CameraLook | null, _commit?: boolean): void => {
    const st = useStore.getState()
    if (only) setClipLook(only, l)
    else if (asLayer) st.setLayerLook(layerClip!.id, l)
    else if (l) {
      // Nothing to put it on: a new look layer over the whole video (an
      // empty one: five seconds at the playhead). DENEME-1-PLAN-C.md, item 1:
      // it was five seconds at the playhead, a small block the user took
      // for "something empty" added to the timeline.
      const end = projectDuration(st.project)
      const [from, to] = end > 0.5 ? [0, end] : [st.currentTime, st.currentTime + 5]
      // (The new layer is selected and this panel drawn again for it: the
      // field the user is in keeps the focus. It fell to the page, where the
      // next ↑ was "previous cut" and Backspace deleted the layer: phase 11b, U10.)
      const field = document.activeElement instanceof HTMLInputElement ? document.activeElement.getAttribute('aria-label') : null
      // The control in use stays where it is on the screen: the panel above
      // it grows (the "Lies over" row), and it used to slide away.
      const anchor = document.activeElement instanceof HTMLElement && document.activeElement !== document.body ? document.activeElement : null
      const top = anchor?.getBoundingClientRect().top ?? 0
      st.addLookLayer(l, from, to)
      if (field) refocusField(field)
      if (anchor) keepOnScreen(anchor, top)
      if (!toldLookLayer) {
        toldLookLayer = true
        notify({ text: t('den1c.look.layerAdded'), kind: 'info' })
      }
    }
  }
  const cur = look ?? NO_LOOK
  const set = (patch: Partial<CameraLook>): void => setLook({ ...cur, ...patch }, true)
  const dial = (key: Dial): JSX.Element => (
    <UndoSlider key={key} label={t(`insp.look.${key}`)} value={cur[key]} min={0} max={1} step={0.01} fmt={(v) => (v <= 0 ? t('f9y.off') : fmtPct(v))} onChange={(v) => set({ [key]: v } as Partial<CameraLook>)} />
  )
  const over = layerClip?.lookOver ?? 'below'
  return (
    <Section id="Camera look" icon="camera" title={t('insp.look.title')}>
      <div className="hint">
        {only
          ? only.length === 1
            ? t('insp.look.onClip')
            : t('insp.look.onClips', { n: only.length })
          : asLayer
            ? t('insp.look.asLayer', { from: layerClip!.start.toFixed(1), to: (layerClip!.start + layerClip!.duration).toFixed(1) })
            : t('insp.look.newLayer')}
      </div>
      {asLayer && (
        // A list, not a row of parts: the three names are long and ran into
        // each other in a narrow Inspector (DENEME-1, P3). The chosen one's
        // meaning is its tip.
        <Tooltip content={t(`insp.look.over.${over}.hint`)}>
          <div>
            <Field label={t('insp.look.over')}>
              <Select
                value={over}
                testid="inspector.look.over"
                options={LOOK_OVER.map((v) => ({ value: v, label: t(`insp.look.over.${v}`), hint: t(`insp.look.over.${v}.hint`) }))}
                onChange={(v) => useStore.getState().setLookOver(layerClip!.id, v as (typeof LOOK_OVER)[number])}
              />
            </Field>
          </div>
        </Tooltip>
      )}
      {!only && !asLayer && hasLook(projectLook) && (
        <div className="insp-note">
          <span>{t('insp.look.legacy')}</span>
          <div className="insp-row">
            <Button
              size="sm"
              onClick={() => {
                const st = useStore.getState()
                st.addLookLayer(projectLook!, 0, Math.max(1, projectDuration(st.project)), 'all')
                st.setCameraLook(null)
              }}
            >
              {t('insp.look.toLayer')}
            </Button>
            <Button size="sm" variant="danger" onClick={() => setProjectLook(null, true)}>{t('insp.look.removeIt')}</Button>
          </div>
        </div>
      )}
      {!only && !asLayer && layers.length > 0 && (
        <div className="insp-list">
          {layers.map((c) => (
            <Tooltip key={c.id} content={t('insp.look.select')}>
              <Button
                size="sm"
                variant="ghost"
                icon="contrast"
                onClick={() => {
                  const st = useStore.getState()
                  st.selectClip(c.id)
                  st.setTime(c.start + 0.01)
                }}
              >
                {t('insp.look.layerRow', { name: lookShown(lookName(c.cameraLook), LOOK_PRESETS), from: c.start.toFixed(1), to: (c.start + c.duration).toFixed(1) })}
              </Button>
            </Tooltip>
          ))}
        </div>
      )}
      <div className="insp-grid">
        <Button size="sm" pressed={!hasLook(look)} onClick={() => setLook(null)}>{t('insp.none')}</Button>
        {LOOK_PRESETS.map((p) => (
          <Tooltip key={p.id} content={lookPresetHint(p.id)}>
            <Button size="sm" onClick={() => setLook(p.look)}>{lookPresetName(p.id)}</Button>
          </Tooltip>
        ))}
      </div>
      <div className="insp-group">{t('insp.look.group.film')}</div>
      {dial('grain')}
      {dial('weave')}
      {dial('halation')}
      {dial('fade')}
      {dial('flicker')}
      {dial('dust')}
      {dial('mono')}
      <div className="insp-group">{t('insp.look.group.vignette')}</div>
      {dial('vignette')}
      <div className="insp-stack">
        <span className="insp-stack-label">{t('insp.look.vShape')}</span>
        <Segmented value={cur.vShape} label={t('insp.look.vShape')} options={V_SHAPES.map((v) => ({ value: v, label: t(`insp.look.vShape.${v}`) }))} onChange={(v) => set({ vShape: v })} />
      </div>
      <div className="insp-stack">
        <span className="insp-stack-label">{t('insp.look.vMotion')}</span>
        <Segmented value={cur.vMotion} label={t('insp.look.vMotion')} options={V_MOTIONS.map((v) => ({ value: v, label: t(`insp.look.vMotion.${v}`) }))} onChange={(v) => set({ vMotion: v })} />
      </div>
      {cur.vMotion !== 'still' && <UndoSlider label={t('insp.speed')} value={cur.vSpeed} min={0.2} max={2} step={0.01} fmt={(v) => `${v.toFixed(2)}×`} onChange={(v) => set({ vSpeed: v })} />}
      <div className="insp-group">{t('insp.look.group.frame')}</div>
      {dial('bars')}
      {dial('gate')}
    </Section>
  )
}
