// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// The command box (SnippStudio phase 4B.2, ANA-PLAN.md §1 "Çalışma akışı";
// TERMINAL-YOK-PLAN.md, 3; GONDER-PLAN.md, 12): always there under the right
// panel. What the user writes goes to the agent's inbox (its `wait` call
// brings it into the agent's chat), with ONE selection line (ids only); a
// request that is exactly a ready job, and the ready jobs' buttons, are done
// here (0 tokens, never sent). What the user points at stands over it as tags
// (clips, files, a range, a region on the frame), each one removable.
import { useEffect, useRef, useState } from 'react'
import { useStore } from '../../state/store'
import { Button, Chip, Icon, IconButton, TextArea, Tooltip, confirmDialog, notify, useT, type StringKey, t as tt } from '../../ui'
import { isSubtitle } from '../../types'
import { ToolButton } from '../ToolButton'
import { matchReady, READY, selectionText, type ReadyId } from '../../agent/command'
import { currentSelection, useSession } from '../../agent/session'
import { sendToInbox } from '../../agent/inbox'
import { noteSent } from '../../agent/send-line'
import { CopyText, SendLine } from './SendLine'
import { useAgentOn } from './useAgentShown'
import { runReady } from '../../agent/ready'
import { useAgentStore } from '../../agent/store'
import { BOX_PINNED_KEY, boxFolded, boxHeld, focusLeavesBox } from './visibility'

const readPinned = (): boolean => {
  try {
    return localStorage.getItem(BOX_PINNED_KEY) === '1'
  } catch {
    return false
  }
}
const writePinned = (on: boolean): void => {
  try {
    if (on) localStorage.setItem(BOX_PINNED_KEY, '1')
    else localStorage.removeItem(BOX_PINNED_KEY)
  } catch {
    /* not remembered: fine */
  }
}

const one = (n: number): string => (Math.round(n * 10) / 10).toFixed(1)
const READY_ICON: Record<ReadyId, 'scissors' | 'search' | 'eraser' | 'captions' | 'volume-2' | 'image'> = {
  silences: 'scissors',
  repeats: 'search',
  fillers: 'eraser',
  subtitles: 'captions',
  loudness: 'volume-2',
  images: 'image'
}

const READY_KEY: Record<ReadyId, StringKey> = {
  silences: 'agent.ready.silences',
  repeats: 'agent.ready.repeats',
  fillers: 'agent.ready.fillers',
  subtitles: 'agent.ready.subtitles',
  loudness: 'agent.ready.loudness',
  images: 'agent.ready.images'
}

/** A ready command, from its button. */
export async function doReady(id: ReadyId, onTranscribe: () => void): Promise<boolean> {
  const what = tt(READY_KEY[id])
  const ui = useSession.getState()
  const r = await runReady(id)
  ui.setSent({ at: Date.now(), local: true })
  switch (r.kind) {
    case 'transcribe': {
      // (Subtitles made again replace the ones there, corrected by hand or
      // not: asked first when there are any. Phase 11b, C20.)
      const lines = useStore.getState().project.captions.filter(isSubtitle).length
      if (lines > 0 && !(await confirmDialog({ title: tt('agent.ready.subtitles'), message: tt('agent.ready.subtitles.replace', { n: lines }), confirm: tt('agent.ready.subtitles.again'), cancel: tt('agent.ready.subtitles.keep'), danger: true }))) return false
      onTranscribe()
      return true
    }
    case 'drafted':
      notify({ text: tt('agent.ready.drafted', { what }) })
      if (r.skipped) notify({ text: tt('agent.ready.loudness.skipped', { n: r.skipped }) })
      return true
    case 'none':
      notify({ text: tt('agent.ready.none', { what }) })
      return true
    case 'busy':
      notify({ text: tt('agent.ready.busy'), kind: 'error' })
      return false
    default:
      notify({ text: tt('agent.ready.failed', { error: r.kind === 'failed' ? r.error : '' }), kind: 'error' })
      return false
  }
}

function Tags(): JSX.Element {
  const t = useT()
  const clips = useStore((s) => s.selectedClipIds)
  const marks = useStore((s) => s.cutMarks)
  const media = useSession((s) => s.media)
  const region = useSession((s) => s.region)
  const drawing = useSession((s) => s.drawingRegion)
  const range = marks.length >= 2 ? [Math.min(...marks), Math.max(...marks)] : null
  const none = !clips.length && !media.length && !range && !region
  return (
    <div className="agent-box-tags" data-testid="agent.box.tags">
      <IconButton icon="crosshair" size="sm" variant="ghost" label={drawing ? t('agent.box.drawing') : t('agent.box.drawRegion')} pressed={drawing} onClick={() => useSession.getState().setDrawingRegion(!drawing)} testid="agent.box.region" />
      {/* With nothing selected the label's tip says the request is about the
          whole project (a sentence that stood under it before the visual
          polish); a screen reader still reads it. */}
      {none ? (
        <Tooltip content={t('agent.box.whole')}>
          <span className="agent-box-about" data-testid="agent.box.whole">
            {t('agent.box.selected')}
            <span className="ui-sr">{t('agent.box.whole')}</span>
          </span>
        </Tooltip>
      ) : (
        <span className="agent-box-about">{t('agent.box.selected')}</span>
      )}
      {clips.length > 0 && (
        <Chip tone="accent" icon="film" onRemove={() => useStore.getState().selectClips([])} removeLabel={t('agent.box.clips', { count: clips.length })} testid="agent.box.tag.clips">
          {t('agent.box.clips', { count: clips.length })}
        </Chip>
      )}
      {media.length > 0 && (
        <Chip tone="accent" icon="folder-open" onRemove={() => useSession.getState().clearMedia()} removeLabel={t('agent.box.media', { count: media.length })} testid="agent.box.tag.media">
          {t('agent.box.media', { count: media.length })}
        </Chip>
      )}
      {range && (
        <Chip tone="accent" icon="ruler" onRemove={() => useStore.getState().clearCutMarks()} removeLabel={t('agent.box.range', { from: one(range[0]), to: one(range[1]) })} testid="agent.box.tag.range">
          {t('agent.box.range', { from: one(range[0]), to: one(range[1]) })}
        </Chip>
      )}
      {region && (
        <Chip tone="accent" icon="square" onRemove={() => useSession.getState().setRegion(null)} removeLabel={t('agent.box.region', { w: Math.round(region[2]), h: Math.round(region[3]) })} testid="agent.box.tag.region">
          {t('agent.box.region', { w: Math.round(region[2]), h: Math.round(region[3]) })}
        </Chip>
      )}
    </div>
  )
}

/** "Done here: did not go to the agent", or where the sent job is: the
 *  agent took it, or it is in line with Copy beside it (SendLine.tsx). */
function Status(): JSX.Element | null {
  const t = useT()
  const sent = useSession((s) => s.lastSent)
  if (sent?.local) return <div className="agent-box-status is-local" data-testid="agent.box.status" data-state="local">{t('agent.box.status.local')}</div>
  if (sent?.inbox === undefined) return null
  return <SendLine from="box" testid="agent.box.status" />
}

/** The one selection line a job carries (ids only). */
function boxSelection(): { selection?: string } {
  const st = useStore.getState()
  const selection = selectionText(currentSelection(st.selectedClipIds, st.cutMarks))
  return selection ? { selection } : {}
}

export function CommandBox({ onTranscribe }: { onTranscribe: () => void }): JSX.Element {
  const t = useT()
  const [text, setText] = useState('')
  const agentOn = useAgentOn()
  const [readyBusy, setReadyBusy] = useState<ReadyId | null>(null)
  // Phase 3c.Y, K2 and the interface audit's G1: empty and left alone, the
  // box folds to one line, the agent on or off (its work stays one click
  // away); left open by hand, it stays open; a waiting draft or a call under
  // way holds it open (its line follows them).
  const draft = useAgentStore((s) => !!s.draft)
  const calling = useAgentStore((s) => s.events.some((e) => !e.done))
  const held = boxHeld({ draft, running: calling })
  const [pinned, setPinnedState] = useState(readPinned)
  const [open, setOpen] = useState(false)
  const focusText = useRef(false)
  const boxRef = useRef<HTMLElement>(null)
  const folded = boxFolded({ pinned, open, text, draft, running: calling })
  const setPinned = (on: boolean): void => {
    setPinnedState(on)
    writePinned(on)
    if (!on) setOpen(false)
  }
  const unfold = (pin: boolean): void => {
    focusText.current = true
    if (pin) setPinned(true)
    else setOpen(true)
  }
  // Opened for now: a press outside it (not in a window or menu it opened)
  // folds it again when it is empty, as the focus leaving it does. (The focus
  // can leave without a blur: a ready button that turns busy drops it.)
  const textNow = useRef(text)
  textNow.current = text
  useEffect(() => {
    if (!open || pinned) return
    const onDown = (e: PointerEvent): void => {
      const box = boxRef.current
      if (!box || textNow.current.trim()) return
      if (focusLeavesBox(e.target as HTMLElement | null, box)) setOpen(false)
    }
    document.addEventListener('pointerdown', onDown, true)
    return () => document.removeEventListener('pointerdown', onDown, true)
  }, [open, pinned])
  useEffect(() => {
    if (folded || !focusText.current) return
    focusText.current = false
    document.getElementById('agent-box-text')?.focus()
  }, [folded])

  const ready = async (id: ReadyId): Promise<void> => {
    setReadyBusy(id)
    try {
      await doReady(id, onTranscribe)
    } finally {
      setReadyBusy(null)
    }
  }

  // The user's request: exactly a ready job's words → done here; anything
  // else → the agent's inbox (only on this press: GONDER-PLAN.md, 11).
  const send = async (): Promise<void> => {
    const said = text.trim()
    if (!said) {
      notify({ text: t('agent.box.empty') })
      return
    }
    const local = matchReady(said)
    if (local) {
      if (await doReady(local, onTranscribe)) setText('')
      return
    }
    if (!agentOn) {
      notify({ text: t('agent.box.off'), kind: 'error' })
      return
    }
    const { selection } = boxSelection()
    const r = sendToInbox({ kind: 'task', text: said, ...(selection ? { selection } : {}) })
    useSession.getState().setSent({ at: Date.now(), inbox: r.id })
    noteSent('box', r, { kind: 'task', text: said, ...(selection ? { selection } : {}) })
    setText('')
  }

  if (folded) {
    return (
      <section className="agent-box is-folded" aria-label={t('agent.box.label')} data-testid="agent.box" data-folded="true">
        <Button variant="ghost" icon="bot" className="agent-box-open" onClick={() => unfold(false)} onFocus={() => unfold(false)} testid="agent.box.open">
          {t('agent.box.folded')}
        </Button>
        <IconButton icon="chevron-up" size="sm" variant="ghost" label={t('agent.box.keepOpen')} onClick={() => unfold(true)} testid="agent.box.expand" />
      </section>
    )
  }

  return (
    <section
      ref={boxRef}
      className="agent-box"
      aria-label={t('agent.box.label')}
      data-testid="agent.box"
      data-folded="false"
      onBlur={(e) => {
        if (pinned || !open || text.trim()) return
        if (boxRef.current && focusLeavesBox(e.relatedTarget as HTMLElement | null, boxRef.current)) setOpen(false)
      }}
    >
      {!held && (
        <div className="agent-box-fold">
          <IconButton icon="chevron-down" size="sm" variant="ghost" label={t('agent.box.fold')} onClick={() => setPinned(false)} testid="agent.box.collapse" />
        </div>
      )}
      <Tags />
      <div className="agent-box-labelrow">
        <label className="agent-box-label" id="agent-box-label" htmlFor="agent-box-text">{t('agent.box.label')}</label>
        {/* What the box is for, and where work for the agent is asked. */}
        <Tooltip content={t('agent.box.about')}>
          <span className="agent-box-info" role="note" tabIndex={0} aria-label={t('agent.box.about')} data-testid="agent.box.about">
            <Icon name="info" size={14} />
          </span>
        </Tooltip>
      </div>
      <TextArea id="agent-box-text" value={text} onChange={setText} onSubmit={() => void send()} placeholder={t('agent.box.text')} rows={2} testid="agent.box.text" />
      <div className="agent-box-row">
        <span className="agent-spacer" />
        <CopyText what={() => (text.trim() ? { kind: 'task', text, ...boxSelection() } : null)} testid="agent.box.copyText" />
        <Tooltip content={t('agent.box.sendHint')} shortcut="ctrl+enter">
          <Button size="sm" variant="secondary" icon="send" onClick={() => void send()} testid="agent.box.send">
            {t('agent.box.send')}
          </Button>
        </Tooltip>
      </div>
      {/* The ready commands: done here, 0 tokens (their names and that in the tooltips). */}
      <div className="agent-box-ready" role="group" aria-labelledby="agent-box-label">
        {READY.map((id) => (
          <ToolButton key={id} size="sm" icon={readyBusy === id ? 'loader-circle' : READY_ICON[id]} label={t(READY_KEY[id])} hint={t('agent.ready.title')} disabled={readyBusy !== null} onClick={() => void ready(id)} testid={`agent.ready.${id}`} />
        ))}
      </div>
      <Status />
      <p className="agent-box-hint" data-testid="agent.box.hint">{t('agent.box.hint')}</p>
    </section>
  )
}
