// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
import { useEffect, useRef, useState } from 'react'
import { shortsWindowAt } from '../playback/render'
import { SEGMENT_COLORS, useDisplayTime, useStore } from '../state/store'
import type { ShortSegment } from '../types'
import { SegmentStrip } from './SegmentStrip'
import { Button, Icon, IconButton, TextField, Tooltip, useT } from '../ui'

/**
 * A read-out that becomes an input on double-click.
 *
 * Dragging a band is fine for roughing a Short out, but "start it exactly at
 * 10.7" is a typing job — at any sensible zoom a single pixel is several frames,
 * so the only way to hit an exact time was to zoom in absurdly far.
 */
function EditableTime({
  value,
  onCommit,
  title,
  className = 'sp-info',
  suffix = 's',
  warn = false
}: {
  value: number
  onCommit: (v: number) => void
  title: string
  className?: string
  suffix?: string
  /** Shown with a warning icon (a Short longer than 60 s). */
  warn?: boolean
}): JSX.Element {
  const t = useT()
  const [editing, setEditing] = useState(false)
  const [text, setText] = useState('')
  const ref = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (editing) ref.current?.select()
  }, [editing])

  if (!editing) {
    return (
      <span
        className={`${className} editable`}
        title={t('shorts.time.hint', { what: title })}
        onDoubleClick={() => {
          setText(value.toFixed(2))
          setEditing(true)
        }}
      >
        {value.toFixed(1)}
        {suffix}
        {warn && <Icon name="triangle-exclamation-point" size={12} />}
      </span>
    )
  }
  const commit = (): void => {
    setEditing(false)
    const raw = text.trim()
    // An empty box is "I changed my mind", not "set this to zero" — Number('')
    // is 0, which would silently collapse the segment.
    if (!raw) return
    const v = Number(raw.replace(',', '.'))
    if (Number.isFinite(v)) onCommit(v)
  }
  return (
    <input
      ref={ref}
      className={`${className} time-edit`}
      type="text"
      inputMode="decimal"
      aria-label={title}
      value={text}
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        e.stopPropagation() // the editor's global shortcuts must not fire here
        if (e.key === 'Enter') commit()
        else if (e.key === 'Escape') setEditing(false)
      }}
    />
  )
}

/** Compact shorts controls shown under the preview while in Shorts mode. */
export function ShortsPanel({
  onExportSegments
}: {
  onExportSegments: (segments: ShortSegment[]) => void
}): JSX.Element | null {
  const t = useT()
  const mode = useStore((s) => s.project.mode)
  const project = useStore((s) => s.project)
  const currentTime = useDisplayTime()
  const addShortsKeyframe = useStore((s) => s.addShortsKeyframe)
  const deleteShortsKeyframe = useStore((s) => s.deleteShortsKeyframe)
  const setTime = useStore((s) => s.setTime)
  const activeId = useStore((s) => s.activeShortSegmentId)
  const setActiveShortSegment = useStore((s) => s.setActiveShortSegment)
  const addShortSegment = useStore((s) => s.addShortSegment)
  const updateShortSegment = useStore((s) => s.updateShortSegment)
  const deleteShortSegment = useStore((s) => s.deleteShortSegment)
  const copyShortSegment = useStore((s) => s.copyShortSegment)
  const pasteShortSegment = useStore((s) => s.pasteShortSegment)
  const exporting = useStore((s) => !!s.exportStatus && !s.exportStatus.done)
  const exportQueue = useStore((s) => s.exportQueue)
  const toggleExportQueue = useStore((s) => s.toggleExportQueue)
  const clearExportQueue = useStore((s) => s.clearExportQueue)
  /** Which segment's controls are unfolded (one at a time). */
  const [expanded, setExpanded] = useState<string | null>(null)
  if (mode !== 'shorts') return null

  const segments = project.shortSegments ?? []
  // Queue order is the order they were added, and ids that no longer exist
  // (segment deleted after queuing) simply drop out.
  const queued = exportQueue
    .map((id) => segments.find((sg) => sg.id === id))
    .filter((sg): sg is NonNullable<typeof sg> => !!sg)
  const queuedSeconds = queued.reduce((sum, sg) => sum + (sg.end - sg.start), 0)
  const active = segments.find((s) => s.id === activeId) ?? null
  // Pan keyframes shown for the stretch under the playhead (segment or global).
  const inSeg = segments.find((s) => currentTime >= s.start && currentTime <= s.end)
  const kfs = (inSeg ? inSeg.keyframes : project.shorts?.keyframes) ?? []
  const win = shortsWindowAt(project, currentTime)

  return (
    <div className="shorts-panel">
      <div className="sp-row">
        <span className="sp-title">
          <Icon name="smartphone" size={14} />
          {t('shorts.title')}
        </span>
        <Tooltip content={t('shorts.addSeg.hint')}>
          <Button
            variant="secondary"
            size="sm"
            icon="plus"
            onClick={() => {
              const id = addShortSegment()
              const seg = useStore.getState().project.shortSegments?.find((s) => s.id === id)
              if (seg) setTime(seg.start)
            }}
          >
            {t('shorts.addSeg', { at: currentTime.toFixed(1) })}
          </Button>
        </Tooltip>
        <Tooltip content={t('shorts.addKf.hint')}>
          <Button variant="secondary" size="sm" icon="diamond" onClick={addShortsKeyframe}>
            {t('shorts.addKf')}
          </Button>
        </Tooltip>
        <Tooltip content={t('shorts.paste.hint')}>
          <Button
            variant="secondary"
            size="sm"
            icon="clipboard-paste"
            onClick={() => {
              const id = pasteShortSegment()
              const seg = useStore.getState().project.shortSegments?.find((s) => s.id === id)
              if (seg) setTime(seg.start)
            }}
          >
            {t('shorts.paste')}
          </Button>
        </Tooltip>
        <span className="sp-info">{t('shorts.windowX', { x: Math.round(win.cx) })}</span>
        {segments.length > 1 && (
          <Tooltip content={t('shorts.exportAll.hint')}>
            <Button variant="secondary" size="sm" icon="download" onClick={() => onExportSegments(segments)} disabled={exporting}>
              {t('shorts.exportAll', { n: segments.length })}
            </Button>
          </Tooltip>
        )}
      </div>

      {/* The render queue. Segments are finished one at a time — crop this one,
          name it, queue it, move on — and then the whole set goes off in a
          single run into one folder, in the order you queued them. Exporting
          them one by one meant sitting through a save dialog and a render
          between every segment. */}
      {queued.length > 0 && (
        <div className="sp-queue">
          <span className="sp-queue-title">
            <Icon name="hourglass" size={14} />
            {t('shorts.queue')}
          </span>
          {queued.map((seg, i) => (
            <span key={seg.id} className="sp-queue-chip" style={seg.color ? { borderColor: seg.color } : undefined}>
              {i + 1}. {seg.name}
              <IconButton variant="ghost" size="sm" icon="x" label={t('shorts.unqueue')} onClick={() => toggleExportQueue(seg.id)} />
            </span>
          ))}
          <span className="sp-info">
            {queued.length} · {t('shorts.seconds', { s: queuedSeconds.toFixed(1) })}
          </span>
          <Tooltip content={t('shorts.exportQueue.hint')}>
            <Button
              variant="secondary"
              size="sm"
              icon="download"
              disabled={exporting}
              // The queue is emptied once the render actually STARTS (in the
              // export flow), not here — cancelling the settings dialog would
              // otherwise throw the list away without exporting anything.
              onClick={() => onExportSegments(queued)}
            >
              {t('shorts.exportQueue', { n: queued.length })}
            </Button>
          </Tooltip>
          <Tooltip content={t('shorts.clearQueue.hint')}>
            <Button variant="ghost" size="sm" onClick={clearExportQueue} disabled={exporting}>
              {t('shorts.clearQueue')}
            </Button>
          </Tooltip>
        </div>
      )}

      {segments.length === 0 && <span className="sp-hint">{t('shorts.noSegments')}</span>}

      {segments.map((seg) => {
        const dur = seg.end - seg.start
        const isActive = seg.id === activeId
        const inQueue = exportQueue.includes(seg.id)
        // Collapsed by default once there are several: a row per segment with
        // every control on it is unreadable at five or six of them. The strip,
        // the name and the length stay visible; the rest folds away.
        const open = expanded === seg.id || segments.length === 1
        return (
          <div
            key={seg.id}
            className={`sp-seg${isActive ? ' active' : ''}${open ? '' : ' collapsed'}`}
            // The segment's own colour, down the left edge of its row.
            style={{ ['--seg-color' as string]: seg.color ?? SEGMENT_COLORS[0] }}
          >
            {/* With one segment there is nothing to fold away, and a button
                that does nothing is worse than no button. */}
            {segments.length > 1 && (
              <IconButton
                variant="ghost"
                size="sm"
                className="sp-fold"
                icon={open ? 'chevron-down' : 'chevron-right'}
                label={open ? t('shorts.fold') : t('shorts.unfold')}
                aria-expanded={open}
                onClick={() => setExpanded(open ? null : seg.id)}
              />
            )}
            <SegmentStrip start={seg.start} end={seg.end} cells={4} height={24} />
            {/* Name and length stay readable folded — they are what you scan a
                list of segments FOR. */}
            {!open && (
              <span className="sp-head">
                <span className="sp-head-name" title={seg.name}>
                  {seg.name}
                </span>
                <span className="sp-head-dur">{t('shorts.seconds', { s: dur.toFixed(1) })}</span>
              </span>
            )}
            {open && (
              <>
                <Tooltip content={t('shorts.colour.hint')}>
                  <input className="sp-color" type="color" aria-label={t('shorts.colour.hint')} value={seg.color ?? SEGMENT_COLORS[0]} onChange={(e) => updateShortSegment(seg.id, { color: e.target.value })} />
                </Tooltip>
                <Tooltip content={t('shorts.name.hint')}>
                  <TextField size="sm" className="sp-name" value={seg.name} label={t('shorts.name.hint')} onChange={(name) => updateShortSegment(seg.id, { name })} />
                </Tooltip>
                <Tooltip content={isActive ? t('shorts.select.off') : t('shorts.select.on')}>
                  <Button
                    variant="secondary"
                    size="sm"
                    icon={isActive ? 'rotate-cw' : 'play'}
                    pressed={isActive}
                    onClick={() => {
                      setActiveShortSegment(isActive ? null : seg.id)
                      if (!isActive) setTime(seg.start)
                    }}
                  >
                    {isActive ? t('shorts.looping') : t('shorts.select')}
                  </Button>
                </Tooltip>
                <span className="sp-info sp-range">
                  <EditableTime value={seg.start} title={t('shorts.start')} suffix="" onCommit={(v) => updateShortSegment(seg.id, { start: Math.max(0, v) })} />
                  –
                  <EditableTime value={seg.end} title={t('shorts.end')} onCommit={(v) => updateShortSegment(seg.id, { end: v })} />
                </span>
                <EditableTime
                  value={dur}
                  title={dur > 60 ? t('shorts.tooLong') : t('shorts.length')}
                  className={`sp-dur${dur > 60 ? ' over' : ''}`}
                  warn={dur > 60}
                  // Editing the LENGTH keeps the start put and moves the end. Both
                  // edges go in the patch on purpose: the length lock only guards
                  // against resizing by DRAG, so typing a length must still work.
                  onCommit={(v) => updateShortSegment(seg.id, { start: seg.start, end: seg.start + Math.max(0.5, v) })}
                />
                <IconButton
                  size="sm"
                  icon="ruler"
                  pressed={!!seg.fixedDur}
                  label={seg.fixedDur ? t('shorts.fixed.off') : t('shorts.fixed.on', { s: dur.toFixed(1) })}
                  onClick={() => updateShortSegment(seg.id, { fixedDur: !seg.fixedDur })}
                />
                <IconButton
                  size="sm"
                  icon={seg.locked ? 'lock' : 'lock-open'}
                  pressed={!!seg.locked}
                  label={seg.locked ? t('shorts.lock.off') : t('shorts.lock.on')}
                  onClick={() => updateShortSegment(seg.id, { locked: !seg.locked })}
                />
                <IconButton size="sm" icon="copy" label={t('shorts.copy')} onClick={() => copyShortSegment(seg.id)} />
                <Tooltip content={inQueue ? t('shorts.queued.hint') : t('shorts.queue.hint')}>
                  <Button variant="secondary" size="sm" icon="hourglass" pressed={inQueue} onClick={() => toggleExportQueue(seg.id)}>
                    {/* Position among the segments that still EXIST, so the number on
                        the button matches the chip list even after one is deleted. */}
                    {inQueue ? String(queued.findIndex((q) => q.id === seg.id) + 1) : t('shorts.queueOne')}
                  </Button>
                </Tooltip>
                <Tooltip content={t('shorts.exportOne.hint')}>
                  <Button variant="secondary" size="sm" icon="download" onClick={() => onExportSegments([seg])} disabled={exporting}>
                    {t('shorts.exportOne')}
                  </Button>
                </Tooltip>
              </>
            )}
            <IconButton variant="ghost" size="sm" className="sp-del" icon="x" label={t('shorts.delete')} onClick={() => deleteShortSegment(seg.id)} />
          </div>
        )
      })}

      <div className="sp-kfs">
        {kfs.length === 0 && <span className="sp-hint">{inSeg ? t('shorts.noKfIn', { name: inSeg.name }) : t('shorts.noKf')}</span>}
        {kfs.map((kf) => (
          <span key={kf.id} className="sp-kf">
            <Tooltip content={t('shorts.kf.jump', { s: kf.time.toFixed(2) })}>
              <Button variant="secondary" size="sm" icon="diamond" onClick={() => setTime(kf.time)}>
                {t('shorts.kf', { s: kf.time.toFixed(1), x: Math.round(kf.x) })}
              </Button>
            </Tooltip>
            <IconButton variant="ghost" size="sm" className="sp-del" icon="x" label={t('shorts.kf.delete')} onClick={() => deleteShortsKeyframe(kf.id)} />
          </span>
        ))}
        {active && kfs === active.keyframes && <span className="sp-info">{t('shorts.kfOf', { name: active.name })}</span>}
      </div>
      <span className="sp-info">{t('shorts.exportsSize')}</span>
    </div>
  )
}
