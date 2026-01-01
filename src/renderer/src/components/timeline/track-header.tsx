// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// A track's header (name, eye, sound, lock, its menu). Moved out of
// Timeline.tsx in SnippStudio phase 2B; onto the building blocks in phase 3c.2
// (IconButton, the one menu surface, Lucide icons).
import { memo, useEffect, useState } from 'react'
import { useStore } from '../../state/store'
import { FloatingMenu } from '../FloatingMenu'
import type { Track } from '../../types'
import { laneHeight, ownHeightFor } from '../../timeline/view-math'
import { startDrag } from './drag'
import { useTimelineView } from './view-state'
import { Button, IconButton, TextField, Tooltip, useT, type MenuItem } from '../../ui'
import { confirmDialog } from '../../ui/confirm'

export const TrackHeader = memo(TrackHeaderInner)

export function TrackHeaderInner({ track }: { track: Track }): JSX.Element {
  const t = useT()
  const setTrackFlags = useStore((s) => s.setTrackFlags)
  const setTrackHeight = useStore((s) => s.setTrackHeight)
  const deleteTrack = useStore((s) => s.deleteTrack)
  const tracks = useStore((s) => s.project.tracks)
  const removable = tracks.filter((item) => item.kind === track.kind).length > 1
  const index = tracks.findIndex((item) => item.id === track.id)
  const canMoveUp = index > 0 && tracks[index - 1].kind === track.kind
  const canMoveDown = index >= 0 && index < tracks.length - 1 && tracks[index + 1].kind === track.kind
  const trackScale = useTimelineView((v) => v.trackScale)
  const shown = laneHeight(track.kind, track.height, trackScale)
  const compact = shown < 42
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null)
  // A double-click on the name renames the track (phase Ç2b.1, report L10).
  const [naming, setNaming] = useState<string | null>(null)
  useEffect(() => {
    if (!menu) return
    const closeOutside = (event: PointerEvent): void => {
      const target = event.target as HTMLElement
      const ownMenu = !!target.closest('.ui-menu-layer')
      const ownTrigger = target.closest('.track-more-btn')?.getAttribute('data-track-id') === track.id
      if (!ownMenu && !ownTrigger) setMenu(null)
    }
    document.addEventListener('pointerdown', closeOutside)
    return () => document.removeEventListener('pointerdown', closeOutside)
  }, [menu])

  const togglePack = (): void => {
    // (The pure command: the flag, and the gathering when it goes on.)
    useStore.getState().setTrackMagnet(track.id, !track.autoPack)
    setMenu(null)
  }
  const removeTrack = async (): Promise<void> => {
    const clips = useStore.getState().project.tracks.find((item) => item.id === track.id)?.clipIds.length ?? 0
    setMenu(null)
    if (clips > 0) {
      const message = clips === 1 ? t('track.delete.confirm.one', { name: track.name }) : t('track.delete.confirm.many', { name: track.name, n: clips })
      if (!(await confirmDialog({ title: t('ask.deleteTrack.title'), message, confirm: t('ask.delete.ok'), danger: true }))) return
    }
    deleteTrack(track.id)
  }
  return (
    <div className={`tl-track-label${compact ? ' compact' : ''}`}>
      {naming !== null ? (
        <TextField
          className="tname"
          size="sm"
          autoFocus
          testid={`timeline.track.${track.id}.name`}
          label={t('track.rename')}
          value={naming}
          onChange={setNaming}
          onCommit={(name) => {
            if (name.trim() && name.trim() !== track.name) useStore.getState().renameTrack(track.id, name)
            setNaming(null)
          }}
          onBlur={() => setNaming(null)}
          onKeyDown={(event) => { if (event.key === 'Escape') setNaming(null) }}
        />
      ) : (
        <span className="tname" data-testid={`timeline.track.${track.id}.label`} title={t('track.rename.hint', { name: track.name })} onDoubleClick={() => setNaming(track.name)}>{track.name}</span>
      )}
      <span className="ticons" role="group" aria-label={t('track.controls', { name: track.name })}>
        {track.kind === 'video' && (
          <IconButton
            className={`track-quick${track.hidden ? ' off' : ''}`}
            variant="ghost"
            size="sm"
            icon={track.hidden ? 'eye-off' : 'eye'}
            label={track.hidden ? t('track.show', { name: track.name }) : t('track.hide', { name: track.name })}
            aria-pressed={!!track.hidden}
            testid={`timeline.track.${track.id}.hide`}
            onClick={() => setTrackFlags(track.id, { hidden: !track.hidden })}
          />
        )}
        <IconButton
          className={`track-quick${track.muted ? ' off' : ''}`}
          variant="ghost"
          size="sm"
          icon={track.muted ? 'volume-x' : 'volume-2'}
          label={track.muted ? t('track.unmute', { name: track.name }) : t('track.mute', { name: track.name })}
          aria-pressed={!!track.muted}
          testid={`timeline.track.${track.id}.mute`}
          onClick={() => setTrackFlags(track.id, { muted: !track.muted })}
        />
        {track.kind === 'audio' && (
          <Tooltip content={track.solo ? t('track.unsolo', { name: track.name }) : t('track.solo', { name: track.name })}>
            <Button
              className="track-quick track-solo"
              variant="ghost"
              size="sm"
              pressed={!!track.solo}
              aria-label={track.solo ? t('track.unsolo', { name: track.name }) : t('track.solo', { name: track.name })}
              data-testid={`timeline.track.${track.id}.solo`}
              onClick={() => setTrackFlags(track.id, { solo: !track.solo })}
            >
              {t('track.solo.letter')}
            </Button>
          </Tooltip>
        )}
        <IconButton
          className="track-quick"
          variant="ghost"
          size="sm"
          icon="magnet"
          pressed={!!track.autoPack}
          label={track.autoPack ? t('ct.pack.on', { name: track.name }) : t('ct.pack.off', { name: track.name })}
          testid={`timeline.track.${track.id}.pack`}
          onClick={togglePack}
        />
        <IconButton
          className="track-quick track-more-btn"
          variant="ghost"
          size="sm"
          icon="ellipsis"
          pressed={menu ? true : undefined}
          data-track-id={track.id}
          testid={`timeline.track.${track.id}.more`}
          label={t('track.more', { name: track.name })}
          aria-expanded={!!menu}
          onClick={(event) => { const rect = event.currentTarget.getBoundingClientRect(); setMenu(menu ? null : { x: rect.right + 6, y: rect.top - 2 }) }}
        />
      </span>
      {menu && (
        <FloatingMenu
          x={menu.x}
          y={menu.y}
          onPointerDown={(event) => event.stopPropagation()}
          label={t('track.menu', { name: track.name })}
          testid={`timeline.track.${track.id}.menu`}
          onClose={() => setMenu(null)}
          items={([
            { id: 'up', label: t('track.menu.up'), icon: 'arrow-up', headingBefore: t('track.menu', { name: track.name }), disabled: !canMoveUp, onSelect: () => useStore.getState().moveTrack(track.id, -1) },
            { id: 'down', label: t('track.menu.down'), icon: 'arrow-down', disabled: !canMoveDown, onSelect: () => useStore.getState().moveTrack(track.id, 1) },
            { id: 'lock', label: t('track.menu.lock'), icon: track.locked ? 'lock' : 'lock-open', checked: !!track.locked, onSelect: () => setTrackFlags(track.id, { locked: !track.locked }) },
            ...(removable ? [{ id: 'delete', label: t('track.menu.delete'), icon: 'trash' as const, danger: true, separatorBefore: true, onSelect: removeTrack }] : [])
          ] satisfies MenuItem[]).map((it) => ({ ...it, testid: `timeline.track.${track.id}.menu.${it.id}` }))}
        />
      )}
      <div
        className="track-resize"
        title={t('track.resize')}
        onPointerDown={(e) => {
          e.stopPropagation()
          if (e.button !== 0) return
          // The lane's own height as it was: Escape puts it back. (A lane's
          // height is the view: no undo step.) The grip sets the height the
          // lane is drawn at, at whatever height step the timeline is on.
          const own = track.height
          startDrag(e, {
            slop: 2,
            onMove: (p) => setTrackHeight(track.id, ownHeightFor(track.kind, Math.max(24, shown + p.dy), trackScale)),
            onCancel: (moved) => {
              if (moved) useStore.getState().setTrackHeight(track.id, own)
            }
          })
        }}
      />
    </div>
  )
}
