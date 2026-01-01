// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// The left panel's pages' search line and a thing's bookmark (REF-AB item 6,
// picks.ts): a search field, then All · Favourites · Recent. `usePickView`
// holds a page's search and choice and says what it shows.
import { useMemo, useState } from 'react'
import { IconButton, Segmented, TextField, useT } from '../../ui'
import { EmptyState } from '../EmptyState'
import { usePicks, visible, type PickItem, type PickMode, type PickPage } from './picks'
import './picks.css'

export interface PickView {
  page: PickPage
  query: string
  setQuery: (q: string) => void
  mode: PickMode
  setMode: (m: PickMode) => void
  /** Search or a list chosen: the page shows only `shown`. */
  narrowed: boolean
  /** What the page shows, in its order. */
  shown: PickItem[]
  /** Whether an id is shown (every id when nothing narrows). */
  shows: (id: string) => boolean
  /** The ids shown in their order (for a grid's `only`), or undefined. */
  only: string[] | undefined
  /** A thing's bookmark. */
  mark: (id: string) => JSX.Element
}

export function usePickView(page: PickPage, items: readonly PickItem[]): PickView {
  const [query, setQuery] = useState('')
  const [mode, setMode] = useState<PickMode>('all')
  const lists = usePicks((s) => s.lists)
  const shown = useMemo(() => visible(items, lists, page, mode, query), [items, lists, page, mode, query])
  const narrowed = mode !== 'all' || query.trim().length > 0
  const ids = useMemo(() => new Set(shown.map((it) => it.id)), [shown])
  const names = useMemo(() => new Map(items.map((it) => [it.id, it.name])), [items])
  return {
    page,
    query,
    setQuery,
    mode,
    setMode,
    narrowed,
    shown,
    shows: (id) => !narrowed || ids.has(id),
    only: narrowed ? shown.map((it) => it.id) : undefined,
    mark: (id) => <PickMark page={page} id={id} name={names.get(id) ?? id} />
  }
}

/** The search field and the three lists. */
export function PickBar({ view, testid }: { view: PickView; testid: string }): JSX.Element {
  const t = useT()
  return (
    <div className="pick-bar" data-testid={testid}>
      <TextField size="sm" className="pick-search" value={view.query} placeholder={t('refp.pick.search')} label={t('refp.pick.search.label')} onChange={view.setQuery} testid={`${testid}.search`} />
      <Segmented<PickMode>
        label={t('refp.pick.show')}
        value={view.mode}
        onChange={view.setMode}
        testid={`${testid}.mode`}
        options={[
          { value: 'all', label: t('refp.pick.all') },
          { value: 'fav', label: t('refp.pick.fav'), icon: 'bookmark', hint: t('refp.pick.fav.hint') },
          { value: 'recent', label: t('refp.pick.recent'), icon: 'rotate-ccw-clock', hint: t('refp.pick.recent.hint') }
        ]}
      />
    </div>
  )
}

/** Nothing to show: no match, no favourite, nothing used yet. */
export function PickEmpty({ view, testid }: { view: PickView; testid: string }): JSX.Element | null {
  const t = useT()
  if (!view.narrowed || view.shown.length > 0) return null
  const q = view.query.trim()
  if (q)
    return <EmptyState className="pick-empty" art="search" text={t('refp.pick.noMatch', { q })} action={t('refp.pick.clear')} icon="x" onAction={() => view.setQuery('')} testid={testid} />
  return (
    <EmptyState
      className="pick-empty"
      art="effects"
      text={t(view.mode === 'fav' ? 'refp.pick.noFav' : 'refp.pick.noRecent')}
      action={t('refp.pick.showAll')}
      icon="layout-grid"
      onAction={() => view.setMode('all')}
      testid={testid}
    />
  )
}

/** A thing's bookmark: on, it is a favourite of its page. */
export function PickMark({ page, id, name }: { page: PickPage; id: string; name: string }): JSX.Element {
  const t = useT()
  const on = usePicks((s) => (s.lists.fav[page] ?? []).includes(id))
  const fav = usePicks((s) => s.fav)
  return (
    <IconButton
      size="sm"
      icon="bookmark"
      className={on ? 'pick-mark is-fav' : 'pick-mark'}
      pressed={on}
      label={t(on ? 'refp.pick.fav.remove' : 'refp.pick.fav.add', { name })}
      testid={`pick.${page}.fav.${id}`}
      onClick={(e) => {
        e.stopPropagation()
        fav(page, id)
      }}
      onPointerDown={(e) => e.stopPropagation()}
      draggable={false}
    />
  )
}
