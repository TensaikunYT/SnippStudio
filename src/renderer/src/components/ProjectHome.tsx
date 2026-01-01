// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
import { useEffect, useMemo, useRef, useState } from 'react'
import type { FindProgress, RecentEntry } from '../../../preload/index'
import { api } from '../platform'
import { getLastProjectPath, moveProjectPath } from '../media/projectio'
import { movePointsWithFile } from '../agent/restore'
import { useStore } from '../state/store'
import {
  clearCache,
  fmtBytes,
  folderOf,
  getCacheSize,
  loadRecents,
  removeRecent,
  renameRecent
} from '../media/recents'
import { buildDate, whenAgo } from '../ui/data-names'
import { Button, Icon, IconButton, localizeMessage, notify, Select, TextField, Tooltip, t, useModalFocus, useT, type StringKey } from '../ui'
import { BareButton } from '../ui/Button'
import { requestShell } from './app/requests'
import { confirmDialog } from '../ui/confirm'
import { fmtTime, projectNameShown } from '../ui/format'
import { EmptyArt } from './empty-art'
import { EmptyState } from './EmptyState'

/** "1 project", "3 folders" (ui/strings-3c.ts). */
const count = (n: number, what: 'project' | 'folder'): string => t(`home.${what}.${n === 1 ? 'one' : 'many'}` as StringKey, { n: n.toLocaleString() })

type SortKey = 'recent' | 'name' | 'size'

/**
 * CapCut-style Projects home. Opened on demand from the top-bar "Projects"
 * button (NOT at launch, so it never slows startup). Lists recent projects
 * with playhead thumbnails, and hosts the "Clear cache" tool.
 */
export function ProjectHome({
  onClose,
  onOpenRecent,
  onNew,
  onOpenDialog
}: {
  onClose: () => void
  onOpenRecent: (path: string) => void
  onNew: () => void
  onOpenDialog: () => void
}): JSX.Element {
  useT()
  const [recents, setRecents] = useState<RecentEntry[]>([])
  // (Read once: the empty list's picture waits for it, no flash.)
  const [loaded, setLoaded] = useState(false)
  const [query, setQuery] = useState('')
  const [sort, setSort] = useState<SortKey>('recent')
  const [cacheBytes, setCacheBytes] = useState<number | null>(null)
  const [clearing, setClearing] = useState(false)
  const [editing, setEditing] = useState<string | null>(null)
  const [editVal, setEditVal] = useState('')
  // "Find projects": its progress while it runs, then what it found.
  const [finding, setFinding] = useState<FindProgress | null>(null)
  const [findNote, setFindNote] = useState('')
  // Modal for the keyboard too (audit E6): the focus moves in (the search
  // field), Tab stays inside, and goes back to what opened it.
  const panel = useRef<HTMLDivElement | null>(null)
  const trap = useModalFocus(panel, true, '.projects-head .ui-btn')

  const refresh = (): void => {
    void loadRecents().then((list) => {
      setRecents(list)
      setLoaded(true)
    })
  }

  const handleFind = async (): Promise<void> => {
    if (!api || finding) return
    setFindNote('')
    const stop = api.onFindProgress((p) => setFinding(p))
    try {
      setFinding({ phase: 'search', dirs: 0, found: 0, current: '' })
      const r = await api.findProjects()
      if (!r) return
      if (r.cancelled) setFindNote(t('home.find.stopped', { projects: count(r.added, 'project') }))
      else if (r.found === 0) setFindNote(t('home.find.none', { folders: count(r.dirs, 'folder') }))
      else
        setFindNote(
          t('home.find.found', { projects: count(r.found, 'project'), folders: count(r.dirs, 'folder') }) +
            ' ' +
            (r.added > 0 ? t('home.find.new', { n: r.added.toLocaleString() }) : t('home.find.allListed')) +
            (r.truncated ? ' ' + t('home.find.limit') : '')
        )
      refresh()
    } catch (err) {
      setFindNote(localizeMessage(err instanceof Error ? err.message : String(err)))
    } finally {
      stop()
      setFinding(null)
    }
  }
  useEffect(() => {
    refresh()
    void getCacheSize().then(setCacheBytes)
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase()
    const list = q ? recents.filter((r) => r.name.toLowerCase().includes(q)) : recents.slice()
    if (sort === 'name') list.sort((a, b) => a.name.localeCompare(b.name))
    else if (sort === 'size') list.sort((a, b) => b.sizeBytes - a.sizeBytes)
    else list.sort((a, b) => b.lastOpened - a.lastOpened)
    return list
  }, [recents, query, sort])

  const handleTrash = async (e: RecentEntry): Promise<void> => {
    if (!(await confirmDialog({ title: t('ask.trash.title'), message: t('home.trash.ask', { name: projectNameShown(e.name) }), note: e.path, confirm: t('ask.trash.ok'), danger: true }))) return
    const res = await api?.trashProject(e.path)
    await removeRecent(e.path)
    refresh()
    if (res && !res.ok) notify({ text: t('home.trash.failed', { error: res.error ?? t('home.unknownError') }), kind: 'error' })
  }

  const handleRemoveFromList = async (e: RecentEntry): Promise<void> => {
    await removeRecent(e.path)
    refresh()
  }

  // window.prompt isn't supported in Electron — rename is an inline text field.
  const commitRename = async (e: RecentEntry): Promise<void> => {
    const name = editVal.trim()
    setEditing(null)
    if (!name || name === e.name) return
    const wasOpen = getLastProjectPath() === e.path
    const newPath = await renameRecent(e.path, name)
    if (!newPath) {
      notify({ text: t('home.rename.failed'), kind: 'error' })
      return
    }
    // If this project is open in the editor, keep its name and file path in sync
    // so quick-save/autosave still write to the (now renamed) file.
    if (wasOpen) {
      useStore.getState().setProjectName(name)
      moveProjectPath(newPath)
    } else {
      // A closed project's agent restore points go with its file too.
      void movePointsWithFile(e.path, newPath)
    }
    refresh()
  }

  const handleClearCache = async (): Promise<void> => {
    if (!(await confirmDialog({ title: t('ask.cache.title'), message: t('home.cache.ask'), confirm: t('home.cache.clear'), danger: true, icon: 'eraser' }))) return
    setClearing(true)
    try {
      await clearCache()
      setCacheBytes(await getCacheSize())
    } finally {
      setClearing(false)
    }
  }

  return (
    <div className="projects-overlay" onPointerDown={onClose}>
      <div
        ref={panel}
        className="projects-panel"
        role="dialog"
        aria-modal="true"
        aria-label={t('home.title', { n: recents.length })}
        data-testid="home.panel"
        onPointerDown={(e) => e.stopPropagation()}
        onKeyDown={trap}
      >
        <div className="projects-head">
          <h2>{t('home.title', { n: recents.length })}</h2>
          <TextField className="projects-search" value={query} placeholder={t('home.search')} label={t('home.search.label')} onChange={setQuery} testid="home.search" />
          <Select
            value={sort}
            label={t('home.sort')}
            onChange={(v) => setSort(v as SortKey)}
            options={[
              { value: 'recent', label: t('home.sort.recent') },
              { value: 'name', label: t('home.sort.name') },
              { value: 'size', label: t('home.sort.size') }
            ]}
            testid="home.sort"
          />
          <IconButton variant="ghost" icon="x" label={t('home.close')} onClick={onClose} testid="home.close" />
        </div>

        {(finding || findNote) && (
          <div className="projects-find" aria-live="polite">
            <span className="status" title={finding?.current || findNote}>
              {finding
                ? finding.phase === 'read'
                  ? t('home.find.reading', { n: finding.found.toLocaleString() })
                  : t('home.find.looking', { folders: count(finding.dirs, 'folder'), projects: count(finding.found, 'project') })
                : findNote}
            </span>
            {finding ? (
              <Tooltip content={t('home.find.stop.hint')}>
                <Button variant="secondary" size="sm" onClick={() => void api?.cancelFindProjects()}>
                  {t('home.find.stop')}
                </Button>
              </Tooltip>
            ) : (
              <IconButton variant="ghost" size="sm" icon="x" label={t('home.find.hide')} onClick={() => setFindNote('')} />
            )}
          </div>
        )}

        {/* REF-AB item 1: an empty list is a first project to start. */}
        {loaded && recents.length === 0 && !finding ? (
          <div className="projects-first" data-testid="home.first">
            <EmptyArt kind="projects" size={96} />
            <h3>{t('refp.home.first.title')}</h3>
            <p>{t('refp.home.first.text')}</p>
            <div className="projects-first-actions">
              <Button variant="primary" icon="plus" onClick={onNew} testid="home.first.new">{t('home.new')}</Button>
              <Button variant="secondary" icon="folder-open" onClick={onOpenDialog} testid="home.first.open">{t('home.open')}</Button>
              {api && <Button variant="secondary" icon="film" onClick={() => requestShell('sample')} testid="home.first.sample">{t('home.sample')}</Button>}
            </div>
            {api && (
              <Tooltip content={t('home.find.hint')}>
                <Button variant="ghost" size="sm" icon="search" onClick={() => void handleFind()} testid="home.first.find">{t('home.find')}</Button>
              </Tooltip>
            )}
          </div>
        ) : (
        <div className="projects-grid">
          <BareButton type="button" className="project-card new" onClick={onNew} title={t('home.new.hint')} data-testid="home.new">
            <div className="new-plus"><Icon name="plus" size={24} /></div>
            <div className="project-name">{t('home.new')}</div>
          </BareButton>
          <BareButton type="button" className="project-card new" onClick={onOpenDialog} title={t('home.open.hint')} data-testid="home.open">
            <div className="new-plus"><Icon name="folder-open" size={24} /></div>
            <div className="project-name">{t('home.open')}</div>
          </BareButton>
          {api && (
            <BareButton type="button" className="project-card new" onClick={() => void handleFind()} disabled={!!finding} title={t('home.find.hint')} data-testid="home.find">
              <div className="new-plus"><Icon name="search" size={24} /></div>
              <div className="project-name">{t('home.find')}</div>
            </BareButton>
          )}
          {api && (
            <BareButton type="button" className="project-card new" onClick={() => requestShell('sample')} title={t('help.sample.hint')} data-testid="home.sample">
              <div className="new-plus"><Icon name="film" size={24} /></div>
              <div className="project-name">{t('home.sample')}</div>
            </BareButton>
          )}

          {shown.map((e) => (
            <div key={e.path} className={`project-card${e.missing ? ' missing' : ''}`}>
              {/* The card's picture is its open button: Tab reaches it, Enter
                  or Space opens the project (audit E6). */}
              <BareButton
                className="project-thumb"
                onClick={() => onOpenRecent(e.path)}
                title={e.missing ? t('home.missing.hint', { path: e.path }) : e.path}
                aria-label={t('home.openCard', { name: projectNameShown(e.name) })}
                testid="home.card.open"
              >
                {e.thumbnail ? <img src={e.thumbnail} alt="" /> : <div className="project-thumb-empty"><Icon name="play" size={24} /></div>}
                <span className="project-dur">{fmtTime(e.durationSec)}</span>
                {e.missing && <span className="project-missing">{t('home.missing')}</span>}
              </BareButton>
              <div className="project-meta" onClick={() => editing !== e.path && onOpenRecent(e.path)}>
                {editing === e.path ? (
                  <input
                    className="ui-input ui-size-sm project-rename"
                    autoFocus
                    aria-label={t('home.rename')}
                    value={editVal}
                    onChange={(ev) => setEditVal(ev.target.value)}
                    onClick={(ev) => ev.stopPropagation()}
                    onKeyDown={(ev) => {
                      if (ev.key === 'Enter') void commitRename(e)
                      else if (ev.key === 'Escape') setEditing(null)
                    }}
                    onBlur={() => void commitRename(e)}
                  />
                ) : (
                  <div className="project-name">{projectNameShown(e.name)}</div>
                )}
                <div className="project-sub" title={e.path}>
                  {folderOf(e.path) ? `${folderOf(e.path)} · ` : ''}
                  {fmtBytes(e.sizeBytes)} · {whenAgo(e.lastOpened)}
                </div>
              </div>
              <div className="project-actions">
                <IconButton
                  variant="ghost"
                  size="sm"
                  icon="pencil"
                  label={t('home.rename')}
                  onClick={() => {
                    setEditVal(e.name)
                    setEditing(e.path)
                  }}
                />
                <IconButton variant="ghost" size="sm" icon="folder-open" label={t('home.reveal')} onClick={() => void api?.revealPath(e.path)} />
                <IconButton variant="ghost" size="sm" icon="x" label={t('home.unlist')} onClick={() => void handleRemoveFromList(e)} />
                <IconButton variant="ghost" size="sm" icon="trash" label={t('home.trash')} onClick={() => void handleTrash(e)} />
              </div>
            </div>
          ))}
          {shown.length === 0 && recents.length > 0 && (
            <EmptyState className="projects-nomatch" art="search" text={t('refp.home.noMatch')} action={t('refp.home.noMatch.action')} icon="x" onAction={() => setQuery('')} testid="home.nomatch" />
          )}
        </div>
        )}

        <div className="projects-foot">
          <Button variant="danger" size="sm" icon="eraser" disabled={clearing || !cacheBytes} onClick={() => void handleClearCache()}>
            {t('home.cache.clear')}
          </Button>
          <span className="status">
            {cacheBytes === null ? t('home.cache.measuring') : clearing ? t('home.cache.clearing') : cacheBytes > 0 ? t('home.cache.frees', { size: fmtBytes(cacheBytes) }) : t('home.cache.nothing')}
          </span>
          <span className="projects-version" title={t('home.version.hint')}>
            {buildDate(__BUILD_DATE__) ? t('home.versionBuilt', { stamp: __BUILD_STAMP__, date: buildDate(__BUILD_DATE__) }) : t('home.version', { stamp: __BUILD_STAMP__ })}
          </span>
        </div>
      </div>
    </div>
  )
}
