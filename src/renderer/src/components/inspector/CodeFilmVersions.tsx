// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// "Back to the previous version" of a code clip's files (phase 5e, decision
// 3): one click puts the newest version kept in `anim\<name>\.surumler\`
// back (the files as they are now become a version too); the next click goes
// one further back. Only for a code clip's own folder (anim\<name>). Over the
// 2 MB of a version nothing is kept and nothing put back: the row says so
// (audit D2).
import { useEffect, useState } from 'react'
import { api } from '../../platform'
import { codeFilms } from '../../media/codefilm'
import type { Asset } from '../../types'
import { Button, confirmDialog, notify, Tooltip, useT } from '../../ui'

export function CodeFilmVersions({ asset }: { asset: Asset }): JSX.Element | null {
  const t = useT()
  const id = codeFilms.folderId(asset)
  const [info, setInfo] = useState<{ count: number; next: number | null; over?: boolean } | null>(null)
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    if (!id || !api?.codeFilm.versions) return
    let live = true
    const read = (): void => void api!.codeFilm.versions(id).then((r) => live && setInfo(r)).catch(() => {})
    read()
    // (A save is told by the code film module; the version is written 2 s later.)
    let timer: ReturnType<typeof setTimeout> | null = null
    const off = codeFilms.subscribe(() => {
      if (timer) clearTimeout(timer)
      timer = setTimeout(read, 2600)
    })
    return () => {
      live = false
      off()
      if (timer) clearTimeout(timer)
    }
  }, [id])
  if (!id || !asset.path || !/[\\/]anim[\\/][^\\/]+[\\/]?$/i.test(asset.path) || !info) return null
  const back = async (): Promise<void> => {
    if (!api?.codeFilm.versionBack) return
    // (Asked first: the files as they are now are replaced, and this button
    // goes further back, not forward again. It was one click: phase 11b, D24.)
    const yes = await confirmDialog({ title: t('codeFilm.versionBack'), message: t('codeFilm.versionBack.ask', { n: String(info.next ?? '') }), note: t('codeFilm.versionBack.note'), confirm: t('codeFilm.versionBack.do'), cancel: t('codeFilm.versionBack.keep'), danger: true, icon: 'rotate-ccw-clock' })
    if (!yes) return
    setBusy(true)
    try {
      const r = await api.codeFilm.versionBack(id)
      if (r.ok) notify({ text: t('codeFilm.versionDone', { n: String(r.n ?? '') }) })
      else if (r.reason === 'over-limit') notify({ text: t('codeFilm.versionOverLimit'), kind: 'error' })
      else notify({ text: t('codeFilm.versionFailed', { why: r.error ?? '' }), kind: 'error' })
      setInfo(await api.codeFilm.versions(id))
    } finally {
      setBusy(false)
    }
  }
  const none = info.next === null
  const over = !!info.over
  return (
    <div className="row" data-testid="codefilm.versions" data-count={info.count} data-over={over ? '1' : '0'}>
      <Tooltip content={over ? t('codeFilm.versionsOff') : none ? t('codeFilm.noVersion') : t('codeFilm.versionBackHint', { n: String(info.next) })}>
        <span>
          <Button icon="rotate-ccw-clock" disabled={none || over || busy} onClick={() => void back()} testid="codefilm.version-back">
            {t('codeFilm.versionBack')}
          </Button>
        </span>
      </Tooltip>
      <span className="hint is-state" data-testid="codefilm.versions-hint">{over ? t('codeFilm.versionsOff') : t('codeFilm.versionCount', { n: String(info.count) })}</span>
    </div>
  )
}
