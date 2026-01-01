// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// The Notes tab (SnippStudio phase 1): the work notes of the open project.
// VideoHub's notes panel (ui/review/notes.js) on Snipp's timeline: write a
// note for a range or a frame, see the list and what the agent answered, send
// the open ones, go through what changed. Written in the panel language
// (ui/panel.css) from the design values in ui/tokens.css; its controls are
// the building blocks and its words come from t() (phase 3c.1).
import { useEffect, useRef, useState } from 'react'
import type { AgentStatus } from '../../../preload/index'
import { api } from '../platform'
import { useStore } from '../state/store'
import { AGENT_SERVER_NAME, saveDraft, sendNotesToAgent } from '../notes/actions'
import { useInbox } from '../agent/inbox'
import { useAgentOn } from './agent/useAgentShown'
import { CopyText, SendLine } from './agent/SendLine'
import { goToNote, markNote, newNote, NOTE_FOCUS_EVENT, removeNote, startReview } from '../notes/review'
import { clearNotes, filterNotes, isSendable, noteClock, noteContext, noteSpan, parseClock, updateNote, type NoteFilter } from '../notes/model'
import { NOTE_KINDS, type NoteKind, type NoteStatus, type Project, type WorkNote } from '../types'
import { Button, notify, Segmented, Select, TextArea, Tooltip, t, useT, type StringKey } from '../ui'
import { localNum } from '../ui/format'
import { NoteToolButtons } from './NoteDrawLayer'
import { EmptyState } from './EmptyState'
import { usePreviewUi } from './preview/pv-ui'
import { useNoteFilter } from '../notes/filter-pref'
import { noteScript, putNoteInScript } from '../audio/voiceover-note'
import { revealIn } from '../ui/reveal'

/** A note's kind and status as the interface says them (notes/model.ts keeps
 *  the English words the agent reads). */
export const kindLabel = (k: NoteKind): string => t(`notes.kind.${k}` as StringKey)
export const kindHint = (k: NoteKind): string => t(`notes.kind.${k}.hint` as StringKey)
export const statusLabel = (s: NoteStatus): string => t(`notes.status.${s}` as StringKey)

/** The number of notes waiting to be sent, on the tab. */
export function NotesTabBadge(): JSX.Element | null {
  const t = useT()
  const n = useStore((s) => (s.project.notes ?? []).filter(isSendable).length)
  return n > 0 ? <span className="pn-badge" aria-label={t('notes.badge', { n })}>{n}</span> : null
}

function KindChips({ value, onChange }: { value: NoteKind; onChange: (k: NoteKind) => void }): JSX.Element {
  const t = useT()
  return <Segmented value={value} label={t('notes.kind.label')} testid="notes.kind" options={NOTE_KINDS.map((k) => ({ value: k, label: kindLabel(k), hint: kindHint(k) }))} onChange={onChange} />
}

/** A time you can type ("1:02.5"); Enter or leaving the field sets it. */
function TimeField({ value, label, onSet }: { value: number; label: string; onSet: (t: number) => void }): JSX.Element {
  const t = useT()
  const [text, setText] = useState<string | null>(null)
  const commit = (): void => {
    if (text === null) return
    const v = parseClock(text)
    setText(null)
    if (v === null) notify({ text: t('notes.time.bad'), kind: 'error' })
    else onSet(v)
  }
  return (
    <Tooltip content={t('notes.time.hint', { label })}>
      <input
        className="ui-input ui-size-sm is-mono pn-time"
        aria-label={label}
        value={text ?? localNum(noteClock(value))}
        onChange={(e) => setText(e.target.value)}
        onFocus={(e) => e.target.select()}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
          if (e.key === 'Escape') setText(null)
        }}
      />
    </Tooltip>
  )
}

/** The note being written. */
function Composer(): JSX.Element | null {
  const t = useT()
  const draft = useStore((s) => s.noteDraft)
  const textRef = useRef<HTMLTextAreaElement>(null)
  const open = !!draft
  useEffect(() => {
    if (!open) return
    // (Not while the click-and-type box over the preview has the words.)
    const focus = (): void => {
      if (!usePreviewUi.getState().quickNote) textRef.current?.focus()
    }
    // (After the tab has switched to Notes and laid the box out.)
    const id = window.setTimeout(focus, 40)
    window.addEventListener(NOTE_FOCUS_EVENT, focus)
    return () => {
      window.clearTimeout(id)
      window.removeEventListener(NOTE_FOCUS_EVENT, focus)
    }
  }, [open])
  if (!draft) return null
  const s = useStore.getState()
  const patch = s.patchNoteDraft
  const len = draft.end - draft.start
  return (
    <div className="pn-box note-composer" role="group" aria-label={t('notes.new.title')}>
      <div className="pn-row">
        <strong className="note-composer-title">{t('notes.new.title')}</strong>
        <span className="pn-spacer" />
        <Tooltip content={t('notes.fromNow.hint')}>
          <Button variant="ghost" size="sm" onClick={() => { const now = useStore.getState().currentTime; patch({ start: Math.min(now, draft.end), end: Math.max(now, draft.end) }) }}>
            {t('notes.fromNow')}
          </Button>
        </Tooltip>
        <Tooltip content={t('notes.toNow.hint')}>
          <Button variant="ghost" size="sm" onClick={() => { const now = useStore.getState().currentTime; patch({ start: Math.min(draft.start, now), end: Math.max(draft.start, now) }) }}>
            {t('notes.toNow')}
          </Button>
        </Tooltip>
      </div>
      <div className="pn-row" title={t('notes.span.hint')}>
        <TimeField value={draft.start} label={t('notes.from')} onSet={(v) => patch({ start: v, end: Math.max(v, draft.end) })} />
        <span className="pn-dim">{t('notes.to.word')}</span>
        <TimeField value={draft.end} label={t('notes.to')} onSet={(v) => patch({ start: Math.min(draft.start, v), end: v })} />
        <span className="pn-spacer" />
        <span className="pn-dim">{len > 1e-3 ? t('notes.seconds', { s: len.toFixed(1) }) : t('notes.oneFrame')}</span>
      </div>
      <KindChips value={draft.kind} onChange={(kind) => patch({ kind })} />
      <TextArea
        ref={textRef}
        testid="notes.draft.text"
        value={draft.text}
        placeholder={t('notes.draft.placeholder')}
        label={t('notes.draft.label')}
        onChange={(text) => patch({ text })}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault()
            saveDraft()
          }
          if (e.key === 'Escape') {
            e.preventDefault()
            e.currentTarget.blur()
          }
        }}
      />
      <div className="pn-row" title={t('notes.draw.hint')}>
        <NoteToolButtons />
      </div>
      <div className="pn-row">
        <span className="pn-dim">{draft.shapes.length > 0 ? t(draft.shapes.length === 1 ? 'notes.strokes.one' : 'notes.strokes.many', { n: draft.shapes.length, at: noteClock(draft.at ?? draft.start) }) : t('notes.enterSaves')}</span>
        <span className="pn-spacer" />
        <Button variant="secondary" size="sm" testid="notes.draft.cancel" onClick={() => s.cancelNoteDraft()}>
          {t('notes.cancel')}
        </Button>
        <Button variant="secondary" size="sm" testid="notes.draft.save" onClick={() => saveDraft()}>
          {t('notes.draft.save')}
        </Button>
      </div>
    </div>
  )
}

/** What a note is on, in one line, and the long form for its tooltip (a
 *  code clip: the film's own time, and its folder). */
function onLine(project: Project, n: WorkNote): { text: string; title: string } | null {
  const ctx = noteContext(project, n)
  if (!ctx.clip) return null
  const name = ctx.clip.nested ? t('notes.on.compound') : ctx.asset?.name ?? t('notes.on.clip')
  const stays = t('notes.on.stays')
  if (!ctx.code) return { text: t('notes.on', { name }), title: stays }
  const film = ctx.to! - ctx.from! > 1e-3 ? localNum(`${noteClock(ctx.from!)}–${noteClock(ctx.to!)}`) : localNum(noteClock(ctx.from!))
  const folder = ctx.folder ? `${t('notes.on.folder', { folder: ctx.folder })}\n` : ''
  return { text: t('notes.on.code', { name, film }), title: `${folder}${t('notes.on.codeTold')} ${stays}` }
}

function NoteCard({ note }: { note: WorkNote }): JSX.Element {
  const t = useT()
  const selected = useStore((s) => s.noteSel === note.id)
  const project = useStore((s) => s.project)
  const [editing, setEditing] = useState(false)
  const [text, setText] = useState(note.text)
  const [kind, setKind] = useState<NoteKind>(note.kind)
  const [big, setBig] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (selected) revealIn(ref.current, 'nearest')
  }, [selected])
  const on = onLine(project, note)
  const edit = (): void => {
    setText(note.text)
    setKind(note.kind)
    setEditing(true)
  }
  const save = (): void => {
    useStore.getState().editNotes((p) => void updateNote(p, note.id, { text: text.trim(), kind }))
    setEditing(false)
  }
  return (
    <div ref={ref} className={`pn-card note-card st-${note.status}${selected ? ' sel' : ''}`} data-note={note.num} data-testid={`notes.card.${note.id}`} onClick={() => !editing && goToNote(note.id)}>
      <div className="pn-card-head">
        <b>#{note.num}</b>
        <span className="pn-mono">{localNum(noteSpan(note))}</span>
        <span>{kindLabel(note.kind)}</span>
        <span className="pn-spacer" />
        <span className={`pn-pill st-${note.status}`}>{statusLabel(note.status)}</span>
      </div>
      {editing ? (
        <div className="pn-list" onClick={(e) => e.stopPropagation()}>
          <KindChips value={kind} onChange={setKind} />
          <TextArea
            autoFocus
            value={text}
            label={t('notes.card.label', { n: note.num })}
            onChange={setText}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                save()
              }
              if (e.key === 'Escape') setEditing(false)
            }}
          />
          <div className="pn-row">
            <span className="pn-spacer" />
            <Button variant="secondary" size="sm" onClick={() => setEditing(false)}>
              {t('notes.cancel')}
            </Button>
            <Button variant="secondary" size="sm" testid={`notes.card.${note.id}.save`} onClick={save}>
              {t('notes.card.save')}
            </Button>
          </div>
        </div>
      ) : (
        note.text && <div className="pn-text">{note.text}</div>
      )}
      {on && <div className="pn-dim" title={on.title}>{on.text}</div>}
      {note.shapes?.length ? (
        note.regionImage ? (
          <img
            className={`note-shot${big ? ' big' : ''}`}
            src={note.regionImage}
            alt={t('notes.shot.alt', { n: note.num })}
            title={t('notes.shot.hint')}
            onClick={(e) => {
              e.stopPropagation()
              setBig(!big)
            }}
          />
        ) : (
          <div className="pn-dim">{t('notes.shot.making')}</div>
        )
      ) : null}
      {note.reply && (
        <div className="pn-quote">
          <b>{t('notes.agentSaid')}</b>
          {note.reply}
        </div>
      )}
      {!editing && (
        <div className="pn-row" onClick={(e) => e.stopPropagation()}>
          {note.status === 'ready' && (
            <>
              <Tooltip content={t('notes.look.hint')}>
                <Button variant="secondary" size="sm" icon="play" testid={`notes.card.${note.id}.look`} onClick={() => startReview(note.id)}>
                  {t('notes.look')}
                </Button>
              </Tooltip>
              <Button variant="secondary" size="sm" icon="check" testid={`notes.card.${note.id}.approve`} onClick={() => markNote(note.id, 'approved')}>
                {t('notes.approve')}
              </Button>
              <Tooltip content={t('notes.still.hint')}>
                <Button variant="danger" size="sm" testid={`notes.card.${note.id}.still`} onClick={() => markNote(note.id, 'still')}>
                  {t('notes.still')}
                </Button>
              </Tooltip>
            </>
          )}
          {(note.status === 'approved' || note.status === 'agent') && (
            <Tooltip content={note.status === 'agent' ? t('notes.reopen.agent') : t('notes.reopen.hint')}>
              <Button variant="ghost" size="sm" testid={`notes.card.${note.id}.reopen`} onClick={() => markNote(note.id, 'open')}>
                {t('notes.reopen')}
              </Button>
            </Tooltip>
          )}
          {noteScript(note) && (
            <Tooltip content={t('vo.note.hint')}>
              <Button variant="ghost" size="sm" icon="mic" testid={`notes.card.${note.id}.script`} onClick={() => void putNoteInScript(note)}>
                {t('vo.note.put')}
              </Button>
            </Tooltip>
          )}
          {isSendable(note) && (
            <Button variant="ghost" size="sm" testid={`notes.card.${note.id}.edit`} onClick={edit}>
              {t('notes.edit')}
            </Button>
          )}
          <span className="pn-spacer" />
          <Tooltip content={t('notes.delete.hint')}>
            <Button variant="ghost" size="sm" className="pn-delete" aria-label={t('notes.delete.label', { n: note.num })} testid={`notes.card.${note.id}.delete`} onClick={() => removeNote(note.id)}>
              {t('notes.delete')}
            </Button>
          </Tooltip>
        </div>
      )}
    </div>
  )
}

/** Is an agent able to reach this Snipp, and the switch when it is not. */
function AgentRow(): JSX.Element | null {
  const t = useT()
  const [status, setStatus] = useState<AgentStatus | null>(null)
  useEffect(() => {
    void api?.agent?.status().then((s) => setStatus(s ?? null))
  }, [])
  const bridge = api
  if (!bridge?.agent || !status) return null
  if (status.running) {
    return (
      <div className="pn-dim" title={t('notes.access.onHint', { name: AGENT_SERVER_NAME })}>
        {t('notes.access.on', { name: AGENT_SERVER_NAME })}
      </div>
    )
  }
  return (
    <div className="pn-row">
      <span className="pn-dim note-agent-off" role="status">
        {status.error ? t('notes.access.error', { error: status.error }) : t('notes.access.off')}
      </span>
      {!status.error && (
        <Tooltip content={t('notes.access.turnOn.hint')}>
          <Button variant="secondary" size="sm" onClick={() => void bridge.agent.setEnabled(true).then((s) => setStatus(s ?? null))}>
            {t('notes.access.turnOn')}
          </Button>
        </Tooltip>
      )}
    </div>
  )
}

export function NotesPanel(): JSX.Element {
  const t = useT()
  // Phase 3c.Y, K2: "Send to your agent" and the access line only while the
  // agent is switched on (the notes themselves stay).
  const agentOn = useAgentOn()
  const notes = useStore((s) => s.project.notes)
  const hasDraft = useStore((s) => !!s.noteDraft)
  // "Point" (phase 11b, the user's request): the pin tool on, a click on the
  // preview starts a note there (NoteDrawLayer). Only in this mode does the
  // preview take a click for a note: selecting and moving clips stay as they are.
  const pointing = useStore((s) => s.noteTool === 'pin')
  const togglePoint = (): void => {
    const s = useStore.getState()
    s.setPlaying(false)
    s.setNoteTool(s.noteTool === 'pin' ? null : 'pin')
  }
  // Shared with the N lane: "All" also shows the done notes there (DENEME-2-PLAN-N.md, K3).
  const filter = useNoteFilter((s) => s.filter)
  const setFilter = useNoteFilter((s) => s.setFilter)
  const all = notes ?? []
  const shown = filterNotes(all, filter)
  // (Notes already in line for the agent are not sent again: GONDER-PLAN.md.)
  const queued = useInbox((s) => s.queuedNotes)
  const sendable = all.filter(isSendable)
  const toSend = sendable.filter((n) => !queued.includes(n.id)).length
  const inLine = sendable.length - toSend
  const ready = all.filter((n) => n.status === 'ready').length
  const approved = all.filter((n) => n.status === 'approved').length
  // A note picked on the lane that this list is not showing: show everything.
  const sel = useStore((s) => s.noteSel)
  useEffect(() => {
    if (sel && all.some((n) => n.id === sel) && !shown.some((n) => n.id === sel)) setFilter('all')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sel])

  return (
    <div className="pn notes-panel">
      <div className="pn-head">
        <strong>{t('notes.title')}</strong>
        <span className="pn-spacer" />
        <Select
          size="sm"
          testid="notes.filter"
          value={filter}
          label={t('notes.filter')}
          onChange={(v) => setFilter(v as NoteFilter)}
          options={[
            { value: 'open', label: t('notes.filter.open', { n: all.length - ready - approved }) },
            { value: 'ready', label: t('notes.filter.ready', { n: ready }) },
            { value: 'all', label: t('notes.filter.all', { n: all.length }) }
          ]}
        />
        <Tooltip content={t('notes.point.hint')}>
          <Button variant="secondary" size="sm" icon="map-pin" testid="notes.point" pressed={pointing} onClick={() => togglePoint()}>
            {t('notes.point')}
          </Button>
        </Tooltip>
        <Tooltip content={t('notes.new.hint')} shortcut="n">
          <Button variant="secondary" size="sm" icon="plus" testid="notes.new" onClick={() => newNote()}>
            {t('notes.new')}
          </Button>
        </Tooltip>
      </div>
      {ready > 0 && (
        <Tooltip content={t('notes.review.hint')}>
          <Button variant="secondary" icon="check" pressed className="pn-wide" testid="notes.review" onClick={() => startReview()}>
            {t('notes.review', { n: ready })}
          </Button>
        </Tooltip>
      )}
      <Composer />
      {shown.length > 0 ? (
        <div className="pn-list">
          {shown.map((n) => (
            <NoteCard key={n.id} note={n} />
          ))}
        </div>
      ) : (
        !hasDraft && (all.length > 0 ? <div className="pn-empty">{t('notes.emptyList')}</div> : <EmptyState className="pn-empty" text={t('notes.empty')} action={t('empty.notes.action')} icon="plus" onAction={() => newNote()} testid="notes.empty" />)
      )}
      <div className="pn-foot">
        {agentOn && (
          <div className="pn-send-row">
          <Tooltip content={t('notes.send.hint')}>
            <Button variant="secondary" icon="send" className="pn-wide" testid="notes.send" disabled={toSend === 0} onClick={() => void sendNotesToAgent()}>
              {toSend === 0 && inLine > 0 ? t('notes.send.queued', { n: inLine }) : t('notes.send', { n: toSend })}
            </Button>
          </Tooltip>
          <CopyText what={() => { const ids = (useStore.getState().project.notes ?? []).filter(isSendable).map((n) => n.id); return ids.length ? { kind: 'notes', notes: ids } : null }} testid="notes.copyText" />
          </div>
        )}
        {agentOn && <SendLine from="notes" testid="notes.sendLine" />}
        {agentOn && <AgentRow />}
        {approved > 0 && (
          <Tooltip content={t('notes.clearApproved.hint')}>
            <Button variant="ghost" size="sm" testid="notes.clear-approved" onClick={() => useStore.getState().editNotes((p) => void clearNotes(p, 'approved'))}>
              {t('notes.clearApproved', { n: approved })}
            </Button>
          </Tooltip>
        )}
      </div>
    </div>
  )
}
