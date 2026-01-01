// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
import { useEffect, useMemo, useState } from 'react'
import { EmptyState } from './EmptyState'
import { codeFilms } from '../media/codefilm'
import { CodeFilmBadges } from './CodeFilmBadges'
import { FitVoiceDialog } from './FitVoiceDialog'
import { codeFilmImport, importCodeFilm } from '../media/import'
import { generateProxy } from '../media/proxy'
import { dropInput, proxyUrls } from '../media/sources'
import { dropPeaks } from '../media/peakCache'
import { dropCachedFrames } from '../playback/scrub'
import { dropStripImage } from './Filmstrip'
import { relinkAndTell } from '../media/relink-ui'
import { api } from '../platform'
import { useStore } from '../state/store'
import type { Asset } from '../types'
import { uid } from '../types'
import { setDraggedAssets } from '../timeline/droptarget'
import { useSession } from '../agent/session'
import { assetInCompound } from '../commands/ops/base'
import { assetDeleteCost } from '../media/delete-cost'
import { confirmDialog } from '../ui/confirm'
import { Button, Checkbox, Icon, IconButton, notify, Slider, t, t as say, Toggle, Tooltip, useT, type IconName } from '../ui'
import { ToolButton } from './ToolButton'
import { BareButton } from '../ui/Button'
import { fmtTime } from '../ui/format'
import { LiveBadge } from './timeline/LiveBadge'
import { BIN_SORTS, matches, sortAssets, usedAssetIds, type BinSort } from '../media/bin-order'
import { Select, TextField } from '../ui'
import './media-find.css'

/** The media panel's order (REF-AB item 5), kept by the profile. */
const SORT_KEY = 'snipp-bin-sort'
function readSort(): BinSort {
  try {
    const v = localStorage.getItem(SORT_KEY) as BinSort | null
    return v && BIN_SORTS.includes(v) ? v : 'added'
  } catch {
    return 'added'
  }
}

const icon: Record<string, IconName> = { video: 'video', image: 'image', audio: 'eighth-notes', code: 'code' }

/** A code film's line in the bin: its length and whether its page runs. */
function codeLine(a: Asset): string {
  const s = codeFilms.status(a.id)
  const state = !s ? t('bin.film.notStarted') : s.state === 'ready' ? `${s.width}×${s.height}` : s.state === 'booting' ? t('bin.film.starting') : s.state === 'limited' ? t('codeFilm.tooManyShort') : t('bin.film.pageError')
  return t('bin.film.line', { dur: fmtDur(a.duration), state })
}

// The one time form (ui/format.ts, audit G6).
const fmtDur = (s: number): string => (s ? fmtTime(s) : '')

interface GradientSpec {
  from: string
  mid: string | null
  to: string
  angle: number
  radial: boolean
}

/** Builds a full-frame solid/gradient PNG asset (usable like any image). */
function makeColorAsset(c1: string, grad: GradientSpec | null): Asset {
  const W = 1920
  const H = 1080
  const cv = document.createElement('canvas')
  cv.width = W
  cv.height = H
  const ctx = cv.getContext('2d')!
  if (grad) {
    let g: CanvasGradient
    if (grad.radial) {
      g = ctx.createRadialGradient(W / 2, H / 2, 0, W / 2, H / 2, Math.hypot(W, H) / 2)
    } else {
      // Angle 0° = left→right; rotate the gradient axis around the centre.
      const rad = (grad.angle * Math.PI) / 180
      const half = Math.hypot(W, H) / 2
      const dx = Math.cos(rad) * half
      const dy = Math.sin(rad) * half
      g = ctx.createLinearGradient(W / 2 - dx, H / 2 - dy, W / 2 + dx, H / 2 + dy)
    }
    g.addColorStop(0, grad.from)
    if (grad.mid) g.addColorStop(0.5, grad.mid)
    g.addColorStop(1, grad.to)
    ctx.fillStyle = g
  } else {
    ctx.fillStyle = c1
  }
  ctx.fillRect(0, 0, W, H)
  const url = cv.toDataURL('image/png')
  return {
    id: uid(),
    kind: 'image',
    name: grad ? t('bin.colour.gradientName', { from: grad.from, to: grad.to }) : t('bin.colour.solidName', { c: c1 }),
    url,
    size: url.length,
    duration: 0,
    width: W,
    height: H,
    hasAudio: false,
    thumbnail: url
  }
}

/** ＋ Color: create solid / gradient background layers. */
function ColorAssetButton(): JSX.Element {
  const t = useT()
  const [open, setOpen] = useState(false)
  const [c1, setC1] = useState('#101018')
  const [c2, setC2] = useState('#25d0c2')
  const [cMid, setCMid] = useState('#4fa8ff')
  const [useMid, setUseMid] = useState(false)
  const [angle, setAngle] = useState(90)
  const [radial, setRadial] = useState(false)
  const [gradient, setGradient] = useState(false)
  const addAssets = useStore((s) => s.addAssets)

  return (
    <div className="bin-colour">
      <Tooltip content={t('bin.colour.hint')}>
        <Button variant="ghost" icon="palette" pressed={open} aria-label={t('bin.colour')} aria-expanded={open} onClick={() => setOpen(!open)} testid="media.colour" />
      </Tooltip>
      {open && (
        <div className="shell-pop bin-colour-pop" onPointerDown={(e) => e.stopPropagation()}>
          <label className="bin-colour-row">
            <span>{gradient ? t('bin.colour.from') : t('bin.colour.colour')}</span>
            <input type="color" value={c1} onChange={(e) => setC1(e.target.value)} />
          </label>
          <Toggle label={t('bin.colour.gradient')} checked={gradient} onChange={setGradient} />
          {gradient && (
            <>
              <label className="bin-colour-row">
                <span>{t('bin.colour.to')}</span>
                <input type="color" value={c2} onChange={(e) => setC2(e.target.value)} />
              </label>
              <Checkbox label={t('bin.colour.midStop')} checked={useMid} onChange={setUseMid} />
              {useMid && (
                <label className="bin-colour-row">
                  <span>{t('bin.colour.mid')}</span>
                  <input type="color" value={cMid} onChange={(e) => setCMid(e.target.value)} />
                </label>
              )}
              <Checkbox label={t('bin.colour.radial')} checked={radial} onChange={setRadial} />
              {!radial && <Slider label={t('bin.colour.angle')} value={angle} onChange={setAngle} min={0} max={360} step={5} unit="°" />}
            </>
          )}
          <Button
            variant="secondary"
            icon="plus"
            onClick={() => {
              addAssets([makeColorAsset(c1, gradient ? { from: c1, mid: useMid ? cMid : null, to: c2, angle, radial } : null)])
              setOpen(false)
            }}
          >
            {t('bin.colour.add')}
          </Button>
        </div>
      )}
    </div>
  )
}

/**
 * Bin thumbnail that scrubs through the clip as the pointer moves across it —
 * the quickest way to tell two similar takes apart before dragging one in.
 * Uses the filmstrip that was already generated at import, so it costs nothing
 * extra; without one it just shows the still.
 */
function HoverScrubThumb({ asset }: { asset: Asset }): JSX.Element {
  const [frac, setFrac] = useState<number | null>(null)
  const cols = asset.filmstripCols ?? 0
  const canScrub = !!asset.filmstrip && cols > 1
  if (!canScrub || frac === null) {
    return (
      <img
        src={asset.thumbnail}
        alt=""
        onPointerMove={(e) => {
          if (!canScrub) return
          const r = e.currentTarget.getBoundingClientRect()
          setFrac(Math.max(0, Math.min(0.999, (e.clientX - r.left) / r.width)))
        }}
      />
    )
  }
  const idx = Math.min(cols - 1, Math.floor(frac * cols))
  return (
    <div
      className="bin-scrub"
      style={{
        backgroundImage: `url(${asset.filmstrip})`,
        backgroundSize: `${cols * 100}% 100%`,
        backgroundPosition: `${(idx / Math.max(1, cols - 1)) * 100}% 0`
      }}
      title={t('bin.scrub', { s: (frac * asset.duration) | 0 })}
      onPointerMove={(e) => {
        const r = e.currentTarget.getBoundingClientRect()
        setFrac(Math.max(0, Math.min(0.999, (e.clientX - r.left) / r.width)))
      }}
      onPointerLeave={() => setFrac(null)}
    />
  )
}

/** Add a code film: a folder with an index.html (VideoHub's live contract),
 *  with its audio/mix.wav. Arayüz v4: the left panel's Code page asks for it
 *  (it was a button of the media bin's head). */
export async function addCodeFilm(): Promise<void> {
  try {
    const r = await importCodeFilm()
    if (!r) return
    const added = r.assets.length ? useStore.getState().addAssets(r.assets) : []
    const film = added.find((x) => x.kind === 'code')
    if (film) {
      codeFilms.ensure(film)
      notify({ text: r.assets.length > 1 ? say('bin.film.addedSound', { name: film.name }) : say('bin.film.added', { name: film.name }) })
    } else if (r.assets.length) notify({ text: say('bin.film.already') })
    if (r.errors.length) notify({ text: r.errors.join(' · '), kind: 'error' })
  } catch (err) {
    notify({ text: err instanceof Error ? err.message : String(err), kind: 'error' })
  }
}

export function MediaBin({ onImport }: { onImport: () => void }): JSX.Element {
  const t = useT()
  const allAssets = useStore((s) => s.project.assets)
  const assets = allAssets
  const addToTimeline = useStore((s) => s.addToTimeline)
  const addAllToTimeline = useStore((s) => s.addAllToTimeline)
  const updateAsset = useStore((s) => s.updateAsset)
  const deleteAsset = useStore((s) => s.deleteAsset)
  const proxiesEnabled = useStore((s) => s.proxiesEnabled)
  const setProxiesEnabled = useStore((s) => s.setProxiesEnabled)
  const [selected, setSelected] = useState<string[]>([])
  // The picked files are what a request to the agent can be about (phase
  // 4B.2: the command box's file tag); removing that tag lets go of them.
  const mediaCleared = useSession((s) => s.mediaCleared)
  useEffect(() => useSession.getState().setMedia(selected.filter((id) => assets.some((a) => a.id === id))), [selected, assets])
  useEffect(() => {
    if (mediaCleared) setSelected([])
  }, [mediaCleared])
  // The picked pictures "Fit to voice" lays on the voice (cila O, K3).
  const pictureIds = selected.filter((id) => assets.some((a) => a.id === id && a.kind === 'image' && !a.missing))
  const [fitOpen, setFitOpen] = useState(false)
  const [proxyBusy, setProxyBusy] = useState<Record<string, number>>({})
  const [grid, setGrid] = useState(() => localStorage.getItem('autocut-bin-grid') !== 'off')
  // REF-AB item 5: the "in the timeline" badge, the order and a search.
  const clips = useStore((s) => s.project.clips)
  const used = useMemo(() => usedAssetIds({ clips }), [clips])
  const [sort, setSortState] = useState<BinSort>(readSort)
  const setSort = (v: BinSort): void => {
    setSortState(v)
    try {
      localStorage.setItem(SORT_KEY, v)
    } catch {
      /* not remembered: fine */
    }
  }
  const [query, setQuery] = useState('')
  const searching = query.trim().length > 0
  const usable = assets.filter((a) => !a.missing).length
  const anyProxies = proxyUrls.size > 0
  // A code film's page state shows on its line.
  const [, setFilmTick] = useState(0)
  useEffect(() => codeFilms.subscribe(() => setFilmTick((n) => n + 1)), [])

  const toggleSelect = (id: string, e: React.MouseEvent) => {
    if (e.ctrlKey || e.metaKey) {
      setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]))
    } else if (e.shiftKey && selected.length > 0) {
      // Range select between the last selected item and this one.
      const ids = shownList.map((a) => a.id)
      const from = ids.indexOf(selected[selected.length - 1])
      const to = ids.indexOf(id)
      const [lo, hi] = [Math.min(from, to), Math.max(from, to)]
      setSelected(ids.slice(lo, hi + 1))
    } else {
      setSelected([id])
    }
  }

  // A dropped folder becomes ONE item you open, the way a file manager works —
  // rather than dozens of clips shoved into the list next to everything else.
  const [openFolder, setOpenFolder] = useState<string | null>(null)
  const folders: [string, Asset[]][] = []
  const loose: Asset[] = []
  for (const a of assets) {
    if (!a.folder) {
      loose.push(a)
      continue
    }
    const found = folders.find(([n]) => n === a.folder)
    if (found) found[1].push(a)
    else folders.push([a.folder, [a]])
  }
  // A folder that no longer has anything in it (everything deleted) shouldn't
  // strand the view inside it.
  const insideFolder = openFolder ? (folders.find(([n]) => n === openFolder)?.[1] ?? null) : null
  if (openFolder && !insideFolder) setOpenFolder(null)
  // In the chosen order; a search looks through every file, folders' too.
  const insideItems = insideFolder && !searching ? sortAssets(insideFolder, sort) : null
  const looseSorted = sortAssets(loose, sort)
  const found = searching ? sortAssets(assets.filter((a) => matches(query, a.name, a.folder)), sort) : null
  const shownList = found ?? insideItems ?? looseSorted

  const relink = async (assetId: string) => {
    if (!api) return
    const was = useStore.getState().project.assets.find((x) => x.id === assetId)
    if (was?.kind === 'code') {
      // A code film is relinked to its folder.
      const info = await api.codeFilm.pick()
      if (!info) return
      const r = await codeFilmImport(info)
      updateAsset(assetId, { url: info.url, path: info.root, missing: undefined } as never)
      const mix = r.assets.find((x) => x.kind === 'audio')
      if (mix) useStore.getState().addAssets([mix])
      codeFilms.reload(assetId)
      return
    }
    const files = await api.openMediaDialog()
    const f = files[0]
    if (!f) return
    // The file is read first: its duration, size and sound replace the old
    // file's, another kind is refused, the caches go (phase Ç2a.2, P7).
    await relinkAndTell(assetId, f)
  }

  const plural = (n: number): string => t(n === 1 ? 'bin.files.one' : 'bin.files.many', { n })
  const kindName = (a: Asset): string => t(a.kind === 'video' ? 'bin.kind.video' : a.kind === 'audio' ? 'bin.kind.audio' : 'bin.kind.image')

  const renderItem = (a: Asset): JSX.Element => (
    <div
      key={a.id}
      className={`bin-item${a.missing ? ' missing' : ''}${selected.includes(a.id) ? ' selected' : ''}`}
      draggable={!a.missing}
      data-testid={`media.item.${a.id}`}
      onClick={(e) => toggleSelect(a.id, e)}
      onDragStart={(e) => {
        // Dragging a selected item carries the whole selection.
        const ids = selected.includes(a.id) && selected.length > 1 ? selected : [a.id]
        e.dataTransfer.setData('application/x-autocut-assets', JSON.stringify(ids))
        e.dataTransfer.setData('application/x-autocut-asset', a.id)
        e.dataTransfer.effectAllowed = 'copy'
        // For the timeline's drop indicator while this is over it.
        setDraggedAssets(ids)
      }}
      onDragEnd={() => setDraggedAssets(null)}
      onDoubleClick={() => !a.missing && addToTimeline(a.id)}
      title={a.missing ? t('bin.item.missing', { path: a.path ?? a.name }) : t('bin.item.hint')}
    >
      {a.thumbnail ? (
        <HoverScrubThumb asset={a} />
      ) : (
        <div className={`ph is-${a.kind}`}>
          <Icon name={icon[a.kind] ?? 'image'} size={16} />
        </div>
      )}
      {/* REF-AB item 5: a file with a clip in the timeline says so. */}
      {used.has(a.id) && (
        <span className="bin-used" data-testid={`media.used.${a.id}`} title={t('refp.bin.used.hint')}>
          <Icon name="check" size={12} />
          <span className="bin-used-word">{t('refp.bin.used')}</span>
        </span>
      )}
      {/* v3: in the grid the length sits on the picture, in its corner. */}
      {grid && !a.missing && (
        <span className="bin-dur" aria-hidden="true">
          <Icon name={icon[a.kind] ?? 'image'} size={12} />
          {a.kind === 'image' || a.kind === 'code' ? null : fmtDur(a.duration)}
        </span>
      )}
      <div className="meta">
        <div className="name">{a.name}{a.kind === 'code' && <LiveBadge testid={`media.live.${a.id}`} />}</div>
        <div className="sub">
          {a.missing ? (a.kind === 'code' ? t('bin.item.missingFolder') : t('bin.item.missingFile')) : a.kind === 'code' ? codeLine(a) : <span className="bin-sub-kind">{`${kindName(a)} ${fmtDur(a.duration)}`}</span>}
          {!a.missing && a.kind !== 'code' && proxyUrls.has(a.id) && (
            <span className="bin-proxy">
              {' · '}
              <Icon name="zap" size={12} />
              {t('bin.proxy')}
            </span>
          )}
          {!a.missing && a.kind !== 'code' && proxyBusy[a.id] !== undefined && ` · ${t('bin.proxy.busy', { n: Math.round(proxyBusy[a.id] * 100) })}`}
          {/* A code film's "slow" / "unstable" chips (phase 5d.2). */}
          {!a.missing && a.kind === 'code' && <CodeFilmBadges assetId={a.id} />}
          {/* No decoder for its pictures here (phase Ç3a, decision 6). */}
          {!a.missing && a.undecodable && (
            <span className="bin-undecodable" data-testid="media.undecodable" title={t('media.undecodable')}>
              {` · ${t('media.undecodable.badge')}`}
            </span>
          )}
          {/* HDR (phase Ç3b, decision 7). */}
          {!a.missing && a.hdr && (
            <span className="bin-hdr" data-testid="media.hdr" title={t('media.hdr', { kind: a.hdr.toUpperCase() })}>
              {` · ${t('media.hdr.badge', { kind: a.hdr.toUpperCase() })}`}
            </span>
          )}
        </div>
      </div>
      {a.missing && api && (
        <IconButton
          variant="ghost"
          size="sm"
          className="add"
          icon="link"
          label={t('bin.item.relink')}
          onClick={(e) => {
            e.stopPropagation()
            void relink(a.id)
          }}
        />
      )}
      {!a.missing && a.kind === 'video' && !proxyUrls.has(a.id) && proxyBusy[a.id] === undefined && (
        <IconButton
          variant="ghost"
          size="sm"
          className="add"
          icon="zap"
          label={t('bin.item.proxy')}
          onClick={(e) => {
            e.stopPropagation()
            setProxyBusy((p) => ({ ...p, [a.id]: 0 }))
            generateProxy(a, (f) => setProxyBusy((p) => ({ ...p, [a.id]: f })))
              .then(() => {
                setProxyBusy((p) => {
                  const n = { ...p }
                  delete n[a.id]
                  return n
                })
                useStore.getState().setProxiesEnabled(true)
              })
              .catch(() => {
                setProxyBusy((p) => {
                  const n = { ...p }
                  delete n[a.id]
                  return n
                })
                notify({ text: t('bin.item.proxyFailed'), kind: 'error' })
              })
          }}
        />
      )}
      <IconButton
        variant="ghost"
        size="sm"
        className="add"
        icon="plus"
        disabled={!!a.missing}
        testid={`media.item.${a.id}.add`}
        label={t('bin.item.add', { name: a.name })}
        onClick={(e) => {
          e.stopPropagation()
          addToTimeline(a.id)
        }}
      />
      <IconButton
        variant="ghost"
        size="sm"
        className="add del"
        icon="trash"
        testid={`media.item.${a.id}.remove`}
        label={t('bin.item.remove', { name: a.name })}
        onClick={async (e) => {
          e.stopPropagation()
          // Used inside a compound clip: not deleted, and said why
          // (phase Ç2a.1, P16).
          if (assetInCompound(useStore.getState().project, a.id)) {
            notify({ text: t('media.inCompound', { name: a.name }), kind: 'error' })
            return
          }
          // What goes with it, all of it (audit G10): its clips, and the
          // subtitles heard in them.
          const cost = assetDeleteCost(useStore.getState().project, a.id)
          if (cost.clips > 0) {
            const message =
              t(cost.clips === 1 ? 'bin.item.deleteAsk.one' : 'bin.item.deleteAsk.many', { n: cost.clips }) +
              (cost.subtitles > 0 ? ' ' + t(cost.subtitles === 1 ? 'bin.item.deleteAsk.subs.one' : 'bin.item.deleteAsk.subs.many', { n: cost.subtitles }) : '')
            const yes = await confirmDialog({ title: t('bin.item.deleteAsk.title', { name: a.name }), message, note: t('bin.item.deleteAsk.undo'), confirm: t('bin.item.deleteAsk.ok'), danger: true })
            if (!yes) return
          }
          // Free the demuxer, cached stills and peak data with it.
          dropInput(a.id)
          dropCachedFrames(a.id)
          dropPeaks(a.id)
          dropStripImage(a.id)
          deleteAsset(a.id)
          setSelected((prev) => prev.filter((x) => x !== a.id))
        }}
      />
    </div>
  )

  return (
    <div className="bin">
      <div className="bin-head">
        <strong className="bin-title">{t('bin.title')}</strong>
        <ColorAssetButton />
        {anyProxies && (
          <Tooltip content={t('bin.proxy.toggle')}>
            <Button variant="ghost" icon="zap" pressed={proxiesEnabled} onClick={() => setProxiesEnabled(!proxiesEnabled)} aria-label={t('bin.proxy.label')}>
              {proxiesEnabled ? t('bin.proxy.on') : undefined}
            </Button>
          </Tooltip>
        )}
        <IconButton
          variant="ghost"
          icon={grid ? 'layout-grid' : 'layout-list'}
          pressed={grid}
          label={t('bin.grid')}
          onClick={() => {
            const next = !grid
            setGrid(next)
            localStorage.setItem('autocut-bin-grid', next ? 'on' : 'off')
          }}
        />
        {/* Tools of the bin: icons alone (their names in the tooltips); Import
            keeps its word (GORSEL-PLAN.md). */}
        <ToolButton icon="arrow-right-to-line" disabled={usable === 0} testid="media.add-all" onClick={addAllToTimeline} label={t('bin.addAll')} hint={t('bin.addAll.hint')} />
        <Button variant="secondary" icon="plus" testid="media.import" className="bin-import" onClick={onImport}>
          {t('bin.import')}
        </Button>
      </div>
      {assets.length > 0 && (
        <div className="bin-find">
          <TextField className="bin-search" size="sm" value={query} placeholder={t('refp.bin.search')} label={t('refp.bin.search.label')} onChange={setQuery} testid="media.search" />
          <Select
            size="sm"
            className="bin-sort"
            value={sort}
            label={t('refp.bin.sort')}
            onChange={(v) => setSort(v as BinSort)}
            options={BIN_SORTS.map((k) => ({ value: k, label: t(`refp.bin.sort.${k}`) }))}
            testid="media.sort"
          />
        </div>
      )}
      {(selected.length > 1 || pictureIds.length > 0) && (
        <div className="bin-selinfo">
          {selected.length > 1 && <span>{t('bin.selected', { n: selected.length })}</span>}
          {pictureIds.length > 0 && (
            <Tooltip content={t('fit.open.hint')}>
              <Button variant="secondary" size="sm" icon="audio-waveform" testid="media.fit-voice" onClick={() => setFitOpen(true)}>
                {t('fit.open.count', { n: pictureIds.length })}
              </Button>
            </Tooltip>
          )}
        </div>
      )}
      {fitOpen && <FitVoiceDialog pictureIds={pictureIds} onClose={() => setFitOpen(false)} />}
      {/* Inside a folder: its contents only, with a way back out. */}
      {found ? (
        <div className={`bin-list${grid ? ' grid' : ''}`}>
          {found.map(renderItem)}
          {found.length === 0 && <EmptyState className="bin-nomatch" art="search" text={t('refp.bin.noMatch', { q: query.trim() })} action={t('refp.pick.clear')} icon="x" onAction={() => setQuery('')} testid="media.nomatch" />}
        </div>
      ) : insideItems ? (
        <>
          <BareButton type="button" className="bin-folder-head" data-testid="media.folder-back" onClick={() => setOpenFolder(null)}>
            <Icon name="arrow-left" size={14} />
            <Icon name="folder-open" size={14} />
            <span className="bin-folder-name">{openFolder}</span>
            <span className="bin-count">{insideItems.length}</span>
          </BareButton>
          <div className={`bin-list${grid ? ' grid' : ''}`}>{insideItems.map(renderItem)}</div>
        </>
      ) : (
        <div className={`bin-list${grid ? ' grid' : ''}`}>
          {/* Arayüz v4: an empty panel is one large place to import into
              (a click, or files dropped on it); its sentence and its button
              stay (media.empty). */}
          {assets.length === 0 && (
            <div className="bin-drop" onClick={(e) => { if (!(e.target as HTMLElement).closest('button')) onImport() }} data-testid="media.drop">
              <EmptyState className="bin-empty" art="media" text={t('bin.drop.hint')} action={t('bin.drop.title')} icon="plus" onAction={onImport} testid="media.empty" />
            </div>
          )}
          {/* Dropped folders sit at the top as single items; double-click opens
              one, the same gesture that adds a clip to the timeline. */}
          {folders.map(([name, items]) => (
            <div
              key={name}
              className="bin-item bin-folder-item"
              data-testid={`media.folder.${name}`}
              onDoubleClick={() => setOpenFolder(name)}
              title={t('bin.folder.hint', { files: plural(items.length) })}
            >
              <div className="ph">
                <Icon name="folder-open" size={16} />
              </div>
              <div className="meta">
                <div className="name">{name}</div>
                <div className="sub">{plural(items.length)}</div>
              </div>
            </div>
          ))}
          {looseSorted.map(renderItem)}
        </div>
      )}
    </div>
  )
}
