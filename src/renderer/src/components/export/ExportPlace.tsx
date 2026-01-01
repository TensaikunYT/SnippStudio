// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// The export window's name, place and cover (REF-AB item 11,
// REF-AB-PLAN-P.md). The name is typed in the window; the place is the last
// export folder (the profile remembers which, the main process checks it is
// one the user chose: main/ipc/export-place-ipc.ts); only the folder button
// opens a system window. The cover is a frame of the film written beside the
// video as a PNG (never put inside the video).
import { useEffect, useState } from 'react'
import { api } from '../../platform'
import { exportFramePng } from '../../export/exporter'
import { useStore } from '../../state/store'
import { projectDuration } from '../../types'
import { Button, Checkbox, Field, IconButton, Slider, TextField, useT } from '../../ui'
import { fmtTime } from '../../ui/format'
import { stemProblem } from '../../../../shared/export-place'

const DIR_KEY = 'snipp-export-dir'
const COVER_KEY = 'snipp-export-cover'

const read = (key: string): string | null => {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}
const write = (key: string, v: string): void => {
  try {
    localStorage.setItem(key, v)
  } catch {
    /* not kept */
  }
}

/** The place: the remembered folder when the main process still knows it
 *  (null: none yet, the first export asks with the save window). */
export function useExportPlace(): { place: string | null; choose: () => Promise<void>; set: (dir: string) => void } {
  const [place, setPlace] = useState<string | null>(null)
  useEffect(() => {
    const was = read(DIR_KEY)
    if (!was || !api?.exportPlace) return
    let live = true
    void api.exportPlace.known(was).then((dir) => live && setPlace(dir))
    return () => {
      live = false
    }
  }, [])
  const set = (dir: string): void => {
    setPlace(dir)
    write(DIR_KEY, dir)
  }
  const choose = async (): Promise<void> => {
    const dir = await api?.exportPlace?.chooseFolder(place ?? undefined)
    if (dir) set(dir)
  }
  return { place, choose, set }
}

/** The name and place fields. */
export function NamePlace({ stem, onStem, place, onChoose }: { stem: string; onStem: (s: string) => void; place: string | null; onChoose: () => void }): JSX.Element {
  const t = useT()
  const bad = stemProblem(stem) !== null
  return (
    <div className="xw-where" data-testid="export.where">
      <Field label={t('refp.export.name')} hint={bad ? t('refp.export.name.bad') : undefined}>
        <TextField size="sm" value={stem} onChange={onStem} invalid={bad} label={t('refp.export.name')} testid="export.name" />
      </Field>
      <Field label={t('refp.export.place')} hint={t('refp.export.place.hint')}>
        <div className="xw-place">
          <TextField size="sm" readOnly onChange={() => undefined} value={place ?? ''} placeholder={t('refp.export.place.none')} label={t('refp.export.place')} testid="export.place" title={place ?? undefined} />
          {api && <IconButton size="sm" variant="secondary" icon="folder-open" label={t('refp.export.place.choose')} onClick={onChoose} testid="export.place.choose" />}
        </div>
      </Field>
    </div>
  )
}

/** Whether the cover is written: remembered, off until ticked once (an
 *  extra file nobody asked for is not written). */
export function useCoverOn(): [boolean, (on: boolean) => void] {
  const [on, setOn] = useState(() => read(COVER_KEY) === '1')
  return [
    on,
    (v) => {
      setOn(v)
      write(COVER_KEY, v ? '1' : '0')
    }
  ]
}

/** The cover: a small picture of the frame, whether it is written, and
 *  "Change the cover" (the playhead's frame or a moment of the film). */
export function CoverPick({ on, onOn, at, onAt, size }: { on: boolean; onOn: (v: boolean) => void; at: number; onAt: (t: number) => void; size: { w: number; h: number } }): JSX.Element {
  const t = useT()
  const project = useStore((s) => s.project)
  const playhead = useStore((s) => s.currentTime)
  const dur = Math.max(0, projectDuration(project))
  const [url, setUrl] = useState<string | null>(null)
  const [open, setOpen] = useState(false)
  // The frame drawn by the program's own renderer (draft quality: a small
  // picture), a moment after the last change of the moment.
  useEffect(() => {
    if (!on) return
    let live = true
    let made: string | null = null
    const id = window.setTimeout(() => {
      void exportFramePng(project, at, true, 'draft')
        .then((png) => {
          if (!live) return
          made = URL.createObjectURL(new Blob([png as BlobPart], { type: 'image/png' }))
          setUrl(made)
        })
        .catch(() => live && setUrl(null))
    }, 250)
    return () => {
      live = false
      window.clearTimeout(id)
      if (made) URL.revokeObjectURL(made)
    }
  }, [project, at, on])
  return (
    <div className="xw-cover" data-testid="export.cover">
      <div className="xw-head">{t('refp.export.cover')}</div>
      {on && (
        <div className="xw-cover-pic" style={{ aspectRatio: `${size.w} / ${size.h}` }}>
          {url ? <img src={url} alt={t('refp.export.cover.time', { time: fmtTime(at) })} data-testid="export.cover.img" /> : <span className="xw-cover-wait">{t('refp.export.cover.drawing')}</span>}
        </div>
      )}
      <Checkbox label={t('refp.export.cover.write')} checked={on} onChange={onOn} testid="export.cover.on" />
      <p className="xw-hint">{t('refp.export.cover.hint')}</p>
      {on && (
        <Button size="sm" variant="ghost" icon="image" pressed={open} onClick={() => setOpen(!open)} testid="export.cover.change">
          {t('refp.export.cover.change')}
        </Button>
      )}
      {on && open && (
        <div className="xw-cover-change">
          <Button size="sm" variant="secondary" icon="locate-fixed" onClick={() => onAt(playhead)} testid="export.cover.playhead">
            {t('refp.export.cover.playhead')}
          </Button>
          <Slider label={t('refp.export.cover.at')} value={Math.min(at, dur)} min={0} max={Math.max(dur, 0.01)} step={0.01} decimals={2} unit="s" onChange={onAt} testid="export.cover.at" />
        </div>
      )}
    </div>
  )
}
