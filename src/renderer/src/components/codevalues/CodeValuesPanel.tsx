// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// Cila K, "code values" (SnippStudio CILA-K-PLAN.md): the side panel where the
// constants the app found in a code clip's page are changed by hand: colours,
// texts, fonts, times. It is NOT part of the Inspector's flow: one button in
// the Inspector's code clip part opens it, it floats over the left dock (the
// preview, the timeline and the Inspector stay in view), and the page's files
// are read only now, and again when they change.
//
// A change is kept in the project (Asset.code.edits, one undo step per field
// touched) and written into the page as it is served; the files are not
// touched until "Write to the files". While a field is typed in or a colour
// dragged, the project is told 300 ms after the hand stops: one reload of
// the page, in the background, the old frame staying on screen meanwhile.
// Built of the building blocks only (ui/), its words from t().
import { memo, useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { createRoot } from 'react-dom/client'
import { cleanTime, editId, parseColor, type CodeEdit, type Slot, type ValueKind } from '../../../../shared/codeval'
import { codeFilms } from '../../media/codefilm'
import { api } from '../../platform'
import { useStore } from '../../state/store'
import { Button, Checkbox, Chip, Icon, IconButton, NumberField, Select, TextArea, TextField, Tooltip, notify, useT, type IconName, type SelectOption, type StringKey } from '../../ui'
import { installedFonts } from './fonts'
import { fitsRow, KINDS, listing, matches, resetPlace, resetRow, setPlace, setRow, splitColor, splitTime, type Change, type Place, type Row } from './model'
import { codeValues } from './state'
import { motionOff } from '../../ui/motion'

/** How long after the hand stops a field's value goes to the project. */
export const SETTLE_MS = 300
/** Rows shown of one kind before the list asks for a search. */
const ROWS_SHOWN = 120
const PLACES_SHOWN = 60
const NONE: CodeEdit[] = []
const KIND_ICON: Record<ValueKind, IconName> = { color: 'palette', text: 'text-align-start', font: 'type', time: 'hourglass' }
const KIND_NAME: Record<ValueKind, StringKey> = { color: 'codeval.kind.color', text: 'codeval.kind.text', font: 'codeval.kind.font', time: 'codeval.kind.time' }
const WHERE: Record<Slot['where'], StringKey> = { css: 'codeval.in.css', style: 'codeval.in.style', attr: 'codeval.in.attr', html: 'codeval.in.html', js: 'codeval.in.js' }

interface Scan {
  slots: Slot[]
  files: number
  skipped: number
  ms: number
}

/** A field's value while it is being changed: shown at once, given to
 *  `commit` SETTLE_MS after the last change (and when the field goes). */
function useSettled(value: string, commit: (v: string) => void): [string, (v: string, now?: boolean) => void, () => void] {
  const [draft, setDraft] = useState(value)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pending = useRef<string | null>(null)
  const sink = useRef(commit)
  sink.current = commit
  // (The project's value shows when nothing typed here is waiting: an undo.)
  useEffect(() => {
    if (pending.current === null) setDraft(value)
  }, [value])
  const flush = useCallback((): void => {
    if (timer.current) clearTimeout(timer.current)
    timer.current = null
    const v = pending.current
    pending.current = null
    if (v !== null) sink.current(v)
  }, [])
  useEffect(() => flush, [flush])
  const set = useCallback(
    (v: string, now = false): void => {
      setDraft(v)
      pending.current = v
      if (timer.current) clearTimeout(timer.current)
      if (now) flush()
      else timer.current = setTimeout(flush, SETTLE_MS)
    },
    [flush]
  )
  return [draft, set, flush]
}

interface EditorProps {
  kind: ValueKind
  /** What the field shows (the value the page gets). */
  value: string
  onSet: (v: string) => void
  /** A time that may be negative. */
  delay?: boolean
  /** The families found in the page (a font's choices). */
  fonts: readonly string[]
  testid: string
  invalid?: boolean
}

/** The field of one value, by its kind. */
function Editor({ kind, value, onSet, delay, fonts, testid, invalid }: EditorProps): JSX.Element {
  const t = useT()
  const [draft, set, flush] = useSettled(value, onSet)
  const [typed, setTyped] = useState<string | null>(null)
  if (kind === 'color') {
    const { rgb, alpha } = splitColor(draft)
    const text = typed ?? draft
    const bad = typed !== null && parseColor(typed) === null
    return (
      <span className="cv-color">
        <input type="color" className="cv-swatch" value={rgb} aria-label={t('codeval.color.pick')} data-testid={`${testid}.pick`} onChange={(e) => set(e.target.value + alpha)} />
        <TextField
          value={text}
          mono
          size="sm"
          label={t('codeval.color.value')}
          invalid={bad || invalid}
          testid={`${testid}.value`}
          onChange={(v) => {
            setTyped(v)
            const c = parseColor(v)
            if (c) set(c)
          }}
          onCommit={() => {
            flush()
            setTyped(null)
          }}
          onBlur={() => {
            flush()
            setTyped(null)
          }}
        />
      </span>
    )
  }
  if (kind === 'text') return <TextArea value={draft} rows={Math.min(4, Math.max(1, Math.ceil(draft.length / 34)))} label={t('codeval.text.value')} testid={`${testid}.value`} className="cv-text" onChange={(v) => set(v)} onBlur={flush} />
  if (kind === 'font') {
    const here = [...new Set([draft, ...fonts])]
    const hereKeys = new Set(here.map((f) => f.toLowerCase()))
    const options: SelectOption[] = [
      ...here.map((f) => ({ value: f, label: f, group: t('codeval.font.page') })),
      ...installedFonts()
        .filter((f) => !hereKeys.has(f.toLowerCase()))
        .map((f) => ({ value: f, label: f, group: t('codeval.font.installed'), fontFamily: f }))
    ]
    return <Select value={draft} options={options} size="sm" label={t('codeval.font.value')} testid={`${testid}.value`} className={invalid ? 'cv-select is-invalid' : 'cv-select'} onChange={(v) => set(v, true)} />
  }
  const { n, unit } = splitTime(draft)
  return (
    <NumberField
      value={n}
      unit={unit}
      free
      decimals={unit === 's' ? 3 : 1}
      step={unit === 's' ? 0.1 : 10}
      min={delay ? -3600000 : 0}
      max={3600000}
      size="sm"
      label={t('codeval.time.value')}
      testid={`${testid}.value`}
      onChange={(v) => {
        const next = cleanTime(`${Math.round(v * 10000) / 10000}${unit}`)
        if (next) set(next)
      }}
    />
  )
}

/** Why a value was not written at some places, in the user's words. */
function refusedText(t: ReturnType<typeof useT>, row: Row, n: number): string {
  if (row.kind === 'color' && row.places.some((p) => p.refused && p.slot.form === 'num')) return t('codeval.refused.alpha', { n })
  if (row.kind === 'font') return t('codeval.refused.font', { n })
  return t('codeval.refused.other', { n })
}

interface RowProps {
  row: Row
  slots: readonly Slot[]
  fonts: readonly string[]
  change: (c: Change, run: string) => void
}

const RowView = memo(function RowView({ row, slots, fonts, change }: RowProps): JSX.Element {
  const t = useT()
  const [open, setOpen] = useState(false)
  const tid = `codeval.${row.id}`
  const many = row.places.length > 1
  const first = row.places[0]
  const refused = row.places.filter((p) => p.refused).length
  const shown = row.value ?? first.value
  return (
    <div className={row.changed ? 'cv-row is-changed' : 'cv-row'} data-testid={tid} data-kind={row.kind} data-orig={row.orig} data-value={row.value ?? ''} data-places={row.places.length} data-changed={row.changed ? '1' : '0'}>
      <div className="cv-line">
        <Editor kind={row.kind} value={shown} delay={row.places.every((p) => p.slot.delay)} fonts={fonts} testid={tid} invalid={!fitsRow(row, shown)} onSet={(v) => change(setRow(row, v), row.id)} />
        {row.changed && (
          <Tooltip content={t('codeval.own', { value: row.orig })}>
            <span>
              <IconButton icon="rotate-ccw" size="sm" variant="ghost" label={t('codeval.reset')} tooltip={false} testid={`${tid}.reset`} onClick={() => change(resetRow(row), row.id + '.reset')} />
            </span>
          </Tooltip>
        )}
      </div>
      <div className="cv-meta">
        {many ? (
          <Tooltip content={t('codeval.places.hint')}>
            <Button size="sm" variant="ghost" icon={open ? 'chevron-down' : 'chevron-right'} aria-expanded={open} testid={`${tid}.places`} onClick={() => setOpen(!open)}>
              {t('codeval.places', { n: row.places.length })}
            </Button>
          </Tooltip>
        ) : (
          <span className="cv-where">
            {t('codeval.where', { file: first.slot.file, line: first.slot.line })}
            <span className="cv-in">{t(WHERE[first.slot.where])}</span>
          </span>
        )}
        {row.value === null && <Chip tone="neutral">{t('codeval.mixed')}</Chip>}
        {row.changed && <Chip tone="accent">{t('codeval.changed')}</Chip>}
      </div>
      {refused > 0 && (
        <div className="cv-refused" data-testid={`${tid}.refused`}>
          {refusedText(t, row, refused)}
        </div>
      )}
      {many && open && (
        <div className="cv-places">
          {row.places.slice(0, PLACES_SHOWN).map((p, i) => (
            <PlaceView key={`${p.slot.file}:${p.slot.at}`} row={row} place={p} slots={slots} fonts={fonts} change={change} testid={`${tid}.place.${i}`} />
          ))}
          {row.places.length > PLACES_SHOWN && <div className="cv-note">{t('codeval.more', { n: row.places.length - PLACES_SHOWN })}</div>}
        </div>
      )}
    </div>
  )
})

function PlaceView({ row, place, slots, fonts, change, testid }: { row: Row; place: Place; slots: readonly Slot[]; fonts: readonly string[]; change: RowProps['change']; testid: string }): JSX.Element {
  const t = useT()
  const own = place.edit !== null && place.edit.file !== undefined
  const run = `${row.id}@${place.slot.file}:${place.slot.at}`
  return (
    <div className={place.edit || place.refused ? 'cv-place is-changed' : 'cv-place'} data-testid={testid} data-file={place.slot.file} data-line={place.slot.line}>
      <span className="cv-where">
        {t('codeval.where', { file: place.slot.file, line: place.slot.line })}
        <span className="cv-in">{t(WHERE[place.slot.where])}</span>
      </span>
      <div className="cv-line">
        <Editor kind={row.kind} value={place.value} delay={place.slot.delay} fonts={fonts} testid={testid} invalid={place.refused} onSet={(v) => change(setPlace(slots, row, place, v), run)} />
        {own && <IconButton icon="rotate-ccw" size="sm" variant="ghost" label={t('codeval.reset')} testid={`${testid}.reset`} onClick={() => change(resetPlace(place), run + '.reset')} />}
      </div>
    </div>
  )
}

/** From the button that opened it to the panel: a box that flies across and
 *  fades (interface audit G12: the panel opens over the left dock, the button
 *  is in the Inspector on the right; the eye is led there). The dock is kept
 *  as its place: the preview and the Inspector (another film's button, the
 *  versions) stay in sight. Nothing moves with "less motion". */
function fly(from: Element | null, to: Element | null): void {
  if (!from || !to || typeof to.animate !== 'function') return
  const ms = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--dur-slow')) * 1.5
  if (!(ms > 0) || motionOff()) return
  const a = from.getBoundingClientRect()
  const b = to.getBoundingClientRect()
  if (!a.width || !b.width || !b.height) return
  const el = document.createElement('div')
  el.className = 'cv-fly'
  el.dataset.testid = 'codeval.fly'
  el.setAttribute('aria-hidden', 'true')
  Object.assign(el.style, { left: `${b.left}px`, top: `${b.top}px`, width: `${b.width}px`, height: `${b.height}px` })
  document.body.appendChild(el)
  const from0 = `translate(${a.left - b.left}px, ${a.top - b.top}px) scale(${a.width / b.width}, ${a.height / b.height})`
  const run = el.animate([{ transform: from0, opacity: 1 }, { transform: 'none', opacity: 0 }], { duration: ms, easing: getComputedStyle(document.documentElement).getPropertyValue('--ease').trim() || 'ease-out' })
  run.onfinish = () => el.remove()
  run.oncancel = () => el.remove()
}

function Panel({ assetId }: { assetId: string }): JSX.Element | null {
  const t = useT()
  const panelRef = useRef<HTMLElement>(null)
  const asset = useStore((s) => s.project.assets.find((a) => a.id === assetId && a.kind === 'code'))
  const [scan, setScan] = useState<Scan | null | 'failed'>(null)
  const [search, setSearch] = useState('')
  const [onlyChanged, setOnlyChanged] = useState(false)
  const [busy, setBusy] = useState(false)
  const [box, setBox] = useState<{ left: number; top: number; width: number; height: number } | null>(null)
  const filmId = asset ? codeFilms.folderId(asset) : ''
  const url = asset?.url

  // The film left the project: the panel goes.
  useEffect(() => {
    if (!asset) codeValues.close()
  }, [asset])

  // Opened: the focus goes into the panel (one Tab to its first control) and
  // the eye is led to it; closed, the focus goes back to the button that
  // opened it (interface audit E7: 132 Tabs to reach it, Escape left the
  // focus nowhere).
  useEffect(() => {
    const now = document.activeElement
    const opener = now instanceof HTMLElement && now !== document.body ? now : null
    panelRef.current?.focus({ preventScroll: true })
    const raf = requestAnimationFrame(() => fly(opener, panelRef.current))
    return () => {
      cancelAnimationFrame(raf)
      const at = document.activeElement
      // (The user went on elsewhere: the focus stays where they put it.)
      if (at && at !== document.body && at.isConnected && !at.closest('.cv-panel')) return
      const back = opener?.isConnected ? opener : document.querySelector<HTMLElement>('[data-testid="codeval.open"]')
      back?.focus({ preventScroll: true })
    }
  }, [])

  // The page's files are read when the panel opens and when they change.
  useEffect(() => {
    if (!asset || !filmId || !api?.codeFilm.valuesScan) {
      setScan('failed')
      return
    }
    let live = true
    let timer: ReturnType<typeof setTimeout> | null = null
    const read = (): void => {
      void api!.codeFilm.valuesScan(filmId).then(
        (r) => live && setScan(r ? { slots: r.slots, files: r.files, skipped: r.skipped, ms: r.ms } : 'failed'),
        () => live && setScan('failed')
      )
    }
    setScan(null)
    read()
    const off = codeFilms.watchCode(asset, (id) => {
      if (id !== assetId) return
      if (timer) clearTimeout(timer)
      timer = setTimeout(read, 150)
    })
    return () => {
      live = false
      off()
      if (timer) clearTimeout(timer)
    }
    // (The folder: its id and address. The asset's other fields change with every edit.)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [assetId, filmId, url])

  // Over the left dock, whatever its width is now.
  useEffect(() => {
    const place = (): void => {
      const dock = document.querySelector('.workspace-dock')
      const r = dock?.getBoundingClientRect()
      if (r && r.height > 0) setBox({ left: r.left, top: r.top, width: Math.max(r.width, 320), height: r.height })
    }
    place()
    const dock = document.querySelector('.workspace-dock')
    const ro = typeof ResizeObserver !== 'undefined' && dock ? new ResizeObserver(place) : null
    if (dock) ro?.observe(dock)
    window.addEventListener('resize', place)
    return () => {
      ro?.disconnect()
      window.removeEventListener('resize', place)
    }
  }, [])

  // Escape closes it (when no field of it is being typed in, the field keeps Escape).
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape' || e.defaultPrevented) return
      const el = document.activeElement as HTMLElement | null
      if (el && el.closest('.cv-panel') && /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)) {
        el.blur()
        return
      }
      if (el && el.closest('.cv-panel')) codeValues.close()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const edits = asset?.code?.edits ?? NONE
  const slots = scan && scan !== 'failed' ? scan.slots : null
  const list = useMemo(() => (slots ? listing(slots, edits) : null), [slots, edits])
  const fonts = useMemo(() => (slots ? [...new Set(slots.filter((s) => s.kind === 'font').map((s) => s.value))] : []), [slots])
  const change = useCallback((c: Change, run: string): void => {
    if (c.put.length || c.drop.length) useStore.getState().setCodeEdits(assetId, c.put, c.drop, run)
  }, [assetId])

  if (!asset) return null
  const rows = list ? list.rows.filter((r) => (!onlyChanged || r.changed) && matches(r, search)) : []
  const ownFolder = !!asset.path && /[\\/]anim[\\/][^\\/]+[\\/]?$/i.test(asset.path)
  const write = async (): Promise<void> => {
    if (!api?.codeFilm.valuesWrite || !edits.length || busy) return
    setBusy(true)
    try {
      const r = await api.codeFilm.valuesWrite(filmId, edits as unknown[])
      if (r.ok) {
        // In the files now: the list is emptied (one undo step; undone, the
        // changes come back and, the files holding them already, find no place).
        useStore.getState().setCodeEdits(assetId, [], (asset.code?.edits ?? []).map(editId))
        notify({ text: r.version ? t('codeval.write.done', { places: r.places ?? 0, files: r.files ?? 0, n: r.version }) : t('codeval.write.doneKept', { places: r.places ?? 0, files: r.files ?? 0 }) })
      } else if (r.reason === 'over-limit') notify({ text: t('codeval.write.overLimit'), kind: 'error' })
      else if (r.reason === 'gone') notify({ text: t('codeval.write.gone'), kind: 'error' })
      else if (r.reason === 'changed') notify({ text: t('codeval.write.changed'), kind: 'error' })
      else if (r.reason === 'no-versions') notify({ text: t('codeval.write.off'), kind: 'error' })
      else notify({ text: t('codeval.write.failed', { why: r.error ?? '' }), kind: 'error' })
    } finally {
      setBusy(false)
    }
  }
  const style = box ? { left: box.left, top: box.top, width: box.width, height: box.height } : undefined
  return (
    <aside ref={panelRef} tabIndex={-1} className="cv-panel" style={style} aria-label={t('codeval.title')} data-testid="codeval.panel" data-asset={assetId} data-state={scan === null ? 'scanning' : scan === 'failed' ? 'failed' : 'ready'} data-slots={slots?.length ?? 0} data-ms={scan && scan !== 'failed' ? scan.ms : ''} data-edits={edits.length}>
      <header className="cv-head">
        <Icon name="sliders-horizontal" size={16} />
        <strong>{t('codeval.title')}</strong>
        <span className="cv-spacer" />
        <IconButton icon="x" size="sm" variant="ghost" label={t('codeval.close')} testid="codeval.close" onClick={() => codeValues.close()} />
      </header>
      <div className="cv-film">{t('codeval.film', { name: asset.name })}</div>
      <div className="cv-tools">
        <TextField value={search} onChange={setSearch} size="sm" label={t('codeval.search')} placeholder={t('codeval.search')} testid="codeval.search" />
        <Checkbox checked={onlyChanged} onChange={setOnlyChanged} label={t('codeval.onlyChanged')} testid="codeval.only-changed" />
      </div>
      <div className="cv-body">
        {scan === null && <div className="cv-empty" data-testid="codeval.scanning">{t('codeval.scanning')}</div>}
        {scan === 'failed' && <div className="cv-empty" data-testid="codeval.failed">{t('codeval.failed')}</div>}
        {list && list.gone.length > 0 && (
          <section className="cv-gone" data-testid="codeval.gone" data-count={list.gone.length}>
            <div className="cv-section-head">
              <Icon name="triangle-exclamation-point" size={14} />
              <strong>{t('codeval.gone.title', { n: list.gone.length })}</strong>
              <span className="cv-spacer" />
              <Button size="sm" variant="ghost" testid="codeval.gone.discard-all" onClick={() => change({ put: [], drop: list.gone.map((g) => g.id) }, 'gone')}>
                {t('codeval.gone.discardAll')}
              </Button>
            </div>
            <div className="cv-note">{t('codeval.gone.note')}</div>
            {list.gone.slice(0, 40).map((g, i) => (
              <div className="cv-gone-row" key={g.id} data-testid={`codeval.gone.${i}`}>
                <span className="cv-gone-text">{g.edit.orig}</span>
                <Icon name="arrow-right" size={14} />
                <span className="cv-gone-text">{g.edit.value}</span>
                <span className="cv-spacer" />
                <Button size="sm" variant="ghost" icon="trash" testid={`codeval.gone.${i}.discard`} onClick={() => change({ put: [], drop: [g.id] }, 'gone.' + g.id)}>
                  {t('codeval.gone.discard')}
                </Button>
              </div>
            ))}
          </section>
        )}
        {list && list.rows.length === 0 && <div className="cv-empty" data-testid="codeval.empty">{t('codeval.empty')}</div>}
        {list && list.rows.length > 0 && rows.length === 0 && <div className="cv-empty" data-testid="codeval.no-match">{t('codeval.noMatch')}</div>}
        {slots &&
          KINDS.map((kind) => {
            const mine = rows.filter((r) => r.kind === kind)
            if (!mine.length) return null
            return (
              <section className="cv-section" key={kind} data-testid={`codeval.section.${kind}`} data-count={mine.length}>
                <div className="cv-section-head">
                  <Icon name={KIND_ICON[kind]} size={14} />
                  <strong>{t(KIND_NAME[kind])}</strong>
                  <span className="cv-count">{mine.length}</span>
                </div>
                {mine.slice(0, ROWS_SHOWN).map((r) => (
                  // (Keyed by its value too: when the files are rewritten, a
                  // field being typed in is never handed to another value.)
                  <RowView key={`${r.id}|${r.orig}`} row={r} slots={slots} fonts={fonts} change={change} />
                ))}
                {mine.length > ROWS_SHOWN && <div className="cv-note">{t('codeval.more', { n: mine.length - ROWS_SHOWN })}</div>}
              </section>
            )
          })}
        {scan && scan !== 'failed' && scan.skipped > 0 && <div className="cv-note" data-testid="codeval.skipped">{t('codeval.skipped', { n: scan.skipped })}</div>}
      </div>
      <footer className="cv-foot">
        <Tooltip content={ownFolder ? t('codeval.write.hint') : t('codeval.write.off')}>
          <span>
            <Button size="sm" icon={busy ? 'loader-circle' : 'save'} disabled={!ownFolder || !edits.length || busy} testid="codeval.write" onClick={() => void write()}>
              {t('codeval.write')}
            </Button>
          </span>
        </Tooltip>
        <span className="cv-spacer" />
        <Tooltip content={t('codeval.resetAll.hint')}>
          <span>
            <Button size="sm" variant="ghost" icon="rotate-ccw" disabled={!edits.length} testid="codeval.reset-all" onClick={() => change({ put: [], drop: edits.map(editId) }, 'reset-all')}>
              {t('codeval.resetAll')}
            </Button>
          </span>
        </Tooltip>
      </footer>
    </aside>
  )
}

/** The panel when it is open (nothing otherwise: no scan, no listener). */
export function CodeValuesPanel(): JSX.Element | null {
  const assetId = useSyncExternalStore(codeValues.subscribe, codeValues.current)
  return assetId ? <Panel key={assetId} assetId={assetId} /> : null
}

/** Mounts the panel beside the editor (its own small root: the editor's own
 *  tree and layout are untouched). */
export function mountCodeValues(): void {
  const host = document.createElement('div')
  host.dataset.part = 'code-values'
  document.body.appendChild(host)
  createRoot(host).render(<CodeValuesPanel />)
}
