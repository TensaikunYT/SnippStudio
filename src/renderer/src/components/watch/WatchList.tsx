// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// The watch mode's narrow note list (IZLE-PLAN.md; the mock-up's 7th
// screen): each note's number, time and kind (or where it stands once the
// agent has it), its words; a done note faded; the picked one ringed. At the
// bottom the one primary button: the next step (watch-math.ts primaryOf).
import { useEffect, useRef } from 'react'
import { useStore } from '../../state/store'
import type { NoteStatus, WorkNote } from '../../types'
import { BareButton, Button, IconButton, Tooltip, useT, type IconName, type StringKey } from '../../ui'
import { goToNote, removeNote, startReview } from '../../notes/review'
import { isSendable, reviewQueue } from '../../notes/model'
import { sendNotesToAgent } from '../../notes/actions'
import { CopyText, SendLine } from '../agent/SendLine'
import { useInbox } from '../../agent/inbox'
import { useAgentStore } from '../../agent/store'
import { connectAgent } from '../../agent/session'
import { useAgentOn } from '../agent/useAgentShown'
import { form } from '../../agent/count'
import { revealIn } from '../../ui/reveal'
import { exitWatch } from './watch-state'
import { primaryOf, watchSpan, type Primary } from './watch-math'

/** What a note's tag says: its kind while it is the user's, else where it stands. */
function tagOf(n: WorkNote, t: (k: StringKey) => string): string {
  return n.status === 'open' ? t(`izle.kind.${n.kind}` as StringKey) : t(`notes.status.${n.status as NoteStatus}` as StringKey)
}

function NoteRow({ n, on }: { n: WorkNote; on: boolean }): JSX.Element {
  const t = useT()
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (on) revealIn(ref.current)
  }, [on])
  return (
    <div ref={ref} className={`watch-note is-${n.status}${on ? ' is-on' : ''}`} data-testid={`watch.note.${n.num}`} data-status={n.status} role="listitem">
      <BareButton className="watch-note-go" testid={`watch.note.${n.num}.go`} aria-current={on || undefined} onClick={() => goToNote(n.id)}>
        <span className="watch-note-head">
          <span className="watch-num">{n.num}</span>
          <span className="watch-time">{watchSpan(n)}</span>
          <span className="watch-tag">{tagOf(n, t)}</span>
        </span>
        {n.text && <span className="watch-note-text">{n.text}</span>}
      </BareButton>
      <IconButton icon="x" variant="ghost" size="sm" className="watch-note-x" label={t('izle.remove', { num: n.num })} testid={`watch.note.${n.num}.remove`} onClick={() => removeNote(n.id)} />
    </div>
  )
}

/** The primary button's state, read from the stores. */
export function usePrimary(): { kind: Primary; label: string; icon: IconName; disabled: boolean; run: () => void } {
  const t = useT()
  const access = useAgentOn()
  const draft = useAgentStore((s) => !!s.draft)
  const notes = useStore((s) => s.project.notes)
  const reviewing = useStore((s) => !!s.noteReview)
  const ready = useStore((s) => reviewQueue(s.project).length)
  const queued = useInbox((s) => s.queuedNotes)
  const kind = primaryOf({ access, draft, ready })
  const open = (notes ?? []).filter(isSendable)
  const queuedSet = new Set(queued)
  const toSend = open.filter((n) => !queuedSet.has(n.id)).length
  if (kind === 'access') return { kind, label: t('izle.access'), icon: 'zap', disabled: false, run: () => void connectAgent(true) }
  if (kind === 'draft') return { kind, label: t('izle.draft'), icon: 'eye', disabled: false, run: () => exitWatch() }
  if (kind === 'review') return { kind, label: t('izle.review', { n: ready }), icon: 'eye', disabled: reviewing, run: () => startReview() }
  const label = toSend > 0 ? t(`izle.send.${form(toSend)}` as StringKey, { n: toSend }) : open.length > 0 ? t('izle.send.queued', { n: open.length }) : t('izle.send.none')
  return { kind, label, icon: 'send', disabled: toSend === 0, run: () => void sendNotesToAgent() }
}

export function WatchList(): JSX.Element {
  const t = useT()
  const notes = useStore((s) => s.project.notes) ?? []
  const sel = useStore((s) => s.noteSel)
  const p = usePrimary()
  return (
    <aside className="watch-list" data-testid="watch.list" aria-label={t('izle.notes')}>
      <div className="watch-list-head">
        <strong>{t('izle.notes')}</strong>
        <span className="watch-count" data-testid="watch.count">{notes.length}</span>
      </div>
      <div className="watch-list-body" role="list">
        {notes.length === 0 ? <div className="watch-empty" data-testid="watch.empty">{t('izle.notes.empty')}</div> : notes.map((n) => <NoteRow key={n.id} n={n} on={n.id === sel} />)}
      </div>
      <Tooltip content={p.label} shortcut="ctrl+enter" describe={false}>
        <Button variant="primary" icon={p.icon} className="watch-primary" testid="watch.primary" data-kind={p.kind} disabled={p.disabled} onClick={p.run}>
          {p.label}
        </Button>
      </Tooltip>
      {p.kind === 'send' && (
        <div className="watch-send-row">
          <SendLine from="notes" testid="watch.sendLine" />
          <CopyText what={() => { const ids = (useStore.getState().project.notes ?? []).filter(isSendable).map((n) => n.id); return ids.length ? { kind: 'notes', notes: ids } : null }} testid="watch.copyText" />
        </div>
      )}
    </aside>
  )
}
