// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
import { useEffect, useRef, useState } from 'react'
import { useStore } from '../state/store'
import { decideReview, endReview, replayReview, stepReview, toggleReviewBefore } from '../notes/review'
import { noteSpan } from '../notes/model'
import { Button, IconButton, TextField, Tooltip, useT } from '../ui'
import { usePreviewUi } from './preview/pv-ui'
import { loadBindings } from '../shortcuts'
import { localNum } from '../ui/format'
import { kindLabel } from './NotesPanel'

/**
 * Going through what the agent changed ("watch only what changed", from
 * VideoHub's review tour): over the preview, while the stretch of one note
 * loops. Approve it, or say it is still there (it goes back to the agent with
 * the open notes), and the next one plays. Nothing is rendered.
 */
export function NoteReviewBar(): JSX.Element | null {
  const t = useT()
  const review = useStore((s) => s.noteReview)
  const note = useStore((s) => (s.noteReview ? s.project.notes?.find((n) => n.id === s.noteReview!.ids[s.noteReview!.index]) : undefined))
  const before = usePreviewUi((s) => s.reviewBefore)
  // "Still there…": a field for what is still wrong; Enter sends it back
  // (ONIZLEME-UYGULA-PLAN.md, K5).
  const [why, setWhy] = useState<string | null>(null)
  const whyRef = useRef<HTMLInputElement>(null)
  const noteId = note?.id
  useEffect(() => setWhy(null), [noteId])
  useEffect(() => {
    if (why !== null) whyRef.current?.focus()
  }, [why !== null])
  if (!review || !note) return null
  const keys = loadBindings()
  const last = review.index >= review.ids.length - 1
  return (
    <div className="note-review-bar" data-testid="review.bar" role="toolbar" aria-label={t('review.name')} onPointerDown={(e) => e.stopPropagation()}>
      <div className="note-review-what">
        <span className="pn-mono">
          <b>#{note.num}</b> · {t('review.place', { n: review.index + 1, total: review.ids.length })} · {localNum(noteSpan(note))} · {kindLabel(note.kind)}
        </span>
        {note.text && <span className="note-review-text" title={note.text}>{note.text}</span>}
        {note.reply && (
          <span className="note-review-text reply" title={note.reply}>
            {t('review.reply', { reply: note.reply })}
          </span>
        )}
      </div>
      <div className="pn-row">
        <IconButton icon="chevron-left" variant="ghost" size="sm" disabled={review.index === 0} label={t('review.prev')} testid="review.prev" onClick={() => stepReview(-1)} />
        <Tooltip content={t('review.replay.hint')}>
          <Button variant="ghost" size="sm" icon="rotate-cw" testid="review.replay" onClick={() => replayReview()}>
            {t('review.replay')}
          </Button>
        </Tooltip>
        <Tooltip content={t('review.before.hint')} shortcut={keys.reviewBefore}>
          <Button variant="ghost" size="sm" testid="review.before" pressed={before} disabled={!note.regionImage} onClick={() => toggleReviewBefore()}>
            {t('review.before')}
          </Button>
        </Tooltip>
        <Tooltip content={t('review.approve.hint')} shortcut={keys.reviewApprove}>
          <Button variant="secondary" size="sm" icon="check" testid="review.approve" onClick={() => decideReview('approved')}>
            {t('review.approve')}
          </Button>
        </Tooltip>
        {why === null ? (
          <Tooltip content={t('review.still.hint')}>
            <Button variant="danger" size="sm" testid="review.still" onClick={() => setWhy('')}>
              {t('review.still')}
            </Button>
          </Tooltip>
        ) : (
          <TextField
            ref={whyRef}
            size="sm"
            className="note-review-why"
            testid="review.still.why"
            label={t('review.still.why')}
            placeholder={t('review.still.placeholder')}
            value={why}
            onChange={setWhy}
            onCommit={(v) => {
              setWhy(null)
              decideReview('still', v)
            }}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                e.preventDefault()
                e.stopPropagation()
                setWhy(null)
              }
            }}
          />
        )}
        <IconButton icon="chevron-right" variant="ghost" size="sm" label={last ? t('review.next.last') : t('review.next')} testid="review.next" onClick={() => stepReview(1)} />
        <IconButton icon="x" variant="ghost" size="sm" label={t('review.end')} testid="review.end" onClick={() => endReview()} />
      </div>
    </div>
  )
}
