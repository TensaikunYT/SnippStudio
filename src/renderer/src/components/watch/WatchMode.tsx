// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// The watch-and-note mode (Dalga 3, İ; Desktop\SnippStudio\IZLE-PLAN.md;
// the agent mock-up's 7th screen): a calm screen over the editor — the film
// large, a thin strip, a narrow list of notes, one primary button. The one
// preview moves in here (PreviewSlot); the editor's panels stay mounted under
// this layer, hidden, as they were. Notes, the pin, the drawing, "Send to
// agent" and the "watch what changed" review are the ones the editor already
// has; what is new is the layout and the flow.
import { useEffect, useRef } from 'react'
import { useStore } from '../../state/store'
import { projectDuration } from '../../types'
import { BareButton, Button, IconButton, Tooltip, notify, t as tt, useT, type IconName, type StringKey } from '../../ui'
import { NOTE_COLORS } from '../../notes/model'
import type { NoteShape } from '../../types'
import { watchTimeTravel } from './watch-undo'
import { PreviewSlot } from '../PreviewSlot'
import { AgentRow } from '../agent/AgentRow'
import { useAgentStore } from '../../agent/store'
import { endReview, removeNote } from '../../notes/review'
import { ACTIONS, eventToBinding, loadBindings, modalOpen, shortcutsAllowed, type ActionId } from '../../shortcuts'
import { RESERVED_KEYS } from '../../shortcuts-presets'
import { usePreviewUi } from '../preview/pv-ui'
import { dropWatchNote, exitWatch, startWatchNote, toggleWatch, useWatch } from './watch-state'
import { WATCH_KEYS, watchClock } from './watch-math'
import { WatchStrip } from './WatchStrip'
import { WatchList, usePrimary } from './WatchList'
import { WatchBubble } from './WatchBubble'
import './watch.css'

/** The mode's own keys, read before the editor's (capture): N, Esc, Delete,
 *  Ctrl+Enter; the keys that only look pass on; every other key bound to an
 *  edit is quiet while watching (the project changes only by its notes). */
function useWatchKeys(primary: () => void): void {
  const run = useRef(primary)
  run.current = primary
  useEffect(() => {
    const b = loadBindings()
    const bound = new Map<string, ActionId>()
    for (const a of ACTIONS) if (!a.scope) bound.set(b[a.id], a.id)
    const looks = new Set<string>(WATCH_KEYS)
    const onKey = (e: KeyboardEvent): void => {
      if (e.defaultPrevented) return
      const target = e.target as HTMLElement | null
      if (!shortcutsAllowed(target, e)) return
      if (modalOpen(document)) return
      const binding = eventToBinding(e)
      if (!binding) return
      const s = useStore.getState()
      const stop = (): void => {
        e.preventDefault()
        e.stopPropagation()
      }
      if (e.key === 'Escape') {
        stop()
        const ui = usePreviewUi.getState()
        if (ui.keyList) return ui.setKeyList(false)
        if (s.noteDraft) return dropWatchNote()
        if (s.noteTool && s.noteTool !== 'pin') return s.setNoteTool('pin')
        if (s.noteReview) return endReview()
        return exitWatch()
      }
      // A focused button keeps its own Enter (and Space, the editor decides).
      const onControl = !!target && target !== document.body && !!target.closest('button, [role="button"], [role="switch"], [role="tab"]')
      if (binding === 'enter' && onControl) return
      if (binding === 'ctrl+enter') {
        stop()
        return run.current()
      }
      if (binding === b.newNote) {
        stop()
        if (!e.repeat) startWatchNote()
        return
      }
      // Ctrl+Z / Ctrl+Y take back the notes' steps only (cila3, 1b): a stroke
      // of the note being written first, then a step that changed nothing
      // but the notes; a film edit waits for the editor and says so.
      const back = binding === b.undo
      if (back || binding === b.redo || binding === 'ctrl+y') {
        stop()
        const d = s.noteDraft
        if (back && d && d.shapes.length > 0) {
          s.patchNoteDraft({ shapes: d.shapes.slice(0, -1) })
          return
        }
        if (d) return
        if (watchTimeTravel(s, back) === 'film') notify({ text: tt(back ? 'cila3.watch.undo.film' : 'cila3.watch.redo.film') })
        return
      }
      if (binding === 'delete' || binding === b.delete) {
        stop()
        if (s.noteSel && !e.repeat) removeNote(s.noteSel)
        return
      }
      // The review's own keys (B, Y) pass only while a review is open: B and
      // Y are the split and slip tools' keys the rest of the time.
      if (s.noteReview && (binding === b.reviewBefore || binding === b.reviewApprove)) return
      const id = bound.get(binding)
      if (id && looks.has(id)) return
      if (id || RESERVED_KEYS.includes(binding)) stop()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [])
}

/** The drawing tools beside the pin (cila3, 1c): the Notes tab's own box,
 *  arrow and pen. The pen keeps its old test id. */
const DRAW: [NoteShape['type'], IconName, StringKey, string][] = [
  ['rect', 'square', 'notes.draw.rect.hint', 'watch.rect'],
  ['arrow', 'move-up-right', 'notes.draw.arrow.hint', 'watch.arrow'],
  ['pen', 'pencil', 'izle.pen', 'watch.pen']
]

function WatchControls(): JSX.Element {
  const t = useT()
  const playing = useStore((s) => s.playing)
  const now = useStore((s) => s.currentTime)
  const length = useStore((s) => projectDuration(s.project))
  const tool = useStore((s) => s.noteTool)
  const color = useStore((s) => s.noteColor)
  return (
    <div className="watch-controls">
      <Button size="sm" variant="secondary" icon={playing ? 'pause' : 'play'} testid="watch.play" onClick={() => useStore.getState().setPlaying(!playing)}>
        {playing ? t('izle.pause') : t('izle.play')}
      </Button>
      <span className="watch-clock" data-testid="watch.clock">
        {`${watchClock(now)} / ${watchClock(length)}`}
      </span>
      <Button size="sm" variant="ghost" icon="map-pin" testid="watch.note" onClick={() => startWatchNote()}>
        {t('kullanim.watch.note')}
      </Button>
      <span className="watch-tools" role="group" aria-label={t('notes.draw.bar')}>
        {DRAW.map(([id, icon, key, testid]) => (
          <IconButton
            key={id}
            icon={icon}
            size="sm"
            variant="ghost"
            pressed={tool === id}
            label={t(key)}
            testid={testid}
            onClick={() => {
              const s = useStore.getState()
              if (tool === id) s.setNoteTool('pin')
              else startWatchNote(undefined, id)
            }}
          />
        ))}
      </span>
      <span className="watch-swatches note-swatches" role="group" aria-label={t('notes.draw.colour')} data-testid="watch.colours">
        {NOTE_COLORS.map((c, i) => (
          <Tooltip key={c} content={t('notes.draw.colour')}>
            <BareButton
              type="button"
              className={`note-swatch${color === c ? ' on' : ''}`}
              style={{ ['--swatch' as string]: c }}
              aria-label={t('notes.draw.colour.one', { colour: c })}
              aria-pressed={color === c}
              testid={`watch.colour.${i}`}
              onClick={() => useStore.getState().setNoteColor(c)}
            />
          </Tooltip>
        ))}
      </span>
      <span className="watch-keys" data-testid="watch.keys">{t('izle.keys')}</span>
    </div>
  )
}

export function WatchMode({ previewHost }: { previewHost: HTMLElement }): JSX.Element {
  const t = useT()
  const screen = useRef<HTMLDivElement>(null)
  const draft = useAgentStore((s) => !!s.draft)
  const primary = usePrimary()
  useWatchKeys(() => {
    if (!primary.disabled) primary.run()
  })
  // The pin stays in hand while watching (a save or a let-go puts it down).
  const tool = useStore((s) => s.noteTool)
  const writing = useStore((s) => !!s.noteDraft)
  useEffect(() => {
    if (!tool && !writing) useStore.getState().setNoteTool('pin')
  }, [tool, writing])
  return (
    <div className="watch" data-testid="watch" role="region" aria-label={t('izle.name')}>
      <div className="watch-stage">
        <div ref={screen} className="watch-screen" data-testid="watch.screen">
          <PreviewSlot host={previewHost} active />
          <WatchBubble screen={screen} />
        </div>
        {!draft && <AgentRow />}
        <WatchStrip />
        <WatchControls />
      </div>
      <WatchList />
    </div>
  )
}

/** The top bar's "Watch" (Shift+R): in, and out again. */
export function WatchButton(): JSX.Element {
  const t = useT()
  const on = useWatch((s) => s.on)
  const key = loadBindings().watchMode
  return (
    <Tooltip content={on ? t('izle.button.exit') : t('izle.button.hint')} shortcut={key}>
      <Button variant="ghost" size="sm" icon="eye" pressed={on} testid="topbar.watch" onClick={() => toggleWatch()}>
        {t('izle.button')}
      </Button>
    </Tooltip>
  )
}
