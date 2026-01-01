// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// The your-camera map's own fields: its camera keys (made by dragging and
// scrolling the map in the preview, or here), each place and when the camera
// reaches it — and, for both maps, whether the video keeps playing in a
// window while the map is on.

import { useStore } from '../state/store'
import { atlasCamera, findTemplate, mapHasPip, mapPlaces, mapTimes, mapZoomFor, setAtlasKey } from '../templates/model'
import type { Project, TemplateBlock } from '../types'
import { gridLocal } from '../timeline/key-grid'
import { Button, IconButton, Segmented, Toggle, Tooltip, useT } from '../ui'
import { UndoNumber } from './inspector/sliders'

function edit(fn: (p: Project) => void, mergeKey?: string): void {
  useStore.getState().editTemplates(fn, true, mergeKey)
}

/** Keep the video in a window at the bottom left, or give the map the frame. */
export function MapWindow({ b }: { b: TemplateBlock }): JSX.Element {
  const t = useT()
  const on = mapHasPip(b)
  return (
    <Tooltip content={t('tpl.map.window.hint')}>
      <div>
        <Toggle label={t('tpl.map.window')} checked={on} onChange={(v) => edit((p) => { const tp = findTemplate(p, b.id); if (tp) tp.pip = v })} />
      </div>
    </Tooltip>
  )
}

/** Places picked by clicking the map in the preview: a new one per click, or
 *  one place moved to where you click. Finding them by name still works. */
export function MapPickBar({ b }: { b: TemplateBlock }): JSX.Element {
  const t = useT()
  const pick = useStore((s) => s.mapPick)
  const setPick = useStore((s) => s.setMapPick)
  const adding = pick?.tplId === b.id && pick.itemId === null
  return (
    <div className="insp-stack">
      <span className="insp-stack-label">{t('tpl.map.pick')}</span>
      <div className="insp-chips">
        <Tooltip content={t('tpl.map.pick.add.hint')}>
          <Button size="sm" icon={adding ? 'check' : 'map-pin'} pressed={adding} onClick={() => setPick(adding ? null : { tplId: b.id, itemId: null })}>
            {adding ? t('tpl.map.pick.done') : t('tpl.map.pick.add')}
          </Button>
        </Tooltip>
        {b.items.map((it) => {
          const on = pick?.tplId === b.id && pick.itemId === it.id
          return (
            <Tooltip key={it.id} content={t('tpl.map.pick.put', { name: it.title || t('tpl.map.thisPlace') })}>
              <Button size="sm" icon="map-pin" pressed={on} onClick={() => setPick(on ? null : { tplId: b.id, itemId: it.id })}>
                {it.title || t('tpl.empty')}
              </Button>
            </Tooltip>
          )
        })}
      </div>
      {pick?.tplId === b.id && <div className="hint">{pick.itemId ? t('tpl.map.pick.help.one') : t('tpl.map.pick.help.new')}</div>}
    </div>
  )
}

export function AtlasFields({ b }: { b: TemplateBlock }): JSX.Element {
  const t = useT()
  const now = useStore((s) => s.currentTime)
  const local = now - b.start
  const inside = local >= 0 && local <= b.duration
  const keys = b.cams ?? []
  const at = mapTimes(b).at
  const places = mapPlaces(b)
  const keyHere = (cam: { lon: number; lat: number; z: number }): void =>
    edit((p) => {
      const tp = findTemplate(p, b.id)
      if (tp) setAtlasKey(tp, Math.max(0, Math.min(b.duration, local)), cam, p.settings.fps)
    })
  const setKey = (i: number, patch: Partial<{ t: number; lon: number; lat: number; z: number }>): void =>
    edit((p) => {
      const tp = findTemplate(p, b.id)
      const k = tp?.cams?.[i]
      if (!tp || !k) return
      Object.assign(k, patch)
      // A typed time on the frame grid too (phase Ç2c.2, decision 1).
      k.t = Math.max(0, Math.min(tp.duration, gridLocal(k.t, tp.start, p.settings.fps)))
      k.z = Math.max(0.9, Math.min(40, k.z))
      tp.cams!.sort((p1, p2) => p1.t - p2.t)
    })
  const follow = !!b.follow
  const camera = (
    <div className="insp-stack">
      <span className="insp-stack-label">{t('tpl.atlas.camera')}</span>
      <Segmented
        value={follow ? 'follow' : 'keys'}
        label={t('tpl.atlas.camera')}
        options={[
          { value: 'follow', label: t('tpl.atlas.camera.follow'), hint: t('tpl.atlas.camera.follow.hint') },
          { value: 'keys', label: t('tpl.atlas.camera.keys'), hint: t('tpl.atlas.camera.keys.hint') }
        ]}
        onChange={(v) => edit((p) => { const tp = findTemplate(p, b.id); if (!tp) return; if (v === 'follow') tp.follow = true; else delete tp.follow })}
      />
    </div>
  )
  if (follow) {
    return (
      <>
        {camera}
        <div className="hint">{t('tpl.atlas.follow.help')}</div>
      </>
    )
  }
  return (
    <>
      {camera}
      <div className="hint">{t('tpl.atlas.keys.help')}</div>
      <div className="insp-stack">
        <span className="insp-stack-label">{t('tpl.atlas.keys')}</span>
        <div className="insp-kf-list">
          {keys.map((k, i) => (
            <div key={i} className={inside && Math.abs(local - k.t) < 0.06 ? 'insp-move-row is-now' : 'insp-move-row'}>
              <IconButton icon="diamond" size="sm" variant="ghost" label={t('tpl.atlas.key.go')} onClick={() => useStore.getState().setTime(b.start + k.t)} />
              {/* Each of these edits is its own undo step (the store's editTemplates). */}
              <UndoNumber undo={false} name={t('tpl.atlas.key.when')} value={k.t} step={0.1} digits={1} suffix="s" onChange={(v) => setKey(i, { t: v })} />
              <UndoNumber undo={false} name={t('tpl.atlas.key.lon')} value={k.lon} step={1} digits={1} onChange={(v) => setKey(i, { lon: v })} />
              <UndoNumber undo={false} name={t('tpl.atlas.key.lat')} value={k.lat} step={1} digits={1} onChange={(v) => setKey(i, { lat: v })} />
              <UndoNumber undo={false} name={t('tpl.atlas.key.zoom')} value={k.z} step={0.5} digits={1} suffix="×" onChange={(v) => setKey(i, { z: v })} />
              <IconButton
                icon="x"
                size="sm"
                variant="danger"
                label={t('tpl.atlas.key.remove')}
                disabled={keys.length <= 1}
                onClick={() => edit((p) => { const tp = findTemplate(p, b.id); if (tp?.cams && tp.cams.length > 1) tp.cams.splice(i, 1) })}
              />
            </div>
          ))}
        </div>
        <Tooltip content={inside ? t('tpl.atlas.keyHere.hint') : t('tpl.playheadFirst')}>
          <Button size="sm" icon="plus" disabled={!inside} onClick={() => keyHere(atlasCamera(b, local))}>{t('tpl.atlas.keyHere')}</Button>
        </Tooltip>
      </div>
      <div className="insp-stack">
        <span className="insp-stack-label">{t('tpl.atlas.places')}</span>
        {b.items.map((it, i) => {
          const p = places[i]
          const when = at[i]
          return (
            <div key={it.id} className="insp-kf-row">
              <span className="insp-queue-name">{it.title || t('tpl.empty')}</span>
              <span className={p && Number.isFinite(when) ? 'insp-kf-time is-auto' : 'insp-kf-time is-auto is-bad'}>{!p ? t('tpl.atlas.notFound') : Number.isFinite(when) ? t('tpl.atlas.at', { t: when.toFixed(1) }) : t('tpl.atlas.notReached')}</span>
              <Tooltip content={inside ? t('tpl.atlas.frame.hint') : t('tpl.playheadFirst')}>
                <Button size="sm" variant="ghost" disabled={!p || !inside} onClick={() => p && keyHere({ lon: p.lon, lat: p.lat, z: mapZoomFor(p) })}>{t('tpl.atlas.frame')}</Button>
              </Tooltip>
            </div>
          )
        })}
      </div>
    </>
  )
}
